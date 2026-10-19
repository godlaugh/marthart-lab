import {prepareDomainSourceScalar,prepareDomainSourceObjectScalar} from './domainSourceScalar';
import {prepareRootsSourceJsonInt} from './rootsSourceOrder';

export const SOURCE_ATTRACTOR_MODEL='attractor-1.7.8' as const;
export interface SourceAttractorConfiguration {
 model:typeof SOURCE_ATTRACTOR_MODEL;
 settingsPresence:'absent'|'object';initializationPresence:'absent'|'object';boundsPresence:'absent'|'object';
 nativeBackend:'cpu'|'gpu';particleCountCPU:number;particleCountGPU:number;
 dtRange:{min:number;max:number};stepsPerFrame:number;
 warmup:{steps:number;staggerMin:number;staggerMax:number};
 bounds:{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number};
 transform:{scaleX:number;scaleY:number;scaleZ:number;offsetX:number;offsetY:number;offsetZ:number};
}
export type SourceAttractorError={kind:'input'|'capacity'|'nonfinite';path:readonly string[];reason:string};
export type SourceAttractorResult<T>={ok:true;value:T}|{ok:false;error:SourceAttractorError};
export interface SourceAttractorImportFacts {configuration:SourceAttractorConfiguration;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
export interface SourceAttractorImportOptions {/** Full source paths, including settings or initialization. */numberToken?:(path:readonly string[])=>string|undefined;}
class Failure extends Error {constructor(readonly detail:SourceAttractorError){super(detail.reason);}}
function fail(kind:SourceAttractorError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceAttractorResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const javaInt=(value:number)=>Number.isNaN(value)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(value)));
const F=Math.fround;
function finite(value:number,path:readonly string[]):number{if(!Number.isFinite(value)||!Number.isFinite(F(value)))fail('nonfinite',path,'源非有限数值不能保存或回放');return value;}
function defaults():SourceAttractorConfiguration{return{model:SOURCE_ATTRACTOR_MODEL,settingsPresence:'absent',initializationPresence:'absent',boundsPresence:'absent',nativeBackend:'cpu',particleCountCPU:250,particleCountGPU:200000,dtRange:{min:F(.005),max:F(.01)},stepsPerFrame:5,warmup:{steps:0,staggerMin:0,staggerMax:0},bounds:{minX:-1,maxX:1,minY:-1,maxY:1,minZ:-1,maxZ:1},transform:{scaleX:1,scaleY:1,scaleZ:1,offsetX:0,offsetY:0,offsetZ:0}};}
/** JsonAttractorConfig + ConfigUtils reads. Raw authoring text and omitted fields
 * stay with the importing document; these facts retain section presence and
 * consumed paths. Parameter bindings do not exist at this stage in the source.
 * Color, formula, camera and visual settings belong to their separate owners. */
