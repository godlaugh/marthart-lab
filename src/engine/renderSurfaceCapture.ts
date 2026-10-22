import type {GenerationInput} from '../types';
import {sourceSurfaceCapturePlan,type SourceSurfaceCapturePreparation,type SourceSurfacePausedCaptureResult} from './sourceSurfaceCapture';
import {outputBuffers} from './outputBuffers';
import {validateFormulaPresentation} from './formulaConfig';
/** Main-thread offscreen canvas: the same geometry renderer as the viewport,
 * with its own GL resources. Never reconstruct or update the source scene. */
export async function renderSurfaceCapture(prepared:SourceSurfaceCapturePreparation,context:GenerationInput,size:{width:number;height:number},scale:1|3|5,isCancelled:()=>boolean):Promise<SourceSurfacePausedCaptureResult> {
 const plan=sourceSurfaceCapturePlan(context,size,scale),check=()=>{if(isCancelled())throw new DOMException('曲面截图已取消','AbortError');};
 const geometryBytes=[...new Set([...outputBuffers(prepared.capture),...outputBuffers(prepared.preview)])].reduce((sum,b)=>sum+b.byteLength,0);
 if(geometryBytes+plan.bytes>256*1024*1024)throw Error('曲面截图几何与图像缓冲超过本地 256 MiB 预算');
 check();const {ArtRenderer}=await import('./renderer');check();
 const canvas=document.createElement('canvas'),renderer=new ArtRenderer(canvas,'source-surface-export');
 try{
  const gl=renderer.renderer.getContext(),limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(plan.base.width>limits[0]||plan.base.height>limits[1]||Math.max(plan.base.width,plan.base.height)>gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))throw Error('曲面截图尺寸超过当前 GPU 限制');
  renderer.setSize(plan.base.logicalWidth,plan.base.logicalHeight,plan.base.density);
  renderer.setOutput(prepared.capture,{...prepared.scene,evaluatedSourceCamera:prepared.capture.sourceCameraFrame},false);renderer.render();check();
  const {width,height}=plan.base;
  if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw Error('曲面截图实际绘制尺寸不匹配');
  let pixels:Uint8ClampedArray=new Uint8ClampedArray(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('曲面截图像素回读失败');
  const stride=width*4,row=new Uint8ClampedArray(stride);
  for(let y=0;y<Math.floor(height/2);y++){const a=y*stride,b=(height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}
  check();
  // Scene overlays belong to the base draw. The shared encoder composites
  // formulas before whole-image enhancement and optional image enlargement.
  return{preview:prepared.preview,capture:{type:'raster',width,height,pixels,stats:prepared.capture.stats,formulaPresentation:validateFormulaPresentation(prepared.capture.formulaPresentation),sourceCameraFrame:prepared.capture.sourceCameraFrame,sourceCurrentImage:{model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[size.width,size.height],logicalSize:[plan.base.logicalWidth,plan.base.logicalHeight],pixelDensity:plan.base.density,baseSize:[width,height],scale}}};
 }finally{renderer.dispose();renderer.renderer.forceContextLoss();canvas.width=canvas.height=0;}
}
