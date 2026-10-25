import {describe,expect,it,vi} from 'vitest';
import {IteratedDensitySession} from '../src/scenes/iteratedDensity';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {initializeSamilaCamera} from '../src/engine/samilaCamera';
import type {IteratedDensitySamilaAsyncBackend,IteratedDensityAsyncStepResult,IteratedDensityAsyncPresentResult} from '../src/engine/iteratedDensityAsyncBackend';
import type {SourceSamilaPreparedDisplay} from '../src/engine/sourceSamilaSession';
import type {GenerateContext} from '../src/types';

function scene(){
 const s=createScene(definition('samila'));
 s.settings=initializeSamilaCamera({...s.settings,iteratedBackend:'cpu',samilaMathModel:'mathart-1.7.8',samilaProjectionModel:'source-ndc-v1',samilaSplatModel:'samila-splat-1.7.8',samilaSamplingModel:'samila-pcg-1.7.8',samilaPresentationModel:'samila-present-1.7.8',densityToneModel:'samila-normalized-v2',batchSize:4,iteratedFps:10,samilaSpotSize:.04,alpha:1,showTrails:false,normalizedGamma:1,normalizedDynamicRange:1});
 s.equations={f1:'x+a',f2:'y'};s.parameters={a:0};s.palette={name:'white',mode:'linear',stops:['#ffffff','#ffffff'],cycles:1,offset:0};
 s.timeline.tracks=[
  {id:'parameter',type:'numeric',target:'parameters.a',from:0,to:1,start:0,duration:.2,easing:'linear',enabled:true,pingPong:false},
  {id:'alpha',type:'numeric',target:'settings.alpha',from:1,to:0,start:0,duration:.2,easing:'linear',enabled:true,pingPong:false},
  {id:'theta',type:'numeric',target:'camera.theta',from:0,to:1,start:0,duration:1,easing:'linear',enabled:true,pingPong:false},
 ];return s;
}
const c:GenerateContext={width:17,height:13,time:0,quality:'export',samilaPrimaryPixelHeight:1080};
function stepResult(display:SourceSamilaPreparedDisplay):IteratedDensityAsyncStepResult {const samples=display.job.history!.samples;return{facts:{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:samples,accepted:samples,clipped:0,invalid:0,sampleInvalid:0}};}
function backend(){return{kind:'samila' as const,
 admitDisplay:vi.fn<IteratedDensitySamilaAsyncBackend['admitDisplay']>(()=>{}),
 draw:vi.fn<IteratedDensitySamilaAsyncBackend['draw']>(async display=>stepResult(display)),
 present:vi.fn<IteratedDensitySamilaAsyncBackend['present']>(async display=>({shown:{pixels:new Uint8ClampedArray(display.width*display.height*4),occupiedPixels:3,maxCount:7,toneBackend:'native',warnings:[]},sourcePixelRenderer:{backend:'native',identity:'mock-native',generation:1,sequence:1,samples:0}})),
 reset:vi.fn<IteratedDensitySamilaAsyncBackend['reset']>(async()=>{}),
 // Deliberately expose a destructive operation to prove cold ownership never
 // calls it. Native abort would retire preview's shared context as well.
 cancel:vi.fn(),
};}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

