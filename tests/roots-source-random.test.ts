import { describe, expect, it } from 'vitest';
import fixture from './fixtures/roots/random48-source.json';
import { prepareRootsWorkerPartitions, RootsSourceRandom48 } from '../src/engine/rootsSourceRandom';

const bits = (n: number) => { const b = new ArrayBuffer(8), d = new DataView(b); d.setFloat64(0, n); return d.getBigUint64(0).toString(16).padStart(16, '0'); };
describe('retained Random48 and worker partition facts', () => {
 for (const f of fixture.rng) it(`matches independent integer-bit vectors for seed ${f.seed}`, () => {
  const r = new RootsSourceRandom48(BigInt(f.seed));
  expect(f.bits.map(() => bits(r.nextDouble()))).toEqual(f.bits);
  expect(String(r.state48)).toBe(f.endingState48);
 });
 for (const f of fixture.partitionAndDomain) it(`partitions and consumes complete parameter draws (${f.sampleCount}/${f.configuredWorkers}/${f.seed})`, () => {
  const result = prepareRootsWorkerPartitions(f.sampleCount, f.configuredWorkers, BigInt(f.seed));
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value.workerCount).toBe(f.workers.length);
  for (const expected of f.workers) {
   const partition = result.value.partition(expected.worker);
   expect(partition).toEqual({ index: expected.worker, start: expected.start, count: expected.count, seed: BigInt(expected.workerSeed) });
   const r = new RootsSourceRandom48(partition.seed);
   for (const row of expected.samples) {
    expect(result.value.partitionForSample(row.ordinal)).toEqual(partition);
    // Source FIXED draws zero; REAL draws one and RECTANGLE draws two.
    expect(-5 + 10 * r.nextDouble()).toBe(row.real);
    expect([-1 + 2 * r.nextDouble(), -1 + 2 * r.nextDouble()]).toEqual(row.rectangle);
   }
  }
 });
 it('jumps exact double calls, clones checkpoints and resets independently', () => {
  for (const count of [0, 1, 2, 7, 1000, 4001]) {
   const sequential = new RootsSourceRandom48(-5123n), jumped = new RootsSourceRandom48(-5123n);
   for (let i = 0; i < count; i++) sequential.nextDouble();
   jumped.skipDraws(count); expect(jumped.state48).toBe(sequential.state48);
   const copy = jumped.clone(); expect(copy.nextDouble()).toBe(sequential.nextDouble());
   expect(jumped.state48).not.toBe(copy.state48);
   jumped.reset(0n); expect(bits(jumped.nextDouble())).toBe(fixture.rng[0].bits[0]);
  }
  const large = new RootsSourceRandom48(42n); large.skipDraws((1n << 200n) + 7n);
  expect(bits(large.nextDouble())).toBe(fixture.rng[3].bits[7]);
 });
 it('has bounded lazy facts at Java int limits and exact wrapped worker seeds', () => {
  const p = prepareRootsWorkerPartitions(2147483647, 2147483647, 9223372036854775807n);
  if (!p.ok) throw Error('unexpected');
  expect(p.value.partitionForSample(2147483646)).toEqual({ index: 2147483646, start: 2147483646, count: 1, seed: BigInt.asIntN(64, 9223372036854775807n - 7046029254386353131n * 2147483646n) });
  expect(() => p.value.partition(-1)).toThrow(RangeError); expect(() => p.value.partitionForSample(2147483647)).toThrow(RangeError);
 });
 it('rejects invalid counts/seeds without mutating an owned random state', () => {
  for (const n of [0, -1, 1.1, NaN, Infinity, 2147483648]) expect(prepareRootsWorkerPartitions(n, 1, 0n).ok).toBe(false);
  expect(prepareRootsWorkerPartitions(1, 0, 0n).ok).toBe(false);
  expect(prepareRootsWorkerPartitions(1, 1, 1n << 63n).ok).toBe(false);
  expect(() => new RootsSourceRandom48(1n << 63n)).toThrow(RangeError);
  const r = new RootsSourceRandom48(0n), before = r.state48;
  for (const n of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, -1n]) expect(() => r.skipDraws(n)).toThrow(RangeError);
  expect(() => r.reset(1n << 63n)).toThrow(RangeError); expect(r.state48).toBe(before);
 });
});
