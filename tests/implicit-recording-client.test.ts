import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {implicitCameraFrame} from '../src/engine/sourceImplicitResponse';
import {Generator} from '../src/engine/client';
import {GenerationQueue} from '../src/engine/generationQueue';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SceneOutput,GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
const draw=vi.hoisted(()=>({created:0,disposed:0,fail:false,frames:[] as number[],gate:undefined as Promise<void>|undefined}));
// Numerical production Worker and real transfers; browser verification covers native drawing.
vi.mock('../src/engine/renderGeometryRecording',()=>({GeometryRecordingRenderer:class{
 constructor(private scene:unknown,private size:{width:number;height:number}){draw.created++;}
 async render(output:Extract<SceneOutput,{type:'geometry'}>,cancelled:()=>boolean){draw.frames.push(output.implicitRecording!.displayFrame);await draw.gate;if(cancelled())throw Error('cancelled');if(draw.fail){draw.fail=false;throw Error('draw failed');}return{type:'raster',width:this.size.width,height:this.size.height,pixels:new Uint8ClampedArray(this.size.width*this.size.height*4),stats:output.stats,implicitRecording:output.implicitRecording,sourceImplicitParameters:output.sourceImplicitParameters,sourceCameraFrame:output.sourceCameraFrame,formulaPresentation:output.formulaPresentation};}
 dispose(){draw.disposed++;}
}}));
let worker:{onmessage?:(e:MessageEvent<GenerationRequest>)=>void;postMessage:(r:GenerationResponse,o:{transfer:Transferable[]})=>void},port:Transport,corrupt:((r:GenerationResponse)=>void)|undefined;
class Transport{
 onmessage:((e:{data:GenerationResponse})=>void)|null=null;sent:GenerationRequest[]=[];terminated=false;
 constructor(){port=this;}
 postMessage(data:GenerationRequest){this.sent.push(structuredClone(data));worker.onmessage!({data:structuredClone(data)} as MessageEvent<GenerationRequest>);}
 terminate(){this.terminated=true;}
}
beforeEach(async()=>{vi.resetModules();Object.assign(draw,{created:0,disposed:0,fail:false,frames:[],gate:undefined});corrupt=undefined;worker={postMessage:(data,options)=>{const message=structuredClone(data,{transfer:options.transfer});corrupt?.(message);port.onmessage?.({data:message});}};vi.stubGlobal('self',worker);vi.stubGlobal('Worker',Transport);await import('../src/engine/generate.worker');});
afterEach(()=>vi.unstubAllGlobals());
async function setup(name='fps4-varying'){
 const ref=native.cases.find(c=>c.name===name)!,raw=structuredClone(ref.input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(raw)).scene,context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
 const generator=new Generator(),output=await generator.generate(scene,context);return{generator,output,scene,context,ref,options:{width:128,height:96,simulationFps:ref.input.simulationFps,actualFrameRate:37}};
}
describe('Implicit public recording client',()=>{
 for(const name of ['fps4-varying','empty-queue'])it('delivers original ordinals and physical dimensions, then restores and records again: '+name,async()=>{
  const f=await setup(name),start=await f.generator.beginSourceRecording(f.output,f.options);
  expect(start.scene).toEqual(sourcePaletteRuntimeScene(f.scene));expect(start.warmup).toMatchObject({width:384,height:288,implicitRecording:{displayFrame:0,warmup:true}});
  if(start.clock.completionReason!=='animation-queue')throw Error('clock');expect(start.clock.updates).toBe(f.ref.frames.length);
  for(let i=1;i<start.clock.updates;i++){const out=await f.generator.nextSourceRecordingFrame(start.handle,i,f.ref.input.steps[i].actualFrameRate);expect(out.sourceCameraFrame).toMatchObject({sceneTime:f.ref.frames[i].sceneTime,viewport:{logicalWidth:384,logicalHeight:288}});}
  const stop=await f.generator.finishSourceRecording(start.handle);expect(stop.preview.type).toBe('geometry');expect(stop.context.time).toBe(f.ref.frames.at(-1)!.sceneTime);expect(stop.scene).toEqual(sourcePaletteRuntimeScene(f.scene));expect(draw.created).toBe(1);expect(draw.disposed).toBe(1);
  const again=await f.generator.beginSourceRecording(stop.preview,f.options);expect(again.warmup.implicitRecording?.displayFrame).toBe(0);await f.generator.finishSourceRecording(again.handle);f.generator.dispose();
 });
 it('retries client drawing without another numerical update and rejects changed observation',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);draw.fail=true;
  await expect(f.generator.nextSourceRecordingFrame(start.handle,1,12)).rejects.toMatchObject({recordingRetained:true});const count=port.sent.length;
  await expect(f.generator.nextSourceRecordingFrame(start.handle,1,24)).rejects.toThrow('改变');const retry=await f.generator.nextSourceRecordingFrame(start.handle,1,12);
  expect(port.sent).toHaveLength(count);expect(retry.implicitRecording?.displayFrame).toBe(1);await f.generator.finishSourceRecording(start.handle);f.generator.dispose();
 });
 it('stops cancelled asynchronous drawing at the consumed frame',async()=>{
  const f=await setup(),abort=new AbortController(),start=await f.generator.beginSourceRecording(f.output,f.options,abort.signal);let release!:()=>void;draw.gate=new Promise<void>(r=>{release=r;});
  const frame=f.generator.nextSourceRecordingFrame(start.handle,1,12).catch(e=>e);await vi.waitFor(()=>expect(draw.frames).toEqual([0,1]));abort.abort();release();expect(await frame).toMatchObject({recordingRetained:true});
  const stop=await f.generator.finishSourceRecording(start.handle);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(1);f.generator.dispose();
 });
 it.each(['source-recording-begin','source-recording-frame'] as const)('restores an undelivered transferred numerical frame: %s',async operation=>{
  const f=await setup();let start=operation==='source-recording-frame'?await f.generator.beginSourceRecording(f.output,f.options):undefined;
  corrupt=r=>{if(r.operation===operation&&!('error' in r)){corrupt=undefined;throw Error('lost after transfer');}};
  const failure=await(start?f.generator.nextSourceRecordingFrame(start.handle,1,12):f.generator.beginSourceRecording(f.output,f.options)).catch(e=>e);
  expect(failure).toMatchObject({recordingRetained:true});const stop=await f.generator.finishSourceRecording(failure.handle);
  expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(start?1:0);expect(stop.context.time).toBe(start ? .5 : .25);f.generator.dispose();
 });
 it.each(['viewport','clock','scene'] as const)('rejects corrupt start facts: %s',kind=>setup().then(async f=>{
  corrupt=r=>{if(r.operation!=='source-recording-begin'||'error' in r)return;if(kind==='viewport')r.result.warmup.sourceCameraFrame!.viewport={...r.result.warmup.sourceCameraFrame!.viewport,logicalWidth:r.result.warmup.sourceCameraFrame!.viewport.logicalWidth/2};else if(kind==='clock')r.result.warmup.implicitRecording={...r.result.warmup.implicitRecording!,simulationFps:30};else r.result.scene.timeline.fps=4;};
  await expect(f.generator.beginSourceRecording(f.output,f.options)).rejects.toMatchObject({recordingRetained:false});expect(port.terminated).toBe(true);f.generator.dispose();
 }));
 it('uses the production queue to skip warmup, deliver ordered observations and restore after an early stop',async()=>{
  const f=await setup(),outputs:SceneOutput[]=[];let restored:unknown;
  const queue=new GenerationQueue(f.generator,{busy:()=>{},error:e=>{throw e;},output:o=>outputs.push(o),recordingStopped:s=>{restored=s;}});
  queue.request(f.scene,f.context,0);await vi.waitFor(()=>expect(outputs).toHaveLength(1));let completion:unknown;const frames:number[]=[];
  await queue.recordSource(outputs[0],f.options,{actualFrameRate:()=>12,frame:async(o,index)=>{expect(o.implicitRecording?.displayFrame).toBe(index+1);frames.push(index);},shouldStop:()=>frames.length===1,complete:async(_s,c)=>{completion=c;}});
  expect(frames).toEqual([0]);expect(completion).toEqual({reason:'manual-stop',encodedFrames:1,lastDisplayFrame:1});expect(restored).toMatchObject({context:{time:.5},preview:{type:'geometry'}});expect(draw.disposed).toBe(1);queue.dispose();
 });
});


