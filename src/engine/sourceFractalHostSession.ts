import {SourceFractalSceneRuntime,type SourceFractalSceneRuntimeConfiguration} from './sourceFractalSceneRuntime';
import {SourceSceneHostClock,validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';

export class SourceFractalHostError extends Error {
 constructor(readonly code:'input'|'state'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceFractalHostError';}
}
export interface SourceFractalHostOptions {
 readonly paused?:boolean;
 readonly now?:()=>number;
 readonly isCancelled?:()=>boolean;
 /** Shared with parameter phases; the host also enforces a per-operation cap. */
 readonly reserve?:(units:number)=>void;
}
/** An in-process capability. A transport adapter must own its own handle map. */
export interface SourceFractalHostRecordingHandle {readonly recordingId:number;}
export interface SourceFractalHostSnapshot {
 /** -1 before the first numerical Scene.update; never a rendered-frame count. */
 readonly updateOrdinal:number;
 readonly paused:boolean;
 readonly mode:'live'|'recording';
 readonly state:ReturnType<SourceFractalSceneRuntime['snapshot']>;
 readonly hostClock:ReturnType<SourceSceneHostClock['diagnostics']>;
 /** Numerical facts only. Warmup still needs rendering and discarding by a host. */
 readonly recording?:{readonly simulationFps:number;readonly ordinal:number;readonly warmup:boolean;readonly complete:boolean};
}
interface Recording {
 readonly handle:SourceFractalHostRecordingHandle;
 readonly simulationFps:number;
 ordinal:number;
}
const WORK_LIMIT=2_000_000;
const clone=<T>(value:T):T=>structuredClone(value);
const camera=(value:readonly [number,number,number])=>({phi:value[0],theta:value[1],gamma:value[2]});
function simulationFps(value:number):number {
 if(!Number.isSafeInteger(value)||value<1||value>120)throw new SourceFractalHostError('input','分形录制模拟帧率必须为 1–120 的整数');
 return value;
}
function effectiveFps(value:number):void {
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new SourceFractalHostError('input','分形宿主帧率必须为有限 Float32');
}

/** Numerical-only MathArt Fractal host. It owns the wall clock and the complete
 * mobject/queue instance, but no display, GPU target, encoder or asynchronous
 * publication lease. Authored input, last full-load recording anchor and the
 * currently mutated runtime are deliberately distinct identities. */
export class SourceFractalHostSession {
 private runtime!:SourceFractalSceneRuntime;
 private hostClock!:SourceSceneHostClock;
 private authored!:SourceFractalSceneRuntimeConfiguration;
 private applied!:SourceFractalSceneRuntimeConfiguration;
 private updateOrdinal=-1;
 private recording?:Recording;
 private recordingId=0;
 private failed=false;
 private work=0;
 private readonly options:SourceFractalHostOptions;
 constructor(configuration:SourceFractalSceneRuntimeConfiguration,options:SourceFractalHostOptions={}){
  if(!options||options.now!==undefined&&typeof options.now!=='function'||options.isCancelled!==undefined&&typeof options.isCancelled!=='function'||options.reserve!==undefined&&typeof options.reserve!=='function')throw new SourceFractalHostError('input','分形宿主回调无效');
  this.options={...options};this.fullLoad(configuration,{paused:options.paused===undefined?false:options.paused});
 }
 private check():void {if(this.options.isCancelled?.())throw new SourceFractalHostError('cancelled','分形宿主更新已取消');}
 private ensure():void {if(this.failed)throw new SourceFractalHostError('state','分形宿主部分更新失败，需要 fullLoad 重建');}
 private live():void {this.ensure();if(this.recording)throw new SourceFractalHostError('state','分形录制期间不能执行实时或配置操作');}
 private reserve=(units:number):void=>{
  this.check();
  if(!Number.isSafeInteger(units)||units<0||!Number.isSafeInteger(this.work+units)||this.work+units>WORK_LIMIT)throw new SourceFractalHostError('capacity','分形宿主单次更新超过共享 200 万工作预算');
  this.work+=units;this.options.reserve?.(units);this.check();
 };
 /** After this boundary, host time or child state may already have changed. */
 private mutate<T>(operation:()=>T):T {
  this.work=0;this.check();
  try{return operation();}catch(error){this.failed=true;throw error;}
 }
 private prepare(configuration:SourceFractalSceneRuntimeConfiguration,paused:boolean){
  validateSourceSceneClockRequest({paused});this.work=0;this.check();
  // Runtime performs format/capacity admission before we retain another copy.
  const runtime=new SourceFractalSceneRuntime(configuration,{reserve:this.reserve});
  const hostClock=new SourceSceneHostClock(paused,camera(runtime.snapshot().scene.cameraAngles),this.options.now);
  const retained=clone(configuration);this.check();return{runtime,hostClock,retained};
 }
 private install(candidate:ReturnType<SourceFractalHostSession['prepare']>):void {
  this.runtime=candidate.runtime;this.hostClock=candidate.hostClock;this.updateOrdinal=-1;this.recording=undefined;this.failed=false;
 }
 /** Explicit recovery/load boundary. A rejected candidate preserves all old
  * identities. Successful loads replace the queue and the recording anchor. */
 fullLoad(configuration:SourceFractalSceneRuntimeConfiguration,options:{paused?:boolean}={}):SourceFractalHostSnapshot {
  if(this.recording&&!this.failed)throw new SourceFractalHostError('state','请先结束分形录制再加载配置');
  const candidate=this.prepare(configuration,options.paused===undefined?false:options.paused);
  this.install(candidate);this.authored=candidate.retained;this.applied=candidate.retained;
  return this.snapshot();
 }
 authoredConfiguration():SourceFractalSceneRuntimeConfiguration {this.ensure();return clone(this.authored);}
 recordingApplied():SourceFractalSceneRuntimeConfiguration {this.ensure();return clone(this.applied);}
 snapshot():SourceFractalHostSnapshot {
  this.ensure();const state=this.runtime.snapshot(),hostClock=this.hostClock.diagnostics(),recording=this.recording;
  return{updateOrdinal:this.updateOrdinal,paused:hostClock.paused,mode:recording?'recording':'live',state,hostClock,
   ...(recording?{recording:{simulationFps:recording.simulationFps,ordinal:recording.ordinal,warmup:recording.ordinal===0,complete:state.scene.queueComplete}}:{})};
 }
 private advance(dt:number,paused:boolean):SourceFractalHostSnapshot {
  const pending=this.runtime.clock.clipCount-this.runtime.clock.snapshot().queueIndex;
  this.reserve(1+Math.max(0,pending));
  this.runtime.clock.step(dt,paused,this.options.isCancelled);this.updateOrdinal++;
  return this.snapshot();
 }
 /** Local fixed reconstruction on a new incarnation, not an original seek.
  * One shared budget covers all child phases; the wall clock remains fresh. */
 reconstruct(time:number):SourceFractalHostSnapshot {
  this.live();if(this.updateOrdinal!==-1)throw new SourceFractalHostError('state','本地分形重建必须使用新的宿主');
  if(!Number.isFinite(time)||time<0||time>86400)throw new SourceFractalHostError('input','分形本地重建起点必须在 0–86400 秒');
  return this.mutate(()=>{
   this.runtime.setEffectiveFrameRate(this.applied.fps);
   const last=Math.floor(time*this.applied.fps+1e-9);
   for(let i=0;i<=last;i++)this.advance(Math.fround(1/this.applied.fps),false);
   // A local seek may initialize paused. Resume must restore the reconstructed
   // camera, not the fresh constructor's angles, and still has no elapsed time.
   this.hostClock=new SourceSceneHostClock(this.hostClock.diagnostics().paused,camera(this.runtime.clock.snapshot().cameraAngles),this.options.now);
   return this.snapshot();
  });
 }
 /** actualFrameRate is PApplet's measured rate, not 1/dt or the encoder rate.
  * Signed wall-clock deltas and the source animator's <=1 FPS fallback remain. */
 update(request:SourceSceneClockRequest,actualFrameRate:number):SourceFractalHostSnapshot {
  this.live();validateSourceSceneClockRequest(request);this.hostClock.assertPaused(request.paused);effectiveFps(actualFrameRate);
  return this.mutate(()=>{this.runtime.setEffectiveFrameRate(actualFrameRate);return this.advance(this.hostClock.update(request),request.paused);});
 }
 setPaused(paused:boolean,timestampMs?:number):SourceFractalHostSnapshot {
  this.live();validateSourceSceneClockRequest({paused,timestampMs});
  return this.mutate(()=>{
   const restore=this.hostClock.setPaused(paused,camera(this.runtime.clock.snapshot().cameraAngles),timestampMs);
   if(restore)this.runtime.clock.writeCameraAngles([restore.phi,restore.theta,restore.gamma]);
   return this.snapshot();
  });
 }
 /** The pending-fractal-config route, regardless of pause state. The authored
  * config changes, but SceneManager and the last full-load anchor do not. */
 hotApply(configuration:SourceFractalSceneRuntimeConfiguration):SourceFractalHostSnapshot {
  this.live();const candidate=this.prepare(configuration,this.hostClock.diagnostics().paused);
  return this.mutate(()=>{this.runtime.applyConfiguration(candidate.retained);this.authored=candidate.retained;return this.snapshot();});
 }
 /** Editor Apply branches on current host pause state, not the previous
  * Scene.update's paused flag. Running Apply is a full scene reload. */
 applyConfiguration(configuration:SourceFractalSceneRuntimeConfiguration):SourceFractalHostSnapshot {
  this.live();return this.hostClock.diagnostics().paused?this.hotApply(configuration):this.fullLoad(configuration);
 }
 /** Toolbar begin: rebuild the last full-load anchor, force running and perform
  * the first fixed update. It does not prove a warmup render or encoded frame. */
 beginRecording(fps:number):{handle:SourceFractalHostRecordingHandle;warmup:SourceFractalHostSnapshot} {
  this.live();simulationFps(fps);
  const candidate=this.prepare({...this.applied,fps},false);
  return this.mutate(()=>{
   this.install(candidate);const handle=Object.freeze({recordingId:++this.recordingId});
   this.recording={handle,simulationFps:fps,ordinal:0};this.runtime.setEffectiveFrameRate(fps);
   return{handle,warmup:this.advance(Math.fround(1/fps),false)};
  });
 }
 private ownedRecording(handle:SourceFractalHostRecordingHandle):Recording {
  this.ensure();if(!this.recording||handle!==this.recording.handle)throw new SourceFractalHostError('state','分形录制句柄不属于当前实例');return this.recording;
 }
 nextRecordingFrame(handle:SourceFractalHostRecordingHandle,ordinal:number):SourceFractalHostSnapshot {
  const recording=this.ownedRecording(handle);
  if(!Number.isSafeInteger(ordinal)||ordinal<1||ordinal/recording.simulationFps>86400)throw new SourceFractalHostError('input','分形录制更新序号必须是 24 小时内的正整数');
  if(ordinal!==recording.ordinal+1||this.runtime.clock.snapshot().queueComplete)throw new SourceFractalHostError('state','分形录制必须连续更新且不能越过队列终帧');
  return this.mutate(()=>{recording.ordinal=ordinal;this.runtime.setEffectiveFrameRate(recording.simulationFps);return this.advance(Math.fround(1/recording.simulationFps),false);});
 }
 /** May stop early. disableRenderMode resets wall time only: no extra update,
  * pause, camera restore, configuration reload or restoration of old preview. */
 finishRecording(handle:SourceFractalHostRecordingHandle,timestampMs?:number):SourceFractalHostSnapshot {
  this.ownedRecording(handle);validateSourceSceneClockRequest({paused:false,timestampMs});
  return this.mutate(()=>{this.hostClock.resetTime(timestampMs);this.recording=undefined;return this.snapshot();});
 }
}
