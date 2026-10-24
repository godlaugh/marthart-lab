import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {sourceRecordingSize} from './sourceRecordingSize';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import type {SourceBouncingPresentationFrame} from '../scenes/sourceBouncing';
import {prepareSourceBouncingScene,sourceBouncingCameraInput} from './sourceBouncingDocument';
import {parseSourceBouncingCheckpoint,sourceBouncingSeedCheckpoint,planSourceBouncingRecording,type SourceBouncingCheckpoint} from './sourceBouncingReplay';
import {prepareSourceCamera,type SourceCameraViewport} from './sourceCamera';
import {sourceBouncingViewFromCamera,sourceBouncingViewMatches,sourceBouncingViewInput,type SourceBouncingView} from './sourceBouncingNavigation';
import type {SourceBouncingResult} from './sourceBouncingConfig';

export interface SourceBouncingPresentedExport {ready:boolean;frame:SourceBouncingPresentationFrame;}
export interface SourceBouncingExportPlan {
 readonly requestedSize:{readonly width:number;readonly height:number};
 readonly width:number;readonly height:number;readonly pixelDensity:number;
 readonly viewport:SourceCameraViewport;readonly view:SourceBouncingView;
 readonly warmup?:SourceBouncingCheckpoint;
 readonly recording?:{readonly simulationFps:number;readonly encodingFps:number};
 readonly frames:readonly SourceBouncingCheckpoint[];
}
/** Export consumes a delivered frame and its authored scene, never UI seconds.
 * A fresh export worker reconstructs the absolute update index from the seed;
 * viewport changes only alter projection and boundary tessellation. */
export function prepareSourceBouncingExport(scene:SceneDocument,presented:SourceBouncingPresentedExport|undefined,options:{kind:'image'|'video';start:'current'|'seed';width:number;height:number;fps:number;simulationFps?:number}):SourceBouncingResult<SourceBouncingExportPlan>{
 const parsed=prepareSourceBouncingScene(scene);if(!parsed.ok)return parsed;
 if(!presented?.ready)return{ok:false,error:{kind:'input',path:['frame'],reason:'请等待源弹跳当前预览完成并暂停后再导出'}};
 const checkpoint=parseSourceBouncingCheckpoint(presented.frame.checkpoint);if(!checkpoint.ok)return checkpoint;
 if(!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||options.width<16||options.height<16)return{ok:false,error:{kind:'input',path:['size'],reason:'源弹跳导出尺寸必须为至少 16 的整数'}};
 const pixelDensity=presented.frame.pixelDensity;
 if(!Number.isSafeInteger(pixelDensity)||pixelDensity<1)return{ok:false,error:{kind:'input',path:['frame','pixelDensity'],reason:'源弹跳导出缺少已呈现帧的实测正整数像素密度，请重新生成预览'}};
 let size:ReturnType<typeof prepareSourcePausedCaptureSize>;
 try{size=options.kind==='video'?sourceRecordingSize(options,pixelDensity,MAX_RASTER_PIXELS):prepareSourcePausedCaptureSize(options,pixelDensity,MAX_RASTER_PIXELS);}catch(error){return{ok:false,error:{kind:'capacity',path:['size'],reason:error instanceof Error?error.message:String(error)}};}
 const target={requestedSize:{width:options.width,height:options.height},width:size.width,height:size.height,pixelDensity};
 const viewport:SourceCameraViewport={logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,referenceLogicalHeight:presented.frame.viewport.referenceLogicalHeight,target:'offscreen',projectionPass:'perspective'};
 // PNG and the local current-state recording extension retain the delivered
 // view. Native toolbar recording rebuilds its loaded JSON scene and zoom=1;
 // this local seed option applies that rebuild to the current author document.
 const delivered=sourceBouncingViewFromCamera(presented.frame.camera);
 if(!delivered.ok)return{ok:false,error:{...delivered.error,path:['camera',...delivered.error.path]}};
 const selected=options.kind==='video'&&options.start==='seed'?sourceBouncingViewFromCamera(sourceBouncingCameraInput(parsed.value).frame):delivered;
 if(!selected.ok)return selected;
 const view=selected.value,camera=prepareSourceCamera(sourceBouncingViewInput(view),viewport);
 if(!camera.ok||camera.value.kind!=='known')return{ok:false,error:{kind:'input',path:['camera'],reason:'源弹跳导出相机或参考画布无效'}};
 if(options.kind==='image')return{ok:true,value:{...target,viewport,view,frames:[checkpoint.value]}};
 if(!Number.isSafeInteger(options.fps)||options.fps<1||options.fps>120)return{ok:false,error:{kind:'input',path:['fps'],reason:'源弹跳导出帧率必须为 1–120 的整数'}};
 const simulationFps=options.simulationFps===undefined?options.fps:options.simulationFps;
 if(!Number.isSafeInteger(simulationFps)||simulationFps<1||simulationFps>120)return{ok:false,error:{kind:'input',path:['simulationFps'],reason:'源弹跳模拟帧率必须为 1–120 的整数'}};
 const recording=planSourceBouncingRecording({from:options.start==='seed'?sourceBouncingSeedCheckpoint():checkpoint.value,fps:simulationFps,recordDuration:parsed.value.recordDuration});
 if(!recording.ok)return recording;
 if(recording.value.frames.length===0)return{ok:false,error:{kind:'input',path:['recordDuration'],reason:'源弹跳录制在预热帧内已结束，没有可编码帧；请延长源录制时长或提高模拟帧率'}};
 return{ok:true,value:{...target,viewport,view,recording:{simulationFps,encodingFps:options.fps},warmup:recording.value.warmup,frames:recording.value.frames}};
}
export function sourceBouncingExportContext(plan:SourceBouncingExportPlan,checkpoint:SourceBouncingCheckpoint):GenerationInput{
 return{sourcePointPixelDensity:plan.pixelDensity,time:checkpoint.sceneTime,sourceBouncingFrame:checkpoint,sourceBouncingView:{...plan.view},sourceViewport:{...plan.viewport},quality:'export',width:plan.width,height:plan.height};
}
/** Validate the returned frame before either encoding or accepting warmup. */
export function assertSourceBouncingExportFrame(output:SceneOutput,plan:SourceBouncingExportPlan,checkpoint:SourceBouncingCheckpoint):asserts output is Extract<SceneOutput,{type:'raster'}> {
 const frame=output.sourceBouncingFrame;
 if(output.backend==='native'&&(output.type!=='raster'||output.sourcePixelRenderer?.backend!=='native'||!/^[a-f0-9]{64}$/.test(output.sourcePixelRenderer.identity)))throw new Error('源弹跳原生导出缺少后端来源');
 if(output.type!=='raster'||!['webgl2','native'].includes(output.backend??'')||!output.cameraResolved||output.width!==plan.width||output.height!==plan.height||output.pixels.length!==plan.width*plan.height*4||!frame||frame.pixelDensity!==plan.pixelDensity||frame.checkpoint.model!==checkpoint.model||frame.checkpoint.simulationUpdates!==checkpoint.simulationUpdates||!Object.is(frame.checkpoint.sceneTime,checkpoint.sceneTime)||!sourceBouncingViewMatches(frame.camera,plan.view)||frame.viewport.logicalWidth!==plan.viewport.logicalWidth||frame.viewport.logicalHeight!==plan.viewport.logicalHeight||frame.viewport.referenceLogicalHeight!==plan.viewport.referenceLogicalHeight||frame.viewport.target!=='offscreen'||frame.viewport.projectionPass!=='perspective')throw new Error('源弹跳导出帧与已呈现检查点、相机或尺寸不一致');
}
