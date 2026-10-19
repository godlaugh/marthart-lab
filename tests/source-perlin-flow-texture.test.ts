import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SourceProcessingNoise } from '../src/engine/sourceProcessingNoise';
import { SourcePerlinFlowTexture, SourcePerlinFlowTextureError, sourcePerlinTextureSeed, type SourcePerlinFlowStyle } from '../src/engine/sourcePerlinFlowTexture';
import fixture from './fixtures/source-perlin/flow-textures.json';

const argb = (gray: number): number => (0xff000000 | (gray << 16) | (gray << 8) | gray) >>> 0;
describe('source Perlin Processing flow texture', () => {
 it('keeps independent static evidence distinct from executed native pixels', () => {
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.jarSha256).toBe('a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
  expect(fixture.cases.filter(c => 'source512GraySha256' in c)).toHaveLength(1);
 });
 for (const c of fixture.seedCases) it(`preserves constructor seed mixing and all style seeds: ${c.seed}`, () => {
  expect(sourcePerlinTextureSeed(c.seed)).toBe(c.textureSeed);
  for (let style = 0; style < 6; style++) expect(new SourcePerlinFlowTexture({ seed: c.seed, style: style as SourcePerlinFlowStyle }).noiseSeed).toBe(c.styleSeeds[style]);
 });
 for (const c of fixture.noiseCases) it(`matches independent Processing value noise for seed ${c.seed}`, () => {
  const noise = new SourceProcessingNoise(BigInt(c.seed));
  expect(fixture.noiseCoordinates.map(([x, y, z]) => noise.sample(x, y, z))).toEqual(c.samples);
  // Sampling has no cursor; repeated and reversed queries use the same table.
  expect([...fixture.noiseCoordinates].reverse().map(([x, y, z]) => noise.sample(x, y, z))).toEqual([...c.samples].reverse());
 });
 for (const c of fixture.cases) it(`matches style ${c.style}, seed ${c.seed} sparse source-size and complete diagnostic textures`, () => {
  const style = c.style as SourcePerlinFlowStyle;
  const small = new SourcePerlinFlowTexture({ seed: c.seed, style, size: 8 });
  const gray = Buffer.from(c.small8GrayHex, 'hex');
  expect([...small.generate()]).toEqual([...gray].map(argb));
  for (const sample of c.samples) {
   const flow = new SourcePerlinFlowTexture({ seed: c.seed, style, size: sample.size });
   expect(sample.points.map(([x, y]) => flow.scalar(x, y))).toEqual(sample.scalar);
   expect(sample.points.map(([x, y]) => flow.sample(x, y))).toEqual(sample.gray.map(argb));
  }
  if (c.small32GraySha256) {
   const pixels = new SourcePerlinFlowTexture({ seed: c.seed, style, size: 32 }).generate();
   expect(createHash('sha256').update(Uint8Array.from(pixels, pixel => pixel & 255)).digest('hex')).toBe(c.small32GraySha256);
  }
  if ('source512GraySha256' in c) {
   const pixels = new SourcePerlinFlowTexture({ seed: c.seed, style, size: 512 }).generate();
   expect(createHash('sha256').update(Uint8Array.from(pixels, pixel => pixel & 255)).digest('hex')).toBe(c.source512GraySha256);
  }
 });
 it('returns owned output and samples row-major at x/size, y/size', () => {
  const flow = new SourcePerlinFlowTexture({ seed: 12345, style: 3, size: 8 });
  const pixels = flow.generate();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(pixels[y * 8 + x]).toBe(flow.sample(x, y));
  const original = flow.sample(0, 0); pixels.fill(0);
  expect(flow.generate()[0]).toBe(original);
 });
 it('rejects seed precision loss and out-of-long inputs instead of silently changing them', () => {
  for (const seed of [Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, .5, '', '9223372036854775808', '-9223372036854775809', '1.5']) expect(() => sourcePerlinTextureSeed(seed)).toThrow(SourcePerlinFlowTextureError);
  expect(sourcePerlinTextureSeed(12345)).toBe(sourcePerlinTextureSeed('12345'));
 });
 it('bounds allocations and validates style/coordinates', () => {
  expect(() => new SourcePerlinFlowTexture({ seed: 0, style: 0, size: 2049 })).toThrow(expect.objectContaining({ code: 'capacity' }));
  for (const size of [0, -1, .5, NaN, Infinity]) expect(() => new SourcePerlinFlowTexture({ seed: 0, style: 0, size })).toThrow(expect.objectContaining({ code: 'input' }));
  for (const style of [-1, 6, .5, NaN]) expect(() => new SourcePerlinFlowTexture({ seed: 0, style: style as SourcePerlinFlowStyle })).toThrow(expect.objectContaining({ code: 'input' }));
  const flow = new SourcePerlinFlowTexture({ seed: 0, style: 0 });
  for (const [x, y] of [[-1, 0], [512, 0], [0, 512], [0, .5], [NaN, 0]]) expect(() => flow.sample(x, y)).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('honors cancellation before allocation and during texture rows without exposing partial pixels', () => {
  expect(() => new SourcePerlinFlowTexture({ seed: 0, style: 0, isCancelled: () => true })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let checks = 0;
  const flow = new SourcePerlinFlowTexture({ seed: 0, style: 0, isCancelled: () => ++checks >= 5 });
  expect(() => flow.generate()).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(checks).toBe(5);
 });
 it('rejects nonfinite Float32 coordinates', () => {
  const noise = new SourceProcessingNoise(0n);
  for (const coordinate of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) expect(() => noise.sample(coordinate)).toThrow(RangeError);
 });
});
