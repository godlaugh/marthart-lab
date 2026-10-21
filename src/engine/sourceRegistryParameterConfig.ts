import type {OscillationEdgeEasing,SourceSurfaceParameterAction,SourceSurfaceParameterClip,SourceRegistryParameterConfiguration,SourceRegistryParameterModel,SourceRegistryParameterAction,SourceSymmetryParameterOperation,SourceMapParameterOperation} from '../types';
import type {OrdinarySourceScalarScope} from './ordinarySourceCameraImport';
import {ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS} from './ordinarySourceCameraImport';
import {parseDomainSourceDouble,parseDomainSourceFloat} from './domainSourceScalar';
import {lookupSourceEasing,SOURCE_EASING_NAMES} from './sourceEasing';
import {javaTrim} from './sourceJavaText';
import {sourceSurfaceGradientPayload} from './sourceSurfaceGradientConfig';

export const SOURCE_SURFACE_PARAMETER_MODEL='surface-registry-1.7.8' as const;
export const SOURCE_SYMMETRY_PARAMETER_MODEL='symmetry-registry-1.7.8' as const;
export const SOURCE_MAP_PARAMETER_MODEL='map-registry-1.7.8' as const;
export const SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT:Readonly<OscillationEdgeEasing>=Object.freeze({window:.5,floor:.25,easing:'sine-out'});
export const SOURCE_SURFACE_PARAMETER_DEFAULT:Readonly<SourceRegistryParameterConfiguration>=Object.freeze({min:-100,max:100,step:Math.fround(.1),edgeEasing:SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT});
export const SOURCE_SYMMETRY_PARAMETER_DEFAULT:Readonly<SourceRegistryParameterConfiguration>=Object.freeze({min:-1,max:1,step:Math.fround(.1),edgeEasing:SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT});
export const SOURCE_MAP_PARAMETER_DEFAULT=SOURCE_SYMMETRY_PARAMETER_DEFAULT;
export const SOURCE_REGISTRY_PARAMETER_FIELDS=['min','max','step','enable'] as const;
export const SOURCE_REGISTRY_PARAMETER_EDGE_FIELDS=['window','floor','easing'] as const;
export type SourceRegistryParameterError={kind:'input'|'capacity'|'nonfinite';path:readonly string[];reason:string};
export type SourceRegistryParameterResult<T>={ok:true;value:T}|{ok:false;error:SourceRegistryParameterError};
class ParameterFailure extends Error {constructor(readonly detail:SourceRegistryParameterError){super(`源注册表参数 ${detail.path.join('.')}: ${detail.reason}`);}}
const fail=(kind:SourceRegistryParameterError['kind'],path:readonly string[],reason:string):never=>{throw new ParameterFailure({kind,path,reason});};
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
function attempt<T>(read:()=>T):SourceRegistryParameterResult<T>{try{return{ok:true,value:read()};}catch(error){if(error instanceof ParameterFailure)return{ok:false,error:error.detail};throw error;}}
const keys=(raw:Record<string,unknown>,allowed:readonly string[],path:readonly string[])=>{if(Object.keys(raw).some(key=>!allowed.includes(key)))fail('input',path,'未知字段');};
function finite(raw:unknown,path:readonly string[]):number {if(typeof raw!=='number')return fail('input',path,'需要数值');if(!Number.isFinite(raw))return fail('nonfinite',path,'本地不能保存或回放非有限源数值');return raw;}
function name(raw:unknown,path:readonly string[]):string {if(typeof raw!=='string')return fail('input',path,'参数名必须是原始字符串');if(raw.length>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)return fail('capacity',path,'参数名超过本地文本容量');return raw;}
function bounded<T>(raw:unknown,path:readonly string[]):T[]{if(!Array.isArray(raw))return fail('input',path,'需要数组');if(raw.length>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters)return fail('capacity',path,'参数项超过本地注册表容量');return raw as T[];}
function savedEdge(raw:unknown,path:readonly string[]):OscillationEdgeEasing{
 if(!object(raw))return fail('input',path,'需要边界缓动对象');keys(raw,['window','floor','easing'],path);
 if(typeof raw.easing!=='string'||!(SOURCE_EASING_NAMES as readonly string[]).includes(raw.easing))return fail('input',[...path,'easing'],'未知源缓动');
 return{window:finite(raw.window,[...path,'window']),floor:finite(raw.floor,[...path,'floor']),easing:raw.easing};
}
function savedConfig(raw:unknown,path:readonly string[]):SourceRegistryParameterConfiguration{
 if(!object(raw))return fail('input',path,'需要参数配置对象');keys(raw,['min','max','step','edgeEasing'],path);
 return{min:finite(raw.min,[...path,'min']),max:finite(raw.max,[...path,'max']),step:finite(raw.step,[...path,'step']),edgeEasing:savedEdge(raw.edgeEasing,[...path,'edgeEasing'])};
}
export function parseSourceRegistryParameterActions<Model extends SourceRegistryParameterModel>(raw:unknown,method:'paramStart'|'paramStop',model:Model):SourceRegistryParameterAction<Model>[] {
 let characters=0;return bounded<unknown>(raw,[]).map((value,index)=>{
  const path=[String(index)];if(!object(value))return fail('input',path,'需要源参数动作对象');keys(value,['model','scope','configuration'],path);
  if(value.model!==model||!object(value.scope))return fail('input',path,'源参数模型或作用域无效');
  const scope=value.scope;if(scope.kind==='named'){characters+=name(scope.name,[...path,'scope','name']).length;if(characters>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)fail('capacity',path,'参数名总文本超过本地容量');}if(scope.kind!=='all'&&scope.kind!=='named')return fail('input',[...path,'scope'],'作用域无效');keys(scope,scope.kind==='all'?['kind']:['kind','name'],[...path,'scope']);
  if(method==='paramStart'&&scope.kind==='named')return{model,scope:{kind:'named',name:name(scope.name,[...path,'scope','name'])},configuration:savedConfig(value.configuration,[...path,'configuration'])};
  if(value.configuration!==undefined)return fail('input',[...path,'configuration'],'全部操作或停止动作不能携带配置');
  return{model,scope:scope.kind==='all'?{kind:'all'}:{kind:'named',name:name(scope.name,[...path,'scope','name'])}};
 });
}
export const parseSourceSurfaceParameterActions=(raw:unknown,method:'paramStart'|'paramStop'):SourceSurfaceParameterAction[]=>parseSourceRegistryParameterActions(raw,method,SOURCE_SURFACE_PARAMETER_MODEL);
export const parseSourceSymmetryParameterActions=(raw:unknown,method:'paramStart'|'paramStop'):SourceSymmetryParameterOperation[]=>parseSourceRegistryParameterActions(raw,method,SOURCE_SYMMETRY_PARAMETER_MODEL);
export const parseSourceMapParameterActions=(raw:unknown,method:'paramStart'|'paramStop'):SourceMapParameterOperation[]=>parseSourceRegistryParameterActions(raw,method,SOURCE_MAP_PARAMETER_MODEL);
export function parseSourceSurfaceParameterClip(raw:unknown):SourceSurfaceParameterClip{
 if(!object(raw)||raw.model!==SOURCE_SURFACE_PARAMETER_MODEL)return fail('input',[],'需要源参数片段模型');keys(raw,['model','parameters'],[]);
 const seen=new Set<string>();let characters=0;return{model:SOURCE_SURFACE_PARAMETER_MODEL,parameters:bounded<unknown>(raw.parameters,['parameters']).map((item,index)=>{
  const path=['parameters',String(index)];if(!object(item))return fail('input',path,'需要参数配置');keys(item,['name','min','max','step','enabled'],path);
  const key=name(item.name,[...path,'name']);characters+=key.length;if(characters>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)fail('capacity',path,'参数名总文本超过本地容量');if(seen.has(key))return fail('input',path,'独立片段参数名重复');seen.add(key);
  if(typeof item.enabled!=='boolean')return fail('input',[...path,'enabled'],'需要布尔值');
  return{name:key,min:finite(item.min,[...path,'min']),max:finite(item.max,[...path,'max']),step:finite(item.step,[...path,'step']),enabled:item.enabled};
 })};
}
interface ImportOptions {
 scope:OrdinarySourceScalarScope;
 /** Source JSONObject HashMap order, resolved by Reader; relative payload path. */
 memberOrder:(path:readonly string[])=>readonly string[];
 edgeDefaults?:OscillationEdgeEasing;
}
interface ImportFacts<T> {configuration:T;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
function uniqueFacts<T>(facts:ImportFacts<T>):ImportFacts<T>{
 const seen=new Set<string>();facts.numericPaths=facts.numericPaths.filter(path=>{const key=JSON.stringify(path);if(seen.has(key))return false;seen.add(key);return true;});return facts;
}
/** Retain recognized numeric source slots independently from execution. This
 * does not parse disabled or target-excluded configurations. */
function retainedNumbers(raw:Record<string,unknown>,base:string[],standalone:boolean):string[][]{
 const paths:string[][]=[],edge=(value:unknown,path:string[])=>{if(object(value))for(const field of SOURCE_REGISTRY_PARAMETER_EDGE_FIELDS)if(typeof value[field]==='number')paths.push([...path,field]);};
 if(!standalone){if(typeof raw.targetDomain==='number')paths.push([...base,'targetDomain']);edge(raw.edgeEasing,[...base,'edgeEasing']);}
 const parameters=standalone?raw:raw.parameters;if(!object(parameters))return paths;
 for(const key of Object.keys(parameters)){
  const value=parameters[key],path=[...base,...(standalone?[]:['parameters']),key];
  if(typeof value==='number')paths.push(path);
  else if(object(value)){for(const field of SOURCE_REGISTRY_PARAMETER_FIELDS)if(typeof value[field]==='number')paths.push([...path,field]);if(!standalone)edge(value.edgeEasing,[...path,'edgeEasing']);}
 }
 return paths;
}
function edge(raw:unknown,inherited:OscillationEdgeEasing,path:readonly string[],consumed:string[][],numeric:string[][],diagnostics:string[]):OscillationEdgeEasing{
 if(!object(raw))return fail('input',path,'源 edgeEasing 必须为对象');
 const value={...inherited};for(const key of ['window','floor'] as const){if(!Object.hasOwn(raw,key))continue;const p=[...path,key];consumed.push(p);numeric.push(p);const v=raw[key];
  if(typeof v==='number')value[key]=finite(v,p);
  else if(typeof v==='string'){
   const parsed=parseDomainSourceDouble(v);if(parsed.ok)value[key]=finite(parsed.value,p);else if(parsed.error.kind==='capacity')fail('capacity',p,'边界缓动数值超过解析容量');else diagnostics.push(`${p.join('.')}: 源边界数值无法解析，保留继承值。`);
  }else diagnostics.push(`${p.join('.')}: 源边界数值无法解析，保留继承值。`);
 }
 if(Object.hasOwn(raw,'easing')){const p=[...path,'easing'];consumed.push(p);numeric.push(p);const mapped=lookupSourceEasing(raw.easing);if(mapped)value.easing=mapped;else diagnostics.push(`${p.join('.')}: 未识别源缓动，保留继承值。`);}
 if(Object.keys(raw).length===0)consumed.push([...path]);return value;
}
export function importSourceRegistryParameterEdge(raw:unknown):SourceRegistryParameterResult<ImportFacts<OscillationEdgeEasing>>{
 return attempt(()=>{const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];return{configuration:edge(raw,{...SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT},[],consumedPaths,numericPaths,diagnostics),consumedPaths,numericPaths,diagnostics};});
}
function enabled(raw:Record<string,unknown>,path:string[],consumed:string[][],numeric:string[][]):boolean{
 if(!Object.hasOwn(raw,'enable'))return true;const p=[...path,'enable'];consumed.push(p);numeric.push(p);const v=raw.enable;
 if(typeof v==='boolean')return v;if(typeof v==='string'&&/^(?:true|false)$/i.test(v))return v.toLowerCase()==='true';return fail('input',p,'源 enable 只接受布尔值或不带空格的 true/false 字符串');
}
function scalar(raw:Record<string,unknown>,key:string,fallback:number,path:string[],options:ImportOptions,consumed:string[][],numeric:string[][],diagnostics:string[]):number{
 const p=[...path,key];consumed.push(p);numeric.push(p);const out=options.scope.field(raw[key],p.join('.'),fallback,Object.hasOwn(raw,key));
 if(!out.ok)return fail(out.error.kind==='capacity'?'capacity':out.error.kind==='nonfinite'?'nonfinite':'input',p,JSON.stringify(out.error));diagnostics.push(...out.value.diagnostics);return out.value.value;
}
function ordered(raw:Record<string,unknown>,path:readonly string[],options:ImportOptions):readonly string[]{
 const order=options.memberOrder(path);if(order.length>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters)return fail('capacity',path,'参数项超过本地注册表容量');
 if(order.length!==Object.keys(raw).length||new Set(order).size!==order.length||order.some(key=>!Object.hasOwn(raw,key)))return fail('input',path,'源参数成员顺序不完整');
 let total=0;for(const key of order){total+=name(key,path).length;if(total>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)fail('capacity',path,'参数名总文本超过本地容量');}return order;
}
/** JSONObject.getString(default) stringifies non-null values. A non-string
 * target cannot equal a recognized domain, so no Java display formatter is
 * needed. Surface excludes only FRACTAL; Map/Symmetry admit their family and SURFACE. */
