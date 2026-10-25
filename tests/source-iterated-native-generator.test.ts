import {afterEach,describe,expect,it,vi} from 'vitest';
import type {IteratedFrameJob} from '../src/scenes/iteratedDensity';
import type {IteratedGpuOptions} from '../src/engine/iteratedDensityGpu';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest} from '../src/engine/generationProtocol';
import {Generator} from '../src/engine/client';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {editSourceSymmetryConfiguration} from '../src/engine/sourceSymmetryConfig';

// The real Generator and semantic Session run here. Only native execution is a
// deterministic recorder; no WebGL/CGL, shader execution or pixel-fidelity claim.
const recorder=vi.hoisted(()=>({instances:[] as Array<{disposed:number;retained:number;trace:unknown[]}>,gate:undefined as Promise<void>|undefined,entered:undefined as (()=>void)|undefined,disposeError:undefined as Error|undefined,stepFailure:undefined as (()=>void)|undefined}));
vi.mock('../src/engine/sourceIteratedNativeBackend',()=>({SourceIteratedNativeBackend:class {
 width=0;height=0;disposed=0;retained=0;trace:unknown[]=[];
 constructor(){recorder.instances.push(this);}
 async step(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'isCancelled'>){recorder.entered?.();await recorder.gate;this.trace.push({kind:'step',options,field:job.field});this.width=options.width;this.height=options.height;this.retained=1024;recorder.stepFailure?.();return{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:job.config.count*((job.iterationFrame?.warmupSteps??0)+(job.iterationFrame?.iterationSteps??0)),invalid:0,accepted:job.config.record?job.config.count:0,clipped:0,sampleInvalid:0};}
 async resizeAccumulation(width:number,height:number){this.width=width;this.height=height;this.trace.push({kind:'resize',width,height});}
 async present(){this.trace.push({kind:'present'});return{pixels:new Uint8ClampedArray(this.width*this.height*4),occupiedPixels:1,maxCount:1,toneBackend:'native' as const,warnings:[],sourcePixelRenderer:{backend:'native' as const,identity:'a'.repeat(64),generation:1,sequence:2,samples:0}};}
 validateAccumulationCapture(width:number,height:number,additionalBytes:number){this.trace.push({kind:'admit',width,height,additionalBytes});}
 diagnostics(){return{retainedBytes:this.retained};}
 async dispose(){this.disposed++;this.trace.push({kind:'dispose'});if(recorder.disposeError)throw recorder.disposeError;this.retained=0;}
}}));
class FakeWorker {
 static instances:FakeWorker[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:unknown;onerror:unknown;
 constructor(){FakeWorker.instances.push(this);}
 postMessage(value:GenerationRequest){this.messages.push(structuredClone(value));}
 terminate(){this.terminated=true;}
}
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Native app dispatch',type:'SYMMETRY_CHAOS',parameters:{alpha:2.5},settings:{batch_size:8,burn_in_steps:3,iterations_per_frame:1},timeline:[{type:'wait',duration:.1}]})).scene;
const input=(s=scene()):GenerationInput=>({time:0,width:16,height:12,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(s,16,12,'primary',12),symmetryLive:{sessionId:'native-preview',renderFps:30,replayRevision:0,clock:{paused:true}}});
function setup(){vi.stubEnv('VITE_SOURCE_RENDERER','native');vi.stubGlobal('Worker',FakeWorker);FakeWorker.instances=[];recorder.instances=[];recorder.gate=undefined;recorder.entered=undefined;recorder.disposeError=undefined;recorder.stepFailure=undefined;return new Generator();}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function cleanup(g:Generator){recorder.disposeError=undefined;recorder.stepFailure=undefined;g.dispose();await g.settledNativeCleanup();expect(recorder.instances.every(v=>v.retained===0)).toBe(true);}

describe('native source Symmetry application dispatch',()=>{
 it('uses the page clock and exact completed-frame capability for pause, hot parameters, navigation and PNG capture',async()=>{
  const g=setup(),s=scene(),c=input(s);try{
   const first=await g.generate(s,c);expect(first).toMatchObject({backend:'native',symmetryLive:{clockSource:'page-wall-clock',paused:true},sourcePixelRenderer:{backend:'native'}});expect(FakeWorker.instances).toHaveLength(0);
   await expect(g.captureSymmetryPaused({...first},{width:20,height:16})).rejects.toThrow('当前');
   const hot=editSourceSymmetryConfiguration(s,{...s,parameters:{...s.parameters,alpha:.4}},'parameters');await g.updateIteratedParameters(first,hot,[['alpha',.4]]);
   const moved=await g.navigateIteratedPaused(first,{kind:'wheel',count:1});expect(moved).toMatchObject({backend:'native',symmetryLive:{paused:true}});
   await expect(g.navigateIteratedPaused(first,{kind:'wheel',count:1})).rejects.toThrow('当前');
   const capture=await g.captureSymmetryPaused(moved,{width:20,height:16},3);expect(capture.capture).toMatchObject({width:60,height:48,sourcePausedImage:{baseSize:[20,16],scale:3}});expect(capture.preview).toMatchObject({width:16,height:12,backend:'native'});
   await g.setSymmetryPaused(capture.preview,false,1000);const next=await g.generate(hot,{...c,symmetryLive:{...c.symmetryLive!,clock:{paused:false,timestampMs:1100}}});expect(next).toMatchObject({symmetryLive:{paused:false,clockSource:'injected'}});
   expect(recorder.instances).toHaveLength(1);
  }finally{await cleanup(g);}
 });
 it('keeps recording cancellation tied to the owner, publishes contiguous frames, and restores the primary after orderly stop',async()=>{
  const g=setup(),s=scene(),c=input(s);try{
   const first=await g.generate(s,c),started=await g.beginSourceRecording(first,{width:16,height:12,simulationFps:30});expect(started.warmup).toMatchObject({backend:'native',iteratedRecording:{displayFrame:0,warmup:true}});expect(g.hasSourceRecording(started.handle)).toBe(true);
   g.cancel();expect(g.hasSourceRecording(started.handle)).toBe(true);
   const frame=await g.nextSourceRecordingFrame(started.handle,1);expect(frame).toMatchObject({backend:'native',iteratedRecording:{displayFrame:1,warmup:false}});
   await expect(g.nextSourceRecordingFrame(started.handle,1)).rejects.toMatchObject({recordingRetained:true});
   const stopped=await g.finishSourceRecording(started.handle,2000);expect(stopped.preview).toMatchObject({backend:'native',width:16,height:12});expect(g.hasSourceRecording(started.handle)).toBe(false);
   await g.setSymmetryPaused(stopped.preview,true);const captured=await g.captureSymmetryPaused(stopped.preview,{width:16,height:12});expect(captured.preview).toMatchObject({backend:'native'});
   expect(FakeWorker.instances).toHaveLength(0);
  }finally{await cleanup(g);}
 });
 it('keeps unsupported Map, custom kernels and cold Symmetry in the worker route under native policy',async()=>{
  for(const kind of ['map','custom','cold'] as const){
   const g=setup(),s=kind==='map'?parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map route',settings:{batch_size:8},equations:{x_next:'x',y_next:'y'}})).scene:scene(),c=input(s);
   if(kind==='map'){delete c.symmetryLive;c.mapLive={sessionId:'map-preview',renderFps:30,replayRevision:0,clock:{paused:true}};}
   if(kind==='custom')s.equations.glsl='void calculate_next(in vec3 p, out vec3 q, out float m){q=p;m=0.;}';
   if(kind==='cold')delete c.symmetryLive;
   const pending=g.generate(s,c),failure=pending.catch(e=>e);expect(FakeWorker.instances).toHaveLength(1);expect(FakeWorker.instances[0].messages[0].operation).toBe('generate');expect(recorder.instances).toHaveLength(0);g.cancel();expect((await failure).name).toBe('AbortError');await cleanup(g);
  }
 });
 it('releases native owners before returning to the worker and terminates that worker before native reacquisition',async()=>{
  const g=setup(),s=scene(),c=input(s);try{
   await g.generate(s,c);const cold={...c};delete cold.symmetryLive;const pending=g.generate(s,cold),failure=pending.catch(e=>e);
   await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(1));expect(recorder.instances[0].retained).toBe(0);g.cancel();await failure;
   expect(FakeWorker.instances[0].terminated).toBe(true);await g.generate(s,{...c,symmetryLive:{...c.symmetryLive!,sessionId:'replacement'}});expect(recorder.instances).toHaveLength(2);
  }finally{await cleanup(g);}
 });
 it('waits for an in-flight native ACK during hard cancellation and suppresses its stale output before replacement',async()=>{
  const g=setup(),s=scene(),c=input(s);let release!:()=>void,entered!:()=>void;recorder.gate=new Promise<void>(r=>release=r);const ready=new Promise<void>(r=>entered=r);recorder.entered=entered;
  try{const first=g.generate(s,c),failure=first.catch(e=>e);await ready;g.cancel();expect((await failure).name).toBe('AbortError');
   const next=g.generate(s,{...c,symmetryLive:{...c.symmetryLive!,sessionId:'replacement'}});expect(recorder.instances[0].disposed).toBe(0);recorder.gate=undefined;release();expect(await next).toMatchObject({backend:'native'});expect(recorder.instances[0].retained).toBe(0);expect(recorder.instances[0].trace.filter((v:any)=>v.kind==='present')).toHaveLength(0);expect(recorder.instances).toHaveLength(2);
  }finally{release();await cleanup(g);}
 });
 it('keeps the page clock after fixed reconstruction initializes a live incarnation',async()=>{
  const g=setup(),s=scene(),c=input(s);try{const result=await g.generate(s,{...c,symmetryLive:{...c.symmetryLive!,startAt:.01}});expect(result).toMatchObject({backend:'native',symmetryLive:{clockSource:'page-wall-clock'}});}finally{await cleanup(g);}
 });
 it('retains an unacknowledged recording warmup owner when its cleanup fails, without granting an unusable recording handle',async()=>{
  const g=setup(),s=scene(),c=input(s);try{
   const first=await g.generate(s,c);recorder.stepFailure=()=>{recorder.disposeError=Error('uncertain ink cleanup');throw Error('warmup acknowledgement lost');};
   await expect(g.beginSourceRecording(first,{width:16,height:12,simulationFps:30})).rejects.toMatchObject({recordingRetained:false,previewRetained:false});expect(recorder.instances).toHaveLength(2);expect(recorder.instances[1].retained).toBeGreaterThan(0);
   await expect(g.generate(s,c)).rejects.toThrow('清理失败');expect(recorder.instances).toHaveLength(2);g.dispose();await expect(g.settledNativeCleanup()).rejects.toThrow('清理失败');expect(recorder.instances[1].retained).toBeGreaterThan(0);
  }finally{await cleanup(g);}
 });
 it('disposes during a pending recording warmup only after its ACK, then releases the uncertain incarnation',async()=>{
  const g=setup(),s=scene(),c=input(s);let release!:()=>void,entered!:()=>void;
  try{const first=await g.generate(s,c);recorder.gate=new Promise<void>(r=>release=r);const ready=new Promise<void>(r=>entered=r);recorder.entered=entered;
   const start=g.beginSourceRecording(first,{width:16,height:12,simulationFps:30}),failure=start.catch(e=>e);await ready;g.dispose();expect(await failure).toMatchObject({recordingRetained:false});expect(recorder.instances[1].disposed).toBe(0);
   recorder.gate=undefined;release();await g.settledNativeCleanup();expect(recorder.instances.every(v=>v.retained===0)).toBe(true);expect(recorder.instances[1].trace.filter((v:any)=>v.kind==='present')).toHaveLength(0);
  }finally{release?.();await cleanup(g);}
 });
 it('retains cleanup failures and blocks replacement until the same owner can be released',async()=>{
  const g=setup(),s=scene(),c=input(s);try{await g.generate(s,c);recorder.disposeError=Error('retained ink');g.cancel();await expect(g.settledNativeCleanup()).rejects.toThrow('清理失败');expect(recorder.instances[0].retained).toBeGreaterThan(0);
   await expect(g.generate(s,{...c,symmetryLive:{...c.symmetryLive!,sessionId:'replacement'}})).rejects.toThrow();expect(recorder.instances).toHaveLength(1);recorder.disposeError=undefined;await g.settledNativeCleanup();expect(await g.generate(s,c)).toMatchObject({backend:'native'});
  }finally{await cleanup(g);}
 });
});
