import {sourceSamilaSceneIdentity} from './sourceSamilaIdentity';
import {snapshotGenerationInput} from './generationInput';
import {retainsIteratedCompiler} from './iteratedIdentity';
import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {rootsPresentationRequestIdentity} from './rootsPresentationRequest';
import type {RootsPausedCaptureResult,RootsPausedCaptureSize,PerlinPausedCaptureResult,PerlinPausedCaptureSize,PausedCaptureSize,PausedCaptureResult,PerlinRecordingOptions,PerlinRecordingHandle,PerlinRecordingStart,PerlinRecordingStop,PerlinRecordingRaster} from './generationProtocol';
import {pausedCaptureContracts,PerlinRecordingOperationError} from './generationProtocol';
import {usesSourceBouncing} from './sourceBouncingDocument';
import {usesSourcePerlin} from './sourcePerlinIdentity';
type Context=GenerationInput;
interface GeneratorPort {
  generate(scene:SceneDocument,context:Context,onProgress?:(output:SceneOutput)=>void):Promise<SceneOutput>;
  cancel():void;
  dispose():void;
  captureRootsPaused?(output:SceneOutput,size:RootsPausedCaptureSize,scale?:1|3|5):Promise<RootsPausedCaptureResult>;
  capturePerlinPaused?(output:SceneOutput,size:PerlinPausedCaptureSize,scale?:1|3|5):Promise<PerlinPausedCaptureResult>;
  captureSamilaPaused?(output:SceneOutput,size:PausedCaptureSize,scale?:1|3|5):Promise<PausedCaptureResult>;
  beginPerlinRecording?(output:SceneOutput,options:PerlinRecordingOptions):Promise<PerlinRecordingStart>;
  nextPerlinRecordingFrame?(handle:PerlinRecordingHandle,displayFrame:number):Promise<PerlinRecordingRaster>;
  finishPerlinRecording?(handle:PerlinRecordingHandle):Promise<PerlinRecordingStop>;
  hasPerlinRecording?(handle:PerlinRecordingHandle):boolean;
}
interface Request {scene:SceneDocument;context:Context;intent?:'metadata';}
export interface PerlinRecordingConsumer {
  start?:(start:PerlinRecordingStart)=>void|Promise<void>;
  frame:(frame:PerlinRecordingRaster,encodedIndex:number,start:PerlinRecordingStart)=>void|Promise<void>;
}
interface RecordingOwner {request:Request;stop:boolean;active:boolean;handle?:PerlinRecordingHandle;cleanup?:Promise<void>;invalidPreview?:Error;}
// Component teardown must not discard the only reference to a failed release.
// These owners are retried explicitly, or once when another queue is created.
const retiredQueues=new Set<GenerationQueue>();
export async function retryRetiredGenerationQueueCleanup():Promise<void>{
  const results=await Promise.allSettled([...retiredQueues].map(queue=>queue.retryPerlinRecordingCleanup()));
  const errors=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);
  if(errors.length)throw new AggregateError(errors,'已卸载预览的 Perlin 录制清理仍未完成');
}
/** Coalesce time changes while retaining the latest requested frame. Domain
 * native Roots and continuous Map/Symmetry edits retain their renderer instance; an
 * explicit cancel or a different document creates a new instance. */
