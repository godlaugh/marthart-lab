import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({exchange:vi.fn(),release:vi.fn(),lease:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),exchangeSourceAttractorNative:mock.exchange,releaseSourceAttractorNative:mock.release}));
vi.mock('../src/engine/sourceNativeLease',async actual=>({...await actual<typeof import('../src/engine/sourceNativeLease')>(),ensureSourceNativeLease:mock.lease}));
import {SourceAttractorNativeBackend} from '../src/engine/sourceAttractorNativeBackend';
import {SourceNativeError} from '../src/engine/sourceNativeError';
import {prepareSourceAttractorScene} from '../src/engine/sourceAttractorDocument';
import {parseProjectFile} from '../src/engine/legacyImport';
import {encodeSourceAttractorNativeRequest,sourceAttractorNativeResidentBytes,sourceAttractorNativeProgramBytes,type SourceAttractorNativeRequest,type SourceAttractorNativeTarget} from '../src/engine/sourceAttractorNativeProtocol';
import {prepareSourceAttractorGpuInitialData,prepareSourceAttractorGpuOptions,prepareSourceAttractorGpuDisplay} from '../src/engine/sourceAttractorGpuPrepared';
import * as preparedProducer from '../src/engine/sourceAttractorGpuPrepared';
import {SourceAttractorGpu} from '../src/engine/sourceAttractorGpu';
import {sourceAttractorGpuPrograms} from '../src/engine/sourceAttractorGpuShaders';
import {SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
import {Generator} from '../src/engine/client';
import type {SourceNativeAttractorResponse} from '../src/engine/sourceNativeClient';
import {ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';
import type {GenerationInput} from '../src/types';
// Real producer, codec, backend, replay and public client. Only transport/lease
// are simulated: no native execution or pixel-parity claim belongs to this file.
type Options={retainedBytes?:number;retainedTarget?:SourceAttractorNativeTarget;signal?:AbortSignal};
const records:{request:SourceAttractorNativeRequest;options:Options}[]=[],remote=new Map<string,{index:number;renderIndex:number;uploaded:number;count:number;size:number}>(),owners:SourceAttractorNativeBackend[]=[],clients:Generator[]=[];
const context:GenerationInput={time:0,width:8,height:6,quality:'preview',sourceViewport:{logicalWidth:8,logicalHeight:6,referenceLogicalHeight:6,target:'primary',projectionPass:'perspective'},sourcePointPixelDensity:1};
function fixture(count=65){const scene=parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'Native owner',equations:{dx:'1',dy:'0',dz:'0'},settings:{render_mode:'GPU',particle_count_gpu:count,sub_steps:3,time_step:1},initialization:{warmup_steps:101,warmup_stagger_min:2,warmup_stagger_max:7},timeline:[{type:'wait',duration:1}]})).scene;scene.timeline.fps=4;const prepared=prepareSourceAttractorScene(scene);if(prepared.backend!=='gpu')throw Error('gpu');return{scene,prepared,display:{width:8,height:6,backgroundColor:prepared.backgroundColor,cameraPlan:prepareOrdinarySourceFrame(ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context))}};}
function backend(count=65,memory?:{retainedBytes?:()=>number}){const {prepared}=fixture(count),owner=new SourceAttractorNativeBackend(prepared,memory);owners.push(owner);return owner;}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function exchange(request:SourceAttractorNativeRequest,options:Options={}):Promise<SourceNativeAttractorResponse>{
 const encoded=encodeSourceAttractorNativeRequest(request,options);if(!encoded.ok)throw Error(encoded.error.reason);records.push({request:structuredClone(request),options:{...options}});const op=request.operation;
 if(op.kind==='create')remote.set(op.resource,{index:0,renderIndex:0,uploaded:0,count:op.count,size:op.texSize});
 const s=remote.get(op.resource);if(op.kind!=='release'&&!s)throw Error('missing remote owner');
 if(op.kind==='upload')s!.uploaded+=op.positions.length/4;if(op.kind==='pass')s!.index++;if(op.kind==='render')s!.renderIndex++;
 const reply:SourceNativeAttractorResponse={resource:op.resource,disposition:op.kind==='release'?(s?'released':'absent'):'owned',passIndex:s?.index??0,renderIndex:s?.renderIndex??0,uploaded:s?.uploaded??0,count:s?.count??0,texSize:s?.size??0,width:request.width,height:request.height,accumWidth:op.kind==='render'?op.display.layout.accumWidth:0,accumHeight:op.kind==='render'?op.display.layout.accumHeight:0,renderedPassIndex:op.kind==='render'?s!.index:0,offset:0,readCount:0,generation:request.generation,sequence:request.sequence,rendererIdentity:'b'.repeat(64),contextSerial:1,sessionSerial:2,requestBytes:encoded.value.byteLength,...(op.kind==='render'?{pixels:new Uint8ClampedArray(request.width*request.height*4).fill(41)}:{})};
 if(op.kind==='release')remote.delete(op.resource);return reply;
}
const kinds=()=>records.map(r=>r.request.operation.kind);
beforeEach(()=>{records.length=0;remote.clear();mock.exchange.mockReset().mockImplementation(exchange);mock.release.mockReset().mockImplementation(exchange);mock.lease.mockReset().mockResolvedValue(undefined);vi.stubEnv('VITE_SOURCE_RENDERER','native');vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('WebGL fallback forbidden');}});});
afterEach(async()=>{mock.exchange.mockImplementation(exchange);mock.release.mockImplementation(exchange);for(const client of clients.splice(0)){client.dispose();await client.settledNativeCleanup();}for(const owner of owners.splice(0))await owner.dispose();expect(remote.size).toBe(0);vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('retained native GPU Attractor production ownership',()=>{
 it('uploads the full canonical square in bounded chunks and consumes exact shared warmup passes',async()=>{
  const owner=backend(105000);await owner.initialize();const uploads=records.filter(r=>r.request.operation.kind==='upload').map(r=>r.request.operation).filter(op=>op.kind==='upload'),expected=prepareSourceAttractorGpuInitialData(prepareSourceAttractorGpuOptions(fixture(105000).prepared));
  expect(uploads.length).toBeGreaterThan(1);const positions=new Float32Array(expected.data.length),uv=new Float32Array(expected.uv.length),colors=new Float32Array(expected.rgba.length);
  for(const chunk of uploads){expect(chunk.positions.byteLength+chunk.texIndex.byteLength+chunk.colors.byteLength).toBeLessThanOrEqual(4*1024*1024);positions.set(chunk.positions,chunk.offset*4);uv.set(chunk.texIndex,Math.min(chunk.offset,105000)*2);colors.set(chunk.colors,Math.min(chunk.offset,105000)*4);}
  expect(new Uint8Array(positions.buffer)).toEqual(new Uint8Array(expected.data.buffer));expect(uv).toEqual(expected.uv);expect(colors).toEqual(expected.rgba);expect(owner.diagnostics()).toMatchObject({initialized:true,warmupPasses:2,updatePasses:0});
  const passes=records.filter(r=>r.request.operation.kind==='pass').map(r=>r.request.operation).filter(op=>op.kind==='pass');expect(passes.map(op=>[op.pass.steps,op.pass.currentStepBase])).toEqual([[100,0],[8,100]]);await owner.advance();expect(owner.diagnostics().updatePasses).toBe(1);
 });
 it('accounts for other owners and retained caller pixels without double charging provisional create or unchanged target',async()=>{
  const a=backend(65,{retainedBytes:()=>192});await a.initialize();const first=records[0];expect(first.options.retainedBytes).toBe(192);
  const b=backend();await b.initialize();const creates=records.filter(r=>r.request.operation.kind==='create');expect(creates[1].options.retainedBytes).toBe(a.ownedBytes());
  const d=fixture().display;await a.render(d);const before=a.ownedBytes();await a.render(d);const renders=records.filter(r=>r.request.operation.kind==='render');expect(renders[0].options.retainedTarget).toBeUndefined();expect(renders[1].options.retainedTarget).toMatchObject({width:8,height:6});expect(renders[1].options.retainedBytes).toBe(before+b.ownedBytes()+192);
  await expect(backend().initialize()).rejects.toThrow('两个');
 });
 it('keeps prepared display facts free of the WebGL representation and codec-admits native 2M at 1024-square',()=>{
  const f=fixture(),options={...f.prepared,configuration:{...f.prepared.configuration,particleCountGPU:2_000_000,warmup:{steps:0,staggerMin:0,staggerMax:0}}},prepared=prepareSourceAttractorGpuOptions(options),display={...f.display,width:1024,height:1024};
  const plan=prepareSourceAttractorGpuDisplay(prepared,display);expect(prepared.layout.bytes+plan.layout.bytes).toBe(270283840);
  const webgl=new SourceAttractorGpu(options);try{expect(()=>webgl.render(display)).toThrow('预算');expect(webgl.diagnostics().contextOwned).toBe(false);}finally{webgl.dispose();}
  const programs=sourceAttractorGpuPrograms(prepared.shader,'native-gl41'),retainedBytes=sourceAttractorNativeResidentBytes(prepared.layout.count,prepared.layout.size,sourceAttractorNativeProgramBytes(programs));
  const packet=encodeSourceAttractorNativeRequest({generation:1,sequence:1,width:1024,height:1024,operation:{kind:'render',resource:'ac'.repeat(16),expectedIndex:0,expectedRenderIndex:0,expectedUploaded:prepared.layout.texels,expectedCount:prepared.layout.count,expectedTexSize:prepared.layout.size,display:plan}},{retainedBytes});expect(packet.ok).toBe(true);
 });
 it('rejects insufficient upload headroom before requesting any canonical array allocation',async()=>{
  let held=0;const owner=backend(65,{retainedBytes:()=>held}),original=preparedProducer.createSourceAttractorGpuInitialSource,next=vi.fn();
  vi.spyOn(preparedProducer,'createSourceAttractorGpuInitialSource').mockImplementation((...args)=>{const source=original(...args);return{...source,get cursor(){return source.cursor;},next:(n:number)=>{next(n);return source.next(n);}};});
  mock.exchange.mockImplementation(async(r,o)=>{const result=await exchange(r,o);if(r.operation.kind==='create')held=SOURCE_FRAME_BUDGET-owner.ownedBytes()-1000;return result;});
  await expect(owner.initialize()).rejects.toMatchObject({kind:'capacity'});expect(next).not.toHaveBeenCalled();expect(kinds()).toEqual(['create']);expect(owner.diagnostics().cleanupPending).toBe(true);held=0;await owner.dispose();
 });
 it('shrinks upload chunks to actual headroom and preserves the entire canonical stream including padding',async()=>{
  let held=0;const owner=backend(65,{retainedBytes:()=>held});mock.exchange.mockImplementation(async(r,o)=>{const result=await exchange(r,o);if(r.operation.kind==='create')held=SOURCE_FRAME_BUDGET-owner.ownedBytes()-(124*6+96*4+80*6);return result;});
  await owner.initialize();const uploads=records.map(r=>r.request.operation).filter(op=>op.kind==='upload'),expected=prepareSourceAttractorGpuInitialData(prepareSourceAttractorGpuOptions(fixture().prepared)),positions=new Float32Array(expected.data.length),uv=new Float32Array(expected.uv.length),colors=new Float32Array(expected.rgba.length);
  expect(uploads.length).toBeGreaterThan(32);for(const op of uploads){expect(op.positions.byteLength+op.texIndex.byteLength+op.colors.byteLength).toBeLessThanOrEqual(80);positions.set(op.positions,op.offset*4);if(op.texIndex.length)uv.set(op.texIndex,op.offset*2);if(op.colors.length)colors.set(op.colors,op.offset*4);}
  expect(positions).toEqual(expected.data);expect(uv).toEqual(expected.uv);expect(colors).toEqual(expected.rgba);held=0;await owner.dispose();
 });
 it('retains uncertain creation and failed cleanup custody until exact release succeeds',async()=>{
  const owner=backend();mock.exchange.mockImplementationOnce(async(r,o)=>{await exchange(r,o);throw Error('create ACK lost');});await expect(owner.initialize()).rejects.toThrow('ACK lost');const token=records[0].request.operation.resource;expect(remote.has(token)).toBe(true);
  mock.release.mockRejectedValueOnce(Error('release ACK lost'));await expect(owner.dispose()).rejects.toThrow('release ACK lost');expect(owner.diagnostics().cleanupPending).toBe(true);await expect(owner.advance()).rejects.toThrow('已失效');
  await owner.dispose();expect(records.at(-1)!.request.operation).toEqual({kind:'release',resource:token});expect(remote.has(token)).toBe(false);
 });
 it('does not release a foreign resource after an explicit ownership rejection',async()=>{
  const foreign=backend();await foreign.initialize();const token=records[0].request.operation.resource;
  vi.spyOn(crypto,'randomUUID').mockReturnValue(`${token.slice(0,8)}-${token.slice(8,12)}-${token.slice(12,16)}-${token.slice(16,20)}-${token.slice(20)}` as ReturnType<Crypto['randomUUID']>);
  mock.exchange.mockImplementation(async(r,o)=>{if(r.operation.kind==='create'&&remote.has(r.operation.resource))throw new SourceNativeError('ownership','token belongs to another owner');return exchange(r,o);});
  const rejected=backend();await expect(rejected.initialize()).rejects.toMatchObject({kind:'ownership'});expect(rejected.diagnostics()).toMatchObject({contextOwned:false,cleanupPending:false,failed:true});await rejected.dispose();expect(mock.release).not.toHaveBeenCalled();expect(remote.has(token)).toBe(true);
  await foreign.advance();expect(foreign.diagnostics().updatePasses).toBe(1);
 });
 it('awaits a pending ACK before disposal and never aborts the shared transport',async()=>{
  const owner=backend(),entered=deferred<void>(),ack=deferred<void>();await owner.initialize();mock.exchange.mockImplementation(async(r,o)=>{const result=await exchange(r,o);if(r.operation.kind==='render'){entered.resolve();await ack.promise;}return result;});
  const render=owner.render(fixture().display);await entered.promise;const close=owner.dispose();expect(kinds()).not.toContain('release');expect(records.every(r=>r.options.signal===undefined)).toBe(true);ack.resolve();await render;await close;expect(kinds().at(-1)).toBe('release');
 });
 it('rejects context replacement and retains its token for an absent cleanup ACK',async()=>{
  const owner=backend();await owner.initialize();mock.exchange.mockImplementationOnce(async(r,o)=>({...await exchange(r,o),contextSerial:3}));await expect(owner.advance()).rejects.toThrow('context');expect(owner.diagnostics().cleanupPending).toBe(true);const token=records[0].request.operation.resource;remote.delete(token);await owner.dispose();expect(owner.diagnostics().contextOwned).toBe(false);
 });
 it('uses the public page route with source formulas and explicit density, reuses same-time owner and releases before reverse reconstruction',async()=>{
  const client=new Generator();clients.push(client);vi.stubGlobal('Worker',class{constructor(){throw Error('unexpected Worker');}});const {scene}=fixture();scene.formulas!.main.visible=true;scene.formulas!.main.latex='x';
  const first=await client.generate(scene,context);expect(first).toMatchObject({type:'raster',backend:'native',sourceAttractorPixelDensity:1,sourcePixelRenderer:{backend:'native',identity:'b'.repeat(64)}});expect(first.formulaPresentation!.labels[0].latex).toBe('x');
  const before=records.length;await client.generate(scene,context);expect(kinds().slice(before)).toEqual(['render']);expect(records.at(-1)!.options.retainedBytes).toBeGreaterThan(first.type==='raster'?first.pixels.byteLength:0);
  await client.generate(scene,{...context,time:.5});const previous=records.length;await client.generate(scene,context);expect(kinds().slice(previous,previous+2)).toEqual(['release','create']);
 });
 it('public cancellation waits for ACK cleanup and next explicit request can recover without fallback',async()=>{
  const client=new Generator();clients.push(client);const {scene}=fixture(),entered=deferred<void>(),ack=deferred<void>();mock.exchange.mockImplementation(async(r,o)=>{const result=await exchange(r,o);if(r.operation.kind==='render'){entered.resolve();await ack.promise;}return result;});
  const pending=client.generate(scene,context),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});await entered.promise;client.cancel();await rejected;expect(kinds()).not.toContain('release');ack.resolve();await client.settledNativeCleanup();expect(remote.size).toBe(0);mock.exchange.mockImplementation(exchange);const out=await client.generate(scene,context);expect(out.backend).toBe('native');
 });
 it('public retry cannot replace a resource whose release still fails',async()=>{
  const client=new Generator();clients.push(client);const {scene}=fixture();mock.exchange.mockImplementation(async(r,o)=>{const reply=await exchange(r,o);if(r.operation.kind==='render')throw Error('render ACK lost');return reply;});mock.release.mockRejectedValue(Error('release pending'));
  await expect(client.generate(scene,context)).rejects.toThrow();const token=records[0].request.operation.resource;expect(remote.has(token)).toBe(true);expect(kinds().filter(k=>k==='create')).toHaveLength(1);
  await expect(client.generate(scene,context)).rejects.toThrow('release');expect(kinds().filter(k=>k==='create')).toHaveLength(1);mock.release.mockImplementation(exchange);mock.exchange.mockImplementation(exchange);await client.generate(scene,context);expect(kinds().filter(k=>k==='create')).toHaveLength(2);expect(remote.has(token)).toBe(false);
 });
 it('keeps source CPU and local Attractor on Worker even under native drawing policy',async()=>{
  const messages:unknown[]=[];vi.stubGlobal('Worker',class{onmessage:unknown;onerror:unknown;postMessage(value:unknown){messages.push(value);}terminate(){}});const client=new Generator();clients.push(client);const {scene}=fixture();scene.attractorSource!.configuration.nativeBackend='cpu';
  const cpu=client.generate(scene,context),cancelled=expect(cpu).rejects.toMatchObject({name:'AbortError'});expect(messages).toHaveLength(1);expect(mock.exchange).not.toHaveBeenCalled();client.cancel();await cancelled;
  const local=structuredClone(scene);delete local.attractorSource;const request=client.generate(local,context),rejected=expect(request).rejects.toMatchObject({name:'AbortError'});expect(messages).toHaveLength(2);client.cancel();await rejected;
 });
});
