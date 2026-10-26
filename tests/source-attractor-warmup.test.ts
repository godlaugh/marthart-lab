import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Worker as NodeWorker} from 'node:worker_threads';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {prepareSourceAttractorEquation} from '../src/engine/sourceAttractorEquation';
import {SourceAttractorCpuParticles} from '../src/engine/sourceAttractorCpuParticles';
import {prepareSourceAttractorWarmup,runSourceAttractorWarmupSerial,executeSourceAttractorWarmup,SOURCE_ATTRACTOR_WARMUP_LIMITS,type SourceAttractorWarmupRequest} from '../src/engine/sourceAttractorWarmup';
import {SourceAttractorWarmupPool,type SourceAttractorWarmupWorkerPort} from '../src/engine/sourceAttractorWarmupPool';

function configuration(count=32,warmup=40){const result=importSourceAttractorConfig({particle_count_cpu:count,time_step_min:.002,time_step_max:.006,sub_steps:3,scale_x:2,offset_z:-3},{warmup_steps:warmup,stagger_min:2,stagger_max:32});if(!result.ok)throw result.error;return result.value.configuration;}
function equation(dx='y-x',dy='x-z',dz='x*y-z'){const result=prepareSourceAttractorEquation({equations:{dx,dy,dz},parameters:{a:1+2**-40}});if(!result.ok)throw result.error;return result.value;}
const bits=(a:Float32Array)=>new Uint32Array(a.buffer,a.byteOffset,a.length);
class Port implements SourceAttractorWarmupWorkerPort {
 onmessage:SourceAttractorWarmupWorkerPort['onmessage']=null;onerror:SourceAttractorWarmupWorkerPort['onerror']=null;onmessageerror:SourceAttractorWarmupWorkerPort['onmessageerror']=null;
 requests:SourceAttractorWarmupRequest[]=[];terminated=0;failTerminate=false;
 postMessage(request:SourceAttractorWarmupRequest){this.requests.push(structuredClone(request));}
 terminate(){this.terminated++;if(this.failTerminate)throw Error('termination failed');}
 complete(change?:(value:ReturnType<typeof executeSourceAttractorWarmup>)=>void){const value=executeSourceAttractorWarmup(this.requests.shift()!);change?.(value);this.onmessage?.({data:value} as MessageEvent);}
}
const setup=()=>{const ports:Port[]=[],pool=new SourceAttractorWarmupPool(()=>{const port=new Port();ports.push(port);return port;});return{pool,ports};};
let directory:string,workerPath:string;const terminations:Promise<unknown>[]=[];
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'attractor-warmup-test-'));workerPath=join(directory,'worker.mjs');
 // Execute the actual browser Worker entry with a narrow Node transport shim.
 const source=resolve('src/engine/sourceAttractorWarmup.worker.ts');
 const bundle=await build({stdin:{contents:`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:(value,transfer)=>parentPort.postMessage(value,transfer),close:()=>parentPort.close()};await import(${JSON.stringify(source)});parentPort.on('message',data=>self.onmessage({data}));`,resolveDir:process.cwd(),sourcefile:'worker-shim.mjs'},platform:'node',format:'esm',bundle:true,write:false});
 await writeFile(workerPath,bundle.outputFiles[0].text);
});
afterAll(async()=>{await Promise.all(terminations);await rm(directory,{recursive:true,force:true});});
function nodePort():SourceAttractorWarmupWorkerPort {
 const worker=new NodeWorker(pathToFileURL(workerPath));
 const port:SourceAttractorWarmupWorkerPort={onmessage:null,onerror:null,onmessageerror:null,postMessage:(message,transfer)=>worker.postMessage(message,transfer as ArrayBuffer[]),terminate(){terminations.push(worker.terminate());}};
 worker.on('message',data=>port.onmessage?.({data} as MessageEvent));worker.on('error',error=>port.onerror?.({message:error.message} as ErrorEvent));worker.on('messageerror',error=>port.onmessageerror?.({data:error} as MessageEvent));return port;
}

