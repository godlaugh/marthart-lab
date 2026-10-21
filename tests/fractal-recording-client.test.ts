import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {FractalFreshRecordingPlan} from '../src/engine/sourceFractalRecording';
import type {GenerationInput,SceneOutput} from '../src/types';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';

/** Transport probe only. It deliberately does not clone requests: input snapshot
 * assertions must prove the production boundary, not a fake Worker's clone. No
 * numerical planning or renderer behavior is simulated by these tests. */
class TransportWorker {
 static instances:TransportWorker[]=[];
 messages:GenerationRequest[]=[];
 terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 constructor(readonly url:URL,readonly options:WorkerOptions){TransportWorker.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(message);}
 terminate(){this.terminated=true;}
 emit(data:GenerationResponse){this.onmessage?.({data});}
}
const clients:Generator[]=[];
function setup(){vi.stubGlobal('Worker',TransportWorker);const client=new Generator();clients.push(client);return client;}
function worker(){return TransportWorker.instances.at(-1)!;}
const scene=()=>createScene(definition('fractal'));
const context:GenerationInput={time:0,width:16,height:12,quality:'export'};
// Opaque response specimen: numerical correctness belongs to native-clock and
// real Worker/GPU tests, not this request/response routing suite.
const plan:FractalFreshRecordingPlan={policy:'fresh-local-source-queue-replay',simulationFps:24,encoderFps:30,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue',workUnits:9};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:0,generated:1,invalid:0,elapsedMs:0}};
function respond(w:TransportWorker,r:GenerationRequest){w.emit({operation:'fractal-recording-plan',sessionId:r.sessionId,id:r.id,result:plan});}
afterEach(()=>{for(const client of clients.splice(0))client.dispose();TransportWorker.instances=[];vi.unstubAllGlobals();});

describe('Fractal fresh recording client transport',()=>{
 it('uses its named module Worker contract and preserves distinct simulation/encoder rates',async()=>{
  const client=setup(),document=scene(),pending=client.planFractalFreshRecording(document,24,30),w=worker(),request=w.messages[0];
  expect(w.url.pathname).toMatch(/\/generate\.worker\.ts$/);expect(w.options).toEqual({type:'module'});
  expect(request).toEqual({operation:'fractal-recording-plan',sessionId:1,id:1,scene:document,simulationFps:24,encoderFps:30});
  respond(w,request);expect(await pending).toBe(plan);
 });
 it('routes concurrent plan results by request ID and ignores foreign sessions and unknown requests',async()=>{
  const client=setup(),first=client.planFractalFreshRecording(scene(),24,30),w=worker(),a=w.messages[0];
  const second=client.planFractalFreshRecording(scene(),24,30),b=w.messages[1],settled=vi.fn();first.then(settled);
  expect(b.id).toBeGreaterThan(a.id);expect(b.sessionId).toBe(a.sessionId);
  w.emit({operation:'fractal-recording-plan',sessionId:a.sessionId+1,id:a.id,result:plan});
  w.emit({operation:'fractal-recording-plan',sessionId:a.sessionId,id:999999,result:plan});
  respond(w,b);expect(await second).toBe(plan);expect(settled).not.toHaveBeenCalled();
  respond(w,a);expect(await first).toBe(plan);
 });
 it('rejects a matching request with the wrong operation instead of accepting another planner result',async()=>{
  const client=setup(),pending=client.planFractalFreshRecording(scene(),24,30),w=worker(),r=w.messages[0];
  w.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output});
  await expect(pending).rejects.toThrow('响应与请求类型不一致');
 });
 it('preserves an owning Worker failure reason and permits a subsequent request',async()=>{
  const client=setup(),pending=client.planFractalFreshRecording(scene(),24,30),w=worker(),r=w.messages[0];
  w.emit({operation:'fractal-recording-plan',id:r.id,sessionId:r.sessionId,error:'源队列工作预算不足'});
  await expect(pending).rejects.toThrow('源队列工作预算不足');
  const next=client.planFractalFreshRecording(scene(),24,30);respond(w,w.messages.at(-1)!);expect(await next).toBe(plan);
 });
 it('terminates on cancellation, rejects all pending work, and ignores late retired-session responses',async()=>{
  const client=setup(),first=client.planFractalFreshRecording(scene(),24,30).catch(error=>error),old=worker(),oldRequest=old.messages[0];
  const drawing=client.generate(scene(),context).catch(error=>error);
  client.cancel();expect(old.terminated).toBe(true);
  expect(await first).toMatchObject({name:'AbortError'});expect(await drawing).toMatchObject({name:'AbortError'});
  // A late response before and after replacement cannot resurrect old work.
  respond(old,oldRequest);
  const next=client.planFractalFreshRecording(scene(),24,30),current=worker(),request=current.messages[0],settled=vi.fn();next.then(settled);
  expect(current).not.toBe(old);expect(request.sessionId).toBeGreaterThan(oldRequest.sessionId);expect(request.id).toBeGreaterThan(oldRequest.id);
  old.emit({operation:'fractal-recording-plan',sessionId:oldRequest.sessionId,id:request.id,result:plan});
  old.onerror?.({message:'late retired crash'});await Promise.resolve();expect(settled).not.toHaveBeenCalled();expect(current.terminated).toBe(false);
  respond(current,request);expect(await next).toBe(plan);
 });
 it('rejects all pending plans on a Worker crash and starts a fresh session on retry',async()=>{
  const client=setup(),first=client.planFractalFreshRecording(scene(),24,30).catch(e=>e),old=worker(),a=old.messages[0];
  const second=client.planFractalFreshRecording(scene(),24,30).catch(e=>e);
  old.onerror?.({message:'module failed'});expect(old.terminated).toBe(true);expect((await first).message).toBe('module failed');expect((await second).message).toBe('module failed');
  const retry=client.planFractalFreshRecording(scene(),24,30),current=worker(),r=current.messages[0];expect(r.sessionId).toBeGreaterThan(a.sessionId);respond(current,r);await retry;
 });
 it('rejects synchronous postMessage failure and removes that pending request',async()=>{
  const client=setup(),first=client.planFractalFreshRecording(scene(),24,30),w=worker();respond(w,w.messages[0]);await first;
  const send=w.postMessage;w.postMessage=()=>{throw new DOMException('cannot clone','DataCloneError');};
  await expect(client.planFractalFreshRecording(scene(),24,30)).rejects.toMatchObject({name:'DataCloneError'});
  w.postMessage=send;const next=client.planFractalFreshRecording(scene(),24,30);respond(w,w.messages.at(-1)!);await next;
 });
 it.each([undefined,null,false,0,'invalid',{displayFrame:NaN,simulationFps:0},{displayFrame:1.5,simulationFps:Infinity}])('preserves malformed-but-present recording input for its owner: %j',async raw=>{
  const client=setup(),input={...context,fractalRecording:raw as unknown as GenerationInput['fractalRecording']};
  const pending=client.generate(scene(),input),w=worker(),r=w.messages[0];
  if(r.operation!=='generate')throw Error('wrong operation');
  expect(Object.hasOwn(r.context,'fractalRecording')).toBe(raw!==undefined);expect(r.context.fractalRecording).toEqual(raw);
  w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output});await pending;
 });
 it('deep copies recording inputs before posting without mutating or sanitizing their unknown nested values',async()=>{
  const raw={displayFrame:0,simulationFps:24,unexpected:{values:[NaN,2]}},input={...context,fractalRecording:raw};
  const snapshot=snapshotGenerationInput(input);expect(snapshot.fractalRecording).not.toBe(raw);
  const client=setup(),pending=client.generate(scene(),input),w=worker(),r=w.messages[0];if(r.operation!=='generate')throw Error('wrong operation');
  expect(r.context.fractalRecording).not.toBe(raw);raw.displayFrame=9;raw.unexpected.values[1]=8;
  const expected={displayFrame:0,simulationFps:24,unexpected:{values:[NaN,2]}};
  expect(snapshot.fractalRecording).toEqual(expected);expect(r.context.fractalRecording).toEqual(expected);
  w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output});await pending;
 });
});
