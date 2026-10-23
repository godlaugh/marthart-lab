import type {RootsMathConfiguration,RootsProgress} from '../types';
import type {RootsMetricKind} from './rootsDensityColor';
import {parseRootsMath} from './rootsMathConfig';
import {prepareRootsNativeMathJob,type RootsMathJob} from './rootsMathJob';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {prepareRootsWorkerPartitions,type RootsWorkerPartitionPlan} from './rootsSourceRandom';
import {RootsNativePointReader,createRootsNativeProgress} from './rootsNativePointReader';
import {RootsPendingQueue,prepareRootsPendingPlan} from './rootsPending';
import {RootsNativeError,type RootsNativeWorkHooks} from './rootsNativeExpression';

export class RootsComputationError extends Error {
 constructor(readonly kind:'input'|'capacity'|'protocol'|'worker',message:string,options?:ErrorOptions){super(message,options);this.name='RootsComputationError';}
}
export interface RootsComputationLimits {readonly maximumWorkers:number;readonly maximumBytes:number;}
export interface RootsComputationPlan {
 readonly configuration:RootsMathConfiguration;readonly metric:RootsMetricKind;
 readonly partitions:RootsWorkerPartitionPlan;readonly queueCapacity:number;
 readonly maxPointsPerSample:number;readonly maximumBatchPoints:number;readonly producerBytes:number;readonly reservedBytes:number;
}
const preparedPlans=new WeakSet<RootsComputationPlan>();
function freezeOwned<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))freezeOwned(child);Object.freeze(value);}return value;}
const positive=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
export function prepareRootsComputationPlan(raw:unknown,metric:unknown,limits:RootsComputationLimits):
 {ok:true;value:RootsComputationPlan}|{ok:false;error:RootsComputationError} {
 let math:RootsMathJob|undefined;
 try{
  if(!limits||!positive(limits.maximumWorkers)||!positive(limits.maximumBytes))throw new RootsComputationError('input','Explicit worker and representation budgets are required');
  if(metric!=='radius'&&metric!=='t2_real'&&metric!=='t2_imag')throw new RootsComputationError('input','Unknown Roots metric');
  const configuration=parseRootsMath(raw);
  if(configuration.model!=='mathart-1.7.8-v1')throw new RootsComputationError('input','Concurrent producer requires source mathematics');
  const seed=parseRootsSignedLongText(configuration.sampling.seed);if(!seed.ok)throw new RootsComputationError('input','Invalid source signed-long seed');
  const p=prepareRootsWorkerPartitions(configuration.sampling.sampleCount,configuration.sampling.workerCount,seed.value);
  if(!p.ok)throw new RootsComputationError('input',p.error.reason);
  const partitions=p.value,w=partitions.workerCount;
  if(w>limits.maximumWorkers)throw new RootsComputationError('capacity',`Requested ${w} workers exceeds caller budget ${limits.maximumWorkers}`);
  math=prepareRootsNativeMathJob(configuration);
  const maximumBatchPoints=math.maxRootCount===0?0:configuration.sampling.batchSize-1+math.maxRootCount;
  if(!Number.isSafeInteger(maximumBatchPoints)||maximumBatchPoints>2147483647)throw new RootsComputationError('capacity','Whole-sample batch exceeds signed-int point representation');
  // Conservative owned-representation reservation: math workspace, reader,
  // builder growth plus batch/output overlap, config clones, queue metadata.
  // JS runtime/Worker VM and allocator overhead are not measured heap usage.
  const configBytes=JSON.stringify(configuration).length*2,producerBytes=math.workspaceCapacityBytes+math.maxRootCount*16+Math.max(16,maximumBatchPoints)*16*5+configBytes*2+4096;
  const queueCapacity=w*2,reservedBytes=w*(producerBytes+1024)+(queueCapacity+w)*maximumBatchPoints*16+configBytes;
  if(!Number.isSafeInteger(reservedBytes)||reservedBytes>limits.maximumBytes)throw new RootsComputationError('capacity',`Roots producer representations require ${reservedBytes} bytes, caller budget ${limits.maximumBytes}`);
  const value=Object.freeze({configuration:freezeOwned(configuration),metric,partitions,queueCapacity,maxPointsPerSample:math.maxRootCount,maximumBatchPoints,producerBytes,reservedBytes});preparedPlans.add(value);return{ok:true,value};
 }catch(error){return{ok:false,error:error instanceof RootsComputationError?error:new RootsComputationError(error instanceof RootsNativeError&&error.kind==='capacity'?'capacity':'input',error instanceof Error?error.message:String(error),{cause:error})};}
 finally{math?.dispose();}
}
export interface RootsComputedBatch {
 readonly workerIndex:number;readonly sequence:number;readonly points:Float32Array;readonly terminal:boolean;
 /** Producer counters; terminal/queue/drawing completion are separate facts. */
 readonly progress:RootsProgress;readonly invalidRoots:number;
}
/** One independent partition. step() does bounded sample work; the transport
 * owns yielding and backpressure. Batching stays in RootsPendingQueue. */
