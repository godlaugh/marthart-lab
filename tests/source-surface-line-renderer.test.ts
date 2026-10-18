import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {prepareSourceCamera,type SourceCameraPlan} from '../src/engine/sourceCamera';
import {createSourceSurfaceMeshLines,sourceSurfaceLineBuffers} from '../src/engine/sourceSurfaceLineRenderer';
import type {SourceSurfaceMeshWireframeFrame} from '../src/engine/sourceSurfaceMeshWireframe';
const parsed=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:200,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'});
if(!parsed.ok||parsed.value.kind!=='known')throw Error('camera fixture');
const sourcePlan=parsed.value.plan;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const withMatrix=(rowMajor:number[]):SourceCameraPlan=>({...sourcePlan,modelView:{...sourcePlan.modelView,rowMajor}});
const plan=withMatrix(identity);
const frame=(positions=[0,0,0,1,0,0],lineWidth=2,packedColor=0xffabcdef):SourceSurfaceMeshWireframeFrame=>({positions:new Float32Array(positions),lineWidth,packedColor,mode:'coupled'});
const release=(mesh:ReturnType<typeof createSourceSurfaceMeshLines>)=>{mesh.geometry.dispose();mesh.material.dispose();};
describe('Processing CPU independent line tessellation',()=>{
 it('emits four vertices and six indices in source endpoint/width order without joining or deduplicating pairs',()=>{
  const data=frame([0,0,0,1,2,3,0,0,0,1,2,3]),input=data.positions.slice(),out=sourceSurfaceLineBuffers(data,plan);
  expect(Array.from(out.positions.slice(0,16))).toEqual([0,0,0,1,0,0,0,1,1,2,3,1,1,2,3,1]);
  expect(Array.from(out.directions.slice(0,16))).toEqual([1,2,3,1,1,2,3,-1,-1,-2,-3,-1,-1,-2,-3,1]);
  expect(Array.from(out.indices)).toEqual([0,1,2,2,1,3,4,5,6,6,5,7]);
  expect(out.positions.slice(16)).toEqual(out.positions.slice(0,16));expect(data.positions).toEqual(input);
 });
 it('transforms raw F32 directions independently of translated endpoint precision',()=>{
  const m=identity.slice();m[3]=16777216;
  const out=sourceSurfaceLineBuffers(frame(),withMatrix(m));
  expect(out.positions[0]).toBe(16777216);expect(out.positions[8]).toBe(16777216);
  expect(out.directions[0]).toBe(1);expect(out.directions[8]).toBe(-1);
 });
 it('uses the staged determinant and source widened exponent, including mirrored and singular transforms',()=>{
  // Independently evaluated with Python struct.pack/unpack float32 arithmetic.
  for(const x of [105,-105]){
   const m=identity.slice();m[0]=x;
   expect(sourceSurfaceLineBuffers(frame(undefined,1.2),withMatrix(m)).directions[3]).toBe(2.8306167125701904);
  }
  const large=identity.slice();large[0]=1e18;
  // The retained exponent produces 1000000.4375, unlike cbrt's 1000000.
  expect(sourceSurfaceLineBuffers(frame(undefined,1.2),withMatrix(large)).directions[3]).toBe(600000.3125);
  const singular=identity.slice();singular[0]=0;
  const collapsed=sourceSurfaceLineBuffers(frame(),withMatrix(singular));
  expect(collapsed.directions[3]).toBe(0);expect(Object.is(collapsed.directions[7],-0)).toBe(true);
 });
 it('rounds direction products and left associated sums without normalization',()=>{
  const m=[1,1,-1,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const out=sourceSurfaceLineBuffers(frame([0,0,0,16777216,1,16777216]),withMatrix(m));
  expect(Array.from(out.directions.slice(0,3))).toEqual([0,1,16777216]);
 });
 it('retains zero length pairs and nonfinite endpoint consequences instead of filtering or bridging',()=>{
  const out=sourceSurfaceLineBuffers(frame([0,0,0,0,0,0,NaN,0,0,1,1,1]),plan);
  expect(out.indices.length).toBe(12);expect(Array.from(out.directions.slice(0,3))).toEqual([0,0,0]);
  expect(Number.isNaN(out.positions[16])).toBe(true);expect(Number.isNaN(out.directions[16])).toBe(true);
 });
 it('keeps uint32 indexing beyond the 16 bit vertex boundary',()=>{
  const count=17000,out=sourceSurfaceLineBuffers({...frame(),positions:new Float32Array(count*6)},plan);
  expect(out.indices).toBeInstanceOf(Uint32Array);expect(out.indices.at(-1)).toBe(count*4-1);expect(out.positions.length).toBe(count*16);
 });
 it('rejects malformed pairs and capacity excess including all expanded RGBA storage',()=>{
  expect(()=>sourceSurfaceLineBuffers({...frame(),positions:new Float32Array(5)},plan)).toThrow(/缓冲/);
  const oversized=new Float32Array((Math.floor(256*1024*1024/216)+1)*6);
  expect(()=>sourceSurfaceLineBuffers({...frame(),positions:oversized},plan)).toThrow(/256 MiB/);
  for(const lineWidth of [0,-1,NaN,Infinity,1e39])expect(()=>sourceSurfaceLineBuffers({...frame(),lineWidth},plan)).toThrow(/宽度/);
  for(const packedColor of [NaN,1.5,-2147483649,4294967296])expect(()=>sourceSurfaceLineBuffers({...frame(),packedColor},plan)).toThrow(/颜色/);
 });
 it('creates an empty draw with owned buffers when no lines are present',()=>{
  const mesh=createSourceSurfaceMeshLines(frame([]),plan);
  expect(mesh.geometry.getIndex()!.count).toBe(0);expect(mesh.geometry.getAttribute('color').count).toBe(0);release(mesh);
 });
 it('preserves packed stroke alpha and zero-alpha grayscale fallback without mesh fill alpha',()=>{
  for(const [packed,rgba] of [[0xff,[1,1,1,1]],[0,[0,0,0,1]],[0xff0000,[1,0,0,0]],[0x800000ff,[0,0,1,Math.fround(128/255)]]] as const){
   const mesh=createSourceSurfaceMeshLines(frame(undefined,2,packed),plan,.5);
   expect(Array.from(mesh.geometry.getAttribute('color').array.slice(0,4))).toEqual([rgba[0],rgba[1],rgba[2],Math.fround(rgba[3]*.5)]);release(mesh);
  }
 });
 it('uses logical viewport, source depth bias and blend, and orders lines after filled meshes',()=>{
  const mesh=createSourceSurfaceMeshLines(frame(),sourcePlan),material=mesh.material;
  expect(material.uniforms.viewport.value.toArray()).toEqual([0,0,200,100]);
  expect(material.uniforms.scale.value.toArray()).toEqual([Math.fround(.999),Math.fround(.999),Math.fround(.999)]);
  expect(material.uniforms.lineModelview.value.toArray()).toEqual(new THREE.Matrix4().toArray());
  expect(material.uniforms.perspective.value).toBe(0);
  expect(material.depthFunc).toBe(THREE.LessEqualDepth);expect(material.depthWrite).toBe(true);expect(material.depthTest).toBe(true);
  expect(material.blendSrcAlpha).toBe(THREE.OneFactor);expect(material.blendDstAlpha).toBe(THREE.OneFactor);expect(material.side).toBe(THREE.DoubleSide);
  expect(mesh.renderOrder).toBe(1);expect(mesh.frustumCulled).toBe(false);expect(mesh.geometry.boundingSphere?.radius).toBe(0);release(mesh);
  const ortho=createSourceSurfaceMeshLines(frame(),{...plan,viewport:{...plan.viewport,projectionPass:'scene-fade-orthographic'}});
  expect(ortho.material.uniforms.scale.value.toArray()).toEqual([1,1,Math.fround(.999)]);release(ortho);
 });
 it('rejects unresolved projection state and invalid display opacity',()=>{
  expect(()=>createSourceSurfaceMeshLines(frame(),{...plan,viewport:{...plan.viewport,projectionPass:'unknown'}})).toThrow(/未知/);
  for(const opacity of [-1,2,NaN])expect(()=>createSourceSurfaceMeshLines(frame(),plan,opacity)).toThrow(/透明度/);
 });
});
