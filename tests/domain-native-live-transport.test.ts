import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {transport,lease}=vi.hoisted(()=>({transport:vi.fn(),lease:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),renderSourceNativeFrame:transport}));
vi.mock('../src/engine/sourceNativeLease',async actual=>({...await actual<typeof import('../src/engine/sourceNativeLease')>(),ensureSourceNativeLease:lease}));
import {Generator} from '../src/engine/client';
import {GenerationQueue} from '../src/engine/generationQueue';
import {DomainLiveGenerationError} from '../src/engine/generationProtocol';
import {usesDomainNativeRendering} from '../src/engine/domain';
import {SourceDomainLiveSession} from '../src/engine/sourceDomainLiveSession';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultFormulas} from '../src/engine/formulas';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import type {SourceNativePixels} from '../src/engine/sourceNativeClient';
import type {SourceRecordingHandle} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';

// Real client, Domain producer, frame codec and numerical/display owners. Only
// native transport/lease are substituted; these tests establish no GPU parity.
type Raster=Extract<SceneOutput,{type:'raster'}>;
type Options={retainedBytes?:number;signal?:AbortSignal};
type Draw={frame:SourceDrawingFrame;options:Options;result:SourceNativePixels};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
type Gate={entered:ReturnType<typeof deferred<Draw>>;ack:ReturnType<typeof deferred<void>>};
const clients:Generator[]=[],recordings:{generator:Generator;handle:SourceRecordingHandle}[]=[],draws:Draw[]=[],queued:Gate[]=[],gates:Gate[]=[];
let workers=0;
function hold(){const gate={entered:deferred<Draw>(),ack:deferred<void>()};queued.push(gate);gates.push(gate);return gate;}
function raster(output:SceneOutput):Raster{if(output.type!=='raster')throw Error('expected Domain raster');return output;}
function client(){const generator=new Generator();clients.push(generator);return generator;}
function scene():SceneDocument{
 const result=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Native Domain transport',type:'DOMAIN_COLORING',domainColoring:{formula:'z+a',parameters:{a:.2,b:.3}},timeline:[{type:'wait',duration:.3}]})).scene;
 Object.assign(result.settings,{domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainBackend:'gpu',domainRenderPolicy:'source-cpu-on-gpu-failure-v1',supersampling:1});
 result.parameters={a:.2,b:.3};result.formulas=defaultFormulas();result.formulas.main.visible=true;result.formulas.main.latex='captured';return result;
}
function context():GenerationInput{return{time:0,quality:'preview',width:4,height:3,domainLive:{sessionId:'native-domain',revision:0,clock:{paused:true},actualFrameRate:37,viewport:{logicalWidth:4,logicalHeight:3,pixelDensity:1}}};}
const recordingOptions={width:2,height:2,simulationFps:10,actualFrameRate:29};
async function setup(){const generator=client(),author=scene(),input=context(),output=raster(await generator.generate(author,input));return{generator,author,input,output};}
async function start(generator:Generator,output:SceneOutput){const result=await generator.beginSourceRecording(output,recordingOptions);recordings.push({generator,handle:result.handle});return result;}
function uniform(draw:Draw,name:string){const item=draw.frame.drawing.commands[0].uniforms.find(item=>item.name===name);if(!item||item.kind==='sampler2d')throw Error('missing numeric uniform '+name);return Array.from(item.values);}
async function exchange(frame:SourceDrawingFrame,options:Options={}):Promise<SourceNativePixels>{
 const packet=encodeSourceDrawingFrame(frame,options);if(!packet.ok)throw Error(packet.error.reason);
 const pixels=new Uint8ClampedArray(frame.width*frame.height*4);for(let index=0;index<pixels.length;index+=4)pixels.set([41,73,151,255],index);
 const result={width:frame.width,height:frame.height,pixels,generation:frame.generation,sequence:frame.sequence,rendererIdentity:'b'.repeat(64),requestBytes:packet.value.byteLength},draw={frame,options:{...options},result};
 draws.push(draw);const gate=queued.shift();if(gate){gate.entered.resolve(draw);await gate.ack.promise;}return result;
}
beforeEach(()=>{
 draws.length=0;queued.length=0;gates.length=0;workers=0;transport.mockReset().mockImplementation(exchange);lease.mockReset().mockResolvedValue(undefined);
 vi.stubEnv('VITE_SOURCE_RENDERER','native');
 vi.stubGlobal('Worker',class{constructor(){workers++;throw Error('unexpected worker route');}});
 vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('unexpected GPU canvas');}});
});
afterEach(async()=>{
 queued.length=0;for(const gate of gates)gate.ack.resolve();
 for(const {generator,handle} of recordings.splice(0))if(generator.hasSourceRecording(handle))await generator.finishSourceRecording(handle).catch(()=>{});
 for(const generator of clients.splice(0)){generator.dispose();await generator.settledNativeCleanup();}
 vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();
});

