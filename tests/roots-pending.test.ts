import {describe,it,expect} from 'vitest';
import {prepareRootsPendingPlan,rootsPendingSplatBudget,RootsPendingQueue,RootsPendingError,type RootsPendingSlice} from '../src/engine/rootsPending';
const plan=(changes:Partial<Parameters<typeof prepareRootsPendingPlan>[0]>={})=>prepareRootsPendingPlan({batchSize:4,workerCount:1,maxPointsPerSample:8,maxSplatPointsPerFrame:1,referenceHeapBytes:0,...changes});
const points=(values:number[])=>Float32Array.from(values.flatMap(x=>[x,-x,x/2,.5]));
const take=(q:RootsPendingQueue)=>{const values:number[]=[];const result=q.consumeDensity(slices=>{for(const s of slices)if(s.points)for(let i=0;i<s.points.length;i+=4)values.push(s.points[i]);});return{...result,values};};
const reason=(run:()=>unknown,kind:RootsPendingError['kind'])=>{try{run();throw Error('Expected rejection');}catch(error){expect(error).toBeInstanceOf(RootsPendingError);expect((error as RootsPendingError).kind).toBe(kind);}};

describe('Roots source queue thresholds (independent retained integer/branch vectors)',()=>{
 it('uses explicit 4GiB reference ceiling, not local memory or observed JVM heap',()=>{
  const p=plan({batchSize:256,workerCount:8,maxSplatPointsPerFrame:20000,referenceHeapBytes:4294967296});
  expect(p).toMatchObject({queueCapacity:16,maximumPendingPoints:62634939,referenceHeapBytes:'4294967296',heapPolicy:'explicit-reference-heap',nativeHeapObserved:false});
  expect(Object.isFrozen(p)).toBe(true);
 });
 it('preserves Java long order and wrap for explicit extreme heap facts',()=>{
  expect(plan({referenceHeapBytes:0}).maximumPendingPoints).toBe(8);
  expect(plan({referenceHeapBytes:1000}).maximumPendingPoints).toBe(14);
  expect(plan({referenceHeapBytes:1n<<62n}).maximumPendingPoints).toBe(8); // *35 wraps negative.
  expect(plan({batchSize:2147483647,workerCount:2147483647,referenceHeapBytes:0}).maximumPendingPoints).toBe(64000000);
  expect(plan({workerCount:2147483647}).queueCapacity).toBe(2); // source int multiply wraps.
 });
 it.each([[0,7,100,0],[50,7,100,7],[51,7,100,14],[74,7,100,14],[75,7,100,28],[89,7,100,28],[90,7,100,56],[101,7,100,56],[100,7,0,7],[100,7,-1,7],[50,7,101,7],[51,7,101,14]])('adaptive pending=%s base=%s P=%s -> %s',(n,s,p,expected)=>{
  expect(rootsPendingSplatBudget(n,s,p)).toBe(expected);
 });
 it('caps boosted work only; never silently reduces a legitimate base budget',()=>{
  expect(rootsPendingSplatBudget(10000000,2000000,64000000)).toBe(2000000);
  expect(rootsPendingSplatBudget(40000000,2000000,64000000)).toBe(1048576);
 });
 it('rejects unknown or non-normalized plan scalars and forged prepared facts',()=>{
  for(const changes of [{batchSize:0},{workerCount:1.1},{maxPointsPerSample:-1},{maxSplatPointsPerFrame:Infinity},{referenceHeapBytes:-1},{referenceHeapBytes:Number.MAX_SAFE_INTEGER+1}])reason(()=>plan(changes),'input');
  reason(()=>new RootsPendingQueue({...plan(),maximumPendingPoints:1},{storage:'points'}),'input');
  reason(()=>new RootsPendingQueue({...plan(),referenceHeapBytes:'invalid'},{storage:'points'}),'input');
 });
});

