import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse,SourceRecordingOptions} from '../src/engine/generationProtocol';

/** Real client, worker handler, numerical owner and CPU renderer. Only the
 * message transport is substituted to inject publication loss/corruption. */
let worker:{onmessage?:(event:MessageEvent<GenerationRequest>)=>void;postMessage:(data:GenerationResponse,options:{transfer:Transferable[]})=>void};
let port:Transport;
let fail:{operation:string;afterTransfer?:boolean}|undefined;
let corrupt:((message:GenerationResponse)=>void)|undefined;
class Transport {
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 sent:GenerationRequest[]=[];received:GenerationResponse[]=[];terminated=false;
 constructor(){port=this;}
 postMessage(data:GenerationRequest){this.sent.push(structuredClone(data));worker.onmessage!({data:structuredClone(data)} as MessageEvent<GenerationRequest>);}
 terminate(){this.terminated=true;}
}
beforeEach(async()=>{
 vi.resetModules();fail=undefined;corrupt=undefined;
 worker={postMessage:(data,options)=>{
  const failure=fail?.operation===data.operation&&!('error' in data)?fail:undefined;
  if(failure){fail=undefined;if(!failure.afterTransfer)throw Error('publication failed');}
  const message=structuredClone(data,{transfer:options.transfer});
  if(failure)throw Error('publication failed after transfer');
  corrupt?.(message);port.received.push(message);port.onmessage?.({data:message});
 }};
 vi.stubGlobal('self',worker);vi.stubGlobal('Worker',Transport);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
const options:SourceRecordingOptions={width:13,height:9,simulationFps:60,actualFrameRate:37};
async function setup(empty=false){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'wire',domainColoring:{formula:'z+a'},timeline:empty?[]:[{type:'wait',duration:.1}]})).scene;
 scene.settings.domainRenderPolicy='source-cpu-always-v1';
 const context:GenerationInput={time:0,width:24,height:16,quality:'export',domainTarget:{logicalWidth:12,logicalHeight:8,pixelDensity:2},domainLive:{sessionId:'wire',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29,viewport:{logicalWidth:12,logicalHeight:8,pixelDensity:2}}};
 const g=new Generator(),output=await g.generate(scene,context);return{g,scene,context,output};
}
describe('Domain recording production transport',()=>{
 it('preserves signed zero observations instead of substituting simulation FPS',async()=>{
  const f=await setup(),start=await f.g.beginSourceRecording(f.output,{...options,actualFrameRate:-0});
  expect(Object.is(start.warmup.domainLive!.actualFrameRate,-0)).toBe(true);
  const frame=await f.g.nextSourceRecordingFrame(start.handle,1,-0);expect(Object.is(frame.domainLive!.actualFrameRate,-0)).toBe(true);
  const stop=await f.g.finishSourceRecording(start.handle);expect(Object.is(stop.preview.domainLive!.actualFrameRate,-0)).toBe(true);f.g.dispose();
 });
 it('requires explicit observations and exact completed/recording capabilities, then restores usable primary',async()=>{
  const f=await setup();await expect(f.g.beginSourceRecording({...f.output},options)).rejects.toThrow('主预览');
  await expect(f.g.beginSourceRecording(f.output,{...options,actualFrameRate:undefined})).rejects.toMatchObject({previewRetained:true,recordingRetained:false});
  const start=await f.g.beginSourceRecording(f.output,options);
  expect(start.warmup.domainLive).toMatchObject({actualFrameRate:37,updateOrdinal:0,clockSource:'fixed-step'});
  await expect(f.g.nextSourceRecordingFrame({...start.handle},1,24)).rejects.toThrow('身份');
  await expect(f.g.nextSourceRecordingFrame(start.handle,1)).rejects.toThrow('Float32');
  expect(await f.g.nextSourceRecordingFrame(start.handle,1,24)).toMatchObject({domainLive:{actualFrameRate:24,updateOrdinal:1}});
  const stop=await f.g.finishSourceRecording(start.handle);expect(stop.preview.domainLive).toMatchObject({updateOrdinal:1,actualFrameRate:24,paused:false,renderKind:'snapshot'});
  expect(f.g.hasSourceRecording(start.handle)).toBe(false);await f.g.setDomainPaused(stop.preview,true);await f.g.navigateDomainPaused(stop.preview,{kind:'wheel',count:1});f.g.dispose();
 });
 it('retains completed primary when worker rejects oversized recording admission',async()=>{
  const f=await setup();const source=port.sent[0];
  port.postMessage({operation:'source-recording-begin',sessionId:source.sessionId,id:100,sourceId:source.id,options:{...options,width:999999}});
  expect(port.received.at(-1)).toMatchObject({retainedSourceId:source.id});
  const start=await f.g.beginSourceRecording(f.output,options);await f.g.finishSourceRecording(start.handle);f.g.dispose();
 });
 it.each([false,true])('finishes a retained warmup whose publication failed (detached=%s)',async afterTransfer=>{
  const f=await setup();fail={operation:'source-recording-begin',afterTransfer};
  const failure=await f.g.beginSourceRecording(f.output,options).catch(e=>e);
  expect(failure).toMatchObject({recordingRetained:true,previewRetained:false});expect(f.g.hasSourceRecording(failure.handle)).toBe(true);
  await expect(f.g.nextSourceRecordingFrame(failure.handle,1,24)).rejects.toThrow('warmup');
  const stop=await f.g.finishSourceRecording(failure.handle);expect(stop.preview.domainLive!.updateOrdinal).toBe(0);expect(port.terminated).toBe(false);f.g.dispose();
 });
 it('retries an undelivered frame exactly once and rejects changed observations at both adapters',async()=>{
  const f=await setup(),start=await f.g.beginSourceRecording(f.output,options);fail={operation:'source-recording-frame'};
  await expect(f.g.nextSourceRecordingFrame(start.handle,1,24)).rejects.toMatchObject({recordingRetained:true});
  await expect(f.g.nextSourceRecordingFrame(start.handle,1,12)).rejects.toThrow('改变');
  port.postMessage({operation:'source-recording-frame',id:100,sessionId:start.handle.sessionId,recordingId:start.handle.recordingId,displayFrame:1,actualFrameRate:12});
  expect(port.received.at(-1)).toMatchObject({retainedRecordingId:start.handle.recordingId,error:expect.stringContaining('改变')});
  const frame=await f.g.nextSourceRecordingFrame(start.handle,1,24);expect(frame.domainLive!.updateOrdinal).toBe(1);
  const stop=await f.g.finishSourceRecording(start.handle);expect(stop.preview.domainLive!.presentation.evaluatedDomainScene!.clock).toEqual(frame.domainLive!.presentation.evaluatedDomainScene!.clock);f.g.dispose();
 });
 it('stops an uncertain detached frame without replaying its numerical update',async()=>{
  const f=await setup(),start=await f.g.beginSourceRecording(f.output,options);fail={operation:'source-recording-frame',afterTransfer:true};
  await expect(f.g.nextSourceRecordingFrame(start.handle,1,24)).rejects.toMatchObject({recordingRetained:true});
  await expect(f.g.nextSourceRecordingFrame(start.handle,1,24)).rejects.toThrow('传输状态未知');
  const stop=await f.g.finishSourceRecording(start.handle);expect(stop.preview.domainLive).toMatchObject({updateOrdinal:1,actualFrameRate:24});f.g.dispose();
 });
 it.each([false,true])('retries stop publication without an extra update (detached=%s)',async afterTransfer=>{
  const f=await setup(),start=await f.g.beginSourceRecording(f.output,options),frame=await f.g.nextSourceRecordingFrame(start.handle,1,24);fail={operation:'source-recording-finish',afterTransfer};
  await expect(f.g.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:true});
  const stop=await f.g.finishSourceRecording(start.handle);expect(stop.preview.domainLive!.presentation.evaluatedDomainScene).toEqual({...frame.domainLive!.presentation.evaluatedDomainScene,simulationFps:f.scene.timeline.fps});expect(port.terminated).toBe(false);f.g.dispose();
 });
 const malformed={
  observation:(r:any)=>{r.result.warmup.domainLive.actualFrameRate=60;},
  simulation:(r:any)=>{r.result.warmup.domainLive.recording.simulationFps=24;},
  prematureCompletion:(r:any)=>{r.result.clock.updates=1;r.result.clock.lastDisplayFrame=0;r.result.clock.encodedFrames=0;r.result.clock.firstEncodedUpdate=null;},
  dimensions:(r:any)=>{r.result.warmup.domainRender.target.logicalWidth++;},
  clockSource:(r:any)=>{r.result.warmup.domainLive.clockSource='worker-wall-clock';},
  ordinal:(r:any)=>{r.result.warmup.domainLive.recording.ordinal=1;},
  authorIdentity:(r:any)=>{r.result.scene.id='another';},
  primaryIdentity:(r:any)=>{r.result.context.domainLive.viewport.pixelDensity=3;},
  labels:(r:any)=>{delete r.result.warmup.formulaPresentation;},
 };
 it.each(Object.entries(malformed))('rejects malformed %s before granting recording control',async(_label,change)=>{
  const f=await setup();corrupt=message=>{if(message.operation==='source-recording-begin'&&!('error' in message))change(message);};
  await expect(f.g.beginSourceRecording(f.output,options)).rejects.toMatchObject({recordingRetained:false});expect(port.terminated).toBe(true);f.g.dispose();
 });
 it('rejects a stop that invents another numerical update',async()=>{
  const f=await setup(),start=await f.g.beginSourceRecording(f.output,options);
  corrupt=message=>{if(message.operation==='source-recording-finish'&&!('error' in message)){
   const out=message.result.preview,live=out.domainLive!;live.updateOrdinal++;live.presentation.evaluatedDomainScene!.displayFrame++;out.domainRender={...out.domainRender!,sourceClock:{...out.domainRender!.sourceClock!,displayFrame:out.domainRender!.sourceClock!.displayFrame+1}};
  }};
  await expect(f.g.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:false});expect(port.terminated).toBe(true);f.g.dispose();
 });
 it('supports a zero-encoded-frame queue through the real worker',async()=>{
  const f=await setup(true),start=await f.g.beginSourceRecording(f.output,options);expect(start.clock).toMatchObject({updates:1,encodedFrames:0,lastDisplayFrame:0});
  const stop=await f.g.finishSourceRecording(start.handle);expect(stop.preview.domainLive!.updateOrdinal).toBe(0);f.g.dispose();
 });
});
