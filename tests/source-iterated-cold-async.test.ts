import {afterEach,describe,expect,it,vi} from 'vitest';
import {IteratedDensitySession,iteratedInitialChunk,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import {IteratedDensityGpu,type IteratedGpuOptions} from '../src/engine/iteratedDensityGpu';
import {SourceIteratedNativeBackend} from '../src/engine/sourceIteratedNativeBackend';
import type {IteratedDensitySourceAsyncBackend} from '../src/engine/iteratedDensityAsyncBackend';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerateContext,SceneDocument} from '../src/types';

function scene(family:'map'|'symmetry'='map',dimension=2){
 return (family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',name:'Cold source boundary',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',parameters:{a:.1},equations:family==='map'?{x_next:'x+a',y_next:'y',z_next:'z'}:undefined,settings:{dimension,batch_size:8,burn_in_steps:100,iterations_per_frame:2},timeline:[{type:'wait',duration:1}]}),{sourceEntry:'runtime-config'}).scene;
}
const context=(s:SceneDocument):GenerateContext=>({time:.07,width:17,height:13,quality:'export',sourceViewport:ordinarySourceViewport(s,17,13,'offscreen',13)});
function facts(job:IteratedFrameJob){return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:job.config.count*(job.iterationFrame!.warmupSteps+job.iterationFrame!.iterationSteps),accepted:job.config.record?job.config.count:0,invalid:0,clipped:0,sampleInvalid:0};}
function record(job:IteratedFrameJob,options:IteratedGpuOptions){
 const {point:_,...transform}=job.transform,{isCancelled:__,...plain}=options;
 return structuredClone({job:{...job,transform},options:plain,seeds:iteratedInitialChunk(job.config,0,job.config.count)});
}
function backend(){
 const native=new SourceIteratedNativeBackend();let width=0,height=0;
 return{kind:'source-iterated' as const,
  estimateWork:vi.fn<IteratedDensitySourceAsyncBackend['estimateWork']>((j,r)=>native.estimateWork(j,r)),
  step:vi.fn<IteratedDensitySourceAsyncBackend['step']>(async(job,options)=>{width=options.width;height=options.height;return facts(job);}),
  present:vi.fn<IteratedDensitySourceAsyncBackend['present']>(async()=>({pixels:new Uint8ClampedArray(width*height*4),occupiedPixels:2,maxCount:4,toneBackend:'native',sourcePixelRenderer:{backend:'native',identity:'mock-native',generation:1,sequence:2,samples:0},warnings:[]})),
  reset:vi.fn(async()=>{}),cancel:vi.fn(),
 };
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return{promise,resolve};}
afterEach(()=>vi.restoreAllMocks());

