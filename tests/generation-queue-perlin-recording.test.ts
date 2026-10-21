import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue,retryRetiredGenerationQueueCleanup} from '../src/engine/generationQueue';
import {SourceRecordingOperationError,type SourceRecordingStart,type SourceRecordingStop,type SourceRecordingHandle,type SourceRecordingRaster} from '../src/engine/generationProtocol';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {GenerationInput,SceneDocument} from '../src/types';

const raster:SourceRecordingRaster={type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16).fill(255),stats:{generated:4,elapsedMs:0,samples:1,invalid:0}};
const context:GenerationInput={width:2,height:2,time:1,quality:'preview'};
const options={width:4,height:4,simulationFps:24};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function fixture(){
 const scene=createScene(definition('perlin')),effective={...scene,name:'effective'};
 const handle=Object.freeze({sessionId:1,recordingId:1});let retained=false;
 const start:SourceRecordingStart={handle,scene:effective,context,clock:{simulationFps:24,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue'},warmup:raster};
 const stop:SourceRecordingStop={scene:effective,context:{...context,time:2/24},preview:{...raster}};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()};
 const port={generate:vi.fn(async(_scene:SceneDocument,_context:GenerationInput)=>raster),cancel:vi.fn(),dispose:vi.fn(),
  capturePerlinPaused:vi.fn(async()=>({capture:raster,preview:raster})),
  beginSourceRecording:vi.fn(async()=>{retained=true;return start;}),
  nextSourceRecordingFrame:vi.fn(async(_handle:SourceRecordingHandle,_index:number)=>({...raster})),
  finishSourceRecording:vi.fn(async(_handle:SourceRecordingHandle)=>{retained=false;return stop;}),
  hasSourceRecording:vi.fn((token:SourceRecordingHandle)=>retained&&token===handle)};
 const queue=new GenerationQueue(port,callbacks);queue.request(scene,context);await flush();port.cancel.mockClear();callbacks.output.mockClear();
 return {scene,effective,handle,start,stop,callbacks,port,queue,retain:()=>{retained=true;}};
}

describe('Perlin recording queue lease',()=>{
 it('discards warmup from encoded frames and waits for consumer backpressure',async()=>{
  const f=await fixture(),gate=deferred<void>(),events:string[]=[];
  f.callbacks.recordingStopped.mockImplementation(()=>events.push('stopped'));f.callbacks.output.mockImplementation(()=>events.push('preview'));
  const consume=vi.fn(async(_frame:SourceRecordingRaster,index:number)=>{events.push(`frame:${index}`);if(index===0)await gate.promise;});
  const task=f.queue.recordSource(raster,options,{start:async start=>{expect(start.warmup).toBe(raster);events.push('start');},frame:consume});await flush();
  expect(f.port.nextSourceRecordingFrame.mock.calls.map(call=>call[1])).toEqual([1]);expect(f.port.finishSourceRecording).not.toHaveBeenCalled();
  gate.resolve();await task;
  expect(f.port.nextSourceRecordingFrame.mock.calls).toEqual([[f.handle,1],[f.handle,2]]);
  expect(events).toEqual(['start','frame:0','frame:1','stopped','preview']);
  expect(f.callbacks.recordingStopped).toHaveBeenCalledWith(f.stop,f.scene);expect(f.callbacks.output).toHaveBeenCalledWith(f.stop.preview,2/24,f.effective);
  expect(f.port.cancel).not.toHaveBeenCalled();expect(f.port.generate).toHaveBeenCalledTimes(1);f.queue.dispose();
 });
 it('leases during pending begin and rejects duplicate begin/capture without cancelling the worker',async()=>{
  const f=await fixture(),begin=deferred<SourceRecordingStart>();f.port.beginSourceRecording.mockImplementationOnce(()=>begin.promise);
  const task=f.queue.recordSource(raster,options,{frame:vi.fn()}),caught=task.catch(error=>error);
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toThrow('等待');
  await expect(f.queue.capturePerlinPaused(raster,{width:2,height:2})).rejects.toThrow('等待');
  f.queue.cancel();expect(f.port.cancel).not.toHaveBeenCalled();f.retain();begin.resolve(f.start);
  expect((await caught).name).toBe('AbortError');expect(f.port.nextSourceRecordingFrame).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledWith(f.handle);f.queue.dispose();
 });
 it('soft cancellation waits for an in-flight consumer before finish',async()=>{
  const f=await fixture(),gate=deferred<void>(),controller=new AbortController();
  const task=f.queue.recordSource(raster,options,{frame:()=>gate.promise},controller.signal),caught=task.catch(error=>error);await flush();controller.abort();
  expect(f.port.finishSourceRecording).not.toHaveBeenCalled();gate.resolve();expect((await caught).name).toBe('AbortError');
  expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(1);expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('waits for an in-flight worker frame before stopping and does not deliver it after cancellation',async()=>{
  const f=await fixture(),frame=deferred<SourceRecordingRaster>(),consume=vi.fn();f.port.nextSourceRecordingFrame.mockImplementationOnce(()=>frame.promise);
  const task=f.queue.recordSource(raster,options,{frame:consume}),caught=task.catch(error=>error);await flush();f.queue.cancel();
  expect(f.port.finishSourceRecording).not.toHaveBeenCalled();frame.resolve(raster);expect((await caught).name).toBe('AbortError');
  expect(consume).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('finishes a warmup-only queue without inventing encoded frames',async()=>{
  const f=await fixture(),consume=vi.fn();f.start.clock={...f.start.clock,updates:1,encodedFrames:0,firstEncodedUpdate:null,lastDisplayFrame:0};
  await f.queue.recordSource(raster,options,{frame:consume});expect(consume).not.toHaveBeenCalled();expect(f.port.nextSourceRecordingFrame).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('rejects an already-aborted request without acquiring a lease',async()=>{
  const f=await fixture(),controller=new AbortController();controller.abort();
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(f.port.beginSourceRecording).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();f.queue.dispose();
 });
 it.each(['start','frame'] as const)('finishes after a %s consumer failure',async phase=>{
  const f=await fixture(),error=new Error('encoder failed');
  const consumer={start:phase==='start'?()=>{throw error;}:undefined,frame:async()=>{throw error;}};
  await expect(f.queue.recordSource(raster,options,consumer)).rejects.toBe(error);
  expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.callbacks.recordingStopped).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('finishes a retained handle supplied with a failed begin',async()=>{
  const f=await fixture(),error=new SourceRecordingOperationError('delivery failed',false,true,f.handle);
  f.port.beginSourceRecording.mockImplementationOnce(async()=>{f.retain();throw error;});
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toBe(error);
  expect(f.port.finishSourceRecording).toHaveBeenCalledWith(f.handle);expect(f.callbacks.output).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it.each([true,false])('invalidates readiness only for a confirmed lost preview (retained=%s)',async retained=>{
  const f=await fixture(),error=new SourceRecordingOperationError('begin rejected',retained,false);
  f.port.beginSourceRecording.mockRejectedValueOnce(error);
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toBe(error);
  expect(f.callbacks.error).toHaveBeenCalledTimes(retained?0:1);expect(f.port.finishSourceRecording).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('preserves a finish failure and retries ownership cleanup before deferred resize',async()=>{
  const f=await fixture(),failure=new Error('readback failed');f.port.finishSourceRecording.mockRejectedValueOnce(failure);
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toBe(failure);
  expect(f.port.hasSourceRecording(f.handle)).toBe(true);expect(f.callbacks.busy).toHaveBeenLastCalledWith(true);
  f.queue.request(f.scene,{...context,width:9,height:7});await flush();
  expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);expect(f.port.generate).toHaveBeenLastCalledWith(f.effective,expect.objectContaining({width:9,height:7,time:2/24}),expect.any(Function));
  expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('defers a different scene without overwriting it with the recording snapshot',async()=>{
  const f=await fixture(),gate=deferred<void>(),other=createScene(definition('surface'));
  const task=f.queue.recordSource(raster,options,{frame:()=>gate.promise});await flush();f.queue.request(other,{...context,time:4});
  expect(f.port.generate).toHaveBeenCalledTimes(1);expect(f.port.cancel).not.toHaveBeenCalled();gate.resolve();await task;await flush();
  expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();expect(f.callbacks.output.mock.calls.every(call=>call[2]===other)).toBe(true);
  expect(f.port.generate).toHaveBeenLastCalledWith(other,expect.objectContaining({time:4}),expect.any(Function));f.queue.dispose();
 });
 it('does not lose a request synchronously made by recordingStopped',async()=>{
  const f=await fixture(),other=createScene(definition('surface'));
  f.callbacks.recordingStopped.mockImplementation(()=>f.queue.request(other,{...context,time:6}));
  await f.queue.recordSource(raster,options,{frame:vi.fn()});await flush();
  expect(f.port.generate).toHaveBeenLastCalledWith(other,expect.objectContaining({time:6}),expect.any(Function));
  expect(f.callbacks.output.mock.calls.every(call=>call[2]===other)).toBe(true);f.queue.dispose();
 });
 it('unmount waits for pending begin and finish before releasing the worker',async()=>{
  const f=await fixture(),begin=deferred<SourceRecordingStart>(),finish=deferred<SourceRecordingStop>();
  f.port.beginSourceRecording.mockImplementationOnce(()=>begin.promise);f.port.finishSourceRecording.mockImplementationOnce(()=>finish.promise);
  const task=f.queue.recordSource(raster,options,{frame:vi.fn()}),caught=task.catch(error=>error);f.queue.dispose();expect(f.port.dispose).not.toHaveBeenCalled();
  f.retain();begin.resolve(f.start);await flush();expect(f.port.dispose).not.toHaveBeenCalled();finish.resolve(f.stop);expect((await caught).name).toBe('AbortError');
  expect(f.port.dispose).toHaveBeenCalledOnce();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();
 });
 it('keeps failed unmount cleanup reachable and retries on another dispose',async()=>{
  const f=await fixture(),gate=deferred<void>();f.port.finishSourceRecording.mockRejectedValueOnce(new Error('release failed'));
  const task=f.queue.recordSource(raster,options,{frame:()=>gate.promise}),caught=task.catch(error=>error);await flush();f.queue.dispose();gate.resolve();
  expect(await caught).toBeInstanceOf(AggregateError);expect(f.port.dispose).not.toHaveBeenCalled();f.queue.dispose();await flush();
  expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);expect(f.port.dispose).toHaveBeenCalledOnce();
 });
 it('retains failed unmount cleanup outside the component and removes it after an explicit retry',async()=>{
  const f=await fixture(),gate=deferred<void>();f.port.finishSourceRecording.mockRejectedValueOnce(new Error('release failed'));
  const task=f.queue.recordSource(raster,options,{frame:()=>gate.promise}),caught=task.catch(error=>error);await flush();f.queue.dispose();gate.resolve();await caught;
  await retryRetiredGenerationQueueCleanup();expect(f.port.dispose).toHaveBeenCalledOnce();
  await retryRetiredGenerationQueueCleanup();expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);
 });
 it('a later capture retries unfinished cleanup without terminating the worker',async()=>{
  const f=await fixture();f.port.finishSourceRecording.mockRejectedValueOnce(new Error('release failed'));
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toThrow('release failed');
  await expect(f.queue.capturePerlinPaused(raster,{width:2,height:2})).resolves.toBe(raster);
  expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);expect(f.port.capturePerlinPaused).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('does not finish twice while a cleanup retry is pending',async()=>{
  const f=await fixture(),gate=deferred<SourceRecordingStop>();f.port.finishSourceRecording.mockRejectedValueOnce(new Error('retained')).mockImplementationOnce(()=>gate.promise);
  await expect(f.queue.recordSource(raster,options,{frame:vi.fn()})).rejects.toThrow('retained');
  const retry=f.queue.retrySourceRecordingCleanup();f.queue.request(f.scene,{...context,width:3});f.queue.cancel();
  expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);gate.resolve(f.stop);await retry;expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
});

describe('recording encoder completion ownership',()=>{
 it.each(['success','cancel','failure'] as const)('retains runtime until encoder completion settles: %s',async outcome=>{
  const f=await fixture(),encoder=deferred<void>(),controller=new AbortController(),complete=vi.fn(()=>encoder.promise);
  const task=f.queue.recordSource(raster,options,{frame:vi.fn(),complete},controller.signal),caught=task.catch(e=>e);await flush();
  expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'queue-complete',encodedFrames:2,lastDisplayFrame:2});expect(f.port.finishSourceRecording).not.toHaveBeenCalled();expect(f.port.hasSourceRecording(f.handle)).toBe(true);
  if(outcome==='cancel')controller.abort();const failure=new Error('encoder finish failed');if(outcome==='failure')encoder.reject(failure);else encoder.resolve();
  const result=await caught;if(outcome==='cancel')expect(result.name).toBe('AbortError');else if(outcome==='failure')expect(result).toBe(failure);else expect(result).toBeUndefined();
  expect(f.port.finishSourceRecording).toHaveBeenCalledExactlyOnceWith(f.handle);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
});

describe('manual recording stop preserves an acknowledged frame prefix',()=>{
 it('stops after start with zero encoded frames and waits for empty-output handling before finishing',async()=>{
  const f=await fixture(),startGate=deferred<void>(),completeGate=deferred<void>();let stop=false;
  const frame=vi.fn(),complete=vi.fn(()=>completeGate.promise),shouldStop=vi.fn(()=>stop);
  const task=f.queue.recordSource(raster,options,{start:()=>startGate.promise,shouldStop,frame,complete});await flush();
  stop=true;expect(shouldStop).not.toHaveBeenCalled();startGate.resolve();await flush();
  expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'manual-stop',encodedFrames:0,lastDisplayFrame:0});
  expect(frame).not.toHaveBeenCalled();expect(f.port.nextSourceRecordingFrame).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();
  completeGate.resolve();await task;expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('includes an already requested worker frame and its entire upload before stopping',async()=>{
  const f=await fixture(),render=deferred<SourceRecordingRaster>(),upload=deferred<void>(),save=deferred<void>();let stop=false;
  f.port.nextSourceRecordingFrame.mockImplementationOnce(()=>render.promise);
  const consume=vi.fn(()=>upload.promise),complete=vi.fn(()=>save.promise);
  const task=f.queue.recordSource(raster,options,{shouldStop:()=>stop,frame:consume,complete});await flush();
  expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledExactlyOnceWith(f.handle,1);stop=true;
  render.resolve(raster);await flush();expect(consume).toHaveBeenCalledExactlyOnceWith(raster,0,f.start);expect(complete).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();
  upload.resolve();await flush();expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'manual-stop',encodedFrames:1,lastDisplayFrame:1});
  expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(1);expect(f.port.finishSourceRecording).not.toHaveBeenCalled();
  await expect(f.queue.retrySourceRecordingCleanup()).rejects.toThrow('仍在处理');expect(f.port.hasSourceRecording(f.handle)).toBe(true);
  save.resolve();await task;expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('samples Stop again after a successful upload without cancelling or requesting another frame',async()=>{
  const f=await fixture(),upload=deferred<void>();let stop=false;
  const complete=vi.fn(),task=f.queue.recordSource(raster,options,{shouldStop:()=>stop,frame:()=>upload.promise,complete});await flush();
  stop=true;expect(complete).not.toHaveBeenCalled();upload.resolve();await task;
  expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'manual-stop',encodedFrames:1,lastDisplayFrame:1});expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(1);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('keeps natural completion when Stop arrives during the final planned upload',async()=>{
  const f=await fixture(),last=deferred<void>();let stop=false;
  const complete=vi.fn(),task=f.queue.recordSource(raster,options,{shouldStop:()=>stop,frame:(_frame,index)=>index===1?last.promise:undefined,complete});await flush();
  expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(2);stop=true;last.resolve();await task;
  expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'queue-complete',encodedFrames:2,lastDisplayFrame:2});expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(2);f.queue.dispose();
 });
 it('reports a naturally empty queue without inventing a frame even if Stop is already set',async()=>{
  const f=await fixture();f.start.clock={...f.start.clock,updates:1,encodedFrames:0,lastDisplayFrame:0,firstEncodedUpdate:null};const complete=vi.fn();
  await f.queue.recordSource(raster,options,{shouldStop:()=>true,frame:vi.fn(),complete});
  expect(complete).toHaveBeenCalledExactlyOnceWith(f.start,{reason:'queue-complete',encodedFrames:0,lastDisplayFrame:0});expect(f.port.nextSourceRecordingFrame).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('does not report a failed upload as a saved partial recording',async()=>{
  const f=await fixture(),upload=deferred<void>(),failure=new Error('upload failed');let stop=false;
  const complete=vi.fn(),task=f.queue.recordSource(raster,options,{shouldStop:()=>stop,frame:()=>upload.promise,complete}),caught=task.catch(e=>e);await flush();stop=true;upload.reject(failure);
  expect(await caught).toBe(failure);expect(complete).not.toHaveBeenCalled();expect(f.port.nextSourceRecordingFrame).toHaveBeenCalledTimes(1);expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('keeps cancellation distinct from a save-stop while the current upload settles',async()=>{
  const f=await fixture(),upload=deferred<void>(),abort=new AbortController();let stop=false;
  const complete=vi.fn(),task=f.queue.recordSource(raster,options,{shouldStop:()=>stop,frame:()=>upload.promise,complete},abort.signal),caught=task.catch(e=>e);await flush();stop=true;abort.abort();
  expect(f.port.finishSourceRecording).not.toHaveBeenCalled();upload.resolve();expect((await caught).name).toBe('AbortError');expect(complete).not.toHaveBeenCalled();expect(f.port.finishSourceRecording).toHaveBeenCalledOnce();f.queue.dispose();
 });
});
