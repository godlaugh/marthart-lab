import {describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {sceneAtTime} from '../src/engine/timeline';
import type {SceneDocument,SceneOutput} from '../src/types';

function source(kind:'map'|'symmetry'='map',timeline:unknown[]=[]){return {config_version:'1.0.0',type:kind==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Captured density public producer',camera:{phi:0,theta:0,gamma:0},parameters:kind==='map'?{}:{lambda:1,alpha:0,beta:0,gamma:0,omega:0,symmetry_degree:3},...(kind==='map'?{equations:{x_next:'x',y_next:'y',z_next:'z'}}:{equation:{template:'standard'}}),settings:{render_mode:'CPU',batch_size:1,burn_in_steps:0,scale_x:8,scale_y:8,scale_z:1,x0_min:2,x0_max:2,y0_min:1,y0_max:1},timeline};}
const action=(method:string,args:unknown[])=>({type:'animate',duration:1,easing:'LINEAR',actions:[{method,args}]});
// These raster/cancellation tests exercise the existing CPU camera pipeline.
// The file-adapter tests below and headless browser verifier cover project GPU routing.
function fixture(kind:'map'|'symmetry'='map',timeline:unknown[]=[]){const text=JSON.stringify(source(kind,timeline));const scene=kind==='symmetry'?parseLegacyScene(text,{iteratedMath:'legacy-v1',symmetryEntry:'runtime-config'}).scene:parseProjectFile(text).scene;scene.timeline.fps=4;scene.settings.iteratedFps=4;scene.settings.pointSize=2;return scene;}
const context=(scene:SceneDocument,time=0,width=64,height=48,target:'primary'|'offscreen'='primary')=>({time,width,height,quality:'export' as const,sourceViewport:ordinarySourceViewport(scene,width,height,target,48)});
function pixels(output:SceneOutput){if(output.type!=='raster')throw Error('Expected raster');return output.pixels;}
const mass=(ink:Float32Array|Float64Array)=>{let n=0;for(let i=3;i<ink.length;i+=4)n+=ink[i];return n;};
describe('Map/Symmetry captured camera through import, timeline and public generation',()=>{
 it.each(['map','symmetry']as const)('imports %s source camera and preserves it across save/reopen',kind=>{
  const raw=source(kind,[action('rotateGamma',['PI/4'])]),result=parseProjectFile(JSON.stringify(raw)),scene=result.scene;
  expect(scene.settings).toMatchObject({iteratedCameraModel:'captured-density-v1',sourceCameraProjection:'perspective'});
  expect(scene.timeline.schedule).toBe('ordinary-camera-sequence-v1');expect(scene.timeline.tracks[0].actions?.[0].method).toBe('rotateGamma');
  expect(scene.provenance?.original).toEqual(raw);expect(sceneAtTime(scene,.5).evaluatedSourceCamera?.camera.gamma).toBeGreaterThan(0);
  const restored=parseScene(serializeScene(scene));expect(restored.sourceCamera).toEqual(scene.sourceCamera);expect(restored.evaluatedSourceCamera).toBeUndefined();
  expect(restored.settings.iteratedCameraModel).toBe('captured-density-v1');
 });
 it('distinguishes project reset scales from direct runtime-config scales',()=>{
  const raw=source('symmetry');delete (raw.settings as Partial<typeof raw.settings>).scale_x;delete (raw.settings as Partial<typeof raw.settings>).scale_y;delete (raw.settings as Partial<typeof raw.settings>).scale_z;
  expect(parseProjectFile(JSON.stringify(raw)).scene.settings).toMatchObject({scaleX:35,scaleY:35,scaleZ:35});
  expect(parseLegacyScene(JSON.stringify(raw)).scene.settings).toMatchObject({scaleX:100,scaleY:100,scaleZ:0});
  expect(parseLegacyScene(JSON.stringify(raw),{iteratedCamera:'legacy-v1'}).scene.settings.scaleX).not.toBe(100);
 });
 it('uses empty source expression scope and ignores unsupported camera arguments without interpreting them',()=>{
  const raw=source('map',[action('rotateTheta',['k']),action('track',['sin(']),action('stopTracking',[])]);Object.assign(raw.parameters,{k:2});
  const result=parseProjectFile(JSON.stringify(raw));expect(result.scene.timeline.tracks[0].actions?.[0].args?.angle).toBe(0);
  expect(result.scene.timeline.tracks.slice(1).every(track=>track.actions?.length===0)).toBe(true);
  const sym=fixture('symmetry',[{type:'align',duration:.5,target_theta:'not parsed'}]);expect(sym.timeline.tracks[0].type).toBe('wait');
  expect(fixture('map',[{type:'align',duration:.5,target_theta:1}]).timeline.tracks[0].type).toBe('align');
 });
 it('keeps double-to-float action parsing and native duration fallback at import',()=>{
  const scene=fixture('map',[action('rotateTheta',['1.0000000596046447753906250000000000000001']),{type:'wait',duration:'missing'},{type:'wait',duration:{}}]);
  expect(scene.timeline.tracks[0].actions?.[0].args?.angle).toBe(1);expect(scene.timeline.tracks.slice(1).map(t=>t.duration)).toEqual([1,1]);
 });
 it('retains custom Symmetry parameter authoring through supported source animate actions',()=>{
  const scene=fixture('symmetry');scene.equations.glsl='uniform float gain; void calculate_next(in vec3 p,out vec3 n,out float m){n=p*gain;m=0.;}';scene.parameters.gain=.5;
  scene.timeline.tracks=[{id:'param',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false,actions:[{id:'start',method:'paramStart',parameters:[{target:'parameters.gain',min:.2,max:.8,step:1,enabled:true}]}]}];
  const saved=parseScene(serializeScene(scene));expect(saved.equations.glsl).toBe(scene.equations.glsl);
  expect(sceneAtTime(saved,.5).parameters.gain).toBe(sceneAtTime(scene,.5).parameters.gain);expect(sceneAtTime(saved,.5).parameters.gain).not.toBe(.5);
 });
 it('uses source type/method defaults and skips actions without a valid argument container',()=>{
  const scene=fixture('symmetry',[{duration:.5},{type:null,duration:.5},{type:true,duration:.5},{type:'animate',duration:1,actions:[{args:[]},{method:null,args:[]},{method:'paramStop'},{method:'gradientStop',args:null}]}]);
  expect(scene.timeline.tracks.map(t=>t.type)).toEqual(['wait','wait','wait','animate']);expect(scene.timeline.tracks[3].actions).toEqual([]);
 });
 it('imports two-rate ambient with a zero gamma rate and ignores a lone rate',()=>{
  const scene=fixture('map',[action('ambient',[.2,.4]),action('ambient',[1])]);
  expect(scene.timeline.tracks[0].actions?.[0].args).toEqual({phiSpeed:Math.fround(.2),thetaSpeed:Math.fround(.4),gammaSpeed:0});
  expect(scene.timeline.tracks[1].actions).toEqual([]);
 });
 it('retains the old mathematical viewport only for an explicit legacy import and existing documents',()=>{
  const scene=parseLegacyScene(JSON.stringify(source()),{iteratedCamera:'legacy-v1'}).scene;
  expect(scene.sourceCamera).toBeUndefined();expect(scene.settings.iteratedCameraModel).toBeUndefined();
  const output=generateScene(parseScene(serializeScene(scene)),{time:0,width:64,height:48,quality:'export'});
  expect(output.sourceCameraFrame).toBeUndefined();expect(output.density?.bounds.minX).not.toBe(-1);
 });
 it.each(['map','symmetry']as const)('%s fixed-frame replay agrees with a fresh public request and cancellation recovery',kind=>{
  const scene=fixture(kind,[action('rotateTheta',[1])]),owner=new TemporalGenerationSession();
  try{
   const first=generateScene(scene,context(scene),owner),initialMass=mass(owner.iterated.snapshotInk());
   expect(first.sourceCameraFrame?.camera.theta).toBe(.25);expect(first.density?.accepted).toBe(1);
   const end=generateScene(scene,context(scene,.75),owner),facts=owner.iterated.diagnostics();
   expect(end.sourceCameraFrame?.time).toBe(.75);expect(end.sourceCameraFrame?.camera.theta).toBe(1);
   expect(facts.recordedPasses).toBe(kind==='map'?1:4);expect(facts.clears).toBe(kind==='map'?4:1);
   if(kind==='symmetry')expect(mass(owner.iterated.snapshotInk())).toBeCloseTo(initialMass*4,10);
   expect(pixels(end)).toEqual(pixels(generateScene(scene,context(scene,.75))));
   expect(generateScene(scene,context(scene,.75),owner).temporal?.cacheHits).toBe(1);
   generateScene(scene,context(scene,0),owner);expect(pixels(generateScene(scene,context(scene,.75),owner))).toEqual(pixels(end));
   expect(()=>generateScene(scene,{...context(scene,1),isCancelled:()=>true},owner)).toThrow();expect(owner.iterated.diagnostics().retainedBytes).toBe(0);
   expect(pixels(generateScene(scene,context(scene,.75),owner))).toEqual(pixels(end));
  }finally{owner.reset();}
 });
 it('camera and logical viewport changes invalidate the accumulator identity',()=>{
  const scene=fixture(),owner=new TemporalGenerationSession();
  try{
   const first=generateScene(scene,context(scene,.5),owner);scene.sourceCamera={...scene.sourceCamera!,frame:{center:[6,0,0]}};
   const moved=generateScene(scene,context(scene,.5),owner);expect(pixels(moved)).not.toEqual(pixels(first));expect(moved.temporal?.cacheHits).toBe(0);
   const request={...context(scene,.5),sourceViewport:ordinarySourceViewport(scene,128,96,'primary',96)};
   const resized=generateScene(scene,request,owner);expect(resized.temporal?.cacheHits).toBe(0);expect(pixels(resized)).toEqual(pixels(generateScene(scene,request)));
   expect(resized.sourceCameraFrame?.viewport.logicalHeight).toBe(96);
  }finally{owner.reset();}
 });
 it('a focal-only action retains its captured projection while provenance follows the evaluated camera',()=>{
  const scene=fixture('map',[action('focal',[40])]),owner=new TemporalGenerationSession();
  try{generateScene(scene,context(scene),owner);const baseline=owner.iterated.diagnostics().sourceCameraAnchor!;
   const end=generateScene(scene,context(scene,.75),owner),last=owner.iterated.diagnostics();
   expect(last.sourceCameraAnchor!.projection).toEqual(baseline.projection);expect(last.recordedPasses).toBe(4);expect(last.clears).toBe(1);
   expect(end.sourceCameraFrame?.camera.focalDistance).not.toBe(baseline.camera.focalDistance);
  }finally{owner.reset();}
 });
 it('clips behind-camera samples but keeps side-edge splat coverage',()=>{
  const scene=fixture();Object.assign(scene.settings,{dimension:3,scaleX:1,scaleY:1,pointSize:4});scene.equations={x:'32.1',y:'0',z:'0'};
  expect(generateScene(scene,context(scene)).density?.accepted).toBe(1);
  scene.equations.z='50';const behind=generateScene(scene,context(scene));expect(behind.density?.clipped).toBe(1);expect(behind.density?.accepted).toBe(0);
 });
 it('retains the offscreen logical scale and exact delivered camera with exports',()=>{
  const scene=fixture('symmetry',[action('rotateTheta',[.5])]);const output=generateScene(scene,context(scene,.5,128,96,'offscreen'));
  expect(output.sourceCameraFrame?.viewport).toEqual({logicalWidth:128,logicalHeight:96,referenceLogicalHeight:48,target:'offscreen',projectionPass:'perspective'});
  expect(output.type==='raster'&&output.cameraResolved).toBe(true);expect(output.density?.accepted).toBe(3);
 });
});
