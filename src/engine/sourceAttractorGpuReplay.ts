import type {AnimationTrack,SceneOutput} from '../types';
import {evaluateOrdinarySourceCameraTimeline,type OrdinarySourceCameraParticles} from './ordinarySourceCameraTimeline';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import {attractorParticleId} from './particleCamera';
import {SOURCE_CAMERA_MODEL,type SourceCameraScalars,type SourceCameraViewport} from './sourceCamera';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {SourceAttractorGpu,SourceAttractorGpuError,sourceAttractorGpuLayout,prepareSourceAttractorGpuWork,type SourceAttractorGpuOptions} from './sourceAttractorGpu';

export interface SourceAttractorGpuReplayOptions extends SourceAttractorGpuOptions {
 readonly camera:SourceCameraScalars;readonly tracks:readonly AnimationTrack[];readonly fps:number;readonly time:number;
}
/** GPU getParticlePos returns the CPU Dot3D's original transformed seed. It
 * never reads the evolved texture and CPU warmup is skipped. This producer
 * owns those static references and records actual queue-dispatched updates. */
export function replaySourceAttractorGpu(options:SourceAttractorGpuReplayOptions){
 const {count}=sourceAttractorGpuLayout(options.configuration.particleCountGPU);
 const source=createSourceAttractorSeedStream(options.configuration);if(!source.ok)throw new SourceAttractorGpuError('input',source.error.reason);
 let positions:Float32Array|undefined,filled=0,updates=0;
 const particles:OrdinarySourceCameraParticles={
  bind(request){
   const index=request.action.args?.index;if(typeof index!=='number'||!Number.isFinite(index))throw new SourceAttractorGpuError('input','源 GPU 跟踪需要有限索引');
   const id=attractorParticleId(index,count);if(id===undefined)return{kind:'ignored',reason:'原版吸引子跟踪索引超出槽位范围；保留此前有效目标'};
   positions??=new Float32Array(count*3);
   while(filled<=id){if((filled&255)===0&&options.isCancelled?.())throw new SourceAttractorGpuError('cancelled','源 GPU 跟踪初始化已取消');const next=source.value.next();if(!next.ok||!next.value)throw new SourceAttractorGpuError('input',next.ok?'源 GPU 初始化提前结束':next.error.reason);positions.set(next.value.position,filled++*3);}
   const values=positions,at=id*3;return{kind:'bound',readPosition:()=>[values[at],values[at+1],values[at+2]] as [number,number,number]};
  },
  update(){updates++;},
  // Source GPU gradients do not construct a running palette animator.
  beginGradientActions(){},interpolateGradientActions(){},
 };
 const frame=evaluateOrdinarySourceCameraTimeline(options.camera,options.tracks,options.fps,options.time,{particleActions:'attractor',isCancelled:options.isCancelled,createParticles:()=>particles});
 return{frame,updates};
}
export interface SourceAttractorGpuDisplayOptions extends SourceAttractorGpuReplayOptions {
 readonly viewport:SourceCameraViewport;readonly width:number;readonly height:number;readonly backgroundColor:number;
}
// Normally empty. A failed cleanup cannot become an unowned context merely
// because the synchronous request unwound. Retry before admitting another.
const pendingDisposal=new Set<SourceAttractorGpu>();
export function disposeSourceAttractorGpuRequests(){for(const engine of pendingDisposal){engine.dispose();pendingDisposal.delete(engine);}}
/** Fresh replay owns one context and releases it after publishing RGBA8. No
 * particle readback or later renderer camera transform is involved. */
export function generateSourceAttractorGpu(options:SourceAttractorGpuDisplayOptions):Extract<SceneOutput,{type:'raster'}>{
 disposeSourceAttractorGpuRequests();
 const started=performance.now(),{frame,updates}=replaySourceAttractorGpu(options);
 const sourceCameraFrame={model:SOURCE_CAMERA_MODEL,time:frame.time,frameIndex:frame.frameIndex,camera:structuredClone(frame.camera),viewport:{...options.viewport}},cameraPlan=prepareOrdinarySourceFrame(sourceCameraFrame);
 prepareSourceAttractorGpuWork(options.configuration,options.shader.operations,updates);
 const engine=new SourceAttractorGpu(options);pendingDisposal.add(engine);
 try{
  for(let i=0;i<updates;i++)engine.advance();
  const raster=engine.render({width:options.width,height:options.height,cameraPlan,backgroundColor:options.backgroundColor});
  return{type:'raster',cameraResolved:true,backend:'webgl2',...raster,sourceCameraFrame,
   temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:options.fps,recordedPoints:0,cacheHits:0},
   stats:{samples:engine.layout.count,generated:engine.layout.count,invalid:0,elapsedMs:performance.now()-started},
   warnings:[...frame.diagnostics.map(d=>d.message),'源吸引子 GPU 使用 RK4 与逐帧浮点密度；相机跟踪保留初始 CPU 位置。原版 JVM/JOGL 完整画面尚未完成一致性验收。'],
  };
 }finally{engine.dispose();pendingDisposal.delete(engine);}
}
