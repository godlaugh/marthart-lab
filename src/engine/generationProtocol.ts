import type { GenerationInput, GenerationStatus, SceneDocument, SceneOutput } from '../types';
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';

export interface RootsPausedCaptureSize {width:number;height:number;}
export interface RootsPausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:Extract<SceneOutput,{type:'raster'}>;}
/** Only the owning worker can confirm that a rejected capture retained its
 * completed preview. Message text or an input/capacity error tag is not proof. */
export class RootsPausedCaptureError extends Error {
  constructor(message:string,readonly previewRetained:boolean){super(message);this.name='RootsPausedCaptureError';}
}

export type GenerationRequest = { sessionId: number } & (
  | { operation: 'generate'; id: number; scene: SceneDocument; context: GenerationInput; wantsStatus?:true }
  | { operation: 'roots-paused-capture'; id:number; sourceId:number; size:RootsPausedCaptureSize; scale:1|3|5 }
  | { operation: 'search-stable'; id: number; scene: SceneDocument; options: StableSearchOptions }
  | { operation: 'spirograph-recording-plan'; id:number; scene:SceneDocument; startFrame:number; fps:number }
  | { operation: 'roots-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'explore-complex'; id: number; scene: SceneDocument; options: ComplexExploreOptions });
export type GenerationPayload =
  | { operation: 'generate'; id: number; output: SceneOutput }
  | { operation: 'roots-paused-capture'; id:number; result:RootsPausedCaptureResult }
  | { operation: 'generate-progress'; id: number; output: SceneOutput }
  | { operation: 'generate-status'; id: number; status: GenerationStatus }
  | { operation: 'search-stable'; id: number; result: StableSearchResult }
  | { operation: 'spirograph-recording-plan'; id:number; result:SpirographRecordingPlan }
  | { operation: 'roots-recording-plan'; id:number; result:RootsFreshRecordingPlan }
  | { operation: 'search-stable'; id: number; progress: StableSearchProgress }
  | { operation: 'explore-complex'; id: number; result: ComplexExploreResult }
  | { operation: 'explore-complex'; id: number; progress: ComplexExploreProgress }
  | { operation:'roots-paused-capture';id:number;error:string;retainedSourceId?:number }
  | { operation: Exclude<GenerationRequest['operation'],'roots-paused-capture'>; id: number; error: string };
export type GenerationResponse = GenerationPayload & { sessionId: number };
