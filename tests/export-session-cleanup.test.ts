import {describe,expect,it,vi} from 'vitest';
import {ExportSessionCleanup,ExportSessionCleanupError,type ExportCleanupFetch} from '../src/engine/exportSessionCleanup';
const id1='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
const response=(status:number)=>new Response(null,{status});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(value:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

describe('export cleanup owns successful creation tickets across dialog lifetimes',()=>{
 it('does not create cleanup ownership until successful POST data is explicitly registered',async()=>{
  const fetcher=vi.fn<ExportCleanupFetch>().mockResolvedValue(response(200)),owner=new ExportSessionCleanup(fetcher);
  expect(owner.diagnostics()).toEqual({owned:0,pendingCleanup:0,ids:[]});await owner.flush();expect(fetcher).not.toHaveBeenCalled();
  const ticket=owner.registerCreated(id1);expect(owner.registerCreated(id1)).toBe(ticket);
  expect(ticket.pending).toBe(true);expect(ticket.cleanupRequested).toBe(false);expect(Object.isFrozen(ticket)).toBe(true);
  await owner.flush();expect(fetcher).not.toHaveBeenCalled();expect(owner.diagnostics().owned).toBe(1);
 });
 it.each(['',id1+'\n',id1+'\r',id1.toUpperCase().replace('1','A'),'../exports/anything','https://example.com/file',undefined])('rejects unowned malformed ID %s',id=>{
  const owner=new ExportSessionCleanup(vi.fn());expect(()=>owner.registerCreated(id as string)).toThrow(/标识/);expect(owner.diagnostics().owned).toBe(0);
 });
 it.each([200,204,404])('retires only a successful or absent cleanup response %s',async status=>{
  const fetcher=vi.fn<ExportCleanupFetch>().mockResolvedValue(response(status)),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  await ticket.cleanup();expect(ticket.pending).toBe(false);expect(owner.diagnostics()).toEqual({owned:0,pendingCleanup:0,ids:[]});
  expect(fetcher).toHaveBeenCalledWith(`/api/exports/${id1}?onlyUnfinished=true`,{method:'DELETE',cache:'no-store'});
  await ticket.cleanup();await owner.flush();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([400,401,403,409,429,500,503])('retains failed HTTP %s cleanup and retries it before allowing the next export',async status=>{
  const fetcher=vi.fn<ExportCleanupFetch>().mockResolvedValue(response(status)),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  await expect(ticket.cleanup()).rejects.toMatchObject({name:'ExportSessionCleanupError',pendingIds:[id1]});
  expect(ticket.pending).toBe(true);expect(owner.diagnostics()).toEqual({owned:1,pendingCleanup:1,ids:[id1]});
  let created=false;await expect(owner.flush().then(()=>{created=true;})).rejects.toBeInstanceOf(ExportSessionCleanupError);expect(created).toBe(false);
  fetcher.mockResolvedValue(response(204));await owner.flush();expect(ticket.pending).toBe(false);expect(owner.diagnostics().owned).toBe(0);
 });
 it('retains network and synchronous transport errors with their original cause',async()=>{
  const error=new TypeError('offline'),fetcher=vi.fn<ExportCleanupFetch>().mockRejectedValue(error),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  try{await ticket.cleanup();throw new Error('Expected failure');}catch(failure){expect(failure).toBeInstanceOf(ExportSessionCleanupError);expect((failure as AggregateError).errors).toEqual([error]);}
  fetcher.mockImplementation(()=>{throw error;});await expect(owner.flush()).rejects.toBeInstanceOf(ExportSessionCleanupError);expect(ticket.pending).toBe(true);
  fetcher.mockResolvedValue(response(404));await owner.flush();expect(owner.diagnostics().owned).toBe(0);
 });
 it('shares one in-flight cleanup promise across catch, unmount and next-dialog flush',async()=>{
  const transport=deferred<Response>(),fetcher=vi.fn<ExportCleanupFetch>().mockReturnValue(transport.promise),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  const a=ticket.cleanup(),b=ticket.cleanup(),flush1=owner.flush(),flush2=owner.flush();
  expect(a).toBe(b);expect(flush1).toBe(flush2);expect(ticket.cleanupRequested).toBe(true);
  await Promise.resolve();expect(fetcher).toHaveBeenCalledTimes(1);transport.resolve(response(200));await Promise.all([a,b,flush1,flush2]);
  expect(owner.diagnostics().owned).toBe(0);
 });
 it('survives loss of the dialog ref and never clears a different still-active export',async()=>{
  const fetcher=vi.fn<ExportCleanupFetch>().mockRejectedValue(new Error('offline')),owner=new ExportSessionCleanup(fetcher);
  let dialog=owner.registerCreated(id1);await dialog.cleanup().catch(()=>{});dialog=undefined as never;
  const active=owner.registerCreated(id2);fetcher.mockResolvedValue(response(200));await owner.flush();
  expect(owner.diagnostics()).toEqual({owned:1,pendingCleanup:0,ids:[id2]});expect(active.pending).toBe(true);
  expect(fetcher.mock.calls.every(([url])=>url.includes(id1))).toBe(true);active.finished();
 });
 it('retires successful finish without sending DELETE, including already requested cleanup',async()=>{
  const fetcher=vi.fn<ExportCleanupFetch>(),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  const pending=ticket.cleanup();ticket.finished();await pending;await owner.flush();expect(fetcher).not.toHaveBeenCalled();expect(ticket.pending).toBe(false);
 });
 it('does not resurrect completed ownership if an older in-flight cleanup rejects after finish success',async()=>{
  const transport=deferred<Response>(),fetcher=vi.fn<ExportCleanupFetch>().mockReturnValue(transport.promise),owner=new ExportSessionCleanup(fetcher),ticket=owner.registerCreated(id1);
  const cleanup=ticket.cleanup();await Promise.resolve();ticket.finished();transport.reject(new Error('response lost'));await cleanup;
  expect(owner.diagnostics().owned).toBe(0);await owner.flush();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('retired generation callbacks cannot remove a newly registered ticket even if a service reuses its ID',async()=>{
  const transport=deferred<Response>(),fetcher=vi.fn<ExportCleanupFetch>().mockReturnValue(transport.promise),owner=new ExportSessionCleanup(fetcher),old=owner.registerCreated(id1);
  const cleanup=old.cleanup();await Promise.resolve();old.finished();const current=owner.registerCreated(id1);
  transport.resolve(response(200));await cleanup;old.finished();expect(current.pending).toBe(true);expect(owner.diagnostics().ids).toEqual([id1]);current.finished();
 });
 it('flush includes another cleanup request arriving while the first transport is unresolved',async()=>{
  const first=deferred<Response>(),fetcher=vi.fn<ExportCleanupFetch>().mockReturnValueOnce(first.promise).mockResolvedValue(response(200)),owner=new ExportSessionCleanup(fetcher);
  const one=owner.registerCreated(id1),two=owner.registerCreated(id2),cleanup=one.cleanup(),flush=owner.flush();await Promise.resolve();
  const cleanup2=two.cleanup();first.resolve(response(200));await Promise.all([cleanup,cleanup2,flush]);
  expect(fetcher).toHaveBeenCalledTimes(2);expect(owner.diagnostics().owned).toBe(0);
 });
 it('flush preserves every failed ticket while retiring successful siblings',async()=>{
  const fetcher=vi.fn<ExportCleanupFetch>().mockImplementation(async url=>response(url.includes(id1)?500:204)),owner=new ExportSessionCleanup(fetcher),one=owner.registerCreated(id1),two=owner.registerCreated(id2);
  await Promise.allSettled([one.cleanup(),two.cleanup()]);await expect(owner.flush()).rejects.toMatchObject({pendingIds:[id1]});
  expect(one.pending).toBe(true);expect(two.pending).toBe(false);expect(owner.diagnostics().ids).toEqual([id1]);
 });
});
