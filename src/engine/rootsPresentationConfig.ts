/** Authored presentation facts, independent of the solver, palette and backend.
 * Omission is a caller-owned legacy choice; this module never upgrades it. */
export interface RootsPendingConfiguration {
 model: 'roots-pending-ordinal-v1';
 /** Source int base budget; adaptive splatting may exceed this per display. */
 maxSplatPointsPerFrame: number;
 /** Explicit local reference for the source capacity formula. This is not an
  * observation of Runtime.maxMemory() or the renderer's allocation budget. */
 referenceHeapBytes: number;
}
export interface RootsPresentationConfiguration {
 model: 'local-v1' | 'mathart-1.7.8-v1';
 mode: 'density' | 'point-cloud';
 /** Explicit preview policy; absence retains saved ordinal replay. */
 previewMode?: 'live-worker-arrival-v1';
 transform: {scale: [number, number, number]; offset: [number, number, number]; rotationDegrees: number};
 camera: {phi: number; theta: number; gamma: number; center: [number, number, number]; zoom: number; focalDistance: number};
 dotSize: number;
 accumulation: {enabled: boolean; fadeAlpha: number};
 /** Omission preserves the saved immediate-consumption implementation. */
 pending?: RootsPendingConfiguration;
}

/** Logical dimensions and reference height are separate from the physical
 * raster dimensions carried by the generation request. No ambient DPR lookup. */
export interface RootsViewportRequest {
 logicalWidth: number;
 logicalHeight: number;
 referenceLogicalHeight: number;
 target: 'primary' | 'offscreen';
}

export type RootsPresentationInputReason = 'object-required' | 'missing-field' | 'invalid-choice' |
 'number-required' | 'non-finite' | 'float32-overflow' | 'triple-required' | 'boolean-required' |
 'integer-required' | 'source-int-range' | 'reference-heap-safe-integer-required';
export class RootsPresentationConfigurationError extends Error {
 readonly kind = 'input';
 constructor(readonly path: string, readonly reason: RootsPresentationInputReason) {
  super(`Invalid Roots presentation configuration at ${path}: ${reason}`);
  this.name = 'RootsPresentationConfigurationError';
 }
}
export type RootsPresentationResult<T> = {ok: true; value: T} |
 {ok: false; error: RootsPresentationConfigurationError};

