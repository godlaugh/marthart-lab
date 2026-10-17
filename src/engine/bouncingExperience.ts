import type {AnimationClipType,ControlSpec,SceneDocument,Settings} from '../types';
import {RECORDING_DURATION_MIN,RECORDING_DURATION_MAX} from './recordingContract';

/** UI/clock policy only. Existing equations, parameters and tracks remain executable. */
export const bouncingExperienceDefaults:Settings={bouncingPlaybackModel:'continuous-v2',bouncingRecordDuration:10};
export const bouncingExperienceControls:ControlSpec[]=[
 {key:'bouncingPlaybackModel',label:'预览播放方式',type:'select',group:'仿真',options:[{value:'timeline-v1',label:'时间线 · 兼容模式'},{value:'continuous-v2',label:'连续运行'}]},
 {key:'bouncingRecordDuration',label:'独立录制时长 · 秒',type:'number',group:'仿真',min:RECORDING_DURATION_MIN,max:RECORDING_DURATION_MAX,step:.1,help:'录制按实际经过的秒数停止；等待片段只定义导出范围。'},
];
export function continuousBouncing(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='bouncing'&&scene.settings.bouncingPlaybackModel==='continuous-v2';}
export function bouncingExperience(scene:SceneDocument){
 const bouncing=scene.kind==='bouncing',continuous=continuousBouncing(scene),model=scene.settings.bouncingPlaybackModel;
 return{continuous,
  error:bouncing&&model!==undefined&&model!=='timeline-v1'&&model!=='continuous-v2'?'未知弹跳播放方式；原值已保留，请选择播放方式。':undefined,
  equations:!bouncing||scene.settings.shape==='formula',
  applyEquationsOnBlur:bouncing&&scene.settings.shape==='formula',
  createParameters:!continuous,
  parameterPanel:!continuous||Object.keys(scene.parameters).length>0,
  formulaPanel:!continuous||!!scene.formulas,
  compatibleTracks:continuous&&scene.timeline.tracks.some(track=>(track.type??'numeric')!=='wait'),
 };
}
export function bouncingControlSettings(settings:Settings):Settings{return{bouncingPlaybackModel:'timeline-v1',bouncingRecordDuration:10,...settings};}
export function bouncingClipAllowed(scene:SceneDocument,type:AnimationClipType):boolean{return !continuousBouncing(scene)||type==='wait';}
export function bouncingCanvasControl(scene:SceneDocument,key:string):boolean{
 if(scene.kind!=='bouncing')return true;
 if(key==='wireframe')return false; // The producer emits points/segments or a raster, never triangles.
 return scene.settings.bouncingPresentation!=='raster'||!['opacity','showGrid','showAxes'].includes(key);
}
export function bouncingControlGroup(key:string):string{
 if(key==='colorMetric')return '渐变';
 if(key==='shape'||key==='fill'||key==='initialRadius'||key.startsWith('shape')||key.startsWith('box')||key.startsWith('formula')||key.startsWith('initialShape')||key==='showInitialShape')return '初始位置';
 if(key.startsWith('velocity')||['speed','angle','spread'].includes(key))return '初始速度';
 if(key.startsWith('boundary')||key.startsWith('collision')||['radius','ellipseY','sides','polygon','showBoundary','showCollisionBoundary','guideResolution'].includes(key))return '边界';
 return '仿真';
}
export function sceneRecordingDuration(scene:SceneDocument):number{
 const value=scene.kind==='bouncing'?scene.settings.bouncingRecordDuration:scene.timeline.duration;
 return value===undefined?10:typeof value==='number'?value:NaN;
}
