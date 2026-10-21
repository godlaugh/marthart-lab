import {SourceDomainSceneRuntime,type SourceDomainSceneConfiguration} from './sourceDomainSceneRuntime';
import {SourceSceneHostClock,validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';

/** Deltas are Processing logical mouse coordinates; count is MouseEvent's int.
 * The native toolbar only delivers these gestures while paused. */
export type SourceDomainViewportGesture=
 |{readonly kind:'pan';readonly dx:number;readonly dy:number;readonly width:number;readonly height:number}
 |{readonly kind:'wheel';readonly count:number};
export interface SourceDomainHostOptions {
 readonly paused?:boolean;
 readonly now?:()=>number;
 readonly isCancelled?:()=>boolean;
 readonly reserve?:(units:number)=>void;
}
/** Identity capability, never a caller-supplied numeric recording identifier. */
export interface SourceDomainHostRecordingHandle {readonly recordingId:number;}
export interface SourceDomainHostSnapshot {
 readonly updateOrdinal:number;
 readonly paused:boolean;
 readonly state:ReturnType<SourceDomainSceneRuntime['snapshot']>;
 readonly hostClock:ReturnType<SourceSceneHostClock['diagnostics']>;
 readonly recording?:{readonly simulationFps:number;readonly ordinal:number;readonly warmup:boolean;readonly complete:boolean};
}
const F=Math.fround,WORK_LIMIT=2_000_000;
const unusedCamera={phi:0,theta:0,gamma:0};
function actualFps(value:number):void {if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw Error('域着色宿主帧率必须为有限 Float32');}

/** Numerical host boundary. It owns wall time, full reload and the recording
 * anchor, but no GPU target, UI event, displayed-frame lease or encoder.
 * Domain always reloads on full Apply, even while paused. Unlike Fractal,
 * recording never substitutes simulation FPS for observed PApplet.frameRate. */
export class SourceDomainHostSession {
 private runtime!:SourceDomainSceneRuntime;
 private hostClock!:SourceSceneHostClock;
 private applied!:SourceDomainSceneConfiguration;
 private updateOrdinal=-1;
 private recording?:{handle:SourceDomainHostRecordingHandle;simulationFps:number;ordinal:number};
 private serial=0;private failed=false;private work=0;
 private readonly options:SourceDomainHostOptions;
 constructor(configuration:SourceDomainSceneConfiguration,options:SourceDomainHostOptions={}){
  if(!options||options.now!==undefined&&typeof options.now!=='function'||options.isCancelled!==undefined&&typeof options.isCancelled!=='function'||options.reserve!==undefined&&typeof options.reserve!=='function')throw Error('域着色宿主回调无效');
  this.options={...options};this.fullLoad(configuration,{paused:options.paused??false});
 }
 private check():void {if(this.options.isCancelled?.())throw new DOMException('域着色宿主已取消','AbortError');}
 private ensure():void {if(this.failed)throw Error('域着色宿主更新失败，需要 fullLoad 重建');}
 private live():void {this.ensure();if(this.recording)throw Error('域着色录制期间不能执行实时或配置操作');}
 private reserve=(units:number):void=>{this.check();if(!Number.isSafeInteger(units)||units<0||!Number.isSafeInteger(this.work+units)||this.work+units>WORK_LIMIT)throw Error('域着色宿主单次操作超过共享200万工作预算');this.work+=units;this.options.reserve?.(units);this.check();};
 private mutate<T>(operation:()=>T):T {this.work=0;this.check();try{return operation();}catch(error){this.failed=true;throw error;}}
 private prepare(configuration:SourceDomainSceneConfiguration,paused:boolean){
  validateSourceSceneClockRequest({paused});this.work=0;this.check();
  const runtime=new SourceDomainSceneRuntime(configuration,{reserve:this.reserve}),hostClock=new SourceSceneHostClock(paused,unusedCamera,this.options.now),applied=structuredClone(configuration);
  this.check();return{runtime,hostClock,applied};
 }
 private install(candidate:ReturnType<SourceDomainHostSession['prepare']>):void {this.runtime=candidate.runtime;this.hostClock=candidate.hostClock;this.updateOrdinal=-1;this.recording=undefined;this.failed=false;}
 fullLoad(configuration:SourceDomainSceneConfiguration,options:{paused?:boolean}={}):SourceDomainHostSnapshot {
  if(this.recording&&!this.failed)throw Error('请先结束域着色录制再加载配置');
  const candidate=this.prepare(configuration,options.paused??false);this.install(candidate);this.applied=candidate.applied;return this.snapshot();
 }
 recordingApplied():SourceDomainSceneConfiguration {this.ensure();return structuredClone(this.applied);}
 snapshot():SourceDomainHostSnapshot {this.ensure();const state=this.runtime.snapshot(),clock=this.hostClock.diagnostics(),r=this.recording;return{updateOrdinal:this.updateOrdinal,paused:clock.paused,state,hostClock:clock,...(r?{recording:{simulationFps:r.simulationFps,ordinal:r.ordinal,warmup:r.ordinal===0,complete:state.clock.queueComplete}}:{})};}
 private advance(dt:number,paused:boolean,frameRate:number):void {this.runtime.setParameterFrameRate(frameRate);this.runtime.advance(dt,paused,this.options.isCancelled);this.updateOrdinal++;}
 update(request:SourceSceneClockRequest,frameRate:number):SourceDomainHostSnapshot {
  this.live();validateSourceSceneClockRequest(request);this.hostClock.assertPaused(request.paused);actualFps(frameRate);
  return this.mutate(()=>{this.advance(this.hostClock.update(request),request.paused,frameRate);return this.snapshot();});
 }
 setPaused(paused:boolean,timestampMs?:number):SourceDomainHostSnapshot {
  this.live();validateSourceSceneClockRequest({paused,timestampMs});return this.mutate(()=>{this.hostClock.setPaused(paused,unusedCamera,timestampMs);return this.snapshot();});
 }
 /** Runtime navigation is independent of authored Apply and the recording
  * anchor. It neither updates the scene nor advances display ordinal. Finite
  * positive dimensions are a local admission boundary for native division. */
 navigatePaused(gesture:SourceDomainViewportGesture):SourceDomainHostSnapshot {
  this.live();if(!this.hostClock.diagnostics().paused)throw Error('域着色视口手势只接受暂停状态');
  if(!gesture||typeof gesture!=='object')throw Error('域着色视口手势无效');
  const state=this.runtime.snapshot(),scale=Number(state.settings.scale??2.5);
  if(!Number.isFinite(scale))throw Error('域着色当前缩放无效');
  if(gesture.kind==='pan'){
   const {dx,dy,width,height}=gesture;
   if(![dx,dy].every(v=>typeof v==='number'&&Number.isFinite(F(v)))||![width,height].every(v=>Number.isInteger(v)&&v>0&&v<=2147483647))throw Error('域着色平移需要有限增量和正整数逻辑尺寸');
   const aspect=F(F(width)/Math.max(1,F(height))),inverse=1/Math.max(scale,1e-9);
   const x=((-F(dx)/width)*2)*aspect*inverse,y=((-F(dy)/height)*2)*inverse;
   if(![x,y,Number(state.settings.centerX??0)+x,Number(state.settings.centerY??0)+y].every(Number.isFinite))throw Error('域着色平移超出有限数值范围');
   return this.mutate(()=>{this.runtime.addViewportCenterDelta(x,y);return this.snapshot();});
  }
  if(gesture.kind==='wheel'){
   if(!Number.isInteger(gesture.count)||gesture.count< -2147483648||gesture.count>2147483647)throw Error('域着色滚轮需要原版整数计数');
   const next=scale*Math.pow(F(1.05),-F(gesture.count));
   if(!Number.isFinite(next))throw Error('域着色滚轮缩放超出有限数值范围');
   return this.mutate(()=>{this.runtime.setViewportScale(next);return this.snapshot();});
  }
  throw Error('域着色不支持此视口手势');
 }
 /** Generic Inspector value commit, distinct from full Apply and an animator
  * scalar write. No redraw or fresh frame is implied by the returned snapshot. */
 updateParameter(name:string,value:number):SourceDomainHostSnapshot {
  this.live();if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value))throw Error('域着色参数热写入需要字符串名称和有限值');
  return this.mutate(()=>{this.runtime.updateParameter(name,value);return this.snapshot();});
 }
 /** Reset/recording helpers can force looping without the toolbar resume clock reset. */
 forceResume():SourceDomainHostSnapshot {this.live();return this.mutate(()=>{this.hostClock.forceResume();return this.snapshot();});}
 /** Scene.reload preserves the current pause state but installs a fresh queue
  * and mobject. Input is a freshly prepared configuration, not a display clone. */
 applyConfiguration(configuration:SourceDomainSceneConfiguration):SourceDomainHostSnapshot {this.live();return this.fullLoad(configuration,{paused:this.hostClock.diagnostics().paused});}
 /** Explicit local seek, not native behavior. Frame zero is one fixed update;
  * simulation FPS and parameter-host FPS are separate required inputs. */
 reconstruct(displayFrame:number,simulationFps:number,frameRate:number):SourceDomainHostSnapshot {
  this.live();if(this.updateOrdinal!==-1)throw Error('域着色重建必须使用新的宿主');this.validateFixed(simulationFps);actualFps(frameRate);
  if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame/simulationFps>86400)throw Error('域着色重建帧必须是24小时内非负整数');
  return this.mutate(()=>{for(let i=0;i<=displayFrame;i++)this.advance(F(1/F(simulationFps)),false,frameRate);return this.snapshot();});
 }
 private validateFixed(fps:number):void {if(typeof fps!=='number'||!Number.isFinite(fps)||fps<1||fps>120)throw Error('域着色模拟帧率必须在1–120之间');}
 /** Native toolbar begin rebuilds the full-load anchor and forces running.
  * The returned first numerical update still needs a warmup render/discard. */
 beginRecording(simulationFps:number,frameRate:number):{handle:SourceDomainHostRecordingHandle;warmup:SourceDomainHostSnapshot} {
  this.live();this.validateFixed(simulationFps);actualFps(frameRate);const candidate=this.prepare(this.applied,false);
  return this.mutate(()=>{this.install(candidate);const handle=Object.freeze({recordingId:++this.serial});this.recording={handle,simulationFps,ordinal:0};this.advance(F(1/F(simulationFps)),false,frameRate);return{handle,warmup:this.snapshot()};});
 }
 private owned(handle:SourceDomainHostRecordingHandle){this.ensure();if(!this.recording||handle!==this.recording.handle)throw Error('域着色录制句柄不属于当前实例');return this.recording;}
 nextRecordingFrame(handle:SourceDomainHostRecordingHandle,ordinal:number,frameRate:number):SourceDomainHostSnapshot {
  const r=this.owned(handle);actualFps(frameRate);if(!Number.isSafeInteger(ordinal)||ordinal<1||ordinal!==r.ordinal+1||ordinal/r.simulationFps>86400||this.runtime.queueComplete)throw Error('域着色录制必须连续更新且不能越过队列终帧');
  return this.mutate(()=>{r.ordinal=ordinal;this.advance(F(1/F(r.simulationFps)),false,frameRate);return this.snapshot();});
 }
 /** disableRenderMode changes only wall-clock origin, leaving final numerical
  * state and running status intact. No extra object update or preview restore. */
 finishRecording(handle:SourceDomainHostRecordingHandle,timestampMs?:number):SourceDomainHostSnapshot {
  this.owned(handle);validateSourceSceneClockRequest({paused:false,timestampMs});return this.mutate(()=>{this.hostClock.resetTime(timestampMs);this.recording=undefined;return this.snapshot();});
 }
}
