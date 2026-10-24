import type {OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';

export interface SourcePerlinLiveContext {
 sessionId:string;clock:SourceSceneClockRequest;
 /** Explicit local fixed reconstruction, only on a new session/seek identity. */
 startAt?:number;
 /** Explicit UI palette command. Increment even when submitting equal colors.
  * Omission keeps the older document-diff adapter for non-UI callers. */
 paletteRevision?:number;
}
export interface SourcePerlinLiveFacts {
 sessionId:string;paused:boolean;clockSource:'worker-wall-clock'|'injected'|'fixed-step';
 renderKind:'update'|'snapshot';sceneTime:number;constructions:number;
 paletteRevision?:number;
 /** Actual retained queue/camera state, not a replay of the requested UI time. */
 frame:OrdinarySourceCameraFrame;
}
/** Own the small live request once; timestamps are host-clock inputs, not
 * mathematical time. Omission of startAt preserves the source's first dt=0. */
export function validateSourcePerlinLiveContext(value:unknown):SourcePerlinLiveContext {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Perlin 实时上下文无效');
 const v=value as Partial<SourcePerlinLiveContext>;
 if(typeof v.sessionId!=='string'||!v.sessionId.trim()||v.sessionId.length>256)throw Error('Perlin 实时会话身份无效');
 if(!v.clock||typeof v.clock!=='object'||Array.isArray(v.clock))throw Error('Perlin 实时时钟无效');
 validateSourceSceneClockRequest(v.clock);
 if(v.startAt!==undefined&&(!Number.isFinite(v.startAt)||v.startAt<0||v.startAt>86400))throw Error('Perlin 本地重建起点必须在 0–86400 秒');
 if(v.paletteRevision!==undefined&&(!Number.isSafeInteger(v.paletteRevision)||v.paletteRevision<0))throw Error('Perlin 色板命令序号必须为非负安全整数');
 return{sessionId:v.sessionId,clock:{paused:v.clock.paused,...(v.clock.timestampMs===undefined?{}:{timestampMs:v.clock.timestampMs})},...(v.startAt===undefined?{}:{startAt:v.startAt}),...(v.paletteRevision===undefined?{}:{paletteRevision:v.paletteRevision})};
}
