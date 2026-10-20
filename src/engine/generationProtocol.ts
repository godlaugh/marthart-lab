import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { GenerationInput, GenerationStatus, SceneDocument, SceneOutput } from '../types';
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';

export interface PausedCaptureSize {width:number;height:number;}
export interface PausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:Extract<SceneOutput,{type:'raster'}>;}
export type RootsPausedCaptureSize=PausedCaptureSize;
export type RootsPausedCaptureResult=PausedCaptureResult;
export type PerlinPausedCaptureSize=PausedCaptureSize;
export type PerlinPausedCaptureResult=PausedCaptureResult;
export type PausedCaptureOperation='roots-paused-capture'|'perlin-paused-capture';
export function isPausedCaptureOperation(operation:string):operation is PausedCaptureOperation{return operation==='roots-paused-capture'||operation==='perlin-paused-capture';}
/** Only the owning worker can confirm that a rejected capture retained its
 * completed preview. Message text or an input/capacity error tag is not proof. */
export class PausedCaptureError extends Error {
  constructor(message:string,readonly previewRetained:boolean){super(message);this.name='PausedCaptureError';}
}
export class RootsPausedCaptureError extends PausedCaptureError {
  constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='RootsPausedCaptureError';}
}
export class PerlinPausedCaptureError extends PausedCaptureError {
  constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='PerlinPausedCaptureError';}
}

type PausedCaptureRequest={ [Operation in PausedCaptureOperation]:{operation:Operation;id:number;sourceId:number;size:PausedCaptureSize;scale:1|3|5} }[PausedCaptureOperation];
export type GenerationRequest = { sessionId: number } & (
  | { operation: 'generate'; id: number; scene: SceneDocument; context: GenerationInput; wantsStatus?:true }
  | PausedCaptureRequest
  | { operation: 'search-stable'; id: number; scene: SceneDocument; options: StableSearchOptions }
  | { operation: 'spirograph-recording-plan'; id:number; scene:SceneDocument; startFrame:number; fps:number }
  | { operation: 'perlin-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'roots-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'explore-complex'; id: number; scene: SceneDocument; options: ComplexExploreOptions });
export type GenerationPayload =
  | { operation: 'generate'; id: number; output: SceneOutput }
  | { operation: PausedCaptureOperation; id:number; result:PausedCaptureResult }
  | { operation: 'generate-progress'; id: number; output: SceneOutput }
  | { operation: 'generate-status'; id: number; status: GenerationStatus }
  | { operation: 'search-stable'; id: number; result: StableSearchResult }
  | { operation: 'spirograph-recording-plan'; id:number; result:SpirographRecordingPlan }
  | { operation: 'perlin-recording-plan'; id:number; result:PerlinFreshRecordingPlan }
  | { operation: 'roots-recording-plan'; id:number; result:RootsFreshRecordingPlan }
  | { operation: 'search-stable'; id: number; progress: StableSearchProgress }
  | { operation: 'explore-complex'; id: number; result: ComplexExploreResult }
  | { operation: 'explore-complex'; id: number; progress: ComplexExploreProgress }
  | { operation:PausedCaptureOperation;id:number;error:string;retainedSourceId?:number }
  | { operation: Exclude<GenerationRequest['operation'],PausedCaptureOperation>; id: number; error: string };
export type GenerationResponse = GenerationPayload & { sessionId: number };
