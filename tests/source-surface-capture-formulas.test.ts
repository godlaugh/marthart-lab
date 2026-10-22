import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {renderSurfaceCapture} from '../src/engine/renderSurfaceCapture';
import {encodeFormulaRaster} from '../src/engine/formulaCanvas';
import {SurfaceRecordingRenderer} from '../src/engine/renderSurfaceRecording';
import type {GenerationInput} from '../src/types';
const state=vi.hoisted(()=>({width:0,height:0,events:[] as string[],encoded:[] as unknown[],draws:[] as unknown[][]}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{
 renderer={getContext:()=>({MAX_VIEWPORT_DIMS:1,MAX_RENDERBUFFER_SIZE:2,NO_ERROR:0,RGBA:3,UNSIGNED_BYTE:4,get drawingBufferWidth(){return state.width;},get drawingBufferHeight(){return state.height;},getParameter:(p:number)=>p===1?[1024,1024]:1024,isContextLost:()=>false,getError:()=>0,readPixels:(_x:number,_y:number,w:number,h:number,_f:number,_t:number,out:Uint8ClampedArray)=>{state.events.push('geometry');for(let y=0;y<h;y++)out.fill(20+y,y*w*4,(y+1)*w*4);}}),forceContextLoss(){} };setSize(w:number,h:number,d:number){state.width=w*d;state.height=h*d;}setOutput(){}render(){}dispose(){}
}}));
vi.mock('../src/engine/formulaSvg',()=>({renderFormulaSvg:()=>({width:4,height:2,source:'<svg/>'})}));
vi.mock('../src/engine/sourcePausedPng',()=>({encodeSourcePausedPng:async(p:Uint8ClampedArray,w:number,h:number,s:number)=>{state.events.push('enhance-upscale');state.encoded=[p.slice(),w,h,s];return new Blob(['png']);}}));
function setup(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'capture',equations:{x:'u',y:'v',z:'0'},settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:2,v_segments:2},timeline:[{type:'wait',duration:1}],main_equation:{enabled:true,position:[0,0],scale:.25,color:'#ffffff',latex:'x'}})).scene;
 const context:GenerationInput={time:0,width:16,height:8,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,8,4,'primary',4),surfaceLive:{sessionId:'capture',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}},owner=new SourceSurfaceLiveSession();owner.generate(scene,context);return{scene,context,owner};
}
beforeEach(()=>{
 state.events=[];state.encoded=[];state.draws=[];
 vi.stubGlobal('document',{createElement:()=>{let pixels=new Uint8ClampedArray();return{width:0,height:0,getContext:()=>({putImageData:(image:{data:Uint8ClampedArray})=>{pixels=image.data.slice();},drawImage:(...args:unknown[])=>{state.events.push('formula');state.draws.push(args);pixels[0]=211;},getImageData:()=>({data:pixels})})};}});
 vi.stubGlobal('Image',class{src='';decode=()=>Promise.resolve();});vi.stubGlobal('ImageData',class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:formula');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Surface base PNG and formula composition owner',()=>{
 it.each([1,3,5] as const)('delivers raw base geometry and composes formula before shared enhancement/%sx upscale',async scale=>{
  const f=setup(),prepared=f.owner.capturePaused(f.scene,f.context,{width:8,height:4},scale),result=await renderSurfaceCapture(prepared,f.context,{width:8,height:4},scale,()=>false);
  expect(result.capture).toMatchObject({width:8,height:4,sourceCurrentImage:{stage:'base-before-formulas',baseSize:[8,4],logicalSize:[4,2],pixelDensity:2,requestedSize:[8,4],scale}});
  expect(result.capture.pixels[0]).toBe(23);expect(state.events).toEqual(['geometry']);
  await encodeFormulaRaster(result.capture);expect(state.events).toEqual(['geometry','formula','enhance-upscale']);expect(state.draws[0].slice(1)).toEqual([2.75,1.375,2.5,1.25]);
  expect(state.encoded.slice(1)).toEqual([8,4,scale]);expect((state.encoded[0] as Uint8ClampedArray)[0]).toBe(211);expect(result.capture.pixels[0]).toBe(23);
 });
 it('recording carries the producing frame layout rather than parsing a newer document',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,{width:8,height:4,simulationFps:10,actualFrameRate:60}),scene=structuredClone(f.scene);scene.formulas!.main.latex='new draft';
  const renderer=new SurfaceRecordingRenderer(scene,{width:8,height:4,logicalWidth:4,logicalHeight:2,density:2});
  try{if(start.warmup.type!=='geometry')throw Error('geometry');const out=renderer.render(start.warmup,()=>false);expect(out.formulaPresentation).toEqual(start.warmup.formulaPresentation);expect(out.formulaPresentation!.labels[0].latex).toBe('x');expect(out).not.toHaveProperty('sourceCurrentImage');}finally{renderer.dispose();f.owner.finishRecording(start.handle,1000);}
 });
});
