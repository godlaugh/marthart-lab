import type {SceneDocument} from '../types';
import {ImplicitControlJournal} from './implicitControlJournal';
import {IMPLICIT_PALETTE_CONTROL_MAX_BYTES,ImplicitPaletteControlOwner,ImplicitPaletteControlError,implicitPaletteControlRepresentationBytes,validateImplicitPaletteControlReceipt,type ImplicitPaletteControlCommand,type ImplicitPaletteControlPayload,type ImplicitPaletteControlReceipt,type ImplicitPaletteControls} from './implicitPaletteControl';

export type ImplicitEditorHotCommand=Exclude<ImplicitPaletteControlPayload,{kind:'apply'|'restart'}>;
export type ImplicitEditorAction={kind:'stage'}|{kind:'metadata'}|ImplicitPaletteControlPayload;
/** A replay plan for authored command state, not a framebuffer, mesh, clock or
 * worker checkpoint. Cold remains distinct from the subsequent hot commands. */
export interface ImplicitEditorCheckpoint {
 readonly cold:SceneDocument;
 readonly hot:readonly ImplicitEditorHotCommand[];
}
export interface ImplicitEditorHistoryChange {
 readonly before:ImplicitEditorCheckpoint;
 readonly after:ImplicitEditorCheckpoint;
 readonly runtimeChanged:boolean;
 readonly intent:ImplicitEditorAction['kind'];
}
function payload(command:ImplicitPaletteControlCommand):ImplicitPaletteControlPayload {const {revision:_,...value}=command;return Object.freeze(value);}

/** UI-only command history. The worker remains the runtime authority; this
 * owner retains issued intentions for explicit undo/redo reconstruction. It
 * never infers a runtime command from author document differences. */
export class ImplicitEditorSession {
 private journal:ImplicitControlJournal;
 private readonly checkpoints=new WeakSet<ImplicitEditorCheckpoint>();
 private acknowledged?:ImplicitEditorCheckpoint;
 private current:ImplicitEditorCheckpoint;
 constructor(sessionId:string,initialAppliedScene:SceneDocument){
  this.journal=new ImplicitControlJournal(sessionId,initialAppliedScene);
  this.current=this.reduce(undefined,this.journal.request().commands);
 }
 get sessionId():string{return this.journal.sessionId;}
 get receipt():ImplicitPaletteControlReceipt{return this.journal.receipt;}
 get pendingCount():number{return this.journal.pendingCount;}
 get issuedRevision():number{return this.journal.issuedRevision;}
 /** Conservative expanded representation of the retained command state. This
  * excludes authored documents, rendered pixels and other App allocations. */
 get retainedBytes():number{return implicitPaletteControlRepresentationBytes({current:this.current,acknowledged:this.acknowledged,pending:this.journal.request()});}
 request():ImplicitPaletteControls{return this.journal.request();}
 /** Explicit independent export reconstruction, never a retained Worker frame.
  * The backend owner is the sole interpreter of hot colors and empty commands.
  * Call only on demand; the caller owns any cached returned scene. */
 runtimeScene():SceneDocument {
  const checkpoint=this.current;
  implicitPaletteControlRepresentationBytes({retained:{current:checkpoint,acknowledged:this.acknowledged,pending:this.journal.request()},temporary:Array.from({length:6},()=>checkpoint)});
  const owner=new ImplicitPaletteControlOwner(this.sessionId+'-independent-export');
  const commands:ImplicitPaletteControlCommand[]=[{kind:'apply',revision:1,scene:checkpoint.cold},...checkpoint.hot.map((command,index)=>({...command,revision:index+2}))];
  return owner.prepare({acknowledgedRevision:0,commands}).current;
 }

