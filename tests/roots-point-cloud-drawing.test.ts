import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {prepareRootsPointFrame, prepareRootsPointCloudBackground, rootsPointCloudPrograms, rootsPointCloudChunkPoints, prepareRootsPointChunk, prepareRootsPointChunks, ROOTS_POINT_FRAME_BINDING_BYTES, ROOTS_NATIVE_POINT_CLOUD_CHUNK} from '../src/engine/rootsPointCloudDrawing';
import {RootsPointCloudRing} from '../src/engine/rootsPointCloudRing';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {prepareRootsDensityColor, ROOTS_DENSITY_COLOR_VERSION, type RootsMetricColorPlan} from '../src/engine/rootsDensityColor';

const F = Math.fround;
function plan(accumulation = false) {
 const c = defaultRootsPresentationConfiguration(); c.mode = 'point-cloud'; c.accumulation.enabled = accumulation;
 return prepareRootsProjection(c, {width: 500, height: 600, viewport: {logicalWidth: 250, logicalHeight: 300, referenceLogicalHeight: 486, target: 'offscreen'}});
}
function color(background = '#000000') { return prepareRootsDensityColor({settings: {rootDensityColorVersion: ROOTS_DENSITY_COLOR_VERSION, background}}) as RootsMetricColorPlan; }
function ring(capacity = 8, recent = capacity) { return new RootsPointCloudRing({capacityPoints: capacity, recentWindowPoints: recent}); }
function input(n: number, start = 0) { return Float32Array.from({length: n * 4}, (_, i) => i % 4 === 3 ? .5 : start + Math.floor(i / 4)); }

