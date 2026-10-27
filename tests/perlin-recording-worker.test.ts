import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
const owners=vi.hoisted(()=>({active:false,primary:false,generate:vi.fn(),reset:vi.fn(),perlin:{beginRecording:vi.fn(),nextRecordingFrame:vi.fn(),finishRecording:vi.fn(),ownsRecording:vi.fn(),matchesCompletedPrimary:vi.fn(),capturePaused:vi.fn()}}));
vi.mock('../src/engine/temporal',()=>({generateScene:owners.generate,generateSceneAsync:async(...args:unknown[])=>owners.generate(...args),TemporalGenerationSession:class{sourcePerlin=owners.perlin;reset=owners.reset;}}));
vi.mock('../src/scenes',()=>({definition:()=>({dimension:2})}));
const scene={id:'source',kind:'perlin',perlinSource:{backend:'cpu'}} as SceneDocument;
const effective={...scene,perlinSource:{backend:'gpu'}} as SceneDocument;
const context:GenerationInput={time:2,width:4,height:4,quality:'preview',sourcePerlinViewport:{width:4,height:4,pixelDensity:1},sourceViewport:{logicalWidth:4,logicalHeight:4,referenceLogicalHeight:4,target:'primary',projectionPass:'perspective'}};
const resumed={...context,time:.1};
const raster=(frameIndex=0):Extract<SceneOutput,{type:'raster'}>=>({type:'raster',width:4,height:4,pixels:new Uint8ClampedArray(64).fill(128),stats:{samples:1,generated:16,invalid:0,elapsedMs:0},sourcePerlinFrame:{sourceViewport:{width:4,height:4,pixelDensity:1},frameIndex,updates:frameIndex+1,samples:0,queueComplete:frameIndex===2,queueIndex:0,sceneTime:frameIndex/10}});
const clock={simulationFps:10,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue'};
let runtimeHandle:object,worker:{onmessage?:(e:MessageEvent<GenerationRequest>)=>Promise<void>;postMessage:ReturnType<typeof vi.fn>};
const send=async (r:GenerationRequest)=>{await worker.onmessage!({data:r} as MessageEvent<GenerationRequest>);return worker.postMessage.mock.calls.at(-1)![0] as GenerationResponse;};
const begin=async ()=>{await send({operation:'generate',id:1,sessionId:7,scene,context});return await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:1,options:{width:4,height:4,simulationFps:10}});};
beforeEach(async()=>{
 vi.resetModules();vi.resetAllMocks();owners.active=false;owners.primary=false;runtimeHandle=Object.freeze({runtime:true});
 owners.reset.mockImplementation(()=>{owners.active=false;owners.primary=false;});
 owners.generate.mockImplementation(()=>{owners.primary=true;return raster(1);});
 owners.perlin.beginRecording.mockImplementation(()=>{owners.active=true;owners.primary=false;return{handle:runtimeHandle,scene:effective,context:{...context,time:0},clock,warmup:raster()};});
 owners.perlin.ownsRecording.mockImplementation(h=>owners.active&&h===runtimeHandle);
 owners.perlin.matchesCompletedPrimary.mockImplementation(()=>owners.primary);
 owners.perlin.nextRecordingFrame.mockImplementation((_h,index)=>raster(index));
 owners.perlin.finishRecording.mockImplementation(()=>{owners.active=false;owners.primary=false;return{scene:effective,context:resumed};});
 owners.perlin.capturePaused.mockReturnValue({capture:raster(),preview:raster()});
 worker={postMessage:vi.fn()};vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
// These owner mocks test protocol state transitions and failure retention, not
// native rendering. The real WebGL recording verifier covers the live runtime.
describe('Perlin recording worker lease ownership',()=>{
 it('routes the exact completed source and runtime handle, then refreshes primary with effective state',async ()=>{
  const started=await begin();expect(started).toMatchObject({operation:'source-recording-begin',recordingId:2,result:{scene:effective,clock}});
  expect(owners.perlin.beginRecording).toHaveBeenCalledWith(scene,context,{width:4,height:4,simulationFps:10});
  const frame=await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1});expect(frame).toMatchObject({operation:'source-recording-frame',recordingId:2,displayFrame:1});expect(owners.perlin.nextRecordingFrame).toHaveBeenCalledWith(runtimeHandle,1);
  const stop=await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2});expect(stop).toMatchObject({operation:'source-recording-finish',recordingId:2,result:{scene:effective,context:resumed}});
  expect(owners.perlin.finishRecording).toHaveBeenCalledExactlyOnceWith(runtimeHandle);expect(owners.generate).toHaveBeenLastCalledWith(effective,resumed,expect.anything());
  const captured=await send({operation:'perlin-paused-capture',id:5,sessionId:7,sourceId:4,size:{width:4,height:4},scale:1});expect(captured).not.toHaveProperty('error');
  expect(owners.perlin.capturePaused).toHaveBeenCalledWith(effective,expect.objectContaining({time:.1}),expect.anything());
 });
 it('rejects ordinary tasks, foreign sessions and stale handles without resetting the active lease',async ()=>{
  await begin();const resetCount=owners.reset.mock.calls.length;
  const requests:GenerationRequest[]=[{operation:'generate',id:3,sessionId:7,scene,context},{operation:'perlin-paused-capture',id:4,sessionId:7,sourceId:1,size:{width:4,height:4},scale:1},{operation:'perlin-recording-plan',id:5,sessionId:7,scene,simulationFps:10,encoderFps:10},{operation:'search-stable',id:6,sessionId:7,scene,options:{}},{operation:'source-recording-frame',id:7,sessionId:7,recordingId:999,displayFrame:1},{operation:'source-recording-frame',id:8,sessionId:8,recordingId:2,displayFrame:1}];
  for(const request of requests){const response=await send(request);expect(response).toHaveProperty('error');if(request.sessionId===7)expect(response).toHaveProperty('retainedRecordingId',2);else expect(response).not.toHaveProperty('retainedRecordingId');}
  expect(owners.reset).toHaveBeenCalledTimes(resetCount);expect(owners.generate).toHaveBeenCalledTimes(1);expect(owners.perlin.nextRecordingFrame).not.toHaveBeenCalled();
  expect(await send({operation:'source-recording-frame',id:9,sessionId:7,recordingId:2,displayFrame:1})).not.toHaveProperty('error');
 });
 it('requires the exact completed source and preserves only runtime-proven previews on begin failure',async ()=>{
  await send({operation:'generate',id:1,sessionId:7,scene,context});
  expect(await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:999,options:{width:4,height:4,simulationFps:10}})).toHaveProperty('error');expect(owners.perlin.beginRecording).not.toHaveBeenCalled();
  owners.perlin.beginRecording.mockImplementationOnce(()=>{throw Error('preflight');});
  expect(await send({operation:'source-recording-begin',id:3,sessionId:7,sourceId:1,options:{width:4,height:4,simulationFps:10}})).toMatchObject({error:'preflight',retainedSourceId:1});
  owners.perlin.beginRecording.mockImplementationOnce(()=>{owners.primary=false;throw Error('mutated then failed');});
  const failed=await send({operation:'source-recording-begin',id:4,sessionId:7,sourceId:1,options:{width:4,height:4,simulationFps:10}});expect(failed).toHaveProperty('error');expect(failed).not.toHaveProperty('retainedSourceId');
 });
 it('retains a warmup completed before its response failed, allowing orderly finish',async ()=>{
  await send({operation:'generate',id:1,sessionId:7,scene,context});worker.postMessage.mockImplementationOnce(()=>{throw Error('warmup send failed');});
  expect(await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:1,options:{width:4,height:4,simulationFps:10}})).toMatchObject({error:'warmup send failed',retainedRecordingId:2});
  expect(await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2})).not.toHaveProperty('error');expect(owners.perlin.beginRecording).toHaveBeenCalledOnce();
 });
 it('retries an undelivered frame without advancing again and rejects a later frame until delivery',async ()=>{
  await begin();worker.postMessage.mockImplementationOnce(()=>{throw Error('frame send failed');});
  expect(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1})).toMatchObject({retainedRecordingId:2,error:'frame send failed'});
  expect(await send({operation:'source-recording-frame',id:4,sessionId:7,recordingId:2,displayFrame:2})).toHaveProperty('error');
  expect(await send({operation:'source-recording-frame',id:5,sessionId:7,recordingId:2,displayFrame:1})).not.toHaveProperty('error');expect(owners.perlin.nextRecordingFrame).toHaveBeenCalledOnce();
 });
 it('retains recoverable bad-index failures but revokes a failed runtime',async ()=>{
  await begin();owners.perlin.nextRecordingFrame.mockImplementationOnce(()=>{throw Error('index');});expect(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:99})).toMatchObject({retainedRecordingId:2,error:'index'});
  owners.perlin.nextRecordingFrame.mockImplementationOnce(()=>{owners.active=false;throw Error('model failed');});const response=await send({operation:'source-recording-frame',id:4,sessionId:7,recordingId:2,displayFrame:1});expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedRecordingId');
  expect(await send({operation:'source-recording-finish',id:5,sessionId:7,recordingId:2})).toHaveProperty('error');expect(owners.perlin.finishRecording).not.toHaveBeenCalled();
 });
 it('retries failed finish publication without stopping or rendering twice and rejects duplicate successful finish',async ()=>{
  await begin();worker.postMessage.mockImplementationOnce(()=>{throw Error('finish send failed');});expect(await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2})).toMatchObject({retainedRecordingId:2,error:'finish send failed'});
  expect(await send({operation:'source-recording-frame',id:4,sessionId:7,recordingId:2,displayFrame:1})).toHaveProperty('error');
  expect(await send({operation:'source-recording-finish',id:5,sessionId:7,recordingId:2})).not.toHaveProperty('error');expect(owners.perlin.finishRecording).toHaveBeenCalledOnce();expect(owners.generate).toHaveBeenCalledTimes(2);
  expect(await send({operation:'source-recording-finish',id:6,sessionId:7,recordingId:2})).toHaveProperty('error');expect(owners.perlin.finishRecording).toHaveBeenCalledOnce();
  expect(await send({operation:'perlin-paused-capture',id:7,sessionId:7,sourceId:5,size:{width:4,height:4},scale:1})).not.toHaveProperty('error');
 });
 it('retains ownership after an ambiguous transferred response and re-reads a detached finish preview',async ()=>{
  await begin();
  const transferThenFail=(data:unknown,options:{transfer:Transferable[]})=>{structuredClone(data,{transfer:options.transfer});throw Error('ambiguous delivered response');};
  worker.postMessage.mockImplementationOnce(transferThenFail);
  expect(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1})).toMatchObject({retainedRecordingId:2});
  const retry=await send({operation:'source-recording-frame',id:4,sessionId:7,recordingId:2,displayFrame:1});
  expect(retry).toHaveProperty('error');expect(retry).toHaveProperty('retainedRecordingId',2);expect(owners.perlin.nextRecordingFrame).toHaveBeenCalledOnce();
  worker.postMessage.mockImplementationOnce(transferThenFail);
  expect(await send({operation:'source-recording-finish',id:5,sessionId:7,recordingId:2})).toMatchObject({retainedRecordingId:2});
  expect(await send({operation:'source-recording-finish',id:6,sessionId:7,recordingId:2})).not.toHaveProperty('error');
  expect(owners.perlin.finishRecording).toHaveBeenCalledOnce();expect(owners.generate).toHaveBeenCalledTimes(3);
  expect(owners.generate).toHaveBeenLastCalledWith(effective,resumed,expect.anything());
 });
 it('re-reads a detached live finish preview through its retained owner without generation or another update',async ()=>{
  await begin();const liveContext={...resumed,perlinLive:{sessionId:'retained',clock:{paused:false}}};
  owners.perlin.finishRecording.mockImplementation(()=>{owners.active=false;owners.primary=true;return{scene:effective,context:liveContext,preview:raster(2)};});
  worker.postMessage.mockImplementationOnce((data:unknown,options:{transfer:Transferable[]})=>{structuredClone(data,{transfer:options.transfer});throw Error('delivered then send threw');});
  expect(await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2})).toMatchObject({retainedRecordingId:2});
  expect(await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2})).not.toHaveProperty('error');
  expect(owners.perlin.finishRecording).toHaveBeenCalledTimes(2);expect(owners.generate).toHaveBeenCalledTimes(1);
 });
 it('invalidates the lease if the required primary refresh fails',async ()=>{
  await begin();owners.generate.mockImplementationOnce(()=>{owners.primary=false;throw Error('primary failed');});const response=await send({operation:'source-recording-finish',id:3,sessionId:7,recordingId:2});expect(response).toHaveProperty('error','primary failed');expect(response).not.toHaveProperty('retainedRecordingId');
  expect(await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2})).toHaveProperty('error');expect(owners.perlin.finishRecording).toHaveBeenCalledOnce();
 });
});
