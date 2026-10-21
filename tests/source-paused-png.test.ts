import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeSourcePausedPng} from '../src/engine/sourcePausedPng';
import {prepareSourcePausedPng,type SourcePausedPngRequest} from '../src/engine/sourcePausedPngContract';
class ImageWorker {
 static instances:ImageWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 onmessageerror:(()=>void)|null=null;
 request?:SourcePausedPngRequest;
 terminate=vi.fn();
 constructor(){ImageWorker.instances.push(this);}
 postMessage(request:SourcePausedPngRequest,transfer:ArrayBuffer[]){this.request=structuredClone(request,{transfer});}
}
const pixels=()=>new Uint8ClampedArray([1,77,233,0,3,127,39,1]);
function start(scale:1|3|5=3){
 ImageWorker.instances=[];vi.stubGlobal('Worker',ImageWorker);
 const input=pixels(),abort=new AbortController(),pending=encodeSourcePausedPng(input,2,1,scale,{signal:abort.signal}),worker=ImageWorker.instances[0];
 return{input,abort,pending,worker};
}
afterEach(()=>vi.unstubAllGlobals());
describe('isolated current-image PNG worker ownership',()=>{
 it('transfers only a compact owned copy, validates output dimensions and releases the worker',async()=>{
  const f=start(),blob=new Blob(['encoded'],{type:'image/png'});
  expect(f.worker.request?.pixels).toEqual(f.input);expect(f.input).toEqual(pixels());
  f.worker.onmessage!({data:{operation:'encode-source-paused-png',id:1,result:{blob,width:6,height:3}}});
  expect(await f.pending).toBe(blob);expect(f.input).toEqual(pixels());expect(f.worker.terminate).toHaveBeenCalledOnce();
  expect(f.worker.onmessage).toBeNull();f.abort.abort();expect(f.worker.terminate).toHaveBeenCalledOnce();
 });
 it('terminates work on abort and can retry without detaching the retained frame',async()=>{
  const f=start(),rejected=f.pending.catch(e=>e);f.abort.abort();
  expect(await rejected).toMatchObject({name:'AbortError'});expect(f.worker.terminate).toHaveBeenCalledOnce();expect(f.input).toEqual(pixels());
  const retry=encodeSourcePausedPng(f.input,2,1,1),worker=ImageWorker.instances[1],blob=new Blob(['retry'],{type:'image/png'});
  worker.onmessage!({data:{operation:'encode-source-paused-png',id:1,result:{blob,width:2,height:1}}});
  expect(await retry).toBe(blob);expect(worker.terminate).toHaveBeenCalledOnce();expect(f.input).toEqual(pixels());
 });
 it.each(['identity','size','type','empty','worker-error','decode-error','reported-error'])('rejects %s and releases only its own worker',async failure=>{
  const f=start(),caught=f.pending.catch(e=>e);
  if(failure==='worker-error')f.worker.onerror!({message:'worker died'});
  else if(failure==='decode-error')f.worker.onmessageerror!();
  else if(failure==='reported-error')f.worker.onmessage!({data:{operation:'encode-source-paused-png',id:1,error:'encoding budget'}});
  else f.worker.onmessage!({data:{operation:'encode-source-paused-png',id:failure==='identity'?9:1,result:{width:failure==='size'?2:6,height:3,blob:new Blob(failure==='empty'?[]:['bytes'],{type:failure==='type'?'image/jpeg':'image/png'})}}});
  expect(await caught).toBeInstanceOf(Error);expect(f.worker.terminate).toHaveBeenCalledOnce();expect(f.input).toEqual(pixels());
 });
 it('rejects cancelled, invalid and over-budget inputs before creating a worker',async()=>{
  ImageWorker.instances=[];vi.stubGlobal('Worker',ImageWorker);const abort=new AbortController();abort.abort();
  await expect(encodeSourcePausedPng(pixels(),2,1,1,{signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
  await expect(encodeSourcePausedPng(new Uint8ClampedArray(7),2,1,1)).rejects.toThrow('RGBA');
  await expect(encodeSourcePausedPng(pixels(),2,1,2 as 1)).rejects.toThrow('倍率');
  expect(()=>prepareSourcePausedPng(8192,4096,5,128*1024**2)).toThrow();
  // Count both the original labelled frame and its base-size composition.
  expect(()=>prepareSourcePausedPng(8192,4096,1,256*1024**2)).toThrow('768 MiB');
  expect(ImageWorker.instances).toHaveLength(0);
 });
 it('releases a worker whose input publication throws',async()=>{
  const terminate=vi.fn();vi.stubGlobal('Worker',class{terminate=terminate;postMessage(){throw Error('transfer failed');}});
  const input=pixels();await expect(encodeSourcePausedPng(input,2,1,1)).rejects.toThrow('transfer failed');
  expect(terminate).toHaveBeenCalledOnce();expect(input).toEqual(pixels());
 });
});
