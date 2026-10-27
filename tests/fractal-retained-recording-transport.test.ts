import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {GenerationQueue} from '../src/engine/generationQueue';
import {SourceRecordingOperationError,type GenerationRequest,type GenerationResponse,type SourceRecordingHandle,type SourceRecordingStart,type SourceRecordingStop,type SourceRecordingRaster} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument} from '../src/types';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';

const owners=vi.hoisted(()=>({active:false,primary:false,generate:vi.fn(),reset:vi.fn(),fractal:{beginRecording:vi.fn(),nextRecordingFrame:vi.fn(),finishRecording:vi.fn(),ownsRecording:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()}}));
vi.mock('../src/engine/temporal',()=>({generateScene:owners.generate,generateSceneAsync:async(...args:unknown[])=>owners.generate(...args),TemporalGenerationSession:class{sourceFractal=owners.fractal;reset=owners.reset;}}));
vi.mock('../src/scenes',()=>({definition:()=>({dimension:2})}));
const author={id:'fractal',kind:'fractal',name:'staged author'} as SceneDocument,anchor={...author,name:'last full load'};
const context:GenerationInput={time:2,width:4,height:4,quality:'preview',fractalPixelDensity:1,fractalViewport:{logicalWidth:4,logicalHeight:4,target:'primary'},fractalLive:{sessionId:'retained',revision:3,intent:'hot',startAt:.2,actualFrameRate:59,clock:{paused:true,timestampMs:1000}}};
const primary:GenerationInput={...context,time:0,fractalLive:{...context.fractalLive!,clock:{paused:false}}};
const clock={simulationFps:10,warmupUpdates:1 as const,updates:3,encodedFrames:2,firstEncodedUpdate:2 as const,lastDisplayFrame:2,completionReason:'animation-queue' as const};
const options={width:2,height:2,simulationFps:10};
// These pixels and facts are transport fixtures, not GPU or original-runtime
// evidence. Owner/render correctness has separate production-bound coverage.
function raster(index:number,mode:'initial'|'recording'|'stopped'='recording'):SourceRecordingRaster {
 const fixed=mode==='recording',snapshot=mode==='stopped',size=fixed?6:4,time=mode==='initial'?2:(index+1)/10,complete=index===2,queueIndex=complete?1:0;
 return{type:'raster',width:size,height:size,pixels:new Uint8ClampedArray(size*size*4),stats:{samples:1,generated:size*size,invalid:0},
  formulaPresentation:{referenceWidth:4,referenceHeight:4,labels:[]},
  fractalRender:{profile:FRACTAL_SOURCE_NUMERIC_PROFILE,execution:{backend:'webgl2'},requestedSize:[size,size],rasterSize:[size,size]} as unknown as SourceRecordingRaster['fractalRender'],
  fractalLive:{sessionId:'retained',revision:3,clock:fixed?'fixed-source-queue':'realtime-source-queue',clockSource:fixed?'fixed-step':'worker-wall-clock',target:fixed?'offscreen':'primary',renderKind:snapshot?'snapshot':'update',sceneTime:time,rawDt:snapshot?0:.1,activeDt:snapshot?0:.1,queueIndex,queueComplete:complete,paused:mode==='initial',updateOrdinal:index,objectUpdates:snapshot?0:1,actualFrameRate:fixed?10:59,
   presentation:{settings:{centerX:1},evaluatedFractalScene:{displayFrame:index,simulationFps:10,scene:{sceneTime:time,queueIndex,queueComplete:complete}}} as unknown as NonNullable<SourceRecordingRaster['fractalLive']>['presentation']},
  ...(fixed?{fractalRecording:{displayFrame:index,simulationFps:10,warmup:index===0,complete,queueIndex,sceneTime:time}}:{})};
}
const startResult=()=>({scene:anchor,context:structuredClone(primary),clock:{...clock},warmup:raster(0)});
const stopResult=(index=2)=>({scene:structuredClone(author),context:{...structuredClone(primary),time:(index+1)/10},preview:raster(index,'stopped')});
class FakeWorker {
 static all:FakeWorker[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;
 constructor(){FakeWorker.all.push(this);}postMessage(value:GenerationRequest){this.messages.push(structuredClone(value));}terminate(){this.terminated=true;}
 emit(value:GenerationResponse){this.onmessage?.({data:value});}
}
async function client(input=context){
 vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),output=raster(0,'initial'),pending=generator.generate(author,input),worker=FakeWorker.all.at(-1)!,request=worker.messages.at(-1)!;
 worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});await pending;return{generator,worker,output};
}
async function started(){
 const f=await client(),pending=f.generator.beginSourceRecording(f.output,options),request=f.worker.messages.at(-1)!;
 f.worker.emit({operation:'source-recording-begin',id:request.id,sessionId:request.sessionId,recordingId:request.id,result:startResult()});return{...f,start:await pending};
}
afterEach(()=>vi.unstubAllGlobals());
describe('retained Fractal recording client',()=>{
 it('accepts full-quality primary rendering and preserves its sampling quality through stop',async()=>{
  const f=await client({...context,quality:'export'}),begin=f.generator.beginSourceRecording(f.output,options),r=f.worker.messages.at(-1)!,result=startResult();result.context.quality='export';
  f.worker.emit({operation:'source-recording-begin',id:r.id,sessionId:r.sessionId,recordingId:r.id,result});const {handle}=await begin;
  const finish=f.generator.finishSourceRecording(handle),last=f.worker.messages.at(-1)!,stop=stopResult(0);stop.context.quality='export';
  f.worker.emit({operation:'source-recording-finish',id:last.id,sessionId:last.sessionId,recordingId:handle.recordingId,result:stop});expect((await finish).context.quality).toBe('export');expect(f.worker.terminated).toBe(false);f.generator.dispose();
 });
 it.each(['preview','export'] as const)('accepts a smaller stop raster only when the original sampling quality permits it: %s',async quality=>{
  const f=await client({...context,quality}),begin=f.generator.beginSourceRecording(f.output,options),r=f.worker.messages.at(-1)!,result=startResult();result.context.quality=quality;
  f.worker.emit({operation:'source-recording-begin',id:r.id,sessionId:r.sessionId,recordingId:r.id,result});const {handle}=await begin;
  const finish=f.generator.finishSourceRecording(handle),caught=finish.catch(e=>e),last=f.worker.messages.at(-1)!,stop=stopResult(0);stop.context.quality=quality;
  stop.preview.width=2;stop.preview.height=2;stop.preview.pixels=new Uint8ClampedArray(16);stop.preview.fractalRender!.rasterSize=[2,2];
  f.worker.emit({operation:'source-recording-finish',id:last.id,sessionId:last.sessionId,recordingId:handle.recordingId,result:stop});
  if(quality==='preview'){expect(await caught).toBe(stop);expect(f.worker.terminated).toBe(false);expect(stop.preview.fractalRender!.requestedSize).toEqual([4,4]);}
  else{expect(await caught).toMatchObject({recordingRetained:false});expect(f.worker.terminated).toBe(true);}
  f.generator.dispose();
 });
 it('leases the exact live preview, validates actual fixed frames and adopts an unadvanced running stop snapshot',async()=>{
  const f=await client();await expect(f.generator.beginSourceRecording({...f.output},options)).rejects.toThrow('主预览');
  const begin=f.generator.beginSourceRecording(f.output,options),request=f.worker.messages.at(-1)!;
  await expect(f.generator.generate(author,context)).rejects.toThrow('录制期间');
  f.worker.emit({operation:'source-recording-begin',id:request.id,sessionId:request.sessionId,recordingId:request.id,result:startResult()});const {handle}=await begin;
  f.generator.cancel();expect(f.worker.terminated).toBe(false);
  await expect(f.generator.nextSourceRecordingFrame(handle,2)).rejects.toMatchObject({recordingRetained:true});
  for(const index of [1,2]){
   const frame=f.generator.nextSourceRecordingFrame(handle,index),r=f.worker.messages.at(-1)!;
   f.worker.emit({operation:'source-recording-frame',id:r.id,sessionId:r.sessionId,recordingId:handle.recordingId,displayFrame:index,output:raster(index)});expect((await frame).fractalRecording?.complete).toBe(index===2);
  }
  await expect(f.generator.nextSourceRecordingFrame(handle,3)).rejects.toMatchObject({recordingRetained:true});
  const finish=f.generator.finishSourceRecording(handle),last=f.worker.messages.at(-1)!,stop=stopResult();
  f.worker.emit({operation:'source-recording-finish',id:last.id,sessionId:last.sessionId,recordingId:handle.recordingId,result:stop});expect(await finish).toBe(stop);expect(f.generator.hasSourceRecording(handle)).toBe(false);
  const pause=f.generator.setFractalPaused(stop.preview,true),p=f.worker.messages.at(-1)!;expect(p).toMatchObject({operation:'fractal-playback',sourceId:last.id});
  f.worker.emit({operation:'fractal-playback',id:p.id,sessionId:p.sessionId,sourceId:last.id,paused:true});await pause;f.generator.dispose();
 });
 it.each(['profile','raster-size','physical-size','early-complete','clock','missing-plan'] as const)('rejects malformed warmup proof: %s',async mismatch=>{
  const f=await client(),pending=f.generator.beginSourceRecording(f.output,options),caught=pending.catch(e=>e),r=f.worker.messages.at(-1)!,result=startResult();
  if(mismatch==='profile')Object.assign(result.warmup.fractalRender!,{profile:'local-v1'});
  else if(mismatch==='raster-size')result.warmup.fractalRender!.rasterSize=[2,2];
  else if(mismatch==='physical-size'){result.warmup.width=2;result.warmup.height=2;result.warmup.pixels=new Uint8ClampedArray(16);result.warmup.fractalRender!.rasterSize=[2,2];}
  else if(mismatch==='early-complete')Object.assign(result.warmup.fractalRecording!,{complete:true});
  else if(mismatch==='clock')Object.assign(result.warmup.fractalLive!,{clock:'realtime-source-queue'});
  else Object.assign(result,{clock:undefined});
  f.worker.emit({operation:'source-recording-begin',id:r.id,sessionId:r.sessionId,recordingId:r.id,result});expect(await caught).toMatchObject({recordingRetained:false});expect(f.worker.terminated).toBe(true);f.generator.dispose();
 });
 it.each(['ordinal','complete','time','missing-pixels'] as const)('rejects a delivered frame whose actual evidence disagrees: %s',async mismatch=>{
  const f=await started(),pending=f.generator.nextSourceRecordingFrame(f.start.handle,1),caught=pending.catch(e=>e),r=f.worker.messages.at(-1)!,output=raster(1);
  if(mismatch==='ordinal')Object.assign(output.fractalRecording!,{displayFrame:2});
  else if(mismatch==='complete')Object.assign(output.fractalRecording!,{complete:true});
  else if(mismatch==='time')Object.assign(output.fractalRecording!,{sceneTime:2});
  else output.pixels=new Uint8ClampedArray(0);
  f.worker.emit({operation:'source-recording-frame',id:r.id,sessionId:r.sessionId,recordingId:f.start.handle.recordingId,displayFrame:1,output});expect(await caught).toMatchObject({recordingRetained:false});expect(f.worker.terminated).toBe(true);f.generator.dispose();
 });
 it('retains failed delivery and finish leases without losing their Fractal validation state',async()=>{
  const f=await started(),{handle}=f.start;
  for(const phase of ['frame','finish'] as const){
   const pending=phase==='frame'?f.generator.nextSourceRecordingFrame(handle,1):f.generator.finishSourceRecording(handle),caught=pending.catch(e=>e),r=f.worker.messages.at(-1)!;
   f.worker.emit({operation:phase==='frame'?'source-recording-frame':'source-recording-finish',id:r.id,sessionId:r.sessionId,error:'publication failure',retainedRecordingId:handle.recordingId});expect(await caught).toMatchObject({recordingRetained:true,handle});
  }
  const finish=f.generator.finishSourceRecording(handle),r=f.worker.messages.at(-1)!;
  f.worker.emit({operation:'source-recording-finish',id:r.id,sessionId:r.sessionId,recordingId:handle.recordingId,result:stopResult(0)});await finish;expect(f.worker.terminated).toBe(false);f.generator.dispose();
 });
 it('allows only finish after a retained begin error whose warmup was not delivered',async()=>{
  const f=await client(),pending=f.generator.beginSourceRecording(f.output,options),caught=pending.catch(e=>e),r=f.worker.messages.at(-1)!;
  f.worker.emit({operation:'source-recording-begin',id:r.id,sessionId:r.sessionId,error:'warmup delivery',retainedRecordingId:r.id});const error=await caught;
  await expect(f.generator.nextSourceRecordingFrame(error.handle,1)).rejects.toMatchObject({recordingRetained:true});
  const finish=f.generator.finishSourceRecording(error.handle),last=f.worker.messages.at(-1)!;
  f.worker.emit({operation:'source-recording-finish',id:last.id,sessionId:last.sessionId,recordingId:r.id,result:stopResult(0)});await finish;f.generator.dispose();
 });
 it.each(['update','paused','size','requested-size','logical-viewport','profile'] as const)('rejects an invalid stop snapshot: %s',async mismatch=>{
  const f=await started(),pending=f.generator.finishSourceRecording(f.start.handle),caught=pending.catch(e=>e),r=f.worker.messages.at(-1)!,result=stopResult(0);
  if(mismatch==='update')result.preview.fractalLive!.renderKind='update';
  else if(mismatch==='paused')result.context.fractalLive!.clock.paused=true;
  else if(mismatch==='size')result.context.width=5;
  else if(mismatch==='requested-size')result.preview.fractalRender!.requestedSize=[5,4];
  else if(mismatch==='logical-viewport')result.context.fractalViewport!.logicalWidth=5;
  else Object.assign(result.preview.fractalRender!,{profile:'local-v1'});
  f.worker.emit({operation:'source-recording-finish',id:r.id,sessionId:r.sessionId,recordingId:f.start.handle.recordingId,result});expect(await caught).toMatchObject({recordingRetained:false});expect(f.worker.terminated).toBe(true);f.generator.dispose();
 });
});

