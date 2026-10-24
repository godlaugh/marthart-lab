import type {FractalFreshRecordingPlan} from './sourceFractalRecording';
import type {SourceRecordingClock} from './sourceRecordingClock';
import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { GenerationInput, GenerationStatus, SceneDocument, SceneOutput } from '../types';
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';

export type SourceRecordingRaster=Extract<SceneOutput,{type:'raster'}>;
export type SourceRecordingWireStart=Omit<SourceRecordingStart,'handle'|'warmup'>&{warmup:SceneOutput};
export interface SourceRecordingOptions {width:number;height:number;simulationFps:number;/** Domain, Surface and Implicit require the independently observed FPS for warmup. */actualFrameRate?:number;}
export interface SourceRecordingHandle {readonly sessionId:number;readonly recordingId:number;}
export interface SourceRecordingStart {handle:SourceRecordingHandle;scene:SceneDocument;context:GenerationInput;clock:SourceRecordingClock;warmup:SourceRecordingRaster;}
export interface SourceRecordingStop {scene:SceneDocument;context:GenerationInput;preview:SceneOutput;}
export type SourceRecordingOperation='source-recording-begin'|'source-recording-frame'|'source-recording-finish';
export function isSourceRecordingOperation(operation:string):operation is SourceRecordingOperation{return operation==='source-recording-begin'||operation==='source-recording-frame'||operation==='source-recording-finish';}
/** Retention is an acknowledgement from the current owner, never inferred from
 * an error message. A retained begin failure exposes its exact local handle so
 * callers can finish a recording whose warmup response could not be delivered. */
export class SourceRecordingOperationError extends Error {
 constructor(message:string,readonly previewRetained:boolean,readonly recordingRetained:boolean,readonly handle?:SourceRecordingHandle){super(message);this.name='SourceRecordingOperationError';}
}
/** A rejected live configuration may retain the exact completed numerical
 * instance. Only an owner-confirmed response grants this capability. */
export class FractalLiveGenerationError extends Error {
 constructor(message:string,readonly previewRetained:boolean){super(message);this.name='FractalLiveGenerationError';}
}
export class RootsLiveGenerationError extends Error {
 constructor(message:string,readonly previewRetained:boolean){super(message);this.name='RootsLiveGenerationError';}
}

export interface PausedCaptureSize {width:number;height:number;}
export interface PausedCaptureResult {capture:Extract<SceneOutput,{type:'raster'}>;preview:Extract<SceneOutput,{type:'raster'}>;}
export type RootsPausedCaptureSize=PausedCaptureSize;
export type RootsPausedCaptureResult=PausedCaptureResult;
export type PerlinPausedCaptureSize=PausedCaptureSize;
export type PerlinPausedCaptureResult=PausedCaptureResult;
export type PausedCaptureOperation='roots-paused-capture'|'perlin-paused-capture'|'samila-paused-capture'|'symmetry-paused-capture'|'map-paused-capture'|'fractal-paused-capture'|'domain-paused-capture';
export function isPausedCaptureOperation(operation:string):operation is PausedCaptureOperation{return operation==='roots-paused-capture'||operation==='perlin-paused-capture'||operation==='samila-paused-capture'||operation==='symmetry-paused-capture'||operation==='map-paused-capture'||operation==='fractal-paused-capture'||operation==='domain-paused-capture';}
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
export class SymmetryPausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='SymmetryPausedCaptureError';}
}
export class MapPausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='MapPausedCaptureError';}
}
export class FractalPausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='FractalPausedCaptureError';}
}
export class DomainPausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='DomainPausedCaptureError';}
}
export class SurfacePausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='SurfacePausedCaptureError';}
}
export type GeometryPausedCaptureOperation='surface-paused-capture'|'implicit-paused-capture';
export class ImplicitPausedCaptureError extends PausedCaptureError {
 constructor(message:string,previewRetained:boolean){super(message,previewRetained);this.name='ImplicitPausedCaptureError';}
}
/** The operation owns its label and error type across client and queue. */
export const pausedCaptureContracts={
 'implicit-paused-capture':{label:'隐式曲面',Error:ImplicitPausedCaptureError},
 'surface-paused-capture':{label:'曲面',Error:SurfacePausedCaptureError},
 'roots-paused-capture':{label:'复根',Error:RootsPausedCaptureError},
 'perlin-paused-capture':{label:'Perlin',Error:PerlinPausedCaptureError},
 'samila-paused-capture':{label:'Samila',Error:SamilaPausedCaptureError},
 'symmetry-paused-capture':{label:'Symmetry',Error:SymmetryPausedCaptureError},
 'map-paused-capture':{label:'Map',Error:MapPausedCaptureError},
 'domain-paused-capture':{label:'域着色',Error:DomainPausedCaptureError},
 'fractal-paused-capture':{label:'分形',Error:FractalPausedCaptureError},
} satisfies Record<PausedCaptureOperation|GeometryPausedCaptureOperation,{label:string;Error:new(message:string,retained:boolean)=>PausedCaptureError}>;