 checkpoint():ImplicitEditorCheckpoint{return this.current;}
 private checkpointFor(cold:SceneDocument,hot:readonly ImplicitEditorHotCommand[]):ImplicitEditorCheckpoint {
  const value=Object.freeze({cold,hot:Object.freeze([...hot])});this.checkpoints.add(value);return value;
 }
 private reduce(base:ImplicitEditorCheckpoint|undefined,commands:readonly ImplicitPaletteControlCommand[]):ImplicitEditorCheckpoint {
  if(base&&!commands.length)return base;
  let cold=base?.cold,hot:ImplicitEditorHotCommand[]=[...(base?.hot??[])];
  for(const command of commands){
   if(command.kind==='apply'){cold=command.scene;hot=[];}
   else if(command.kind==='restart')hot=[];
   else hot.push(payload(command) as ImplicitEditorHotCommand);
  }
  if(!cold)throw new Error('隐式历史缺少已应用配置');
  return this.checkpointFor(cold,hot);
 }
 edit(intent:ImplicitEditorAction):ImplicitEditorHistoryChange {
  const before=this.current;
  if(intent.kind==='stage'||intent.kind==='metadata')return Object.freeze({before,after:before,runtimeChanged:false,intent:intent.kind});
  const value:ImplicitPaletteControlPayload=intent;
  // Include the old retained replay plan and pending transport before the
  // journal detaches anything. Historical entries themselves belong to App's
  // bounded history owner; this helper keeps only current/acknowledged plans.
  implicitPaletteControlRepresentationBytes({current:before,acknowledged:this.acknowledged,pending:this.journal.request(),next:value,detached:value});
  const command=this.journal.enqueue(value);
  this.current=this.reduce(before,[command]);
  return Object.freeze({before,after:this.current,runtimeChanged:true,intent:intent.kind});
 }
 /** A recording receipt may reset current to cold without consuming a new
  * command. Apply/restart resets are counted from the confirmed prefix first;
  * any later, still-pending commands remain issued and overlay that cold plan. */
 acknowledge(sessionId:string,raw:unknown):boolean {
  if(sessionId!==this.sessionId)return false;
  const receipt=validateImplicitPaletteControlReceipt(raw),prior=this.journal.receipt,request=this.journal.request();
  if(receipt.revision<prior.revision||receipt.revision===prior.revision&&receipt.resetRevision<=prior.resetRevision)return this.journal.acknowledge(sessionId,receipt);
  const count=receipt.revision-prior.revision,confirmed=request.commands.slice(0,count),remaining=request.commands.slice(count);
  let acknowledged=this.reduce(this.acknowledged,confirmed);
  const commandResets=confirmed.reduce((sum,c)=>sum+Number(c.kind==='apply'||c.kind==='restart'),0);
  const recordingReset=receipt.resetRevision>prior.resetRevision+commandResets;
  if(recordingReset)acknowledged=this.checkpointFor(acknowledged.cold,[]);
  const current=recordingReset?this.reduce(acknowledged,remaining):this.current;
  implicitPaletteControlRepresentationBytes({prior:this.current,acknowledged,current,pending:request});
  if(!this.journal.acknowledge(sessionId,receipt))return false;
  this.acknowledged=acknowledged;this.current=current;return true;
 }
 /** Undo/redo callers invoke this only for an edge with runtimeChanged=true.
  * Stage/metadata edges must leave the runtime alone, including after recording.
  * A new identity makes the reconstruction explicit: Apply cold, then replay
  * hot intentions in order. Mesh buffers, producer progress and scene time are not saved. */
 restore(checkpoint:ImplicitEditorCheckpoint,newSessionId:string):void {
  if(!this.checkpoints.has(checkpoint))throw new Error('隐式历史检查点不属于当前编辑会话');
  if(newSessionId===this.sessionId)throw new Error('隐式历史恢复需要新的运行会话身份');
  implicitPaletteControlRepresentationBytes({current:this.current,acknowledged:this.acknowledged,pending:this.journal.request(),checkpoint,detached:checkpoint});
  const journal=new ImplicitControlJournal(newSessionId,checkpoint.cold);
  for(const command of checkpoint.hot)journal.enqueue(command);
  this.journal=journal;this.acknowledged=undefined;this.current=checkpoint;
 }
}

/** Admission for the extra Implicit command/history/library retention owned by UI.
 * Count each owner and historical checkpoint once by reference. Their internal
 * shared graphs deliberately use expanded representation estimates: this is a
 * conservative capacity bound, not a process-memory measurement. A candidate
 * reserves three representations before mutation: caller input, detached journal
 * snapshot and the resulting replay/checkpoint plan. No candidate is cloned here.
 * Callers collect every retained owner/checkpoint before edit, restore or load. */
export function assertImplicitEditorRetention(owners:Iterable<ImplicitEditorSession>,checkpoints:Iterable<ImplicitEditorCheckpoint>,candidate?:unknown):number {
 let bytes=0;
 const add=(size:number)=>{bytes+=size;if(bytes>IMPLICIT_PALETTE_CONTROL_MAX_BYTES)throw new ImplicitPaletteControlError('Implicit editor command/history retention exceeds the 768 MiB representation budget','capacity');};
 const seenOwners=new Set<ImplicitEditorSession>();
 for(const owner of owners)if(!seenOwners.has(owner)){seenOwners.add(owner);add(owner.retainedBytes);}
 const seenCheckpoints=new Set<ImplicitEditorCheckpoint>();
 for(const checkpoint of checkpoints)if(!seenCheckpoints.has(checkpoint)){seenCheckpoints.add(checkpoint);add(implicitPaletteControlRepresentationBytes(checkpoint));}
 if(candidate!==undefined){const candidateBytes=implicitPaletteControlRepresentationBytes(candidate);add(candidateBytes*3);}
 return bytes;
}
