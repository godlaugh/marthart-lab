/** Renderer-realm ownership of export sessions returned by successful POSTs.
 * It outlives individual dialogs but does not persist IDs, credentials or any
 * ambient environment. Completed user files are never cancellation targets. */
export type ExportCleanupFetch=(url:string,init:RequestInit)=>Promise<Pick<Response,'ok'|'status'>>;
export class ExportSessionCleanupError extends AggregateError {
 constructor(errors:readonly unknown[],readonly pendingIds:readonly string[]){
  super(errors,'导出任务清理失败；保留任务标识以便重试');this.name='ExportSessionCleanupError';
 }
}
export interface ExportSessionTicket {
 readonly id:string;
 readonly pending:boolean;
 readonly cleanupRequested:boolean;
 /** Marks cleanup requested synchronously, even if the dialog then unmounts.
  * Concurrent attempts on this ticket share exactly the same promise. */
 cleanup():Promise<void>;
 /** Call immediately after a successful finish response, before cancel/UI work.
  * Retires client cleanup ownership; it never sends DELETE or deletes a file. */
 finished():void;
}
export interface ExportResourceTicket {
 readonly pending:boolean;
 readonly cleanupRequested:boolean;
 cleanup():Promise<void>;
}
interface OwnedTicket extends ExportSessionTicket {retire():void;}
const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class ExportSessionCleanup {
 private readonly tickets=new Map<string|object,OwnedTicket|ExportResourceTicket>();
 private flushing?:Promise<void>;
 constructor(private readonly fetcher:ExportCleanupFetch=(url,init)=>fetch(url,init)){}
 /** The caller must invoke this only for a successful creation response, before
  * testing cancellation. Merely typing or discovering an ID grants no ownership. */
 registerCreated(id:string):ExportSessionTicket {
  if(typeof id!=='string'||id.length!==36||!validId.test(id))throw new Error('导出服务返回的任务标识无效');
  const existing=this.tickets.get(id);if(existing)return existing as OwnedTicket;
  let pending=true,requested=false,inFlight:Promise<void>|undefined;
  const retire=()=>{pending=false;if(this.tickets.get(id)===ticket)this.tickets.delete(id);};
  const ticket:OwnedTicket={id,get pending(){return pending;},get cleanupRequested(){return requested;},retire,finished:retire,
   cleanup:()=>{
    if(inFlight)return inFlight;
    if(!pending)return Promise.resolve();
    requested=true;
    // Defer the transport call until after installing inFlight, including for a
    // synchronous throwing/reentrant test transport. Only success/404 retire.
    const attempt=Promise.resolve().then(async()=>{
     if(!pending)return;
     try{
      const response=await this.fetcher(`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE',cache:'no-store'});
      if(response.ok||response.status===404){retire();return;}
      throw new Error(`导出任务清理请求失败 (${response.status})`);
     }catch(error){
      // A concurrent successful finish owns retirement even if an older cleanup
      // request later fails. Never resurrect an already completed generation.
      if(!pending)return;
      throw new ExportSessionCleanupError([error],[id]);
     }
    });
    const tracked=attempt.finally(()=>{if(inFlight===tracked)inFlight=undefined;});
    inFlight=tracked;return tracked;
   },
  };
  Object.freeze(ticket);this.tickets.set(id,ticket);return ticket;
 }
 /** Register the actual local owner before its first operation. A failed
  * release remains reachable through this same export-lifetime registry. */
 registerResource(owner:object,release:()=>Promise<void>):ExportResourceTicket {
  const existing=this.tickets.get(owner);if(existing)return existing;
  let pending=true,requested=false,inFlight:Promise<void>|undefined;
  const ticket:ExportResourceTicket={get pending(){return pending;},get cleanupRequested(){return requested;},cleanup:()=>{
   if(inFlight)return inFlight;if(!pending)return Promise.resolve();requested=true;
   const attempt=Promise.resolve().then(async()=>{await release();pending=false;if(this.tickets.get(owner)===ticket)this.tickets.delete(owner);});
   const tracked=attempt.finally(()=>{if(inFlight===tracked)inFlight=undefined;});inFlight=tracked;return tracked;
  }};
  Object.freeze(ticket);this.tickets.set(owner,ticket);return ticket;
 }
 /** Before starting another export, await all previously requested cleanup.
  * It never cancels another dialog's active export. New pending tickets arriving
  * during the flush are included before it resolves; any failure blocks creation. */
 flush():Promise<void> {
  if(this.flushing)return this.flushing;
  const operation=Promise.resolve().then(async()=>{
   while(true){
    const pending=[...this.tickets.values()].filter(t=>t.pending&&t.cleanupRequested);
    if(!pending.length)return;
    // Retired native resources share one request slot. Keep retries serial,
    // attempt every owner, and never discard a failed sibling.
    const errors:unknown[]=[];
    for(const ticket of pending)try{await ticket.cleanup();}catch(error){if(ticket.pending)errors.push(error);}
    if(errors.length)throw new ExportSessionCleanupError(errors,pending.filter((t):t is OwnedTicket=>t.pending&&'id' in t).map(t=>t.id));
   }
  });
  const tracked=operation.finally(()=>{if(this.flushing===tracked)this.flushing=undefined;});
  this.flushing=tracked;return tracked;
 }
 diagnostics():{owned:number;pendingCleanup:number;ids:readonly string[]}{
  return{owned:this.tickets.size,pendingCleanup:[...this.tickets.values()].filter(t=>t.cleanupRequested).length,ids:[...this.tickets.keys()].filter((key):key is string=>typeof key==='string')};
 }
}
/** One page/app renderer lifetime, intentionally outside React component state. */
export const exportSessionCleanup=new ExportSessionCleanup();
