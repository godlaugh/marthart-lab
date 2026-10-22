import {describe,it,expect,vi} from 'vitest';
import native from './fixtures/source-surface-scene/recording-native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {outputBuffers} from '../src/engine/outputBuffers';
import {planSourceSurfaceRecording} from '../src/engine/sourceSurfaceRecording';
import type {SceneOutput,GenerationInput} from '../src/types';
function geometry(output:SceneOutput){if(output.type!=='geometry')throw Error('geometry');return output;}
function fixture(name='animated-mesh',backend='CPU',density=1){
 const trace=native.actual.cases.find(c=>c.input.name===name)!;
 const project=structuredClone(trace.input.project);project.settings.render_mode=backend;
 const scene=parseProjectFile(JSON.stringify(project)).scene;
 const c:GenerationInput={time:0,width:64*density,height:48*density,quality:'preview',sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'record',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29}};
 const owner=new SourceSurfaceLiveSession(),initial=owner.generate(scene,c);
 return{trace,scene,c,owner,initial,options:{width:17,height:13,simulationFps:4,actualFrameRate:37}};
}
describe('retained Surface recording owner',()=>{
 for(const row of native.actual.cases)it('matches original numerical recording: '+row.input.name,()=>{
  const f=fixture(row.input.name),{owner,scene,c,options}=f,start=owner.beginRecording(scene,c,options);
  expect(start.clock.updates).toBe(row.frames.length);expect(start.clock.encodedFrames).toBe(row.frames.length-1);
  for(const [index,record]of row.frames.entries()){
   const rate=row.input.steps[index].actualFrameRate,out=index===0?start.warmup:owner.nextRecordingFrame(start.handle,index,rate),expected=record.state,frame=out.surfaceLive!.frame;
   expect(frame).toMatchObject({frameIndex:index,sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueIndex:expected.queueIndex,queueComplete:expected.queueComplete});
   for(const key of ['phi','theta','gamma','zoom','focalDistance'] as const)expect(frame.camera[key]).toBe(expected.camera[key]);
   expect(frame.rates).toEqual([expected.camera.phiRate,expected.camera.thetaRate,expected.camera.gammaRate]);
   expect(out.topology).toBe(expected.mode==='MESH'?'mesh':'points');
   // CPU mesh x=a+u at u=0 is derived from the original function's scalar;
   // point positions are direct original Dot3D observations, not pixels.
   expect(out.positions[0]).toBe(expected.mode==='MESH'?Math.fround(expected.value.value):expected.firstPosition![0]);
   expect(out.surfaceLive).toMatchObject({clockSource:'fixed-step',paused:false,constructions:2,recording:{displayFrame:index,actualFrameRate:rate,warmup:index===0,complete:record.autoComplete}});
   structuredClone(out,{transfer:outputBuffers(out)});
  }
  expect(row.beforeStop).toEqual(row.afterStop);
  const before=owner.diagnostics().frame,stop=owner.finishRecording(start.handle,2000);expect(stop.preview.surfaceLive!.frame).toEqual(before);expect(stop.preview.sourceCameraFrame!.viewport.target).toBe('primary');
  expect(stop.preview.surfaceLive!.recording).toBeUndefined();expect(owner.ownsRecording(start.handle)).toBe(false);
  const retry=owner.finishRecording(start.handle,9000);expect(retry.preview.surfaceLive!.frame).toEqual(before);
  const resumed=geometry(owner.generate(scene,{...stop.context,surfaceLive:{...stop.context.surfaceLive!,clock:{paused:false,timestampMs:2250},actualFrameRate:43}}));expect(resumed.surfaceLive!.frame.rawDt).toBe(.25);expect(resumed.surfaceLive!.frame.frameIndex).toBe(row.frames.length);
  expect(()=>owner.finishRecording(start.handle)).toThrow();owner.reset();
 });
 it('reloads the full applied anchor, preserves draft and ignores paused navigation/hot parameter changes',()=>{
  const f=fixture();f.owner.updateParameter(f.scene,f.c,'a',.9);f.owner.navigatePaused(f.scene,f.c,{kind:'drag',dx:30,dy:20});f.owner.navigatePaused(f.scene,f.c,{kind:'wheel',count:-3});
  const draft=structuredClone(f.scene);draft.equations.x='(';draft.name='unsaved draft';
  const start=f.owner.beginRecording(draft,f.c,f.options);expect(start.scene.equations).toEqual(f.scene.equations);expect(start.scene.parameters.a).toBe(.25);expect(start.warmup.surfaceLive!.frame.camera.zoom).toBe(1);
  draft.name='later mutation';const stop=f.owner.finishRecording(start.handle,2000);expect(stop.scene.name).toBe('unsaved draft');expect(stop.scene.equations.x).toBe('(');expect(stop.context.surfaceLive!.clock.paused).toBe(false);f.owner.reset();
 });
 it('uses 3x and inherited-density rounding for the actual recording geometry',()=>{
  const f=fixture('animated-mesh','GPU',2),start=f.owner.beginRecording(f.scene,f.c,f.options);
  expect(start.warmup.sourceCameraFrame!.viewport).toMatchObject({logicalWidth:26,logicalHeight:20,referenceLogicalHeight:48,target:'offscreen'});expect(start.warmup.sourceGpuMesh?.referencePixelDensity).toBe(2);
  f.owner.finishRecording(start.handle,2000);f.owner.reset();
 });
 it('rejects preflight/identity errors without losing the primary or advancing recording',()=>{
  const f=fixture();for(const options of [{...f.options,actualFrameRate:NaN},{...f.options,simulationFps:0},{...f.options,width:30000}])expect(()=>f.owner.beginRecording(f.scene,f.c,options)).toThrow();
  expect(f.owner.matchesCompletedPrimary(f.scene,f.c)).toBe(true);expect(f.owner.diagnostics().constructions).toBe(1);
  const start=f.owner.beginRecording(f.scene,f.c,f.options),before=f.owner.diagnostics().frame;
  for(const operation of [()=>f.owner.nextRecordingFrame({},1,37),()=>f.owner.nextRecordingFrame(start.handle,2,37),()=>f.owner.nextRecordingFrame(start.handle,1,NaN),()=>f.owner.generate(f.scene,f.c),()=>f.owner.reset(),()=>f.owner.setPaused(true)])expect(operation).toThrow();
  expect(f.owner.diagnostics().frame).toEqual(before);f.owner.finishRecording(start.handle,2000);f.owner.reset();
 });
 it('retains prior preview if warmup geometry fails, and keeps pending numerical updates for retry',()=>{
  const f=fixture(),boundary=f.owner as unknown as {display(...args:unknown[]):SceneOutput};
  const fault=vi.spyOn(boundary,'display');fault.mockImplementationOnce(()=>{throw Error('warmup geometry failed');});
  expect(()=>f.owner.beginRecording(f.scene,f.c,f.options)).toThrow('warmup');expect(f.owner.matchesCompletedPrimary(f.scene,f.c)).toBe(true);expect(f.owner.diagnostics().constructions).toBe(1);
  const start=f.owner.beginRecording(f.scene,f.c,f.options);fault.mockImplementationOnce(()=>{throw Error('frame geometry failed');});
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('frame geometry');const consumed=f.owner.diagnostics().frame;
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,37)).toThrow('已消费');expect(f.owner.diagnostics().frame).toEqual(consumed);
  const retry=f.owner.nextRecordingFrame(start.handle,1,24);expect(retry.surfaceLive!.frame).toEqual(consumed);
  fault.mockImplementationOnce(()=>{throw Error('stop geometry failed');});expect(()=>f.owner.finishRecording(start.handle,2000)).toThrow('stop geometry');
  expect(f.owner.ownsRecording(start.handle)).toBe(true);const stop=f.owner.finishRecording(start.handle,9000);expect(stop.preview.surfaceLive!.frame).toEqual(consumed);
  const resumed=geometry(f.owner.generate(f.scene,{...stop.context,surfaceLive:{...stop.context.surfaceLive!,clock:{paused:false,timestampMs:2250}}}));expect(resumed.surfaceLive!.frame.rawDt).toBe(.25);fault.mockRestore();f.owner.reset();
 });
 it('cancels before mutation and still allows stop cleanup',()=>{
  const f=fixture();let cancelled=false;const c={...f.c,isCancelled:()=>cancelled};
  const start=f.owner.beginRecording(f.scene,c,f.options);cancelled=true;expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('取消');const before=f.owner.diagnostics().frame;
  const stop=f.owner.finishRecording(start.handle,2000);expect(stop.preview.surfaceLive!.frame).toEqual(before);f.owner.reset();
 });
 it('stops after cancellation following a consumed update without replaying or dropping that state',()=>{
  const f=fixture();let cancelled=false;const start=f.owner.beginRecording(f.scene,{...f.c,isCancelled:()=>cancelled},f.options);
  const boundary=f.owner as unknown as {display(...args:unknown[]):SceneOutput},display=boundary.display.bind(f.owner);
  const fault=vi.spyOn(boundary,'display').mockImplementationOnce((...args)=>{const output=display(...args);cancelled=true;return output;});
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('取消');
  const consumed=f.owner.diagnostics().frame;expect(consumed!.frameIndex).toBe(1);expect(f.owner.diagnostics().recording?.pending).toBe(true);
  const stop=f.owner.finishRecording(start.handle,2000);expect(stop.preview.surfaceLive!.frame).toEqual(consumed);
  expect(stop.context.surfaceLive!.actualFrameRate).toBe(24);fault.mockRestore();f.owner.reset();
 });
 it('keeps bounded queue planning independent of observed FPS and rejects unavailable source models',()=>{
  const f=fixture();expect(planSourceSurfaceRecording(f.scene,4).updates).toBe(5);expect(()=>planSourceSurfaceRecording(f.scene,4,()=>true)).toThrow('取消');
  expect(()=>planSourceSurfaceRecording({...f.scene,kind:'map'},4)).toThrow('源配置');f.owner.reset();
 });
});
