import type {SourceSurfaceGpuMeshFrame} from './engine/sourceSurfaceGpuMesh';
import type {SourceSurfaceGpuPointFrame} from './engine/sourceSurfaceGpuPoints';
import type {SourceSurfacePointAppearance} from './engine/sourceSurfacePointAppearance';
import type {SourceSurfaceMeshAppearance} from './engine/sourceSurfaceMeshRenderer';
import type {SourceSurfaceMeshWireframeFrame} from './engine/sourceSurfaceMeshWireframe';
import type {SourceSurfaceMeshConfiguration} from './engine/sourceSurfaceMeshConfig';
import type {SourceSurfacePalette} from './engine/sourceSurfaceColor';
import type {SourceCameraInput,SourceCameraViewport} from './engine/sourceCamera';
import type {OrdinarySourceCameraEvaluation,OrdinarySourceCameraFrame} from './engine/ordinarySourceCamera';
import type {FractalSourceFrameFacts} from './engine/fractalSourceFrame';
import type {FractalSourceColorConfiguration,FractalSourcePaletteRuntime} from './engine/fractalSourceColor';
import type {PreparedSamilaView} from './engine/samilaCamera';
import type {DomainRenderFacts} from './engine/domainRenderPolicy';
import type {SpirographReplayFrame} from './engine/spirographReplay';
import type {RootsPresentationConfiguration,RootsViewportRequest} from './engine/rootsPresentationConfig';
import type {RootsPresentationFacts} from './engine/rootsPresentationFacts';
import type {RootsSceneFrame} from './engine/rootsSceneClock';
import type {ProjectResolution} from './engine/projectResolution';
export type SceneKind =
  | "surface"
  | "attractor"
  | "map"
  | "implicit"
  | "fractal"
  | "domain"
  | "symmetry"
  | "perlin"
  | "spirograph"
  | "bouncing"
  | "samila"
  | "roots";
export type Settings = Record<string, number | string | boolean>;
export type RootParameterDomain = 'UNIT_CIRCLE' | 'REAL_RANGE' | 'COMPLEX_RECT' | 'FIXED';
/** Serialized in settings.rootParameters; parsed exclusively by rootParameters.ts. */
export interface RootParameter {
  name: string;
  domain: RootParameterDomain;
  minRe: number; maxRe: number; minIm: number; maxIm: number;
  value: [number, number];
}
/** Source-authored definitions preserve raw names and range order. These are
 * not legacy RootParameter identifiers; the native owner resolves bindings. */
export interface RootNativeParameter {
  name: string;
  domain: RootParameterDomain;
  minRe: number; maxRe: number; minIm: number; maxIm: number;
  value: [number, number];
}
/** Omission preserves the original local implementation. local-v1 retains this
 * payload dormant so changing rules never destroys the other authored family. */
export type RootNativeVariable = string | {sourceValue:unknown;numberToken?:string} | {sourceJson:string};
export interface RootsMathConfiguration {
  model: 'local-v1' | 'mathart-1.7.8-v1';
  polynomial: {variable:RootNativeVariable;coefficients:{exponent:string;expression:string}[]};
  parameters: RootNativeParameter[];
  solver: {maxIterations:number;tolerance:number};
  sampling: {sampleCount:number;batchSize:number;workerCount:number;seed:string;filter:string};
}
export type RGB = [number, number, number];
export interface PaletteCurvePoint { x: number; y: number }
export interface CosinePalette { a: RGB; b: RGB; c: RGB; d: RGB }
export interface PaletteCurves { red: PaletteCurvePoint[]; green: PaletteCurvePoint[]; blue: PaletteCurvePoint[] }
export interface Palette {
  name: string;
  stops: string[];
  /** Optional strictly increasing normalized locations, including 0 and 1. */
  positions?: number[];
  mode: "linear" | "sine" | "cosine" | "hsv" | "curve";
  /** HSV here interpolates manual stops; legacy mode=hsv remains the color wheel. */
  interpolation?: "rgb" | "hsv";
  cosine?: CosinePalette;
  curves?: PaletteCurves;
  offset: number;
  cycles: number;
}
/** Authored source palette, separate from the richer local palette. Strings,
 * order, alpha and cardinality are retained; the Domain color owner parses them. */
