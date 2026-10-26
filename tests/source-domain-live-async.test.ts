import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceDomainLiveSession,type SourceDomainLiveContext} from '../src/engine/sourceDomainLiveSession';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import {DomainRenderSession} from '../src/engine/domainRenderSession';
import {generateDomain} from '../src/engine/domain';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultFormulas} from '../src/engine/formulas';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';

function scene(){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Domain asynchronous owner',type:'DOMAIN_COLORING',domainColoring:{formula:'z+a',parameters:{a:.2,b:.3}},timeline:[{type:'animate',duration:.3,easing:'LINEAR',actions:[{method:'domainRotate',args:[.7]},{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.02}}}}]},{type:'wait',duration:.2}]})).scene;
 s.settings.domainRenderPolicy='source-cpu-always-v1';s.parameters={a:.2,b:.3};
 s.formulas=defaultFormulas();s.formulas.main.visible=true;s.formulas.main.latex='captured';return s;
}
function context(paused=true,timestampMs=1000):GenerateContext&{domainLive:SourceDomainLiveContext}{
 return{time:0,quality:'preview',width:4,height:3,domainLive:{sessionId:'domain-async',revision:0,clock:{paused,timestampMs},actualFrameRate:37,viewport:{logicalWidth:4,logicalHeight:3,pixelDensity:1}}};
}
const recordingOptions={width:2,height:2,simulationFps:10,actualFrameRate:29};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
type Draw={scene:SceneDocument;context:GenerateContext;session:DomainRenderSession;retainedBytes:number;output:ReturnType<typeof generateDomain>};
function controlledRenderer(){
 const calls:Draw[]=[],gates:{entered:ReturnType<typeof deferred<Draw>>;ack:ReturnType<typeof deferred<SceneOutput>>}[]=[];
 const render=vi.fn((s:SceneDocument,c:GenerateContext,session:DomainRenderSession,options:{retainedBytes:number})=>{
  // Real tiny CPU pixels, without density expansion or a GPU presentation pass.
  // The controllable promise models renderer ACK latency/failure only.
  const output=generateDomain(s,c,session),draw={scene:structuredClone(s),context:c,session,retainedBytes:options.retainedBytes,output};
  calls.push(draw);const gate=gates.shift();if(!gate)return output;gate.entered.resolve(draw);return gate.ack.promise;
 });
 return{render,calls,hold(){const gate={entered:deferred<Draw>(),ack:deferred<SceneOutput>()};gates.push(gate);return gate;}};
}
function withoutTiming(output:SceneOutput){const {elapsedMs:_,...stats}=output.stats;return{...output,stats};}
afterEach(()=>vi.restoreAllMocks());

