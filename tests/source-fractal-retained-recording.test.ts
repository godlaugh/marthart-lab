import displayFixture from './fixtures/source-fractal-display/mandelbrot.json';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {SourceFractalSceneRuntime} from '../src/engine/sourceFractalSceneRuntime';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';
import {prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {parseProjectFile} from '../src/engine/legacyImport';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import {planFractalRecordingClock} from '../src/engine/sourceFractalRecording';
import type {GenerateContext,SceneDocument,SceneOutput,RasterOutput} from '../src/types';
import runtimeOracle from './fixtures/source-fractal-runtime/source.json';

const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'retained source recording',fractal:{formula_id:'newton',parameters:runtimeOracle.initialInput.parameters},timeline:runtimeOracle.cases[1].input.timeline})).scene;
const input=(paused=false):GenerateContext=>({time:0,quality:'preview',width:6,height:4,fractalPixelDensity:2,fractalViewport:{logicalWidth:12,logicalHeight:8,target:'primary'},fractalLive:{sessionId:'retained',revision:0,intent:'apply',clock:{paused,timestampMs:50},actualFrameRate:17}});
const options={width:3,height:5,simulationFps:60};
function setup(){
 const scenes:SceneDocument[]=[],contexts:GenerateContext[]=[];
 // Isolate host ownership and actual numerical updates. These injected pixel
 // buffers and render facts do not establish WebGL or original GPU equivalence.
 const render=vi.fn((s:SceneDocument,c:GenerateContext):SceneOutput=>{scenes.push(structuredClone(s));contexts.push({...c});return{type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{profile:FRACTAL_SOURCE_NUMERIC_PROFILE,execution:{backend:'webgl2'},rasterSize:[c.width,c.height]} as unknown as RasterOutput['fractalRender']};});
 return{owner:new SourceFractalLiveSession(render),render,scenes,contexts};
}
function hot(s:SceneDocument){const draft=structuredClone(s);draft.settings.centerX=9;draft.settings.background='#884422';draft.timeline.tracks=[];return draft;}
afterEach(()=>vi.restoreAllMocks());
describe('retained Fractal recording owns the full-load anchor and final numerical instance',()=>{
 it('rebuilds one display owner at recording warmup and retains it across fixed frames and primary handoff',()=>{
  const s=parseProjectFile(JSON.stringify(displayFixture)).scene,f=setup(),c=input(true);
  for(let i=0;i<4;i++)f.owner.generate(s,c);
  expect(f.contexts.at(-1)!.fractalDisplay).toMatchObject({gradientSize:1024,previewScale:1});
  const start=f.owner.beginRecording(s,c,options);
  expect(f.contexts.at(-1)!.fractalDisplay).toMatchObject({ordinal:0,gradientSize:0,previewScale:.25});
  for(let ordinal=1;ordinal<=3;ordinal++)f.owner.nextRecordingFrame(start.handle,ordinal);
  expect(f.contexts.slice(-4).map(c=>[c.fractalDisplay!.previewScale,c.fractalDisplay!.gradientSize])).toEqual([[.25,0],[.5,0],[1,0],[1,1024]]);
  const before=f.owner.diagnostics().host!.state;f.owner.finishRecording(start.handle,1000);
  expect(f.contexts.at(-1)!.fractalDisplay).toMatchObject({ordinal:4,stateReset:true,previewScale:.25,gradientSize:1024,useGradientTexture:false});
  expect(f.owner.diagnostics().host!.state).toEqual(before);
 });
 it('discards hot/staged state at begin, renders real warmup/terminal updates and keeps the author draft separate',()=>{
  const s=scene(),f=setup(),initial=input();f.owner.generate(s,initial);
  const draft=hot(s),context={...input(),fractalLive:{...initial.fractalLive!,revision:1,intent:'hot' as const,configuration:draft,clock:{paused:false,timestampMs:100}}};
  f.owner.generate(draft,context);f.owner.setPaused(true);
  const staged=structuredClone(draft);staged.settings.centerX=99;staged.settings.perturbationPrecision='UNKNOWN';
  const paused={...context,fractalLive:{...context.fractalLive,configuration:undefined,clock:{paused:true}}};f.owner.generate(staged,paused);
  const authorBefore=structuredClone(staged),start=f.owner.beginRecording(staged,paused,options),clock=planFractalRecordingClock(s,60),control=new SourceFractalSceneRuntime({...prepareSourceFractalScene(s),fps:60},{reserve:()=>{}});
  expect(start.clock).toEqual(clock);expect(start.clock.encodedFrames).toBeGreaterThan(0);expect(start.scene).toEqual(s);expect(start.context.fractalLive).toMatchObject({sessionId:'retained',revision:1,actualFrameRate:17,clock:{paused:false}});expect(start.context.fractalLive).not.toHaveProperty('configuration');
  expect(start.warmup).toMatchObject({width:10,height:16,fractalRecording:{displayFrame:0,warmup:true},fractalLive:{clock:'fixed-source-queue',clockSource:'fixed-step',target:'offscreen',paused:false,actualFrameRate:60}});
  expect(f.contexts.at(-1)!.fractalViewport).toEqual({logicalWidth:5,logicalHeight:8,target:'offscreen'});
  const frames=[start.warmup];for(let ordinal=1;ordinal<=clock.lastDisplayFrame;ordinal++)frames.push(f.owner.nextRecordingFrame(start.handle,ordinal));
  for(const [ordinal,frame] of frames.entries()){
   control.clock.step(Math.fround(1/60));
   const actual=frame.fractalLive!.presentation.evaluatedFractalScene!;
   expect(actual).toEqual({...control.snapshot(),displayFrame:ordinal,simulationFps:60});
   expect(frame.fractalRecording).toMatchObject({displayFrame:ordinal,complete:ordinal===clock.lastDisplayFrame,warmup:ordinal===0});
   expect(frame.fractalLive!.presentation.settings.background).toBe(s.settings.background);
  }
  expect(()=>f.owner.nextRecordingFrame(start.handle,clock.lastDisplayFrame+1)).toThrow('连续');
  const before=f.owner.diagnostics().host!,stop=f.owner.finishRecording(start.handle,1000),after=f.owner.diagnostics().host!;
  expect(stop.scene).toEqual(authorBefore);expect(stop.context.fractalLive!.clock).toEqual({paused:false});expect(stop.preview.fractalLive).toMatchObject({clock:'realtime-source-queue',target:'primary',renderKind:'snapshot',objectUpdates:0,rawDt:0,activeDt:0,updateOrdinal:clock.lastDisplayFrame});
  expect(stop.preview.fractalRecording).toBeUndefined();expect(after.state).toEqual(before.state);expect(after.updateOrdinal).toBe(before.updateOrdinal);expect(after.paused).toBe(false);expect(f.owner.ownsRecording(start.handle)).toBe(false);
  expect(f.owner.matchesCompletedPrimary(staged,stop.context)).toBe(true);
  const resumed=f.owner.generate(staged,{...stop.context,fractalLive:{...stop.context.fractalLive!,clock:{paused:false,timestampMs:1050},actualFrameRate:23}});
  expect(resumed.fractalLive!.updateOrdinal).toBe(clock.lastDisplayFrame+1);expect(resumed.fractalLive!.sceneTime).toBeGreaterThan(before.state.scene.sceneTime);expect(resumed.fractalLive!.presentation.settings.perturbationPrecision).toBe(s.settings.perturbationPrecision);
  expect(resumed.fractalLive!.presentation.evaluatedFractalScene!.parameters).not.toEqual(before.state.parameters);expect(staged).toEqual(authorBefore);
 });
 it('paused Apply keeps the old recording anchor, while running Apply installs the complete new anchor',()=>{
  for(const paused of [true,false]){
   const s=scene(),f=setup(),c=input(paused),draft=hot(s);f.owner.generate(s,c);
   const changed={...c,fractalLive:{...c.fractalLive!,revision:1,configuration:draft}};f.owner.generate(draft,changed);
   const start=f.owner.beginRecording(draft,changed,options);
   expect(start.scene.timeline.tracks).toEqual(paused?s.timeline.tracks:[]);expect(start.scene.settings.background).toBe(paused?s.settings.background:draft.settings.background);
   expect(start.clock.encodedFrames===0).toBe(!paused);expect(start.warmup.fractalRecording!.complete).toBe(!paused);f.owner.finishRecording(start.handle,1000);
  }
 });
 it('validates explicit density, rates, dimensions and cancellation before replacing a completed host',()=>{
  for(const density of [undefined,0,1.5,NaN]){
   const s=scene(),f=setup(),c={...input(true),fractalPixelDensity:density};f.owner.generate(s,c);const before=f.owner.diagnostics();
   expect(()=>f.owner.beginRecording(s,c,options)).toThrow();expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
  }
  const s=scene(),f=setup(),c=input(true);f.owner.generate(s,c);const before=f.owner.diagnostics();
  for(const invalid of [{...options,simulationFps:1.5},{...options,width:16384},{...options,height:0}])expect(()=>f.owner.beginRecording(s,c,invalid)).toThrow();
  expect(()=>f.owner.beginRecording(s,{...c,isCancelled:()=>true},options)).toThrow('取消');expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
 it('retains a pending finish after redraw failure and reissues detached handoff pixels without updating or resetting twice',()=>{
  const f=setup(),s=scene(),c=input(),finish=vi.spyOn(SourceFractalHostSession.prototype,'finishRecording');f.owner.generate(s,c);const start=f.owner.beginRecording(s,c,options);f.owner.nextRecordingFrame(start.handle,1);const before=f.owner.diagnostics().host!.state;
  f.render.mockImplementationOnce(()=>{throw Error('primary unavailable');});expect(()=>f.owner.finishRecording(start.handle,1000)).toThrow('primary unavailable');expect(f.owner.ownsRecording(start.handle)).toBe(true);expect(()=>f.owner.generate(s,c)).toThrow('录制');expect(()=>f.owner.reset()).toThrow('结束');
  const stop=f.owner.finishRecording(start.handle,2000);expect(finish).toHaveBeenCalledTimes(1);expect(f.owner.diagnostics().host!.state).toEqual(before);expect(stop.context.time).toBe(before.scene.sceneTime);
  structuredClone(stop.preview.pixels,{transfer:[stop.preview.pixels.buffer]});expect(stop.preview.pixels.byteLength).toBe(0);
  const retried=f.owner.finishRecording(start.handle,3000);expect(retried.preview.pixels.byteLength).toBe(c.width*c.height*4);expect(finish).toHaveBeenCalledTimes(1);expect(f.owner.diagnostics().host!.state).toEqual(before);
  f.owner.setPaused(true);expect(()=>f.owner.finishRecording(start.handle)).toThrow('身份');
 });
 it('fails closed after an actual warmup/recorded render fails, but permits explicit new-session recovery',()=>{
  for(const warmup of [true,false]){
   const f=setup(),s=scene(),c=input();f.owner.generate(s,c);
   let handle:object|undefined;
   if(!warmup)handle=f.owner.beginRecording(s,c,options).handle;
   f.render.mockImplementationOnce(()=>{throw Error('lost render');});expect(()=>warmup?f.owner.beginRecording(s,c,options):f.owner.nextRecordingFrame(handle!,1)).toThrow('lost render');
   expect(f.owner.diagnostics().failed).toBe(true);expect(f.owner.matchesCompletedPrimary(s,c)).toBe(false);if(handle)expect(f.owner.ownsRecording(handle)).toBe(false);
   expect(f.owner.generate(s,{...c,fractalLive:{...c.fractalLive!,sessionId:'recover'}}).fractalLive!.rawDt).toBe(0);
  }
 });
 it('rejects foreign/skipped frames and all competing operations without advancing a recording',()=>{
  const f=setup(),s=scene(),c=input(),start=(f.owner.generate(s,c),f.owner.beginRecording(s,c,options)),before=f.owner.diagnostics();
  for(const [handle,index] of [[{},1],[start.handle,2],[start.handle,NaN]] as const)expect(()=>f.owner.nextRecordingFrame(handle,index)).toThrow();
  expect(()=>f.owner.finishRecording({})).toThrow('身份');expect(()=>f.owner.setPaused(true)).toThrow();expect(()=>f.owner.capturePaused(s,c)).toThrow();expect(()=>f.owner.generate(s,c)).toThrow();expect(f.owner.diagnostics()).toEqual(before);
  f.owner.finishRecording(start.handle,1000);
 });
});