describe('Implicit owned continuation through public client',()=>{
 it('continues at wall-clock deltas, pauses without updating, then resumes from the new baseline',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options);
  await f.generator.nextSourceRecordingFrame(start.handle,1,12);
  const stop=await f.generator.finishSourceRecording(start.handle,1000);
  const live=(paused:boolean,timestampMs:number)=>({...stop.context,time:99,implicitLive:{...stop.context.implicitLive!,actualFrameRate:23,clock:{paused,timestampMs}}});
  const next=await f.generator.generate(stop.scene,live(false,1125));
  expect(next.sourceCameraFrame).toMatchObject({frameIndex:2,sceneTime:.625,rawDt:.125});
  expect(next.implicitLive).toMatchObject({paused:false,renderKind:'update',clockSource:'injected',actualFrameRate:23});
  expect(stop.scene.timeline.fps).toBe(30);
  await f.generator.setImplicitPaused(next,true,5000);
  const paused=await f.generator.generate(stop.scene,live(true,9000));
  expect(paused.sourceCameraFrame).toMatchObject({frameIndex:2,sceneTime:.625});
  expect(paused.sourceCameraFrame?.camera).toEqual(next.sourceCameraFrame?.camera);
  expect(paused.implicitLive?.renderKind).toBe('snapshot');
  await f.generator.setImplicitPaused(paused,false,10000);
  const resumed=await f.generator.generate(stop.scene,live(false,10125));
  expect(resumed.sourceCameraFrame).toMatchObject({frameIndex:3,sceneTime:.75,rawDt:.125});
  const again=await f.generator.beginSourceRecording(resumed,f.options);
  expect(again.warmup.implicitRecording?.displayFrame).toBe(0);
  await f.generator.finishSourceRecording(again.handle);f.generator.dispose();
 });
 it.each(['session','scene','pause'] as const)('rejects an unowned continuation: %s',async kind=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options),stop=await f.generator.finishSourceRecording(start.handle,1000);
  const scene=structuredClone(stop.scene),context=structuredClone(stop.context);
  if(kind==='session')context.implicitLive!.sessionId='foreign';
  else if(kind==='scene')scene.timeline.fps=17;
  else context.implicitLive!.clock.paused=true;
  await expect(f.generator.generate(scene,context)).rejects.toThrow();expect(port.terminated).toBe(true);f.generator.dispose();
 });
 it('retires continuation when returning to an ordinary authored preview',async()=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options),stop=await f.generator.finishSourceRecording(start.handle,1000);
  await f.generator.generate(f.scene,f.context);
  await expect(f.generator.generate(stop.scene,stop.context)).rejects.toThrow('继续播放');f.generator.dispose();
 });
 it('continues after a cancelled drawing without inheriting its cancellation',async()=>{
  const f=await setup(),abort=new AbortController(),start=await f.generator.beginSourceRecording(f.output,f.options,abort.signal);
  abort.abort();const stop=await f.generator.finishSourceRecording(start.handle,1000);
  const output=await f.generator.generate(stop.scene,{...stop.context,implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}});
  expect(output.sourceCameraFrame).toMatchObject({frameIndex:1,sceneTime:.375});f.generator.dispose();
 });
});


