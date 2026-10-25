import {describe,expect,it,vi} from 'vitest';
import {GenerationQueue,retryRetiredGenerationQueueCleanup} from '../src/engine/generationQueue';
import {SourceRecordingOperationError,type SourceRecordingStart,type SourceRecordingStop,type SourceRecordingHandle,type SourceRecordingRaster} from '../src/engine/generationProtocol';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {restartSourceSamilaPalette,writeSourceSamilaParameter} from '../src/engine/sourceSamilaPaletteEditing';
import type {GenerationInput,SceneDocument} from '../src/types';

// A fake retained producer isolates queue scheduling and identity ownership.
// Rendering, ACK validation, and native release correctness have separate tests.
const options={width:16,height:18,simulationFps:7};
function deferred<T=void>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const context:GenerationInput={width:32,height:24,time:1,quality:'preview',samilaPrimaryPixelHeight:24,samilaLive:{sessionId:'samila-a',pixelDensity:1,dirtyRevision:5,runtimeRevision:7,parameterRevisions:{a:9},clock:{paused:true}}};
const raster=(ctx:GenerationInput):SourceRecordingRaster=>({type:'raster',width:ctx.width,height:ctx.height,pixels:new Uint8ClampedArray(ctx.width*ctx.height*4),stats:{generated:4,samples:4,invalid:0},samilaLive:{sessionId:ctx.samilaLive!.sessionId,target:'primary',displayIndex:3,accumulationPasses:3,anchorTheta:0,parameterChanged:false,cleared:false,clock:'realtime-source-queue',runtime:{sceneTime:ctx.time,rawDt:0,activeDt:0,queueIndex:0,queueComplete:false,parameterWriteRevision:0,phi:0,theta:0,gamma:0,paused:ctx.samilaLive!.clock!.paused,updates:3,clockSource:'page-wall-clock'}}});
async function fixture(){
 const base=parseLegacyScene('{"config_version":"1.0.0","type":"SAMILA","name":"queue fixture","parameters":{"a":1},"settings":{"batch_size":4},"timeline":[{"type":"wait","duration":0.3}]}').scene;
 const scene=writeSourceSamilaParameter(base,'a',2),effective=restartSourceSamilaPalette(scene),handle=Object.freeze({sessionId:1,recordingId:2});let retained=false;
 const stopContext:GenerationInput={...context,time:3/7,samilaLive:{...context.samilaLive!,dirtyRevision:0,runtimeRevision:0,parameterRevisions:{},clock:{paused:false}}};
 const stop:SourceRecordingStop={scene:effective,context:stopContext,preview:raster(stopContext)};
 const start:SourceRecordingStart={handle,scene:effective,context:stopContext,clock:{simulationFps:7,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue'},warmup:raster(stopContext)};
 const port={generate:vi.fn(async(_scene:SceneDocument,c:GenerationInput)=>raster(c)),cancel:vi.fn(),dispose:vi.fn(),settledNativeCleanup:vi.fn(async()=>{}),
  beginSourceRecording:vi.fn(async()=>{retained=true;return start;}),nextSourceRecordingFrame:vi.fn(async(_token:SourceRecordingHandle,_index:number)=>raster(stopContext)),
  hasSourceRecording:vi.fn((token:SourceRecordingHandle)=>retained&&token===handle),finishSourceRecording:vi.fn(async(_token:SourceRecordingHandle)=>{retained=false;return stop;})};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()},queue=new GenerationQueue(port,callbacks);
 queue.request(scene,context);await flush();const output=callbacks.output.mock.lastCall![0] as SourceRecordingRaster;callbacks.output.mockClear();port.cancel.mockClear();
 return{scene,effective,handle,stop,start,port,queue,callbacks,output,retain:()=>{retained=true;}};
}

describe('Samila recording queue identity and retained cleanup',()=>{
 it('adopts the stop runtime while preserving a deferred viewport and its new density',async()=>{
  const f=await fixture(),saving=deferred(),complete=vi.fn(()=>saving.promise);
  const task=f.queue.recordSource(f.output,options,{frame:vi.fn(),complete});await flush();expect(complete).toHaveBeenCalledOnce();
  f.queue.request(f.scene,{...context,time:99,width:48,height:36,samilaPrimaryPixelHeight:36,samilaLive:{...context.samilaLive!,pixelDensity:2}});
  expect(f.port.generate).toHaveBeenCalledOnce();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();saving.resolve();await task;await flush();
  expect(f.port.generate).toHaveBeenLastCalledWith(f.effective,expect.objectContaining({time:3/7,width:48,height:36,samilaPrimaryPixelHeight:36,samilaLive:{sessionId:'samila-a',pixelDensity:2,dirtyRevision:0,runtimeRevision:0,parameterRevisions:{},clock:{paused:false}}}),expect.any(Function));
  expect(f.callbacks.recordingStopped).toHaveBeenCalledExactlyOnceWith(f.stop,f.scene);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();await flush();
 });
 it.each([false,true])('does not overwrite a same-ID replacement with a new live session (same document object=%s)',async sameObject=>{
  const f=await fixture(),upload=deferred(),replacement=sameObject?f.scene:{...f.scene,name:'replacement'},next={...context,time:4,width:40,samilaLive:{...context.samilaLive!,sessionId:'samila-b',dirtyRevision:12}};
  const task=f.queue.recordSource(f.output,options,{frame:()=>upload.promise});await flush();f.queue.request(replacement,next);expect(f.port.generate).toHaveBeenCalledOnce();upload.resolve();await task;await flush();
  expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();expect(f.callbacks.output.mock.calls.every(call=>call[2]===replacement)).toBe(true);expect(f.port.generate).toHaveBeenLastCalledWith(replacement,next,expect.any(Function));expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();await flush();
 });
 it('retains an uncertain warmup handle through a failed release and retries before the deferred preview',async()=>{
  const f=await fixture(),failedBegin=new SourceRecordingOperationError('warmup ACK unknown',false,true,f.handle);
  f.port.beginSourceRecording.mockImplementationOnce(async()=>{f.retain();throw failedBegin;});f.port.finishSourceRecording.mockRejectedValueOnce(new SourceRecordingOperationError('release ACK unknown',false,true,f.handle));
  const failure=await f.queue.recordSource(f.output,options,{frame:vi.fn()}).catch(error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors[0]).toBe(failedBegin);expect(f.port.hasSourceRecording(f.handle)).toBe(true);expect(f.callbacks.busy).toHaveBeenLastCalledWith(true);
  f.queue.request(f.scene,{...context,width:44,height:26,samilaPrimaryPixelHeight:26});await flush();
  expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);expect(f.port.generate).toHaveBeenLastCalledWith(f.effective,expect.objectContaining({width:44,height:26,time:3/7,samilaLive:f.stop.context.samilaLive}),expect.any(Function));expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();await flush();
 });
 it('waits for a submitted draw on cancel, suppresses its upload, and restores without hard-cancelling the producer',async()=>{
  const f=await fixture(),drawing=deferred<SourceRecordingRaster>(),controller=new AbortController(),consume=vi.fn();f.port.nextSourceRecordingFrame.mockImplementationOnce(()=>drawing.promise);
  const task=f.queue.recordSource(f.output,options,{frame:consume},controller.signal),caught=task.catch(error=>error);await flush();controller.abort();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();expect(f.port.cancel).not.toHaveBeenCalled();drawing.resolve(raster(f.stop.context));
  expect(await caught).toMatchObject({name:'AbortError'});expect(consume).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledExactlyOnceWith(f.handle);expect(f.callbacks.recordingStopped).toHaveBeenCalledOnce();f.queue.dispose();await flush();
 });
 it('keeps native release failures reachable after upload failure and unmount',async()=>{
  const f=await fixture(),upload=deferred(),uploadError=Error('upload failed'),cleanupError=Error('native cleanup failed');f.port.settledNativeCleanup.mockRejectedValueOnce(cleanupError);
  const task=f.queue.recordSource(f.output,options,{frame:()=>upload.promise}),caught=task.catch(error=>error);await flush();f.queue.dispose();expect(f.port.dispose).not.toHaveBeenCalled();upload.reject(uploadError);
  const failure=await caught;expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors[0]).toMatchObject({name:'AbortError'});expect(failure.errors[1]).toBe(cleanupError);expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.port.dispose).toHaveBeenCalledOnce();
  await retryRetiredGenerationQueueCleanup();expect(f.port.settledNativeCleanup).toHaveBeenCalledTimes(2);expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.port.dispose).toHaveBeenCalledOnce();
 });
});
