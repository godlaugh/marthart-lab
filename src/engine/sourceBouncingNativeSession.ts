import {ensureSourceNativeLease} from './sourceNativeLease';
import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import {prepareSourceBouncingFrame} from './sourceBouncingFramePlan';
import {requireSourceBouncing} from './sourceBouncingLimits';
import {prepareSourceBouncingSeeds} from './sourceBouncingSeeds';
import {sourceBouncingSeedsInWorker} from './sourceBouncingSeedWorker';
import {prepareSourceBouncingDrawing,sourceBouncingDrawingFrame} from './sourceBouncingDrawing';
import {sourceBouncingGpuUpdateWork,type SourceBouncingUpdate} from './sourceBouncingGpu';
import {SOURCE_BOUNCING_GPU_LIMITS} from './sourceBouncingLimits';
import {sourceBouncingProgramBytes,sourceBouncingRetainedBytes,type SourceBouncingOperation} from './sourceBouncingOperation';
import {sourceBouncingNativeQuad,sourceBouncingNativeUpdateFragment,sourceBouncingNativeTextureVertex,sourceBouncingNativeFragment} from './sourceBouncingGpuShader';
import {controlSourceBouncingState,renderSourceNativeFrame,SourceNativeError} from './sourceNativeClient';
import {encodeSourceDrawingFrame,SOURCE_FRAME_BUDGET,type SourceDrawingFrame} from './sourceDrawingFrame';
const shaders={quad:sourceBouncingNativeQuad,update:sourceBouncingNativeUpdateFragment,vertex:sourceBouncingNativeTextureVertex,fragment:sourceBouncingNativeFragment};
const programBytes=sourceBouncingProgramBytes(shaders),chunkFloats=1048576;
const aborted=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('源弹跳生成已取消','AbortError');};
type OwnedState={owner:object;resource:string;particleCount:number;programBytes:number;key:string;update:SourceBouncingUpdate;updates:number;uploaded:number;ready:boolean;renderer?:string;cleanupPending:boolean};
let nextGeneration=0;
/** One page owns the backend's one retained resource. Generator instances use
 * this coordinator for preview and export. An idle resource may be transferred
 * between callers, but an active operation is never stolen or queued. */
