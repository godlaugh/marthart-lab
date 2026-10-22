import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {Generator} from '../src/engine/client';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SceneOutput,GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import native from './fixtures/source-surface-scene/recording-native.json';
const draw=vi.hoisted(()=>({created:0,disposed:0,frames:[] as number[],fail:false,failDispose:false}));
// Real client/worker/numerical ownership and real buffer transfer. Drawing is
// substituted here; the browser verifier exercises the real GL renderer.
vi.mock('../src/engine/renderSurfaceRecording',()=>({SurfaceRecordingRenderer:class{
 constructor(private scene:unknown,private size:{width:number;height:number}){draw.created++;}
 render(output:Extract<SceneOutput,{type:'geometry'}>,cancelled:()=>boolean){if(cancelled())throw Error('cancelled');if(draw.fail){draw.fail=false;throw Error('draw failed');}draw.frames.push(output.surfaceLive!.frame.frameIndex);return{type:'raster',...this.size,pixels:new Uint8ClampedArray(this.size.width*this.size.height*4),stats:output.stats,surfaceLive:output.surfaceLive,sourceCameraFrame:output.sourceCameraFrame};}
 dispose(){if(draw.failDispose){draw.failDispose=false;throw Error('dispose failed');}draw.disposed++;}
}}));
let worker:{onmessage?:(e:MessageEvent<GenerationRequest>)=>void;postMessage:(r:GenerationResponse,o:{transfer:Transferable[]})=>void};
let port:Transport,fail:{operation:string;detached?:boolean}|undefined,corrupt:((r:GenerationResponse)=>void)|undefined;
class Transport {
 onmessage:((e:{data:GenerationResponse})=>void)|null=null;sent:GenerationRequest[]=[];terminated=false;
 constructor(){port=this;}
 postMessage(data:GenerationRequest){this.sent.push(structuredClone(data));worker.onmessage!({data:structuredClone(data)} as MessageEvent<GenerationRequest>);}
 terminate(){this.terminated=true;}
}
beforeEach(async()=>{
 vi.resetModules();Object.assign(draw,{created:0,disposed:0,frames:[],fail:false,failDispose:false});fail=undefined;corrupt=undefined;
 worker={postMessage:(data,options)=>{const fault=fail?.operation===data.operation&&!('error' in data)?fail:undefined;if(fault){fail=undefined;if(!fault.detached)throw Error('publication failed');}const message=structuredClone(data,{transfer:options.transfer});if(fault)throw Error('publication failed after transfer');corrupt?.(message);port.onmessage?.({data:message});}};
 vi.stubGlobal('self',worker);vi.stubGlobal('Worker',Transport);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
async function setup(name='animated-mesh'){
 const trace=native.actual.cases.find(c=>c.input.name===name)!,scene=parseProjectFile(JSON.stringify(trace.input.project)).scene;
 const context:GenerationInput={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'client-surface',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29}};
 const generator=new Generator(),output=await generator.generate(scene,context);return{generator,output,scene,context,trace,options:{width:17,height:13,simulationFps:4,actualFrameRate:37}};
}
describe('Surface retained recording client',()=>{
 it('uses one renderer, delivers observed frame facts, and restores a usable geometry preview',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);expect(start.warmup).toMatchObject({type:'raster',width:51,height:39,surfaceLive:{recording:{warmup:true,actualFrameRate:37}}});
  for(let i=1;i<start.clock.updates;i++){const out=await f.generator.nextSourceRecordingFrame(start.handle,i,f.trace.input.steps[i].actualFrameRate);expect(out.surfaceLive!.frame.sceneTime).toBe(f.trace.frames[i].state.sceneTime);}
  expect(draw.created).toBe(1);expect(draw.frames).toEqual([0,1,2,3,4]);
  const stop=await f.generator.finishSourceRecording(start.handle);expect(stop.preview.type).toBe('geometry');expect(draw.disposed).toBe(1);
  await f.generator.setSurfacePaused(stop.preview,true);const current=await f.generator.currentSurface(stop.preview);expect(current.surfaceLive!.frame).toEqual(stop.preview.surfaceLive!.frame);f.generator.dispose();
 });
 it('rejects stale images and invalid observations without revoking the completed primary',async()=>{
  const f=await setup();await expect(f.generator.beginSourceRecording({...f.output},f.options)).rejects.toThrow('主预览');
  await expect(f.generator.beginSourceRecording(f.output,{...f.options,actualFrameRate:NaN})).rejects.toMatchObject({previewRetained:true});
  const start=await f.generator.beginSourceRecording(f.output,f.options);await expect(f.generator.nextSourceRecordingFrame(start.handle,1)).rejects.toThrow();await expect(f.generator.nextSourceRecordingFrame({...start.handle},1,24)).rejects.toThrow('身份');await f.generator.finishSourceRecording(start.handle);f.generator.dispose();
 });
 it('repaints a failed client frame without another worker update',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);draw.fail=true;
  await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toMatchObject({recordingRetained:true});
  const sent=port.sent.length;await expect(f.generator.nextSourceRecordingFrame(start.handle,1,12)).rejects.toThrow('改变');
  const retry=await f.generator.nextSourceRecordingFrame(start.handle,1,24);expect(port.sent).toHaveLength(sent);expect(retry.surfaceLive!.frame.frameIndex).toBe(1);expect(draw.created).toBe(1);
  await f.generator.finishSourceRecording(start.handle);f.generator.dispose();
 });
 it('stops a warmup whose local drawing failed',async()=>{
  const f=await setup();draw.fail=true;const failure=await f.generator.beginSourceRecording(f.output,f.options).catch(e=>e);expect(failure).toMatchObject({recordingRetained:true});
  await expect(f.generator.nextSourceRecordingFrame(failure.handle,1,24)).rejects.toThrow('warmup');const stop=await f.generator.finishSourceRecording(failure.handle);expect(stop.preview.surfaceLive!.frame.frameIndex).toBe(0);expect(draw.disposed).toBe(1);f.generator.dispose();
 });
 it.each([false,true])('recovers stop after warmup publication failure (detached=%s)',async detached=>{
  const f=await setup();fail={operation:'source-recording-begin',detached};const failure=await f.generator.beginSourceRecording(f.output,f.options).catch(e=>e);expect(failure.recordingRetained).toBe(true);
  const stop=await f.generator.finishSourceRecording(failure.handle);expect(stop.preview.surfaceLive!.frame.frameIndex).toBe(0);expect(draw.created).toBe(0);f.generator.dispose();
 });
 it.each([false,true])('retains frame/stop publication failures (detached=%s)',async detached=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);fail={operation:'source-recording-frame',detached};await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toMatchObject({recordingRetained:true});
  if(!detached)await f.generator.nextSourceRecordingFrame(start.handle,1,24);else await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toThrow('传输状态未知');
  fail={operation:'source-recording-finish',detached};await expect(f.generator.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:true});
  const stop=await f.generator.finishSourceRecording(start.handle);expect(stop.preview.surfaceLive!.frame.frameIndex).toBe(1);expect(draw.disposed).toBe(1);f.generator.dispose();
 });
 it('retains renderer and runtime after cleanup failure and retries before stopping the worker',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);draw.failDispose=true;const sent=port.sent.length;
  await expect(f.generator.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:true});expect(port.sent).toHaveLength(sent);expect(f.generator.hasSourceRecording(start.handle)).toBe(true);
  await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toThrow();await f.generator.finishSourceRecording(start.handle);expect(draw.disposed).toBe(1);f.generator.dispose();
 });
 it('does not create a late renderer or publish after disposal during module loading',async()=>{
  const f=await setup(),task=f.generator.beginSourceRecording(f.output,f.options);const caught=task.catch(e=>e);f.generator.dispose();expect(await caught).toMatchObject({recordingRetained:false});await Promise.resolve();expect(draw.created).toBe(0);expect(port.terminated).toBe(true);
 });
 it('passes per-frame observations through the queue, preserving deferred draft and applying backpressure',async()=>{
  const f=await setup(),callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()},queue=new GenerationQueue(f.generator,callbacks);
  queue.request(f.scene,f.context);await vi.waitFor(()=>expect(callbacks.output).toHaveBeenCalled());const output=callbacks.output.mock.calls.at(-1)![0] as SceneOutput;
  await expect(queue.recordSource(output,f.options,{frame:vi.fn()})).rejects.toThrow('实际帧率');
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let index=1;
  const task=queue.recordSource(output,f.options,{actualFrameRate:()=>f.trace.input.steps[index++].actualFrameRate,frame:async(_frame,i)=>{if(i===0)await gate;}});
  await vi.waitFor(()=>expect(draw.frames).toEqual([0,1]));
  const draft=structuredClone(f.scene);draft.name='deferred draft';draft.equations.x='(';queue.request(draft,f.context);await Promise.resolve();expect(draw.frames).toEqual([0,1]);release();await task;
  await vi.waitFor(()=>expect(callbacks.output.mock.calls.at(-1)![2]).toBe(draft));
  expect(callbacks.recordingStopped.mock.calls[0][0].scene).toBe(draft);expect(callbacks.recordingStopped.mock.calls[0][0].context.surfaceLive.clock.paused).toBe(false);
  expect(port.sent.filter(r=>r.operation==='source-recording-frame').map(r=>r.operation==='source-recording-frame'&&r.actualFrameRate)).toEqual([24,12,1,0]);expect(callbacks.error).not.toHaveBeenCalled();queue.dispose();
 });
 it('finishes and releases Surface resources after queue cancellation during a consumer upload',async()=>{
  const f=await setup(),callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(f.generator,callbacks);
  queue.request(f.scene,f.context);await vi.waitFor(()=>expect(callbacks.output).toHaveBeenCalled());
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),abort=new AbortController();
  const task=queue.recordSource(callbacks.output.mock.calls.at(-1)![0],f.options,{actualFrameRate:()=>24,frame:()=>gate},abort.signal),caught=task.catch(e=>e);
  await vi.waitFor(()=>expect(draw.frames).toEqual([0,1]));abort.abort();expect(draw.disposed).toBe(0);release();expect((await caught).name).toBe('AbortError');expect(draw.disposed).toBe(1);expect(port.terminated).toBe(false);queue.dispose();
 });
 it('normalizes retry observations once and preserves signed zero warmup',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,{...f.options,actualFrameRate:-0});expect(Object.is(start.warmup.surfaceLive!.recording!.actualFrameRate,-0)).toBe(true);
  fail={operation:'source-recording-frame'};await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24.00000001)).rejects.toMatchObject({recordingRetained:true});
  const frame=await f.generator.nextSourceRecordingFrame(start.handle,1,24);expect(frame.surfaceLive!.recording!.actualFrameRate).toBe(24);await f.generator.finishSourceRecording(start.handle);f.generator.dispose();
 });
 it('rejects impossible clock advancement after an unconfirmed transferred frame',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);fail={operation:'source-recording-frame',detached:true};await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toMatchObject({recordingRetained:true});
  corrupt=r=>{if(r.operation==='source-recording-finish'&&!('error' in r)){const live=r.result.preview.surfaceLive!;r.result.preview.surfaceLive={...live,frame:{...live.frame,sceneTime:live.frame.sceneTime+1}};r.result.context.time+=1;}};
  await expect(f.generator.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:false});expect(port.terminated).toBe(true);f.generator.dispose();
 });
 const mutations={
  camera:(r:any)=>{r.result.warmup.sourceCameraFrame.camera.phi+=.2;},
  ordinal:(r:any)=>{r.result.warmup.surfaceLive.recording.displayFrame++;},
  rate:(r:any)=>{r.result.warmup.surfaceLive.recording.actualFrameRate=4;},
  simulation:(r:any)=>{r.result.clock.simulationFps=60;},
  target:(r:any)=>{r.result.warmup.sourceCameraFrame.viewport.logicalHeight++;},
  construction:(r:any)=>{r.result.warmup.surfaceLive.constructions++;},
  scene:(r:any)=>{r.result.scene.id='foreign';},
 };
 it.each(Object.entries(mutations))('rejects malformed %s before drawing or granting control',async(_name,mutate)=>{
  const f=await setup();corrupt=r=>{if(r.operation==='source-recording-begin'&&!('error' in r))mutate(r);};await expect(f.generator.beginSourceRecording(f.output,f.options)).rejects.toMatchObject({recordingRetained:false});expect(draw.created).toBe(0);expect(port.terminated).toBe(true);f.generator.dispose();
 });
});
