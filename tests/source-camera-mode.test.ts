import {describe,expect,it,vi} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {CAPTURED_DENSITY_CAMERA_MODEL,CAPTURED_DENSITY_CAMERA_ACTIONS,sourceCameraMode,usesCapturedDensityCamera,capturedDensityCameraClipTypes,ordinarySourceCameraGeometry} from '../src/engine/sourceCameraMode';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';
import {supportsCameraActions,supportsCameraAction,supportsCameraComponent,supportsParticleTracking} from '../src/engine/sceneCamera';
import {resolveTimeline,sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import {generateScene} from '../src/engine/temporal';
import {IteratedDensitySession} from '../src/scenes/iteratedDensity';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';

function scene(kind:'map'|'symmetry'='map'){
 const s=createScene(definition(kind));Object.assign(s.settings,{iteratedMode:'continuous',iteratedCameraModel:CAPTURED_DENSITY_CAMERA_MODEL,sourceCameraProjection:'perspective',batchSize:1,burnIn:0,iteratedBackend:'cpu'});
 s.sourceCamera={model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:kind,phi:0,theta:0,gamma:0}};
 s.timeline={duration:2,fps:4,loop:false,schedule:'ordinary-camera-sequence-v1',tracks:[{id:'turn',type:'animate',target:'camera.actions',start:0,duration:1,from:0,to:0,easing:'linear',enabled:true,pingPong:false,actions:[{id:'theta',method:'rotateTheta',args:{angle:1}}]}]};return s;
}
function context(s:SceneDocument):GenerateContext{return{width:8,height:6,time:.25,quality:'preview',sourceViewport:ordinarySourceViewport(s,80,60,'primary',60)};}
function output(s:SceneDocument,c:GenerateContext):Extract<SceneOutput,{type:'raster'}>{return{type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),cameraResolved:true,sourceCameraFrame:ordinarySourceCameraFrame(sceneAtTime(s,c.time),c),stats:{samples:1,generated:1,invalid:0,elapsedMs:0}};}

describe('source camera display mode ownership',()=>{
 it.each(['map','symmetry'] as const)('requires an explicit complete captured density marker for %s',kind=>{
  const s=scene(kind);expect(sourceCameraMode(s)).toEqual({kind:'captured-density',family:kind});expect(usesCapturedDensityCamera(s)).toBe(true);expect(ordinarySourceCameraGeometry(s)).toBe(false);
  expect(ordinarySourceCameraInitial(s)).toMatchObject({phi:0,theta:0,gamma:0,zoom:1});
  const reopened=parseScene(serializeScene(s));expect(sourceCameraMode(reopened)).toEqual(sourceCameraMode(s));expect(reopened.sourceCamera).toEqual(s.sourceCamera);
  delete s.settings.iteratedCameraModel;expect(sourceCameraMode(s)).toEqual({kind:'unsupported',reason:'display-mode'});expect(()=>ordinarySourceCameraInitial(s)).toThrow('显示模式');
  delete s.sourceCamera;delete s.timeline.schedule;expect(sourceCameraMode(s)).toEqual({kind:'local'});expect(ordinarySourceCameraInitial(s)).toBeUndefined();expect(supportsCameraActions(s)).toBe(false);
  expect(sceneAtTime(s,.25).camera).toEqual(s.camera);expect(timelineWarnings(s).join()).toContain('未变换图像平面');
 });
 it('keeps old geometry applicability separate from authored source identity',()=>{
  const s=createScene(definition('surface'));expect(ordinarySourceCameraGeometry(s)).toBe(true);expect(sourceCameraMode(s)).toEqual({kind:'local'});
  s.sourceCamera={model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}};expect(sourceCameraMode(s)).toEqual({kind:'ordinary'});
 });
 it.each([
  ['unknown-density-model',(s:SceneDocument)=>{s.settings.iteratedCameraModel='future';}],
  ['density-family',(s:SceneDocument)=>{s.kind='surface';}],
  ['density-not-continuous',(s:SceneDocument)=>{s.settings.iteratedMode='single';}],
  ['density-camera-missing',(s:SceneDocument)=>{delete s.sourceCamera;}],
 ] as const)('rejects incomplete or malformed identity: %s',(reason,change)=>{
  const s=scene();change(s);expect(sourceCameraMode(s)).toEqual({kind:'unsupported',reason});expect(()=>ordinarySourceCameraInitial(s)).toThrow(reason);expect(usesCapturedDensityCamera(s)).toBe(false);
 });
 it('retains strict source family, projection and finite scalar validation',()=>{
  const s=scene();s.sourceCamera={...s.sourceCamera!,configuration:{kind:'angles',family:'symmetry'}};expect(()=>ordinarySourceCameraInitial(s)).toThrow('类型不匹配');
  s.sourceCamera={...s.sourceCamera,configuration:{kind:'angles',family:'map',theta:Infinity}};expect(()=>ordinarySourceCameraInitial(s)).toThrow('nonfinite');
  s.sourceCamera={...s.sourceCamera,configuration:{kind:'unknown',reason:'not observed'}};expect(()=>ordinarySourceCameraInitial(s)).toThrow('未解析');
  s.settings.sourceCameraProjection='unknown';expect(()=>ordinarySourceCameraInitial(s)).toThrow('投影');
 });
 it.each(['map','symmetry'] as const)('enables only evidenced %s camera methods and uses the existing source clock',kind=>{
  const s=scene(kind);for(const method of CAPTURED_DENSITY_CAMERA_ACTIONS)expect(supportsCameraAction(s,method),method).toBe(true);
  for(const method of ['track','stopTracking','rotate'])expect(supportsCameraAction(s,method),method).toBe(false);
  expect(supportsParticleTracking(s)).toBe(false);expect(supportsCameraComponent(s,'gamma')).toBe(true);
  expect(sceneAtTime(s,.25).evaluatedSourceCamera?.camera.theta).toBe(.5);
  const original=structuredClone(s.sourceCamera);sceneAtTime(s,.75);expect(s.sourceCamera).toEqual(original);
 });
 it('rejects non-dispatched camera methods even when action.enabled is false',()=>{
  for(const kind of ['map','symmetry'] as const)for(const method of ['track','stopTracking','rotate']){
   const s=scene(kind);s.timeline.tracks[0].actions=[{id:'unsupported',method,args:{index:0},enabled:false}];
   expect(()=>resolveTimeline(s)).toThrow('不分派');s.timeline.tracks[0].enabled=false;expect(()=>resolveTimeline(s)).not.toThrow();
  }
 });
 it('allows source Map align while rejecting a fabricated Symmetry align or numeric camera clip',()=>{
  const map=scene(),symmetry=scene('symmetry');expect(capturedDensityCameraClipTypes(map)).toEqual(['wait','animate','align']);expect(capturedDensityCameraClipTypes(symmetry)).toEqual(['wait','animate']);
  for(const s of [map,symmetry])s.timeline.tracks[0]={...s.timeline.tracks[0],type:'align',actions:undefined,orientation:{theta:0},alignMode:'next-turn'};
  expect(()=>resolveTimeline(map)).not.toThrow();expect(()=>resolveTimeline(symmetry)).toThrow('不支持 align');
  map.timeline.tracks[0]={...map.timeline.tracks[0],type:'numeric',target:'camera.zoom'};expect(()=>resolveTimeline(map)).toThrow('不支持 numeric');
 });
});

