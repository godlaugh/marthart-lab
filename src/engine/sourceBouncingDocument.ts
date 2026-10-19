import {importSourceBouncingConfig,parseSourceBouncingConfiguration,type SourceBouncingConfiguration,type SourceBouncingError,type SourceBouncingResult,type SourceBouncingImportOptions} from './sourceBouncingConfig';
import {importSourceBouncingVisualConfig,parseSourceBouncingVisualConfiguration,type SourceBouncingVisualConfiguration} from './sourceBouncingVisualConfig';
import {prepareDomainSourceScalar} from './domainSourceScalar';
import type {SourceCameraInput} from './sourceCamera';
import {SOURCE_BOUNCING_VIEW_MODEL,sourceBouncingViewInput} from './sourceBouncingNavigation';

export interface SourceBouncingCameraAngles {phi:number;theta:number;gamma:number;}
export interface SourceBouncingDocumentPayload {
 configuration:SourceBouncingConfiguration;
 visual:SourceBouncingVisualConfiguration;
 camera:SourceBouncingCameraAngles;
 recordDuration:number;
}
/** Shared simulation identity; visual/camera edits do not replace particles. */
export function sourceBouncingInitializationKey(configuration:SourceBouncingConfiguration):string{
 return JSON.stringify(configuration,(_key,value:unknown)=>typeof value==='number'&&Object.is(value,-0)?{negativeZero:true}:value);
}
export interface SourceBouncingDocumentImportFacts {
 payload:SourceBouncingDocumentPayload;
 /** Consumed fields from the component owners, not an exception-order trace
  * of the interleaved native constructor. Duplicate paths are emitted once. */
 consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];
}
/** Identity is independent of validity; malformed owned payloads still select
 * this owner and fail explicitly instead of falling through to local physics. */
export const usesSourceBouncing=(scene:{kind?:unknown;bouncingSource?:unknown}):boolean=>scene.kind==='bouncing'&&scene.bouncingSource!==undefined;
const F=Math.fround,MIN_RECORD_DURATION=F(.1),angles=['phi','theta','gamma'] as const;
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
class Failure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(kind:SourceBouncingError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(fn:()=>T):SourceBouncingResult<T>{try{return{ok:true,value:fn()};}catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
function unwrap<T>(result:SourceBouncingResult<T>,prefix:readonly string[]=[]):T{if(!result.ok)fail(result.error.kind,[...prefix,...result.error.path],result.error.reason);return result.value;}
function exact(raw:Record<string,unknown>,keys:readonly string[],path:readonly string[]){if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))fail('input',path,'源弹跳文档字段缺失或包含未知字段');}
function finite(raw:unknown,path:readonly string[]):number{if(typeof raw!=='number')fail('input',path,'必须为数值');const value=F(raw);if(!Number.isFinite(value))fail('nonfinite',path,'源弹跳文档需要有限 Float32');return value;}
function uniquePaths(paths:readonly (readonly string[])[]):string[][]{const seen=new Set<string>();return paths.filter(path=>{const key=JSON.stringify(path);if(seen.has(key))return false;seen.add(key);return true;}).map(path=>[...path]);}
/** Compose the existing initialization and visual owners. This projection does
 * not parse names/type/project layout or timeline: native Bouncing has no JSON
 * timeline dispatcher. The public adapter retains those unconsumed source
 * fields. The palette owner runs first, as AbstractVisualConfig.parsePalette.
 * Cross-owner malformed-field first-error order is not a JVM execution claim. */