describe('shared cold replay owner with an asynchronous backend (CPU-only scheduling, not GPU parity)',()=>{
 it('samples fixed frames once, preserves six-pass history, and presents fractional/tone edits without another seed',async()=>{
  const s=scene(),b=backend(),seeds=vi.fn(()=>42),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:seeds});
  try{
   const first=await owner.generateAsync(s,{...c,time:.15});
   expect(b.draw.mock.calls.map(([p])=>[p.job.frame,p.job.history!.passes,p.job.samilaSampling!.frameSeed,p.options.clearInk])).toEqual([[0,1,42,true],[1,6,42,true]]);
   expect(seeds).toHaveBeenCalledTimes(2);expect(first).toMatchObject({backend:'native',sourceSamilaPresentation:{backend:'native'},sourcePixelRenderer:{identity:'mock-native'},stats:{samples:28},density:{inputPoints:24,accepted:24,occupiedPixels:3,maxCount:7},temporal:{time:.1,frames:2}});
   const second=await owner.generateAsync(s,{...c,time:.19}),edited={...s,settings:{...s.settings,normalizedBrightness:.9}};
   await owner.generateAsync(edited,{...c,time:.19});
   expect(b.draw).toHaveBeenCalledTimes(2);expect(seeds).toHaveBeenCalledTimes(2);expect(b.present).toHaveBeenCalledTimes(3);expect(second.temporal).toMatchObject({time:.1,cacheHits:1});
   const [firstPresent,secondPresent,thirdPresent]=b.present.mock.calls.map(([p])=>p);
   expect(firstPresent.tone.model).toBe('samila-normalized-v2');expect(firstPresent.tone.model==='samila-normalized-v2'&&firstPresent.tone.normalization).toMatchObject({alpha:.5,completedPasses:6,baseBatchSize:4});
   expect(secondPresent.tone).toEqual(firstPresent.tone);expect(secondPresent.view.currentTheta).toBeCloseTo(.19);expect(firstPresent.view.currentTheta).toBeCloseTo(.15);
   expect(thirdPresent.tone.model==='samila-normalized-v2'&&thirdPresent.tone.tone.brightness).toBeCloseTo(.9);expect(()=>owner.snapshotInk()).toThrow('未提供原始墨迹');
  }finally{await owner.resetAsync();}
 });
 it('replays backwards with the original tape, but resize and full reset start fresh epochs',async()=>{
  const s=scene(),b=backend();let nextSeed=0;const owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:()=>++nextSeed});
  try{
   await owner.generateAsync(s,{...c,time:.2});await owner.generateAsync(s,c);await owner.generateAsync(s,{...c,time:.2});
   expect(b.draw.mock.calls.map(([p])=>p.job.samilaSampling!.frameSeed)).toEqual([1,2,3,1,2,3]);expect(nextSeed).toBe(3);expect(b.reset).toHaveBeenCalledTimes(2);
   await owner.generateAsync(s,{...c,width:19});expect(nextSeed).toBe(4);expect(b.draw.mock.calls.at(-1)![0].options).toMatchObject({width:19,clearInk:true});
   await owner.resetAsync();expect(owner.diagnostics().samilaSampling.retainedBytes).toBe(0);await owner.generateAsync(s,c);expect(nextSeed).toBe(5);
  }finally{await owner.resetAsync();}
 });
 it('keeps pre-start blank output on the existing CPU path without native draw or entropy',async()=>{
  const s=scene();s.settings.iteratedStartTime=1;const b=backend(),seeds=vi.fn(()=>1),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:seeds}),cpu=new IteratedDensitySession({samilaSeedProvider:seeds});
  try{const actual=await owner.generateAsync(s,c),expected=cpu.generate(s,c);expect(actual.type).toBe('raster');expect(actual).toMatchObject({backend:'cpu',temporal:{frames:0},stats:{samples:0}});expect(actual.type==='raster'&&actual.pixels).toEqual(expected.type==='raster'&&expected.pixels);expect(b.draw).not.toHaveBeenCalled();expect(b.present).not.toHaveBeenCalled();expect(seeds).not.toHaveBeenCalled();}finally{cpu.reset();await owner.resetAsync();}
 });
 it('admits expanded compensation before consuming its seed or submitting a native step',async()=>{
  const s=scene(),b=backend(),seeds=vi.fn(()=>1),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:seeds});
  b.admitDisplay.mockImplementation(({job})=>{if(job.history!.passes===6)throw Error('native capacity');});
  try{await expect(owner.generateAsync(s,{...c,time:.1})).rejects.toThrow('native capacity');expect(b.draw).toHaveBeenCalledOnce();expect(seeds).toHaveBeenCalledOnce();expect(b.present).not.toHaveBeenCalled();expect(owner.diagnostics()).toMatchObject({frame:null,cleanupPending:false});}finally{await owner.resetAsync();}
 });
 it('waits for an in-flight step acknowledgement before soft cancellation releases its resource',async()=>{
  const b=backend(),pending=deferred<IteratedDensityAsyncStepResult>(),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:()=>3});b.draw.mockImplementationOnce(()=>pending.promise);
  const draw=owner.generateAsync(scene(),{...c,time:.2}),failure=expect(draw).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.draw).toHaveBeenCalledOnce());
  expect(b.draw.mock.calls[0][0].options.isCancelled).toBeUndefined();const resets=b.reset.mock.calls.length,cleanup=owner.resetAsync();expect(b.cancel).not.toHaveBeenCalled();expect(b.reset).toHaveBeenCalledTimes(resets);
  await expect(owner.generateAsync(scene(),c)).rejects.toThrow('正在执行');pending.resolve(stepResult(b.draw.mock.calls[0][0]));await failure;await cleanup;
  expect(b.draw).toHaveBeenCalledOnce();expect(b.present).not.toHaveBeenCalled();expect(b.cancel).not.toHaveBeenCalled();expect(owner.diagnostics()).toMatchObject({frame:null,retainedBytes:0,cleanupPending:false,inFlight:false});
 });
 it('does not publish a present response cancelled in flight, and keeps the tape for an explicit retry',async()=>{
  const s=scene(),b=backend(),pending=deferred<IteratedDensityAsyncPresentResult>(),seeds=vi.fn(()=>4),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:seeds});let cancelled=false;b.present.mockImplementationOnce(()=>pending.promise);
  const draw=owner.generateAsync(s,{...c,isCancelled:()=>cancelled}),failure=expect(draw).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.present).toHaveBeenCalledOnce());cancelled=true;
  pending.resolve({shown:{pixels:new Uint8ClampedArray(c.width*c.height*4),occupiedPixels:1,maxCount:1,toneBackend:'native',warnings:[]}});await failure;
  expect(b.cancel).not.toHaveBeenCalled();expect(owner.diagnostics().frame).toBe(null);expect(owner.diagnostics().samilaSampling.seeds).toBe(1);
  await owner.generateAsync(s,c);expect(seeds).toHaveBeenCalledOnce();expect(b.draw).toHaveBeenCalledTimes(2);expect(b.draw.mock.calls.map(([p])=>p.job.samilaSampling!.frameSeed)).toEqual([4,4]);
  await owner.resetAsync();expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('retains failed cleanup until explicit retry and never resubmits an uncertain step',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:()=>5});await owner.generateAsync(s,c);
  b.draw.mockRejectedValueOnce(Error('unknown step commit'));b.reset.mockRejectedValueOnce(Error('release unavailable'));
  await expect(owner.generateAsync(s,{...c,time:.1})).rejects.toThrow('清理未完成');expect(owner.diagnostics()).toMatchObject({cleanupPending:true,frame:0});expect(owner.diagnostics().samilaSampling.retainedBytes).toBeGreaterThan(0);
  const calls=b.draw.mock.calls.length;await expect(owner.generateAsync(s,{...c,time:.1})).rejects.toThrow('清理');expect(b.draw).toHaveBeenCalledTimes(calls);
  await owner.resetAsync();expect(owner.diagnostics()).toMatchObject({cleanupPending:false,frame:null,retainedBytes:0});
 });
 it('ends an uncertain native request without retry or CPU fallback, allowing only a new explicit replay',async()=>{
  const s=scene(),b=backend(),seeds=vi.fn(()=>7),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:seeds});
  try{
   await owner.generateAsync(s,c);b.draw.mockRejectedValueOnce(Error('unknown step commit'));
   await expect(owner.generateAsync(s,{...c,time:.1})).rejects.toThrow('unknown step commit');
   expect(b.draw).toHaveBeenCalledTimes(2);expect(b.present).toHaveBeenCalledOnce();expect(seeds).toHaveBeenCalledTimes(2);expect(owner.diagnostics()).toMatchObject({frame:null,cleanupPending:false});
   // Explicit caller action starts a new retained resource and replays both
   // fixed frames using their already consumed seed words.
   const retried=await owner.generateAsync(s,{...c,time:.1});expect(retried.backend).toBe('native');expect(b.draw).toHaveBeenCalledTimes(4);expect(seeds).toHaveBeenCalledTimes(2);expect(b.draw.mock.calls.slice(2).map(([p])=>p.job.frame)).toEqual([0,1]);
  }finally{await owner.resetAsync();}
 });
 it('does not discard completed owner metadata or retry a failed release during backwards seek',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b,samilaSeedProvider:()=>6});await owner.generateAsync(s,{...c,time:.1});const resets=b.reset.mock.calls.length;b.reset.mockRejectedValueOnce(Error('release unavailable'));
  await expect(owner.generateAsync(s,c)).rejects.toThrow('release unavailable');expect(b.reset).toHaveBeenCalledTimes(resets+1);expect(owner.diagnostics()).toMatchObject({cleanupPending:true,frame:1});expect(b.draw).toHaveBeenCalledTimes(2);await owner.resetAsync();
 });
});
