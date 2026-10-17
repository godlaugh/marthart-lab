/** java.util.Random(long) from the retained runtime; exact integer recurrence.
 * All counts here refer to nextDouble calls (two 48-bit LCG steps per call).
 * No browser scheduling, thread completion order or native execution is implied. */
const MASK = (1n << 48n) - 1n, MULTIPLIER = 25214903917n, INCREMENT = 11n;
const MIN_LONG = -(1n << 63n), MAX_LONG = (1n << 63n) - 1n;
export const ROOTS_WORKER_SEED_INCREMENT = -7046029254386353131n;
function seedValid(seed: bigint): boolean { return typeof seed === 'bigint' && seed >= MIN_LONG && seed <= MAX_LONG; }
export class RootsSourceRandom48 {
 private state: bigint;
 constructor(seed: bigint) {
  if (!seedValid(seed)) throw new RangeError('Roots source seed must be a signed Java long.');
  this.state = (seed ^ MULTIPLIER) & MASK;
 }
 /** Internal 48-bit state, for bounded checkpoint ownership and diagnostics. */
 get state48(): bigint { return this.state; }
 clone(): RootsSourceRandom48 { const copy = new RootsSourceRandom48(0n); copy.state = this.state; return copy; }
 reset(seed: bigint): void {
  if (!seedValid(seed)) throw new RangeError('Roots source seed must be a signed Java long.');
  this.state = (seed ^ MULTIPLIER) & MASK;
 }
 private next(bits: number): number {
  this.state = (this.state * MULTIPLIER + INCREMENT) & MASK;
  return Number(this.state >> BigInt(48 - bits));
 }
 nextDouble(): number { return (this.next(26) * 134217728 + this.next(27)) * 2 ** -53; }
 /** Exact affine jump, O(log count), without constructing/discarding samples. */
 skipDraws(count: bigint | number): void {
  if (typeof count !== 'number' && typeof count !== 'bigint' || typeof count === 'number' && (!Number.isSafeInteger(count) || count < 0) || typeof count === 'bigint' && count < 0n) throw new RangeError('Roots random draw count must be a nonnegative exact integer.');
  let steps = BigInt(count) * 2n, multiplier = MULTIPLIER, increment = INCREMENT, m = 1n, c = 0n;
  // The full-period LCG repeats after 2^48 steps. Reduction also bounds work
  // for callers holding arbitrarily large bigint sample ordinals.
  steps &= MASK;
  while (steps) {
   if (steps & 1n) { m = (m * multiplier) & MASK; c = (c * multiplier + increment) & MASK; }
   increment = (increment * (multiplier + 1n)) & MASK; multiplier = (multiplier * multiplier) & MASK; steps >>= 1n;
  }
  this.state = (m * this.state + c) & MASK;
 }
}
export interface RootsWorkerPartition { readonly index: number; readonly start: number; readonly count: number; readonly seed: bigint }
export interface RootsWorkerPartitionPlan {
 readonly sampleCount: number; readonly configuredWorkers: number; readonly workerCount: number;
 /** Lazy facts avoid allocating an array sized by an untrusted worker count. */
 partition(index: number): RootsWorkerPartition;
 partitionForSample(ordinal: number): RootsWorkerPartition;
}
export type RootsWorkerPartitionResult = { ok: true; value: RootsWorkerPartitionPlan } | { ok: false; error: { kind: 'input'; field: 'sampleCount' | 'workerCount' | 'seed'; reason: string } };
export function prepareRootsWorkerPartitions(sampleCount: number, configuredWorkers: number, seed: bigint): RootsWorkerPartitionResult {
 const int = (x: number) => Number.isInteger(x) && x >= 1 && x <= 2147483647;
 if (!int(sampleCount)) return { ok: false, error: { kind: 'input', field: 'sampleCount', reason: 'Expected positive signed Java int after source configuration normalization.' } };
 if (!int(configuredWorkers)) return { ok: false, error: { kind: 'input', field: 'workerCount', reason: 'Expected positive signed Java int after source configuration normalization.' } };
 if (!seedValid(seed)) return { ok: false, error: { kind: 'input', field: 'seed', reason: 'Expected exact signed Java long.' } };
 const workerCount = Math.max(1, Math.min(configuredWorkers, sampleCount)), quotient = Math.floor(sampleCount / workerCount), remainder = sampleCount % workerCount;
 const partition = (index: number): RootsWorkerPartition => {
  if (!Number.isInteger(index) || index < 0 || index >= workerCount) throw new RangeError('Roots worker index is outside its prepared partition.');
  return Object.freeze({ index, start: index * quotient + Math.min(index, remainder), count: quotient + (index < remainder ? 1 : 0), seed: BigInt.asIntN(64, seed + ROOTS_WORKER_SEED_INCREMENT * BigInt(index)) });
 };
 return { ok: true, value: Object.freeze({ sampleCount, configuredWorkers, workerCount, partition, partitionForSample(ordinal: number): RootsWorkerPartition {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= sampleCount) throw new RangeError('Roots sample ordinal is outside its prepared partition.');
  const largerSpan = (quotient + 1) * remainder;
  return partition(ordinal < largerSpan ? Math.floor(ordinal / (quotient + 1)) : remainder + Math.floor((ordinal - largerSpan) / quotient));
 } }) };
}
