import {describe,expect,it,vi} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {prepareIteratedFrame,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import {SourceIteratedReplaySession,type SourceIteratedDisplayEvent} from '../src/engine/sourceIteratedReplaySession';
import type {SourceIteratedReplayBackend,SourceIteratedReplayAsyncBackend,SourceIteratedPresented} from '../src/engine/sourceIteratedReplayBackend';
import type {IteratedGpuFacts,IteratedGpuOptions} from '../src/engine/iteratedDensityGpu';
import {prepareSourceSymmetryTone} from '../src/engine/sourceSymmetryPresentation';
import {GenerationCleanupError} from '../src/engine/generationCleanup';

const options={width:32,height:24,projection:'xy' as const,padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}};
const paused:SourceIteratedDisplayEvent={updates:[],paused:true,parameterChanged:false,cameraChanged:false};
function scene(family:'map'|'symmetry'='symmetry'){
 return (family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Replay boundary',parameters:{a:.2},equations:family==='map'?{x_next:'a*x+y',y_next:'nx-y'}:undefined,settings:{dimension:2,batch_size:8,burn_in_steps:100,iterations_per_frame:2,accumulation_decay:.7},timeline:[]}),{sourceEntry:'runtime-config'}).scene;
}
const job=(family:'map'|'symmetry'='symmetry')=>prepareIteratedFrame(scene(family),0,0);
const facts=(frame:IteratedFrameJob):IteratedGpuFacts=>({bounds:{...options.bounds},steps:frame.config.count*(frame.iterationFrame!.warmupSteps+frame.iterationFrame!.iterationSteps),invalid:1,accepted:frame.config.record?frame.config.count-2:0,clipped:frame.config.record?1:0,sampleInvalid:frame.config.record?1:0});
type RecordedFrame=Omit<IteratedFrameJob,'transform'>&{transform:Omit<IteratedFrameJob['transform'],'point'>};
function recordFrame(frame:IteratedFrameJob):RecordedFrame{const {point:_point,...transform}=frame.transform;return structuredClone({...frame,transform});}
type Trace=({kind:'step';job:RecordedFrame;options:Omit<IteratedGpuOptions,'isCancelled'>}|{kind:'resize';width:number;height:number}|{kind:'dispose'})[];
function synchronous(){
 const trace:Trace=[];let retained=0;
 const backend:SourceIteratedReplayBackend={
  step:vi.fn((frame,opt)=>{retained=128;const {isCancelled:_cancel,...plain}=opt;trace.push({kind:'step',job:recordFrame(frame),options:structuredClone(plain)});return facts(frame);}),
  resizeAccumulation:vi.fn((width,height)=>{trace.push({kind:'resize',width,height});}),
  present:vi.fn<SourceIteratedReplayBackend['present']>(()=>({pixels:new Uint8ClampedArray(4),occupiedPixels:1,maxCount:2,toneBackend:'webgl2',warnings:[]})),
  validateAccumulationCapture:vi.fn(),readParticles:vi.fn(()=>({positionsAndMetric:new Float32Array(4),invalidCounts:new Uint32Array(1),validity:new Uint8Array(1)})),readback:vi.fn(()=>new Float32Array(4)),
  diagnostics:()=>({retainedBytes:retained}),dispose:vi.fn(()=>{trace.push({kind:'dispose'});retained=0;}),
 };return{backend,trace};
}
function asynchronous(){
 const sync=synchronous();
 const backend={
  step:vi.fn<SourceIteratedReplayAsyncBackend['step']>(async(frame,opt)=>sync.backend.step(frame,opt)),
  resizeAccumulation:vi.fn<SourceIteratedReplayAsyncBackend['resizeAccumulation']>(async(w,h)=>sync.backend.resizeAccumulation(w,h)),
  present:vi.fn<SourceIteratedReplayAsyncBackend['present']>(async(tone,view)=>({...sync.backend.present(tone,undefined,view),toneBackend:'native',sourcePixelRenderer:{backend:'native',identity:'boundary-test',generation:1,sequence:1,samples:0}})),
  validateAccumulationCapture:vi.fn<SourceIteratedReplayAsyncBackend['validateAccumulationCapture']>(),
  diagnostics:sync.backend.diagnostics,
  dispose:vi.fn<SourceIteratedReplayAsyncBackend['dispose']>(async()=>sync.backend.dispose()),
  // Deliberately available to prove cancellation never calls destructive abort.
  cancel:vi.fn(),
 };return{...sync,backend};
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const running=(frame:IteratedFrameJob):SourceIteratedDisplayEvent=>({...paused,paused:false,updates:[frame.field,{...frame.field}]});

describe('one replay owner with synchronous and asynchronous execution (CPU-only boundary tests)',()=>{
 it('preserves completed-pass units across replay phases and rejects mixed units',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',30,{asyncBackend:b.backend}),frame=job();
  b.backend.step.mockImplementation(async j=>({...facts(j),invalidUnit:'completed-pass'}));
  try{
   expect((await owner.displayAsync(frame,options,paused)).gpu.invalidUnit).toBe('completed-pass');owner.requestReplay();
   const replay=await owner.displayAsync(frame,options,running(frame));expect(replay.gpu.invalidUnit).toBe('completed-pass');expect(replay.gpu.invalid).toBe(replay.phases.length);
   owner.requestReplay();b.backend.step.mockImplementationOnce(async j=>({...facts(j),invalidUnit:'iteration'}));
   await expect(owner.displayAsync(frame,options,running(frame))).rejects.toThrow('单位发生变化');
  }finally{await owner.resetAsync();}
 });
 for(const family of ['map','symmetry'] as const)it(`${family}: shares ordered warmup/replay, burn-only frames, resize and counters`,async()=>{
  const a=synchronous(),b=asynchronous(),sync=new SourceIteratedReplaySession(family,1,{backend:a.backend}),async=new SourceIteratedReplaySession(family,1,{asyncBackend:b.backend}),frame=job(family);
  frame.config.burn=1000;
  const display=async(event=paused,opt=options)=>{const expected=sync.display(frame,opt,event),actual=await async.displayAsync(frame,opt,event);expect(actual).toEqual(expected);expect(b.trace).toEqual(a.trace);return actual;};
  try{
   const first=await display();expect(first.phases).toEqual([{kind:'display',warmupSteps:0,iterationSteps:0,draw:true,resetParticles:true}]);
   sync.requestReplay();async.requestReplay();const replay=await display(running(frame));
   expect(replay.phases.map(p=>p.kind)).toEqual(['update','replay','replay']);expect(replay.phases[0].warmupSteps).toBe(16);
   let row=replay,limit=100;
   while(row.remainingReplaySteps>0&&--limit)row=await display();expect(limit).toBeGreaterThan(0);
   const burnOnly=await display();expect(burnOnly.passes).toBe(0);expect(burnOnly.phases[0]).toMatchObject({kind:'replay',draw:false,iterationSteps:0});
   const before=async.diagnostics(),resized=await display(paused,{...options,width:33});
   expect(resized).toMatchObject({resized:true,replayed:false,cleared:true,accumulationPasses:1,replayActive:false,remainingBurnInSteps:before.remainingBurnInSteps,remainingReplaySteps:before.remainingReplaySteps});
   expect(resized.phases[0].resetParticles).toBe(false);expect(b.trace.at(-2)).toEqual({kind:'resize',width:33,height:24});
  }finally{sync.reset();await async.resetAsync();}
 });
 it('snapshots both ordered parameter fields and later phases before asynchronous execution',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('map',60,{asyncBackend:b.backend}),frame=job('map');await owner.displayAsync(frame,options,paused);owner.requestReplay();
  if(frame.field.kind!=='map')throw Error('Expected prepared Map field');
  const first={...frame.field,parameters:{...frame.field.parameters,a:1}},second={...frame.field,parameters:{...frame.field.parameters,a:2}},event={...running(frame),updates:[first,second]},pending=deferred<IteratedGpuFacts>();
  b.backend.step.mockImplementationOnce(()=>pending.promise);
  const operation=owner.displayAsync(frame,options,event);frame.config.burn=7;first.parameters.a=91;second.parameters.a=92;event.updates.length=0;options.bounds.minX=-1;
  await vi.waitFor(()=>expect(b.backend.step).toHaveBeenCalledTimes(2));
  const submitted=b.backend.step.mock.calls[1][0];expect(submitted.iterationUpdates!.map(p=>p.kind==='map'?p.parameters.a:undefined)).toEqual([1,2]);expect(submitted.config.burn).toBe(100);
  pending.resolve(facts(submitted));const result=await operation;
  expect(result.phases).toMatchObject([{kind:'update',iterationSteps:4},{kind:'replay',warmupSteps:12},{kind:'replay',warmupSteps:0}]);
  expect(b.backend.step.mock.calls.slice(2).every(([p])=>p.config.burn===100&&p.iterationUpdates===undefined)).toBe(true);
  await owner.resetAsync();
 });
 it('accepts only the immutable prepared transform when detaching an async frame',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend}),frame=job();
  await expect(owner.displayAsync({...frame,transform:{...frame.transform}},options,paused)).rejects.toThrow('不可变');expect(b.backend.step).not.toHaveBeenCalled();
  const operation=owner.displayAsync(frame,options,paused),transform=frame.transform;frame.transform={...transform,sx:99};
  await operation;const submitted=b.backend.step.mock.calls[0][0];expect(submitted.transform).toBe(transform);expect(submitted.transform.point(.25,.5)).toEqual(transform.point(.25,.5));await owner.resetAsync();
 });
 it('blocks controls and waits for resize ACK before any subsequent step',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend}),frame=job();await owner.displayAsync(frame,options,paused);owner.requestReplay();
  const pending=deferred<void>();b.backend.resizeAccumulation.mockImplementationOnce(()=>pending.promise);
  const display=owner.displayAsync(frame,{...options,width:33},paused);await vi.waitFor(()=>expect(b.backend.resizeAccumulation).toHaveBeenCalledOnce());
  expect(b.backend.step).toHaveBeenCalledOnce();expect(()=>owner.setRenderFps(30)).toThrow('空闲');expect(()=>owner.requestReplay()).toThrow('空闲');expect(()=>owner.validateCapture(40,30,0)).toThrow('空闲');
  pending.resolve();expect((await display).resized).toBe(true);expect(b.backend.step).toHaveBeenCalledTimes(2);
  owner.validateCapture(40,30,16);expect(b.backend.validateAccumulationCapture).toHaveBeenCalledWith(40,30,16);await owner.resetAsync();
 });
 it('keeps an uncertain step failed until exact cleanup succeeds, without resubmitting it',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend}),frame=job();await owner.displayAsync(frame,options,paused);owner.requestReplay();
  b.backend.step.mockImplementationOnce(async p=>facts(p));
  b.backend.step.mockRejectedValueOnce(Error('unknown native ACK'));
  await expect(owner.displayAsync(frame,options,running(frame))).rejects.toThrow('unknown native ACK');
  expect(owner.diagnostics()).toMatchObject({failed:true,initialized:true,displayIndex:1,acknowledgedPhases:2,gpu:{retainedBytes:128}});
  expect(()=>owner.requestReplay()).toThrow();await expect(owner.displayAsync(frame,options,paused)).rejects.toThrow('重置');expect(b.backend.step).toHaveBeenCalledTimes(3);
  b.backend.dispose.mockRejectedValueOnce(Error('release not acknowledged'));
  await expect(owner.resetAsync()).rejects.toThrow('保留所有权');expect(owner.diagnostics()).toMatchObject({failed:true,displayIndex:1,gpu:{retainedBytes:128}});
  await expect(owner.displayAsync(frame,options,paused)).rejects.toThrow('重置');expect(b.backend.dispose).toHaveBeenCalledOnce();
  await owner.resetAsync();expect(owner.diagnostics()).toMatchObject({failed:false,initialized:false,acknowledgedPhases:0,gpu:{retainedBytes:0}});
  const restarted=await owner.displayAsync(frame,options,paused);expect(restarted.displayIndex).toBe(0);expect(b.backend.step.mock.calls.at(-1)![0].frame).toBe(0);await owner.resetAsync();
 });
 it('soft reset records the current ACK before disposal and never starts another replay phase',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend}),frame=job();await owner.displayAsync(frame,options,paused);owner.requestReplay();
  const pending=deferred<IteratedGpuFacts>();b.backend.step.mockImplementationOnce(()=>pending.promise);
  const display=owner.displayAsync(frame,options,running(frame)),rejection=expect(display).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.backend.step).toHaveBeenCalledTimes(2));
  expect(b.backend.step.mock.calls[1][1]).not.toHaveProperty('isCancelled');let acknowledgedAtDisposal=0;const dispose=b.backend.dispose.getMockImplementation()!;
  b.backend.dispose.mockImplementationOnce(async()=>{acknowledgedAtDisposal=owner.diagnostics().acknowledgedPhases;await dispose();});
  const reset=owner.resetAsync();expect(owner.resetAsync()).toBe(reset);expect(b.backend.dispose).not.toHaveBeenCalled();
  pending.resolve(facts(b.backend.step.mock.calls[1][0]));await rejection;await reset;
  expect(acknowledgedAtDisposal).toBe(2);expect(b.backend.step).toHaveBeenCalledTimes(2);expect(b.backend.cancel).not.toHaveBeenCalled();expect(owner.diagnostics()).toMatchObject({failed:false,initialized:false,inFlight:false,resetting:false,gpu:{retainedBytes:0}});
 });
 it('does not publish a cancelled present or advance replay state during presentation',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend});await owner.displayAsync(job(),options,paused);
  const tone=prepareSourceSymmetryTone(scene(),{width:options.width,height:options.height}),before=owner.diagnostics();
  const shown=await owner.presentAsync(tone);expect(shown).toMatchObject({toneBackend:'native',sourcePixelRenderer:{backend:'native'}});expect(owner.diagnostics().acknowledgedPhases).toBe(before.acknowledgedPhases);expect(owner.diagnostics().displayIndex).toBe(before.displayIndex);
  const pending=deferred<SourceIteratedPresented>();b.backend.present.mockImplementationOnce(()=>pending.promise);let cancelled=false;
  const operation=owner.presentAsync(tone,()=>cancelled),rejection=expect(operation).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.backend.present).toHaveBeenCalledTimes(2));cancelled=true;pending.resolve(shown);await rejection;
  expect(owner.diagnostics()).toMatchObject({failed:true,displayIndex:1,acknowledgedPhases:1});await expect(owner.presentAsync(tone)).rejects.toThrow('重置');expect(b.backend.cancel).not.toHaveBeenCalled();await owner.resetAsync();
 });
 it('rejects invalid display admission before backend mutation without losing a completed owner',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend}),frame=job();await owner.displayAsync(frame,options,paused);
  // A giant radius is rejected by the existing shared work owner, not the driver.
  const invalid={...frame,densitySplat:{...frame.densitySplat!,radius:1e8}};
  const calls=b.backend.step.mock.calls.length;await expect(owner.displayAsync(invalid,options,paused)).rejects.toThrow('20 亿');expect(b.backend.step).toHaveBeenCalledTimes(calls);expect(owner.diagnostics().failed).toBe(false);
  await owner.displayAsync(frame,options,paused);await owner.resetAsync();
 });
 it('preserves synchronous cleanup tickets and never lets an old retry clear a new generation',()=>{
  const b=synchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{backend:b.backend}),frame=job();owner.display(frame,options,paused);
  const dispose=vi.mocked(b.backend.dispose);dispose.mockImplementationOnce(()=>{throw Error('delete failed');});let held:unknown;
  try{owner.reset();}catch(error){held=error;}expect(held).toBeInstanceOf(GenerationCleanupError);expect(owner.diagnostics()).toMatchObject({failed:true,initialized:true,gpu:{retainedBytes:128}});
  (held as GenerationCleanupError).retryCleanup();expect(owner.diagnostics().initialized).toBe(false);owner.display(frame,options,paused);
  const calls=dispose.mock.calls.length;(held as GenerationCleanupError).retryCleanup();expect(dispose).toHaveBeenCalledTimes(calls);expect(owner.diagnostics().initialized).toBe(true);owner.reset();
 });
 it('does not expose a synchronous escape hatch for an asynchronous owner',async()=>{
  const b=asynchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{asyncBackend:b.backend});
  expect(()=>owner.display(job(),options,paused)).toThrow('Async');expect(()=>owner.reset()).toThrow('Async');expect(b.backend.step).not.toHaveBeenCalled();expect(b.backend.dispose).not.toHaveBeenCalled();await owner.resetAsync();
 });
 it('keeps synchronous presentation inside the same non-reentrant resource boundary',()=>{
  const b=synchronous(),owner=new SourceIteratedReplaySession('symmetry',60,{backend:b.backend});owner.display(job(),options,paused);
  const tone=prepareSourceSymmetryTone(scene(),{width:options.width,height:options.height});
  vi.mocked(b.backend.present).mockImplementationOnce(()=>{expect(()=>owner.reset()).toThrow('尚未结束');expect(()=>owner.requestReplay()).toThrow('空闲');return{pixels:new Uint8ClampedArray(4),occupiedPixels:1,maxCount:1,toneBackend:'webgl2',warnings:[]};});
  expect(owner.present(tone).pixels).toHaveLength(4);expect(owner.diagnostics()).toMatchObject({initialized:true,failed:false});expect(b.backend.dispose).not.toHaveBeenCalled();owner.reset();
 });
 it('admits the whole replay display using actual backend work before its first effect',async()=>{
  const b=asynchronous(),estimateWork=vi.fn(()=>1_100_000_000),owner=new SourceIteratedReplaySession('map',60,{asyncBackend:{...b.backend,estimateWork}}),frame=job('map');
  await owner.displayAsync(frame,options,paused);owner.requestReplay();const calls=b.backend.step.mock.calls.length;
  await expect(owner.displayAsync(frame,options,paused)).rejects.toThrow('20 亿');expect(b.backend.step).toHaveBeenCalledTimes(calls);expect(owner.diagnostics()).toMatchObject({failed:false,replayPending:true});
  expect(estimateWork.mock.calls.length).toBeGreaterThan(1);estimateWork.mockReturnValue(10);await owner.displayAsync(frame,options,paused);await owner.resetAsync();
 });

});
