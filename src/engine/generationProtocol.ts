import type {PerlinFreshRecordingPlan,PerlinRecordingClock} from './sourcePerlinRecording';
import type { GenerationInput, GenerationStatus, SceneDocument, SceneOutput } from '../types';
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';

export type PerlinRecordingRaster=Extract<SceneOutput,{type:'raster'}>;
export interface PerlinRecordingOptions {width:number;height:number;simulationFps:number;}
export interface PerlinRecordingHandle {readonly sessionId:number;readonly recordingId:number;}
export interface PerlinRecordingStart {handle:PerlinRecordingHandle;scene:SceneDocument;context:GenerationInput;clock:PerlinRecordingClock;warmup:PerlinRecordingRaster;}
export interface PerlinRecordingStop {scene:SceneDocument;context:GenerationInput;preview:PerlinRecordingRaster;}
export type PerlinRecordingOperation='perlin-recording-begin'|'perlin-recording-frame'|'perlin-recording-finish';
export function isPerlinRecordingOperation(operation:string):operation is PerlinRecordingOperation{return operation==='perlin-recording-begin'||operation==='perlin-recording-frame'||operation==='perlin-recording-finish';}
/** Retention is an acknowledgement from the current owner, never inferred from
 * an error message. A retained begin failure exposes its exact local handle so
 * callers can finish a recording whose warmup response could not be delivered. */
export class PerlinRecordingOperationError extends Error {
 constructor(message:string,readonly previewRetained:boolean,readonly recordingRetained:boolean,readonly handle?:PerlinRecordingHandle){super(message);this.name='PerlinRecordingOperationError';}
}

export interface PausedCaptureSize {width:number;height:number;}
export interface PausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:Extract<SceneOutput,{type:'raster'}>;}
export type RootsPausedCaptureSize=PausedCaptureSize;
export type RootsPausedCaptureResult=PausedCaptureResult;
export type PerlinPausedCaptureSize=PausedCaptureSize;
export type PerlinPausedCaptureResult=PausedCaptureResult;
export type PausedCaptureOperation='roots-paused-capture'|'perlin-paused-capture'|'samila-paused-capture';
export function isPausedCaptureOperation(operation:string):operation is PausedCaptureOperation{return operation==='roots-paused-capture'||operation==='perlin-paused-capture'||operation==='samila-paused-capture';}
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
export class SamilaPausedCaptureError extends PausedCaptureError {
  constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='SamilaPausedCaptureError';}
}
/** The operation owns its label and error type across client and queue. */
export const pausedCaptureContracts={
 'roots-paused-capture':{label:'复根',Error:RootsPausedCaptureError},
 'perlin-paused-capture':{label:'Perlin',Error:PerlinPausedCaptureError},
 'samila-paused-capture':{label:'Samila',Error:SamilaPausedCaptureError},
} satisfies Record<PausedCaptureOperation,{label:string;Error:new(message:string,retained:boolean)=>PausedCaptureError}>;

type PausedCaptureRequest={ [Operation in PausedCaptureOperation]:{operation:Operation;id:number;sourceId:number;size:PausedCaptureSize;scale:1|3|5} }[PausedCaptureOperation];
export type GenerationRequest = { sessionId: number } & (
  | { operation: 'generate'; id: number; scene: SceneDocument; context: GenerationInput; wantsStatus?:true }
  | {operation:'samila-playback';id:number;sourceId:number;paused:boolean}
  | PausedCaptureRequest
  | {operation:'perlin-recording-begin';id:number;sourceId:number;options:PerlinRecordingOptions}
  | {operation:'perlin-recording-frame';id:number;recordingId:number;displayFrame:number}
  | {operation:'perlin-recording-finish';id:number;recordingId:number}
  | { operation: 'search-stable'; id: number; scene: SceneDocument; options: StableSearchOptions }
  | { operation: 'spirograph-recording-plan'; id:number; scene:SceneDocument; startFrame:number; fps:number }
  | { operation: 'perlin-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'roots-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'explore-complex'; id: number; scene: SceneDocument; options: ComplexExploreOptions });
export type GenerationPayload =
  | {operation:'samila-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'perlin-recording-begin';id:number;recordingId:number;result:Omit<PerlinRecordingStart,'handle'>}
  | {operation:'perlin-recording-frame';id:number;recordingId:number;displayFrame:number;output:PerlinRecordingRaster}
  | {operation:'perlin-recording-finish';id:number;recordingId:number;result:PerlinRecordingStop}
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
  | {operation:GenerationRequest['operation'];id:number;error:string;retainedSourceId?:number;retainedRecordingId?:number};
export type GenerationResponse = GenerationPayload & { sessionId: number };
