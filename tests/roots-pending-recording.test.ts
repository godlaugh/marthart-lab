import {afterEach,describe,expect,it,vi} from 'vitest';
import type {AnimationTrack,SceneDocument} from '../src/types';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import * as mathModule from '../src/engine/rootsMathJob';
import {RootsPendingStream,type RootsPendingStreamFacts} from '../src/engine/rootsPendingStream';
import {createRootsNativeProgress} from '../src/engine/rootsNativePointReader';
import {rootsSchedule} from '../src/scenes/rootsDensity';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
import {
 planRootsFreshRecording,rootsPendingCompletion,ROOTS_PENDING_RECORDING_LIMITS,
 type RootsFreshRecordingPlan,type RootsPendingCompletionFacts,
} from '../src/engine/rootsRecording';

const options={simulationFps:4,encoderFps:24};
const wait=(duration=.001):AnimationTrack=>({id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration,easing:'linear',enabled:true,pingPong:false});
function scene(tracks:AnimationTrack[]=[],mode:'density'|'point-cloud'='density'):SceneDocument {
 const s=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration()),true);
 s.rootsPresentation!.mode=mode;
 s.rootsPresentation!.pending={model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:1,referenceHeapBytes:0};
 s.rootsMath!.polynomial={variable:'x',coefficients:[{exponent:'7',expression:'1'},{exponent:'0',expression:'-1'}]};
 s.rootsMath!.parameters=[];
 s.rootsMath!.sampling={sampleCount:1,batchSize:2,workerCount:1,seed:'1',filter:''};
 s.settings={...s.settings,rootSamplesPerFrame:1,rootSamplingFps:4,rootStartTime:0};
 s.timeline={...s.timeline,tracks,fps:4,duration:10};
 return s;
}
function pending(plan:RootsFreshRecordingPlan):RootsPendingCompletionFacts {
 if(plan.completion.policy!=='roots-pending-ordinal-v1')throw new Error('expected pending completion');
 return plan.completion;
}
afterEach(()=>vi.restoreAllMocks());

