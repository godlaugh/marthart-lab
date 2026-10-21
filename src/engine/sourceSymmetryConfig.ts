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
 editorMap?:SourceSnapshotMap;
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
export function createSourceSymmetryConfiguration(batchSize:number,ordered:readonly SourceSymmetryEntry[],editorMap?:SourceSnapshotMap):SourceSymmetryResult<SourceSymmetryConfiguration>{
 return parseSourceSymmetryConfiguration({model:SOURCE_SYMMETRY_CONFIG,...(editorMap?{editorMap}:{}),construction:{batchSize,degree:sourceSymmetryDegree(Object.fromEntries(ordered)),parameters:ordered}});
}
export function parseSourceSymmetryConfiguration(raw:unknown):SourceSymmetryResult<SourceSymmetryConfiguration>{
 if(!record(raw)||raw.model!==SOURCE_SYMMETRY_CONFIG||!record(raw.construction))return error('源 Symmetry 构造配置无效');
 const c=raw.construction;if(!Number.isInteger(c.batchSize)||Number(c.batchSize)<1||Number(c.batchSize)>8000000)return error('源 Symmetry 粒子数超过本地 1–8000000 容量');
 if(!Array.isArray(c.parameters)||c.parameters.length>65536)return error('源 Symmetry 构造参数超过本地容量','capacity');
 const seen=new Set<string>(),entries:SourceSymmetryEntry[]=[];let characters=0;
 for(const row of c.parameters){
  if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||typeof row[1]!=='number'||!Number.isFinite(row[1])||seen.has(row[0]))return error('源 Symmetry 构造参数无效或重复');
  if((characters+=row[0].length)>8*1024*1024)return error('源 Symmetry 构造参数名超过本地容量','capacity');
  seen.add(row[0]);entries.push([row[0],row[1]]);
 }
 const degree=sourceSymmetryDegree(Object.fromEntries(entries));if(c.degree!==degree)return error('源 Symmetry 构造阶数与参数不一致');
 const keys=entries.map(([key])=>key);
 const editor=raw.editorMap===undefined?prepareSourceSnapshotMap(keys):parseSourceSnapshotMap(raw.editorMap);if(!editor.ok)return error(editor.error.reason,editor.error.kind);
 if(editor.keys.length!==keys.length||editor.keys.some(key=>!seen.has(key)))return error('源 Symmetry 编辑参数树与构造参数不匹配');
 return{ok:true,value:{model:SOURCE_SYMMETRY_CONFIG,editorMap:editor.state,construction:{batchSize:c.batchSize as number,degree,parameters:entries}}};
}
export function usesSourceSymmetryConfiguration(scene:Pick<SceneDocument,'kind'|'symmetrySource'>):boolean {
 if(scene.symmetrySource===undefined)return false;
 if(scene.kind!=='symmetry'||scene.symmetrySource.model!==SOURCE_SYMMETRY_CONFIG)throw Error('未知源 Symmetry 构造配置');
 return true;
}
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
export function editSourceSymmetryConfiguration(before:SceneDocument,next:SceneDocument):SceneDocument {
 if(!usesSourceSymmetryConfiguration(next))return next;
 let parameters=next.parameters;
 for(const [setting,key]of [['degree','symmetry_degree'],['deltaPower','delta_power']])if(next.settings[setting]!==before.settings[setting])parameters={...parameters,[key]:Number(next.settings[setting])};
 next={...next,parameters};
 const structural=['batchSize','degree','deltaPower','initialMode','initialRange','initialXMin','initialXMax','initialYMin','initialYMax','template'];
 const changed=structural.some(key=>!Object.is(before.settings[key],next.settings[key]))||before.equations.glsl!==next.equations.glsl||Object.keys(before.parameters).length!==Object.keys(parameters).length||Object.entries(parameters).some(([key,value])=>!Object.hasOwn(before.parameters,key)||!Object.is(value,before.parameters[key]));
 next={...next,settings:{...next.settings,degree:sourceSymmetryDegree(parameters),deltaPower:parameters.delta_power??1}};
 if(!changed)return next;
 const anchor=next.symmetrySource!,previous=anchor.editorMap===undefined?prepareSourceSnapshotMap(anchor.construction.parameters.map(([key])=>key)):parseSourceSnapshotMap(anchor.editorMap);if(!previous.ok)throw Error(previous.error.reason);
 const editor=prepareSourceSnapshotMap(Object.keys(next.parameters),previous.state);if(!editor.ok)throw Error(editor.error.reason);
 const json=prepareRootsSourceMemberOrder(editor.keys);if(!json.ok)throw Error('源 Symmetry 重建 JSON 参数顺序失败：'+JSON.stringify(json.error));
 const parsed=importSourceSymmetryParameters(next.parameters,json.value.keys,String(next.settings.template));if(!parsed.ok)throw Error(parsed.error.reason);
 const retained=prepareSourceSnapshotMap(parsed.value.ordered.map(([key])=>key),editor.state);if(!retained.ok)throw Error(retained.error.reason);
 const created=createSourceSymmetryConfiguration(Number(next.settings.batchSize),parsed.value.ordered,retained.state);if(!created.ok)throw Error(created.error.reason);
 return{...next,parameters:parsed.value.parameters,settings:{...next.settings,degree:created.value.construction.degree,deltaPower:parsed.value.parameters.delta_power??1},symmetrySource:created.value};
}