type IteratedPlaybackOperation='symmetry-playback'|'map-playback';
type IteratedPlaybackRequest={ [Operation in IteratedPlaybackOperation]:{operation:Operation;id:number;sourceId:number;paused:boolean;timestampMs?:number} }[IteratedPlaybackOperation];
type PausedCaptureRequest={ [Operation in PausedCaptureOperation]:{operation:Operation;id:number;sourceId:number;size:PausedCaptureSize;scale:1|3|5} }[PausedCaptureOperation];
export type GenerationRequest = { sessionId: number } & (
  | {operation:'surface-navigation';id:number;sourceId:number;event:import('./sourceViewportNavigation').SourceViewportNavigationEvent}
  | {operation:'implicit-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'surface-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'surface-parameter';id:number;sourceId:number;name:string;value:number}
  | {[O in GeometryPausedCaptureOperation]:{operation:O;id:number;sourceId:number;size:PausedCaptureSize;scale:1|3|5}}[GeometryPausedCaptureOperation]
  | {operation:'surface-current';id:number;sourceId:number}
  | {operation:'domain-navigation';id:number;sourceId:number;event:import('./sourceDomainLiveSession').SourceDomainNavigationEvent}
  | {operation:'domain-parameters';id:number;sourceId:number;scene:SceneDocument;writes:readonly (readonly [string,number])[]}
  | {operation:'iterated-navigation';id:number;sourceId:number;event:import('./sourceViewportNavigation').SourceViewportNavigationEvent}
  | { operation: 'generate'; id: number; scene: SceneDocument; context: GenerationInput; wantsStatus?:true }
  | {operation:'iterated-parameters';id:number;sourceId:number;scene:SceneDocument;writes:readonly (readonly [string,number])[]}
  | IteratedPlaybackRequest
  | {operation:'samila-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'roots-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'perlin-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'domain-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'fractal-playback';id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | PausedCaptureRequest
  | {operation:'source-recording-begin';id:number;sourceId:number;options:SourceRecordingOptions}
  | {operation:'source-recording-frame';id:number;recordingId:number;displayFrame:number;actualFrameRate?:number}
  | {operation:'source-recording-finish';id:number;recordingId:number;timestampMs?:number}
  | { operation: 'search-stable'; id: number; scene: SceneDocument; options: StableSearchOptions }
  | { operation: 'spirograph-recording-plan'; id:number; scene:SceneDocument; startFrame:number; fps:number }
  | { operation: 'fractal-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'perlin-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'roots-recording-plan'; id:number; scene:SceneDocument; simulationFps:number; encoderFps:number }
  | { operation: 'explore-complex'; id: number; scene: SceneDocument; options: ComplexExploreOptions });
export type GenerationPayload =
  | {operation:'surface-navigation';id:number;sourceId:number;output:SceneOutput}
  | {operation:'implicit-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'surface-playback';id:number;sourceId:number;paused:boolean;frame:import('./ordinarySourceCameraTimeline').OrdinarySourceCameraFrame}
  | {operation:'surface-parameter';id:number;sourceId:number}
  | {[O in GeometryPausedCaptureOperation]:{operation:O;id:number;sourceId:number;result:import('./sourceGeometryCapture').SourceGeometryCapturePreparation}}[GeometryPausedCaptureOperation]
  | {operation:'surface-current';id:number;sourceId:number;output:SceneOutput}
  | {operation:'domain-navigation';id:number;sourceId:number;output:SceneOutput}
  | {operation:'domain-parameters';id:number;sourceId:number}
  | {operation:'iterated-navigation';id:number;sourceId:number;output:SceneOutput}
  | {operation:'iterated-parameters';id:number;sourceId:number}
  | {operation:IteratedPlaybackOperation;id:number;sourceId:number;paused:boolean;timestampMs?:number}
  | {operation:'samila-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'roots-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'perlin-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'domain-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'fractal-playback';id:number;sourceId:number;paused:boolean}
  | {operation:'source-recording-begin';id:number;recordingId:number;result:SourceRecordingWireStart}
  | {operation:'source-recording-frame';id:number;recordingId:number;displayFrame:number;output:SceneOutput}
  | {operation:'source-recording-finish';id:number;recordingId:number;result:SourceRecordingStop}
  | { operation: 'generate'; id: number; output: SceneOutput }
  | { operation: PausedCaptureOperation; id:number; result:PausedCaptureResult }
  | { operation: 'generate-progress'; id: number; output: SceneOutput }
  | { operation: 'generate-status'; id: number; status: GenerationStatus }
  | { operation: 'search-stable'; id: number; result: StableSearchResult }
  | { operation: 'spirograph-recording-plan'; id:number; result:SpirographRecordingPlan }
  | { operation: 'fractal-recording-plan'; id:number; result:FractalFreshRecordingPlan }
  | { operation: 'perlin-recording-plan'; id:number; result:PerlinFreshRecordingPlan }
  | { operation: 'roots-recording-plan'; id:number; result:RootsFreshRecordingPlan }
  | { operation: 'search-stable'; id: number; progress: StableSearchProgress }
  | { operation: 'explore-complex'; id: number; result: ComplexExploreResult }
  | { operation: 'explore-complex'; id: number; progress: ComplexExploreProgress }
  | {operation:GenerationRequest['operation'];id:number;error:string;retainedSourceId?:number;retainedRecordingId?:number};
export type GenerationResponse = GenerationPayload & { sessionId: number };
