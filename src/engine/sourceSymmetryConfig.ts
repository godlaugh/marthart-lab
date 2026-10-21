import {prepareSourceSnapshotMap,parseSourceSnapshotMap,type SourceSnapshotMap} from './sourceSnapshotMapOrder';
import {prepareRootsSourceMemberOrder} from './rootsSourceOrder';
import {sourceJavaMix64,sourceJavaStringHash} from './sourceJavaHash';
import type {SceneDocument} from '../types';
import type {SymmetryParameters} from '../scenes/iterated';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';

export const SOURCE_SYMMETRY_CONFIG='mathart-1.7.8-initialization-v1' as const;
export type SourceSymmetryEntry=readonly [string,number];
/** Construction facts are distinct from the mutable runtime parameter map.
 * Runtime animation/replay keeps these facts; an inspector edit rebuild replaces
 * them. Saving this local document retains the same simulation anchor. */
export interface SourceSymmetryConfiguration {
 model:typeof SOURCE_SYMMETRY_CONFIG;
 /** Parsed import route; the persisted-value parser migrates older documents. */
 entry:'project'|'runtime-config';
 editorMap?:SourceSnapshotMap;
 /** Original ProjectState values can differ from effective engine defaults. */
 editorParameters?:SourceSymmetryEntry[];
 construction:{batchSize:number;degree:number;parameters:SourceSymmetryEntry[]};
}
export type SourceSymmetryResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity';reason:string}};
const error=(reason:string,kind:'input'|'capacity'='input')=>({ok:false as const,error:{kind,reason}});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const standard:SourceSymmetryEntry[]=[['lambda',2],['alpha',-2.43],['beta',1],['gamma',.05],['omega',0],['symmetry_degree',3]];
export const sourceSymmetryDefaults=(template:string):SourceSymmetryEntry[]=>(template==='modified'?[...standard.slice(0,5),['delta',0],standard[5],['delta_power',1]]:standard).map(([k,v])=>[k,v] as SourceSymmetryEntry);
const integer=(value:number)=>Number.isNaN(value)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(value)));
export const sourceSymmetryDegree=(parameters:Readonly<Record<string,number>>)=>Object.hasOwn(parameters,'symmetry_degree')?Math.max(2,integer(parameters.symmetry_degree)):3;
function numeric(value:unknown):SourceSymmetryResult<number|undefined>{
 if(typeof value==='number')return{ok:true,value};
 if(typeof value==='string'){
  const parsed=parseDomainSourceDouble(value);if(parsed.ok)return{ok:true,value:parsed.value};
  if(parsed.error.kind==='capacity')return error('源 Symmetry 参数字符串超过解析容量','capacity');
  if(javaEqualsIgnoreCaseAscii(value,'true'))return{ok:true,value:1};
  if(javaEqualsIgnoreCaseAscii(value,'false'))return{ok:true,value:0};
 }
 if(typeof value==='boolean')return{ok:true,value:value?1:0};
 return{ok:true,value:undefined};
}
/** JsonSymmetryChaosConfig: an existing equation object suppresses the legacy
 * numeric modified flag. Unknown/case-varied template strings select standard. */
export function sourceSymmetryTemplate(equation:unknown,hasEquation:boolean,parameters:unknown):SourceSymmetryResult<'standard'|'modified'>{
 if(hasEquation){if(!record(equation))return error('源 Symmetry equation 需要对象');return{ok:true,value:equation.template==='modified'?'modified':'standard'};}
 const raw=record(parameters)?parameters.use_modified_equation:undefined;
 if(typeof raw==='number')return{ok:true,value:raw>.5?'modified':'standard'};
 if(typeof raw==='string'){const parsed=parseDomainSourceDouble(raw);if(parsed.ok)return{ok:true,value:parsed.value>.5?'modified':'standard'};if(parsed.error.kind==='capacity')return error('源 Symmetry 模板标记超过解析容量','capacity');}
 return{ok:true,value:'standard'};
}
/** JSONObject.getDouble(default), followed by the config field's float cast. */
export function sourceSymmetryFloat(raw:unknown,fallback:number):SourceSymmetryResult<number>{
 let value=Math.fround(fallback);
 if(typeof raw==='number')value=raw;
 else if(typeof raw==='string'){const parsed=parseDomainSourceDouble(raw);if(parsed.ok)value=parsed.value;else if(parsed.error.kind==='capacity')return error('源 Symmetry 初始盒文本超过解析容量','capacity');}
 value=Math.fround(value);return Number.isFinite(value)?{ok:true,value}:error('源 Symmetry 初始盒需要有限 float32 数值');
}
/** Caller supplies JSONObject/HashMap order from the existing source JSON owner.
 * No expression parser, alphabetical sorting or JS key-order reconstruction. */
