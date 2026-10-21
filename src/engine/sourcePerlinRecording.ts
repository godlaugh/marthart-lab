import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import type {SceneDocument,SceneOutput} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {ORDINARY_CAMERA_SEQUENCE,resolveOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {parseSourcePerlinDocument} from './sourcePerlinDocument';

export class SourcePerlinRecordingError extends Error {
 constructor(readonly code:'input'|'cancelled'|'state'|'capacity',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinRecordingError';}
}
/** This local mode applies the current document to a fresh export session. It
 * does not reproduce MathArt's last-applied snapshot or retained framebuffer.
 * Keep it separate from a future live-instance recording operation. */
export function withPerlinFreshRecording(scene:SceneDocument,simulationFps:number):SceneDocument {
 if(scene.kind!=='perlin'||!scene.perlinSource||scene.timeline.schedule!==ORDINARY_CAMERA_SEQUENCE||!ordinarySourceCameraInitial(scene))
  throw new SourcePerlinRecordingError('input','Perlin 源队列重放需要完整配置和原版顺序时间线');
 const config=parseSourcePerlinDocument(scene.perlinSource);
 if(!config.ok)throw new SourcePerlinRecordingError('input',`Perlin ${config.error.path.join('.')}: ${config.error.reason}`);
 if(!Number.isSafeInteger(simulationFps)||simulationFps<1||simulationFps>120)
  throw new SourcePerlinRecordingError('input','Perlin 录制模拟帧率必须为 1–120 的整数');
 return {...scene,timeline:{...scene.timeline,fps:simulationFps}};
}
export interface PerlinFreshRecordingPlan extends SourceQueueRecordingClock {
 readonly policy:'fresh-local-source-queue-replay';readonly encoderFps:number;
}
/** Scene.isAutoRecordingComplete inherits manager.isFinished. MathArt.draw
 * updates, renders, discards its one warmup (or encodes), THEN tests completion.
 * The clock owns float32 folding and one-child-per-frame advancement. This
 * scalar plan does not choose a configuration snapshot or framebuffer lifetime. */
export function planPerlinRecordingClock(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean):SourceQueueRecordingClock {
 if(isCancelled?.())throw new SourcePerlinRecordingError('cancelled','Perlin 录制规划已取消');
 const configured=withPerlinFreshRecording(scene,simulationFps);
 const layout=resolveOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(configured)!,configured.timeline.tracks,simulationFps,{particleActions:'perlin',isCancelled});
 const updates=Math.max(1,layout.updates);
 if((updates-1)/simulationFps>86400)throw new SourcePerlinRecordingError('capacity','Perlin 录制规划超过本地 24 小时帧域');
 return {simulationFps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
}
export function planPerlinFreshRecording(scene:SceneDocument,options:{simulationFps:number;encoderFps:number;isCancelled?:()=>boolean}):PerlinFreshRecordingPlan {
 if(options.isCancelled?.())throw new SourcePerlinRecordingError('cancelled','Perlin 录制规划已取消');
 if(!Number.isSafeInteger(options.encoderFps)||options.encoderFps<1||options.encoderFps>120)
  throw new SourcePerlinRecordingError('input','Perlin 视频编码帧率必须为 1–120 的整数');
 return {...planPerlinRecordingClock(scene,options.simulationFps,options.isCancelled),policy:'fresh-local-source-queue-replay',encoderFps:options.encoderFps};
}
/** Validate facts from the actual retained render, including the discarded
 * warmup. Never turn a prediction into permission to encode a missing frame. */
export function assertPerlinRecordingFrame(output:SceneOutput,plan:SourceQueueRecordingClock,displayFrame:number):void {
 const frame=output.type==='raster'?output.sourcePerlinFrame:undefined;
 if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame>plan.lastDisplayFrame||!frame||
  frame.frameIndex!==displayFrame||frame.queueComplete!==(displayFrame===plan.lastDisplayFrame))
  throw new SourcePerlinRecordingError('state','Perlin 录制帧与实际队列完成状态不一致');
}