describe('real-math pending recording: independent whole-batch hand traces',()=>{
 it('waits an extra frame for a terminal blocked by a seven-point batch, even after all samples were solved',()=>{
  // x^7-1 gives 7 finite roots. B=2,W=1,S=1,H=0 => Q=2,P=4.
  // Frame1: poll batch7, terminal blocked; boosted budget min(7,8)=7.
  // Frame2: poll terminal. The first frame is warmup, so encode exactly one.
  const p=planRootsFreshRecording(scene(),options),f=pending(p);
  expect(p).toMatchObject({updates:2,encodedFrames:1,firstEncodedUpdate:2,lastDisplayFrame:1,completionReason:'pending-drained'});
  expect(f).toMatchObject({attemptedSamples:1,workerCount:1,finishedWorkers:1,queueSize:0,pendingPoints:0,complete:true});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({queueCapacity:2,maximumPendingPoints:4,producedPoints:7,publishedPoints:7,drainedPoints:7,consumedPoints:7,pumpCalls:2,drainCalls:4,splatCalls:2});
  expect(p.pendingPlanning!.mathWorkUnits).toBeGreaterThan(7);
  expect(p.pendingPlanning!.peakBytes).toBeGreaterThan(0);
  expect(Object.isFrozen(p.pendingPlanning!.finalQueue)).toBe(true);
  expect(p.completion).not.toHaveProperty('pending');
  expect(JSON.stringify(p).match(/"arrivalPolicy"/g)).toHaveLength(1);
 });
 it('lets cloud drain both batch and terminal in warmup without density throttling',()=>{
  const p=planRootsFreshRecording(scene([],'point-cloud'),options),f=pending(p);
  expect(p).toMatchObject({updates:1,encodedFrames:0,firstEncodedUpdate:null,completionReason:'pending-drained'});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({producedPoints:7,drainedPoints:7,consumedPoints:0,finishedWorkers:1,drainCalls:2,splatCalls:0});
 });
 it('keeps the source animation-manager priority over a blocked terminal',()=>{
  const p=planRootsFreshRecording(scene([wait()]),options),f=pending(p);
  expect(p).toMatchObject({updates:1,encodedFrames:0,completionReason:'animation-queue'});
  expect(f).toMatchObject({queueComplete:true,hasAnimations:true,complete:true,queueSize:1,finishedWorkers:0,pendingPoints:0});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({drainCalls:3,splatCalls:1,producedPoints:7,consumedPoints:7});
 });
 it('does not infer degree times samples when the actual coefficient table degenerates',()=>{
  const s=scene();s.rootsMath!.polynomial.coefficients=[{exponent:'7',expression:'0'},{exponent:'0',expression:'1'}];
  const p=planRootsFreshRecording(s,options);
  expect(p).toMatchObject({updates:1,encodedFrames:0});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({producedPoints:0,consumedPoints:0,finishedWorkers:1});
 });
 it('executes actual filtering and ordinary per-sample evaluation failures instead of inventing points',()=>{
  const filtered=scene();filtered.rootsMath!.sampling.filter='im(t2)>=0';
  const invalid=scene();invalid.rootsMath!.polynomial.coefficients[1].expression='missing';
  for(const s of[filtered,invalid]){
   const p=planRootsFreshRecording(s,options);
   expect(p).toMatchObject({updates:1,encodedFrames:0});
   expect(pending(p)).toMatchObject({attemptedSamples:1,finishedWorkers:1,complete:true});
   expect(p.pendingPlanning!.finalQueue.producedPoints).toBe(0);
  }
 });
 it('continues source FIFO remainders after samples have ended',()=>{
  // Two samples -> one 14-point batch, P=20. Budgets 2,2, then ten 1s.
  const s=scene();s.rootsMath!.sampling.sampleCount=2;s.rootsMath!.sampling.batchSize=10;s.settings.rootSamplesPerFrame=2;
  const p=planRootsFreshRecording(s,options);
  expect(p).toMatchObject({updates:12,encodedFrames:11});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({producedPoints:14,consumedPoints:14,pumpCalls:12,drainCalls:24,splatCalls:12,pendingPoints:0});
 });
 it('uses delayed sample scheduling, not an empty timeline duration, for production',()=>{
  const s=scene();s.settings.rootStartTime=.5;s.timeline.duration=.1;
  const p=planRootsFreshRecording(s,options);
  expect(p).toMatchObject({updates:4,encodedFrames:3,lastDisplayFrame:3});
  expect(p.pendingPlanning!.finalQueue).toMatchObject({producedPoints:7,finishedWorkers:1,pumpCalls:4});
 });
 it('preserves camera-only marker behavior and keeps simulation/encoder FPS independent',()=>{
  const s=scene([wait(1)]);s.timeline.schedule='roots-camera-sequence-v1';
  const slow=planRootsFreshRecording(s,{simulationFps:2,encoderFps:120});
  const fast=planRootsFreshRecording(s,{simulationFps:4,encoderFps:1});
  expect(slow.updates).toBe(2);expect(fast.updates).toBe(4);
  expect(fast.finalFrame).not.toHaveProperty('gradient');
  expect(fast.pendingPlanning!.finalQueue.drainCalls).toBe(12);
  expect(planRootsFreshRecording(s,{simulationFps:4,encoderFps:120}).completion).toEqual(fast.completion);
 });
 it('retains old omitted-profile scalar planning and lossless pending document replay',()=>{
  const s=scene(),before=structuredClone(s),legacy=structuredClone(s);delete legacy.rootsPresentation!.pending;
  expect(planRootsFreshRecording(legacy,options)).toMatchObject({updates:1,encodedFrames:0,completionReason:'ordinal-samples',completion:{policy:'local-synchronous-ordinal'}});
  expect(planRootsFreshRecording(legacy,options)).not.toHaveProperty('pendingPlanning');
  const actual=planRootsFreshRecording(s,options);
  expect(planRootsFreshRecording(parseScene(serializeScene(s)),options)).toEqual(actual);
  expect(s).toEqual(before);
 });
});

describe('completion observes actual queue facts, with no second partition calculation',()=>{
 function facts():RootsPendingStreamFacts {
  const s=scene(),math=mathModule.prepareRootsMathJob(s),state=createRootsNativeProgress(1),schedule=rootsSchedule(s.settings,s.rootsMath);
  const stream=new RootsPendingStream(math,state,schedule,s.rootsPresentation!.pending!,{storage:'count-only'});
  try{stream.pump(1,'t2_imag');stream.drain('density');stream.consumeDensity();return stream.facts;}
  finally{stream.dispose();math.dispose();}
 }
 const input={mode:'density' as const,queueComplete:true,hasAnimations:false,configuredWorkerCount:20,sampleCount:1};
 it('does not derive finishedWorkers from attemptedSamples, and owns the returned scalar snapshot',()=>{
  const raw=facts(),f=rootsPendingCompletion(raw,input);
  expect(f).toMatchObject({attemptedSamples:1,configuredWorkerCount:20,workerCount:1,finishedWorkers:0,queueSize:1,complete:false});
  expect(rootsPendingCompletion(raw,{...input,hasAnimations:true}).complete).toBe(true);
  expect(Object.isFrozen(f)).toBe(true);expect(f).not.toHaveProperty('pending');
  const withOldDiagnostics={...input,pending:raw,arbitrary:'not a predicate input'};
  expect(rootsPendingCompletion(raw,withOldDiagnostics)).toEqual(f);
  expect(Object.keys(f).sort()).toEqual(['attemptedSamples','complete','configuredWorkerCount','finishedWorkers','hasAnimations','mode','pendingPoints','policy','queueComplete','queueSize','sampleCount','workerCount'].sort());
 });
 it('rejects failed/disposed or inconsistent observation inputs without fabricating completion',()=>{
  const f=facts();
  for(const delta of[{failed:true},{disposed:true},{attemptedSamples:2},{policy:'old'}])
   expect(()=>rootsPendingCompletion({...f,...delta} as RootsPendingStreamFacts,input)).toThrow(expect.objectContaining({code:'input'}));
 });
});

