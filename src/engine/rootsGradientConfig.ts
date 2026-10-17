import {parseDomainSourceDouble} from './domainSourceScalar';
import {isJavaBlank,javaTrim} from './sourceJavaText';
import {SOURCE_JSON_LIMITS} from './sourceJson';

export interface RootsGradientConfiguration {
 readonly mode:'hue_rotate'|'offset_cycle'|'palette_morph'|'cross_fade';
 readonly interpolation:'rgb'|'linear'|'oklab'|'oklch';
 readonly speed:number;
}
export class RootsGradientConfigurationError extends Error {
 constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='RootsGradientConfigurationError';}
}
export const ROOTS_GRADIENT_MODES=Object.freeze(['hue_rotate','offset_cycle','palette_morph','cross_fade'] as const);
export const ROOTS_GRADIENT_INTERPOLATIONS=Object.freeze(['rgb','linear','oklab','oklch'] as const);
export const ROOTS_GRADIENT_DEFAULT:RootsGradientConfiguration=Object.freeze({mode:'hue_rotate',interpolation:'oklab',speed:60});
const modes:readonly string[]=ROOTS_GRADIENT_MODES,interpolations:readonly string[]=ROOTS_GRADIENT_INTERPOLATIONS;
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
const own=(raw:Readonly<Record<string,unknown>>,key:string):unknown=>Object.hasOwn(raw,key)?raw[key]:undefined;
const fail=(message:string):never=>{throw new RootsGradientConfigurationError('input',message);};
/** Saved local configuration is strict. Source defaults belong only to the
 * native importer below; an old missing gradient marker must not start one. */
export function parseRootsGradientConfiguration(raw:unknown):RootsGradientConfiguration {
 if(!object(raw))return fail('复根渐变配置必须为对象');
 if(Object.keys(raw).some(key=>!['mode','interpolation','speed','model','affectInside','affectOutside'].includes(key)))return fail('复根渐变配置含未知字段');
 if(!Object.hasOwn(raw,'mode')||!Object.hasOwn(raw,'interpolation')||!modes.includes(raw.mode as string)||!interpolations.includes(raw.interpolation as string))return fail('复根渐变模式或插值无效');
 if(!Object.hasOwn(raw,'speed')||typeof raw.speed!=='number'||!Number.isFinite(raw.speed)||raw.speed<0)return fail('复根渐变速度必须为有限非负数值');
 if(raw.model!==undefined&&raw.model!=='offsets')return fail('复根源渐变只接受 offsets 模型');
 if(raw.affectInside!==undefined&&raw.affectInside!==true||raw.affectOutside!==undefined&&raw.affectOutside!==true)return fail('复根源渐变始终同时作用于两侧');
 return {mode:raw.mode as RootsGradientConfiguration['mode'],interpolation:raw.interpolation as RootsGradientConfiguration['interpolation'],speed:raw.speed};
}

export const ROOTS_GRADIENT_SOURCE_FIELDS=Object.freeze(['targetDomain','mode','interpolation','speed','affectInside','affectOutside'] as const);
export interface RootsGradientSourcePayload {readonly value:Readonly<Record<string,unknown>>;readonly path:readonly string[];}
/** JsonComplexRootsConfig.extractFirstObjectPayload, offsets0–64. Arrays are
 * searched in order until the first object, including a later array slot. The
 * existing source JSON node budget also bounds callers supplying raw values. */
