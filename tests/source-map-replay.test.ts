import {beforeEach,describe,expect,it,vi} from 'vitest';
import native from './fixtures/map/replay-runtime.json';
import type {IteratedFrameJob} from '../src/scenes/iteratedDensity';
import type {IteratedGpuOptions} from '../src/engine/iteratedDensityGpu';
const trace=vi.hoisted(()=>({steps:[] as {job:IteratedFrameJob;options:IteratedGpuOptions}[],resizes:[] as number[][],fail:false}));
// This is a boundary trace for lifecycle ordering and failure ownership. Native
// static helper values are real JVM evidence; this mock does not prove GL pixels.
vi.mock('../src/engine/iteratedDensityGpu',()=>({IteratedDensityGpu:class {
 step(job:IteratedFrameJob,options:IteratedGpuOptions){
  trace.steps.push({job,options});if(trace.fail)throw Error('synthetic GPU failure');
  return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:0,invalid:0,accepted:0,clipped:0,sampleInvalid:0};
 }
 resizeAccumulation(width:number,height:number){trace.resizes.push([width,height]);}
 diagnostics(){return{retainedBytes:0};}
 dispose(){}
}}));
import {SourceIteratedReplaySession,sourceIteratedReplayBudget,type SourceIteratedDisplayEvent} from '../src/engine/sourceIteratedReplaySession';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
const job=(burn=100,iterations=2)=>prepareIteratedFrame(parseLegacyScene(JSON.stringify({
 config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map replay lifecycle',parameters:{a:.2},
 equations:{x_next:'a*x+y',y_next:'nx-y',z_next:'ny+z'},
 settings:{dimension:3,batch_size:8,burn_in_steps:burn,iterations_per_frame:iterations,accumulation_decay:.7},timeline:[],
}),{sourceEntry:'runtime-config'}).scene,0,0);
const options={width:32,height:24,projection:'xy' as const,padding:0,isCancelled:()=>false};
const paused:SourceIteratedDisplayEvent={updates:[],paused:true,parameterChanged:false,cameraChanged:false};
beforeEach(()=>{trace.steps=[];trace.resizes=[];trace.fail=false;});