export interface DomainSourcePalette { colors: string[] }
/** Authored Roots colors retain source spelling and order; no derived LUT. */
export interface RootsSourcePalette { colors: string[] }
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  orthographic: boolean;
  zoom: number;
  autoFit?: boolean;
}
/** Runtime-only camera facts produced by timeline evaluation; never persisted. */
export interface EvaluatedCamera {model:'mandelbulb';time:number;camera:CameraState;roll:number;focalLength:number;rayScale:number;}
/** Producer-resolved camera for an actual generated frame; never authored state. */
export interface CameraFrame {time:number;camera:CameraState;roll:number;focalLength:number;}
export interface ParticleCameraRequest {time:number;index:number;}
export type ParticleCameraSample = {status:'available';particleId:number;position:[number,number,number]} | {status:'out-of-range'|'unavailable';particleId?:number};
export interface FormulaStyle {visible:boolean;x:number;y:number;scale:number;color:string;anchor?:'top-left'|'center';}
export interface FormulaLabel extends FormulaStyle {id:string;latex:string;}
export interface FormulaConfig {referenceWidth:number;referenceHeight:number;main:FormulaStyle&{latex?:string};additional:FormulaLabel[];}
export type AnimationClipType = "numeric" | "wait" | "animate" | "align" | "trails" | "param" | "fractal_zoom" | "surface_mode_transition" | "spirograph_finish_wait";
export interface OscillationEdgeEasing {window:number;floor:number;easing:string;}
export interface ParameterAnimation {
  /** Omitted keeps local radians/second and ordered bounds. The explicit
   * source Domain model retains raw min/max and signed units/frame at 60 Hz. */
  model?: "domain-1.7.8";
  target: string; min: number; max: number; step: number; enabled: boolean; phase?: number; edgeEasing?:OscillationEdgeEasing;
  binding?:{mode:"complex-full";imaginaryTarget:string}; round?:boolean;
}
export interface GradientAnimation {
  /** Omitted preserves existing stop-based artwork. Offsets animate the
   * independent fractal fields or the Domain target's sole paletteOffset. */
  model?: "palette" | "offsets";
  affectInside?: boolean; affectOutside?: boolean;
  mode: "offset_cycle" | "hue_rotate" | "palette_morph" | "cross_fade";
  speed: number; interpolation: "rgb" | "linear" | "oklab" | "oklch";
  fromStops?: string[]; toStops?: string[];
}
/** Timeline-owned sampling state. It is rebuilt for a seek and never saved. */
export interface EvaluatedDomainGradient {running:boolean;interpolation:GradientAnimation['interpolation'];}
/** Exact source parameter identity. It is never encoded as a dotted UI target. */
export type DomainParameterAction = {
  model:'domain-registry-1.7.8';
  scope:{kind:'all'} | {kind:'named';name:string};
  configuration?:{min:number;max:number;step:number;edgeEasing?:OscillationEdgeEasing};
};
/** Source Surface identities are names, never dotted local animation targets. */
export interface SourceSurfaceParameterConfiguration {min:number;max:number;step:number;edgeEasing:OscillationEdgeEasing;}
export type SourceSurfaceParameterAction = {
  model:'surface-registry-1.7.8';
  scope:{kind:'all'}|{kind:'named';name:string};
  configuration?:SourceSurfaceParameterConfiguration;
};
export interface SourceSurfaceParameterClip {
  model:'surface-registry-1.7.8';
  /** Standalone clips replace the registry, retaining disabled entries and
   * the animator's separate null-edge default. */
  parameters:{name:string;min:number;max:number;step:number;enabled:boolean}[];
}
export interface AnimationAction {
  id: string; method: string; enabled?: boolean;
  args?: Record<string, number | string | boolean>;
  parameters?: ParameterAnimation[]; gradient?: GradientAnimation;
  /** Ordered source operations within this action; All is one registry operation. */
  domainParameters?:DomainParameterAction[];
  surfaceParameters?:SourceSurfaceParameterAction[];
}
export interface AnimationTrack {
  id: string;
  target: string;
  from: number;
  to: number;
  start: number;
  duration: number;
  easing: string;
  pingPong: boolean;
  enabled: boolean;
  type?: AnimationClipType;
  label?: string;
  repeat?: number;
  fromCurrent?: boolean;
  round?: boolean;
  actions?: AnimationAction[];
  parameterAnimations?: ParameterAnimation[];
  surfaceParameterClip?:SourceSurfaceParameterClip;
  parameterClock?: "elapsed" | "eased";
  replaceParameters?:boolean;
  orientation?: { theta?: number; phi?: number; gamma?: number };
  alignMode?: "absolute" | "next-turn";
  keyframes?: { time: number; centerX: number; centerY: number; centerXLow?: number; centerYLow?: number; zoom: number; easing?: string }[];
  interpolation?: "linear" | "exponential";
  gradient?: GradientAnimation;
  surfaceMode?: "points" | "mesh";
  surfaceFadeOutRatio?: number;
  trailsEnabled?: boolean;
  /** Omitted preserves the saved automatic closure estimate. Explicit waits
   * end at visible completion or at their authored maximum duration. */
  spirographWait?: 'visual-or-deadline-v1';
}
export interface SamilaViewportTransform {scaleX:number;scaleY:number;offsetX:number;offsetY:number;}
export interface RuntimeSamilaViewport extends SamilaViewportTransform {
  model:"samila-runtime-viewport-v1"; baselineKey:string; revision:number; at:number;
  bounds:DensityBounds;
}
/** Ordered authored input; the last command assigned to one update wins. */
export interface SpirographFrameEvent {beforeFrame:number;type:'clear'|'restart'|'finish';}
/** Update identity is independent of presentation seconds and encoder FPS. */
export interface SpirographFrameRequest {
  frame:number;
  /** Capture a deterministic preview checkpoint, then advance with a new fixed
   * recording step. frame is relative to this recording's initial state. */
  recording?:{startFrame:number;fps:number};
}
export interface SceneDocument {
  /** Explicit project canvas dimensions; omission retains existing sizing. */
  projectResolution?: ProjectResolution;
  domainSourcePalette?: DomainSourcePalette;
  /** Independent authored source colors. The profile selects execution;
   * switching to local keeps this configuration available for restoration. */
  fractalSourceColor?: FractalSourceColorConfiguration;
  rootsSourcePalette?: RootsSourcePalette;
  surfaceSourcePalette?: SourceSurfacePalette;
  /** Canonical source mesh settings, independent of local mesh controls. */
  surfaceSource?: SourceSurfaceMeshConfiguration;
  rootsMath?: RootsMathConfiguration;
  /** Optional authored presentation payload. Omission retains legacy rules;
   * local-v1 keeps this payload dormant without discarding its source values. */
  rootsPresentation?: RootsPresentationConfiguration;
  runtimeSamilaViewport?: RuntimeSamilaViewport;
  evaluatedCamera?: EvaluatedCamera;
  /** Runtime camera facts, never a replacement for rootsPresentation.camera. */
  evaluatedRootsCamera?:RootsSceneFrame;
  evaluatedDomainGradient?: EvaluatedDomainGradient;
  /** Active source gradient interpolation; rebuilt for each evaluated frame. */
  evaluatedFractalGradient?: FractalSourcePaletteRuntime;
  /** Runtime-only source screen rotation, in radians, separate from authored degrees. */
  evaluatedSpirographRotationRadians?: number;
  evaluatedSpirographFrame?:SpirographReplayFrame;
  spirographFrameEvents?:SpirographFrameEvent[];
  version: 1;
  id: string;
  name: string;
  kind: SceneKind;
  description?: string;
  equations: Record<string, string>;
  parameters: Record<string, number>;
  settings: Settings;
  palette: Palette;
  camera: CameraState;
  sourceCamera?:SourceCameraInput;
  evaluatedSourceCamera?:OrdinarySourceCameraEvaluation;
  timeline: {
    duration: number;
    fps: number;
    loop: boolean;
    tracks: AnimationTrack[];
    playbackMode?: "once" | "loop" | "ping-pong";
    /** Sequential profiles derive absolute positions through resolveTimeline.
     * Spirograph reads track.start as a pre-clip delay; Roots ignores it and
     * uses explicit waits. duration is the caller's minimum playback span. */
    schedule?: 'spirograph-sequence-v1' | 'roots-camera-sequence-v1' | 'roots-scene-sequence-v1' | 'ordinary-camera-sequence-v1';
  };
  favorite: boolean;
  formulas?: FormulaConfig;
  provenance?: {
    kind: "MathArt Studio";
    original: unknown;
    warnings: string[];
    /** Original JSON number spelling for registered project and family fields. */
    sourceNumberTokens?: {path:string[];token:string}[];
    reference?: {
      url: string;
      section: string;
      completion: "runtime-defaults" | "packaged-config";
      assumptions: string[];
      package?: {file: string; sha256: string};
    };
  };
}
export interface ControlSpec {
  key: string;
  label: string;
  group: string;
  type: "number" | "select" | "toggle" | "text";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}
