import {prepareSourceBouncingFrame} from '../engine/sourceBouncingFramePlan';
import {requireSourceBouncing as unwrap} from '../engine/sourceBouncingLimits';
import {SourceBouncingGpuError,SOURCE_BOUNCING_GPU_LIMITS} from '../engine/sourceBouncingLimits';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {type SourceBouncingCheckpoint} from '../engine/sourceBouncingReplay';
import {prepareSourceBouncingSeeds,type SourceBouncingSeedDiagnostics} from '../engine/sourceBouncingSeeds';
import {SourceBouncingGpu,sourceBouncingGpuFrameLayout,sourceBouncingGpuUpdateWork,type SourceBouncingUpdate} from '../engine/sourceBouncingGpu';
import {type SourceCameraScalars,type SourceCameraViewport} from '../engine/sourceCamera';
import {GenerationCleanupState} from '../engine/generationCleanup';

export interface SourceBouncingPresentationFrame {
 /** Measured renderer density of this delivered frame, never saved author configuration. */
 readonly pixelDensity:number;
 readonly checkpoint:SourceBouncingCheckpoint;
 readonly camera:SourceCameraScalars;
 readonly viewport:SourceCameraViewport;
}
/** One worker owns the state textures. Absolute checkpoints make coalesced
 * requests replayable: seconds never select a number of physics updates. */
export class SourceBouncingSession {
 private readonly cleanup=new GenerationCleanupState();
 private gpu?:SourceBouncingGpu;
 private update?:SourceBouncingUpdate;
 private key='';
 private updates=0;
 private isCancelled?:()=>boolean;
 private seedDiagnostics?:SourceBouncingSeedDiagnostics;
 reset(failures:readonly unknown[]=[]):void{
  this.cleanup.reset(()=>{
   // Keep the owning reference until disposal succeeds, including retry.
   this.gpu?.dispose();this.gpu=undefined;this.update=undefined;
   this.key='';this.updates=0;this.seedDiagnostics=undefined;this.isCancelled=undefined;
  },failures);
 }
 diagnostics(){const gpu=this.gpu?.diagnostics();return{simulationUpdates:this.updates,retainedBytes:gpu?.retainedBytes??0,seed:this.seedDiagnostics,gpu};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput{
  this.cleanup.prepare();
  const started=performance.now();
  try{
   const {payload,checkpoint,viewport,pixelDensity,formulas,camera:plan,key}=prepareSourceBouncingFrame(scene,context);
   sourceBouncingGpuFrameLayout(payload.configuration.particleCount,context.width,context.height,true,'transfer');
   if(key!==this.key||checkpoint.simulationUpdates<this.updates)this.reset();
   this.isCancelled=context.isCancelled;
   if(this.isCancelled?.())throw new SourceBouncingGpuError('cancelled','源弹跳生成已取消');
   const prepared=this.gpu?undefined:unwrap(prepareSourceBouncingSeeds(payload.configuration,{isCancelled:()=>this.isCancelled?.()??false}));
   const update=this.update??prepared!.update;
   const work=sourceBouncingGpuUpdateWork(payload.configuration.particleCount,update)*(checkpoint.simulationUpdates-this.updates);
   if(!Number.isSafeInteger(work)||work>SOURCE_BOUNCING_GPU_LIMITS.collisionEdgeWork)throw new SourceBouncingGpuError('capacity','源弹跳本次重放超过 1,000,000,000 碰撞工作量；请使用较近的更新索引');
   if(!this.gpu){
    const seeds=unwrap(prepared!.generate());
    this.update=seeds.update;
    this.seedDiagnostics=seeds.diagnostics;
    this.gpu=SourceBouncingGpu.takeState(seeds.state,()=>this.isCancelled?.()??false);
    this.key=key;
   }
   while(this.updates<checkpoint.simulationUpdates){this.gpu.advance(this.update!);this.updates++;}
   const image=this.gpu.render({width:context.width,height:context.height,cameraPlan:plan,visualConfiguration:payload.visual,initialSpeed:payload.configuration.initialSpeed,boundary:this.update!.boundary});
   return{type:'raster',formulaPresentation:formulas,...image,cameraResolved:true,dimension:2,backend:'webgl2',
    sourceBouncingFrame:{pixelDensity,checkpoint,camera:structuredClone(plan.camera.value),viewport:{...viewport}},
    stats:{samples:payload.configuration.particleCount,generated:payload.configuration.particleCount,invalid:0,elapsedMs:performance.now()-started},
    warnings:['源弹跳按显式更新次数回放；原版 JVM/JOGL 完整画面尚未验收。'],
   };
  }catch(error){this.reset([error]);throw error;}
  finally{this.isCancelled=undefined;}
 }
}
