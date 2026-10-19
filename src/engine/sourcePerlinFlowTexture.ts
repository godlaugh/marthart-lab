import { sourcePerlinSeed } from './sourcePerlinSeed';
import { SourceProcessingNoise } from './sourceProcessingNoise';

const F = Math.fround;
const mul = (a: number, b: number): number => F(a * F(b));
const add = (a: number, b: number): number => F(a + b);
const sub = (a: number, b: number): number => F(a - b);
const pow = (a: number, b: number): number => F(Math.pow(a, F(b)));
const ridge = (a: number): number => sub(1, mul(Math.abs(sub(a, .5)), 2));
const clamp = (a: number): number => Math.max(0, Math.min(1, a));
export type SourcePerlinFlowStyle = 0 | 1 | 2 | 3 | 4 | 5;
/** Local allocation budget: one packed image, at most 16 MiB. Source default is 512². */
export const SOURCE_PERLIN_FLOW_MAX_PIXELS = 4 * 1024 * 1024;
export class SourcePerlinFlowTextureError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'cancelled', message: string) { super(message); this.name = 'SourcePerlinFlowTextureError'; }
}
export interface SourcePerlinFlowTextureOptions {
 seed: string | number;
 style: SourcePerlinFlowStyle;
 size?: number;
 isCancelled?: () => boolean;
}

/** Static-derived buildFlowTexture, no JVM/JOGL or whole-frame parity claim.
 * Every source style resets noiseSeed before its first sample; samples only read
 * the resulting immutable table. Generating a selected style therefore produces
 * the same pixels as building all six, without preserving ambient noise state.
 * ARGB is unsigned and row-major; no vertical flip or GPU filtering is applied. */
export class SourcePerlinFlowTexture {
 readonly size: number;
 readonly style: SourcePerlinFlowStyle;
 readonly textureSeed: number;
 readonly noiseSeed: number;
 private readonly noise: SourceProcessingNoise;
 private readonly isCancelled?: () => boolean;
 constructor(options: SourcePerlinFlowTextureOptions) {
  if (!options || !Number.isInteger(options.style) || options.style < 0 || options.style > 5) throw new SourcePerlinFlowTextureError('input', 'Perlin flow style must be an integer from 0 to 5.');
  this.size = options.size ?? 512;
  if (!Number.isSafeInteger(this.size) || this.size < 1) throw new SourcePerlinFlowTextureError('input', 'Perlin flow size must be a positive integer.');
  if (this.size > Math.floor(Math.sqrt(SOURCE_PERLIN_FLOW_MAX_PIXELS))) throw new SourcePerlinFlowTextureError('capacity', 'Perlin flow image exceeds the local pixel allocation budget.');
  this.style = options.style;
  this.textureSeed = sourcePerlinSeed(options.seed).textureSeed;
  this.noiseSeed = this.textureSeed ^ Math.imul(-1640531527, this.style + 1);
  this.isCancelled = options.isCancelled;
  this.checkCancelled();
  this.noise = new SourceProcessingNoise(BigInt(this.noiseSeed));
 }
 private checkCancelled(): void {
  if (this.isCancelled?.()) throw new SourcePerlinFlowTextureError('cancelled', 'Perlin flow texture generation cancelled.');
 }
 scalar(x: number, y: number): number {
  this.checkCancelled();
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.size || y >= this.size) throw new SourcePerlinFlowTextureError('input', 'Perlin texture coordinates must identify an image pixel.');
  return this.value(F(F(x) / F(this.size)), F(F(y) / F(this.size)));
 }
 sample(x: number, y: number): number { return this.argb(this.scalar(x, y)); }
 generate(): Uint32Array {
  this.checkCancelled();
  const pixels = new Uint32Array(this.size * this.size);
  for (let y = 0; y < this.size; y++) {
   const v = F(F(y) / F(this.size));
   for (let x = 0; x < this.size; x++) {
    if ((x & 255) === 0) this.checkCancelled();
    pixels[y * this.size + x] = this.argb(this.value(F(F(x) / F(this.size)), v));
   }
  }
  this.checkCancelled();
  return pixels;
 }
 private argb(value: number): number {
  // PApplet.color(float) -> PGraphics.colorCalc with RGB maximum 255.
  const gray = Math.trunc(mul(F(mul(value, 255) / 255), 255));
  return (0xff000000 | (gray << 16) | (gray << 8) | gray) >>> 0;
 }
 private value(u: number, v: number): number {
  const n = (x: number, y: number, z: number): number => this.noise.sample(x, y, F(z));
  let q: number;
  switch (this.style) {
   case 0: {
    const a = n(mul(u, 3), mul(v, 3), .11), b = n(mul(u, 9), mul(v, 9), .37);
    const c = n(mul(add(u, mul(v, .75)), 26), mul(sub(v, mul(u, .33)), 6), .71);
    const d = n(mul(sub(u, mul(v, .42)), 42), mul(add(v, mul(u, .18)), 8), 1.13);
    q = pow(add(add(add(mul(a, .42), mul(b, .28)), mul(ridge(c), .22)), mul(ridge(d), .08)), 1.35); break;
   }
   case 1: {
    const a = n(mul(add(u, mul(v, .4)), 4.5), mul(sub(v, mul(u, .3)), 4.5), .19);
    const b = n(mul(sub(u, mul(v, .2)), 14), mul(add(v, mul(u, .2)), 14), .53);
    const c = n(mul(add(u, v), 36), mul(sub(v, u), 36), .97);
    q = pow(add(add(mul(a, .35), mul(b, .3)), mul(pow(ridge(c), 2.5), .35)), 1.2); break;
   }
   case 2: {
    const a = n(mul(add(u, mul(F(Math.sin(mul(v, 6.2831854820251465))), .15)), 8), mul(v, 2.6), .23);
    const b = n(mul(add(u, mul(v, .65)), 18), mul(sub(v, mul(u, .28)), 3), .77);
    q = pow(add(mul(a, .62), mul(pow(ridge(b), 1.8), .38)), 1.1); break;
   }
   case 3: {
    const x = sub(u, .5), y = sub(v, .5), radius = F(Math.sqrt(add(mul(x, x), mul(y, y))));
    const wave = add(.5, mul(F(Math.sin(add(mul(radius, 42), mul(n(mul(u, 6), mul(v, 6), .13), 5)))), .5));
    const b = n(mul(add(u, mul(v, .4)), 10), mul(sub(v, mul(u, .4)), 10), .89);
    q = pow(add(mul(wave, .58), mul(b, .42)), 1.35); break;
   }
   case 4: {
    const a = n(mul(u, 3.5), mul(sub(1, v), 8.5), .21);
    const b = n(mul(add(u, mul(a, .35)), 14), mul(add(v, mul(a, .2)), 14), .91);
    const c = pow(clamp(add(sub(1, v), mul(b, .25))), 1.9);
    q = pow(add(add(mul(a, .48), mul(b, .22)), mul(c, .3)), .95); break;
   }
   case 5: {
    const a = n(mul(u, 2.2), mul(v, 2.2), .09);
    const b = n(mul(add(u, mul(v, .25)), 7), mul(sub(v, mul(u, .25)), 7), .49);
    const c = n(mul(u, 18), mul(v, 18), 1.01);
    q = pow(add(add(mul(a, .55), mul(b, .3)), mul(c, .15)), 1.55); break;
   }
  }
  return clamp(q);
 }
}
