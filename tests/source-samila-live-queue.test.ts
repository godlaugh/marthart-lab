import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
const context:GenerationInput={time:1,width:32,height:24,quality:'preview',samilaLive:{sessionId:'live',pixelDensity:1,dirtyRevision:0}};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:1,generated:1,invalid:0}};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const requests:{scene:SceneDocument;context:GenerationInput;resolve:(value:SceneOutput)=>void;reject:(error:Error)=>void}[]=[],captures:{resolve:(value:{capture:SceneOutput;preview:SceneOutput})=>void;reject:(error:Error)=>void}[]=[];
 const port={generate:vi.fn((scene:SceneDocument,context:GenerationInput)=>new Promise<SceneOutput>((resolve,reject)=>requests.push({scene,context,resolve,reject}))),captureSamilaPaused:vi.fn(()=>new Promise<{capture:Extract<SceneOutput,{type:'raster'}>;preview:Extract<SceneOutput,{type:'raster'}>}>((resolve,reject)=>captures.push({resolve:resolve as (v:{capture:SceneOutput;preview:SceneOutput})=>void,reject}))),cancel:vi.fn(),dispose:vi.fn()};
 Object.assign(port,{captureSymmetryPaused:port.captureSamilaPaused});
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()};return{queue:new GenerationQueue(port,callbacks),port,callbacks,requests,captures};
}
describe('live Samila request identity and capture lease',()=>{
 it('coalesces hot edits while retaining worker and cumulative dirty revision',async()=>{
  const f=fixture(),s=createScene(definition('samila'));f.queue.request(s,context);
  const next={...s,parameters:{...s.parameters,a:3}};
  f.queue.request({...s,parameters:{...s.parameters,a:2}},{...context,samilaLive:{...context.samilaLive!,dirtyRevision:1}});
  f.queue.request(next,{...context,samilaLive:{...context.samilaLive!,dirtyRevision:2}});
  expect(f.port.cancel).toHaveBeenCalledTimes(1);f.requests[0].resolve(output);await flush();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.requests).toHaveLength(2);
  expect(f.requests[1].context.samilaLive?.dirtyRevision).toBe(2);f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,1,next);f.queue.dispose();
 });
 it('rebinds explicit metadata without drawing, while equal-input explicit display still samples',async()=>{
  const f=fixture(),s=createScene(definition('samila'));f.queue.request(s,context);f.requests[0].resolve(output);await flush();
  const named={...s,id:'saved',name:'Renamed'};f.queue.request(named,context,0,'metadata');expect(f.requests).toHaveLength(1);expect(f.callbacks.output).toHaveBeenLastCalledWith(output,1,named);
  f.queue.request({...named},context);expect(f.requests).toHaveLength(2);f.requests[1].resolve(output);await flush();
  f.queue.request(named,context);expect(f.requests).toHaveLength(3);f.requests[2].resolve(output);await flush();f.queue.dispose();
 });
 it('rebinds metadata arriving during generation only after its exact output completes',async()=>{
  const f=fixture(),s=createScene(definition('samila')),named={...s,name:'new'};f.queue.request(s,context);f.queue.request(named,context,0,'metadata');expect(f.requests).toHaveLength(1);
  f.requests[0].resolve(output);await flush();expect(f.requests).toHaveLength(1);expect(f.callbacks.output).toHaveBeenCalledOnce();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,1,named);f.queue.dispose();
 });
 it('never reuses a capability invalidated by a new failed generation',async()=>{
  const f=fixture(),s=createScene(definition('samila'));f.queue.request(s,context);f.requests[0].resolve(output);await flush();
  f.queue.request(s,context);f.requests[1].reject(Error('failed'));await flush();f.queue.request({...s,name:'later'},context,0,'metadata');expect(f.requests).toHaveLength(3);f.requests[2].resolve(output);await flush();f.queue.dispose();
 });
});

describe.each(['samila','symmetry'] as const)('%s capture lease',kind=>{
 const key=kind==='symmetry'?'symmetryLive':'samilaLive',method=kind==='symmetry'?'captureSymmetryPaused':'captureSamilaPaused';
 const live:GenerationInput=kind==='samila'?context:{time:1,width:32,height:24,quality:'preview',symmetryLive:{sessionId:'live',renderFps:60,replayRevision:0,clock:{paused:true}}};
 it.each(['replace','cancel','dispose'] as const)('defers %s until the two-display capture finishes',async action=>{
  const f=fixture(),s=createScene(definition(kind));f.queue.request(s,live);f.requests[0].resolve(output);await flush();
  const pending=f.queue[method](output,{width:4,height:4}),caught=pending.catch(e=>e);
  if(action==='replace')f.queue.request({...s},{...live,[key]:{...live[key],sessionId:'next'}});else f.queue[action]();
  expect(f.port.cancel).toHaveBeenCalledTimes(1);expect(f.port.dispose).not.toHaveBeenCalled();expect(f.requests).toHaveLength(1);
  f.captures[0].resolve({capture:output,preview:{...output}});expect((await caught).name).toBe('AbortError');expect(f.callbacks.output).toHaveBeenCalledOnce();
  if(action==='dispose')expect(f.port.dispose).toHaveBeenCalledOnce();else expect(f.port.cancel).toHaveBeenCalledTimes(2);
  if(action==='replace'){expect(f.requests).toHaveLength(2);f.requests[1].resolve(output);await flush();}f.queue.dispose();
 });
});

