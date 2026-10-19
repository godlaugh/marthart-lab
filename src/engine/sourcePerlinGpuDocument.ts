import {SOURCE_PERLIN_GPU_FLOAT_FIELDS as floatFields,SOURCE_PERLIN_GPU_INT_FIELDS as intFields} from './sourcePerlinFields';
import type { SourcePerlinGpuUniforms } from './sourcePerlinGpu';
import type { SourcePerlinParameterValues } from './sourcePerlinParameterRuntime';
import { SOURCE_PERLIN_PARAMETER_NAMES } from './sourcePerlinParameterConfig';
import { SOURCE_PERLIN_DEFAULT_PALETTE, SOURCE_PERLIN_COLOR_LIMIT } from './sourcePerlinColorRuntime';
import { prepareDomainSourceScalar, prepareDomainSourceObjectScalar } from './domainSourceScalar';
import { parseRootsSignedLongText, prepareRootsSourceJsonInt, prepareRootsSourceJsonLong } from './rootsSourceOrder';
import { sourceConfigPackedColor, SOURCE_COLOR_TEXT_BUDGET, SourceConfigColorError } from './sourceConfigColor';
import { javaTrim, javaEqualsIgnoreCaseAscii } from './sourceJavaText';

export interface SourcePerlinGpuDocumentPayload {
 seed: string;
 /** Original Java int; drawGpuNoise owns selection clamping to 0..5. */
 textureStyle: number;
 uniforms: Omit<SourcePerlinGpuUniforms, 'time'>;
 palette: number[];
 parameters: SourcePerlinParameterValues;
 cpuStyle: 'particles' | 'field-curves';
}
export interface SourcePerlinGpuDocumentError { kind: 'input' | 'capacity' | 'nonfinite' | 'unsupported'; path: readonly string[]; reason: string; }
export type SourcePerlinGpuDocumentResult<T> = { ok: true; value: T } | { ok: false; error: SourcePerlinGpuDocumentError };
export interface SourcePerlinGpuDocumentImportFacts {
 configuration: SourcePerlinGpuDocumentPayload;
 consumedPaths: string[][];
 numericPaths: string[][];
 diagnostics: string[];
}
export interface SourcePerlinGpuDocumentImportOptions {
 numberToken?: (path: readonly string[]) => string | undefined;
 /** Captured once by the caller, corresponding to constructor currentTimeMillis.
  * Required only when source seed is absent or getLong fails. Never read a clock
  * inside this parser or replace an explicit successfully parsed source seed. */
 defaultSeed?: string;
}
const F = Math.fround;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
class Failure extends Error { constructor(readonly detail: SourcePerlinGpuDocumentError) { super(detail.reason); } }
function fail(kind: SourcePerlinGpuDocumentError['kind'], path: readonly string[], reason: string): never { throw new Failure({ kind, path, reason }); }
function attempt<T>(run: () => T): SourcePerlinGpuDocumentResult<T> { try { return { ok: true, value: run() }; } catch (error) { if (error instanceof Failure) return { ok: false, error: error.detail }; throw error; } }
function finite(raw: unknown, path: readonly string[]): number {
 if (typeof raw !== 'number') return fail('input', path, '需要数值');
 if (!Number.isFinite(raw) || !Number.isFinite(F(raw))) return fail('nonfinite', path, '需要有限 Float32 数值');
 return F(raw);
}
function integer(raw: unknown, path: readonly string[]): number {
 if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < -2147483648 || raw > 2147483647) return fail('input', path, '需要 Java int32，不进行截断或钳制');
 return raw;
}
function seedText(raw: unknown, path: readonly string[]): string {
 if (typeof raw !== 'string') return fail('input', path, '种子需要精确的 Java long 整数文本');
 const parsed = parseRootsSignedLongText(raw);
 if (!parsed.ok) return fail(parsed.error.kind === 'capacity' ? 'capacity' : 'input', path, '种子超出 Java long 文本范围或解析容量');
 return parsed.value.toString();
}
function defaults(seed: string): SourcePerlinGpuDocumentPayload {
 return { seed, textureStyle: 0, uniforms: { noiseFrequency: 1.5, warpAmplitude: F(.1), warpFrequency: 2, directionOffset: 0, timeSpeed: 1, marchSteps: 32, stepSize: F(.008), brightness: F(1.7), vignettePower: F(.1), fiberStrength: F(.7), renderStyle: 0 }, palette: [...SOURCE_PERLIN_DEFAULT_PALETTE], parameters: { noise_offset: 0, noise_scale: 8, curve_noise_scale: F(1.2), curve_angle_scale: 4 }, cpuStyle: 'particles' };
}
function exactKeys(raw: unknown, keys: readonly string[], path: readonly string[]): Record<string, unknown> {
 if (!object(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) return fail('input', path, '配置字段缺失或包含未知字段');
 return raw;
}
export const usesSourcePerlinGpu = (scene: { kind: string; perlinGpuSource?: unknown }): boolean => scene.kind === 'perlin' && scene.perlinGpuSource !== undefined;

/** Canonical semantic facts. Narrow authored floating values once to Float32;
 * preserve signed integer fields until their drawing owner applies source clamps.
 * Source aliases, expressions, palette strings and omitted defaults are not
 * reinterpreted here. Raw imported provenance remains owned by the outer document. */
export function parseSourcePerlinGpuDocument(raw: unknown): SourcePerlinGpuDocumentResult<SourcePerlinGpuDocumentPayload> { return attempt(() => {
 const input = exactKeys(raw, ['seed', 'textureStyle', 'uniforms', 'palette', 'parameters', 'cpuStyle'], []);
 const result = defaults(seedText(input.seed, ['seed']));
 result.textureStyle = integer(input.textureStyle, ['textureStyle']);
 const uniforms = exactKeys(input.uniforms, [...Object.keys(floatFields), ...Object.keys(intFields)], ['uniforms']);
 const values: Record<string, number> = {};
 for (const key of Object.keys(floatFields)) values[key] = finite(uniforms[key], ['uniforms', key]);
 for (const key of Object.keys(intFields)) values[key] = integer(uniforms[key], ['uniforms', key]);
 result.uniforms = values as unknown as SourcePerlinGpuDocumentPayload['uniforms'];
 const parameters = exactKeys(input.parameters, SOURCE_PERLIN_PARAMETER_NAMES, ['parameters']);
 const initial = {} as Record<keyof SourcePerlinParameterValues, number>;
 for (const name of SOURCE_PERLIN_PARAMETER_NAMES) initial[name] = finite(parameters[name], ['parameters', name]);
 if (initial.curve_noise_scale < F(.01) || initial.curve_angle_scale < F(.1)) return fail('input', ['parameters'], '曲线参数低于原版初始化下界');
 result.parameters = initial;
 if (input.cpuStyle !== 'particles' && input.cpuStyle !== 'field-curves') return fail('input', ['cpuStyle'], '未知 CPU 场样式');
 result.cpuStyle = input.cpuStyle;
 if (!Array.isArray(input.palette) || !input.palette.length) return fail('input', ['palette'], '规范色板需要非空 ARGB 数组');
 if (input.palette.length > SOURCE_PERLIN_COLOR_LIMIT) return fail('capacity', ['palette'], '色板超过本地 65536 色预算');
 result.palette = Array.from(input.palette, (value, i) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return fail('input', ['palette', String(i)], '需要无符号 32 位 ARGB');
  return value;
 });
 return result;
}); }

