import { describe, expect, it } from 'vitest';
import { importSourcePerlinGpuDocument, parseSourcePerlinGpuDocument, usesSourcePerlinGpu, type SourcePerlinGpuDocumentPayload } from '../src/engine/sourcePerlinGpuDocument';
import { SOURCE_PERLIN_DEFAULT_PALETTE } from '../src/engine/sourcePerlinColorRuntime';

const F = Math.fround;
function imported(settings: Record<string, unknown> = {}, palette?: unknown, tokens: Record<string, string> = {}) {
 const result = importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '123', ...settings }, palette, { defaultSeed: '999', numberToken: path => tokens[path.join('.')] });
 if (!result.ok) throw new Error(JSON.stringify(result.error));
 return result.value;
}
function canonical(): SourcePerlinGpuDocumentPayload { return imported().configuration; }

describe('source Perlin GPU document ownership', () => {
 it('imports verified constructor defaults and stores semantic parameters separately from shader uniforms', () => {
  expect(canonical()).toEqual({ seed: '123', textureStyle: 0, cpuStyle: 'particles', parameters: { noise_offset: 0, noise_scale: 8, curve_noise_scale: F(1.2), curve_angle_scale: 4 }, uniforms: { noiseFrequency: 1.5, warpAmplitude: F(.1), warpFrequency: 2, directionOffset: 0, timeSpeed: 1, marchSteps: 32, stepSize: F(.008), brightness: F(1.7), vignettePower: F(.1), fiberStrength: F(.7), renderStyle: 0 }, palette: [...SOURCE_PERLIN_DEFAULT_PALETTE] });
 });
 it('uses literal double-to-float and ConfigUtils expression routes for GPU float settings', () => {
  const facts = imported({ gpu_noise_frequency: '2*pi', gpu_warp_amplitude: '0x1p-3', gpu_warp_frequency: '2^3', gpu_direction_offset: '-pi/2', gpu_time_speed: '-2', gpu_step_size: '.01', gpu_brightness: '1.2e1', gpu_vignette_power: 'bad!', gpu_fiber_strength: null });
  expect(facts.configuration.uniforms).toMatchObject({ noiseFrequency: F(2 * Math.PI), warpAmplitude: .125, warpFrequency: 8, directionOffset: F(-Math.PI / 2), timeSpeed: -2, stepSize: F(.01), brightness: 12, vignettePower: 0, fiberStrength: F(.7) });
  expect(facts.diagnostics.some(value => value.includes('gpu_vignette_power'))).toBe(true);
 });
 it('keeps integer narrowing, expression evaluation and source draw clamping separate', () => {
  const facts = imported({ gpu_march_steps: '2*100', gpu_texture_style: -25, gpu_render_style: '9/2', gpu_brightness: -2, gpu_fiber_strength: 9 });
  expect(facts.configuration).toMatchObject({ textureStyle: -25, uniforms: { marchSteps: 200, renderStyle: 4, brightness: -2, fiberStrength: 9 } });
  expect(parseSourcePerlinGpuDocument(facts.configuration)).toEqual({ ok: true, value: facts.configuration });
 });
 it('distinguishes original Long.intValue wrapping from Double.intValue saturation', () => {
  const integer = imported({ gpu_texture_style: 4294967297 }, undefined, { 'settings.gpu_texture_style': '4294967297' });
  const double = imported({ gpu_texture_style: 4294967297 }, undefined, { 'settings.gpu_texture_style': '4294967297.0' });
  expect(integer.configuration.textureStyle).toBe(1); expect(double.configuration.textureStyle).toBe(2147483647);
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1', gpu_texture_style: 4294967297 }, undefined)).toMatchObject({ ok: false, error: { kind: 'input', path: ['settings', 'gpu_texture_style'] } });
 });
 it('retains exact unsafe-long source seed through retained numeric tokens', () => {
  const facts = imported({ seed: Number('9007199254740993') }, undefined, { 'settings.seed': '9007199254740993' });
  expect(facts.configuration.seed).toBe('9007199254740993');
  expect(facts.numericPaths).toContainEqual(['settings', 'seed']);
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: Number('9007199254740993') }, undefined)).toMatchObject({ ok: false, error: { kind: 'input', path: ['settings', 'seed'] } });
 });
 it('uses the captured constructor seed only when the original getLong would fail or be absent', () => {
  for (const seed of [undefined, null, '1/2', '9223372036854775808', true]) {
   const facts = imported({ seed }); expect(facts.configuration.seed).toBe('999'); expect(facts.diagnostics.some(s => s.includes('构造'))).toBe(true);
  }
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU' }, undefined)).toMatchObject({ ok: false, error: { path: ['settings', 'seed'] } });
  expect(imported({ seed: '-9223372036854775808' }).configuration.seed).toBe('-9223372036854775808');
 });
 it('normalizes old small noise scale once and applies only actual initialization floors', () => {
  const facts = imported({ noise_offset: 8, noise_scale: .01, curve_noise_scale: '-9', curve_angle_scale: 0, cpu_render_style: '  field_curves\t' });
  expect(facts.configuration.parameters).toEqual({ noise_offset: 8, noise_scale: 10, curve_noise_scale: F(.01), curve_angle_scale: F(.1) });
  expect(facts.configuration.cpuStyle).toBe('field-curves');
  expect(imported({ noise_scale: F(.08) }).configuration.parameters.noise_scale).toBe(F(.08));
  expect(imported({ noise_scale: -3 }).configuration.parameters.noise_scale).toBe(-3);
  const input = canonical(); input.parameters = { ...input.parameters, noise_scale: .01 };
  const parsed = parseSourcePerlinGpuDocument(input); expect(parsed.ok && parsed.value.parameters.noise_scale).toBe(F(.01));
 });
 it('matches GPU eligibility without trimming and rejects malformed settings before parsing controls', () => {
  expect(imported({ render_mode: 'gPu' }).configuration.textureStyle).toBe(0);
  for (const render_mode of [' GPU ', 'CPU', undefined, null, true, {}]) expect(importSourcePerlinGpuDocument({ render_mode, seed: '1' }, undefined)).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
  for (const settings of [null, [], 'GPU', 1]) expect(importSourcePerlinGpuDocument(settings, undefined)).toMatchObject({ ok: false, error: { kind: 'input', path: ['settings'] } });
 });
 it('does not claim unrelated CPU settings and source fields as consumed', () => {
  const facts = imported({ cpu_render_style: 'bad', unknown: 20, particle_count: 'invalid expression', flow_mode: null, gpu_noise_frequency: 3 });
  expect(facts.consumedPaths).toContainEqual(['settings', 'render_mode']);
  expect(facts.consumedPaths).toContainEqual(['settings', 'cpu_render_style']);
  expect(facts.numericPaths).toContainEqual(['settings', 'gpu_noise_frequency']);
  expect(facts.consumedPaths).not.toContainEqual(['settings', 'particle_count']);
  expect(facts.consumedPaths).not.toContainEqual(['settings', 'unknown']);
  expect(facts.configuration.cpuStyle).toBe('particles');
 });
 it('uses the default palette for absent and empty palettes, and parses packed alpha exactly', () => {
  expect(imported({}, []).configuration.palette).toEqual([...SOURCE_PERLIN_DEFAULT_PALETTE]);
  const facts = imported({}, ['#102030', '#40102030', '0x102030', '-1', 'red', ' #ffffff']);
  expect(facts.configuration.palette).toEqual([0xff102030, 0x40102030, 0xff102030, 0xffffffff, 0xffffffff, 0xffffffff]);
  expect(facts.diagnostics).toHaveLength(2); expect(facts.consumedPaths).toContainEqual(['palette']);
 });
 it('explicitly rejects partial native palette constructions instead of substituting defaults', () => {
  for (const palette of [null, {}, 1, ['#ff0000', 123], ['#ff0000', null]]) expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1' }, palette)).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
 });
 it('bounds retained palette/text and numeric expression parsing without converting capacity failures to defaults', () => {
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1' }, Array(65537).fill('#ffffff'))).toMatchObject({ ok: false, error: { kind: 'capacity' } });
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1' }, ['x'.repeat(1048577)])).toMatchObject({ ok: false, error: { kind: 'capacity' } });
  expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1', gpu_brightness: '1'.repeat(65537) }, undefined)).toMatchObject({ ok: false, error: { kind: 'capacity' } });
 });
 it('rejects nonfinite float values while keeping source integer saturation semantics', () => {
  for (const gpu_noise_frequency of ['1/0', 'NaN', Infinity, Number.MAX_VALUE]) expect(importSourcePerlinGpuDocument({ render_mode: 'GPU', seed: '1', gpu_noise_frequency }, undefined)).toMatchObject({ ok: false, error: { kind: 'nonfinite' } });
  expect(imported({ gpu_march_steps: '1/0' }).configuration.uniforms.marchSteps).toBe(2147483647);
  expect(imported({ gpu_march_steps: '0/0' }).configuration.uniforms.marchSteps).toBe(0);
 });
 it('canonical parsing detaches nested values, normalizes float precision and never reimports source aliases', () => {
  const raw = canonical(); raw.uniforms = { ...raw.uniforms, brightness: .1 };
  const parsed = parseSourcePerlinGpuDocument(raw); expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  expect(parsed.value.uniforms.brightness).toBe(F(.1));
  raw.palette[0] = 0; raw.parameters = { ...raw.parameters, noise_scale: 99 };
  expect(parsed.value.palette[0]).toBe(SOURCE_PERLIN_DEFAULT_PALETTE[0]); expect(parsed.value.parameters.noise_scale).toBe(8);
  expect(parseSourcePerlinGpuDocument({ ...canonical(), gpu_noise_frequency: 1 })).toMatchObject({ ok: false, error: { kind: 'input' } });
 });
 it('canonical parsing rejects missing, foreign, unrepresentable and silently truncated facts', () => {
  for (const seed of [1, '1e3', '9223372036854775808']) expect(parseSourcePerlinGpuDocument({ ...canonical(), seed })).toMatchObject({ ok: false, error: { path: ['seed'] } });
  for (const textureStyle of [.5, 2147483648, NaN]) expect(parseSourcePerlinGpuDocument({ ...canonical(), textureStyle })).toMatchObject({ ok: false, error: { path: ['textureStyle'] } });
  for (const palette of [[], [-1], [0x100000000], ['#ffffff']]) expect(parseSourcePerlinGpuDocument({ ...canonical(), palette })).toMatchObject({ ok: false, error: { path: expect.arrayContaining(['palette']) } });
  expect(parseSourcePerlinGpuDocument({ ...canonical(), parameters: { ...canonical().parameters, curve_noise_scale: 0 } })).toMatchObject({ ok: false, error: { path: ['parameters'] } });
  expect(parseSourcePerlinGpuDocument({ ...canonical(), uniforms: { ...canonical().uniforms, time: 0 } })).toMatchObject({ ok: false, error: { path: ['uniforms'] } });
  expect(parseSourcePerlinGpuDocument({ ...canonical(), cpuStyle: 'GPU' })).toMatchObject({ ok: false, error: { path: ['cpuStyle'] } });
 });
 it('selects source GPU only through explicit scene payload presence, leaving validation to its owner', () => {
  expect(usesSourcePerlinGpu({ kind: 'perlin' })).toBe(false);
  expect(usesSourcePerlinGpu({ kind: 'surface', perlinGpuSource: canonical() })).toBe(false);
  expect(usesSourcePerlinGpu({ kind: 'perlin', perlinGpuSource: null })).toBe(true);
 });
});
