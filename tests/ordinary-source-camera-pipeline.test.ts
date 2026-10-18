import {describe,it,expect} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateScene} from '../src/engine/temporal';
import {sceneAtTime,resolveTimeline} from '../src/engine/timeline';
import {ordinarySourceViewport,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';
import {SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';
import type {GenerateContext} from '../src/types';

function fixture(){
 const scene=createScene(definition('surface'));
 scene.equations={x:'u+t',y:'v',z:'u*v'};scene.parameters={};
 Object.assign(scene.settings,{renderMode:'points',computeBackend:'cpu',showTrails:false,uMin:0,uMax:10,vMin:0,vMax:5,uSegments:3,vSegments:3,periodicU:false,periodicV:false,sourceCameraProjection:'perspective'});
 scene.sourceCamera={model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'surface',phi:0,theta:0,gamma:0}};
 scene.timeline={duration:3,fps:4,loop:false,schedule:'ordinary-camera-sequence-v1',tracks:[0,1].map(i=>({id:String(i),type:'animate',target:'camera.actions',from:0,to:0,start:i,duration:1,easing:'linear',enabled:true,pingPong:false,actions:[{id:'action'+i,method:'rotateTheta',args:{angle:1},enabled:true}]}))};
 return scene;
}
const context=(scene:ReturnType<typeof fixture>,time=1.75):GenerateContext=>({time,width:48,height:32,quality:'preview',sourceViewport:ordinarySourceViewport(scene,96,64,'primary',64)});
describe('ordinary camera public document and generation pipeline',()=>{
 it('delivers source targets with exact request logical viewport through save and reopen',()=>{
  const scene=fixture(),restored=parseScene(serializeScene(scene)),out=generateScene(restored,context(scene));
  expect(out.type).toBe('geometry');expect(out.sourceCameraFrame).toMatchObject({time:1.75,frameIndex:7,camera:{theta:1},viewport:{logicalWidth:96,logicalHeight:64}});
  expect(sceneAtTime(restored,.25).evaluatedSourceCamera?.camera.theta).toBe(.5);
  expect(sceneAtTime(restored,1.75).evaluatedSourceCamera?.camera.theta).toBe(1);
  expect(restored.sourceCamera).toEqual(scene.sourceCamera);expect(restored.evaluatedSourceCamera).toBeUndefined();
 });
 it('strips delivered runtime state from persistence and does not upgrade old local projects',()=>{
  const scene=fixture(),evaluated=sceneAtTime(scene,.25),text=serializeScene(evaluated);
  expect(text).not.toContain('evaluatedSourceCamera');expect(parseScene(text).sourceCamera).toEqual(scene.sourceCamera);
  delete scene.sourceCamera;delete scene.timeline.schedule;scene.timeline.tracks=[];
  const restored=parseScene(serializeScene(scene));expect(restored.sourceCamera).toBeUndefined();expect(generateScene(restored,context(scene)).sourceCameraFrame).toBeUndefined();
 });
 it('invalidates initial camera cache on edits and preserves independent returned frames',()=>{
  const scene=fixture(),first=generateScene(scene,context(scene));
  scene.sourceCamera={...scene.sourceCamera!,frame:{theta:2}};
  const second=generateScene(scene,context(scene));expect(second.sourceCameraFrame?.camera.theta).toBe(3);expect(first.sourceCameraFrame?.camera.theta).toBe(1);
 });
 it('keeps cached display layout separate from authored durations and invalidates frame-rate edits',()=>{
  const scene=fixture();scene.timeline.tracks.forEach(t=>{t.duration=.3;});
  const first=resolveTimeline(scene);expect(first.tracks.map(t=>t.duration)).toEqual([.5,.5]);
  first.tracks[0].start=100;first.tracks[0].duration=100;
  expect(resolveTimeline(scene).tracks.map(t=>t.start)).toEqual([0,.5]);expect(scene.timeline.tracks.map(t=>t.duration)).toEqual([.3,.3]);
  scene.timeline.fps=10;expect(resolveTimeline(scene).tracks.map(t=>t.duration)).toEqual([.3,.3]);
 });
 it('fails before geometry evaluation on missing or unknown viewport, invalid mode and incomplete frames',()=>{
  const scene=fixture();scene.equations.x='invalid_function(';const ctx=context(scene);
  expect(()=>generateScene(scene,{...ctx,sourceViewport:undefined})).toThrow('逻辑画布');
  expect(()=>generateScene(scene,{...ctx,sourceViewport:{...ctx.sourceViewport!,projectionPass:'unknown'}})).toThrow('投影');
  scene.kind='map';expect(()=>generateScene(scene,ctx)).toThrow('显示模式');
  const frame=generateScene(fixture(),context(fixture())).sourceCameraFrame!;
  Reflect.deleteProperty(frame.camera,'theta');expect(()=>prepareOrdinarySourceFrame(frame)).toThrow('完整');
 });
 it('uses logical export height relative to the captured preview, independently of sampling quality',()=>{
  const scene=fixture(),preview=generateScene(scene,context(scene)),ctx=context(scene);
  const exported=generateScene(scene,{...ctx,width:192,height:128,quality:'export',sourceViewport:ordinarySourceViewport(scene,192,128,'offscreen',64)});
  expect(prepareOrdinarySourceFrame(preview.sourceCameraFrame!).displayScale).toBe(1);
  expect(prepareOrdinarySourceFrame(exported.sourceCameraFrame!).displayScale).toBe(2);
  expect(exported.sourceCameraFrame!.camera).toEqual(preview.sourceCameraFrame!.camera);
 });
});
