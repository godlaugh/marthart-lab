import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sourceSymmetryApplyIdentity} from '../src/engine/sourceSymmetryIdentity';
import {SourceIteratedReplaySession} from '../src/engine/sourceIteratedReplaySession';
import {PARAMETER_RANGES_KEY} from '../src/engine/parameterEditing';
import {snapshotGenerationInput} from '../src/engine/generationInput';
const make=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Live identity',parameters:{lambda:.25},settings:{batch_size:4,burn_in_steps:3},timeline:[]})).scene;
describe('Symmetry live ownership boundary',()=>{
 it('retains constructor identity across metadata, source hot setters and camera angle writes',()=>{
  const scene=make(),key=sourceSymmetryApplyIdentity(scene);
  const changes=[(s:typeof scene)=>{s.name='rename';s.id='save-as';s.description='description';s.settings[PARAMETER_RANGES_KEY]='{}';},(s:typeof scene)=>{s.palette.stops=['#ffffff','#000000'];s.palette.mode='cosine';},(s:typeof scene)=>{s.settings.scaleX=17;s.settings.offsetZ=2;s.settings.normalizedBrightness=.5;s.settings.iterationsPerFrame=4;},(s:typeof scene)=>{s.sourceCamera={...s.sourceCamera!,frame:{...s.sourceCamera!.frame,phi:.2,theta:.3,gamma:.4}};}];
  for(const change of changes){const next=structuredClone(scene);change(next);expect(sourceSymmetryApplyIdentity(next)).toBe(key);}
 });
 it('recreates on mathematical, queue, resolution and local palette extension changes',()=>{
  const scene=make(),key=sourceSymmetryApplyIdentity(scene);
  const changes=[(s:typeof scene)=>{s.parameters.lambda=.3;},(s:typeof scene)=>{s.settings.burnIn=4;},(s:typeof scene)=>{s.timeline.fps=24;},(s:typeof scene)=>{s.palette.offset=.2;},(s:typeof scene)=>{s.sourceCamera={...s.sourceCamera!,frame:{...s.sourceCamera!.frame,zoom:2}};}];
  for(const change of changes){const next=structuredClone(scene);change(next);expect(sourceSymmetryApplyIdentity(next)).not.toBe(key);}
 });
 it('preserves explicit transport clock and edit revision without aliasing caller state',()=>{
  const context={time:0,quality:'preview' as const,width:48,height:32,symmetryLive:{sessionId:'live',renderFps:60,replayRevision:1,startAt:.2,clock:{paused:false,timestampMs:1000}}};
  const copy=snapshotGenerationInput(context);context.symmetryLive.clock.timestampMs=9000;context.symmetryLive.replayRevision=2;expect(copy.symmetryLive).toMatchObject({replayRevision:1,clock:{timestampMs:1000},startAt:.2});
 });
 it('updates host frame rate independently of an existing replay budget',()=>{
  const owner=new SourceIteratedReplaySession('symmetry',60);owner.setRenderFps(30);expect(owner.diagnostics().renderFps).toBe(30);
  for(const value of [NaN,.5,2147483648])expect(()=>owner.setRenderFps(value)).toThrow('renderFps');expect(owner.diagnostics().renderFps).toBe(30);owner.reset();
 });
});
