import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import native from './fixtures/source-surface-scene/recording-native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {outputTransferState} from '../src/engine/outputBuffers';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';

// Real import, worker handler and numerical owner. Structured cloning transfers
// real geometry buffers; only publication failure is injected. No GPU draw.
let worker:{onmessage?:(e:MessageEvent<GenerationRequest>)=>void;postMessage:(data:GenerationResponse,options:{transfer:Transferable[]})=>void};
let response:GenerationResponse,sequence:number,fail:{operation:string;detached:boolean}|undefined;
beforeEach(async()=>{
 vi.resetModules();sequence=0;fail=undefined;
 worker={postMessage:(data,options)=>{
  const fault=fail?.operation===data.operation&&!('error' in data)?fail:undefined;
  if(fault){fail=undefined;if(!fault.detached)throw Error('publication failed');}
  const delivered=structuredClone(data,{transfer:options.transfer});
  if(fault)throw Error('publication failed after transfer');response=delivered;
 }};
 vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
function send(data:Omit<GenerationRequest,'id'|'sessionId'>|Record<string,unknown>){worker.onmessage!({data:{sessionId:7,id:++sequence,...data}} as MessageEvent<GenerationRequest>);return response;}
function result<O extends GenerationResponse['operation']>(response:GenerationResponse,operation:O):Extract<GenerationResponse,{operation:O}>{
 if(response.operation!==operation||'error' in response)throw Error('error' in response?response.error:'operation mismatch');return response as Extract<GenerationResponse,{operation:O}>;
}
function setup(name='animated-mesh',backend='CPU'){
 const row=native.actual.cases.find(c=>c.input.name===name)!,project=structuredClone(row.input.project);project.settings.render_mode=backend;
 const scene=parseProjectFile(JSON.stringify(project)).scene;
 const context:GenerationInput={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'surface-wire',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29}};
 const first=result(send({operation:'generate',scene,context}),'generate');
 return{row,scene,context,sourceId:first.id,options:{width:17,height:13,simulationFps:4,actualFrameRate:37}};
}
function begin(f:ReturnType<typeof setup>){return result(send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options}),'source-recording-begin');}
describe('Surface recording production worker transport',()=>{
 for(const row of native.actual.cases)it('matches original numerical frames after real buffer transfer: '+row.input.name,()=>{
  const f=setup(row.input.name),start=begin(f);expect(start.result.clock.updates).toBe(row.frames.length);
  for(const [i,expected]of row.frames.entries()){
   const out=i===0?start.result.warmup:result(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:i,actualFrameRate:row.input.steps[i].actualFrameRate}),'source-recording-frame').output;
   if(out.type!=='geometry')throw Error('expected geometry');
   expect(out.surfaceLive!.frame).toMatchObject({frameIndex:i,sceneTime:expected.state.sceneTime,rawDt:expected.state.rawDt,queueComplete:expected.autoComplete});
   expect(out.positions[0]).toBe(expected.state.mode==='MESH'?Math.fround(expected.state.value.value):expected.state.firstPosition![0]);
  }
  const stop=result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  if(stop.result.preview.type!=='geometry')throw Error('expected geometry');
  const frame=stop.result.preview.surfaceLive!.frame;expect(frame.frameIndex).toBe(row.frames.length-1);
  result(send({operation:'surface-playback',sourceId:stop.id,paused:true}),'surface-playback');
  const current=result(send({operation:'surface-current',sourceId:stop.id}),'surface-current');
  expect(current.output.type==='geometry'&&current.output.surfaceLive!.frame).toEqual(frame);
 });
 it('transfers GPU descriptors with legitimately empty CPU positions',()=>{
  const start=begin(setup('animated-mesh','GPU')),out=start.result.warmup;if(out.type!=='geometry')throw Error('expected geometry');
  expect(out.positions.length).toBe(0);expect(out.sourceGpuMesh!.seeds.byteLength).toBeGreaterThan(0);
  expect(result(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:24}),'source-recording-frame').output).toHaveProperty('sourceGpuMesh');
  result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
 });
 it.each([false,true])('stops an undelivered warmup without another update (detached=%s)',detached=>{
  const f=setup();fail={operation:'source-recording-begin',detached};const error=send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options});
  if(!('error' in error))throw Error('expected failure');expect(error.retainedRecordingId).toBe(sequence);
  const stop=result(send({operation:'source-recording-finish',recordingId:error.retainedRecordingId}),'source-recording-finish');expect(stop.result.preview).toMatchObject({surfaceLive:{frame:{frameIndex:0}}});
 });
 it.each([false,true])('retains failed frame publication and never consumes it twice (detached=%s)',detached=>{
  const start=begin(setup());fail={operation:'source-recording-frame',detached};const request={operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:24};
  expect(send(request)).toMatchObject({retainedRecordingId:start.recordingId});
  expect(send({...request,actualFrameRate:12})).toHaveProperty('error');expect(send({...request,displayFrame:2})).toHaveProperty('error');
  const retried=send(request);if(detached)expect(retried).toMatchObject({error:expect.stringContaining('传输状态未知'),retainedRecordingId:start.recordingId});else expect(retried).toMatchObject({output:{surfaceLive:{frame:{frameIndex:1}}}});
  const stop=result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');expect(stop.result.preview).toMatchObject({surfaceLive:{frame:{frameIndex:1}}});
 });
 it.each([false,true])('rebuilds detached stop geometry from its retained handoff (detached=%s)',detached=>{
  const start=begin(setup()),frame=result(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:24}),'source-recording-frame').output;
  fail={operation:'source-recording-finish',detached};expect(send({operation:'source-recording-finish',recordingId:start.recordingId})).toMatchObject({retainedRecordingId:start.recordingId});
  expect(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:2,actualFrameRate:12})).toHaveProperty('error');
  const stop=result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  if(frame.type!=='geometry'||stop.result.preview.type!=='geometry')throw Error('expected geometry');
  expect(stop.result.preview.positions).toEqual(frame.positions);expect(stop.result.preview.surfaceLive!.frame).toEqual(frame.surfaceLive!.frame);
  expect(send({operation:'source-recording-finish',recordingId:start.recordingId})).toHaveProperty('error');
 });
 it('distinguishes a legitimate empty geometry buffer from a detached empty buffer',()=>{
  const output={type:'geometry' as const,topology:'points' as const,positions:new Float32Array(),stats:{samples:0,generated:0,invalid:0,elapsedMs:0}};
  const storage=outputTransferState(output);expect(storage.intact()).toBe(true);
  structuredClone(output,{transfer:[output.positions.buffer]});expect(storage.intact()).toBe(false);
 });
 it('rejects oversized admission, foreign sessions and stale handles while retaining the actual owner',()=>{
  const f=setup();expect(send({operation:'source-recording-begin',sourceId:f.sourceId,options:{...f.options,width:999999}})).toMatchObject({retainedSourceId:f.sourceId});
  const start=begin(f);
  expect(send({operation:'generate',scene:f.scene,context:f.context})).toMatchObject({retainedRecordingId:start.recordingId});
  expect(send({operation:'source-recording-frame',recordingId:999,displayFrame:1,actualFrameRate:24})).toMatchObject({retainedRecordingId:start.recordingId});
  expect(send({operation:'source-recording-finish',sessionId:8,recordingId:start.recordingId})).not.toHaveProperty('retainedRecordingId');
  result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
 });
});
