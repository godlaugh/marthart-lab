import {formulaPresentation} from './formulas';
import type {GenerateContext,SceneDocument} from '../types';
import {prepareSourceBouncingScene,sourceBouncingCameraInput,sourceBouncingInitializationKey} from './sourceBouncingDocument';
import {parseSourceBouncingView,sourceBouncingViewInput} from './sourceBouncingNavigation';
import {parseSourceBouncingCheckpoint,sourceBouncingSeedCheckpoint} from './sourceBouncingReplay';
import {prepareSourceCamera} from './sourceCamera';
import {sourceBouncingGpuDisplayLayout} from './sourceBouncingDrawing';
import {SourceBouncingGpuError,requireSourceBouncing} from './sourceBouncingLimits';
/** One owner interprets document, absolute checkpoint, runtime camera and DPI
 * for both browser GPU and native rendering. No seed allocation or GL work. */
export function prepareSourceBouncingFrame(scene:SceneDocument,context:GenerateContext){
 if([context.fractalRecording,context.rootsLive,context.perlinLive,context.implicitLive,context.surfaceLive,context.domainLive,context.fractalLive,context.mapLive,context.symmetryLive,context.samilaLive,context.spirographFrame].some(value=>value!==undefined))throw new SourceBouncingGpuError('input','源弹跳只能使用自身的显式更新检查点，不能混用其它场景时钟');
 const payload=requireSourceBouncing(prepareSourceBouncingScene(scene));
 const checkpoint=context.sourceBouncingFrame===undefined?sourceBouncingSeedCheckpoint():requireSourceBouncing(parseSourceBouncingCheckpoint(context.sourceBouncingFrame));
 if(context.time!==checkpoint.sceneTime)throw new SourceBouncingGpuError('input','源弹跳需要与场景时间配对的显式更新检查点；不能由秒数推算粒子状态');
 const viewport=context.sourceViewport;
 if(!viewport||viewport.projectionPass!=='perspective')throw new SourceBouncingGpuError('input','源弹跳需要明确的逻辑画布尺寸与透视投影');
 const view=context.sourceBouncingView===undefined?undefined:requireSourceBouncing(parseSourceBouncingView(context.sourceBouncingView));
 const camera=prepareSourceCamera(view?sourceBouncingViewInput(view):sourceBouncingCameraInput(payload),viewport);
 if(!camera.ok)throw camera.error;if(camera.value.kind!=='known')throw new SourceBouncingGpuError('input','源弹跳相机投影未知');
 sourceBouncingGpuDisplayLayout(context.width,context.height);
 const pixelDensity=context.sourcePointPixelDensity;
 if(typeof pixelDensity!=='number'||!Number.isSafeInteger(pixelDensity)||pixelDensity<1)throw new SourceBouncingGpuError('input','源弹跳需要已测量的正整数像素密度');
 if(context.width!==viewport.logicalWidth*pixelDensity||context.height!==viewport.logicalHeight*pixelDensity)throw new SourceBouncingGpuError('input','源弹跳物理尺寸必须等于逻辑尺寸乘以已测量的像素密度');
 return{payload,checkpoint,viewport,pixelDensity,formulas:formulaPresentation(scene,viewport),camera:camera.value.plan,key:sourceBouncingInitializationKey(payload.configuration)};
}
