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
 it.each(['replace','cancel','dispose'] as const)('defers %s until the two-display capture finishes',async action=>{
  const f=fixture(),s=createScene(definition('samila'));f.queue.request(s,context);f.requests[0].resolve(output);await flush();
  const pending=f.queue.captureSamilaPaused(output,{width:4,height:4}),caught=pending.catch(e=>e);
  if(action==='replace')f.queue.request({...s},{...context,samilaLive:{sessionId:'next',pixelDensity:1}});else f.queue[action]();
  expect(f.port.cancel).toHaveBeenCalledTimes(1);expect(f.port.dispose).not.toHaveBeenCalled();expect(f.requests).toHaveLength(1);
  f.captures[0].resolve({capture:output,preview:{...output}});expect((await caught).name).toBe('AbortError');expect(f.callbacks.output).toHaveBeenCalledOnce();
  if(action==='dispose')expect(f.port.dispose).toHaveBeenCalledOnce();else expect(f.port.cancel).toHaveBeenCalledTimes(2);
  if(action==='replace'){expect(f.requests).toHaveLength(2);f.requests[1].resolve(output);await flush();}f.queue.dispose();
 });
 it('never reuses a capability invalidated by a new failed generation',async()=>{
  const f=fixture(),s=createScene(definition('samila'));f.queue.request(s,context);f.requests[0].resolve(output);await flush();
  f.queue.request(s,context);f.requests[1].reject(Error('failed'));await flush();f.queue.request({...s,name:'later'},context,0,'metadata');expect(f.requests).toHaveLength(3);f.requests[2].resolve(output);await flush();f.queue.dispose();
 });
});
