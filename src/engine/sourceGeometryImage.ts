import type {ArtRenderer} from './renderer';
import type {SceneDocument,SceneOutput} from '../types';
import {usesSourceAttractorCpu} from './sourceAttractorDocument';
import {usesSourceImplicitMesh} from './sourceImplicitIdentity';
import {outputBuffers} from './outputBuffers';
import {readSourceDrawingPixels,sourceDrawingPolicy} from './sourceDrawingPixels';
import {ensureSourceNativeLease} from './sourceNativeLease';
import {renderSourceNativeChunks,SourceNativeError} from './sourceNativeClient';
import type {SourceDrawingPlan} from './sourceDrawingSnapshot';
import {encodeFormulaRaster,type FormulaCompositeOptions} from './formulaCanvas';
import {validateFormulaPresentation} from './formulaConfig';
import {MAX_RASTER_PIXELS} from './rasterDimensions';

export const usesSourceGeometryImage=(scene:SceneDocument)=>usesSourceImplicitMesh(scene)||usesSourceAttractorCpu(scene);

let generation=0;
const pendingPlans=new Set<SourceDrawingPlan>();
function releasePlan(plan:SourceDrawingPlan){const released=plan.dispose();if(!released.ok){pendingPlans.add(plan);throw new SourceNativeError('cleanup',released.error.reason);}pendingPlans.delete(plan);}
/** Consume already generated source geometry. The shared drawing owner selects
 * the pixel backend; source formulas and PNG enhancement consume its pixels.
 * JPEG uses the same draw, with ordinary lossy encoding and no PNG enhancement.
 * This boundary does not create a retained capture or replay numerical state. */
export async function encodeSourceGeometryImage(
 renderer:ArtRenderer,scene:SceneDocument,output:SceneOutput,
 options:Omit<FormulaCompositeOptions,'sourceImageProcessing'|'sourcePresentationAlpha'>&
  {signal:AbortSignal;purpose:'static-image'|'video-frame';format?:'image/png'|'image/jpeg'}
):Promise<Blob>{
 const format=options.format??'image/png';
 if(options.purpose!=='static-image'&&options.purpose!=='video-frame')throw Error('未知源几何图像用途');
 if(format!=='image/png'&&format!=='image/jpeg'||options.purpose==='video-frame'&&format!=='image/png')throw Error('源几何视频帧需要 PNG 编码');
 if(!usesSourceGeometryImage(scene)||output.type!=='geometry'||!output.sourceCameraFrame||
    (usesSourceImplicitMesh(scene)?!output.sourceImplicitPresentation:output.backend!=='cpu'||!output.sourcePointAppearance||!!output.sourceGpuPoints))
  throw Error('源几何图像需要对应的 CPU 几何及相机帧');
 const formulas=validateFormulaPresentation(output.formulaPresentation),gl=renderer.renderer.getContext();
 const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
 const retainedBytes=[...new Set(outputBuffers(output))].reduce((sum,b)=>sum+b.byteLength,0)+width*height*4;
 if(!Number.isSafeInteger(width*height)||width<=0||height<=0||width*height>MAX_RASTER_PIXELS||retainedBytes>256*1024*1024)throw Error('源几何与图像超过容量');
 const isCancelled=()=>options.signal.aborted||!!options.isCancelled?.();
 if(isCancelled())throw new DOMException('源几何图像已取消','AbortError');
 if(sourceDrawingPolicy()==='native')await ensureSourceNativeLease(options.signal);
 let pixels:Awaited<ReturnType<typeof readSourceDrawingPixels>>;
 if(usesSourceAttractorCpu(scene)&&sourceDrawingPolicy()==='native'){
  for(const pending of pendingPlans)releasePlan(pending);
  const prepared=renderer.sourceDrawingPlan(++generation,1,{retainedBuffers:outputBuffers(output),additionalBytes:width*height*4,isCancelled});
  if(!prepared.ok)throw new SourceNativeError(prepared.error.kind,prepared.error.reason);
  const {plan,...frame}=prepared.value;
  try{
   if(frame.samples!==0)throw Error('源导出需要无多重采样的离屏帧');
   const native=await renderSourceNativeChunks(frame,plan,{signal:options.signal});
   pixels={pixels:native.pixels,sourcePixelRenderer:{backend:'native',identity:native.rendererIdentity,generation:native.generation,sequence:native.sequence,samples:frame.samples}};
  }finally{releasePlan(plan);}
 }else pixels=await readSourceDrawingPixels(renderer,width,height,retainedBytes,isCancelled,{signal:options.signal,generation:++generation,sequence:1});
 if(usesSourceAttractorCpu(scene))renderer.releaseSourceDrawing();
 return encodeFormulaRaster({type:'raster',width,height,...pixels,formulaPresentation:formulas},format,
  {signal:options.signal,isCancelled:options.isCancelled,...(options.purpose==='video-frame'?{sourcePresentationAlpha:'opaque' as const}:format==='image/png'?{sourceImageProcessing:'paused-png' as const}:{})});
}
