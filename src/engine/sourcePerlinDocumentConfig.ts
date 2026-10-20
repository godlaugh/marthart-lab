import type { SourcePerlinParameterValues } from './sourcePerlinParameterRuntime';
import { SOURCE_PERLIN_PARAMETER_NAMES } from './sourcePerlinParameterConfig';
import { SOURCE_PERLIN_DEFAULT_PALETTE, SOURCE_PERLIN_COLOR_LIMIT } from './sourcePerlinColorRuntime';
import { prepareDomainSourceScalar, prepareDomainSourceObjectScalar } from './domainSourceScalar';
import { parseRootsSignedLongText, prepareRootsSourceJsonInt, prepareRootsSourceJsonLong, prepareRootsSourceJsonString } from './rootsSourceOrder';
import { sourceConfigPackedColor, SOURCE_COLOR_TEXT_BUDGET, SourceConfigColorError } from './sourceConfigColor';
import { javaTrim, javaEqualsIgnoreCaseAscii } from './sourceJavaText';
export interface SourcePerlinDocumentError { kind: 'input' | 'capacity' | 'nonfinite' | 'unsupported'; path: readonly string[]; reason: string; }
export type SourcePerlinDocumentResult<T> = { ok: true; value: T } | { ok: false; error: SourcePerlinDocumentError };
export interface SourcePerlinDocumentImportOptions {
 numberToken?: (path: readonly string[]) => string | undefined;
 /** Captured once by the caller, corresponding to constructor currentTimeMillis.
  * Required only when source seed is absent or getLong fails. Never read a clock
  * inside this parser or replace an explicit successfully parsed source seed. */
 defaultSeed?: string;
}
const F = Math.fround;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
class Failure extends Error { constructor(readonly detail: SourcePerlinDocumentError) { super(detail.reason); } }
export function fail(kind: SourcePerlinDocumentError['kind'], path: readonly string[], reason: string): never { throw new Failure({ kind, path, reason }); }
export function attempt<T>(run: () => T): SourcePerlinDocumentResult<T> { try { return { ok: true, value: run() }; } catch (error) { if (error instanceof Failure) return { ok: false, error: error.detail }; throw error; } }
export function finite(raw: unknown, path: readonly string[]): number {
 if (typeof raw !== 'number') return fail('input', path, '需要数值');
 if (!Number.isFinite(raw) || !Number.isFinite(F(raw))) return fail('nonfinite', path, '需要有限 Float32 数值');
 return F(raw);
}
export function integer(raw: unknown, path: readonly string[]): number {
 if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < -2147483648 || raw > 2147483647) return fail('input', path, '需要 Java int32，不进行截断或钳制');
 return raw;
}
export function seedText(raw: unknown, path: readonly string[]): string {
 if (typeof raw !== 'string') return fail('input', path, '种子需要精确的 Java long 整数文本');
 const parsed = parseRootsSignedLongText(raw);
 if (!parsed.ok) return fail(parsed.error.kind === 'capacity' ? 'capacity' : 'input', path, '种子超出 Java long 文本范围或解析容量');
 return parsed.value.toString();
}
export function exactKeys(raw: unknown, keys: readonly string[], path: readonly string[]): Record<string, unknown> {
 if (!object(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) return fail('input', path, '配置字段缺失或包含未知字段');
 return raw;
}

export function parsePerlinPalette(raw: unknown): number[] {
 if (!Array.isArray(raw) || !raw.length) return fail('input', ['palette'], '规范色板需要非空 ARGB 数组');
 if (raw.length > SOURCE_PERLIN_COLOR_LIMIT) return fail('capacity', ['palette'], '色板超过本地 65536 色预算');
 return Array.from(raw, (value, i) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return fail('input', ['palette', String(i)], '需要无符号 32 位 ARGB');
  return value;
 });
}
export const defaultPerlinParameters = (): SourcePerlinParameterValues => ({noise_offset:0,noise_scale:8,curve_noise_scale:F(1.2),curve_angle_scale:4});
export function parsePerlinParameters(raw: unknown): SourcePerlinParameterValues {
 const input=exactKeys(raw,SOURCE_PERLIN_PARAMETER_NAMES,['parameters']);
 const result={} as Record<keyof SourcePerlinParameterValues,number>;
 for(const name of SOURCE_PERLIN_PARAMETER_NAMES)result[name]=finite(input[name],['parameters',name]);
 if(result.curve_noise_scale<F(.01)||result.curve_angle_scale<F(.1))return fail('input',['parameters'],'曲线参数低于原版初始化下界');
 return result;
}
export function parsePerlinCpuStyle(raw: unknown): 'particles'|'field-curves' {
 if(raw!=='particles'&&raw!=='field-curves')return fail('input',['cpuStyle'],'未知 CPU 场样式');
 return raw;
}
/** Shared original ConfigUtils/JSONObject interpretation for both render modes.
 * Raw source ownership and token provenance remain with the outer document. */
