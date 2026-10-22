/** Shared MathArt host recording ordinals. Scene-specific completion planning
 * must establish the final update; a plan never substitutes for a real frame. */
export interface SourceQueueRecordingClock {
 readonly simulationFps:number;readonly warmupUpdates:1;readonly updates:number;
 readonly encodedFrames:number;readonly firstEncodedUpdate:2|null;readonly lastDisplayFrame:number;
 readonly completionReason:'animation-queue';
}

/** Validate reported ordinals without replaying or replanning the producer's
 * scene. Completion of each delivered frame must still agree with this clock. */
export function validSourceQueueRecordingClock(value:unknown,simulationFps:number):value is SourceQueueRecordingClock {
 if(!value||typeof value!=='object')return false;const clock=value as SourceQueueRecordingClock;
 return clock.simulationFps===simulationFps&&clock.warmupUpdates===1&&clock.completionReason==='animation-queue'&&Number.isSafeInteger(clock.updates)&&clock.updates>=1&&clock.lastDisplayFrame===clock.updates-1&&clock.encodedFrames===clock.lastDisplayFrame&&clock.firstEncodedUpdate===(clock.encodedFrames?2:null)&&clock.lastDisplayFrame/simulationFps<=86400;
}
