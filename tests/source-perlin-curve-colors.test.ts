import { describe, expect, it } from 'vitest';
import { SourcePerlinCurveColors, SOURCE_PERLIN_CURVE_COLOR_BYTES, type SourcePerlinCurveColorMode } from '../src/engine/sourcePerlinCurveColors';
import { SourcePerlinColorRuntime } from '../src/engine/sourcePerlinColorRuntime';
import { SourceProcessingNoise } from '../src/engine/sourceProcessingNoise';
import { sourcePerlinSeed } from '../src/engine/sourcePerlinSeed';
import { sourcePerlinFbm } from '../src/engine/sourcePerlinFbm';
import { importSourcePerlinGradientGroup } from '../src/engine/sourcePerlinGradientImport';
import fixture from './fixtures/source-perlin/curve-colors.json';
import angleFixture from './fixtures/source-perlin/angle-field.json';

const F = Math.fround;
const options = { seed: '0', width: 320, height: 200, seedSpaceCircleCount: 3, minRadius: 180, maxRadius: 260, colors: new SourcePerlinColorRuntime({ palette: [0x10ff0000, 0x8000ff00, 0xf00000ff] }), noise: new SourceProcessingNoise(0n) };
const query = { mode: 'seed-space' as const, index: 0, count: 3, x: 160, y: 100, curveNoiseScale: 1.2, curveNoiseOctaves: 2 };
type Operation = { kind: 'begin'; actions: ({kind: 'stop'} | {kind: 'start'; mode: string; interpolation: string; speed: number})[] } | {kind: 'interpolate'; eased: number; finished: boolean} | {kind: 'update'; dt: number} | {kind: 'replace'; palette: number[]};

