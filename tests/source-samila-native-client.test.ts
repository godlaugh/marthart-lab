import {afterEach,describe,expect,it,vi} from 'vitest';
import {exchangeSourceSamilaNative,renderSourceNativeFrame} from '../src/engine/sourceNativeClient';
import {SourceSamilaSession} from '../src/engine/sourceSamilaSession';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {prepareSourceSamilaNativeCreate,prepareSourceSamilaNativeDisplay} from '../src/engine/sourceSamilaNativeProgram';
import type {SourceSamilaNativeRequest} from '../src/engine/sourceSamilaNativeProtocol';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';

const resource='12'.repeat(16);
function requests(width=2,height=3){
 const scene=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'SAMILA',name:'Native transport input',settings:{batch_size:13},equations:{f1:'sin(x*y)',f2:'cos(x-y)'},timeline:[{type:'wait',duration:1}]})).scene;
 const owner=new SourceSamilaSession({samilaSeedProvider:()=>0x80000001}),token=owner.begin(scene,{width,height,time:0,quality:'preview',samilaPrimaryPixelHeight:972,samilaLive:{sessionId:'transport',pixelDensity:1}}),prepared=owner.prepareDisplay(token);
 const envelope={generation:2,sequence:4};
 const create:SourceSamilaNativeRequest={...envelope,width:1,height:1,operation:prepareSourceSamilaNativeCreate(prepared.job,resource)};
 const display:SourceSamilaNativeRequest={...envelope,width,height,operation:prepareSourceSamilaNativeDisplay(prepared.job,prepared.tone,prepared.view,{width,height,clearInk:true,resource,expectedIndex:0,paletteChanged:false})};
 owner.reset();return{create,display};
}
// Hand-authored wire responses follow the retained 64-byte contract. Production
// parsing/encoding and shader/LUT preparation remain under test; only fetch is fake.
function response(request:SourceSamilaNativeRequest,change?:(body:Uint8Array,headers:Record<string,string>)=>void){
 const op=request.operation,display=op.kind==='display'||op.kind==='present',accumulate=op.kind==='display'||op.kind==='step',body=new Uint8Array(64+(display?request.width*request.height*4:0)),v=new DataView(body.buffer),word=(at:number,value:number)=>v.setUint32(at,value,true);
 word(0,1);word(4,{create:1,display:2,release:3,present:4,step:5}[op.kind]);body.set(Uint8Array.from(op.resource.match(/../g)!,part=>parseInt(part,16)),8);word(24,accumulate?op.expectedIndex+1:op.kind==='present'?op.expectedIndex:0);word(28,op.kind==='release'?2:0);
 if(accumulate){word(32,op.baseBatch*op.passes);word(36,op.baseBatch*op.passes);}
 if(display){word(48,1);v.setFloat32(52,.5,true);for(let i=64;i<body.length;i++)body[i]=(i-64)*7;}
 const headers:Record<string,string>={'content-type':'application/octet-stream','content-length':String(body.length),'x-source-generation':String(request.generation),'x-source-sequence':String(request.sequence),'x-source-width':String(request.width),'x-source-height':String(request.height),'x-source-renderer':'a'.repeat(64),'x-source-format':'samila-v1','x-source-row-order':display?'bottom-up':'none','x-source-context':'9','x-source-session':'4'};
 change?.(body,headers);return new Response(body,{headers});
}
const legacy=():SourceDrawingFrame=>({generation:3,sequence:1,width:1,height:1,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});
afterEach(()=>vi.unstubAllGlobals());

