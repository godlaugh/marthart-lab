import {describe,it,expect} from 'vitest';
import {prepareSourceCamera,type SourceCameraPlan} from '../src/engine/sourceCamera';
import {sourceProcessingClosedStrokeBuffers,sourceProcessingLineDisplay,SOURCE_PROCESSING_CLOSED_STROKE_LIMITS} from '../src/engine/sourceProcessingStroke';
const parsed=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:200,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'});
if(!parsed.ok||parsed.value.kind!=='known')throw Error('camera fixture');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const plan:SourceCameraPlan={...parsed.value.plan,modelView:{...parsed.value.plan.modelView,rowMajor:identity}};
const triangle=new Float32Array([0,0,0,2,0,0,0,3,0]);
const vertices=(data:Float32Array)=>Array.from({length:data.length/4},(_,i)=>Array.from(data.slice(i*4,i*4+4)));
describe('Processing immediate closed 3D stroke',()=>{
 it('retains source segment and bevel order, including the separate closing bevel',()=>{
  // addLineSegment3D PC 334..467 / 633..752 and addBevel3D PC 339..441.
  const out=sourceProcessingClosedStrokeBuffers(triangle,2,plan);
  expect(Array.from(out.indices)).toEqual([
   0,1,2,2,1,3,
   4,5,6,6,5,7,8,2,4,8,3,5,
   9,10,11,11,10,12,13,6,9,13,7,10,
   14,11,15,14,16,12,
  ]);
  expect(vertices(out.positions)).toEqual([
   [0,0,0,1],[0,0,0,1],[2,0,0,1],[2,0,0,1],
   [2,0,0,1],[2,0,0,1],[0,3,0,1],[0,3,0,1],[2,0,0,1],
   [0,3,0,1],[0,3,0,1],[0,0,0,1],[0,0,0,1],[0,3,0,1],
   [0,0,0,1],[0,0,0,1],[0,0,0,1],
  ]);
  expect(vertices(out.directions)).toEqual([
   [2,0,0,1],[2,0,0,-1],[-2,0,0,-1],[-2,0,0,1],
   [-2,3,0,1],[-2,3,0,-1],[2,-3,0,-1],[2,-3,0,1],[0,0,0,0],
   [0,-3,0,1],[0,-3,0,-1],[0,3,0,-1],[0,3,0,1],[0,0,0,0],
   [0,0,0,0],[2,0,0,1],[2,0,0,-1],
  ]);
 });
 it('uses the strict transformed float width threshold, including exact equality',()=>{
  for(const [width,scale,joins] of [[1.9999998807907104,1,false],[2,1,true],[1,2,true],[3,.5,false]] as const){
   const rowMajor=identity.map((n,i)=>i===0||i===5||i===10?scale:n);
   const out=sourceProcessingClosedStrokeBuffers(triangle,width,{...plan,modelView:{...plan.modelView,rowMajor}});
   expect(out.positions.length).toBe((joins?17:12)*4);expect(out.indices.length).toBe(joins?36:18);
  }
 });
 it('closes thin strokes without cap or join vertices',()=>{
  const out=sourceProcessingClosedStrokeBuffers(triangle,1,plan);
  expect(Array.from(out.indices)).toEqual([0,1,2,2,1,3,4,5,6,6,5,7,8,9,10,10,9,11]);
  expect(Array.from(out.positions.slice(-8))).toEqual([0,0,0,1,0,0,0,1]);
 });
 it('keeps repeated points, nonfinite consequences, and literal zero bevel directions',()=>{
  const input=new Float32Array([0,0,0,0,0,0,NaN,0,0]),out=sourceProcessingClosedStrokeBuffers(input,2,plan);
  expect(out.indices.length).toBe(36);expect(out.positions.length).toBe(68);
  expect(Array.from(out.directions.slice(0,4))).toEqual([0,0,0,1]);
  expect(Number.isNaN(out.positions[6*4])).toBe(true);
  for(const vertex of [8,13,14])for(const value of out.directions.slice(vertex*4,vertex*4+4))expect(Object.is(value,0)).toBe(true);
  const rowMajor=identity.slice();rowMajor[0]=NaN;
  const nan=sourceProcessingClosedStrokeBuffers(triangle,2,{...plan,modelView:{...plan.modelView,rowMajor}});
  expect(nan.indices.length).toBe(36);expect(Number.isNaN(nan.directions[3])).toBe(true);
  expect(Array.from(nan.directions.slice(32,36))).toEqual([0,0,0,0]);
 });
 it('preserves signed zero widths for a singular transform and computes raw differences before translation',()=>{
  const rowMajor=identity.slice();rowMajor[0]=0;
  const zero=sourceProcessingClosedStrokeBuffers(triangle,2,{...plan,modelView:{...plan.modelView,rowMajor}});
  expect(Object.is(zero.directions[3],0)).toBe(true);expect(Object.is(zero.directions[7],-0)).toBe(true);
  const translated=identity.slice();translated[3]=16777216;
  const out=sourceProcessingClosedStrokeBuffers(new Float32Array([0,0,0,1,0,0,0,1,0]),2,{...plan,modelView:{...plan.modelView,rowMajor:translated}});
  expect(out.positions[0]).toBe(out.positions[8]);expect(out.directions[0]).toBe(1);
 });
 it('bounds the isolated index cache and exposes exact host allocation capacity',()=>{
  const out=sourceProcessingClosedStrokeBuffers(new Float32Array(600),2,plan);
  expect(out.positions.length/4).toBe(SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxVertices);
  expect(out.indices.length).toBe(SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxIndices);
  expect(out.positions.byteLength+out.directions.byteLength+out.indices.byteLength).toBe(SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxBufferBytes);
  for(const count of [0,6,10,603])expect(()=>sourceProcessingClosedStrokeBuffers(new Float32Array(count),2,plan)).toThrow(/3 至 200/);
  for(const width of [0,-1,Infinity,NaN,1e39])expect(()=>sourceProcessingClosedStrokeBuffers(triangle,width,plan)).toThrow(/宽度/);
 });
 it('owns logical viewport and pass-dependent source depth bias for either host',()=>{
  expect(sourceProcessingLineDisplay(plan)).toEqual({viewport:[0,0,200,100],perspective:0,scale:[Math.fround(.999),Math.fround(.999),Math.fround(.999)]});
  expect(sourceProcessingLineDisplay({...plan,viewport:{...plan.viewport,projectionPass:'scene-fade-orthographic'}}).scale).toEqual([1,1,Math.fround(.999)]);
  expect(()=>sourceProcessingLineDisplay({...plan,viewport:{...plan.viewport,projectionPass:'unknown'}})).toThrow(/未知/);
 });
});
