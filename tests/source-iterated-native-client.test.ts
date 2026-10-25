import {afterEach,describe,expect,it,vi} from 'vitest';
import {exchangeSourceIteratedNative,exchangeSourceSamilaNative,renderSourceNativeFrame} from '../src/engine/sourceNativeClient';
import type {SourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';
import type {SourceSamilaNativeRequest} from '../src/engine/sourceSamilaNativeProtocol';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';

const resource='12'.repeat(16),identity='a'.repeat(64);
const read=():SourceIteratedNativeRequest=>({generation:3,sequence:5,operation:{kind:'read',resource,expectedIndex:7,expectedCount:4,offset:1,count:2}});
const createSource=():SourceIteratedNativeRequest=>({generation:3,sequence:5,operation:{kind:'create-source',resource,count:4,vertex:'#version 410 core\n// math vertex\nvoid main() {}',fragment:'#version 410 core\nvoid main() {}',diagnosticVertex:'#version 410 core\n// diagnostics vertex\nvoid main() {}',diagnosticFragment:'#version 410 core\n// diagnostics fragment\nvoid main() {}'}});
const release=():SourceIteratedNativeRequest=>({generation:3,sequence:6,operation:{kind:'release',resource,expectedCount:4}});
function reply(request:SourceIteratedNativeRequest,change?:(body:Uint8Array,headers:Record<string,string>)=>void){
 const op=request.operation;if(op.kind!=='read'&&op.kind!=='release'&&op.kind!=='advance')throw Error('fixture');
 const body=new Uint8Array(64+(op.kind==='read'?op.count*24:0)),v=new DataView(body.buffer),word=(at:number,n:number)=>v.setUint32(at,n,true);
 word(0,2);word(4,op.kind==='read'?4:op.kind==='advance'?3:5);body.set(Uint8Array.from(resource.match(/../g)!,p=>parseInt(p,16)),8);word(24,op.kind==='advance'?op.expectedIndex+1:7);word(28,op.kind==='release'?1:0);word(32,4);word(36,4);
 if(op.kind==='advance')word(48,op.steps);
 if(op.kind==='read'){word(40,1);word(44,2);for(let i=0;i<2;i++){for(let j=0;j<4;j++)v.setFloat32(64+i*24+j*4,i*4+j+.25,true);word(64+i*24+16,10+i);word(64+i*24+20,i);}}
 const headers:Record<string,string>={'content-type':'application/octet-stream','content-length':String(body.length),'x-source-generation':String(request.generation),'x-source-sequence':String(request.sequence),'x-source-width':'1','x-source-height':'1','x-source-renderer':identity,'x-source-format':'iterated-v1','x-source-row-order':'none','x-source-context':'9','x-source-session':'4'};
 change?.(body,headers);return new Response(body,{headers});
}
function sourceReply(request:SourceIteratedNativeRequest,kind=6){
 if(request.operation.kind!=='create-source')throw Error('fixture');
 const template=reply(release()),body=new Uint8Array(64),v=new DataView(body.buffer);v.setUint32(0,2,true);v.setUint32(4,kind,true);body.set(Uint8Array.from(resource.match(/../g)!,p=>parseInt(p,16)),8);v.setUint32(36,request.operation.count,true);
 const headers=new Headers(template.headers);headers.set('x-source-generation',String(request.generation));headers.set('x-source-sequence',String(request.sequence));return new Response(body,{headers});
}
const legacy=():SourceDrawingFrame=>({generation:1,sequence:1,width:1,height:1,samples:0,clear:[0,0,0,0],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});
const samila=():SourceSamilaNativeRequest=>({generation:1,sequence:1,width:1,height:1,operation:{kind:'release',resource}});
function legacyReply(){return new Response(new Uint8Array([1,2,3,4]),{headers:{'content-type':'application/octet-stream','content-length':'4','x-source-generation':'1','x-source-sequence':'1','x-source-width':'1','x-source-height':'1','x-source-renderer':identity,'x-source-format':'rgba8','x-source-row-order':'bottom-up'}});}
function samilaReply(){const body=new Uint8Array(64),v=new DataView(body.buffer);v.setUint32(0,1,true);v.setUint32(4,3,true);body.set(Uint8Array.from(resource.match(/../g)!,p=>parseInt(p,16)),8);v.setUint32(28,2,true);return new Response(body,{headers:{'content-type':'application/octet-stream','content-length':'64','x-source-generation':'1','x-source-sequence':'1','x-source-width':'1','x-source-height':'1','x-source-renderer':identity,'x-source-format':'samila-v1','x-source-row-order':'none','x-source-context':'0','x-source-session':'4'}});}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('iterated v6/v7 production client transport (CPU mock fetch only)',()=>{
 it('transports v7 source programs through the existing shared client and binds the submitted snapshot',async()=>{
  const input=createSource(),sent=structuredClone(input);let deliver!:(response:Response)=>void;
  const fetch=vi.fn(()=>new Promise<Response>(resolve=>{deliver=resolve;}));vi.stubGlobal('fetch',fetch);
  const pending=exchangeSourceIteratedNative(input);if(input.operation.kind!=='create-source')throw Error('fixture');
  input.operation.count=8;input.operation.resource='34'.repeat(16);input.operation.diagnosticVertex='invalid';input.operation={kind:'release',resource:input.operation.resource};input.generation=99;
  deliver(sourceReply(sent));expect(await pending).toMatchObject({resource,index:0,uploaded:0,totalCount:4,readCount:0,steps:0,generation:3,sequence:5,contextSerial:9,sessionSerial:4});
  const packet=(fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as Uint8Array,v=new DataView(packet.buffer,packet.byteOffset);
  expect([v.getUint32(4,true),v.getUint32(60,true),v.getUint32(64,true),v.getUint32(88,true)]).toEqual([7,2,6,4]);
  let at=92;const shaders=[];for(let i=0;i<4;i++){const n=v.getUint32(at,true);at+=4;shaders.push(new TextDecoder().decode(packet.subarray(at,at+n)));at+=n;}expect(at).toBe(packet.length);
  if(sent.operation.kind!=='create-source')throw Error('fixture');expect(shaders).toEqual([sent.operation.vertex,sent.operation.fragment,sent.operation.diagnosticVertex,sent.operation.diagnosticFragment]);
 });
 it.each(['diagnosticVertex','diagnosticFragment'] as const)('rejects malformed %s before fetch and releases the transport slot',async field=>{
  const input=createSource();Object.assign(input.operation,{[field]:'#version 300 es\nvoid main() {}'});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:'input'});expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal('fetch',vi.fn(async()=>sourceReply(createSource())));expect((await exchangeSourceIteratedNative(createSource())).totalCount).toBe(4);
 });
 it('rejects an old create ACK for a new source resource without publishing ownership',async()=>{
  const input=createSource();vi.stubGlobal('fetch',vi.fn(async()=>sourceReply(input,1)));await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:'protocol'});
 });
 it('submits the production packet and returns state words without image row operations',async()=>{
  const input=read(),fetch=vi.fn(async()=>reply(input));vi.stubGlobal('fetch',fetch);const result=await exchangeSourceIteratedNative(input);
  expect(result).toMatchObject({resource,index:7,uploaded:4,totalCount:4,offset:1,readCount:2,steps:0,contextSerial:9,sessionSerial:4,generation:3,sequence:5,width:1,height:1,rendererIdentity:identity});
  expect(Array.from(result.positionsAndMetric!)).toEqual([.25,1.25,2.25,3.25,4.25,5.25,6.25,7.25]);expect(Array.from(result.invalidCounts!)).toEqual([10,11]);expect(Array.from(result.validity!)).toEqual([0,1]);expect(result).not.toHaveProperty('pixels');
  const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/source-renderer/frames');expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error'});
  const packet=init.body as Uint8Array,v=new DataView(packet.buffer,packet.byteOffset);expect(v.getUint32(4,true)).toBe(6);expect(v.getUint32(60,true)).toBe(2);expect(result.requestBytes).toBe(100);
 });
 it.each([6,7] as const)('transports 3D in the existing v%s dimension field without changing the 2D packet layout',async version=>{
  const inputs=([2,3] as const).map(dimension=>({generation:3,sequence:5,operation:{kind:'advance',resource,expectedIndex:7,expectedCount:4,reset:false,...(version===7?{resetCounter:true}:{}),dimension,steps:5,uniforms:[{name:'gain',value:.25}]}} satisfies SourceIteratedNativeRequest));
  let received=0;const fetch=vi.fn(async()=>reply(inputs[received++]));vi.stubGlobal('fetch',fetch);
  for(const input of inputs)expect(await exchangeSourceIteratedNative(input)).toMatchObject({index:8,totalCount:4,uploaded:4,steps:5});
  const packets=fetch.mock.calls.map(call=>new Uint8Array((call as unknown as [string,RequestInit])[1].body as Uint8Array));
  const dimensionOffset=version===7?100:96;
  for(let i=0;i<packets.length;i++){
   const bytes=packets[i],view=new DataView(bytes.buffer,bytes.byteOffset);expect(view.getUint32(4,true)).toBe(version);expect(view.getUint32(60,true)).toBe(2);expect(view.getUint32(64,true)).toBe(3);
   expect([view.getUint32(88,true),view.getUint32(92,true),view.getUint32(dimensionOffset,true),view.getUint32(dimensionOffset+4,true),view.getUint32(dimensionOffset+8,true)]).toEqual([7,0,inputs[i].operation.dimension,5,1]);
   if(version===7)expect(view.getUint32(96,true)).toBe(1);
  }
  // The new dimension value uses the existing word; every other byte is the
  // production 2D encoding, including the uniform table and v7 reset counter.
  new DataView(packets[1].buffer).setUint32(dimensionOffset,2,true);expect(packets[1]).toEqual(packets[0]);
 });
 it('rejects dimensions 1 and 4 before fetch for both versions without retaining the shared slot',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  for(const version of [6,7])for(const dimension of [1,4]){
   const input={generation:3,sequence:5,operation:{kind:'advance',resource,expectedIndex:7,expectedCount:4,reset:false,...(version===7?{resetCounter:true}:{}),dimension,steps:5,uniforms:[]}} as unknown as SourceIteratedNativeRequest;
   await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:'input'});
  }
  expect(fetch).not.toHaveBeenCalled();vi.stubGlobal('fetch',vi.fn(async()=>reply(release())));expect((await exchangeSourceIteratedNative(release())).disposition).toBe('released');
 });
 it.each(['format','content-type','row-order','renderer','generation','sequence','width','height','context','session','length'] as const)('rejects an inconsistent %s header and releases the shared slot',async kind=>{
  const input=read();vi.stubGlobal('fetch',vi.fn(async()=>reply(input,(_body,h)=>{
   if(kind==='format')h['x-source-format']='rgba8';if(kind==='content-type')h['content-type']='application/json';if(kind==='row-order')h['x-source-row-order']='bottom-up';if(kind==='renderer')h['x-source-renderer']='unknown';if(kind==='generation')h['x-source-generation']='2';if(kind==='sequence')h['x-source-sequence']='6';if(kind==='width')h['x-source-width']='2';if(kind==='height')h['x-source-height']='2';if(kind==='context')h['x-source-context']='0';if(kind==='session')h['x-source-session']='0';if(kind==='length')h['content-length']='113';
  })));
  await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:'protocol'});vi.stubGlobal('fetch',vi.fn(async()=>reply(release())));expect((await exchangeSourceIteratedNative(release())).disposition).toBe('released');
 });
 it.each(['resource','family','kind','index','uploaded','total','offset','count','steps','reserved','validity'] as const)('rejects forged %s payload fields',async kind=>{
  const input=read();vi.stubGlobal('fetch',vi.fn(async()=>reply(input,(body)=>{
   const v=new DataView(body.buffer);if(kind==='resource')body[8]^=1;
   const changes:Record<string,[number,number]>={family:[0,1],kind:[4,3],index:[24,8],uploaded:[32,3],total:[36,5],offset:[40,0],count:[44,1],steps:[48,1],reserved:[56,1],validity:[108,2]};if(changes[kind])v.setUint32(...changes[kind],true);
  })));await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:'protocol'});
 });
 it.each(['truncated','extra'] as const)('bounds actual streamed %s bytes independently of content-length',async kind=>{
  const input=read(),original=reply(input),buffer=new Uint8Array(await original.arrayBuffer()),body=new Uint8Array(kind==='extra'?buffer.length+1:buffer.length-1);body.set(buffer.subarray(0,Math.min(body.length,buffer.length)));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{headers:original.headers})));await expect(exchangeSourceIteratedNative(input)).rejects.toMatchObject({kind:kind==='extra'?'capacity':'protocol'});
 });
 it('retains remote ownership/state-lost failures instead of substituting output',async()=>{
  for(const kind of ['ownership','state-lost','cleanup']){vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({kind,error:'exact resource unavailable'}),{status:409})));await expect(exchangeSourceIteratedNative(read())).rejects.toMatchObject({kind});}
 });
 it('rejects malformed input, over-budget retained state and pre-cancelled calls before network',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const input=read();if(input.operation.kind!=='read')throw Error('fixture');
  await expect(exchangeSourceIteratedNative({...input,operation:{...input.operation,count:65537}})).rejects.toMatchObject({kind:'input'});
  await expect(exchangeSourceIteratedNative(input,{retainedBytes:256*1024*1024})).rejects.toMatchObject({kind:'capacity'});
  const controller=new AbortController();controller.abort();await expect(exchangeSourceIteratedNative(input,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal('fetch',vi.fn(async()=>reply(input)));expect((await exchangeSourceIteratedNative(input)).index).toBe(7);
 });
 it.each([read,createSource])('shares one slot with legacy and Samila, and cancellation allows both families to resume (%#)',async input=>{
  const controller=new AbortController(),fetch=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true})));vi.stubGlobal('fetch',fetch);
  const pending=exchangeSourceIteratedNative(input(),{signal:controller.signal});
  await expect(exchangeSourceIteratedNative(read())).rejects.toMatchObject({kind:'capacity'});await expect(renderSourceNativeFrame(legacy())).rejects.toMatchObject({kind:'capacity'});await expect(exchangeSourceSamilaNative(samila())).rejects.toMatchObject({kind:'capacity'});expect(fetch).toHaveBeenCalledOnce();
  controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  vi.stubGlobal('fetch',vi.fn(async()=>samilaReply()));expect((await exchangeSourceSamilaNative(samila())).disposition).toBe('absent');
  vi.stubGlobal('fetch',vi.fn(async()=>legacyReply()));expect(Array.from((await renderSourceNativeFrame(legacy())).pixels)).toEqual([1,2,3,4]);
  vi.stubGlobal('fetch',vi.fn(async()=>reply(read())));expect((await exchangeSourceIteratedNative(read())).index).toBe(7);
 });
 it('does not allow iterated requests to bypass a slot held by a legacy request',async()=>{
  const controller=new AbortController();vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}))));
  const pending=renderSourceNativeFrame(legacy(),{signal:controller.signal});await expect(exchangeSourceIteratedNative(read())).rejects.toMatchObject({kind:'capacity'});controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
 });
 it('binds an acknowledged request to its submitted snapshot despite caller mutation during transport',async()=>{
  const input=read(),sent=structuredClone(input);let deliver!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{deliver=resolve;})));
  const pending=exchangeSourceIteratedNative(input);if(input.operation.kind!=='read')throw Error('fixture');input.operation.expectedCount=5;input.operation.expectedIndex=8;input.operation.offset=0;input.operation.resource='34'.repeat(16);input.generation=99;
  deliver(reply(sent));expect(await pending).toMatchObject({generation:3,sequence:5,resource,index:7,totalCount:4,offset:1,readCount:2});
 });
});
