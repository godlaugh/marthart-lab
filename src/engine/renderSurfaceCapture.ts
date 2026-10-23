import type {GenerationInput} from '../types';
import {sourceSurfaceCapturePlan,type SourceSurfaceCapturePreparation,type SourceSurfacePausedCaptureResult} from './sourceSurfaceCapture';
import {outputBuffers} from './outputBuffers';
import {validateFormulaPresentation} from './formulaConfig';
import {readSourceDrawingPixels,sourceDrawingBackend,type SourceDrawingRequest} from './sourceDrawingPixels';
import {SourceDrawingResources} from './sourceDrawingResources';
/** Main-thread offscreen canvas: the same geometry renderer as the viewport,
 * with its own GL resources. Never reconstruct or update the source scene. */
export async function renderSurfaceCapture(prepared:SourceSurfaceCapturePreparation,context:GenerationInput,size:{width:number;height:number},scale:1|3|5,isCancelled:()=>boolean,request?:SourceDrawingRequest):Promise<SourceSurfacePausedCaptureResult> {
 sourceDrawingBackend(request);
 const plan=sourceSurfaceCapturePlan(context,size,scale),check=()=>{if(isCancelled()||request?.signal.aborted)throw new DOMException('曲面截图已取消','AbortError');};
 const geometryBytes=[...new Set([...outputBuffers(prepared.capture),...outputBuffers(prepared.preview)])].reduce((sum,b)=>sum+b.byteLength,0);
 if(geometryBytes+plan.bytes>256*1024*1024)throw Error('曲面截图几何与图像缓冲超过本地 256 MiB 预算');
 check();const resources=new SourceDrawingResources(),renderer=resources.renderer;let failure:unknown;
 try{
  const gl=renderer.renderer.getContext(),limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(plan.base.width>limits[0]||plan.base.height>limits[1]||Math.max(plan.base.width,plan.base.height)>gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))throw Error('曲面截图尺寸超过当前 GPU 限制');
  renderer.setSize(plan.base.logicalWidth,plan.base.logicalHeight,plan.base.density);
  // setOutput already draws its completed geometry; sourceDrawingFrame owns
  // its own fresh render-list pass. Do not insert another draw between them.
  renderer.setOutput(prepared.capture,{...prepared.scene,evaluatedSourceCamera:prepared.capture.sourceCameraFrame},false);check();
  const {width,height}=plan.base;
  const {pixels,sourcePixelRenderer}=await readSourceDrawingPixels(renderer,width,height,geometryBytes+plan.bytes,isCancelled,request);
  check();
  // Scene overlays belong to the base draw. The shared encoder composites
  // formulas before whole-image enhancement and optional image enlargement.
  return{preview:prepared.preview,capture:{type:'raster',width,height,pixels,sourcePixelRenderer,stats:prepared.capture.stats,formulaPresentation:validateFormulaPresentation(prepared.capture.formulaPresentation),sourceCameraFrame:prepared.capture.sourceCameraFrame,sourceCurrentImage:{model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[size.width,size.height],logicalSize:[plan.base.logicalWidth,plan.base.logicalHeight],pixelDensity:plan.base.density,baseSize:[width,height],scale}}};
 }catch(error){failure=error;throw error;}
 finally{try{resources.dispose();}catch(cleanup){if(failure)throw new AggregateError([failure,cleanup],'曲面截图失败且绘图资源仍待清理');throw cleanup;}}
}
