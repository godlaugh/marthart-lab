import {describe,it,expect} from 'vitest';
import {SourceGeometryRecordingLease} from '../src/engine/sourceGeometryRecordingLease';
import {SourceImplicitRecordingSession} from '../src/engine/sourceImplicitRecording';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GeometryRecordingRenderer} from '../src/engine/renderGeometryRecording';
import type {GenerateContext,SceneOutput} from '../src/types';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
function setup(){
 const raw=structuredClone(native.cases[0].input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const cold=parseProjectFile(JSON.stringify(raw)).scene;cold.implicitSourcePalette={colors:['#80112233']};cold.settings.opacity=1;cold.settings.meshWireframe=false;
 // This staged formula layout must not be used to reinterpret the cold output.
 cold.formulas={main:cold.formulas!.main,additional:[],referenceWidth:405,referenceHeight:486};
 const author=structuredClone(cold);author.implicitSourcePalette={colors:['#aabbcc']};author.settings.background='#ff0000';author.settings.opacity=.1;author.formulas={layout:'source-surface-centered-v1',main:cold.formulas.main,additional:[]};
 const context:GenerateContext={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(cold,405,486,'primary',486),implicitControls:{sessionId:'palette-lease',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:cold},{kind:'palette',revision:2,colors:author.implicitSourcePalette.colors}]}};
 const owner=new SourceImplicitRecordingSession();const output=owner.generateControlled(author,context,(scene,palette)=>{
  const {implicitControls:_,...input}=context;const value=generateScene(scene,{...input,implicitPalettePrepared:palette});if(value.type!=='geometry')throw Error('geometry');return value;
 });
 const options={width:128,height:96,simulationFps:4,actualFrameRate:37};
 const lease=new SourceGeometryRecordingLease(author,context,output,options);
 const start=owner.beginRecording(author,context,options);
 return{cold,author,context,output,owner,options,lease,start};
}
const fakeRenderer=class {
 async render(output:Extract<SceneOutput,{type:'geometry'}>){return{type:'raster',width:128,height:96,pixels:new Uint8ClampedArray(128*96*4),stats:output.stats,implicitControls:output.implicitControls} as Extract<SceneOutput,{type:'raster'}>;}
 dispose(){}
} as unknown as typeof GeometryRecordingRenderer;
const draw=(lease:SourceGeometryRecordingLease)=>lease.render(fakeRenderer,()=>false,{generation:1,sequence:1});
describe('Implicit explicit palette recording lease',()=>{
 it('retains staged author while accepting cold warmup, canonical acknowledgement, frames and stop',async()=>{
  const f=setup();expect(f.output.implicitControls).toEqual({sessionId:'palette-lease',revision:2,applyRevision:1,resetRevision:1});
  expect(f.output.sourceImplicitPresentation!.fillColors.slice(0,4)).toEqual(new Float32Array([170/255,187/255,204/255,1]));
  expect(f.start.scene).toEqual(f.author);expect(f.start.warmup.sourceBackgroundColor).toBe(0xff000000);
  expect(f.start.warmup.sourceImplicitPresentation!.fillColors.slice(0,4)).toEqual(new Float32Array([17/255,34/255,51/255,128/255]));
  expect(f.start.context.implicitControls).toEqual({sessionId:'palette-lease',acknowledgedRevision:2,commands:[]});
  f.lease.acceptStart(f.start);expect(f.lease.scene).toEqual(f.author);await draw(f.lease);
  f.lease.requestFrame(1,12);const frame=f.owner.nextRecordingFrame(f.start.handle,1,12);f.lease.acceptFrame(frame,1);expect((await draw(f.lease)).implicitControls).toEqual(f.start.warmup.implicitControls);
  const stop=f.owner.finishRecording(f.start.handle);f.lease.acceptStop(stop);expect(stop.scene).toEqual(f.author);expect(stop.preview.implicitControls).toEqual(f.start.warmup.implicitControls);
 });
 it.each(['sessionId','revision','applyRevision','resetRevision','missing'] as const)('rejects a forged start %s without consuming the valid start',key=>{
  const f=setup(),bad=structuredClone(f.start);
  if(key==='missing')delete bad.warmup.implicitControls;else if(key==='sessionId')bad.warmup.implicitControls!.sessionId='foreign';else bad.warmup.implicitControls![key]++;
  expect(()=>f.lease.acceptStart(bad)).toThrow();expect(f.lease.clock).toBeUndefined();expect(()=>f.lease.acceptStart(f.start)).not.toThrow();f.owner.finishRecording(f.start.handle);
 });
 it('rejects unacknowledged/replayed envelopes and forged author snapshots at start/stop',()=>{
  const f=setup();const pending=structuredClone(f.start);pending.context.implicitControls=f.context.implicitControls;expect(()=>f.lease.acceptStart(pending)).toThrow('起始');
  const changed=structuredClone(f.start);changed.scene.settings.background='#ffffff';expect(()=>f.lease.acceptStart(changed)).toThrow('起始');f.lease.acceptStart(f.start);
  const stop=f.owner.finishRecording(f.start.handle),bad=structuredClone(stop);bad.context.implicitControls!.commands=[{kind:'restart',revision:3}];expect(()=>f.lease.acceptStop(bad)).toThrow('停止');
  const author=structuredClone(stop);author.scene=f.cold;expect(()=>f.lease.acceptStop(author)).toThrow('停止');expect(()=>f.lease.acceptStop(stop)).not.toThrow();
 });
 it('rejects changed per-frame and stop receipts, preserving retry of the valid numerical frame',async()=>{
  const f=setup();f.lease.acceptStart(f.start);await draw(f.lease);f.lease.requestFrame(1,12);
  const frame=f.owner.nextRecordingFrame(f.start.handle,1,12),bad=structuredClone(frame);bad.implicitControls!.resetRevision++;expect(()=>f.lease.acceptFrame(bad,1)).toThrow('回执');f.lease.acceptFrame(frame,1);await draw(f.lease);
  const stop=f.owner.finishRecording(f.start.handle),badStop=structuredClone(stop);badStop.preview.implicitControls!.revision++;expect(()=>f.lease.acceptStop(badStop)).toThrow('回执');expect(()=>f.lease.acceptStop(stop)).not.toThrow();
 });
 it('admits retransmitted consumed commands after a prior recording reset without reapplying hot color',()=>{
  const f=setup(),stop=f.owner.finishRecording(f.start.handle,1000);
  const context:GenerateContext={...stop.context,implicitControls:f.context.implicitControls,implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}};
  const output=f.owner.generateControlled(f.author,context,()=>{throw Error('Consumed commands must use the held continuation');});
  expect(output.implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:2});
  expect(output.sourceImplicitPresentation!.fillColors.slice(0,4)).toEqual(new Float32Array([17/255,34/255,51/255,128/255]));
  const lease=new SourceGeometryRecordingLease(f.author,context,output,f.options),start=f.owner.beginRecording(f.author,context,f.options);
  expect(start.warmup.implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:3});expect(()=>lease.acceptStart(start)).not.toThrow();lease.acceptStop(f.owner.finishRecording(start.handle));
 });
 it('rejects an invalid completed preview receipt before acquiring a recording lease',()=>{
  const f=setup(),bad=structuredClone(f.output);bad.implicitControls!.applyRevision=2;expect(()=>new SourceGeometryRecordingLease(f.author,f.context,bad,f.options)).toThrow('回执');f.owner.finishRecording(f.start.handle);
 });
});
