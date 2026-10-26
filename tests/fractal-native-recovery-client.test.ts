import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {transport,lease}=vi.hoisted(()=>({transport:vi.fn(),lease:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),exchangeSourceFractalNative:transport}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:lease}));
vi.mock('../src/engine/sourceDrawingPixels',async actual=>({...await actual<typeof import('../src/engine/sourceDrawingPixels')>(),sourceDrawingPolicy:()=> 'native'}));
import fixture from './fixtures/source-fractal-display/mandelbrot.json';
import {Generator} from '../src/engine/client';
import {FractalSourceNativeSampler} from '../src/engine/fractalSourceNativeSampler';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';
import {parseProjectFile} from '../src/engine/legacyImport';
import {withFractalFreshRecording} from '../src/engine/sourceFractalRecording';
import {encodeSourceFractalNativeRequest,type SourceFractalNativeRequest} from '../src/engine/sourceFractalNativeProtocol';
import type {SourceNativeFractalResponse} from '../src/engine/sourceNativeClient';
import type {GenerationInput} from '../src/types';

// Real client, numerical/display sessions, codec and sampler ownership. Synthetic
// native records exercise recovery contracts, not GPU execution or pixel parity.
const clients:Generator[]=[],remote=new Map<string,{index:number;width:number;height:number}>();
let sampleFailures=0,releaseFailures=0;
const scene=()=>parseProjectFile(JSON.stringify({...fixture,timeline:[{type:'wait',duration:.1}]})).scene;
const coldContext=():GenerationInput=>({time:0,quality:'export',width:4,height:3,fractalPixelDensity:1,fractalViewport:{logicalWidth:4,logicalHeight:3,target:'offscreen'}});
const liveContext=():GenerationInput=>({...coldContext(),quality:'preview',fractalViewport:{logicalWidth:4,logicalHeight:3,target:'primary'},fractalLive:{sessionId:'native-recovery',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:true,timestampMs:100}}});
const recordingOptions={width:4,height:3,simulationFps:60};
function client(){const generator=new Generator();clients.push(generator);return generator;}
const operations=()=>transport.mock.calls.map(([request])=>(request as SourceFractalNativeRequest).operation);
const kinds=()=>operations().map(operation=>operation.kind);

function reply(request:SourceFractalNativeRequest):SourceNativeFractalResponse {
 const op=request.operation,previous=remote.get(op.resource),count=op.kind==='sample'?op.points.length/2:0,records=new Uint8Array(count*52),view=new DataView(records.buffer);
 const allocated=op.kind==='sample'&&(!previous||previous.width!==request.width||previous.height!==request.height)?1:0;
 if(op.kind==='create')remote.set(op.resource,{index:0,width:0,height:0});
 if(op.kind==='sample'){
  for(let i=0;i<count;i++){
   const values=[0,0,0,0,1,1,1,0];for(let j=0;j<values.length;j++)view.setFloat32(i*52+j*4,values[j],true);
   records.set([41,73,151,255],i*52+32);
  }
  remote.set(op.resource,{index:op.expectedIndex+1,width:request.width,height:request.height});
 }
 if(op.kind==='release')remote.delete(op.resource);
 return{resource:op.resource,committedRequests:op.kind==='sample'?op.expectedIndex+1:op.kind==='release'?previous?.index??0:0,disposition:op.kind==='release'?(previous?'released':'absent'):'owned',count,width:request.width,height:request.height,draws:op.kind==='sample'?1:0,targetAllocations:allocated,referenceUploads:op.kind==='sample'?1:0,paletteUploads:op.kind==='sample'?1:0,...(op.kind==='sample'?{records}:{}),generation:request.generation,sequence:request.sequence,rendererIdentity:'a'.repeat(64),contextSerial:9,sessionSerial:4,requestBytes:128};
}
async function exchange(request:SourceFractalNativeRequest,options:Parameters<typeof encodeSourceFractalNativeRequest>[1]){
 const encoded=encodeSourceFractalNativeRequest(request,options);if(!encoded.ok)throw Error(encoded.error.reason);
 if(request.operation.kind==='release'&&releaseFailures>0){releaseFailures--;throw Error('release unavailable');}
 const response=reply(request);
 // A lost ACK leaves a remotely committed sample and uncertain local ownership.
 if(request.operation.kind==='sample'&&sampleFailures>0){sampleFailures--;throw Error('sample acknowledgement lost');}
 return{...response,requestBytes:encoded.value.length};
}
async function started(){
 const generator=client(),author=scene(),context=liveContext(),output=await generator.generate(author,context);
 const start=await generator.beginSourceRecording(output,recordingOptions);
 expect(generator.hasSourceRecording(start.handle)).toBe(true);
 return{generator,author,context,output,start};
}
beforeEach(()=>{remote.clear();sampleFailures=0;releaseFailures=0;transport.mockReset().mockImplementation(exchange);lease.mockReset().mockResolvedValue(undefined);});
afterEach(async()=>{
 vi.restoreAllMocks();sampleFailures=0;releaseFailures=0;
 transport.mockReset().mockImplementation(exchange);lease.mockReset().mockResolvedValue(undefined);
 for(const generator of clients.splice(0)){generator.dispose();await generator.settledNativeCleanup();}
 expect(remote.size).toBe(0);
});