export function importSourceSymmetryParameters(raw:unknown,order:readonly string[],template:string):SourceSymmetryResult<{parameters:Record<string,number>;ordered:SourceSymmetryEntry[]}>{
 const values=new Map<string,number>();
 if(record(raw)){
  if(order.length!==Object.keys(raw).length||new Set(order).size!==order.length||order.some(k=>!Object.hasOwn(raw,k)))return error('源 Symmetry 参数顺序与对象不匹配');
  for(const key of order){const parsed=numeric(raw[key]);if(!parsed.ok)return parsed;if(parsed.value!==undefined){if(!Number.isFinite(parsed.value))return error('源 Symmetry 非有限参数暂不能保存到本地项目');values.set(key,parsed.value);}}
 }
 if(!values.size)for(const [key,value]of sourceSymmetryDefaults(template))values.set(key,value);
 values.delete('use_modified_equation');
 if(values.has('delta_power'))values.set('delta_power',Math.max(1,integer(Math.floor(Math.fround(values.get('delta_power')!)+.5))));
 if(template==='modified'){if(!values.has('delta'))values.set('delta',0);if(!values.has('delta_power'))values.set('delta_power',1);}
 const ordered=[...values];return{ok:true,value:{parameters:Object.fromEntries(ordered),ordered}};
}
/** File loading in MathArtSession uses ProjectState.fromJson -> toJson.
 * Its parameter reader accepts only Java Double values; failed conversions
 * become zero, and reset clears all previous parameters before import. */
