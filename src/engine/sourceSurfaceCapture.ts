import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {prepareSourcePausedUpscale} from './sourcePausedUpscale';
import {sourcePausedImageBytes} from './sourcePausedImage';
export type SurfaceGeometry=Extract<SceneOutput,{type:'geometry'}>;
export interface SourceSurfaceCapturePreparation {scene:SceneDocument;capture:SurfaceGeometry;preview:SurfaceGeometry;}
export interface SourceSurfacePausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:SurfaceGeometry;}
export function sourceSurfaceCapturePlan(context:GenerationInput,size:{width:number;height:number},scale:1|3|5){
 if(!context.surfaceLive?.clock.paused||context.sourceViewport?.target!=='primary')throw Error('曲面截图需要已暂停的主预览');
 if(scale!==1&&scale!==3&&scale!==5)throw Error('曲面 PNG 放大倍率必须为 1、3 或 5');
 const base=prepareSourcePausedCaptureSize(size,context.sourcePointPixelDensity??1);
 const upscale=scale===1?undefined:prepareSourcePausedUpscale(base.width,base.height,scale);
 // CPU image buffers only. Renderer/GPU allocations are separately admitted
 // against actual GL limits; this is not a process-memory measurement.
 const bytes=sourcePausedImageBytes(base.width,base.height)+base.width*base.height*4+(upscale?.peakBytes??0);
 if(bytes>256*1024*1024)throw Error('曲面截图图像缓冲超过本地 256 MiB 预算');
 const captureContext:GenerationInput={...context,quality:'export',width:base.width,height:base.height,sourcePointPixelDensity:base.density,sourceViewport:{...context.sourceViewport,logicalWidth:base.logicalWidth,logicalHeight:base.logicalHeight,target:'offscreen',referenceLogicalHeight:context.sourceViewport.logicalHeight}};
 return{base,width:upscale?.width??base.width,height:upscale?.height??base.height,bytes,captureContext};
}