describe('source Attractor complete warmup owner',()=>{
 it('admits the complete job independently of lane count and refuses oversized work before creating workers',()=>{
  const config=configuration(500,2000),field=equation();
  const one=prepareSourceAttractorWarmup(config,field,{parallel:true,maximumWorkers:1}),four=prepareSourceAttractorWarmup(config,field,{parallel:true,maximumWorkers:4});
  expect(one.work).toBe(four.work);expect(four.slices.reduce((sum,s)=>sum+s.work,0)).toBe(four.work);expect(four.slices.every(s=>s.work<=20_000_000)).toBe(true);
  expect(()=>prepareSourceAttractorWarmup(configuration(10000,100000),field,{parallel:true})).toThrow('预算');
  expect(()=>prepareSourceAttractorWarmup(config,field,{parallel:true,maximumWorkers:5})).toThrow('4');
  expect(()=>prepareSourceAttractorWarmup(configuration(1,1),{operations:5_000_000,create:field.create},{parallel:true})).toThrow();
  expect(SOURCE_ATTRACTOR_WARMUP_LIMITS.maximumWork).toBe(320_000_000);
 });
 it('uses actual independent worker entries and preserves every F32 slot/nonfinite value against serial Euler',async()=>{
  for(const field of [equation(),equation('1/0','0/0','0')]){
   const config=configuration(),plan=prepareSourceAttractorWarmup(config,field,{parallel:true,maximumWorkers:4}),expected=runSourceAttractorWarmupSerial(plan),pool=new SourceAttractorWarmupPool(nodePort);
   const actual=await pool.run(plan);expect(bits(actual.raw)).toEqual(bits(expected.raw));expect(bits(actual.dt)).toEqual(bits(expected.dt));expect(actual.steps).toEqual(expected.steps);expect(actual.work).toBe(expected.work);
   expect(actual.workers).toBeGreaterThan(1);expect(pool.diagnostics()).toMatchObject({ownedWorkers:0,pending:false,completedSlices:plan.slices.length});pool.reset();
  }
 });
 it('hydrates only after complete ACK and preserves serial updates, stable bindings and transferred snapshots',async()=>{
  const config=configuration(10,50),field=equation(),serial=new SourceAttractorCpuParticles({configuration:config,equation:field});
  const pool=new SourceAttractorWarmupPool(nodePort),asyncOwner=await SourceAttractorCpuParticles.createAsync({configuration:config,equation:field},pool);
  for(let i=0;i<4;i++){
   if(i){const frame={frameIndex:i-1,time:i/30,deltaTime:Math.fround(1/30)};serial.update(frame);asyncOwner.update(frame);}
   const a=asyncOwner.snapshot(),b=serial.snapshot();expect(bits(a.rawPositions)).toEqual(bits(b.rawPositions));expect(a.integrationSteps).toEqual(b.integrationSteps);expect(a.workUnits).toBe(b.workUnits);
   structuredClone(a,{transfer:[a.positions.buffer]});expect(asyncOwner.snapshot().positions.byteLength).toBeGreaterThan(0);serial.snapshot();
  }
 });
 it.each(['identity','count','steps','work'] as const)('rejects malformed %s ACK and terminates every exact owned worker',async kind=>{
  const {pool,ports}=setup(),plan=prepareSourceAttractorWarmup(configuration(),equation(),{parallel:true});const promise=pool.run(plan);const rejected=expect(promise).rejects.toThrow();
  ports[0].complete(value=>{if(kind==='identity')(value as {job:number}).job++;if(kind==='count')(value as {raw:Float32Array}).raw=new Float32Array(1);if(kind==='steps')value.steps[0]--;if(kind==='work')(value as {work:number}).work++;});
  await rejected;expect(ports.every(port=>port.terminated===1)).toBe(true);expect(pool.diagnostics().ownedWorkers).toBe(0);
 });
 it('cancels pending work, does not publish partial state, and can run a fresh job after cleanup',async()=>{
  const {pool,ports}=setup(),plan=prepareSourceAttractorWarmup(configuration(),equation(),{parallel:true});let cancelled=false;
  const pending=pool.run(plan,()=>cancelled),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});cancelled=true;await rejected;
  expect(ports.every(p=>p.terminated===1)).toBe(true);expect(pool.diagnostics().ownedWorkers).toBe(0);
  const second=pool.run(plan);for(const port of ports.slice(plan.workers))while(port.requests.length)port.complete();await second;
 });
 it('pins delayed slice inputs before ACK and retains nonfinite numeric payloads without shared buffers',async()=>{
  const {pool,ports}=setup(),plan=prepareSourceAttractorWarmup(configuration(8,40),equation(),{parallel:true,maximumWorkers:1}),expected=runSourceAttractorWarmupSerial(plan),pending=pool.run(plan);
  plan.raw.fill(99);plan.dt.fill(0);plan.steps.fill(0);for(const port of ports)while(port.requests.length)port.complete();const output=await pending;expect(bits(output.raw)).toEqual(bits(expected.raw));expect(output.steps).toEqual(expected.steps);expect(output.dt).toEqual(expected.dt);
 });
 it('preserves zero-particle and Java-overflow warmup skips without launching unnecessary workers',async()=>{
  const {pool,ports}=setup(),empty=prepareSourceAttractorWarmup(configuration(0,40),equation(),{parallel:true});expect((await pool.run(empty)).raw.length).toBe(0);expect(ports).toHaveLength(0);
  const config=configuration(1,2147483647);config.warmup.staggerMin=2;config.warmup.staggerMax=2;const plan=prepareSourceAttractorWarmup(config,equation(),{parallel:true});expect(plan.steps[0]).toBe(0);expect(runSourceAttractorWarmupSerial(plan).steps[0]).toBe(0);
 });
 it('retains failed cleanup ownership and refuses reuse until explicit reset succeeds',async()=>{
  const {pool,ports}=setup(),plan=prepareSourceAttractorWarmup(configuration(1,1),equation(),{parallel:true});const pending=pool.run(plan),rejected=expect(pending).rejects.toThrow('cleanup');ports[0].failTerminate=true;ports[0].complete();await rejected;
  expect(pool.diagnostics().ownedWorkers).toBe(1);expect(()=>pool.run(plan)).toThrow('上一任务');ports[0].failTerminate=false;pool.reset();expect(pool.diagnostics().ownedWorkers).toBe(0);
 });
 it('cleans partial launches and never falls back to the serial implementation',async()=>{
  const port=new Port();let calls=0;const pool=new SourceAttractorWarmupPool(()=>{if(calls++)throw Error('launch failed');return port;});
  await expect(pool.run(prepareSourceAttractorWarmup(configuration(),equation(),{parallel:true}))).rejects.toThrow('launch failed');expect(port.terminated).toBe(1);
 });
});
