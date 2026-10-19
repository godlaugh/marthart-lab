import {describe,expect,it} from 'vitest';
import {createSourceSurfaceMeshGeometry,type SourceSurfaceMeshGeometryConfiguration,type SourceMeshVector} from '../src/engine/sourceSurfaceMeshGeometry';
import shiftOracle from './fixtures/source-surface-mesh-shifts.json';

const F=Math.fround;
function owner(overrides:Partial<SourceSurfaceMeshGeometryConfiguration>={}){
 return createSourceSurfaceMeshGeometry({numU:3,numV:2,uMin:0,uMax:1,vMin:0,vMax:1,meshWrapU:false,meshWrapV:false,meshWrapThreshold:.25,sample:(u,v)=>[u,v,0],reserve:()=>{},...overrides});
}

/** Static-source geometry checks, not a native GPU framebuffer oracle.
 * MeshSurface 95a1c0c8…: buildThreejsMeshShape, addMeshVertex/Param,
 * useACDiagonal/Param and forEach{MainGrid,USeam,VSeam,UVCorner}*Quad. */
describe('retained source GPU mesh parameters and shared seam traversal',()=>{
 it('publishes inclusive UV seeds with zero mesh speeds and U-major palette identities',()=>{
  const frame=owner().renderGpu();
  expect(Array.from(frame.seeds)).toEqual([0,0,0,0,.5,0,0,0,1,0,0,0,0,1,0,0,.5,1,0,0,1,1,0,0]);
  expect(Array.from(frame.sourceColorIndices)).toEqual([0,2,4,1,3,5]);
  expect(Array.from(frame.triangles)).toEqual([0,1,4,0,4,3,1,2,5,1,5,4]);
  expect(frame.seams).toEqual({wrapU:false,wrapV:false,twistedU:false,twistedV:false,shiftU:0});
  expect('positions' in frame).toBe(false);expect('normals' in frame).toBe(false);
 });
 it('chooses diagonals from CPU surface samples but retains invalid GPU triangles',()=>{
  expect(Array.from(owner({numU:2,sample:(u,v)=>[u,v,F(10*u*v)]}).renderGpu().triangles)).toEqual([0,1,2,1,3,2]);
  const badCorner=(u:number,v:number):SourceMeshVector=>[u,v,u===1&&v===1?Infinity:0];
  const frame=owner({numU:2,sample:badCorner}).renderGpu();
  // Infinity can also satisfy native closure's Infinity <= Infinity test.
  // Its additional seam quads must not obscure the retained main quad.
  expect(Array.from(frame.triangles.slice(0,6))).toEqual([0,1,3,0,3,2]);
  expect(frame.seeds.every(Number.isFinite)).toBe(true);
  expect(owner({numU:2,sample:badCorner}).render().triangles.length).toBe(0);
 });
 it('retains main, U, V and UV-corner triangles and nearest seam palette identity',()=>{
  const frame=owner({numU:2,meshWrapU:true,meshWrapV:true,sample:()=>[0,0,0]}).renderGpu();
  expect(Array.from(frame.triangles)).toEqual([0,1,3,0,3,2,4,5,6,4,6,7,2,3,1,2,1,0,8,9,10,8,10,11]);
  expect(Array.from(frame.seeds)).toEqual([0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0]);
  expect(Array.from(frame.sourceColorIndices)).toEqual([0,2,1,3,2,0,0,3,3,0,0,2]);
  // The same invalid param seam is omitted by CPU fill but emitted by GPU.
  const invalid=owner({numU:2,meshWrapU:true,meshWrapV:true,sample:()=>[NaN,0,0]}).renderGpu();
  expect(invalid.triangles).toEqual(frame.triangles);expect(invalid.seeds.length).toBe(48);
  expect(owner({numU:2,meshWrapU:true,meshWrapV:true,sample:()=>[NaN,0,0]}).render().triangles.length).toBe(0);
 });
 it.each(shiftOracle.cases)('uses independently derived continuous U shift n=$numV amount=$amount offset=$offset',test=>{
  const sample=(u:number,v:number,withOffset:boolean):SourceMeshVector=>{
   const offset=withOffset?test.offset:0;return[F(F(u)+offset),F(F(v+test.amount*u)+offset),F(F(u*v*.17)+offset)];
  };
  const mesh=owner({numU:3,numV:test.numV,meshWrapU:true,meshWrapV:test.wrapV,sample});
  expect(mesh.sampleSeams().shiftU).toBe(0);
  const frame=mesh.renderGpu();expect(frame.seams.shiftU).toBe(test.shift);
  expect(mesh.sampleSeams().shiftU).toBe(test.shift);
 });
 it('samples live draw uniforms without starting or invalidating the topology shift search',()=>{
  let amount=.17,units=0;
  const mesh=owner({numV:3,meshWrapU:true,sample:(u,v)=>[F(u),F(v+amount*u),F(u*v*.17)],reserve:n=>{units+=n;}});
  expect(mesh.sampleSeams().shiftU).toBe(0);expect(units).toBeLessThan(1000);
  const initial=mesh.renderGpu();expect(initial.seams.shiftU).toBe(.34375);
  const seeds=initial.seeds.slice(),triangles=initial.triangles.slice();amount=.63;mesh.invalidateWrapShift();
  units=0;expect(mesh.sampleSeams().shiftU).toBe(.34375);expect(units).toBeLessThan(1000);
  expect(initial.seeds).toEqual(seeds);expect(initial.triangles).toEqual(triangles);
  expect(mesh.renderGpu().seams.shiftU).not.toBe(.34375);
 });
 it('does not silently rebuild an earlier GPU shape when live closure or diagonal changes',()=>{
  let curved=false;
  const mesh=owner({numU:2,sample:(u,v)=>[u,v,curved?F(10*u*v):0]});
  const first=mesh.renderGpu();curved=true;
  expect(mesh.sampleSeams()).toEqual({wrapU:false,wrapV:false,twistedU:false,twistedV:false,shiftU:0});
  expect(Array.from(first.triangles)).toEqual([0,1,3,0,3,2]);
  expect(Array.from(mesh.renderGpu().triangles)).toEqual([0,1,2,1,3,2]);
  // The runtime decides when a dirty source PShape requires renderGpu again.
 });
 it('derives draw-time periodic uniforms from current offset-free geometry',()=>{
  let opening=0;
  const mesh=owner({numU:4,numV:5,sample:(u,v,includeOffset)=>{
   const offset=includeOffset?1e8:0;return[F(F(opening*u+Math.sin(2*Math.PI*u))+offset),F(v+offset),0];
  }});
  expect(mesh.sampleSeams().wrapU).toBe(true);
  const shape=mesh.renderGpu(),triangles=shape.triangles.slice();opening=1;
  expect(mesh.sampleSeams().wrapU).toBe(false);
  expect(shape.triangles).toEqual(triangles);
  // The still-retained shape and live GPU wrapping uniforms have distinct
  // lifetimes; neither setting is copied from domain.periodicU here.
 });
 it('updates live twist uniforms and retains the original V-twist failure behavior',()=>{
  let twisted=true;
  const mesh=owner({numU:3,numV:3,uMin:-1,uMax:1,meshWrapV:true,sample:(u,v,withOffset)=>{
   const p:SourceMeshVector=twisted?[F((1-2*v)*u),F((2+u)*Math.sin(Math.PI*v)),0]:[u,v,0];
   return withOffset?[F(p[0]+1e8),F(p[1]+1e8),1e8]:p;
  }});
  expect(mesh.sampleSeams().twistedV).toBe(true);twisted=false;
  expect(mesh.sampleSeams().twistedV).toBe(true);
  expect(Array.from(mesh.renderGpu().triangles.slice(-12))).toEqual([6,7,1,6,1,2,7,8,0,7,0,1]);
 });
 it('preserves reversed endpoint parameters and the native absolute-range seam color rule',()=>{
  const frame=owner({numU:2,uMin:1,uMax:0,meshWrapU:true,sample:()=>[0,0,0]}).renderGpu();
  expect(Array.from(frame.seeds.slice(0,8))).toEqual([1,0,0,0,0,0,0,0]);
  expect(Array.from(frame.sourceColorIndices.slice(4))).toEqual([0,0,0,1]);
 });
 it('admits memory before sampling and retains failed ownership across both rendering paths',()=>{
  let samples=0;
  const rejected=owner({reserve:()=>{throw Error('capacity');},sample:()=>{samples++;return[0,0,0];}});
  expect(()=>rejected.renderGpu()).toThrow('capacity');expect(samples).toBe(0);
  expect(()=>rejected.sampleSeams()).toThrow('capacity');expect(()=>rejected.render()).toThrow('capacity');expect(samples).toBe(0);
  const empty=owner({numU:1,sample:()=>{samples++;return[0,0,0];}}).renderGpu();
  expect(empty.seeds.length).toBe(0);expect(empty.triangles.length).toBe(0);expect(samples).toBe(0);
  let units=0;const cancelled=owner({meshWrapU:true,reserve:n=>{units+=n;if(units>1000)throw Error('cancelled');}});
  expect(()=>cancelled.renderGpu()).toThrow('cancelled');units=0;
  expect(()=>cancelled.sampleSeams()).toThrow('cancelled');expect(units).toBe(0);
 });
 it('owns independent output buffers without exposing mutable diagonal samples',()=>{
  const mesh=owner(),first=mesh.renderGpu();first.seeds[0]=99;first.sourceColorIndices[0]=99;first.triangles[0]=99;
  const next=mesh.renderGpu();expect(next.seeds[0]).toBe(0);expect(next.sourceColorIndices[0]).toBe(0);expect(next.triangles[0]).toBe(0);
  expect(mesh.render().positions[0]).toBe(0);
 });
});
