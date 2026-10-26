import {afterEach,describe,expect,it,vi} from 'vitest';
import fixture from './fixtures/source-fractal-display/mandelbrot.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {SourceFractalFreshRecordingSession} from '../src/engine/sourceFractalFreshRecording';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';
import {SourceFractalDisplay} from '../src/engine/sourceFractalDisplay';
import {sourceProfileForFormula} from '../src/engine/fractalSourcePrecision';
import {withFractalFreshRecording} from '../src/engine/sourceFractalRecording';
import type {GenerateContext,SceneDocument,SceneOutput,RasterOutput} from '../src/types';

const scene=()=>parseProjectFile(JSON.stringify({...fixture,timeline:[{type:'wait',duration:.1}]})).scene;
const context=(paused=true,timestampMs:number|undefined=50):GenerateContext=>({time:0,quality:'preview',width:16,height:12,fractalPixelDensity:2,fractalViewport:{logicalWidth:8,logicalHeight:6,target:'primary'},fractalLive:{sessionId:'async-fractal',revision:0,intent:'apply',clock:{paused,timestampMs},actualFrameRate:37}});
const recordingOptions={width:5,height:3,simulationFps:60};
const coldContext=(displayFrame:number):GenerateContext=>({time:displayFrame/60,quality:'export',width:16,height:12,fractalPixelDensity:2,fractalViewport:{logicalWidth:8,logicalHeight:6,target:'offscreen'},fractalRecording:{displayFrame,simulationFps:60}});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function output(_scene:SceneDocument,c:GenerateContext):Extract<SceneOutput,{type:'raster'}> {
 return{type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4).fill(c.fractalDisplay?.ordinal??0),stats:{samples:1,generated:1,invalid:0},fractalRender:{profile:sourceProfileForFormula('mandelbrot'),formula:'mandelbrot',execution:{backend:'webgl2'},rasterSize:[c.width,c.height],display:c.fractalDisplay} as unknown as RasterOutput['fractalRender']};
}
const observe=(s:SceneDocument,c:GenerateContext)=>({scene:structuredClone(s),context:{time:c.time,width:c.width,height:c.height,quality:c.quality,fractalViewport:c.fractalViewport,display:c.fractalDisplay}});
afterEach(()=>vi.restoreAllMocks());