describe('Domain shared live owner with asynchronous CPU renderer acknowledgements',()=>{
 it('captures caller inputs before waiting and blocks competing controls until ACK',async()=>{
  const s=scene(),original=structuredClone(s),c=context(),saved=structuredClone(c),f=controlledRenderer(),gate=f.hold(),progress=vi.fn();
  c.domainLive.configuration=structuredClone(s);
  const owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render}),pending=owner.generateAsync(s,{...c,onProgress:progress});
  s.equations.f='(';c.domainLive.configuration.equations.f='(';c.domainLive.configuration.parameters.a=99;c.width=99;c.domainLive.viewport!.logicalWidth=99;c.domainLive.sessionId='mutated';
  const draw=await gate.entered.promise;
  expect(draw.scene.equations).toEqual(original.equations);expect(draw.scene.parameters.a).toBe(.2);expect(draw.context.width).toBe(4);
  expect(owner.matchesCompletedPrimary(original,saved)).toBe(false);
  expect(()=>owner.setPaused(false)).toThrow();expect(()=>owner.updateParameters(original,saved,[['a',.7]])).toThrow();expect(()=>owner.reset()).toThrow();
  await expect(owner.generateAsync(original,saved)).rejects.toThrow();expect(()=>owner.generate(original,saved)).toThrow();
  gate.ack.resolve(draw.output);const output=await pending;
  expect(output.backend).toBe('cpu');expect(output.pixels.byteLength).toBe(48);expect(output.domainLive).toMatchObject({sessionId:'domain-async',viewport:{logicalWidth:4}});
  expect(owner.matchesCompletedPrimary(original,saved)).toBe(true);
  expect(()=>draw.context.onProgress!(draw.output)).not.toThrow();expect(progress).not.toHaveBeenCalled();
 });

 it('matches synchronous CPU pixels and host facts through running, paused resize and full Apply',async()=>{
  const s=scene(),sync=new SourceDomainLiveSession(generateDomain),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render});
  for(const ms of [1000,1050]){
   const c=context(false,ms);expect(withoutTiming(await owner.generateAsync(s,c))).toEqual(withoutTiming(sync.generate(s,c)));
  }
  owner.setPaused(true,1100);sync.setPaused(true,1100);
  const resized={...context(true,1100),width:5},before=owner.diagnostics().host;
  expect(withoutTiming(await owner.generateAsync(s,resized))).toEqual(withoutTiming(sync.generate(s,resized)));expect(owner.diagnostics().host).toEqual(before);
  const changed=structuredClone(s);changed.formulas!.main.latex='applied';changed.settings.background='#123456';
  const apply={...resized,domainLive:{...resized.domainLive,revision:1,configuration:changed}};
  expect(withoutTiming(await owner.generateAsync(changed,apply))).toEqual(withoutTiming(sync.generate(changed,apply)));
  expect(f.calls[0].session).toBe(f.calls[2].session);expect(f.calls[3].session).not.toBe(f.calls[2].session);
 });

 it.each(['promise','thenable'] as const)('rejects a %s returned to the synchronous driver',kind=>{
  const render=(s:SceneDocument,c:GenerateContext,session:DomainRenderSession):SceneOutput=>{
   const output=generateDomain(s,c,session);
   return (kind==='promise'?Promise.resolve(output):{then:(resolve:(value:SceneOutput)=>void)=>resolve(output)}) as unknown as SceneOutput;
  };
  const owner=new SourceDomainLiveSession(render),s=scene(),c=context();
  expect(()=>owner.generate(s,c)).toThrow(/thenable|async/i);expect(owner.matchesCompletedPrimary(s,c)).toBe(false);owner.reset();
 });

 it('soft reset and settle wait for ACK while suppressing cancelled output and late progress',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),gate=f.hold(),progress=vi.fn(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render});
  const pending=owner.generateAsync(s,{...c,onProgress:progress}),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'}),draw=await gate.entered.promise;
  let settled=false,reset=false;const settling=owner.settle().then(()=>{settled=true;}),resetting=owner.resetAsync().then(()=>{reset=true;});
  await Promise.resolve();expect(settled).toBe(false);expect(reset).toBe(false);expect(draw.context.isCancelled!()).toBe(true);
  expect(()=>draw.context.onProgress!(draw.output)).not.toThrow();expect(progress).not.toHaveBeenCalled();
  gate.ack.resolve(draw.output);await rejected;await Promise.all([settling,resetting]);
  expect(owner.diagnostics()).toMatchObject({sessionId:'',failed:false,host:undefined});expect(owner.matchesCompletedPrimary(s,c)).toBe(false);
  expect((await owner.generateAsync(s,c)).domainLive.updateOrdinal).toBe(0);
 });

 it('checks revocation after renderer ACK but before the owning operation resumes',async()=>{
  const s=scene(),c=context();let resetting:Promise<void>|undefined;
  const owner=new SourceDomainLiveSession(undefined,{asyncRender:(s,c,session)=>Promise.resolve(generateDomain(s,c,session)).then(output=>{resetting=owner.resetAsync();return output;})});
  await expect(owner.generateAsync(s,c)).rejects.toMatchObject({name:'AbortError'});await resetting;
  expect(owner.matchesCompletedPrimary(s,c)).toBe(false);expect(owner.diagnostics().sessionId).toBe('');
 });

 it('holds navigation publication until ACK and snapshots the gesture without another numerical update',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render}),sync=new SourceDomainLiveSession(generateDomain);
  await owner.generateAsync(s,c);sync.generate(s,c);const before=owner.diagnostics().host!,event={kind:'pan' as const,dx:1,dy:-1},gate=f.hold();
  const pending=owner.navigatePausedAsync(s,c,event);event.dx=100;event.dy=100;
  const expected=sync.navigatePaused(s,c,{kind:'pan',dx:1,dy:-1}),draw=await gate.entered.promise;
  expect(owner.matchesCompletedPrimary(s,c)).toBe(false);expect(()=>owner.setPaused(false)).toThrow();expect(()=>owner.updateParameters(s,c,[['a',.8]])).toThrow();
  gate.ack.resolve(draw.output);const output=await pending;
  expect(withoutTiming(output)).toEqual(withoutTiming(expected));expect(output.domainLive).toMatchObject({renderKind:'snapshot',updateOrdinal:before.updateOrdinal,sceneTime:before.state.clock.sceneTime,rawDt:0,activeDt:0});
  expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
 });

 it('awaits both capture draws and accounts for retained pixels without advancing the host',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render}),initial=await owner.generateAsync(s,c),before=owner.diagnostics().host;
  const first=f.hold(),second=f.hold(),extra=initial.pixels.byteLength,pending=owner.capturePausedAsync(s,{...c,quality:'export',width:5,height:2},{additionalBytes:extra});
  const capture=await first.entered.promise;
  expect(f.calls).toHaveLength(2);expect(capture.retainedBytes).toBe(extra);expect(capture.context.domainTarget).toEqual({logicalWidth:5,logicalHeight:2,pixelDensity:1});expect(owner.matchesCompletedPrimary(s,c)).toBe(false);
  first.ack.resolve(capture.output);const preview=await second.entered.promise;
  expect(preview.retainedBytes).toBe(extra+capture.output.pixels.byteLength);expect(preview.session).toBe(capture.session);expect(preview.context.width).toBe(c.width);
  second.ack.resolve(preview.output);const result=await pending;
  expect(result.capture).toMatchObject({width:5,height:2,backend:'cpu',domainLive:{renderKind:'snapshot',target:'offscreen'}});
  expect(result.preview.domainLive!.presentation).toEqual(result.capture.domainLive!.presentation);expect(result.capture.formulaPresentation).toEqual(initial.formulaPresentation);
  expect(owner.diagnostics().host).toEqual(before);expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
 });

 it('keeps the old primary after failed warmup and commits the candidate only after success',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render});await owner.generateAsync(s,c);
  const before=owner.diagnostics().host,oldRenderer=f.calls[0].session,gate=f.hold(),options={...recordingOptions},pending=owner.beginRecordingAsync(s,c,options),rejected=expect(pending).rejects.toThrow('warmup rejected');
  options.actualFrameRate=99;options.width=99;const draw=await gate.entered.promise;
  expect(draw.context.width).toBe(recordingOptions.width*3);expect(owner.diagnostics().host).toEqual(before);expect(draw.session).not.toBe(oldRenderer);
  draw.session.fail({stage:'render',reason:'candidate failure'});gate.ack.reject(Error('warmup rejected'));await rejected;
  expect(draw.session.failure()).toBeUndefined();expect(oldRenderer.failure()).toBeUndefined();expect(owner.matchesCompletedPrimary(s,c)).toBe(true);expect(owner.diagnostics().host).toEqual(before);
  const start=await owner.beginRecordingAsync(s,c,recordingOptions);expect(start.warmup.domainLive.actualFrameRate).toBe(recordingOptions.actualFrameRate);expect(owner.ownsRecording(start.handle)).toBe(true);
  await expect(owner.resetAsync()).rejects.toThrow('结束');expect(owner.ownsRecording(start.handle)).toBe(true);await owner.finishRecordingAsync(start.handle,2000);await owner.resetAsync();
 });

 it('retries a failed recording frame at the same FPS and retries finish without another host mutation',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render});await owner.generateAsync(s,c);
  const start=await owner.beginRecordingAsync(s,c,recordingOptions),next=vi.spyOn(SourceDomainHostSession.prototype,'nextRecordingFrame'),finish=vi.spyOn(SourceDomainHostSession.prototype,'finishRecording');
  const gate=f.hold(),pending=owner.nextRecordingFrameAsync(start.handle,1,24),rejected=expect(pending).rejects.toThrow('frame rejected'),draw=await gate.entered.promise;
  gate.ack.reject(Error('frame rejected'));await rejected;const consumed=owner.diagnostics().host;
  expect(owner.ownsRecording(start.handle)).toBe(true);expect(next).toHaveBeenCalledTimes(1);
  await expect(owner.nextRecordingFrameAsync(start.handle,1,12)).rejects.toThrow('改变');expect(next).toHaveBeenCalledTimes(1);
  const retried=await owner.nextRecordingFrameAsync(start.handle,1,24);expect(retried.pixels).toEqual(draw.output.pixels);expect(owner.diagnostics().host).toEqual(consumed);expect(next).toHaveBeenCalledTimes(1);
  const stopGate=f.hold(),stopping=owner.finishRecordingAsync(start.handle,2000),stopRejected=expect(stopping).rejects.toThrow('restore rejected');await stopGate.entered.promise;
  stopGate.ack.reject(Error('restore rejected'));await stopRejected;const finished=owner.diagnostics().host;
  expect(finish).toHaveBeenCalledTimes(1);expect(owner.ownsRecording(start.handle)).toBe(true);
  const stop=await owner.finishRecordingAsync(start.handle,9000);expect(finish).toHaveBeenCalledTimes(1);expect(owner.diagnostics().host).toEqual(finished);expect(next).toHaveBeenCalledTimes(1);
  expect(stop.preview.domainLive).toMatchObject({renderKind:'snapshot',rawDt:0,activeDt:0,updateOrdinal:1,actualFrameRate:24});expect(owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
 });

 it('retains an active recording handle when reset revokes a pending frame',async()=>{
  const s=scene(),c=context(),f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render});await owner.generateAsync(s,c);
  const start=await owner.beginRecordingAsync(s,c,recordingOptions),gate=f.hold(),pending=owner.nextRecordingFrameAsync(start.handle,1,24),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'}),draw=await gate.entered.promise;
  const resetting=owner.resetAsync(),resetRejected=expect(resetting).rejects.toThrow('结束');
  expect(draw.context.isCancelled!()).toBe(true);gate.ack.resolve(draw.output);await rejected;await resetRejected;
  expect(owner.ownsRecording(start.handle)).toBe(true);expect(owner.diagnostics().sessionId).toBe(c.domainLive.sessionId);
  const stop=await owner.finishRecordingAsync(start.handle,2000);expect(owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);await owner.resetAsync();
 });

 it('uses the page clock across reconstruction, Apply, recording stop and injected timestamps',async()=>{
  const s=scene(),c=context(false);delete c.domainLive.clock.timestampMs;let now=1000;
  const f=controlledRenderer(),owner=new SourceDomainLiveSession(undefined,{asyncRender:f.render,hostClock:{now:()=>now,source:'page-wall-clock'}});
  expect((await owner.generateAsync(s,c)).domainLive).toMatchObject({clockSource:'page-wall-clock',rawDt:0});now=1100;
  expect((await owner.generateAsync(s,c)).domainLive.rawDt).toBe(Math.fround(Math.fround(1.1)-1));
  const seek={...c,domainLive:{...c.domainLive,sessionId:'seek',startAt:.1}};
  expect((await owner.generateAsync(s,seek)).domainLive).toMatchObject({clockSource:'page-wall-clock',renderKind:'snapshot'});
  const apply={...seek,domainLive:{...seek.domainLive,revision:1,configuration:s}};
  expect((await owner.generateAsync(s,apply)).domainLive).toMatchObject({clockSource:'page-wall-clock',updateOrdinal:0});
  const start=await owner.beginRecordingAsync(s,apply,recordingOptions);expect(start.warmup.domainLive.clockSource).toBe('fixed-step');now=2000;
  const stop=await owner.finishRecordingAsync(start.handle);expect(stop.preview.domainLive.clockSource).toBe('page-wall-clock');now=2050;
  expect((await owner.generateAsync(s,stop.context)).domainLive.rawDt).toBe(Math.fround(Math.fround(2.05)-2));
  const injected={...stop.context,domainLive:{...stop.context.domainLive!,clock:{paused:false,timestampMs:2100}}};
  expect((await owner.generateAsync(s,injected)).domainLive.clockSource).toBe('injected');
 });
});