describe('Implicit queue handoff',()=>{
 it.each([false,true])('preserves author identity and resumes a deferred viewport, deferred=%s',async deferred=>{
  const f=await setup(),outputs:{output:SceneOutput;time:number;scene:typeof f.scene}[]=[],errors:Error[]=[];let stopped:import('../src/engine/generationProtocol').SourceRecordingStop|undefined;
  const queue=new GenerationQueue(f.generator,{busy:()=>{},error:e=>errors.push(e),output:(output,time,scene)=>outputs.push({output,time,scene}),recordingStopped:s=>{stopped=s;}});
  queue.request(f.scene,f.context);await vi.waitFor(()=>expect(outputs).toHaveLength(1));
  let delivered=0;await queue.recordSource(outputs[0].output,f.options,{actualFrameRate:()=>12,frame:async()=>{delivered++;if(deferred)queue.request(f.scene,{...f.context,width:600,height:600,sourceViewport:ordinarySourceViewport(f.scene,300,300,'primary',486)});},shouldStop:()=>delivered===1});
  if(deferred)await vi.waitFor(()=>expect(outputs.at(-1)?.output.sourceCameraFrame?.viewport.logicalWidth).toBe(300));
  expect(stopped?.scene).toBe(f.scene);
  if(!stopped)throw Error('missing stop');
  const context={...stopped.context,implicitLive:{...stopped.context.implicitLive!,clock:{paused:false,timestampMs:2000}}};
  queue.request(f.scene,context);await vi.waitFor(()=>expect(outputs.at(-1)?.output.implicitLive?.renderKind).toBe('update'));
  const rendered=outputs.at(-1)!;expect(rendered.time).toBe(implicitCameraFrame(rendered.output).sceneTime);expect(rendered.scene).toBe(f.scene);
  await queue.setImplicitPaused(true);
  queue.request(f.scene,{...context,implicitLive:{...context.implicitLive,clock:{paused:true,timestampMs:9000}}});await vi.waitFor(()=>expect(outputs.at(-1)?.output.implicitLive?.renderKind).toBe('snapshot'));
  expect(outputs.at(-1)?.time).toBe(rendered.time);expect(errors).toEqual([]);queue.dispose();
 });
});

