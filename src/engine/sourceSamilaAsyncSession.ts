import type {GenerateContext,SceneDocument} from '../types';
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
