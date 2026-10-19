import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceAttractorScene} from '../src/engine/sourceAttractorDocument';
import {SourceAttractorGpuReplaySession,generateSourceAttractorGpu,disposeSourceAttractorGpuRequests,replaySourceAttractorGpu} from '../src/engine/sourceAttractorGpuReplay';
import {SourceAttractorGpu,prepareSourceAttractorGpuWork} from '../src/engine/sourceAttractorGpu';
import {sceneAtTime} from '../src/engine/timeline';
import {parseScene,serializeScene} from '../src/engine/document';

function fixture(timeline:unknown[]=[{type:'animate',duration:0,actions:[{method:'track',args:[0]}]},{type:'wait',duration:1}]){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'GPU replay',equations:{dx:'1',dy:'0',dz:'0'},settings:{render_mode:'GPU',particle_count_gpu:2,sub_steps:3,time_step:1,scale_x:2,offset_x:1},initialization:{warmup_steps:100,bounds:{min_x:2,max_x:2,min_y:0,max_y:0,min_z:0,max_z:0}},timeline})).scene;
 scene.timeline.fps=4;const prepared=prepareSourceAttractorScene(scene);if(prepared.backend!=='gpu')throw Error('GPU expected');
 return{scene,options:{...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:0}};
}
describe('source GPU Attractor public replay ownership',()=>{
 it('tracks original transformed seeds without CPU warmup or reading evolved GPU positions',()=>{
  const {scene,options}=fixture();
  for(const time of [0,.25,1,2,.5]){
   const replay=replaySourceAttractorGpu({...options,time});
   expect(replay.frame.camera.center).toEqual([5,0,0]);
   expect(sceneAtTime(scene,time).evaluatedSourceCamera!.camera).toEqual(replay.frame.camera);
  }
  expect(replaySourceAttractorGpu({...options,time:2}).updates).toBe(replaySourceAttractorGpu({...options,time:1}).updates);
 });
 it('distinguishes an empty display-only queue from zero/negative duration dispatched updates',()=>{
  const empty=fixture([]).options;expect(replaySourceAttractorGpu(empty).updates).toBe(0);
  const options=fixture([{type:'wait',duration:0},{type:'wait',duration:-1},{type:'wait',duration:0}]).options;
  expect(replaySourceAttractorGpu(options).updates).toBe(1);
  expect(replaySourceAttractorGpu({...options,time:.25}).updates).toBe(2);
  expect(replaySourceAttractorGpu({...options,time:2}).updates).toBe(3);
 });
 it('ignores native GPU gradient args without parsing them and preserves imported raw source',()=>{
  const {scene,options}=fixture([{type:'animate',duration:0,actions:[{method:'gradientStart',args:{speed:'x'.repeat(65537)}},{method:'track',args:[0]}]}]);
  expect(scene.timeline.tracks[0].actions!.map(a=>a.method)).toEqual(['track']);
  expect(parseScene(serializeScene(scene)).provenance).toEqual(scene.provenance);
  expect(replaySourceAttractorGpu(options).frame.camera.center).toEqual([5,0,0]);
 });
 it('rejects impossible warmup before context allocation while retaining signed int overflow semantics',()=>{
  const {options}=fixture(),configuration=structuredClone(options.configuration);configuration.particleCountGPU=1;
  configuration.warmup={steps:2147483647,staggerMin:0,staggerMax:0};
  expect(()=>new SourceAttractorGpu({...options,configuration})).toThrow('预算');
  configuration.warmup.staggerMax=1;
  expect(prepareSourceAttractorGpuWork(configuration,options.shader.operations,0)).toMatchObject({warmup:0,passes:0,work:0});
  const owner=new SourceAttractorGpu({...options,configuration});expect(owner.diagnostics().contextOwned).toBe(false);owner.dispose();owner.dispose();
 });
 it('bounds copy-only draws as well as arithmetic and reports cancellation without a context',()=>{
  const {options}=fixture(),configuration={...options.configuration,stepsPerFrame:-1,warmup:{steps:0,staggerMin:0,staggerMax:0}};
  expect(()=>prepareSourceAttractorGpuWork(configuration,options.shader.operations,10001)).toThrow('预算');
  const owner=new SourceAttractorGpu({...options,configuration,isCancelled:()=>true});expect(()=>owner.initialize()).toThrow('取消');expect(owner.diagnostics().contextOwned).toBe(false);owner.dispose();
 });
});

