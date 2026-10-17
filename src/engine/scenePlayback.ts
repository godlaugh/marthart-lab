import type {SceneDocument} from '../types';
import {continuousBouncing} from './bouncingExperience';
import {normalizeTimelineTime,resolveTimeline} from './timeline';
import {usesSpirographFrameClock} from './spirographFrameConfig';
/** Scene seconds, before any producer-specific physical-time conversion. */
export const MAX_CONTINUOUS_SCENE_TIME=86400;
/** A playback policy change starts at the currently shown scene coordinate,
 * never at a hidden loop/ping-pong accumulator from the previous policy. */
export function playbackAnchor(sceneTime:number):number{
 if(!Number.isFinite(sceneTime)||sceneTime<0||sceneTime>MAX_CONTINUOUS_SCENE_TIME)throw new Error('播放时间必须为非负有限数');return sceneTime;
}
export function scenePlaybackTime(scene:SceneDocument,elapsed:number):{time:number;finished:boolean}{
 if(!Number.isFinite(elapsed)||elapsed<0)throw new Error('播放时间必须为非负有限数');
 if(continuousBouncing(scene)||usesSpirographFrameClock(scene))return{time:Math.min(elapsed,MAX_CONTINUOUS_SCENE_TIME),finished:elapsed>=MAX_CONTINUOUS_SCENE_TIME};
 const timeline=resolveTimeline(scene),mode=timeline.playbackMode??(timeline.loop?'loop':'once');
 return{time:normalizeTimelineTime(elapsed,timeline),finished:mode==='once'&&elapsed>=timeline.duration};
}
