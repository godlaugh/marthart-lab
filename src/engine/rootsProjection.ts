import { prepareSourceCamera, SOURCE_CAMERA_MODEL } from './sourceCamera';
import { parseRootsPresentationConfiguration, type RootsPresentationConfiguration, type RootsViewportRequest } from './rootsPresentationConfig';

export type RootsVec3 = readonly [number, number, number];
export type RootsVec4 = readonly [number, number, number, number];
export interface RootsProjectionMatrix {
  /** Processing PMatrix3D storage; multiplied by column vectors. */
  readonly rowMajor: readonly number[];
  /** The same matrix, transposed once for WebGL uniformMatrix4fv(false). */
  readonly columnMajor: Float32Array;
}
export interface RootsMatrixReferenceViewport {
  readonly physicalWidth: number; readonly physicalHeight: number;
  readonly logicalWidth: number; readonly logicalHeight: number;
  readonly referenceLogicalHeight: number;
  readonly target: RootsViewportRequest['target'];
  readonly displayScale: number;
}
export interface PreparedRootsProjection {
  readonly model: 'mathart-1.7.8-v1';
  readonly mode: 'density' | 'point-cloud';
  readonly worldTransformRule: 'host-f32-java-trig-reference';
  readonly pointCloudTransformRule: 'raw-f32-glsl-radians-trig';
  readonly physicalWidth: number; readonly physicalHeight: number;
  readonly logicalWidth: number; readonly logicalHeight: number;
  readonly referenceLogicalHeight: number;
  readonly target: RootsViewportRequest['target'];
  readonly displayScale: number; readonly pixelRatio: number;
  readonly densityDiameter: number; readonly pointsDiameter: number;
  readonly quadDiameter: number; readonly pointCloudUniformSize: number;
  readonly transform: { readonly scale: RootsVec3; readonly offset: RootsVec3; readonly rotationDegrees: number; readonly cos: number; readonly sin: number };
  readonly camera: { readonly phi: number; readonly theta: number; readonly gamma: number; readonly center: RootsVec3; readonly zoom: number; readonly focalDistance: number };
  readonly accumulation: { readonly enabled: boolean; readonly fadeAlpha: number };
  readonly optics: { readonly halfSensorOverFocal: number; readonly fov: number; readonly cameraZ: number; readonly aspect: number; readonly near: number; readonly far: number; readonly projectionKind: 'perspective' | 'orthographic'; readonly orthographicFar: number | null };
  readonly projection: RootsProjectionMatrix;
  readonly modelView: RootsProjectionMatrix;
  /** Matrix capture dimensions can differ from the current splat target after resize. */
  readonly matrixReferenceViewport: RootsMatrixReferenceViewport;
}
export class RootsProjectionError extends Error {
  constructor(readonly reason: 'invalid-input' | 'invalid-singular-camera' | 'invalid-prepared-plan', message: string) {
    super(message); this.name = 'RootsProjectionError';
  }
}
const F = Math.fround;
const add = (a: number, b: number) => F(a + b);
const sub = (a: number, b: number) => F(a - b);
const mul = (a: number, b: number) => F(a * b);
const div = (a: number, b: number) => F(a / b);
const CAMERA_DELTA = F(1e-4);
const finite = (values: readonly number[]) => values.every(Number.isFinite);
function input(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(F(value))) throw new RootsProjectionError('invalid-input', `Roots projection ${name} must be finite in float32`);
  return F(value);
}
function vec3(value: RootsVec3, name: string): RootsVec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new RootsProjectionError('invalid-input', `Roots projection ${name} requires three values`);
  return Object.freeze(value.map((x, i) => input(x, `${name}[${i}]`))) as unknown as RootsVec3;
}
function dimension(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(F(value))) throw new RootsProjectionError('invalid-input', `Roots projection ${name} must be a positive integer`);
  return value;
}
/** Source host geometry reference. JS/Java libm and actual GLSL/FMA final bits are not claimed identical. */
export function prepareRootsProjection(authored: RootsPresentationConfiguration, request: { width: number; height: number; viewport: RootsViewportRequest }): PreparedRootsProjection {
  // The configuration owner supplies canonical bounds and a detached snapshot.
  const config = parseRootsPresentationConfiguration(authored);
  if (config.model !== 'mathart-1.7.8-v1') throw new RootsProjectionError('invalid-input', 'Local Roots projection remains owned by the legacy presentation path');
  const physicalWidth = dimension(request.width, 'physical width'), physicalHeight = dimension(request.height, 'physical height');
  const logicalWidth = dimension(request.viewport.logicalWidth, 'logical width'), logicalHeight = dimension(request.viewport.logicalHeight, 'logical height');
  const referenceLogicalHeight = dimension(request.viewport.referenceLogicalHeight, 'reference logical height');
  const target = request.viewport.target;
  if (target !== 'primary' && target !== 'offscreen') throw new RootsProjectionError('invalid-input', 'Unknown Roots viewport target');
  if (config.mode !== 'density' && config.mode !== 'point-cloud') throw new RootsProjectionError('invalid-input', 'Unknown Roots presentation mode');
  const rotationDegrees = input(config.transform.rotationDegrees, 'rotationDegrees');
  // Math.toRadians(float promoted to double), not Processing/GLSL radians(float).
  const radians = rotationDegrees * 0.017453292519943295; // Retained java.lang.Math.toRadians@0–5.
  const transform = Object.freeze({ scale: vec3(config.transform.scale, 'scale'), offset: vec3(config.transform.offset, 'offset'), rotationDegrees, cos: F(Math.cos(radians)), sin: F(Math.sin(radians)) });
  const accumulation = Object.freeze({ enabled: config.accumulation.enabled, fadeAlpha: input(config.accumulation.fadeAlpha, 'fadeAlpha') });
  if (typeof accumulation.enabled !== 'boolean') throw new RootsProjectionError('invalid-input', 'Roots accumulation enabled must be boolean');
  // The family configuration owns authored values; the common source camera
  // owns float assignment, optics and staged matrix arithmetic for all consumers.
  const prepared = prepareSourceCamera({model: SOURCE_CAMERA_MODEL, configuration: {kind: 'absent'}, frame: config.camera},
    {logicalWidth, logicalHeight, referenceLogicalHeight, target, projectionPass: accumulation.enabled ? 'scene-fade-orthographic' : 'perspective'});
  if (!prepared.ok) throw new RootsProjectionError(prepared.error.reason === 'singular-camera' ? 'invalid-singular-camera' : 'invalid-input', prepared.error.message);
  if (prepared.value.kind !== 'known') throw new RootsProjectionError('invalid-input', prepared.value.reason);
  const source = prepared.value.plan, camera = source.camera.value, displayScale = source.displayScale;
  const dotSize = input(config.dotSize, 'dotSize'), w = F(logicalWidth);
  const pixelRatio = div(F(physicalWidth), w);
  const densityDiameter = Math.max(F(.5), mul(Math.max(F(.5), mul(mul(dotSize, 100), displayScale)), pixelRatio));
  const pointsDiameter = Math.max(densityDiameter, 1), quadDiameter = Math.max(mul(densityDiameter, F(.6)), F(.8));
  const pointCloudUniformSize = mul(densityDiameter, F(.01));
  const plan: PreparedRootsProjection = Object.freeze({ model: 'mathart-1.7.8-v1', mode: config.mode, worldTransformRule: 'host-f32-java-trig-reference', pointCloudTransformRule: 'raw-f32-glsl-radians-trig', physicalWidth, physicalHeight, logicalWidth, logicalHeight, referenceLogicalHeight, target, displayScale, pixelRatio, densityDiameter, pointsDiameter, quadDiameter, pointCloudUniformSize, transform, camera, accumulation, optics: Object.freeze({ ...source.optics, projectionKind: accumulation.enabled ? 'orthographic' : 'perspective' }), projection: source.projection, modelView: source.modelView, matrixReferenceViewport: Object.freeze({ physicalWidth, physicalHeight, logicalWidth, logicalHeight, referenceLogicalHeight, target, displayScale }) });
  validatePreparedRootsProjection(plan);
  return plan;
}

