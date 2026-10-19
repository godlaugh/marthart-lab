import { sourceColorLerp } from './domainSourcePalette';
import { JavaSourceRandom48 } from './javaSourceRandom';
import type { SourcePerlinColorRuntime } from './sourcePerlinColorRuntime';
import { sourcePerlinFbm } from './sourcePerlinFbm';
import { sourcePerlinMix64, sourcePerlinSeed } from './sourcePerlinSeed';
import type { SourceProcessingNoise } from './sourceProcessingNoise';

const F = Math.fround;
/** Three float arrays plus packed ARGB: 4 MiB retained and one 4 MiB snapshot.
 * This is a local representation budget, not a source circle-count limit. */
export const SOURCE_PERLIN_CURVE_COLOR_BYTES = 8 * 1024 * 1024;
export class SourcePerlinCurveColorsError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'nonfinite' | 'cancelled', message: string) { super(message); this.name = code === 'cancelled' ? 'AbortError' : 'SourcePerlinCurveColorsError'; }
}
const finite = (value: number) => {
 if (typeof value !== 'number' || !Number.isFinite(F(value))) throw new SourcePerlinCurveColorsError('nonfinite', 'Perlin curve colors require finite Float32 values.');
 return F(value);
};
const integer = (value: number) => {
 if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new SourcePerlinCurveColorsError('input', 'Perlin curve color counts and indices require Java int32.');
 return value;
};
const packed = (value: number) => {
 if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new SourcePerlinCurveColorsError('input', 'Perlin color sampler must return unsigned packed ARGB.');
 return value;
};
const constrain = (value: number) => Math.max(0, Math.min(1, value));
export type SourcePerlinCurveColorMode = 'seed-space' | 'noise' | 'index' | 'position';
export interface SourcePerlinCurveColorsOptions {
 readonly seed: string | number;
 /** Effective field dimensions, already selected by initFieldCurves. */
 readonly width: number; readonly height: number;
 readonly seedSpaceCircleCount: number;
 readonly minRadius: number; readonly maxRadius: number;
 readonly colors: Pick<SourcePerlinColorRuntime, 'sampleCurrent' | 'sampleShifted'>;
 /** Caller owns the ambient Processing noise lifecycle. */
 readonly noise: Pick<SourceProcessingNoise, 'sample'>;
 readonly isCancelled?: () => boolean;
}
export interface SourcePerlinCurveColorQuery {
 readonly mode: SourcePerlinCurveColorMode;
 readonly index: number; readonly count: number;
 readonly x: number; readonly y: number;
 readonly curveNoiseScale: number; readonly curveNoiseOctaves: number;
}

/** Owns fixed seed-space blobs only. Curve geometry and cached per-curve colors
 * remain separate owners: rebuilding a path must not recreate blobs or resolve
 * existing curve colors. Explicit refreshes may supply ColorRuntime's captured
 * sampler; ordinary resolves use its current state. No local gradient rules. */
