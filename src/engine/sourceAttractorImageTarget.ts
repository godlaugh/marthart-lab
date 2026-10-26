import type {SceneDocument,SceneOutput} from '../types';
import {usesSourceAttractor,usesSourceAttractorCpu} from './sourceAttractorDocument';
import {ordinarySourceViewport} from './ordinarySourceCamera';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {SOURCE_CAMERA_MODEL} from './sourceCamera';

/** Display density is an explicit request fact. Preview sampling resolution
 * may change with quality, so a raster/logical-size ratio is not this value. */
export function sourceAttractorPixelDensity(value:number|undefined):number|undefined {
 if(value!==undefined&&(!Number.isFinite(value)||value<=0))throw Error('源吸引子参考像素密度须为大于 0 的有限数值');
 return value;
}
export function validSourceAttractorRasterDensity(output:SceneOutput,requested:number|undefined):boolean {
 try{return output.type==='raster'&&sourceAttractorPixelDensity(output.sourceAttractorPixelDensity)===sourceAttractorPixelDensity(requested);}catch{return false;}
}
/** Only a completed primary frame can grant the export target's density.
 * The caller also binds the output to the currently presented scene identity. */
export function sourceAttractorPreviewPixelDensity(scene:SceneDocument,output:SceneOutput|null|undefined):number|undefined {
 if(!usesSourceAttractor(scene)||!output)return;
 const frame=output.sourceCameraFrame,v=frame?.viewport;
 if(frame?.model!==SOURCE_CAMERA_MODEL||v?.target!=='primary'||v.referenceLogicalHeight!==v.logicalHeight||![v.logicalWidth,v.logicalHeight].every(n=>Number.isFinite(n)&&n>0))return;
 const value=usesSourceAttractorCpu(scene)?output.type==='geometry'?output.sourcePointAppearance?.referencePixelDensity:undefined:output.type==='raster'?output.sourceAttractorPixelDensity:undefined;
 try{return sourceAttractorPixelDensity(value);}catch{return;}
}
/** MathArt.ensureRenderBuffer(1): physical request → rounded logical target,
 * then inherited primary density. CPU geometry and GPU density use the same
 * camera target. Fixed-time replay video does not acquire recording scale 3. */
export function sourceAttractorImageTarget(scene:SceneDocument,size:{width:number;height:number},pixelDensity:number,referenceLogicalHeight:number){
 if(!usesSourceAttractor(scene))throw Error('源吸引子图像需要明确的源场景');
 if(!Number.isFinite(referenceLogicalHeight)||referenceLogicalHeight<=0)throw Error('源吸引子图像缺少已呈现预览的逻辑高度');
 const target=prepareSourcePausedCaptureSize(size,pixelDensity);
 return{...target,sourceViewport:ordinarySourceViewport(scene,target.logicalWidth,target.logicalHeight,'offscreen',referenceLogicalHeight)};
}
