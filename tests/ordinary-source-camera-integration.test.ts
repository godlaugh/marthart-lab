import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {serializeScene,createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
const equations:Record<string,object>={SURFACE:{equations:{x:'u',y:'v',z:'u*v'}},IMPLICIT:{equation:{f:'x*x+y*y+z*z-1'}},ATTRACTOR:{equations:{dx:'y',dy:'-x',dz:'0'}},PERLIN:{}};
const source=(type='SURFACE',extra:Record<string,unknown>={})=>({config_version:'1.0.0',type,name:'Source camera integration',parameters:{},settings:{},...equations[type],...extra});
const parse=(type='SURFACE',extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(source(type,extra)));
const animate=(method:string,args:unknown[],extra:Record<string,unknown>={})=>({type:'animate',duration:1,easing:'LINEAR',actions:[{method,args}],...extra});
const angles=(scene:ReturnType<typeof parse>['scene'],time=0)=>sceneAtTime(scene,time).evaluatedSourceCamera!.camera;
describe('source project file through production ordinary camera timeline',()=>{
 it.each(['SURFACE','IMPLICIT','ATTRACTOR','PERLIN'])('opts new %s imports into the source model including absent camera',type=>{
  const result=parse(type);expect(result.format).toBe('mathart');expect(result.scene.sourceCamera?.configuration.kind).toBe('absent');
  expect(result.scene.settings.sourceCameraProjection).toBe('perspective');expect(result.scene.timeline.schedule).toBe('ordinary-camera-sequence-v1');expect(result.scene.timeline.tracks).toEqual([]);
  expect(angles(result.scene)).toMatchObject({phi:Math.fround(Math.PI/2),theta:0,gamma:0});
  expect(result.warnings.join()).not.toContain('约定尚未核对');
 });
 it('preserves nonaccumulating build-time relative targets across save and reopen',()=>{
  const original=source('SURFACE',{camera:{phi:0,theta:.25,gamma:0,future_camera_field:17},timeline:[animate('rotateTheta',[1]),animate('rotateTheta',[1])]});
  const result=parseProjectFile(JSON.stringify(original));result.scene.timeline.fps=4;
  expect(Array.from({length:8},(_,i)=>angles(result.scene,i/4).theta)).toEqual([.5,.75,1,1.25,1.25,1.25,1.25,1.25]);
  expect(result.scene.provenance?.original).toEqual(original);expect(result.warnings.join()).toContain('camera.future_camera_field');
  expect(result.scene.provenance?.sourceNumberTokens).toContainEqual({path:['camera','theta'],token:'0.25'});
  const serialized=serializeScene(sceneAtTime(result.scene,1.5));expect(serialized).not.toContain('evaluatedSourceCamera');
  const reopened=parseProjectFile(serialized);expect(reopened.format).toBe('local');expect(reopened.scene.sourceCamera).toEqual(result.scene.sourceCamera);expect(angles(reopened.scene,1.75).theta).toBe(1.25);
 });
 it('leaves a prior version1 local orbit document unchanged',()=>{
  const local=createScene(definition('surface'));const saved=serializeScene(local),result=parseProjectFile(saved);
  expect(result.scene.sourceCamera).toBeUndefined();expect(result.scene.timeline.schedule).not.toBe('ordinary-camera-sequence-v1');expect(serializeScene(result.scene)).toBe(saved);
 });
 it('shares native parameter order between default camera, action and duration without mathjs substitution',()=>{
  const result=parse('SURFACE',{parameters:{a:3,b:'a+1',PI:8},camera:{},timeline:[animate('rotateTheta',['b'],{duration:'PI/8'})]});
  expect(result.scene.parameters).toMatchObject({a:3,b:4,PI:8});expect(result.scene.sourceCamera?.configuration).toMatchObject({phi:4});
  expect(result.scene.timeline.tracks[0]).toMatchObject({duration:1,actions:[{args:{angle:4}}]});
  const unsupported=parse('SURFACE',{timeline:[animate('rotateTheta',['2**3'])]});expect(unsupported.scene.timeline.tracks[0].actions?.[0].args?.angle).toBe(0);expect(unsupported.warnings.join()).toContain('返回 0');
 });
 it('keeps initial Perlin Double route distinct from action direct Float and duration Double routes',()=>{
  const literal='1.0000000596046447753906250000000000000001';
  const result=parse('PERLIN',{camera:{phi:literal},timeline:[animate('rotateTheta',[literal],{duration:literal})]});
  expect(result.scene.sourceCamera?.configuration).toMatchObject({phi:1});expect(result.scene.timeline.tracks[0]).toMatchObject({duration:1,actions:[{args:{angle:1+2**-23}}]});
 });
 it('matches family method and minimum arity rather than adding unsupported camera methods',()=>{
  const result=parse('ATTRACTOR',{timeline:[animate('setRates',[1,2,3,4]),animate('ambient',[4,5]),animate('rotateTo',[1,2,3]),animate('rotateGamma',[7])]});
  expect(result.scene.timeline.tracks.map(t=>t.actions)).toMatchObject([[{method:'ambient',args:{phiSpeed:1,thetaSpeed:2,gammaSpeed:3}}],[{method:'ambient',args:{phiSpeed:4,thetaSpeed:5,gammaSpeed:0}}],[],[]]);
  expect(result.scene.timeline.duration).toBe(4);expect(result.warnings.join()).toContain('片段时长保留');
  expect(parse('SURFACE',{timeline:[animate('rotateTo',[1,2,3,4]),animate('rotatePhi',[])]}).scene.timeline.tracks.map(t=>t.actions)).toMatchObject([[{args:{phi:1,theta:2,gamma:3}}],[{args:{angle:0}}]]);
 });
 it('parses align via native scoped getJsonFloat and preserves next-turn replay',()=>{
  const result=parse('SURFACE',{parameters:{a:.25},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'align',duration:1,easing:'LINEAR',target_theta:'a'}]});result.scene.timeline.fps=4;
  expect(result.scene.timeline.tracks[0]).toMatchObject({type:'align',alignMode:'next-turn',orientation:{theta:.25}});
  expect(angles(result.scene,.75).theta).toBe(Math.fround(Math.fround(2*Math.PI)+.25));
 });
 it('distinguishes ignored native methods, disabled clips and unsupported native children',()=>{
  const result=parse('IMPLICIT',{timeline:[{enabled:false,type:17,duration:'bad'},animate('stopAmbient',[]),{type:'not-native',duration:2}]});
  expect(result.scene.timeline.tracks).toHaveLength(2);expect(result.scene.timeline.duration).toBe(3);expect(result.scene.timeline.tracks[1].type).toBe('wait');
  expect(parse('ATTRACTOR',{timeline:[{type:'not-native',duration:2}]}).scene.timeline.tracks).toEqual([]);
  expect(parse('SURFACE',{timeline:[animate('track',[1])]}).scene.settings).toMatchObject({showTrails:true,fadeTrails:true,trailLifetime:4});
  expect(parse('SURFACE',{timeline:[{type:'trails',enable:true}]}).scene.timeline.tracks[0]).toMatchObject({type:'trails',duration:0,trailsEnabled:true});
  expect(parse('SURFACE',{timeline:[{type:'surface_mode_transition'}]}).scene.timeline.tracks[0]).toMatchObject({type:'surface_mode_transition',surfaceMode:'points',duration:1});
 });
 it('uses the source parameter owner while preserving native clip duration',()=>{
  const result=parse('SURFACE',{parameters:{a:1},timeline:[animate('paramStart',[{parameters:{a:{step:.1,min:0,max:2}}}]),{type:'param',duration:2,parameters:{a:{step:.1,min:0,max:2}}}]});
  expect(result.scene.timeline.duration).toBe(3);expect(result.scene.timeline.tracks).toHaveLength(2);expect(result.scene.timeline.tracks[0].actions![0].surfaceParameters![0].configuration).toMatchObject({step:Math.fround(.1),min:0,max:2});expect(result.scene.timeline.tracks[1].surfaceParameterClip!.parameters[0]).toMatchObject({name:'a',step:Math.fround(.1),enabled:true});expect(result.scene.timeline.tracks[1].parameterAnimations).toBeUndefined();
 });
 it('defaults missing duration to one but retains source-specific malformed handling',()=>{
  expect(parse('SURFACE',{timeline:[{type:'wait'}]}).scene.timeline.tracks[0].duration).toBe(1);
  expect(parse('ATTRACTOR',{timeline:[{type:'wait',duration:'unknown'}]}).scene.timeline.tracks[0].duration).toBe(1);
  for(const [duration,expected]of [[0,0],[-1,-1],['unknown',0]])expect(parse('SURFACE',{timeline:[{type:'wait',duration}]}).scene.timeline.tracks[0].duration).toBe(expected);
  expect(()=>parse('SURFACE',{timeline:[{type:'wait',duration:null}]})).toThrow('field-string-required');
  for(const duration of ['NaN','Infinity'])expect(()=>parse('SURFACE',{timeline:[{type:'wait',duration}]})).toThrow('nonfinite');
 });
 it('preserves the Perlin camera queue independently of trails and accumulation',()=>{
  for(const show_trails of [true,false])expect(parse('PERLIN',{settings:{show_trails,use_accumulation_buffer:false}}).scene.settings.sourceCameraProjection).toBe('perspective');
  const raster=parse('PERLIN',{camera:{theta:1},settings:{use_accumulation_buffer:true}});
  expect(raster.scene.sourceCamera).toMatchObject({configuration:{family:'perlin',theta:1}});expect(raster.scene.perlinCpuSource?.display.accumulation).toBe(true);expect(raster.warnings.join()).not.toContain('尚未接入原版几何相机');
 });
 it('retains explicit capacity and numeric formatting limits at the file boundary',()=>{
  expect(()=>parse('SURFACE',{camera:{phi:1+2**-24}})).toThrow('source-number-text-unknown');
  expect(()=>parse('PERLIN',{timeline:[animate('rotateTheta',['1'.repeat(65537)])]})).toThrow('capacity');
 });
});
