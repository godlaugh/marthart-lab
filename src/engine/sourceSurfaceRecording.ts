import type {SceneDocument,SceneOutput} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {resolveOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {usesSourceSurfaceGeometry,usesSourceSurfaceHost} from './sourceSurfaceIdentity';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
export interface SourceSurfaceRecordingFrame {
 readonly displayFrame:number;readonly warmup:boolean;readonly complete:boolean;
 readonly simulationFps:number;readonly actualFrameRate:number;
}
/** Inherited Scene.isAutoRecordingComplete follows the animation manager, not
 * parameter animators. Plan only the ordinals, never a numerical/GPU frame. */
export function planSourceSurfaceRecording(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean):SourceQueueRecordingClock {
 if(isCancelled?.())throw new DOMException('曲面录制规划已取消','AbortError');
 if(!usesSourceSurfaceGeometry(scene))throw Error('曲面录制需要完整源配置');
 const camera=ordinarySourceCameraInitial(scene);
 if(!camera)throw Error('曲面录制需要完整源配置');
 if(!Number.isSafeInteger(simulationFps)||simulationFps<1||simulationFps>120)throw Error('曲面录制模拟帧率必须为 1–120 的整数');
 const layout=resolveOrdinarySourceCameraTimeline(camera,scene.timeline.tracks,simulationFps,{particleActions:'surface',surfaceMode:usesSourceSurfaceHost(scene)?scene.surfaceSource!.mode:undefined,isCancelled});
 const updates=Math.max(1,layout.updates);
 if((updates-1)/simulationFps>86400)throw Error('曲面录制超过本地 24 小时帧域');
 return{simulationFps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
}
export function assertSourceSurfaceRecordingFrame(output:SceneOutput,clock:SourceQueueRecordingClock,displayFrame:number):void {
 const live=output.type==='geometry'?output.surfaceLive:undefined,record=live?.recording;
 if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame>clock.lastDisplayFrame||!live||live.paused||live.renderKind!=='update'||live.clockSource!=='fixed-step'||!record||output.sourceCameraFrame?.viewport.target!=='offscreen'||record.displayFrame!==displayFrame||record.simulationFps!==clock.simulationFps||!Number.isFinite(record.actualFrameRate)||record.warmup!==(displayFrame===0)||record.complete!==(displayFrame===clock.lastDisplayFrame)||record.complete!==live.frame.queueComplete||live.frame.frameIndex!==displayFrame)throw Error('曲面录制帧与实际队列完成状态不一致');
}