export class SourcePerlinCurveColors {
 readonly width: number; readonly height: number; readonly seed: string;
 private readonly count: number;
 private readonly xs: Float32Array; private readonly ys: Float32Array;
 private readonly radii: Float32Array; private readonly blobColors: Uint32Array;
 private readonly colors: SourcePerlinCurveColorsOptions['colors'];
 private readonly noise: SourcePerlinCurveColorsOptions['noise'];
 private readonly isCancelled?: () => boolean;
 constructor(options: SourcePerlinCurveColorsOptions) {
  this.width = finite(options.width); this.height = finite(options.height);
  if (this.width <= 0 || this.height <= 0) throw new SourcePerlinCurveColorsError('input', 'Perlin curve colors require positive effective field dimensions.');
  this.count = Math.max(0, integer(options.seedSpaceCircleCount));
  const minRadius = Math.max(0, finite(options.minRadius)), maxRadius = Math.max(minRadius, finite(options.maxRadius));
  this.colors = options.colors; this.noise = options.noise; this.isCancelled = options.isCancelled;
  if (!this.colors || typeof this.colors.sampleCurrent !== 'function' || typeof this.colors.sampleShifted !== 'function' || !this.noise || typeof this.noise.sample !== 'function') throw new SourcePerlinCurveColorsError('input', 'Perlin curve colors require source palette and noise owners.');
  const seed = sourcePerlinSeed(options.seed).originalSeed; this.seed = seed.toString();
  if (this.count > Math.floor(SOURCE_PERLIN_CURVE_COLOR_BYTES / 32)) throw new SourcePerlinCurveColorsError('capacity', 'Perlin seed-space blobs exceed the local retained-and-copy budget.');
  this.check();
  const xs = new Float32Array(this.count), ys = new Float32Array(this.count), radii = new Float32Array(this.count), colors = new Uint32Array(this.count);
  const random = new JavaSourceRandom48(sourcePerlinMix64(BigInt.asIntN(64, seed ^ -7046029254386353131n)));
  for (let i = 0; i < this.count; i++) {
   if ((i & 127) === 0) this.check();
   xs[i] = F(random.nextFloat() * this.width); ys[i] = F(random.nextFloat() * this.height);
   radii[i] = F(minRadius + F(random.nextFloat() * F(maxRadius - minRadius)));
   colors[i] = packed(this.colors.sampleShifted(random.nextFloat(), 0));
  }
  this.check(); this.xs = xs; this.ys = ys; this.radii = radii; this.blobColors = colors;
 }
 private check() { if (this.isCancelled?.()) throw new SourcePerlinCurveColorsError('cancelled', 'Perlin curve color generation cancelled.'); }
 resolve(query: SourcePerlinCurveColorQuery, sampleGradient: (coordinate: number) => number = coordinate => this.colors.sampleCurrent(coordinate)): number {
  this.check();
  if (!query || !['seed-space', 'noise', 'index', 'position'].includes(query.mode) || typeof sampleGradient !== 'function') throw new SourcePerlinCurveColorsError('input', 'Unknown Perlin curve color mode or sampler.');
  const index = integer(query.index), count = integer(query.count), x = finite(query.x), y = finite(query.y);
  const scale = finite(query.curveNoiseScale), octaves = integer(query.curveNoiseOctaves);
  const u = F(x / Math.max(1, this.width)), v = F(y / Math.max(1, this.height));
  let coordinate: number;
  if (query.mode === 'seed-space') {
   let color = packed(sampleGradient(F(F(constrain(u) + constrain(v)) * .5)));
   for (let i = 0; i < this.count; i++) {
    if ((i & 127) === 0) this.check();
    const dx = F(x - this.xs[i]), dy = F(y - this.ys[i]), distance = F(Math.sqrt(F(F(dx * dx) + F(dy * dy))));
    if (distance < this.radii[i]) {
     const t = F(1 - F(distance / this.radii[i])), smooth = F(F(t * t) * F(3 - F(2 * t)));
     color = sourceColorLerp(color, this.blobColors[i], smooth, 'rgb');
    }
   }
   this.check(); return color;
  }
  if (query.mode === 'noise') coordinate = sourcePerlinFbm(this.noise, F(u * scale), F(v * scale), octaves);
  else if (query.mode === 'index') coordinate = count <= 1 ? 0 : F(F(index) / F(count - 1));
  else coordinate = F(F(F(.65) * u) + F(F(.35) * v));
  const color = packed(sampleGradient(coordinate)); this.check(); return color;
 }
 diagnostics() { return { count: this.count, retainedBytes: this.count * 16, reservedWorkingBytes: this.count * 32, seedRandomDraws: this.count * 4 }; }
 snapshotBlobs() {
  this.check();
  const result = { xs: this.xs.slice(), ys: this.ys.slice(), radii: this.radii.slice(), colors: this.blobColors.slice() };
  this.check(); return result;
 }
}
