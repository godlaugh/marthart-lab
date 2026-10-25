import type {IteratedFrameJob} from '../scenes/iteratedDensity';
import type {IteratedDensityGpu,IteratedGpuFacts,IteratedGpuOptions} from './iteratedDensityGpu';
import type {RasterOutput} from '../types';

export type SourceIteratedPresentArguments=Parameters<IteratedDensityGpu['present']>;
export type SourceIteratedPresented=Omit<ReturnType<IteratedDensityGpu['present']>,'toneBackend'>&{
 toneBackend:'cpu'|'webgl2'|'native';
 sourcePixelRenderer?:RasterOutput['sourcePixelRenderer'];
};
export interface SourceIteratedBackendDiagnostics {retainedBytes:number;[key:string]:unknown;}
/** The default WebGL owner implements this boundary directly. It retains its
 * synchronous public API and its own fine-grained cancellation checks. */
export interface SourceIteratedReplayBackend {
 step(job:IteratedFrameJob,options:IteratedGpuOptions):IteratedGpuFacts;
 resizeAccumulation(width:number,height:number,isCancelled?:()=>boolean):boolean|void;
 present(...args:SourceIteratedPresentArguments):ReturnType<IteratedDensityGpu['present']>;
 validateAccumulationCapture(width:number,height:number,additionalBytes:number):void;
 readParticles():ReturnType<IteratedDensityGpu['readParticles']>;
 readback():Float32Array;
 diagnostics():SourceIteratedBackendDiagnostics;
 dispose():void;
}
/** One exact retained resource. The backend must commit a received ACK before
 * resolving; rejection leaves its state uncertain and requires disposal.
 * Cancellation is intentionally absent: an export must not abort a shared CGL
 * context. The semantic owner stops between acknowledged effects instead. */
export interface SourceIteratedReplayAsyncBackend {
 /** Actual backend work, including replayed math prefixes and diagnostics.
  * Pure synchronous preflight; omission retains the legacy logical-step cost. */
 estimateWork?(job:IteratedFrameJob,resetParticles:boolean):number;
 step(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'isCancelled'>):Promise<IteratedGpuFacts>;
 resizeAccumulation(width:number,height:number):Promise<boolean|void>;
 present(tone:SourceIteratedPresentArguments[0],view?:SourceIteratedPresentArguments[2]):Promise<SourceIteratedPresented>;
 /** Synchronous admission only; no remote mutation or resource allocation. */
 validateAccumulationCapture(width:number,height:number,additionalBytes:number):void;
 diagnostics():SourceIteratedBackendDiagnostics;
 /** Exact, idempotent release; keep every uncertain resource on failure. */
 dispose():Promise<void>;
}
export type SourceIteratedReplayBackendOptions=
 | {backend?:SourceIteratedReplayBackend;asyncBackend?:never}
 | {backend?:never;asyncBackend:SourceIteratedReplayAsyncBackend};

/** Only execution effects live here. Replay, warmup and all counters remain in
 * SourceIteratedReplaySession's single generator, shared by both drivers. */
export type SourceIteratedReplayEffect=
 | {kind:'resize';width:number;height:number;isCancelled?:()=>boolean}
 | {kind:'step';job:IteratedFrameJob;options:IteratedGpuOptions};
export type SourceIteratedReplayOperation<T>=Generator<SourceIteratedReplayEffect,T,IteratedGpuFacts|void>;

export function executeSourceIteratedReplay<T>(operation:SourceIteratedReplayOperation<T>,backend:SourceIteratedReplayBackend):T {
 let next=operation.next();
 while(!next.done){
  const effect=next.value;let reply:IteratedGpuFacts|void=undefined;
  try{if(effect.kind==='resize')backend.resizeAccumulation(effect.width,effect.height,effect.isCancelled);else reply=backend.step(effect.job,effect.options);}
  catch(error){operation.throw(error);throw error;}
  next=operation.next(reply);
 }
 return next.value;
}
export async function executeSourceIteratedReplayAsync<T>(operation:SourceIteratedReplayOperation<T>,backend:SourceIteratedReplayAsyncBackend):Promise<T> {
 let next=operation.next();
 while(!next.done){
  const effect=next.value;let reply:IteratedGpuFacts|void=undefined;
  try{
   if(effect.kind==='resize')await backend.resizeAccumulation(effect.width,effect.height);
   else{const {isCancelled:_isCancelled,...options}=effect.options;reply=await backend.step(effect.job,options);}
  }catch(error){operation.throw(error);throw error;}
  // Resume first: the owner records the ACK before its cancellation boundary.
  next=operation.next(reply);
 }
 return next.value;
}
