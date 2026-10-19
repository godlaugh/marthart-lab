import {prepareDomainSourceScalar} from './domainSourceScalar';
import {DEFAULT_DOMAIN_SOURCE_COLORS} from './domainSourcePalette';
import {sourceManimGradientColor} from './sourceManimGradient';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor} from './sourceConfigColor';
import type {SourceAttractorError,SourceAttractorResult} from './sourceAttractorConfig';

export const SOURCE_ATTRACTOR_VISUAL_MODEL='attractor-visual-1.7.8' as const;
/** Local input budget, not a source-format palette limit. Color lookup stays
 * lazy in particle count; no array is allocated for the requested particles. */
export const SOURCE_ATTRACTOR_PALETTE_LIMITS=Object.freeze({colors:65536,characters:SOURCE_COLOR_TEXT_BUDGET});
export type SourceAttractorPalette={kind:'absent'}|{kind:'colors';colors:string[]};
export interface SourceAttractorGpuTone {exposure:number;contrast:number;gamma:number;saturation:number;densityScale:number;}
export const SOURCE_ATTRACTOR_GPU_TONE_DEFAULTS:Readonly<SourceAttractorGpuTone>=Object.freeze({exposure:8,contrast:1,gamma:Math.fround(2.2),saturation:Math.fround(.82),densityScale:1});
export const SOURCE_ATTRACTOR_GPU_TONE_LIMITS=Object.freeze({exposure:Object.freeze([Math.fround(.1),64] as const),contrast:Object.freeze([Math.fround(.1),4] as const),gamma:Object.freeze([Math.fround(.1),10] as const),saturation:Object.freeze([0,2] as const),densityScale:Object.freeze([Math.fround(.1),4] as const)});
const toneFields={exposure:'gpu_exposure',contrast:'gpu_contrast',gamma:'gpu_gamma',saturation:'gpu_saturation',densityScale:'gpu_density_scale'} as const;
export interface SourceAttractorVisualConfiguration {
 model:typeof SOURCE_ATTRACTOR_VISUAL_MODEL;
 settingsPresence:'absent'|'object';
 points:{dotRadius:number;fadePoints:false};
 trails:{lineWeight:number;lifetime:number;show:boolean;fade:boolean};
 palette:SourceAttractorPalette;
 gpuTone:SourceAttractorGpuTone;
}
export interface SourceAttractorVisualImportFacts {
 configuration:SourceAttractorVisualConfiguration;
 consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];
}
export interface SourceAttractorInitialColors {
 readonly count:number;
 /** Snapshot of the effective cachePalette colors, after empty/default recovery. */
 readonly packedPalette:readonly number[];
 readonly diagnostics:readonly string[];
 /** Packed ARGB prior to Processing.tint(int) interpretation. */
 colorAt(index:number):SourceAttractorResult<number>;
}
class Failure extends Error {constructor(readonly detail:SourceAttractorError){super(detail.reason);}}
function fail(kind:SourceAttractorError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceAttractorResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
const F=Math.fround;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fields(raw:Record<string,unknown>,keys:readonly string[],path:readonly string[]):void{if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))fail('input',path,'源视觉配置字段缺失或包含未知字段');}
function finite(value:unknown,path:readonly string[]):number{if(typeof value!=='number')fail('input',path,'必须为数值');if(!Number.isFinite(value)||!Number.isFinite(F(value)))fail('nonfinite',path,'源视觉数值不能表示为有限 Float32');return value;}
/** JsonAttractorConfig.clamp and StrangeAttractor.clamp return the lower
 * bound for every nonfinite Float32, including positive infinity. */
