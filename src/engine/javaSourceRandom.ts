/** java.util.Random(long) from the retained runtime; exact integer recurrence.
 * skipDraws counts nextDouble calls (two 48-bit LCG steps per call).
 * No browser scheduling, thread completion order or native execution is implied. */
const MASK = (1n << 48n) - 1n, MULTIPLIER = 25214903917n, INCREMENT = 11n;
const MIN_LONG = -(1n << 63n), MAX_LONG = (1n << 63n) - 1n;
export function isJavaSourceLong(seed: bigint): boolean { return typeof seed === 'bigint' && seed >= MIN_LONG && seed <= MAX_LONG; }
export class JavaSourceRandom48 {
 private state: bigint;
 constructor(seed: bigint) {
  if (!isJavaSourceLong(seed)) throw new RangeError('Source random seed must be a signed Java long.');
  this.state = (seed ^ MULTIPLIER) & MASK;
 }
 /** Internal 48-bit state, for bounded checkpoint ownership and diagnostics. */
 get state48(): bigint { return this.state; }
 clone(): JavaSourceRandom48 { const copy = new JavaSourceRandom48(0n); copy.state = this.state; return copy; }
 reset(seed: bigint): void {
  if (!isJavaSourceLong(seed)) throw new RangeError('Source random seed must be a signed Java long.');
  this.state = (seed ^ MULTIPLIER) & MASK;
 }
 private next(bits: number): number {
  this.state = (this.state * MULTIPLIER + INCREMENT) & MASK;
  return Number(this.state >> BigInt(48 - bits));
 }
 /** Random.nextFloat: one next(24) draw, exactly representable in Float32. */
 nextFloat(): number { return this.next(24) * 2 ** -24; }
 /** Random.nextInt(bound), including signed-int rejection arithmetic. */
 nextInt(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > 2147483647) throw new RangeError('Source random bound must be a positive Java int.');
  const mask = bound - 1;
  let bits = this.next(31);
  if ((bound & mask) === 0) return Math.floor(bits / (2147483648 / bound));
  let value = bits % bound;
  while (((bits - value + mask) | 0) < 0) { bits = this.next(31); value = bits % bound; }
  return value;
 }
 nextDouble(): number { return (this.next(26) * 134217728 + this.next(27)) * 2 ** -53; }
 /** Exact affine jump, O(log count), without constructing/discarding samples. */
 skipDraws(count: bigint | number): void { this.skip(count,2n); }
 /** Random.nextFloat consumes one LCG step, including bounded chunk jumps. */
 skipFloatDraws(count: bigint | number): void { this.skip(count,1n); }
 private skip(count: bigint | number,stride:bigint): void {
  if (typeof count !== 'number' && typeof count !== 'bigint' || typeof count === 'number' && (!Number.isSafeInteger(count) || count < 0) || typeof count === 'bigint' && count < 0n) throw new RangeError('Source random draw count must be a nonnegative exact integer.');
  let steps = BigInt(count) * stride, multiplier = MULTIPLIER, increment = INCREMENT, m = 1n, c = 0n;
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