export function importSourceAttractorConfig(rawSettings:unknown,rawInitialization:unknown,options:SourceAttractorImportOptions={}):SourceAttractorResult<SourceAttractorImportFacts>{return attempt(()=>{
 const configuration=defaults(),consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 const section=(raw:unknown,path:string[]):Record<string,unknown>|undefined=>{if(raw===undefined)return undefined;if(!object(raw))fail('input',path,'源配置节必须为对象');if(!Object.keys(raw).length)consumedPaths.push(path);return raw;};
 const read=(raw:Record<string,unknown>,key:string,parent:string[]):unknown=>{if(Object.hasOwn(raw,key)){const path=[...parent,key];consumedPaths.push(path);if(typeof raw[key]==='number')numericPaths.push(path);}return raw[key];};
 const float=(raw:Record<string,unknown>,key:string,fallback:number,parent:string[]):number=>{
  if(!Object.hasOwn(raw,key))return F(fallback);
  const value=read(raw,key,parent),path=[...parent,key];
  // getFloat first; ConfigUtils falls back to getString(default), then an
  // empty-scope FastExpression whose parse failures become 0, not fallback.
  if(value===null)return F(fallback);
  const parsed=prepareDomainSourceScalar(value,{fallback:0,precision:'float32'});
  if(!parsed.ok)return fail('capacity',path,JSON.stringify(parsed.error));
  if(parsed.facts.route==='fallback')diagnostics.push(`${path.join('.')}: 源表达式解析失败，返回 0；原值保留在 source。`);
  return finite(parsed.facts.value,path);
 };
 const int=(raw:Record<string,unknown>,key:string,fallback:number,parent:string[]):number=>{
  if(!Object.hasOwn(raw,key))return fallback;
  const value=read(raw,key,parent),path=[...parent,key];if(value===null)return fallback;
  const direct=prepareRootsSourceJsonInt(value,fallback,options.numberToken?.(path));
  if(!direct.ok)return fail(direct.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(direct.error));
  if(direct.value.route!=='fallback')return direct.value.value;
  const parsed=prepareDomainSourceObjectScalar(value,{fallback:0,precision:'float64'});
  if(!parsed.ok)return fail('capacity',path,JSON.stringify(parsed.error));
  if(parsed.facts.route==='fallback')diagnostics.push(`${path.join('.')}: 源整数表达式解析失败，返回 0；原值保留在 source。`);
  return javaInt(parsed.facts.value);
 };
 const settings=section(rawSettings,['settings']);
 if(settings){
  configuration.settingsPresence='object';const p=['settings'];
  const old=Object.hasOwn(settings,'particle_count'),cpu=Object.hasOwn(settings,'particle_count_cpu'),gpu=Object.hasOwn(settings,'particle_count_gpu');
  if(cpu)configuration.particleCountCPU=int(settings,'particle_count_cpu',2000,p);else if(old)configuration.particleCountCPU=int(settings,'particle_count',2000,p);
  if(gpu)configuration.particleCountGPU=int(settings,'particle_count_gpu',200000,p);else if(old&&!cpu)configuration.particleCountGPU=int(settings,'particle_count',200000,p);
  configuration.particleCountCPU=Math.min(configuration.particleCountCPU,10000);
  if(Object.hasOwn(settings,'time_step_min')||Object.hasOwn(settings,'time_step_max'))configuration.dtRange={min:float(settings,'time_step_min',F(.005),p),max:float(settings,'time_step_max',F(.01),p)};
  else if(Object.hasOwn(settings,'time_step')){const dt=float(settings,'time_step',F(.01),p);configuration.dtRange={min:dt,max:dt};}
  if(configuration.dtRange.min>configuration.dtRange.max)[configuration.dtRange.min,configuration.dtRange.max]=[configuration.dtRange.max,configuration.dtRange.min];
  configuration.stepsPerFrame=int(settings,'sub_steps',5,p);
  for(const axis of ['X','Y','Z'] as const){configuration.transform[`scale${axis}`]=float(settings,`scale_${axis.toLowerCase()}`,1,p);configuration.transform[`offset${axis}`]=float(settings,`offset_${axis.toLowerCase()}`,0,p);}
  if(Object.hasOwn(settings,'render_mode')){const mode=read(settings,'render_mode',p);if(typeof mode!=='string')fail('input',[...p,'render_mode'],'源 render_mode 必须为字符串');configuration.nativeBackend=mode.toUpperCase()==='GPU'?'gpu':'cpu';}
 }
 const initialization=section(rawInitialization,['initialization']);
 if(initialization){
  configuration.initializationPresence='object';const p=['initialization'];
  configuration.warmup={steps:int(initialization,'warmup_steps',0,p),staggerMin:int(initialization,'warmup_stagger_min',0,p),staggerMax:int(initialization,'warmup_stagger_max',0,p)};
  const bounds=section(initialization.bounds,[...p,'bounds']);
  if(bounds){configuration.boundsPresence='object';for(const axis of ['X','Y','Z'] as const){configuration.bounds[`min${axis}`]=float(bounds,`min_${axis.toLowerCase()}`,-1,[...p,'bounds']);configuration.bounds[`max${axis}`]=float(bounds,`max_${axis.toLowerCase()}`,1,[...p,'bounds']);}}
 }
 // Legacy particle_count may be read twice by the source, but provenance paths
 // describe consumed members rather than executions of a getter.
 const unique=(paths:string[][])=>paths.filter((p,i)=>paths.findIndex(q=>q.join('.')===p.join('.'))===i);
 return{configuration,consumedPaths:unique(consumedPaths),numericPaths:unique(numericPaths),diagnostics};
});}
/** Saved facts: no defaulting, source aliases, clamping, sorting or backend
 * switching. Runtime resource admission is separate from source input facts. */
export function parseSourceAttractorConfiguration(raw:unknown):SourceAttractorResult<SourceAttractorConfiguration>{return attempt(()=>{
 const integers=new Set(['particleCountCPU','particleCountGPU','stepsPerFrame','steps','staggerMin','staggerMax']);
 const walk=(value:unknown,shape:unknown,path:string[]):unknown=>{
  if(object(shape)){if(!object(value))fail('input',path,'必须为对象');const keys=Object.keys(shape);if(Object.keys(value).some(key=>!keys.includes(key)))fail('input',path,'未知字段');return Object.fromEntries(keys.map(key=>[key,walk(value[key],shape[key],[...path,key])]));}
  if(typeof shape==='number'){if(typeof value!=='number')fail('input',path,'必须为数值');finite(value,path);if(integers.has(path.at(-1)!)&&(!Number.isInteger(value)||value< -2147483648||value>2147483647))fail('input',path,'必须为 Java int32');return value;}
  const key=path.at(-1),allowed=key==='model'?[SOURCE_ATTRACTOR_MODEL]:key==='nativeBackend'?['cpu','gpu']:['absent','object'];if(typeof value!=='string'||!allowed.includes(value))fail('input',path,'未知配置枚举');return value;
 };
 return walk(raw,defaults(),[]) as SourceAttractorConfiguration;
});}
