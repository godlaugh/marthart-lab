import {describe,expect,it,vi} from 'vitest';
import fixture from './fixtures/source-fractal-runtime/source.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {SourceFractalSceneRuntime,type SourceFractalSceneRuntimeConfiguration} from '../src/engine/sourceFractalSceneRuntime';
import {SourceFractalHostSession} from '../src/engine/sourceFractalHostSession';

const F=Math.fround;
function configuration(index=0):SourceFractalSceneRuntimeConfiguration {
 const input=fixture.initialInput;
 const c=prepareSourceFractalScene(parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Fractal numerical host',type:'FRACTAL',fractal:{formula_id:input.formula,type:input.fractalType,power:input.powerBeforeBinder,parameters:input.parameters},timeline:fixture.cases[index].input.timeline})).scene);
 // Same explicit numerical seeds as the retained original-JVM fixture.
 Object.assign(c.initial,{centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:input.zoom,rotation:input.rotation,rotationRate:input.rotationRate,iterations:input.iterations,ambientRates:[...input.ambientRates]});
 return{...c,gradient:{palette:input.gradient[0],inside:input.gradient[1],outside:input.gradient[2]},cameraAngles:[0,0,0],fps:input.frameRate};
}
function replacement():SourceFractalSceneRuntimeConfiguration {
 const c=configuration();return{...c,initial:{...c.initial,centerX:2,rotation:1.25,rotationRate:99,currentTime:900,ambientRates:[4,5,6]},gradient:{palette:.5,inside:.6,outside:.7},clips:[{kind:'wait',duration:3}],cameraAngles:[.1,.2,.3]};
}
const runtime=(c:SourceFractalSceneRuntimeConfiguration)=>new SourceFractalSceneRuntime(c,{reserve(){}});

describe('numerical Fractal same-instance host lifecycle',()=>{
 it('resumes a paused local reconstruction from its reconstructed camera',()=>{
  const c=configuration(),host=new SourceFractalHostSession(c,{paused:true});
  const reconstructed=host.reconstruct(.1);expect(reconstructed.state.scene.cameraAngles[1]).toBeGreaterThan(0);
  const resumed=host.setPaused(false,500);expect(resumed.state.scene.cameraAngles).toEqual(reconstructed.state.scene.cameraAngles);expect(resumed.updateOrdinal).toBe(reconstructed.updateOrdinal);
 });
 it('uses the measured frame rate and original first-zero wall-clock update, including signed time',()=>{
  const c=configuration(),a=new SourceFractalHostSession(c),b=new SourceFractalHostSession(c);
  const first=a.update({paused:false,timestampMs:50},60);b.update({paused:false,timestampMs:50},120);
  expect(first.updateOrdinal).toBe(0);expect(first.state.scene.rawDt).toBe(0);
  const next=a.update({paused:false,timestampMs:100},60),different=b.update({paused:false,timestampMs:100},120);
  const original=fixture.cases[0].frames[1].state;
  expect(next.state.scene.rawDt).toBe(F(.05));expect(next.state.scene.sceneTime).toBe(original.sceneTime.value);
  expect(next.state.scene.object.rotation).toBe(original.fractalRotation.value);
  expect(next.state.formula.native.dynamicParams).toEqual(original.formula.dynamicParams.map(v=>v.value));
  expect(next.state.offsets.inside).toBe(original.gradient.offsets[1].value);
  expect(different.state.formula.parameters).not.toEqual(next.state.formula.parameters);
  for(const fallback of [-1,0,1]){
   const host=new SourceFractalHostSession(c);host.update({paused:false,timestampMs:50},fallback);
   expect(host.update({paused:false,timestampMs:100},fallback).state).toEqual(next.state);
  }
  const reversed=a.update({paused:false,timestampMs:75},60);expect(reversed.state.scene.rawDt).toBeLessThan(0);
 });
 it('pauses without reading time and resumes only the camera/time clock without an update',()=>{
  const now=vi.fn(()=>9000),host=new SourceFractalHostSession(configuration(),{now});
  host.update({paused:false,timestampMs:50},60);const before=host.update({paused:false,timestampMs:100},60);
  const paused=host.setPaused(true);expect(now).not.toHaveBeenCalled();expect(paused.paused).toBe(true);
  expect(paused.state).toEqual(before.state);expect(paused.updateOrdinal).toBe(before.updateOrdinal);
  const frozen=host.update({paused:true},37);expect(now).not.toHaveBeenCalled();expect(frozen.state.scene.object).toEqual(before.state.scene.object);
  expect(frozen.state.scene.objectUpdates).toEqual([]);expect(frozen.state.formula).toEqual(before.state.formula);expect(frozen.state.offsets).toEqual(before.state.offsets);
  const resumed=host.setPaused(false,500);expect(resumed.paused).toBe(false);expect(resumed.updateOrdinal).toBe(frozen.updateOrdinal);
  expect(resumed.state).toEqual(frozen.state);expect(resumed.state.scene.cameraAngles).toEqual(before.state.scene.cameraAngles);
  expect(resumed.hostClock.lastTime).toBe(F(.5));
  host.setPaused(false);expect(now).not.toHaveBeenCalled();
  const next=host.update({paused:false,timestampMs:550},37);expect(next.state.scene.rawDt).toBe(F(F(.55)-F(.5)));
 });
 it('keeps authored, full-load recording anchor and hot mobject state distinct',()=>{
  const c=configuration(),next=replacement(),host=new SourceFractalHostSession(c),control=runtime(c);
  host.update({paused:false,timestampMs:50},60);control.clock.step(0);
  const before=host.update({paused:false,timestampMs:100},60);control.clock.step(F(.05));
  host.setPaused(true);expect(host.snapshot().state.scene.paused).toBe(false); // Last step is deliberately stale.
  const applied=host.applyConfiguration(next);control.applyConfiguration(next);
  expect(applied.state).toEqual(control.snapshot());expect(applied.updateOrdinal).toBe(before.updateOrdinal);
  expect(applied.paused).toBe(true);expect(applied.hostClock.lastTime).toBe(before.hostClock.lastTime);
  expect(applied.state.scene.object.rotationRate).toBe(c.initial.rotationRate);
  expect(applied.state.scene.object.currentTime).toBe(before.state.scene.object.currentTime);
  expect(applied.state.parameters.running).toBe(false);expect(applied.state.parameters.entries).toEqual([]);expect(applied.state.gradient.running).toBe(false);
  expect(host.authoredConfiguration()).toEqual(next);expect(host.recordingApplied()).toEqual(c);
  host.setPaused(false,200);const hot=host.hotApply(c);expect(hot.updateOrdinal).toBe(before.updateOrdinal);expect(hot.state.scene.sceneTime).toBe(before.state.scene.sceneTime);
  const loaded=host.applyConfiguration(next);expect(loaded.updateOrdinal).toBe(-1);expect(loaded.state).toEqual(runtime(next).snapshot());
  expect(host.recordingApplied()).toEqual(next);expect(host.authoredConfiguration()).toEqual(next);expect(loaded.hostClock.lastTime).toBe(0);
 });
 it('records the full-load anchor with one numerical warmup and contiguous complete scene updates',()=>{
  const c=configuration(),next=replacement(),host=new SourceFractalHostSession(c,{paused:true});
  host.applyConfiguration(next);const {handle,warmup}=host.beginRecording(24),control=runtime({...c,fps:24});
  control.clock.step(F(1/24));expect(warmup.state).toEqual(control.snapshot());
  expect(warmup).toMatchObject({mode:'recording',paused:false,updateOrdinal:0,recording:{simulationFps:24,ordinal:0,warmup:true,complete:false}});
  expect(host.authoredConfiguration()).toEqual(next);expect(host.recordingApplied()).toEqual(c);
  let last=warmup,terminalDouble=false;
  for(let ordinal=1;!last.recording!.complete;ordinal++){
   expect(ordinal).toBeLessThan(20);control.clock.step(F(1/24));last=host.nextRecordingFrame(handle,ordinal);
   expect(last.state).toEqual(control.snapshot());expect(last.recording!.ordinal).toBe(ordinal);expect(last.recording!.warmup).toBe(false);
   if(last.recording!.complete)terminalDouble=last.state.scene.objectUpdates.map(x=>x.kind).join(',')==='active,completed';
  }
  expect(terminalDouble).toBe(true);expect(last.state.parameters.running).toBe(true);expect(last.state.gradient.running).toBe(true);
  expect(()=>host.nextRecordingFrame(handle,last.updateOrdinal+1)).toThrow('终帧');expect(host.snapshot()).toEqual(last);
  const stopped=host.finishRecording(handle,5000);expect(stopped.mode).toBe('live');expect(stopped.paused).toBe(false);expect(stopped.recording).toBeUndefined();
  expect(stopped.state).toEqual(last.state);expect(stopped.updateOrdinal).toBe(last.updateOrdinal);expect(stopped.hostClock.lastTime).toBe(5);
  control.setEffectiveFrameRate(120);control.clock.step(F(F(5.05)-5));
  expect(host.update({paused:false,timestampMs:5050},120).state).toEqual(control.snapshot());
 });
 it('handles empty queues and early stop without extra numerical updates',()=>{
  const c={...configuration(),clips:[]},host=new SourceFractalHostSession(c,{paused:true});
  const {handle,warmup}=host.beginRecording(30);expect(warmup.recording).toEqual({simulationFps:30,ordinal:0,warmup:true,complete:true});
  expect(warmup.state.scene.objectUpdates.map(p=>p.kind)).toEqual(['completed']);expect(()=>host.nextRecordingFrame(handle,1)).toThrow('终帧');
  expect(host.finishRecording(handle,1000).state).toEqual(warmup.state);
  host.fullLoad(configuration());const early=host.beginRecording(60);expect(early.warmup.recording!.complete).toBe(false);
  expect(host.finishRecording(early.handle,2000).state).toEqual(early.warmup.state);
  expect(()=>host.finishRecording(early.handle,2000)).toThrow('句柄');
 });
 it('rejects malformed inputs and foreign/out-of-order handles before changing valid state',()=>{
  const c=configuration(),host=new SourceFractalHostSession(c);host.update({paused:false,timestampMs:50},60);
  const before=host.snapshot(),bad={...c,initial:{...c.initial,centerX:NaN}};
  for(const action of [()=>host.fullLoad(bad),()=>host.hotApply(bad),()=>host.applyConfiguration(bad),()=>host.update({paused:true,timestampMs:100},60),()=>host.update({paused:false,timestampMs:100},NaN),()=>host.update({paused:false,timestampMs:NaN},60),()=>host.beginRecording(1.5)]){
   expect(action).toThrow();expect(host.snapshot()).toEqual(before);expect(host.recordingApplied()).toEqual(c);
  }
  const {handle,warmup}=host.beginRecording(60);
  for(const action of [()=>host.nextRecordingFrame({...handle},1),()=>host.nextRecordingFrame(handle,2),()=>host.nextRecordingFrame(handle,1.5),()=>host.nextRecordingFrame(handle,86400*60+1),()=>host.finishRecording(handle,Infinity),()=>host.setPaused(true),()=>host.update({paused:false,timestampMs:100},60),()=>host.hotApply(c),()=>host.applyConfiguration(c),()=>host.fullLoad(c),()=>host.beginRecording(60)]){
   expect(action).toThrow();expect(host.snapshot()).toEqual(warmup);
  }
  expect(host.nextRecordingFrame(handle,1).recording!.ordinal).toBe(1);
 });
 it('owns retained configs and all published nested state without mutable aliases',()=>{
  const input=configuration(),original=structuredClone(input),host=new SourceFractalHostSession(input);
  input.initial.centerX=99;input.initial.ambientRates[1]=88;expect(host.recordingApplied()).toEqual(original);
  const anchor=host.recordingApplied(),authored=host.authoredConfiguration();anchor.initial.centerX=77;authored.initial.ambientRates[1]=66;
  const before=host.snapshot(),published=host.snapshot();published.state.scene.object.centerX=55;published.hostClock.savedAngles.theta=44;
  expect(host.snapshot()).toEqual(before);expect(host.authoredConfiguration()).toEqual(original);expect(host.recordingApplied()).toEqual(original);
  const fresh=host.beginRecording(60);expect(fresh.warmup.state.scene.object.centerX).toBe(0);
 });
 it('preserves valid state on preflight cancellation but fails closed after child mutation and recovers with fullLoad',()=>{
  const c=configuration();let cancelled=false,reject=false;
  const host=new SourceFractalHostSession(c,{isCancelled:()=>cancelled,reserve(){if(reject)throw Error('child budget');}});
  const before=host.snapshot();cancelled=true;expect(()=>host.update({paused:false,timestampMs:50},60)).toThrow('取消');expect(host.snapshot()).toEqual(before);
  cancelled=false;host.update({paused:false,timestampMs:50},60);host.update({paused:false,timestampMs:100},60);
  reject=true;expect(()=>host.hotApply(replacement())).toThrow('child budget');expect(()=>host.snapshot()).toThrow('fullLoad');
  reject=false;host.fullLoad(c);expect(host.snapshot().state).toEqual(runtime(c).snapshot());
  const {handle}=host.beginRecording(60);reject=true;expect(()=>host.nextRecordingFrame(handle,1)).toThrow('child budget');
  expect(()=>host.finishRecording(handle,1000)).toThrow('fullLoad');reject=false;host.fullLoad(c);expect(host.snapshot().mode).toBe('live');
  expect(()=>host.nextRecordingFrame(handle,1)).toThrow('句柄');
 });
 it('shares cancellation and work bounds with real parameter phases, including terminal work',()=>{
  const c=configuration();let cancel=false,arm=false,calls=0;
  const host=new SourceFractalHostSession(c,{isCancelled:()=>cancel,reserve(){calls++;if(arm&&calls===2)cancel=true;}});
  host.update({paused:false,timestampMs:50},60);calls=0;arm=true;
  expect(()=>host.update({paused:false,timestampMs:100},60)).toThrow('取消');expect(()=>host.snapshot()).toThrow('fullLoad');
  cancel=false;arm=false;host.fullLoad(c);
  host.update({paused:false,timestampMs:50},60);
  // A legal finite host FPS can exceed the local phase-work capacity. It must
  // fail rather than silently cap FPS or return a partly advanced snapshot.
  expect(()=>host.update({paused:false,timestampMs:100},1e10)).toThrow();expect(()=>host.snapshot()).toThrow('fullLoad');
  host.fullLoad(c);expect(host.update({paused:false,timestampMs:50},60).updateOrdinal).toBe(0);
 });
});
