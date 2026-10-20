import {SOURCE_PERLIN_GPU_FLOAT_FIELDS as floatFields,SOURCE_PERLIN_GPU_INT_FIELDS as intFields} from './sourcePerlinFields';
import type { SourcePerlinGpuUniforms } from './sourcePerlinGpu';
import type { SourcePerlinParameterValues } from './sourcePerlinParameterRuntime';
import { SOURCE_PERLIN_DEFAULT_PALETTE } from './sourcePerlinColorRuntime';
import { attempt, fail, finite, integer, seedText, exactKeys, parsePerlinPalette, parsePerlinParameters, parsePerlinCpuStyle, defaultPerlinParameters, createPerlinConfigReader } from './sourcePerlinDocumentConfig';
import type { SourcePerlinDocumentError, SourcePerlinDocumentResult, SourcePerlinDocumentImportOptions } from './sourcePerlinDocumentConfig';
export interface SourcePerlinGpuDocumentPayload {
 seed: string;
 /** Original Java int; drawGpuNoise owns selection clamping to 0..5. */
 textureStyle: number;
 uniforms: Omit<SourcePerlinGpuUniforms, 'time'>;
 palette: number[];
 parameters: SourcePerlinParameterValues;
 cpuStyle: 'particles' | 'field-curves';
}
export type SourcePerlinGpuDocumentError=SourcePerlinDocumentError;
export type SourcePerlinGpuDocumentResult<T>=SourcePerlinDocumentResult<T>;
export type SourcePerlinGpuDocumentImportOptions=SourcePerlinDocumentImportOptions;
export interface SourcePerlinGpuDocumentImportFacts {
 configuration: SourcePerlinGpuDocumentPayload;
 consumedPaths: string[][];
 numericPaths: string[][];
 diagnostics: string[];
}
const F=Math.fround;
function defaults(seed: string): SourcePerlinGpuDocumentPayload {
 return { seed, textureStyle: 0, uniforms: { noiseFrequency: 1.5, warpAmplitude: F(.1), warpFrequency: 2, directionOffset: 0, timeSpeed: 1, marchSteps: 32, stepSize: F(.008), brightness: F(1.7), vignettePower: F(.1), fiberStrength: F(.7), renderStyle: 0 }, palette: [...SOURCE_PERLIN_DEFAULT_PALETTE], parameters: defaultPerlinParameters(), cpuStyle: 'particles' };
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
 result.parameters=parsePerlinParameters(input.parameters);
 result.cpuStyle=parsePerlinCpuStyle(input.cpuStyle);
 result.palette=parsePerlinPalette(input.palette);
 return result;
}); }
/** GPU projection only; CPU-only geometry admission belongs to its runtime. */
export function importSourcePerlinGpuDocument(rawSettings:unknown,rawPalette:unknown,options:SourcePerlinGpuDocumentImportOptions={}):SourcePerlinGpuDocumentResult<SourcePerlinGpuDocumentImportFacts>{return attempt(()=>{
 const reader=createPerlinConfigReader(rawSettings,options);
 if(reader.backend()!=='gpu')return fail('unsupported',['settings','render_mode'],'原版 GPU 路径需要 render_mode 为 GPU（忽略大小写，不去除空白）');
 const result=defaults(reader.seed());
 const uniforms:Record<string,number>={};
 for(const [key,sourceKey] of Object.entries(floatFields))uniforms[key]=reader.scalar(sourceKey,result.uniforms[key as keyof typeof floatFields]);
 for(const [key,sourceKey] of Object.entries(intFields))uniforms[key]=reader.int(sourceKey,result.uniforms[key as keyof typeof intFields]);
 result.uniforms=uniforms as unknown as SourcePerlinGpuDocumentPayload['uniforms'];
 result.textureStyle=reader.int('gpu_texture_style',0);
 result.parameters=reader.parameters();
 result.cpuStyle=reader.enumValue('cpu_render_style',{PARTICLES:'particles',FIELD_CURVES:'field-curves'} as const,'particles');
 result.palette=reader.palette(rawPalette);
 return {configuration:result,consumedPaths:reader.consumedPaths,numericPaths:reader.numericPaths,diagnostics:reader.diagnostics};
});}
