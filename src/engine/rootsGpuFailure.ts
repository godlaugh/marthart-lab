export type RootsGpuFailureKind='device'|'input'|'capacity'|'cleanup';
/** Only device failures authorize replay. Invalid facts, budgets and cleanup
 * failures retain their own meaning; cancellation is never a GPU failure. */
export class RootsGpuError extends Error {
 constructor(message:string,readonly failureKind:RootsGpuFailureKind='device',options?:ErrorOptions){super(message,options);this.name='RootsGpuError';}
}
export function rootsGpuRequire(ok:unknown,message:string,kind:RootsGpuFailureKind='device'):asserts ok {if(!ok)throw new RootsGpuError(message,kind);}
export function rootsGpuCall<T>(operation:()=>T):T {try{return operation();}catch(error){if(error instanceof RootsGpuError||error instanceof DOMException&&error.name==='AbortError')throw error;throw new RootsGpuError(error instanceof Error?error.message:String(error),'device',{cause:error});}}
/** Validate already prepared facts through their owner, without labeling input
 * exceptions as device failures or duplicating the owner's normalization. */
export function rootsGpuInput<T>(operation:()=>T):T {try{return operation();}catch(error){if(error instanceof RootsGpuError)throw error;throw new RootsGpuError(error instanceof Error?error.message:String(error),'input',{cause:error});}}
export function rootsGpuCancel(cancel?:()=>boolean){let stopped=false;try{stopped=cancel?.()??false;}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;throw new RootsGpuError('GPU root cancellation callback failed','input',{cause:error});}if(stopped)throw new DOMException('GPU root density cancelled','AbortError');}
export function rootsGpuCleanup(operation:()=>void){try{operation();}catch(error){if(error instanceof RootsGpuError&&error.failureKind==='cleanup')throw error;throw new RootsGpuError('GPU root cleanup failed','cleanup',{cause:error});}}
/** A finally block must neither replace the operation failure nor authorize
 * replay when state/resource cleanup is incomplete. */
export function rootsGpuFinally<T>(operation:()=>T,cleanup:()=>void):T {
 let result!:T,failed=false,failure:unknown;
 try{result=operation();}catch(error){failed=true;failure=error;}
 try{rootsGpuCleanup(cleanup);}catch(error){if(failed)throw new RootsGpuError('GPU root operation and cleanup failed','cleanup',{cause:new AggregateError([failure,error])});throw error;}
 if(failed)throw failure;return result;
}
