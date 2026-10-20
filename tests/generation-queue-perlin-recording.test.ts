import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue,retryRetiredGenerationQueueCleanup} from '../src/engine/generationQueue';
import {PerlinRecordingOperationError,type PerlinRecordingStart,type PerlinRecordingStop,type PerlinRecordingHandle,type PerlinRecordingRaster} from '../src/engine/generationProtocol';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {GenerationInput,SceneDocument} from '../src/types';

const raster:PerlinRecordingRaster={type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16).fill(255),stats:{generated:4,elapsedMs:0,samples:1,invalid:0}};
const context:GenerationInput={width:2,height:2,time:1,quality:'preview'};
const options={width:4,height:4,simulationFps:24};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function fixture(){
 const scene=createScene(definition('perlin')),effective={...scene,name:'effective'};
 const handle=Object.freeze({sessionId:1,recordingId:1});let retained=false;
 const start:PerlinRecordingStart={handle,scene:effective,context,clock:{simulationFps:24,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue'},warmup:raster};
 const stop:PerlinRecordingStop={scene:effective,context:{...context,time:2/24},preview:{...raster}};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()};
 const port={generate:vi.fn(async(_scene:SceneDocument,_context:GenerationInput)=>raster),cancel:vi.fn(),dispose:vi.fn(),
  capturePerlinPaused:vi.fn(async()=>({capture:raster,preview:raster})),
  beginPerlinRecording:vi.fn(async()=>{retained=true;return start;}),
  nextPerlinRecordingFrame:vi.fn(async(_handle:PerlinRecordingHandle,_index:number)=>({...raster})),
  finishPerlinRecording:vi.fn(async(_handle:PerlinRecordingHandle)=>{retained=false;return stop;}),
  hasPerlinRecording:vi.fn((token:PerlinRecordingHandle)=>retained&&token===handle)};
 const queue=new GenerationQueue(port,callbacks);queue.request(scene,context);await flush();port.cancel.mockClear();callbacks.output.mockClear();
 return {scene,effective,handle,start,stop,callbacks,port,queue,retain:()=>{retained=true;}};
}

describe('Perlin recording queue lease',()=>{
 it('discards warmup from encoded frames and waits for consumer backpressure',async()=>{
  const f=await fixture(),gate=deferred<void>(),events:string[]=[];
  f.callbacks.recordingStopped.mockImplementation(()=>events.push('stopped'));f.callbacks.output.mockImplementation(()=>events.push('preview'));
  const consume=vi.fn(async(_frame:PerlinRecordingRaster,index:number)=>{events.push(`frame:${index}`);if(index===0)await gate.promise;});
  const task=f.queue.recordPerlin(raster,options,{start:async start=>{expect(start.warmup).toBe(raster);events.push('start');},frame:consume});await flush();
  expect(f.port.nextPerlinRecordingFrame.mock.calls.map(call=>call[1])).toEqual([1]);expect(f.port.finishPerlinRecording).not.toHaveBeenCalled();
  gate.resolve();await task;
  expect(f.port.nextPerlinRecordingFrame.mock.calls).toEqual([[f.handle,1],[f.handle,2]]);
  expect(events).toEqual(['start','frame:0','frame:1','stopped','preview']);
  expect(f.callbacks.recordingStopped).toHaveBeenCalledWith(f.stop,f.scene);expect(f.callbacks.output).toHaveBeenCalledWith(f.stop.preview,2/24,f.effective);
  expect(f.port.cancel).not.toHaveBeenCalled();expect(f.port.generate).toHaveBeenCalledTimes(1);f.queue.dispose();
 });
 it('leases during pending begin and rejects duplicate begin/capture without cancelling the worker',async()=>{
  const f=await fixture(),begin=deferred<PerlinRecordingStart>();f.port.beginPerlinRecording.mockImplementationOnce(()=>begin.promise);
  const task=f.queue.recordPerlin(raster,options,{frame:vi.fn()}),caught=task.catch(error=>error);
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toThrow('等待');
  await expect(f.queue.capturePerlinPaused(raster,{width:2,height:2})).rejects.toThrow('等待');
  f.queue.cancel();expect(f.port.cancel).not.toHaveBeenCalled();f.retain();begin.resolve(f.start);
  expect((await caught).name).toBe('AbortError');expect(f.port.nextPerlinRecordingFrame).not.toHaveBeenCalled();expect(f.port.finishPerlinRecording).toHaveBeenCalledWith(f.handle);f.queue.dispose();
 });
 it('soft cancellation waits for an in-flight consumer before finish',async()=>{
  const f=await fixture(),gate=deferred<void>(),controller=new AbortController();
  const task=f.queue.recordPerlin(raster,options,{frame:()=>gate.promise},controller.signal),caught=task.catch(error=>error);await flush();controller.abort();
  expect(f.port.finishPerlinRecording).not.toHaveBeenCalled();gate.resolve();expect((await caught).name).toBe('AbortError');
  expect(f.port.nextPerlinRecordingFrame).toHaveBeenCalledTimes(1);expect(f.port.finishPerlinRecording).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('waits for an in-flight worker frame before stopping and does not deliver it after cancellation',async()=>{
  const f=await fixture(),frame=deferred<PerlinRecordingRaster>(),consume=vi.fn();f.port.nextPerlinRecordingFrame.mockImplementationOnce(()=>frame.promise);
  const task=f.queue.recordPerlin(raster,options,{frame:consume}),caught=task.catch(error=>error);await flush();f.queue.cancel();
  expect(f.port.finishPerlinRecording).not.toHaveBeenCalled();frame.resolve(raster);expect((await caught).name).toBe('AbortError');
  expect(consume).not.toHaveBeenCalled();expect(f.port.finishPerlinRecording).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('finishes a warmup-only queue without inventing encoded frames',async()=>{
  const f=await fixture(),consume=vi.fn();f.start.clock={...f.start.clock,updates:1,encodedFrames:0,firstEncodedUpdate:null,lastDisplayFrame:0};
  await f.queue.recordPerlin(raster,options,{frame:consume});expect(consume).not.toHaveBeenCalled();expect(f.port.nextPerlinRecordingFrame).not.toHaveBeenCalled();expect(f.port.finishPerlinRecording).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('rejects an already-aborted request without acquiring a lease',async()=>{
  const f=await fixture(),controller=new AbortController();controller.abort();
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(f.port.beginPerlinRecording).not.toHaveBeenCalled();expect(f.port.finishPerlinRecording).not.toHaveBeenCalled();f.queue.dispose();
 });
 it.each(['start','frame'] as const)('finishes after a %s consumer failure',async phase=>{
  const f=await fixture(),error=new Error('encoder failed');
  const consumer={start:phase==='start'?()=>{throw error;}:undefined,frame:async()=>{throw error;}};
  await expect(f.queue.recordPerlin(raster,options,consumer)).rejects.toBe(error);
  expect(f.port.finishPerlinRecording).toHaveBeenCalledOnce();expect(f.callbacks.recordingStopped).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('finishes a retained handle supplied with a failed begin',async()=>{
  const f=await fixture(),error=new PerlinRecordingOperationError('delivery failed',false,true,f.handle);
  f.port.beginPerlinRecording.mockImplementationOnce(async()=>{f.retain();throw error;});
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toBe(error);
  expect(f.port.finishPerlinRecording).toHaveBeenCalledWith(f.handle);expect(f.callbacks.output).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it.each([true,false])('invalidates readiness only for a confirmed lost preview (retained=%s)',async retained=>{
  const f=await fixture(),error=new PerlinRecordingOperationError('begin rejected',retained,false);
  f.port.beginPerlinRecording.mockRejectedValueOnce(error);
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toBe(error);
  expect(f.callbacks.error).toHaveBeenCalledTimes(retained?0:1);expect(f.port.finishPerlinRecording).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('preserves a finish failure and retries ownership cleanup before deferred resize',async()=>{
  const f=await fixture(),failure=new Error('readback failed');f.port.finishPerlinRecording.mockRejectedValueOnce(failure);
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toBe(failure);
  expect(f.port.hasPerlinRecording(f.handle)).toBe(true);expect(f.callbacks.busy).toHaveBeenLastCalledWith(true);
  f.queue.request(f.scene,{...context,width:9,height:7});await flush();
  expect(f.port.finishPerlinRecording).toHaveBeenCalledTimes(2);expect(f.port.generate).toHaveBeenLastCalledWith(f.effective,expect.objectContaining({width:9,height:7,time:2/24}),expect.any(Function));
  expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('defers a different scene without overwriting it with the recording snapshot',async()=>{
  const f=await fixture(),gate=deferred<void>(),other=createScene(definition('surface'));
  const task=f.queue.recordPerlin(raster,options,{frame:()=>gate.promise});await flush();f.queue.request(other,{...context,time:4});
  expect(f.port.generate).toHaveBeenCalledTimes(1);expect(f.port.cancel).not.toHaveBeenCalled();gate.resolve();await task;await flush();
  expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();expect(f.callbacks.output.mock.calls.every(call=>call[2]===other)).toBe(true);
  expect(f.port.generate).toHaveBeenLastCalledWith(other,expect.objectContaining({time:4}),expect.any(Function));f.queue.dispose();
 });
 it('does not lose a request synchronously made by recordingStopped',async()=>{
  const f=await fixture(),other=createScene(definition('surface'));
  f.callbacks.recordingStopped.mockImplementation(()=>f.queue.request(other,{...context,time:6}));
  await f.queue.recordPerlin(raster,options,{frame:vi.fn()});await flush();
  expect(f.port.generate).toHaveBeenLastCalledWith(other,expect.objectContaining({time:6}),expect.any(Function));
  expect(f.callbacks.output.mock.calls.every(call=>call[2]===other)).toBe(true);f.queue.dispose();
 });
 it('unmount waits for pending begin and finish before releasing the worker',async()=>{
  const f=await fixture(),begin=deferred<PerlinRecordingStart>(),finish=deferred<PerlinRecordingStop>();
  f.port.beginPerlinRecording.mockImplementationOnce(()=>begin.promise);f.port.finishPerlinRecording.mockImplementationOnce(()=>finish.promise);
  const task=f.queue.recordPerlin(raster,options,{frame:vi.fn()}),caught=task.catch(error=>error);f.queue.dispose();expect(f.port.dispose).not.toHaveBeenCalled();
  f.retain();begin.resolve(f.start);await flush();expect(f.port.dispose).not.toHaveBeenCalled();finish.resolve(f.stop);expect((await caught).name).toBe('AbortError');
  expect(f.port.dispose).toHaveBeenCalledOnce();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.callbacks.recordingStopped).not.toHaveBeenCalled();
 });
 it('keeps failed unmount cleanup reachable and retries on another dispose',async()=>{
  const f=await fixture(),gate=deferred<void>();f.port.finishPerlinRecording.mockRejectedValueOnce(new Error('release failed'));
  const task=f.queue.recordPerlin(raster,options,{frame:()=>gate.promise}),caught=task.catch(error=>error);await flush();f.queue.dispose();gate.resolve();
  expect(await caught).toBeInstanceOf(AggregateError);expect(f.port.dispose).not.toHaveBeenCalled();f.queue.dispose();await flush();
  expect(f.port.finishPerlinRecording).toHaveBeenCalledTimes(2);expect(f.port.dispose).toHaveBeenCalledOnce();
 });
 it('retains failed unmount cleanup outside the component and removes it after an explicit retry',async()=>{
  const f=await fixture(),gate=deferred<void>();f.port.finishPerlinRecording.mockRejectedValueOnce(new Error('release failed'));
  const task=f.queue.recordPerlin(raster,options,{frame:()=>gate.promise}),caught=task.catch(error=>error);await flush();f.queue.dispose();gate.resolve();await caught;
  await retryRetiredGenerationQueueCleanup();expect(f.port.dispose).toHaveBeenCalledOnce();
  await retryRetiredGenerationQueueCleanup();expect(f.port.finishPerlinRecording).toHaveBeenCalledTimes(2);
 });
 it('a later capture retries unfinished cleanup without terminating the worker',async()=>{
  const f=await fixture();f.port.finishPerlinRecording.mockRejectedValueOnce(new Error('release failed'));
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toThrow('release failed');
  await expect(f.queue.capturePerlinPaused(raster,{width:2,height:2})).resolves.toBe(raster);
  expect(f.port.finishPerlinRecording).toHaveBeenCalledTimes(2);expect(f.port.capturePerlinPaused).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('does not finish twice while a cleanup retry is pending',async()=>{
  const f=await fixture(),gate=deferred<PerlinRecordingStop>();f.port.finishPerlinRecording.mockRejectedValueOnce(new Error('retained')).mockImplementationOnce(()=>gate.promise);
  await expect(f.queue.recordPerlin(raster,options,{frame:vi.fn()})).rejects.toThrow('retained');
  const retry=f.queue.retryPerlinRecordingCleanup();f.queue.request(f.scene,{...context,width:3});f.queue.cancel();
  expect(f.port.finishPerlinRecording).toHaveBeenCalledTimes(2);gate.resolve(f.stop);await retry;expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
});