describe('retained Fractal recording Worker lease',()=>{
 let runtimeHandle:object,worker:{onmessage?:(event:MessageEvent<GenerationRequest>)=>Promise<void>;postMessage:ReturnType<typeof vi.fn>};
 const send=async (request:GenerationRequest)=>{await worker.onmessage!({data:request} as MessageEvent<GenerationRequest>);return worker.postMessage.mock.calls.at(-1)![0] as GenerationResponse;};
 const begin=async ()=>{await send({operation:'generate',id:1,sessionId:7,scene:author,context});return await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:1,options});};
 beforeEach(async()=>{
  vi.resetModules();vi.resetAllMocks();owners.active=false;owners.primary=false;runtimeHandle=Object.freeze({});
  owners.reset.mockImplementation(()=>{owners.active=false;owners.primary=false;});
  owners.generate.mockImplementation(()=>{owners.primary=true;return raster(0,'initial');});
  owners.fractal.beginRecording.mockImplementation(()=>{owners.active=true;owners.primary=false;return{handle:runtimeHandle,...startResult()};});
  owners.fractal.ownsRecording.mockImplementation(h=>owners.active&&h===runtimeHandle);owners.fractal.matchesCompletedPrimary.mockImplementation(()=>owners.primary);
  owners.fractal.nextRecordingFrame.mockImplementation((_h,index)=>raster(index));
  owners.fractal.finishRecording.mockImplementation(()=>{owners.active=false;owners.primary=true;return stopResult();});
  worker={postMessage:vi.fn()};vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
 });
 it('uses the retained owner and its final primary snapshot without generating an extra live frame',async ()=>{
  expect(await begin()).toMatchObject({operation:'source-recording-begin',recordingId:2,result:{scene:anchor,clock}});
  expect(owners.fractal.beginRecording).toHaveBeenCalledWith(author,context,options);
  const frame=await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1});expect(frame).toMatchObject({operation:'source-recording-frame',displayFrame:1});expect(owners.fractal.nextRecordingFrame).toHaveBeenCalledWith(runtimeHandle,1);
  const stopped=await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2});expect(stopped).toMatchObject({operation:'source-recording-finish',result:{scene:author,context:{time:.3},preview:{fractalLive:{renderKind:'snapshot',paused:false,sceneTime:.3}}}});
  expect(owners.generate).toHaveBeenCalledOnce();expect(owners.fractal.finishRecording).toHaveBeenCalledExactlyOnceWith(runtimeHandle);
  expect(await send({operation:'fractal-playback',id:5,sessionId:7,sourceId:4,paused:true})).toMatchObject({operation:'fractal-playback',sourceId:4,paused:true});
 });
 it('keeps an undelivered frame for exact retry and retains finish after publication failure',async ()=>{
  await begin();worker.postMessage.mockImplementationOnce(()=>{throw Error('frame publication');});
  expect(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1})).toMatchObject({retainedRecordingId:2});
  expect(await send({operation:'source-recording-frame',id:4,sessionId:7,recordingId:2,displayFrame:2})).toHaveProperty('error');
  expect(await send({operation:'source-recording-frame',id:5,sessionId:7,recordingId:2,displayFrame:1})).not.toHaveProperty('error');expect(owners.fractal.nextRecordingFrame).toHaveBeenCalledOnce();
  worker.postMessage.mockImplementationOnce(()=>{throw Error('finish publication');});expect(await send({operation:'source-recording-finish',id:6,sessionId:7,recordingId:2})).toMatchObject({retainedRecordingId:2});
  expect(await send({operation:'source-recording-finish',id:7,sessionId:7,recordingId:2})).not.toHaveProperty('error');expect(owners.fractal.finishRecording).toHaveBeenCalledOnce();expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('retains a failed snapshot redraw for finish retry and never substitutes generic generation',async ()=>{
  await begin();owners.fractal.finishRecording.mockImplementationOnce(()=>{throw Error('snapshot readback');});
  expect(await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2})).toMatchObject({error:'snapshot readback',retainedRecordingId:2});
  expect(await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2})).not.toHaveProperty('error');expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('reacquires detached stop pixels through the same owner handoff without a live update',async ()=>{
  await begin();worker.postMessage.mockImplementationOnce(message=>{structuredClone(message.result.preview.pixels,{transfer:[message.result.preview.pixels.buffer]});throw Error('detached stop publication');});
  expect(await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2})).toMatchObject({error:'detached stop publication',retainedRecordingId:2});
  const response=await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2});expect(response).not.toHaveProperty('error');
  expect(owners.fractal.finishRecording.mock.calls).toEqual([[runtimeHandle],[runtimeHandle]]);expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('rejects foreign requests and revokes a failed runtime using owner proof',async ()=>{
  await begin();const resets=owners.reset.mock.calls.length;
  expect(await send({operation:'generate',id:3,sessionId:7,scene:author,context})).toMatchObject({retainedRecordingId:2});
  expect(await send({operation:'source-recording-frame',id:4,sessionId:8,recordingId:2,displayFrame:1})).not.toHaveProperty('retainedRecordingId');expect(owners.reset).toHaveBeenCalledTimes(resets);
  owners.fractal.nextRecordingFrame.mockImplementationOnce(()=>{owners.active=false;throw Error('render failed');});
  expect(await send({operation:'source-recording-frame',id:5,sessionId:7,recordingId:2,displayFrame:1})).not.toHaveProperty('retainedRecordingId');expect(await send({operation:'source-recording-finish',id:6,sessionId:7,recordingId:2})).toHaveProperty('error');
 });
});

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return{promise,resolve};}
async function queueFixture(){
 const handle=Object.freeze({sessionId:1,recordingId:2});let retained=false;
 const initial=raster(0,'initial'),stop=stopResult(),start:SourceRecordingStart={handle,...startResult()};
 const port={generate:vi.fn(async(_s:SceneDocument,_c:GenerationInput)=>initial),cancel:vi.fn(),dispose:vi.fn(),setFractalPaused:vi.fn(async()=>{}),
  beginSourceRecording:vi.fn(async()=>{retained=true;return start;}),nextSourceRecordingFrame:vi.fn(async(_h:SourceRecordingHandle,index:number)=>raster(index)),finishSourceRecording:vi.fn(async()=>{retained=false;return stop;}),hasSourceRecording:vi.fn((h:SourceRecordingHandle)=>retained&&h===handle)};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()},queue=new GenerationQueue(port,callbacks);queue.request(author,context);await flush();port.cancel.mockClear();callbacks.output.mockClear();
 return{queue,port,callbacks,handle,initial,stop,start};
}
describe('retained Fractal recording queue stop',()=>{
 it('preserves the exact author object and adopts the final primary without a new generate',async()=>{
  const f=await queueFixture(),frames=vi.fn();await f.queue.recordSource(f.initial,options,{frame:frames});
  expect(frames.mock.calls.map(c=>c[1])).toEqual([0,1]);expect(f.callbacks.recordingStopped.mock.calls[0][0].scene).toBe(author);
  expect(f.callbacks.output).toHaveBeenLastCalledWith(f.stop.preview,.3,author);expect(f.port.generate).toHaveBeenCalledOnce();expect(f.port.cancel).not.toHaveBeenCalled();
  await f.queue.setFractalPaused(true);expect(f.port.setFractalPaused).toHaveBeenCalledWith(f.stop.preview,true);f.queue.dispose();
 });
 it.each(['resize','stage','event'] as const)('keeps deferred %s while adopting the retained running clock and actual time',async edit=>{
  const f=await queueFixture(),wait=gate(),task=f.queue.recordSource(f.initial,options,{frame:()=>wait.promise});await flush();
  const staged=edit==='resize'?author:{...author,name:'new draft'};
  const pending={...context,width:9,fractalLive:{...context.fractalLive!,...(edit==='event'?{revision:4,intent:'hot' as const,configuration:staged}:{})}};
  f.queue.request(staged,pending);wait.resolve();await task;await flush();
  expect(f.port.generate).toHaveBeenLastCalledWith(staged,expect.objectContaining({time:.3,width:9,fractalLive:expect.objectContaining({sessionId:'retained',revision:edit==='event'?4:3,startAt:.2,clock:{paused:false},...(edit==='event'?{configuration:staged}:{})})}),expect.any(Function));
  expect(f.callbacks.recordingStopped.mock.calls[0][0].scene).toBe(staged);expect(f.port.cancel).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('keeps cancellation and failed cleanup owned until explicit finish succeeds',async()=>{
  const f=await queueFixture(),wait=gate(),controller=new AbortController(),task=f.queue.recordSource(f.initial,options,{frame:()=>wait.promise},controller.signal),caught=task.catch(e=>e);await flush();
  f.port.finishSourceRecording.mockRejectedValueOnce(new SourceRecordingOperationError('retry finish',false,true,f.handle));controller.abort();expect(f.port.finishSourceRecording).not.toHaveBeenCalled();wait.resolve();expect(await caught).toBeInstanceOf(AggregateError);expect(f.port.cancel).not.toHaveBeenCalled();
  await f.queue.retrySourceRecordingCleanup();expect(f.port.finishSourceRecording).toHaveBeenCalledTimes(2);expect(f.callbacks.output).toHaveBeenLastCalledWith(f.stop.preview,.3,author);f.queue.dispose();
 });
});
