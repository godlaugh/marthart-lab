import {describe,it,expect} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {createAnimationTrack,sceneAtTime,timelineControlsTarget} from '../src/engine/timeline';
import {definitions} from '../src/scenes';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalPrecision';

const scene=()=>{const s=createScene(definitions.find(d=>d.kind==='fractal')!);Object.assign(s.settings,{formula:'newton',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1});s.timeline={...s.timeline,duration:10,loop:false,tracks:[]};return s;};
const controlled=(s:ReturnType<typeof scene>,keys:readonly string[])=>keys.map(k=>timelineControlsTarget(s,'settings.'+k));
const zoomKeys=['centerX','centerY','centerXLow','centerYLow','zoom'];

describe('direct timeline writers expose successful control facts',()=>{
 it('marks all five fractal keyframe fields even when the first write equals the authored value',()=>{
  const s=scene(),track=createAnimationTrack(s,'fractal_zoom',0);delete track.sourceFractalZoom;track.duration=2;track.interpolation='linear';track.keyframes=[{time:0,centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1},{time:2,centerX:2,centerY:-4,centerXLow:1e-25,centerYLow:-1e-25,zoom:3}];s.timeline.tracks=[track];
  const first=sceneAtTime(s,0);expect(controlled(first,zoomKeys)).toEqual([true,true,true,true,true]);expect(first.settings.zoom).toBe(s.settings.zoom);expect(controlled(s,zoomKeys)).toEqual([false,false,false,false,false]);
  const endpoint=sceneAtTime(s,2),held=sceneAtTime(s,8),cold=sceneAtTime(parseScene(serializeScene(s)),8);
  expect(held.settings.zoom).toBe(3);expect(held.settings.centerX).toBe(2);expect(held.settings.centerY).toBe(-4);expect(held.settings.centerXLow).toBe(1e-25);expect(held.settings.centerYLow).toBe(-1e-25);
  for(const output of [endpoint,held,cold])expect(controlled(output,zoomKeys)).toEqual([true,true,true,true,true]);expect(cold.settings).toEqual(held.settings);
  // Runtime facts belong to the evaluated object, never to persisted documents.
  expect(controlled(parseScene(serializeScene(held)),zoomKeys)).toEqual([false,false,false,false,false]);
 });
 it('does not infer control from disabled or not-yet-started keyframe clips',()=>{
  const s=scene(),track=createAnimationTrack(s,'fractal_zoom',2);s.timeline.tracks=[track];expect(controlled(sceneAtTime(s,1),zoomKeys)).toEqual([false,false,false,false,false]);
  track.enabled=false;expect(controlled(sceneAtTime(s,9),zoomKeys)).toEqual([false,false,false,false,false]);
 });
 it('records fractal rotation from the action writer, including same-value start and held stop',()=>{
  const s=scene(),rotation=createAnimationTrack(s,'animate',1);rotation.duration=1;rotation.easing='linear';rotation.actions=[{id:'rotation',method:'fractalRotate',args:{speed:.4},enabled:true}];
  const stop=createAnimationTrack(s,'animate',3);stop.duration=1;stop.easing='linear';stop.actions=[{id:'stop',method:'stopAmbient',args:{},enabled:true}];s.timeline.tracks=[rotation,stop];
  expect(controlled(sceneAtTime(s,0),['rotation'])).toEqual([false]);const start=sceneAtTime(s,1);expect(start.settings.rotation).toBe(s.settings.rotation);expect(controlled(start,['rotation'])).toEqual([true]);
  const held=sceneAtTime(s,8),cold=sceneAtTime(parseScene(serializeScene(s)),8);expect(controlled(held,['rotation'])).toEqual([true]);expect(cold.settings.rotation).toBe(held.settings.rotation);expect(controlled(cold,['rotation'])).toEqual([true]);
  rotation.actions[0].enabled=false;expect(controlled(sceneAtTime(s,8),['rotation'])).toEqual([false]);
 });
 it.each(['local-v1','mathart-1.7.8-cpu','mathart-1.7.8-gpu'])('records the shared Domain rotation writer without changing its navigation eligibility: %s',version=>{
  const s=createScene(definitions.find(d=>d.kind==='domain')!);s.settings.domainViewportVersion=version;
  const track=createAnimationTrack(s,'animate',0);track.duration=1;track.easing='linear';track.actions=[{id:'rotate',method:'domainRotate',args:{speed:.2},enabled:true}];s.timeline={...s.timeline,duration:4,loop:false,tracks:[track]};
  const output=sceneAtTime(s,.5);expect(timelineControlsTarget(output,'settings.rotation')).toBe(true);expect(timelineControlsTarget(output,'settings.scale')).toBe(false);expect(timelineControlsTarget(output,'settings.centerX')).toBe(false);
 });
});
