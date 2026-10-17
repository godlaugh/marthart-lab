import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneDocument,SceneOutput} from '../src/types';

const context={time:0,width:17,height:13,quality:'preview' as const};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray([0,0,0,255]),stats:{samples:1,generated:1,invalid:0}};
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(){
 const requests:{scene:SceneDocument;resolve:(o:SceneOutput)=>void;reject:(error:Error)=>void;progress?: (o:SceneOutput)=>void}[]=[];
 const port={generate:vi.fn((scene:SceneDocument,_context:unknown,progress?: (o:SceneOutput)=>void)=>new Promise<SceneOutput>((resolve,reject)=>requests.push({scene,resolve,reject,progress}))),cancel:vi.fn(),dispose:vi.fn()};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()};
 return{queue:new GenerationQueue(port,callbacks),port,callbacks,requests};
}
describe('Domain renderer lifetime through preview scheduling',()=>{
 it('keeps an idle renderer across configuration edits; explicit retry creates a fresh renderer',async()=>{
  const f=fixture(),scene=createScene(definition('domain'));
  f.queue.request(scene,context);f.requests[0].resolve(output);await flush();
  const edited={...scene,settings:{...scene.settings,centerX:.25}};
  f.queue.request(edited,context);expect(f.port.cancel).toHaveBeenCalledTimes(1);
  f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,0,edited);
  f.queue.cancel();f.queue.request(edited,context);expect(f.port.cancel).toHaveBeenCalledTimes(3);
  f.requests[2].resolve(output);await flush();f.queue.dispose();
 });
 it.each(['success','failure'] as const)('coalesces in-flight edits and suppresses obsolete %s without losing renderer state',async terminal=>{
  const f=fixture(),scene=createScene(definition('domain'));
  f.queue.request(scene,context);
  const first={...scene,settings:{...scene.settings,centerX:1}},last={...scene,settings:{...scene.settings,centerX:2}};
  f.queue.request(first,context);f.queue.request(last,context);
  expect(f.requests).toHaveLength(1);expect(f.port.cancel).toHaveBeenCalledTimes(1);
  f.requests[0].progress?.(output);
  if(terminal==='success')f.requests[0].resolve(output);else f.requests[0].reject(new Error('obsolete render failure'));
  await flush();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.callbacks.error).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(2);expect(f.requests[1].scene).toBe(last);
  f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,0,last);expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();
 });
 it('ends renderer ownership on document replacement, cancellation and disposal',async()=>{
  const f=fixture(),scene=createScene(definition('domain')),other={...scene,id:scene.id+'-other'};
  f.queue.request(scene,context);f.queue.request(other,context);
  expect(f.requests).toHaveLength(2);expect(f.port.cancel).toHaveBeenCalledTimes(2);
  f.requests[0].resolve(output);await flush();expect(f.callbacks.output).not.toHaveBeenCalled();
  f.queue.cancel();f.requests[1].resolve(output);await flush();expect(f.callbacks.output).not.toHaveBeenCalled();
  f.queue.dispose();expect(f.port.dispose).toHaveBeenCalledOnce();
 });
});
