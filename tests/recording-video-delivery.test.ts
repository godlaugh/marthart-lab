import {describe,expect,it,vi} from 'vitest';
import {RecordingVideoDelivery} from '../src/engine/recordingVideoDelivery';
import {ExportSessionCleanup} from '../src/engine/exportSessionCleanup';
const id='11111111-1111-4111-8111-111111111111',url=`/api/exports/${id}/file`;
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const state=(v:Record<string,unknown>={})=>({id,status:'encoding',expected:5,frames:0,locked:false,...v});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
function setup(fetcher:(url:string,init:RequestInit)=>Promise<Response>,recover=vi.fn(async()=>{}),expected:number|{expected:null;frameLimit:number}=5){
 const cleanup=vi.fn(async()=>new Response(null,{status:204})),owner=new ExportSessionCleanup(cleanup),ticket=owner.registerCreated(id),abort=new AbortController();
 return{delivery:new RecordingVideoDelivery(ticket,expected,abort.signal,recover,fetcher),ticket,abort,cleanup,owner};
}
describe('retained recording delivery owns acknowledged frames across uncertain responses',()=>{
 it('reconciles an accepted upload without resending or regenerating it, then seals only the confirmed prefix',async()=>{
  const blob=new Blob(['same encoded frame']);
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('lost upload response')).mockResolvedValueOnce(response(state({frames:1}))).mockResolvedValueOnce(response({id,url,frames:1}));
  const s=setup(fetcher);await s.delivery.upload(blob,0);expect(s.ticket.pending).toBe(true);
  expect(await s.delivery.finish(1)).toEqual({url,frames:1});
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual([`/api/exports/${id}/frames?index=0`,`/api/exports/${id}`,`/api/exports/${id}/finish`]);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({finalFrames:1});expect(s.ticket.pending).toBe(false);expect(s.cleanup).not.toHaveBeenCalled();
 });
 it('recovers a completed file from GET after losing finish response and protects it from late cleanup',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response({frames:1})).mockRejectedValueOnce(new TypeError('lost finish response')).mockResolvedValueOnce(response(state({status:'complete',frames:1,finalFrames:1,url})));
  const recover=vi.fn(async()=>{}),s=setup(fetcher,recover);await s.delivery.upload(new Blob(),0);expect(await s.delivery.finish(1)).toEqual({url,frames:1});
  await s.ticket.cleanup();expect(s.cleanup).not.toHaveBeenCalled();expect(recover).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('holds ownership during unknown finish until explicit retry sends the same sealed request',async()=>{
  const ready=deferred<void>(),retry=deferred<void>();
  const recover=vi.fn(async(_error:Error)=>{ready.resolve();await retry.promise;});
  const fetcher=vi.fn().mockResolvedValueOnce(response({frames:1})).mockRejectedValueOnce(new TypeError('offline finish')).mockRejectedValueOnce(new TypeError('offline GET')).mockResolvedValueOnce(response({id,url,frames:1}));
  const s=setup(fetcher,recover);await s.delivery.upload(new Blob(),0);let ended=false;const save=s.delivery.finish(1).then(v=>{ended=true;return v;});await ready.promise;
  expect(ended).toBe(false);expect(s.ticket.pending).toBe(true);expect(s.cleanup).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(3);
  retry.resolve();expect(await save).toEqual({url,frames:1});expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[3][1].body);expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[3][0]);
 });
 it('waits for cleanup before releasing an explicitly discarded unknown save',async()=>{
  const ready=deferred<void>(),retry=deferred<void>(),deleted=deferred<Response>();
  const fetcher=vi.fn().mockResolvedValueOnce(response({frames:1})).mockRejectedValue(new TypeError('offline'));
  const recover=vi.fn(async(_error:Error)=>{ready.resolve();await retry.promise;});const s=setup(fetcher,recover);s.cleanup.mockReturnValue(deleted.promise);
  await s.delivery.upload(new Blob(),0);let ended=false;const save=s.delivery.finish(1).catch(e=>{ended=true;return e;});await ready.promise;s.abort.abort();retry.resolve();
  await vi.waitFor(()=>expect(s.cleanup).toHaveBeenCalledTimes(1));expect(ended).toBe(false);expect(s.ticket.pending).toBe(true);
  deleted.resolve(new Response(null,{status:204}));expect(await save).toMatchObject({name:'AbortError'});expect(s.ticket.pending).toBe(false);
 });
 it('reports a confirmed encoder failure and does not promise reconstruction of discarded PNGs',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response({frames:1})).mockResolvedValueOnce(response({error:'encoder failed'},500)).mockResolvedValueOnce(response(state({status:'failed',frames:1,finalFrames:1,error:'encoder failed'})));
  const recover=vi.fn(async()=>{}),s=setup(fetcher,recover);await s.delivery.upload(new Blob(),0);await expect(s.delivery.finish(1)).rejects.toThrow('encoder failed');
  expect(recover).not.toHaveBeenCalled();expect(s.cleanup).toHaveBeenCalledTimes(1);expect(s.owner.diagnostics().owned).toBe(0);
 });
 it('does not retransmit an upload while the server is locked, and retries the identical Blob after explicit recovery',async()=>{
  const ready=deferred<void>(),retry=deferred<void>(),blob=new Blob(['retained bytes']);
  const recover=vi.fn(async(_error:Error)=>{ready.resolve();await retry.promise;});
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('lost')).mockResolvedValueOnce(response(state({locked:true}))).mockResolvedValueOnce(response({frames:1}));
  const s=setup(fetcher,recover),upload=s.delivery.upload(blob,0);await ready.promise;expect(fetcher).toHaveBeenCalledTimes(2);retry.resolve();await upload;
  expect(fetcher.mock.calls[0][1].body).toBe(blob);expect(fetcher.mock.calls[2][1].body).toBe(blob);await s.ticket.cleanup();
 });
 it('does not retire an unknown or mismatched completion identity',async()=>{
  const ready=deferred<void>(),retry=deferred<void>();
  const recover=vi.fn(async(_error:Error)=>{ready.resolve();await retry.promise;});
  const fetcher=vi.fn().mockResolvedValueOnce(response({frames:1})).mockResolvedValueOnce(response({id,url:'https://invalid.example/file',frames:1})).mockResolvedValueOnce(response(state({status:'complete',frames:1,finalFrames:1,url:'/wrong'})));
  const s=setup(fetcher,recover);await s.delivery.upload(new Blob(),0);const save=s.delivery.finish(1).catch(e=>e);await ready.promise;expect(s.ticket.pending).toBe(true);expect(s.cleanup).not.toHaveBeenCalled();s.abort.abort();retry.resolve();expect(await save).toMatchObject({name:'AbortError'});
 });
 it('retains unknown malformed status instead of coercing it into a terminal failure',async()=>{
  const ready=deferred<void>(),retry=deferred<void>();
  const recover=vi.fn(async(_error:Error)=>{ready.resolve();await retry.promise;});
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('upload response lost')).mockResolvedValueOnce(response(state({status:['encoding']})));
  const s=setup(fetcher,recover),upload=s.delivery.upload(new Blob(),0).catch(e=>e);await ready.promise;
  expect(s.ticket.pending).toBe(true);expect(s.cleanup).not.toHaveBeenCalled();expect(recover.mock.calls[0][0]).toMatchObject({message:'录制任务状态无效'});
  s.abort.abort();retry.resolve();expect(await upload).toMatchObject({name:'AbortError'});
 });
});

