import {describe,it,expect} from 'vitest';
import type {AnimationTrack,SceneDocument} from '../src/types';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {sceneAtTime,timelineControlsTarget} from '../src/engine/timeline';
const numeric=(patch:Partial<AnimationTrack>={}):AnimationTrack=>({id:crypto.randomUUID(),type:'numeric',target:'settings.scale',from:2.5,to:2.5,start:1,duration:1,easing:'linear',pingPong:false,enabled:true,...patch});
function document(tracks:AnimationTrack[]):SceneDocument{const scene=createScene(definition('domain'));scene.settings.scale=2.5;scene.settings.domainViewportVersion='mathart-1.7.8-cpu';scene.timeline={duration:10,fps:30,loop:false,tracks};return scene;}
describe('evaluated timeline target ownership',()=>{
 it('records a successful same-value write and holds ownership after the clip',()=>{
  const scene=document([numeric()]);
  for(const time of [1,1.5,2,9]){const frame=sceneAtTime(scene,time);expect(frame.settings.scale).toBe(2.5);expect(timelineControlsTarget(frame,'settings.scale')).toBe(true);expect(timelineControlsTarget(frame,'settings.centerX')).toBe(false);}
  expect(timelineControlsTarget(scene,'settings.scale')).toBe(false);
 });
 it('does not mark disabled, future, unsupported or absent writes',()=>{
  const scene=document([numeric(),numeric({target:'settings.centerX',enabled:false}),numeric({target:'camera.zoom',start:0,from:1,to:2})]);
  const frame=sceneAtTime(scene,.5);for(const target of ['settings.scale','settings.centerX','camera.zoom'])expect(timelineControlsTarget(frame,target)).toBe(false);
  expect(timelineControlsTarget(sceneAtTime(document([]),9),'settings.scale')).toBe(false);
 });
 it('retains control of a stopped parameter oscillator frozen at its final value',()=>{
  const start=numeric({type:'animate',target:'camera.actions',start:0,duration:0,actions:[{id:'start',method:'paramStart',parameters:[{target:'settings.scale',min:2,max:3,step:1,enabled:true}]}]});
  const stop=numeric({type:'animate',target:'camera.actions',start:2,duration:0,actions:[{id:'stop',method:'paramStop',args:{target:'settings.scale'}}]});
  const scene=document([start,stop]),a=sceneAtTime(scene,2),b=sceneAtTime(scene,8);
  expect(b.settings.scale).toBe(a.settings.scale);expect(timelineControlsTarget(a,'settings.scale')).toBe(true);expect(timelineControlsTarget(b,'settings.scale')).toBe(true);
 });
 it('reconstructs facts on cold/warm/reversed seeks and never serializes them',()=>{
  const scene=document([numeric()]),saved=JSON.stringify(scene),times=[3,.5,2,0,1];
  const flags=times.map(t=>timelineControlsTarget(sceneAtTime(scene,t),'settings.scale'));
  expect(flags).toEqual([true,false,true,false,true]);
  expect(times.map(t=>timelineControlsTarget(sceneAtTime(JSON.parse(saved),t),'settings.scale'))).toEqual(flags);
  const evaluated=sceneAtTime(scene,3);expect(timelineControlsTarget(JSON.parse(JSON.stringify(evaluated)),'settings.scale')).toBe(false);
  expect(times.slice().reverse().map(t=>timelineControlsTarget(sceneAtTime(scene,t),'settings.scale'))).toEqual(flags.slice().reverse());expect(JSON.stringify(scene)).toBe(saved);
 });
});
