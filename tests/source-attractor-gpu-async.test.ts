import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceAttractorScene} from '../src/engine/sourceAttractorDocument';
import {SourceAttractorGpuReplaySession,replaySourceAttractorGpu} from '../src/engine/sourceAttractorGpuReplay';
import {SourceAttractorSession} from '../src/scenes/sourceAttractor';
import {sourceAttractorGpuLayout,type SourceAttractorGpuAsyncBackend,type SourceAttractorGpuOptions,type SourceAttractorGpuRaster} from '../src/engine/sourceAttractorGpuPrepared';
const fixture=()=>{const scene=parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'Async GPU',equations:{dx:'1',dy:'0',dz:'0'},settings:{render_mode:'GPU',particle_count_gpu:2,sub_steps:3,time_step:1},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},timeline:[{type:'wait',duration:1}]})).scene;scene.timeline.fps=4;const prepared=prepareSourceAttractorScene(scene);if(prepared.backend!=='gpu')throw Error('gpu');return{scene,options:{...prepared,tracks:scene.timeline.tracks,fps:4,time:0}};};
const viewport={logicalWidth:64,logicalHeight:48,referenceLogicalHeight:48,target:'offscreen' as const,projectionPass:'perspective' as const};
const request=(time:number,width=64)=>({time,width,height:48,backgroundColor:0xff000000,viewport:{...viewport}});
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function until(check:()=>boolean){for(let i=0;i<100&&!check();i++)await Promise.resolve();expect(check()).toBe(true);}
function device(){
 const trace:string[]=[],owners:SourceAttractorGpuAsyncBackend[]=[],state:{gate?:ReturnType<typeof deferred<void>>;failDispose:boolean;disposals:number}={failDispose:false,disposals:0};
 const factory=(options:SourceAttractorGpuOptions):SourceAttractorGpuAsyncBackend=>{
  const id=owners.length,layout=sourceAttractorGpuLayout(options.configuration.particleCountGPU);let updates=0,rendered=0,disposed=false;trace.push(`create${id}`);
  const owner:SourceAttractorGpuAsyncBackend={layout,async initialize(){},async advance(){trace.push(`advance${id}`);updates++;},async render(r){trace.push(`render${id}:${r.width}`);await state.gate?.promise;rendered++;trace.push(`ack${id}`);return{width:r.width,height:r.height,pixels:new Uint8ClampedArray(r.width*r.height*4).fill(updates),sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64),generation:id+1,sequence:rendered,samples:0}};},async dispose(){trace.push(`dispose${id}`);state.disposals++;if(state.failDispose)throw Error('release ACK failed');disposed=true;},diagnostics(){return{contextOwned:!disposed,handles:disposed?0:1,initialized:true,disposed,failed:false,texSize:layout.size,particleCount:layout.count,updatePasses:updates,warmupPasses:0,rendered,nodeWork:updates,readbackBytes:0,estimatedBytes:disposed?0:layout.bytes};}};
  owners.push(owner);return owner;
 };return{factory,trace,owners,state};
}
describe('source GPU Attractor shared asynchronous replay',()=>{
 it('uses the existing queue for skip/resize/repeat/reverse and publishes native pixels only after ACK',async()=>{
  const d=device(),{options}=fixture(),owner=new SourceAttractorGpuReplaySession(options,{asyncBackend:d.factory});
  try{for(const time of [0,.25,.25,.75,1,2]){const out=await owner.generateAsync(request(time)),expected=replaySourceAttractorGpu({...options,time});expect(out.sourceCameraFrame!.camera).toEqual(expected.frame.camera);expect(owner.diagnostics().engine!.updatePasses).toBe(expected.updates);expect(out.backend).toBe('native');}
   const advances=d.trace.filter(x=>x.startsWith('advance')).length;await owner.generateAsync(request(2,96));expect(d.trace.filter(x=>x.startsWith('advance'))).toHaveLength(advances);expect(d.owners).toHaveLength(1);
   await owner.generateAsync(request(.25));expect(d.trace.indexOf('dispose0')).toBeLessThan(d.trace.indexOf('create1'));expect(d.owners).toHaveLength(2);
  }finally{await owner.resetAsync();}
 });
 it('waits for an in-flight ACK before cancellation cleanup and never publishes its revoked output',async()=>{
  const d=device(),owner=new SourceAttractorGpuReplaySession(fixture().options,{asyncBackend:d.factory});d.state.gate=deferred<void>();
  const pending=owner.generateAsync(request(0)),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});await until(()=>d.trace.includes('render0:64'));
  expect(()=>owner.generateAsync(request(.25))).toThrow('正在进行');expect(()=>owner.reset()).toThrow('resetAsync');const reset=owner.resetAsync();expect(d.state.disposals).toBe(0);
  d.state.gate.resolve();await rejected;await reset;expect(d.trace.indexOf('ack0')).toBeLessThan(d.trace.indexOf('dispose0'));expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('retains a failed reverse release and blocks subsequent advances until explicit cleanup succeeds',async()=>{
  const d=device(),owner=new SourceAttractorGpuReplaySession(fixture().options,{asyncBackend:d.factory});await owner.generateAsync(request(.5));d.state.failDispose=true;
  await expect(owner.generateAsync(request(0))).rejects.toThrow('release ACK failed');expect(d.state.disposals).toBe(1);expect(owner.diagnostics()).toMatchObject({cleanupPending:true});expect(d.owners).toHaveLength(1);
  expect(()=>owner.generateAsync(request(.75))).toThrow('release ACK failed');expect(d.state.disposals).toBe(1);await expect(owner.resetAsync()).rejects.toThrow('release ACK failed');expect(d.state.disposals).toBe(2);
  d.state.failDispose=false;await owner.resetAsync();await owner.generateAsync(request(0));expect(d.owners).toHaveLength(2);await owner.resetAsync();
 });
 it('captures request dimensions before await and rejects synchronous misuse of an async backend',async()=>{
  const d=device(),owner=new SourceAttractorGpuReplaySession(fixture().options,{asyncBackend:d.factory}),r=request(0);d.state.gate=deferred<void>();
  expect(()=>owner.generate(r)).toThrow('generateAsync');const pending=owner.generateAsync(r);r.width=96;r.time=.5;r.viewport.logicalWidth=96;await until(()=>d.trace.includes('render0:64'));d.state.gate.resolve();const out=await pending;expect(out.width).toBe(64);expect(out.sourceCameraFrame!.viewport.logicalWidth).toBe(64);await owner.resetAsync();
 });
 it('admits native 2M plus 1024-square using backend representations while retaining the WebGL joint limit',async()=>{
  const d=device(),{options}=fixture();options.configuration.particleCountGPU=2_000_000;options.configuration.warmup={steps:0,staggerMin:0,staggerMax:0};options.tracks=[];
  const r={...request(0,1024),height:1024,viewport:{...viewport,logicalWidth:1024,logicalHeight:1024,referenceLogicalHeight:1024}};
  const native=new SourceAttractorGpuReplaySession(options,{asyncBackend:d.factory}),webgl=new SourceAttractorGpuReplaySession(options);
  try{expect(()=>webgl.generate(r)).toThrow('预算');const out=await native.generateAsync(r);expect(out).toMatchObject({width:1024,height:1024,backend:'native'});expect(d.owners).toHaveLength(1);}finally{webgl.reset();await native.resetAsync();}
 });
 it('keeps source Session formula/density facts paired and does not rebuild motion for labels or dimensions',async()=>{
  const {scene}=fixture(),d=device(),session=new SourceAttractorSession({asyncBackend:d.factory}),c={...request(0),quality:'preview' as const,sourceViewport:{...viewport},sourcePointPixelDensity:2};
  scene.formulas!.main.visible=true;scene.formulas!.main.latex='x';d.state.gate=deferred<void>();const pending=session.generateAsync(scene,c);scene.formulas!.main.latex='y';await until(()=>d.trace.includes('render0:64'));d.state.gate.resolve();const out=await pending;
  expect(out.formulaPresentation!.labels[0].latex).toBe('x');expect(out).toHaveProperty('sourceAttractorPixelDensity',2);const next=await session.generateAsync(scene,{...c,width:96});expect(next.formulaPresentation!.labels[0].latex).toBe('y');expect(d.owners).toHaveLength(1);await session.resetAsync();
 });
});