describe('whole samples, publication backpressure and terminal ownership',()=>{
 it('flushes only after an entire sample, preserving overshoot and copied input',()=>{
  const q=new RootsPendingQueue(plan({maxSplatPointsPerFrame:10}),{storage:'points'}),a=points([1,2,3]);
  q.appendSample(0,a);a.fill(99);expect(q.snapshot().queuedBatches).toBe(0);
  q.appendSample(0,points([4,5,6]));expect(q.snapshot()).toMatchObject({queuedBatches:1,queuedPoints:6,builderPoints:0});
  q.drain('density');expect(take(q).values).toEqual([1,2,3,4,5,6]);q.dispose();
 });
 it('preserves a blocked full batch and refuses duplicate sample computation',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'points'});
  q.appendSample(0,points([1,2,3,4]));q.appendSample(0,points([5,6,7,8]));expect(q.appendSample(0,points([9,10,11,12]))).toEqual({blocked:true});
  const bytes=q.snapshot().retainedBytes;
  expect(q.workerState(0)).toMatchObject({builderPoints:4,blockedBatchPoints:4,blocked:true,canProduce:false});
  reason(()=>q.appendSample(0,points([13])),'state');expect(q.snapshot().producedPoints).toBe(12);
  q.drain('density');expect(q.publishWorker(0)).toEqual({blocked:false});expect(q.snapshot().retainedBytes).toBeLessThan(bytes);
  const seen=[...take(q).values];q.drain('density');while(q.snapshot().pendingPoints)seen.push(...take(q).values);
  expect(seen).toEqual(Array.from({length:12},(_,i)=>i+1));q.dispose();
 });
 it('pre-poll threshold allows whole-batch overshoot and blocks a head terminal',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'count-only'});
  q.appendSample(0,5);q.appendSample(0,5);expect(q.finishWorker(0)).toEqual({blocked:true});
  expect(q.drain('density')).toEqual({batches:2,points:10,terminals:0});expect(q.snapshot().pendingPoints).toBe(10); // P=8
  expect(q.publishWorker(0)).toEqual({blocked:false});expect(q.drain('density')).toEqual({batches:0,points:0,terminals:0});
  expect(q.snapshot()).toMatchObject({queuedBatches:1,finishedWorkers:0});
  expect(q.consumeDensity()).toEqual({budget:8,consumedPoints:8});expect(q.drain('density').terminals).toBe(1);
  expect(q.snapshot()).toMatchObject({finishedWorkers:1,pendingPoints:2,queuedBatches:0});q.consumeDensity();q.consumeDensity();expect(q.snapshot().pendingPoints).toBe(0);q.dispose();
 });
 it('publishes final partial data before its separately blocked terminal',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'count-only'});
  q.appendSample(0,4);q.appendSample(0,4);q.appendSample(0,2);expect(q.finishWorker(0)).toEqual({blocked:true});
  expect(q.workerState(0)).toMatchObject({finishRequested:true,blockedBatchPoints:2,terminal:'waiting'});
  q.drain('density');expect(q.publishWorker(0)).toEqual({blocked:false});expect(q.snapshot()).toMatchObject({queuedBatches:2,queuedPoints:2,finishedWorkers:0});
  q.consumeDensity();expect(q.drain('density')).toEqual({batches:1,points:2,terminals:1});q.dispose();
 });
 it('empty/filtered workers finish only when their terminal is actually polled',()=>{
  const q=new RootsPendingQueue(plan({workerCount:2,maxPointsPerSample:0}),{storage:'count-only'});
  q.appendSample(0,0,{filtered:true});q.finishWorker(0);q.finishWorker(0);q.finishWorker(1);
  expect(q.snapshot()).toMatchObject({queuedBatches:2,queuedPoints:0,finishedWorkers:0,producedPoints:0});
  expect(q.drain('density')).toEqual({batches:0,points:0,terminals:2});expect(q.snapshot().finishedWorkers).toBe(2);q.dispose();
 });
 it('uses caller enqueue order across workers, not worker-index sorting',()=>{
  const q=new RootsPendingQueue(plan({workerCount:2,maxSplatPointsPerFrame:20}),{storage:'points'});
  q.appendSample(1,points([9,8,7,6]));q.appendSample(0,points([1,2,3,4]));q.finishWorker(1);q.finishWorker(0);q.drain('density');expect(take(q).values).toEqual([9,8,7,6,1,2,3,4]);q.dispose();
 });
 it('does not invent producer wakeups between drains',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'count-only'});for(let i=0;i<3;i++)q.appendSample(0,4);
  q.drain('density');q.consumeDensity();q.drain('density');expect(q.snapshot()).toMatchObject({queuedBatches:0,blockedPoints:4});
  q.publishWorker(0);q.drain('density');expect(q.snapshot().blockedPoints).toBe(0);q.dispose();
 });
});

