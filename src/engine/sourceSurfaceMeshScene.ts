import type {SceneDocument} from '../types';
import {usesSourceSurfaceMesh,SOURCE_SURFACE_CLIP_TYPES,SOURCE_SURFACE_ACTION_METHODS} from './sourceSurfaceIdentity';
import {parseSourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {prepareSourceSurfaceFunction} from './sourceSurfaceFunction';
import {createSourceSurfaceMeshRuntime} from './sourceSurfaceMeshRuntime';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {evaluateOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';

/** Canonical mesh settings own source values. Local surface settings are never
 * reinterpreted as a second mesh configuration. Admission precedes replay. */
export function prepareSourceSurfaceMeshScene(scene:SceneDocument){
 if(!usesSourceSurfaceMesh(scene))throw new Error('缺少原版曲面网格版本');
 const parsed=parseSourceSurfaceMeshConfiguration(scene.surfaceSourceMesh);
 if(!parsed.ok)throw new Error(`原版曲面网格 ${parsed.error.path.join('.')}：${parsed.error.reason}`);
 const configuration=parsed.value,s=scene.settings;
 if(configuration.mode!=='mesh'||configuration.nativeBackend!=='cpu'||s.renderMode!=='mesh'||s.computeBackend!=='cpu')throw new Error('原版曲面网格仅接入 CPU 初始网格模式；GPU 和模式切换尚待接入');
 if(s.scale!==1||['rotateX','rotateY','rotateZ'].some(key=>Number(s[key]??0)!==0))throw new Error('原版曲面网格使用源分轴缩放与偏移，不执行本地整体变换');
 if(!Number.isFinite(scene.timeline.fps)||scene.timeline.fps<1||scene.timeline.fps>120)throw new Error('原版网格帧率必须在 1–120');
 if(![configuration.mesh.uSegments,configuration.mesh.vSegments].every(n=>Number.isInteger(n)&&n>=1&&n<=512))throw new Error('原版网格每轴采样数必须在 1–512，不截断请求');
 for(const track of scene.timeline.tracks){
  if(!track.enabled)continue;
  if(!SOURCE_SURFACE_CLIP_TYPES.includes(track.type??'')||track.actions?.some(a=>!SOURCE_SURFACE_ACTION_METHODS.includes(a.method)))throw new Error('原版曲面模式动画尚未接入，不能按本地时钟替代');
 }
 const t=configuration.transform;
 const preparedFunction=prepareSourceSurfaceFunction({equations:scene.equations,parameters:scene.parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 return{configuration,preparedFunction};
}

export function replaySourceSurfaceMesh(scene:SceneDocument,time:number,coverage:'all'|'tracked',isCancelled?:()=>boolean){
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw new Error('原版曲面网格需要源相机');
 const {configuration,preparedFunction}=prepareSourceSurfaceMeshScene(scene);
 const mesh=createSourceSurfaceMeshRuntime({configuration,surfaceFunction:preparedFunction.create(),operationsPerPosition:preparedFunction.operations,frameRate:scene.timeline.fps,palette:scene.surfaceSourcePalette,isCancelled,coverage});
 const frame=evaluateOrdinarySourceCameraTimeline(initial,scene.timeline.tracks,scene.timeline.fps,time,{isCancelled,particleActions:'surface',createParticles:()=>({
  bind:request=>mesh.bind(request),update:step=>mesh.update(step),displayFrame:(index,final)=>mesh.display(index,1,final),
  setRecordingTrails:enabled=>mesh.setRecordingTrails(enabled),
  beginGradientActions:actions=>mesh.beginGradientActions(actions),interpolateGradientActions:(eased,finished)=>mesh.interpolateGradientActions(eased,finished),
  beginParameterActions:actions=>mesh.beginParameterActions(actions),interpolateParameterActions:(eased,finished)=>mesh.interpolateParameterActions(eased,finished),
  beginParameterClip:parameters=>mesh.beginParameterClip(parameters),finishParameterClip:()=>mesh.finishParameterClip(),
 })});
 return{frame,mesh};
}
