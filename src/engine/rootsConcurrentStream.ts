import type {RootsProgress} from '../types';
import {GenerationCleanupState} from './generationCleanup';
import {RootsComputationPool,type RootsComputationWorkerFactory} from './rootsComputationPool';
import {RootsComputationError,type RootsComputationLimits} from './rootsComputation';
import {RootsPendingQueue,prepareRootsPendingPlan,type RootsPendingHooks,type RootsPendingSlice} from './rootsPending';
import type {RootsPendingConfiguration} from './rootsPresentationConfig';
import {createRootsNativeProgress} from './rootsNativePointReader';
const check=(hooks:RootsPendingHooks)=>{if(hooks.isCancelled?.())throw new DOMException('Roots stream cancelled','AbortError');};
const counters=['attemptedSamples','acceptedPolynomials','filteredSamples','invalidSamples','nonconvergentSamples','rootPoints','solverIterations','solverWork'] as const;
/** A live source stream between independently running producers and one frame
 * consumer. It owns all transferred pending buffers and the producer lifetime;
 * camera/gradient clocks, GPU resources and recording decisions remain outside.
 * Saved ordinal replay uses its separate existing owner and is not upgraded. */
export class RootsConcurrentStream {
 private readonly pool:RootsComputationPool;private readonly pending:RootsPendingQueue;
 private readonly producerReservation:number;private readonly sampleCount:number;
 private delivered=new Map<number,RootsProgress>();private invalidByWorker=new Map<number,number>();
 private mode?:'density'|'point-cloud';
 private cleanup=new GenerationCleanupState();private disposed=false;private failed=false;private closing=false;
 constructor(configuration:unknown,metric:unknown,pending:Pick<RootsPendingConfiguration,'maxSplatPointsPerFrame'|'referenceHeapBytes'>,limits:RootsComputationLimits,factory?:RootsComputationWorkerFactory){
  this.pool=new RootsComputationPool(configuration,metric,limits,factory);
  const source=this.pool.describe();this.producerReservation=source.reservedBytes;this.sampleCount=source.sampleCount;
  try{
   const remaining=limits.maximumBytes-source.reservedBytes;
   if(remaining<RootsPendingQueue.minimumBytes)throw new RootsComputationError('capacity','No admitted space remains for pending display points');
   this.pending=new RootsPendingQueue(prepareRootsPendingPlan({...source,...pending}),{storage:'points',ingestion:'batches',maximumBytes:remaining});
  }catch(error){this.pool.dispose();throw error;}
 }
 private ready(){if(this.disposed||this.failed||this.closing)throw new RootsComputationError('protocol','Concurrent stream is not usable');}
 private operation<T>(run:()=>T):T {
  this.ready();try{return run();}catch(error){this.failed=true;this.cleanup.reset(()=>this.release(),[error]);throw error;}
 }
 private release(){this.pool.dispose();this.pending.dispose();this.delivered.clear();this.invalidByWorker.clear();this.disposed=true;}
 start(){this.operation(()=>this.pool.start());}
 private prepareConsumption(mode:'density'|'point-cloud'){
  this.pool.assertHealthy();
  if(this.pool.snapshot().state==='idle')throw new RootsComputationError('protocol','Start the producer before consuming');
  if(mode!=='density'&&mode!=='point-cloud'||this.mode!==undefined&&this.mode!==mode)throw new RootsComputationError('protocol','A display mode change requires a new concurrent stream');
  this.mode=mode;
 }

 /** No math executes on this consumer. Each arrival keeps its original batch
  * and terminal order; a full pending backlog stops taking producer credits. */
 drain(mode:'density'|'point-cloud',consumer?: (slice:RootsPendingSlice)=>void,hooks:RootsPendingHooks={}){
  check(hooks);return this.operation(()=>{
   this.prepareConsumption(mode);
   let batches=0,points=0,terminals=0;
   while(true){
    const result=this.pending.drain(mode,consumer,hooks);batches+=result.batches;points+=result.points;terminals+=result.terminals;
    if(!this.pending.canAcceptBatch(mode))break;
    const batch=this.pool.take();if(!batch)break;
    this.pending.acceptBatch(batch.workerIndex,batch.points,batch.terminal,mode,hooks);
    this.delivered.set(batch.workerIndex,batch.progress);this.invalidByWorker.set(batch.workerIndex,batch.invalidRoots);
   }
   return{batches,points,terminals};
  });
 }
 consumeDensity(consumer:(slices:Iterable<RootsPendingSlice>)=>void,hooks:RootsPendingHooks={}){
  check(hooks);return this.operation(()=>{this.prepareConsumption('density');return this.pending.consumeDensity(consumer,hooks);});
 }
 get progress():RootsProgress {
  const state=createRootsNativeProgress(this.sampleCount);
  for(const progress of this.delivered.values())for(const key of counters){const value=state[key]+progress[key];if(!Number.isSafeInteger(value))throw new RootsComputationError('capacity','Delivered progress exceeds exact representation');state[key]=value;}
  state.complete=this.pool.snapshot().computationComplete;return state;
 }
 get facts(){
  const pool=this.pool.snapshot(),pending=this.pending.snapshot();
  return Object.freeze({policy:'roots-worker-arrival-v1' as const,pool,pending,invalidRoots:[...this.invalidByWorker.values()].reduce((n,v)=>n+v,0),
   reservedBytes:this.disposed?0:this.producerReservation+pending.retainedBytes,disposed:this.disposed,failed:this.failed,
   // The caller must still successfully commit the display for this update.
   canFinishAfterDisplay:!this.failed&&!this.disposed&&!this.closing&&pool.computationComplete&&pending.finishedWorkers===pending.workerCount&&pending.queuedBatches===0&&pending.pendingPoints===0});
 }
 dispose(){if(this.disposed)return;this.closing=true;this.cleanup.reset(()=>this.release());}
}