function toneClamp(key:keyof SourceAttractorGpuTone,value:number):number{
 const [low,high]=SOURCE_ATTRACTOR_GPU_TONE_LIMITS[key],rounded=F(value);
 return Number.isFinite(rounded)?Math.max(low,Math.min(high,rounded)):low;
}
function savedTone(raw:unknown):SourceAttractorGpuTone{
 if(!object(raw))fail('input',['gpuTone'],'GPU 色调配置必须为对象');
 fields(raw,Object.keys(toneFields),['gpuTone']);
 const result={...SOURCE_ATTRACTOR_GPU_TONE_DEFAULTS};
 for(const key of Object.keys(toneFields) as (keyof SourceAttractorGpuTone)[]){
  if(typeof raw[key]!=='number')fail('input',['gpuTone',key],'GPU 色调必须为数值');
  if(!Number.isFinite(raw[key]))fail('nonfinite',['gpuTone',key],'保存的 GPU 色调必须为有限数值');
  result[key]=toneClamp(key,raw[key]);
 }
 return result;
}
function colors(raw:unknown):string[]{
 if(!Array.isArray(raw))fail('input',['palette'],'源 palette 必须为数组');
 if(raw.length>SOURCE_ATTRACTOR_PALETTE_LIMITS.colors)fail('capacity',['palette'],'色板超过本地 65536 色准备预算');
 let characters=0;
 return Array.from(raw,(value,index)=>{
  // AbstractVisualConfig.parsePalette uses strict JSONArray.getString(i).
  if(typeof value!=='string')fail('input',['palette',String(index)],'源色板成员必须为字符串');
  characters+=value.length;if(characters>SOURCE_ATTRACTOR_PALETTE_LIMITS.characters)fail('capacity',['palette'],'色板超过本地 1 MiB 文本准备预算');
  return value;
 });
}
function savedPalette(raw:unknown):SourceAttractorPalette{
 if(!object(raw))fail('input',['palette'],'源色板配置必须为对象');
 if(raw.kind==='absent'){fields(raw,['kind'],['palette']);return{kind:'absent'};}
 if(raw.kind!=='colors')fail('input',['palette','kind'],'未知源色板配置');
 fields(raw,['kind','colors'],['palette']);return{kind:'colors',colors:colors(raw.colors)};
}
/** Visual-only JsonAttractorConfig fields. Source parent defaults differ when
 * settings is absent. Palette is a top-level source array, not settings.palette.
 * Raw color strings, empty palettes and section omission remain distinguishable.
 * Native radius/trail values are not clamped or converted to local diameters. */
export function importSourceAttractorVisualConfig(rawSettings:unknown,rawPalette:unknown):SourceAttractorResult<SourceAttractorVisualImportFacts>{return attempt(()=>{
 const present=rawSettings!==undefined;
 if(present&&!object(rawSettings))fail('input',['settings'],'源 settings 必须为对象');
 const configuration:SourceAttractorVisualConfiguration={model:SOURCE_ATTRACTOR_VISUAL_MODEL,settingsPresence:present?'object':'absent',points:{dotRadius:2,fadePoints:false},trails:{lineWeight:present?F(.8):1,lifetime:present?3:4,show:true,fade:false},palette:rawPalette===undefined?{kind:'absent'}:{kind:'colors',colors:colors(rawPalette)},gpuTone:{...SOURCE_ATTRACTOR_GPU_TONE_DEFAULTS}};
 const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 if(rawPalette!==undefined)consumedPaths.push(['palette']);
 if(present){
  const raw=rawSettings as Record<string,unknown>;
  if(!Object.keys(raw).length)consumedPaths.push(['settings']);
  const read=(key:string):unknown=>{consumedPaths.push(['settings',key]);if(typeof raw[key]==='number')numericPaths.push(['settings',key]);return raw[key];};
  const scalar=(key:string,fallback:number,tone?:keyof SourceAttractorGpuTone):number=>{
   if(!Object.hasOwn(raw,key))return fallback;
   const value=read(key);if(value===null)return fallback;
   const parsed=prepareDomainSourceScalar(value,{fallback:0,precision:'float32'});
   if(!parsed.ok)fail('capacity',['settings',key],JSON.stringify(parsed.error));
   if(parsed.facts.route==='fallback')diagnostics.push(`settings.${key}: 源表达式解析失败，返回 0；原值保留在 source。`);
   return tone===undefined?finite(parsed.facts.value,['settings',key]):toneClamp(tone,parsed.facts.value);
  };
  const boolean=(key:string,fallback:boolean):boolean=>{
   if(!Object.hasOwn(raw,key))return fallback;const value=read(key);
   if(typeof value==='boolean')return value;
   if(typeof value==='string'&&/^(true|false)$/i.test(value))return value.toLowerCase()==='true';
   return fail('input',['settings',key],'源 getBoolean 需要布尔值或不带空格的 true/false 字符串');
  };
  configuration.points.dotRadius=scalar('dot_size',2);
  configuration.trails.lineWeight=scalar('line_weight',F(.8));
  configuration.trails.lifetime=scalar('trail_lifetime',3);
  configuration.trails.show=boolean('show_trails',true);
  configuration.trails.fade=boolean('fade_trails',false);
  for(const key of Object.keys(toneFields) as (keyof SourceAttractorGpuTone)[])configuration.gpuTone[key]=scalar(toneFields[key],SOURCE_ATTRACTOR_GPU_TONE_DEFAULTS[key],key);
 }
 return{configuration,consumedPaths,numericPaths,diagnostics};
});}
/** Deep copy saved facts. Older documents omit gpuTone; this owner alone
 * migrates that omission to source defaults. Present tone objects remain strict
 * and use the native runtime Float32 clamp, also used by numeric authoring. */