export function importSourceSymmetryProjectParameters(raw:unknown,order:readonly string[],template:string):SourceSymmetryResult<{parameters:Record<string,number>;ordered:SourceSymmetryEntry[];editorMap:SourceSnapshotMap;editorParameters:SourceSymmetryEntry[]}>{
 const editorParameters:SourceSymmetryEntry[]=[];
 if(raw!==undefined&&!record(raw))return error('源 Symmetry 项目参数需要对象');
 if(record(raw)){
  if(order.length!==Object.keys(raw).length||new Set(order).size!==order.length||order.some(k=>!Object.hasOwn(raw,k)))return error('源 Symmetry 项目参数顺序与对象不匹配');
  for(const key of order){const item=raw[key];let value=0;
   if(typeof item==='number')value=item;
   else if(typeof item==='string'){const parsed=parseDomainSourceDouble(item);if(parsed.ok)value=parsed.value;else if(parsed.error.kind==='capacity')return error('源 Symmetry 参数字符串超过解析容量','capacity');}
   if(!Number.isFinite(value))return error('源 Symmetry 非有限编辑参数暂不能保存到本地项目');editorParameters.push([key,value]);
  }
 }
 const editor=prepareSourceSnapshotMap(editorParameters.map(([key])=>key));if(!editor.ok)return error(editor.error.reason,editor.error.kind);
 const json=prepareRootsSourceMemberOrder(editor.keys);if(!json.ok)return error('源 Symmetry 项目 JSON 参数顺序失败');
 const runtime=importSourceSymmetryParameters(Object.fromEntries(editorParameters),json.value.keys,template);if(!runtime.ok)return runtime;
 return{ok:true,value:{...runtime.value,editorMap:editor.state,editorParameters}};
}
export function createSourceSymmetryConfiguration(batchSize:number,ordered:readonly SourceSymmetryEntry[],editorMap?:SourceSnapshotMap,editorParameters?:readonly SourceSymmetryEntry[],entry:'project'|'runtime-config'=editorParameters===undefined?'runtime-config':'project'):SourceSymmetryResult<SourceSymmetryConfiguration>{
 return parseSourceSymmetryConfiguration({model:SOURCE_SYMMETRY_CONFIG,entry,...(editorMap?{editorMap}:{}),...(editorParameters?{editorParameters}:{}),construction:{batchSize,degree:sourceSymmetryDegree(Object.fromEntries(ordered)),parameters:ordered}});
}
function readEntries(raw:unknown,label:string):SourceSymmetryResult<SourceSymmetryEntry[]>{
 if(!Array.isArray(raw)||raw.length>65536)return error(`源 Symmetry ${label}参数超过本地容量`,'capacity');
 const seen=new Set<string>(),entries:SourceSymmetryEntry[]=[];let characters=0;
 for(const row of raw){
  if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||typeof row[1]!=='number'||!Number.isFinite(row[1])||seen.has(row[0]))return error(`源 Symmetry ${label}参数无效或重复`);
  if((characters+=row[0].length)>8*1024*1024)return error(`源 Symmetry ${label}参数名超过本地容量`,'capacity');seen.add(row[0]);entries.push([row[0],row[1]]);
 }
 return{ok:true,value:entries};
}
export function parseSourceSymmetryConfiguration(raw:unknown):SourceSymmetryResult<SourceSymmetryConfiguration>{
 if(!record(raw)||raw.model!==SOURCE_SYMMETRY_CONFIG||!record(raw.construction))return error('源 Symmetry 构造配置无效');
 const entry=raw.entry??(raw.editorParameters===undefined?'runtime-config':'project');if(entry!=='project'&&entry!=='runtime-config')return error('源 Symmetry 配置入口无效');
 const c=raw.construction;if(!Number.isInteger(c.batchSize)||Number(c.batchSize)<1||Number(c.batchSize)>8000000)return error('源 Symmetry 粒子数超过本地 1–8000000 容量');
 const construction=readEntries(c.parameters,'构造');if(!construction.ok)return construction;const entries=construction.value;
 const degree=sourceSymmetryDegree(Object.fromEntries(entries));if(c.degree!==degree)return error('源 Symmetry 构造阶数与参数不一致');
 let editorParameters:SourceSymmetryEntry[]|undefined;
 if(raw.editorParameters!==undefined){const editor=readEntries(raw.editorParameters,'编辑');if(!editor.ok)return editor;editorParameters=editor.value;}
 const keys=(editorParameters??entries).map(([key])=>key),editorNames=new Set(keys);
 const editor=raw.editorMap===undefined?prepareSourceSnapshotMap(keys):parseSourceSnapshotMap(raw.editorMap);if(!editor.ok)return error(editor.error.reason,editor.error.kind);
 if(editor.keys.length!==keys.length||editor.keys.some(key=>!editorNames.has(key)))return error('源 Symmetry 编辑参数树与编辑参数不匹配');
 return{ok:true,value:{model:SOURCE_SYMMETRY_CONFIG,entry,editorMap:editor.state,...(editorParameters?{editorParameters}:{}),construction:{batchSize:c.batchSize as number,degree,parameters:entries}}};
}
export function usesSourceSymmetryConfiguration(scene:Pick<SceneDocument,'kind'|'symmetrySource'>):boolean {
 if(scene.symmetrySource===undefined)return false;
 if(scene.kind!=='symmetry'||scene.symmetrySource.model!==SOURCE_SYMMETRY_CONFIG)throw Error('未知源 Symmetry 构造配置');
 return true;
}
export function usesSourceSymmetryProject(scene:Pick<SceneDocument,'kind'|'symmetrySource'>):boolean{return usesSourceSymmetryConfiguration(scene)&&scene.symmetrySource!.entry==='project';}
const mix=(seed:bigint,value:bigint)=>sourceJavaMix64(seed^value);
export function sourceSymmetryInitialSeed(configuration:SourceSymmetryConfiguration):string {
 const c=configuration.construction;let seed=mix(mix(-7046029254386353131n,BigInt(c.batchSize)),BigInt(c.degree));
 const bits=new DataView(new ArrayBuffer(8));
 for(const [key,value]of c.parameters){const hash=sourceJavaStringHash(key);bits.setFloat64(0,value);seed=mix(mix(seed,BigInt(hash)),bits.getBigInt64(0));}
 return String(seed);
}
/** Native missing/nonfinite/overflow uniforms are zero; degree is intentionally
 * not replaced by the constructor's truncation or the shader's round/clamp. */
