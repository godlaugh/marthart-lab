import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {prepareSourceImplicitOffscreenTarget} from '../src/engine/sourceImplicitViewport';
import {sourceRecordingSize} from '../src/engine/sourceRecordingSize';
import type {SceneOutput} from '../src/types';
const state=vi.hoisted(()=>({created:0,draws:0,disposals:0,releases:0,failDispose:false,failRelease:false,lost:false,error:0,width:0,height:0,sizes:[] as number[][]}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{
 renderer={getContext:()=>({MAX_VIEWPORT_DIMS:1,MAX_RENDERBUFFER_SIZE:2,NO_ERROR:0,RGBA:3,UNSIGNED_BYTE:4,get drawingBufferWidth(){return state.width;},get drawingBufferHeight(){return state.height;},getParameter:(p:number)=>p===1?[100,100]:100,isContextLost:()=>state.lost,getError:()=>state.error,readPixels:(_x:number,_y:number,w:number,h:number,_f:number,_t:number,out:Uint8ClampedArray)=>{for(let y=0;y<h;y++)out.fill(y+1,y*w*4,(y+1)*w*4);}}),forceContextLoss:()=>{state.releases++;if(state.failRelease){state.failRelease=false;throw Error('release');}state.lost=true;}};
 constructor(){state.created++;}setSize(w:number,h:number,d:number){state.sizes.push([w,h,d]);state.width=w*d;state.height=h*d;}setOutput(){state.draws++;}render(){state.draws++;}dispose(){state.disposals++;if(state.failDispose){state.failDispose=false;throw Error('dispose');}}
}}));
import {GeometryRecordingRenderer} from '../src/engine/renderGeometryRecording';
import {retrySourceDrawingCleanup,sourceDrawingCleanupCount} from '../src/engine/sourceDrawingResources';
const scene=createScene(definition('surface')),size=sourceRecordingSize({width:1,height:1},1);
const geometry:Extract<SceneOutput,{type:'geometry'}>={type:'geometry',topology:'points',positions:new Float32Array([0,0,0]),formulaPresentation:{referenceWidth:1280,referenceHeight:720,labels:[]},stats:{samples:1,generated:1,invalid:0,elapsedMs:0}};
beforeEach(()=>{retrySourceDrawingCleanup();Object.assign(state,{created:0,draws:0,disposals:0,releases:0,failDispose:false,failRelease:false,lost:false,error:0,width:0,height:0,sizes:[]});vi.stubGlobal('document',{createElement:()=>({width:0,height:0})});});
afterEach(()=>{retrySourceDrawingCleanup();vi.unstubAllGlobals();});
describe('Surface recording GL resource owner',async()=>{
 it('reuses one renderer and returns top-down raw pixels with formula metadata',async()=>{
  const owner=new GeometryRecordingRenderer(scene,size),a=await owner.render(geometry,()=>false),b=await owner.render(geometry,()=>false);
  expect(a.pixels[0]).toBe(3);expect(a.pixels[24]).toBe(1);expect(b.pixels).toEqual(a.pixels);expect(a.formulaPresentation).toBeDefined();expect(a.cameraResolved).toBe(true);expect(state.created).toBe(1);expect(state.draws).toBe(2);
  owner.dispose();owner.dispose();expect(state.disposals).toBe(1);expect(state.releases).toBe(1);
 });
 it.each(['CPU','GPU'] as const)('uses completed Implicit %s material for drawing dimensions despite the staged opposite backend',async mode=>{
  const applied=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'IMPLICIT',name:'Completed Implicit recording model',equation:{f:'x^2+y^2+z^2-1'},settings:{render_mode:'SOLID',mesh_mode:mode,x_segments:4,y_segments:4,z_segments:4}})).scene;
  const size=sourceRecordingSize({width:8,height:6},2),model=mode==='GPU'?'mathart-1.7.8-gpu-material-v1':'mathart-1.7.8-cpu-slices-v1',target=prepareSourceImplicitOffscreenTarget(model,size,2,486);
  const output=generateScene(applied,{time:0,width:size.width,height:size.height,quality:'export',sourcePointPixelDensity:2,sourceViewport:{...ordinarySourceViewport(applied,size.width,size.height,'offscreen',486),...target.sourceViewport}});if(output.type!=='geometry')throw Error('geometry');
  const staged=structuredClone(applied);staged.settings.computeBackend=mode==='CPU'?'webgl2':'cpu';const owner=new GeometryRecordingRenderer(staged,size);
  try{const result=await owner.render(output,()=>false);expect(state.sizes).toEqual([mode==='GPU'?[12,9,2]:[24,18,1]]);expect(result).toMatchObject({width:24,height:18,sourceCameraFrame:output.sourceCameraFrame});}finally{owner.dispose();}
 });
 it.each(['failDispose','failRelease'] as const)('retains the exact failed resource and retries only unfinished release stages: %s',async failure=>{
  const owner=new GeometryRecordingRenderer(scene,size);state[failure]=true;expect(()=>owner.dispose()).toThrow();expect(sourceDrawingCleanupCount()).toBe(1);
  retrySourceDrawingCleanup();expect(sourceDrawingCleanupCount()).toBe(0);
  expect(state.disposals).toBe(failure==='failDispose'?2:1);expect(state.releases).toBe(failure==='failRelease'?2:1);await expect(owner.render(geometry,()=>false)).rejects.toThrow('已释放');
 });
 it('rejects cancellation, a lost context and a failed readback without dropping the renderer owner',async()=>{
  const owner=new GeometryRecordingRenderer(scene,size);await expect(owner.render(geometry,()=>true)).rejects.toThrow('取消');expect(state.draws).toBe(0);
  state.lost=true;await expect(owner.render(geometry,()=>false)).rejects.toThrow('丢失');state.lost=false;state.error=1282;await expect(owner.render(geometry,()=>false)).rejects.toThrow('回读');owner.dispose();
 });
 it('rejects GPU capacity before drawing or pixel allocation',async()=>{
  const owner=new GeometryRecordingRenderer(scene,sourceRecordingSize({width:40,height:40},1));await expect(owner.render(geometry,()=>false)).rejects.toThrow('GPU 限制');expect(state.draws).toBe(0);owner.dispose();
 });
});
