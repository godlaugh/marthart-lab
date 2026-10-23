import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {renderGeometryCapture} from '../src/engine/renderGeometryCapture';
import {encodeFormulaRaster} from '../src/engine/formulaCanvas';
import {GeometryRecordingRenderer} from '../src/engine/renderGeometryRecording';
import type {GenerationInput,FormulaPresentation} from '../src/types';
const state=vi.hoisted(()=>({width:0,height:0,events:[] as string[],encoded:[] as unknown[],compositions:[] as {base:Uint8ClampedArray;width:number;height:number;presentation:FormulaPresentation;signal?:AbortSignal}[]}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{
 renderer={getContext:()=>({MAX_VIEWPORT_DIMS:1,MAX_RENDERBUFFER_SIZE:2,NO_ERROR:0,RGBA:3,UNSIGNED_BYTE:4,get drawingBufferWidth(){return state.width;},get drawingBufferHeight(){return state.height;},getParameter:(p:number)=>p===1?[1024,1024]:1024,isContextLost:()=>false,getError:()=>0,readPixels:(_x:number,_y:number,w:number,h:number,_f:number,_t:number,out:Uint8ClampedArray)=>{state.events.push('geometry');for(let y=0;y<h;y++)out.fill(20+y,y*w*4,(y+1)*w*4);}}),forceContextLoss(){} };setSize(w:number,h:number,d:number){state.width=w*d;state.height=h*d;}setOutput(){}render(){}dispose(){}
}}));
// This is an owner/order test. The GL compositor and its pixel fidelity are
// exercised by browser validation; this boundary only marks the composed bytes.
vi.mock('../src/engine/sourceFormulaCompositor',()=>({compositeSourceFormulaPixels:async(base:Uint8ClampedArray,width:number,height:number,presentation:FormulaPresentation,signal?:AbortSignal)=>{
 state.events.push('formula');state.compositions.push({base,width,height,presentation,signal});const composed=base.slice();composed[0]=211;return composed;
}}));
vi.mock('../src/engine/sourcePausedPng',()=>({encodeSourcePausedPng:async(p:Uint8ClampedArray,w:number,h:number,s:number)=>{state.events.push('enhance-upscale');state.encoded=[p.slice(),w,h,s];return new Blob(['png']);}}));
function setup(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'capture',equations:{x:'u',y:'v',z:'0'},settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:2,v_segments:2},timeline:[{type:'wait',duration:1}],main_equation:{enabled:true,position:[0,0],scale:.25,color:'#ffffff',latex:'x'}})).scene;
 scene.formulas!.main.latex='x'; // Explicit local edit after source import.
 const context:GenerationInput={time:0,width:16,height:8,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,8,4,'primary',4),surfaceLive:{sessionId:'capture',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}},owner=new SourceSurfaceLiveSession();owner.generate(scene,context);return{scene,context,owner};
}
beforeEach(()=>{state.events=[];state.encoded=[];state.compositions=[];vi.stubGlobal('document',{createElement:()=>({width:0,height:0})});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Surface base PNG and formula composition owner',()=>{
 it.each([1,3,5] as const)('delivers raw base geometry and composes formula before shared enhancement/%sx upscale',async scale=>{
  const f=setup(),draft=structuredClone(f.scene);draft.formulas!.main.latex='unapplied draft';draft.formulas!.main.x=999;
  const prepared=f.owner.capturePaused(draft,f.context,{width:8,height:4},scale),result=await renderGeometryCapture(prepared,f.context,{width:8,height:4},scale,()=>false);
  expect(result.capture).toMatchObject({width:8,height:4,sourceCurrentImage:{stage:'base-before-formulas',baseSize:[8,4],logicalSize:[4,2],pixelDensity:2,requestedSize:[8,4],scale}});
  expect(result.capture.pixels[0]).toBe(23);expect(state.events).toEqual(['geometry']);
  const controller=new AbortController();await encodeFormulaRaster(result.capture,'image/png',{signal:controller.signal});expect(state.events).toEqual(['geometry','formula','enhance-upscale']);
  expect(state.compositions).toHaveLength(1);expect(state.compositions[0].base).toBe(result.capture.pixels);expect(state.compositions[0].presentation).toBe(result.capture.formulaPresentation);
  expect(state.compositions[0]).toMatchObject({width:8,height:4,presentation:{layout:'source-surface-centered-v1',labels:[{latex:'x',x:0}]}});expect(state.compositions[0].signal).toBe(controller.signal);
  expect(state.encoded.slice(1)).toEqual([8,4,scale]);expect((state.encoded[0] as Uint8ClampedArray)[0]).toBe(211);expect(result.capture.pixels[0]).toBe(23);
 });
 it('recording carries the producing frame layout rather than parsing a newer document',async()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,{width:8,height:4,simulationFps:10,actualFrameRate:60}),scene=structuredClone(f.scene);scene.formulas!.main.latex='new draft';
  const renderer=new GeometryRecordingRenderer(scene,{width:8,height:4,logicalWidth:4,logicalHeight:2,density:2});
  try{if(start.warmup.type!=='geometry')throw Error('geometry');const out=await renderer.render(start.warmup,()=>false);expect(out.formulaPresentation).toEqual(start.warmup.formulaPresentation);expect(out.formulaPresentation!.labels[0].latex).toBe('x');expect(out).not.toHaveProperty('sourceCurrentImage');}finally{renderer.dispose();f.owner.finishRecording(start.handle,1000);}
 });
});