/** GPU projection of JsonPerlinConfig, not a claim that every unrelated CPU
 * geometry allocation in the original constructor can complete. All pre-GPU
 * scalar/enum/seed reads recover locally; malformed settings fails before them.
 * ConfigUtils.parseValue and parseInt admit empty-scope expressions here, unlike
 * the Perlin timeline parameter dictionary's getDouble(default) contract. */
export function importSourcePerlinGpuDocument(rawSettings: unknown, rawPalette: unknown, options: SourcePerlinGpuDocumentImportOptions = {}): SourcePerlinGpuDocumentResult<SourcePerlinGpuDocumentImportFacts> { return attempt(() => {
 if (rawSettings !== undefined && !object(rawSettings)) return fail('input', ['settings'], '原版 settings 必须为对象；否则配置构造在 GPU 字段之前中止');
 const settings = rawSettings ?? {};
 const consumedPaths: string[][] = [], numericPaths: string[][] = [], diagnostics: string[] = [];
 const read = (key: string): unknown => {
  if (Object.hasOwn(settings, key)) { consumedPaths.push(['settings', key]); if (typeof settings[key] === 'number') numericPaths.push(['settings', key]); }
  return settings[key];
 };
 const mode = read('render_mode');
 if (typeof mode !== 'string' || !javaEqualsIgnoreCaseAscii(mode, 'GPU')) return fail('unsupported', ['settings', 'render_mode'], '原版 GPU 路径需要 render_mode 为 GPU（忽略大小写，不去除空白）');
 const rawSeed = read('seed'), parsedSeed = prepareRootsSourceJsonLong(rawSeed, 0n, options.numberToken?.(['settings', 'seed']));
 if (!parsedSeed.ok) return fail(parsedSeed.error.kind === 'capacity' ? 'capacity' : 'input', ['settings', 'seed'], JSON.stringify(parsedSeed.error));
 let seed: string;
 if (parsedSeed.value.route === 'fallback') {
  if (options.defaultSeed === undefined) return fail('input', ['settings', 'seed'], '种子缺失或 getLong 失败，需要调用者提供已捕获的构造时间种子');
  seed = seedText(options.defaultSeed, ['defaultSeed']);
  diagnostics.push('settings.seed: 原版保留构造时的时间种子；本次采用调用者捕获的种子，保存后不再读取时钟。');
 } else seed = parsedSeed.value.canonicalText;
 const result = defaults(seed);
 const scalar = (key: string, fallback: number): number => {
  const raw = read(key); if (raw === undefined || raw === null) return fallback;
  const parsed = prepareDomainSourceScalar(raw, { fallback: 0, precision: 'float32' });
  if (!parsed.ok) return fail('capacity', ['settings', key], JSON.stringify(parsed.error));
  if (parsed.facts.route === 'fallback') diagnostics.push(`settings.${key}: 原版表达式解析失败，采用 0；原字段保留在 source。`);
  return finite(parsed.facts.value, ['settings', key]);
 };
 const int = (key: string, fallback: number): number => {
  const raw = read(key); if (raw === undefined || raw === null) return fallback;
  const direct = prepareRootsSourceJsonInt(raw, fallback, options.numberToken?.(['settings', key]));
  if (!direct.ok) return fail(direct.error.kind === 'capacity' ? 'capacity' : 'input', ['settings', key], JSON.stringify(direct.error));
  if (direct.value.route !== 'fallback') return direct.value.value;
  const parsed = prepareDomainSourceObjectScalar(raw, { fallback: 0, precision: 'float64' });
  if (!parsed.ok) return fail('capacity', ['settings', key], JSON.stringify(parsed.error));
  if (parsed.facts.route === 'fallback') diagnostics.push(`settings.${key}: 原版整数表达式解析失败，采用 0；原字段保留在 source。`);
  const value = parsed.facts.value;
  return Number.isNaN(value) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
 };
 const uniforms: Record<string, number> = {};
 for (const [key, sourceKey] of Object.entries(floatFields)) uniforms[key] = scalar(sourceKey, result.uniforms[key as keyof typeof floatFields]);
 for (const [key, sourceKey] of Object.entries(intFields)) uniforms[key] = int(sourceKey, result.uniforms[key as keyof typeof intFields]);
 result.uniforms = uniforms as unknown as SourcePerlinGpuDocumentPayload['uniforms'];
 result.textureStyle = int('gpu_texture_style', 0);
 const initial = {} as Record<keyof SourcePerlinParameterValues, number>;
 for (const name of SOURCE_PERLIN_PARAMETER_NAMES) initial[name] = scalar(name, result.parameters[name]);
 // normalizeParticleNoiseScale is a constructor import conversion, not a setter
 // floor. Saved semantic values must never run through it a second time.
 if (initial.noise_scale > 0 && initial.noise_scale < F(.08)) initial.noise_scale = F(initial.noise_scale * F(1000));
 initial.curve_noise_scale = Math.max(F(.01), initial.curve_noise_scale);
 initial.curve_angle_scale = Math.max(F(.1), initial.curve_angle_scale);
 result.parameters = initial;
 const cpuStyle = read('cpu_render_style');
 result.cpuStyle = typeof cpuStyle === 'string' && javaEqualsIgnoreCaseAscii(javaTrim(cpuStyle), 'FIELD_CURVES') ? 'field-curves' : 'particles';
 if (rawPalette !== undefined) {
  if (!Array.isArray(rawPalette)) return fail('unsupported', ['palette'], '原版非数组色板会中止配置构造；此 GPU 文档不模拟部分构造结果');
  if (rawPalette.length > SOURCE_PERLIN_COLOR_LIMIT) return fail('capacity', ['palette'], '色板超过本地 65536 色预算');
  consumedPaths.push(['palette']); let text = 0;
  const colors = Array.from(rawPalette, (value, i) => {
   const path = ['palette', String(i)];
   if (typeof value !== 'string') return fail('unsupported', path, '原版颜色元素必须为字符串；部分色板构造结果尚未纳入此文档');
   text += value.length; if (text > SOURCE_COLOR_TEXT_BUDGET) return fail('capacity', path, '色板超过本地颜色文本预算');
   try { return sourceConfigPackedColor(value); } catch (error) {
    if (!(error instanceof SourceConfigColorError)) throw error;
    diagnostics.push(`palette.${i}: 原版颜色解析失败，采用白色；原字段保留在 source。`); return 0xffffffff;
   }
  });
  if (colors.length) result.palette = colors;
 }
 return { configuration: result, consumedPaths, numericPaths, diagnostics };
}); }
