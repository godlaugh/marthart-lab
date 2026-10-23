import type {RootsProgress} from '../types';
import {GenerationCleanupState} from './generationCleanup';
import {prepareRootsComputationPlan,RootsComputationError,type RootsComputationLimits,type RootsComputationPlan,type RootsComputedBatch} from './rootsComputation';

export interface RootsComputationWorkerPort {
 onmessage:((event:MessageEvent<unknown>)=>void)|null;
 onerror:((event:ErrorEvent)=>void)|null;
 onmessageerror:((event:MessageEvent<unknown>)=>void)|null;
 postMessage(value:unknown):void;terminate():void;
}
export type RootsComputationWorkerFactory=()=>RootsComputationWorkerPort;
const makeWorker:RootsComputationWorkerFactory=()=>new Worker(new URL('./rootsComputation.worker.ts',import.meta.url),{type:'module'});
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const natural=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const counters=['totalSamples','attemptedSamples','acceptedPolynomials','filteredSamples','invalidSamples','nonconvergentSamples','rootPoints','solverIterations','solverWork'] as const;
interface Peer {port:RootsComputationWorkerPort;sequence:number;pending:boolean;terminal:boolean;progress?:RootsProgress;invalidRoots:number;}
/** Owns producer lifetimes and the source-sized incoming FIFO. A returned batch
 * transfers buffer ownership to the frame consumer; taking a terminal is not
 * evidence that its point buffer has been drawn. No display clock lives here. */
