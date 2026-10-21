import {SOURCE_FRACTAL_RETAINED_LIMITS} from './sourceFractalLimits';
import type {AnimationTrack,SceneDocument} from '../types';
import {FRACTAL_SCENE_SEQUENCE,parseSourceFractalDocument,parseSourceFractalActionsPayload,usesSourceFractal} from './sourceFractalDocument';
import {SourceFractalSceneRuntime,type SourceFractalSceneRuntimeConfiguration,type SourceFractalRuntimeClip} from './sourceFractalSceneRuntime';
import {SourceFractalPlaybackSession,SourceFractalPlaybackError} from './sourceFractalPlayback';
import {RootsSceneClock} from './rootsSceneClock';
import {SOURCE_EASING_NAMES} from './sourceEasing';
import {readGradientOffsets} from './gradientOffsets';
import {authoredFractalSourceColor,usesFractalSourceColor} from './fractalSourceColorAuthoring';
import {parseSourceFractalZoomTarget} from './sourceFractalZoom';

export type SourceFractalEvaluation=ReturnType<SourceFractalSceneRuntime['snapshot']>&{displayFrame:number;simulationFps:number};
const F=Math.fround,WORK_LIMIT=2_000_000;
const finite=(value:unknown,label:string)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error(`分形 ${label} 需要有限数值`);return value;};
export function validateSourceFractalTrack(track:AnimationTrack,reserve?:(actions:number,nameCharacters:number)=>void):void {
 if(!track||typeof track!=='object'||!['wait','animate','fractal_zoom'].includes(track.type??''))throw Error('原版分形队列只接受等待、动画和目标缩放');
 if(track.pingPong||(track.repeat??1)!==1||track.keyframes!==undefined||track.interpolation!==undefined||track.actions!==undefined||track.parameterAnimations!==undefined||track.gradient!==undefined||track.surfaceParameterClip!==undefined||track.orientation!==undefined)throw Error('原版分形片段不能混用本地动作、关键帧或重复');
 if(typeof track.enabled!=='boolean'||!Number.isFinite(track.start)||track.start<0||!Number.isFinite(track.duration)||Math.abs(track.duration)>86400||!Number.isFinite(F(track.duration)))throw Error('原版分形片段时长或启用状态无效');
 if(!SOURCE_EASING_NAMES.includes(track.easing))throw Error('原版分形缓动无效');
 if(track.type==='animate'){const parsed=parseSourceFractalActionsPayload(track.fractalSource,reserve);if(!parsed.ok)throw Error(parsed.error.reason);if(track.sourceFractalZoom!==undefined)throw Error('普通分形动画不能包含目标缩放');}
 else if(track.fractalSource!==undefined)throw Error('分形动作仅属于 animate 片段');
 if(track.type==='fractal_zoom'){const parsed=parseSourceFractalZoomTarget(track.sourceFractalZoom);if(!parsed.ok)throw Error(parsed.error.reason);if(track.duration<F(1e-4))throw Error('分形目标缩放时长至少 0.0001');}
 else if(track.sourceFractalZoom!==undefined)throw Error('分形目标仅属于 fractal_zoom 片段');
}
export function prepareSourceFractalScene(scene:SceneDocument):SourceFractalSceneRuntimeConfiguration {
 if(!usesSourceFractal(scene)||scene.timeline.schedule!==FRACTAL_SCENE_SEQUENCE)throw Error('源分形配置需要对应的逐帧队列');
 const payload=parseSourceFractalDocument(scene.fractalSource);if(!payload.ok)throw Error(payload.error.reason);
 const {fps,tracks}=scene.timeline;if(!Number.isFinite(fps)||fps<1||fps>120||!Number.isFinite(scene.timeline.duration)||scene.timeline.duration<=0||scene.timeline.duration>86400)throw Error('分形帧率或播放时长无效');
 if(!Array.isArray(tracks)||tracks.length>1000)throw Error('分形队列最多 1000 个片段');
 const clips:SourceFractalRuntimeClip[]=[];let actionCount=0,nameCharacters=0;
 const reserve=(actions:number,characters:number)=>{actionCount+=actions;nameCharacters+=characters;if(actionCount>SOURCE_FRACTAL_RETAINED_LIMITS.actions||nameCharacters>SOURCE_FRACTAL_RETAINED_LIMITS.nameCharacters)throw Error('分形队列动作或参数名称超过共享容量');};
 for(const track of tracks){validateSourceFractalTrack(track,reserve);if(!track.enabled)continue;
  if(track.type==='wait')clips.push({kind:'wait',duration:track.duration});
  else if(track.type==='fractal_zoom')clips.push({kind:'target',duration:track.duration,easing:track.easing,target:track.sourceFractalZoom!});
  else{const action=track.fractalSource!;clips.push({kind:'animate',duration:track.duration,easing:track.easing,targets:action.targets,parameters:action.parameters,gradient:action.gradient});}
 }
 const s=scene.settings,n=(key:string,fallback:number)=>finite(s[key]??fallback,key);
 return{initial:{centerX:n('centerX',0),centerY:n('centerY',0),centerXLow:n('centerXLow',0),centerYLow:n('centerYLow',0),zoom:n('zoom',1),rotation:n('rotation',0),rotationRate:0,iterations:n('iterations',200),bailout:0,juliaReal:0,juliaImag:0,ambientAngles:[0,0,0],ambientRates:[0,0,0],currentTime:0},formula:payload.value.formula,gradient:readGradientOffsets(scene),clips,fps,cameraAngles:[F(Math.PI/2),0,0]};
}
interface CachedLayout {starts:readonly number[];lastTime:number;}
const layouts=new Map<string,CachedLayout>();
/** Layout executes only the shared clock, never parameter or rendering work.
 * It uses the same grouped-duration rule as SourceFractalSceneClock. */
