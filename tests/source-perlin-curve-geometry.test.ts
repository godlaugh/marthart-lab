import { describe, expect, it } from 'vitest';
import { SourcePerlinCurveGeometry, sourcePerlinCurveDimensions, SOURCE_PERLIN_CURVE_GEOMETRY_BYTES } from '../src/engine/sourcePerlinCurveGeometry';
import { SourcePerlinAngleField } from '../src/engine/sourcePerlinAngleField';
import { SourceProcessingNoise } from '../src/engine/sourceProcessingNoise';
import { sourcePerlinSeed } from '../src/engine/sourcePerlinSeed';
import fixture from './fixtures/source-perlin/angle-field.json';

const F = Math.fround;
const options = { seed: '0', count: 1, length: 5, width: 320, height: 200, sampling: 'random' as const, stepSize: 2, noiseOffset: 0, angleField: { sample: () => 0 } };
describe('source Perlin fixed-seed curve geometry', () => {
 it('keeps source-derived geometry separate from native raster evidence', () => {
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.classSha256).toBe('ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92');
 });
 for (const c of fixture.curveGeometryCases) it(`matches independent source geometry and offset rebuild: ${c.name}`, () => {
  const a = fixture.cases.find(a => a.name === c.angleFieldCase)!;
  const textureSeed = sourcePerlinSeed(a.input.seed).textureSeed;
  const noiseSeed = 'noiseSeed' in a.input ? BigInt(a.input.noiseSeed!) : BigInt(textureSeed);
  const angleField = new SourcePerlinAngleField({ ...a.input, textureSeed, noise: new SourceProcessingNoise(noiseSeed) });
  const geometry = new SourcePerlinCurveGeometry({ ...c.input, sampling: c.input.sampling as 'random' | 'jittered-grid', angleField });
  const before = geometry.snapshot();
  expect([before.width, before.height]).toEqual([c.effectiveWidth, c.effectiveHeight]);
  expect([...before.seedXs].map((x, i) => [x, before.seedYs[i]])).toEqual(c.seeds);
  expect([...before.xs]).toEqual(c.xs); expect([...before.ys]).toEqual(c.ys);
  geometry.rebuild({ noiseOffset: c.rebuild.noiseOffset });
  const after = geometry.snapshot();
  expect([...after.xs]).toEqual(c.rebuild.xs); expect([...after.ys]).toEqual(c.rebuild.ys);
  expect(after.seedXs).toEqual(before.seedXs); expect(after.seedYs).toEqual(before.seedYs);
  geometry.rebuild({ noiseOffset: c.input.noiseOffset });
  expect(geometry.snapshot()).toEqual(before);
 });
 for (const length of [4, 5]) it(`traces straight paths backward first and centers the seed for length ${length}`, () => {
  const calls: number[][] = [];
  const geometry = new SourcePerlinCurveGeometry({ ...options, length, angleField: { sample: (x, y, offset, width, height) => { calls.push([x, y, offset, width!, height!]); return 0; } } });
  const s = geometry.snapshot(), x = s.seedXs[0], y = s.seedYs[0];
  const offsets = length === 4 ? [-4, -2, 0, 2] : [-4, -2, 0, 2, 4];
  expect([...s.xs]).toEqual(offsets.map(dx => F(F(x + dx) - 160)));
  expect([...s.ys]).toEqual(offsets.map(() => F(y - 100)));
  expect(calls).toEqual((length === 4 ? [x, F(x - 2), x] : [x, F(x - 2), x, F(x + 2)]).map(xx => [xx, y, 0, 320, 200]));
 });
 it('applies the joint 800 fallback before field creation, including the 200 boundary', () => {
  expect(sourcePerlinCurveDimensions(199, 600)).toEqual({ width: 800, height: 800 });
  expect(sourcePerlinCurveDimensions(600, -1)).toEqual({ width: 800, height: 800 });
  expect(sourcePerlinCurveDimensions(200, 600)).toEqual({ width: 200, height: 600 });
  let extent: number[] = [];
  new SourcePerlinCurveGeometry({ ...options, width: 10, angleField: { sample: (_x, _y, _offset, width, height) => { extent = [width!, height!]; return 0; } } });
  expect(extent).toEqual([800, 800]);
 });
 it('normalizes count and length once while retaining authored values', () => {
  const geometry = new SourcePerlinCurveGeometry({ ...options, count: -2, length: 0 });
  expect(geometry.diagnostics()).toMatchObject({ count: 1, length: 2, sourceCount: -2, sourceLength: 0, seedRandomDraws: 2 });
  const seeds = geometry.snapshot().seedXs;
  geometry.rebuild({ length: 8 });
  expect(geometry.snapshot().seedXs).toEqual(seeds);
  expect(geometry.diagnostics()).toMatchObject({ length: 8, sourceLength: 8 });
 });
 it('returns detached arrays and can replace the angle field without reseeding', () => {
  const geometry = new SourcePerlinCurveGeometry(options), initial = geometry.snapshot();
  const copy = geometry.snapshot(); copy.xs.fill(NaN); copy.ys.fill(NaN); copy.seedXs.fill(NaN); copy.seedYs.fill(NaN);
  expect(geometry.snapshot()).toEqual(initial);
  geometry.rebuild({ angleField: { sample: () => F(Math.PI / 2) } });
  const changed = geometry.snapshot();
  expect(changed.xs).not.toEqual(initial.xs); expect(changed.seedXs).toEqual(initial.seedXs);
  geometry.rebuild({ angleField: options.angleField });
  expect(geometry.snapshot()).toEqual(initial);
 });
 it('does not wrap or clamp path coordinates outside the viewport', () => {
  const geometry = new SourcePerlinCurveGeometry({ ...options, stepSize: 1000 }), s = geometry.snapshot();
  expect(s.xs[0]).toBeLessThan(-160); expect(s.xs[4]).toBeGreaterThan(160);
 });
 it('rejects capacity before calling the angle field and retains old geometry after rejected growth', () => {
  let calls = 0; const angleField = { sample: () => { calls++; return 0; } };
  for (const change of [{ count: 2147483647 }, { length: 2147483647 }]) expect(() => new SourcePerlinCurveGeometry({ ...options, ...change, angleField })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(calls).toBe(0);
  const geometry = new SourcePerlinCurveGeometry(options), before = geometry.snapshot();
  expect(() => geometry.rebuild({ length: 2147483647 })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(geometry.snapshot()).toEqual(before);
  geometry.rebuild({ length: 100 });
  expect(geometry.diagnostics().reservedWorkingBytes).toBeLessThanOrEqual(SOURCE_PERLIN_CURVE_GEOMETRY_BYTES);
  // A growing generation must also admit its own future detached copy and
  // same-sized rebuild, not only fit beside the smaller previous generation.
  const growing = new SourcePerlinCurveGeometry({ ...options, count: 1000, length: 2 });
  const prior = growing.snapshot();
  expect(() => growing.rebuild({ length: 2097 })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(growing.snapshot()).toEqual(prior);
 });
 it('rejects malformed Java ints, seeds, floats, sampling and fields', () => {
  for (const count of [.5, NaN, 2147483648]) expect(() => new SourcePerlinCurveGeometry({ ...options, count })).toThrow(expect.objectContaining({ code: 'input' }));
  for (const length of [.5, Infinity, -2147483649]) expect(() => new SourcePerlinCurveGeometry({ ...options, length })).toThrow(expect.objectContaining({ code: 'input' }));
  for (const seed of ['9223372036854775808', Number.MAX_SAFE_INTEGER + 1]) expect(() => new SourcePerlinCurveGeometry({ ...options, seed })).toThrow(expect.objectContaining({ code: 'input' }));
  for (const value of [NaN, Infinity, Number.MAX_VALUE]) {
   expect(() => new SourcePerlinCurveGeometry({ ...options, width: value })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
   expect(() => new SourcePerlinCurveGeometry({ ...options, stepSize: value })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
   expect(() => new SourcePerlinCurveGeometry({ ...options, noiseOffset: value })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
  }
  expect(() => new SourcePerlinCurveGeometry({ ...options, sampling: 'bad' as never })).toThrow(expect.objectContaining({ code: 'input' }));
  expect(() => new SourcePerlinCurveGeometry({ ...options, angleField: {} as never })).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('fails closed on nonfinite samples or coordinate overflow and preserves the previous generation', () => {
  const geometry = new SourcePerlinCurveGeometry(options), before = geometry.snapshot();
  expect(() => geometry.rebuild({ angleField: { sample: () => NaN } })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
  expect(() => geometry.rebuild({ stepSize: 3e38 })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
  expect(geometry.snapshot()).toEqual(before);
  geometry.rebuild(); expect(geometry.snapshot()).toEqual(before);
 });
 it('cancels before work, during generation and mid-rebuild without publishing partial arrays', () => {
  expect(() => new SourcePerlinCurveGeometry({ ...options, isCancelled: () => true })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let checks = 0;
  expect(() => new SourcePerlinCurveGeometry({ ...options, length: 500, isCancelled: () => ++checks === 5 })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let cancelled = false, calls = 0;
  const geometry = new SourcePerlinCurveGeometry({ ...options, isCancelled: () => cancelled }), before = geometry.snapshot();
  expect(() => geometry.rebuild({ length: 500, angleField: { sample: () => { if (++calls === 130) cancelled = true; return 0; } } })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(calls).toBeGreaterThanOrEqual(130);
  expect(() => geometry.snapshot()).toThrow(expect.objectContaining({ code: 'cancelled' }));
  cancelled = false; expect(geometry.snapshot()).toEqual(before);
  geometry.rebuild(); expect(geometry.snapshot()).toEqual(before);
 });
 it('retains prior geometry when a caller-owned field throws, with retry available', () => {
  const geometry = new SourcePerlinCurveGeometry(options), before = geometry.snapshot();
  let calls = 0;
  expect(() => geometry.rebuild({ angleField: { sample: () => { if (++calls === 3) throw new Error('field unavailable'); return 1; } } })).toThrow('field unavailable');
  expect(geometry.snapshot()).toEqual(before);
  geometry.rebuild(); expect(geometry.snapshot()).toEqual(before);
 });
});
