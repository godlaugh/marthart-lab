import {usesSourceBouncing} from './sourceBouncingDocument';
import type {FormulaPresentation,SceneDocument,SceneOutput} from '../types';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {usesSourceAttractor,usesSourceAttractorCpu} from './sourceAttractorDocument';
import {sourceDrawingPolicy} from './sourceDrawingPixels';
import type {SourceDrawingFrame} from './sourceDrawingFrame';
import {renderSourceNativeFrame,renderSourceNativeChunks,SourceNativeError} from './sourceNativeClient';
import type {SourceDrawingPlannedFrame} from './renderer';
import type {SourceDrawingPlan} from './sourceDrawingSnapshot';
import {ensureSourceNativeLease} from './sourceNativeLease';
import {prepareSourceFormulas,SourceFormulaCompositor} from './sourceFormulaCompositor';
import {compositeFormulas} from './formulaCanvas';

type Pixels={width:number;height:number;pixels:Uint8ClampedArray};
export function usesNativeSourceViewport(scene:SceneDocument,output?:SceneOutput|null):boolean {
 return sourceDrawingPolicy()==='native'&&((usesSourceBouncing(scene)&&!!output?.sourceBouncingFrame)||nativeSourceFramePreviewEnabled(scene)&&!!output?.sourceCameraFrame&&(nativeAttractorRasterPreviewEnabled(scene)?output.type==='raster':output.type!=='raster'));
}
export const nativeAttractorRasterPreviewEnabled=(scene:SceneDocument)=>sourceDrawingPolicy()==='native'&&usesSourceAttractor(scene)&&!usesSourceAttractorCpu(scene);
export const nativeSourceFramePreviewEnabled=(scene:SceneDocument)=>sourceDrawingPolicy()==='native'&&(usesSourceSurfaceGeometry(scene)||usesSourceImplicitCpuMesh(scene)||usesSourceAttractor(scene));
export interface NativeViewportRequest {
 /** Called only when the previous native operation has settled. The caller
  * owns the immutable output and snapshots the matching renderer here. */
 prepare:(generation:number,sequence:number,retainedPresentationBytes:number)=>{frame:SourceDrawingFrame;retainedBytes:number}|{planned:SourceDrawingPlannedFrame}|{pixels:Pixels};
 formulas:FormulaPresentation;
 /** Bounded geometry admits the actual prepared glyphs before native begin. */
 prepareFormulasFirst?:boolean;
 current:()=>boolean;
 ready:()=>void;
 failed:(error:unknown)=>void;
}
let generation=0;
const retired=new Set<SourceNativeViewport>();
/** One active operation plus one replaceable pending request. Never queue a
 * snapshot per RAF, publish stale pixels, or release the shared native slot
 * before the cancelled operation has actually settled. */
