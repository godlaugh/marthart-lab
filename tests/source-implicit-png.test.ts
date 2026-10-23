import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {encodeSourceImplicitImage} from '../src/engine/sourceImplicitImage';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import fixture from './fixtures/source-implicit-presentation/native.json';
import type {ArtRenderer} from '../src/engine/renderer';
import type {RasterOutput} from '../src/types';
import type {FormulaCompositeOptions} from '../src/engine/formulaCanvas';
const encode=vi.hoisted(()=>vi.fn(async()=>new Blob(['png'],{type:'image/png'})));
vi.mock('../src/engine/formulaCanvas',()=>({encodeFormulaRaster:encode}));
function setup(){
 const raw=structuredClone(fixture.cases[0].input);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(raw)).scene;
 const output=generateScene(scene,{time:0,width:2,height:2,quality:'export',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,2,2,'offscreen',486)});
 const gl={drawingBufferWidth:2,drawingBufferHeight:2,readPixels:vi.fn(()=>{throw Error('Unexpected WebGL fallback');})};
 let identity={generation:0,sequence:0};
 const renderer={renderer:{getContext:()=>gl},sourceDrawingFrame(generation:number,sequence:number){identity={generation,sequence};return{ok:true,value:{...identity,width:2,height:2,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}}};}} as unknown as ArtRenderer;
 const controller=new AbortController();
 const response=()=>new Response(new Uint8Array([...Array(8).fill(11),...Array(8).fill(29)]),{headers:{'content-type':'application/octet-stream','content-length':'16','x-source-format':'rgba8','x-source-row-order':'bottom-up','x-source-generation':String(identity.generation),'x-source-sequence':String(identity.sequence),'x-source-width':'2','x-source-height':'2','x-source-renderer':'a'.repeat(64)}});
 return {output,renderer,controller,response,gl,run:()=>encodeSourceImplicitImage(renderer,output,{signal:controller.signal,purpose:'static-png'})};
}
beforeEach(()=>{vi.stubEnv('VITE_SOURCE_RENDERER','native');encode.mockClear();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('CPU implicit PNG uses shared source drawing and encoding owners',()=>{
 it('delivers native top-down bytes, resolved formula frame and enhancement without claiming a retained capture',async()=>{
  const f=setup();vi.stubGlobal('fetch',vi.fn(async()=>f.response()));await f.run();
  expect(encode).toHaveBeenCalledOnce();const [image,type,options]=encode.mock.calls[0] as unknown as [RasterOutput,string,FormulaCompositeOptions];
  expect(image.pixels).toEqual(new Uint8ClampedArray([...Array(8).fill(29),...Array(8).fill(11)]));expect(image.formulaPresentation).toEqual(f.output.formulaPresentation);expect(image.sourcePixelRenderer?.backend).toBe('native');expect(image).not.toHaveProperty('sourceCurrentImage');expect(type).toBe('image/png');expect(options.sourceImageProcessing).toBe('paused-png');expect(f.gl.readPixels).not.toHaveBeenCalled();
 });
 it('routes a video frame to opaque PNG encoding without static image enhancement',async()=>{
  const f=setup();vi.stubGlobal('fetch',vi.fn(async()=>f.response()));await encodeSourceImplicitImage(f.renderer,f.output,{signal:f.controller.signal,purpose:'video-frame'});
  const options=(encode.mock.calls[0] as unknown as [unknown,unknown,FormulaCompositeOptions])[2];expect(options.sourcePresentationAlpha).toBe('opaque');expect(options.sourceImageProcessing).toBeUndefined();
 });
 it('does not encode or fall back after unavailable service, and permits a fresh retry',async()=>{
  const f=setup();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({kind:'unavailable',error:'missing backend'}),{status:503})).mockImplementationOnce(async()=>f.response()));
  await expect(f.run()).rejects.toMatchObject({kind:'unavailable'});expect(encode).not.toHaveBeenCalled();expect(f.gl.readPixels).not.toHaveBeenCalled();await f.run();expect(encode).toHaveBeenCalledOnce();
 });
 it('cancels an in-flight native response without encoding and releases the shared slot',async()=>{
  const f=setup();let ready!:()=>void;const started=new Promise<void>(r=>ready=r);
  vi.stubGlobal('fetch',vi.fn((_url,options:RequestInit)=>new Promise((_resolve,reject)=>{options.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});ready();})));
  const pending=f.run();await started;f.controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(encode).not.toHaveBeenCalled();const next=setup();vi.stubGlobal('fetch',vi.fn(async()=>next.response()));await next.run();expect(encode).toHaveBeenCalledOnce();
 });
 it('rejects missing formulas or excessive image allocation before transport',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const f=setup();f.output.formulaPresentation=undefined;await expect(f.run()).rejects.toThrow();const large=setup();large.gl.drawingBufferWidth=large.gl.drawingBufferHeight=100000;await expect(large.run()).rejects.toThrow('容量');expect(fetch).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
 });
});
