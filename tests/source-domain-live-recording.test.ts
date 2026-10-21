import {describe,expect,it,vi} from 'vitest';
import {SourceDomainLiveSession} from '../src/engine/sourceDomainLiveSession';
import {planDomainRecordingClock} from '../src/engine/sourceDomainRecording';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateDomain} from '../src/engine/domain';
import {defaultFormulas} from '../src/engine/formulas';
import type {GenerateContext} from '../src/types';
import fixture from './fixtures/source-domain-clock/recording.json';

const bits=(x:number)=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,x);return v.getUint32(0).toString(16).padStart(8,'0');};
function setup(index=2){
 const row=fixture.cases[index],scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'recording',domainColoring:{formula:'z+a'},...row.input})).scene;
 scene.parameters={a:row.initial.values.a.value,b:row.initial.values.b.value};
 Object.assign(scene.settings,{domainRenderPolicy:'source-cpu-always-v1',scale:row.initial.values.scale.value,rotation:row.initial.rotation.value,paletteOffset:row.initial.paletteOffset.value});
 scene.formulas=defaultFormulas();scene.formulas.main.visible=true;scene.formulas.main.latex='captured';
 const context:GenerateContext={time:0,width:24,height:16,quality:'export',domainTarget:{logicalWidth:12,logicalHeight:8,pixelDensity:2},domainLive:{sessionId:'recording',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29,viewport:{logicalWidth:12,logicalHeight:8,pixelDensity:2}}};
 const render=vi.fn(generateDomain),owner=new SourceDomainLiveSession(render);owner.generate(scene,context);
 const options={width:13,height:9,simulationFps:60,actualFrameRate:row.frames[0].state.pAppletFrameRate.value};
 return{scene,context,owner,render,options,row};
}

