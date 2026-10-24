import {rootsPresentationControlVisible} from '../src/engine/rootsPresentationAuthoring';
import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration,defaultRootsPendingConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {sourceLivePreviewKind} from '../src/engine/sourceLivePreview';
import type {GenerationInput,SceneOutput,SceneDocument} from '../src/types';
import type {RootsControls,RootsControlReceipt} from '../src/engine/rootsControl';
const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
function scene(){const s=createScene(definition('roots'));s.rootsPresentation={...defaultRootsPresentationConfiguration(),previewMode:'live-worker-arrival-v1'};return s;}
function controlledScene(){return withRootsSceneTimeline(withRootsPresentation(scene(),{...defaultRootsPresentationConfiguration(),previewMode:'live-worker-arrival-v1',pending:defaultRootsPendingConfiguration()}),true);}
const input=():GenerationInput=>({time:0,width:2,height:2,quality:'preview',rootsLive:{sessionId:'roots-live',maximumWorkers:4,clock:{paused:true,timestampMs:1000}}});
// Queue races use a controlled port; real production output validation and GPU
// are covered by verify-roots-live-preview.mjs and verify-roots-live-ui.mjs.
const output={type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16),stats:{samples:1,generated:2,invalid:0,elapsedMs:0},rootsLive:{sceneTime:.5}} as SceneOutput;
async function setup(){const s=scene(),c=input(),port={generate:vi.fn(async(_s:SceneDocument,_c:GenerationInput)=>output),setRootsPaused:vi.fn(async()=>{}),cancel:vi.fn(),dispose:vi.fn()},callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(port,callbacks);queue.request(s,c);await flush();port.cancel.mockClear();return{s,c,port,callbacks,queue};}
describe('Roots live queue ownership',()=>{
 it('acknowledges executed controls from a superseded image before sending deferred edits',async()=>{
  const s=controlledScene(),first=deferred<SceneOutput>(),second=deferred<SceneOutput>();
  const port={generate:vi.fn((_s:SceneDocument,_c:GenerationInput)=>port.generate.mock.calls.length===1?first.promise:second.promise),cancel:vi.fn(),dispose:vi.fn()};
  const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),rootsControlAcknowledged:vi.fn()},queue=new GenerationQueue(port,callbacks);
  const withControls=(controls:RootsControls)=>({...input(),rootsLive:{...input().rootsLive!,controls}});
  const applied={kind:'apply' as const,revision:1,scene:s},palette={kind:'palette' as const,revision:2,palette:{colors:['#ffffff']}};
  queue.request(s,withControls({acknowledgedRevision:0,commands:[applied]}));
  port.cancel.mockClear();
  const edited={...s,rootsSourcePalette:palette.palette};queue.request(edited,withControls({acknowledgedRevision:0,commands:[applied,palette]}));
  const frame=(controls:RootsControlReceipt)=>({...output,rootsLive:{sceneTime:.5,sessionId:'roots-live',controls}} as SceneOutput);
  first.resolve(frame({revision:1,applyRevision:1,resetRevision:1}));await flush();
  expect(callbacks.output).not.toHaveBeenCalled();expect(callbacks.rootsControlAcknowledged).toHaveBeenCalledExactlyOnceWith('roots-live',{revision:1,applyRevision:1,resetRevision:1});
  expect(port.generate.mock.calls[1][1].rootsLive!.controls).toEqual({acknowledgedRevision:1,commands:[palette]});
  second.resolve(frame({revision:2,applyRevision:1,resetRevision:1}));await flush();
  expect(callbacks.output).toHaveBeenCalledOnce();expect(callbacks.error).not.toHaveBeenCalled();expect(port.cancel).not.toHaveBeenCalled();queue.dispose();
 });
 it('preserves the full unacknowledged Apply and hot event batch while coalescing before a draw',async()=>{
  const s=controlledScene(),port={generate:vi.fn(async(_s:SceneDocument,_c:GenerationInput)=>({...output,rootsLive:{sceneTime:0,sessionId:'roots-live',controls:{revision:2,applyRevision:1,resetRevision:1}}} as SceneOutput)),cancel:vi.fn(),dispose:vi.fn()};
  const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(port,callbacks);
  const commands:RootsControls['commands']=[{kind:'apply',revision:1,scene:s},{kind:'palette',revision:2,palette:{colors:['#ffffff']}}];
  vi.useFakeTimers();try{
   queue.request(s,{...input(),rootsLive:{...input().rootsLive!,controls:{acknowledgedRevision:0,commands:[commands[0]]}}},20);
   queue.request({...s,name:'pending hot'}, {...input(),rootsLive:{...input().rootsLive!,controls:{acknowledgedRevision:0,commands}}},20);
   await vi.advanceTimersByTimeAsync(20);await flush();
   expect(port.generate).toHaveBeenCalledOnce();expect(port.generate.mock.calls[0][1].rootsLive!.controls?.commands).toEqual(commands);expect(callbacks.error).not.toHaveBeenCalled();
  }finally{queue.dispose();vi.useRealTimers();}
 });
 it('ignores an old document control receipt and rejects a receipt beyond the issued command',async()=>{
  const s=controlledScene(),old=deferred<SceneOutput>(),next=deferred<SceneOutput>();
  const port={generate:vi.fn((_s:SceneDocument,_c:GenerationInput)=>port.generate.mock.calls.length===1?old.promise:next.promise),cancel:vi.fn(),dispose:vi.fn()},callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),rootsControlAcknowledged:vi.fn()},queue=new GenerationQueue(port,callbacks);
  const controls:RootsControls={acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:s}]};
  queue.request(s,{...input(),rootsLive:{...input().rootsLive!,controls}});
  queue.request(s,{...input(),rootsLive:{...input().rootsLive!,sessionId:'new',controls}});
  old.resolve({...output,rootsLive:{sessionId:'roots-live',sceneTime:0,controls:{revision:1,applyRevision:1,resetRevision:1}}} as SceneOutput);await flush();
  expect(callbacks.rootsControlAcknowledged).not.toHaveBeenCalled();
  next.resolve({...output,rootsLive:{sessionId:'new',sceneTime:0,controls:{revision:2,applyRevision:1,resetRevision:1}}} as SceneOutput);await flush();
  expect(callbacks.error).toHaveBeenCalledOnce();expect(callbacks.output).not.toHaveBeenCalled();expect(callbacks.rootsControlAcknowledged).not.toHaveBeenCalled();queue.dispose();
 });
 it('publishes owned scene time and redraws metadata edits while retaining producer identity',async()=>{
  const f=await setup();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,.5,f.s);f.c.rootsLive!.clock.timestampMs=9000;
  expect(f.port.generate.mock.calls[0][1].rootsLive!.clock.timestampMs).toBe(1000);
  f.queue.request({...f.s,id:'save-as-id',name:'renamed'},f.c,0,'metadata');await flush();expect(f.port.generate).toHaveBeenCalledTimes(2);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('acknowledges pause before a deferred display and releases its control lease',async()=>{
  const f=await setup(),gate=deferred<void>();f.port.setRootsPaused.mockImplementationOnce(()=>gate.promise);
  const ack=f.queue.setRootsPaused(false);f.queue.request(f.s,f.c);await flush();expect(f.port.generate).toHaveBeenCalledTimes(1);
  gate.resolve();await ack;await flush();expect(f.port.generate.mock.calls.at(-1)![1].rootsLive!.clock.paused).toBe(false);
  await f.queue.setRootsPaused(true);expect(f.port.setRootsPaused).toHaveBeenCalledTimes(2);f.queue.dispose();
 });
 it('retires the worker on new runtime identity and on return to saved ordinal replay',async()=>{
  const f=await setup();f.queue.request(f.s,{...f.c,rootsLive:{...f.c.rootsLive!,sessionId:'new'}});await flush();expect(f.port.cancel).toHaveBeenCalledTimes(1);
  const c={...f.c};delete c.rootsLive;f.queue.request(f.s,c);await flush();expect(f.port.cancel).toHaveBeenCalledTimes(2);f.queue.dispose();
 });
 it('does not accept a late control acknowledgement after scene replacement',async()=>{
  const f=await setup(),gate=deferred<void>();f.port.setRootsPaused.mockImplementationOnce(()=>gate.promise);const ack=f.queue.setRootsPaused(false).catch(e=>e);
  f.queue.request(scene(),{...f.c,rootsLive:{...f.c.rootsLive!,sessionId:'replacement'}});expect((await ack).name).toBe('AbortError');gate.resolve();await flush();expect(f.port.generate.mock.calls.at(-1)![1].rootsLive!.clock.paused).toBe(true);f.queue.dispose();
 });
});
describe('explicit saved preview policy',()=>{
 it('persists opt-in while preserving omitted legacy policy through canonical load',()=>{
  const s=scene(),saved=parseScene(JSON.stringify(persistentScene(s)));expect(saved.rootsPresentation!.previewMode).toBe('live-worker-arrival-v1');expect(sourceLivePreviewKind(saved)).toBe('roots');expect(rootsPresentationControlVisible(saved,'rootSamplesPerFrame')).toBe(false);
  delete s.rootsPresentation!.previewMode;const legacy=parseScene(JSON.stringify(persistentScene(s)));expect(legacy.rootsPresentation).not.toHaveProperty('previewMode');expect(sourceLivePreviewKind(legacy)).toBeUndefined();expect(rootsPresentationControlVisible(legacy,'rootSamplesPerFrame')).toBe(true);
 });
 it('rejects unknown policy instead of silently returning ordinal behavior',()=>{
  const s=scene();(s.rootsPresentation as unknown as {previewMode:string}).previewMode='unknown';expect(()=>parseScene(JSON.stringify(s))).toThrow();
 });
});
