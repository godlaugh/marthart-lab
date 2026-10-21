/** Shared MathArt host recording ordinals. Scene-specific completion planning
 * must establish the final update; a plan never substitutes for a real frame. */
export interface SourceQueueRecordingClock {
 readonly simulationFps:number;readonly warmupUpdates:1;readonly updates:number;
 readonly encodedFrames:number;readonly firstEncodedUpdate:2|null;readonly lastDisplayFrame:number;
 readonly completionReason:'animation-queue';
}