/** Prepared-fact boundary shared by CPU and GL consumers; never reparses settings. */
export function validatePreparedRootsProjection(plan: PreparedRootsProjection): void {
  const fail = () => { throw new RootsProjectionError('invalid-prepared-plan', 'Invalid prepared Roots projection facts'); };
  if (!plan || plan.model !== 'mathart-1.7.8-v1' || !['density', 'point-cloud'].includes(plan.mode) || plan.worldTransformRule !== 'host-f32-java-trig-reference' || plan.pointCloudTransformRule !== 'raw-f32-glsl-radians-trig') fail();
  for (const value of [plan.physicalWidth, plan.physicalHeight, plan.logicalWidth, plan.logicalHeight, plan.referenceLogicalHeight]) if (!Number.isSafeInteger(value) || value <= 0) fail();
  if (!finite([plan.displayScale, plan.pixelRatio, plan.densityDiameter, plan.pointsDiameter, plan.quadDiameter, plan.pointCloudUniformSize]) || plan.displayScale <= 0 || plan.pixelRatio <= 0 || plan.densityDiameter < F(.5) || plan.pointsDiameter !== Math.max(plan.densityDiameter, 1) || plan.quadDiameter !== Math.max(mul(plan.densityDiameter, F(.6)), F(.8)) || plan.pointCloudUniformSize !== mul(plan.densityDiameter, F(.01))) fail();
  const ref = plan.matrixReferenceViewport;
  if (!ref || ![ref.physicalWidth, ref.physicalHeight, ref.logicalWidth, ref.logicalHeight, ref.referenceLogicalHeight].every(v => Number.isSafeInteger(v) && v > 0) || !Number.isFinite(ref.displayScale) || ref.displayScale <= 0 || (ref.target !== 'primary' && ref.target !== 'offscreen')) fail();
  if (plan.target !== 'primary' && plan.target !== 'offscreen') fail();
  for (const v of [plan.transform?.scale, plan.transform?.offset, plan.camera?.center]) if (!Array.isArray(v) || v.length !== 3 || !finite(v)) fail();
  if (!finite([plan.transform.rotationDegrees, plan.transform.cos, plan.transform.sin, plan.camera.phi, plan.camera.theta, plan.camera.gamma, plan.camera.zoom, plan.camera.focalDistance, plan.accumulation?.fadeAlpha]) || typeof plan.accumulation?.enabled !== 'boolean') fail();
  if (!plan.optics || !finite([plan.optics.halfSensorOverFocal, plan.optics.fov, plan.optics.cameraZ, plan.optics.aspect, plan.optics.near, plan.optics.far]) || !['perspective', 'orthographic'].includes(plan.optics.projectionKind) || (plan.optics.orthographicFar !== null && !Number.isFinite(plan.optics.orthographicFar))) fail();
  for (const m of [plan.projection, plan.modelView]) {
    if (!m || m.rowMajor.length !== 16 || !(m.columnMajor instanceof Float32Array) || m.columnMajor.length !== 16 || !finite(m.rowMajor)) fail();
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) if (!Object.is(m.rowMajor[row * 4 + col], m.columnMajor[col * 4 + row])) fail();
  }
}