describe('Samila v5 production transport contract (CPU only)',()=>{
 it('uses acknowledged target identity for the real desktop size while retaining unknown and resize budgets',async()=>{
  const {display}=requests(1724,1160),retainedBytes=1724*1160*52,retainedTarget={resource,width:1724,height:1160},fetch=vi.fn(async()=>response(display));vi.stubGlobal('fetch',fetch);
  await expect(exchangeSourceSamilaNative(display,{retainedBytes})).rejects.toMatchObject({kind:'capacity'});expect(fetch).not.toHaveBeenCalled();
  const result=await exchangeSourceSamilaNative(display,{retainedBytes,retainedTarget});expect(result.pixels).toHaveLength(1724*1160*4);expect(fetch).toHaveBeenCalledOnce();
  await expect(exchangeSourceSamilaNative(display,{retainedBytes,retainedTarget:{...retainedTarget,resource:'34'.repeat(16)}})).rejects.toMatchObject({kind:'input'});
  await expect(exchangeSourceSamilaNative(display,{retainedBytes,retainedTarget:{resource,width:1160,height:1724}})).rejects.toMatchObject({kind:'capacity'});
  await expect(exchangeSourceSamilaNative(display,{retainedBytes:0,retainedTarget})).rejects.toMatchObject({kind:'input'});expect(fetch).toHaveBeenCalledOnce();
 });
 it('carries the production request and flips only pixel rows, preserving channel and alpha bytes',async()=>{
  const {display}=requests(),fetch=vi.fn(async()=>response(display));vi.stubGlobal('fetch',fetch);
  const output=await exchangeSourceSamilaNative(display),expected=Array.from({length:24},(_,i)=>i*7);
  expect([...output.pixels!]).toEqual([...expected.slice(16,24),...expected.slice(8,16),...expected.slice(0,8)]);
  expect(output).toMatchObject({resource,committedDisplays:1,steps:13,accepted:13,contextSerial:9,sessionSerial:4,generation:2,sequence:4});
  const input=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(input[0]).toBe('/api/source-renderer/frames');expect(input[1]).toMatchObject({method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store'});
  const packet=input[1].body as Uint8Array;expect(new DataView(packet.buffer,packet.byteOffset).getUint32(4,true)).toBe(5);expect(packet.byteLength).toBe(output.requestBytes);
 });
 it('keeps step acknowledgements pixel-free and read-only presentation at the same checkpoint',async()=>{
  const {display}=requests();if(display.operation.kind!=='display')throw Error('fixture');
  const step:SourceSamilaNativeRequest={...display,operation:{...display.operation,kind:'step'}};
  vi.stubGlobal('fetch',vi.fn(async()=>response(step)));expect(await exchangeSourceSamilaNative(step)).toMatchObject({committedDisplays:1,steps:13,accepted:13,occupiedPixels:0,maxCount:0});expect(await exchangeSourceSamilaNative(step)).not.toHaveProperty('pixels');
  const present:SourceSamilaNativeRequest={...display,operation:{kind:'present',resource,expectedIndex:1,present:display.operation.present}};
  vi.stubGlobal('fetch',vi.fn(async()=>response(present)));const shown=await exchangeSourceSamilaNative(present);expect(shown).toMatchObject({committedDisplays:1,steps:0,occupiedPixels:1});expect(shown.pixels).toHaveLength(24);
  for(const [request,offset,value]of [[step,48,1],[step,24,0],[present,32,1],[present,24,2]] as const){vi.stubGlobal('fetch',vi.fn(async()=>response(request,body=>new DataView(body.buffer).setUint32(offset,value,true))));await expect(exchangeSourceSamilaNative(request)).rejects.toMatchObject({kind:'protocol'});}
 });
 it.each(['resource','checkpoint','generation','sequence','context','session','family','kind','disposition','reserved','counts','ink','nan','row-order'] as const)('rejects a forged or malformed %s response',async kind=>{
  const {display}=requests();vi.stubGlobal('fetch',vi.fn(async()=>response(display,(body,headers)=>{
   const v=new DataView(body.buffer);if(kind==='resource')body[8]^=1;if(kind==='checkpoint')v.setUint32(24,2,true);if(kind==='generation')headers['x-source-generation']='3';if(kind==='sequence')headers['x-source-sequence']='5';if(kind==='context')headers['x-source-context']='0';if(kind==='session')headers['x-source-session']='0';if(kind==='family')v.setUint32(0,2,true);if(kind==='kind')v.setUint32(4,1,true);if(kind==='disposition')v.setUint32(28,1,true);if(kind==='reserved')v.setUint32(60,1,true);if(kind==='counts')v.setUint32(36,12,true);if(kind==='ink')v.setUint32(56,1,true);if(kind==='nan')v.setFloat32(52,NaN,true);if(kind==='row-order')headers['x-source-row-order']='top-down';
  })));
  await expect(exchangeSourceSamilaNative(display)).rejects.toMatchObject({kind:'protocol'});
 });
 it('keeps control responses separate from pixels and binds releases to the exact resource',async()=>{
  const {create}=requests();vi.stubGlobal('fetch',vi.fn(async()=>response(create)));const created=await exchangeSourceSamilaNative(create);expect(created).toMatchObject({resource,disposition:'owned',committedDisplays:0});expect(created).not.toHaveProperty('pixels');
  const release:SourceSamilaNativeRequest={...create,sequence:5,operation:{kind:'release',resource}};vi.stubGlobal('fetch',vi.fn(async()=>response(release)));expect(await exchangeSourceSamilaNative(release)).toMatchObject({resource,disposition:'absent',committedDisplays:0});
  vi.stubGlobal('fetch',vi.fn(async()=>response(release,body=>{body[8]^=1;})));await expect(exchangeSourceSamilaNative(release)).rejects.toMatchObject({kind:'protocol'});
  vi.stubGlobal('fetch',vi.fn(async()=>response(create,body=>{body[32]=1;})));await expect(exchangeSourceSamilaNative(create)).rejects.toMatchObject({kind:'protocol'});
 });
 it.each(['seed','batch','viewport','bool','nan'] as const)('rejects mismatched production %s inputs before transport',async kind=>{
  const {display}=requests();if(display.operation.kind!=='display')throw Error('fixture');const op=display.operation;
  if(kind==='seed')op.seed^=1;if(kind==='batch')op.passes=6;if(kind==='viewport')display.width=3;
  if(kind==='bool'){const u=op.sample.find(u=>u.name==='u_quadSplat')!;if(u.kind!=='bool')throw Error('fixture');u.values[0]=2;}
  if(kind==='nan'){const u=op.sample.find(u=>u.name==='radius')!;if(u.kind!=='float')throw Error('fixture');u.values[0]=NaN;}
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(exchangeSourceSamilaNative(display)).rejects.toMatchObject({kind:'input'});expect(fetch).not.toHaveBeenCalled();
 });
 it('shares one request slot with legacy native families, then releases the slot after cancellation',async()=>{
  const {display}=requests(),controller=new AbortController(),fetch=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true})));vi.stubGlobal('fetch',fetch);
  const pending=exchangeSourceSamilaNative(display,{signal:controller.signal});await expect(renderSourceNativeFrame(legacy())).rejects.toMatchObject({kind:'capacity'});expect(fetch).toHaveBeenCalledOnce();controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  const frame=legacy();vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3,4]),{headers:{'content-type':'application/octet-stream','content-length':'4','x-source-generation':String(frame.generation),'x-source-sequence':String(frame.sequence),'x-source-width':'1','x-source-height':'1','x-source-renderer':'a'.repeat(64),'x-source-format':'rgba8','x-source-row-order':'bottom-up'}})));
  expect([...(await renderSourceNativeFrame(frame)).pixels]).toEqual([1,2,3,4]);
 });
});
