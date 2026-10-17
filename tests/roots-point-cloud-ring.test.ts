import {afterEach, describe, expect, it, vi} from 'vitest';
import {
 RootsPointCloudRing, RootsPointCloudRingError, prepareRootsPointCloudRing, rootsPointCloudRingBytes,
 ROOTS_POINT_CLOUD_CAPACITY, ROOTS_POINT_CLOUD_RECENT_WINDOW, ROOTS_POINT_CLOUD_APPEND_LIMIT,
 type RootsPointCloudWindow,
} from '../src/engine/rootsPointCloudRing';

function points(first: number, count: number): Float32Array {
 const values = new Float32Array(count * 4);
 for (let i = 0; i < count; i++) values.set([first + i, -(first + i), (first + i) / 4, (first + i) / 8], i * 4);
 return values;
}
function unpack(window: RootsPointCloudWindow): number[] { return window.ranges.flatMap(range => Array.from(range.values)); }
function xs(window: RootsPointCloudWindow): number[] { return unpack(window).filter((_, i) => i % 4 === 0); }
afterEach(() => vi.unstubAllGlobals());

describe('source arrival-order point ring, independent of color and projection', () => {
 it('plans the native 10M / 3M windows without allocation and accounts compact raw storage', () => {
  const ring = new RootsPointCloudRing();
  expect(ROOTS_POINT_CLOUD_CAPACITY).toBe(10_000_000);
  expect(ROOTS_POINT_CLOUD_RECENT_WINDOW).toBe(3_000_000);
  expect(ring.plan).toEqual({capacityPoints: 10_000_000, recentWindowPoints: 3_000_000, maxBytes: 160_000_000, storageBytes: 160_000_000});
  expect(ring.facts.allocatedBytes).toBe(0);
  expect(ring.fullWindow().ranges).toEqual([]);
  ring.append(new Float32Array());
  expect(ring.facts.allocatedBytes).toBe(0);
  ring.dispose();
 });

 it('uses the newest window before saturation and preserves full arrival order separately', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 7, recentWindowPoints: 3});
  const input = points(0, 5), before = input.slice();
  ring.append(input);
  expect(xs(ring.recentWindow())).toEqual([2, 3, 4]);
  expect(xs(ring.fullWindow())).toEqual([0, 1, 2, 3, 4]);
  expect(ring.recentWindow()).toMatchObject({firstWriteOrdinal: 2n, totalWrites: 5n, pointCount: 3});
  expect(ring.facts).toMatchObject({retainedPointCount: 5, writeCursor: 5, totalWrites: 5n, allocatedBytes: 112});
  expect(input).toEqual(before);
  const borrow = ring.fullWindow();
  expect(borrow.ranges[0].values.buffer).not.toBe(input.buffer);
  expect(borrow.ranges[0].values.buffer).toBe(ring.recentWindow().ranges[0].values.buffer);
 });

 it('returns at most two physical borrowed ranges after wrap, in chronological order', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 5, recentWindowPoints: 4});
  ring.append(points(0, 5));
  expect(xs(ring.fullWindow())).toEqual([0, 1, 2, 3, 4]);
  expect(ring.facts.writeCursor).toBe(0);
  ring.append(points(5, 2));
  const full = ring.fullWindow(), recent = ring.recentWindow();
  expect(xs(full)).toEqual([2, 3, 4, 5, 6]);
  expect(xs(recent)).toEqual([3, 4, 5, 6]);
  expect(full.ranges.map(r => [r.pointOffset, r.pointCount])).toEqual([[2, 3], [0, 2]]);
  expect(recent.ranges.map(r => [r.pointOffset, r.pointCount])).toEqual([[3, 2], [0, 2]]);
  expect(recent).toMatchObject({firstWriteOrdinal: 3n, totalWrites: 7n});
 });

 it('matches an independent bounded FIFO through every small capacity and many multi-wrap batches', () => {
  for (let capacity = 1; capacity <= 13; capacity++) {
   for (const recent of [1, 3, 20]) {
    const ring = new RootsPointCloudRing({capacityPoints: capacity, recentWindowPoints: recent});
    let all: number[] = [], total = 0;
    for (const count of [0, 1, 4, 2, 19, 27, 0, 13, 1]) {
     ring.append(points(total, count));
     all.push(...Array.from({length: count}, (_, i) => total + i)); total += count;
     all = all.slice(-capacity);
     expect(xs(ring.fullWindow())).toEqual(all);
     expect(xs(ring.recentWindow())).toEqual(all.slice(-recent));
     expect(ring.fullWindow().ranges.length).toBeLessThanOrEqual(2);
     expect(ring.facts).toMatchObject({retainedPointCount: all.length, writeCursor: total % capacity, totalWrites: BigInt(total)});
    }
   }
  }
 });

 it('copies raw float32 bit patterns without filtering, metric clamping or coloring', () => {
  // Includes a noncanonical quiet NaN payload, infinities, -0, and metrics
  // outside [0,1]. GPU metric constraint belongs to the later upload owner.
  const bits = new Uint32Array([0x7fc01234, 0x7f800000, 0xff800000, 0xc0000000, 0x80000000, 0, 0x3eaaaaab, 0x40000000]);
  const input = new Float32Array(bits.buffer);
  const ring = new RootsPointCloudRing({capacityPoints: 2});
  ring.append(input);
  const raw = ring.fullWindow().ranges[0].values;
  expect(new Uint32Array(raw.buffer, raw.byteOffset, raw.length)).toEqual(bits);
  expect(ring.facts.retainedPointCount).toBe(2);
 });

 it('supports bounded subranges and explicitly rejects oversized submissions without mutation', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 7, recentWindowPoints: 3});
  const input = points(100, ROOTS_POINT_CLOUD_APPEND_LIMIT + 2);
  const before = ring.facts;
  expect(() => ring.append(input)).toThrow('split the arrival batch');
  expect(ring.facts).toEqual(before);
  ring.append(input, {pointOffset: 1, pointCount: ROOTS_POINT_CLOUD_APPEND_LIMIT});
  expect(xs(ring.fullWindow())).toEqual(Array.from({length: 7}, (_, i) => 101 + ROOTS_POINT_CLOUD_APPEND_LIMIT - 7 + i));
  expect(ring.facts.totalWrites).toBe(BigInt(ROOTS_POINT_CLOUD_APPEND_LIMIT));
  expect(ring.facts.writeCursor).toBe(ROOTS_POINT_CLOUD_APPEND_LIMIT % 7);
 });

 it('invalidates borrowed windows on mutations, rejects foreign windows, and never copies for a read', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 5});
  ring.append(points(0, 4));
  const first = ring.fullWindow(), second = ring.recentWindow();
  expect(ring.isCurrentWindow(first)).toBe(true);
  expect(first.ranges[0].values.buffer).toBe(second.ranges[0].values.buffer);
  expect(new RootsPointCloudRing({capacityPoints: 5}).isCurrentWindow(first)).toBe(false);
  ring.append(new Float32Array());
  expect(ring.isCurrentWindow(first)).toBe(true);
  ring.append(points(4, 1));
  expect(ring.isCurrentWindow(first)).toBe(false);
  const current = ring.fullWindow();
  ring.clear();
  expect(ring.isCurrentWindow(current)).toBe(false);
  expect(ring.facts).toMatchObject({retainedPointCount: 0, writeCursor: 0, totalWrites: 0n, allocatedBytes: 80});
  expect(ring.fullWindow().ranges).toEqual([]);
  ring.append(points(99, 1));
  expect(xs(ring.fullWindow())).toEqual([99]);
  expect(ring.fullWindow().ranges[0].values.buffer).toBe(first.ranges[0].values.buffer);
 });

 it('rejects any alias of the ring buffer before a wrapping append could overwrite unread input', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 5});
  ring.append(points(0, 4));
  const window = ring.fullWindow(), before = unpack(window), facts = ring.facts;
  expect(() => ring.append(window.ranges[0].values)).toThrow('aliases');
  expect(() => ring.append(new Float32Array(window.ranges[0].values.buffer, 0, 4))).toThrow('aliases');
  expect(ring.facts).toEqual(facts);
  expect(unpack(ring.fullWindow())).toEqual(before);
  expect(ring.isCurrentWindow(window)).toBe(true);
 });

 it('checks cancellation before allocation or any writes, and can resume with a fresh request', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 5});
  const signal = AbortSignal.abort();
  expect(() => ring.append(points(0, 2), {signal})).toThrow(expect.objectContaining({name: 'AbortError'}));
  expect(ring.facts.allocatedBytes).toBe(0);
  ring.append(points(0, 2));
  const before = ring.fullWindow();
  expect(() => ring.append(points(2, 5), {signal})).toThrow(expect.objectContaining({name: 'AbortError'}));
  expect(ring.isCurrentWindow(before)).toBe(true);
  expect(xs(ring.fullWindow())).toEqual([0, 1]);
  ring.append(points(2, 1));
  expect(xs(ring.fullWindow())).toEqual([0, 1, 2]);
 });

 it('preflights exact byte capacity and safe integer arithmetic without allocating', () => {
  expect(rootsPointCloudRingBytes(3)).toBe(48);
  expect(prepareRootsPointCloudRing({capacityPoints: 3, maxBytes: 47})).toMatchObject({ok: false, error: {kind: 'capacity'}});
  expect(prepareRootsPointCloudRing({capacityPoints: 3, maxBytes: 48})).toMatchObject({ok: true, value: {storageBytes: 48}});
  expect(prepareRootsPointCloudRing({capacityPoints: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER})).toMatchObject({ok: false, error: {kind: 'capacity'}});
  for (const raw of [null, [], {capacityPoints: 0}, {capacityPoints: 1.5}, {capacityPoints: NaN}, {recentWindowPoints: -1}, {maxBytes: Infinity}]) {
   expect(prepareRootsPointCloudRing(raw)).toMatchObject({ok: false, error: {kind: 'input'}});
  }
 });

 it('keeps a failed first allocation empty and retryable with its original plan', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 3}), input = points(0, 2), Native = Float32Array;
  vi.stubGlobal('Float32Array', new Proxy(Native, {construct() { throw new RangeError('injected allocation failure'); }}));
  expect(() => ring.append(input)).toThrow(expect.objectContaining({kind: 'allocation'}));
  expect(ring.facts).toMatchObject({retainedPointCount: 0, totalWrites: 0n, allocatedBytes: 0});
  vi.unstubAllGlobals();
  ring.append(input);
  expect(xs(ring.fullWindow())).toEqual([0, 1]);
 });

 it('rejects malformed and detached inputs without changing existing arrivals', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 5});
  ring.append(points(0, 2));
  const before = ring.fullWindow();
  expect(() => ring.append(new Float64Array(4) as unknown as Float32Array)).toThrow(RootsPointCloudRingError);
  expect(() => ring.append(new Float32Array(3))).toThrow('tuples');
  expect(() => ring.append(points(2, 2), {pointOffset: -1})).toThrow('pointOffset');
  expect(() => ring.append(points(2, 2), {pointOffset: 3, pointCount: 0})).toThrow('range');
  expect(() => ring.append(points(2, 2), {pointCount: 3})).toThrow('range');
  const detached = points(2, 1); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  expect(() => ring.append(detached)).toThrow('detached');
  expect(() => ring.append(new Float32Array(new SharedArrayBuffer(16)))).toThrow('unshared');
  expect(ring.isCurrentWindow(before)).toBe(true);
  expect(xs(ring.fullWindow())).toEqual([0, 1]);
 });

 it('detects illegal borrower transfer and still permits cleanup', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 2}); ring.append(points(0, 2));
  const borrowed = ring.fullWindow();
  structuredClone(borrowed.ranges[0].values.buffer, {transfer: [borrowed.ranges[0].values.buffer]});
  expect(ring.isCurrentWindow(borrowed)).toBe(false);
  expect(() => ring.fullWindow()).toThrow('detached');
  expect(() => ring.append(points(2, 1))).toThrow('detached');
  ring.dispose(); expect(ring.facts.allocatedBytes).toBe(0);
 });

 it('disposes idempotently, invalidates borrows and cannot silently restart an old instance', () => {
  const ring = new RootsPointCloudRing({capacityPoints: 2}); ring.append(points(0, 2));
  const borrowed = ring.fullWindow(); ring.dispose(); ring.dispose();
  expect(ring.isCurrentWindow(borrowed)).toBe(false);
  expect(ring.facts).toMatchObject({disposed: true, retainedPointCount: 0, writeCursor: 0, totalWrites: 0n, allocatedBytes: 0});
  expect(() => ring.clear()).toThrow('disposed');
  expect(() => ring.recentWindow()).toThrow('disposed');
  expect(() => ring.append(points(0, 1))).toThrow('disposed');
  // Releasing the owner is not a false claim that escaped JS references were freed.
  expect(borrowed.ranges[0].values.byteLength).toBe(32);
 });
});