function acceptsDomain(raw:unknown,model:SourceRegistryParameterModel):boolean {
 if(model===SOURCE_SURFACE_PARAMETER_MODEL)return typeof raw!=='string'||raw.toUpperCase()!=='FRACTAL';
 if(raw==null)return true;
 if(typeof raw!=='string')return false;
 const domain=javaTrim(raw).toUpperCase();
 return domain===''||domain==='SURFACE'||domain===(model===SOURCE_MAP_PARAMETER_MODEL?'MAP_ATTRACTOR':'SYMMETRY_CHAOS');
}
function importParameterAction<Model extends SourceRegistryParameterModel>(method:'paramStart'|'paramStop',args:unknown,options:ImportOptions,model:Model):SourceRegistryParameterResult<ImportFacts<SourceRegistryParameterAction<Model>[]>>{
 return attempt(()=>{
  const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[],configuration:SourceRegistryParameterAction<Model>[]=[];
  const facts={configuration,consumedPaths,numericPaths,diagnostics};
  if(model===SOURCE_SURFACE_PARAMETER_MODEL&&!object(args)&&!Array.isArray(args)){diagnostics.push('原版曲面跳过无数组或对象参数的动作。');return uniqueFacts(facts);}
  const payload=sourceSurfaceGradientPayload(args),raw=payload?.value??{},base=[...(payload?.path??[])];
  for(const path of retainedNumbers(raw,base,false))numericPaths.push(path);
  if(payload){
   const p=[...base,'targetDomain'];consumedPaths.push(p);numericPaths.push(p);
   if(!acceptsDomain(raw.targetDomain,model)){diagnostics.push('源参数动作不适用于此 targetDomain。');return uniqueFacts(facts);}
   if(!Object.keys(raw).length)consumedPaths.push(base);
  }
  let parameters:Record<string,unknown>|undefined;
  if(Object.hasOwn(raw,'parameters')){if(!object(raw.parameters))return fail('input',[...base,'parameters'],'源 parameters 必须为对象');parameters=raw.parameters;}
  const inherited={...(model===SOURCE_SURFACE_PARAMETER_MODEL?options.edgeDefaults??SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT:SOURCE_REGISTRY_PARAMETER_EDGE_DEFAULT)};
  const defaultsForModel=model===SOURCE_SURFACE_PARAMETER_MODEL?SOURCE_SURFACE_PARAMETER_DEFAULT:SOURCE_SYMMETRY_PARAMETER_DEFAULT;
  const defaults=Object.hasOwn(raw,'edgeEasing')?edge(raw.edgeEasing,inherited,[...base,'edgeEasing'],consumedPaths,numericPaths,diagnostics):inherited;
  if(!parameters||Object.keys(parameters).length===0){if(parameters)consumedPaths.push([...base,'parameters']);configuration.push({model,scope:{kind:'all'}});return uniqueFacts(facts);}
  const path=[...base,'parameters'];for(const key of ordered(parameters,path,options)){
   const value=parameters[key],p=[...path,key];if(!object(value)){diagnostics.push(`${p.join('.')}: 原版动作跳过非对象配置。`);continue;}
   if(!enabled(value,p,consumedPaths,numericPaths))continue;
   const operation:SourceRegistryParameterAction<Model>={model,scope:{kind:'named',name:key}};
   if(method==='paramStart'){
    const step=scalar(value,'step',Math.fround(.1),p,options,consumedPaths,numericPaths,diagnostics),min=scalar(value,'min',defaultsForModel.min,p,options,consumedPaths,numericPaths,diagnostics),max=scalar(value,'max',defaultsForModel.max,p,options,consumedPaths,numericPaths,diagnostics);
    operation.configuration={step,min,max,edgeEasing:Object.hasOwn(value,'edgeEasing')?edge(value.edgeEasing,defaults,[...p,'edgeEasing'],consumedPaths,numericPaths,diagnostics):{...defaults}};
   }
   if(!Object.keys(value).length)consumedPaths.push(p);configuration.push(operation);
  }
  return uniqueFacts(facts);
 });
}
/** The helper accepts absent payloads as an all operation. The source Scene
 * importer separately skips actions whose args are neither arrays nor objects. */