export class SourceBouncingNativeSession {
 private state?:OwnedState;
 private active?:{owner:object;controller:AbortController;settled:Promise<void>};
 private retiring?:Promise<void>;
 private readonly generation=++nextGeneration;
 private sequence=0;
 private counters={initializations:0,uploadBytes:0,draws:0,recoveries:0};
 private identity(){if(this.sequence===0xffffffff)throw new SourceNativeError('capacity','原生帧序号已用尽');return{generation:this.generation,sequence:++this.sequence};}
 private controlFrame(operation:SourceBouncingOperation):SourceDrawingFrame{return{...this.identity(),width:1,height:1,samples:0,clear:[0,0,0,0],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0},bouncing:operation};}
 private async cleanup(){
  const state=this.state;if(!state)return;
  state.cleanupPending=true;
  try{await controlSourceBouncingState(this.controlFrame({kind:'release',resource:state.resource}));}
  catch(error){
   // The single-resource service positively identifies a different resource;
   // it did not release it. Our old resource cannot coexist with that owner.
   if(!(error instanceof SourceNativeError&&error.kind==='ownership'))throw error;
  }
  if(this.state===state)this.state=undefined;
 }
 private checkRenderer(state:OwnedState,identity:string){if(state.renderer&&state.renderer!==identity)throw new SourceNativeError('protocol','保留状态的原生后端身份发生变化');state.renderer=identity;}
 async settleCancellation(){if(this.active?.controller.signal.aborted)await this.active.settled;}
 owns(owner:object){return this.active?.owner===owner||this.state?.owner===owner;}
 diagnostics(){return{...this.counters,active:!!this.active,owned:!!this.state,ready:this.state?.ready??false,updates:this.state?.updates??0,uploaded:this.state?.uploaded??0,cleanupPending:this.state?.cleanupPending??false,retainedBytes:this.state?sourceBouncingRetainedBytes(this.state.particleCount,programBytes):0};}
 /** Remains awaitable after synchronous UI cancellation. Failure preserves the
  * token and cleanup obligation; the next acquisition retries before creating. */
 release(owner:object):Promise<void>{
  const active=this.active;
  if(active){if(active.owner!==owner)return Promise.resolve();active.controller.abort();return active.settled.then(()=>this.release(owner));}
  if(this.state?.owner!==owner)return Promise.resolve();
  if(!this.retiring)this.retiring=this.cleanup().finally(()=>{this.retiring=undefined;});
  return this.retiring;
 }
 generate(owner:object,scene:SceneDocument,input:GenerationInput):Promise<SceneOutput>{
  if(this.active)return Promise.reject(new SourceNativeError('capacity','已有原生弹跳任务；请等待完成或取消'));
  let plan:ReturnType<typeof prepareSourceBouncingFrame>;
  try{plan=prepareSourceBouncingFrame(scene,input);}catch(error){return Promise.reject(error);}
  const controller=new AbortController(),active={owner,controller,settled:Promise.resolve()};this.active=active;
  // Transfer only the local lease. A previous Generator's delayed dispose must
  // not release state now used by this request.
  if(this.state)this.state.owner=owner;
  const task=(async()=>{
   const started=performance.now(),signal=controller.signal;
   try{
    if(this.retiring)await this.retiring;aborted(signal);await ensureSourceNativeLease(signal);aborted(signal);
    if(this.state?.cleanupPending)await this.cleanup();
    const prepared=requireSourceBouncing(prepareSourceBouncingSeeds(plan.payload.configuration));
    for(let attempt=0;attempt<2;attempt++){
     if(this.state&&(this.state.key!==plan.key||plan.checkpoint.simulationUpdates<this.state.updates))await this.cleanup();
     const from=this.state?.updates??0,work=sourceBouncingGpuUpdateWork(prepared.count,prepared.update)*(plan.checkpoint.simulationUpdates-from);
     if(!Number.isSafeInteger(work)||work>SOURCE_BOUNCING_GPU_LIMITS.collisionEdgeWork)throw new SourceNativeError('capacity','源弹跳本次重放超过 1,000,000,000 碰撞工作量；请使用较近的更新索引');
     const drawing=prepareSourceBouncingDrawing(prepared.count,{width:input.width,height:input.height,cameraPlan:plan.camera,visualConfiguration:plan.payload.visual,initialSpeed:plan.payload.configuration.initialSpeed,boundary:prepared.update.boundary});
     if(!this.state){
      const seedBytes=prepared.count*16;
      if(sourceBouncingRetainedBytes(prepared.count,programBytes)+seedBytes+6*(Math.min(seedBytes,chunkFloats*4)+256)+12>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','初始粒子、上传副本与原生状态超过容量');
      const resource=crypto.randomUUID().replaceAll('-',''),metadata={resource,particleCount:prepared.count,programBytes};
      const create=this.controlFrame({kind:'create',...metadata,shaders}),admission=encodeSourceDrawingFrame(create,{retainedBytes:seedBytes});if(!admission.ok)throw new SourceNativeError(admission.error.kind,admission.error.reason);
      let seeds=await sourceBouncingSeedsInWorker(plan.payload.configuration,signal);aborted(signal);
      const state:OwnedState={owner,...metadata,key:plan.key,update:prepared.update,updates:0,uploaded:0,ready:false,cleanupPending:false};this.state=state;
      const created=await controlSourceBouncingState(create,{signal,retainedBytes:seeds.state.byteLength});this.checkRenderer(state,created.rendererIdentity);this.counters.initializations++;
      for(let offset=0;offset<seeds.state.length;offset+=chunkFloats){
       const particles=seeds.state.subarray(offset,Math.min(offset+chunkFloats,seeds.state.length));
       const result=await controlSourceBouncingState(this.controlFrame({kind:'upload',...metadata,offset:offset/4,particles}),{signal});this.checkRenderer(state,result.rendererIdentity);state.uploaded=result.uploadedParticles;this.counters.uploadBytes+=particles.byteLength;
      }
      // Drop the transferred seed buffer before allocating/reading a frame.
      seeds={...seeds,state:new Float32Array()};state.ready=state.uploaded===state.particleCount;
     }
     const state=this.state!;aborted(signal);if(!state.ready)throw new SourceNativeError('protocol','原生状态尚未完成上传');
     const frame=sourceBouncingDrawingFrame(drawing,this.identity(),{kind:'retained',operation:{kind:'draw',resource:state.resource,particleCount:state.particleCount,programBytes:state.programBytes,from:state.updates,to:plan.checkpoint.simulationUpdates,update:state.update}});
     try{
      const image=await renderSourceNativeFrame(frame,{signal});this.checkRenderer(state,image.rendererIdentity);aborted(signal);state.updates=plan.checkpoint.simulationUpdates;this.counters.draws++;
      return{type:'raster',formulaPresentation:plan.formulas,width:image.width,height:image.height,pixels:image.pixels,cameraResolved:true,dimension:2,backend:'native',sourcePixelRenderer:{backend:'native',identity:image.rendererIdentity,generation:image.generation,sequence:image.sequence,samples:0},sourceBouncingFrame:{pixelDensity:plan.pixelDensity,checkpoint:plan.checkpoint,camera:structuredClone(plan.camera.camera.value),viewport:{...plan.viewport}},stats:{samples:state.particleCount,generated:state.particleCount,invalid:0,elapsedMs:performance.now()-started},warnings:[]} satisfies SceneOutput;
     }catch(error){if(attempt===0&&error instanceof SourceNativeError&&error.kind==='state-lost'&&!signal.aborted){await this.cleanup();this.counters.recoveries++;continue;}throw error;}
    }
    throw new SourceNativeError('state-lost','原生状态恢复失败');
   }catch(error){try{await this.cleanup();}catch(cleanup){throw new AggregateError([error,cleanup],'源弹跳生成失败，原生资源清理仍待重试');}throw error;}
   finally{if(this.active===active)this.active=undefined;}
  })();
  active.settled=task.then(()=>{},()=>{});return task;
 }
}
export const sourceBouncingNativeSession=new SourceBouncingNativeSession();
