import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceProcessingRoundPointBuffers, SOURCE_PROCESSING_POINT_BYTES } from '../src/engine/sourceProcessingPoints';
import { sourcePerlinPointRgba } from '../src/engine/sourcePerlinPointColors';
import { sourceProcessingTransformScale } from '../src/engine/sourceProcessingStroke';
import { sourceProcessingCosLut, sourceProcessingSinLut } from '../src/engine/sourceProcessingTrig';
import type fixtureShape from './fixtures/source-perlin/points.json';

// Vite's JSON-to-module transform loses -0.0. Parse the retained evidence text
// directly so the native F32 signed-zero cases remain bit-sign-sensitive.
const fixture: typeof fixtureShape = JSON.parse(readFileSync(new URL('./fixtures/source-perlin/points.json', import.meta.url), 'utf8'));

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const options = { positions: new Float32Array([1, 2, 3]), colors: new Float32Array([.25, .5, .75, .125]), width: 1, rowMajor: identity };
describe('source Processing immediate ROUND POINTS', () => {
 it('keeps static primitive evidence separate from native image verification', () => {
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.pointVertSha256).toBe('a0a2d9f77c73c66ff0f81fa403789986c6254718d87f11bfa566202c8747c485');
 });
 for (const c of fixture.cases) it(`matches every independent fan offset and native index: ${c.name}`, () => {
  const s = c.input.transformScale;
  const matrix = [...identity];
  if (c.name === 'noninteger-phase') { matrix[0] = 2; matrix[5] = 3; }
  else { matrix[0] = s; matrix[5] = s; matrix[10] = s; }
  expect(sourceProcessingTransformScale(matrix)).toBe(s);
  const colors = sourcePerlinPointRgba(new Uint32Array([c.input.packedColor]));
  expect([...colors]).toEqual(c.normalizedColor);
  const result = sourceProcessingRoundPointBuffers({ positions: new Float32Array(c.input.position), colors, width: c.input.strokeWeight, rowMajor: matrix });
  expect(result.perimeter).toBe(c.segments);
  expect([...result.offsets]).toEqual(c.offsets.flat()); expect([...result.indices]).toEqual(c.indices);
  expect(result.positions).toHaveLength(c.vertices * 4);
  for (let i = 0; i < c.vertices; i++) expect([...result.colors.slice(i * 4, i * 4 + 4)]).toEqual(c.normalizedColor);
  expect(result.caches).toEqual([{ vertexOffset: 0, indexOffset: 0, vertexCount: c.vertices, indexCount: c.indices.length }]);
 });
 it('preserves every independently checked 3D matrix scale and LUT value', () => {
  for (const c of fixture.matrixScaleCases) {
   if (!c.matrix || c.matrix.length !== 9) continue; // source 2D/null contracts are separate
   const m = [...identity]; for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[row * 4 + col] = c.matrix[row * 3 + col];
   expect(sourceProcessingTransformScale(m)).toBe(c.expected);
  }
  for (const c of fixture.lutSamples) { expect(sourceProcessingCosLut(c.index)).toBe(c.cos); expect(sourceProcessingSinLut(c.index)).toBe(c.sin); }
 });
 it('bakes row-major eye coordinates once while preserving parsed RGBA alpha', () => {
  const result = sourceProcessingRoundPointBuffers({ ...options, rowMajor: [2, 0, 0, 7, 0, 3, 0, 11, 0, 0, 4, 13, 0, 0, 0, 1] });
  for (let i = 0; i < result.positions.length; i += 4) {
   expect([...result.positions.slice(i, i + 4)]).toEqual([9, 17, 25, 1]);
   expect([...result.colors.slice(i, i + 4)]).toEqual([.25, .5, .75, .125]);
  }
  expect([...result.offsets.slice(0, 2)]).toEqual([0, 0]);
 });
 it('keeps Perlin RGB255 adaptation outside generic geometry, including zero-alpha small ints', () => {
  expect([...sourcePerlinPointRgba(new Uint32Array([0x00000080, 0x12345678, 0x00ff0000]))]).toEqual([0, 0, Math.fround(128 / 255), 1, Math.fround(52 / 255), Math.fround(86 / 255), Math.fround(120 / 255), 1, 1, 0, 0, 1]);
 });
 it('preserves point order, repeated vertices and the unusual closing triangle', () => {
  const result = sourceProcessingRoundPointBuffers({ ...options, positions: new Float32Array([1, 2, 3, -2, 4, 0]), colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, .5]) });
  expect([...result.indices.slice(57, 66)]).toEqual([0, 1, 20, 21, 22, 23, 21, 23, 24]);
  expect([...result.positions.slice(84, 88)]).toEqual([-2, 4, 0, 1]);
  expect([...result.colors.slice(84, 88)]).toEqual([0, 1, 0, .5]);
 });
 it('rolls short-index caches before equality at 32768 and resets cache-local indices', () => {
  // width203 -> n127, 128 vertices/point. 256 points would equal32768,
  // which the source rejects for the current cache, so it rolls at point255.
  const count = 257, result = sourceProcessingRoundPointBuffers({ ...options, width: 203, positions: new Float32Array(count * 3), colors: new Float32Array(count * 4).fill(1) });
  expect(result.perimeter).toBe(127);
  expect(result.caches).toEqual([{ vertexOffset: 0, indexOffset: 0, vertexCount: 32640, indexCount: 97155 }, { vertexOffset: 32640, indexOffset: 97155, vertexCount: 256, indexCount: 762 }]);
  expect([...result.indices.slice(97155, 97161)]).toEqual([0, 1, 2, 0, 2, 3]);
  expect(Math.max(...result.indices.slice(0, 97155))).toBe(32639);
 });
 it('does not filter nonfinite point coordinates and returns complete empty arrays for no input', () => {
  const result = sourceProcessingRoundPointBuffers({ ...options, positions: new Float32Array([NaN, 2, 0]) });
  expect([...result.positions].every(Number.isNaN)).toBe(true);
  const empty = sourceProcessingRoundPointBuffers({ ...options, positions: new Float32Array(), colors: new Float32Array() });
  expect(empty.positions).toHaveLength(0); expect(empty.indices).toHaveLength(0); expect(empty.caches).toEqual([]);
 });
 it('admits saturated detail for finite overflowing widths without inventing a local clamp', () => {
  const result = sourceProcessingRoundPointBuffers({ ...options, width: Math.fround(3e38) });
  expect(result.perimeter).toBe(200); expect(result.offsets[2]).toBe(Math.fround(1.5e38));
 });
 it('bounds expanded representation before touching invalid per-point color channels', () => {
  const count = 30000, colors = new Float32Array(count * 4); colors[0] = NaN;
  expect(() => sourceProcessingRoundPointBuffers({ ...options, width: 1000, positions: new Float32Array(count * 3), colors })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(sourceProcessingRoundPointBuffers(options).accountedBytes).toBeLessThan(SOURCE_PROCESSING_POINT_BYTES);
 });
 it('rejects malformed source buffers, matrices and unparsed color channels', () => {
  for (const change of [{ positions: [1, 2, 3] }, { positions: new Float32Array(2) }, { colors: new Float32Array(3) }, { width: NaN }, { width: Infinity }, { rowMajor: [] }, { rowMajor: identity.map(() => NaN) }, { colors: new Float32Array([1, 0, 0, 1.1]) }]) expect(() => sourceProcessingRoundPointBuffers({ ...options, ...change } as never)).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('cancels during validation or generation without publishing or mutating input arrays', () => {
  expect(() => sourceProcessingRoundPointBuffers({ ...options, isCancelled: () => true })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  const positions = new Float32Array(300 * 3), colors = new Float32Array(300 * 4).fill(1); let checks = 0;
  expect(() => sourceProcessingRoundPointBuffers({ ...options, positions, colors, isCancelled: () => ++checks === 6 })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(checks).toBe(6); expect(positions.every(v => v === 0)).toBe(true); expect(colors.every(v => v === 1)).toBe(true);
  expect(() => sourcePerlinPointRgba(new Uint32Array(1), () => true)).toThrow(expect.objectContaining({ code: 'cancelled' }));
 });
});
