import type {GenerateContext, SceneDocument, SceneOutput} from '../types';
import {prepareSourceCamera, resolveSourceCamera, SOURCE_CAMERA_MODEL, type SourceCameraInput, type SourceCameraPlan, type SourceCameraScalars, type SourceCameraViewport} from './sourceCamera';

export interface OrdinarySourceCameraEvaluation {time:number;camera:SourceCameraScalars;frameIndex:number;}
/** Small delivered facts, never a serialized GPU matrix or an inferred orbit. */
export interface OrdinarySourceCameraFrame extends OrdinarySourceCameraEvaluation {
 model:typeof SOURCE_CAMERA_MODEL;viewport:SourceCameraViewport;
}
type Scene=Pick<SceneDocument,'kind'|'settings'|'sourceCamera'>;
export function ordinarySourceCameraGeometry(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
 if(scene.kind==='surface'||scene.kind==='implicit')return true;
 if(scene.kind==='attractor')return scene.settings.presentation!=='density';
 return scene.kind==='perlin'&&scene.settings.style==='continuous'&&['heads','trails'].includes(String(scene.settings.particleDisplay));
}
export function ordinarySourceCameraInitial(scene:Scene):SourceCameraScalars|undefined {
 if(scene.sourceCamera===undefined)return;
 if(!ordinarySourceCameraGeometry(scene))throw new Error('此显示模式尚未接入原版相机投影；请使用已支持的几何显示模式');
 if(!['perspective','scene-fade-orthographic'].includes(String(scene.settings.sourceCameraProjection)))throw new Error('原版相机缺少已确认的投影方式');
 const parsed=resolveSourceCamera(scene.sourceCamera);
 if(!parsed.ok)throw parsed.error;
 if(parsed.value.kind!=='known')throw new Error('原版相机配置未解析：'+parsed.value.reason);
 if(scene.sourceCamera.configuration.kind==='angles'&&scene.sourceCamera.configuration.family!==scene.kind)throw new Error('原版相机场景类型不匹配');
 return parsed.value.state.authored;
}
export function ordinarySourceViewport(scene:Scene,width:number,height:number,target:'primary'|'offscreen',referenceLogicalHeight:number):SourceCameraViewport {
 const pass=scene.settings.sourceCameraProjection;
 return{logicalWidth:width,logicalHeight:height,referenceLogicalHeight,target,projectionPass:pass==='perspective'||pass==='scene-fade-orthographic'?pass:'unknown'};
}
export function prepareOrdinarySourceFrame(frame:OrdinarySourceCameraFrame):SourceCameraPlan {
 if(!frame||frame.model!==SOURCE_CAMERA_MODEL||!Number.isFinite(frame.time)||frame.time<0||frame.time>86400||!Number.isSafeInteger(frame.frameIndex)||frame.frameIndex<0)throw new Error('原版相机呈现帧无效');
 if(!frame.camera||typeof frame.camera!=='object'||['phi','theta','gamma','center','zoom','focalDistance'].some(key=>!Object.hasOwn(frame.camera,key)))throw new Error('原版相机呈现帧必须包含完整相机标量');
 const input:SourceCameraInput={model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'},frame:frame.camera};
 const parsed=prepareSourceCamera(input,frame.viewport);if(!parsed.ok)throw parsed.error;
 if(parsed.value.kind!=='known')throw new Error('原版相机投影阶段尚未确定');return parsed.value.plan;
}
/** Attach at the generation boundary, pairing the exact request with its frame.
 * Geometry history can contain older vertices; their current display camera is
 * owned by this delivered frame. No renderer reads newer editor state. */
export function bindOrdinarySourceCamera(output:SceneOutput,current:SceneDocument,context:GenerateContext):SceneOutput {
 if(current.sourceCamera===undefined)return output;
 if(output.type!=='geometry')throw new Error('原版几何相机不能应用到已投影的像素图像');
 output.sourceCameraFrame=ordinarySourceCameraFrame(current,context);return output;
}
export function ordinarySourceCameraFrame(current:SceneDocument,context:GenerateContext):OrdinarySourceCameraFrame {
 if(!context.sourceViewport)throw new Error('原版相机缺少逻辑画布尺寸');
 if(context.sourceViewport.projectionPass!==current.settings.sourceCameraProjection)throw new Error('原版相机请求的投影方式与场景不匹配');
 const value=current.evaluatedSourceCamera;if(!value)throw new Error('原版相机缺少对应的时间线帧');
 const frame:OrdinarySourceCameraFrame={...value,camera:structuredClone(value.camera),model:SOURCE_CAMERA_MODEL,viewport:{...context.sourceViewport}};
 prepareOrdinarySourceFrame(frame);return frame;
}
