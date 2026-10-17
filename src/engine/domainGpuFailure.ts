export type DomainGpuFailureStage='context'|'capability'|'compile'|'link'|'allocation'|'render'|'readback'|'source-program';
export interface DomainGpuFailureFacts {readonly stage:DomainGpuFailureStage;readonly reason:string;}

/** An observed GPU boundary failure, not a request validation or CPU error. */
export class DomainGpuError extends Error {
 readonly failure:DomainGpuFailureFacts;
 constructor(stage:DomainGpuFailureStage,reason:string,options?:ErrorOptions){
  super(reason,options);this.name='DomainGpuError';this.failure=Object.freeze({stage,reason});
 }
}

/** Only wrap the GL operation itself. Parsing, allocation of CPU arrays and
 * user/CPU callbacks must remain outside this boundary. */
export function domainGpuOperation<T>(stage:DomainGpuFailureStage,reason:string,operation:()=>T):T {
 try{return operation();}catch(error){
  if(error instanceof DomainGpuError||typeof error==='object'&&error!==null&&'name'in error&&error.name==='AbortError')throw error;
  throw new DomainGpuError(stage,reason+': '+(error instanceof Error?error.message:String(error)),{cause:error});
 }
}
