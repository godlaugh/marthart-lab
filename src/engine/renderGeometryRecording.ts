import {prepareSourceImplicitOffscreenTarget} from './sourceImplicitViewport';
import type {SceneDocument,SceneOutput} from '../types';
import {SourceDrawingResources} from './sourceDrawingResources';
import {readSourceDrawingPixels,sourceDrawingBackend,type SourceDrawingRequest} from './sourceDrawingPixels';
import {outputBuffers} from './outputBuffers';
import {validateFormulaPresentation} from './formulaConfig';
import type {sourceRecordingSize} from './sourceRecordingSize';

export class GeometryRecordingRenderer {
 private readonly resources:SourceDrawingResources;
 private active?:AbortController;
 constructor(private readonly scene:SceneDocument,private readonly size:ReturnType<typeof sourceRecordingSize>){
  this.resources=new SourceDrawingResources();
 }
 async render(output:Extract<SceneOutput,{type:'geometry'}>,isCancelled:()=>boolean,request?:SourceDrawingRequest):Promise<Extract<SceneOutput,{type:'raster'}>>{
  sourceDrawingBackend(request);
  if(this.active)throw Error('曲面录制前一帧尚未完成');
  const controller=new AbortController(),abort=()=>controller.abort();this.active=controller;request?.signal.addEventListener('abort',abort,{once:true});
  try{
  const renderer=this.resources.renderer;
  const check=()=>{if(isCancelled()||controller.signal.aborted||request?.signal.aborted)throw new DOMException('曲面录制绘图已取消','AbortError');};check();
  const {width,height,logicalWidth,logicalHeight,density}=this.size;
  const bytes=outputBuffers(output).reduce((sum,buffer)=>sum+buffer.byteLength,0)+width*height*4+width*4;
  if(bytes>256*1024*1024)throw Error('曲面录制几何与回读缓冲超过本地 256 MiB 预算');
  const gl=renderer.renderer.getContext(),limits=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(gl.isContextLost())throw Error('曲面录制绘图上下文已丢失');
  if(width>limits[0]||height>limits[1]||Math.max(width,height)>gl.getParameter(gl.MAX_RENDERBUFFER_SIZE))throw Error('曲面录制尺寸超过当前 GPU 限制');
  const target=output.sourceImplicitPresentation?prepareSourceImplicitOffscreenTarget(output.sourceImplicitPresentation.model,this.size,density,output.sourceCameraFrame!.viewport.referenceLogicalHeight):undefined;
  if(target)renderer.setSize(target.drawing.width,target.drawing.height,target.drawing.pixelRatio);else renderer.setSize(logicalWidth,logicalHeight,density);
  renderer.setOutput(output,{...this.scene,evaluatedSourceCamera:output.sourceCameraFrame},false);check();
  const {pixels,sourcePixelRenderer}=await readSourceDrawingPixels(renderer,width,height,bytes,isCancelled,request?{...request,signal:controller.signal}:undefined);
  check();
  // Video receives raw draw pixels. Paused PNG enhancement/upscale belongs to
  // its separate capture path; formulas and their final transition are
  // composed by the video consumer from these delivered frame facts.
  return{type:'raster',width,height,pixels,sourcePixelRenderer,cameraResolved:true,stats:output.stats,sourceCameraFrame:output.sourceCameraFrame,surfaceLive:output.surfaceLive,implicitRecording:output.implicitRecording,implicitControls:output.implicitControls,sourceImplicitParameters:output.sourceImplicitParameters,formulaPresentation:validateFormulaPresentation(output.formulaPresentation)};
  }finally{request?.signal.removeEventListener('abort',abort);if(this.active===controller)this.active=undefined;}
 }
 dispose():void {this.active?.abort();this.resources.dispose();}
}
