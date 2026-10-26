import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {encodeSourceGeometryImage,usesSourceGeometryImage} from '../src/engine/sourceGeometryImage';
import {sourceAttractorImageTarget} from '../src/engine/sourceAttractorImageTarget';
import {parseProjectFile} from '../src/engine/legacyImport';
import {formulaPresentation} from '../src/engine/formulas';
import {prepareSourceDrawingPlan} from '../src/engine/sourceDrawingSnapshot';
import {generateScene} from '../src/engine/temporal';
import {artExportPurpose,type ArtRenderer} from '../src/engine/renderer';
import {usesNativeSourceViewport,nativeSourceFramePreviewEnabled} from '../src/engine/sourceNativeViewport';
import type {RasterOutput,SceneOutput} from '../src/types';
import type {FormulaCompositeOptions} from '../src/engine/formulaCanvas';

const state=vi.hoisted(()=>({encode:vi.fn(async()=>new Blob(['encoded'])),lease:vi.fn(async()=>{}),chunks:vi.fn(),released:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async importOriginal=>({...await importOriginal<object>(),renderSourceNativeChunks:state.chunks}));
vi.mock('../src/engine/formulaCanvas',()=>({encodeFormulaRaster:state.encode}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:state.lease,sourceNativeLeaseToken:()=>undefined}));
function source(){return parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'Image boundary diagnostic',equations:{dx:'y',dy:'-x',dz:'0'},settings:{particle_count_cpu:2,sub_steps:1},initialization:{warmup_steps:0}})).scene;}
function setup(){
 const scene=source(),target=sourceAttractorImageTarget(scene,{width:4,height:4},2,486);
 const output=generateScene(scene,{time:0,quality:'export',width:target.width,height:target.height,sourceViewport:target.sourceViewport,sourcePointPixelDensity:target.density});
 output.formulaPresentation=formulaPresentation(scene,target.sourceViewport);
 const gl={drawingBufferWidth:4,drawingBufferHeight:4,readPixels:vi.fn(()=>{throw Error('Unexpected WebGL fallback');})};
 let identity={generation:0,sequence:0};
 const renderer={renderer:{getContext:()=>gl},releaseSourceDrawing:state.released,sourceDrawingPlan(generation:number,sequence:number){return{ok:true,value:{generation,sequence,width:4,height:4,samples:0,clear:[0,0,0,1],plan:(prepareSourceDrawingPlan([]) as {ok:true;value:unknown}).value}};},sourceDrawingFrame(generation:number,sequence:number){identity={generation,sequence};return{ok:true,value:{...identity,width:4,height:4,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}}};}} as unknown as ArtRenderer;
 const signal=new AbortController().signal;
 const fetch=vi.fn(async()=>new Response(new Uint8Array(64).map((_v,i)=>i),{headers:{'content-type':'application/octet-stream','content-length':'64','x-source-format':'rgba8','x-source-row-order':'bottom-up','x-source-generation':String(identity.generation),'x-source-sequence':String(identity.sequence),'x-source-width':'4','x-source-height':'4','x-source-renderer':'a'.repeat(64)}}));
 vi.stubGlobal('fetch',fetch);return{scene,output,renderer,gl,signal,fetch};
}
beforeEach(()=>{vi.stubEnv('VITE_SOURCE_RENDERER','native');state.encode.mockClear();state.lease.mockReset().mockResolvedValue();state.released.mockClear();state.chunks.mockReset().mockImplementation(async(frame:any)=>({...frame,pixels:new Uint8ClampedArray(Array.from({length:64},(_,i)=>(i+48)%64)),rendererIdentity:'a'.repeat(64),requestBytes:100}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('CPU Attractor shared geometry image boundary (mock transport; no native pixel parity claim)',()=>{
 it('admits only explicitly sourced CPU geometry, not local or source GPU Attractor',()=>{
  const {scene,output}=setup();expect(usesSourceGeometryImage(scene)).toBe(true);expect(nativeSourceFramePreviewEnabled(scene)).toBe(true);expect(usesNativeSourceViewport(scene,output)).toBe(true);expect(artExportPurpose(scene)).toBe('source-offscreen-export');
  scene.attractorSource!.configuration.nativeBackend='gpu';expect(usesSourceGeometryImage(scene)).toBe(false);expect(nativeSourceFramePreviewEnabled(scene)).toBe(true);expect(usesNativeSourceViewport(scene,output)).toBe(false);
  expect(usesNativeSourceViewport(scene,{...output,type:'raster',width:4,height:4,pixels:new Uint8ClampedArray(64),backend:'native'} as SceneOutput)).toBe(true);expect(artExportPurpose(scene)).toBe('local-export');
  delete scene.attractorSource;expect(usesSourceGeometryImage(scene)).toBe(false);
 });
 it('uses Processing physical-to-logical rounding and primary reference height without recording scale',()=>{
  const scene=source();expect(sourceAttractorImageTarget(scene,{width:500,height:600},2,486)).toMatchObject({width:500,height:600,logicalWidth:250,logicalHeight:300,density:2,sourceViewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}});
  expect(sourceAttractorImageTarget(scene,{width:500,height:600},1,486)).toMatchObject({width:500,height:600,logicalWidth:500,logicalHeight:600,density:1});
  expect(sourceAttractorImageTarget(scene,{width:501,height:601},2,486)).toMatchObject({width:502,height:602,logicalWidth:251,logicalHeight:301});
  expect(sourceAttractorImageTarget(scene,{width:1920,height:1080},2,486)).toMatchObject({width:1920,height:1080,logicalWidth:960,logicalHeight:540});
  expect(()=>sourceAttractorImageTarget(scene,{width:500,height:600},NaN,486)).toThrow();expect(()=>sourceAttractorImageTarget(scene,{width:500,height:600},2,NaN)).toThrow();
 });
 it.each(['image/png','image/jpeg'] as const)('uses native pixels and the delivered formula owner for %s',async format=>{
  const f=setup();await encodeSourceGeometryImage(f.renderer,f.scene,f.output,{signal:f.signal,purpose:'static-image',format});
  expect(state.lease).toHaveBeenCalledOnce();expect(f.fetch).not.toHaveBeenCalled();expect(state.chunks).toHaveBeenCalledOnce();expect(state.released).toHaveBeenCalledOnce();expect(state.released.mock.invocationCallOrder[0]).toBeLessThan(state.encode.mock.invocationCallOrder[0]);expect(f.gl.readPixels).not.toHaveBeenCalled();
  const [image,type,options]=state.encode.mock.calls[0] as unknown as [RasterOutput,string,FormulaCompositeOptions];
  expect(type).toBe(format);expect(image.formulaPresentation).toEqual(f.output.formulaPresentation);expect(image.pixels.slice(0,16)).toEqual(new Uint8ClampedArray(Array.from({length:16},(_,i)=>48+i)));expect(image.sourcePixelRenderer).toMatchObject({backend:'native',identity:'a'.repeat(64),samples:0});
  expect(options.sourceImageProcessing).toBe(format==='image/png'?'paused-png':undefined);expect(options.sourcePresentationAlpha).toBeUndefined();expect(image).not.toHaveProperty('sourceCurrentImage');
 });
 it('keeps video alpha completion in the shared encoder and does not enhance video frames',async()=>{
  const f=setup();await encodeSourceGeometryImage(f.renderer,f.scene,f.output,{signal:f.signal,purpose:'video-frame'});
  expect(state.encode.mock.calls[0]).toEqual([expect.anything(),'image/png',expect.objectContaining({sourcePresentationAlpha:'opaque'})]);expect((state.encode.mock.calls[0] as unknown as [unknown,unknown,FormulaCompositeOptions])[2].sourceImageProcessing).toBeUndefined();
 });
 it('rejects source GPU or missing CPU frame facts and incompatible codec before starting native work',async()=>{
  const f=setup(),options={signal:f.signal,purpose:'static-image' as const};
  f.scene.attractorSource!.configuration.nativeBackend='gpu';await expect(encodeSourceGeometryImage(f.renderer,f.scene,f.output,options)).rejects.toThrow('CPU');f.scene.attractorSource!.configuration.nativeBackend='cpu';
  await expect(encodeSourceGeometryImage(f.renderer,f.scene,{...f.output,backend:'webgl2'} as SceneOutput,options)).rejects.toThrow('CPU');
  await expect(encodeSourceGeometryImage(f.renderer,f.scene,f.output,{...options,purpose:'video-frame',format:'image/jpeg'})).rejects.toThrow('PNG');expect(f.fetch).not.toHaveBeenCalled();expect(state.lease).not.toHaveBeenCalled();
 });
 it('does not submit a frame or encode after lease establishment fails',async()=>{
  const f=setup();state.lease.mockRejectedValueOnce(Error('lease unavailable'));await expect(encodeSourceGeometryImage(f.renderer,f.scene,f.output,{signal:f.signal,purpose:'static-image'})).rejects.toThrow('lease unavailable');expect(f.fetch).not.toHaveBeenCalled();expect(f.gl.readPixels).not.toHaveBeenCalled();expect(state.encode).not.toHaveBeenCalled();
 });
 it('does not fall back or encode after native failure, and retains geometry until caller cleanup',async()=>{
  const f=setup();state.chunks.mockRejectedValueOnce(Error('native draw failed'));await expect(encodeSourceGeometryImage(f.renderer,f.scene,f.output,{signal:f.signal,purpose:'video-frame'})).rejects.toThrow('native draw failed');expect(f.gl.readPixels).not.toHaveBeenCalled();expect(state.released).not.toHaveBeenCalled();expect(state.encode).not.toHaveBeenCalled();
 });
 it('does not encode a native result when exclusive geometry cleanup failed',async()=>{
  const f=setup();state.released.mockImplementationOnce(()=>{throw Error('geometry still owned');});await expect(encodeSourceGeometryImage(f.renderer,f.scene,f.output,{signal:f.signal,purpose:'static-image'})).rejects.toThrow('geometry still owned');expect(state.encode).not.toHaveBeenCalled();
 });
});
