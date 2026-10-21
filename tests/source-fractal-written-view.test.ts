import {describe,expect,it} from 'vitest';
import {SourceFractalSceneClock,type SourceFractalObjectState,type SourceFractalSceneClip} from '../src/engine/sourceFractalSceneClock';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime,timelineControlsTarget} from '../src/engine/timeline';
import {parseScene,serializeScene} from '../src/engine/document';
const initial=():SourceFractalObjectState=>({centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0,rotationRate:0,iterations:200,bailout:4,juliaReal:0,juliaImag:0,ambientAngles:[0,0,0],ambientRates:[0,0,0],currentTime:0});
const viewFields=['centerX','centerY','centerXLow','centerYLow','zoom','rotation'] as const;
const zoomFields=viewFields.slice(0,5);
const original=(timeline:unknown[])=>({config_version:'1.0.0',type:'FRACTAL',name:'View write facts',fractal:{formula_id:'newton',parameters:{exponent:[3,0],bailout:.001,relaxation:1}},timeline});
function scene(timeline:unknown[]){const s=parseProjectFile(JSON.stringify(original(timeline))).scene;s.timeline={...s.timeline,fps:10,duration:4,loop:false};return s;}
const controls=(s:ReturnType<typeof scene>)=>viewFields.filter(key=>timelineControlsTarget(s,`settings.${key}`));

describe('source clock owns actual view writes',()=>{
 it('records same-value ordinary writes only when executed, retaining them through wait/pause/completion',()=>{
  const clips:SourceFractalSceneClip[]=[{kind:'wait',duration:.25},{kind:'animate',duration:.25,easing:'linear',targets:{center:[0,0],zoom:1,rotation:0}},{kind:'wait',duration:.25}];
  const clock=new SourceFractalSceneClock(initial(),clips);expect(clock.snapshot().writtenViewFields).toEqual([]);expect(clock.step(.25).writtenViewFields).toEqual([]);expect(clock.step(.25,true).writtenViewFields).toEqual([]);
  const active=clock.step(0);expect(active.writtenViewFields).toEqual(viewFields);expect(active.object.zoom).toBe(1);
  for(const paused of [false,true,false,false])expect(clock.step(.25,paused).writtenViewFields).toEqual(viewFields);
  (active.writtenViewFields as string[]).length=0;expect(clock.snapshot().writtenViewFields).toEqual(viewFields);
  clock.reset();expect(clock.snapshot().writtenViewFields).toEqual([]);expect(clock.step(.25).writtenViewFields).toEqual([]);
 });
 it('marks rotation from an actual positive-dt rate update, not from merely writing a rate',()=>{
  const clock=new SourceFractalSceneClock(initial(),[{kind:'animate',duration:1,easing:'linear',targets:{rotationRate:1}}]);
  expect(clock.step(0).writtenViewFields).toEqual([]);expect(clock.step(.25,true).writtenViewFields).toEqual([]);
  const moving=clock.step(.25);expect(moving.object.rotation).toBeGreaterThan(0);expect(moving.writtenViewFields).toEqual(['rotation']);clock.reset();expect(clock.snapshot().writtenViewFields).toEqual([]);
  const completed=new SourceFractalSceneClock({...initial(),rotationRate:1},[]);expect(completed.step(0).writtenViewFields).toEqual([]);expect(completed.step(-.1).writtenViewFields).toEqual([]);expect(completed.step(.1).writtenViewFields).toEqual(['rotation']);
 });
 it('does not lock the viewport for non-view parameters, ambient motion or a zero rotation rate',()=>{
  const clock=new SourceFractalSceneClock(initial(),[{kind:'animate',duration:.1,easing:'linear',targets:{rotationRate:0,ambientRates:[1,2,3],iterations:100,bailout:5,julia:[.2,.3]}}]);expect(clock.step(.1).writtenViewFields).toEqual([]);expect(clock.step(.1).writtenViewFields).toEqual([]);
 });
 it('exposes no cancelled partial frame and resets all ownership facts',()=>{
  const clock=new SourceFractalSceneClock(initial(),[{kind:'animate',duration:1,easing:'linear',targets:{zoom:2}}]);clock.step(.1);expect(()=>clock.step(.1,false,()=>true)).toThrow();expect(()=>clock.snapshot()).toThrow('必须重置');clock.reset();expect(clock.snapshot().writtenViewFields).toEqual([]);
 });
});

describe('public source timeline publishes viewport-control facts',()=>{
 it('does not mark a future target, and retains all target fields after it completes',()=>{
  const s=scene([{type:'wait',duration:.5},{type:'fractal_zoom',duration:.5,zoom:1,center:[0,0]},{type:'wait',duration:.5}]);
  const before=sceneAtTime(s,0);expect(controls(before)).toEqual([]);
  for(const time of [.6,1.2,3])expect(controls(sceneAtTime(s,time))).toEqual(zoomFields);
  expect(controls(s)).toEqual([]);expect(controls(sceneAtTime(s,0))).toEqual([]);expect(controls(before)).toEqual([]);
 });
 it('tracks ordinary center/zoom/rotation writers through held output and backwards reconstruction',()=>{
  const s=scene([{type:'wait',duration:.5},{type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'center',args:[2,3]},{method:'zoomFractal',args:[4]},{method:'rotation',args:[.25]}]}]);
  const before=sceneAtTime(s,0),held=sceneAtTime(s,3);expect(controls(before)).toEqual([]);expect(controls(held)).toEqual(viewFields);
  expect(controls(sceneAtTime(s,.1))).toEqual([]);expect(controls(sceneAtTime(s,3))).toEqual(viewFields);expect(controls(held)).toEqual(viewFields);
  const reopened=parseScene(serializeScene(s));expect(controls(sceneAtTime(reopened,3))).toEqual(viewFields);expect(controls(parseScene(serializeScene(held)))).toEqual([]);
 });
 it('does not mark disabled clips and drops old writes after a changed authoring identity',()=>{
  const s=scene([{type:'animate',duration:.5,actions:[{method:'center',args:[2,3]},{method:'zoomFractal',args:[4]}]}]);expect(controls(sceneAtTime(s,2))).toEqual(zoomFields);
  s.timeline.tracks[0].enabled=false;expect(controls(sceneAtTime(s,2))).toEqual([]);
  s.timeline.tracks=[];expect(controls(sceneAtTime(s,2))).toEqual([]);
 });
 it('publishes rotation-rate writes for the paused-navigation gate and holds them after stop',()=>{
  const s=scene([{type:'wait',duration:.5},{type:'animate',duration:.5,actions:[{method:'fractalRotate',args:[.2]}]},{type:'animate',duration:.5,actions:[{method:'stopAmbient',args:[]}]}]);
  expect(controls(sceneAtTime(s,0))).toEqual([]);const held=sceneAtTime(s,3);expect(controls(held)).toEqual(['rotation']);
  // These are the exact fields tested by Viewport.completedPlaneNavigation;
  // the authored scene remains navigable, the delivered controlled frame does not.
  expect(viewFields.some(key=>timelineControlsTarget(held,`settings.${key}`))).toBe(true);expect(viewFields.some(key=>timelineControlsTarget(s,`settings.${key}`))).toBe(false);
 });
});