describe('density consumption and cloud forwarding',()=>{
 it('charges raw nonfinite entries while the downstream finite-N decision stays separate',()=>{
  const q=new RootsPendingQueue(plan({maxSplatPointsPerFrame:10}),{storage:'points'});
  const raw=Float32Array.from([1,2,3,.1,Infinity,2,3,.2,4,5,6,.3,7,NaN,8,.4]);q.appendSample(0,raw);q.drain('density');let submitted=0;
  const result=q.consumeDensity(slices=>{for(const s of slices)for(let i=0;i<s.points!.length;i+=4)if([s.points![i],s.points![i+1],s.points![i+2]].every(Number.isFinite))submitted++;});
  expect(result.consumedPoints).toBe(4);expect(submitted).toBe(2);expect(q.snapshot().pendingPoints).toBe(0);q.dispose();
 });
 it('preserves signed-zero/NaN/Infinity raw bits and applies no transform at append',()=>{
  const q=new RootsPendingQueue(plan({batchSize:1,maxSplatPointsPerFrame:1}),{storage:'points'});
  const raw=Float32Array.from([-0,Infinity,-Infinity,NaN]);q.appendSample(0,raw);q.drain('density');
  q.consumeDensity(slices=>{for(const s of slices){expect(Object.is(s.points![0],-0)).toBe(true);expect(s.points![1]).toBe(Infinity);expect(s.points![2]).toBe(-Infinity);expect(Number.isNaN(s.points![3])).toBe(true);}});q.dispose();
 });
 it('retains exact FIFO head offsets across repeated budgets',()=>{
  const q=new RootsPendingQueue(plan({batchSize:3,maxSplatPointsPerFrame:2,referenceHeapBytes:100000}),{storage:'points'});
  q.appendSample(0,points([1,2,3]));q.appendSample(0,points([4,5,6]));q.drain('density');
  expect(take(q).values).toEqual([1,2]);expect(take(q).values).toEqual([3,4]);expect(take(q).values).toEqual([5,6]);expect(q.snapshot().pendingBatches).toBe(0);q.dispose();
 });
 it('does not apply density budget to cloud and forwards bounded borrowed chunks',()=>{
  const q=new RootsPendingQueue(plan({batchSize:70000,maxPointsPerSample:70000}),{storage:'points'});const raw=new Float32Array(70000*4);raw[raw.length-4]=17;
  q.appendSample(0,raw);q.finishWorker(0);const sizes:number[]=[];let last=0;
  expect(q.drain('point-cloud',s=>{sizes.push(s.pointCount);last=s.points![s.points!.length-4];})).toEqual({batches:1,points:70000,terminals:1});
  expect(sizes).toEqual([65536,4464]);expect(last).toBe(17);expect(q.snapshot()).toMatchObject({pendingPoints:0,drainedPoints:70000,consumedPoints:0,finishedWorkers:1});q.dispose();
 });
 it('points/count-only follow identical batch/terminal/budget traces',()=>{
  const a=new RootsPendingQueue(plan(),{storage:'points'}),b=new RootsPendingQueue(plan(),{storage:'count-only'});
  const compare=()=>{const omit=({storage:_,retainedBytes:__,peakBytes:___,...s}:ReturnType<typeof a.snapshot>)=>s;expect(omit(a.snapshot())).toEqual(omit(b.snapshot()));};
  for(const n of [3,3,4,2]){a.appendSample(0,points(Array(n).fill(n)));b.appendSample(0,n);compare();}
  a.finishWorker(0);b.finishWorker(0);compare();
  for(let i=0;i<12;i++){expect(a.drain('density')).toEqual(b.drain('density'));expect(a.consumeDensity(s=>{for(const _ of s){/* consume */}})).toEqual(b.consumeDensity());expect(a.publishWorker(0)).toEqual(b.publishWorker(0));compare();}
  expect(a.snapshot()).toMatchObject({pendingPoints:0,queuedBatches:0,finishedWorkers:1,consumedPoints:12});a.dispose();b.dispose();
 });
});

