/** Raw arrival-order point storage; no solver, projection or color interpretation.
 * The retained source keeps 10M points and draws its most recent 3M. Its GPU
 * staging has six floats (two unused) and constrains metric on upload, whereas
 * the native-shape path reads the original metric. This shared ring therefore
 * retains four raw floats; the GPU upload owner must apply that source clamp.
 * See ComplexRootsMobject.appendBatchToPointCloudStaging / drawRecentPointCloudWindow.
 */
export const ROOTS_POINT_CLOUD_CAPACITY = 10_000_000;
export const ROOTS_POINT_CLOUD_RECENT_WINDOW = 3_000_000;
export const ROOTS_POINT_CLOUD_STRIDE = 4;
/** Local synchronous submission bound: at most 1 MiB copied per call. This is
 * not a native format limit; callers must split larger arrival batches. */
export const ROOTS_POINT_CLOUD_APPEND_LIMIT = 65_536;
export const ROOTS_POINT_CLOUD_DEFAULT_BYTES = ROOTS_POINT_CLOUD_CAPACITY * ROOTS_POINT_CLOUD_STRIDE * Float32Array.BYTES_PER_ELEMENT;

export class RootsPointCloudRingError extends Error {
 constructor(readonly kind: 'input' | 'capacity' | 'state' | 'allocation', readonly reason: string, options?: ErrorOptions) {
  super(`Roots point ring: ${reason}`, options); this.name = 'RootsPointCloudRingError';
 }
}
export type RootsPointCloudRingResult<T> = {ok: true; value: T} | {ok: false; error: RootsPointCloudRingError};
export interface RootsPointCloudRingOptions {
 /** Explicit local/test override; omission retains the source 10M capacity. */
 capacityPoints?: number;
 recentWindowPoints?: number;
 /** Owned retained array only. The caller also budgets borrowed input, GPU
  * buffers and any escaped borrowed views; this is not a process-memory cap. */
 maxBytes?: number;
}
export interface RootsPointCloudRingPlan {
 readonly capacityPoints: number;
 readonly recentWindowPoints: number;
 readonly maxBytes: number;
 readonly storageBytes: number;
}
function integer(value: unknown, name: string, positive = true): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
  throw new RootsPointCloudRingError('input', `${name} must be a ${positive ? 'positive' : 'nonnegative'} safe integer`);
 }
 return value;
}
export function rootsPointCloudRingBytes(capacityPoints: number): number {
 integer(capacityPoints, 'capacityPoints');
 const bytes = capacityPoints * ROOTS_POINT_CLOUD_STRIDE * Float32Array.BYTES_PER_ELEMENT;
 if (!Number.isSafeInteger(bytes)) throw new RootsPointCloudRingError('capacity', 'storage byte count exceeds safe integer arithmetic');
 return bytes;
}
export function prepareRootsPointCloudRing(options: unknown = {}): RootsPointCloudRingResult<RootsPointCloudRingPlan> {
 try {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new RootsPointCloudRingError('input', 'options must be an object');
  const raw = options as Record<string, unknown>;
  const own = (key: string, fallback: number) => Object.hasOwn(raw, key) && raw[key] !== undefined ? raw[key] : fallback;
  const capacityPoints = integer(own('capacityPoints', ROOTS_POINT_CLOUD_CAPACITY), 'capacityPoints');
  const recentWindowPoints = integer(own('recentWindowPoints', ROOTS_POINT_CLOUD_RECENT_WINDOW), 'recentWindowPoints');
  const maxBytes = integer(own('maxBytes', ROOTS_POINT_CLOUD_DEFAULT_BYTES), 'maxBytes');
  const storageBytes = rootsPointCloudRingBytes(capacityPoints);
  if (storageBytes > maxBytes) throw new RootsPointCloudRingError('capacity', `storage requires ${storageBytes} bytes, exceeding maxBytes ${maxBytes}`);
  return {ok: true, value: Object.freeze({capacityPoints, recentWindowPoints, maxBytes, storageBytes})};
 } catch (error) {
  if (error instanceof RootsPointCloudRingError) return {ok: false, error};
  throw error;
 }
}
export interface RootsPointCloudRange {
 readonly pointOffset: number;
 readonly pointCount: number;
 /** Read-only borrow by contract, not a copy. Do not modify or transfer its
  * buffer. All borrows expire on the next append, clear or dispose. */
 readonly values: Float32Array;
}
export interface RootsPointCloudWindow {
 readonly pointCount: number;
 readonly firstWriteOrdinal: bigint;
 readonly totalWrites: bigint;
 readonly ranges: readonly RootsPointCloudRange[];
}
export interface RootsPointCloudRingFacts {
 readonly capacityPoints: number;
 readonly recentWindowPoints: number;
 readonly retainedPointCount: number;
 readonly writeCursor: number;
 /** Exact local counter since clear, not a claim of native signed-long wrap. */
 readonly totalWrites: bigint;
 readonly allocatedBytes: number;
 readonly disposed: boolean;
}
export interface RootsPointCloudAppendOptions {
 pointOffset?: number;
 pointCount?: number;
 signal?: AbortSignal;
}

