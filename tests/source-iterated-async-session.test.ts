import {describe,it,expect,vi} from 'vitest';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {editSourceSymmetryConfiguration} from '../src/engine/sourceSymmetryConfig';
import {SourceIteratedReplaySession} from '../src/engine/sourceIteratedReplaySession';
import {SourceIteratedSession} from '../src/engine/sourceIteratedSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import type {GenerateContext} from '../src/types';
import type {SourceIteratedReplayBackend,SourceIteratedReplayAsyncBackend,SourceIteratedPresented} from '../src/engine/sourceIteratedReplayBackend';
import type {IteratedFrameJob} from '../src/scenes/iteratedDensity';
import type {IteratedGpuOptions} from '../src/engine/iteratedDensityGpu';

type Family='map'|'symmetry';
const scene=(family:Family)=>(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',name:'Async live boundary',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',parameters:family==='map'?{gain:.001}:{alpha:2.5},equations:family==='map'?{x_next:'x+gain',y_next:'y'}:undefined,settings:{batch_size:8,burn_in_steps:3,iterations_per_frame:1},timeline:[{type:'wait',duration:.1}]}),{sourceEntry:'runtime-config'}).scene;
const context=(family:Family,paused=true):GenerateContext=>({time:0,width:32,height:24,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene(family),32,24,'primary',24),[family==='map'?'mapLive':'symmetryLive']:{sessionId:'test-live',renderFps:30,replayRevision:0,clock:{paused,timestampMs:1000}}});
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
/** A deterministic boundary recorder, not a GPU or native correctness oracle. */
function backend(){
 const trace:unknown[]=[];let width=0,height=0,retained=0,disposed=0;
 const controls:{stepGate?:ReturnType<typeof deferred<void>>;entered?:ReturnType<typeof deferred<void>>;stepError?:Error;disposeError?:Error;native?:boolean}={};
 const sync:SourceIteratedReplayBackend={
  step(job:IteratedFrameJob,options:IteratedGpuOptions){
   const {isCancelled:_cancel,...target}=options,{transform,...rest}=job,{point:_point,...scalars}=transform;trace.push({kind:'step',job:structuredClone({...rest,transform:scalars}),options:target});
   if(controls.stepError)throw controls.stepError;width=options.width;height=options.height;retained=1024;
   return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:job.config.count*((job.iterationFrame?.warmupSteps??0)+(job.iterationFrame?.iterationSteps??0)),invalid:0,accepted:job.config.record?job.config.count:0,clipped:0,sampleInvalid:0};
  },
  resizeAccumulation(w,h){trace.push({kind:'resize',width:w,height:h});width=w;height=h;},
  present(tone,_cancel,view){trace.push({kind:'present',tone:structuredClone(tone),view:structuredClone(view)});return{pixels:new Uint8ClampedArray(width*height*4),occupiedPixels:1,maxCount:1,toneBackend:'webgl2',warnings:[]};},
  validateAccumulationCapture(w,h,additional){trace.push({kind:'admit',width:w,height:h,additional});},
  diagnostics(){return{retainedBytes:retained};},readParticles(){return{positionsAndMetric:new Float32Array(),invalidCounts:new Uint32Array(),validity:new Uint8Array()};},readback(){return new Float32Array();},
  dispose(){disposed++;trace.push({kind:'dispose'});if(controls.disposeError)throw controls.disposeError;retained=0;},
 };
 const async:SourceIteratedReplayAsyncBackend={
  async step(job,options){controls.entered?.resolve();await controls.stepGate?.promise;return sync.step(job,options);},
  async resizeAccumulation(w,h){sync.resizeAccumulation(w,h);},
  async present(tone,view):Promise<SourceIteratedPresented>{const result=sync.present(tone,undefined,view);return controls.native?{...result,toneBackend:'native',sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64),generation:1,sequence:2,samples:1}}:result;},
  validateAccumulationCapture:sync.validateAccumulationCapture,diagnostics:sync.diagnostics,async dispose(){sync.dispose();},
 };
 return{trace,sync,async,controls,get disposed(){return disposed;}};
}
const edit=(s:ReturnType<typeof scene>,value:number)=>{const candidate={...s,parameters:{...s.parameters,[s.kind==='map'?'gain':'alpha']:value}};return s.kind==='map'?editSourceMapScene(s,candidate,'parameters'):editSourceSymmetryConfiguration(s,candidate,'parameters');};
function pair(family:Family){const a=backend(),b=backend(),s=scene(family),c=context(family);return{a,b,s,c,sync:new SourceIteratedSession(family,{backend:()=>a.sync}),async:new SourceIteratedSession(family,{asyncBackend:()=>b.async})};}
function semantic(d:ReturnType<SourceIteratedSession['diagnostics']>){const {inFlight:_i,resetting:_r,...rest}=d;return rest;}

