import type { SourcePerlinAngleField } from './sourcePerlinAngleField';
import { JavaSourceRandom48 } from './javaSourceRandom';
import { sourcePerlinSeed, sourcePerlinMix64 } from './sourcePerlinSeed';

const F = Math.fround;
/** Local typed-representation budget: owned geometry, transactional candidate,
 * and one detached snapshot together. Caller-retained extra copies and an
 * externally owned angle/noise field are accounted for by their own owners. */
export const SOURCE_PERLIN_CURVE_GEOMETRY_BYTES = 64 * 1024 * 1024;
export class SourcePerlinCurveGeometryError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'nonfinite' | 'cancelled', message: string) { super(message); this.name = code === 'cancelled' ? 'AbortError' : 'SourcePerlinCurveGeometryError'; }
}
const finite = (value: number): number => {
 if (typeof value !== 'number' || !Number.isFinite(F(value))) throw new SourcePerlinCurveGeometryError('nonfinite', 'Perlin curve values must be finite Float32.');
 return F(value);
};
const integer = (value: number): number => {
 if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new SourcePerlinCurveGeometryError('input', 'Perlin curve count and length require Java int32.');
 return value;
};
/** initFieldCurves applies this joint fallback, before angle-field construction. */
export function sourcePerlinCurveDimensions(width: number, height: number): Readonly<{ width: number; height: number }> {
 width = finite(width); height = finite(height);
 return Object.freeze(width < 200 || height < 200 ? { width: 800, height: 800 } : { width, height });
}
type AngleField = Pick<SourcePerlinAngleField, 'sample'>;
export interface SourcePerlinCurveGeometryOptions {
 readonly seed: string | number;
 readonly count: number;
 readonly length: number;
 readonly width: number;
 readonly height: number;
 readonly sampling: 'random' | 'jittered-grid';
 readonly stepSize: number;
 readonly angleField: AngleField;
 readonly noiseOffset: number;
 readonly isCancelled?: () => boolean;
}
export interface SourcePerlinCurveRebuildOptions {
 readonly length?: number;
 readonly stepSize?: number;
 readonly noiseOffset?: number;
 readonly angleField?: AngleField;
}
interface GeometryState {
 readonly sourceLength: number;
 readonly length: number;
 readonly stepSize: number;
 readonly noiseOffset: number;
 readonly angleField: AngleField;
 readonly xs: Float32Array;
 readonly ys: Float32Array;
}

/** Static-derived sampleCurveSeed/buildFieldCurve/fillFieldCurve owner.
 * Seeds are fixed for this instance. Rebuild does not touch color state, draw
 * order, ambient Processing noise or random cursors. Every public array is a
 * detached copy; failed/cancelled rebuilds preserve the complete old geometry.
 * This is path geometry, not a Processing/JOGL stroke rasterizer. */
