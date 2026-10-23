import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {renderSurfaceCapture} from '../src/engine/renderSurfaceCapture';
import {GeometryRecordingRenderer} from '../src/engine/renderGeometryRecording';
import {retrySourceDrawingCleanup,sourceDrawingCleanupCount} from '../src/engine/sourceDrawingResources';
import type {GenerationInput} from '../src/types';
const state=vi.hoisted(()=>({width:0,height:0,created:0,disposed:0,released:0,readbacks:0,failDispose:false}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class {
 renderer={getContext:()=>({MAX_VIEWPORT_DIMS:1,MAX_RENDERBUFFER_SIZE:2,get drawingBufferWidth(){return state.width;},get drawingBufferHeight(){return state.height;},isContextLost:()=>false,getParameter:(p:number)=>p===1?[1024,1024]:1024,readPixels(){state.readbacks++;throw Error('Unexpected WebGL fallback');}}),forceContextLoss(){state.released++;}};
 constructor(){state.created++;}setSize(w:number,h:number,d:number){state.width=w*d;state.height=h*d;}setOutput(){}render(){}
 sourceDrawingFrame(generation:number,sequence:number){return{ok:true,value:{generation,sequence,width:state.width,height:state.height,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}}};}
 dispose(){state.disposed++;if(state.failDispose){state.failDispose=false;throw Error('dispose failed');}}
}}));
function fixture(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'native capture',equations:{x:'u',y:'v',z:'0'},settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:2,v_segments:2},timeline:[{type:'wait',duration:1}]})).scene;
 const context:GenerationInput={time:0,width:16,height:8,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,8,4,'primary',4),surfaceLive:{sessionId:'native-capture',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}};
 const owner=new SourceSurfaceLiveSession();owner.generate(scene,context);const prepared=owner.capturePaused(scene,context,{width:8,height:4},1),controller=new AbortController();
 return{controller,scene,prepared,run:()=>renderSurfaceCapture(prepared,context,{width:8,height:4},1,()=>false,{signal:controller.signal,generation:2,sequence:9})};
}
function response(){const pixels=new Uint8Array(128);for(let y=0;y<4;y++)pixels.fill(y+1,y*32,(y+1)*32);return new Response(pixels,{headers:{'content-type':'application/octet-stream','content-length':'128','x-source-format':'rgba8','x-source-row-order':'bottom-up','x-source-generation':'2','x-source-sequence':'9','x-source-width':'8','x-source-height':'4','x-source-renderer':'a'.repeat(64)}});}
beforeEach(()=>{retrySourceDrawingCleanup();Object.assign(state,{width:0,height:0,created:0,disposed:0,released:0,readbacks:0,failDispose:false});vi.stubGlobal('document',{createElement:()=>({width:0,height:0})});vi.stubEnv('VITE_SOURCE_RENDERER','native');});
afterEach(()=>{retrySourceDrawingCleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
// Native transport/pixel fidelity is verified with real CGL and Worker scripts.
// These controlled faults prove delivery, cancellation and resource ownership.
describe('native paused capture delivery',()=>{
 it('returns native top-down bytes and exact producer provenance without WebGL readback',async()=>{
  const fetch=vi.fn(async()=>response());vi.stubGlobal('fetch',fetch);const result=await fixture().run();
  expect(result.capture.pixels[0]).toBe(4);expect(result.capture.pixels[96]).toBe(1);
  expect(result.capture.sourcePixelRenderer).toEqual({backend:'native',identity:'a'.repeat(64),generation:2,sequence:9,samples:0});
  expect(result.capture.sourceCurrentImage?.stage).toBe('base-before-formulas');expect(fetch).toHaveBeenCalledOnce();expect(state.readbacks).toBe(0);expect(state.disposed).toBe(1);expect(state.released).toBe(1);
 });
 it('does not substitute WebGL pixels after a backend error, and a later request can recover',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({kind:'unavailable',error:'backend missing'}),{status:503})).mockImplementationOnce(async()=>response());vi.stubGlobal('fetch',fetch);
  await expect(fixture().run()).rejects.toMatchObject({kind:'unavailable'});expect(state.readbacks).toBe(0);expect(state.released).toBe(1);
  expect((await fixture().run()).capture.sourcePixelRenderer?.backend).toBe('native');expect(state.released).toBe(2);
 });
 it('aborts an outstanding request and releases its own context before a replacement capture',async()=>{
  let started!:()=>void;const ready=new Promise<void>(r=>{started=r;}),aborted=vi.fn();
  vi.stubGlobal('fetch',vi.fn((_url,options:RequestInit)=>new Promise((_resolve,reject)=>{options.signal!.addEventListener('abort',()=>{aborted();reject(new DOMException('cancelled','AbortError'));},{once:true});started();})));
  const f=fixture(),pending=f.run();await ready;f.controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(aborted).toHaveBeenCalledOnce();expect(state.released).toBe(1);expect(state.readbacks).toBe(0);
  vi.stubGlobal('fetch',vi.fn(async()=>response()));await fixture().run();expect(state.released).toBe(2);
 });
 it('retains failed cleanup and retries only unfinished stages',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response()));state.failDispose=true;await expect(fixture().run()).rejects.toThrow('保留');expect(sourceDrawingCleanupCount()).toBe(1);expect(state.released).toBe(1);
  retrySourceDrawingCleanup();expect(sourceDrawingCleanupCount()).toBe(0);expect(state.disposed).toBe(2);expect(state.released).toBe(1);
 });
 it('preserves the render failure alongside a failed cleanup',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({kind:'unavailable',error:'backend missing'}),{status:503})));state.failDispose=true;
  const error=await fixture().run().catch(e=>e);expect(error).toBeInstanceOf(AggregateError);expect(error.errors[0]).toMatchObject({kind:'unavailable'});expect(error.errors[1]).toBeInstanceOf(AggregateError);expect(sourceDrawingCleanupCount()).toBe(1);
 });
 it('records consecutive native frames with one context and aborts an in-flight frame on disposal',async()=>{
  const f=fixture(),owner=new GeometryRecordingRenderer(f.scene,{width:8,height:4,logicalWidth:4,logicalHeight:2,density:2}),request={signal:f.controller.signal,generation:2,sequence:9};
  vi.stubGlobal('fetch',vi.fn(async()=>response()));
  const first=await owner.render(f.prepared.capture,()=>false,request),second=await owner.render(f.prepared.capture,()=>false,request);
  expect(first.sourcePixelRenderer?.backend).toBe('native');expect(second.pixels).toEqual(first.pixels);expect(state.created).toBe(1);expect(state.readbacks).toBe(0);expect(state.released).toBe(0);
  let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});let aborted=false;
  vi.stubGlobal('fetch',vi.fn((_url,options:RequestInit)=>new Promise((_resolve,reject)=>{options.signal!.addEventListener('abort',()=>{aborted=true;reject(new DOMException('cancelled','AbortError'));},{once:true});started();})));
  const pending=owner.render(f.prepared.capture,()=>false,request);await ready;
  await expect(owner.render(f.prepared.capture,()=>false,request)).rejects.toThrow('前一帧');owner.dispose();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(aborted).toBe(true);expect(state.released).toBe(1);
 });
 it('keeps a recording renderer retryable after native failure without returning WebGL pixels',async()=>{
  const f=fixture(),owner=new GeometryRecordingRenderer(f.scene,{width:8,height:4,logicalWidth:4,logicalHeight:2,density:2}),request={signal:f.controller.signal,generation:2,sequence:9};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({kind:'unavailable',error:'backend missing'}),{status:503})).mockImplementationOnce(async()=>response()));
  await expect(owner.render(f.prepared.capture,()=>false,request)).rejects.toMatchObject({kind:'unavailable'});
  expect((await owner.render(f.prepared.capture,()=>false,request)).sourcePixelRenderer?.backend).toBe('native');expect(state.created).toBe(1);expect(state.readbacks).toBe(0);owner.dispose();
 });
 it('rejects pre-cancel and unknown build policy before allocating a context',async()=>{
  const f=fixture();f.controller.abort();await expect(f.run()).rejects.toMatchObject({name:'AbortError'});expect(state.created).toBe(0);
  vi.stubEnv('VITE_SOURCE_RENDERER','typo');await expect(fixture().run()).rejects.toThrow('配置');expect(state.created).toBe(0);
 });
});
