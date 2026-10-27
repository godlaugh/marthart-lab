import {withSourceRootsPointNativeTransaction,releaseSourceRootsPointNative,type SourceRootsPointNativeExchange,type SourceNativeRootsPointResponse} from './sourceNativeClient';
import {rootsPointCloudChunkPoints,type RootsPointPrograms,type RootsPointFrameMetadata} from './rootsPointCloudDrawing';
import {admitSourceRootsPointNativeRequest,sourceRootsPointNativeProgramBytes,sourceRootsPointNativeResidentBytes,sourceRootsPointNativeFrameSchedule,sourceRootsPointNativeSchedule,sourceRootsPointNativeScheduleChunk,type SourceRootsPointNativeOperation,type SourceRootsPointNativeRequest,type SourceRootsPointNativeFrameSchedule} from './sourceRootsPointNativeProtocol';
import {SourceNativeError} from './sourceNativeError';

export type RootsPointNativeTarget='primary'|'offscreen';
export interface RootsPointNativeDeviceFacts {readonly width:number;readonly height:number;readonly pointSizeRange:readonly[number,number];readonly rendererIdentity:string;readonly contextSerial:number;readonly sessionSerial:number;}
export interface RootsPointCloudNativeBackendOptions {
 /** Other page-owned representations only. This module already counts all
  * its point targets; the Worker's numerical ring has a separate owner/budget. */
 retainedBytes?:()=>number;
}
export interface RootsPointNativeBegin {metadata:RootsPointFrameMetadata;rangeCounts:readonly number[];chunkPoints:number;}
export interface RootsPointNativeAppend {ordinal:number;rangeIndex:number;rangeOffset:number;points:Float32Array;}
type Identity=Pick<RootsPointNativeDeviceFacts,'rendererIdentity'|'contextSerial'|'sessionSerial'>;
type Counts=Pick<SourceNativeRootsPointResponse,'phase'|'receivedPoints'|'totalPoints'|'nextChunk'|'totalChunks'|'pointDraws'|'fadeDraws'|'clears'>;
interface TargetState {
 target:RootsPointNativeTarget;resource:string;width:number;height:number;programs:RootsPointPrograms;bytes:number;
 displayIndex:number;failed:boolean;identity?:Identity;device?:RootsPointNativeDeviceFacts;counts?:Counts;
}
interface HeldFrame {
 state:TargetState;frame:SourceRootsPointNativeFrameSchedule;send?:SourceRootsPointNativeExchange;
 close:()=>void;done:Promise<void>;open:boolean;
}
const owners=new Set<TargetState>();let generation=0;
const globalBytes=()=>[...owners].reduce((sum,state)=>sum+state.bytes,0);
const uint=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff;
function demand(ok:unknown,message:string,kind='input'):asserts ok {if(!ok)throw new SourceNativeError(kind,message);}
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function copyPrograms(p:RootsPointPrograms):RootsPointPrograms {return Object.freeze({point:Object.freeze({...p.point}),fade:Object.freeze({...p.fade})});}
function samePrograms(a:RootsPointPrograms,b:RootsPointPrograms){return a.point.vertex===b.point.vertex&&a.point.fragment===b.point.fragment&&a.fade.vertex===b.fade.vertex&&a.fade.fragment===b.fade.fragment;}
function copyMetadata(m:RootsPointFrameMetadata):RootsPointFrameMetadata {
 return Object.freeze({...(m.clear?{clear:Object.freeze([...m.clear] as [number,number,number,number])}:{}),...(m.fade?{fade:Object.freeze([...m.fade] as [number,number,number,number])}:{}),palette:m.palette.slice(),uniforms:Object.freeze(m.uniforms.map(u=>Object.freeze(u.kind==='sampler2d'?{...u}:{...u,values:new Float32Array(u.values)})))});
}

/** Page-side custody only: no solver, scene clock, raw ring, or retained RGBA
 * copies. A completed frame's pixels are transferred to the Worker by caller. */
