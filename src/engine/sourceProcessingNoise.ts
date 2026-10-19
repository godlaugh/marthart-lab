import { JavaSourceRandom48 } from './javaSourceRandom';

const F = Math.fround;
const javaInt = (value: number): number => Number.isNaN(value) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
// PGraphics.<clinit>: F(cos(F(F(i * DEG_TO_RAD) * .5))).
const COS = Float32Array.from({ length: 720 }, (_, i) => F(Math.cos(F(F(i * F(Math.PI / 180)) * .5))));
const fade = (t: number): number => F(.5 * F(1 - COS[javaInt(F(t * 360)) % 720]));
const lerp = (a: number, b: number, t: number): number => F(a + F(t * F(b - a)));

/** Processing's seeded value noise, not permutation/gradient Perlin noise.
 * Retained PApplet.noise(FFF), four default octaves and .5 amplitude falloff.
 * The immutable 4096-float table is private; sampling consumes no random draws.
 * This owner does not mutate an ambient PApplet's noiseSeed/noiseDetail state. */
export class SourceProcessingNoise {
 private readonly table: Float32Array;
 constructor(seed: bigint) {
  const random = new JavaSourceRandom48(seed);
  this.table = Float32Array.from({ length: 4096 }, () => random.nextFloat());
 }
 sample(x: number, y = 0, z = 0): number {
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') throw new RangeError('Processing noise coordinates must be numbers.');
  x = Math.abs(F(x)); y = Math.abs(F(y)); z = Math.abs(F(z));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new RangeError('Processing noise coordinates must be finite Float32 values.');
  let xi = javaInt(x), yi = javaInt(y), zi = javaInt(z);
  let xf = F(x - F(xi)), yf = F(y - F(yi)), zf = F(z - F(zi));
  let result = 0, amplitude = .5;
  const p = this.table;
  for (let octave = 0; octave < 4; octave++) {
   const offset = (xi + (yi << 4) + (zi << 8)) | 0;
   const rx = fade(xf), ry = fade(yf);
   const lower = lerp(lerp(p[offset & 4095], p[(offset + 1) & 4095], rx), lerp(p[(offset + 16) & 4095], p[(offset + 17) & 4095], rx), ry);
   const upper = lerp(lerp(p[(offset + 256) & 4095], p[(offset + 257) & 4095], rx), lerp(p[(offset + 272) & 4095], p[(offset + 273) & 4095], rx), ry);
   result = F(result + F(lerp(lower, upper, fade(zf)) * amplitude));
   amplitude = F(amplitude * .5);
   xi <<= 1; yi <<= 1; zi <<= 1;
   xf = F(xf * 2); yf = F(yf * 2); zf = F(zf * 2);
   if (xf >= 1) { xi = (xi + 1) | 0; xf = F(xf - 1); }
   if (yf >= 1) { yi = (yi + 1) | 0; yf = F(yf - 1); }
   if (zf >= 1) { zi = (zi + 1) | 0; zf = F(zf - 1); }
  }
  return result;
 }
}
