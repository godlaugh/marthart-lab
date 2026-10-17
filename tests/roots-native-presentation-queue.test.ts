import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {rootsPresentationRequestIdentity} from '../src/engine/rootsPresentationRequest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
const ctx={time:0,width:17,height:13,quality:'preview' as const};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:1,generated:1,invalid:0}};
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(){
 const requests:{scene:SceneDocument;context:GenerationInput;resolve:(o:SceneOutput)=>void;reject:(e:Error)=>void;progress?:(o:SceneOutput)=>void}[]=[];
 const port={generate:vi.fn((scene:SceneDocument,context:GenerationInput,progress?:(o:SceneOutput)=>void)=>new Promise<SceneOutput>((resolve,reject)=>requests.push({scene,context,resolve,reject,progress}))),cancel:vi.fn(),dispose:vi.fn()};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()};return{queue:new GenerationQueue(port,callbacks),port,callbacks,requests};
}
function scene(){const s=createScene(definition('roots'));s.rootsPresentation=defaultRootsPresentationConfiguration();return s;}
describe('native Roots request ownership',()=>{
 it.each([null,0,false,{},'', ' \t\n'])('rejects invalid explicit identity %j',token=>{
  expect(()=>rootsPresentationRequestIdentity({id:'doc'},token)).toThrow(/非空字符串/);
 });
 it('keeps exact token identity and separates omitted document identity',()=>{
  expect(rootsPresentationRequestIdentity({id:'x'},undefined)).not.toBe(rootsPresentationRequestIdentity({id:'x'},'x'));
  expect(rootsPresentationRequestIdentity({id:'x'},' x ')).not.toBe(rootsPresentationRequestIdentity({id:'y'},'x'));
 });
 it.each(['success','failure'] as const)('coalesces hot edits and save ID changes while suppressing obsolete %s',async terminal=>{
  const f=fixture(),s=scene();f.queue.request(s,{...ctx,rootsSessionId:'live'});
  const a=structuredClone(s),b=structuredClone(s);a.rootsPresentation!.camera.theta=.2;b.id='saved-id';b.rootsPresentation!.camera.theta=.4;
  f.queue.request(a,{...ctx,rootsSessionId:'live'});f.queue.request(b,{...ctx,rootsSessionId:'live'});
  expect(f.requests).toHaveLength(1);expect(f.port.cancel).toHaveBeenCalledTimes(1);f.requests[0].progress?.(output);
  if(terminal==='success')f.requests[0].resolve(output);else f.requests[0].reject(Error('obsolete'));
  await flush();expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.callbacks.output).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(2);expect(f.requests[1].scene).toBe(b);f.requests[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,0,b);f.queue.dispose();
 });
 it('cancels on changed runtime token for the same scene object and on omitted-token handoff',async()=>{
  const f=fixture(),s=scene();f.queue.request(s,{...ctx,rootsSessionId:s.id});f.queue.request(s,{...ctx,rootsSessionId:'loaded'});f.queue.request(s,ctx);
  expect(f.port.cancel).toHaveBeenCalledTimes(3);expect(f.requests).toHaveLength(3);
  f.requests[0].resolve(output);f.requests[1].resolve(output);await flush();expect(f.callbacks.output).not.toHaveBeenCalled();f.requests[2].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenCalledOnce();f.queue.dispose();
 });
 it('preserves legacy document fallback but cancels on explicit retry',()=>{
  const f=fixture(),s=scene();f.queue.request(s,ctx);f.queue.request(structuredClone(s),ctx);expect(f.port.cancel).toHaveBeenCalledTimes(1);
  f.queue.cancel();expect(f.port.cancel).toHaveBeenCalledTimes(2);f.queue.request(s,ctx);expect(f.port.cancel).toHaveBeenCalledTimes(3);f.queue.dispose();
 });
 it('owns queued viewport facts rather than borrowing the caller object',async()=>{
  vi.useFakeTimers();try{
   const f=fixture(),s=scene(),viewport={logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary' as const};
   f.queue.request(s,{...ctx,rootsViewport:viewport},50);viewport.logicalWidth=500;viewport.referenceLogicalHeight=500;
   await vi.advanceTimersByTimeAsync(50);expect(f.requests[0].context.rootsViewport).toEqual({logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'});
   f.requests[0].resolve(output);await flush();f.queue.dispose();
  }finally{vi.useRealTimers();}
 });
});