describe.each(['samila','symmetry'] as const)('%s playback transition ordering',kind=>{
 const key=kind==='symmetry'?'symmetryLive':'samilaLive',method=kind==='symmetry'?'setSymmetryPaused':'setSamilaPaused';
 const live:GenerationInput=kind==='samila'?{...context,samilaLive:{...context.samilaLive!,clock:{paused:false}}}:{time:1,width:32,height:24,quality:'preview',symmetryLive:{sessionId:'live',renderFps:60,replayRevision:0,clock:{paused:false}}};
 const samilaFrame=(time:number):SceneOutput=>({...output,samilaLive:{sessionId:'live',target:'primary',displayIndex:2,accumulationPasses:1,anchorTheta:0,parameterChanged:false,cleared:false,clock:'realtime-source-queue',runtime:{sceneTime:time,rawDt:.2,activeDt:.2,queueIndex:0,queueComplete:false,parameterWriteRevision:0,phi:0,theta:0,gamma:0,paused:false,updates:2,clockSource:'worker-wall-clock'}}});
 const frame=(time:number):SceneOutput=>kind==='samila'?samilaFrame(time):{...output,symmetryLive:{sessionId:'live',clock:'realtime-source-queue',clockSource:'worker-wall-clock',sceneTime:time,rawDt:.2,activeDt:.2,queueIndex:0,queueComplete:false,paused:false,objectUpdates:2,replayRevision:0,display:{displayIndex:2,replayed:false,resized:false,cleared:false,passes:1,accumulationPasses:2,warmupApplied:true,replayActive:false,remainingBurnInSteps:0,remainingReplaySteps:0,phases:[],gpu:{steps:1,accepted:1,invalid:0,clipped:0,sampleInvalid:0,bounds:{minX:0,maxX:1,minY:0,maxY:1}}}}};
 function playbackFixture(){
  const f=fixture(),controls:{resolve:()=>void;reject:(error:Error)=>void}[]=[];
  const control=vi.fn((_output:SceneOutput,_paused:boolean)=>new Promise<void>((resolve,reject)=>controls.push({resolve,reject})));
  Object.assign(f.port,{[method]:control});return{...f,controls,control};
 }
 it('pauses after the running display and before deferred edits, using the latest completed source',async()=>{
  const f=playbackFixture(),s=createScene(definition(kind)),a=frame(.2),b=frame(.7);
  f.queue.request(s,live);f.requests[0].resolve(a);await flush();f.queue.request(s,{...live,time:.2});
  const pause=f.queue[method](true);expect(f.control).not.toHaveBeenCalled();
  const edited={...s,parameters:{...s.parameters,a:2}};f.queue.request(edited,{...live,time:.2});
  f.requests[1].resolve(b);await flush();expect(f.control).toHaveBeenCalledWith(b,true);expect(f.requests).toHaveLength(2);
  f.controls[0].resolve();await pause;await flush();expect(f.requests).toHaveLength(3);expect(f.requests[2].context[key]?.clock?.paused).toBe(true);
  f.requests[2].resolve(frame(.7));await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(expect.anything(),.7,edited);f.queue.dispose();
 });
 it('does not draw for pause/resume and keeps explicit metadata edits reusable at the actual scene time',async()=>{
  const f=playbackFixture(),s=createScene(definition(kind)),a=frame(.75);f.queue.request(s,live);f.requests[0].resolve(a);await flush();
  const pause=f.queue[method](true);f.controls[0].resolve();await pause;await flush();expect(f.requests).toHaveLength(1);
  const named={...s,name:'named'};f.queue.request(named,{...live,time:.75,[key]:{...live[key],clock:{paused:true}}},0,'metadata');expect(f.requests).toHaveLength(1);
  const resume=f.queue[method](false);f.controls[1].resolve();await resume;await flush();expect(f.requests).toHaveLength(1);f.queue.dispose();
 });
 it('rebinds metadata queued during a realtime display despite stale playhead feedback',async()=>{
  const f=playbackFixture(),s=createScene(definition(kind)),named={...s,name:'named'},a=frame(2.5);
  f.queue.request(s,live);f.queue.request(named,live,0,'metadata');f.requests[0].resolve(a);await flush();
  expect(f.requests).toHaveLength(1);expect(f.callbacks.output).toHaveBeenLastCalledWith(a,2.5,named);f.queue.dispose();
 });
 it.each(['replace','cancel','dispose'] as const)('rejects pending playback on %s and ignores late acknowledgement',async action=>{
  const f=playbackFixture(),s=createScene(definition(kind));f.queue.request(s,live);f.requests[0].resolve(frame(.2));await flush();
  const transition=f.queue[method](true).catch(e=>e);
  if(action==='replace')f.queue.request({...s},{...live,[key]:{...live[key],sessionId:'new'}});else f.queue[action]();
  expect((await transition).name).toBe('AbortError');f.controls[0].resolve();await flush();expect(f.callbacks.error).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('starts a delayed initial display before controlling it and reports failed generation without hanging',async()=>{
  const f=playbackFixture(),s=createScene(definition(kind));f.queue.request(s,live,10000);
  const transition=f.queue[method](true).catch(e=>e);expect(f.requests).toHaveLength(1);f.requests[0].reject(Error('draw failed'));await flush();expect(await transition).toBeInstanceOf(Error);expect(f.control).not.toHaveBeenCalled();f.queue.dispose();
 });
});
