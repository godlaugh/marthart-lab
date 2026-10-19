import type {AnimationTrack,SceneOutput} from '../types';
import {evaluateOrdinarySourceCameraTimeline,OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraParticles,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import {attractorParticleId} from './particleCamera';
import {SOURCE_CAMERA_MODEL,type SourceCameraScalars,type SourceCameraViewport} from './sourceCamera';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import {SourceAttractorGpu,SourceAttractorGpuError,SOURCE_ATTRACTOR_GPU_LIMITS,sourceAttractorGpuLayout,sourceAttractorGpuDisplayLayout,prepareSourceAttractorGpuWork,type SourceAttractorGpuOptions} from './sourceAttractorGpu';

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
type DisplayRequest=Pick<SourceAttractorGpuDisplayOptions,'time'|'viewport'|'width'|'height'|'backgroundColor'|'isCancelled'>;
// Only failed retirements enter this set. Healthy live preview/export sessions
// must never be retired by an unrelated direct query.
const pendingDisposal=new Set<SourceAttractorGpuReplaySession>();
export function disposeSourceAttractorGpuRequests(){for(const owner of pendingDisposal)owner.reset();}

/** One native object lifetime: queue/static tracking and GPU textures advance
 * together. Total shader-work/pass limits still cover this entire lifetime. */
export class SourceAttractorGpuReplaySession {
 private readonly options:SourceAttractorGpuOptions;
 private readonly timeline:OrdinarySourceCameraTimelineSession;
 private readonly cleanup=new GenerationCleanupState();
 private engine?:SourceAttractorGpu;
 private tracking?:ReturnType<typeof gpuTracking>;
 private updates=0;private constructions=0;
 private request?:DisplayRequest;
 constructor(options:SourceAttractorGpuReplayOptions){
  this.options={configuration:structuredClone(options.configuration),visualConfiguration:structuredClone(options.visualConfiguration),shader:{...options.shader},isCancelled:()=>this.request?.isCancelled?.()??false};
  this.timeline=new OrdinarySourceCameraTimelineSession(options.camera,options.tracks,options.fps,{
   particleActions:'attractor',isCancelled:this.options.isCancelled,
   createParticles:()=>{
    // Reverse seeks replace a generation only after its GPU retirement succeeds.
    this.retire();this.tracking=undefined;this.updates=0;
    this.tracking=gpuTracking(this.options,()=>this.updates++,bytes=>this.admitDisplay(this.request!,bytes));
    return this.tracking.particles;
   },
  });
  this.fps=options.fps;
 }
 private readonly fps:number;
 private retire(){this.engine?.dispose();this.engine=undefined;}
 reset(failures:readonly unknown[]=[]):void{
  try{this.cleanup.reset(()=>{this.retire();this.timeline.reset();this.tracking=undefined;this.updates=0;this.request=undefined;this.constructions=0;},failures);pendingDisposal.delete(this);}
  catch(error){pendingDisposal.add(this);throw error;}
 }
 diagnostics(){const engine=this.engine?.diagnostics();return{constructions:this.constructions,updates:this.updates,trackingBytes:this.tracking?.retainedBytes??0,retainedBytes:(engine?.estimatedBytes??0)+(this.tracking?.retainedBytes??0),engine};}
 private admitDisplay(request:DisplayRequest,trackingBytes=this.tracking?.retainedBytes??0){
  const layout=sourceAttractorGpuLayout(this.options.configuration.particleCountGPU),display=sourceAttractorGpuDisplayLayout(request.width,request.height);
  if(layout.bytes+display.bytes+trackingBytes>SOURCE_ATTRACTOR_GPU_LIMITS.bytes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子跟踪、附件与上传表示合计超过本地 256 MiB 预算');
  if(!Number.isInteger(request.backgroundColor)||request.backgroundColor<0||request.backgroundColor>0xffffffff)throw new SourceAttractorGpuError('input','源 GPU 背景需要 uint32 ARGB');
 }
 generate(request:DisplayRequest):Extract<SceneOutput,{type:'raster'}>{
  this.cleanup.prepare();disposeSourceAttractorGpuRequests();const started=performance.now();
  try{
   this.request=request;this.admitDisplay(request);
   const frame=this.timeline.evaluate(request.time);
   const sourceCameraFrame={model:SOURCE_CAMERA_MODEL,time:frame.time,frameIndex:frame.frameIndex,camera:structuredClone(frame.camera),viewport:{...request.viewport}},cameraPlan=prepareOrdinarySourceFrame(sourceCameraFrame);
   // Inspect cumulative updates before allocation or driver submission. Each
   // advance still charges the same lifetime counters inside the GPU owner.
   prepareSourceAttractorGpuWork(this.options.configuration,this.options.shader.operations,this.updates);
   if(!this.engine){this.engine=new SourceAttractorGpu(this.options);this.constructions++;}
   for(let i=this.engine.diagnostics().updatePasses;i<this.updates;i++)this.engine.advance();
   const raster=this.engine.render({width:request.width,height:request.height,cameraPlan,backgroundColor:request.backgroundColor});
   return composeGpuOutput(raster,sourceCameraFrame,frame,this.fps,this.engine.layout.count,started);
  }catch(error){this.reset([error]);throw error;}
  finally{this.request=undefined;}
 }
}
function composeGpuOutput(raster:{width:number;height:number;pixels:Uint8ClampedArray},sourceCameraFrame:NonNullable<SceneOutput['sourceCameraFrame']>,frame:OrdinarySourceCameraFrame,fps:number,count:number,started:number):Extract<SceneOutput,{type:'raster'}>{
 return{type:'raster',cameraResolved:true,backend:'webgl2',...raster,sourceCameraFrame,
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
