import {sourceParticleGradientPayload} from './sourceParticleGradientImport';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';

export const SOURCE_PERLIN_PARAMETER_NAMES=['noise_offset','noise_scale','curve_noise_scale','curve_angle_scale'] as const;
export type SourcePerlinParameterName=typeof SOURCE_PERLIN_PARAMETER_NAMES[number];
export interface SourcePerlinParameterConfiguration {readonly name:SourcePerlinParameterName;readonly step:number;readonly min:number;readonly max:number;}
export interface SourcePerlinParameterAction {readonly kind:'start'|'stop';readonly parameters:readonly SourcePerlinParameterConfiguration[];}
export interface SourcePerlinParameterError {readonly kind:'input'|'capacity'|'nonfinite';readonly path:readonly string[];readonly reason:string;}
export type SourcePerlinParameterResult<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:SourcePerlinParameterError};
export class SourcePerlinParameterFailure extends Error {
 constructor(readonly detail:SourcePerlinParameterError){super(`Perlin 源参数 ${detail.path.join('.')}: ${detail.reason}`);this.name='SourcePerlinParameterFailure';}
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(kind:SourcePerlinParameterError['kind'],path:readonly string[],reason:string):never=>{throw new SourcePerlinParameterFailure({kind,path,reason});};
function attempt<T>(f:()=>T):SourcePerlinParameterResult<T>{try{return{ok:true,value:f()};}catch(e){if(e instanceof SourcePerlinParameterFailure)return{ok:false,error:e.detail};throw e;}}
const finite=(v:unknown,path:readonly string[]):number=>typeof v==='number'&&Number.isFinite(v)?v:fail('nonfinite',path,'需要有限数值');
export const SOURCE_PERLIN_PARAMETER_DEFAULTS:Readonly<Record<SourcePerlinParameterName,readonly [number,number,number]>>=Object.freeze({noise_offset:Object.freeze([.01,-1,1] as const),noise_scale:Object.freeze([1,4,30] as const),curve_noise_scale:Object.freeze([.02,.45,5.8] as const),curve_angle_scale:Object.freeze([.05,1.4,8.5] as const)});
const floors:Readonly<Record<SourcePerlinParameterName,number>>={noise_offset:-1,noise_scale:.0001,curve_noise_scale:.01,curve_angle_scale:.1};
/** Saved actions have already passed source defaults/clamps. Reject stale or
 * foreign representations rather than silently reinterpreting a document. */
export function parseSourcePerlinParameterAction(raw:unknown):SourcePerlinParameterResult<SourcePerlinParameterAction>{return attempt(()=>{
 if(!object(raw)||(raw.kind!=='start'&&raw.kind!=='stop')||Object.keys(raw).some(k=>!['kind','parameters'].includes(k)))return fail('input',[],'需要 Perlin 参数动作');
 if(!Array.isArray(raw.parameters)||raw.parameters.length>4)return fail('capacity',['parameters'],'每个动作最多四种固定参数');
 let last=-1;
 const parameters=raw.parameters.map((value,index)=>{
  const p=['parameters',String(index)];if(!object(value)||Object.keys(value).some(k=>!['name','step','min','max'].includes(k)))return fail('input',p,'参数配置无效');
  const order=SOURCE_PERLIN_PARAMETER_NAMES.indexOf(value.name as SourcePerlinParameterName);
  if(order<0||order<=last)return fail('input',[...p,'name'],'参数必须唯一且按原版固定顺序排列');last=order;
  const name=SOURCE_PERLIN_PARAMETER_NAMES[order],step=finite(value.step,[...p,'step']),min=finite(value.min,[...p,'min']),max=finite(value.max,[...p,'max']);
  if(min<floors[name]||max<min||name==='noise_offset'&&max>1)return fail('input',p,'规范化范围超出原版参数边界');
  // Source setters store float, while phase/configuration arithmetic is double.
  if(!Number.isFinite(Math.fround(max))||!Number.isFinite((min+max)*.5))return fail('nonfinite',p,'参数范围无法表示为有限源字段');
  return Object.freeze({name,step,min,max});
 });
 return Object.freeze({kind:raw.kind as 'start'|'stop',parameters:Object.freeze(parameters)});
});}

export interface SourcePerlinParameterImportFacts {
 readonly action?:SourcePerlinParameterAction;
 readonly skipped:boolean;
 readonly consumedPaths:readonly (readonly string[])[];
 readonly numericPaths:readonly (readonly string[])[];
 readonly diagnostics:readonly string[];
}
/** Caller owns the original input and numeric-token provenance. Raw missing args
 * skips the child; an empty payload still constructs a start/stop child. */
export function importSourcePerlinParameterAction(method:'paramStart'|'paramStop',args:unknown):SourcePerlinParameterResult<SourcePerlinParameterImportFacts>{return attempt(()=>{
 const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 if(!object(args)&&!Array.isArray(args))return{skipped:true,consumedPaths,numericPaths,diagnostics:['原版 Perlin 跳过没有数组或对象 args 的参数动作。']};
 const payload=sourceParticleGradientPayload(args),raw=payload?.value??{},base=[...(payload?.path??[])],parameters:SourcePerlinParameterConfiguration[]=[];
 if(payload&&Object.keys(raw).length===0)consumedPaths.push(base);
 if(Object.hasOwn(raw,'parameters')){
  const source=raw.parameters,p=[...base,'parameters'];if(!object(source))return fail('input',p,'源 parameters 必须为对象');
  if(Object.keys(source).length===0)consumedPaths.push(p);
  for(const name of SOURCE_PERLIN_PARAMETER_NAMES){
   if(!Object.hasOwn(source,name))continue;const value=source[name],path=[...p,name];
   if(!object(value)){consumedPaths.push(path);continue;}
   if(Object.hasOwn(value,'enable')){
    consumedPaths.push([...path,'enable']);const enabled=value.enable;
    if(enabled===false||typeof enabled==='string'&&javaEqualsIgnoreCaseAscii(enabled,'false'))continue;
   }
   if(Object.keys(value).length===0)consumedPaths.push(path);
   const values=['step','min','max'].map((key,i)=>{
    const fieldPath=[...path,key];if(Object.hasOwn(value,key)){consumedPaths.push(fieldPath);numericPaths.push(fieldPath);}
    const source=value[key];let number:number|undefined;
    if(typeof source==='number')number=source;
    else if(typeof source==='string'){
     const parsed=parseDomainSourceDouble(source);if(parsed.ok)number=parsed.value;
     else if(parsed.error.kind==='capacity')return fail('capacity',fieldPath,'数值文本超过本地解析容量');
    }
    // JSONObject.getDouble(key,default) catches parse/type failures. It does
    // not evaluate expressions and does not round successful doubles to float.
    if(number===undefined){if(Object.hasOwn(value,key))diagnostics.push(`${fieldPath.join('.')}: 按原版 getDouble 使用默认值。`);return SOURCE_PERLIN_PARAMETER_DEFAULTS[name][i];}
    return finite(number,fieldPath);
   });
   const step=values[0];let min=values[1],max=values[2];if(min>max)[min,max]=[max,min];
   min=Math.max(floors[name],name==='noise_offset'?Math.min(1,min):min);
   max=name==='noise_offset'?Math.max(-1,Math.min(1,max)):Math.max(min,max);
   parameters.push({name,step,min,max});
  }
 }
 const parsed=parseSourcePerlinParameterAction({kind:method==='paramStart'?'start':'stop',parameters});if(!parsed.ok)throw new SourcePerlinParameterFailure(parsed.error);
 return{action:parsed.value,skipped:false,consumedPaths,numericPaths,diagnostics};
});}
