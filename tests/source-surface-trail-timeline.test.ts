import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {replaySourceSurface,prepareSourceSurfaceParticles} from '../src/engine/sourceSurfaceParticles';
import {sceneAtTime,createAnimationTrack,resolveTimeline} from '../src/engine/timeline';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport,ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
import {evaluateOrdinarySourceCameraTimeline} from '../src/engine/ordinarySourceCameraTimeline';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';

// Instruction-derived expected transitions, not original-app runtime evidence:
// JsonSurfaceConfig.setupTimeline 730–780; InstantAction.<init>/onStart;
// TrailRecordingAnimation.execute; ParametricSurface.setRecordingTrails and
// updateCPUDots 1379–1472; SceneManager.update advances only one queue entry.
const track={type:'animate',duration:.5,actions:[{method:'track',args:[0]}]};
function fixture(timeline:unknown[]=[track,{type:'trails',enable:false},{type:'wait',duration:.5},{type:'trails',enable:true},{type:'wait',duration:.5},{type:'trails',enable:false}],settings:Record<string,unknown>={}){
 const imported=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Recording sequence',equations:{x:'u',y:'v',z:'0'},settings:{u_segments:1,v_segments:1,u_min:0,u_max:100,v_min:0,v_max:1,periodic_u:false,speed_u:1,speed_v:0,scale_x:1,scale_y:1,scale_z:1,trail_lifetime:4,...settings},timeline}));
 imported.scene.timeline.fps=4;return imported;
}
const history=(scene:ReturnType<typeof fixture>['scene'],time:number)=>replaySourceSurface(scene,time,'all').particles.snapshot();
const xs=(out:ReturnType<typeof history>)=>out.trails?Array.from(out.trails.positions).filter((_,i)=>i%3===0):[];

