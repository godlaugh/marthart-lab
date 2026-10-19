import type { SourceProcessingNoise } from './sourceProcessingNoise';

const F = Math.fround;
export class SourcePerlinFbmError extends Error {
 constructor(readonly code: 'input' | 'nonfinite', message: string) { super(message); this.name = 'SourcePerlinFbmError'; }
}
const finite = (value: number) => {
 if (typeof value !== 'number' || !Number.isFinite(F(value))) throw new SourcePerlinFbmError('nonfinite', 'Perlin FBM requires finite Float32 coordinates and noise samples.');
 return F(value);
};
/** PerlinNoiseField.fbm: the same outer octave loop serves the angle grid and
 * NOISE curve colors. Its noise owner retains Processing's inner octave loop
 * and seed lifecycle; this function never reseeds or consumes random draws. */
export function sourcePerlinFbm(noise: Pick<SourceProcessingNoise, 'sample'>, x: number, y: number, octaves: number): number {
 x = finite(x); y = finite(y);
 if (!noise || typeof noise.sample !== 'function' || !Number.isInteger(octaves) || octaves < -2147483648 || octaves > 2147483647) throw new SourcePerlinFbmError('input', 'Perlin FBM requires a noise owner and Java int32 octave count.');
 const count = Math.max(1, Math.min(6, octaves));
 let sum = 0, weight = 0, amplitude = 1, frequency = 1;
 for (let i = 0; i < count; i++) {
  sum = F(sum + F(finite(noise.sample(F(x * frequency), F(y * frequency))) * amplitude));
  weight = F(weight + amplitude); amplitude = F(amplitude * .5); frequency = F(frequency * 2);
 }
 return finite(F(sum / weight));
}