describe('Domain retained recording',()=>{
 for(let i=0;i<fixture.cases.length;i++)it(`renders original JVM numerical recording: ${fixture.cases[i].name}`,()=>{
  const f=setup(i),plan=planDomainRecordingClock(f.scene,60),started=f.owner.beginRecording(f.scene,f.context,f.options);
  expect(plan).toMatchObject({updates:f.row.frames.length,encodedFrames:f.row.derivedOfferedFrames,lastDisplayFrame:f.row.frames.length-1});
  for(const row of f.row.frames){
   const out=row.index===0?started.warmup:f.owner.nextRecordingFrame(started.handle,row.index,row.state.pAppletFrameRate.value),s=out.domainLive.presentation.evaluatedDomainScene!,e=row.state;
   expect(out).toMatchObject({width:40,height:28,domainLive:{target:'offscreen',clockSource:'fixed-step',updateOrdinal:row.index,paused:false,actualFrameRate:e.pAppletFrameRate.value,recording:{warmup:row.index===0,complete:row.actualAutoRecordingComplete}},domainRender:{target:{logicalWidth:20,logicalHeight:14,density:2},sourceClock:{simulationFps:60}}});
   expect(bits(s.rotation)).toBe(e.rotation.bits);expect(bits(s.rotationRate)).toBe(e.rotationRate.bits);expect(bits(s.clock.sceneTime)).toBe(e.sceneTime.bits);expect(bits(s.paletteOffset)).toBe(e.paletteOffset.bits);
   expect(s.parameters.a).toBeCloseTo(e.values.a.value,13);expect(s.parameters.b).toBe(e.values.b.value);
  }
  expect(()=>f.owner.nextRecordingFrame(started.handle,plan.lastDisplayFrame+1,37)).toThrow();
  const before=f.owner.diagnostics().host!,stop=f.owner.finishRecording(started.handle,2000);
  expect(stop.preview.domainLive).toMatchObject({target:'primary',renderKind:'snapshot',paused:false,updateOrdinal:plan.lastDisplayFrame,rawDt:0,activeDt:0});expect(stop.preview.domainLive.recording).toBeUndefined();
  expect(f.owner.diagnostics().host!.state).toEqual(before.state);expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
  const resumed=f.owner.generate(stop.scene,{...stop.context,domainLive:{...stop.context.domainLive!,clock:{paused:false,timestampMs:2025},actualFrameRate:43}});
  expect(resumed.domainLive).toMatchObject({updateOrdinal:plan.lastDisplayFrame+1,rawDt:Math.fround(Math.fround(2.025)-Math.fround(2)),actualFrameRate:43});
 });
 it('rebuilds full Apply, ignoring hot edits, navigation and staged author changes; retains author draft on finish',()=>{
  const f=setup(),draft=structuredClone(f.scene);draft.equations.f='(';draft.formulas!.main.latex='draft';
  f.owner.updateParameters(f.scene,f.context,[['a',.8]]);f.owner.navigatePaused(f.scene,f.context,{kind:'pan',dx:2,dy:1});
  const oldRenderer=f.render.mock.calls.at(-1)![2],start=f.owner.beginRecording(draft,f.context,f.options);
  expect(start.warmup.domainLive.presentation.parameters.a).toBeCloseTo(f.row.frames[0].state.values.a.value,13);
  expect(start.warmup.domainLive.presentation.settings.centerX).toBe(f.scene.settings.centerX);expect(start.warmup.formulaPresentation.labels[0].latex).toBe('captured');
  expect(f.render.mock.calls.at(-1)![2]).not.toBe(oldRenderer);expect(start.scene.equations.f).toBe(f.scene.equations.f);
  const stop=f.owner.finishRecording(start.handle,2000);expect(stop.scene).toEqual(draft);expect(stop.preview.domainLive.presentation.equations.f).toBe(f.scene.equations.f);
  const snapshot=f.owner.diagnostics().host;f.owner.finishRecording(start.handle,9999);expect(f.owner.diagnostics().host).toEqual(snapshot);
  f.owner.setPaused(true,2100);expect(()=>f.owner.finishRecording(start.handle)).toThrow('身份');
 });
 it('keeps the completed primary on invalid/oversized/cancelled begin or warmup render failure',()=>{
  const f=setup(),before=f.owner.diagnostics();
  for(const options of[{...f.options,actualFrameRate:NaN},{...f.options,simulationFps:0},{...f.options,width:999999}])expect(()=>f.owner.beginRecording(f.scene,f.context,options)).toThrow();
  expect(()=>f.owner.beginRecording(f.scene,{...f.context,isCancelled:()=>true},f.options)).toThrow('取消');
  f.render.mockImplementationOnce(()=>{throw Error('warmup device');});expect(()=>f.owner.beginRecording(f.scene,f.context,f.options)).toThrow('warmup device');
  expect(f.owner.diagnostics()).toEqual(before);expect(f.owner.matchesCompletedPrimary(f.scene,f.context)).toBe(true);
  const start=f.owner.beginRecording(f.scene,f.context,f.options);f.owner.finishRecording(start.handle);
 });
 it('retries a failed frame with the exact consumed observation, then retries stop without advancing/resetting time again',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options);
  expect(()=>f.owner.nextRecordingFrame({...start.handle},1,24)).toThrow('身份');expect(()=>f.owner.nextRecordingFrame(start.handle,2,24)).toThrow('序号');
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,NaN)).toThrow();expect(f.owner.diagnostics().host!.updateOrdinal).toBe(0);
  f.render.mockImplementationOnce(()=>{throw Error('frame device');});expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('frame device');
  const pending=f.owner.diagnostics().host;expect(f.owner.ownsRecording(start.handle)).toBe(true);
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,12)).toThrow('改变');expect(f.owner.diagnostics().host).toEqual(pending);
  expect(f.owner.nextRecordingFrame(start.handle,1,24).domainLive.updateOrdinal).toBe(1);expect(f.owner.diagnostics().host).toEqual(pending);
  f.render.mockImplementationOnce(()=>{throw Error('primary device');});expect(()=>f.owner.finishRecording(start.handle,2000)).toThrow('primary device');
  const finished=f.owner.diagnostics().host;expect(f.owner.ownsRecording(start.handle)).toBe(true);expect(()=>f.owner.nextRecordingFrame(start.handle,2,12)).toThrow();
  const stop=f.owner.finishRecording(start.handle,9000);expect(f.owner.diagnostics().host).toEqual(finished);expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
 });
 it('blocks live operations while recording and permits cleanup after cancellation',()=>{
  const f=setup();let cancel=false;const start=f.owner.beginRecording(f.scene,{...f.context,isCancelled:()=>cancel},f.options);
  expect(()=>f.owner.generate(f.scene,f.context)).toThrow('录制');expect(()=>f.owner.reset()).toThrow('录制');expect(()=>f.owner.updateParameters(f.scene,f.context,[['a',.1]])).toThrow();
  cancel=true;expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('取消');
  const stop=f.owner.finishRecording(start.handle,2000);expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
 });
 it('bounds/cancels planning and preserves signed negative-duration group behavior',()=>{
  const f=setup();expect(()=>planDomainRecordingClock(f.scene,60,()=>true)).toThrow('取消');
  f.scene.timeline.tracks[0].duration=86400;expect(()=>planDomainRecordingClock(f.scene,120)).toThrow('预算');
  f.scene.timeline.tracks[0].duration=-1;expect(planDomainRecordingClock(f.scene,60).updates).toBe(1);
 });
});