export function createPerlinConfigReader(rawSettings: unknown, options: SourcePerlinDocumentImportOptions={}) {
 if (rawSettings !== undefined && !object(rawSettings)) return fail('input', ['settings'], '原版 settings 必须为对象；否则配置构造在场景字段之前中止');
 const settings = rawSettings ?? {};
 const consumedPaths: string[][] = [], numericPaths: string[][] = [], diagnostics: string[] = [];
 const read = (key: string): unknown => {
  if (Object.hasOwn(settings, key)) { consumedPaths.push(['settings', key]); if (typeof settings[key] === 'number') numericPaths.push(['settings', key]); }
  return settings[key];
 };
 const scalar = (key: string, fallback: number, allowNonfinite = false): number => {
  const raw = read(key); if (raw === undefined || raw === null) return fallback;
  const parsed = prepareDomainSourceScalar(raw, { fallback: 0, precision: 'float32' });
  if (!parsed.ok) return fail('capacity', ['settings', key], JSON.stringify(parsed.error));
  if (parsed.facts.route === 'fallback') diagnostics.push(`settings.${key}: 原版表达式解析失败，采用 0；原字段保留在 source。`);
  return allowNonfinite ? F(parsed.facts.value) : finite(parsed.facts.value, ['settings', key]);
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
 const seed = (): string => {
 const rawSeed = read('seed'), parsedSeed = prepareRootsSourceJsonLong(rawSeed, 0n, options.numberToken?.(['settings', 'seed']));
 if (!parsedSeed.ok) return fail(parsedSeed.error.kind === 'capacity' ? 'capacity' : 'input', ['settings', 'seed'], JSON.stringify(parsedSeed.error));
 let value: string;
 if (parsedSeed.value.route === 'fallback') {
  if (options.defaultSeed === undefined) return fail('input', ['settings', 'seed'], '种子缺失或 getLong 失败，需要调用者提供已捕获的构造时间种子');
  value = seedText(options.defaultSeed, ['defaultSeed']);
  diagnostics.push('settings.seed: 原版保留构造时的时间种子；本次采用调用者捕获的种子，保存后不再读取时钟。');
 } else value = parsedSeed.value.canonicalText;
 return value;
 };
 const parameters = (): SourcePerlinParameterValues => { const defaults=defaultPerlinParameters();
 const initial = {} as Record<keyof SourcePerlinParameterValues, number>;
 for (const name of SOURCE_PERLIN_PARAMETER_NAMES) initial[name] = scalar(name, defaults[name], name === 'curve_noise_scale' || name === 'curve_angle_scale');
 // normalizeParticleNoiseScale is a constructor import conversion, not a setter
 // floor. Saved semantic values must never run through it a second time.
 if (initial.noise_scale > 0 && initial.noise_scale < F(.08)) initial.noise_scale = F(initial.noise_scale * F(1000));
 initial.curve_noise_scale = finite(Math.max(F(.01), initial.curve_noise_scale), ['settings','curve_noise_scale']);
 initial.curve_angle_scale = finite(Math.max(F(.1), initial.curve_angle_scale), ['settings','curve_angle_scale']);
 return initial;
 };
 const palette = (rawPalette: unknown): number[] => { let palette=[...SOURCE_PERLIN_DEFAULT_PALETTE];
 if (rawPalette !== undefined) {
  if (!Array.isArray(rawPalette)) return fail('unsupported', ['palette'], '原版非数组色板会中止配置构造；此文档不模拟部分构造结果');
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
  if (colors.length) palette = colors;
 }
 return palette;
 };
 const enumValue = <T extends string>(key:string, choices:Readonly<Record<string,T>>, fallback:T):T => {
  const value=read(key); if(typeof value!=='string')return fallback;
  const trimmed=javaTrim(value);
  if(/[^\x00-\x7f]/.test(trimmed))diagnostics.push(`settings.${key}: 原版枚举使用 JVM 默认区域大写规则；当前使用 Unicode 大写映射，未验证特殊区域设置。`);
  const normalized=trimmed.toUpperCase();for(const [source,result] of Object.entries(choices))if(normalized===source)return result;
  return fallback;
 };
 const boolean = (key:string,fallback:boolean):boolean => {
  const value=read(key); if(typeof value==='boolean')return value;
  if(typeof value==='string'){if(javaEqualsIgnoreCaseAscii(value,'true'))return true;if(javaEqualsIgnoreCaseAscii(value,'false'))return false;}
  return fallback;
 };
 const packedColor=(key:string,fallback:string):number=>{
  const value=read(key),path=['settings',key];
  const parsed=prepareRootsSourceJsonString(value,fallback,options.numberToken?.(path));
  if(!parsed.ok)return fail(parsed.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(parsed.error));
  if(parsed.value.status==='unknown'){
   if(parsed.value.reason==='number-token-required')return fail('input',path,'源颜色数值需要原始 JSON 数值 token');
   // Java Double strings contain a decimal/exponent or NaN/Infinity, and JSON
   // containers start with braces/brackets; neither is ConfigUtils color text.
   diagnostics.push(`settings.${key}: 原版颜色解析失败，采用白色；原字段保留在 source。`);return 0xffffffff;
  }
  const text=parsed.value.value;
  if(text.length>SOURCE_COLOR_TEXT_BUDGET)return fail('capacity',['settings',key],'颜色超过本地文本预算');
  try{return sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push(`settings.${key}: 原版颜色解析失败，采用白色；原字段保留在 source。`);return 0xffffffff;}
 };
 const backend=(): 'cpu'|'gpu'=>{const value=read('render_mode');return typeof value==='string'&&javaEqualsIgnoreCaseAscii(value,'GPU')?'gpu':'cpu';};
 return {read,scalar,int,seed,parameters,palette,enumValue,boolean,packedColor,backend,consumedPaths,numericPaths,diagnostics};
}

/** JsonPerlinConfig compares only render_mode to GPU using equalsIgnoreCase,
 * without trim. Missing, null, invalid and other values retain/select CPU. */
export function sourcePerlinBackendFromSettings(rawSettings:unknown):SourcePerlinDocumentResult<'cpu'|'gpu'>{
 return attempt(()=>createPerlinConfigReader(rawSettings).backend());
}
