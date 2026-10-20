import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneOutput} from '../src/types';
import type {RootsPausedCaptureResult} from '../src/engine/generationProtocol';
import {RootsPausedCaptureError,PerlinPausedCaptureError} from '../src/engine/generationProtocol';
function fixture(family:'roots'|'perlin'='roots'){
  const captures:{resolve:(result:RootsPausedCaptureResult)=>void;reject:(error:Error)=>void}[]=[];
  const requests:{time:number;resolve:(o:SceneOutput)=>void;reject:(e:Error)=>void;progress?:(o:SceneOutput)=>void}[]=[];
  const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},port={generate:vi.fn((_s:unknown,c:{time:number},progress?:(o:SceneOutput)=>void)=>new Promise<SceneOutput>((resolve,reject)=>requests.push({time:c.time,resolve,reject,progress}))),cancel:vi.fn(),dispose:vi.fn()};
  const capture=vi.fn(()=>new Promise<RootsPausedCaptureResult>((resolve,reject)=>captures.push({resolve,reject})));
  const capturePort={...port,...(family==='roots'?{captureRootsPaused:capture}:{capturePerlinPaused:capture})};
  return{queue:new GenerationQueue(capturePort,callbacks),requests,captures,callbacks,port:capturePort};
}
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray([0,0,0,255]),stats:{generated:1,elapsedMs:0,samples:1,invalid:0}};
const context=(time:number)=>({time,width:1,height:1,quality:'preview' as const});
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
describe('preview generation scheduling',()=>{
  it('keeps a retained preview usable after a pure capture preflight rejection',async()=>{
    const f=fixture(),scene=createScene(definition('roots'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const denied=f.queue.captureRootsPaused(output,{width:7680,height:4320}),caught=denied.catch(e=>e),error=new RootsPausedCaptureError('capacity',true);f.captures[0].reject(error);
    expect(await caught).toBe(error);expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);
    const retry=f.queue.captureRootsPaused(output,{width:1,height:1});f.captures[1].resolve({capture:output,preview:{...output}});expect(await retry).toBe(output);expect(f.port.cancel).toHaveBeenCalledTimes(1);f.queue.dispose();
  });
  it('serializes capture and publishes the changed primary frame without terminating its worker',async()=>{
    const f=fixture(),scene=createScene(definition('roots'));f.queue.request(scene,context(2));
    await expect(f.queue.captureRootsPaused(output,{width:1,height:1})).rejects.toThrow('等待');
    f.requests[0].resolve(output);await flush();const capture=f.queue.captureRootsPaused(output,{width:1,height:1});
    await expect(f.queue.captureRootsPaused(output,{width:1,height:1})).rejects.toThrow('等待');
    const preview={...output};f.captures[0].resolve({capture:output,preview});expect(await capture).toBe(output);
    expect(f.callbacks.output).toHaveBeenLastCalledWith(preview,2,scene);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);
    expect(f.port.cancel).toHaveBeenCalledTimes(1);f.queue.dispose();
  });
  it('defers a same-owner seek until capture finishes and rejects the obsolete PNG',async()=>{
    const f=fixture(),scene=createScene(definition('roots'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const capture=f.queue.captureRootsPaused(output,{width:1,height:1}),caught=capture.catch(e=>e);
    f.queue.request(scene,context(3));expect(f.requests).toHaveLength(1);
    f.captures[0].resolve({capture:output,preview:{...output}});expect((await caught).name).toBe('AbortError');
    expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.requests.map(r=>r.time)).toEqual([2,3]);
    f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,3,scene);f.queue.dispose();
  });
  it('surfaces capture failures without falsely publishing an unchanged preview',async()=>{
    const f=fixture(),scene=createScene(definition('roots'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const capture=f.queue.captureRootsPaused(output,{width:1,height:1}),caught=capture.catch(e=>e),error=new Error('GPU lost after resize');f.captures[0].reject(error);
    expect(await caught).toBe(error);expect(f.callbacks.error).toHaveBeenCalledWith(error);expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();
  });
  it('ignores a late capture result after explicit preview cancellation',async()=>{
    const f=fixture(),scene=createScene(definition('roots'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const capture=f.queue.captureRootsPaused(output,{width:1,height:1}),caught=capture.catch(e=>e);f.queue.cancel();f.captures[0].resolve({capture:output,preview:{...output}});
    expect((await caught).name).toBe('AbortError');expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();
  });
  it('serializes Perlin capture and defers a same-owner seek without publishing stale capture results',async()=>{
    const f=fixture('perlin'),scene=createScene(definition('perlin'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const capture=f.queue.capturePerlinPaused(output,{width:3,height:5},3),caught=capture.catch(error=>error);
    f.queue.request(scene,context(3));expect(f.requests).toHaveLength(1);
    f.captures[0].resolve({capture:output,preview:{...output}});expect((await caught).name).toBe('AbortError');
    expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.requests.map(request=>request.time)).toEqual([2,3]);
    f.requests[1].resolve(output);await flush();
    const fresh=f.queue.capturePerlinPaused(output,{width:3,height:5},5),preview={...output};f.captures[1].resolve({capture:output,preview});
    expect(await fresh).toBe(output);expect(f.callbacks.output).toHaveBeenLastCalledWith(preview,3,scene);f.queue.dispose();
  });
  it('suppresses only confirmed Perlin retention errors, never Roots errors or plain messages',async()=>{
    for(const error of [new PerlinPausedCaptureError('capacity',true),new PerlinPausedCaptureError('capacity',false),new RootsPausedCaptureError('capacity',true),new Error('preview retained')]){
      const f=fixture('perlin'),scene=createScene(definition('perlin'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
      const capture=f.queue.capturePerlinPaused(output,{width:1,height:1}),caught=capture.catch(value=>value);f.captures[0].reject(error);expect(await caught).toBe(error);
      expect(f.callbacks.error).toHaveBeenCalledTimes(error instanceof PerlinPausedCaptureError&&error.previewRetained?0:1);expect(f.callbacks.output).toHaveBeenCalledTimes(1);f.queue.dispose();
    }
  });
  it('rejects late Perlin capture after cancellation and disposes without publishing it',async()=>{
    const f=fixture('perlin'),scene=createScene(definition('perlin'));f.queue.request(scene,context(2));f.requests[0].resolve(output);await flush();
    const capture=f.queue.capturePerlinPaused(output,{width:1,height:1}),caught=capture.catch(error=>error);f.queue.cancel();f.captures[0].resolve({capture:output,preview:{...output}});
    expect((await caught).name).toBe('AbortError');expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.callbacks.error).not.toHaveBeenCalled();f.queue.dispose();
  });
  it('cancels active and coalesced work, ignores late callbacks, and can retry the same scene',async()=>{
    const f=fixture(),scene=createScene(definition('perlin'));f.queue.request(scene,context(120));f.queue.request(scene,context(130));
    f.requests[0].progress?.(output);expect(f.callbacks.output).toHaveBeenCalledOnce();
    f.queue.cancel();expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);
    f.requests[0].progress?.(output);f.requests[0].reject(new Error('late failure'));await flush();
    expect(f.callbacks.output).toHaveBeenCalledOnce();expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.requests).toHaveLength(1);
    f.queue.request(scene,context(120));f.requests[1].resolve(output);await flush();
    expect(f.callbacks.output).toHaveBeenLastCalledWith(output,120,scene);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();
  });
  it('cancels a delayed request without starting it and permits another delayed request',async()=>{
    vi.useFakeTimers();try{const f=fixture(),scene=createScene(definition('surface'));f.queue.request(scene,context(0),90);f.queue.cancel();vi.advanceTimersByTime(100);expect(f.port.generate).not.toHaveBeenCalled();f.queue.request(scene,context(3),90);vi.advanceTimersByTime(90);expect(f.requests.map(r=>r.time)).toEqual([3]);f.requests[0].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,3,scene);f.queue.dispose();}finally{vi.useRealTimers();}
  });
  it('displays replay progress at its actual simulation time and final output at requested time',async()=>{const f=fixture(),scene=createScene(definition('perlin'));f.queue.request(scene,context(120));const partial={...output,temporal:{time:35,windowStart:0,frames:2101,samplingFps:60,recordedPoints:0,cacheHits:0}};f.requests[0].progress?.(partial);expect(f.callbacks.output).toHaveBeenLastCalledWith(partial,35,scene);expect(f.callbacks.busy).toHaveBeenLastCalledWith(true);f.requests[0].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,120,scene);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();});
  it('finishes the latest seek even when input stops while an earlier frame is pending',async()=>{const f=fixture(),scene=createScene(definition('surface'));f.queue.request(scene,context(0));f.queue.request(scene,context(1));f.queue.request(scene,context(2));expect(f.requests).toHaveLength(1);f.requests[0].resolve(output);await flush();expect(f.requests.map(r=>r.time)).toEqual([0,2]);f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,2,scene);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);expect(f.port.cancel).toHaveBeenCalledTimes(1);f.queue.dispose();});
  it('rejects late progress/results/errors from a replaced scene and preserves frame time',async()=>{const f=fixture(),a=createScene(definition('surface')),b=createScene(definition('fractal'));f.queue.request(a,context(1));f.queue.request(b,context(3));f.requests[0].progress?.(output);f.requests[0].reject(new Error('stale'));f.requests[1].progress?.(output);await flush();expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.callbacks.output).toHaveBeenLastCalledWith(output,3,b);f.requests[1].resolve(output);await flush();f.queue.dispose();});
  it('cancels delayed work and ignores callbacks after disposal',async()=>{vi.useFakeTimers();try{const f=fixture(),scene=createScene(definition('surface'));f.queue.request(scene,context(0),90);f.queue.request(scene,context(4));vi.advanceTimersByTime(90);expect(f.requests.map(r=>r.time)).toEqual([4]);f.queue.dispose();f.requests[0].progress?.(output);f.requests[0].resolve(output);await flush();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.port.dispose).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}});
});