describe('source Surface instant recording through public import, clock and geometry',()=>{
 it('ignores duration and easing fields as the native dispatch does, retains raw values and round-trips zero duration',()=>{
  const {scene}=fixture([track,{type:'trails',enable:false,duration:'not a duration',easing:{ignored:true}},{type:'trails'}]);
  expect(scene.timeline.tracks.slice(1).map(t=>[t.duration,t.trailsEnabled])).toEqual([[0,false],[0,true]]);
  expect((scene.provenance!.original as {timeline:unknown[]}).timeline[1]).toEqual({type:'trails',enable:false,duration:'not a duration',easing:{ignored:true}});
  expect(parseScene(serializeScene(scene)).timeline.tracks).toEqual(scene.timeline.tracks);
 });
 it('preserves an ignored numeric duration token without using it as queue time',()=>{
  const original=fixture([{type:'trails',enable:true,duration:1}]).scene.provenance!.original;
  const scene=parseProjectFile(JSON.stringify(original).replace('"duration":1','"duration":1e999')).scene;
  const reopened=parseScene(serializeScene(scene));expect(reopened.timeline.tracks[0].duration).toBe(0);
  expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','duration'],token:'1e999'});
 });
 it('switches recording before the same-frame particle update and preserves display and retained history',()=>{
  const {scene}=fixture(),before=structuredClone(scene);
  expect(xs(history(scene,.25))).toEqual([.25,.5]);
  expect(xs(history(scene,1))).toEqual([.25,.5]);
  const resumed=history(scene,1.25);expect(xs(resumed)).toEqual([.25,.5,1.5]);
  expect(Array.from(resumed.trails!.indices)).toEqual([0,1,1,2]); // Source does not insert a recording-pause gap.
  expect(resumed.positions[0]).toBe(1.5);
  const evaluated=sceneAtTime(scene,.75);expect(evaluated.settings.showTrails).toBe(true);expect(evaluated.settings.recordTrails).toBe(true);
  expect(scene).toEqual(before);
 });
 it('expires old history while recording is disabled and resumes with only surviving samples',()=>{
  const {scene}=fixture(undefined,{trail_lifetime:.5});
  expect(xs(history(scene,.5))).toEqual([.25,.5]);
  expect(xs(history(scene,.75))).toEqual([.5]);
  expect(xs(history(scene,1))).toEqual([]);
  expect(xs(history(scene,1.25))).toEqual([1.5]);
 });
 it('consumes exactly one display update per instant, including final actions with zero active dt',()=>{
  const {scene}=fixture();const layout=resolveTimeline(scene);
  expect(layout.tracks.map(t=>[t.start,t.duration])).toEqual([[0,.5],[.5,.25],[.75,.5],[1.25,.25],[1.5,.5],[2,.25]]);
  const final=replaySourceSurface(scene,2,'all');expect(final.frame.queueComplete).toBe(true);expect(final.frame.sceneTime).toBe(2);
  expect(xs(final.particles.snapshot())).toEqual([.25,.5,1.5,1.75,2]);
  expect(history(scene,3).trails).toEqual(final.particles.snapshot().trails);
 });
 it('handles consecutive all-instant clips without reading 0/0 easing or advancing particle time',()=>{
  const {scene}=fixture([{type:'trails',enable:false},{type:'trails',enable:true}]);
  expect(scene.settings.surfaceGeometryVersion).toBe('mathart-1.7.8-points-v1');
  expect(replaySourceSurface(scene,0,'all').frame.queueIndex).toBe(1);
  const final=replaySourceSurface(scene,.25,'all');expect(final.frame.queueComplete).toBe(true);expect(final.frame.sceneTime).toBe(0);expect(final.particles.snapshot().positions[0]).toBe(0);expect(xs(final.particles.snapshot())).toEqual([]);
  expect(resolveTimeline(scene).tracks.map(t=>[t.start,t.duration])).toEqual([[0,.25],[.25,.25]]);
 });
 it('preserves hidden display and supports initially stopped recording with a later enable',()=>{
  const hidden=fixture(undefined,{show_trails:false}).scene;expect(history(hidden,1.5).trails).toBeUndefined();expect(sceneAtTime(hidden,1.5).settings.showTrails).toBe(false);
  const {scene}=fixture();scene.settings.recordTrails=false;expect(history(scene,.25).trails).toBeUndefined();expect(xs(history(scene,1.25))).toEqual([1.5]);
 });
 it('skips disabled clips before inspecting their malformed contents',()=>{
  const {scene}=fixture([track,{type:'trails',enabled:false,enable:{bad:true},duration:-9},{type:'wait',duration:.5}]);expect(scene.timeline.tracks).toHaveLength(2);expect(history(scene,.5).trails!.records).toBe(3);
 });
 it('replays backward deterministically through actual geometry and camera consumers after saving',()=>{
  const scene=parseScene(serializeScene(fixture().scene));const run=(time:number)=>{const out=generateScene(scene,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(scene,96,64,'primary',64)});if(out.type!=='geometry')throw Error('Expected geometry');return out;};
  const first=run(.75);run(2);const again=run(.75);expect(again.positions).toEqual(first.positions);expect(again.trails).toEqual(first.trails);expect(again.sourceCameraFrame).toEqual(first.sourceCameraFrame);
 });
 it('authors explicit instantaneous recording clips without changing the generic tween zero-duration contract',()=>{
  const {scene}=fixture();const authored=createAnimationTrack(scene,'trails');expect(authored.duration).toBe(0);expect(authored.trailsEnabled).toBe(true);
  const initial=ordinarySourceCameraInitial(scene)!;
  expect(()=>evaluateOrdinarySourceCameraTimeline(initial,[authored],4,0)).toThrow('粒子生产者');
  expect(()=>evaluateOrdinarySourceCameraTimeline(initial,[{...authored,trailsEnabled:undefined}],4,0)).toThrow('录制开关');
  expect(()=>new RootsSceneClock(initial,[{duration:0,easing:'linear'}])).toThrow('大于 0');
  expect(()=>new RootsSceneClock(initial,[{duration:0,easing:'linear',instant:true,zoom:2}])).toThrow('没有插值');
 });
 it('poisons the same producer when a recording switch is cancelled',()=>{
  let cancel=false;const p=prepareSourceSurfaceParticles(fixture().scene).create('all',()=>cancel);cancel=true;expect(()=>p.setRecordingTrails(false)).toThrow('取消');cancel=false;expect(()=>p.snapshot()).toThrow('取消');
 });
});