describe('Roots point-cloud shared drawing facts', () => {
 it('preserves all four previous ES shader byte strings and owns the native header', () => {
  const webgl = rootsPointCloudPrograms('webgl2'), native = rootsPointCloudPrograms('native-gl41');
  const expected = ['0ca68ed53446491634244979262e4adccb71163f2bb22793065c517f0e631408', 'afd76b2373f8d06cfd1f8285111e775762cf54ac21fd9819cc9dc923f3d60174', '328f5bfd9ece581779a83701810d0716f0c1b5893a0a099a1c2570f21003081d', '17110e6aee18a62ed06d89f652dcaee83d80762da4414527de4166d44bcbfbf6'];
  let i = 0;
  for (const name of ['point', 'fade'] as const) for (const stage of ['vertex', 'fragment'] as const) {
   expect(createHash('sha256').update(webgl[name][stage]).digest('hex')).toBe(expected[i++]);
   expect(native[name][stage]).toBe('#version 410 core\n' + webgl[name][stage].slice('#version 300 es\nprecision highp float;\nprecision highp int;\n'.length));
  }
  expect(() => rootsPointCloudPrograms('unknown' as 'webgl2')).toThrow(/profile/);
 });
 it('produces the complete ordered 14 bindings and owned snapshots without reinterpreting settings', () => {
  const p = plan(), c = color('1'), frame = prepareRootsPointFrame(p, c, false);
  expect(frame.uniforms.map(u => [u.name, u.kind])).toEqual([
   ['projection', 'mat4'], ['modelview', 'mat4'], ['pointSize', 'float'], ['rotationDegrees', 'float'], ['scaleVec', 'vec3'], ['offsetVec', 'vec3'],
   ['brightness', 'float'], ['contrast', 'float'], ['gamma', 'float'], ['dynamicRange', 'float'], ['saturation', 'float'], ['paletteOffset', 'float'], ['backgroundRgb', 'vec3'], ['paletteTex', 'sampler2d'],
  ]);
  expect(frame.uniforms.reduce((n, u) => n + ('values' in u ? u.values.byteLength : 0), 0)).toBe(ROOTS_POINT_FRAME_BINDING_BYTES);
  expect(frame.uniforms[13]).toEqual({name: 'paletteTex', kind: 'sampler2d', texture: 0});
  for (const u of frame.uniforms) if ('values' in u) expect([u.count, u.values.buffer instanceof ArrayBuffer, u.values.byteOffset]).toEqual([1, true, 0]);
  const projection = frame.uniforms[0]; if (!('values' in projection)) throw Error('Expected numeric matrix');
  expect(projection.values).toEqual(p.projection.columnMajor); expect(projection.values.buffer).not.toBe(p.projection.columnMajor.buffer);
  const saved = projection.values[0], lut = frame.palette[0]; p.projection.columnMajor[0] = 100; c.lut[0] ^= 255;
  expect(projection.values[0]).toBe(saved); expect(frame.palette[0]).toBe(lut); expect(frame.palette.buffer.byteLength).toBe(1024);
 });
 it('owns fresh clear plus accumulation fade without conflating packed background and shader RGB', () => {
  const c = color('1');
  expect(c.backgroundRGB).toEqual([0, 0, F(1 / 255)]);
  expect(prepareRootsPointFrame(plan(false), c, false).clear).toEqual([F(1 / 255), F(1 / 255), F(1 / 255), 1]);
  expect(prepareRootsPointFrame(plan(false), c, true).fade).toBeUndefined();
  expect(prepareRootsPointFrame(plan(true), c, false).clear).toBeUndefined();
  const fresh = prepareRootsPointFrame(plan(true), c, true); expect(fresh.clear).toBeDefined(); expect(fresh.fade).toBeDefined();
  expect(prepareRootsPointCloudBackground(0)).toEqual([0, 0, 0, 1]);
  expect(prepareRootsPointCloudBackground(0x00112233)).toEqual([F(17 / 255), F(34 / 255), F(51 / 255), 0]);
  expect(prepareRootsPointCloudBackground(0x80112233, 6.9)[3]).toBe(F(3 / 255));
  expect(prepareRootsPointCloudBackground(0xff010203, 6.9)[3]).toBe(F(6 / 255));
  expect(prepareRootsPointCloudBackground(0x80112233, 255)[3]).toBe(F(128 / 255));
  expect(prepareRootsPointCloudBackground(0xffffffff, -1)[3]).toBe(0);
  for (const value of [-1, 0x100000000, NaN, .5]) expect(() => prepareRootsPointCloudBackground(value)).toThrowError(expect.objectContaining({failureKind: 'input'}));
 });
 it('rejects malformed prepared facts and shared or non-binary32 upload values', () => {
  const p = plan(), c = color();
  expect(() => prepareRootsPointFrame({...p, mode: 'density'}, c, false)).toThrow(/point-cloud/);
  expect(() => prepareRootsPointFrame(p, {...c, brightness: Number.MAX_VALUE}, false)).toThrow(/binary32/);
  expect(() => prepareRootsPointFrame(p, {...c, lut: new Uint8Array(new SharedArrayBuffer(1024))}, false)).toThrow(/unshared/);
 });
 it('keeps the existing 65536 point and 8M footprint scheduling with actual device limits', () => {
  expect(rootsPointCloudChunkPoints(500, 600, .01, [1, 511])).toBe(65536);
  expect(rootsPointCloudChunkPoints(500, 600, 100, [1, 511])).toBe(Math.floor(8_000_000 / (102 * 102)));
  expect(rootsPointCloudChunkPoints(500, 600, 100, [1, 2])).toBe(65536);
  expect(rootsPointCloudChunkPoints(16384, 16384, 16384, [1, 16384])).toBe(1);
  expect(() => rootsPointCloudChunkPoints(500, 600, 1, [])).toThrow(/range/);
  expect(() => rootsPointCloudChunkPoints(500, 600, 1, [1, Infinity])).toThrow(/range/);
 });
 it('copies wrapped ranges in arrival order into independent transferable buffers', () => {
  const r = ring(5); r.append(input(5)); r.append(input(2, 5));
  const chunks = prepareRootsPointChunks(r, 2); expect(chunks.rangeCounts).toEqual([3, 2]);
  const iterator = chunks[Symbol.iterator](), step = iterator.next(); if (step.done) throw Error('Expected first chunk'); const first = step.value;
  expect([first.ordinal, first.rangeIndex, first.rangeOffset, first.pointCount]).toEqual([0, 0, 0, 2]);
  expect(first.points.filter((_, i) => i % 4 === 0)).toEqual(Float32Array.of(2, 3));
  expect(first.points.buffer.byteLength).toBe(32); expect(first.points.buffer).not.toBe(r.recentWindow().ranges[0].values.buffer);
  structuredClone(first.points, {transfer: [first.points.buffer]}); expect(first.points.byteLength).toBe(0);
  const rest = Array.from(iterator); expect(rest.map(c => [c.ordinal, c.rangeIndex, c.rangeOffset, c.pointCount])).toEqual([[1, 0, 2, 1], [2, 1, 0, 2]]);
  expect(rest.map(c => [...c.points.filter((_, i) => i % 4 === 0)])).toEqual([[4], [5, 6]]);
  expect(r.facts.allocatedBytes).toBe(80); chunks.assertCurrent();
 });
 it('preserves raw XYZ payload bits and signed zero while the single metric owner clamps infinities', () => {
  const r = ring(), words = Uint32Array.from([0x7fa12345, 0x80000000, 0xff800000, 0x80000000, 1, 2, 3, 0x7f800000]);
  r.append(new Float32Array(words.buffer)); const c = Array.from(prepareRootsPointChunks(r, 8))[0];
  expect([...new Uint32Array(c.points.buffer)]).toEqual([0x7fa12345, 0x80000000, 0xff800000, 0x80000000, 1, 2, 3, 0x3f800000]);
  r.clear(); r.append(Float32Array.of(0, 0, 0, NaN));
  expect(() => Array.from(prepareRootsPointChunks(r, 8))).toThrowError(expect.objectContaining({failureKind: 'input'})); expect(r.facts.retainedPointCount).toBe(1);
 });
 it('rejects stale, foreign or detached ring windows before producing a later chunk', () => {
  const r = ring(); r.append(input(3)); const chunks = prepareRootsPointChunks(r, 1), iterator = chunks[Symbol.iterator](); iterator.next();
  r.append(input(1)); expect(() => iterator.next()).toThrow(/changed/); expect(() => chunks.assertCurrent()).toThrow(/changed/);
  const foreign = ring(); foreign.append(input(1)); expect(() => prepareRootsPointChunk(foreign.recentWindow(), 0, 0, 1, r)).toThrow(/changed/);
  const window = r.recentWindow(); structuredClone(window.ranges[0].values, {transfer: [window.ranges[0].values.buffer]});
  expect(() => prepareRootsPointChunk(window, 0, 0, 1, r)).toThrow(/changed/);
 });
 it('allows only explicit independent bounded WebGL staging, preserving the same bits and cancellation', () => {
  const r = ring(2); r.append(Float32Array.of(-0, 1, 2, -0, 3, 4, 5, Infinity));
  const destination = new Float32Array(8), window = r.recentWindow();
  const copied = prepareRootsPointChunk(window, 0, 0, 2, r), staged = prepareRootsPointChunk(window, 0, 0, 2, r, {destination});
  expect(staged.buffer).toBe(destination.buffer); expect(new Uint32Array(staged.buffer)).toEqual(new Uint32Array(copied.buffer));
  for (const invalid of [window.ranges[0].values, new Float32Array(4), new Float32Array(12).subarray(4), new Float32Array((ROOTS_NATIVE_POINT_CLOUD_CHUNK + 1) * 4)]) {
   expect(() => prepareRootsPointChunk(window, 0, 0, 2, r, {destination: invalid as Float32Array<ArrayBuffer>})).toThrow(/staging/);
  }
  expect(() => prepareRootsPointChunk(window, 0, 0, 2, r, {destination, isCancelled: () => true})).toThrowError(expect.objectContaining({name: 'AbortError'}));
  expect(r.recentWindow().ranges[0].values).toEqual(Float32Array.of(-0, 1, 2, -0, 3, 4, 5, Infinity));
 });
 it('honors cancellation and callback failures without consuming or clearing retained inputs', () => {
  const r = ring(); r.append(input(3)); let stop = false; const chunks = prepareRootsPointChunks(r, 1, {isCancelled: () => stop});
  const iterator = chunks[Symbol.iterator](); iterator.next(); stop = true;
  expect(() => iterator.next()).toThrowError(expect.objectContaining({name: 'AbortError'})); expect(r.facts.retainedPointCount).toBe(3);
  expect(() => prepareRootsPointChunks(r, 1, {isCancelled: () => {throw Error('callback');}})).toThrowError(expect.objectContaining({failureKind: 'input'}));
 });
 it('preflights bounded counts and allows an empty frame without fabricating point draws', () => {
  const r = ring(); expect(Array.from(prepareRootsPointChunks(r, 1))).toEqual([]);
  for (const n of [0, .5, ROOTS_NATIVE_POINT_CLOUD_CHUNK + 1]) expect(() => prepareRootsPointChunks(r, n)).toThrow(/capacity/);
  r.append(input(2)); const window = r.recentWindow();
  for (const [range, offset, count] of [[-1, 0, 1], [0, -1, 1], [0, 1, 2], [0, 0, 65537]]) expect(() => prepareRootsPointChunk(window, range, offset, count, r)).toThrow();
 });
});
