import {afterEach,describe,expect,it,vi} from 'vitest';
import {RealtimeRecorder} from '../src/engine/realtimeRecorder';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';

// Real browser encoding/playback is checked separately. These fault-injection
// tests cover ownership paths that cannot be triggered reliably with a codec.
function fixture(options:{missingTrack?:boolean;startError?:boolean;stopError?:boolean;delayedStop?:boolean}={}){
 const track={requestFrame:vi.fn(),stop:vi.fn()},stream={getTracks:()=>[track],getVideoTracks:()=>options.missingTrack?[]:[track]};
 const callbacks=new Map<number,FrameRequestCallback>();let next=0,tickTime=performance.now();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callbacks.set(++next,callback);return next;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
 class Canvas {width=640;height=360;captureStream(){return stream;}getContext(){return {clearRect:vi.fn(),drawImage:vi.fn()};}}
 let media:Recorder;
 class Recorder{
  static isTypeSupported(){return true;}
  state='inactive';mimeType='video/webm';onstop:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){media=this;}
  start(){if(options.startError)throw new Error('start failed');this.state='recording';}
  stop(){if(options.stopError)throw new Error('stop failed');this.state='inactive';if(!options.delayedStop)queueMicrotask(()=>this.flush());}
  flush(){this.ondataavailable?.({data:new Blob(['encoded'])});this.onstop?.();}
 }
 vi.stubGlobal('HTMLCanvasElement',Canvas);vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('document',{createElement:()=>new Canvas()});
 const scene=createScene(definition('surface'));scene.formulas=undefined;
 const frame={canvas:new Canvas() as unknown as HTMLCanvasElement,scene,source:scene,sceneTime:3,revision:1};
 return{track,callbacks,frame,media:()=>media!,tick:async()=>{const first=callbacks.entries().next().value!;callbacks.delete(first[0]);await first[1](tickTime+=1000);}};
}
const ready=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('recording resource ownership',()=>{
 it('stops playback and the duration clock before the encoder finishes flushing',async()=>{let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);const f=fixture({delayedStop:true}),recorder=new RealtimeRecorder(),stopped=vi.fn(),promise=recorder.record(()=>f.frame,30,60,()=>{},undefined,stopped);await ready();await f.tick();now=1500;recorder.stop();expect(stopped).toHaveBeenCalledOnce();now=6500;f.media().flush();const result=await promise;expect(result.duration).toBe(.5);expect(stopped).toHaveBeenCalledOnce();});
 it('separates repeated submissions from presented revisions and scene seconds',async()=>{
  const f=fixture(),recorder=new RealtimeRecorder(),started=vi.fn(),promise=recorder.record(()=>f.frame,30,60,()=>{},started);await ready();expect(started.mock.calls[0][0].sceneTime).toBe(3);expect(started.mock.calls[0][1]).toEqual(expect.any(Number));await f.tick();await f.tick();f.frame.revision=2;f.frame.sceneTime=3.4;await f.tick();recorder.stop();const result=await promise;expect(result.frames).toBe(3);expect(result.frameVersions).toBe(2);expect(result.sceneStart).toBe(3);expect(result.sceneEnd).toBe(3.4);
 });
 it('rejects a different same-id source rather than mixing edited content into the recording',async()=>{const f=fixture(),recorder=new RealtimeRecorder();let frame=f.frame;const promise=recorder.record(()=>frame,30,60,()=>{});await ready();frame={...frame,source:{...frame.source}};await f.tick();await expect(promise).rejects.toThrow('场景已更改');expect(f.track.stop).toHaveBeenCalledOnce();});
 it('does not treat a nonempty codec header without a complete submitted frame as success',async()=>{const f=fixture(),recorder=new RealtimeRecorder(),promise=recorder.record(()=>f.frame,30,.1,()=>{});await ready();recorder.stop();await expect(promise).rejects.toThrow('尚未提交完整帧');expect(f.track.stop).toHaveBeenCalledOnce();});
 it('preserves out-of-range duration as a validation error before acquiring a stream',async()=>{const f=fixture();await expect(new RealtimeRecorder().record(()=>f.frame,30,3601,()=>{})).rejects.toThrow('原值已保留');expect(f.track.stop).not.toHaveBeenCalled();});
 it('flushes a composed frame on manual stop and releases the stream',async()=>{const f=fixture(),recorder=new RealtimeRecorder(),promise=recorder.record(()=>f.frame,30,60,()=>{});await ready();await f.tick();recorder.stop();const result=await promise;expect(result.frames).toBe(1);expect(result.blob.size).toBeGreaterThan(0);expect(f.track.requestFrame).toHaveBeenCalledOnce();expect(f.track.stop).toHaveBeenCalledOnce();expect(f.callbacks.size).toBe(0);expect(f.media().ondataavailable).toBeNull();});
 it('rejects cancellation without publishing an unfinished recording',async()=>{const f=fixture(),recorder=new RealtimeRecorder(),promise=recorder.record(()=>f.frame,30,60,()=>{});await ready();recorder.cancel();await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(f.track.stop).toHaveBeenCalledOnce();expect(f.callbacks.size).toBe(0);});
 it('cleans up when a stream lacks a capture track or the codec cannot start',async()=>{for(const options of [{missingTrack:true},{startError:true}]){const f=fixture(options);await expect(new RealtimeRecorder().record(()=>f.frame,30,60,()=>{})).rejects.toThrow();expect(f.track.stop).toHaveBeenCalledOnce();expect(f.callbacks.size).toBe(0);}});
 it('settles the promise and cleans up if the codec throws during stop',async()=>{const f=fixture({stopError:true}),recorder=new RealtimeRecorder(),promise=recorder.record(()=>f.frame,30,60,()=>{});await ready();recorder.stop();await expect(promise).rejects.toThrow('stop failed');expect(f.track.stop).toHaveBeenCalledOnce();expect(f.callbacks.size).toBe(0);});
 it('rejects lost frames and oversized encoding without retaining chunks',async()=>{
  const f=fixture(),recorder=new RealtimeRecorder();let available=true;const promise=recorder.record(()=>available?f.frame:null,30,60,()=>{});await ready();available=false;await f.tick();await expect(promise).rejects.toThrow('画布不可用');expect(f.track.stop).toHaveBeenCalledOnce();
  const g=fixture(),second=new RealtimeRecorder(),pending=second.record(()=>g.frame,30,60,()=>{});await ready();g.media().ondataavailable?.({data:{size:512*1024*1024+1} as Blob});await expect(pending).rejects.toThrow('512 MiB');expect(g.track.stop).toHaveBeenCalledOnce();expect(g.callbacks.size).toBe(0);
 });
});