export class SourcePerlinCurveGeometry {
 readonly width: number;
 readonly height: number;
 readonly count: number;
 readonly seed: string;
 readonly sampling: 'random' | 'jittered-grid';
 private readonly sourceCount: number;
 private readonly seedXs: Float32Array;
 private readonly seedYs: Float32Array;
 private readonly isCancelled?: () => boolean;
 private state: GeometryState;
 constructor(options: SourcePerlinCurveGeometryOptions) {
  if (!options || !['random', 'jittered-grid'].includes(options.sampling)) throw new SourcePerlinCurveGeometryError('input', 'Unknown Perlin curve sampling mode.');
  const dimensions = sourcePerlinCurveDimensions(options.width, options.height);
  this.width = dimensions.width; this.height = dimensions.height;
  this.sourceCount = integer(options.count); this.count = Math.max(1, this.sourceCount);
  this.sampling = options.sampling; this.isCancelled = options.isCancelled;
  const sourceSeed = sourcePerlinSeed(options.seed).originalSeed; this.seed = sourceSeed.toString();
  const sourceLength = integer(options.length), length = Math.max(2, sourceLength);
  this.admit(length, length); this.check();
  const stepSize = finite(options.stepSize), noiseOffset = finite(options.noiseOffset);
  this.assertField(options.angleField);
  this.seedXs = new Float32Array(this.count); this.seedYs = new Float32Array(this.count);
  const random = new JavaSourceRandom48(sourcePerlinMix64(BigInt.asIntN(64, sourceSeed ^ 7866515270071974961n)));
  const ratio = Math.max(F(.0001), F(this.width / Math.max(1, this.height)));
  const columns = Math.max(1, Math.min(2147483647, Math.ceil(Math.sqrt(F(F(this.count) * ratio)))));
  const rows = Math.max(1, Math.ceil(this.count / columns));
  const dx = F(this.width / F(columns)), dy = F(this.height / F(rows));
  for (let i = 0; i < this.count; i++) {
   if ((i & 127) === 0) this.check();
   const rx = random.nextFloat(), ry = random.nextFloat();
   if (this.sampling === 'random') { this.seedXs[i] = finite(F(rx * this.width)); this.seedYs[i] = finite(F(ry * this.height)); }
   else {
    const jx = F(F(.18) + F(F(.64) * rx)), jy = F(F(.18) + F(F(.64) * ry));
    this.seedXs[i] = finite(Math.min(this.width, F(F(F(i % columns) + jx) * dx)));
    this.seedYs[i] = finite(Math.min(this.height, F(F(F(Math.trunc(i / columns)) + jy) * dy)));
   }
  }
  this.state = this.build(sourceLength, stepSize, noiseOffset, options.angleField);
 }
 private check(): void { if (this.isCancelled?.()) throw new SourcePerlinCurveGeometryError('cancelled', 'Perlin curve geometry generation cancelled.'); }
 private assertField(field: AngleField): void { if (!field || typeof field.sample !== 'function') throw new SourcePerlinCurveGeometryError('input', 'Perlin curves require an owned source angle field.'); }
 private admit(length: number, previousLength: number): number {
  // Two coordinate arrays per generation; two seed arrays retained + copied.
  // Count both old and candidate snapshots conservatively during a rebuild.
  // Reserve a same-sized next generation too, so growth cannot install a state
  // whose subsequent snapshot/rebuild would exceed the admitted envelope.
  const bytesPerCurve = 16 * Math.max(previousLength, length) + 16 * length + 16;
  if (this.count > Math.floor(SOURCE_PERLIN_CURVE_GEOMETRY_BYTES / bytesPerCurve)) throw new SourcePerlinCurveGeometryError('capacity', 'Perlin curves exceed the local geometry and transactional-copy budget.');
  return this.count * bytesPerCurve;
 }
 private build(sourceLength: number, stepSize: number, noiseOffset: number, field: AngleField): GeometryState {
  const length = Math.max(2, sourceLength), xs = new Float32Array(this.count * length), ys = new Float32Array(xs.length);
  const halfWidth = F(this.width * .5), halfHeight = F(this.height * .5), middle = Math.trunc(length / 2);
  let work = 0;
  for (let curve = 0; curve < this.count; curve++) {
   this.check();
   const seedX = this.seedXs[curve], seedY = this.seedYs[curve], base = curve * length;
   xs[base + middle] = finite(F(seedX - halfWidth)); ys[base + middle] = finite(F(seedY - halfHeight));
   // Complete the backward half before resetting to the same seed for forward.
   for (const direction of [-1, 1] as const) {
    let x = seedX, y = seedY;
    for (let point = middle + direction; point >= 0 && point < length; point += direction) {
     if ((work++ & 127) === 0) this.check();
     const angle = finite(field.sample(x, y, noiseOffset, this.width, this.height));
     const moveX = F(F(Math.cos(angle)) * stepSize), moveY = F(F(Math.sin(angle)) * stepSize);
     x = finite(direction < 0 ? F(x - moveX) : F(x + moveX));
     y = finite(direction < 0 ? F(y - moveY) : F(y + moveY));
     xs[base + point] = finite(F(x - halfWidth)); ys[base + point] = finite(F(y - halfHeight));
    }
   }
  }
  this.check(); return { sourceLength, length, stepSize, noiseOffset, angleField: field, xs, ys };
 }
 rebuild(options: SourcePerlinCurveRebuildOptions = {}): void {
  this.check();
  const old = this.state, sourceLength = options.length === undefined ? old.sourceLength : integer(options.length);
  const length = Math.max(2, sourceLength), stepSize = options.stepSize === undefined ? old.stepSize : finite(options.stepSize), noiseOffset = options.noiseOffset === undefined ? old.noiseOffset : finite(options.noiseOffset);
  const field = options.angleField ?? old.angleField;
  this.assertField(field); this.admit(length, old.length);
  const candidate = this.build(sourceLength, stepSize, noiseOffset, field);
  this.state = candidate;
 }
 diagnostics() {
  return { count: this.count, length: this.state.length, sourceCount: this.sourceCount, sourceLength: this.state.sourceLength, width: this.width, height: this.height, retainedBytes: this.count * 8 + this.count * this.state.length * 8, reservedWorkingBytes: this.admit(this.state.length, this.state.length), seedRandomDraws: this.count * 2 };
 }
 snapshot() {
  this.check();
  const snapshot = { seed: this.seed, count: this.count, length: this.state.length, width: this.width, height: this.height, sampling: this.sampling, stepSize: this.state.stepSize, noiseOffset: this.state.noiseOffset, seedXs: this.seedXs.slice(), seedYs: this.seedYs.slice(), xs: this.state.xs.slice(), ys: this.state.ys.slice() };
  this.check(); return snapshot;
 }
}