type RecordValue = Record<string, unknown>;
function object(value: unknown, path: string): RecordValue {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RootsPresentationConfigurationError(path, 'object-required');
 return value as RecordValue;
}
function field(value: RecordValue, key: string, path: string): unknown {
 if (!Object.hasOwn(value, key)) throw new RootsPresentationConfigurationError(path, 'missing-field');
 return value[key];
}
function scalar(value: unknown, path: string): number {
 if (typeof value !== 'number') throw new RootsPresentationConfigurationError(path, 'number-required');
 if (!Number.isFinite(value)) throw new RootsPresentationConfigurationError(path, 'non-finite');
 // This is an explicit local admission policy, not native coercion. Underflow
 // to zero is the normal source float conversion; authored values stay intact.
 if (!Number.isFinite(Math.fround(value))) throw new RootsPresentationConfigurationError(path, 'float32-overflow');
 return value;
}
function numberField(value: RecordValue, key: string, path: string): number {
 return scalar(field(value, key, path), path);
}
function triple(value: unknown, path: string): [number, number, number] {
 if (!Array.isArray(value) || value.length !== 3) throw new RootsPresentationConfigurationError(path, 'triple-required');
 return [0, 1, 2].map(i => scalar(value[i], `${path}[${i}]`)) as [number, number, number];
}
function pendingConfiguration(value: unknown): RootsPendingConfiguration {
 const raw = object(value, 'pending');
 if (field(raw, 'model', 'pending.model') !== 'roots-pending-ordinal-v1')
  throw new RootsPresentationConfigurationError('pending.model', 'invalid-choice');
 const maxSplatPointsPerFrame = field(raw, 'maxSplatPointsPerFrame', 'pending.maxSplatPointsPerFrame');
 if (typeof maxSplatPointsPerFrame !== 'number' || !Number.isInteger(maxSplatPointsPerFrame))
  throw new RootsPresentationConfigurationError('pending.maxSplatPointsPerFrame', 'integer-required');
 // INT_MAX is the source representation, not a local rendering capacity cap.
 if (maxSplatPointsPerFrame < 1 || maxSplatPointsPerFrame > 2147483647)
  throw new RootsPresentationConfigurationError('pending.maxSplatPointsPerFrame', 'source-int-range');
 const referenceHeapBytes = field(raw, 'referenceHeapBytes', 'pending.referenceHeapBytes');
 // Exact arithmetic is supplied by the pending owner. The authored JS number
 // must be losslessly representable; do not clamp it to a guessed native heap.
 if (typeof referenceHeapBytes !== 'number' || !Number.isSafeInteger(referenceHeapBytes) || referenceHeapBytes < 0)
  throw new RootsPresentationConfigurationError('pending.referenceHeapBytes', 'reference-heap-safe-integer-required');
 return {model: 'roots-pending-ordinal-v1', maxSplatPointsPerFrame, referenceHeapBytes};
}
function decode(value: unknown): RootsPresentationConfiguration {
 const raw = object(value, 'rootsPresentation');
 if(raw.previewMode!==undefined&&raw.previewMode!=='live-worker-arrival-v1')throw new RootsPresentationConfigurationError('previewMode','invalid-choice');
 const model = field(raw, 'model', 'model'), mode = field(raw, 'mode', 'mode');
 if (model !== 'local-v1' && model !== 'mathart-1.7.8-v1') throw new RootsPresentationConfigurationError('model', 'invalid-choice');
 if (mode !== 'density' && mode !== 'point-cloud') throw new RootsPresentationConfigurationError('mode', 'invalid-choice');
 const transform = object(field(raw, 'transform', 'transform'), 'transform');
 const camera = object(field(raw, 'camera', 'camera'), 'camera');
 const accumulation = object(field(raw, 'accumulation', 'accumulation'), 'accumulation');
 const enabled = field(accumulation, 'enabled', 'accumulation.enabled');
 if (typeof enabled !== 'boolean') throw new RootsPresentationConfigurationError('accumulation.enabled', 'boolean-required');
 const dotSize = numberField(raw, 'dotSize', 'dotSize');
 const fadeAlpha = numberField(accumulation, 'fadeAlpha', 'accumulation.fadeAlpha');
 const source = model === 'mathart-1.7.8-v1';
 return {
  model, mode,
  transform: {
   scale: triple(field(transform, 'scale', 'transform.scale'), 'transform.scale'),
   offset: triple(field(transform, 'offset', 'transform.offset'), 'transform.offset'),
   rotationDegrees: numberField(transform, 'rotationDegrees', 'transform.rotationDegrees'),
  },
  camera: {
   phi: numberField(camera, 'phi', 'camera.phi'),
   theta: numberField(camera, 'theta', 'camera.theta'),
   gamma: numberField(camera, 'gamma', 'camera.gamma'),
   center: triple(field(camera, 'center', 'camera.center'), 'camera.center'),
   zoom: numberField(camera, 'zoom', 'camera.zoom'),
   focalDistance: numberField(camera, 'focalDistance', 'camera.focalDistance'),
  },
  // Canonical authored bounds only. The projection owner stages the source
  // float arithmetic; do not quantize the entire saved configuration here.
  dotSize: source ? Math.min(.1, Math.max(.001, dotSize)) : dotSize,
  accumulation: {enabled, fadeAlpha: source ? Math.min(255, Math.max(0, fadeAlpha)) : fadeAlpha},
  ...(raw.previewMode===undefined?{}:{previewMode:'live-worker-arrival-v1' as const}),
  ...(!Object.hasOwn(raw, 'pending') || raw.pending === undefined ? {} : {pending: pendingConfiguration(raw.pending)}),
 };
}

export function prepareRootsPresentationConfiguration(value: unknown): RootsPresentationResult<RootsPresentationConfiguration> {
 try { return {ok: true, value: decode(value)}; }
 catch (error) {
  if (error instanceof RootsPresentationConfigurationError) return {ok: false, error};
  throw error;
 }
}

/** Throwing adapter for document parsers; all interpretation lives in prepare. */
export function parseRootsPresentationConfiguration(value: unknown): RootsPresentationConfiguration {
 const result = prepareRootsPresentationConfiguration(value);
 if (!result.ok) throw result.error;
 return result.value;
}

/** Fresh source baseline. CameraController has center=0, zoom=1, focal=20;
 * Scene then sets phi to PI/2_F. See the retained projection authoring and
 * display-host audits; the controller's initial phi=0 alone is incomplete. */
export function defaultRootsPresentationConfiguration(): RootsPresentationConfiguration {
 return {
  model: 'mathart-1.7.8-v1', mode: 'density',
  transform: {scale: [240, 240, 35], offset: [0, 0, 0], rotationDegrees: 0},
  camera: {phi: Math.fround(Math.PI / 2), theta: 0, gamma: 0, center: [0, 0, 0], zoom: 1, focalDistance: 20},
  dotSize: .01, accumulation: {enabled: false, fadeAlpha: 6},
 };
}

/** Explicit opt-in. The retained package requests -Xmx4096m; using that
 * ceiling here is a local reference policy, not measured native maxMemory. */
export function defaultRootsPendingConfiguration(): RootsPendingConfiguration {
 return {model: 'roots-pending-ordinal-v1', maxSplatPointsPerFrame: 20000, referenceHeapBytes: 4294967296};
}
