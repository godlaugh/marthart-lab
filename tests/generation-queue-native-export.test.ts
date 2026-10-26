import {describe,expect,it,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {SourceNativeExportPreview} from '../src/engine/sourceNativeExportPreview';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceAttractorSession} from '../src/scenes/sourceAttractor';
import {sourceAttractorGpuLayout,type SourceAttractorGpuAsyncFactory} from '../src/engine/sourceAttractorGpuPrepared';
import type {GenerationInput,SceneOutput} from '../src/types';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Native export handoff',settings:{render_mode:'GPU',particle_count_gpu:2000000,sub_steps:1},equations:{dx:'1',dy:'0',dz:'0'},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},timeline:[{type:'wait',duration:5}]})).scene;
const context:GenerationInput={time:2.5,width:1024,height:1024,quality:'export',sourcePointPixelDensity:2,sourceViewport:{logicalWidth:512,logicalHeight:512,referenceLogicalHeight:512,target:'primary',projectionPass:'perspective'}};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray([31,44,55,255]),stats:{samples:1,generated:1,invalid:0,elapsedMs:0}};
// Real scheduler/export owner with controlled native ACKs; no GPU/2M allocation.
describe('Native preview lends resources without losing the presented frame or clock',()=>{
 it.each(['cpu','gpu'] as const)('%s completion binds exact requested time and preserves the actual discrete source time',async backend=>{
  const document=scene();document.attractorSource!.configuration.nativeBackend=backend;document.attractorSource!.configuration.particleCountCPU=2;document.attractorSource!.configuration.particleCountGPU=2;document.timeline.fps=30;
  const asyncBackend:SourceAttractorGpuAsyncFactory=options=>{
   const layout=sourceAttractorGpuLayout(options.configuration.particleCountGPU);let updates=0;
   return{layout,async initialize(){},async advance(){updates++;},async render(display){return{width:display.width,height:display.height,pixels:new Uint8ClampedArray(display.width*display.height*4)};},async dispose(){},diagnostics(){return{contextOwned:true,handles:1,initialized:true,disposed:false,failed:false,texSize:layout.size,particleCount:layout.count,updatePasses:updates,warmupPasses:0,rendered:0,nodeWork:0,readbackBytes:0,estimatedBytes:layout.bytes};}};
  };
  const session=new SourceAttractorSession(backend==='gpu'?{asyncBackend}:{}),callback=vi.fn(),port={generate:async(s:typeof document,c:GenerationInput)=>backend==='cpu'?session.generate(s,c):session.generateAsync(s,c),cancel(){},dispose(){},settledNativeCleanup:()=>session.resetAsync()},queue=new GenerationQueue(port,{output:callback,error:vi.fn(),busy:vi.fn()});
  try{
   for(const requested of [.0333333333333333,.045]){
    const input={...context,time:requested,width:2,height:2};queue.request(document,input);await vi.waitFor(()=>expect(callback).toHaveBeenCalledWith(expect.anything(),requested,document));
    const actual=callback.mock.calls.at(-1)![0] as SceneOutput;expect(actual.sourceCameraFrame!.time).toBe(1/30);expect(actual.temporal!.time).toBe(1/30);expect(actual.sourceCameraFrame!.time).not.toBe(requested);
   }
  }finally{queue.dispose();await session.resetAsync();}
 });
 it('waits for release, preserves delivered pixels, and replays exactly the same request after export',async()=>{
  const ack=deferred<void>(),document=scene(),inputs:GenerationInput[]=[],seen:SceneOutput[]=[],port={generate:vi.fn(async(_scene:unknown,input:GenerationInput)=>{inputs.push(input);return output;}),cancel:vi.fn(),dispose:vi.fn(),settledNativeCleanup:vi.fn(()=>ack.promise)};
  const queue=new GenerationQueue(port,{output:o=>seen.push(o),error:vi.fn(),busy:vi.fn()}),lease=new SourceNativeExportPreview(),identity=[document,context];
  queue.request(document,context);await flush();port.cancel.mockClear();lease.defer(identity);lease.open(identity,{releasePreview:()=>queue.releaseNativePreview()});
  const preparing=lease.preparePresented();await flush();expect(port.cancel).toHaveBeenCalledTimes(1);expect(lease.ready).toBe(false);expect(seen).toEqual([output]);expect(seen[0]).toBe(output);expect(port.dispose).not.toHaveBeenCalled();
  ack.resolve();await preparing;expect(lease.ready).toBe(true);expect(port.generate).toHaveBeenCalledTimes(1);
  const exportCleanup=deferred<void>(),closing=lease.closeAfterCleanup(()=>exportCleanup.promise);await flush();expect(lease.active).toBe(true);expect(port.generate).toHaveBeenCalledTimes(1);
  exportCleanup.resolve();expect(await closing).toBe(true);expect(lease.defer(identity)).toBe(false);queue.request(document,context);await flush();expect(inputs).toEqual([context,context]);expect(seen).toEqual([output,output]);queue.dispose();await flush();
 });
 it('does not lend a still running or delayed preview',async()=>{
  const result=deferred<SceneOutput>(),port={generate:vi.fn(()=>result.promise),cancel:vi.fn(),dispose:vi.fn(),settledNativeCleanup:vi.fn(async()=>{})};
  const queue=new GenerationQueue(port,{output:vi.fn(),error:vi.fn(),busy:vi.fn()}),document=scene();queue.request(document,context);port.cancel.mockClear();
  await expect(queue.releaseNativePreview()).rejects.toThrow('尚未完成');expect(port.cancel).not.toHaveBeenCalled();expect(port.settledNativeCleanup).not.toHaveBeenCalled();
  result.resolve(output);await flush();await queue.releaseNativePreview();expect(port.settledNativeCleanup).toHaveBeenCalledTimes(1);queue.dispose();await flush();
  const delayed=new GenerationQueue(port,{output:vi.fn(),error:vi.fn(),busy:vi.fn()});delayed.request(document,context,1000);await expect(delayed.releaseNativePreview()).rejects.toThrow('尚未完成');delayed.dispose();await flush();
 });
 it('failed cleanup preserves the reusable generator for an explicit release retry',async()=>{
  const failure=Error('owned native release failed'),port={generate:vi.fn(async()=>output),cancel:vi.fn(),dispose:vi.fn(),settledNativeCleanup:vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)};
  const queue=new GenerationQueue(port,{output:vi.fn(),error:vi.fn(),busy:vi.fn()}),document=scene();queue.request(document,context);await flush();
  await expect(queue.releaseNativePreview()).rejects.toBe(failure);expect(port.dispose).not.toHaveBeenCalled();await queue.releaseNativePreview();expect(port.settledNativeCleanup).toHaveBeenCalledTimes(2);queue.request(document,context);await flush();expect(port.generate).toHaveBeenCalledTimes(2);queue.dispose();await flush();
 });
});