export type RootsTransformedPoint = { readonly kind: 'point'; readonly world: RootsVec3 } | { readonly kind: 'invalid'; readonly reason: 'nonfinite-input' | 'nonfinite-world' };
/** Density/native-shape host reference. Custom point-cloud GLSL must consume
 * RAW xyz and transform uniforms: its float radians/trig is a distinct producer.
 * This helper's point-cloud mode only supplies the native-shape/reference Z rule. */
export function transformRootsPoint(plan: PreparedRootsProjection, raw: RootsVec3): RootsTransformedPoint {
  const x = F(raw[0]), y = F(raw[1]), z = F(raw[2]);
  // Density has no source-Z dependency. This also permits an unused nonfinite raw Z.
  if (!finite(plan.mode === 'density' ? [x, y] : [x, y, z])) return { kind: 'invalid', reason: 'nonfinite-input' };
  const { cos: c, sin: s, scale, offset } = plan.transform;
  const xx = sub(mul(c, x), mul(s, y)), yy = add(mul(s, x), mul(c, y));
  const world: RootsVec3 = [add(mul(xx, scale[0]), offset[0]), add(mul(yy, scale[1]), offset[1]), plan.mode === 'density' ? offset[2] : add(mul(z, scale[2]), offset[2])];
  return finite(world) ? { kind: 'point', world } : { kind: 'invalid', reason: 'nonfinite-world' };
}
function matrixPoint(m: readonly number[], point: RootsVec4): RootsVec4 {
  return [0, 4, 8, 12].map(i => add(add(add(mul(m[i], point[0]), mul(m[i + 1], point[1])), mul(m[i + 2], point[2])), mul(m[i + 3], point[3]))) as unknown as RootsVec4;
}
export interface ProjectedRootsPoint {
  readonly clip: RootsVec4; readonly ndc: RootsVec3 | null;
  /** Continuous top-down physical pixel coordinate, not rounded/clipped to a pixel index. */
  readonly pixel: readonly [number, number] | null;
  readonly finite: boolean; readonly insideClip: boolean;
}
export function projectRootsPoint(plan: PreparedRootsProjection, world: RootsVec3): ProjectedRootsPoint {
  const eye = matrixPoint(plan.modelView.rowMajor, [world[0], world[1], world[2], 1]);
  const clip = matrixPoint(plan.projection.rowMajor, eye), ok = finite(clip), w = clip[3];
  const ndc: RootsVec3 | null = ok && w > 0 ? [div(clip[0], w), div(clip[1], w), div(clip[2], w)] : null;
  const pixel: readonly [number, number] | null = ndc && finite(ndc) ? [(ndc[0] + 1) * plan.physicalWidth / 2, (1 - ndc[1]) * plan.physicalHeight / 2] : null;
  const insideClip = ok && w > 0 && clip[0] >= -w && clip[0] <= w && clip[1] >= -w && clip[1] <= w && clip[2] >= -w && clip[2] <= w;
  return { clip, ndc, pixel, finite: ok, insideClip };
}

