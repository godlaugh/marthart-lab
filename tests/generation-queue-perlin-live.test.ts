import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {parseLegacyScene} from '../src/engine/legacyImport';
import type {GenerationInput,SceneOutput,SceneDocument} from '../src/types';
import type {SourceRecordingStart,SourceRecordingStop} from '../src/engine/generationProtocol';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const context=():GenerationInput=>({time:99,width:2,height:2,quality:'preview',perlinLive:{sessionId:'retained',clock:{paused:true,timestampMs:1000}}});
const raster=():Extract<SceneOutput,{type:'raster'}>=>({type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16),stats:{samples:1,generated:4,invalid:0,elapsedMs:0},perlinLive:{sessionId:'retained',paused:true,clockSource:'worker-wall-clock',renderKind:'snapshot',sceneTime:.5,constructions:1,frame:{time:.5,frameIndex:2,sceneTime:.5,queueIndex:0,queueComplete:false,rawDt:0,activeDt:0,rates:[0,0,0],diagnostics:[],camera:{phi:0,theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:20}}}});
async function setup(){
 const scene=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Perlin queue fixture',settings:{render_mode:'GPU'},timeline:[{type:'wait',duration:1}]})).scene;
 const input=context(),output=raster(),effective={...scene,perlinSource:{...scene.perlinSource!,backend:'cpu' as const},timeline:{...scene.timeline,fps:24}};
 const handle={sessionId:1,recordingId:1};let retained=false;
 const stop:SourceRecordingStop={scene:effective,context:{...input,time:.5,perlinLive:{sessionId:'retained',clock:{paused:false}}},preview:{...output,perlinLive:{...output.perlinLive!,paused:false}}};
 const start:SourceRecordingStart={handle,scene:effective,context:stop.context,clock:{simulationFps:24,warmupUpdates:1,updates:1,encodedFrames:0,firstEncodedUpdate:null,lastDisplayFrame:0,completionReason:'animation-queue'},warmup:output};
 const port={generate:vi.fn(async(_s:SceneDocument,_c:GenerationInput)=>output),setPerlinPaused:vi.fn(async()=>{}),cancel:vi.fn(),dispose:vi.fn(),beginSourceRecording:vi.fn(async()=>{retained=true;return start;}),nextSourceRecordingFrame:vi.fn(async()=>output),finishSourceRecording:vi.fn(async()=>{retained=false;return stop;}),hasSourceRecording:vi.fn(()=>retained)};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()},queue=new GenerationQueue(port,callbacks);queue.request(scene,input);await flush();port.cancel.mockClear();return{scene,input,output,effective,stop,port,callbacks,queue};
}
// Controllable ports isolate queue races and authority; real Worker/WebGL2 is
// exercised by scripts/verify-source-perlin-live.mjs, not by these fixtures.
describe('Perlin live queue ordering and recording handoff',()=>{
 it('snapshots nested clock input, publishes delivered time, and draws metadata edits without caching pixels',async()=>{
  const f=await setup();f.input.perlinLive!.clock.timestampMs=9999;
  expect(f.port.generate.mock.calls[0][1].perlinLive!.clock.timestampMs).toBe(1000);expect(f.callbacks.output).toHaveBeenLastCalledWith(f.output,.5,f.scene);
  const renamed={...f.scene,name:'rename'};f.queue.request(renamed,{...f.input,time:999},0,'metadata');await flush();expect(f.port.generate).toHaveBeenCalledTimes(2);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('orders playback acknowledgements before queued requests and copies the acknowledged paused state',async()=>{
  const f=await setup(),gate=deferred<void>();f.port.setPerlinPaused.mockImplementationOnce(()=>gate.promise);
  const ack=f.queue.setPerlinPaused(false);f.queue.request(f.scene,f.input);await flush();expect(f.port.generate).toHaveBeenCalledTimes(1);
  gate.resolve();await ack;await flush();expect(f.port.generate.mock.calls.at(-1)![1].perlinLive!.clock.paused).toBe(false);expect(f.port.setPerlinPaused).toHaveBeenCalledWith(f.output,false);f.queue.dispose();
 });
 it('releases the playback lease before an awaited acknowledgement resolves',async()=>{
  const f=await setup();await f.queue.setPerlinPaused(false);await expect(f.queue.setPerlinPaused(true)).resolves.toBeUndefined();expect(f.port.setPerlinPaused).toHaveBeenCalledTimes(2);f.queue.dispose();
 });
 it.each(['viewport','rename','explicit-backend'] as const)('merges only deferred authored changes after %s',async variant=>{
  const f=await setup(),gate=deferred<void>();const task=f.queue.recordSource(f.output,{width:2,height:2,simulationFps:24},{start:()=>gate.promise,frame:()=>{}});await flush();
  let next=f.scene;if(variant==='rename')next={...f.scene,name:'new label'};
  // The in-flight author document was GPU. A subsequent explicit CPU edit is
  // still applied normally; unchanged GPU on a rename must not undo Stop's CPU.
  if(variant==='explicit-backend')next={...f.scene,perlinSource:{...f.scene.perlinSource!,backend:'cpu'},timeline:{...f.scene.timeline,fps:48}};
  f.queue.request(next,{...f.input,width:6});gate.resolve();await task;await flush();
  const [doc,input]=f.port.generate.mock.calls.at(-1)!;expect(input).toMatchObject({width:6,time:.5,perlinLive:{sessionId:'retained',clock:{paused:false}}});
  expect(doc.perlinSource!.backend).toBe('cpu');expect(doc.timeline.fps).toBe(variant==='explicit-backend'?48:24);expect(doc.name).toBe(variant==='rename'?'new label':f.scene.name);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('does not overwrite an explicit new session even when the scene object is unchanged',async()=>{
  const f=await setup(),gate=deferred<void>();const task=f.queue.recordSource(f.output,{width:2,height:2,simulationFps:24},{start:()=>gate.promise,frame:()=>{}});await flush();
  f.queue.request(f.scene,{...f.input,perlinLive:{sessionId:'new',clock:{paused:true}}});gate.resolve();await task;await flush();
  expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();expect(f.port.generate.mock.calls.at(-1)![1].perlinLive!.sessionId).toBe('new');f.queue.dispose();
 });
 it.each([1,2])('retains palette revision %s across a recording handoff without replaying an old command',async revision=>{
  const f=await setup(),gate=deferred<void>();
  f.input.perlinLive!.paletteRevision=1;f.stop.context.perlinLive!.paletteRevision=1;
  f.queue.request(f.scene,f.input);await flush();
  const task=f.queue.recordSource(f.output,{width:2,height:2,simulationFps:24},{start:()=>gate.promise,frame:()=>{}});await flush();
  const colors=revision===1?f.scene.perlinSource!.palette:[0xff123456];
  const next={...f.scene,perlinSource:{...f.scene.perlinSource!,palette:colors}};
  f.queue.request(next,{...f.input,perlinLive:{...f.input.perlinLive!,paletteRevision:revision}});
  gate.resolve();await task;await flush();
  const [doc,input]=f.port.generate.mock.calls.at(-1)!;
  expect(doc.perlinSource!.palette).toEqual(colors);expect(input.perlinLive).toEqual({sessionId:'retained',paletteRevision:revision,clock:{paused:false}});
  expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
});