export class RootsPointCloudRing {
 readonly plan: RootsPointCloudRingPlan;
 private data?: Float32Array;
 private count = 0;
 private cursor = 0;
 private writes = 0n;
 private revision = 0n;
 private disposed = false;
 private readonly borrows = new WeakMap<RootsPointCloudWindow, bigint>();

 constructor(options: RootsPointCloudRingOptions = {}) {
  const prepared = prepareRootsPointCloudRing(options);
  if (!prepared.ok) throw prepared.error;
  this.plan = prepared.value;
 }
 private ready(): void {
  if (this.disposed) throw new RootsPointCloudRingError('state', 'ring is disposed');
  // An escaped borrower must not transfer the owned buffer. Detect that
  // violation rather than returning empty/partly written windows silently.
  if (this.data && this.data.byteLength !== this.plan.storageBytes) throw new RootsPointCloudRingError('state', 'owned buffer was detached or resized by a borrower');
 }
 get facts(): RootsPointCloudRingFacts {
  return Object.freeze({capacityPoints: this.plan.capacityPoints, recentWindowPoints: this.plan.recentWindowPoints,
   retainedPointCount: this.count, writeCursor: this.cursor, totalWrites: this.writes,
   allocatedBytes: this.data?.byteLength ?? 0, disposed: this.disposed});
 }

