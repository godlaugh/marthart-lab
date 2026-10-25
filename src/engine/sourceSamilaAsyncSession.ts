import type {GenerateContext,SceneDocument} from '../types';
import {SourceRecordingOperationError,type SourceRecordingHandle,type SourceRecordingOptions,type SourceRecordingStart,type SourceRecordingStop} from './generationProtocol';
import {SourceSamilaSession,type SourceSamilaDisplayBudget,type SourceSamilaDisplayResult,type SourceSamilaHotAction,type SourceSamilaLiveOutput,type SourceSamilaOperation,type SourceSamilaPreparedDisplay,type SourceSamilaSessionOptions} from './sourceSamilaSession';

/** The transport/backend owns resources and capacity. In particular native
 * admission must enforce its actual 256 MiB contract, not the WebGL estimate. */
export interface SourceSamilaAsyncBackend {
 admitDisplay(budget:SourceSamilaDisplayBudget):void;
 draw(display:SourceSamilaPreparedDisplay):Promise<SourceSamilaDisplayResult>;
 /** Idempotent release/reset, retaining any uncertain owner on failure. */
 reset():Promise<void>;
 /** Abort an in-flight transport without claiming that its draw rolled back. */
 cancel?():void;
 diagnostics?():unknown;
}
/** Scheduling and cleanup only: clock, queue, seeds, revisions, dirty state,
 * capture ordering and output acknowledgement belong to SourceSamilaSession. */
export class SourceSamilaAsyncSession {
 private readonly owner:SourceSamilaSession;
 private inFlight?:Promise<unknown>;
 private resetting?:Promise<void>;
 private blocked=false;
 private released=false;
 constructor(private readonly backend:SourceSamilaAsyncBackend,options:Omit<SourceSamilaSessionOptions,'admitDisplay'>={}) {
  this.owner=new SourceSamilaSession({...options,admitDisplay:budget=>backend.admitDisplay(budget)});
 }
 private assertIdle():void {
  if(this.released)throw Error('Samila 异步会话已释放');
  if(this.resetting||this.inFlight)throw Error('Samila 异步会话正在执行');
  if(this.blocked)throw Error('Samila 异步会话失败，需要显式重置');
 }
 private async draw(token:SourceSamilaOperation):Promise<void> {
  const prepared=this.owner.prepareDisplay(token);
  // A rejected promise does not establish whether accumulation happened. Never
  // submit this display twice, including after transport timeout/cancellation.
  const result=await this.backend.draw(prepared);this.owner.commitDisplay(prepared,result);
 }
 private async run<T>(begin:()=>SourceSamilaOperation,perform:(token:SourceSamilaOperation)=>Promise<T>):Promise<T> {
  this.assertIdle();let token:SourceSamilaOperation|undefined;
  const operation=(async()=>{
   try{token=begin();if(token.resetRequired)await this.backend.reset();return await perform(token);}
   catch(error){if(token){this.owner.abort(token);this.blocked=true;}else if(this.owner.diagnostics().failed)this.blocked=true;throw error;}
  })();
  this.inFlight=operation;
  try{return await operation;}finally{if(this.inFlight===operation)this.inFlight=undefined;}
 }
 generate(scene:SceneDocument,context:GenerateContext):Promise<SourceSamilaLiveOutput> {
  return this.run(()=>this.owner.begin(scene,context),async token=>{await this.draw(token);return this.owner.completePrimary(token);});
 }
 capturePaused(scene:SceneDocument,context:GenerateContext,options:{additionalBytes?:number}={}):Promise<{capture:SourceSamilaLiveOutput;preview:SourceSamilaLiveOutput}> {
  return this.run(()=>this.owner.beginCapture(scene,context,options),async token=>{await this.draw(token);await this.draw(token);return this.owner.completeCapture(token);});
 }
 hasRecording(handle:SourceRecordingHandle):boolean {return this.owner.hasRecording(handle);}
 async beginRecording(scene:SceneDocument,context:GenerateContext,options:SourceRecordingOptions,handle:SourceRecordingHandle):Promise<SourceRecordingStart> {
  try{return await this.run(()=>this.owner.beginRecording(scene,context,options,handle),async token=>{await this.draw(token);return this.owner.recordingStart(handle,this.owner.completeRecordingFrame(token));});}
  catch(error){throw new SourceRecordingOperationError(error instanceof Error?error.message:String(error),this.matchesCompletedPrimary(scene,context),this.hasRecording(handle),this.hasRecording(handle)?handle:undefined);}
 }
 async nextRecordingFrame(handle:SourceRecordingHandle,displayFrame:number):Promise<SourceSamilaLiveOutput> {
  try{return await this.run(()=>this.owner.nextRecordingFrame(handle,displayFrame),async token=>{await this.draw(token);return this.owner.completeRecordingFrame(token);});}
  catch(error){throw new SourceRecordingOperationError(error instanceof Error?error.message:String(error),!this.blocked&&this.hasRecording(handle),this.hasRecording(handle),this.hasRecording(handle)?handle:undefined);}
 }
 /** A failed draw has unknown commit state. Finish then releases this exact
  * resource; it never retries that draw or claims to restore its old preview.
  * Failed release keeps the handle for another explicit cleanup attempt. */
 async finishRecording(handle:SourceRecordingHandle,timestampMs?:number):Promise<SourceRecordingStop> {
  if(!this.hasRecording(handle))throw new SourceRecordingOperationError('Samila 录制句柄不属于当前会话',false,false);
  if(this.inFlight||this.resetting)throw new SourceRecordingOperationError('Samila 录制仍在执行',!this.blocked,true,handle);
  if(this.blocked){
   try{await this.reset();}
   catch(error){throw new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,true,handle);}
   throw new SourceRecordingOperationError('Samila 录制失败的资源已释放；主画布未恢复',false,false);
  }
  try{return await this.run(()=>this.owner.beginRecordingFinish(handle,timestampMs),async token=>{await this.draw(token);return this.owner.completeRecordingFinish(token);});}
  catch(error){throw new SourceRecordingOperationError(error instanceof Error?error.message:String(error),!this.blocked&&this.hasRecording(handle),this.hasRecording(handle),this.hasRecording(handle)?handle:undefined);}
 }
 setPaused(paused:boolean,timestampMs?:number):void {this.assertIdle();this.owner.setPaused(paused,timestampMs);}
 applyHot(action:SourceSamilaHotAction):void {this.assertIdle();this.owner.applyHot(action);}
 matchesCompletedPrimary(scene:SceneDocument,context:GenerateContext):boolean {return !this.blocked&&!this.released&&!this.inFlight&&!this.resetting&&this.owner.matchesCompletedPrimary(scene,context);}
 diagnostics(){return{...this.owner.diagnostics(),backend:this.backend.diagnostics?.(),inFlight:Boolean(this.inFlight),cleanupPending:this.blocked,released:this.released};}
 /** Revoke immediately; release only after the current draw settles. Failed
  * release preserves both backend and semantic owner for an explicit retry. */
 reset():Promise<void> {
  if(this.resetting)return this.resetting;
  this.blocked=true;this.owner.invalidate();const pending=this.inFlight;
  const cleanup=(async()=>{if(pending)this.backend.cancel?.();await pending?.catch(()=>{});await this.backend.reset();this.owner.reset();this.blocked=false;})();
  this.resetting=cleanup;
  void cleanup.then(()=>{if(this.resetting===cleanup)this.resetting=undefined;},()=>{if(this.resetting===cleanup)this.resetting=undefined;});
  return cleanup;
 }
 release():Promise<void> {this.released=true;return this.reset();}
}