describe('Fractal native client recovery through real CPU owners',()=>{
 it.each(['cold PNG','fresh recording'] as const)('releases the failed %s token before a new explicit generation and retains failed release ownership',async mode=>{
  const generator=client(),author=mode==='fresh recording'?withFractalFreshRecording(scene(),60):scene();
  const context:GenerationInput={...coldContext(),...(mode==='fresh recording'?{fractalRecording:{displayFrame:0,simulationFps:60}}:{})};
  sampleFailures=1;await expect(generator.generate(author,context)).rejects.toThrow('sample acknowledgement lost');
  expect(kinds()).toEqual(['create','sample']);const oldToken=operations()[0].resource;
  expect(remote.get(oldToken)?.index).toBe(1);

  releaseFailures=1;await expect(generator.generate(author,context)).rejects.toThrow('release unavailable');
  expect(kinds()).toEqual(['create','sample','release']);expect(operations()[2].resource).toBe(oldToken);
  expect(remote.has(oldToken)).toBe(true);

  const output=await generator.generate(author,context);
  expect(kinds().slice(0,6)).toEqual(['create','sample','release','release','create','sample']);
  expect(operations()[3].resource).toBe(oldToken);expect(operations()[4].resource).not.toBe(oldToken);
  expect(operations().slice(5).every(operation=>operation.kind==='sample'&&operation.resource===operations()[4].resource)).toBe(true);
  expect(remote.has(oldToken)).toBe(false);expect(remote.size).toBe(1);
  expect(output).toMatchObject({type:'raster',width:4,height:3,fractalRender:{execution:{backend:'native'}}});
  if(mode==='fresh recording')expect(output).toMatchObject({fractalRecording:{displayFrame:0,simulationFps:60,warmup:true}});
 });

 it('releases an uncertain native finish without publishing a preview or retaining the recording handle',async()=>{
  const {generator,output,start}=await started(),before=operations().length,token=operations()[0].resource;
  let acknowledgeRelease!:()=>void,releaseStarted!:()=>void,finished=false;
  const releaseAck=new Promise<void>(resolve=>{acknowledgeRelease=resolve;}),releaseEntered=new Promise<void>(resolve=>{releaseStarted=resolve;});
  transport.mockImplementation(async(request:SourceFractalNativeRequest,options:Parameters<typeof encodeSourceFractalNativeRequest>[1])=>{
   if(request.operation.kind==='release'){releaseStarted();await releaseAck;}
   return exchange(request,options);
  });
  sampleFailures=1;const finishing=generator.finishSourceRecording(start.handle,500);
  const rejected=expect(finishing).rejects.toMatchObject({message:'sample acknowledgement lost',previewRetained:false,recordingRetained:false});
  void finishing.then(()=>{finished=true;},()=>{finished=true;});
  await releaseEntered;
  try{
   expect(generator.hasSourceRecording(start.handle)).toBe(true);expect(remote.has(token)).toBe(true);
   await Promise.resolve();expect(finished).toBe(false);expect(kinds().slice(before)).toEqual(['sample','release']);
  }finally{acknowledgeRelease();}
  await rejected;
  expect(operations().slice(before).map(operation=>({kind:operation.kind,resource:operation.resource}))).toEqual([{kind:'sample',resource:token},{kind:'release',resource:token}]);
  expect(generator.hasSourceRecording(start.handle)).toBe(false);expect(remote.size).toBe(0);
  await expect(generator.beginSourceRecording(output,recordingOptions)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});
  expect(operations()).toHaveLength(before+2);
 });

 it('retains failed finish cleanup and retries only release without numerical work or another sample',async()=>{
  const finish=vi.spyOn(SourceFractalHostSession.prototype,'finishRecording'),update=vi.spyOn(SourceFractalHostSession.prototype,'update'),displayFinish=vi.spyOn(SourceFractalLiveSession.prototype,'finishRecordingAsync');
  const {generator,output,start}=await started(),before=operations().length,token=operations()[0].resource;
  sampleFailures=1;releaseFailures=1;
  await expect(generator.finishSourceRecording(start.handle,500)).rejects.toMatchObject({previewRetained:false,recordingRetained:true,handle:start.handle});
  expect(generator.hasSourceRecording(start.handle)).toBe(true);expect(remote.has(token)).toBe(true);
  expect(kinds().slice(before)).toEqual(['sample','release']);expect(finish).toHaveBeenCalledTimes(1);
  const updates=update.mock.calls.length;

  await expect(generator.finishSourceRecording(start.handle,900)).rejects.toMatchObject({message:'sample acknowledgement lost',previewRetained:false,recordingRetained:false});
  expect(kinds().slice(before)).toEqual(['sample','release','release']);
  expect(operations().slice(before).every(operation=>operation.resource===token)).toBe(true);
  expect(finish).toHaveBeenCalledTimes(1);expect(displayFinish).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(updates);
  expect(generator.hasSourceRecording(start.handle)).toBe(false);expect(remote.size).toBe(0);
  await expect(generator.beginSourceRecording(output,recordingOptions)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});
  expect(operations()).toHaveLength(before+3);
 });

 it('rejects pause, capture and recording when the native resource is unusable despite a completed numerical session',async()=>{
  const generate=vi.spyOn(SourceFractalLiveSession.prototype,'generateAsync'),generator=client(),author=scene(),context=liveContext();
  const output=await generator.generate(author,context),session=generate.mock.contexts[0],before=operations().length;
  if(!(session instanceof SourceFractalLiveSession))throw Error('expected the real live session receiver');
  expect(session.matchesCompletedPrimary(author,context)).toBe(true);
  const original=FractalSourceNativeSampler.prototype.diagnostics;
  const diagnostics=vi.spyOn(FractalSourceNativeSampler.prototype,'diagnostics').mockImplementation(function(this:FractalSourceNativeSampler){return{...original.call(this),cleanupPending:true};});
  try{
   await expect(generator.setFractalPaused(output,false,200)).rejects.toThrow('主预览');
   await expect(generator.captureFractalPaused(output,{width:4,height:3})).rejects.toMatchObject({previewRetained:false});
   await expect(generator.beginSourceRecording(output,recordingOptions)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});
   expect(operations()).toHaveLength(before);expect(session.matchesCompletedPrimary(author,context)).toBe(true);
  }finally{diagnostics.mockRestore();}
 });

 it('restores a healthy native recording preview and keeps its resource usable',async()=>{
  const {generator,start}=await started(),before=operations().length,token=operations()[0].resource;
  const stop=await generator.finishSourceRecording(start.handle,500);
  expect(stop.preview).toMatchObject({type:'raster',fractalRender:{execution:{backend:'native'}},fractalLive:{target:'primary',renderKind:'snapshot',rawDt:0,objectUpdates:0}});
  expect(generator.hasSourceRecording(start.handle)).toBe(false);expect(remote.has(token)).toBe(true);
  expect(kinds().slice(before)).toContain('sample');
  expect(operations().slice(before).every(operation=>operation.kind==='sample'&&operation.resource===token)).toBe(true);
  await expect(generator.setFractalPaused(stop.preview,true,600)).resolves.toBeUndefined();
  const next=await generator.beginSourceRecording(stop.preview,recordingOptions);
  expect(generator.hasSourceRecording(next.handle)).toBe(true);
  await generator.finishSourceRecording(next.handle,700);expect(generator.hasSourceRecording(next.handle)).toBe(false);
 });

 it('charges retained preview pixels through public capture without advancing the numerical session',async()=>{
  const capture=vi.spyOn(SourceFractalLiveSession.prototype,'capturePausedAsync'),update=vi.spyOn(SourceFractalHostSession.prototype,'update'),prepare=vi.spyOn(FractalSourceNativeSampler.prototype,'prepareReference');
  const generator=client(),author=scene(),context=liveContext(),first=await generator.generate(author,context),output=await generator.generate(author,context);
  if(first.type!=='raster'||output.type!=='raster')throw Error('expected the native primary rasters');
  expect(prepare.mock.calls.map(([,options])=>options?.additionalBytes)).toEqual([0,first.pixels.byteLength]);
  const updates=update.mock.calls.length,ordinal=output.fractalLive!.updateOrdinal;
  const result=await generator.captureFractalPaused(output,{width:5,height:2});
  expect(capture).toHaveBeenCalledTimes(1);expect(capture.mock.calls[0][2]).toEqual({additionalBytes:output.pixels.byteLength});
  expect(prepare.mock.calls.slice(2).map(([,options])=>options?.additionalBytes)).toEqual([output.pixels.byteLength,output.pixels.byteLength+result.capture.pixels.byteLength]);
  expect(result.capture).toMatchObject({type:'raster',width:5,height:2,fractalLive:{target:'offscreen',renderKind:'snapshot',updateOrdinal:ordinal,rawDt:0,objectUpdates:0},fractalRender:{execution:{backend:'native'}}});
  expect(result.preview).toMatchObject({type:'raster',width:output.width,height:output.height,fractalLive:{target:'primary',renderKind:'snapshot',updateOrdinal:ordinal,rawDt:0,objectUpdates:0},fractalRender:{execution:{backend:'native'}}});
  expect(update).toHaveBeenCalledTimes(updates);
  await expect(generator.setFractalPaused(result.preview,true,200)).resolves.toBeUndefined();
  await generator.generate(author,{...context,fractalLive:{...context.fractalLive!,clock:{paused:true,timestampMs:300}}});
  expect(prepare.mock.calls.slice(4).map(([,options])=>options?.additionalBytes)).toEqual([result.preview.pixels.byteLength]);
 });

 it.each(['cold PNG','fresh recording'] as const)('charges only the preceding raster on the next explicit %s generation',async mode=>{
  const prepare=vi.spyOn(FractalSourceNativeSampler.prototype,'prepareReference'),generator=client(),author=mode==='fresh recording'?withFractalFreshRecording(scene(),60):scene();
  const context=(displayFrame:number):GenerationInput=>({...coldContext(),time:displayFrame/60,...(mode==='fresh recording'?{fractalRecording:{displayFrame,simulationFps:60}}:{})});
  const first=await generator.generate(author,context(0));if(first.type!=='raster')throw Error('expected the native export raster');
  const second=await generator.generate(author,context(1));
  expect(second).toMatchObject({type:'raster',fractalRender:{execution:{backend:'native'}}});
  expect(prepare.mock.calls.map(([,options])=>options?.additionalBytes)).toEqual([0,first.pixels.byteLength]);
 });

 it('preserves a preview after rejected configuration but requires a new live session after uncertain sampling',async()=>{
  const generator=client(),author=scene(),context=liveContext(),output=await generator.generate(author,context);
  const before=operations().length,token=operations()[0].resource,invalid=structuredClone(author);invalid.id='different-document';
  await expect(generator.generate(author,{...context,fractalLive:{...context.fractalLive!,revision:1,intent:'hot',configuration:invalid}})).rejects.toMatchObject({previewRetained:true});
  expect(operations()).toHaveLength(before);
  await expect(generator.setFractalPaused(output,true,200)).resolves.toBeUndefined();

  const continued:GenerationInput={...context,fractalLive:{...context.fractalLive!,clock:{paused:true,timestampMs:300}}};
  sampleFailures=1;
  await expect(generator.generate(author,continued)).rejects.toMatchObject({message:'sample acknowledgement lost',previewRetained:false});
  expect(kinds().slice(before)).toEqual(['sample']);
  await expect(generator.setFractalPaused(output,true,400)).rejects.toThrow('主预览');
  await expect(generator.generate(author,continued)).rejects.toMatchObject({previewRetained:false});
  expect(operations()).toHaveLength(before+1);

  const recovered=await generator.generate(author,{...continued,fractalLive:{...continued.fractalLive!,sessionId:'native-recovered'}});
  expect(kinds().slice(before,before+4)).toEqual(['sample','release','create','sample']);
  expect(operations()[before+1].resource).toBe(token);expect(operations()[before+2].resource).not.toBe(token);
  expect(remote.has(token)).toBe(false);
  expect(recovered).toMatchObject({type:'raster',fractalLive:{sessionId:'native-recovered',updateOrdinal:0},fractalRender:{execution:{backend:'native'}}});
 });
});
