import {describe,expect,it} from 'vitest';
import {createSourceSurfaceMeshGeometry,type SourceSurfaceMeshGeometryConfiguration,type SourceMeshVector} from '../src/engine/sourceSurfaceMeshGeometry';
import {prepareSourceSurfaceFunction} from '../src/engine/sourceSurfaceFunction';
import shiftOracle from './fixtures/source-surface-mesh-shifts.json';

const F=Math.fround;
function owner(overrides:Partial<SourceSurfaceMeshGeometryConfiguration>={}){
 return createSourceSurfaceMeshGeometry({numU:3,numV:2,uMin:0,uMax:1,vMin:0,vMax:1,meshWrapU:false,meshWrapV:false,meshWrapThreshold:.25,sample:(u,v)=>[u,v,0],reserve:()=>{},...overrides});
}
function xyz(values:Float32Array,index:number){return Array.from(values.slice(index*3,index*3+3));}

describe('source CPU mesh geometry and seam owner',()=>{
 it('samples inclusive v-major grid endpoints, preserves U-major color identity and tie-AC topology',()=>{
  const frame=owner().render();
  expect(Array.from(frame.positions)).toEqual([0,0,0,.5,0,0,1,0,0,0,1,0,.5,1,0,1,1,0]);
  expect(Array.from(frame.sourceColorIndices)).toEqual([0,2,4,1,3,5]);
  expect(Array.from(frame.triangles)).toEqual([0,1,4,0,4,3,1,2,5,1,5,4]);
  // PVector.cross(other) allocates a new vector, whose native return is popped.
  for(let i=0;i<6;i++)expect(xyz(frame.normals,i)).toEqual([1,0,0]);
  expect(frame.seams).toEqual({wrapU:false,wrapV:false,twistedU:false,twistedV:false,shiftU:0});
 });
 it('uses the shorter diagonal and rejects an entire quad containing one nonfinite corner',()=>{
  const frame=owner({numU:2,sample:(u,v)=>[u,v,F(10*u*v)]}).render();
  expect(Array.from(frame.triangles)).toEqual([0,1,2,1,3,2]);
  const missing=owner({numU:2,sample:(u,v)=>[u,v,u===1&&v===1?NaN:0]}).render();
  expect(missing.triangles.length).toBe(0);expect(Number.isNaN(missing.positions[11])).toBe(true);
 });
 it('emits all U, V and UV corner quads in native order without welding degenerate seams',()=>{
  const frame=owner({numU:2,meshWrapU:true,meshWrapV:true,sample:()=>[0,0,0]}).render();
  expect(frame.positions.length/3).toBe(12);
  expect(Array.from(frame.triangles)).toEqual([0,1,3,0,3,2,4,5,6,4,6,7,2,3,1,2,1,0,8,9,10,8,10,11]);
  expect(Array.from(frame.sourceColorIndices)).toEqual([0,2,1,3,2,0,0,3,3,0,0,2]);
  expect(Array.from(frame.wireframeIndexedTriangles)).toEqual([0,1,3,0,3,2,2,3,1,2,1,0]);
  expect(frame.wireframeUSeamQuads.length).toBe(12);
  for(let i=0;i<4;i++)expect(xyz(frame.normals,i)).toEqual([0,0,1]);
  for(let i=4;i<12;i++)expect(xyz(frame.normals,i)).toEqual([0,0,0]);
 });
 it('retains separate param-seam normal sampling and division rather than main-grid reciprocal multiplication',()=>{
  const frame=owner({numU:2,meshWrapU:true,sample:(u,v)=>[F(u),F(u*u),v]}).render();
  expect(frame.seams.shiftU).toBe(0);
  for(let i=0;i<4;i++)expect(xyz(frame.normals,i+4)).toEqual(shiftOracle.paramNormals[i]);
  expect(xyz(frame.normals,1)).not.toEqual(xyz(frame.normals,4));
  let units=0;
  const mesh=owner({sample:(u,v)=>[F(u),F(u*u),v],reserve:n=>{units+=n;}});
  expect(mesh.sampleParameterNormal(1,0)).toEqual(shiftOracle.paramNormals[0]);expect(units).toBe(3);
 });
 it.each(shiftOracle.cases)('matches independent Float32 continuous shift n=$numV amount=$amount offset=$offset wrap=$wrapV',test=>{
  const sample=(u:number,v:number,withOffset:boolean):SourceMeshVector=>{
   const offset=withOffset?test.offset:0;return[F(F(u)+offset),F(F(v+test.amount*u)+offset),F(F(u*v*.17)+offset)];
  };
  const frame=owner({numU:3,numV:test.numV,meshWrapU:true,meshWrapV:test.wrapV,sample}).render();
  expect(frame.seams.shiftU).toBe(test.shift);
 });
 it('keeps continuous shift across parameter changes until explicit invalidation',()=>{
  let amount=.17;
  const mesh=owner({numV:3,meshWrapU:true,sample:(u,v)=>[F(u),F(v+amount*u),F(u*v*.17)]});
  const initial=mesh.render(),initialBits=Array.from(initial.positions);amount=.63;
  expect(mesh.render().seams.shiftU).toBe(initial.seams.shiftU);
  expect(Array.from(initial.positions)).toEqual(initialBits);
  mesh.invalidateWrapShift();expect(mesh.render().seams.shiftU).not.toBe(initial.seams.shiftU);
 });
 it('consumes shared function Float32 scale/offset and named edits without reparsing or aliasing reusable samples',()=>{
  const surface=prepareSourceSurfaceFunction({equations:{x:'a+u',y:'v+u/3',z:'u*v'},parameters:{a:16777217},scales:[3,.1,-7],offsets:[-50331648,2,5]}).create();
  const scratch=new Float32Array(3),mesh=owner({sample:(u,v,includeOffset)=>{
   surface.position(u,v,scratch,0,includeOffset);return scratch as unknown as SourceMeshVector;
  }});
  for(const expected of shiftOracle.sharedFunctionFrames){
   expect(surface.write('a',expected.a)).toBe(true);const frame=mesh.render();
   expect(Array.from(frame.positions.slice(0,18))).toEqual(expected.positions);
   expect(Array.from(frame.normals.slice(0,18))).toEqual(expected.normals);
  }
 });
 it('preserves a shared function shift through parameter changes that also change auto closure',()=>{
  const surface=prepareSourceSurfaceFunction({equations:{x:'a*u+sin(2*pi*u)',y:'v+b*u',z:'0'},parameters:{a:0,b:0},scales:[1,1,1],offsets:[0,0,0]}).create();
  const scratch=new Float32Array(3),sample=(u:number,v:number,includeOffset:boolean)=>{
   surface.position(u,v,scratch,0,includeOffset);return scratch as unknown as SourceMeshVector;
  },mesh=owner({numU:4,numV:5,meshWrapU:true,sample});
  expect(owner({numU:4,numV:5,sample}).render().seams.wrapU).toBe(true);
  const first=mesh.render();surface.write('a',1);surface.write('b',.63);
  expect(owner({numU:4,numV:5,sample}).render().seams.wrapU).toBe(false);
  const stale=mesh.render();expect(stale.seams.shiftU).toBe(first.seams.shiftU);
  expect(stale.positions).not.toEqual(first.positions);
  mesh.invalidateWrapShift();expect(mesh.render().seams.shiftU).not.toBe(first.seams.shiftU);
 });
 it('detects reflection from offset-free samples and preserves V twist after later failed closure',()=>{
  let twisted=true;
  const mesh=owner({numU:3,numV:3,uMin:-1,uMax:1,meshWrapV:true,sample:(u,v,withOffset)=>{
   const p:SourceMeshVector=twisted?[F((1-2*v)*u),F((2+u)*Math.sin(Math.PI*v)),0]:[u,v,0];
   return withOffset?[F(p[0]+1e8),F(p[1]+1e8),1e8]:p;
  }});
  const first=mesh.render();expect(first.seams.twistedV).toBe(true);
  // Rendering offsets collapse geometry but must not change closure decisions.
  expect(first.seams.wrapU).toBe(false);
  twisted=false;const later=mesh.render();expect(later.seams.twistedV).toBe(true);
  expect(Array.from(later.triangles.slice(-12))).toEqual([6,7,1,6,1,2,7,8,0,7,0,1]);
 });
 it('clamps reversed-bound param colors with the native absolute-range denominator',()=>{
  const frame=owner({numU:2,uMin:1,uMax:0,meshWrapU:true,sample:()=>[0,0,0]}).render();
  expect(Array.from(frame.sourceColorIndices.slice(4))).toEqual([0,0,0,1]);
 });
 it('owns cyclic palette closure separately from geometry closure and excludes offsets',()=>{
  const mesh=owner({numU:4,numV:3,sample:(u,v,offset)=>[F(u+(offset?1e8:0)),F(v+(offset?1e8:0)),0]});
  expect(mesh.cyclicPaletteU()).toBe(false);
  expect(owner({meshWrapU:true}).cyclicPaletteU()).toBe(true);
  const shifted=owner({numU:4,numV:3,sample:(u,v)=>{
   const angle=Math.PI*2/3*u+Math.PI*4/3*v;return[F(Math.cos(angle)),F(Math.sin(angle)),0];
  }});
  expect(shifted.render().seams.wrapU).toBe(false);expect(shifted.cyclicPaletteU()).toBe(true);
 });
 it('rejects invalid dimensions before sampling and reserves output capacity before any sampling',()=>{
  let calls=0;
  expect(()=>owner({numU:513,sample:()=>{calls++;return[0,0,0];}})).toThrow('1–512');
  expect(()=>owner({reserve:()=>{throw new Error('capacity');},sample:()=>{calls++;return[0,0,0];}}).render()).toThrow('capacity');
  expect(calls).toBe(0);
  const empty=owner({numU:1,sample:()=>{calls++;return[0,0,0];}}).render();expect(empty.positions.length).toBe(0);expect(calls).toBe(0);
 });
 it('checks the budget during first-draw continuous search and retains independent snapshots',()=>{
  let units=0;
  const cancelled=owner({meshWrapU:true,reserve:n=>{units+=n;if(units>1000)throw new Error('cancelled');}});
  expect(()=>cancelled.render()).toThrow('cancelled');
  expect(units).toBeLessThan(1100);
  units=0;expect(()=>cancelled.render()).toThrow('cancelled');expect(units).toBe(0);
  const mesh=owner(),first=mesh.render();first.positions[0]=99;expect(mesh.render().positions[0]).toBe(0);
 });
});
