import { JavaSourceRandom48,isJavaSourceLong } from './javaSourceRandom';
import { sourceProcessingCosLut } from './sourceProcessingTrig';

const F = Math.fround;
const javaInt = (value: number): number => Number.isNaN(value) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
const fade = (t: number): number => F(.5 * F(1 - sourceProcessingCosLut(javaInt(F(t * 360)) % 720)));
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

export const SOURCE_PROCESSING_NOISE_TABLE_BYTES=4096*Float32Array.BYTES_PER_ELEMENT;
export class SourceProcessingNoiseStateError extends Error {
 constructor(readonly code:'input'|'disposed',message:string){super(message);this.name='SourceProcessingNoiseStateError';}
}
/** One PApplet's mutable noiseSeed boundary. Existing immutable tables retain
 * their behavior; this owner swaps only its current table, never random().
 * Sampling has no cursor. Disposed borrowed samplers fail instead of quietly
 * continuing to read an orphaned table. */
export class SourceProcessingNoiseState {
 private current?:SourceProcessingNoise;
 private seed?:bigint;
 private reseeds=0;
 private disposed=false;
 constructor(seed:bigint){this.reseed(seed);}
 private check(){if(this.disposed)throw new SourceProcessingNoiseStateError('disposed','Processing noise state is disposed.');}
 reseed(seed:bigint):void{
  this.check();
  if(typeof seed!=='bigint'||!isJavaSourceLong(seed))throw new SourceProcessingNoiseStateError('input','Processing noise seed must be a signed Java long bigint.');
  const next=new SourceProcessingNoise(seed);
  this.current=next;this.seed=seed;this.reseeds++;
 }
 sample(x:number,y=0,z=0):number{this.check();return this.current!.sample(x,y,z);}
 diagnostics(){return{seed:this.seed?.toString(),reseeds:this.reseeds,retainedBytes:this.current?SOURCE_PROCESSING_NOISE_TABLE_BYTES:0,disposed:this.disposed};}
 dispose():void{this.current=undefined;this.seed=undefined;this.disposed=true;}
}