export class RootsComputationPool {
 private readonly plan:RootsComputationPlan;private readonly limits:RootsComputationLimits;
 private peers=new Map<number,Peer>();private queue:RootsComputedBatch[]=[];private waiting:RootsComputedBatch[]=[];
 private cleanup=new GenerationCleanupState();private state:'idle'|'running'|'complete'|'failed'|'disposed'='idle';
 private failure?:Error;private consumed=new Map<number,RootsProgress>();private terminals=0;private offers=0;private taken=0;
 constructor(configuration:unknown,metric:unknown,limits:RootsComputationLimits,private readonly factory:RootsComputationWorkerFactory=makeWorker){
  const result=prepareRootsComputationPlan(configuration,metric,limits);if(!result.ok)throw result.error;this.plan=result.value;this.limits={...limits};
 }
 start(){
  this.cleanup.prepare();if(this.state!=='idle')throw new RootsComputationError('protocol','Pool can start only once');this.state='running';
  try{for(let index=0;index<this.plan.partitions.workerCount;index++){
   const port=this.factory(),peer:Peer={port,sequence:0,pending:false,terminal:false,invalidRoots:0};this.peers.set(index,peer);
   port.onmessage=event=>{if(this.state!=='running')return;try{this.receive(index,event.data);}catch(error){this.fail(error);}};
   port.onerror=event=>this.fail(new RootsComputationError('worker',event.message||'Roots worker failed'));
   port.onmessageerror=()=>this.fail(new RootsComputationError('protocol','Unable to deserialize Roots worker output'));
   port.postMessage({kind:'start',workerIndex:index,configuration:this.plan.configuration,metric:this.plan.metric,limits:this.limits});
  }}catch(error){this.fail(error);this.assertHealthy();}
 }
 private fail(error:unknown){
  if(this.state==='disposed'||this.state==='complete'||this.state==='failed')return;
  this.state='failed';this.failure=error instanceof Error?error:new RootsComputationError('worker',String(error));
  try{this.stopPorts();}catch(cleanup){this.failure=cleanup instanceof Error?cleanup:new Error(String(cleanup));}
 }
 private stopPorts(){this.cleanup.reset(()=>{
  const errors:unknown[]=[];
  for(const [index,peer] of this.peers){try{peer.port.terminate();this.peers.delete(index);}catch(error){errors.push(error);}}
  if(errors.length)throw new AggregateError(errors,'Roots worker termination failed');
 },this.failure?[this.failure]:[]);}
 private assertHealthy(){if(this.failure)throw this.failure;if(this.state==='disposed')throw new RootsComputationError('protocol','Pool disposed');}
 private decode(index:number,raw:unknown):RootsComputedBatch {
  const peer=this.peers.get(index)!;
  if(!object(raw))throw new RootsComputationError('protocol','Invalid worker response');
  if(raw.kind==='failure'){
   const e=raw.error;if(!object(e)||typeof e.message!=='string'||!['input','capacity','protocol','worker'].includes(String(e.kind)))throw new RootsComputationError('protocol','Invalid worker failure');
   throw new RootsComputationError(e.kind as RootsComputationError['kind'],e.message);
  }
  const b=raw.batch;
  if(raw.kind!=='batch'||!object(b)||b.workerIndex!==index||b.sequence!==peer.sequence||peer.pending||peer.terminal||typeof b.terminal!=='boolean')throw new RootsComputationError('protocol','Unexpected worker batch identity');
  const points=b.points;
  if(!(points instanceof Float32Array)||points.byteOffset!==0||points.byteLength!==points.buffer.byteLength||!(points.buffer instanceof ArrayBuffer)||points.length%4!==0||points.length/4>this.plan.maximumBatchPoints)throw new RootsComputationError('protocol','Invalid owned point buffer');
  const p=b.progress;
  if(!object(p)||!counters.every(k=>natural(p[k]))||p.maxResidual!==null||p.complete!==false||!natural(b.invalidRoots))throw new RootsComputationError('protocol','Invalid producer progress');
  const progress=Object.fromEntries(counters.map(k=>[k,p[k]])) as unknown as RootsProgress;progress.maxResidual=null;progress.complete=false;Object.freeze(progress);
  const count=this.plan.partitions.partition(index).count,previous=peer.progress;
  if(progress.totalSamples!==count||progress.attemptedSamples<= (previous?.attemptedSamples??0)||progress.attemptedSamples>count||b.terminal!==(progress.attemptedSamples===count)
   ||progress.acceptedPolynomials+progress.filteredSamples+progress.invalidSamples!==progress.attemptedSamples
   ||progress.nonconvergentSamples>progress.acceptedPolynomials||progress.rootPoints!==(previous?.rootPoints??0)+points.length/4
   ||b.invalidRoots<peer.invalidRoots||counters.some(k=>previous&&progress[k]<previous[k])
   ||!b.terminal&&points.length/4<this.plan.configuration.sampling.batchSize)throw new RootsComputationError('protocol','Inconsistent producer progress');
  return Object.freeze({workerIndex:index,sequence:peer.sequence,points,terminal:b.terminal,progress,invalidRoots:b.invalidRoots});
 }
 private admit(batch:RootsComputedBatch){
  this.queue.push(batch);const peer=this.peers.get(batch.workerIndex)!;peer.pending=false;
  if(!batch.terminal)peer.port.postMessage({kind:'credit',sequence:peer.sequence});
 }
 private receive(index:number,raw:unknown){
  const batch=this.decode(index,raw),peer=this.peers.get(index)!;
  peer.sequence++;peer.pending=true;peer.terminal=batch.terminal;peer.progress=batch.progress;peer.invalidRoots=batch.invalidRoots;this.offers++;
  if(this.queue.length<this.plan.queueCapacity)this.admit(batch);else this.waiting.push(batch);
 }
 take():RootsComputedBatch|undefined {
  this.assertHealthy();if(this.state==='idle')throw new RootsComputationError('protocol','Pool not started');
  const batch=this.queue.shift();if(!batch)return;
  this.taken++;this.consumed.set(batch.workerIndex,batch.progress);if(batch.terminal)this.terminals++;
  try{if(this.waiting.length)this.admit(this.waiting.shift()!);}catch(error){this.fail(error);this.assertHealthy();}
  if(this.terminals===this.plan.partitions.workerCount){this.state='complete';try{this.stopPorts();}catch(error){this.failure=error as Error;throw error;}}
  return batch;
 }
 snapshot(){
  const producerSamples=[...this.peers.values()].reduce((n,p)=>n+(p.progress?.attemptedSamples??0),0);
  const consumedSamples=[...this.consumed.values()].reduce((n,p)=>n+p.attemptedSamples,0);
  return Object.freeze({state:this.state,workerCount:this.plan.partitions.workerCount,queueCapacity:this.plan.queueCapacity,queuedBatches:this.queue.length,waitingBatches:this.waiting.length,
   producerSamplesObserved:this.state==='complete'?consumedSamples:producerSamples,consumedSamples,consumedTerminals:this.terminals,offers:this.offers,taken:this.taken,
   retainedPointBytes:[...this.queue,...this.waiting].reduce((n,b)=>n+b.points.byteLength,0),reservedBytes:this.plan.reservedBytes,ownedWorkers:this.peers.size,
   computationComplete:this.state==='complete',drawingComplete:null});
 }
 dispose(){
  if(this.state==='disposed')return;this.state='disposed';
  try{this.stopPorts();}catch(error){this.state='failed';this.failure=error as Error;throw error;}
  this.queue=[];this.waiting=[];this.consumed.clear();
 }
}
