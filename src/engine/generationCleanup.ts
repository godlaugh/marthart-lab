interface CleanupTicket {pending:boolean;retry:()=>void;}
/** The error holds the failed resource generation's ticket, not an unrestricted
 * reset callback. Once any successful retry retires it, old errors are no-ops. */
export class GenerationCleanupError extends AggregateError {
 constructor(errors:readonly unknown[],private readonly ticket:CleanupTicket){super(errors,'Generation cleanup failed; resources retained for retry');this.name='GenerationCleanupError';}
 get cleanupPending(){return this.ticket.pending;}
 retryCleanup(){if(this.ticket.pending)this.ticket.retry();}
}
/** Each reusable session owns one pending cleanup. It must retire that cleanup
 * before starting another generation, so an older error cannot clear new work. */
export class GenerationCleanupState {
 private ticket?:CleanupTicket;
 prepare(){this.ticket?.retry();}
 reset(operation:()=>void,failures:readonly unknown[]=[]):void {
  try{operation();}catch(error){
   const ticket=this.ticket??{pending:true,retry:()=>this.reset(operation)};
   this.ticket=ticket;throw new GenerationCleanupError([...failures,error],ticket);
  }
  if(this.ticket)this.ticket.pending=false;
  this.ticket=undefined;
 }
}
interface GenerationOwner {reset(failures?:readonly unknown[]):void;}
export function withGenerationCleanup<T>(operation:()=>T,owner:GenerationOwner):T {
 let result:T;
 try{result=operation();}catch(error){owner.reset([error]);throw error;}
 owner.reset();return result;
}