describe('Implicit capture identity admission',()=>{
 it.each(['scene','frame','viewport','live','formula','parameters'] as const)('rejects corrupt capture %s before drawing',async kind=>{
  const f=await setup(),start=await f.generator.beginSourceRecording(f.output,f.options),stop=await f.generator.finishSourceRecording(start.handle,1000);
  await f.generator.setImplicitPaused(stop.preview,true,2000);
  await expect(f.generator.captureImplicitPaused({...stop.preview},{width:65,height:49})).rejects.toMatchObject({previewRetained:false});
  await expect(f.generator.captureImplicitPaused(stop.preview,{width:30000,height:30000})).rejects.toMatchObject({previewRetained:true});
  corrupt=r=>{
   if(r.operation!=='implicit-paused-capture'||'error' in r)return;
   if(kind==='scene')r.result.scene.timeline.fps=4;
   if(kind==='parameters')r.result.capture.sourceImplicitParameters={model:'implicit-registry-1.7.8',values:{unexpected:1}};
   if(kind==='frame')r.result.capture.sourceCameraFrame={...r.result.capture.sourceCameraFrame!,camera:{...r.result.capture.sourceCameraFrame!.camera,phi:r.result.capture.sourceCameraFrame!.camera.phi+1}};
   if(kind==='viewport')r.result.capture.sourceCameraFrame={...r.result.capture.sourceCameraFrame!,viewport:{...r.result.capture.sourceCameraFrame!.viewport,logicalWidth:33}};
   if(kind==='live')r.result.capture.implicitLive!.sessionId='foreign';
   if(kind==='formula')r.result.capture.formulaPresentation=undefined;
  };
  await expect(f.generator.captureImplicitPaused(stop.preview,{width:65,height:49})).rejects.toThrow('响应状态');
  expect(port.terminated).toBe(true);f.generator.dispose();
 });
});
