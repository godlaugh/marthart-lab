import { describe, expect, it } from 'vitest';
import { SourcePerlinParticleColors, SOURCE_PERLIN_PARTICLE_COLOR_BYTES } from '../src/engine/sourcePerlinParticleColors';
import { SourcePerlinColorRuntime, SOURCE_PERLIN_INITIAL_COLOR_LIMIT, SOURCE_PERLIN_DEFAULT_PALETTE } from '../src/engine/sourcePerlinColorRuntime';
import { SourceParticleTrailHistory } from '../src/engine/sourceParticleTrails';
import type { SourceGradientConfiguration } from '../src/engine/sourceGradientRuntime';
import fixture from './fixtures/source-perlin/colors.json';

const palette = [0x60ff0000, 0xa000ff00, 0xe00000ff];
type OracleAction = { kind: 'stop' } | ({ kind: 'start' } & SourceGradientConfiguration);
type Operation = { kind: 'begin'; actions: OracleAction[] } | { kind: 'interpolate'; eased: number; finished: boolean } | { kind: 'update'; dt: number } | { kind: 'draw' } | { kind: 'replace'; palette: number[] };
describe('source Perlin initial and current particle color arrays', () => {
 for (const c of fixture.initialParticles) it(`matches independent ManimColors.gradient for ${c.count} particles`, () => {
  expect(fixture.provenance.nativeExecution).toBe(false);
  const colors = new SourcePerlinParticleColors({ count: c.count, palette });
  expect([...colors.packed]).toEqual(c.colors);
  expect(colors.snapshot().runtime.refreshed).toBeUndefined();
 });
 for (const c of fixture.cases) it(`publishes exact callback colors and retains them between refreshes: ${c.name}`, () => {
  // Nine evenly spaced particle slots include every independently checked
  // fixture coordinate; checking the callback consumer avoids re-sampling it.
  const colors = new SourcePerlinParticleColors({ count: 9, palette: c.palette }), initial = colors.packed.slice(), borrowed = colors.packed;
  const indices = [0, 1, 4, 7, 8];
  const assertRow = (row: typeof c.rows[number]) => {
   expect(colors.packed).toBe(borrowed);
   expect(indices.map(i => colors.packed[i])).toEqual(row.refreshed ?? indices.map(i => initial[i]));
   expect(colors.snapshot().runtime.revision).toBe(row.revision);
  };
  assertRow(c.rows[0]);
  for (const [i, op] of (c.operations as Operation[]).entries()) {
   if (op.kind === 'begin') colors.runtime.beginGradientActions(op.actions.map(a => a.kind === 'stop' ? { kind: 'stop' } : { kind: 'start', config: { mode: a.mode, interpolation: a.interpolation, speed: a.speed } }));
   else if (op.kind === 'interpolate') colors.runtime.interpolateGradientActions(op.eased, op.finished);
   else if (op.kind === 'update') colors.runtime.update(op.dt);
   else if (op.kind === 'replace') colors.runtime.replacePalette(op.palette);
   else if (op.kind === 'draw') colors.runtime.paletteTexture();
   assertRow(c.rows[i + 1]);
  }
 });
 it('keeps single-particle last-color initialization distinct from wrapped first-color refresh', () => {
  const colors = new SourcePerlinParticleColors({ count: 1, palette }), borrowed = colors.packed;
  expect(borrowed[0]).toBe(palette[2]);
  colors.runtime.update(0); expect(borrowed[0]).toBe(palette[2]);
  colors.runtime.replacePalette(palette);
  expect(colors.packed).toBe(borrowed); expect(borrowed[0]).toBe(palette[0]);
  expect(colors.runtime.initialParticleColors(1)[0]).toBe(palette[2]);
 });
 it('uses only ColorRuntime palette normalization and preserves packed alpha', () => {
  const absent = new SourcePerlinParticleColors({ count: 1 }), empty = new SourcePerlinParticleColors({ count: 1, palette: [] });
  expect(absent.packed[0]).toBe(SOURCE_PERLIN_DEFAULT_PALETTE.at(-1)); expect(empty.packed).toEqual(absent.packed);
  const input = [0x00123456], colors = new SourcePerlinParticleColors({ count: 3, palette: input });
  input[0] = 0xffffffff; expect([...colors.packed]).toEqual([0x00123456, 0x00123456, 0x00123456]);
  colors.runtime.replacePalette([0xff000000, 0x000000ff]);
  expect([...colors.runtime.initialParticleColors(2)]).toEqual([0xff000000, 0x000000ff]);
  expect([...colors.packed]).toEqual([0xff000000, 0x7f00007f, 0xff000000]);
 });
 it('recolors existing trail records through the same borrowed packed array', () => {
  const colors = new SourcePerlinParticleColors({ count: 1, palette });
  const history = new SourceParticleTrailHistory(1, 3, false, colors.packed, () => { void colors.packed; }, () => { throw new Error('trail capacity'); });
  history.add(0, 1, 2, 0, 0); history.add(0, 3, 4, 0, .1);
  const before = history.snapshot();
  expect([...before.colors]).toEqual([0, 0, 1, 0, 0, 1]);
  colors.runtime.replacePalette([0xff336699]);
  const after = history.snapshot();
  expect(after.positions).toEqual(before.positions); expect(after.indices).toEqual(before.indices);
  expect([...after.colors]).toEqual([.2, .4, .6, .2, .4, .6].map(Math.fround));
  expect(after.records).toBe(2);
 });
 it('publishes detached snapshots while retaining a bounded stable current buffer', () => {
  const colors = new SourcePerlinParticleColors({ count: 5, palette }), borrowed = colors.packed, before = borrowed.slice();
  colors.snapshot().packed.fill(0); colors.runtime.initialParticleColors(5).fill(0);
  expect(colors.packed).toBe(borrowed); expect(borrowed).toEqual(before);
  expect(colors.diagnostics()).toEqual({ count: 5, retainedBytes: 20, reservedWorkingBytes: 60 });
  expect(colors.diagnostics().reservedWorkingBytes).toBeLessThanOrEqual(SOURCE_PERLIN_PARTICLE_COLOR_BYTES);
 });
 it('supports zero particles without changing palette and gradient semantics', () => {
  const colors = new SourcePerlinParticleColors({ count: 0, palette });
  colors.runtime.replacePalette([0x00123456]); expect(colors.packed).toHaveLength(0);
  expect(colors.snapshot().runtime.revision).toBe(1);
  expect(colors.runtime.initialParticleColors(1)[0]).toBe(0x00123456);
 });
 it('rejects invalid counts and representation growth before color allocation', () => {
  for (const count of [-1, .5, NaN, Infinity, 2147483648]) {
   expect(() => new SourcePerlinParticleColors({ count })).toThrow(expect.objectContaining({ code: 'input' }));
   expect(() => new SourcePerlinColorRuntime().initialParticleColors(count)).toThrow(expect.objectContaining({ code: 'input' }));
  }
  expect(() => new SourcePerlinParticleColors({ count: SOURCE_PERLIN_INITIAL_COLOR_LIMIT + 1 })).toThrow(expect.objectContaining({ code: 'capacity' }));
  expect(() => new SourcePerlinColorRuntime().initialParticleColors(SOURCE_PERLIN_INITIAL_COLOR_LIMIT + 1)).toThrow(expect.objectContaining({ code: 'capacity' }));
 });
 it('rejects partial refreshes and preserves the previous borrowed bytes after cancellation', () => {
  let armed = false, checks = 0;
  const colors = new SourcePerlinParticleColors({ count: 1024, palette, isCancelled: () => armed && ++checks === 40 });
  const borrowed = colors.packed, before = borrowed.slice();
  armed = true;
  expect(() => colors.runtime.replacePalette([0xffffffff, 0xff000000])).toThrow(expect.objectContaining({ code: 'cancelled' }));
  expect(checks).toBe(40); expect(borrowed).toEqual(before);
  armed = false;
  expect(() => colors.packed).toThrow(expect.objectContaining({ code: 'failed' }));
  expect(() => colors.snapshot()).toThrow(expect.objectContaining({ code: 'failed' }));
  expect(() => colors.runtime.update(0)).toThrow(expect.objectContaining({ code: 'cancelled' }));
 });
 it('fails closed when runtime rejects an operation before calling the refresh consumer', () => {
  const colors = new SourcePerlinParticleColors({ count: 3, palette }), borrowed = colors.packed, before = borrowed.slice();
  expect(() => colors.runtime.replacePalette([-1])).toThrow(expect.objectContaining({ code: 'input' }));
  expect(borrowed).toEqual(before);
  expect(() => colors.packed).toThrow(expect.objectContaining({ code: 'input' }));
  expect(() => colors.diagnostics()).toThrow(expect.objectContaining({ code: 'input' }));
 });
 it('cancels initial generation before publishing any particle buffer', () => {
  expect(() => new SourcePerlinParticleColors({ count: 3, isCancelled: () => true })).toThrow(expect.objectContaining({ code: 'cancelled' }));
  let checks = 0;
  expect(() => new SourcePerlinParticleColors({ count: 1024, isCancelled: () => ++checks === 7 })).toThrow(expect.objectContaining({ code: 'cancelled' }));
 });
});
