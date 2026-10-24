import type {SceneDocument} from '../types';
import {IMPLICIT_PALETTE_CONTROL_MAX_BYTES,ImplicitPaletteControlError,implicitPaletteControlRepresentationBytes,implicitPaletteControlReceiptMatches,validateImplicitPaletteControls,validateImplicitPaletteControlReceipt,type ImplicitPaletteControlCommand,type ImplicitPaletteControlPayload,type ImplicitPaletteControls,type ImplicitPaletteControlReceipt} from './implicitPaletteControl';

export class ImplicitControlJournalError extends Error {
 constructor(readonly kind:'input'|'sequence',message:string){super(message);this.name='ImplicitControlJournalError';}
}

/** Only detached protocol snapshots enter the journal. Freeze them once on
 * admission; repeated display requests share the same immutable pending batch. */
function freeze<T>(value:T):T {
 const seen=new WeakSet<object>(),pending:unknown[]=[value];
 while(pending.length){
  const current=pending.pop();if(!current||typeof current!=='object'||seen.has(current)||Object.isFrozen(current))continue;
  seen.add(current);for(const child of Object.values(current))pending.push(child);Object.freeze(current);
 }
 return value;
}
function snapshotImplicitControlCommand(raw:ImplicitPaletteControlCommand):ImplicitPaletteControlCommand {
 const parsed=validateImplicitPaletteControls({acknowledgedRevision:raw.revision-1,commands:[raw]});
 return structuredClone(parsed.commands[0]);
}
interface State {sessionId:string;issuedRevision:number;receipt:ImplicitPaletteControlReceipt;request:ImplicitPaletteControls;}

function admitSnapshot(previous:ImplicitPaletteControls|undefined,command:unknown,count:number,acknowledgedRevision:number):void {
 // Detaching creates a distinct command graph even if a caller reuses an
 // existing snapshot as its input. Measure it separately from retained state.
 // Null slots represent references in the new immutable batch; the old batch
 // remains owned until validation and snapshotting have succeeded.
 const bytes=(previous?implicitPaletteControlRepresentationBytes(previous):0)+2*implicitPaletteControlRepresentationBytes(command)
  +implicitPaletteControlRepresentationBytes({acknowledgedRevision,commands:Array.from({length:count},()=>null)});
 if(bytes>IMPLICIT_PALETTE_CONTROL_MAX_BYTES)throw new ImplicitPaletteControlError('Implicit journal pending snapshots exceed the 768 MiB representation budget','capacity');
}

/** Main-thread ownership of explicit Implicit commands, independent of whether a
 * completed frame is still eligible to be published by the UI. No command is
 * inferred from scene differences, compacted, or replayed after acknowledgement. */
export class ImplicitControlJournal {
 private state!:State;
 constructor(sessionId:string,scene:SceneDocument){this.reset(sessionId,scene);}
 get sessionId():string{return this.state.sessionId;}
 get issuedRevision():number{return this.state.issuedRevision;}
 get receipt():ImplicitPaletteControlReceipt{return this.state.receipt;}
 get pendingCount():number{return this.state.request.commands.length;}

 /** A new document/instance needs a new session identity. Applying unchanged
  * author values in the current session is enqueue({kind:'apply',scene}). */
 reset(sessionId:string,scene:SceneDocument):void {
  if(typeof sessionId!=='string'||!sessionId.trim())throw new ImplicitControlJournalError('input','Implicit command journal requires a session identity');
  if(this.state?.sessionId===sessionId)throw new ImplicitControlJournalError('sequence','Implicit journal reset requires a new session identity');
  const raw:ImplicitPaletteControlCommand={revision:1,kind:'apply',scene};admitSnapshot(this.state?.request,raw,1,0);
  const command=freeze(snapshotImplicitControlCommand(raw));
  const request=freeze(validateImplicitPaletteControls({acknowledgedRevision:0,commands:[command]}));
  this.state={sessionId,issuedRevision:1,receipt:freeze({revision:0,applyRevision:0,resetRevision:0}),request};
 }

 enqueue(payload:ImplicitPaletteControlPayload):ImplicitPaletteControlCommand {
  const state=this.state,revision=state.issuedRevision+1,raw={...payload,revision};
  admitSnapshot(state.request,raw,state.request.commands.length+1,state.receipt.revision);
  const command=freeze(snapshotImplicitControlCommand(raw));
  // The protocol owns the complete retained representation budget, including
  // scene text and every pending command. Admission failure changes no state.
  const request=freeze(validateImplicitPaletteControls({acknowledgedRevision:state.receipt.revision,commands:[...state.request.commands,command]}));
  this.state={...state,issuedRevision:revision,request};return command;
 }

 request():ImplicitPaletteControls{return this.state.request;}

 /** Consume confirmed prefixes even when their rendered frame is stale for
  * presentation. Old-session and older receipts have no authority over this
  * journal. Recording may increase resetRevision without consuming a command. */
 acknowledge(sessionId:string,value:unknown):boolean {
  const state=this.state;if(sessionId!==state.sessionId)return false;
  const receipt=validateImplicitPaletteControlReceipt(value),previous=state.receipt;
  if(receipt.revision<previous.revision)return false;
  if(receipt.revision>state.issuedRevision)throw new ImplicitControlJournalError('sequence','Implicit receipt acknowledges commands that were not issued');
  if(receipt.revision===previous.revision){
   if(receipt.applyRevision!==previous.applyRevision)throw new ImplicitControlJournalError('sequence','Implicit receipt changed the applied revision without consuming a command');
   if(receipt.resetRevision<=previous.resetRevision)return false;
   this.state={...state,receipt:freeze({...receipt})};return true;
  }
  const consumed=receipt.revision-previous.revision;
  const confirmed={acknowledgedRevision:previous.revision,commands:state.request.commands.slice(0,consumed)};
  if(!implicitPaletteControlReceiptMatches(receipt,confirmed,previous.revision?previous:undefined,{allowRecordingResets:true}))throw new ImplicitControlJournalError('sequence','Implicit receipt does not match the issued apply or restart commands');
  const request=freeze({acknowledgedRevision:receipt.revision,commands:state.request.commands.slice(consumed)});
  this.state={...state,receipt:freeze({...receipt}),request};return true;
 }
}