describe('one Fractal numerical/display owner with sync and async drivers (CPU injected renderer)',()=>{
 it('waits for ACK, snapshots caller inputs, and rejects competing controls until publication',async()=>{
  const entered=deferred<GenerateContext>(),ack=deferred<SceneOutput>(),s=scene(),c=context(),original=structuredClone(s);
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:(s,c)=>{entered.resolve(c);return ack.promise;}});
  const pending=owner.generateAsync(s,c);s.settings.centerX=900;c.width=100;c.fractalLive!.sessionId='changed';
  const actual=await entered.promise;expect(actual.width).toBe(16);expect(owner.matchesCompletedPrimary(original,context())).toBe(false);
  await expect(owner.generateAsync(original,context())).rejects.toThrow('正在');expect(()=>owner.setPaused(false)).toThrow();expect(()=>owner.reset()).toThrow();
  expect(()=>owner.generate(original,context())).toThrow('Async');
  ack.resolve(output(original,actual));const result=await pending;
  expect(result.fractalLive!.sessionId).toBe('async-fractal');expect(result.fractalLive!.presentation.settings.centerX).toBe(original.settings.centerX);
  expect(owner.matchesCompletedPrimary(original,context())).toBe(true);
 });
 it('preserves the same progressive displays and hot/Apply behavior with synchronous and asynchronous rendering',async()=>{
  const s=scene(),syncCalls:unknown[]=[],asyncCalls:unknown[]=[];
  const sync=new SourceFractalLiveSession((s,c)=>{syncCalls.push(observe(s,c));return output(s,c);});
  const asyncOwner=new SourceFractalLiveSession(undefined,{asyncRender:async(s,c)=>{asyncCalls.push(observe(s,c));return output(s,c);}});
  for(let i=0;i<4;i++){expect(await asyncOwner.generateAsync(s,context())).toEqual(sync.generate(s,context()));}
  const draft=structuredClone(s);draft.settings.centerX=3;draft.settings.background='#abcdef';
  const hot={...context(),fractalLive:{...context().fractalLive!,revision:1,intent:'hot' as const,configuration:draft}};
  expect(await asyncOwner.generateAsync(draft,hot)).toEqual(sync.generate(draft,hot));
  sync.setPaused(false,100);asyncOwner.setPaused(false,100);
  const apply={...context(false,150),fractalLive:{...context(false,150).fractalLive!,revision:2,configuration:draft}};
  expect(await asyncOwner.generateAsync(draft,apply)).toEqual(sync.generate(draft,apply));expect(asyncCalls).toEqual(syncCalls);
 });
 it('soft reset waits for ACK/finally and prevents a revoked result or progress from escaping',async()=>{
  const entered=deferred<GenerateContext>(),ack=deferred<SceneOutput>(),progress=vi.fn(),s=scene();
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:(_s,c)=>{entered.resolve(c);return ack.promise;}});
  const pending=owner.generateAsync(s,{...context(),onProgress:progress}),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'}),c=await entered.promise;
  let settled=false;const resetting=owner.resetAsync().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);expect(c.isCancelled!()).toBe(true);
  expect(()=>c.onProgress!(output(s,c))).toThrow('取消');expect(progress).not.toHaveBeenCalled();await expect(owner.generateAsync(s,context())).rejects.toThrow('正在');
  ack.resolve(output(s,c));await rejected;await resetting;expect(owner.diagnostics()).toMatchObject({sessionId:'',failed:false,host:undefined});
 });
 it('checks revocation again between the display promise and the parent generator resume',async()=>{
  const original=SourceFractalDisplay.prototype.displayAsync,s=scene();let reset:Promise<void>|undefined;
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:async(s,c)=>output(s,c)});
  vi.spyOn(SourceFractalDisplay.prototype,'displayAsync').mockImplementation(function(this:SourceFractalDisplay,input,render){
   return original.call(this,input,render).then(value=>{reset=owner.resetAsync();return value;}) as ReturnType<SourceFractalDisplay['displayAsync']>;
  });
  await expect(owner.generateAsync(s,context())).rejects.toMatchObject({name:'AbortError'});await reset;
  expect(owner.matchesCompletedPrimary(s,context())).toBe(false);expect(owner.diagnostics().sessionId).toBe('');
 });
 it('closes progress publication when an async operation settles, including fresh recording',async()=>{
  const s=scene(),progress=vi.fn();let retained:GenerateContext|undefined;
  const render=async(s:SceneDocument,c:GenerateContext)=>{retained=c;c.onProgress?.(output(s,c));return output(s,c);};
  const live=new SourceFractalLiveSession(undefined,{asyncRender:render});await live.generateAsync(s,{...context(),onProgress:progress});expect(progress).toHaveBeenCalledTimes(1);
  expect(()=>retained!.onProgress!(output(s,retained!))).toThrow('已结束');expect(progress).toHaveBeenCalledTimes(1);
  const fresh=new SourceFractalFreshRecordingSession(undefined,{asyncRender:render});await fresh.generateAsync(withFractalFreshRecording(s,60),{...coldContext(0),onProgress:progress});expect(progress).toHaveBeenCalledTimes(2);
  expect(()=>retained!.onProgress!(output(s,retained!))).toThrow('已结束');expect(progress).toHaveBeenCalledTimes(2);
 });
 it('captures offscreen then restores primary after separate ACKs without a numerical update',async()=>{
  const s=scene(),retained:number[]=[],calls:GenerateContext[]=[],acks:ReturnType<typeof deferred<SceneOutput>>[]=[],entered:ReturnType<typeof deferred<void>>[]=[deferred<void>(),deferred<void>()];let capture=false;
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:(s,c,_prepared,options)=>{retained.push(options.retainedBytes);if(!capture)return output(s,c);const d=deferred<SceneOutput>();calls.push(c);acks.push(d);entered[calls.length-1].resolve();return d.promise;}});
  for(let i=0;i<4;i++)await owner.generateAsync(s,context());const before=owner.diagnostics().host!;capture=true;
  expect(retained).toEqual([0,0,0,0]);
  const pending=owner.capturePausedAsync(s,{...context(),quality:'export',width:20,height:16},{additionalBytes:96});await entered[0].promise;expect(retained.at(-1)).toBe(96);
  expect(calls).toHaveLength(1);expect(calls[0].fractalViewport!.target).toBe('offscreen');expect(owner.matchesCompletedPrimary(s,context())).toBe(false);
  const captured=output(s,calls[0]);acks[0].resolve(captured);await entered[1].promise;expect(calls[1].fractalViewport!.target).toBe('primary');expect(retained.at(-1)).toBe(96+captured.pixels.byteLength);
  acks[1].resolve(output(s,calls[1]));const result=await pending;
  expect(result.capture.fractalLive).toMatchObject({renderKind:'snapshot',rawDt:0,objectUpdates:0,updateOrdinal:before.updateOrdinal});expect(result.preview.fractalLive!.presentation.evaluatedFractalScene).toEqual(result.capture.fractalLive!.presentation.evaluatedFractalScene);
  expect(owner.diagnostics().host).toEqual(before);expect(calls.map(c=>[c.fractalDisplay!.ordinal,c.fractalDisplay!.gradientSize])).toEqual([[4,1024],[5,0]]);
 });
 it('rejects invalid caller-retained byte counts before capture changes the completed owner',async()=>{
  const render=vi.fn(output),owner=new SourceFractalLiveSession(undefined,{asyncRender:render}),s=scene(),c=context();await owner.generateAsync(s,c);
  for(const additionalBytes of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
   await expect(owner.capturePausedAsync(s,{...c,quality:'export',width:20,height:16},{additionalBytes})).rejects.toThrow('预算');
   expect(owner.matchesCompletedPrimary(s,c)).toBe(true);expect(render).toHaveBeenCalledTimes(1);
  }
 });
 it('records the same warmup/updates as sync, and retains finish ownership after rejected primary restoration',async()=>{
  const s=scene(),sync=new SourceFractalLiveSession(output),finish=vi.spyOn(SourceFractalHostSession.prototype,'finishRecording');let rejectPrimary=false;
  const owner=new SourceFractalLiveSession(undefined,{asyncRender:async(s,c)=>{if(rejectPrimary&&c.fractalViewport?.target==='primary')throw Error('restore rejected');return output(s,c);}});
  sync.generate(s,context());await owner.generateAsync(s,context());const startSync=sync.beginRecording(s,context(),recordingOptions),start=await owner.beginRecordingAsync(s,context(),recordingOptions);
  expect(start.warmup).toEqual(startSync.warmup);expect(start.warmup.fractalLive!.clockSource).toBe('fixed-step');
  await expect(owner.resetAsync()).rejects.toThrow('结束');expect(owner.ownsRecording(start.handle)).toBe(true);
  for(let ordinal=1;ordinal<=start.clock.lastDisplayFrame;ordinal++)expect(await owner.nextRecordingFrameAsync(start.handle,ordinal)).toEqual(sync.nextRecordingFrame(startSync.handle,ordinal));
  const before=owner.diagnostics().host!.state;rejectPrimary=true;await expect(owner.finishRecordingAsync(start.handle,1000)).rejects.toThrow('restore rejected');
  expect(owner.ownsRecording(start.handle)).toBe(true);expect(finish).toHaveBeenCalledTimes(1);rejectPrimary=false;
  const stop=await owner.finishRecordingAsync(start.handle,2000);expect(finish).toHaveBeenCalledTimes(1);expect(owner.diagnostics().host!.state).toEqual(before);
  expect(stop.preview.fractalLive).toMatchObject({target:'primary',renderKind:'snapshot',rawDt:0,activeDt:0,objectUpdates:0});expect(stop.scene).toEqual(s);
  expect(stop).toEqual(sync.finishRecording(startSync.handle,1000));await owner.resetAsync();
 });
 it('does not expose a failed warmup and permits only explicit reset/new-session recovery',async()=>{
  const s=scene();let reject=false;const owner=new SourceFractalLiveSession(undefined,{asyncRender:async(s,c)=>{if(reject)throw Error('sample rejected');return output(s,c);}});
  await owner.generateAsync(s,context());reject=true;await expect(owner.beginRecordingAsync(s,context(),recordingOptions)).rejects.toThrow('sample rejected');
  await owner.settle();expect(owner.diagnostics().failed).toBe(true);expect(owner.matchesCompletedPrimary(s,context())).toBe(false);
  reject=false;await expect(owner.generateAsync(s,context())).rejects.toThrow('sessionId');await owner.resetAsync();expect((await owner.generateAsync(s,context())).fractalLive!.updateOrdinal).toBe(0);
 });
 it('uses the page clock through reconstruction, full Apply, recording stop and injected timestamps',async()=>{
  const s=scene();let now=50;const owner=new SourceFractalLiveSession(undefined,{asyncRender:async(s,c)=>output(s,c),hostClock:{now:()=>now,source:'page-wall-clock'}});
  const c=context(false,undefined);delete c.fractalLive!.clock.timestampMs;
  expect((await owner.generateAsync(s,c)).fractalLive).toMatchObject({clockSource:'page-wall-clock',rawDt:0});now=100;
  expect((await owner.generateAsync(s,c)).fractalLive!.rawDt).toBe(Math.fround(.05));
  const seek={...c,fractalLive:{...c.fractalLive!,sessionId:'seek',startAt:.03}};expect((await owner.generateAsync(s,seek)).fractalLive!.clockSource).toBe('page-wall-clock');
  const apply={...seek,fractalLive:{...seek.fractalLive!,revision:1,configuration:s}};expect((await owner.generateAsync(s,apply)).fractalLive).toMatchObject({clockSource:'page-wall-clock',updateOrdinal:0});
  const start=await owner.beginRecordingAsync(s,apply,recordingOptions);expect(start.warmup.fractalLive!.clockSource).toBe('fixed-step');now=200;const stop=await owner.finishRecordingAsync(start.handle);
  expect(stop.preview.fractalLive!.clockSource).toBe('page-wall-clock');now=250;expect((await owner.generateAsync(s,stop.context)).fractalLive!.rawDt).toBe(Math.fround(Math.fround(.25)-Math.fround(.2)));
  const injected={...stop.context,fractalLive:{...stop.context.fractalLive!,clock:{paused:false,timestampMs:300}}};expect((await owner.generateAsync(s,injected)).fractalLive!.clockSource).toBe('injected');
 });
});

