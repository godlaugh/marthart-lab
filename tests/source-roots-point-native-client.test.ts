import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {create,begin,request,reply,resource} from './source-roots-point-native-fixture';
import {sourceRootsPointNativeFrameSchedule,type SourceRootsPointNativeRequest} from '../src/engine/sourceRootsPointNativeProtocol';
vi.mock('../src/engine/sourceNativeLease',()=>({sourceNativeLeaseToken:()=> 'ab'.repeat(16),ensureSourceNativeLease:vi.fn(async()=>{})}));
beforeEach(()=>vi.resetModules());afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function response(r:SourceRootsPointNativeRequest,body=reply(r),extra:Record<string,string>={}){
 return new Response(body,{headers:{'content-type':'application/octet-stream','content-length':String(body.length),'x-source-generation':String(r.generation),'x-source-sequence':String(r.sequence),'x-source-width':String(r.width),'x-source-height':String(r.height),'x-source-renderer':'a'.repeat(64),'x-source-format':'roots-point-v1','x-source-row-order':r.operation.kind==='finish'?'bottom-up':'none','x-source-context':'1','x-source-session':'1',...extra}});
}
it('delivers full RGBA including nonopaque alpha top-down exactly once',async()=>{
 const b=begin();if(b.operation.kind!=='begin')throw Error();const r=request({kind:'finish',resource,expectedDisplay:0,frame:sourceRootsPointNativeFrameSchedule(b.operation)},1,2),raw=reply(r);raw.set([1,2,3,25,4,5,6,127],96);
 vi.stubGlobal('fetch',vi.fn(async()=>response(r,raw)));const api=await import('../src/engine/sourceNativeClient');
 const result=await api.withSourceRootsPointNativeTransaction(send=>send(r));expect([...result.pixels!]).toEqual([4,5,6,127,1,2,3,25]);expect(result).toMatchObject({displayIndex:1,phase:'idle',receivedPoints:7,nextChunk:3,width:1,height:2,contextSerial:1,sessionSerial:1});
});
it('binds HTTP and payload identities before caller mutation across an await',async()=>{
 const r=create();vi.stubGlobal('fetch',vi.fn(async()=>{const out=response(r);r.generation=77;r.width=9;r.operation.resource='cd'.repeat(16);return out;}));
 const api=await import('../src/engine/sourceNativeClient');expect(await api.withSourceRootsPointNativeTransaction(send=>send(r))).toMatchObject({resource,generation:1,width:2});
});
it.each(['format','row-order','sequence','context','session','payload','short'] as const)('rejects %s before publishing native output',async kind=>{
 const r=create(),body=reply(r),extra:Record<string,string>={};
 if(kind==='format')extra['x-source-format']='rgba8';if(kind==='row-order')extra['x-source-row-order']='bottom-up';if(kind==='sequence')extra['x-source-sequence']='9';if(kind==='context')extra['x-source-context']='0';if(kind==='session')extra['x-source-session']='0';if(kind==='payload')new DataView(body.buffer).setUint32(60,1,true);
 vi.stubGlobal('fetch',vi.fn(async()=>response(r,kind==='short'?body.subarray(0,-1):body,extra)));const api=await import('../src/engine/sourceNativeClient');await expect(api.withSourceRootsPointNativeTransaction(send=>send(r))).rejects.toMatchObject({kind:'protocol'});
});
it('holds the shared slot between ACKs and rejects an escaped transaction capability',async()=>{
 const r=create();vi.stubGlobal('fetch',vi.fn(async()=>response(r)));const api=await import('../src/engine/sourceNativeClient');let finish!:()=>void,saved:Parameters<Parameters<typeof api.withSourceRootsPointNativeTransaction>[0]>[0]|undefined,ready!:()=>void;
 const started=new Promise<void>(resolve=>ready=resolve),pending=api.withSourceRootsPointNativeTransaction(async send=>{saved=send;await send(r);ready();await new Promise<void>(resolve=>finish=resolve);});await started;
 await expect(api.withSourceRootsPointNativeTransaction(async send=>send(r))).rejects.toMatchObject({kind:'capacity'});await expect(api.releaseSourceRootsPointNative(request({kind:'release',resource}))).rejects.toMatchObject({kind:'capacity'});
 finish();await pending;await expect(saved!(r)).rejects.toMatchObject({kind:'ownership'});
});
it('does not release the slot when the callback returns before an outstanding ACK',async()=>{
 const r=create();let deliver!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>deliver=resolve)));
 const api=await import('../src/engine/sourceNativeClient');const pending=api.withSourceRootsPointNativeTransaction(async send=>{void send(r);});
 await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));await expect(api.withSourceRootsPointNativeTransaction(async()=>{})).rejects.toMatchObject({kind:'capacity'});
 deliver(response(r));await expect(pending).rejects.toMatchObject({kind:'ownership'});
});
it('rejects overlapping commands before any second fetch',async()=>{
 const r=create();let deliver!:(r:Response)=>void;const fetch=vi.fn(()=>new Promise<Response>(resolve=>deliver=resolve));vi.stubGlobal('fetch',fetch);
 const api=await import('../src/engine/sourceNativeClient');await api.withSourceRootsPointNativeTransaction(async send=>{const first=send(r);await expect(send(r)).rejects.toMatchObject({kind:'capacity'});expect(fetch).toHaveBeenCalledTimes(1);deliver(response(r));await first;});
});
it('retries explicitly busy cleanup while holding the slot, without inheriting caller cancellation',async()=>{
 vi.useFakeTimers();const r=request({kind:'release',resource});let attempts=0;vi.stubGlobal('fetch',vi.fn(async()=>++attempts===1?new Response(JSON.stringify({kind:'capacity',retryable:true,error:'busy'}),{status:429}):response(r)));
 const api=await import('../src/engine/sourceNativeClient'),pending=api.releaseSourceRootsPointNative(r);await vi.advanceTimersByTimeAsync(0);await expect(api.withSourceRootsPointNativeTransaction(async()=>{})).rejects.toMatchObject({kind:'capacity'});await vi.advanceTimersByTimeAsync(25);expect(await pending).toMatchObject({disposition:'absent'});expect(attempts).toBe(2);
});
it('keeps an ordinary capacity failure visible and permits owner-directed cleanup retry',async()=>{
 const r=request({kind:'release',resource});let fail=true;const fetch=vi.fn(async()=>fail?new Response(JSON.stringify({kind:'capacity',error:'limit'}),{status:429}):response(r));vi.stubGlobal('fetch',fetch);
 const api=await import('../src/engine/sourceNativeClient');await expect(api.releaseSourceRootsPointNative(r)).rejects.toMatchObject({kind:'capacity'});expect(fetch).toHaveBeenCalledTimes(1);fail=false;expect((await api.releaseSourceRootsPointNative(r)).disposition).toBe('absent');
});
