import type {RootsOrdinalCompletionFacts,RootsPendingCompletionFacts} from './rootsRecording';
import type {RootsPendingStreamFacts} from './rootsPendingStream';
import type {RootsMatrixReferenceViewport} from './rootsProjection';
import type {RootsCameraState,RootsSceneGradientFrame} from './rootsSceneClock';
/** Delivered execution facts, never authored or reused as configuration. */
export interface RootsPresentationFacts {
 model:'mathart-1.7.8-v1';
 mode:'density'|'point-cloud';
 clockPolicy:'local-fixed-sample-clock-v1'|'source-live-clock-v1';
 streamPolicy:'global-ordinal'|'worker-arrival';
 presentationAlpha:'opaque-framebuffer-rgb'|'preserved-framebuffer-rgba';
 instance:number;
 restartReason:'initial'|'document'|'math'|'mode'|'timeline'|'camera'|'gradient'|'pending-policy'|'backward-seek'|null;
 attemptedSamples:number;newSamples:number;newRawPoints:number;totalRawPoints:number;
 physicalSize:readonly[number,number];logicalSize:readonly[number,number];
 referenceLogicalHeight:number;target:'primary'|'offscreen';
 /** Present only on the explicit paused capture pair; ordinary generations
  * keep their prior facts. Both frames retain the same math/clock instance. */
 pausedCapture?:{policy:'same-instance-render-only-v1';role:'capture'|'preview-refresh';baseScale:1;clockAdvanced:false;samplesGenerated:0|null;arrivals:'local-no-pending'|'retained-local-pending'|'concurrent-pending';primarySize:readonly[number,number]};
 pending?:RootsPendingStreamFacts;
 autoRecording?:RootsOrdinalCompletionFacts|RootsPendingCompletionFacts;
 cameraTimeline?:{
  model:'roots-camera-sequence-v1'|'roots-scene-sequence-v1';replay:'offline-fixed-dt-from-zero';fps:number;
  frame:number;completedFrames:number;sampleTime:number;framesAdvanced:number;readbacks:number;
  rawDt:number;activeDt:number;sceneTime:number;queueIndex:number;queueComplete:boolean;
  gradient?:RootsSceneGradientFrame;managerFinishedAtFrameStart?:boolean;
  camera:RootsCameraState;rates:readonly[number,number,number];
  displayFrames:number;inkClears:number;
 };
 density?:{submittedFinitePointCount:number;kernel:'points'|'quad'|undefined;capture:boolean;clearInk:boolean;clearReasons:readonly string[];displayRotation:number;matrixReferenceViewport:RootsMatrixReferenceViewport};
 pointCloud?:{retainedPoints:number;drawnPoints:number;totalWrites:string;accumulationEnabled:boolean;fadeAlpha:number};
}
