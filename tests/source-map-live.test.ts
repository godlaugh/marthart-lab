import type {Settings} from '../src/types';
import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {sourceIteratedApplyIdentity,sourceIteratedSceneIdentity} from '../src/engine/sourceIteratedLiveIdentity';
import {SourceIteratedTimelineSession} from '../src/engine/sourceIteratedTimeline';
import {SourceIteratedSession} from '../src/engine/sourceIteratedSession';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
const make=()=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map live boundary',equations:{x_next:'x+gain',y_next:'y'},parameters:{gain:.001,colorSpeed:.75},settings:{batch_size:4,burn_in_steps:3,color_speed:.5,color_phase:180},timeline:[]}),{sourceEntry:'runtime-config'}).scene;
describe('Map live event ownership',()=>{
 it('retains construction for hot color, dot, tone, transforms and camera angles, but not explicit construction edits',()=>{
  const s=make(),key=sourceIteratedApplyIdentity(s);
  for(const settings of ([{pointSize:.5},{colorSpeed:.8,colorPhase:40},{normalizedBrightness:.4,mapBackgroundAlpha:0},{scaleX:2},{stepMetricMin:-1}] as Settings[]))expect(sourceIteratedApplyIdentity({...s,settings:{...s.settings,...settings}})).toBe(key);
  expect(sourceIteratedApplyIdentity({...s,sourceCamera:{...s.sourceCamera!,frame:{...s.sourceCamera!.frame,phi:.3}}})).toBe(key);
  const changed=editSourceMapScene(s,{...s,settings:{...s.settings,iterationsPerFrame:3}});expect(sourceIteratedApplyIdentity(changed)).not.toBe(key);
 });
 it('ignores unused palette and metadata but includes source alpha and signed-zero authored settings in capture identity',()=>{
  const s=make(),key=sourceIteratedSceneIdentity(s);
  expect(sourceIteratedSceneIdentity({...s,name:'Renamed',palette:{...s.palette,stops:['#000000']}})).toBe(key);
  expect(sourceIteratedSceneIdentity({...s,settings:{...s.settings,mapBackgroundAlpha:0}})).not.toBe(key);
  expect(sourceIteratedSceneIdentity({...s,settings:{...s.settings,offsetX:-0}})).not.toBe(sourceIteratedSceneIdentity({...s,settings:{...s.settings,offsetX:0}}));
 });
 it('hot colors write both scalars while retaining same-named mathematical uniforms',()=>{
  const t=new SourceIteratedTimelineSession(make());t.snapshot();
  expect(t.writeMapColors({colorSpeed:1,colorPhase:300})).toBe(true);
  expect(t.snapshot()).toMatchObject({mapColors:{colorSpeed:1,colorPhase:300},parameters:{values:{colorSpeed:.75}}});
  expect(t.writeMapColors({colorSpeed:1,colorPhase:300})).toBe(false);
  t.reset();
 });
 it('uses Float32 subtraction and threshold for hot settings, including subthreshold writes',()=>{
  const t=new SourceIteratedTimelineSession(make());t.snapshot();
  const below=Math.fround(.5+2**-21),above=Math.fround(below+2**-19);
  expect(t.writeMapColors({colorSpeed:below,colorPhase:180})).toBe(false);expect(t.snapshot().mapColors!.colorSpeed).toBe(below);
  expect(t.writeMapColors({colorSpeed:above,colorPhase:180})).toBe(true);t.reset();
 });
 it('deep copies Map event and host-clock transport',()=>{
  const c={time:0,width:32,height:24,quality:'preview' as const,mapLive:{sessionId:'map',renderFps:60,replayRevision:0,mapEdits:{runtimeRevision:1,dotSizeRevision:2},clock:{paused:true,timestampMs:1000}}};
  const copy=snapshotGenerationInput(c);c.mapLive.mapEdits.runtimeRevision=3;c.mapLive.clock.timestampMs=2000;
  expect(copy.mapLive).toMatchObject({mapEdits:{runtimeRevision:1,dotSizeRevision:2},clock:{timestampMs:1000}});
 });
 it('rejects malformed or cross-family event capabilities before creating a GPU owner',()=>{
  const owner=new SourceIteratedSession('map'),s=make(),c={time:0,width:32,height:24,quality:'preview' as const,mapLive:{sessionId:'map',renderFps:60,replayRevision:0,clock:{paused:true}}};
  for(const mapEdits of [null,{},false,{runtimeRevision:-1,dotSizeRevision:0},{runtimeRevision:0,dotSizeRevision:NaN}])expect(()=>owner.generate(s,{...c,mapLive:{...c.mapLive,mapEdits:mapEdits as never}})).toThrow('热编辑');
  expect(()=>owner.generate(s,{...c,symmetryLive:{...c.mapLive}})).toThrow('两个实时场景');
  expect(owner.diagnostics().retainedBytes).toBe(0);owner.reset();
 });
});
