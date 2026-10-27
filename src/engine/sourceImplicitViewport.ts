import {SOURCE_IMPLICIT_PRESENTATION} from './sourceImplicitIdentity';
import {SOURCE_IMPLICIT_GPU_PRESENTATION} from './sourceImplicitGpuPresentation';
import type {SourceImplicitPresentation} from './sourceImplicitPresentation';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {validateRasterRequest,MAX_RASTER_PIXELS} from './rasterDimensions';

/** Source CPU immediate vertices are prepared in physical eye coordinates.
 * The retained GPU material consumes logical PGraphics matrices instead.
 * Keep the existing projection-pass fact when merging sourceViewport; this
 * dimensions owner must not infer perspective/ortho from a material model. */
export function prepareSourceImplicitOffscreenTarget(
 model:SourceImplicitPresentation['model'],size:{width:number;height:number},
 pixelDensity:number,referenceLogicalHeight:number,
){
 if(!Number.isFinite(pixelDensity)||pixelDensity<=0||!Number.isFinite(referenceLogicalHeight)||referenceLogicalHeight<=0)throw Error('源隐式离屏显示缺少有效的主预览尺寸与像素密度');
 validateRasterRequest({...size,quality:'export',time:0});
 if(model!==SOURCE_IMPLICIT_PRESENTATION&&model!==SOURCE_IMPLICIT_GPU_PRESENTATION)throw Error('未知源隐式离屏显示模型');
 const base=model===SOURCE_IMPLICIT_GPU_PRESENTATION?prepareSourcePausedCaptureSize(size,pixelDensity,MAX_RASTER_PIXELS):{...size,logicalWidth:size.width,logicalHeight:size.height,density:1};
 return{
  width:base.width,height:base.height,
  sourceViewport:{logicalWidth:base.logicalWidth,logicalHeight:base.logicalHeight,referenceLogicalHeight,target:'offscreen' as const},
  drawing:{width:base.logicalWidth,height:base.logicalHeight,pixelRatio:base.density},
 };
}