export class GenerationQueue {
  private latest:Request|null=null;
  private running:Request|null=null;
  private completedSamila?:{request:Request;output:SceneOutput};
  private timer:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  private captureOwner?:{retire:boolean};
  private recordingOwner?:RecordingOwner;
  constructor(private readonly generator:GeneratorPort,private readonly callbacks:{output:(output:SceneOutput,time:number,source:SceneDocument)=>void;error:(error:Error)=>void;busy:(value:boolean)=>void;recordingStopped?:(stop:PerlinRecordingStop,originalScene:SceneDocument)=>void}){
    if(retiredQueues.size)void retryRetiredGenerationQueueCleanup().catch(error=>{if(!this.disposed)this.callbacks.error(error);});
  }
  request(scene:SceneDocument,context:Context,delayMs=0,intent?:'metadata'){
    if(this.disposed)return;
    const previous=this.latest?.scene,sceneChanged=previous!==scene;
    const sameIterated=!!previous&&previous.id===scene.id&&previous.kind===scene.kind&&retainsIteratedCompiler(previous)&&retainsIteratedCompiler(scene);
    const sameDomain=previous?.kind==='domain'&&scene.kind==='domain'&&previous.id===scene.id;
    const sameSourceBouncing=!!previous&&usesSourceBouncing(previous)&&usesSourceBouncing(scene)&&previous.id===scene.id;
    const sameSourcePerlin=!!previous&&usesSourcePerlin(previous)&&usesSourcePerlin(scene)&&previous.id===scene.id;
    const liveToken=scene.kind==='samila'?context.samilaLive?.sessionId:undefined,previousLiveToken=previous?.kind==='samila'?this.latest?.context.samilaLive?.sessionId:undefined;
    const sameSamila=typeof liveToken==='string'&&liveToken.trim().length>0&&liveToken===previousLiveToken;
    const samilaIdentityChanged=(liveToken!==undefined||previousLiveToken!==undefined)&&!sameSamila;
    const native=usesRootsNativePresentation(scene),nativeIdentity=native?rootsPresentationRequestIdentity(scene,context.rootsSessionId):undefined;
    const previousNative=!!previous&&usesRootsNativePresentation(previous);
    const sameNativeRoots=previousNative&&native&&rootsPresentationRequestIdentity(previous!,this.latest?.context.rootsSessionId)===nativeIdentity;
    const nativeIdentityChanged=previousNative&&native&&!sameNativeRoots;
    this.latest={scene,context:snapshotGenerationInput(context),intent};
    // A recording leases this exact worker, including while begin is pending.
    // Keep only the newest editor request without cancelling that lease.
    if(this.recordingOwner){this.callbacks.busy(true);this.retryRecordingInBackground();return;}
    if((sceneChanged&&!sameDomain&&!sameNativeRoots&&!sameSourceBouncing&&!sameSourcePerlin&&!sameIterated&&!sameSamila)||nativeIdentityChanged||samilaIdentityChanged){
      this.running=null;this.completedSamila=undefined;clearTimeout(this.timer);this.timer=undefined;
      // A capture owns two sequential displays. Retire only after its owner
      // finishes restoring the primary destination, even on document replace.
      if(this.captureOwner)this.captureOwner.retire=true;else this.generator.cancel();
    }
    this.callbacks.busy(true);
    if(this.running||this.captureOwner||this.timer!==undefined)return;
    if(delayMs>0)this.timer=setTimeout(()=>{this.timer=undefined;this.start();},delayMs);
    else this.start();
  }
  private start(){
    if(this.disposed||this.running||this.captureOwner||this.recordingOwner||!this.latest)return;
    const request=this.latest,cached=this.completedSamila;
    // Metadata edits rebind the exact completed capability, without a draw.
    // The owner supplies the render identity; transport facts must also match.
    if(cached&&request.intent==='metadata'&&request.context.samilaLive&&request.scene!==cached.request.scene&&sourceSamilaSceneIdentity(request.scene)===sourceSamilaSceneIdentity(cached.request.scene)&&JSON.stringify(request.context)===JSON.stringify(cached.request.context)){
      this.completedSamila={request,output:cached.output};
      this.callbacks.output(cached.output,request.context.time,request.scene);this.callbacks.busy(false);return;
    }
    this.completedSamila=undefined;this.running=request;
    const current=()=>!this.disposed&&this.running===request;
    // Source Bouncing can change only its runtime view while scene/time stay
    // identical. Retain its GPU work, but publish only the latest request.
    const publishable=()=>current()&&this.latest?.scene===request.scene&&(!(usesSourceBouncing(request.scene)||request.context.samilaLive!==undefined)||this.latest===request);
    const publish=(output:SceneOutput,time=request.context.time)=>{if(publishable())this.callbacks.output(output,time,request.scene);};
    void this.generator.generate(request.scene,request.context,output=>publish(output,output.temporal?.time??request.context.time)).then(output=>{if(current()&&request.context.samilaLive)this.completedSamila={request,output};publish(output);}).catch((error:Error)=>{
      if(publishable()&&error.name!=='AbortError')this.callbacks.error(error);
    }).finally(()=>{
      if(!current())return;
      this.running=null;
      if(this.latest!==request)this.start();else this.callbacks.busy(false);
    });
  }
  captureRootsPaused(output:SceneOutput,size:RootsPausedCaptureSize,scale:1|3|5=1):Promise<SceneOutput>{
    return this.capturePaused('captureRootsPaused',output,size,scale);
  }
  capturePerlinPaused(output:SceneOutput,size:PerlinPausedCaptureSize,scale:1|3|5=1):Promise<SceneOutput>{
    return this.capturePaused('capturePerlinPaused',output,size,scale);
  }
  captureSamilaPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<SceneOutput>{
    return this.capturePaused('captureSamilaPaused',output,size,scale);
  }
  private async capturePaused(method:'captureRootsPaused'|'capturePerlinPaused'|'captureSamilaPaused',output:SceneOutput,size:PausedCaptureSize,scale:1|3|5):Promise<SceneOutput>{
    if(this.recordingOwner&&!this.recordingOwner.active)await this.retryPerlinRecordingCleanup();
    const request=this.latest,capture=this.generator[method],contract=pausedCaptureContracts[method==='captureRootsPaused'?'roots-paused-capture':method==='capturePerlinPaused'?'perlin-paused-capture':'samila-paused-capture'];
    if(this.disposed||this.running||this.captureOwner||this.recordingOwner||this.timer!==undefined||!request||!capture)
      throw new Error(`请等待当前${contract.label}预览完成后再保存暂停画面`);
    const cached=this.completedSamila;this.completedSamila=undefined;
    const ticket={retire:false};this.captureOwner=ticket;this.callbacks.busy(true);
    const current=()=>!this.disposed&&this.captureOwner===ticket;
    try{
      const result=await capture.call(this.generator,output,size,scale);
      if(current()&&request.context.samilaLive)this.completedSamila={request,output:result.preview};
      if(!current()||this.latest!==request)throw new DOMException('截图期间场景已改变','AbortError');
      // Source capture also redraws the primary destination. Publish that
      // result even if the caller has abandoned its PNG download.
      this.callbacks.output(result.preview,request.context.time,request.scene);
      return result.capture;
    }catch(error){
      if(current()&&error instanceof contract.Error&&error.previewRetained)this.completedSamila=cached;
      if(current()&&this.latest===request&&error instanceof Error&&error.name!=='AbortError'&&!(error instanceof contract.Error&&error.previewRetained))this.callbacks.error(error);
      throw error;
    }finally{
      if(this.captureOwner===ticket){
        this.captureOwner=undefined;
        if(this.disposed)this.generator.dispose();
        else {
          if(ticket.retire){this.completedSamila=undefined;this.generator.cancel();}
          if(this.latest&&this.latest!==request)this.start();else this.callbacks.busy(false);
        }
      }
    }
  }
  /** Consume one encoded frame at a time. Warmup is delivered only to start;
   * the next worker frame is not requested until the consumer has finished. */
  async recordPerlin(output:SceneOutput,options:PerlinRecordingOptions,consumer:PerlinRecordingConsumer,signal?:AbortSignal):Promise<void>{
    if(this.recordingOwner&&!this.recordingOwner.active)await this.retryPerlinRecordingCleanup();
    const request=this.latest;
    if(this.disposed||this.running||this.captureOwner||this.recordingOwner||this.timer!==undefined||!request||!this.generator.beginPerlinRecording||!this.generator.nextPerlinRecordingFrame||!this.generator.finishPerlinRecording||!this.generator.hasPerlinRecording)
      throw new Error('请等待当前 Perlin 预览或录制完成');
    if(signal?.aborted)throw new DOMException('Perlin 录制已取消','AbortError');
    const owner:RecordingOwner={request,stop:false,active:true};this.recordingOwner=owner;this.callbacks.busy(true);
    const abort=()=>{owner.stop=true;},check=()=>{if(owner.stop||signal?.aborted)throw new DOMException('Perlin 录制已取消','AbortError');};
    signal?.addEventListener('abort',abort,{once:true});
    let failed=false,failure:unknown;
    try{
      const start=await this.generator.beginPerlinRecording(output,options);owner.handle=start.handle;
      const lastDisplayFrame=start.clock.lastDisplayFrame,handle=start.handle;
      check();await consumer.start?.(start);check();
      for(let displayFrame=1;displayFrame<=lastDisplayFrame;displayFrame++){
        const frame=await this.generator.nextPerlinRecordingFrame(handle,displayFrame);
        check();await consumer.frame(frame,displayFrame-1,start);check();
      }
    }catch(error){
      if(error instanceof PerlinRecordingOperationError&&error.recordingRetained&&error.handle)owner.handle=error.handle;
      if(error instanceof PerlinRecordingOperationError&&!error.previewRetained)owner.invalidPreview=error;
      failed=true;failure=error;
    }finally{
      signal?.removeEventListener('abort',abort);owner.active=false;
      try{await this.finishRecordingOwner(owner);}catch(error){
        failure=failed?new AggregateError([failure,error],'Perlin 录制失败且停止清理未完成'):error;failed=true;
      }
    }
    if(failed)throw failure;
  }
  /** A failed finish keeps its handle and worker owned. Retrying is explicit
   * and also happens on the next request/cancel/dispose, never via terminate. */
  retryPerlinRecordingCleanup():Promise<void>{
    const owner=this.recordingOwner;
    if(!owner)return Promise.resolve();
    if(owner.active)return Promise.reject(new Error('Perlin 录制仍在处理帧'));
    return this.finishRecordingOwner(owner);
  }
  private retryRecordingInBackground(){
    const owner=this.recordingOwner;if(!owner||owner.active||owner.cleanup)return;
    void this.finishRecordingOwner(owner).catch(error=>{if(!this.disposed)this.callbacks.error(error instanceof Error?error:new Error(String(error)));});
  }
  private finishRecordingOwner(owner:RecordingOwner):Promise<void>{
    if(owner.cleanup)return owner.cleanup;
    const cleanup=async()=>{
      let stop:PerlinRecordingStop|undefined;
      try{
        if(owner.handle&&this.generator.hasPerlinRecording!(owner.handle))stop=await this.generator.finishPerlinRecording!(owner.handle);
      }catch(error){
        // A confirmed released client lease cannot be retried. A retained one
        // stays reachable here, even during unmount, until cleanup succeeds.
        if(owner.handle&&this.generator.hasPerlinRecording!(owner.handle)){if(this.disposed)retiredQueues.add(this);throw error;}
        if(!this.disposed&&this.latest===owner.request)this.callbacks.error(error instanceof Error?error:new Error(String(error)));
        this.releaseRecordingOwner(owner);throw error;
      }
      const latest=this.latest,deferred=latest!==owner.request;let expected=latest;
      try{
        if(!stop&&owner.invalidPreview&&!this.disposed&&this.latest===owner.request)this.callbacks.error(owner.invalidPreview);
        if(stop&&!this.disposed&&latest?.scene===owner.request.scene){
          this.latest=expected={scene:stop.scene,context:{...latest.context,time:stop.context.time}};
          this.callbacks.recordingStopped?.(stop,owner.request.scene);
          if(this.latest?.scene===stop.scene)this.callbacks.output(stop.preview,stop.context.time,stop.scene);
        }
      }finally{this.releaseRecordingOwner(owner,deferred||this.latest!==expected);}
    };
    owner.cleanup=cleanup().finally(()=>{owner.cleanup=undefined;});return owner.cleanup;
  }
  private releaseRecordingOwner(owner:RecordingOwner,deferred=this.latest!==owner.request){
    if(this.recordingOwner!==owner)return;
    this.recordingOwner=undefined;
    if(this.disposed){this.generator.dispose();retiredQueues.delete(this);return;}
    if(deferred&&this.latest)this.start();else this.callbacks.busy(false);
  }
  /** Stop pending and active work without disposing the reusable scheduler.
   * Invalidate request ownership before cancellation rejects its promise. */
  cancel(){
    if(this.disposed)return;
    this.completedSamila=undefined;
    if(this.recordingOwner){clearTimeout(this.timer);this.timer=undefined;this.latest=null;this.recordingOwner.stop=true;this.retryRecordingInBackground();return;}
    clearTimeout(this.timer);this.timer=undefined;this.latest=null;this.running=null;
    if(this.captureOwner){this.captureOwner.retire=true;return;}
    this.generator.cancel();this.callbacks.busy(false);
  }
  dispose(){this.completedSamila=undefined;this.disposed=true;clearTimeout(this.timer);this.timer=undefined;this.latest=null;this.running=null;
    if(this.captureOwner){this.captureOwner.retire=true;return;}
    if(this.recordingOwner){this.recordingOwner.stop=true;this.retryRecordingInBackground();return;}
    this.generator.dispose();
  }
}