export function importSourceSymmetryParameterAction(method:'paramStart'|'paramStop',args:unknown,options:Omit<ImportOptions,'edgeDefaults'>):SourceRegistryParameterResult<ImportFacts<SourceSymmetryParameterOperation[]>> {
 return importParameterAction(method,args,options,SOURCE_SYMMETRY_PARAMETER_MODEL);
}
/** Map shares the Symmetry registry builder, except for its target domain.
 * Its outer source Scene likewise skips non-array/non-object args. */
export function importSourceMapParameterAction(method:'paramStart'|'paramStop',args:unknown,options:Omit<ImportOptions,'edgeDefaults'>):SourceRegistryParameterResult<ImportFacts<SourceMapParameterOperation[]>> {
 return importParameterAction(method,args,options,SOURCE_MAP_PARAMETER_MODEL);
}
export function importSourceSurfaceParameterAction(method:'paramStart'|'paramStop',args:unknown,options:ImportOptions):SourceRegistryParameterResult<ImportFacts<SourceSurfaceParameterAction[]>> {
 return importParameterAction(method,args,options,SOURCE_SURFACE_PARAMETER_MODEL);
}
export function importSourceSurfaceParameterClip(raw:unknown,options:ImportOptions):SourceRegistryParameterResult<ImportFacts<SourceSurfaceParameterClip>>{
 return attempt(()=>{
  const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[],configuration:SourceSurfaceParameterClip={model:SOURCE_SURFACE_PARAMETER_MODEL,parameters:[]};const facts={configuration,consumedPaths,numericPaths,diagnostics};
  if(raw===undefined)return uniqueFacts(facts);if(!object(raw))return fail('input',[],'独立源片段 parameters 必须为对象');
  for(const path of retainedNumbers(raw,[],true))numericPaths.push(path);
  if(!Object.keys(raw).length)consumedPaths.push([]);
  for(const key of ordered(raw,[],options)){
   const value=raw[key],p=[key];
   if(object(value)){
    const step=scalar(value,'step',Math.fround(.1),p,options,consumedPaths,numericPaths,diagnostics),min=scalar(value,'min',-100,p,options,consumedPaths,numericPaths,diagnostics),max=scalar(value,'max',100,p,options,consumedPaths,numericPaths,diagnostics),enable=enabled(value,p,consumedPaths,numericPaths);
    configuration.parameters.push({name:key,min,max,step,enabled:enable});if(!Object.keys(value).length)consumedPaths.push(p);
   }else{
    consumedPaths.push(p);numericPaths.push(p);let scalarValue=0;
    if(typeof value==='number')scalarValue=finite(Math.fround(value),p);
    else if(typeof value==='string'){const parsed=parseDomainSourceFloat(value);if(parsed.ok)scalarValue=finite(parsed.value,p);else if(parsed.error.kind==='capacity')return fail('capacity',p,'独立参数数值超过解析容量');}
    configuration.parameters.push({name:key,min:scalarValue,max:scalarValue,step:0,enabled:true});
   }
  }
  return uniqueFacts(facts);
 });
}
