import {describe,expect,it} from 'vitest';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {prepareRootsComputationPlan,RootsComputationProducer} from '../src/engine/rootsComputation';
import {RootsConcurrentStream} from '../src/engine/rootsConcurrentStream';
import type {RootsComputationWorkerPort} from '../src/engine/rootsComputationPool';
import {prepareRootsPendingPlan,RootsPendingQueue} from '../src/engine/rootsPending';
const limits={maximumWorkers:4,maximumBytes:1024*1024},pending={maxSplatPointsPerFrame:7,referenceHeapBytes:0};
function configuration(){const c=createRootsNativeMath(1);c.polynomial={variable:'x',coefficients:[{exponent:'10',expression:'1'},{exponent:'0',expression:'-1'}]};c.parameters=[];c.sampling={sampleCount:14,batchSize:64,workerCount:1,seed:'0',filter:''};return c;}
class Port implements RootsComputationWorkerPort {
 onmessage:RootsComputationWorkerPort['onmessage']=null;onerror:RootsComputationWorkerPort['onerror']=null;onmessageerror:RootsComputationWorkerPort['onmessageerror']=null;terminated=0;failTerminate=false;
 postMessage(){}terminate(){this.terminated++;if(this.failTerminate)throw Error('terminate failed');}emit(batch:unknown){this.onmessage?.({data:{kind:'batch',batch}} as MessageEvent<unknown>);}
}
function setup(samples=14){
 const c=configuration();c.sampling.sampleCount=samples;const port=new Port(),stream=new RootsConcurrentStream(c,'radius',pending,limits,()=>port),p=prepareRootsComputationPlan(c,'radius',limits);if(!p.ok)throw p.error;
 const producer=new RootsComputationProducer(p.value,0);stream.start();while(true){const b=producer.step(128);if(b.kind!=='batch')throw Error('expected full batch');port.emit(b.batch);if(b.batch.terminal)break;}producer.dispose();return{stream,port};
}
describe('concurrent producer to owned frame backlog',()=>{
 it('keeps a terminal behind a capacity-crossing batch, then waits for the last displayed point',()=>{
  const {stream}=setup();try{
   expect(stream.drain('density')).toEqual({batches:2,points:140,terminals:0});
   expect(stream.progress).toMatchObject({attemptedSamples:14,rootPoints:140,complete:true});
   expect(stream.facts).toMatchObject({canFinishAfterDisplay:false,pool:{computationComplete:true},pending:{pendingPoints:140,queuedBatches:1,finishedWorkers:0}});
   let consumed=0;const draw=(slices:Iterable<{pointCount:number}>)=>{for(const s of slices)consumed+=s.pointCount;};
   expect(stream.consumeDensity(draw)).toEqual({budget:56,consumedPoints:56});
   expect(stream.drain('density')).toEqual({batches:0,points:0,terminals:1});
   expect(stream.facts).toMatchObject({canFinishAfterDisplay:false,pending:{pendingPoints:84,finishedWorkers:1}});
   for(let i=0;i<20&&!stream.facts.canFinishAfterDisplay;i++)stream.consumeDensity(draw);
   expect(consumed).toBe(140);expect(stream.facts.canFinishAfterDisplay).toBe(true);
  }finally{stream.dispose();}
 });
 it('drains cloud batches in order without applying density throttling',()=>{
  const {stream}=setup();let points=0;try{
   const result=stream.drain('point-cloud',s=>{expect(s.points!.length).toBe(s.pointCount*4);points+=s.pointCount;});
   expect(result).toEqual({batches:2,points:140,terminals:1});expect(points).toBe(140);expect(stream.facts.canFinishAfterDisplay).toBe(true);
  }finally{stream.dispose();}
 });
 it('preserves a pre-cancelled stream and stops its producer after a partial display failure',()=>{
  const {stream,port}=setup();try{
   expect(()=>stream.drain('density',undefined,{isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));expect(stream.facts.disposed).toBe(false);expect(stream.facts.pool.taken).toBe(0);
   stream.drain('density');expect(()=>stream.consumeDensity(slices=>{for(const _ of slices)throw Error('GPU failed');})).toThrow('GPU failed');
   expect(stream.facts).toMatchObject({failed:true,disposed:true,canFinishAfterDisplay:false,reservedBytes:0});expect(port.terminated).toBe(1);
  }finally{stream.dispose();}
 });
 it('surfaces a failed producer immediately even while density backlog blocks further arrivals',()=>{
  const {stream,port}=setup(21);try{
   stream.drain('density');expect(stream.facts.pending.pendingPoints).toBe(140);
   port.onerror?.({message:'producer crashed'} as ErrorEvent);let drew=false;
   expect(()=>stream.consumeDensity(()=>{drew=true;})).toThrow('producer crashed');expect(drew).toBe(false);expect(stream.facts.disposed).toBe(true);
  }finally{stream.dispose();}
 });
 it('rejects changing consumption mode with retained density points',()=>{
  const {stream}=setup();try{stream.drain('density');expect(()=>stream.drain('point-cloud',()=>{})).toThrow(/new concurrent stream/);expect(stream.facts).toMatchObject({failed:true,disposed:true});}finally{stream.dispose();}
 });
 it('retains pending buffers after termination failure and releases them on owned cleanup retry',()=>{
  const {stream,port}=setup(21);stream.drain('density');port.failTerminate=true;
  let error:unknown;try{stream.dispose();}catch(e){error=e;}
  expect(error).toBeInstanceOf(GenerationCleanupError);expect(stream.facts.pending.pendingPoints).toBe(140);expect(stream.facts.pool.ownedWorkers).toBe(1);
  expect(()=>stream.drain('density')).toThrow(/not usable/);
  port.failTerminate=false;(error as GenerationCleanupError).retryCleanup();expect(stream.facts).toMatchObject({disposed:true,reservedBytes:0,pending:{retainedBytes:0},pool:{ownedWorkers:0}});stream.dispose();
 });
 it('cancels all producers and releases arrived buffers when cloud consumption throws',()=>{
  const {stream,port}=setup();expect(()=>stream.drain('point-cloud',()=>{throw Error('ring failed');})).toThrow('ring failed');expect(stream.facts.disposed).toBe(true);expect(port.terminated).toBe(1);
 });
});
describe('batch ingestion retains the existing queue owner and budgets',()=>{
 const plan=prepareRootsPendingPlan({batchSize:64,workerCount:1,maxPointsPerSample:10,...pending});
 const points=(n=70)=>new Float32Array(n*4);
 it('takes exclusive whole-buffer ownership without copying or rebatching',()=>{
  const q=new RootsPendingQueue(plan,{storage:'points',ingestion:'batches'}),p=points();try{
   q.acceptBatch(0,p,true,'density');q.drain('density');let seen:unknown;
   q.consumeDensity(slices=>{for(const s of slices)seen=s.points!.buffer;});expect(seen).toBe(p.buffer);
   expect(()=>q.acceptBatch(0,points(),true,'density')).toThrow(/terminated/);
   expect(()=>q.appendSample(0,points(1))).toThrow(/completed batches/);expect(()=>q.finishWorker(0)).toThrow(/terminal belongs/);
  }finally{q.dispose();}
 });
 it('rejects malformed buffers and batches before changing ownership',()=>{
  const q=new RootsPendingQueue(plan,{storage:'points',ingestion:'batches'});try{
   for(const p of [points(74),new Float32Array(new ArrayBuffer(1124),4),new Float32Array(3)])expect(()=>q.acceptBatch(0,p,false,'density')).toThrow();
   const p=points();structuredClone(p,{transfer:[p.buffer]});expect(()=>q.acceptBatch(0,p,true,'density')).toThrow(/detached/);
   expect(q.snapshot()).toMatchObject({producedPoints:0,queuedBatches:0,builders:0});
  }finally{q.dispose();}
 });
 it('admits the entire arrived representation before mutation',()=>{
  const q=new RootsPendingQueue(plan,{storage:'points',ingestion:'batches',maximumBytes:300}),p=points();
  try{expect(()=>q.acceptBatch(0,p,true,'density')).toThrow(expect.objectContaining({kind:'capacity'}));expect(p.length).toBe(280);expect(q.snapshot()).toMatchObject({retainedBytes:256,producedPoints:0,queuedBatches:0});}finally{q.dispose();}
 });
});
