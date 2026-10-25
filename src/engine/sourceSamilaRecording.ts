import type {SceneDocument,SceneOutput} from '../types';
import {sourceSamilaRecordingLayout} from './sourceSamilaReplay';
import {validSourceQueueRecordingClock,type SourceQueueRecordingClock} from './sourceRecordingClock';

/** Facts belong to the successfully acknowledged display, never its plan. */
export interface SourceSamilaRecordingFrame {
 readonly displayFrame:number;readonly simulationFps:number;readonly warmup:boolean;
 readonly complete:boolean;readonly queueIndex:number;readonly sceneTime:number;
 readonly pixels:'raw-present-target-rgba8';
}
export function planSamilaRecordingClock(scene:SceneDocument,simulationFps:number):SourceQueueRecordingClock {
 if(!Number.isSafeInteger(simulationFps)||simulationFps<1||simulationFps>120)throw Error('Samila 录制模拟帧率必须为 1–120 的整数');
 const updates=Math.max(1,sourceSamilaRecordingLayout(scene,simulationFps).updates);
 const clock:SourceQueueRecordingClock={simulationFps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
 if(!validSourceQueueRecordingClock(clock,simulationFps))throw Error('Samila 录制超过 24 小时帧域');return clock;
}
export function assertSourceSamilaRecordingFrame(output:SceneOutput,clock:SourceQueueRecordingClock,displayFrame:number):void {
 const facts=output.type==='raster'?output.samilaRecording:undefined,live=output.type==='raster'?output.samilaLive:undefined;
 if(!validSourceQueueRecordingClock(clock,clock.simulationFps)||!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame>clock.lastDisplayFrame||output.type!=='raster'||
  !(output.pixels instanceof Uint8ClampedArray)||output.pixels.byteLength!==output.width*output.height*4||!facts||!live?.runtime||live.target!=='offscreen'||
  facts.displayFrame!==displayFrame||facts.simulationFps!==clock.simulationFps||facts.warmup!==(displayFrame===0)||facts.complete!==(displayFrame===clock.lastDisplayFrame)||
  live.clock!=='fixed-source-queue'||live.runtime.clockSource!=='fixed-step'||live.runtime.paused||live.runtime.rawDt!==Math.fround(1/clock.simulationFps)||live.runtime.updates!==displayFrame+1||
  facts.pixels!=='raw-present-target-rgba8'||facts.complete!==live.runtime.queueComplete||facts.queueIndex!==live.runtime.queueIndex||facts.sceneTime!==live.runtime.sceneTime||
  !Number.isSafeInteger(facts.queueIndex)||facts.queueIndex<0||!Number.isFinite(facts.sceneTime))throw Error('Samila 录制帧与实际队列或原始 RGBA 不一致');
}