export function importSourceBouncingDocument(raw:unknown,options:SourceBouncingImportOptions={}):SourceBouncingResult<SourceBouncingDocumentImportFacts>{return attempt(()=>{
 const visual=unwrap(importSourceBouncingVisualConfig(raw,options)),configuration=unwrap(importSourceBouncingConfig(raw,options));
 // Both owners already established an object root and matching section facts.
 const root=raw as Record<string,unknown>,camera:SourceBouncingCameraAngles={phi:0,theta:0,gamma:0};
 const consumedPaths=[...visual.consumedPaths,...configuration.consumedPaths],numericPaths=[...visual.numericPaths,...configuration.numericPaths],diagnostics=[...visual.diagnostics,...configuration.diagnostics];
 let recordDuration=10;
 const scalar=(container:Record<string,unknown>,key:string,fallback:number,path:string[])=>{
  if(!Object.hasOwn(container,key))return fallback;
  const value=container[key];consumedPaths.push(path);if(typeof value==='number')numericPaths.push(path);
  if(value===null)return fallback;
  const result=prepareDomainSourceScalar(value,{fallback:0,precision:'float32'});
  if(!result.ok)fail('capacity',path,JSON.stringify(result.error));
  if(result.facts.route==='fallback')diagnostics.push(`${path.join('.')}: 源表达式解析失败，返回 0；原文由调用者保留。`);
  return result.facts.value;
 };
 if(configuration.configuration.settingsPresence==='object'){
  const settings=root.settings as Record<string,unknown>;
  // Json ctor PC674–691: max(.1f, parseValue), not an app duration cap.
  recordDuration=finite(Math.max(MIN_RECORD_DURATION,scalar(settings,'record_duration',10,['settings','record_duration'])),['settings','record_duration']);
  // Json ctor PC10–27 returns before camera when settings is absent.
  if(Object.hasOwn(root,'camera')){
   if(!object(root.camera))fail('input',['camera'],'源 camera 必须为对象');
   if(!Object.keys(root.camera).length)consumedPaths.push(['camera']);
   for(const key of angles)camera[key]=finite(scalar(root.camera,key,0,['camera',key]),['camera',key]);
  }
 }
 return{payload:{configuration:configuration.configuration,visual:visual.configuration,camera,recordDuration},consumedPaths:uniquePaths(consumedPaths),numericPaths:uniquePaths(numericPaths),diagnostics};
});}
/** Detached finite canonical facts. Source normalization happens at import;
 * saved durations below the native minimum fail rather than being repaired.
 * Presence metadata does not override later explicit canonical author edits. */
export function parseSourceBouncingDocument(raw:unknown):SourceBouncingResult<SourceBouncingDocumentPayload>{return attempt(()=>{
 if(!object(raw))fail('input',[],'源弹跳文档必须为对象');exact(raw,['configuration','visual','camera','recordDuration'],[]);
 const configuration=unwrap(parseSourceBouncingConfiguration(raw.configuration),['configuration']),visual=unwrap(parseSourceBouncingVisualConfiguration(raw.visual),['visual']);
 if(configuration.settingsPresence!==visual.settingsPresence)fail('input',['visual','settingsPresence'],'初始化与视觉配置的 settings 来源状态不一致');
 if(!object(raw.camera))fail('input',['camera'],'源相机必须为对象');exact(raw.camera,angles,['camera']);
 const camera={phi:finite(raw.camera.phi,['camera','phi']),theta:finite(raw.camera.theta,['camera','theta']),gamma:finite(raw.camera.gamma,['camera','gamma'])};
 const recordDuration=finite(raw.recordDuration,['recordDuration']);if(recordDuration<MIN_RECORD_DURATION)fail('input',['recordDuration'],'源录制时长不能小于 Float32(0.1)');
 return{configuration,visual,camera,recordDuration};
});}
/** Explicit Bouncing baseline, never an invented ordinary-camera family.
 * Passing all scalars prevents the shared Scene default phi=PI/2 leaking in.
 * Interactive camera changes belong to the replay owner, not JSON import. */
export function sourceBouncingCameraInput(payload:SourceBouncingDocumentPayload):SourceCameraInput{
 return sourceBouncingViewInput({model:SOURCE_BOUNCING_VIEW_MODEL,...payload.camera,zoom:1});
}

/** Public generation gate. These documents have an empty native queue and no
 * local equation/parameter/settings interpretation. Capability checks stay in
 * the runtime owner; parsing never allocates seeds or obtains a GPU context. */
export function prepareSourceBouncingScene(scene:unknown):SourceBouncingResult<SourceBouncingDocumentPayload>{return attempt(()=>{
 if(!object(scene)||!usesSourceBouncing(scene))fail('input',['bouncingSource'],'缺少原版弹跳文档身份');
 const payload=unwrap(parseSourceBouncingDocument(scene.bouncingSource),['bouncingSource']);
 if(scene.sourceCamera!==undefined)fail('input',['sourceCamera'],'源弹跳相机由 bouncingSource.camera 持有，不执行普通相机队列');
 if(!object(scene.timeline)||!Array.isArray(scene.timeline.tracks))fail('input',['timeline'],'源弹跳需要明确的空时间轴');
 if(scene.timeline.tracks.length!==0)fail('input',['timeline','tracks'],'原版 Bouncing JSON 没有时间轴片段');
 if(scene.timeline.schedule!==undefined)fail('input',['timeline','schedule'],'源弹跳不执行顺序时间轴调度');
 for(const key of ['settings','equations','parameters'])if(!object(scene[key])||Object.keys(scene[key]).length!==0)fail('input',[key],'源弹跳作者配置只允许位于 bouncingSource；本地字段必须为空对象');
 return payload;
});}