describe('Map replay helper evidence and lifecycle ownership',()=>{
 for(const row of native.rows.filter(r=>r.method==='computeReplayBudgetForFrame'&&r.args[0]>=0&&r.args[0]<=256))it('original Map helper budget '+row.id,()=>{
  expect(sourceIteratedReplayBudget(row.args[0],row.args[1],row.args[2])).toBe(row.result);
 });
 for(const row of native.rows.filter(r=>r.method==='computeReplayRebuildSteps'&&r.args[0]>=0&&r.args[0]<=100000&&r.args[1]===64&&r.args[2]===256))it('original rebuild step count '+row.id,()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job(row.args[0]);owner.display(frame,options,paused);owner.requestReplay();const result=owner.display(frame,options,paused);
  expect(result.remainingReplaySteps+result.passes).toBe(row.result);
 });
 for(const row of native.rows.filter(r=>r.method==='computeTargetRevealFrames'&&r.args[0]===.5))it('original configured reveal frame count '+row.id,()=>{
  const owner=new SourceIteratedReplaySession('map',row.args[1]),frame=job();owner.display(frame,options,paused);owner.requestReplay();owner.display(frame,options,paused);
  expect(owner.diagnostics().targetRevealFrames).toBe(row.result);
 });
 it('rejects a Map job at a Symmetry owner before GPU mutation',()=>{
  const owner=new SourceIteratedReplaySession('symmetry',60);
  expect(()=>owner.display(job(),options,paused)).toThrow('配置');expect(trace.steps).toHaveLength(0);
 });
 it('initialization discards an earlier replay request and paused initialization has no mathematical advance',()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job();owner.requestReplay();
  const result=owner.display(frame,options,paused);
  expect(result).toMatchObject({replayed:false,passes:1,accumulationPasses:1,warmupApplied:false,replayActive:false});
  expect(result.phases).toEqual([{kind:'display',warmupSteps:0,iterationSteps:0,draw:true,resetParticles:true}]);
  expect(owner.diagnostics().replayPending).toBe(false);
  expect(trace.steps[0].job.config.decay).toBe(frame.config.decay);
 });
 it('keeps both ordinary updates before replay reset, then repeats warmup while an active replay is incomplete',()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job(100,2);owner.display(frame,options,paused);owner.requestReplay();
  const event={...paused,paused:false,updates:[frame.field,{...frame.field}]};
  const first=owner.display(frame,options,event);
  expect(first.phases).toEqual([
   {kind:'update',warmupSteps:100,iterationSteps:4,draw:false,resetParticles:false},
   {kind:'replay',warmupSteps:12,iterationSteps:2,draw:true,resetParticles:true},
   {kind:'replay',warmupSteps:0,iterationSteps:2,draw:true,resetParticles:false},
  ]);
  expect(trace.steps[1].job.iterationUpdates).toBe(event.updates);
  expect(trace.steps[2].job.iterationUpdates).toBeUndefined();
  expect(first).toMatchObject({remainingBurnInSteps:88,remainingReplaySteps:98,accumulationPasses:2,warmupApplied:false});
  const next=owner.display(frame,options,event);expect(next.phases[0]).toMatchObject({kind:'update',warmupSteps:100,iterationSteps:4});
 });
 it('resizing cancels active replay without replacing particles or remaining counters',()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job();owner.display(frame,options,paused);owner.requestReplay();owner.display(frame,options,paused);
  const before=owner.diagnostics();expect(owner.willReplayDisplay(32,24)).toBe(true);expect(owner.willReplayDisplay(33,24)).toBe(false);
  const result=owner.display(frame,{...options,width:33},paused);
  expect(trace.resizes).toEqual([[33,24]]);expect(result).toMatchObject({resized:true,replayed:false,cleared:true,replayActive:false,accumulationPasses:1,remainingBurnInSteps:before.remainingBurnInSteps,remainingReplaySteps:before.remainingReplaySteps,warmupApplied:before.warmupApplied});
  expect(result.phases).toEqual([{kind:'display',warmupSteps:0,iterationSteps:0,draw:true,resetParticles:false}]);
 });
 it('keeps paused parameter acknowledgement separate from clear decisions and replay display',()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job();owner.display(frame,options,paused);
  expect(owner.display(frame,options,{...paused,parameterChanged:true})).toMatchObject({cleared:false,accumulationPasses:2});
  // The caller acknowledged the changed map while paused. Resume must not
  // reintroduce a change just because no clear occurred on that display.
  expect(owner.display(frame,options,{...paused,paused:false})).toMatchObject({cleared:false,accumulationPasses:3});
  expect(owner.display(frame,options,{...paused,paused:false,parameterChanged:true})).toMatchObject({cleared:true,accumulationPasses:1});
  owner.requestReplay();expect(owner.willReplayDisplay(32,24)).toBe(true);
 });
 it('continues burn-only replay displays after all splat samples are exhausted',()=>{
  const owner=new SourceIteratedReplaySession('map',1),frame=job(1000,1);owner.display(frame,options,paused);owner.requestReplay();
  let result=owner.display(frame,options,paused),displays=1;
  while(result.remainingReplaySteps>0&&displays++<40)result=owner.display(frame,options,paused);
  expect(result).toMatchObject({remainingReplaySteps:0,accumulationPasses:256,replayActive:true});
  const burnOnly=owner.display(frame,options,paused);
  expect(burnOnly.passes).toBe(0);expect(burnOnly.accumulationPasses).toBe(256);
  expect(burnOnly.phases).toEqual([{kind:'replay',warmupSteps:12,iterationSteps:0,draw:false,resetParticles:false}]);
  expect(burnOnly.remainingBurnInSteps).toBe(result.remainingBurnInSteps-12);
 });
 it('fails closed after a partial GPU operation until owner reset',()=>{
  const owner=new SourceIteratedReplaySession('map',60),frame=job();owner.display(frame,options,paused);trace.fail=true;
  expect(()=>owner.display(frame,options,paused)).toThrow('synthetic GPU failure');expect(owner.diagnostics().failed).toBe(true);
  expect(()=>owner.requestReplay()).toThrow();trace.fail=false;owner.reset();expect(owner.diagnostics()).toMatchObject({failed:false,initialized:false});
 });
});
