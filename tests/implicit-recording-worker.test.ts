import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
import {serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
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
function send(data:Record<string,unknown>){worker.onmessage!({data:structuredClone({sessionId:7,id:++sequence,...data})} as MessageEvent<GenerationRequest>);return response;}
function result<O extends GenerationResponse['operation']>(response:GenerationResponse,operation:O):Extract<GenerationResponse,{operation:O}>{
 if(response.operation!==operation||'error' in response)throw Error('error' in response?response.error:'operation mismatch');return response as Extract<GenerationResponse,{operation:O}>;
}
function setup(name='fps4-varying',full=false,unsupported=false){
 const row=native.cases.find(c=>c.name===name)!,project=structuredClone(row.input.project);
 if(!full)project.settings.x_segments=project.settings.y_segments=project.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(project)).scene;
 if(unsupported){scene.parameters.a=0;scene.timeline.tracks.push({...scene.timeline.tracks[1],id:'unsupported-parameter',actions:[{id:'parameter-action',method:'paramStart',parameters:[{target:'parameters.a',step:.1,min:0,max:1,enabled:true}]}]});}
 const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
 const first=result(send({operation:'generate',scene,context}),'generate');
 return{row,scene,context,sourceId:first.id,options:{width:128,height:96,simulationFps:row.input.simulationFps,actualFrameRate:row.input.steps[0].actualFrameRate}};
}
function begin(f:ReturnType<typeof setup>){return result(send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options}),'source-recording-begin');}
describe('Implicit recording production Worker transport',()=>{
 for(const row of native.cases)it('matches original clock/camera after real geometry buffer transfer: '+row.name,()=>{
  const f=setup(row.name,true),start=begin(f);expect(start.result.clock).toMatchObject({updates:row.frames.length,encodedFrames:row.frames.length-1,warmupUpdates:1});
  for(const [i,expected]of row.frames.entries()){
   const out=i===0?start.result.warmup:result(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:i,actualFrameRate:row.input.steps[i].actualFrameRate}),'source-recording-frame').output;
   if(out.type!=='geometry')throw Error('geometry');
   expect(out.positions.byteLength).toBeGreaterThan(0);expect(out.sourceImplicitPresentation).toBeDefined();
   expect(out.implicitRecording).toEqual({displayFrame:i,simulationFps:row.input.simulationFps,actualFrameRate:row.input.steps[i].actualFrameRate,warmup:i===0,complete:expected.complete});
   const {phiRate:_,thetaRate:__,gammaRate:___,...camera}=expected.camera;
   expect(out.sourceCameraFrame).toMatchObject({frameIndex:i,sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueComplete:expected.complete,rates:[expected.camera.phiRate,expected.camera.thetaRate,expected.camera.gammaRate],camera,viewport:{logicalWidth:384,logicalHeight:288,target:'offscreen',referenceLogicalHeight:486}});
  }
  expect(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:row.frames.length,actualFrameRate:37})).toHaveProperty('error');
  const stop=result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  expect(stop.result.preview).toMatchObject({sourceCameraFrame:{frameIndex:row.frames.length-1,sceneTime:row.frames.at(-1)!.sceneTime,viewport:{target:'primary',logicalWidth:405,logicalHeight:486}}});expect(stop.result.preview).not.toHaveProperty('implicitRecording');
  expect(stop.result.scene.timeline.fps).toBe(f.scene.timeline.fps);
  const again=result(send({operation:'source-recording-begin',sourceId:stop.id,options:f.options}),'source-recording-begin');expect(again.result.warmup).toMatchObject({implicitRecording:{displayFrame:0}});
  result(send({operation:'source-recording-finish',recordingId:again.recordingId}),'source-recording-finish');
 },15000);
 it.each([false,true])('stops an undelivered warmup without another update (detached=%s)',detached=>{
  const f=setup();fail={operation:'source-recording-begin',detached};const error=send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options});
  if(!('error' in error))throw Error('failure');expect(error.retainedRecordingId).toBe(sequence);
  const stop=result(send({operation:'source-recording-finish',recordingId:error.retainedRecordingId}),'source-recording-finish');expect(stop.result.preview).toMatchObject({sourceCameraFrame:{frameIndex:0}});
 });
 it.each([false,true])('never consumes a failed frame publication twice (detached=%s)',detached=>{
  const start=begin(setup());fail={operation:'source-recording-frame',detached};const request={operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:12};
  expect(send(request)).toMatchObject({retainedRecordingId:start.recordingId});expect(send({...request,actualFrameRate:24})).toHaveProperty('error');expect(send({...request,displayFrame:2})).toHaveProperty('error');
  const retried=send(request);if(detached)expect(retried).toMatchObject({error:expect.stringContaining('传输状态未知'),retainedRecordingId:start.recordingId});else expect(retried).toMatchObject({output:{implicitRecording:{displayFrame:1}}});
  expect(result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish').result.preview).toMatchObject({sourceCameraFrame:{frameIndex:1}});
 });
 it.each([false,true])('re-materializes stopped geometry after failed publication (detached=%s)',detached=>{
  const start=begin(setup()),frame=result(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:12}),'source-recording-frame').output;
  fail={operation:'source-recording-finish',detached};expect(send({operation:'source-recording-finish',recordingId:start.recordingId})).toMatchObject({retainedRecordingId:start.recordingId});
  expect(send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:2,actualFrameRate:12})).toHaveProperty('error');
  const stop=result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  if(frame.type!=='geometry'||stop.result.preview.type!=='geometry')throw Error('geometry');expect(stop.result.preview.positions).toEqual(frame.positions);expect(stop.result.preview.sourceCameraFrame?.camera).toEqual(frame.sourceCameraFrame?.camera);
  expect(send({operation:'source-recording-finish',recordingId:start.recordingId})).toHaveProperty('error');
 });
 it('retains the exact preview on admission failure and the real lease on foreign requests',()=>{
  const f=setup();expect(send({operation:'source-recording-begin',sourceId:f.sourceId,options:{...f.options,width:999999}})).toMatchObject({retainedSourceId:f.sourceId});
  expect(send({operation:'source-recording-begin',sourceId:f.sourceId,options:{...f.options,actualFrameRate:NaN}})).toMatchObject({retainedSourceId:f.sourceId});
  const start=begin(f);expect(send({operation:'generate',scene:f.scene,context:f.context})).toMatchObject({retainedRecordingId:start.recordingId});expect(send({operation:'source-recording-frame',recordingId:999,displayFrame:1,actualFrameRate:12})).toMatchObject({retainedRecordingId:start.recordingId});expect(send({operation:'source-recording-finish',sessionId:8,recordingId:start.recordingId})).not.toHaveProperty('retainedRecordingId');
  result(send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
 });
 it('does not silently ignore unimplemented parameter actions',()=>{
  const f=setup('fps4-varying',false,true);expect(send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options})).toMatchObject({error:expect.stringContaining('非相机动作'),retainedSourceId:f.sourceId});
 });
 it('retains an unmapped imported effect through save/load and rejects recording',()=>{
  const raw=JSON.parse(JSON.stringify(native.cases[0].input.project));raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
  raw.timeline[1].actions.push({method:'paramStart',args:{a:{step:.1,min:0,max:1}}});
  const imported=parseProjectFile(JSON.stringify(raw));
  expect(imported.warnings.some(w=>w.includes('尚未映射'))).toBe(true);
  const scene=parseProjectFile(serializeScene(imported.scene)).scene,action=scene.timeline.tracks[1].actions!.at(-1)!;
  expect(action).toMatchObject({method:'paramStart',enabled:true,sourceEffect:'unmapped'});
  const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
  const primary=result(send({operation:'generate',scene,context}),'generate');
  expect(send({operation:'source-recording-begin',sourceId:primary.id,options:{width:128,height:96,simulationFps:4,actualFrameRate:37}})).toMatchObject({error:expect.stringContaining('非相机动作'),retainedSourceId:primary.id});
  action.args={value:1};expect(()=>parseProjectFile(serializeScene(scene))).toThrow('未映射源效果');
  delete action.args;scene.timeline.schedule=undefined;expect(()=>parseProjectFile(serializeScene(scene))).toThrow('未映射源效果');
 });
});
