import type {ControlSpec,SceneDocument,SpirographFrameEvent,Settings} from '../types';
import {parseSpirographVersion} from './spirographModel';
import {isSpirographIgnoredTarget} from './timeline';
import {numberSetting} from './expression';
import {usesSpirographFrameClock,spirographSimulationFps,sourceFrameIndex,sourceFrameAtOrAfter,parseSpirographFrameEvents,spirographFrameClips} from './spirographFrameConfig';

/** Selecting a rule is explicit; it never guesses a migration from provenance
 * or converts old fields/animation tracks behind the author's back. */
export function withSpirographVersion(scene:SceneDocument,value:unknown):SceneDocument {
 if(scene.kind!=='spirograph')throw new Error('旋轮规则仅适用于旋轮场景');
 const version=parseSpirographVersion(value);
 if(version!=='local-v1'&&!String(scene.settings.layers??'').trim())throw new Error('请先转换为多图层，再选择原版旋轮规则');
 const settings:Settings={...scene.settings,spirographVersion:version,...(version==='local-v1'&&scene.settings.spiroView==='native'?{spiroView:'fit'}:{})};
 if(version==='local-v1')delete settings.spirographClock;
 return {...scene,settings};
}

/** A one-time, explicit transcription of the still-known legacy events. It
 * cannot reconstruct events that an older editor already deleted. */
function legacyFrameEvents(scene:SceneDocument,fps:number):SpirographFrameEvent[] {
 const start=numberSetting(scene.settings,'traceStartTime',0,0,86400);
 const events:{time:number;type:SpirographFrameEvent['type']}[]=[];
 if(start>0)events.push({time:start,type:'restart'});
 if(scene.settings.traceClearTime!==undefined){const time=numberSetting(scene.settings,'traceClearTime',0,0,86400);if(time>start)events.push({time,type:'clear'});}
 if(scene.settings.traceFinishTime!==undefined){const time=numberSetting(scene.settings,'traceFinishTime',0,0,86400);if(time>=start)events.push({time,type:'finish'});}
 return events.sort((a,b)=>a.time-b.time).map(event=>({beforeFrame:Math.max(1,sourceFrameAtOrAfter(event.time,fps)),type:event.type}));
}

/** No mutation on failure and no automatic migration when loading a document.
 * Explicit empty events mean no events, even if legacy timestamps remain. */
export function withSpirographClock(scene:SceneDocument,raw:unknown,simulationFps?:number):SceneDocument {
 if(scene.kind!=='spirograph')throw new Error('旋轮规则仅适用于旋轮场景');
 const settings={...scene.settings};
 if(raw===undefined){delete settings.spirographClock;return{...scene,settings};}
 settings.spirographClock=raw as string;
 if(simulationFps!==undefined)settings.spirographSimulationFps=simulationFps;
 const candidate={...scene,settings};
 usesSpirographFrameClock(candidate);
 const fps=spirographSimulationFps(candidate);
 spirographFrameClips(candidate);
 const events=scene.spirographFrameEvents===undefined?legacyFrameEvents(scene,fps):parseSpirographFrameEvents(scene.spirographFrameEvents);
 return{...candidate,settings:{...settings,spirographSimulationFps:fps,animate:true,finishTrace:false},spirographFrameEvents:events};
}

/** Frame identities survive FPS edits. Their displayed seconds change. */
export function withSpirographSimulationFps(scene:SceneDocument,fps:number):SceneDocument {
 if(!usesSpirographFrameClock(scene))throw new Error('请先启用旋轮逐帧参考时钟');
 const candidate={...scene,settings:{...scene.settings,spirographSimulationFps:fps}};
 spirographSimulationFps(candidate);parseSpirographFrameEvents(candidate.spirographFrameEvents);
 return candidate;
}

export function spirographAuthoringControls(scene:SceneDocument,controls:ControlSpec[]):ControlSpec[] {
 if(scene.kind!=='spirograph')return controls;
 const source=parseSpirographVersion(scene.settings.spirographVersion)!=='local-v1';
 // Shared target applicability also hides dormant source Z transforms;
 // their authored values remain available after an explicit local-mode switch.
 return controls.filter(control=>(!source||control.key!=='finishTrace')&&!isSpirographIgnoredTarget(scene,`settings.${control.key}`)).map(control=>{
  if(control.key==='rotation')return{...control,label:source?'场景旋转 · 度 · 正值顺时针':'整体旋转 · 弧度 · 正值逆时针'};
  if(control.key==='offsetY')return{...control,label:source?'Y 偏移 · 正值向下':'Y 偏移 · 正值向上'};
  if(control.key==='rotationSpeed')return{...control,label:'旋转速度 · 弧度/秒'};
  if(source&&control.key==='rotateZ')return{...control,label:'额外本地旋转 · 弧度'};
  if(source&&control.key==='spiroView')return{...control,options:[{value:'native',label:'原版像素坐标'},...(control.options??[])]};
  return control;
 });
}

/** Events modify the selected completed frame. The replay owner applies only
 * the final command for one frame, matching the native pending-operation slot. */
export function spirographDrawingEvent(scene:SceneDocument,event:SpirographFrameEvent['type'],time:number,completedFrame?:number):SceneDocument {
 if(scene.kind!=='spirograph'||!Number.isFinite(time)||time<0)throw new Error('旋轮绘制事件时间无效');
 if(usesSpirographFrameClock(scene)){
  if(completedFrame!==undefined&&(!Number.isSafeInteger(completedFrame)||completedFrame<0))throw new Error('旋轮绘制事件时间无效');
  const beforeFrame=Math.max(1,completedFrame??sourceFrameIndex(time,spirographSimulationFps(scene)));
  const events=parseSpirographFrameEvents([...parseSpirographFrameEvents(scene.spirographFrameEvents),{beforeFrame,type:event}]);
  return{...scene,spirographFrameEvents:events,...(event==='clear'?{settings:{...scene.settings,showTrace:true}}:{})};
 }
 const settings={...scene.settings};
 if(event==='clear'){settings.traceClearTime=time;settings.showTrace=true;}
 else if(event==='restart'){settings.traceStartTime=time;settings.animate=true;settings.finishTrace=false;delete settings.traceFinishTime;delete settings.traceClearTime;}
 else if(parseSpirographVersion(settings.spirographVersion)!=='local-v1'){settings.traceFinishTime=time;delete settings.finishTrace;}
 else settings.finishTrace=true;
 return {...scene,settings};
}