describe('source fixed-frame replay: shared scheduling and isolated async ownership (not GPU parity)',()=>{
 for(const [family,dimension] of [['map',2],['map',3],['symmetry',2]] as const)it(`${family} ${dimension}D preserves synchronous frame plans, seeds, tone and captured view`,async()=>{
  const s=scene(family,dimension),c=context(s),b=backend(),sync=new IteratedDensitySession(),owner=new IteratedDensitySession({asyncBackend:b});
  const trace:ReturnType<typeof record>[]=[];
  vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((job,options)=>{trace.push(record(job,options));return facts(job);});
  const present=vi.spyOn(IteratedDensityGpu.prototype,'present').mockReturnValue({pixels:new Uint8ClampedArray(c.width*c.height*4),occupiedPixels:2,maxCount:4,toneBackend:'webgl2',warnings:[]});
  try{
   const expected=sync.generate(s,c),actual=await owner.generateAsync(s,c);
   expect(b.step.mock.calls.map(([j,o])=>record(j,o))).toEqual(trace);expect(trace).toHaveLength(3);
   expect(trace[0].job.iterationFrame).toMatchObject({warmupSteps:16,objectUpdates:2,iterationSteps:4});
   expect(b.present.mock.calls[0]).toEqual([present.mock.calls[0][0],present.mock.calls[0][2]]);
   expect(actual).toMatchObject({backend:'native',sourcePixelRenderer:{identity:'mock-native'},temporal:expected.temporal,density:{...expected.density,toneBackend:'native'},stats:{samples:expected.stats.samples,generated:expected.stats.generated}});
   const cost=b.estimateWork.mock.results.reduce((n,r)=>n+r.value,0);expect(cost).toBeGreaterThan(actual.stats.samples);
   await owner.generateAsync(s,{...c,time:.075});expect(b.step).toHaveBeenCalledTimes(3);expect(b.present).toHaveBeenCalledTimes(2);
   await owner.generateAsync(s,{...c,time:0});expect(b.reset).toHaveBeenCalledTimes(2);expect(record(...b.step.mock.calls.at(-1)!)).toEqual(trace[0]);
   await owner.generateAsync(s,{...c,width:19,time:0});expect(b.reset).toHaveBeenCalledTimes(3);expect(b.step.mock.calls.at(-1)![1]).toMatchObject({resetParticles:true,width:19});
  }finally{sync.reset();await owner.resetAsync();}
 });
 it('preserves ordered animated parameter updates and clear events without reseeding particles',async()=>{
  const s=parseLegacyScene(JSON.stringify({config_version:'1.0.0',name:'Animated cold Map',type:'MAP_ATTRACTOR',parameters:{a:0},equations:{x_next:'x+a',y_next:'y'},settings:{batch_size:8,burn_in_steps:3,iterations_per_frame:2},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.003}}}}]},{type:'wait',duration:1}]}),{sourceEntry:'runtime-config'}).scene;
  const c=context(s),b=backend(),owner=new IteratedDensitySession({asyncBackend:b}),sync=new IteratedDensitySession(),trace:ReturnType<typeof record>[]=[];
  vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation((j,o)=>{trace.push(record(j,o));return facts(j);});
  vi.spyOn(IteratedDensityGpu.prototype,'present').mockReturnValue({pixels:new Uint8ClampedArray(c.width*c.height*4),occupiedPixels:2,maxCount:4,toneBackend:'webgl2',warnings:[]});
  try{
   const expected=sync.generate(s,c),actual=await owner.generateAsync(s,c);expect(b.step.mock.calls.map(([j,o])=>record(j,o))).toEqual(trace);
   expect(actual.density?.inputPoints).toBe(expected.density?.inputPoints);
   const updates=b.step.mock.calls.at(-1)![0].iterationUpdates!;expect(updates).toHaveLength(2);expect(updates[0].kind==='map'&&updates[0].parameters.a).not.toBe(updates[1].kind==='map'&&updates[1].parameters.a);
   expect(b.step.mock.calls.map(([,o])=>o.resetParticles)).toEqual([true,false,false]);expect(b.step.mock.calls.every(([,o])=>o.clearInk)).toBe(true);
  }finally{sync.reset();await owner.resetAsync();}
 });
 it('admits cumulative native prefix work before submitting the over-budget frame',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});b.estimateWork.mockReturnValue(1_100_000_000);
  try{await expect(owner.generateAsync(s,context(s))).rejects.toThrow('20 亿');expect(b.step).toHaveBeenCalledOnce();expect(b.present).not.toHaveBeenCalled();expect(b.reset).toHaveBeenCalledTimes(2);expect(owner.diagnostics()).toMatchObject({frame:null,cleanupPending:false});}finally{await owner.resetAsync();}
 });
 it('honors delayed start and disabled recording without borrowing a live clock',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});s.settings.iteratedStartTime=1;s.settings.recordTrails=false;
  try{
   const blank=await owner.generateAsync(s,context(s));expect(blank).toMatchObject({backend:'cpu',temporal:{frames:0},stats:{samples:0}});expect(b.step).not.toHaveBeenCalled();expect(b.present).not.toHaveBeenCalled();
   const out=await owner.generateAsync(s,{...context(s),time:1});expect(out).toMatchObject({backend:'native',temporal:{frames:1},density:{inputPoints:0,accepted:0}});expect(b.step.mock.calls[0][0].config.record).toBe(false);expect(b.step.mock.calls[0][0].time).toBe(1);
  }finally{await owner.resetAsync();}
 });
 it('detaches the entire scene and viewport before the first asynchronous acknowledgement',async()=>{
  const s=scene(),c=context(s),b=backend(),gate=deferred<ReturnType<typeof facts>>(),owner=new IteratedDensitySession({asyncBackend:b});b.step.mockImplementationOnce(()=>gate.promise);
  const draw=owner.generateAsync(s,c);await vi.waitFor(()=>expect(b.step).toHaveBeenCalledOnce());const first=b.step.mock.calls[0][0];
  s.parameters.a=99;s.settings.iteratedFps=1;s.camera.zoom=99;Object.assign(c.sourceViewport!,{logicalWidth:999});
  gate.resolve(facts(first));try{const out=await draw;expect(out.temporal?.frames).toBe(3);expect(b.step.mock.calls.every(([j])=>j.field.kind==='map'&&j.field.parameters.a===.1)).toBe(true);expect(b.step.mock.calls.every(([,o])=>o.width===17)).toBe(true);}finally{await owner.resetAsync();}
 });
 it('waits for the exact step ACK before cancellation, never aborting the shared renderer',async()=>{
  const s=scene(),b=backend(),gate=deferred<ReturnType<typeof facts>>(),owner=new IteratedDensitySession({asyncBackend:b});b.step.mockImplementationOnce(()=>gate.promise);
  const draw=owner.generateAsync(s,context(s)),failure=expect(draw).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(b.step).toHaveBeenCalledOnce());
  const cleanup=owner.resetAsync();expect(b.reset).toHaveBeenCalledOnce();expect(b.step.mock.calls[0][1]).not.toHaveProperty('isCancelled');gate.resolve(facts(b.step.mock.calls[0][0]));await failure;await cleanup;
  expect(b.step).toHaveBeenCalledOnce();expect(b.present).not.toHaveBeenCalled();expect(b.cancel).not.toHaveBeenCalled();expect(owner.diagnostics()).toMatchObject({frame:null,retainedBytes:0,cleanupPending:false});
 });
 it('retains failed cleanup and refuses replacement until exact release succeeds',async()=>{
  const s=scene(),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});await owner.generateAsync(s,{...context(s),time:0});
  b.step.mockRejectedValueOnce(Error('unknown commit'));b.reset.mockRejectedValueOnce(Error('release unavailable'));
  await expect(owner.generateAsync(s,context(s))).rejects.toThrow('清理未完成');expect(owner.diagnostics()).toMatchObject({frame:0,cleanupPending:true});
  await expect(owner.generateAsync(s,context(s))).rejects.toThrow('等待清理');expect(b.step).toHaveBeenCalledTimes(2);await owner.resetAsync();expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('refuses legacy/custom source models before any native step',async()=>{
  const s=scene('symmetry'),b=backend(),owner=new IteratedDensitySession({asyncBackend:b});s.equations.glsl='void calculate_next(in vec3 p,out vec3 q,out float m){q=p;m=0.;}';
  try{await expect(owner.generateAsync(s,context(s))).rejects.toThrow('完整源 Map/Symmetry');expect(b.step).not.toHaveBeenCalled();}finally{await owner.resetAsync();}
 });
});
