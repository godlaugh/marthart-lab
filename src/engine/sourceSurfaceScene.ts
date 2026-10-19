import type {SceneDocument} from '../types';
import {usesSourceSurfaceHost,SOURCE_SURFACE_HOST_CLIP_TYPES,SOURCE_SURFACE_ACTION_METHODS} from './sourceSurfaceIdentity';
import {parseSourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {prepareSourceSurfaceFunction} from './sourceSurfaceFunction';
import {SourceSurfaceHost} from './sourceSurfaceHost';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {evaluateOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {sourceSurfaceFadeRatio} from './sourceSurfaceTransition';

/** One authored full configuration owns both modes. Generic/local surface
 * selectors and geometry fields are not a second editable source of truth. */
export function prepareSourceSurfaceScene(scene:SceneDocument){
 if(!usesSourceSurfaceHost(scene))throw new Error('缺少原版曲面宿主版本');
 const parsed=parseSourceSurfaceMeshConfiguration(scene.surfaceSource);
 if(!parsed.ok)throw new Error(`原版曲面 ${parsed.error.path.join('.')}：${parsed.error.reason}`);
 const configuration=parsed.value,s=scene.settings;
 if(configuration.nativeBackend!=='cpu'||s.computeBackend!=='cpu')throw new Error('原版曲面宿主只接入 CPU；GPU 尚待接入');
 if(s.scale!==1||['rotateX','rotateY','rotateZ'].some(key=>Number(s[key]??0)!==0))throw new Error('原版曲面使用源分轴缩放与偏移，不执行本地整体变换');
 if(!Number.isFinite(scene.timeline.fps)||scene.timeline.fps<1||scene.timeline.fps>120)throw new Error('原版曲面帧率必须在 1–120');
 const modes=new Set([configuration.mode]);
 for(const track of scene.timeline.tracks){
  if(!track.enabled)continue;
  if(!SOURCE_SURFACE_HOST_CLIP_TYPES.includes(track.type??'')||track.actions?.some(a=>!SOURCE_SURFACE_ACTION_METHODS.includes(a.method)))throw new Error('原版曲面动画类型尚未接入，不能按本地时钟替代');
  if(track.type==='surface_mode_transition'){
   if(track.surfaceMode!=='points'&&track.surfaceMode!=='mesh')throw new Error('原版曲面过渡目标无效');
   modes.add(track.surfaceMode);sourceSurfaceFadeRatio(track.surfaceFadeOutRatio??.5);
  }
 }
 for(const mode of modes){const grid=mode==='mesh'?configuration.mesh:configuration.points;
  if(![grid.uSegments,grid.vSegments].every(n=>Number.isInteger(n)&&n>=1&&n<=512))throw new Error(`原版${mode==='mesh'?'网格':'点'}每轴采样数必须在 1–512，不截断请求`);
 }
 const t=configuration.transform;
 prepareSourceSurfaceFunction({equations:scene.equations,parameters:scene.parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 return{configuration};
}
export function replaySourceSurfaceHost(scene:SceneDocument,time:number,coverage:'all'|'tracked',isCancelled?:()=>boolean){
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw new Error('原版曲面需要源相机');
 const {configuration}=prepareSourceSurfaceScene(scene);
 const host=new SourceSurfaceHost({configuration,equations:scene.equations,parameters:scene.parameters,frameRate:scene.timeline.fps,palette:scene.surfaceSourcePalette,isCancelled,coverage});
 const frame=evaluateOrdinarySourceCameraTimeline(initial,scene.timeline.tracks,scene.timeline.fps,time,{isCancelled,particleActions:'surface',surfaceMode:configuration.mode,createParticles:()=>host});
 return{frame,host};
}