export interface RootsProjectionState {
  readonly anchor: PreparedRootsProjection;
  readonly current: PreparedRootsProjection;
  readonly lastCamera: PreparedRootsProjection['camera'];
}
export type RootsProjectionClearReason = 'physical-size' | 'transform' | 'camera-projection';
export interface RootsProjectionUpdate {
  readonly state: RootsProjectionState;
  /** Current dimensions/world/dot with the captured density camera and matrices. */
  readonly splatPlan: PreparedRootsProjection;
  readonly capture: boolean;
  readonly captureReason: 'initial' | 'camera-projection' | null;
  readonly clearInk: boolean;
  readonly reasons: readonly RootsProjectionClearReason[];
  readonly displayRotation: number;
}
/** Density observation state only. Resource identity, scene changes and mode changes remain session-owned. */
export function updateRootsProjectionState(prior: RootsProjectionState | undefined, plan: PreparedRootsProjection): RootsProjectionUpdate {
  const cameraChanged = !!prior && [sub(plan.camera.zoom, prior.lastCamera.zoom), ...plan.camera.center.map((x, i) => sub(x, prior.lastCamera.center[i]))].some(x => Math.abs(x) > CAMERA_DELTA);
  const reasons: RootsProjectionClearReason[] = [];
  if (prior) {
    if (prior.current.physicalWidth !== plan.physicalWidth || prior.current.physicalHeight !== plan.physicalHeight) reasons.push('physical-size');
    const a = prior.current.transform, b = plan.transform;
    if (a.rotationDegrees !== b.rotationDegrees || a.scale.some((v, i) => v !== b.scale[i]) || a.offset.some((v, i) => v !== b.offset[i])) reasons.push('transform');
    if (cameraChanged) reasons.push('camera-projection');
  }
  const anchor = !prior || cameraChanged ? plan : prior.anchor;
  const displayRotation = sub(add(sub(plan.camera.phi, anchor.camera.phi), sub(plan.camera.theta, anchor.camera.theta)), sub(plan.camera.gamma, anchor.camera.gamma));
  const splatPlan = anchor === plan ? plan : Object.freeze({ ...plan, camera: anchor.camera, optics: anchor.optics, projection: anchor.projection, modelView: anchor.modelView, matrixReferenceViewport: anchor.matrixReferenceViewport });
  return { state: Object.freeze({ anchor, current: plan, lastCamera: plan.camera }), splatPlan, capture: !prior || cameraChanged, captureReason: !prior ? 'initial' : cameraChanged ? 'camera-projection' : null, clearInk: reasons.length > 0, reasons: Object.freeze(reasons), displayRotation };
}
