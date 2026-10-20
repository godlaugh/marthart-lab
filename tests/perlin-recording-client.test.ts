import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import type {GenerationRequest,GenerationResponse,PerlinRecordingHandle} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
class FakeWorker {
 static all:FakeWorker[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;
 constructor(){FakeWorker.all.push(this);}postMessage(value:GenerationRequest){this.messages.push(structuredClone(value));}terminate(){this.terminated=true;}
 emit(value:GenerationResponse){this.onmessage?.({data:value});}
}
const scene={id:'test',kind:'perlin',perlinSource:{backend:'cpu'}} as SceneDocument;
const context:GenerationInput={time:1,width:2,height:2,quality:'preview'};
const raster=(index=0):Extract<SceneOutput,{type:'raster'}>=>({type:'raster',width:2,height:2,pixels:new Uint8ClampedArray(16),stats:{samples:1,generated:4,invalid:0,elapsedMs:0},sourcePerlinFrame:{sourceViewport:{width:2,height:2,pixelDensity:1},samples:0,frameIndex:index,updates:index+1,queueComplete:index===2,queueIndex:0,sceneTime:index/10}});
const clock={simulationFps:10,warmupUpdates:1 as const,updates:3,encodedFrames:2,firstEncodedUpdate:2 as const,lastDisplayFrame:2,completionReason:'animation-queue' as const};
const options={width:2,height:2,simulationFps:10};
async function setup(){vi.stubGlobal('Worker',FakeWorker);const g=new Generator(),output=raster(),p=g.generate(scene,context),w=FakeWorker.all.at(-1)!,r=w.messages.at(-1)!;w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output});await p;return{g,w,output};}
async function start(){const state=await setup(),p=state.g.beginPerlinRecording(state.output,options),r=state.w.messages.at(-1)!;state.w.emit({operation:'perlin-recording-begin',sessionId:r.sessionId,id:r.id,recordingId:r.id,result:{scene,context,clock,warmup:raster()}});return{...state,started:await p};}
afterEach(()=>vi.unstubAllGlobals());
describe('Perlin recording client lease',()=>{
 it('locks the exact completed preview, preserves the worker on cancel and publishes finish preview capability',async()=>{
  const {g,w,output}=await setup();await expect(g.beginPerlinRecording({...output},options)).rejects.toThrow('主预览');
  const pending=g.beginPerlinRecording(output,options),r=w.messages.at(-1)!,before=w.messages.length;
  await expect(g.generate(scene,context)).rejects.toThrow('录制期间');await expect(g.planPerlinFreshRecording(scene,10,10)).rejects.toThrow('录制期间');
  await expect(g.searchStable(scene)).rejects.toThrow('录制期间');await expect(g.capturePerlinPaused(output,options)).rejects.toThrow('录制期间');expect(w.messages).toHaveLength(before);
  w.emit({operation:'perlin-recording-begin',id:r.id,sessionId:r.sessionId,recordingId:r.id,result:{scene,context,clock,warmup:raster()}});const {handle}=await pending;
  expect(Object.isFrozen(handle)).toBe(true);expect(g.hasPerlinRecording(handle)).toBe(true);expect(g.hasPerlinRecording({...handle})).toBe(false);
  await expect(g.nextPerlinRecordingFrame({...handle},1)).rejects.toMatchObject({recordingRetained:true,handle});g.cancel();expect(w.terminated).toBe(false);
  const next=g.nextPerlinRecordingFrame(handle,1),n=w.messages.at(-1)!;w.emit({operation:'perlin-recording-frame',id:n.id,sessionId:n.sessionId,recordingId:handle.recordingId,displayFrame:1,output:raster(1)});expect((await next).sourcePerlinFrame?.frameIndex).toBe(1);
  const finish=g.finishPerlinRecording(handle),f=w.messages.at(-1)!,preview=raster(1);w.emit({operation:'perlin-recording-finish',id:f.id,sessionId:f.sessionId,recordingId:handle.recordingId,result:{scene,context,preview}});expect((await finish).preview).toBe(preview);expect(g.hasPerlinRecording(handle)).toBe(false);
  await expect(g.finishPerlinRecording(handle)).rejects.toMatchObject({recordingRetained:false});
  const capture=g.capturePerlinPaused(preview,options),c=w.messages.at(-1)!;expect(c.operation==='perlin-paused-capture'&&c.sourceId).toBe(f.id);w.emit({operation:'perlin-paused-capture',id:c.id,sessionId:c.sessionId,result:{capture:preview,preview}});await capture;g.dispose();
 });
 it('retains begin failures only with exact owner proof and exposes a finishable handle',async()=>{
  for(const proof of ['preview','recording','none'] as const){
   const {g,w,output}=await setup(),begin=g.beginPerlinRecording(output,options),caught=begin.catch(e=>e),r=w.messages.at(-1)!;
   w.emit({operation:'perlin-recording-begin',id:r.id,sessionId:r.sessionId,error:'rejected',...(proof==='preview'&&r.operation==='perlin-recording-begin'?{retainedSourceId:r.sourceId}:proof==='recording'?{retainedRecordingId:r.id}:{})});const error=await caught;
   expect(error).toMatchObject({name:'PerlinRecordingOperationError',previewRetained:proof==='preview',recordingRetained:proof==='recording'});
   if(proof==='recording'){expect(g.hasPerlinRecording(error.handle)).toBe(true);const finish=g.finishPerlinRecording(error.handle),f=w.messages.at(-1)!;w.emit({operation:'perlin-recording-finish',id:f.id,sessionId:f.sessionId,recordingId:r.id,result:{scene,context,preview:raster()}});await finish;}
   else if(proof==='preview'){const again=g.beginPerlinRecording(output,options),handled=again.catch(e=>e);g.dispose();await handled;}
   else await expect(g.beginPerlinRecording(output,options)).rejects.toThrow('主预览');g.dispose();
  }
 });
 it('keeps retained frame and finish failures retryable, but revokes a failed runtime',async()=>{
  const {g,w,started:{handle}}=await start();
  for(const operation of ['perlin-recording-frame','perlin-recording-finish'] as const){
   const pending=operation==='perlin-recording-frame'?g.nextPerlinRecordingFrame(handle,1):g.finishPerlinRecording(handle),caught=pending.catch(e=>e),r=w.messages.at(-1)!;
   w.emit({operation,id:r.id,sessionId:r.sessionId,error:'retry',retainedRecordingId:handle.recordingId});expect(await caught).toMatchObject({recordingRetained:true,handle});expect(g.hasPerlinRecording(handle)).toBe(true);
  }
  const bad=g.nextPerlinRecordingFrame(handle,1),caught=bad.catch(e=>e),r=w.messages.at(-1)!;w.emit({operation:'perlin-recording-frame',id:r.id,sessionId:r.sessionId,error:'runtime failed'});expect(await caught).toMatchObject({recordingRetained:false});expect(g.hasPerlinRecording(handle)).toBe(false);g.dispose();
 });
 it('invalidates the worker for unknown send outcomes at begin, frame and finish',async()=>{
  for(const phase of ['begin','frame','finish'] as const){const state=phase==='begin'?{...await setup(),started:undefined}:await start(),{g,w}=state;
   w.postMessage=()=>{throw Error('send failed');};const p=phase==='begin'?g.beginPerlinRecording(state.output,options):phase==='frame'?g.nextPerlinRecordingFrame(state.started!.handle,1):g.finishPerlinRecording(state.started!.handle);
   await expect(p).rejects.toMatchObject({name:'PerlinRecordingOperationError',previewRetained:false,recordingRetained:false});expect(w.terminated).toBe(true);if(state.started)expect(g.hasPerlinRecording(state.started.handle)).toBe(false);g.dispose();}
 });
 it('ignores foreign-session responses and rejects mismatched frame identity or malformed success',async()=>{
  for(const mismatch of ['recording','frame','operation','malformed'] as const){const {g,w,started:{handle}}=await start(),p=g.nextPerlinRecordingFrame(handle,1),caught=p.catch(e=>e),r=w.messages.at(-1)!;
   w.emit({operation:'perlin-recording-frame',id:r.id,sessionId:r.sessionId+1,recordingId:handle.recordingId,displayFrame:1,output:raster(1)});expect(g.hasPerlinRecording(handle)).toBe(true);
   const response=mismatch==='operation'?{operation:'generate',id:r.id,sessionId:r.sessionId,output:raster(1)}:{operation:'perlin-recording-frame',id:r.id,sessionId:r.sessionId,recordingId:mismatch==='recording'?999:handle.recordingId,displayFrame:mismatch==='frame'?2:1,output:mismatch==='malformed'?{}:raster(1)};
   w.emit(response as GenerationResponse);expect(await caught).toMatchObject({recordingRetained:false});expect(w.terminated).toBe(true);g.dispose();}
 });
 it('hard worker failure revokes recording ownership and rejects its operation',async()=>{const {g,w,started:{handle}}=await start(),p=g.finishPerlinRecording(handle),caught=p.catch(e=>e);w.onerror?.({message:'crash'});expect(await caught).toMatchObject({name:'PerlinRecordingOperationError',recordingRetained:false});expect(g.hasPerlinRecording(handle)).toBe(false);g.dispose();});
});