export function resolveSourceFractalTimeline(scene:SceneDocument):SceneDocument['timeline'] {
 const plan=prepareSourceFractalScene(scene),enabled=scene.timeline.tracks.filter(t=>t.enabled),durations=plan.clips.map(c=>c.kind==='animate'&&(c.parameters?.length||c.gradient)?Math.max(0,F(c.duration)):F(c.duration));
 // Timing depends only on narrowed durations/grouping and fps, not formula,
 // display names or track identities. Revalidate all inputs before cache lookup.
 const key=JSON.stringify([plan.fps,durations]);let layout=layouts.get(key);
 if(!layout){
  const clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},durations.map(duration=>({duration,easing:'linear'}))),starts:number[]=[];let work=0,frame=0;
  while(!clock.snapshot().queueComplete){const before=clock.snapshot();work+=1+durations.length-before.queueIndex;if(work>WORK_LIMIT)throw Error('分形队列布局超过 200 万工作预算');const next=clock.step(F(1/plan.fps),{allowSignedDt:true});if(next.startedClip!==null)starts[next.startedClip]=frame/plan.fps;frame++;}
  layout={starts,lastTime:Math.max(0,frame-1)/plan.fps};layouts.set(key,layout);if(layouts.size>4)layouts.delete(layouts.keys().next().value!);
 }
 const duration=Math.max(scene.timeline.duration,layout.lastTime);
 if(duration>86400)throw Error('分形队列超过 24 小时');
 const starts=new Map(enabled.map((track,i)=>[track.id,layout.starts[i]??0]));
 return{...scene.timeline,duration,tracks:scene.timeline.tracks.map(track=>({...track,start:starts.get(track.id)??0}))};
}
interface CachedReplay {runtime:SourceFractalSceneRuntime;playback:SourceFractalPlaybackSession;used:number;cancel?:()=>boolean;}
const sessions=new Map<string,CachedReplay>();
/** One retained state per scene identity, with a bounded four-entry cache.
 * A changed authoring input or backwards seek reconstructs every child. */
export function replaySourceFractal(scene:SceneDocument,time:number,isCancelled?:()=>boolean):SourceFractalEvaluation {
 return replay(scene,{time},isCancelled);
}
export function replaySourceFractalFrame(scene:SceneDocument,displayFrame:number,isCancelled?:()=>boolean):SourceFractalEvaluation {
 return replay(scene,{displayFrame},isCancelled);
}
function replay(scene:SceneDocument,position:{time:number}|{displayFrame:number},isCancelled?:()=>boolean):SourceFractalEvaluation {
 const plan=prepareSourceFractalScene(scene),key=JSON.stringify(plan,(_key,value:unknown)=>typeof value==='number'&&Object.is(value,-0)?{negativeZero:true}:value);
 let cached=sessions.get(key);
 if(!cached){
  const entry={} as CachedReplay;entry.used=0;
  const reserve=(units:number)=>{if(entry.cancel?.())throw new DOMException('分形回放已取消','AbortError');entry.used+=units;if(entry.used>WORK_LIMIT)throw new SourceFractalPlaybackError('capacity','分形队列与参数循环超过共享 200 万工作预算');};
  entry.playback=new SourceFractalPlaybackSession({fps:plan.fps,isCancelled:()=>entry.cancel?.()??false,reserve,createScene:()=>{entry.runtime=new SourceFractalSceneRuntime(plan,{reserve});return entry.runtime.clock;}});
  cached=entry;sessions.set(key,cached);if(sessions.size>4)sessions.delete(sessions.keys().next().value!);
 }
 cached.used=0;cached.cancel=isCancelled;
 try{const frame='displayFrame' in position?cached.playback.evaluateFrame(position.displayFrame):cached.playback.evaluate(position.time);return{...cached.runtime.snapshot(),displayFrame:frame.displayFrame,simulationFps:plan.fps};}
 catch(error){sessions.delete(key);throw error;}
 finally{cached.cancel=undefined;}
}
/** Mutates only the display copy. Formula values stay in the evaluated native
 * snapshot; legacy formula settings are never used as a second authored copy. */
export function bindSourceFractalFrame(out:SceneDocument,frame:SourceFractalEvaluation):readonly string[] {
 out.evaluatedFractalScene=frame;
 const o=frame.scene.object;Object.assign(out.settings,{centerX:o.centerX,centerY:o.centerY,centerXLow:o.centerXLow,centerYLow:o.centerYLow,zoom:o.zoom,rotation:o.rotation,iterations:o.iterations});
 if(usesFractalSourceColor(out)){const color=structuredClone(authoredFractalSourceColor(out));color.palette.offset=frame.offsets.palette;color.inside.offset=frame.offsets.inside;color.outside.offset=frame.offsets.outside;out.fractalSourceColor=color;}
 else{out.palette.offset=frame.offsets.palette;out.settings.insideGradientOffset=frame.offsets.inside;out.settings.outsideGradientOffset=frame.offsets.outside;}
 if(frame.gradient.running&&frame.gradient.config)out.evaluatedFractalGradient={interpolation:frame.gradient.config.interpolation,cyclic:true};else delete out.evaluatedFractalGradient;
 return frame.scene.writtenViewFields.map(field=>`settings.${field}`);
}
