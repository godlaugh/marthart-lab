import type {AnimationTrack} from '../types';

/** Preserve the existing enabled-track accounting. Operations inside an action
 * consume the same budget as legacy parameter oscillations. Shared by local
 * timeline compilation and explicit source camera queue compilation. */
export const TIMELINE_OPERATION_LIMIT=4096;
export function timelineTrackCost(track:AnimationTrack):number {
 return track.enabled?1+(track.parameterAnimations?.length??0)+(track.surfaceParameterClip?.parameters?.length??0)+(track.actions?.reduce((n,action)=>n+1+(action.parameters?.length??0)+(action.domainParameters?.length??0)+(action.surfaceParameters?.length??0)+(action.samilaParameters?.parameters.length??0),0)??0):0;
}
export function validateTimelineCapacity(tracks:readonly AnimationTrack[]):void {
 if(tracks.reduce((sum,track)=>sum+timelineTrackCost(track),0)>TIMELINE_OPERATION_LIMIT)throw new Error('时间线动作与参数振荡总数超过4096个');
}