export function sourceSymmetryFieldParameters(scene:SceneDocument):SymmetryParameters {
 const p=scene.parameters,f=(key:string)=>{const value=Object.hasOwn(p,key)?Math.fround(p[key]):0;return Number.isFinite(value)?value:0;};
 if(scene.settings.template!=='standard'&&scene.settings.template!=='modified')throw Error('未知源 Symmetry 模板');
 return{lambda:f('lambda'),alpha:f('alpha'),beta:f('beta'),gamma:f('gamma'),omega:f('omega'),delta:f('delta'),n:f('symmetry_degree'),deltaPower:f('delta_power'),template:scene.settings.template};
}
export function editSourceSymmetryConfiguration(before:SceneDocument,next:SceneDocument,intent:'edit'|'apply'|'parameters'='edit'):SceneDocument {
 if(!usesSourceSymmetryConfiguration(next))return next;
 if(intent==='apply'&&next.symmetrySource!.editorParameters===undefined)throw Error('源 Symmetry 缺少编辑参数来源，请重新导入项目后应用');
 let parameters=next.parameters;
 for(const [setting,key]of [['degree','symmetry_degree'],['deltaPower','delta_power']])if(next.settings[setting]!==before.settings[setting])parameters={...parameters,[key]:Number(next.settings[setting])};
 next={...next,parameters};
 const onlyParameters=JSON.stringify({...before,parameters:null,iteratedDraft:undefined})===JSON.stringify({...next,parameters:null,iteratedDraft:undefined});
 if(intent==='parameters'){
  if(Object.keys(before.parameters).some(k=>!Object.hasOwn(parameters,k)))throw Error('源 Symmetry 参数热写入不能删除名字，请完整应用');
  if(!onlyParameters)throw Error('源 Symmetry 参数热写入不能同时修改构造字段');
  const changed=Object.entries(parameters).filter(([k,v])=>!Object.hasOwn(before.parameters,k)||!Object.is(before.parameters[k],v));
  if(changed.some(([k])=>next.settings.template==='modified'&&k==='delta_power'))throw Error('修改版 delta_power 是结构参数，请完整应用');
  if(!changed.length)return next;
  const anchor=next.symmetrySource!,runtime=new Map(anchor.construction.parameters),values=anchor.editorParameters?new Map(anchor.editorParameters):undefined;
  for(const [k,v]of changed){if(!Number.isFinite(v))throw Error('源 Symmetry 参数需要有限数值');runtime.set(k,v);values?.set(k,v);}
  const tree=prepareSourceSnapshotMap([...(values??runtime).keys()],anchor.editorMap);if(!tree.ok)throw Error(tree.error.reason);
  const parsed=parseSourceSymmetryConfiguration({...anchor,construction:{...anchor.construction,degree:sourceSymmetryDegree(parameters),parameters:[...runtime]},editorMap:tree.state,...(values?{editorParameters:[...values]}:{})});if(!parsed.ok)throw Error(parsed.error.reason);
  return{...next,parameters,settings:{...next.settings,degree:sourceSymmetryDegree(parameters),deltaPower:parameters.delta_power??1},symmetrySource:parsed.value};
 }
 const structural=['batchSize','degree','deltaPower','initialMode','initialRange','initialXMin','initialXMax','initialYMin','initialYMax','template'];
 const changed=structural.some(key=>!Object.is(before.settings[key],next.settings[key]))||before.equations.glsl!==next.equations.glsl||Object.keys(before.parameters).length!==Object.keys(parameters).length||Object.entries(parameters).some(([key,value])=>!Object.hasOwn(before.parameters,key)||!Object.is(value,before.parameters[key]));
 next={...next,settings:{...next.settings,degree:sourceSymmetryDegree(parameters),deltaPower:parameters.delta_power??1}};
 if(intent!=='apply'&&!changed)return next;
 const anchor=next.symmetrySource!,previous=anchor.editorMap===undefined?prepareSourceSnapshotMap((anchor.editorParameters??anchor.construction.parameters).map(([key])=>key)):parseSourceSnapshotMap(anchor.editorMap);if(!previous.ok)throw Error(previous.error.reason);
 // Patch explicit user changes into the ProjectState map. Engine-injected
 // defaults and rounded values are not authored editor entries.
 const values=new Map<string,number>(anchor.editorParameters??Object.entries(next.parameters));
 if(anchor.editorParameters){
  for(const key of Object.keys(before.parameters))if(!Object.hasOwn(parameters,key))values.delete(key);
  for(const [key,value]of Object.entries(parameters))if(!Object.hasOwn(before.parameters,key)||!Object.is(value,before.parameters[key]))values.set(key,value);
 }
 const editor=prepareSourceSnapshotMap([...values.keys()],previous.state);if(!editor.ok)throw Error(editor.error.reason);
 const json=prepareRootsSourceMemberOrder(editor.keys);if(!json.ok)throw Error('源 Symmetry 重建 JSON 参数顺序失败：'+JSON.stringify(json.error));
 const parsed=importSourceSymmetryParameters(Object.fromEntries(values),json.value.keys,String(next.settings.template));if(!parsed.ok)throw Error(parsed.error.reason);
 const retained=anchor.editorParameters?editor:prepareSourceSnapshotMap(parsed.value.ordered.map(([key])=>key),editor.state);if(!retained.ok)throw Error(retained.error.reason);
 const created=createSourceSymmetryConfiguration(Number(next.settings.batchSize),parsed.value.ordered,retained.state,anchor.editorParameters?[...values]:undefined,anchor.entry);if(!created.ok)throw Error(created.error.reason);
 return{...next,parameters:parsed.value.parameters,settings:{...next.settings,degree:created.value.construction.degree,deltaPower:parsed.value.parameters.delta_power??1},symmetrySource:created.value};
}