describe('source Perlin curve colors, independent static reference', () => {
 it('does not claim JVM execution or displayed opacity from packed colors', () => {
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.classSha256).toBe('ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92');
 });
 for (const c of fixture.cases) it(`matches fixed blobs, live samples and explicit cached refresh: ${c.name}`, () => {
  let curves: SourcePerlinCurveColors;
  let cachedColors: number[] = [];
  const queries = c.points.map(p => ({ ...p, mode: c.input.mode.replace('_', '-') as SourcePerlinCurveColorMode, curveNoiseScale: c.input.curveNoiseScale, curveNoiseOctaves: c.input.curveNoiseOctaves }));
  const colors = new SourcePerlinColorRuntime({ palette: c.input.palette, onRefresh: sample => { cachedColors = queries.map(q => curves.resolve(q, sample)); } });
  curves = new SourcePerlinCurveColors({ ...c.input, seedSpaceCircleCount: c.input.circleCount, colors, noise: new SourceProcessingNoise(BigInt(sourcePerlinSeed(c.input.seed).textureSeed)) });
  const blobs = curves.snapshotBlobs();
  expect([...blobs.xs].map((x, i) => ({ x, y: blobs.ys[i], radius: blobs.radii[i], color: blobs.colors[i] }))).toEqual(c.blobs);
  cachedColors = queries.map(q => curves.resolve(q));
  const row = () => {
   const s = colors.snapshot(), running = s.gradient.running;
   return { state: s.state, running, interpolation: s.gradient.config?.interpolation ?? 'rgb', revision: s.revision, currentColors: queries.map(q => curves.resolve(q)), cachedColors, blobColors: [...curves.snapshotBlobs().colors] };
  };
  expect(row()).toEqual(c.rows[0]);
  for (const [i, op] of (c.operations as Operation[]).entries()) {
   if (op.kind === 'begin') {
    // Fixture actions are authored JSON. Source fromJson clamps negative speed
    // before canonical runtime validation; do not bypass that producing owner.
    const group = importSourcePerlinGradientGroup(op.actions.map(a => a.kind === 'stop' ? { method: 'gradientStop', args: {} } : { method: 'gradientStart', args: { mode: a.mode, interpolation: a.interpolation, speed: a.speed } }));
    expect(group.action).toBeDefined(); colors.beginGradientActions([group.action!]);
   } else if (op.kind === 'interpolate') colors.interpolateGradientActions(op.eased, op.finished);
   else if (op.kind === 'update') colors.update(op.dt);
   else if (op.kind === 'replace') colors.replacePalette(op.palette);
   else throw new Error('Unknown fixture operation');
   expect(row(), `${c.name} operation ${i} ${op.kind}`).toEqual(c.rows[i + 1]);
   expect(curves.snapshotBlobs()).toEqual(blobs);
  }
 });
 it('shares the exact FBM octave owner with angle fields', () => {
  const noise = new SourceProcessingNoise(BigInt(angleFixture.fbmNoiseSeed));
  for (const c of angleFixture.fbmCases) expect(sourcePerlinFbm(noise, c.x, c.y, c.octaves)).toBe(c.expected);
 });
 it('samples NOISE without angle-field seed offsets and confines sampling to that mode', () => {
  const calls: number[][] = [], coordinates: number[] = [];
  const curves = new SourcePerlinCurveColors({ ...options, noise: { sample: (x, y) => { calls.push([x, y!]); return .25; } } });
  const sample = (q: number) => { coordinates.push(q); return 0xff123456; };
  curves.resolve({ ...query, mode: 'noise', x: 80, y: 100, curveNoiseScale: 2, curveNoiseOctaves: 2 }, sample);
  expect(calls).toEqual([[.5, 1], [1, 2]]); expect(coordinates).toEqual([.25]);
  for (const mode of ['seed-space', 'index', 'position'] as const) curves.resolve({ ...query, mode }, sample);
  expect(calls).toHaveLength(2);
 });
 it('uses current parameters on refresh without rebuilding the fixed blobs', () => {
  const curves = new SourcePerlinCurveColors(options), before = curves.snapshotBlobs();
  const a = curves.resolve({ ...query, mode: 'noise', curveNoiseScale: .25 });
  const b = curves.resolve({ ...query, mode: 'noise', curveNoiseScale: 2.5 });
  expect(a).not.toBe(b); expect(curves.snapshotBlobs()).toEqual(before);
 });
 it('exposes shifted sampling through its existing gradient owner, excluding live offsets', () => {
  const palette = [0x10ff0000, 0x8000ff00, 0xf00000ff], colors = new SourcePerlinColorRuntime({ palette });
  colors.beginGradientActions([{ kind: 'start', config: { mode: 'hue_rotate', interpolation: 'linear', speed: 120 } }]);
  colors.interpolateGradientActions(1, true); colors.update(.75);
  expect(colors.sampleShifted(0, 0)).toBe(palette[0]); expect(colors.sampleCurrent(0)).not.toBe(palette[0]);
  expect(colors.sampleShifted(.25, 0)).toBe(colors.sampleShifted(0, .25));
  expect(() => new SourcePerlinColorRuntime().sampleShifted(Infinity, 0)).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('returns detached blob snapshots and accounts for retained and copied arrays', () => {
  const curves = new SourcePerlinCurveColors(options), before = curves.snapshotBlobs(), copy = curves.snapshotBlobs();
  copy.xs.fill(NaN); copy.ys.fill(NaN); copy.radii.fill(NaN); copy.colors.fill(0);
  expect(curves.snapshotBlobs()).toEqual(before);
  expect(curves.diagnostics()).toEqual({ count: 3, retainedBytes: 48, reservedWorkingBytes: 96, seedRandomDraws: 12 });
 });
 it('bounds allocations before sampling and normalizes nonpositive source counts/radii', () => {
  let samples = 0; const colors = { sampleCurrent: () => 0xffffffff, sampleShifted: () => { samples++; return 0xffffffff; } };
  expect(() => new SourcePerlinCurveColors({ ...options, colors, seedSpaceCircleCount: SOURCE_PERLIN_CURVE_COLOR_BYTES / 32 + 1 })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(samples).toBe(0);
  const empty = new SourcePerlinCurveColors({ ...options, colors, seedSpaceCircleCount: -1 });
  expect(empty.snapshotBlobs().xs).toHaveLength(0); expect(empty.resolve(query)).toBe(0xffffffff); expect(samples).toBe(0);
  const zero = new SourcePerlinCurveColors({ ...options, minRadius: -1, maxRadius: -2 });
  expect([...zero.snapshotBlobs().radii]).toEqual([0, 0, 0]);
 });
 it('validates caller values before publishing blobs or colors', () => {
  for (const width of [NaN, Infinity, Number.MAX_VALUE]) expect(() => new SourcePerlinCurveColors({ ...options, width })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
  expect(() => new SourcePerlinCurveColors({ ...options, width: 0 })).toThrow(expect.objectContaining({ code: 'input' }));
  for (const seedSpaceCircleCount of [.5, NaN, 2147483648]) expect(() => new SourcePerlinCurveColors({ ...options, seedSpaceCircleCount })).toThrow(expect.objectContaining({ code: 'input' }));
  expect(() => new SourcePerlinCurveColors({ ...options, colors: { sampleCurrent: () => 0, sampleShifted: () => -1 } })).toThrow(expect.objectContaining({ code: 'input' }));
  const curves = new SourcePerlinCurveColors(options);
  for (const q of [{ ...query, mode: 'bad' }, { ...query, index: .5 }, { ...query, curveNoiseOctaves: 2147483648 }]) expect(() => curves.resolve(q as never)).toThrow(expect.objectContaining({ code: 'input' }));
  expect(() => curves.resolve({ ...query, x: NaN })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
  expect(() => curves.resolve(query, () => 0x100000000)).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('cancels construction and sampling without publishing partially built results', () => {
  expect(() => new SourcePerlinCurveColors({ ...options, isCancelled: () => true })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let checks = 0;
  expect(() => new SourcePerlinCurveColors({ ...options, seedSpaceCircleCount: 500, isCancelled: () => ++checks === 3 })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let cancelled = false;
  const curves = new SourcePerlinCurveColors({ ...options, isCancelled: () => cancelled }), before = curves.snapshotBlobs();
  expect(() => curves.resolve(query, () => { cancelled = true; return 0xffffffff; })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(() => curves.snapshotBlobs()).toThrow(expect.objectContaining({ code: 'cancelled' }));
  cancelled = false; expect(curves.snapshotBlobs()).toEqual(before);
  expect(curves.resolve(query)).toBeTypeOf('number');
 });
 it('does not mutate retained blob state when a dependency fails', () => {
  const curves = new SourcePerlinCurveColors(options), before = curves.snapshotBlobs();
  expect(() => curves.resolve(query, () => { throw new Error('refresh failed'); })).toThrow('refresh failed');
  expect(curves.snapshotBlobs()).toEqual(before);
  const brokenNoise = new SourcePerlinCurveColors({ ...options, noise: { sample: () => NaN } });
  expect(() => brokenNoise.resolve({ ...query, mode: 'noise' })).toThrow(expect.objectContaining({ code: 'nonfinite' }));
 });
 it('checks cancellation inside a long ordered overlap scan', () => {
  let armed = false, checks = 0;
  const curves = new SourcePerlinCurveColors({ ...options, seedSpaceCircleCount: 512, isCancelled: () => armed && ++checks === 3 }), before = curves.snapshotBlobs();
  armed = true;
  expect(() => curves.resolve(query)).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(checks).toBe(3); // entry, blob 0, blob 128
  armed = false; expect(curves.snapshotBlobs()).toEqual(before);
 });
 it('preserves source overflow in squared blob distance as an outside-circle result', () => {
  const curves = new SourcePerlinCurveColors(options);
  const color = curves.resolve({ ...query, x: F(3e38), y: F(3e38) }, () => 0xff123456);
  expect(color).toBe(0xff123456);
 });
});
