import {SourceBouncingGpuError,SOURCE_BOUNCING_GPU_LIMITS} from '../engine/sourceBouncingLimits';
import {parseSourceBouncingView,sourceBouncingViewInput} from '../engine/sourceBouncingNavigation';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceBouncingScene,sourceBouncingCameraInput,sourceBouncingInitializationKey} from '../engine/sourceBouncingDocument';
import {parseSourceBouncingCheckpoint,sourceBouncingSeedCheckpoint,type SourceBouncingCheckpoint} from '../engine/sourceBouncingReplay';
import {prepareSourceBouncingSeeds,type SourceBouncingSeedDiagnostics} from '../engine/sourceBouncingSeeds';
import {SourceBouncingGpu,sourceBouncingGpuFrameLayout,sourceBouncingGpuUpdateWork,type SourceBouncingUpdate} from '../engine/sourceBouncingGpu';
import type {SourceBouncingResult} from '../engine/sourceBouncingConfig';
import {prepareSourceCamera,type SourceCameraScalars,type SourceCameraViewport} from '../engine/sourceCamera';
import {GenerationCleanupState} from '../engine/generationCleanup';

export interface SourceBouncingPresentationFrame {
 /** Measured renderer density of this delivered frame, never saved author configuration. */
 readonly pixelDensity:number;
 readonly checkpoint:SourceBouncingCheckpoint;
 readonly camera:SourceCameraScalars;
 readonly viewport:SourceCameraViewport;
}
function unwrap<T>(result:SourceBouncingResult<T>):T{
 if(!result.ok)throw new SourceBouncingGpuError(result.error.kind==='cancelled'?'cancelled':result.error.kind==='capacity'?'capacity':'input',`${result.error.path.join('.')}：${result.error.reason}`);
 return result.value;
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
   const payload=unwrap(prepareSourceBouncingScene(scene));
   const checkpoint=context.sourceBouncingFrame===undefined?sourceBouncingSeedCheckpoint():unwrap(parseSourceBouncingCheckpoint(context.sourceBouncingFrame));
   if(context.time!==checkpoint.sceneTime)throw new SourceBouncingGpuError('input','源弹跳需要与场景时间配对的显式更新检查点；不能由秒数推算粒子状态');
   const viewport=context.sourceViewport;
   if(!viewport||viewport.projectionPass!=='perspective')throw new SourceBouncingGpuError('input','源弹跳需要明确的逻辑画布尺寸与透视投影');
   const view=context.sourceBouncingView===undefined?undefined:unwrap(parseSourceBouncingView(context.sourceBouncingView));
   const camera=prepareSourceCamera(view?sourceBouncingViewInput(view):sourceBouncingCameraInput(payload),viewport);
   if(!camera.ok)throw camera.error;
   if(camera.value.kind!=='known')throw new SourceBouncingGpuError('input','源弹跳相机投影未知');
   const plan=camera.value.plan;
   sourceBouncingGpuFrameLayout(payload.configuration.particleCount,context.width,context.height,true,'transfer');
   const pixelDensity=context.sourcePointPixelDensity;
   if(typeof pixelDensity!=='number'||!Number.isSafeInteger(pixelDensity)||pixelDensity<1)throw new SourceBouncingGpuError('input','源弹跳需要已测量的正整数像素密度');
   if(context.width!==viewport.logicalWidth*pixelDensity||context.height!==viewport.logicalHeight*pixelDensity)throw new SourceBouncingGpuError('input','源弹跳物理尺寸必须等于逻辑尺寸乘以已测量的像素密度');
   // The canonical source owner already interpreted inputs. This key preserves
   // signed zero and omits display, camera and metadata edits deliberately.
   const key=sourceBouncingInitializationKey(payload.configuration);
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
   return{type:'raster',...image,cameraResolved:true,dimension:2,backend:'webgl2',
    sourceBouncingFrame:{pixelDensity,checkpoint,camera:structuredClone(plan.camera.value),viewport:{...viewport}},
    stats:{samples:payload.configuration.particleCount,generated:payload.configuration.particleCount,invalid:0,elapsedMs:performance.now()-started},
    warnings:['源弹跳按显式更新次数回放；原版 JVM/JOGL 完整画面尚未验收。'],
   };
  }catch(error){this.reset([error]);throw error;}
  finally{this.isCancelled=undefined;}
 }
}