export function parseSourceAttractorVisualConfiguration(raw:unknown):SourceAttractorResult<SourceAttractorVisualConfiguration>{return attempt(()=>{
 if(!object(raw))fail('input',[],'源视觉配置必须为对象');
 fields(raw,['model','settingsPresence','points','trails','palette',...(Object.hasOwn(raw,'gpuTone')?['gpuTone']:[])],[]);
 if(raw.model!==SOURCE_ATTRACTOR_VISUAL_MODEL)fail('input',['model'],'未知源视觉版本');
 if(raw.settingsPresence!=='absent'&&raw.settingsPresence!=='object')fail('input',['settingsPresence'],'未知 settings 存在状态');
 if(!object(raw.points))fail('input',['points'],'必须为对象');fields(raw.points,['dotRadius','fadePoints'],['points']);
 if(raw.points.fadePoints!==false)fail('input',['points','fadePoints'],'原版 JsonAttractorConfig 不读取 fade_points，必须为 false');
 if(!object(raw.trails))fail('input',['trails'],'必须为对象');fields(raw.trails,['lineWeight','lifetime','show','fade'],['trails']);
 if(typeof raw.trails.show!=='boolean'||typeof raw.trails.fade!=='boolean')fail('input',['trails'],'轨迹开关必须为布尔值');
 return{model:SOURCE_ATTRACTOR_VISUAL_MODEL,settingsPresence:raw.settingsPresence,points:{dotRadius:finite(raw.points.dotRadius,['points','dotRadius']),fadePoints:false},trails:{lineWeight:finite(raw.trails.lineWeight,['trails','lineWeight']),lifetime:finite(raw.trails.lifetime,['trails','lifetime']),show:raw.trails.show,fade:raw.trails.fade},palette:savedPalette(raw.palette),gpuTone:Object.hasOwn(raw,'gpuTone')?savedTone(raw.gpuTone):{...SOURCE_ATTRACTOR_GPU_TONE_DEFAULTS}};
});}
/** StrangeAttractor.cachePalette -> ManimColors.gradient, shared by initial
 * construction and applyPalette. This is not the later gradient-animation
 * callback sampler (which wraps and may use other interpolation spaces). */
export function prepareSourceAttractorInitialColors(input:SourceAttractorPalette,count:number):SourceAttractorResult<SourceAttractorInitialColors>{return attempt(()=>{
 if(!Number.isInteger(count)||count<0||count>2147483647)fail('input',['count'],'初始颜色数量必须为非负 Java int');
 const palette=savedPalette(input),diagnostics:string[]=[];
 // Both families' default constant is exactly ManimColors.DEFAULT_PALETTE;
 // reuse its existing definition without borrowing Domain sampling semantics.
 const effective=palette.kind==='absent'||palette.colors.length===0?DEFAULT_DOMAIN_SOURCE_COLORS:palette.colors;
 const packedPalette=Object.freeze(effective.map((text,index)=>{
  try{return sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push(`palette.${index}: 源颜色解析失败，采用白色；原字符串已保留。`);return 0xffffffff;}
 }));
 return Object.freeze({count,packedPalette,diagnostics:Object.freeze(diagnostics),colorAt(index:number){return attempt(()=>{
  if(!Number.isInteger(index)||index<0||index>=count)fail('input',['index'],'初始颜色索引超出粒子数量');
  return sourceManimGradientColor(packedPalette,count,index);
 });}});
});}
