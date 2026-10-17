import type {RootsProgress} from '../types';
import type {RootsMathJob} from './rootsMathJob';
import type {RootsPendingConfiguration} from './rootsPresentationConfig';
import type {RootsMetricKind} from './rootsDensityColor';
import type {RootsNativeWorkHooks} from './rootsNativeExpression';
import type {rootsSchedule} from '../scenes/rootsDensity';
import {RootsNativePointReader} from './rootsNativePointReader';
import {prepareRootsWorkerPartitions,type RootsWorkerPartitionPlan} from './rootsSourceRandom';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {RootsPendingQueue,prepareRootsPendingPlan,type RootsPendingOptions,type RootsPendingSlice,type RootsPendingSnapshot} from './rootsPending';
import {RootsGpuError,rootsGpuCancel} from './rootsGpuFailure';

export interface RootsPendingStreamFacts extends RootsPendingSnapshot {
 readonly policy:'roots-pending-ordinal-v1';readonly arrivalPolicy:'once-before-frame-drains';
 readonly scheduledSamples:number;readonly attemptedSamples:number;readonly invalidRoots:number;
 readonly producerWorker:number;readonly pumpCalls:number;readonly drainCalls:number;readonly splatCalls:number;
 readonly maximumPendingPoints:number;readonly maxSplatPointsPerFrame:number;
 readonly referenceHeapBytes:string;readonly nativeHeapObserved:false;
}
/** Shared real/count-only producer schedule. A logical worker publishes complete
 * samples/batches in global-ordinal order. Full queue stops its producer until
 * the next frame entry; drains never execute more math. This explicit local
 * schedule does not claim the original concurrently timed worker puts. */
export class RootsPendingStream {
 private readonly partitions:RootsWorkerPartitionPlan;
 private readonly reader:RootsNativePointReader;
 private readonly queue:RootsPendingQueue;
 private worker=0;private scheduledSamples=0;private rawInvalid=0;
 private pumpCalls=0;private drainCalls=0;private splatCalls=0;private disposed=false;
 constructor(math:RootsMathJob,private readonly state:RootsProgress,private readonly schedule:ReturnType<typeof rootsSchedule>,configuration:RootsPendingConfiguration,options:RootsPendingOptions){
  const ensemble=math.ensemble;
  if(!ensemble)throw new RootsGpuError('待绘制队列需要源样本分区','input');
  const seed=parseRootsSignedLongText(ensemble.seed);if(!seed.ok)throw seed.error;
  const partitions=prepareRootsWorkerPartitions(ensemble.sampleCount,ensemble.configuredWorkers,seed.value);if(!partitions.ok)throw new RootsGpuError(partitions.error.reason,'input');
  this.partitions=partitions.value;
  const plan=prepareRootsPendingPlan({batchSize:ensemble.batchSize,workerCount:this.partitions.workerCount,maxPointsPerSample:math.maxRootCount,...configuration});
  this.reader=new RootsNativePointReader(math,state,options.storage,options.onBytes);
  try{this.queue=new RootsPendingQueue(plan,{...options,onBytes:bytes=>options.onBytes?.(bytes+this.reader.retainedBytes)});}
  catch(error){this.reader.dispose();throw error;}
 }
 get retainedBytes(){return this.queue.snapshot().retainedBytes+this.reader.retainedBytes;}
 get invalidRoots(){return this.rawInvalid;}
 get facts():RootsPendingStreamFacts {
  const q=this.queue.snapshot(),plan=this.queue.plan;
  return{...q,retainedBytes:q.retainedBytes+this.reader.retainedBytes,peakBytes:q.peakBytes+this.reader.retainedBytes,
   policy:'roots-pending-ordinal-v1',arrivalPolicy:'once-before-frame-drains',scheduledSamples:this.scheduledSamples,attemptedSamples:this.state.attemptedSamples,invalidRoots:this.rawInvalid,producerWorker:this.worker,
   pumpCalls:this.pumpCalls,drainCalls:this.drainCalls,splatCalls:this.splatCalls,maximumPendingPoints:plan.maximumPendingPoints,maxSplatPointsPerFrame:plan.maxSplatPointsPerFrame,referenceHeapBytes:plan.referenceHeapBytes,nativeHeapObserved:false};
 }
 pump(target:number,metric:RootsMetricKind,hooks:RootsNativeWorkHooks&{poll?:()=>void}={}){
  if(this.disposed)throw new RootsGpuError('待绘制点流已释放','input');
  if(!Number.isSafeInteger(target)||target<this.state.attemptedSamples||target>this.state.totalSamples)throw new RootsGpuError('待绘制点流的调度样本范围无效','input');
  this.scheduledSamples=target;this.pumpCalls++;
  while(this.worker<this.partitions.workerCount){
   rootsGpuCancel(hooks.isCancelled);hooks.poll?.();
   const worker=this.queue.workerState(this.worker);
   if(worker.finishRequested){
    if(this.queue.publishWorker(this.worker,hooks).blocked)break;
    this.worker++;continue;
   }
   if(worker.blocked&&this.queue.publishWorker(this.worker,hooks).blocked)break;
   if(this.state.attemptedSamples>=target)break;
   const partition=this.partitions.partition(this.worker),ordinal=this.state.attemptedSamples;
   if(ordinal<partition.start||ordinal>=partition.start+partition.count)throw new RootsGpuError('待绘制生产者与共享样本分区不一致','input');
   const sample=this.reader.read(this.schedule.start+Math.floor(ordinal/this.schedule.perFrame)/this.schedule.fps,metric,hooks);this.rawInvalid+=sample.invalidRoots;
   let blocked=this.queue.appendSample(this.worker,sample.points??sample.pointCount,{...hooks,filtered:sample.filtered}).blocked;
   if(this.state.attemptedSamples===partition.start+partition.count){
    blocked=this.queue.finishWorker(this.worker,hooks).blocked;
    if(!blocked)this.worker++;
   }
   if(blocked)break;
  }
 }
 drain(mode:'density'|'point-cloud',consumer?:(slice:RootsPendingSlice)=>void,hooks:RootsNativeWorkHooks={}){
  const result=this.queue.drain(mode,consumer,hooks);this.drainCalls++;return result;
 }
 consumeDensity<T>(consumer?:(slices:Iterable<RootsPendingSlice>)=>T,hooks:RootsNativeWorkHooks={}){
  const result=this.queue.consumeDensity(consumer,hooks);this.splatCalls++;return result;
 }
 dispose(){this.queue.dispose();this.reader.dispose();this.disposed=true;}
}