export class SourceNativeViewport {
 private readonly generation=++generation;
 private sequence=0;
 private pending?:NativeViewportRequest;
 private active?:AbortController;
 private running?:Promise<void>;
 private compositor?:SourceFormulaCompositor;
 private closed=false;
 private glyphBytes=0;
 private plans=new Set<SourceDrawingPlan>();
 private cleanupFailure?:{error:unknown};
 constructor(readonly canvas:HTMLCanvasElement){for(const owner of retired)owner.dispose();}
 submit(request:NativeViewportRequest):void {
  if(this.closed)throw Error('原生预览已释放');
  this.pending=request;this.active?.abort();this.start();
 }
 cancel():void {this.pending=undefined;this.active?.abort();}
 async settled():Promise<void>{while(this.running)await this.running;if(this.cleanupFailure)throw this.cleanupFailure.error;}
 private start():void {
  if(this.running||!this.pending||this.closed)return;
  this.running=this.drain().finally(()=>{
   this.running=undefined;
   if(this.closed){
    // React cleanup cannot await an in-flight ACK. Keep this owner in retired
    // until the request releases its chunk, then finish cleanup without an
    // unhandled rejection. settled()/dispose() expose or retry real failures.
    try{this.finishDispose();}catch{/* finishDispose retains the owner and error. */}
   }else this.start();
  });
 }
 private async drain():Promise<void>{
  while(this.pending&&!this.closed){
   const request=this.pending;this.pending=undefined;
   const controller=new AbortController();this.active=controller;
   const current=()=>!this.closed&&!controller.signal.aborted&&request.current();
   try{
    if(!current())continue;
    // Glyph preparation finishes before native begin. Its temporary network
    // buffers do not coexist with the native target; the actual delivered
    // glyphs and old composition do remain until publication.
    const earlyFormulas=request.prepareFormulasFirst&&request.formulas.layout==='source-surface-centered-v1'?await prepareSourceFormulas(request.formulas,controller.signal):undefined;
    if(!current())continue;
    const retainedPresentationBytes=this.compositor?this.canvas.width*this.canvas.height*8+this.glyphBytes*3:0;
    const input=request.prepare(this.generation,++this.sequence,retainedPresentationBytes+(earlyFormulas?.glyphs.reduce((sum,glyph)=>sum+glyph.pixels.byteLength*3,0)??0));
    if('planned' in input)this.plans.add(input.planned.plan);
    if(!('pixels' in input))await ensureSourceNativeLease(controller.signal);
    if(!current()){this.releasePlans();continue;}
    // Keep one bounded operation at a time. A cancelled geometry request
    // settles before the next request can borrow the browser's native slot.
    const pixels='pixels' in input?input.pixels:'planned' in input?await renderSourceNativeChunks(input.planned,input.planned.plan,{signal:controller.signal}):await renderSourceNativeFrame(input.frame,{signal:controller.signal,retainedBytes:input.retainedBytes});
    this.releasePlans();
    if(!current())continue;
    const formulas=earlyFormulas??(request.formulas.layout==='source-surface-centered-v1'?await prepareSourceFormulas(request.formulas,controller.signal):undefined);
    let base=pixels.pixels;
    if(!formulas&&request.formulas.labels.length){
     // Saved local layouts retain their existing MathJax/Canvas2D semantics.
     // Stage them privately so no partially composed frame can be published.
     const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;
     let composed:HTMLCanvasElement|undefined;
     try{
      const context=canvas.getContext('2d');if(!context)throw Error('无法创建公式合成画布');
      context.putImageData(new ImageData(new Uint8ClampedArray(base),pixels.width,pixels.height),0,0);
      composed=await compositeFormulas(canvas,request.formulas,{signal:controller.signal});
      const result=composed.getContext('2d');if(!result)throw Error('无法读取公式合成画布');
      base=result.getImageData(0,0,pixels.width,pixels.height).data;
     }finally{canvas.width=canvas.height=0;if(composed&&composed!==canvas)composed.width=composed.height=0;}
    }
    if(!current())continue;
    this.compositor??=new SourceFormulaCompositor(this.canvas);
    if(formulas)this.compositor.draw(formulas,pixels.width,pixels.height,pixels.pixels);
    else this.compositor.drawPixels(pixels.width,pixels.height,base);
    this.glyphBytes=formulas?.glyphs.reduce((sum,glyph)=>sum+glyph.pixels.byteLength,0)??0;
    if(current())request.ready();
   }catch(error){if(current())request.failed(error);}
   finally{try{this.releasePlans();}catch(error){if(current())request.failed(error);}controller.abort();if(this.active===controller)this.active=undefined;}
  }
 }
 private releasePlans(){for(const plan of this.plans){const released=plan.dispose();if(!released.ok)throw new SourceNativeError('cleanup',released.error.reason);this.plans.delete(plan);}}
 private finishDispose():void {
  try{this.releasePlans();this.compositor?.dispose();this.compositor=undefined;this.glyphBytes=0;this.cleanupFailure=undefined;retired.delete(this);}
  catch(error){this.cleanupFailure={error};retired.add(this);throw error;}
 }
 dispose():void {
  this.closed=true;this.cancel();retired.add(this);
  // A pending chunk is owned work, not a cleanup failure. Its transport must
  // settle before plan/compositor teardown; never release it from unmount.
  if(!this.running)this.finishDispose();
 }
}