// These doubles exercise ownership/scheduling only. Real shader pixels are
// checked separately by verify-source-attractor-gpu/public scripts.
describe('retained GPU replay resource generation',()=>{
 const viewport={logicalWidth:64,logicalHeight:48,referenceLogicalHeight:48,target:'offscreen' as const,projectionPass:'perspective' as const};
 const request=(time:number,width=64)=>({time,width,height:48,backgroundColor:0xff000000,viewport});
 function device(){
  const updates=new WeakMap<SourceAttractorGpu,number>(),original=SourceAttractorGpu.prototype.diagnostics;
  const advance=vi.spyOn(SourceAttractorGpu.prototype,'advance').mockImplementation(function(this:SourceAttractorGpu){updates.set(this,(updates.get(this)??0)+1);});
  vi.spyOn(SourceAttractorGpu.prototype,'diagnostics').mockImplementation(function(this:SourceAttractorGpu){return{...original.call(this),updatePasses:updates.get(this)??0};});
  vi.spyOn(SourceAttractorGpu.prototype,'render').mockImplementation(function(this:SourceAttractorGpu,r){return{width:r.width,height:r.height,pixels:new Uint8ClampedArray(r.width*r.height*4).fill(updates.get(this)??0)};});
  const dispose=vi.spyOn(SourceAttractorGpu.prototype,'dispose');
  return{advance,dispose};
 }
 afterEach(()=>{disposeSourceAttractorGpuRequests();vi.restoreAllMocks();});
 it('advances only missing updates, preserves same-frame/resize state, and rebuilds on reverse seek',()=>{
  const d=device(),{options}=fixture(),owner=new SourceAttractorGpuReplaySession(options);
  try{
   for(const time of [0,.25,.25,.75,1,2]){
    const out=owner.generate(request(time)),fresh=replaySourceAttractorGpu({...options,time});
    expect(out.sourceCameraFrame!.camera).toEqual(fresh.frame.camera);
    expect(owner.diagnostics().engine!.updatePasses).toBe(fresh.updates);
    expect(d.advance).toHaveBeenCalledTimes(fresh.updates);
   }
   expect(owner.diagnostics()).toMatchObject({constructions:1,trackingBytes:12});
   const calls=d.advance.mock.calls.length;owner.generate(request(2,96));expect(d.advance).toHaveBeenCalledTimes(calls);expect(d.dispose).not.toHaveBeenCalled();
   owner.generate(request(.25));expect(d.dispose).toHaveBeenCalledTimes(1);expect(owner.diagnostics().constructions).toBe(2);
   expect(owner.diagnostics().engine!.updatePasses).toBe(replaySourceAttractorGpu({...options,time:.25}).updates);
  }finally{owner.reset();}
 });
 it('keeps independent direct queries from retiring a healthy session and retires their own engine',()=>{
  const d=device(),{options}=fixture(),owner=new SourceAttractorGpuReplaySession(options);
  try{
   owner.generate(request(0));const live=d.advance.mock.instances[0];
   generateSourceAttractorGpu({...options,...request(.25)});
   expect(d.dispose).toHaveBeenCalledTimes(1);expect(d.dispose.mock.instances[0]).not.toBe(live);
   owner.generate(request(.5));expect(owner.diagnostics().constructions).toBe(1);
  }finally{owner.reset();}
 });
 it('retains failed disposal, blocks allocation, and makes an old cleanup ticket inert after recovery',()=>{
  const d=device(),{options}=fixture(),owner=new SourceAttractorGpuReplaySession(options);
  owner.generate(request(.5));const old=d.advance.mock.instances[0];
  let fail=true;d.dispose.mockImplementation(function(this:SourceAttractorGpu){if(fail)throw Error('delete failed');});
  let ticket:any;try{owner.generate(request(0));}catch(error){ticket=error;}
  expect(ticket?.cleanupPending).toBe(true);expect(owner.diagnostics().engine).toBeDefined();
  const count=d.advance.mock.calls.length;expect(()=>owner.generate(request(.75))).toThrow('cleanup');expect(d.advance).toHaveBeenCalledTimes(count);
  fail=false;owner.generate(request(.75));const current=d.advance.mock.instances.at(-1);expect(current).not.toBe(old);
  expect(ticket.cleanupPending).toBe(false);const disposed=d.dispose.mock.calls.length;ticket.retryCleanup();expect(d.dispose).toHaveBeenCalledTimes(disposed);
  owner.reset();
 });
 it('stores only unique bound ids and no seed vectors for an empty queue',()=>{
  device();const {options}=fixture([{type:'animate',duration:0,actions:[{method:'track',args:[1]},{method:'track',args:[0]},{method:'track',args:[1]},{method:'track',args:[3]}]}]);
  const owner=new SourceAttractorGpuReplaySession(options),empty=new SourceAttractorGpuReplaySession(fixture([]).options);
  try{owner.generate(request(0));expect(owner.diagnostics().trackingBytes).toBe(24);empty.generate(request(0));expect(empty.diagnostics()).toMatchObject({updates:0,trackingBytes:0});}finally{owner.reset();empty.reset();}
 });
 it('rejects cumulative copy-only pass overflow even when split across requests',()=>{
  const d=device(),{options}=fixture([{type:'wait',duration:20000}]);
  const owner=new SourceAttractorGpuReplaySession({...options,fps:1,configuration:{...options.configuration,stepsPerFrame:0,warmup:{steps:0,staggerMin:0,staggerMax:0}}});
  try{owner.generate(request(4999));owner.generate(request(9998));expect(d.advance.mock.calls.length).toBeLessThanOrEqual(10000);const count=d.advance.mock.calls.length;expect(()=>owner.generate(request(10001))).toThrow('预算');expect(d.advance).toHaveBeenCalledTimes(count);expect(d.dispose).toHaveBeenCalledTimes(1);}finally{owner.reset();}
 });
});