export class RootsComputationProducer {
 private readonly math:RootsMathJob;private readonly reader:RootsNativePointReader;private readonly queue:RootsPendingQueue;
 private readonly state:RootsProgress;private sequence=0;private invalidRoots=0;private done=false;private disposed=false;
 constructor(private readonly plan:RootsComputationPlan,private readonly workerIndex:number){
  if(!preparedPlans.has(plan))throw new RootsComputationError('input','Producer requires its owning prepared plan');
  const partition=plan.partitions.partition(workerIndex);this.math=prepareRootsNativeMathJob(plan.configuration);
  this.state=createRootsNativeProgress(partition.count);
  let reader:RootsNativePointReader|undefined;
  const admit=(bytes:number)=>{if(bytes+this.math.workspaceCapacityBytes+(reader?.retainedBytes??0)>plan.producerBytes)throw new RootsComputationError('capacity','Producer exceeded its reserved representation budget');};
  try{
   this.reader=reader=new RootsNativePointReader(this.math,this.state,'points',admit,partition.start);
   this.queue=new RootsPendingQueue(prepareRootsPendingPlan({batchSize:plan.configuration.sampling.batchSize,workerCount:plan.partitions.workerCount,maxPointsPerSample:this.math.maxRootCount,maxSplatPointsPerFrame:1,referenceHeapBytes:0}),{storage:'points',maximumBytes:plan.producerBytes,onBytes:admit});
  }catch(error){reader?.dispose();this.math.dispose();throw error;}
 }
 step(maximumSamples:number,hooks:RootsNativeWorkHooks={}):{kind:'yield'}|{kind:'batch';batch:RootsComputedBatch}{
  if(this.disposed||this.done)throw new RootsComputationError('protocol','Producer is no longer readable');
  if(!positive(maximumSamples))throw new RootsComputationError('input','Sample slice must be a positive integer');
  let samples=0;
  while(this.queue.snapshot().queuedBatches===0&&this.state.attemptedSamples<this.state.totalSamples&&samples++<maximumSamples){
   const sample=this.reader.read(0,this.plan.metric,hooks);this.invalidRoots+=sample.invalidRoots;
   this.queue.appendSample(this.workerIndex,sample.points!,{...hooks,filtered:sample.filtered});
   if(this.state.attemptedSamples===this.state.totalSamples)this.queue.finishWorker(this.workerIndex,hooks);
  }
  const facts=this.queue.snapshot();if(!facts.queuedBatches)return{kind:'yield'};
  const bytes=facts.queuedPoints*16;
  if(bytes+facts.retainedBytes+this.reader.retainedBytes+this.math.workspaceCapacityBytes>this.plan.producerBytes)throw new RootsComputationError('capacity','Producer output exceeds admitted overlap');
  const points=new Float32Array(facts.queuedPoints*4);let offset=0;
  const result=this.queue.drain('point-cloud',slice=>{points.set(slice.points!,offset);offset+=slice.pointCount*4;},hooks);
  this.done=result.terminals===1;
  const batch:RootsComputedBatch={workerIndex:this.workerIndex,sequence:this.sequence++,points,terminal:this.done,progress:{...this.state},invalidRoots:this.invalidRoots};
  if(this.done)this.dispose();return{kind:'batch',batch};
 }
 dispose(){if(this.disposed)return;this.queue.dispose();this.reader.dispose();this.math.dispose();this.disposed=true;}
}
