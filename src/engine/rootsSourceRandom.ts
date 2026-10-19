import {isJavaSourceLong} from './javaSourceRandom';
export const ROOTS_WORKER_SEED_INCREMENT = -7046029254386353131n;
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
 if (!isJavaSourceLong(seed)) return { ok: false, error: { kind: 'input', field: 'seed', reason: 'Expected exact signed Java long.' } };
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
