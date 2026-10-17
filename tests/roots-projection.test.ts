import { describe, expect, it } from 'vitest';
import fixture from './fixtures/roots/projection-source.json';
import { defaultRootsPresentationConfiguration, type RootsPresentationConfiguration } from '../src/engine/rootsPresentationConfig';
import { prepareRootsProjection, transformRootsPoint, projectRootsPoint, updateRootsProjectionState, validatePreparedRootsProjection, RootsProjectionError } from '../src/engine/rootsProjection';

const F = Math.fround;
const triple = (v: number[]) => v as [number, number, number];
function config(edit?: (c: RootsPresentationConfiguration) => void) {
 const c = defaultRootsPresentationConfiguration(); edit?.(c); return c;
}
function prepare(c = config(), width = 800, height = 800, physicalWidth = width, physicalHeight = height, referenceLogicalHeight = height, target: 'primary' | 'offscreen' = 'primary') {
 return prepareRootsProjection(c, { width: physicalWidth, height: physicalHeight, viewport: { logicalWidth: width, logicalHeight: height, referenceLogicalHeight, target } });
}
function changed(prior: ReturnType<typeof prepare>, edit: (c: RootsPresentationConfiguration) => void) {
 return prepare(config(c => { c.camera = {...prior.camera, center: [...prior.camera.center]}; c.transform = {...prior.transform, scale: [...prior.transform.scale], offset: [...prior.transform.offset]}; edit(c); }), prior.logicalWidth, prior.logicalHeight, prior.physicalWidth, prior.physicalHeight, prior.referenceLogicalHeight, prior.target);
}
describe('Roots source projection prepared owner', () => {
 for (const row of fixture.world) for (const mode of ['density', 'point-cloud'] as const) it(`independent staged-float world: ${row.id}/${mode}`, () => {
  const p = prepare(config(c => { c.mode = mode; c.transform = {scale: triple(row.scale), offset: triple(row.offset), rotationDegrees: row.degrees}; }));
  const r = transformRootsPoint(p, triple(row.raw));
  expect(r.kind).toBe('point'); if (r.kind !== 'point') return;
  // The retained fixture declares libm last-bit limits. These finite vectors
  // happen to agree exactly on this JS/Python host; no driver claim follows.
  expect(r.world).toEqual(row.outputs[mode]);
 });
 for (const row of fixture.diameter) it(`independent physical point sizing: ${row.logicalWidth}/${row.physicalWidth}/${row.displayScale}`, () => {
  const c = config(c => { c.dotSize = row.dot; });
  if (row.logicalWidth === 0) {
   // Source helper's defensive zero-size ratio is not a renderable request.
   expect(() => prepare(c, 0, 800, row.physicalWidth, 800)).toThrow(RootsProjectionError); return;
  }
  const p = prepare(c, row.logicalWidth, 800, row.physicalWidth, 800, 800 / row.displayScale, 'offscreen');
  expect(p.pixelRatio).toBe(row.expected.pixelRatio); expect(p.densityDiameter).toBe(row.expected.uniform);
  expect(p.pointsDiameter).toBe(row.expected.points); expect(p.quadDiameter).toBe(row.expected.quad);
  expect(p.pointCloudUniformSize).toBe(F(row.expected.uniform * F(.01)));
 });
 for (const row of fixture.optics) it(`independent source optics: ${row.width}/${row.height}/${row.focalDistance}/${row.zoom}`, () => {
  const p = prepare(config(c => { c.camera.focalDistance = row.focalDistance; c.camera.zoom = row.zoom; }), row.width, row.height);
  for (const name of Object.keys(row.expected) as (keyof typeof row.expected)[]) expect(p.optics[name]).toBe(row.expected[name]);
 });
 it('retains raw authoring values and uses one F32 transform; density does not consume raw depth', () => {
  const c = config(c => { c.transform.scale = [-2, 0, 3]; c.transform.rotationDegrees = 1 + 2 ** -25; });
  const snapshot = structuredClone(c), p = prepare(c);
  expect(c).toEqual(snapshot); expect(p.transform.rotationDegrees).toBe(1);
  expect(transformRootsPoint(p, [1, 2, Infinity]).kind).toBe('point');
  expect(transformRootsPoint(prepare(config(c => { c.mode = 'point-cloud'; })), [1, 2, Infinity])).toEqual({kind: 'invalid', reason: 'nonfinite-input'});
  expect(transformRootsPoint(p, [Infinity, 2, 0])).toEqual({kind: 'invalid', reason: 'nonfinite-input'});
  const large = prepare(config(c => { c.transform.scale = [1e30, 1e30, 1]; }));
  expect(transformRootsPoint(large, [1e30, 1e30, 0])).toEqual({kind: 'invalid', reason: 'nonfinite-world'});
 });
 it('delegates authored dot/fade bounds and cloning to the sole configuration owner', () => {
  const c = config(c => { c.dotSize = 100; c.accumulation.fadeAlpha = -2; });
  const before = structuredClone(c), p = prepare(c);
  expect(c).toEqual(before); expect(p.densityDiameter).toBe(10); expect(p.accumulation.fadeAlpha).toBe(0);
  expect(p.worldTransformRule).toBe('host-f32-java-trig-reference'); expect(p.pointCloudTransformRule).toBe('raw-f32-glsl-radians-trig');
  c.camera.center[0] = 100; expect(p.camera.center[0]).toBe(0);
 });
 it('projects analytic origin and axes in physical top-down coordinates', () => {
  const p = prepare(config(c => { c.camera.phi = 0; c.camera.focalDistance = 50; }));
  for (const [world, expected] of [ [[0, 0, 0], [400, 400]], [[100, 50, 0], [500, 450]], [[-100, -50, 0], [300, 350]] ] as const) {
   const r = projectRootsPoint(p, world); expect(r.insideClip).toBe(true);
   expect(r.pixel![0]).toBeCloseTo(expected[0], 4); expect(r.pixel![1]).toBeCloseTo(expected[1], 4);
  }
  const p2 = prepare(config(c => { c.camera.phi = 0; c.camera.focalDistance = 50; }), 800, 800, 1600, 1600);
  expect(projectRootsPoint(p2, [100, 50, 0]).pixel).toEqual(projectRootsPoint(p, [100, 50, 0]).pixel!.map(x => x * 2));
  expect(p2.pointsDiameter).toBe(p.pointsDiameter * 2);
 });
 it('composes Rz(-gamma) Rx(phi) Rz(theta) in order and preserves a single matrix representation', () => {
  const p = prepare(config(c => { c.camera.phi = Math.PI / 2; c.camera.theta = Math.PI / 2; c.camera.gamma = 0; }));
  const q = prepare(config(c => { c.camera.phi = Math.PI / 2; c.camera.theta = 0; c.camera.gamma = Math.PI / 2; }));
  // Independent axis geometry: the first sends +X to +Z, the second to -Y.
  expect(p.modelView.rowMajor[0]).toBeCloseTo(0, 6); expect(p.modelView.rowMajor[4]).toBeCloseTo(0, 6); expect(p.modelView.rowMajor[8]).toBeCloseTo(1, 6);
  expect(q.modelView.rowMajor[0]).toBeCloseTo(0, 6); expect(q.modelView.rowMajor[4]).toBeCloseTo(-1, 6); expect(q.modelView.rowMajor[8]).toBeCloseTo(0, 6);
  for (const m of [p.modelView, p.projection]) for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) expect(m.columnMajor[col * 4 + row]).toBe(m.rowMajor[row * 4 + col]);
 });
 it('retains generic Processing Rodrigues axis rounding instead of specialized-axis simplification', () => {
  // Independent retained rotate(FFFF) @73..88: (1-c)*x*x+c. With
  // angle=1.58F, c=-0.009203585796058178 and the result is one ulp below1.
  const p = prepare(config(c => { c.camera.phi = 1.58; c.camera.theta = 0; c.camera.gamma = 0; }));
  expect(p.modelView.rowMajor[0]).toBe(0.9999999403953552);
  expect(p.modelView.rowMajor[0]).not.toBe(1);
 });
 it('wrapper leaves orthographic projection but restores the source perspective camera modelview', () => {
  const c = config(c => { c.camera.phi = 0; c.camera.focalDistance = 50; });
  const perspective = prepare(c); c.accumulation.enabled = true; const ortho = prepare(c);
  expect(ortho.optics.projectionKind).toBe('orthographic'); expect(ortho.modelView).toEqual(perspective.modelView);
  expect(ortho.projection.rowMajor[0]).toBe(F(2 / 800)); expect(ortho.projection.rowMajor[5]).toBe(F(-2 / 800));
  expect(ortho.projection.rowMajor[14]).toBe(0); expect(ortho.projection.rowMajor[15]).toBe(1);
  const a = projectRootsPoint(ortho, [100, 50, 0]), b = projectRootsPoint(ortho, [100, 50, 300]);
  expect(a.pixel).toEqual(b.pixel); expect(a.pixel![0]).toBeCloseTo(500, 4); expect(a.pixel![1]).toBeCloseTo(450, 4);
  expect(projectRootsPoint(perspective, [100, 50, 0]).pixel).not.toEqual(projectRootsPoint(perspective, [100, 50, 300]).pixel);
 });
 it('reports clipping without deleting offscreen quad centers and rejects singular derived cameras', () => {
  const p = prepare(config(c => { c.camera.phi = 0; }));
  const out = projectRootsPoint(p, [1e6, 0, 0]); expect(out.insideClip).toBe(false); expect(out.pixel![0]).toBeGreaterThan(800);
  const behind = projectRootsPoint(p, [0, 0, p.optics.cameraZ * 2]); expect(behind.pixel).toBeNull(); expect(behind.insideClip).toBe(false);
  expect(projectRootsPoint(p, [Infinity, 0, 0]).finite).toBe(false);
  for (const focal of [0, 1e30, 1e-44]) expect(() => prepare(config(c => { c.camera.focalDistance = focal; }))).toThrow(RootsProjectionError);
  // No arbitrary positive camera range. Zoom zero is clamped by the source FOV
  // recipe, and a finite negative focal distance is representable.
  expect(prepare(config(c => { c.camera.zoom = 0; })).optics.fov).toBe(F(3.1405928134918213));
  expect(prepare(config(c => { c.camera.focalDistance = -20; })).optics.cameraZ).toBeLessThan(0);
 });
 it('rejects dormant local plans and forged/transposed/mutated prepared facts', () => {
  expect(() => prepare(config(c => { c.model = 'local-v1'; }))).toThrow(RootsProjectionError);
  const p = prepare(); expect(() => validatePreparedRootsProjection(p)).not.toThrow();
  expect(() => validatePreparedRootsProjection({...p, pointsDiameter: 100})).toThrow(RootsProjectionError);
  expect(() => validatePreparedRootsProjection({...p, physicalWidth: 0})).toThrow(RootsProjectionError);
  expect(() => validatePreparedRootsProjection({...p, camera: {...p.camera, zoom: NaN}})).toThrow(RootsProjectionError);
  expect(() => validatePreparedRootsProjection({...p, transform: {...p.transform, scale: [Infinity, 1, 1]}})).toThrow(RootsProjectionError);
  p.modelView.columnMajor[0] = NaN;
  expect(() => validatePreparedRootsProjection(p)).toThrow(RootsProjectionError);
 });
});