 /** Atomic bounded submission. Input is borrowed only for this call. Raw NaN,
  * infinity, signed zero and metric values are retained without filtering. */
 append(input: Float32Array, options: RootsPointCloudAppendOptions = {}): RootsPointCloudRingFacts {
  this.ready();
  if (!(input instanceof Float32Array) || !(input.buffer instanceof ArrayBuffer) || input.length % ROOTS_POINT_CLOUD_STRIDE !== 0) {
   throw new RootsPointCloudRingError('input', 'input must be unshared Float32Array XYZ/metric tuples');
  }
  try { new Uint8Array(input.buffer, 0, 0); }
  catch (cause) { throw new RootsPointCloudRingError('input', 'input buffer is detached', {cause}); }
  if (input.buffer === this.data?.buffer) throw new RootsPointCloudRingError('input', 'append input aliases the ring buffer; submit independent arrival data');
  const offset = integer(options.pointOffset ?? 0, 'pointOffset', false);
  const count = integer(options.pointCount ?? input.length / ROOTS_POINT_CLOUD_STRIDE - offset, 'pointCount', false);
  if (offset > input.length / ROOTS_POINT_CLOUD_STRIDE || count > input.length / ROOTS_POINT_CLOUD_STRIDE - offset) {
   throw new RootsPointCloudRingError('input', 'point range exceeds input');
  }
  if (count > ROOTS_POINT_CLOUD_APPEND_LIMIT) throw new RootsPointCloudRingError('capacity', `append exceeds ${ROOTS_POINT_CLOUD_APPEND_LIMIT} points; split the arrival batch into bounded submissions`);
  if (options.signal?.aborted) throw new DOMException('Roots point ring append cancelled', 'AbortError');
  if (count === 0) return this.facts;
  // One lazy allocation, no growth and no retained-array double peak. The
  // exact allocation was admitted by prepare before any point is consumed.
  if (!this.data) {
   try { this.data = new Float32Array(this.plan.storageBytes / Float32Array.BYTES_PER_ELEMENT); }
   catch (cause) { throw new RootsPointCloudRingError('allocation', `could not allocate ${this.plan.storageBytes} bytes`, {cause}); }
  }
  const capacity = this.plan.capacityPoints;
  const copied = Math.min(count, capacity), skipped = count - copied;
  const start = (this.cursor + skipped) % capacity;
  const first = Math.min(copied, capacity - start);
  const sourceStart = (offset + skipped) * ROOTS_POINT_CLOUD_STRIDE;
  const sourceMiddle = sourceStart + first * ROOTS_POINT_CLOUD_STRIDE;
  this.data.set(input.subarray(sourceStart, sourceMiddle), start * ROOTS_POINT_CLOUD_STRIDE);
  if (first < copied) this.data.set(input.subarray(sourceMiddle, sourceMiddle + (copied - first) * ROOTS_POINT_CLOUD_STRIDE), 0);
  this.cursor = (this.cursor + count) % capacity;
  this.count = Math.min(capacity, this.count + count);
  this.writes += BigInt(count);
  this.revision++;
  return this.facts;
 }

 private window(limit: number): RootsPointCloudWindow {
  this.ready();
  const count = Math.min(this.count, limit);
  const ranges: RootsPointCloudRange[] = [];
  if (count > 0) {
   const start = (this.cursor - count + this.plan.capacityPoints) % this.plan.capacityPoints;
   const first = Math.min(count, this.plan.capacityPoints - start);
   ranges.push(Object.freeze({pointOffset: start, pointCount: first,
    values: this.data!.subarray(start * ROOTS_POINT_CLOUD_STRIDE, (start + first) * ROOTS_POINT_CLOUD_STRIDE)}));
   if (first < count) ranges.push(Object.freeze({pointOffset: 0, pointCount: count - first,
    values: this.data!.subarray(0, (count - first) * ROOTS_POINT_CLOUD_STRIDE)}));
  }
  const result = Object.freeze({pointCount: count, firstWriteOrdinal: this.writes - BigInt(count), totalWrites: this.writes, ranges: Object.freeze(ranges)});
  this.borrows.set(result, this.revision);
  return result;
 }
 recentWindow(): RootsPointCloudWindow { return this.window(this.plan.recentWindowPoints); }
 /** All retained arrivals, oldest first. This supplies raw data for a future
  * native-shape consumer; no native-shape rendering is implemented here. */
 fullWindow(): RootsPointCloudWindow { return this.window(this.plan.capacityPoints); }
 isCurrentWindow(window: RootsPointCloudWindow): boolean {
  return !this.disposed && (!this.data || this.data.byteLength === this.plan.storageBytes) && this.borrows.get(window) === this.revision;
 }
 /** O(1); old bytes are not zero-filled, but no old point remains addressable
  * through a new window. Previously borrowed views are now invalid. */
 clear(): void {
  this.ready(); this.count = 0; this.cursor = 0; this.writes = 0n; this.revision++;
 }
 /** Idempotently releases this owner's reference. Escaped borrows still retain
  * their ArrayBuffer until their consumers release them; GC timing is unknown. */
 dispose(): void {
  if (this.disposed) return;
  this.data = undefined; this.count = 0; this.cursor = 0; this.writes = 0n; this.revision++; this.disposed = true;
 }
}
