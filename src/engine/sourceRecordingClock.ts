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
 if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isFinite(simulationFps)||simulationFps<1||simulationFps>120)return false;const clock=value as SourceQueueRecordingClock;
 return clock.simulationFps===simulationFps&&clock.warmupUpdates===1&&clock.completionReason==='animation-queue'&&Number.isSafeInteger(clock.updates)&&clock.updates>=1&&clock.lastDisplayFrame===clock.updates-1&&clock.encodedFrames===clock.lastDisplayFrame&&clock.firstEncodedUpdate===(clock.encodedFrames?2:null)&&clock.lastDisplayFrame/simulationFps<=86400;
}

/** Asynchronous producers cannot predict their completion ordinal. Only a
 * successfully displayed frame can establish it, including the warmup. */
export interface SourceObservedRecordingClock {
 readonly simulationFps:number;readonly warmupUpdates:1;
 readonly completionReason:'observed-roots-display';
}
export type SourceRecordingClock=SourceQueueRecordingClock|SourceObservedRecordingClock;
export function validSourceObservedRecordingClock(value:unknown,simulationFps:number):value is SourceObservedRecordingClock {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Number.isSafeInteger(simulationFps)&&simulationFps>=1&&simulationFps<=120&&v.simulationFps===simulationFps&&v.warmupUpdates===1&&v.completionReason==='observed-roots-display'&&!['updates','encodedFrames','lastDisplayFrame','firstEncodedUpdate'].some(key=>key in v);
}
