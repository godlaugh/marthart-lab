import type {AnimationTrack,SceneOutput} from '../types';
import {runGenerationEffects,runGenerationEffectsAsync} from './generationEffects';
import type {SourceAttractorGpuAsyncBackend,SourceAttractorGpuAsyncFactory,SourceAttractorGpuDisplay,SourceAttractorGpuRaster} from './sourceAttractorGpuPrepared';
import {evaluateOrdinarySourceCameraTimeline,OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraParticles,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import {attractorParticleId} from './particleCamera';
import {SOURCE_CAMERA_MODEL,type SourceCameraScalars,type SourceCameraViewport} from './sourceCamera';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import {SourceAttractorGpu,admitSourceAttractorWebGlDisplay,SourceAttractorGpuError,SOURCE_ATTRACTOR_GPU_LIMITS,sourceAttractorGpuLayout,sourceAttractorGpuDisplayLayout,prepareSourceAttractorGpuWork,type SourceAttractorGpuOptions} from './sourceAttractorGpu';

export interface SourceAttractorGpuReplayOptions extends SourceAttractorGpuOptions {
 readonly camera:SourceCameraScalars;readonly tracks:readonly AnimationTrack[];readonly fps:number;readonly time:number;
}
/** Static initial CPU positions, never GPU readback or CPU warmup. Bind every
 * action first, then consume the original RNG stream through the highest id.
 * Unselected slots consume all source draws but do not require retained XYZ. */
function gpuTracking(options:SourceAttractorGpuOptions,update:()=>void,admit:(bytes:number)=>void=()=>{}){
 const {count}=sourceAttractorGpuLayout(options.configuration.particleCountGPU);
 const source=createSourceAttractorSeedStream(options.configuration);if(!source.ok)throw new SourceAttractorGpuError('input',source.error.reason);
 const positions=new Map<number,Float32Array>();let ready=false,maximum=-1;
 const particles:OrdinarySourceCameraParticles={
  bind(request){
   if(ready)throw new SourceAttractorGpuError('input','源 GPU 跟踪必须在播放前绑定');
   const index=request.action.args?.index;if(typeof index!=='number'||!Number.isFinite(index))throw new SourceAttractorGpuError('input','源 GPU 跟踪需要有限索引');
   const id=attractorParticleId(index,count);if(id===undefined)return{kind:'ignored',reason:'原版吸引子跟踪索引超出槽位范围；保留此前有效目标'};
   let values=positions.get(id);
   if(!values){admit((positions.size+1)*12);values=new Float32Array(3);positions.set(id,values);maximum=Math.max(maximum,id);}
   const captured=values;
   return{kind:'bound',readPosition:()=>{if(!ready)throw new SourceAttractorGpuError('input','源 GPU 跟踪绑定尚未完成');return[captured[0],captured[1],captured[2]] as [number,number,number];}};
  },
  finishBindings(){
   for(let id=0;id<=maximum;id++){
    if((id&255)===0&&options.isCancelled?.())throw new SourceAttractorGpuError('cancelled','源 GPU 跟踪初始化已取消');
    const next=source.value.next();if(!next.ok||!next.value)throw new SourceAttractorGpuError('input',next.ok?'源 GPU 初始化提前结束':next.error.reason);
    positions.get(id)?.set(next.value.position);
   }
   ready=true;
  },
  update,
  // Source GPU gradients do not construct a running palette animator.
  beginGradientActions(){},interpolateGradientActions(){},
 };
 return{particles,get retainedBytes(){return positions.size*12;}};
}
/** Pure camera queries own no GL context. Their update count is the native
 * queue's exact dispatch count, including zero-dt updates and completion. */
export function replaySourceAttractorGpu(options:SourceAttractorGpuReplayOptions){
 let updates=0;const tracking=gpuTracking(options,()=>updates++);
 const frame=evaluateOrdinarySourceCameraTimeline(options.camera,options.tracks,options.fps,options.time,{particleActions:'attractor',isCancelled:options.isCancelled,createParticles:()=>tracking.particles});
 return{frame,updates};
}
export interface SourceAttractorGpuDisplayOptions extends SourceAttractorGpuReplayOptions {
 readonly viewport:SourceCameraViewport;readonly width:number;readonly height:number;readonly backgroundColor:number;
}
export type SourceAttractorGpuDisplayRequest=Pick<SourceAttractorGpuDisplayOptions,'time'|'viewport'|'width'|'height'|'backgroundColor'|'isCancelled'>;
// Only failed retirements enter this set. Healthy live preview/export sessions
// must never be retired by an unrelated direct query.
const pendingDisposal=new Set<SourceAttractorGpuReplaySession>();
export function disposeSourceAttractorGpuRequests(){for(const owner of pendingDisposal)owner.reset();}

/** One native object lifetime: queue/static tracking and GPU textures advance
 * together. Total shader-work/pass limits still cover this entire lifetime. */
type ReplayEffect={kind:'evaluate';time:number}|{kind:'advance'}|{kind:'render';display:SourceAttractorGpuDisplay}|{kind:'reset';failures:readonly unknown[]};
export class SourceAttractorGpuReplaySession {
 private readonly options:SourceAttractorGpuOptions;
 private readonly timeline:OrdinarySourceCameraTimelineSession;
 private readonly cleanup=new GenerationCleanupState();
 private engine?:SourceAttractorGpu|SourceAttractorGpuAsyncBackend;
 private tracking?:ReturnType<typeof gpuTracking>;
 private updates=0;private constructions=0;
 private request?:SourceAttractorGpuDisplayRequest;
 private busy=false;private revoked=false;private active?:Promise<Extract<SceneOutput,{type:'raster'}>>;private resetting?:Promise<void>;private cleanupFailure?:unknown;
 constructor(options:SourceAttractorGpuReplayOptions,private readonly execution:{asyncBackend?:SourceAttractorGpuAsyncFactory}={}){
  this.options={configuration:structuredClone(options.configuration),visualConfiguration:structuredClone(options.visualConfiguration),shader:{...options.shader},retainedBytes:()=>this.tracking?.retainedBytes??0,isCancelled:()=>this.revoked||!!this.request?.isCancelled?.()};
  this.timeline=new OrdinarySourceCameraTimelineSession(options.camera,options.tracks,options.fps,{
   particleActions:'attractor',isCancelled:this.options.isCancelled,
   createParticles:()=>{this.retire();return this.replaceTracking();},
   createParticlesAsync:async()=>{await this.retireAsync();return this.replaceTracking();},
  });
  this.fps=options.fps;
 }
 private replaceTracking(){
  this.tracking=undefined;this.updates=0;
  this.tracking=gpuTracking(this.options,()=>this.updates++,bytes=>this.admitDisplay(this.request!,bytes));return this.tracking.particles;
 }
 private readonly fps:number;
 private retire(){if(this.execution.asyncBackend&&this.engine)throw Error('源原生吸引子需要异步清理');(this.engine as SourceAttractorGpu|undefined)?.dispose();this.engine=undefined;}
 private async retireAsync(){
  try{await this.engine?.dispose();}catch(error){this.cleanupFailure=error;throw error;}
  this.engine=undefined;this.cleanupFailure=undefined;
 }
 private clearState(){this.timeline.reset();this.tracking=undefined;this.updates=0;this.request=undefined;this.constructions=0;}
 reset(failures:readonly unknown[]=[]):void{
  if(this.busy||this.resetting)throw Error('源 GPU 吸引子请求尚未结束；需要 resetAsync');this.clearSync(failures);
 }
 private clearSync(failures:readonly unknown[]=[]){
  try{this.cleanup.reset(()=>{this.retire();this.clearState();},failures);pendingDisposal.delete(this);}
  catch(error){if(!this.execution.asyncBackend)pendingDisposal.add(this);throw error;}
 }
 private async clearAsync(failures:readonly unknown[]=[]){
  try{await this.retireAsync();this.clearState();pendingDisposal.delete(this);}
  catch(error){this.cleanupFailure=failures.length?new AggregateError([...failures,error],'原生吸引子清理失败；仍保留资源等待 resetAsync 重试'):error;throw this.cleanupFailure;}
 }
 async settle():Promise<void>{await this.active?.then(()=>undefined,()=>undefined);}
 resetAsync():Promise<void>{
  if(this.resetting)return this.resetting;this.revoked=true;
  const operation=(async()=>{const active=this.active;if(active){await this.settle();if(this.cleanupFailure)throw this.cleanupFailure;}await this.clearAsync();})();
  const settled=operation.finally(()=>{if(this.resetting===settled)this.resetting=undefined;});this.resetting=settled;return settled;
 }
 diagnostics(){const engine=this.engine?.diagnostics();return{constructions:this.constructions,updates:this.updates,trackingBytes:this.tracking?.retainedBytes??0,retainedBytes:(engine?.estimatedBytes??0)+(this.tracking?.retainedBytes??0),cleanupPending:!!this.cleanupFailure,engine};}
 private admitDisplay(request:SourceAttractorGpuDisplayRequest,trackingBytes=this.tracking?.retainedBytes??0){
  const layout=sourceAttractorGpuLayout(this.options.configuration.particleCountGPU),display=sourceAttractorGpuDisplayLayout(request.width,request.height);
  if(this.execution.asyncBackend){
   // The count floor remains shared, but native does not own WebGL's full
   // uploads/readback arrays. Its backend admits actual device+transfer+tracking.
   if(!Number.isSafeInteger(trackingBytes)||trackingBytes<0||trackingBytes>SOURCE_ATTRACTOR_GPU_LIMITS.bytes)throw new SourceAttractorGpuError('capacity','源 GPU 跟踪表示超过本地预算');
  }else admitSourceAttractorWebGlDisplay(layout,display,trackingBytes);
  if(!Number.isInteger(request.backgroundColor)||request.backgroundColor<0||request.backgroundColor>0xffffffff)throw new SourceAttractorGpuError('input','源 GPU 背景需要 uint32 ARGB');
 }
 private check(){if(this.options.isCancelled?.())throw new SourceAttractorGpuError('cancelled','源 GPU 吸引子回放已取消');}
 private enter(){if(this.busy||this.resetting)throw Error('源 GPU 吸引子请求正在进行');if(this.cleanupFailure)throw this.cleanupFailure;this.cleanup.prepare();disposeSourceAttractorGpuRequests();this.busy=true;this.revoked=false;}
 private perform(effect:ReplayEffect):unknown{
  switch(effect.kind){case'evaluate':return this.timeline.evaluate(effect.time);case'advance':return this.engine!.advance();case'render':return this.engine!.render(effect.display);case'reset':return this.clearSync(effect.failures);}
 }
 private performAsync(effect:ReplayEffect):unknown|Promise<unknown>{
  switch(effect.kind){case'evaluate':return this.timeline.evaluateAsync(effect.time);case'advance':return this.engine!.advance();case'render':return this.engine!.render(effect.display);case'reset':return this.clearAsync(effect.failures);}
 }
 generate(request:SourceAttractorGpuDisplayRequest):Extract<SceneOutput,{type:'raster'}>{
  if(this.execution.asyncBackend)throw Error('源原生吸引子需要 generateAsync');this.enter();
  try{return runGenerationEffects(this.generateOperation(request),effect=>this.perform(effect));}finally{this.busy=false;}
 }
 generateAsync(request:SourceAttractorGpuDisplayRequest):Promise<Extract<SceneOutput,{type:'raster'}>>{
  this.enter();const operation=runGenerationEffectsAsync(this.generateOperation(request),effect=>this.performAsync(effect));
  const settled=operation.finally(()=>{this.busy=false;if(this.active===settled)this.active=undefined;});this.active=settled;return settled;
 }
 private *generateOperation(request:SourceAttractorGpuDisplayRequest):Generator<ReplayEffect,Extract<SceneOutput,{type:'raster'}>,unknown>{
  const started=performance.now();
  try{
   this.request={...request,viewport:{...request.viewport}};this.check();this.admitDisplay(this.request);
   const frame=(yield{kind:'evaluate',time:this.request.time}) as OrdinarySourceCameraFrame;this.check();
   const sourceCameraFrame={model:SOURCE_CAMERA_MODEL,time:frame.time,frameIndex:frame.frameIndex,camera:structuredClone(frame.camera),viewport:{...this.request.viewport}},cameraPlan=prepareOrdinarySourceFrame(sourceCameraFrame);
   prepareSourceAttractorGpuWork(this.options.configuration,this.options.shader.operations,this.updates);
   if(!this.engine){this.engine=this.execution.asyncBackend?this.execution.asyncBackend(this.options):new SourceAttractorGpu(this.options);this.constructions++;}
   for(let i=this.engine.diagnostics().updatePasses;i<this.updates;i++){yield{kind:'advance'};this.check();}
   const raster=(yield{kind:'render',display:{width:this.request.width,height:this.request.height,cameraPlan,backgroundColor:this.request.backgroundColor}}) as SourceAttractorGpuRaster;this.check();
   return composeGpuOutput(raster,sourceCameraFrame,frame,this.fps,this.engine.layout.count,started);
  }catch(error){if(!this.cleanupFailure)yield{kind:'reset',failures:[error]};throw error;}
  finally{this.request=undefined;}
 }
}

function composeGpuOutput(raster:SourceAttractorGpuRaster,sourceCameraFrame:NonNullable<SceneOutput['sourceCameraFrame']>,frame:OrdinarySourceCameraFrame,fps:number,count:number,started:number):Extract<SceneOutput,{type:'raster'}>{
 return{type:'raster',cameraResolved:true,backend:raster.sourcePixelRenderer?.backend==='native'?'native':'webgl2',...raster,sourceCameraFrame,
  temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:fps,recordedPoints:0,cacheHits:0},
  stats:{samples:count,generated:count,invalid:0,elapsedMs:performance.now()-started},
  warnings:[...frame.diagnostics.map(d=>d.message),'源吸引子 GPU 使用 RK4 与逐帧浮点密度；相机跟踪保留初始 CPU 位置。原版 JVM/JOGL 完整画面尚未完成一致性验收。'],
 };
}
/** Independent direct queries must retire even successful output. Failed
 * cleanup remains owned in the ticket/set and blocks further allocation. */
export function generateSourceAttractorGpu(options:SourceAttractorGpuDisplayOptions):Extract<SceneOutput,{type:'raster'}>{
 disposeSourceAttractorGpuRequests();const owner=new SourceAttractorGpuReplaySession(options);
 return withGenerationCleanup(()=>owner.generate(options),owner);
}