export interface Preset {
  id: string;
  name: string;
  description?: string;
  equations?: Record<string, string>;
  parameters?: Record<string, number>;
  settings?: Settings;
  /** Complete authored content, produced through the document's owning importer.
   * This branch replaces defaults; empty maps and omitted fields are meaningful. */
  document?: Omit<SceneDocument, "id" | "name" | "description" | "kind" | "favorite" | "evaluatedCamera" | "evaluatedRootsCamera" | "evaluatedDomainGradient" | "evaluatedSpirographRotationRadians" | "evaluatedSpirographFrame" | "runtimeSamilaViewport">;
}
export interface GeometryOutput {
  /** Implicit work counts include confirmed attempts before a CPU replay;
   * requested counts describe one requested grid. Quality counts describe the
   * final mesh. Working bytes are a representation estimate, not process RSS
   * or a topology guarantee. */
  implicit?: {
    requestedCells: number; examinedCells: number;
    requestedLatticeSamples: number; latticeSamples: number;
    latticeValidationSamples: number;
    rootEvaluations: number; refinedEdges: number; rejectedEdges: number;
    /** Shared zero corners certified for the final extraction, excluding discarded GPU attempts. */
    representedZeroCorners: number;
    unresolvedCells: number; degenerateTriangles: number;
    estimatedPeakWorkingBytes: number;
  };
  /** Producer-owned world-space line segments; each six floats form one segment. */
  lineOverlays?: {id:string;positions:Float32Array;color:string;width:number;opacity:number}[];
  type: "geometry";
  positions: Float32Array;
  indices?: Uint32Array;
  /** Unique sorted unordered non-self pairs over compact position identities.
   * Present only when the producer supplies mesh overlay edges; empty is a
   * supplied empty result, while omission does not mean an empty topology. */
  meshEdges?: Uint32Array;
  colors?: Float32Array;
  /** Producer-owned normalized alpha per point, multiplied by display opacity. */
  pointAlphas?: Float32Array;
  sourcePointAppearance?: SourceSurfacePointAppearance;
  /** GPU-owned formula/seed transport, never CPU world positions. */
  sourceGpuMesh?:SourceSurfaceGpuMeshFrame;
  sourceGpuPoints?:SourceSurfaceGpuPointFrame;
  sourceMeshAppearance?: SourceSurfaceMeshAppearance;
  /** Original packed colors per mesh vertex, before native fill(int) semantics. */
  sourceMeshColors?: Uint32Array;
  /** Ordered native CPU line pairs, packed stroke color and resolved width. */
  sourceMeshWireframe?: SourceSurfaceMeshWireframeFrame;
  /** Packed background passed to source P3D background(int), including alpha. */
  sourceSurfaceBackgroundColor?:number;
  /** Final source full-scene black overlay, already quantized to a byte. */
  sourceSurfaceOverlayAlpha?:number;
  /** Parameter-grid provenance from the surface producer, before vertex compaction.
   * Each cell mask: bit 0 = (a,b,c), bit 1 = (a,c,d); omitted triangles stay holes. */
  surfaceGrid?: {
    width: number; height: number; uSegments: number; vSegments: number;
    vertexIndices: Int32Array; cellTriangles: Uint8Array;
  };
  /** Independent formula-sampled surface isolines. Indices are line pairs. */
  surfaceWireframe?: {positions:Float32Array;indices:Uint32Array;backend:'cpu'|'webgl2'};
  /** Stable identities for particle heads; omission means no temporal joining. */
  particleIds?: Uint32Array;
  /** Independent line-segment history. Producer alpha is multiplied by display opacity. */
  trails?: {
    positions: Float32Array;
    colors?: Float32Array;
    alphas: Float32Array;
    indices?: Uint32Array;
    /** Optional producer-owned logical-pixel line style paired with this frame. */
    appearance?: {width:number;overlay:boolean};
  };
  topology: "points" | "lines" | "segments" | "mesh";
}
export interface RootsProgress {
  math?: {
    model:'mathart-1.7.8-v1';solver:'aberth-ehrlich-power-substitution';
    sampling:'java-random48-partitioned';logicalWorkers:number;
    replayOrder:'global-ordinal';residualMeasured:false;iterationLimitSamples:number;
  };
  totalSamples:number;
  attemptedSamples:number;
  acceptedPolynomials:number;
  filteredSamples:number;
  invalidSamples:number;
  nonconvergentSamples:number;
  rootPoints:number;
  solverIterations:number;
  solverWork:number;
  /** Maximum measured normalized residual; null when absent or not measured. */
  maxResidual:number|null;
  complete:boolean;
}
export interface RasterOutput {
  /** Numeric and navigation facts owned by this delivered source Fractal image. */
  fractalRender?:FractalSourceFrameFacts;
  /** PNG postprocessing follows base-size rendering; it does not resample the
   * scene or alter the render target dimensions recorded in rootsPresentation. */
  rootsPausedImage?:{enhancement:'mathart-1.7.8-scale1';baseSize:readonly[number,number];scale:1|3|5;resampling:'none'|'openjdk21-software-bicubic';originalRuntimeCompared:false};
  /** Source spatial display facts owned by the completed worker request. */
  rootsPresentation?: RootsPresentationFacts;
  /** Source Roots presentation facts paired with these delivered pixels. */
  rootsColor?: {
    version:'mathart-1.7.8-metric-v1';inkKind:'metric-sum';
    metric:'radius'|'t2_real'|'t2_imag';submittedFinitePointCount:number;
    exposureScale:number;accumulationPrecision:'float64'|'float32';
    toneBackend:'cpu'|'webgl2';paletteOffset:number;
  };
  /** Actual rule/view facts paired with this delivered Domain image. */
  domainRender?:DomainRenderFacts;
  /** Geometry actually used by the delivered sampler, paired with samilaView. */
  samilaViewportTransform?:SamilaViewportTransform;
  /** Delivered raw-ink lookup facts at this image's request time; never authored. */
  samilaView?:PreparedSamilaView;
  type: "raster";
  /** The producer already applied the mathematical camera. Display this image
   * front-on without a second document-camera transform. */
  cameraResolved?: true;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  roots?:RootsProgress;
}
export type DensityProjection = 'xy' | 'xz' | 'yz';
export interface DensityBounds { minX: number; maxX: number; minY: number; maxY: number; }
export interface DensityStats {
  projection: DensityProjection; bounds: DensityBounds; inputPoints: number; examined: number;
  accepted: number; clipped: number; invalid: number; occupiedPixels: number; maxCount: number; cancelled: boolean;
  /** Actual final density presentation backend, independent of orbit/accumulation backend. */
  toneBackend?: 'cpu' | 'webgl2';
}
export type SceneOutput = (GeometryOutput | RasterOutput) & {
  /** Immutable facts from the same replay state as the delivered pixels. */
  spirographFrame?:SpirographReplayFrame;
  cameraFrame?: CameraFrame;
  sourceCameraFrame?:OrdinarySourceCameraFrame;
  dimension?: 2 | 3;
  backend?: 'cpu' | 'webgl2';
  density?: DensityStats;
  temporal?: { time: number; windowStart: number; frames: number; samplingFps: number; recordedPoints: number; cacheHits: number };
  stats: {
    samples: number;
    generated: number;
    invalid: number;
    elapsedMs?: number;
  };
  warnings?: string[];
};
export type GenerationStatus = {kind:'roots';attemptedSamples:number;targetSamples:number;totalSamples:number};
export interface GenerateContext {
  time: number;
  spirographFrame?:SpirographFrameRequest;
  rootsViewport?:RootsViewportRequest;
  sourceViewport?:SourceCameraViewport;
  /** Measured local primary renderer density; separate from source-app DPI evidence. */
  sourcePointPixelDensity?:number;
  /** Actual local logical canvas size, separate from preview sampling pixels.
   * Offscreen requests use the explicit export dimensions; neither proves
   * the original application's operating-system DPI or framebuffer scale. */
  fractalViewport?:{logicalWidth:number;logicalHeight:number;target:'primary'|'offscreen'};
  /** Runtime owner token. Saved document identity can change on Save As without
   * replacing a live Roots instance; explicit Open supplies a fresh token. */
  rootsSessionId?:string;
  quality: "preview" | "export";
  width: number;
  height: number;
  isCancelled?: () => boolean;
  /** Each progress frame owns its buffers; consumers may transfer them. */
  onProgress?: (output: SceneOutput) => void;
  /** Lightweight completed-work facts; no raster allocation or transfer. */
  onStatus?: (status: GenerationStatus) => void;
}
export type GenerationInput = Pick<GenerateContext,'time'|'quality'|'width'|'height'|'spirographFrame'|'rootsViewport'|'sourceViewport'|'sourcePointPixelDensity'|'fractalViewport'|'rootsSessionId'>;
export interface SceneDefinition {
  kind: SceneKind;
  name: string;
  englishName: string;
  description: string;
  dimension: 2 | 3;
  equations: { key: string; label: string }[];
  controls: ControlSpec[];
  defaults: {
    equations: Record<string, string>;
    parameters: Record<string, number>;
    settings: Settings;
  };
  presets: Preset[];
  generate: (scene: SceneDocument, context: GenerateContext) => SceneOutput;
}
