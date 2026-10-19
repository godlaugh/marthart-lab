import {type SourceParticleGradientConfiguration,SourceParticleGradientConfigurationError,SOURCE_PARTICLE_GRADIENT_MODES,SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS} from './sourceParticleGradientConfig';
import type {GradientAnimation} from '../types';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {isJavaBlank,javaTrim} from './sourceJavaText';
import {SOURCE_JSON_LIMITS} from './sourceJson';

export const SOURCE_PARTICLE_GRADIENT_SOURCE_FIELDS=Object.freeze(['targetDomain','mode','interpolation','speed','affectInside','affectOutside'] as const);
const modes:readonly string[]=SOURCE_PARTICLE_GRADIENT_MODES,interpolations:readonly string[]=SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS;
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
const own=(raw:Readonly<Record<string,unknown>>,key:string):unknown=>Object.hasOwn(raw,key)?raw[key]:undefined;

export interface SourceParticleGradientPayload {readonly value:Readonly<Record<string,unknown>>;readonly path:readonly string[];}
/** JsonSurfaceConfig/JsonPerlinConfig.extractFirstObjectPayload offsets 0–54: unlike Roots,
 * only index zero is inspected. No traversal or interpretation of later slots. */
export function sourceParticleGradientPayload(args:unknown):SourceParticleGradientPayload|undefined {
 if(object(args))return {value:args,path:[]};
 if(Array.isArray(args)&&Object.hasOwn(args,0)&&object(args[0]))return {value:args[0],path:['0']};
 return undefined;
}
export type SourceParticleGradientImportFacts={
 readonly payloadPath:readonly string[]|null;
 readonly payloadEmpty:boolean;
 readonly consumedFields:readonly (typeof SOURCE_PARTICLE_GRADIENT_SOURCE_FIELDS[number])[];
 readonly diagnostics:readonly string[];
}&({readonly kind:'start';readonly config:SourceParticleGradientConfiguration}|{readonly kind:'skip';readonly reason:'target-domain'|'unknown-mode'});

/** JSONObject.getString falls back only for missing/null. JSON objects and
 * arrays stringify with delimiters, so cannot match an enum or FRACTAL. Their
 * exact pretty-printing is unnecessary here; do not serialize/traverse them. */
function sourceText(raw:unknown):string|undefined {
 if(raw==null)return undefined;
 if(typeof raw==='string'){
  if(raw.length>SOURCE_JSON_LIMITS.characters)throw new SourceParticleGradientConfigurationError('capacity','粒子渐变文本超过源 JSON 字符容量');
  return raw;
 }
 if(typeof raw==='number'||typeof raw==='boolean')return String(raw);
 return Array.isArray(raw)?'[]':'{}';
}
function enumName(raw:unknown,fallback:string,diagnostics:string[]):string {
 const value=sourceText(raw);if(value===undefined||isJavaBlank(value))return fallback;
 const trimmed=javaTrim(value),upper=trimmed.toUpperCase();
 if(trimmed!==upper&&/[i\u0080-\uffff]/.test(trimmed))diagnostics.push('原版渐变枚举使用 JVM 默认区域大小写规则；当前采用 Unicode 大写映射，未确认原运行环境的区域设置。');
 return upper;
}
function sourceSpeed(raw:unknown,diagnostics:string[]):number {
 let value:number|undefined;
 if(typeof raw==='number')value=raw;
 else if(typeof raw==='string'){
  const parsed=parseDomainSourceDouble(raw);
  if(parsed.ok)value=parsed.value;
  else if(parsed.error.kind==='capacity')throw new SourceParticleGradientConfigurationError('capacity',`粒子渐变速度超过本地标量解析容量 characters=${parsed.error.limit}`);
 }
 if(value===undefined||!Number.isFinite(value)){
  if(raw!==undefined)diagnostics.push('原版渐变速度未解析为有限 Java double，采用默认值 60；原值保留在 source。');
  return 60;
 }
 if(value<0)diagnostics.push('原版渐变速度按非负规则调整为 0；原值保留在 source。');
 return Math.max(0,value);
}

/** Shared 1.7.8 GradientActionConfig contract. Only Surface excludes
 * untrimmed, case-insensitive FRACTAL; Surface, Attractor and Perlin force both flags true.
 * Expected skipped actions are tagged, resource failures never become defaults. */
export function importSourceParticleGradient(args:unknown,family:'surface'|'attractor'|'perlin'):SourceParticleGradientImportFacts {
 const payload=sourceParticleGradientPayload(args),raw=payload?.value??{},diagnostics:string[]=[];
 const facts={payloadPath:payload?.path??null,payloadEmpty:payload!==undefined&&Object.keys(raw).length===0};
 const target=family==='surface'?sourceText(own(raw,'targetDomain')):undefined;
 // FRACTAL contains no i; Java equalsIgnoreCase has no locale dependency here.
 if(family==='surface'&&target!==undefined&&target.toUpperCase()==='FRACTAL')return {kind:'skip',reason:'target-domain',...facts,consumedFields:['targetDomain'],diagnostics:['原版粒子渐变排除 targetDomain FRACTAL，跳过此动作；原值保留在 source。']};
 const mode=enumName(own(raw,'mode'),'HUE_ROTATE',diagnostics).toLowerCase(),interpolation=enumName(own(raw,'interpolation'),'OKLAB',diagnostics).toLowerCase(),speed=sourceSpeed(own(raw,'speed'),diagnostics);
 const consumedFields=payload?SOURCE_PARTICLE_GRADIENT_SOURCE_FIELDS.filter(field=>family==='surface'||field!=='targetDomain'):[];
 if(Object.hasOwn(raw,'affectInside')||Object.hasOwn(raw,'affectOutside'))diagnostics.push('原版粒子渐变固定同时作用于两侧；输入的区域开关保留但不参与执行。');
 if(!modes.includes(mode))return {kind:'skip',reason:'unknown-mode',...facts,consumedFields,diagnostics:[...new Set([...diagnostics,'原版未识别渐变模式，跳过此动作；原值保留在 source。'])]};
 if(!interpolations.includes(interpolation))diagnostics.push('原版未识别渐变插值，采用 OKLAB；原值保留在 source。');
 return {kind:'start',...facts,consumedFields,diagnostics:[...new Set(diagnostics)],config:{model:'offsets',mode:mode as GradientAnimation['mode'],interpolation:interpolations.includes(interpolation)?interpolation as GradientAnimation['interpolation']:'oklab',speed,affectInside:true,affectOutside:true}};
}
