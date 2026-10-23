import type {FormulaPresentation,SceneDocument,SceneOutput} from '../types';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {sourceDrawingPolicy} from './sourceDrawingPixels';
import type {SourceDrawingFrame} from './sourceDrawingFrame';
import {renderSourceNativeFrame} from './sourceNativeClient';
import {prepareSourceFormulas,SourceFormulaCompositor} from './sourceFormulaCompositor';
import {compositeFormulas} from './formulaCanvas';

type Pixels={width:number;height:number;pixels:Uint8ClampedArray};
export function usesNativeGeometryViewport(scene:SceneDocument,output?:SceneOutput|null):boolean {
 return nativeGeometryPreviewEnabled(scene)&&!!output?.sourceCameraFrame;
}
export const nativeGeometryPreviewEnabled=(scene:SceneDocument)=>sourceDrawingPolicy()==='native'&&(usesSourceSurfaceGeometry(scene)||usesSourceImplicitCpuMesh(scene));
export interface NativeViewportRequest {
 /** Called only when the previous native operation has settled. The caller
  * owns the immutable output and snapshots the matching renderer here. */
 prepare:(generation:number,sequence:number)=>{frame:SourceDrawingFrame;retainedBytes:number}|{pixels:Pixels};
 formulas:FormulaPresentation;
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
 constructor(readonly canvas:HTMLCanvasElement){for(const owner of retired)owner.dispose();}
 submit(request:NativeViewportRequest):void {
  if(this.closed)throw Error('原生预览已释放');
  this.pending=request;this.active?.abort();this.start();
 }
 cancel():void {this.pending=undefined;this.active?.abort();}
 async settled():Promise<void>{while(this.running)await this.running;}
 private start():void {
  if(this.running||!this.pending||this.closed)return;
  this.running=this.drain().finally(()=>{this.running=undefined;this.start();});
 }
 private async drain():Promise<void>{
  while(this.pending&&!this.closed){
   const request=this.pending;this.pending=undefined;
   const controller=new AbortController();this.active=controller;
   const current=()=>!this.closed&&!controller.signal.aborted&&request.current();
   try{
    if(!current())continue;
    const input=request.prepare(this.generation,++this.sequence);
    // Keep one bounded operation at a time. A cancelled geometry request
    // settles before the next request can borrow the browser's native slot.
    const pixels='pixels' in input?input.pixels:await renderSourceNativeFrame(input.frame,{signal:controller.signal,retainedBytes:input.retainedBytes});
    if(!current())continue;
    const formulas=request.formulas.layout==='source-surface-centered-v1'?await prepareSourceFormulas(request.formulas,controller.signal):undefined;
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
    if(current())request.ready();
   }catch(error){if(current())request.failed(error);}
   finally{controller.abort();if(this.active===controller)this.active=undefined;}
  }
 }
 dispose():void {
  this.closed=true;this.cancel();
  try{this.compositor?.dispose();this.compositor=undefined;retired.delete(this);}
  catch(error){retired.add(this);throw error;}
 }
}