describe('observed recording delivery',()=>{
 it('requires an explicit unknown-total acknowledgement and finite resource capacity',()=>{
  for(const expected of [{frameLimit:10},{expected:10,frameLimit:10},{expected:null,frameLimit:0},{expected:null,frameLimit:Infinity}])expect(()=>setup(vi.fn(),vi.fn(),expected as never)).toThrow('明确容量');
 });
 it('reconciles unknown-length uploads and seals an actual count below capacity',async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(Error('lost upload')).mockResolvedValueOnce(response(state({expected:null,frameLimit:100,frames:1}))).mockRejectedValueOnce(Error('lost finish')).mockResolvedValueOnce(response(state({expected:null,frameLimit:100,frames:1,status:'complete',finalFrames:1,url})));
  const recover=vi.fn(async()=>{}),s=setup(fetcher,recover,{expected:null,frameLimit:100});
  await s.delivery.upload(new Blob(),0);expect(await s.delivery.finish(1)).toEqual({url,frames:1});expect(recover).not.toHaveBeenCalled();expect(s.ticket.pending).toBe(false);
 });
 it('does not turn a reached resource capacity into natural completion',async()=>{
  const fetcher=vi.fn().mockResolvedValue(response({frames:1})),s=setup(fetcher,vi.fn(),{expected:null,frameLimit:1});
  await s.delivery.upload(new Blob(),0);await expect(s.delivery.upload(new Blob(),1)).rejects.toThrow('资源上限');expect(fetcher).toHaveBeenCalledTimes(1);expect(s.cleanup).toHaveBeenCalledOnce();
 });
 it('rejects changed capacity during uncertain-response recovery',async()=>{
  const recover=vi.fn(async()=>{throw Error('stop recovery');}),fetcher=vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce(response(state({expected:null,frameLimit:99,frames:1}))),s=setup(fetcher,recover,{expected:null,frameLimit:100});
  await expect(s.delivery.upload(new Blob(),0)).rejects.toThrow('stop recovery');expect(recover).toHaveBeenCalledWith(expect.objectContaining({message:'录制任务状态无效'}));expect(s.ticket.pending).toBe(true);await s.ticket.cleanup();
 });
});
