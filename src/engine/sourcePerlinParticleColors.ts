import { SourcePerlinColorRuntime, SOURCE_PERLIN_INITIAL_COLOR_LIMIT, type SourcePerlinColorSnapshot } from './sourcePerlinColorRuntime';

const F = Math.fround;
export const SOURCE_PERLIN_PARTICLE_COLOR_BYTES = SOURCE_PERLIN_INITIAL_COLOR_LIMIT * 12;
export class SourcePerlinParticleColorsError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'cancelled' | 'failed', message: string) { super(message); this.name = code === 'cancelled' ? 'AbortError' : 'SourcePerlinParticleColorsError'; }
}
export interface SourcePerlinParticleColorsOptions {
 readonly count: number;
 readonly palette?: readonly number[];
 readonly isCancelled?: () => boolean;
}
export interface SourcePerlinParticleColorsSnapshot {
 readonly packed: Uint32Array;
 readonly runtime: SourcePerlinColorSnapshot;
}
/** Owns current per-particle col/baseCol, not trail-age colors. The shared
 * ColorRuntime is the sole palette/gradient owner and invokes atomic refreshes.
 * Borrowed packed identity never changes; consumers must not mutate or transfer
 * it. A rejected refresh keeps its previous complete bytes and invalidates this
 * owner. Recreate the scene after failure instead of consuming stale colors. */
export class SourcePerlinParticleColors {
 readonly count: number;
 readonly runtime: SourcePerlinColorRuntime;
 private readonly values: Uint32Array;
 private readonly isCancelled?: () => boolean;
 private failed = false;
 constructor(options: SourcePerlinParticleColorsOptions) {
  if (!Number.isInteger(options.count) || options.count < 0 || options.count > 2147483647) throw new SourcePerlinParticleColorsError('input', 'Perlin particle color count requires a nonnegative Java int.');
  this.count = options.count; this.isCancelled = options.isCancelled;
  if (this.count > SOURCE_PERLIN_INITIAL_COLOR_LIMIT) throw new SourcePerlinParticleColorsError('capacity', 'Perlin particle colors exceed the local retained, candidate and copy budget.');
  this.check();
  this.runtime = new SourcePerlinColorRuntime({ palette: options.palette, isCancelled: options.isCancelled, onRefresh: sample => this.refresh(sample) });
  this.values = this.runtime.initialParticleColors(this.count);
 }
 private check() {
  if (this.failed) throw new SourcePerlinParticleColorsError('failed', 'Perlin particle colors failed; rebuild before use.');
  if (this.isCancelled?.()) throw new SourcePerlinParticleColorsError('cancelled', 'Perlin particle color update cancelled.');
 }
 private refresh(sample: (coordinate: number) => number) {
  try {
   this.check();
   const candidate = new Uint32Array(this.count);
   for (let i = 0; i < this.count; i++) {
    if ((i & 255) === 0) this.check();
    candidate[i] = sample(this.count <= 1 ? 0 : F(F(i) / F(this.count - 1)));
   }
   this.check(); this.values.set(candidate);
  } catch (error) { this.failed = true; throw error; }
 }
 /** Read-only borrowing contract for particle/trail consumers. Runtime failure
  * before a refresh callback also makes subsequent borrowing fail closed. */
 get packed(): Uint32Array { this.check(); this.runtime.snapshot(); return this.values; }
 snapshot(): SourcePerlinParticleColorsSnapshot {
  this.check(); const runtime = this.runtime.snapshot(), packed = this.values.slice(); this.check();
  return { packed, runtime };
 }
 diagnostics() {
  this.check(); this.runtime.snapshot();
  return { count: this.count, retainedBytes: this.count * 4, reservedWorkingBytes: this.count * 12 };
 }
}
