import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {SourceAttractorCpuParticles} from '../src/engine/sourceAttractorCpuParticles';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {importSourceAttractorVisualConfig} from '../src/engine/sourceAttractorVisualConfig';
import {prepareSourceAttractorEquation} from '../src/engine/sourceAttractorEquation';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {sourceParticlePointAppearance} from '../src/engine/sourceParticlePointAppearance';
import {createSourceParticlePoints} from '../src/engine/sourceParticlePointRenderer';
import type {GeometryOutput} from '../src/types';
const take=<T>(result:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
function boundary(palette=['#6011CC33','#C04020E0'],count=2,dx='1'){
 const configuration=take(importSourceAttractorConfig({particle_count_cpu:count,time_step:.1,sub_steps:1},{warmup_steps:0,bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}})).configuration;
 const visualConfiguration=take(importSourceAttractorVisualConfig({dot_size:-12,show_trails:false},palette)).configuration;
 const equation=take(prepareSourceAttractorEquation({equations:{dx,dy:'2',dz:'-1'},parameters:{}}));
 const owner=new SourceAttractorCpuParticles({configuration,equation,visualConfiguration});
 owner.update({frameIndex:0,time:0,deltaTime:0});const snapshot=owner.snapshot();
 const camera=take(prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:192,logicalHeight:128,referenceLogicalHeight:128,target:'primary',projectionPass:'perspective'}));
 if(camera.kind!=='known')throw Error('camera unavailable');
 const output:GeometryOutput={type:'geometry',topology:'points',positions:snapshot.positions,colors:snapshot.colors,pointAlphas:snapshot.pointAlphas,sourcePointAppearance:sourceParticlePointAppearance(visualConfiguration.points.dotRadius,camera.plan)};
 return{owner,snapshot,output,mesh:createSourceParticlePoints(output,camera.plan,1,4)};
}
function dispose(mesh:ReturnType<typeof createSourceParticlePoints>){mesh.geometry.dispose();mesh.material.dispose();}
describe('source Attractor CPU snapshot → shared billboard boundary',()=>{
 it('preserves motion/color owners while staging eye coordinates and native material state',()=>{
  const {snapshot,mesh}=boundary();try{
   expect(mesh.geometry.getAttribute('particleEyePosition').array.length).toBe(snapshot.positions.length/3*4);
   expect(mesh.geometry.getAttribute('particleColor').array).toBe(snapshot.colors);
   expect(mesh.geometry.getAttribute('particleAlpha').array).toBe(snapshot.pointAlphas);
   expect(mesh.geometry.getAttribute('particleEyePosition').array).not.toBe(snapshot.positions);expect(mesh.material.uniforms.sprite.value.anisotropy).toBe(4);expect(mesh.geometry.instanceCount).toBe(2);expect(snapshot.positions[0]).toBe(Math.fround(.1));
   expect(mesh.material.uniforms.radius.value).toBe(Math.fround(-12*Math.fround(.8)));
   expect(mesh.material).toMatchObject({depthTest:true,depthWrite:true,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor});
   expect(mesh.material.uniforms.opacity.value).toBe(1);expect(mesh.userData.sourceSurfaceGpuPoints).toBe(false);
  }finally{dispose(mesh);}
 });
 it.each([{palette:['128'],rgb:Math.fround(128/255),alpha:1},{palette:['#00112233'],rgb:Math.fround(17/255),alpha:0}])('uses normalized tint snapshot without a second packed-color interpretation: $palette',({palette,rgb,alpha})=>{
  const {snapshot,mesh}=boundary(palette,1);try{
   expect(snapshot.colors?.[0]).toBe(rgb);expect(snapshot.pointAlphas?.[0]).toBe(alpha);
   expect(mesh.geometry.getAttribute('particleAlpha').getX(0)).toBe(alpha);
  }finally{dispose(mesh);}
 });
 it('preserves nonfinite slots for native shader clipping without compacting source identities',()=>{
  const {snapshot,mesh}=boundary(undefined,2,'1/0');try{expect(snapshot.positions[0]).toBe(Infinity);expect(mesh.geometry.instanceCount).toBe(2);expect(mesh.geometry.getAttribute('particleEyePosition').array.length).toBe(snapshot.positions.length/3*4);}finally{dispose(mesh);}
 });
 it('handles empty source arrays and releases its owned sprite with the material',()=>{
  const {mesh}=boundary(undefined,0);let textureDisposals=0;mesh.material.uniforms.sprite.value.addEventListener('dispose',()=>textureDisposals++);
  expect(mesh.geometry.instanceCount).toBe(0);dispose(mesh);expect(textureDisposals).toBe(1);
 });
});
