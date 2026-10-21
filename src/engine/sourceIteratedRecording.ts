import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import type {SceneDocument,SceneOutput} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {resolveOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {sourceIteratedLiveKind} from './sourceLivePreview';

export interface SourceIteratedRecordingFrame {
 readonly displayFrame:number;readonly warmup:boolean;readonly complete:boolean;
 readonly simulationFps:number;
}
/** Map and Symmetry inherit Scene.isAutoRecordingComplete. A replay or ongoing
 * parameter animator does not extend recording beyond manager.isFinished. */
export function planSourceIteratedRecording(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean):SourceQueueRecordingClock {
 if(isCancelled?.())throw new DOMException('迭代场景录制规划已取消','AbortError');
 const family=sourceIteratedLiveKind(scene),camera=ordinarySourceCameraInitial(scene);
 if(!family||!camera)throw Error('迭代场景录制需要完整源配置');
 if(!Number.isSafeInteger(simulationFps)||simulationFps<1||simulationFps>120)throw Error('录制模拟帧率必须为 1–120 的整数');
 const layout=resolveOrdinarySourceCameraTimeline(camera,scene.timeline.tracks,simulationFps,{particleActions:family==='map'?'map-parameters':'symmetry-parameters',isCancelled});
 const updates=Math.max(1,layout.updates);
 if((updates-1)/simulationFps>86400)throw Error('迭代场景录制超过本地 24 小时帧域');
 return{simulationFps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
}
export function assertSourceIteratedRecordingFrame(output:SceneOutput,clock:SourceQueueRecordingClock,displayFrame:number):void {
 const facts=output.type==='raster'?output.iteratedRecording:undefined;
 const live=output.type==='raster'?(output.mapLive??output.symmetryLive):undefined;
 if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame>clock.lastDisplayFrame||!facts||!live||
  facts.displayFrame!==displayFrame||facts.simulationFps!==clock.simulationFps||facts.warmup!==(displayFrame===0)||
  facts.complete!==(displayFrame===clock.lastDisplayFrame)||facts.complete!==live.queueComplete||live.clock!=='fixed-source-queue')throw Error('迭代场景录制帧与实际队列完成状态不一致');
}
