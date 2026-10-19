import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import type {SourceBouncingPresentationFrame} from '../scenes/sourceBouncing';
import {prepareSourceBouncingScene,sourceBouncingCameraInput} from './sourceBouncingDocument';
import {parseSourceBouncingCheckpoint,sourceBouncingSeedCheckpoint,planSourceBouncingRecording,type SourceBouncingCheckpoint} from './sourceBouncingReplay';
import {prepareSourceCamera,type SourceCameraScalars,type SourceCameraViewport} from './sourceCamera';
import type {SourceBouncingResult} from './sourceBouncingConfig';

export interface SourceBouncingPresentedExport {ready:boolean;frame:SourceBouncingPresentationFrame;}
export interface SourceBouncingExportPlan {
 readonly width:number;readonly height:number;
 readonly viewport:SourceCameraViewport;readonly camera:SourceCameraScalars;
 readonly warmup?:SourceBouncingCheckpoint;
 readonly frames:readonly SourceBouncingCheckpoint[];
}
/** Export consumes a delivered frame and its authored scene, never UI seconds.
 * A fresh export worker reconstructs the absolute update index from the seed;
 * viewport changes only alter projection and boundary tessellation. */
export function prepareSourceBouncingExport(scene:SceneDocument,presented:SourceBouncingPresentedExport|undefined,options:{kind:'image'|'video';start:'current'|'seed';width:number;height:number;fps:number}):SourceBouncingResult<SourceBouncingExportPlan>{
 const parsed=prepareSourceBouncingScene(scene);if(!parsed.ok)return parsed;
 if(!presented?.ready)return{ok:false,error:{kind:'input',path:['frame'],reason:'请等待源弹跳当前预览完成并暂停后再导出'}};
 const checkpoint=parseSourceBouncingCheckpoint(presented.frame.checkpoint);if(!checkpoint.ok)return checkpoint;
 if(!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||options.width<16||options.height<16)return{ok:false,error:{kind:'input',path:['size'],reason:'源弹跳导出尺寸必须为至少 16 的整数'}};
 const viewport:SourceCameraViewport={logicalWidth:options.width,logicalHeight:options.height,referenceLogicalHeight:presented.frame.viewport.referenceLogicalHeight,target:'offscreen',projectionPass:'perspective'};
 const camera=prepareSourceCamera(sourceBouncingCameraInput(parsed.value),viewport);
 if(!camera.ok||camera.value.kind!=='known')return{ok:false,error:{kind:'input',path:['camera'],reason:'源弹跳导出相机或参考画布无效'}};
 const expected=camera.value.plan.camera.value;
 if(!sameCamera(expected,presented.frame.camera))return{ok:false,error:{kind:'input',path:['camera'],reason:'源弹跳已呈现相机与导出作者配置不一致，请重新预览'}};
 if(options.kind==='image')return{ok:true,value:{width:options.width,height:options.height,viewport,camera:structuredClone(expected),frames:[checkpoint.value]}};
 if(!Number.isSafeInteger(options.fps)||options.fps<1||options.fps>120)return{ok:false,error:{kind:'input',path:['fps'],reason:'源弹跳导出帧率必须为 1–120 的整数'}};
 const recording=planSourceBouncingRecording({from:options.start==='seed'?sourceBouncingSeedCheckpoint():checkpoint.value,fps:options.fps,recordDuration:parsed.value.recordDuration});
 if(!recording.ok)return recording;
 return{ok:true,value:{width:options.width,height:options.height,viewport,camera:structuredClone(expected),warmup:recording.value.warmup,frames:recording.value.frames}};
}
export function sourceBouncingExportContext(plan:SourceBouncingExportPlan,checkpoint:SourceBouncingCheckpoint):GenerationInput{
 return{time:checkpoint.sceneTime,sourceBouncingFrame:checkpoint,sourceViewport:{...plan.viewport},quality:'export',width:plan.width,height:plan.height};
}
function sameCamera(a:SourceCameraScalars,b:SourceCameraScalars):boolean{
 return !!b&&['phi','theta','gamma','zoom','focalDistance'].every(key=>Object.is(a[key as keyof SourceCameraScalars],b[key as keyof SourceCameraScalars]))&&Array.isArray(b.center)&&b.center.length===3&&a.center.every((value,index)=>Object.is(value,b.center[index]));
}
/** Validate the returned frame before either encoding or accepting warmup. */
export function assertSourceBouncingExportFrame(output:SceneOutput,plan:SourceBouncingExportPlan,checkpoint:SourceBouncingCheckpoint):asserts output is Extract<SceneOutput,{type:'raster'}> {
 const frame=output.sourceBouncingFrame;
 if(output.type!=='raster'||output.backend!=='webgl2'||!output.cameraResolved||output.width!==plan.width||output.height!==plan.height||output.pixels.length!==plan.width*plan.height*4||!frame||frame.checkpoint.model!==checkpoint.model||frame.checkpoint.simulationUpdates!==checkpoint.simulationUpdates||!Object.is(frame.checkpoint.sceneTime,checkpoint.sceneTime)||!sameCamera(plan.camera,frame.camera)||frame.viewport.logicalWidth!==plan.viewport.logicalWidth||frame.viewport.logicalHeight!==plan.viewport.logicalHeight||frame.viewport.referenceLogicalHeight!==plan.viewport.referenceLogicalHeight||frame.viewport.target!=='offscreen'||frame.viewport.projectionPass!=='perspective')throw new Error('源弹跳导出帧与已呈现检查点、相机或尺寸不一致');
}
