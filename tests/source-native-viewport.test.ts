import {describe,it,expect,vi,beforeEach} from 'vitest';
import * as THREE from 'three';
import {SourceNativeViewport,type NativeViewportRequest} from '../src/engine/sourceNativeViewport';
import {prepareSourceDrawingPlan,type SourceDrawingPlan,type SourceDrawingChunk} from '../src/engine/sourceDrawingSnapshot';
import {createSourceShaderMaterial} from '../src/engine/sourceShaderMaterial';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
const state=vi.hoisted(()=>({calls:[] as {sequence:number;signal:AbortSignal;chunk?:SourceDrawingChunk;resolve:(v:any)=>void;reject:(e:Error)=>void}[],draws:[] as number[],disposed:0,failDispose:false,prepareError:false,leaseError:false,glyphBytes:0,formulaCalls:0}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:async()=>{if(state.leaseError)throw Error('lease failed');}}));
vi.mock('../src/engine/sourceNativeClient',()=>({SourceNativeError:class extends Error{},renderSourceNativeFrame:(frame:any,options:any)=>new Promise((resolve,reject)=>state.calls.push({sequence:frame.sequence,signal:options.signal,resolve,reject})),renderSourceNativeChunks:(frame:any,plan:SourceDrawingPlan,options:any)=>{
 const next=plan.next();if(!next.ok)throw Error(next.error.reason);const chunk=next.value;
 return new Promise((resolve,reject)=>state.calls.push({sequence:frame.sequence,signal:options.signal,chunk,resolve,reject})).finally(()=>{if(chunk){const released=chunk.release();if(!released.ok)throw Error(released.error.reason);}});
}}));
vi.mock('../src/engine/sourceFormulaCompositor',()=>({prepareSourceFormulas:async(p:any)=>{state.formulaCalls++;if(state.prepareError)throw Error('glyph failed');return{presentation:p,glyphs:state.glyphBytes?[{pixels:new Uint8Array(state.glyphBytes)}]:[]};},SourceFormulaCompositor:class{draw(_p:any,_w:number,_h:number,pixels:Uint8ClampedArray){state.draws.push(pixels[0]);}drawPixels(_w:number,_h:number,pixels:Uint8ClampedArray){state.draws.push(pixels[0]);}dispose(){if(state.failDispose){state.failDispose=false;throw Error('cleanup failed');}state.disposed++;}}}));
const pixels=(n:number)=>({width:1,height:1,pixels:new Uint8ClampedArray([n,0,0,255])});
function request():NativeViewportRequest {
 return{prepare:(generation,sequence)=>({frame:{generation,sequence} as SourceDrawingFrame,retainedBytes:0}),formulas:{layout:'source-surface-centered-v1',primaryLogicalHeight:1,labels:[]},current:()=>true,ready:vi.fn(),failed:vi.fn()};
}
function drawingRequest(){
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));
 const material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:'in vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'out vec4 color;void main(){color=vec4(1.0);}',side:THREE.FrontSide,transparent:true,toneMapped:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,uniforms:{}});
 const prepared=prepareSourceDrawingPlan([new THREE.Mesh(geometry,material)]);if(!prepared.ok)throw Error(prepared.error.reason);
 const plan=prepared.value,r=request();r.prepare=(generation,sequence)=>({planned:{generation,sequence,width:1,height:1,samples:0,clear:[0,0,0,1],plan}});
 return{request:r,plan,dispose(){geometry.dispose();material.dispose();}};
}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
beforeEach(()=>Object.assign(state,{calls:[],draws:[],disposed:0,failDispose:false,prepareError:false,leaseError:false,glyphBytes:0,formulaCalls:0}));
describe('native viewport latest-frame ownership',()=>{
 it('settles a cancelled native call before starting the latest pending request; discarded requests never allocate snapshots',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),a=request(),discarded=request(),b=request();discarded.prepare=vi.fn(discarded.prepare);
  owner.submit(a);await tick();owner.submit(discarded);owner.submit(b);
  expect(state.calls).toHaveLength(1);expect(state.calls[0].signal.aborted).toBe(true);
  state.calls[0].resolve(pixels(1));await tick();expect(state.calls).toHaveLength(2);expect(discarded.prepare).not.toHaveBeenCalled();
  state.calls[1].resolve(pixels(2));await owner.settled();expect(state.draws).toEqual([2]);expect(a.ready).not.toHaveBeenCalled();expect(b.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('rejects an obsolete output even if the transport ignores cancellation',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();let current=true;r.current=()=>current;
  owner.submit(r);await tick();current=false;state.calls[0].resolve(pixels(3));await owner.settled();expect(state.draws).toEqual([]);expect(r.ready).not.toHaveBeenCalled();expect(r.failed).not.toHaveBeenCalled();owner.dispose();
 });
 it('reports real failures without drawing a fallback, then accepts an explicit replacement',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();owner.submit(r);await tick();state.calls[0].reject(Error('native failed'));await owner.settled();expect(r.failed).toHaveBeenCalledOnce();expect(state.draws).toEqual([]);
  const next=request();owner.submit(next);await tick();state.calls[1].resolve(pixels(4));await owner.settled();expect(state.draws).toEqual([4]);owner.dispose();
 });
 it('waits for formulas and refuses a completed pixel frame if glyph preparation fails',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();state.prepareError=true;owner.submit(r);await tick();state.calls[0].resolve(pixels(5));await owner.settled();expect(r.failed).toHaveBeenCalledOnce();expect(state.draws).toEqual([]);owner.dispose();
 });
 it('does not submit geometry after a failed page lease',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();state.leaseError=true;owner.submit(r);await owner.settled();expect(state.calls).toEqual([]);expect(r.failed).toHaveBeenCalledWith(expect.objectContaining({message:'lease failed'}));owner.dispose();
 });
 it('composes an already native recording raster without acquiring another transport slot',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.prepare=()=>({pixels:pixels(6)});owner.submit(r);await owner.settled();expect(state.calls).toEqual([]);expect(state.draws).toEqual([6]);expect(r.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('copies empty local layouts without inventing source formula placement',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.formulas={referenceWidth:100,referenceHeight:100,labels:[]};r.prepare=()=>({pixels:pixels(9)});owner.submit(r);await owner.settled();expect(state.draws).toEqual([9]);expect(r.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('prepares actual glyphs once before bounded native begin and charges old presentation until replacement',async()=>{
  state.glyphBytes=16;const owner=new SourceNativeViewport({width:1,height:1} as HTMLCanvasElement),budgets:number[]=[];
  function planned(){const r=request();r.prepareFormulasFirst=true;r.prepare=(generation,sequence,bytes)=>{budgets.push(bytes);const p=prepareSourceDrawingPlan([]);if(!p.ok)throw Error(p.error.reason);return{planned:{generation,sequence,width:1,height:1,samples:0,clear:[0,0,0,1],plan:p.value}};};return r;}
  owner.submit(planned());await tick();expect(state.formulaCalls).toBe(1);expect(budgets).toEqual([48]);state.calls[0].resolve(pixels(1));await owner.settled();
  owner.submit(planned());await tick();expect(state.formulaCalls).toBe(2);expect(budgets).toEqual([48,104]);state.calls[1].resolve(pixels(2));await owner.settled();expect(state.formulaCalls).toBe(2);owner.dispose();
 });
 it('does not allocate a bounded plan or submit native work when early glyph preparation fails',async()=>{
  const owner=new SourceNativeViewport({width:1,height:1} as HTMLCanvasElement),r=request();r.prepareFormulasFirst=true;r.prepare=vi.fn(r.prepare);state.prepareError=true;owner.submit(r);await owner.settled();expect(r.prepare).not.toHaveBeenCalled();expect(state.calls).toEqual([]);expect(r.failed).toHaveBeenCalledOnce();owner.dispose();
 });
 it('retains an idle cleanup failure until explicit disposal succeeds',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.prepare=()=>({pixels:pixels(7)});owner.submit(r);await owner.settled();
  state.failDispose=true;expect(()=>owner.dispose()).toThrow('cleanup failed');await expect(owner.settled()).rejects.toThrow('cleanup failed');expect(()=>owner.submit(request())).toThrow('已释放');
  owner.dispose();await owner.settled();expect(state.disposed).toBe(1);new SourceNativeViewport({} as HTMLCanvasElement).dispose();
 });
 it('defers unmount cleanup until the actual pending plan chunk is released after ACK',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),first=request();first.prepare=()=>({pixels:pixels(7)});owner.submit(first);await owner.settled();
  const drawing=drawingRequest(),dispose=vi.spyOn(drawing.plan,'dispose');
  try{
   owner.submit(drawing.request);await tick();const call=state.calls[0];expect(call.chunk!.drawing.commands).toHaveLength(1);
   expect(()=>owner.dispose()).not.toThrow();expect(call.signal.aborted).toBe(true);expect(dispose).not.toHaveBeenCalled();expect(state.disposed).toBe(0);expect(call.chunk!.drawing.commands).toHaveLength(1);
   // Another viewport can be constructed while the retired owner is draining.
   new SourceNativeViewport({} as HTMLCanvasElement).dispose();expect(dispose).not.toHaveBeenCalled();
   call.resolve(pixels(8));await owner.settled();expect(dispose).toHaveBeenCalledOnce();expect(state.disposed).toBe(1);expect(()=>call.chunk!.drawing).toThrow('已释放');
   expect(state.draws).toEqual([7]);expect(drawing.request.ready).not.toHaveBeenCalled();expect(drawing.request.failed).not.toHaveBeenCalled();expect(()=>owner.submit(request())).toThrow('已释放');
   owner.dispose();expect(state.disposed).toBe(1);
  }finally{drawing.dispose();}
 });
 it('retains a deferred compositor cleanup failure without an unhandled rejection and permits retry',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),first=request();first.prepare=()=>({pixels:pixels(7)});owner.submit(first);await owner.settled();
  const drawing=drawingRequest();
  try{
   owner.submit(drawing.request);await tick();state.failDispose=true;expect(()=>owner.dispose()).not.toThrow();expect(state.disposed).toBe(0);
   state.calls[0].resolve(pixels(8));await tick();expect(state.disposed).toBe(0);expect(()=>state.calls[0].chunk!.drawing).toThrow('已释放');
   await expect(owner.settled()).rejects.toThrow('cleanup failed');expect(drawing.request.ready).not.toHaveBeenCalled();expect(drawing.request.failed).not.toHaveBeenCalled();expect(state.draws).toEqual([7]);
   owner.dispose();await expect(owner.settled()).resolves.toBeUndefined();expect(state.disposed).toBe(1);owner.dispose();expect(state.disposed).toBe(1);
  }finally{drawing.dispose();}
 });
});
