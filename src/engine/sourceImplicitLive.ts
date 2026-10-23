import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
/** Minted by an owned recording, activated at stop, never a request to reconstruct a scene. */
export interface SourceImplicitLiveContext {sessionId:string;clock:SourceSceneClockRequest;actualFrameRate:number;}
export interface SourceImplicitLiveFacts {sessionId:string;paused:boolean;renderKind:'update'|'snapshot';clockSource:'worker-wall-clock'|'injected';actualFrameRate:number;}
export function implicitObservedFrameRate(value:unknown):number {
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw Error('隐式场景需要独立观察的有限实际帧率');return Math.fround(value);
}
export function validateSourceImplicitLiveContext(value:SourceImplicitLiveContext):void {
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.sessionId!=='string'||!value.sessionId.trim())throw Error('隐式继续播放的会话身份无效');
 validateSourceSceneClockRequest(value.clock);implicitObservedFrameRate(value.actualFrameRate);
}