export class RootsPointCloudNativeBackend {
 private readonly session=crypto.randomUUID().replaceAll('-','');
 private readonly generation:number;private sequence=0;
 private readonly targets=new Map<RootsPointNativeTarget,TargetState>();
 private active?:Promise<unknown>;private retiring?:Promise<void>;private retiringTarget?:RootsPointNativeTarget;private held?:HeldFrame;
 constructor(private readonly options:RootsPointCloudNativeBackendOptions={}) {
  demand(generation<0xffffffff,'Roots native generation identities exhausted','capacity');this.generation=++generation;
 }
 private externalBytes(){const bytes=this.options.retainedBytes?.()??0;demand(Number.isSafeInteger(bytes)&&bytes>=0,'Roots native external retained bytes are invalid');return bytes;}
 private retained(excluding?:TargetState){return globalBytes()-(excluding?.bytes??0)+this.externalBytes();}
 private target(name:RootsPointNativeTarget){demand(name==='primary'||name==='offscreen','Unknown Roots target');const state=this.targets.get(name);demand(state,'Roots native target has not been initialized','state-lost');return state;}
 private ready(name:RootsPointNativeTarget){const state=this.target(name);demand(!state.failed&&state.device,'Roots native target requires cleanup before reuse','state-lost');return state;}
 private request(state:TargetState,operation:SourceRootsPointNativeOperation):SourceRootsPointNativeRequest {
  demand(this.sequence<0xffffffff,'Roots native request sequence exhausted','capacity');
  return{generation:this.generation,sequence:++this.sequence,width:operation.kind==='release'?1:state.width,height:operation.kind==='release'?1:state.height,operation};
 }
 private preflight(request:SourceRootsPointNativeRequest,retainedBytes:number){const admitted=admitSourceRootsPointNativeRequest(request,{retainedBytes});if(!admitted.ok)throw new SourceNativeError(admitted.error.kind,admitted.error.reason);}
 private accept(state:TargetState,request:SourceRootsPointNativeRequest,reply:SourceNativeRootsPointResponse,release=false):void {
  demand(reply.resource===state.resource&&reply.generation===request.generation&&reply.sequence===request.sequence,'Roots native ACK does not belong to this request','protocol');
  demand(typeof reply.rendererIdentity==='string'&&/^[a-f0-9]{64}$/.test(reply.rendererIdentity)&&uint(reply.sessionSerial)&&reply.sessionSerial>0&&uint(reply.contextSerial)&&(reply.disposition==='absent'||reply.contextSerial>0),'Roots native receipt identity is invalid','protocol');
  if(state.identity&&(!release||reply.disposition==='released'))demand(state.identity.rendererIdentity===reply.rendererIdentity&&state.identity.contextSerial===reply.contextSerial&&state.identity.sessionSerial===reply.sessionSerial,'Roots native target context changed','state-lost');
  if(release){demand(reply.disposition==='released'||reply.disposition==='absent','Roots native cleanup was not acknowledged','protocol');return;}
  demand(reply.disposition==='owned'&&reply.width===state.width&&reply.height===state.height,'Roots native target ACK dimensions differ','protocol');
  if(state.device)demand(reply.pointSizeRange[0]===state.device.pointSizeRange[0]&&reply.pointSizeRange[1]===state.device.pointSizeRange[1],'Roots native device facts changed','state-lost');
  state.identity={rendererIdentity:reply.rendererIdentity,contextSerial:reply.contextSerial,sessionSerial:reply.sessionSerial};
  state.device=Object.freeze({...state.identity,width:state.width,height:state.height,pointSizeRange:Object.freeze([...reply.pointSizeRange] as [number,number])});
  state.displayIndex=reply.displayIndex;
  state.counts={phase:reply.phase,receivedPoints:reply.receivedPoints,totalPoints:reply.totalPoints,nextChunk:reply.nextChunk,totalChunks:reply.totalChunks,pointDraws:reply.pointDraws,fadeDraws:reply.fadeDraws,clears:reply.clears};
 }
 private run<T>(operation:()=>Promise<T>):Promise<T> {
  if(this.active||this.retiring)return Promise.reject(new SourceNativeError('capacity','Roots native operation/cleanup must settle first'));
  // Lock before entering the operation, but do not defer its initial input
  // capture/encoding to a microtask where the caller could mutate it first.
  const result=deferred<T>(),settled=result.promise.finally(()=>{if(this.active===settled)this.active=undefined;});this.active=settled;
  try{void operation().then(result.resolve,result.reject);}catch(error){result.reject(error);}return settled;
 }
 initialize(target:RootsPointNativeTarget,size:{width:number;height:number},programs:RootsPointPrograms):Promise<RootsPointNativeDeviceFacts> {
  // Snapshot the tiny immutable program/size input before a lease await.
  const width=size.width,height=size.height;let copied:RootsPointPrograms;
  try{sourceRootsPointNativeProgramBytes(programs);copied=copyPrograms(programs);}catch(error){return Promise.reject(error);}
  return this.run(async()=>{
   demand(target==='primary'||target==='offscreen','Unknown Roots target');demand(!this.held,'Roots native display transaction is still active','capacity');
   const existing=this.targets.get(target);
   if(existing){const current=this.ready(target);demand(current.width===width&&current.height===height&&samePrograms(current.programs,copied),'Release the existing Roots target before replacing size/programs');return current.device!;}
   const bytes=sourceRootsPointNativeResidentBytes(width,height,sourceRootsPointNativeProgramBytes(copied));
   const state:TargetState={target,resource:crypto.randomUUID().replaceAll('-',''),width,height,programs:copied,bytes,displayIndex:0,failed:false};
   const request=this.request(state,{kind:'create',resource:state.resource,session:this.session,target,programs:copied});this.preflight(request,this.retained());
   this.targets.set(target,state);owners.add(state);
   let submitted=false;
   try{
    await withSourceRootsPointNativeTransaction(async send=>{const retainedBytes=this.retained(state);submitted=true;const reply=await send(request,{retainedBytes});this.accept(state,request,reply);});return state.device!;
   }catch(error){state.failed=true;if(!submitted||error instanceof SourceNativeError&&error.kind==='ownership'){this.targets.delete(target);owners.delete(state);}throw error;}
  });
 }
 begin(target:RootsPointNativeTarget,input:RootsPointNativeBegin):Promise<SourceNativeRootsPointResponse> {
  // No async wait before input validation and snapshot. The packet preflight
  // bounds metadata before allocating its independent typed-array copies.
  return this.run(async()=>{
   const state=this.ready(target);demand(!this.held,'Roots native display transaction is still active','capacity');
   const op:Extract<SourceRootsPointNativeOperation,{kind:'begin'}>={kind:'begin',resource:state.resource,expectedDisplay:state.displayIndex,...input};
   let request=this.request(state,op);this.preflight(request,this.retained());
   const size=input.metadata.uniforms.find(u=>u.name==='pointSize');demand(size?.kind==='float','Roots pointSize binding is missing');
   demand(input.chunkPoints<=rootsPointCloudChunkPoints(state.width,state.height,size.values[0],state.device!.pointSizeRange),'Roots native chunk exceeds the actual device footprint','capacity');
   request={...request,operation:{...op,rangeCounts:Object.freeze([...input.rangeCounts]),metadata:copyMetadata(input.metadata)}};
   const captured=request.operation;if(captured.kind!=='begin')throw new SourceNativeError('input','Roots begin operation lost');
   const ready=deferred<void>(),close=deferred<void>();
   const held:HeldFrame={state,frame:sourceRootsPointNativeFrameSchedule(captured),close:()=>close.resolve(),done:Promise.resolve(),open:false};this.held=held;
   held.done=withSourceRootsPointNativeTransaction(async send=>{held.send=send;held.open=true;ready.resolve();await close.promise;}).catch(error=>{ready.reject(error);throw error;}).finally(()=>{held.open=false;});void held.done.catch(()=>{});
   let submitted=false;
   try{await ready.promise;const retainedBytes=this.retained();submitted=true;const reply=await held.send!(request,{retainedBytes});this.accept(state,request,reply);return reply;}
   catch(error){if(submitted)state.failed=true;else{held.close();await held.done.catch(()=>{});if(this.held===held)this.held=undefined;}throw error;}
  });
 }
 append(target:RootsPointNativeTarget,input:RootsPointNativeAppend):Promise<SourceNativeRootsPointResponse> {
  return this.run(async()=>{
   const state=this.ready(target),held=this.held;demand(held?.state===state&&held.send,'Roots append has no owning frame transaction','ownership');
   const next=state.counts?.nextChunk;demand(input.ordinal===next,'Roots append must use the next acknowledged chunk');
   const scheduled=sourceRootsPointNativeScheduleChunk(sourceRootsPointNativeSchedule(held.frame.rangeCounts,held.frame.chunkPoints),input.ordinal);
   demand(input.rangeIndex===scheduled.rangeIndex&&input.rangeOffset===scheduled.rangeOffset,'Roots append range differs from its admitted frame');
   const request=this.request(state,{kind:'append',resource:state.resource,expectedDisplay:state.displayIndex,...input,frame:held.frame}),retainedBytes=this.retained();this.preflight(request,retainedBytes);
   // send encodes synchronously before its first network await. This buffer is
   // borrowed until the returned ACK; no extra full-window or chunk copy.
   try{const reply=await held.send(request,{retainedBytes});this.accept(state,request,reply);return reply;}
   catch(error){state.failed=true;throw error;}
  });
 }
 finish(target:RootsPointNativeTarget):Promise<SourceNativeRootsPointResponse> {
  return this.run(async()=>{
   const state=this.ready(target),held=this.held;demand(held?.state===state&&held.send,'Roots finish has no owning frame transaction','ownership');
   const schedule=sourceRootsPointNativeSchedule(held.frame.rangeCounts,held.frame.chunkPoints);
   demand(state.counts?.receivedPoints===schedule.totalPoints&&state.counts.nextChunk===schedule.totalChunks,'Roots display cannot finish before every chunk ACK');
   const request=this.request(state,{kind:'finish',resource:state.resource,expectedDisplay:state.displayIndex,frame:held.frame}),retainedBytes=this.retained();this.preflight(request,retainedBytes);
   try{
    const reply=await held.send(request,{retainedBytes});this.accept(state,request,reply);
    demand(reply.pixels instanceof Uint8ClampedArray&&reply.pixels.buffer instanceof ArrayBuffer&&reply.pixels.length===state.width*state.height*4,'Roots finish has no complete pixel receipt','protocol');
    // ACK owns the new history/checkpoint before the caller observes cancel.
    held.close();await held.done;if(this.held===held)this.held=undefined;return reply;
   }catch(error){state.failed=true;throw error;}
  });
 }
 private async releaseState(state:TargetState):Promise<void> {
  const held=this.held;demand(!held||held.state===state,'Another Roots target owns the active frame transaction','ownership');
  const request=this.request(state,{kind:'release',resource:state.resource});
  try{
   const reply=held?.send&&held.open?await held.send(request):await releaseSourceRootsPointNative(request);this.accept(state,request,reply,true);
   this.targets.delete(state.target);owners.delete(state);
   if(held){held.close();await held.done.catch(()=>{});if(this.held===held)this.held=undefined;}
  }catch(error){state.failed=true;throw error;}
 }
 release(target?:RootsPointNativeTarget):Promise<void> {
  if(this.retiring){if(this.retiringTarget===undefined||this.retiringTarget===target)return this.retiring;return this.retiring.then(()=>this.release(target));}
  this.retiringTarget=target;
  const pending=(async()=>{
   await this.active?.catch(()=>{});
   if(target!==undefined){demand(target==='primary'||target==='offscreen','Unknown Roots target');const state=this.targets.get(target);if(state)await this.releaseState(state);return;}
   if(this.held)await this.releaseState(this.held.state);
   for(const state of [...this.targets.values()])await this.releaseState(state);
  })();
  const settled=pending.finally(()=>{if(this.retiring===settled){this.retiring=undefined;this.retiringTarget=undefined;}});this.retiring=settled;return settled;
 }
 /** Waits for actual RPC/cleanup, not an intentionally open frame gate. The
  * caller must finish or release that gate before retiring its Worker. */
 async settle():Promise<void>{const results=await Promise.allSettled([this.active,this.retiring]);for(const result of results)if(result.status==='rejected')throw result.reason;}
 diagnostics(){return{active:!!this.active,retiring:!!this.retiring,transactionTarget:this.held?.state.target,retainedBytes:[...this.targets.values()].reduce((n,s)=>n+s.bytes,0),cleanupPending:!!this.retiring||[...this.targets.values()].some(s=>s.failed),targets:[...this.targets.values()].map(s=>({target:s.target,resource:s.resource,width:s.width,height:s.height,displayIndex:s.displayIndex,failed:s.failed,bytes:s.bytes,...s.identity,...s.counts}))};}
}
