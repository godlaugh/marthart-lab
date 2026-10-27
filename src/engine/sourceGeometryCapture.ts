import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {prepareSourcePausedUpscale} from './sourcePausedUpscale';
import {sourcePausedImageBytes} from './sourcePausedImage';
import {prepareSourceImplicitOffscreenTarget} from './sourceImplicitViewport';
import type {SourceImplicitPresentation} from './sourceImplicitPresentation';
import {sourceImplicitPrimarySize} from './sourceImplicitDisplay';
import {SOURCE_IMPLICIT_GPU_PRESENTATION} from './sourceImplicitGpuPresentation';
export type CaptureGeometry=Extract<SceneOutput,{type:'geometry'}>;
export interface SourceGeometryCapturePreparation {scene:SceneDocument;capture:CaptureGeometry;preview:CaptureGeometry;}
export interface SourceGeometryPausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:CaptureGeometry;}
export function sourceGeometryCapturePlan(context:GenerationInput,size:{width:number;height:number},scale:1|3|5,implicitModel?:SourceImplicitPresentation['model']){
 const implicit=!!context.implicitLive;
 if(!(implicit?context.implicitLive:context.surfaceLive)?.clock.paused||context.sourceViewport?.target!=='primary')throw Error('几何场景截图需要已暂停的主预览');
 if(scale!==1&&scale!==3&&scale!==5)throw Error('几何场景 PNG 放大倍率必须为 1、3 或 5');
 const base=prepareSourcePausedCaptureSize(size,context.sourcePointPixelDensity??1);
 const upscale=scale===1?undefined:prepareSourcePausedUpscale(base.width,base.height,scale);
 // CPU image buffers only. Renderer/GPU allocations are separately admitted
 // against actual GL limits; this is not a process-memory measurement.
 const bytes=sourcePausedImageBytes(base.width,base.height)+base.width*base.height*4+(upscale?.peakBytes??0);
 if(bytes>256*1024*1024)throw Error('几何场景截图图像缓冲超过本地 256 MiB 预算');
 if(implicit&&!implicitModel)throw Error('隐式截图缺少已完成的显示模型');
 const target=implicit?prepareSourceImplicitOffscreenTarget(implicitModel!,base,base.density,context.sourceViewport.logicalHeight):undefined;
 const captureContext:GenerationInput={...context,...(implicitModel===SOURCE_IMPLICIT_GPU_PRESENTATION?{sourceImplicitPrimarySize:sourceImplicitPrimarySize(context)}:{}),quality:'export',width:base.width,height:base.height,sourcePointPixelDensity:base.density,sourceViewport:{...context.sourceViewport,logicalWidth:base.logicalWidth,logicalHeight:base.logicalHeight,target:'offscreen',referenceLogicalHeight:context.sourceViewport.logicalHeight,...target?.sourceViewport}};
 const drawing=target?.drawing??{width:base.logicalWidth,height:base.logicalHeight,pixelRatio:base.density};
 return{base,drawing,width:upscale?.width??base.width,height:upscale?.height??base.height,bytes,captureContext};
}