describe('captured density public generation dispatch',()=>{
 it('validates the paired source viewport before calling the density producer',()=>{
  const s=scene(),c=context(s),spy=vi.spyOn(IteratedDensitySession.prototype,'generate');
  try{
   expect(()=>generateScene(s,{...c,sourceViewport:undefined})).toThrow('逻辑画布');
   expect(()=>generateScene(s,{...c,sourceViewport:{...c.sourceViewport!,projectionPass:'unknown'}})).toThrow('投影');
   s.settings.iteratedCameraModel='bad';expect(()=>generateScene(s,c)).toThrow('unknown-density-model');expect(spy).not.toHaveBeenCalled();
  }finally{spy.mockRestore();}
 });
 it('preserves producer-projected raster and its paired camera without geometry binding',()=>{
  const s=scene(),c=context(s),raster=output(s,c),spy=vi.spyOn(IteratedDensitySession.prototype,'generate').mockReturnValue(raster);
  try{const result=generateScene(s,c);expect(result).toBe(raster);expect(result.sourceCameraFrame?.camera.theta).toBe(.5);expect(result.sourceCameraFrame?.viewport).toEqual(c.sourceViewport);expect(spy).toHaveBeenCalledOnce();}finally{spy.mockRestore();}
 });
 it('rejects missing projection ownership and malformed delivered camera facts',()=>{
  const s=scene(),c=context(s),raster=output(s,c),spy=vi.spyOn(IteratedDensitySession.prototype,'generate');
  try{
   spy.mockReturnValue({...raster,cameraResolved:undefined});expect(()=>generateScene(s,c)).toThrow('已投影');
   spy.mockReturnValue({...raster,sourceCameraFrame:undefined});expect(()=>generateScene(s,c)).toThrow('相机帧');
   const bad=structuredClone(raster);Reflect.deleteProperty(bad.sourceCameraFrame!.camera,'theta');spy.mockReturnValue(bad);expect(()=>generateScene(s,c)).toThrow('完整');
   spy.mockReturnValue({type:'geometry',topology:'points',positions:new Float32Array(3),stats:raster.stats});expect(()=>generateScene(s,c)).toThrow('已投影');
  }finally{spy.mockRestore();}
 });
});
