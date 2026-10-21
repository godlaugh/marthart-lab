import {parseDomainSourceDouble,parseDomainSourceFloat,prepareDomainSourceScalar} from './domainSourceScalar';
import {prepareRootsSourceJsonInt,prepareRootsSourceJsonString,prepareRootsSourceMemberOrder,ROOTS_SOURCE_ORDER_LIMITS} from './rootsSourceOrder';
import {parseSourceSnapshotMap,prepareSourceSnapshotMap,type SourceSnapshotMap} from './sourceSnapshotMapOrder';
import {isJavaWhitespace} from './sourceJavaText';
import {sourceNumberTokenValid} from './sourceNumberTokens';
import {prepareSourceMapExpressions} from './sourceMapMath';

export const SOURCE_MAP_CONFIG='mathart-1.7.8-initialization-v1' as const;
export type SourceMapEntry=readonly [string,number];
export type SourceMapEntryPath='project'|'runtime-config';
export interface SourceMapConstruction {
 batchSize:number;dimension:2|3;equations:{x:string;y:string;z:string};parameters:SourceMapEntry[];
 initial:{xMin:number;xMax:number;yMin:number;yMax:number};burnIn:number;iterations:number;
}
export interface SourceMapConfiguration {
 model:typeof SOURCE_MAP_CONFIG;entry:SourceMapEntryPath;settingsPresence:'absent'|'object';
 construction:SourceMapConstruction;editorMap?:SourceSnapshotMap;editorParameters?:SourceMapEntry[];editorEquations?:SourceMapConstruction['equations'];
}
export type SourceMapError={kind:'input'|'capacity'|'nonfinite';path:readonly string[];reason:string};
export type SourceMapResult<T>={ok:true;value:T}|{ok:false;error:SourceMapError};
export interface SourceMapImportOptions {
 entry?:SourceMapEntryPath;numberToken?:(path:readonly string[])=>string|undefined;
 /** Already interpreted JSONObject/HashMap order, e.g. Reader.sourceKeys. */
 memberKeys?:(path:readonly string[])=>readonly string[]|undefined;
}
export interface SourceMapImportFacts {configuration:SourceMapConfiguration;parameters:Record<string,number>;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
export interface SourceMapEditState {parameters:Readonly<Record<string,number>>;equations:{x:string;y:string;z?:string};batchSize:number;dimension:number;initial:SourceMapConstruction['initial'];burnIn:number;iterations:number;}
class Failure extends Error {constructor(readonly detail:SourceMapError){super(detail.reason);}}
function fail(kind:SourceMapError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceMapResult<T>{try{return{ok:true,value:run()};}catch(e){if(e instanceof Failure)return{ok:false,error:e.detail};throw e;}}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const F=Math.fround;
const DEFAULT_EQUATIONS={x:'sin(a*y) + c*cos(a*x)',y:'sin(b*x) + d*cos(b*y)',z:''};
const DEFAULT_PARAMETERS:SourceMapEntry[]=[['a',-1.7],['b',1.8],['c',1.6],['d',.9]];
const DEFAULT_3D={x:'p0 + y - y*z',y:'p1 + z - x*z',z:'p2 + x - x*y'};
function base():SourceMapConstruction{return{batchSize:262144,dimension:2,equations:{...DEFAULT_EQUATIONS},parameters:DEFAULT_PARAMETERS.map(([k,v])=>[k,v]),initial:{xMin:-1,xMax:1,yMin:-1,yMax:1},burnIn:100,iterations:1};}
/** Kotlin Char.isWhitespace includes Java space characters, unlike String.trim. */
function projectTrim(text:string):string{const blank=(c:string)=>isJavaWhitespace(c)||c==='\u00a0'||c==='\u2007'||c==='\u202f';let a=0,b=text.length;while(a<b&&blank(text[a]))a++;while(b>a&&blank(text[b-1]))b--;return text.slice(a,b);}
function finite(value:number,path:readonly string[],float=false):number{if(!Number.isFinite(value)||float&&!Number.isFinite(F(value)))fail('nonfinite',path,'源 Map 非有限数值不能保存到本地项目');return float?F(value):value;}
function unwrap<T>(result:{ok:true;value:T}|{ok:false;error:{kind:string}},path:readonly string[]):T{if(!result.ok)fail(result.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(result.error));return result.value;}
function pairs(raw:unknown,path:readonly string[]):SourceMapEntry[]{
 if(!Array.isArray(raw))return fail('input',path,'源 Map 有序参数必须是数组');
 if(raw.length>ROOTS_SOURCE_ORDER_LIMITS.members)return fail('capacity',path,'源 Map 参数超过本地成员容量');
 const names=new Set<string>();let characters=0;return raw.map((r,i)=>{
  if(!Array.isArray(r)||r.length!==2||typeof r[0]!=='string'||typeof r[1]!=='number'||names.has(r[0]))return fail('input',[...path,String(i)],'源 Map 参数无效或重复');
  names.add(r[0]);characters+=r[0].length;if(characters>ROOTS_SOURCE_ORDER_LIMITS.characters)fail('capacity',path,'源 Map 参数名超过本地文本容量');return[r[0],finite(r[1],[...path,r[0]])];
 });
}
function completeDimension(c:SourceMapConstruction){
 if(c.dimension===2){if(c.equations.z==='')c.equations.z='0.0';return;}
 if(!c.parameters.some(([k])=>['p0','p1','p2'].includes(k)))c.parameters.push(['p0',.9],['p1',1.2],['p2',.7]);
 for(const axis of ['x','y','z'] as const)if(c.equations[axis]==='')c.equations[axis]=DEFAULT_3D[axis];
}
function normalizeBounds(initial:SourceMapConstruction['initial']){
 // Mobject.<init> PC677–748 uses Math.min/max after config's > swap.
 for(const axis of ['x','y'] as const){const lo=initial[`${axis}Min`],hi=initial[`${axis}Max`];initial[`${axis}Min`]=Math.min(lo,hi);initial[`${axis}Max`]=Math.max(lo,hi);}
}
function snapshot(keys:readonly string[],previous?:SourceSnapshotMap){const r=prepareSourceSnapshotMap(keys,previous);if(!r.ok)fail(r.error.kind,['editorMap'],r.error.reason);return r;}
function jsonOrder(keys:readonly string[]){return unwrap(prepareRootsSourceMemberOrder(keys),['parameters']).keys;}
function compile(c:SourceMapConstruction){try{prepareSourceMapExpressions(c.equations,c.parameters.map(([k])=>k),c.dimension);}catch(e){fail(e instanceof Error&&e.message.includes('容量')?'capacity':'input',['equations'],e instanceof Error?e.message:String(e));}}
/** Saved facts are validated, never defaulted, normalized or reordered. */
export function parseSourceMapConfiguration(raw:unknown):SourceMapResult<SourceMapConfiguration>{return attempt(()=>{
 if(!record(raw)||raw.model!==SOURCE_MAP_CONFIG||!['project','runtime-config'].includes(String(raw.entry))||!['absent','object'].includes(String(raw.settingsPresence))||!record(raw.construction))fail('input',[],'源 Map 构造配置无效');
 const c=raw.construction;
 for(const [name,min,max]of [['batchSize',1,8000000],['burnIn',0,100000],['iterations',1,2147483647]] as const){const n=c[name];if(typeof n!=='number'||!Number.isInteger(n)||n<min)fail('input',['construction',name],'源 Map 构造整数无效');if(n>max)fail('capacity',['construction',name],`源 Map ${name} 超过本地 ${max} 容量（不是源格式限制）`);}
 if(c.dimension!==2&&c.dimension!==3)fail('input',['construction','dimension'],'源 Map 构造维度无效');
 if(!record(c.equations)||!record(c.initial))fail('input',['construction'],'源 Map 公式或初始范围无效');
 const equations={} as SourceMapConstruction['equations'],initial={} as SourceMapConstruction['initial'];
 for(const axis of ['x','y','z'] as const){const text=c.equations[axis];if(typeof text!=='string')fail('input',['construction','equations',axis],'源 Map 公式必须是文本');if(text.length>8192)fail('capacity',['construction','equations',axis],'源 Map 公式超过本地8192字符容量');equations[axis]=text;}
 for(const k of ['xMin','xMax','yMin','yMax'] as const){const n=c.initial[k];if(typeof n!=='number'||!Object.is(n,F(n)))fail('input',['construction','initial',k],'源 Map 初始范围必须为已解析Float32');initial[k]=finite(n,['construction','initial',k],true);}
 if(!Object.is(initial.xMin,Math.min(initial.xMin,initial.xMax))||!Object.is(initial.xMax,Math.max(initial.xMin,initial.xMax))||!Object.is(initial.yMin,Math.min(initial.yMin,initial.yMax))||!Object.is(initial.yMax,Math.max(initial.yMin,initial.yMax)))fail('input',['construction','initial'],'保存的源 Map 范围未归一');
 const parameters=pairs(c.parameters,['construction','parameters']);
 let editorParameters:SourceMapEntry[]|undefined,editorMap:SourceSnapshotMap|undefined;
 if(raw.editorParameters!==undefined)editorParameters=pairs(raw.editorParameters,['editorParameters']);
 if(raw.editorMap!==undefined){const r=parseSourceSnapshotMap(raw.editorMap);if(!r.ok)fail(r.error.kind,['editorMap'],r.error.reason);editorMap=r.state;const keys=(editorParameters??parameters).map(([k])=>k),set=new Set(keys);if(r.keys.length!==keys.length||r.keys.some(k=>!set.has(k)))fail('input',['editorMap'],'源 Map 编辑树与编辑参数不一致');}
 let editorEquations:SourceMapConstruction['equations']|undefined;
 if(raw.editorEquations!==undefined){if(!record(raw.editorEquations))fail('input',['editorEquations'],'源 Map 编辑公式无效');editorEquations={x:'',y:'',z:''};for(const axis of ['x','y','z'] as const){const text=raw.editorEquations[axis];if(typeof text!=='string')fail('input',['editorEquations',axis],'源 Map 编辑公式必须是文本');if(text.length>8192)fail('capacity',['editorEquations',axis],'源 Map 编辑公式超过本地8192字符容量');editorEquations[axis]=text;}}
 if(raw.entry==='project'&&(!editorParameters||!editorMap||!editorEquations))fail('input',['editorMap'],'源 Map 项目构造缺少编辑参数及树');
 return{model:SOURCE_MAP_CONFIG,entry:raw.entry as SourceMapEntryPath,settingsPresence:raw.settingsPresence as 'absent'|'object',construction:{batchSize:c.batchSize as number,dimension:c.dimension,equations,parameters,initial,burnIn:c.burnIn as number,iterations:c.iterations as number},...(editorMap?{editorMap}:{}),...(editorParameters?{editorParameters}:{}),...(editorEquations?{editorEquations}:{})};
});}
export function createSourceMapConfiguration(construction:SourceMapConstruction,options:{entry?:SourceMapEntryPath;settingsPresence?:'absent'|'object';editorMap?:SourceSnapshotMap;editorParameters?:readonly SourceMapEntry[];editorEquations?:SourceMapConstruction['equations']}={}):SourceMapResult<SourceMapConfiguration>{return parseSourceMapConfiguration({model:SOURCE_MAP_CONFIG,entry:options.entry??'runtime-config',settingsPresence:options.settingsPresence??'object',construction,...(options.editorMap?{editorMap:options.editorMap}:{}),...(options.editorParameters?{editorParameters:options.editorParameters}:{}),...(options.editorEquations?{editorEquations:options.editorEquations}:{})});}
/** Constructor scope only. Visual settings, camera, palette and timeline have
 * separate owners. Native no-settings early return leaves the private generated
 * GLSL null, but its getter falls back to Base's fixed Clifford shader. */
export function importSourceMapConfiguration(document:unknown,options:SourceMapImportOptions={}):SourceMapResult<SourceMapImportFacts>{return attempt(()=>{
 if(!record(document))fail('input',[],'源 Map 文档需要对象');const entry=options.entry??'project';if(entry!=='project'&&entry!=='runtime-config')fail('input',[],'未知源 Map 入口');
 const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[],c=base();
 const read=(o:Record<string,unknown>,key:string,parent:string[])=>{if(Object.hasOwn(o,key)){const path=[...parent,key];consumedPaths.push(path);if(typeof o[key]==='number')numericPaths.push(path);}return o[key];};
 const section=(value:unknown,path:string[])=>{if(value===undefined)return undefined;if(!record(value))fail('input',path,'源 Map 配置节需要对象');if(!Object.keys(value).length)consumedPaths.push(path);return value;};
 const settings=section(document.settings,['settings']);
 if(entry==='runtime-config'&&!settings){const configuration=unwrap(createSourceMapConfiguration(c,{entry,settingsPresence:'absent'}),[]);diagnostics.push('原 JsonMapAttractorConfig 无 settings 时提前返回，equations/parameters 不参与构造；GLSL getter 使用 Base 固定 Clifford 函数。');return{configuration,parameters:Object.fromEntries(c.parameters),consumedPaths,numericPaths,diagnostics};}
 const int=(key:string,fallback:number)=>{const value=settings?read(settings,key,['settings']):undefined;return unwrap(prepareRootsSourceJsonInt(value,fallback,options.numberToken?.(['settings',key])),['settings',key]).value;};
 c.batchSize=Math.max(1,int('batch_size',262144));c.burnIn=Math.max(0,int('burn_in_steps',100));c.iterations=Math.max(1,int('iterations_per_frame',1));
 const d=int('dimension',2);c.dimension=entry==='project'?Math.min(3,Math.max(2,d)) as 2|3:d===3?3:2;
 for(const [old,key,fallback]of [['x0_min','xMin',-1],['x0_max','xMax',1],['y0_min','yMin',-1],['y0_max','yMax',1]] as const){
  const value=settings?read(settings,old,['settings']):undefined,path=['settings',old];let v=F(fallback);
  if(value!==undefined&&value!==null){
   if(entry==='project'){
    if(typeof value==='number')v=F(value);else if(typeof value==='string'){const p=parseDomainSourceFloat(value);if(p.ok)v=p.value;else if(p.error.kind==='capacity')fail('capacity',path,JSON.stringify(p.error));}
   }else{const parsed=prepareDomainSourceScalar(value,{fallback:0,precision:'float32'});if(!parsed.ok)fail('capacity',path,JSON.stringify(parsed.error));v=parsed.facts.value;}
  }
  c.initial[key]=finite(v,path,true);
 }
 normalizeBounds(c.initial);
 const equations=section(document.equations,['equations']);if(equations)for(const axis of ['x','y','z'] as const){const key=axis+'_next',value=read(equations,key,['equations']),r=unwrap(prepareRootsSourceJsonString(value,c.equations[axis],options.numberToken?.(['equations',key])),['equations',key]);if(r.status==='unknown')fail('input',['equations',key],`原公式字符串不可确定：${r.reason}`);c.equations[axis]=entry==='project'?projectTrim(r.value):r.value;}
 const parameters=section(document.parameters,['parameters']);let editorMap:SourceSnapshotMap|undefined,editorParameters:SourceMapEntry[]|undefined;
 if(parameters||entry==='project'){
  const order=options.memberKeys?.(['parameters'])??jsonOrder(Object.keys(parameters??{})),keys=Object.keys(parameters??{}),set=new Set(order);
  if(order.length!==keys.length||set.size!==keys.length||keys.some(k=>!set.has(k)))fail('input',['parameters'],'源 Map 参数顺序与对象不匹配');
  if(order.length>ROOTS_SOURCE_ORDER_LIMITS.members||order.reduce((n,k)=>n+k.length,0)>ROOTS_SOURCE_ORDER_LIMITS.characters)fail('capacity',['parameters'],'源 Map 参数顺序超过本地容量');
  const rows:SourceMapEntry[]=[];
  for(const key of order){const value=read(parameters!,key,['parameters']),path=['parameters',key];let n:number|undefined;
   if(typeof value==='number'){const token=options.numberToken?.(path);if(token!==undefined&&(!sourceNumberTokenValid(token)||!Object.is(Number(token),value)))fail('input',path,'源 Map 数字token与值不匹配');n=value;}
   else if(typeof value==='string'){const p=parseDomainSourceDouble(value);if(p.ok)n=p.value;else if(p.error.kind==='capacity')fail('capacity',path,JSON.stringify(p.error));}
   if(n===undefined){if(entry==='runtime-config')fail('input',path,'原 JSONObject.getDouble 无法读取参数');n=0;diagnostics.push(`${path.join('.')}: 项目参数读取失败，原版使用0；原值留在source。`);}
   rows.push([key,finite(n,path)]);
  }
  editorParameters=rows;const state=snapshot(rows.map(([k])=>k));editorMap=state.state;
  if(entry==='project'){const values=new Map(rows);c.parameters=jsonOrder(state.keys).map(k=>[k,values.get(k)!]);}else c.parameters=rows.map(([k,v])=>[k,v]);
 }
 // Keep editor facts even for direct runtime imports: missing parameters are
 // different from defaults injected by the constructor.
 if(editorParameters===undefined){editorParameters=[];editorMap=snapshot([]).state;}
 const editorEquations={...c.equations};
 completeDimension(c);compile(c);
 const configuration=unwrap(createSourceMapConfiguration(c,{entry,settingsPresence:settings?'object':'absent',editorMap,editorParameters,editorEquations}),[]);
 return{configuration,parameters:Object.fromEntries(c.parameters),consumedPaths,numericPaths,diagnostics};
});}
/** Inspector field edits normalize changed construction values; explicit Apply
 * always exports the ProjectState, including equal-value/camera-only actions.
 * Runtime timeline evaluation must keep the old
 * construction anchor. Unchanged engine-injected parameters never become new
 * ProjectState authoring entries merely because a setting was edited. */
export function editSourceMapConfiguration(anchor:SourceMapConfiguration,before:SourceMapEditState,next:SourceMapEditState,intent:'edit'|'apply'|'parameters'='edit'):SourceMapResult<{configuration:SourceMapConfiguration;parameters:Record<string,number>}>{return attempt(()=>{
 const valid=unwrap(parseSourceMapConfiguration(anchor),[]);
 if(intent==='apply'&&valid.editorParameters===undefined)fail('input',['editorParameters'],'源 Map 缺少编辑参数来源，请重新导入项目后应用');
 const sameKeys=Object.keys(before.parameters).length===Object.keys(next.parameters).length&&Object.keys(before.parameters).every(k=>Object.hasOwn(next.parameters,k));
 const onlyValues=sameKeys&&Object.keys(next.parameters).some(k=>!Object.is(before.parameters[k],next.parameters[k]))&&JSON.stringify({...before,parameters:null})===JSON.stringify({...next,parameters:null});
 if(intent==='parameters'&&onlyValues){
  const patch=(entries:SourceMapEntry[])=>entries.map(([k,v])=>[k,Object.hasOwn(next.parameters,k)&&!Object.is(before.parameters[k],next.parameters[k])?finite(next.parameters[k],['parameters',k]):v] as SourceMapEntry);
  const editor=valid.editorParameters?new Map(patch(valid.editorParameters)):undefined;
  if(editor)for(const [k,v]of Object.entries(next.parameters))if(!Object.is(before.parameters[k],v))editor.set(k,finite(v,['parameters',k]));
  const editorState=editor?snapshot([...editor.keys()],valid.editorMap):undefined;
  return{configuration:{...valid,construction:{...valid.construction,parameters:patch(valid.construction.parameters)},...(editor?{editorParameters:[...editor],editorMap:editorState!.state}:{})},parameters:{...next.parameters}};
 }
 const constructionChanged=before.batchSize!==next.batchSize||before.dimension!==next.dimension||before.burnIn!==next.burnIn||(['x','y','z'] as const).some(a=>before.equations[a]!==next.equations[a])||(['xMin','xMax','yMin','yMax'] as const).some(k=>!Object.is(before.initial[k],next.initial[k]))||Object.keys(before.parameters).length!==Object.keys(next.parameters).length||Object.entries(next.parameters).some(([k,v])=>!Object.hasOwn(before.parameters,k)||!Object.is(before.parameters[k],v));
 if(intent!=='apply'&&!constructionChanged&&before.iterations===next.iterations)return{configuration:anchor,parameters:{...next.parameters}};
 // The native iterations inspector writes only its runtime setting. Preserve
 // raw constructor equations and parameter order: editor Apply normalization
 // would change the retained seed despite no new mobject being constructed.
 if(intent!=='apply'&&!constructionChanged){
  const configuration=unwrap(parseSourceMapConfiguration({...valid,construction:{...valid.construction,iterations:next.iterations}}),[]);
  return{configuration,parameters:{...next.parameters}};
 }

 const values=new Map(valid.editorParameters??valid.construction.parameters);
 for(const k of Object.keys(before.parameters))if(!Object.hasOwn(next.parameters,k))values.delete(k);
 for(const [k,v]of Object.entries(next.parameters))if(!Object.hasOwn(before.parameters,k)||!Object.is(before.parameters[k],v))values.set(k,v);
 const tree=snapshot([...values.keys()],valid.editorMap);const ordered=jsonOrder(tree.keys).map(k=>[k,values.get(k)!] as SourceMapEntry);
 if(next.dimension!==2&&next.dimension!==3)fail('input',['dimension'],'源 Map 编辑维度无效');
 const editedEquations={...(valid.editorEquations??valid.construction.equations)};
 for(const axis of ['x','y','z'] as const)if(before.equations[axis]!==next.equations[axis])editedEquations[axis]=next.equations[axis]??'';
 for(const axis of ['x','y','z'] as const)editedEquations[axis]=projectTrim(editedEquations[axis]);
 const c:SourceMapConstruction={batchSize:next.batchSize,dimension:next.dimension,burnIn:next.burnIn,iterations:next.iterations,initial:{...next.initial},equations:{...editedEquations},parameters:ordered};
 for(const k of ['xMin','xMax','yMin','yMax'] as const)c.initial[k]=finite(c.initial[k],['initial',k],true);
 normalizeBounds(c.initial);completeDimension(c);compile(c);
 const configuration=unwrap(createSourceMapConfiguration(c,{entry:'project',settingsPresence:'object',editorMap:tree.state,editorParameters:[...values],editorEquations:editedEquations}),[]);return{configuration,parameters:Object.fromEntries(c.parameters)};
});}