export function rootsGradientSourcePayload(raw:unknown):RootsGradientSourcePayload|undefined {
 if(object(raw))return {value:raw,path:[]};
 if(!Array.isArray(raw))return undefined;
 if(raw.length>SOURCE_JSON_LIMITS.nodes)throw new RootsGradientConfigurationError('capacity','复根渐变参数超过源 JSON 节点容量');
 for(let i=0;i<raw.length;i++)if(object(raw[i]))return {value:raw[i],path:[String(i)]};
 return undefined;
}
export type RootsGradientImportFacts={
 readonly payloadPath:readonly string[]|null;
 readonly payloadEmpty:boolean;
 readonly consumedFields:readonly (typeof ROOTS_GRADIENT_SOURCE_FIELDS[number])[];
 readonly diagnostics:readonly string[];
}&({readonly kind:'start';readonly config:RootsGradientConfiguration}|{readonly kind:'skip';readonly reason:'target-domain'|'unknown-mode'});
const text=(raw:unknown):string|undefined=>{
 if(typeof raw!=='string')return undefined;
 if(raw.length>SOURCE_JSON_LIMITS.characters)throw new RootsGradientConfigurationError('capacity','复根渐变文本超过源 JSON 字符容量');
 return raw;
};
function enumName(raw:unknown,fallback:string,diagnostics:string[]):string|undefined {
 if(raw==null)return fallback;
 const value=text(raw);if(value===undefined)return undefined;
 if(isJavaBlank(value))return fallback;
 const trimmed=javaTrim(value),upper=trimmed.toUpperCase();
 // The source uses String.toUpperCase() with the JVM default locale, which
 // is not recorded in JSON. Use Unicode casing and disclose inputs whose
 // mapping can depend on that unavailable locale; never claim locale parity.
 if(trimmed!==upper&&/[i\u0080-\uffff]/.test(trimmed))diagnostics.push('原版渐变枚举使用 JVM 默认区域大小写规则；当前采用 Unicode 大写映射，未确认原运行环境的区域设置。');
 return upper;
}
function speed(raw:unknown,diagnostics:string[]):number {
 let value:number|undefined;
 if(typeof raw==='number')value=raw;
 else if(typeof raw==='string'){
  const result=parseDomainSourceDouble(raw);
  if(result.ok)value=result.value;
  else if(result.error.kind==='capacity')throw new RootsGradientConfigurationError('capacity',`复根渐变速度超过本地标量解析容量 characters=${result.error.limit}`);
 }
 if(value===undefined||!Number.isFinite(value)){
  if(raw!==undefined)diagnostics.push('原版渐变速度未解析为有限 Java double，采用默认值 60；原值保留在 source。');
  return ROOTS_GRADIENT_DEFAULT.speed;
 }
 const clamped=Math.max(0,value);
 if(clamped!==value)diagnostics.push('原版渐变速度按非负规则调整为 0；原值保留在 source。');
 return clamped;
}
/** Source entry only: first-object selection, applicability and native
 * GradientActionConfig defaults. Speed accepts Double.parseDouble literals,
 * never the source expression parser. Expected skipped actions are tagged;
 * resource failures throw instead of being turned into source defaults. */
export function prepareRootsGradientImport(args:unknown):RootsGradientImportFacts {
 const payload=rootsGradientSourcePayload(args),raw=payload?.value??{},diagnostics:string[]=[],payloadPath=payload?.path??null,payloadEmpty=payload!==undefined&&Object.keys(raw).length===0;
 const target=own(raw,'targetDomain');
 if(target!=null&&(typeof target!=='string'||javaTrim(text(target)!)!==''&&javaTrim(target).toUpperCase()!=='COMPLEX_ROOTS'))
  return {kind:'skip',reason:'target-domain',payloadPath,payloadEmpty,consumedFields:['targetDomain'],diagnostics:['原版渐变 targetDomain 不匹配 COMPLEX_ROOTS，跳过此动作；原值保留在 source。']};
 const mode=enumName(own(raw,'mode'),'HUE_ROTATE',diagnostics),interpolation=enumName(own(raw,'interpolation'),'OKLAB',diagnostics),parsedSpeed=speed(own(raw,'speed'),diagnostics);
 const consumedFields=payload?ROOTS_GRADIENT_SOURCE_FIELDS:[];
 // fromJson reads these flags, but Roots reconstructs the action with both
 // true. Their malformed values are caught by getBoolean(default true).
 if(Object.hasOwn(raw,'affectInside')||Object.hasOwn(raw,'affectOutside'))diagnostics.push('原版复根渐变固定同时作用于两侧；输入的区域开关保留但不参与执行。');
 if(mode===undefined||!modes.includes(mode.toLowerCase()))return {kind:'skip',reason:'unknown-mode',payloadPath,payloadEmpty,consumedFields,diagnostics:[...diagnostics,'原版未识别渐变模式，跳过此动作；原值保留在 source。']};
 const selectedInterpolation=interpolation?.toLowerCase();
 if(selectedInterpolation===undefined||!interpolations.includes(selectedInterpolation))diagnostics.push('原版未识别渐变插值，采用 OKLAB；原值保留在 source。');
 return {kind:'start',payloadPath,payloadEmpty,consumedFields,diagnostics:[...new Set(diagnostics)],config:{mode:mode.toLowerCase() as RootsGradientConfiguration['mode'],interpolation:selectedInterpolation!==undefined&&interpolations.includes(selectedInterpolation)?selectedInterpolation as RootsGradientConfiguration['interpolation']:'oklab',speed:parsedSpeed}};
}
