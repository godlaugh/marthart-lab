import {afterEach,describe,expect,it,vi} from 'vitest';
import {exchangeSourceFractalNative} from '../src/engine/sourceNativeClient';
import type {SourceFractalNativeRequest} from '../src/engine/sourceFractalNativeProtocol';
const resource='a1'.repeat(16);
function request():SourceFractalNativeRequest{return{generation:3,sequence:7,width:2,height:1,operation:{kind:'sample',resource,expectedIndex:4,points:new Uint32Array([1,0,0,0,1,0]),reference:new Float32Array(4),palette:new Float32Array(3),uniforms:[{name:'u_refOrbitTex',kind:'sampler2d',texture:2},{name:'u_gradientTex',kind:'sampler2d',texture:1},...(['u_iterations','u_refOrbitLen','u_gradientSize'] as const).map((name,i)=>({name,kind:'int' as const,count:1,values:new Int32Array([i===0?300:0])}))]}};}
function response(change?:(bytes:Uint8Array,headers:Record<string,string>)=>void){
 const raw=new Uint8Array(64+3*52),v=new DataView(raw.buffer);[4,2].forEach((x,i)=>v.setUint32(i*4,x,true));raw.set(new Uint8Array(16).fill(0xa1),8);v.setUint32(24,5,true);v.setUint32(32,3,true);v.setUint32(36,2,true);v.setUint32(40,1,true);[2,1,1,1].forEach((x,i)=>v.setUint32(44+i*4,x,true));
 for(let i=0;i<3;i++){v.setUint32(64+i*52,0x7fc0f00d+i,true);raw.fill(i+1,64+i*52+32,64+i*52+36);}
 const headers={'content-type':'application/octet-stream','content-length':String(raw.length),'x-source-generation':'3','x-source-sequence':'7','x-source-width':'2','x-source-height':'1','x-source-format':'fractal-v1','x-source-row-order':'none','x-source-renderer':'ab'.repeat(32),'x-source-context':'2','x-source-session':'1'};change?.(raw,headers);return new Response(raw,{headers});
}
afterEach(()=>vi.unstubAllGlobals());
describe('Fractal browser native transport',()=>{
 it('preserves arbitrary sample order and every raw nonfinite payload bit',async()=>{
  const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);const result=await exchangeSourceFractalNative(request());
  expect(result).toMatchObject({committedRequests:5,draws:2,targetAllocations:1,referenceUploads:1,paletteUploads:1});expect(result.records).toHaveLength(156);const bits=new DataView(result.records!.buffer,result.records!.byteOffset);
  for(let i=0;i<3;i++){expect(bits.getUint32(i*52,true)).toBe(0x7fc0f00d+i);expect([...result.records!.subarray(i*52+32,i*52+36)]).toEqual([i+1,i+1,i+1,i+1]);}
  const [,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(new DataView((options.body as Uint8Array).buffer).getUint32(4,true)).toBe(11);
 });
 it('decodes against immutable request identity captured before awaiting fetch',async()=>{
  let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));const input=request(),pending=exchangeSourceFractalNative(input);
  input.width=1;input.operation.resource='b2'.repeat(16);if(input.operation.kind==='sample'){input.operation.expectedIndex=19;input.operation.points=new Uint32Array([0,0]);}resolve(response());
  const result=await pending;expect(result.resource).toBe(resource);expect(result.width).toBe(2);expect(result.count).toBe(3);
 });
 it.each(['format','row-order','context','length','resource','checkpoint'])('rejects a mismatched %s and frees the shared request slot',async kind=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response((bytes,headers)=>{
   if(kind==='format')headers['x-source-format']='rgba8';else if(kind==='row-order')headers['x-source-row-order']='bottom-up';else if(kind==='context')headers['x-source-context']='0';else if(kind==='length')headers['content-length']='64';else if(kind==='resource')bytes[8]^=1;else new DataView(bytes.buffer).setUint32(24,4,true);
  })));
  await expect(exchangeSourceFractalNative(request())).rejects.toMatchObject({kind:'protocol'});
  vi.stubGlobal('fetch',vi.fn(async()=>response()));await expect(exchangeSourceFractalNative(request())).resolves.toMatchObject({committedRequests:5});
 });
 it('keeps one shared browser slot until the actual response settles',async()=>{
  let resolve!:(r:Response)=>void;const fetch=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetch);const pending=exchangeSourceFractalNative(request());
  await expect(exchangeSourceFractalNative(request())).rejects.toMatchObject({kind:'capacity'});expect(fetch).toHaveBeenCalledTimes(1);resolve(response());await pending;
 });
});
