import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {createSourceParticleTrailLines} from '../src/engine/sourceProcessingLineRenderer';
import type {SourceParticleTrails} from '../src/engine/sourceParticleTrails';
const parsed=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:200,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'});
if(!parsed.ok||parsed.value.kind!=='known')throw Error('camera fixture');
const plan=parsed.value.plan;
const trails=():SourceParticleTrails=>({positions:new Float32Array([-30,0,0,0,20,0,30,0,0]),colors:new Float32Array([1,0,0,.1234567,.5,.9,0,0,1]),alphas:new Float32Array([1,.3,0]),indices:new Uint32Array([0,1,1,2,1,0,0,1]),particleIds:new Uint32Array([0,0,0]),records:3,oldestTime:0});
const release=(mesh:ReturnType<typeof createSourceParticleTrailLines>)=>{mesh.geometry.dispose();mesh.material.dispose();};
describe('source particle independent Processing LINES',()=>{
 it('instances only index pairs with endpoint RGBA, preserving shared, reversed and duplicate edges without joins',()=>{
  const input=trails(),mesh=createSourceParticleTrailLines(input,2,plan,.37);
  try{
   const geometry=mesh.geometry as THREE.InstancedBufferGeometry,color=geometry.getAttribute('colorA').array;
   expect(geometry.instanceCount).toBe(4);expect(geometry.getAttribute('endpointA').count).toBe(4);expect(geometry.index?.count).toBe(6);
   for(let pair=0;pair<4;pair++)for(let v=0;v<4;v++){
    const index=input.indices[pair*2+(v<2?0:1)];
    expect(Array.from(color.slice(pair*8+(v<2?0:4),pair*8+(v<2?0:4)+4))).toEqual([...input.colors.slice(index*3,index*3+3),Math.fround(input.alphas[index]*.37)]);
   }
   expect(Array.from(geometry.index!.array)).toEqual([0,1,2,2,1,3]);
   const before=Array.from(color);input.colors.fill(0);input.alphas.fill(0);input.positions.fill(0);input.indices.fill(2);expect(Array.from(color)).toEqual(before);
  }finally{release(mesh);}
 });
 it('uses overlay depth state and additive Processing alpha blending',()=>{
  const mesh=createSourceParticleTrailLines(trails(),2,plan);
  try{expect(mesh.material.depthTest).toBe(false);expect(mesh.material.depthWrite).toBe(false);expect(mesh.material.blendSrc).toBe(THREE.SrcAlphaFactor);expect(mesh.material.blendSrcAlpha).toBe(THREE.OneFactor);expect(mesh.material.blendDstAlpha).toBe(THREE.OneFactor);expect(mesh.frustumCulled).toBe(false);}finally{release(mesh);}
 });
 it('accepts empty trails without allocating vertices',()=>{
  const mesh=createSourceParticleTrailLines({...trails(),positions:new Float32Array(),colors:new Float32Array(),alphas:new Float32Array(),indices:new Uint32Array()},1,plan);
  try{expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);}finally{release(mesh);}
 });
 it('rejects malformed indexed topology and all instance storage above 256 MiB before allocation',()=>{
  for(const indices of [undefined,new Uint16Array([0,1]),new Uint32Array([0]),new Uint32Array([0,3])])expect(()=>createSourceParticleTrailLines({...trails(),indices:indices as Uint32Array},1,plan)).toThrow(/索引|缓冲/);
  const indices=new Uint32Array((Math.floor((256*1024*1024-40)/96)+1)*2);
  expect(()=>createSourceParticleTrailLines({...trails(),indices},1,plan)).toThrow(/256 MiB/);
 });
 it('rejects wrong color shapes and invalid normalized channel values',()=>{
  for(const patch of [{colors:new Float32Array(8)},{alphas:new Float32Array(2)},{colors:new Float64Array(9)},{alphas:new Float64Array(3)}])expect(()=>createSourceParticleTrailLines({...trails(),...patch} as SourceParticleTrails,1,plan)).toThrow(/颜色/);
  for(const value of [NaN,Infinity,-.01,1.01])for(const name of ['colors','alphas'] as const){const input=trails();input[name][1]=value;expect(()=>createSourceParticleTrailLines(input,1,plan)).toThrow(/范围/);}
 });
 it('releases geometry and material if mesh construction fails',()=>{
  const geometry=vi.spyOn(THREE.BufferGeometry.prototype,'dispose'),material=vi.spyOn(THREE.RawShaderMaterial.prototype,'dispose');
  const fail=vi.spyOn(THREE.Mesh.prototype,'updateMorphTargets').mockImplementation(()=>{throw Error('construction failure');});
  try{expect(()=>createSourceParticleTrailLines(trails(),1,plan)).toThrow('construction failure');expect(geometry).toHaveBeenCalledOnce();expect(material).toHaveBeenCalledOnce();}finally{fail.mockRestore();geometry.mockRestore();material.mockRestore();}
 });
});