describe('Roots density camera anchor observation reducer', () => {
 it('first capture and angle-only display preserve the matrix owner without clearing ink', () => {
  const initial = prepare(), a = updateRootsProjectionState(undefined, initial);
  expect(a.capture).toBe(true); expect(a.captureReason).toBe('initial'); expect(a.clearInk).toBe(false); expect(a.displayRotation).toBe(0);
  const next = changed(initial, c => { c.camera.phi += .3; c.camera.theta += .5; c.camera.gamma += .1; });
  const b = updateRootsProjectionState(a.state, next);
  expect(b.state.anchor).toBe(initial); expect(b.capture).toBe(false); expect(b.clearInk).toBe(false);
  expect(b.displayRotation).toBe(F(F(F(next.camera.phi - initial.camera.phi) + F(next.camera.theta - initial.camera.theta)) - F(next.camera.gamma - initial.camera.gamma)));
  expect(b.state.lastCamera).toBe(next.camera);
 });
 it('uses strict F32 threshold and updates previous values on every observation, not accumulated drift', () => {
  let p = prepare(config(c => { c.camera.center = [0, 0, 0]; }));
  const anchor = p; let state = updateRootsProjectionState(undefined, p).state;
  const exact = changed(p, c => { c.camera.center[0] = F(1e-4); });
  let update = updateRootsProjectionState(state, exact); expect(update.capture).toBe(false); state = update.state; p = exact;
  for (let i = 1; i < 100; i++) {
   p = changed(p, c => { c.camera.center[0] += .00005; }); update = updateRootsProjectionState(state, p); state = update.state;
   expect(update.capture).toBe(false); expect(update.clearInk).toBe(false); expect(state.anchor).toBe(anchor);
  }
  p = changed(p, c => { c.camera.center[0] += .00011; }); update = updateRootsProjectionState(state, p);
  expect(update.capture).toBe(true); expect(update.clearInk).toBe(true); expect(update.reasons).toEqual(['camera-projection']); expect(update.state.anchor).toBe(p);
 });
 it('resize and transform clear without recapture; dot/focal/wrapper and logical-only edits preserve ink and anchor', () => {
  const p = prepare(), state = updateRootsProjectionState(undefined, p).state;
  const size = prepare(config(), 800, 800, 1600, 1600);
  const a = updateRootsProjectionState(state, size); expect(a.reasons).toEqual(['physical-size']); expect(a.capture).toBe(false); expect(a.state.anchor).toBe(p);
  const transform = changed(p, c => { c.transform.rotationDegrees = 20; c.transform.scale[0] = -240; });
  const b = updateRootsProjectionState(state, transform); expect(b.reasons).toEqual(['transform']); expect(b.state.anchor).toBe(p);
  for (const edit of [(c: RootsPresentationConfiguration) => { c.dotSize = .1; }, (c: RootsPresentationConfiguration) => { c.camera.focalDistance = 50; }, (c: RootsPresentationConfiguration) => { c.accumulation.enabled = true; }]) {
   const u = updateRootsProjectionState(state, changed(p, edit)); expect(u.clearInk).toBe(false); expect(u.capture).toBe(false); expect(u.state.anchor).toBe(p);
  }
  const logical = prepare(config(), 400, 400, 800, 800, 800, 'offscreen');
  expect(updateRootsProjectionState(state, logical).clearInk).toBe(false); expect(updateRootsProjectionState(state, logical).capture).toBe(false);
 });
 it('owns resized splat facts with old captured matrices and current transform/diameter', () => {
  const original = prepare(config(c => { c.camera.phi = 0; }));
  const before = updateRootsProjectionState(undefined, original);
  const next = prepare(config(c => { c.camera.phi = .7; c.camera.focalDistance = 50; c.dotSize = .1; c.transform.offset = [1, 2, 3]; }), 900, 700, 1800, 1400, 800, 'offscreen');
  const result = updateRootsProjectionState(before.state, next), draw = result.splatPlan;
  expect(draw.physicalWidth).toBe(1800); expect(draw.physicalHeight).toBe(1400);
  expect(draw.transform).toBe(next.transform); expect(draw.pointsDiameter).toBe(next.pointsDiameter);
  expect(draw.projection).toBe(original.projection); expect(draw.modelView).toBe(original.modelView);
  expect(draw.camera).toBe(original.camera); expect(draw.optics).toBe(original.optics);
  expect(draw.matrixReferenceViewport).toBe(original.matrixReferenceViewport);
  expect(draw.matrixReferenceViewport.physicalWidth).toBe(800); expect(draw.target).toBe('offscreen');
  expect(result.state.lastCamera).toBe(next.camera); expect(result.state.current).toBe(next);
  expect(() => validatePreparedRootsProjection(draw)).not.toThrow();
  const originalPoint = projectRootsPoint(original, [100, 50, 0]).pixel!, point = projectRootsPoint(draw, [100, 50, 0]).pixel!;
  expect(point).toEqual([originalPoint[0] * 1800 / 800, originalPoint[1] * 1400 / 800]);
 });
 it('simultaneous resize/transform/zoom applies all clear facts and captures the current complete plan', () => {
  const p = prepare(), state = updateRootsProjectionState(undefined, p).state;
  const next = prepare(config(c => { c.camera.zoom = 2; c.camera.phi = .2; c.transform.offset = [1, 2, 3]; }), 900, 700);
  const result = updateRootsProjectionState(state, next);
  expect(result.reasons).toEqual(['physical-size', 'transform', 'camera-projection']); expect(result.state.anchor).toBe(next); expect(result.displayRotation).toBe(0);
  expect(state.current).toBe(p); expect(state.anchor).toBe(p);
 });
});
