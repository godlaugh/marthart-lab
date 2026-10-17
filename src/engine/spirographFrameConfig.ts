import type {SceneDocument,SpirographFrameEvent} from '../types';
import {finite,numberSetting} from './expression';
import {parseSpirographVersion,spirographSourceRotationRate} from './spirographModel';
import {simulationTime} from './simulationClock';
import {parseSpirographClock,parseSpirographReplayFps} from './spirographReplay';
import {sourceEase} from './sourceEasing';

export function usesSpirographFrameClock(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
  const value=parseSpirographClock(scene.settings.spirographClock);
  if(value===undefined)return false;
  if(scene.kind!=='spirograph'||parseSpirographVersion(scene.settings.spirographVersion)!=='mathart-1.7.8-v1')throw new Error('旋轮帧时钟只适用于显式源旋轮规则');
  return true;
}
export function spirographSimulationFps(scene:Pick<SceneDocument,'settings'>):number {
  return parseSpirographReplayFps(numberSetting(scene.settings,'spirographSimulationFps',60));
}
/** Uses the shared binary64 tick neighborhood; arbitrary times sample the last
 * completed update, never add a fabricated fractional source update. */
export function sourceFrameIndex(time:number,fps:number):number {return simulationTime(time,fps).frame;}
/** Timestamp migration must not move an event earlier. Selected-frame editing
 * deliberately uses sourceFrameIndex instead and is a different operation. */
export function sourceFrameAtOrAfter(time:number,fps:number):number {
  const tick=simulationTime(time,fps);return tick.frame+(tick.fraction>0?1:0);
}
export function parseSpirographFrameEvents(raw:unknown):SpirographFrameEvent[] {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>4096)throw new Error('旋轮帧事件必须为最多 4096 项的数组');
  return raw.map(event=>{
    if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('旋轮帧事件必须是对象');
    const item=event as Record<string,unknown>;
    if(Object.keys(item).some(key=>!['beforeFrame','type'].includes(key))||!Number.isSafeInteger(item.beforeFrame)||Number(item.beforeFrame)<1||Number(item.beforeFrame)>86400*120||!['clear','restart','finish'].includes(String(item.type)))throw new Error('旋轮事件需有效帧号和 clear/restart/finish 操作');
    return{beforeFrame:Number(item.beforeFrame),type:item.type as SpirographFrameEvent['type']};
  });
}
export interface SourceSpirographClip {id:string;kind:'wait'|'rotate'|'finish-wait';duration:number;easing?:string;targetRate?:number;}
export interface SpirographClipBinding {trackIndex:number;clipIndex:number;delayIndex?:number;}
/** Authoring adapter only: the replay owner determines every effective start
 * and finish. It never consumes a second continuous schedule. */
export function spirographFrameClips(scene:SceneDocument):{clips:SourceSpirographClip[];bindings:SpirographClipBinding[]} {
  if(!usesSpirographFrameClock(scene))throw new Error('尚未选择旋轮逐帧时钟');
  if(scene.timeline.schedule!=='spirograph-sequence-v1')throw new Error('旋轮逐帧时钟需要顺序队列');
  if(scene.timeline.tracks.length>1000)throw new Error('时间线最多 1000 个片段');
  const clips:SourceSpirographClip[]=[],bindings:SpirographClipBinding[]=[];
  for(const [index,track] of scene.timeline.tracks.entries()){
    if(!track.enabled)continue;
    const delay=finite(track.start,'片段前置等待'),duration=finite(track.duration,'片段长度');
    if(delay<0||delay>86400||duration<0||duration>86400)throw new Error('旋轮片段长度或前置等待超过 0–86400 秒');
    if(track.pingPong||track.repeat!==undefined&&track.repeat!==1)throw new Error('源旋轮帧队列不支持片段重复或往返扩展');
    let delayIndex:number|undefined;
    if(delay>0){delayIndex=clips.length;clips.push({id:JSON.stringify([index,'delay']),kind:'wait',duration:delay});}
    const clip:SourceSpirographClip={id:JSON.stringify([index,'body']),kind:'wait',duration};
    if(track.type==='spirograph_finish_wait'){
      if(track.spirographWait!=='visual-or-deadline-v1')throw new Error('源旋轮帧等待需要明确最长时限');
      clip.kind='finish-wait';
    }else if(track.type==='animate'){
      clip.kind='rotate';clip.easing=track.easing;
      sourceEase(clip.easing,0);
      for(const action of track.actions??[]){
        if(action.enabled===false)continue;
        if(action.method!=='spirographRotate')throw new Error('源旋轮帧队列仅支持旋轮旋转动作');
        if(action.args?.speed!==undefined)clip.targetRate=spirographSourceRotationRate(action.args.speed);
      }
    }else if(track.type!=='wait')throw new Error('源旋轮帧队列仅支持等待、完成等待及旋转片段');
    bindings.push({trackIndex:index,clipIndex:clips.length,...(delayIndex===undefined?{}:{delayIndex})});clips.push(clip);
  }
  return{clips,bindings};
}