describe('ownership, preflight and cancellation',()=>{
 it('capacity callback rejection before a batch copy leaves earlier builder intact',()=>{
  const refusal=new Error('combined display budget');let deny=false;const q=new RootsPendingQueue(plan({maxSplatPointsPerFrame:10}),{storage:'points',onBytes:()=>{if(deny)throw refusal;}});
  q.appendSample(0,points([1,2]));const before=q.snapshot();deny=true;expect(()=>q.appendSample(0,points([3,4]))).toThrow(refusal);expect(q.snapshot()).toEqual(before);
  deny=false;q.finishWorker(0);q.drain('density');expect(take(q).values).toEqual([1,2]);q.dispose();
 });
 it('preflights builder allocation instead of allocating the source threshold eagerly',()=>{
  const q=new RootsPendingQueue(plan({batchSize:100000000}),{storage:'points',maximumBytes:4096});
  reason(()=>q.appendSample(0,points([1])),'capacity');expect(q.snapshot()).toMatchObject({producedPoints:0,builders:0});q.dispose();
  const symbolic=new RootsPendingQueue(plan({batchSize:100000000,maxPointsPerSample:100000000}),{storage:'count-only',maximumBytes:4096});symbolic.appendSample(0,100000000);expect(symbolic.snapshot().queuedPoints).toBe(100000000);symbolic.dispose();
 });
 it('cancels during a large copy without committing any sample/builder',()=>{
  const q=new RootsPendingQueue(plan({batchSize:70000,maxPointsPerSample:70000}),{storage:'points'});let checks=0;
  expect(()=>q.appendSample(0,new Float32Array(280000),{isCancelled:()=>++checks===4})).toThrowError(expect.objectContaining({name:'AbortError'}));
  expect(q.snapshot()).toMatchObject({builders:0,producedPoints:0,queuedBatches:0,failed:false});q.dispose();
 });
 it('cancelled finish does not manufacture a polled terminal',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'count-only'});q.appendSample(0,1);
  expect(()=>q.finishWorker(0,{isCancelled:()=>true})).toThrowError(expect.objectContaining({name:'AbortError'}));expect(q.workerState(0)).toMatchObject({finishRequested:false,terminal:'none'});q.dispose();
 });
 it('caller cancellation exceptions retain identity rather than becoming invalid points',()=>{
  const error={tag:'caller'},q=new RootsPendingQueue(plan(),{storage:'count-only'});
  try{q.appendSample(0,1,{isCancelled:()=>{throw error;}});throw Error('missed');}catch(e){expect(e).toBe(error);}expect(q.snapshot().producedPoints).toBe(0);q.dispose();
 });
 it('failed density draw cannot be replayed against partially mutated external state',()=>{
  const q=new RootsPendingQueue(plan({maxSplatPointsPerFrame:10}),{storage:'points'});q.appendSample(0,points([1,2,3,4]));q.drain('density');const bytes=q.snapshot().retainedBytes,error=new Error('GPU draw failed');
  expect(()=>q.consumeDensity(s=>{for(const _ of s)throw error;})).toThrow(error);
  expect(q.snapshot()).toMatchObject({failed:true,pendingPoints:4,consumedPoints:0,retainedBytes:bytes});reason(()=>take(q),'state');q.dispose();expect(q.snapshot().retainedBytes).toBe(0);
 });
 it('failed cloud sink retains the queued owner for disposal',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'points'});q.appendSample(0,points([1,2,3,4]));const bytes=q.snapshot().retainedBytes,error=new Error('ring append');
  expect(()=>q.drain('point-cloud',()=>{throw error;})).toThrow(error);expect(q.snapshot()).toMatchObject({failed:true,queuedPoints:4,retainedBytes:bytes});q.dispose();expect(q.snapshot().retainedBytes).toBe(0);
 });
 it('rejects a short iterator consumer and reentrant mutation',()=>{
  for(const callback of [(s:Iterable<RootsPendingSlice>)=>{for(const _ of s)break;},(_s:Iterable<RootsPendingSlice>,q:RootsPendingQueue)=>q.appendSample(0,points([9]))]){
   const q=new RootsPendingQueue(plan(),{storage:'points'});q.appendSample(0,points([1,2,3,4]));q.drain('density');reason(()=>q.consumeDensity(s=>callback(s,q)),'state');expect(q.snapshot().failed).toBe(true);q.dispose();
  }
 });
 it('rejects wrong tuple carriers, bound overflow, detached input and filtered points',()=>{
  const q=new RootsPendingQueue(plan(),{storage:'points'});
  for(const input of [3,new Float64Array(4),new Float32Array(3),points(Array(9).fill(1))])reason(()=>q.appendSample(0,input as Float32Array),'input');
  reason(()=>q.appendSample(0,points([1]),{filtered:true}),'input');const detached=points([1]);structuredClone(detached,{transfer:[detached.buffer]});reason(()=>q.appendSample(0,detached),'input');
  expect(q.snapshot().producedPoints).toBe(0);q.dispose();q.dispose();reason(()=>q.canProduce(0),'state');expect(q.snapshot().retainedBytes).toBe(0);
 });
});