describe('one bounded planner task owns and releases real math and queue state',()=>{
 it('cancels before and during work, preserving caller errors and leaving the authored input untouched',()=>{
  const s=scene(),before=structuredClone(s);let calls=0;
  expect(()=>planRootsFreshRecording(s,{...options,isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));
  expect(()=>planRootsFreshRecording(s,{...options,isCancelled:()=>++calls===30})).toThrow(expect.objectContaining({name:'AbortError'}));
  const error=new Error('caller cancellation hook');
  expect(()=>planRootsFreshRecording(s,{...options,isCancelled:()=>{throw error;}})).toThrow(error);
  expect(s).toEqual(before);expect(planRootsFreshRecording(s,options).updates).toBe(2);
 });
 it('propagates mathematical syntax/capacity failures even when a short animation would finish in warmup',()=>{
  const syntax=scene([wait()]);syntax.rootsMath!.polynomial.coefficients[0].expression='sin(';
  const capacity=scene([wait()]);capacity.rootsMath!.polynomial.coefficients[0].exponent='2147483647';
  expect(()=>planRootsFreshRecording(syntax,options)).toThrow(expect.objectContaining({kind:'syntax'}));
  expect(()=>planRootsFreshRecording(capacity,options)).toThrow(expect.objectContaining({kind:'capacity'}));
 });
 it('enforces cumulative work and releases the owned job on hook failure',()=>{
  const prepare=mathModule.prepareRootsMathJob;let disposed=0;
  vi.spyOn(mathModule,'prepareRootsMathJob').mockImplementationOnce((s,h)=>{
   const job=prepare(s,h),sample=job.sample.bind(job),dispose=job.dispose.bind(job);
   return{...job,sample(...args){args[3]!.onWork!(ROOTS_PENDING_RECORDING_LIMITS.mathWork+1);return sample(...args);},dispose(){disposed++;dispose();}};
  });
  expect(()=>planRootsFreshRecording(scene(),options)).toThrow(expect.objectContaining({code:'capacity'}));
  expect(disposed).toBe(1);
 });
 it('admits math plus queue representations before retaining the queue',()=>{
  const prepare=mathModule.prepareRootsMathJob;let disposed=0;
  vi.spyOn(mathModule,'prepareRootsMathJob').mockImplementationOnce((s,h)=>{
   const job=prepare(s,h),dispose=job.dispose.bind(job);
   return{...job,workspaceCapacityBytes:ROOTS_PENDING_RECORDING_LIMITS.bytes+1,dispose(){disposed++;dispose();}};
  });
  expect(()=>planRootsFreshRecording(scene(),options)).toThrow(expect.objectContaining({code:'capacity'}));
  expect(disposed).toBe(1);
 });
 it('retains a failed cleanup ticket and original error until explicit retry succeeds',()=>{
  const prepare=mathModule.prepareRootsMathJob,original=new Error('sample failed'),cleanup=new Error('cleanup failed');let tries=0;
  vi.spyOn(mathModule,'prepareRootsMathJob').mockImplementationOnce((s,h)=>{
   const job=prepare(s,h),dispose=job.dispose.bind(job);
   return{...job,sample(){throw original;},dispose(){if(++tries===1)throw cleanup;dispose();}};
  });
  let thrown:unknown;try{planRootsFreshRecording(scene(),options);}catch(error){thrown=error;}
  expect(thrown).toBeInstanceOf(GenerationCleanupError);
  const failure=thrown as GenerationCleanupError;
  expect(failure.errors).toEqual([original,cleanup]);expect(failure.cleanupPending).toBe(true);
  failure.retryCleanup();expect(tries).toBe(2);expect(failure.cleanupPending).toBe(false);
  failure.retryCleanup();expect(tries).toBe(2);
 });
});