describe('one live iterated owner across sync and awaited effects',()=>{
 for(const family of ['map','symmetry'] as const){
  it(family+' preserves pause, hot parameters, replay, capture restoration and resize order',async()=>{
   const p=pair(family),key=family==='map'?'mapLive':'symmetryLive';
   expect(await p.async.generateAsync(p.s,p.c)).toEqual(p.sync.generate(p.s,p.c));
   const hot=edit(p.s,.25);
   p.sync.updateParameters(p.s,hot,p.c);p.async.updateParameters(p.s,hot,p.c);
   expect(await p.async.navigatePausedAsync(hot,p.c,{kind:'wheel',count:1})).toEqual(p.sync.navigatePaused(hot,p.c,{kind:'wheel',count:1}));
   const replay={...p.c,[key]:{...p.c[key]!,replayRevision:1}};
   expect(await p.async.generateAsync(hot,replay)).toEqual(p.sync.generate(hot,replay));
   expect(await p.async.capturePausedAsync(hot,{...replay,width:48,height:36,quality:'export'})).toEqual(p.sync.capturePaused(hot,{...replay,width:48,height:36,quality:'export'}));
   expect(p.async.matchesCompletedPrimary(hot,replay)).toBe(true);
   const resize={...replay,width:40,sourceViewport:{...replay.sourceViewport!,logicalWidth:40}};
   expect(await p.async.generateAsync(hot,resize)).toEqual(p.sync.generate(hot,resize));
   expect(p.b.trace).toEqual(p.a.trace);expect(semantic(p.async.diagnostics())).toEqual(semantic(p.sync.diagnostics()));
   await p.async.resetAsync();p.sync.reset();expect(p.async.diagnostics().retainedBytes).toBe(0);
  });
  it(family+' preserves applied recording construction and stop has no display',async()=>{
   const p=pair(family);p.sync.generate(p.s,p.c);await p.async.generateAsync(p.s,p.c);
   const hot=edit(p.s,.4);
   p.sync.updateParameters(p.s,hot,p.c);p.async.updateParameters(p.s,hot,p.c);
   const a=p.sync.beginRecording(hot,p.c,{width:32,height:24,simulationFps:30}),b=await p.async.beginRecordingAsync(hot,p.c,{width:32,height:24,simulationFps:30});
   expect(b.scene.parameters).toEqual(p.s.parameters);expect(b.clock).toEqual(a.clock);
   for(let i=1;i<=a.clock.lastDisplayFrame;i++){
    const x=p.sync.nextRecordingFrame(a.handle,i),y=await p.async.nextRecordingFrameAsync(b.handle,i);
    expect(y.iteratedRecording).toEqual(x.iteratedRecording);expect(y.stats).toEqual(x.stats);
   }
   const count=p.b.trace.length;const stopped=p.async.finishRecording(b.handle,2000);p.sync.finishRecording(a.handle,2000);
   expect(stopped.scene.parameters).toEqual(a.scene.parameters);expect(p.b.trace).toHaveLength(count);expect(p.b.trace).toEqual(p.a.trace);
   await p.async.resetAsync();p.sync.reset();
  });
  it(family+' preserves fixed reconstruction steps',async()=>{
   const p=pair(family),key=family==='map'?'mapLive':'symmetryLive',c={...p.c,[key]:{...p.c[key]!,startAt:.1}};
   expect(await p.async.generateAsync(p.s,c)).toEqual(p.sync.generate(p.s,c));expect(p.b.trace).toEqual(p.a.trace);await p.async.resetAsync();p.sync.reset();
  });
 }
 it('snapshots authored inputs before the first await and rejects concurrent mutations',async()=>{
  const p=pair('symmetry');p.b.controls.stepGate=deferred<void>();p.b.controls.entered=deferred<void>();
  const original=structuredClone(p.s),c=structuredClone(p.c),pending=p.async.generateAsync(p.s,p.c);p.s.parameters.alpha=99;p.c.symmetryLive!.replayRevision=99;
  await Promise.race([p.b.controls.entered.promise,pending]);
  await expect(p.async.generateAsync(original,c)).rejects.toThrow('正在执行');expect(()=>p.async.setPaused(false)).toThrow('空闲');expect(p.async.matchesCompletedPrimary(original,c)).toBe(false);
  p.b.controls.stepGate.resolve();await pending;expect(p.async.matchesCompletedPrimary(original,c)).toBe(true);
  expect((p.b.trace.find((v:any)=>v.kind==='step') as any).job.field).not.toEqual(undefined);await p.async.resetAsync();
 });
 it('soft reset waits for the acknowledged effect without presenting or retrying it',async()=>{
  const p=pair('symmetry');p.b.controls.stepGate=deferred<void>();p.b.controls.entered=deferred<void>();
  const pending=p.async.generateAsync(p.s,p.c),rejection=pending.then(()=>{throw Error('Cancelled generation resolved');},error=>error);await Promise.race([p.b.controls.entered.promise,pending]);
  const resetting=p.async.resetAsync();expect(p.b.disposed).toBe(0);expect(p.async.diagnostics().resetting).toBe(true);
  p.b.controls.stepGate.resolve();expect(await rejection).toBeInstanceOf(Error);await resetting;
  expect(p.b.trace.filter((v:any)=>v.kind==='step')).toHaveLength(1);expect(p.b.trace.filter((v:any)=>v.kind==='present')).toHaveLength(0);expect(p.b.disposed).toBe(1);expect(p.async.diagnostics().retainedBytes).toBe(0);
 });
 it('does not publish a final presentation revoked between child ACK and parent resume',async()=>{
  const p=pair('symmetry');await p.async.generateAsync(p.s,p.c);
  const original=SourceIteratedReplaySession.prototype.presentAsync;let cleanup:Promise<void>|undefined;
  const spy=vi.spyOn(SourceIteratedReplaySession.prototype,'presentAsync').mockImplementation(function(this:SourceIteratedReplaySession,...args){
   const pending=original.apply(this,args);void pending.then(()=>{cleanup=p.async.resetAsync();});return pending;
  });
  try{await expect(p.async.generateAsync(p.s,p.c)).rejects.toThrow('取消');await cleanup;expect(p.async.diagnostics().retainedBytes).toBe(0);expect(p.async.matchesCompletedPrimary(p.s,p.c)).toBe(false);}
  finally{spy.mockRestore();await p.async.resetAsync();}
 });
 it('retains failed cleanup for an explicit retry and never retries a failed effect',async()=>{
  const p=pair('symmetry');await p.async.generateAsync(p.s,p.c);
  p.b.controls.stepError=Error('uncertain ACK');p.b.controls.disposeError=Error('retained native resource');
  const before=p.b.trace.length;await expect(p.async.generateAsync(p.s,p.c)).rejects.toThrow('清理失败');
  expect(p.b.disposed).toBe(1);expect(p.b.trace.slice(before).filter((v:any)=>v.kind==='step')).toHaveLength(1);
  expect(p.async.diagnostics()).toMatchObject({failed:true,sessionId:'test-live'});expect(p.async.diagnostics().retainedBytes).toBeGreaterThan(0);
  await expect(p.async.generateAsync(p.s,p.c)).rejects.toThrow('显式重置');
  p.b.controls.disposeError=undefined;await p.async.resetAsync();expect(p.b.disposed).toBe(2);expect(p.async.diagnostics().retainedBytes).toBe(0);
 });
 it('does not automatically repeat a failed release while replacing an owner',async()=>{
  const p=pair('symmetry');await p.async.generateAsync(p.s,p.c);p.b.controls.disposeError=Error('release failed');
  await expect(p.async.generateAsync(p.s,{...p.c,symmetryLive:{...p.c.symmetryLive!,sessionId:'replacement'}})).rejects.toThrow('清理失败');
  expect(p.b.disposed).toBe(1);expect(p.async.diagnostics().sessionId).toBe('test-live');
  p.b.controls.disposeError=undefined;await p.async.resetAsync();
 });
 it('preserves native presentation identity and rejects synchronous access to an async owner',async()=>{
  const p=pair('symmetry');p.b.controls.native=true;
  expect(()=>p.async.generate(p.s,p.c)).toThrow('Async');const result=await p.async.generateAsync(p.s,p.c);
  expect(result).toMatchObject({backend:'native',density:{toneBackend:'native'},sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64)}});
  expect(()=>p.async.readParticles()).toThrow('Async');expect(()=>p.async.reset()).toThrow('resetAsync');await p.async.resetAsync();
 });
});