describe('Domain native client transport through the real asynchronous owner',()=>{
 it('keeps pause, hot parameters, navigation and both capture draws on the same live owner',async()=>{
  const generate=vi.spyOn(SourceDomainLiveSession.prototype,'generateAsync'),capture=vi.spyOn(SourceDomainLiveSession.prototype,'capturePausedAsync'),update=vi.spyOn(SourceDomainHostSession.prototype,'update');
  const {generator,author,input,output}=await setup(),owner=generate.mock.contexts[0];
  if(!(owner instanceof SourceDomainLiveSession))throw Error('expected the real live session receiver');expect(workers).toBe(0);expect(lease).toHaveBeenCalled();
  expect(output).toMatchObject({width:4,height:3,backend:'native',sourcePixelRenderer:{backend:'native',identity:'b'.repeat(64)},domainLive:{clockSource:'page-wall-clock',target:'primary',paused:true,updateOrdinal:0},domainRender:{effective:{backend:'native'}}});
  expect(owner.matchesCompletedPrimary(author,input)).toBe(true);expect(output.formulaPresentation).toBeDefined();
  await expect(generator.setDomainPaused({...output},false)).rejects.toThrow('主预览');
  const before=draws.length,updates=update.mock.calls.length,edited=structuredClone(author);edited.parameters.a=.7;
  await generator.updateDomainParameters(output,edited,[['a',.7]]);expect(draws).toHaveLength(before);expect(update).toHaveBeenCalledTimes(updates);
  const navigated=raster(await generator.navigateDomainPaused(output,{kind:'pan',dx:1,dy:-1}));
  expect(uniform(draws.at(-1)!,'parameter0')).toEqual([Math.fround(.7)]);
  expect(navigated.domainLive).toMatchObject({renderKind:'snapshot',updateOrdinal:0,rawDt:0,activeDt:0});expect(update).toHaveBeenCalledTimes(updates);
  await expect(generator.setDomainPaused(output,false)).rejects.toThrow('主预览');
  const captureIndex=draws.length,result=await generator.captureDomainPaused(navigated,{width:5,height:2},3);
  expect(capture.mock.contexts[0]).toBe(owner);expect(capture.mock.calls[0][2]).toEqual({additionalBytes:navigated.pixels.byteLength});
  expect(draws.slice(captureIndex).map(draw=>draw.options.retainedBytes)).toEqual([navigated.pixels.byteLength,navigated.pixels.byteLength+result.capture.pixels.byteLength]);
  expect(result.capture).toMatchObject({width:5,height:2,backend:'native',domainLive:{renderKind:'snapshot',target:'offscreen',updateOrdinal:0}});
  expect(result.preview).toMatchObject({width:4,height:3,backend:'native',domainLive:{renderKind:'snapshot',target:'primary',updateOrdinal:0}});
  expect(result.capture.domainLive!.presentation).toEqual(result.preview.domainLive!.presentation);expect(result.capture.formulaPresentation).toEqual(output.formulaPresentation);expect(update).toHaveBeenCalledTimes(updates);
  const afterCapture=draws.length;await generator.setDomainPaused(result.preview,false,1000);expect(draws).toHaveLength(afterCapture);
  const next=raster(await generator.generate(edited,{...input,domainLive:{...input.domainLive!,clock:{paused:false,timestampMs:1050}}}));
  expect(next.domainLive).toMatchObject({clockSource:'injected',updateOrdinal:1,paused:false});expect(generate.mock.contexts.at(-1)).toBe(owner);expect(workers).toBe(0);
 });

 it('routes a cold source frame through the native producer and accounts for the preceding raster',async()=>{
  const live=vi.spyOn(SourceDomainLiveSession.prototype,'generateAsync'),generator=client(),author=scene();
  const input:GenerationInput={time:.1,quality:'export',width:4,height:3};expect(usesDomainNativeRendering(author)).toBe(true);
  const first=raster(await generator.generate(author,input)),second=raster(await generator.generate(author,input));
  expect(first).toMatchObject({backend:'native',domainRender:{effective:{backend:'native'},sourceClock:{sceneTime:expect.any(Number)}}});
  expect(second.domainRender?.sourceClock).toEqual(first.domainRender?.sourceClock);expect(first.formulaPresentation).toBeDefined();expect(second.formulaPresentation).toEqual(first.formulaPresentation);
  expect(draws.map(draw=>draw.options.retainedBytes)).toEqual([0,first.pixels.byteLength]);expect(live).not.toHaveBeenCalled();expect(workers).toBe(0);
 });

 it.each(['source CPU','local rules','mixed rules'] as const)('keeps %s live control on the same asynchronous owner without requesting native pixels',async mode=>{
  const generate=vi.spyOn(SourceDomainLiveSession.prototype,'generateAsync'),generator=client(),author=scene(),input=context();
  author.settings.domainBackend='cpu';author.settings.domainRenderPolicy='selected-rules-1723';
  if(mode==='source CPU')author.settings.domainRenderPolicy='source-cpu-always-v1';
  if(mode==='local rules')Object.assign(author.settings,{domainIterationVersion:'local-v1',domainColorVersion:'local-v1',domainViewportVersion:'local-v1'});
  if(mode==='mixed rules')author.settings.domainColorVersion='local-v1';
  expect(usesDomainNativeRendering(author)).toBe(false);
  const output=raster(await generator.generate(author,input));expect(output.backend).toBe('cpu');expect(output.domainLive!.clockSource).toBe('page-wall-clock');expect(generate).toHaveBeenCalledOnce();
  await generator.setDomainPaused(output,true);const next=await generator.navigateDomainPaused(output,{kind:'wheel',count:1});
  expect(raster(next).domainLive!.updateOrdinal).toBe(output.domainLive!.updateOrdinal);expect(transport).not.toHaveBeenCalled();expect(workers).toBe(0);
 });

 it('preserves a usable primary after rejected Apply but invalidates a failed native draw until a new session',async()=>{
  const {generator,author,input,output}=await setup(),invalid=structuredClone(author);invalid.id='another-document';const before=draws.length;
  await expect(generator.generate(author,{...input,domainLive:{...input.domainLive!,revision:1,configuration:invalid}})).rejects.toMatchObject({previewRetained:true});
  expect(draws).toHaveLength(before);await generator.setDomainPaused(output,true);
  const gate=hold(),pending=generator.generate(author,input),rejected=expect(pending).rejects.toMatchObject({message:'native draw rejected',previewRetained:false});await gate.entered.promise;gate.ack.reject(Error('native draw rejected'));await rejected;
  await expect(generator.setDomainPaused(output,true)).rejects.toThrow('主预览');
  await expect(generator.generate(author,input)).rejects.toMatchObject({previewRetained:false});expect(draws).toHaveLength(before+1);
  const recovered=await generator.generate(author,{...input,domainLive:{...input.domainLive!,sessionId:'native-domain-recovered'}});
  expect(raster(recovered).domainLive).toMatchObject({sessionId:'native-domain-recovered',updateOrdinal:0});expect(draws).toHaveLength(before+2);expect(workers).toBe(0);
 });

 it('retains queue playback and capture after rejected Apply, then accepts the repaired configuration',async()=>{
  const generator=client(),author=scene(),input=context(),callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(generator,callbacks);
  try{
   queue.request(author,input);await vi.waitFor(()=>expect(callbacks.output).toHaveBeenCalledOnce());
   const primary=raster(callbacks.output.mock.calls[0][0]),invalid=structuredClone(author);invalid.settings.supersampling=2.5;const before=draws.length;
   queue.request(invalid,{...input,domainLive:{...input.domainLive!,revision:1,configuration:invalid}});
   await vi.waitFor(()=>expect(callbacks.error).toHaveBeenCalledOnce());expect(callbacks.error.mock.calls[0][0]).toBeInstanceOf(DomainLiveGenerationError);expect(callbacks.error.mock.calls[0][0].previewRetained).toBe(true);
   expect(callbacks.output).toHaveBeenCalledOnce();expect(draws).toHaveLength(before);await queue.setDomainPaused(true);expect(draws).toHaveLength(before);
   const capture=raster(await queue.captureDomainPaused(primary,{width:5,height:2}));expect(capture.domainLive).toMatchObject({target:'offscreen',updateOrdinal:primary.domainLive!.updateOrdinal});
   const repaired=structuredClone(author);repaired.parameters.a=.6;
   queue.request(repaired,{...input,domainLive:{...input.domainLive!,revision:2,configuration:repaired}});
   await vi.waitFor(()=>expect(raster(callbacks.output.mock.calls.at(-1)![0]).domainLive!.revision).toBe(2));
   expect(callbacks.error).toHaveBeenCalledOnce();expect(uniform(draws.at(-1)!,'parameter0')).toEqual([Math.fround(.6)]);await queue.setDomainPaused(true);expect(workers).toBe(0);
  }finally{queue.dispose();}
 });

 it('keeps the previous primary after a rejected warmup and publishes a recording only after ACK',async()=>{
  const {generator,output}=await setup(),gate=hold(),pending=generator.beginSourceRecording(output,recordingOptions),rejected=expect(pending).rejects.toMatchObject({message:'warmup rejected',previewRetained:true,recordingRetained:false});
  let published=false;void pending.then(()=>{published=true;},()=>{});const draw=await gate.entered.promise;
  expect(draw.frame).toMatchObject({width:6,height:6});expect(published).toBe(false);
  await expect(generator.setDomainPaused(output,false)).rejects.toThrow();gate.ack.reject(Error('warmup rejected'));await rejected;
  await generator.setDomainPaused(output,true);const opened=await start(generator,output);
  expect(opened.warmup).toMatchObject({backend:'native',domainLive:{clockSource:'fixed-step',updateOrdinal:0,actualFrameRate:29}});expect(generator.hasSourceRecording(opened.handle)).toBe(true);
  const stopped=await generator.finishSourceRecording(opened.handle);expect(generator.hasSourceRecording(opened.handle)).toBe(false);
  expect(raster(stopped.preview).domainLive!.clockSource).toBe('page-wall-clock');await generator.setDomainPaused(stopped.preview,true);
 });

 it('cancels a pending warmup only after native ACK and restores control of the old preview',async()=>{
  const {generator,output}=await setup(),gate=hold(),controller=new AbortController(),pending=generator.beginSourceRecording(output,recordingOptions,controller.signal);
  const rejected=expect(pending).rejects.toMatchObject({previewRetained:true,recordingRetained:false});let finished=false;void pending.then(()=>{finished=true;},()=>{finished=true;});
  await gate.entered.promise;controller.abort();await Promise.resolve();expect(finished).toBe(false);
  gate.ack.resolve();await rejected;await generator.setDomainPaused(output,true);
  const result=await generator.captureDomainPaused(output,{width:5,height:2});
  expect(result.preview.domainLive).toMatchObject({target:'primary',updateOrdinal:output.domainLive!.updateOrdinal,paused:true});
  const opened=await start(generator,result.preview);await generator.finishSourceRecording(opened.handle);expect(generator.hasSourceRecording(opened.handle)).toBe(false);
 });

 it.each(['gpu','cpu'] as const)('restores the full application author draft after %s recording without sending editor state to rendering',async backend=>{
  const generator=client(),author=scene(),input=context();author.settings.domainBackend=backend;
  await generator.generate(author,input);
  const draft={...author,equations:{...author.equations,f:'('},domainPaletteEditor:{...author.domainPaletteEditor!,useCosine:true,colorCount:5}};
  const uiOnly=()=>undefined;Object.assign(draft.domainPaletteEditor,{uiOnly});
  const expected={...structuredClone({...draft,domainPaletteEditor:undefined}),domainPaletteEditor:draft.domainPaletteEditor};
  const output=await generator.generate(draft,input),render=vi.spyOn(SourceDomainLiveSession.prototype,'beginRecordingAsync');
  const opened=await start(generator,output);expect(render).toHaveBeenCalled();
  expect(opened.scene).not.toHaveProperty('domainPaletteEditor');expect(opened.warmup.domainLive!.presentation.equations.f).toBe(author.equations.f);
  draft.equations.f='later edit';
  const stopped=await generator.finishSourceRecording(opened.handle);
  expect(stopped.scene).toEqual(expected);expect(stopped.scene.domainPaletteEditor).toBe(expected.domainPaletteEditor);
  expect((stopped.scene.domainPaletteEditor as typeof draft.domainPaletteEditor&{uiOnly:()=>undefined}).uiOnly).toBe(uiOnly);
  expect(raster(stopped.preview).domainLive!.presentation.equations.f).toBe(author.equations.f);
  expect(generator.hasSourceRecording(opened.handle)).toBe(false);await generator.setDomainPaused(stopped.preview,true);
 });

 it('retries recording frames at the consumed FPS and retries finish without advancing or resetting the host again',async()=>{
  const {generator,output}=await setup(),opened=await start(generator,output),next=vi.spyOn(SourceDomainHostSession.prototype,'nextRecordingFrame'),finish=vi.spyOn(SourceDomainHostSession.prototype,'finishRecording');
  const gate=hold(),pending=generator.nextSourceRecordingFrame(opened.handle,1,24),rejected=expect(pending).rejects.toMatchObject({message:'frame rejected',recordingRetained:true,handle:opened.handle});
  await gate.entered.promise;gate.ack.reject(Error('frame rejected'));await rejected;expect(next).toHaveBeenCalledTimes(1);expect(generator.hasSourceRecording(opened.handle)).toBe(true);
  const afterFailure=draws.length;await expect(generator.nextSourceRecordingFrame(opened.handle,1,12)).rejects.toThrow('改变');expect(draws).toHaveLength(afterFailure);
  const frame=await generator.nextSourceRecordingFrame(opened.handle,1,24);expect(frame.domainLive).toMatchObject({updateOrdinal:1,actualFrameRate:24});expect(next).toHaveBeenCalledTimes(1);
  generator.cancel();expect(generator.hasSourceRecording(opened.handle)).toBe(true);
  const stopGate=hold(),stopping=generator.finishSourceRecording(opened.handle),stopRejected=expect(stopping).rejects.toMatchObject({message:'restore rejected',recordingRetained:true,handle:opened.handle});
  await stopGate.entered.promise;stopGate.ack.reject(Error('restore rejected'));await stopRejected;expect(finish).toHaveBeenCalledTimes(1);expect(generator.hasSourceRecording(opened.handle)).toBe(true);
  const stopped=await generator.finishSourceRecording(opened.handle);expect(finish).toHaveBeenCalledTimes(1);expect(next).toHaveBeenCalledTimes(1);expect(generator.hasSourceRecording(opened.handle)).toBe(false);
  expect(raster(stopped.preview).domainLive).toMatchObject({target:'primary',renderKind:'snapshot',updateOrdinal:1,actualFrameRate:24,rawDt:0,activeDt:0});
  expect(raster(stopped.preview).domainLive!.presentation.evaluatedDomainScene!.clock).toEqual(frame.domainLive!.presentation.evaluatedDomainScene!.clock);
  await generator.setDomainPaused(stopped.preview,true);expect(workers).toBe(0);
 });

 it('waits for a cancelled native ACK before cleanup and never publishes its late primary',async()=>{
  const {generator,author,input,output}=await setup(),gate=hold(),pending=generator.generate(author,input),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  let published=false;void pending.then(()=>{published=true;},()=>{});await gate.entered.promise;generator.cancel();await rejected;
  let settled=false;const settling=generator.settledNativeCleanup().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);expect(published).toBe(false);
  gate.ack.resolve();await settling;expect(published).toBe(false);
  await expect(generator.setDomainPaused(output,true)).rejects.toThrow('主预览');
  const recovered=raster(await generator.generate(author,{...input,domainLive:{...input.domainLive!,sessionId:'after-cancel'}}));
  expect(recovered.domainLive).toMatchObject({sessionId:'after-cancel',updateOrdinal:0});await generator.setDomainPaused(recovered,true);expect(workers).toBe(0);
 });
});