describe('fresh Fractal recording uses the same skipped-display replay for async samples',()=>{
 it('matches continuous, skipped, backward, repeated and resized requests without intermediate samples',async()=>{
  const s=withFractalFreshRecording(scene(),60),syncCalls:unknown[]=[],asyncCalls:unknown[]=[],sync=new SourceFractalFreshRecordingSession((s,c)=>{syncCalls.push(observe(s,c));return output(s,c);}),owner=new SourceFractalFreshRecordingSession(undefined,{asyncRender:async(s,c)=>{asyncCalls.push(observe(s,c));return output(s,c);}});
  for(const ordinal of [0,1,3,5,2,2,0])expect(await owner.generateAsync(s,coldContext(ordinal))).toEqual(sync.generate(s,coldContext(ordinal)));
  const c={...coldContext(4),width:20,fractalViewport:{logicalWidth:10,logicalHeight:6,target:'offscreen' as const}};expect(await owner.generateAsync(s,c)).toEqual(sync.generate(s,c));
  expect(asyncCalls).toEqual(syncCalls);expect(asyncCalls).toHaveLength(8);
 });
 it('waits for a cancelled sample before reset and rebuilds the requested ordinal on the next call',async()=>{
  const s=withFractalFreshRecording(scene(),60),entered=deferred<GenerateContext>(),ack=deferred<SceneOutput>();let hold=true;
  const owner=new SourceFractalFreshRecordingSession(undefined,{asyncRender:(s,c)=>{if(!hold)return output(s,c);entered.resolve(c);return ack.promise;}});
  const pending=owner.generateAsync(s,coldContext(3)),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'}),c=await entered.promise;
  let done=false;const reset=owner.resetAsync().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);await expect(owner.generateAsync(s,coldContext(0))).rejects.toThrow('重入');
  ack.resolve(output(s,c));await rejected;await reset;hold=false;
  const control=new SourceFractalFreshRecordingSession(output);expect(await owner.generateAsync(s,coldContext(3))).toEqual(control.generate(s,coldContext(3)));
 });
 it('preserves forbidden local display input admission before an asynchronous render',async()=>{
  const s=withFractalFreshRecording(scene(),60),render=vi.fn(async(s:SceneDocument,c:GenerateContext)=>output(s,c)),owner=new SourceFractalFreshRecordingSession(undefined,{asyncRender:render});
  await expect(owner.generateAsync(s,{...coldContext(0),fractalDisplay:{} as GenerateContext['fractalDisplay']})).rejects.toThrow('独立录制');expect(render).not.toHaveBeenCalled();
 });
});
