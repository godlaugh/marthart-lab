import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sourceRecordingSize} from '../src/engine/sourceRecordingSize';
import type {SceneOutput} from '../src/types';
const state=vi.hoisted(()=>({created:0,draws:0,disposals:0,releases:0,failDispose:false,failRelease:false,lost:false,error:0,width:0,height:0}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{
 renderer={getContext:()=>({MAX_VIEWPORT_DIMS:1,MAX_RENDERBUFFER_SIZE:2,NO_ERROR:0,RGBA:3,UNSIGNED_BYTE:4,get drawingBufferWidth(){return state.width;},get drawingBufferHeight(){return state.height;},getParameter:(p:number)=>p===1?[100,100]:100,isContextLost:()=>state.lost,getError:()=>state.error,readPixels:(_x:number,_y:number,w:number,h:number,_f:number,_t:number,out:Uint8ClampedArray)=>{for(let y=0;y<h;y++)out.fill(y+1,y*w*4,(y+1)*w*4);}}),forceContextLoss:()=>{state.releases++;if(state.failRelease){state.failRelease=false;throw Error('release');}state.lost=true;}};
 constructor(){state.created++;}setSize(w:number,h:number,d:number){state.width=w*d;state.height=h*d;}setOutput(){}render(){state.draws++;}dispose(){state.disposals++;if(state.failDispose){state.failDispose=false;throw Error('dispose');}}
}}));
import {SurfaceRecordingRenderer,retrySurfaceRecordingRendererCleanup,surfaceRecordingRendererCleanupCount} from '../src/engine/renderSurfaceRecording';
const scene=createScene(definition('surface')),size=sourceRecordingSize({width:1,height:1},1);
const geometry:Extract<SceneOutput,{type:'geometry'}>={type:'geometry',topology:'points',positions:new Float32Array([0,0,0]),formulaPresentation:{referenceWidth:1280,referenceHeight:720,labels:[]},stats:{samples:1,generated:1,invalid:0,elapsedMs:0}};
beforeEach(()=>{retrySurfaceRecordingRendererCleanup();Object.assign(state,{created:0,draws:0,disposals:0,releases:0,failDispose:false,failRelease:false,lost:false,error:0,width:0,height:0});vi.stubGlobal('document',{createElement:()=>({width:0,height:0})});});
afterEach(()=>{retrySurfaceRecordingRendererCleanup();vi.unstubAllGlobals();});
describe('Surface recording GL resource owner',()=>{
 it('reuses one renderer and returns top-down raw pixels with formula metadata',()=>{
  const owner=new SurfaceRecordingRenderer(scene,size),a=owner.render(geometry,()=>false),b=owner.render(geometry,()=>false);
  expect(a.pixels[0]).toBe(3);expect(a.pixels[24]).toBe(1);expect(b.pixels).toEqual(a.pixels);expect(a.formulaPresentation).toBeDefined();expect(a.cameraResolved).toBe(true);expect(state.created).toBe(1);expect(state.draws).toBe(2);
  owner.dispose();owner.dispose();expect(state.disposals).toBe(1);expect(state.releases).toBe(1);
 });
 it.each(['failDispose','failRelease'] as const)('retains the exact failed resource and retries only unfinished release stages: %s',failure=>{
  const owner=new SurfaceRecordingRenderer(scene,size);state[failure]=true;expect(()=>owner.dispose()).toThrow();expect(surfaceRecordingRendererCleanupCount()).toBe(1);
  retrySurfaceRecordingRendererCleanup();expect(surfaceRecordingRendererCleanupCount()).toBe(0);
  expect(state.disposals).toBe(failure==='failDispose'?2:1);expect(state.releases).toBe(failure==='failRelease'?2:1);expect(()=>owner.render(geometry,()=>false)).toThrow('已释放');
 });
 it('rejects cancellation, a lost context and a failed readback without dropping the renderer owner',()=>{
  const owner=new SurfaceRecordingRenderer(scene,size);expect(()=>owner.render(geometry,()=>true)).toThrow('取消');expect(state.draws).toBe(0);
  state.lost=true;expect(()=>owner.render(geometry,()=>false)).toThrow('丢失');state.lost=false;state.error=1282;expect(()=>owner.render(geometry,()=>false)).toThrow('回读');owner.dispose();
 });
 it('rejects GPU capacity before drawing or pixel allocation',()=>{
  const owner=new SurfaceRecordingRenderer(scene,sourceRecordingSize({width:40,height:40},1));expect(()=>owner.render(geometry,()=>false)).toThrow('GPU 限制');expect(state.draws).toBe(0);owner.dispose();
 });
});
