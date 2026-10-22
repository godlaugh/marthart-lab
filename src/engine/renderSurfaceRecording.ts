import type {SceneDocument,SceneOutput} from '../types';
import {ArtRenderer} from './renderer';
import {outputBuffers} from './outputBuffers';
import {formulaPresentation} from './formulas';
import type {sourceRecordingSize} from './sourceRecordingSize';

const retired=new Set<SurfaceRecordingRenderer>();
/** These are exact resources created here. A failed release remains reachable
 * across client invalidation and blocks creation until release can be retried. */
export function retrySurfaceRecordingRendererCleanup():void {
 const errors:unknown[]=[];for(const owner of retired)try{owner.dispose();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'曲面录制绘图资源清理未完成');
}
export function surfaceRecordingRendererCleanupCount():number{return retired.size;}
export class SurfaceRecordingRenderer {
 private canvas?:HTMLCanvasElement;
 private renderer?:ArtRenderer;
 private disposed=false;private graphicsDisposed=false;private contextReleased=false;
 constructor(private readonly scene:SceneDocument,private readonly size:ReturnType<typeof sourceRecordingSize>){
  retrySurfaceRecordingRendererCleanup();
  const canvas=document.createElement('canvas');this.canvas=canvas;
  this.renderer=new ArtRenderer(canvas);
 }
 render(output:Extract<SceneOutput,{type:'geometry'}>,isCancelled:()=>boolean):Extract<SceneOutput,{type:'raster'}>{
  if(this.disposed||!this.renderer)throw Error('曲面录制绘图实例已释放');
  const check=()=>{if(isCancelled())throw new DOMException('曲面录制绘图已取消','AbortError');};check();
  const {width,height,logicalWidth,logicalHeight,density}=this.size,renderer=this.renderer;
  const bytes=outputBuffers(output).reduce((sum,buffer)=>sum+buffer.byteLength,0)+width*height*4+width*4;
  if(bytes>256*1024*1024)throw Error('曲面录制几何与回读缓冲超过本地 256 MiB 预算');
  const gl=renderer.renderer.getContext(),limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(gl.isContextLost())throw Error('曲面录制绘图上下文已丢失');
  if(width>limits[0]||height>limits[1]||Math.max(width,height)>gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))throw Error('曲面录制尺寸超过当前 GPU 限制');
  renderer.setSize(logicalWidth,logicalHeight,density);
  renderer.setOutput(output,{...this.scene,evaluatedSourceCamera:output.sourceCameraFrame},false);renderer.render();check();
  if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw Error('曲面录制实际绘制尺寸不匹配');
  const pixels=new Uint8ClampedArray(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('曲面录制像素回读失败');
  const stride=width*4,row=new Uint8ClampedArray(stride);
  for(let y=0;y<Math.floor(height/2);y++){const a=y*stride,b=(height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}
  check();
  // Video receives raw draw pixels. Paused PNG enhancement/upscale belongs to
  // its separate capture path; formulas are composed by the video consumer.
  return{type:'raster',width,height,pixels,cameraResolved:true,stats:output.stats,sourceCameraFrame:output.sourceCameraFrame,surfaceLive:output.surfaceLive,formulaPresentation:formulaPresentation(this.scene)};
 }
 dispose():void {
  if(this.disposed)return;const errors:unknown[]=[];
  if(!this.graphicsDisposed)try{this.renderer?.dispose();this.graphicsDisposed=true;}catch(error){errors.push(error);}
  if(!this.contextReleased)try{this.renderer?.renderer.forceContextLoss();this.contextReleased=true;}catch(error){errors.push(error);}
  if(errors.length){retired.add(this);throw new AggregateError(errors,'曲面录制绘图资源释放失败，保留以便重试');}
  if(this.canvas)this.canvas.width=this.canvas.height=0;
  this.renderer=undefined;this.canvas=undefined;this.disposed=true;retired.delete(this);
 }
}
