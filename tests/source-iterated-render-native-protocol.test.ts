import {afterEach,describe,expect,it,vi} from 'vitest';
import {SOURCE_ITERATED_RENDER_PROGRAM_NAMES,encodeSourceIteratedRenderNativeRequest,decodeSourceIteratedRenderNativeResponse,captureSourceIteratedRenderNativeResponseBinding,type SourceIteratedRenderNativeRequest,type SourceIteratedRenderNativePrograms} from '../src/engine/sourceIteratedRenderNativeProtocol';
import {encodeSourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';
import {exchangeSourceIteratedNative,exchangeSourceIteratedRenderNative} from '../src/engine/sourceNativeClient';
const resource='12'.repeat(16),stateResource='34'.repeat(16);
const programs=Object.fromEntries(SOURCE_ITERATED_RENDER_PROGRAM_NAMES.map(k=>[k,{vertex:'#version 410 core\nvoid main(){}',fragment:'#version 410 core\nvoid main(){}'}])) as SourceIteratedRenderNativePrograms;
const common={resource,stateResource,expectedIndex:7,expectedDisplays:3,expectedCount:8};
const present=():SourceIteratedRenderNativeRequest=>({generation:2,sequence:4,width:3,height:2,operation:{...common,kind:'present',plan:{filter:'linear',clear:[0,0,0,1],uniforms:[]}}});
const draw=():SourceIteratedRenderNativeRequest=>({...present(),operation:{...common,kind:'draw',clear:false,record:true,decay:.7,plan:{primitive:'points',palette:{key:'palette',format:'source-rgb1024',values:new Float32Array(3072)},noise:new Uint8Array(256),drawUniforms:[],statsUniforms:[]}}});
// Independently constructed protocol replies; these are transport fixtures,
// not evidence of native shaders or GPU mathematics.
function reply(r:SourceIteratedRenderNativeRequest){
 const op=r.operation,b=new Uint8Array(128+(op.kind==='present'?r.width*r.height*4:0)),v=new DataView(b.buffer),u=(at:number,n:number)=>v.setUint32(at,n,true);
 if(op.profile==='source-fragment'){u(100,1);if(op.kind!=='release'){u(92,1);u(96,1);}}
 u(0,3);u(4,{create:1,draw:2,present:3,release:4,'replace-programs':5}[op.kind]);b.set(Uint8Array.from(resource.match(/../g)!,s=>parseInt(s,16)),8);
 if(op.kind==='release'){u(48,2);return b;}
 b.set(Uint8Array.from(stateResource.match(/../g)!,s=>parseInt(s,16)),24);u(40,op.expectedIndex);u(44,op.expectedDisplays+(op.kind==='draw'?1:0));u(52,op.expectedCount);u(56,r.width);u(60,r.height);
 if(op.kind==='draw'){u(64,17);u(72,5);u(76,2);u(80,op.record?1:0);}
 if(op.kind==='present'){u(84,5);v.setFloat32(88,4.5,true);for(let i=0;i<r.width*r.height;i++)b.set([i+1,0,0,255],128+i*4);}
 return b;
}
function response(r:SourceIteratedRenderNativeRequest,raw=reply(r)){
 return new Response(raw as Uint8Array<ArrayBuffer>,{headers:{'content-type':'application/octet-stream','content-length':String(raw.length),'x-source-format':'iterated-render-v1','x-source-row-order':r.operation.kind==='present'?'bottom-up':'none','x-source-renderer':'a'.repeat(64),'x-source-generation':String(r.generation),'x-source-sequence':String(r.sequence),'x-source-width':String(r.width),'x-source-height':String(r.height),'x-source-context':'1','x-source-session':'2'}});
}
afterEach(()=>vi.unstubAllGlobals());
describe('v7 retained iterated drawing contract',()=>{
 it('uses explicit v10 profile/unit words while keeping v7 bytes unchanged',()=>{
  const legacy=present(),fragment=present();fragment.operation.profile='source-fragment';
  const a=encodeSourceIteratedRenderNativeRequest(legacy),b=encodeSourceIteratedRenderNativeRequest(fragment);expect(a.ok&&b.ok).toBe(true);if(!a.ok||!b.ok)return;
  const v=new DataView(b.value.buffer);expect([v.getUint32(4,true),v.getUint32(88,true),v.getUint32(92,true),v.getUint32(116,true)]).toEqual([10,1,1,7]);expect(b.value.length).toBe(a.value.length+8);expect(b.value.subarray(96)).toEqual(a.value.subarray(88));
  expect(decodeSourceIteratedRenderNativeResponse(reply(fragment),fragment)).toMatchObject({diagnosticUnit:'completed-pass',executionProfile:'source-fragment'});
  expect(decodeSourceIteratedRenderNativeResponse(reply(legacy),legacy)).toMatchObject({diagnosticUnit:'iteration',executionProfile:'transform-feedback'});
 });
 it.each([92,96,100,104])('rejects v10 unit/profile corruption at %s before publishing statistics',at=>{
  const r=draw();r.operation.profile='source-fragment';const raw=reply(r);raw[at]^=1;expect(()=>decodeSourceIteratedRenderNativeResponse(raw,r)).toThrow();
 });
 it('does not invent a diagnostic unit for an absent fragment ink owner',()=>{
  const r:SourceIteratedRenderNativeRequest={generation:1,sequence:1,width:1,height:1,operation:{kind:'release',resource,profile:'source-fragment'}};
  const encoded=encodeSourceIteratedRenderNativeRequest(r,{retainedBytes:512*1024*1024});expect(encoded.ok&&encoded.value.length).toBe(96);
  const raw=reply(r),decoded=decodeSourceIteratedRenderNativeResponse(raw,r);expect(decoded.disposition).toBe('absent');expect(decoded.diagnosticUnit).toBeUndefined();expect(decoded.executionProfile).toBeUndefined();raw[92]=1;expect(()=>decodeSourceIteratedRenderNativeResponse(raw,r)).toThrow();
 });

 it('preserves v6 advance bytes unless independent counter reset is explicitly supplied',()=>{
  const base={generation:2,sequence:4,operation:{kind:'advance' as const,resource,expectedIndex:7,expectedCount:8,reset:false,dimension:2 as const,steps:5,uniforms:[]}};
  const old=encodeSourceIteratedNativeRequest(base),next=encodeSourceIteratedNativeRequest({...base,operation:{...base.operation,resetCounter:true}});expect(old.ok&&next.ok).toBe(true);if(!old.ok||!next.ok)return;
  const a=new DataView(old.value.buffer),b=new DataView(next.value.buffer);expect(a.getUint32(4,true)).toBe(6);expect(a.getUint32(100,true)).toBe(5);
  expect([b.getUint32(4,true),b.getUint32(92,true),b.getUint32(96,true),b.getUint32(100,true),b.getUint32(104,true)]).toEqual([7,0,1,2,5]);expect(next.value.length).toBe(old.value.length+4);
  expect(encodeSourceIteratedNativeRequest({...base,operation:{...base.operation,reset:true,resetCounter:false}})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('encodes shader, checkpoint and render inputs under the distinct ink identity',()=>{
  const request:SourceIteratedRenderNativeRequest={...present(),operation:{...common,kind:'create',expectedDisplays:0,programs}},result=encodeSourceIteratedRenderNativeRequest(request);expect(result.ok).toBe(true);if(!result.ok)return;
  const v=new DataView(result.value.buffer);expect([v.getUint32(4,true),v.getUint32(60,true),v.getUint32(64,true),v.getUint32(108,true),v.getUint32(112,true),v.getUint32(116,true)]).toEqual([7,3,1,7,0,8]);
  expect(decodeSourceIteratedRenderNativeResponse(reply(request),request)).toMatchObject({resource,stateResource,index:7,displays:0,width:3,height:2,count:8,disposition:'owned'});
  expect(encodeSourceIteratedRenderNativeRequest(draw()).ok).toBe(true);
 });
 it('binds program replacement to retained ink without incrementing display or publishing statistics',()=>{
  const r:SourceIteratedRenderNativeRequest={...present(),operation:{...common,kind:'replace-programs',programs}};
  const encoded=encodeSourceIteratedRenderNativeRequest(r);expect(encoded.ok).toBe(true);if(!encoded.ok)return;
  expect(new DataView(encoded.value.buffer).getUint32(64,true)).toBe(5);
  expect(decodeSourceIteratedRenderNativeResponse(reply(r),r)).toMatchObject({index:7,displays:3,count:8});
  const dirty=reply(r);dirty[64]=1;expect(()=>decodeSourceIteratedRenderNativeResponse(dirty,r)).toThrow();
  expect(encodeSourceIteratedRenderNativeRequest(r,{retainedBytes:256*1024*1024-100}).ok).toBe(false);
 });
 it.each(['uniform-duplicate','uniform-hole','uniform-overflow','sampler','palette','clear','capacity'] as const)('rejects %s without an output packet',kind=>{
  const r=draw();if(r.operation.kind!=='draw')throw Error();const p=r.operation.plan;
  if(kind==='uniform-duplicate')p.drawUniforms=[{name:'a',kind:'float',values:[1]},{name:'a',kind:'float',values:[1]}];
  if(kind==='uniform-hole')p.drawUniforms=new Array(1);
  if(kind==='uniform-overflow')p.drawUniforms=[{name:'a',kind:'vec2',values:[1,1e39]}];
  if(kind==='sampler')p.drawUniforms=[{name:'a',kind:'usampler2d',texture:4}];
  if(kind==='palette')p.palette.values[17]=NaN;
  if(kind==='clear')r.operation.clear=1 as unknown as boolean;
  const result=encodeSourceIteratedRenderNativeRequest(r,kind==='capacity'?{retainedBytes:256*1024*1024}:{});expect(result).toMatchObject({ok:false,error:{kind:kind==='capacity'?'capacity':'input'}});
 });
 it.each([0,4,8,24,40,44,48,52,56,60,64,72,80,92] as const)('rejects a present reply with corruption at byte %i',at=>{
  const r=present(),b=reply(r);b[at]^=1;expect(()=>decodeSourceIteratedRenderNativeResponse(b,r)).toThrow();
 });
 it('validates draw coverage and uint64 exactness before exposing any facts',()=>{
  const r=draw(),b=reply(r);expect(decodeSourceIteratedRenderNativeResponse(b,r)).toMatchObject({index:7,displays:4,invalid:17,accepted:5,clipped:2,sampleInvalid:1});
  new DataView(b.buffer).setUint32(68,0x200000,true);expect(()=>decodeSourceIteratedRenderNativeResponse(b,r)).toThrow('统计');
  const outside=reply(r);new DataView(outside.buffer).setUint32(72,9,true);expect(()=>decodeSourceIteratedRenderNativeResponse(outside,r)).toThrow('统计');
 });
 it('keeps a frozen response binding independent of caller mutation and rejects forged bindings',()=>{
  const r=present(),b=reply(r),binding=captureSourceIteratedRenderNativeResponseBinding(r);r.width=999;r.operation.resource='ab'.repeat(16);if(r.operation.kind!=='release')r.operation.expectedIndex=123;
  expect(decodeSourceIteratedRenderNativeResponse(b,binding)).toMatchObject({resource,index:7,width:3});expect(Object.isFrozen(binding)).toBe(true);
  expect(()=>decodeSourceIteratedRenderNativeResponse(b,{...binding})).toThrow('codec');
 });
 it('admits idempotent release even over retained capacity but rejects absent-owner state',()=>{
  const r:SourceIteratedRenderNativeRequest={generation:2,sequence:4,width:1,height:1,operation:{kind:'release',resource}};
  expect(encodeSourceIteratedRenderNativeRequest(r,{retainedBytes:512*1024*1024}).ok).toBe(true);expect(decodeSourceIteratedRenderNativeResponse(reply(r),r)).toMatchObject({disposition:'absent'});
  const b=reply(r);b[24]=1;expect(()=>decodeSourceIteratedRenderNativeResponse(b,r)).toThrow();
 });
});
describe('shared browser transport for retained ink',()=>{
 it('preserves v10 profile identity across the public asynchronous HTTP client',async()=>{
  const r=present();r.operation.profile='source-fragment';const ready=response(r);let resolve!:(v:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(a=>{resolve=a;})));const pending=exchangeSourceIteratedRenderNative(r);
  r.operation.profile=undefined;resolve(ready);expect(await pending).toMatchObject({diagnosticUnit:'completed-pass',executionProfile:'source-fragment',index:7});
 });

 it('publishes top-down pixels once, with exact renderer and checkpoint metadata',async()=>{
  const r=present();vi.stubGlobal('fetch',vi.fn(async()=>response(r)));const result=await exchangeSourceIteratedRenderNative(r);
  expect(Array.from(result.pixels!).filter((_,i)=>i%4===0)).toEqual([4,5,6,1,2,3]);expect(result).toMatchObject({index:7,displays:3,contextSerial:1,sessionSerial:2,rendererIdentity:'a'.repeat(64),occupiedPixels:5,maxCount:4.5});
 });
 it('shares the compute request slot and captures immutable response identity before awaiting fetch',async()=>{
  const r=present(),ready=response(r);let resolve!:(v:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(a=>{resolve=a;})));const pending=exchangeSourceIteratedRenderNative(r);
  await expect(exchangeSourceIteratedNative({generation:1,sequence:1,operation:{kind:'release',resource:stateResource}})).rejects.toMatchObject({kind:'capacity'});
  r.width=999;r.operation.resource='ab'.repeat(16);if(r.operation.kind!=='release')r.operation.expectedIndex=123;resolve(ready);expect(await pending).toMatchObject({resource,index:7,width:3});
 });
 it.each(['null','[]','7','"failure"'])('classifies malformed remote error %s and releases the shared request slot',async body=>{
  const r=present();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(body,{status:500})).mockResolvedValueOnce(response(r)));
  await expect(exchangeSourceIteratedRenderNative(r)).rejects.toMatchObject({kind:'protocol'});expect(await exchangeSourceIteratedRenderNative(r)).toMatchObject({resource,index:7});
 });
 it('does not publish pixels from a reply with the wrong parent resource',async()=>{
  const r=present(),b=reply(r);b[24]^=1;vi.stubGlobal('fetch',vi.fn(async()=>response(r,b)));await expect(exchangeSourceIteratedRenderNative(r)).rejects.toMatchObject({kind:'protocol'});
 });
});
