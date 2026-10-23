import {describe,expect,it} from 'vitest';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {prepareRootsComputationPlan,RootsComputationProducer} from '../src/engine/rootsComputation';
import {RootsComputationPool,type RootsComputationWorkerPort} from '../src/engine/rootsComputationPool';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
const limits={maximumWorkers:4,maximumBytes:1024*1024};
function config(samples=5,workers=1){const c=createRootsNativeMath(workers);c.polynomial={variable:'z',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};c.sampling={sampleCount:samples,workerCount:workers,batchSize:1,seed:'1',filter:''};return c;}
function producer(c=config(),index=0){const p=prepareRootsComputationPlan(c,'t2_imag',limits);if(!p.ok)throw p.error;return new RootsComputationProducer(p.value,index);}
class Port implements RootsComputationWorkerPort {
 onmessage:RootsComputationWorkerPort['onmessage']=null;onerror:RootsComputationWorkerPort['onerror']=null;onmessageerror:RootsComputationWorkerPort['onmessageerror']=null;
 sent:unknown[]=[];terminated=0;failTerminate=false;
 postMessage(x:unknown){this.sent.push(x);}terminate(){this.terminated++;if(this.failTerminate)throw Error('terminate failed');}
 emit(value:unknown){this.onmessage?.({data:value} as MessageEvent<unknown>);}
}
function setup(c=config()){
 const ports:Port[]=[],pool=new RootsComputationPool(c,'t2_imag',limits,()=>{const p=new Port();ports.push(p);return p;});pool.start();
 return{pool,ports};
}
function next(p:RootsComputationProducer){const r=p.step(128);if(r.kind!=='batch')throw Error('expected batch');return r.batch;}
describe('owned concurrent Roots computation',()=>{
 it('rejects worker and representation budgets before creating ports, preserving caller input',()=>{
  const c=config(5,2),before=structuredClone(c);let ports=0;
  for(const budget of [{maximumWorkers:1,maximumBytes:1e6},{maximumWorkers:4,maximumBytes:1}])expect(()=>new RootsComputationPool(c,'t2_imag',budget,()=>{ports++;return new Port();})).toThrow(expect.objectContaining({kind:'capacity'}));
  expect(ports).toBe(0);expect(c).toEqual(before);
  expect(prepareRootsComputationPlan({...c,model:'local-v1'},'t2_imag',limits)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('uses the source seed parser and keeps admitted plans immutable',()=>{
  const c=config();c.sampling.seed='١';const prepared=prepareRootsComputationPlan(c,'radius',limits);if(!prepared.ok)throw prepared.error;
  expect(prepared.value.partitions.partition(0).seed).toBe(1n);expect(prepared.value.configuration.sampling.seed).toBe('١');
  expect(()=>{prepared.value.configuration.sampling.batchSize=999;}).toThrow();
  expect(()=>new RootsComputationProducer({...prepared.value},0)).toThrow(/owning prepared plan/);
 });
 it('keeps queue capacity, grants credits only on admission and transfers terminal last',()=>{
  const c=config(),{pool,ports:[port]}=setup(c),p=producer(c);
  try{
   for(let i=0;i<3;i++)port.emit({kind:'batch',batch:next(p)});
   expect(pool.snapshot()).toMatchObject({queuedBatches:2,waitingBatches:1,offers:3,producerSamplesObserved:3,consumedSamples:0,computationComplete:false});
   expect(port.sent).toHaveLength(3); // start and two admitted credits
   const first=pool.take()!;expect(Object.isFrozen(first.progress)).toBe(true);expect(first.progress.attemptedSamples).toBe(1);expect(port.sent.at(-1)).toEqual({kind:'credit',sequence:3});
   port.emit({kind:'batch',batch:next(p)});expect(pool.take()!.progress.attemptedSamples).toBe(2);
   port.emit({kind:'batch',batch:next(p)});
   expect(pool.snapshot().computationComplete).toBe(false);
   const remaining=[pool.take()!,pool.take()!,pool.take()!];expect(remaining.map(b=>b.progress.attemptedSamples)).toEqual([3,4,5]);expect(remaining.map(b=>b.terminal)).toEqual([false,false,true]);
   expect(pool.snapshot()).toMatchObject({state:'complete',consumedSamples:5,consumedTerminals:1,queuedBatches:0,waitingBatches:0,ownedWorkers:0,drawingComplete:null});
   expect(port.terminated).toBe(1);expect(first.points.length).toBe(4);expect(pool.take()).toBeUndefined();
  }finally{p.dispose();pool.dispose();}
 });
 it('rejects unsolicited offers while blocked and preserves the failure',()=>{
  const {pool,ports:[port]}=setup(),p=producer();try{
   for(let i=0;i<4;i++)port.emit({kind:'batch',batch:next(p)});
   expect(pool.snapshot()).toMatchObject({state:'failed',ownedWorkers:0});expect(()=>pool.take()).toThrow(expect.objectContaining({kind:'protocol'}));
  }finally{p.dispose();pool.dispose();}
 });
 it.each(['sequence','progress','buffer','failure'] as const)('fails closed on malformed %s',kind=>{
  const {pool,ports:[port]}=setup(),p=producer();try{
   const b=next(p),raw:Record<string,unknown>={...b};
   if(kind==='sequence')raw.sequence=3;
   if(kind==='progress')raw.progress={...b.progress,rootPoints:77};
   if(kind==='buffer')raw.points=new Uint8Array(4);
   port.emit(kind==='failure'?{kind:'failure',error:{kind:'made-up',message:'bad'}}:{kind:'batch',batch:raw});
   expect(()=>pool.take()).toThrow(expect.objectContaining({kind:'protocol'}));expect(port.terminated).toBe(1);
  }finally{p.dispose();pool.dispose();}
 });
 it('surfaces worker and message decoding failures rather than an empty successful stream',()=>{
  for(const type of ['error','messageerror']){
   const {pool,ports:[port]}=setup();try{if(type==='error')port.onerror?.({message:'GPU-independent solver crash'} as ErrorEvent);else port.onmessageerror?.({} as MessageEvent<unknown>);expect(()=>pool.take()).toThrow();expect(pool.snapshot().state).toBe('failed');expect(port.terminated).toBe(1);}finally{pool.dispose();}
  }
 });
 it('retains a worker whose termination failed and supports cleanup retry',()=>{
  const {pool,ports:[port]}=setup();port.failTerminate=true;
  let error:unknown;try{pool.dispose();}catch(e){error=e;}
  expect(error).toBeInstanceOf(GenerationCleanupError);expect(pool.snapshot().ownedWorkers).toBe(1);
  port.failTerminate=false;(error as GenerationCleanupError).retryCleanup();expect(pool.snapshot().ownedWorkers).toBe(0);pool.dispose();
  expect(pool.snapshot().state).toBe('disposed');
 });
 it('cleans partially created pools and ignores late events after disposal',()=>{
  const port=new Port();let calls=0;const pool=new RootsComputationPool(config(5,2),'radius',limits,()=>{if(calls++)throw Error('launch failed');return port;});
  expect(()=>pool.start()).toThrow('launch failed');expect(port.terminated).toBe(1);pool.dispose();
  port.emit({kind:'failure',error:{kind:'worker',message:'late'}});expect(pool.snapshot().state).toBe('disposed');
 });
 it('yields through all-filtered work and emits an empty terminal without inventing points',()=>{
  const c=config(300,2);c.sampling.filter='im(t2)>=0';c.parameters=[];
  const p=producer(c,1);try{
   expect(p.step(128)).toEqual({kind:'yield'});const result=p.step(128);expect(result.kind).toBe('batch');
   if(result.kind==='batch')expect(result.batch).toMatchObject({workerIndex:1,terminal:true,points:new Float32Array(),progress:{totalSamples:150,attemptedSamples:150,filteredSamples:150,rootPoints:0}});
   expect(()=>p.step(1)).toThrow(/readable/);
  }finally{p.dispose();}
 });
 it('preserves explicit cancellation without fabricating a terminal',()=>{
  const p=producer();try{expect(()=>p.step(128,{isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));expect(next(p).progress.attemptedSamples).toBe(1);}finally{p.dispose();}
 });
});
