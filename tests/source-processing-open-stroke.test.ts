import {describe,it,expect} from 'vitest';
import {sourceProcessingOpenStrokeBuffers,SourceProcessingStrokeError} from '../src/engine/sourceProcessingStroke';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function input(n:number,width=2,offsets=[0,n]){
 const positions=new Float32Array(n*3),colors=new Float32Array(n*4);
 for(let i=0;i<n;i++){positions[i*3]=i;positions[i*3+1]=i%2;colors[i*4]=Math.fround((i%251)/255);colors[i*4+1]=.25;colors[i*4+2]=.5;colors[i*4+3]=Math.fround((i%253)/255);}
 return {positions,colors,polygonOffsets:new Uint32Array(offsets),rowMajor:identity,lineWidth:width};
}
const vec=(a:Float32Array,i:number)=>Array.from(a.subarray(i*4,i*4+4));
describe('source Processing open POLYGON stroke expansion',()=>{
 it('emits source edge/bevel order and per-vertex color without a closing edge or endpoint caps',()=>{
  const source=input(3),out=sourceProcessingOpenStrokeBuffers(source);
  expect(out.caches).toEqual([{vertexOffset:0,indexOffset:0,vertexCount:9,indexCount:18}]);
  expect(Array.from(out.indices)).toEqual([0,1,2,2,1,3,4,5,6,6,5,7,8,2,4,8,3,5]);
  expect(Array.from({length:9},(_,i)=>vec(out.directions,i))).toEqual([[1,1,0,1],[1,1,0,-1],[-1,-1,0,-1],[-1,-1,0,1],[1,-1,0,1],[1,-1,0,-1],[-1,1,0,-1],[-1,1,0,1],[0,0,0,0]]);
  for(const [v,c] of [[0,0],[1,0],[2,1],[3,1],[4,1],[5,1],[6,2],[7,2],[8,1]])expect(vec(out.colors,v)).toEqual(vec(source.colors,c));
 });
 it('preserves native minimum shape size and resets joins across independent shapes',()=>{
  const out=sourceProcessingOpenStrokeBuffers(input(11,2,[0,0,1,3,6,8,11]));
  expect(out.positions.length/4).toBe(18);expect(out.indices.length).toBe(36);
  expect(out.caches).toEqual([{vertexOffset:0,indexOffset:0,vertexCount:18,indexCount:36}]);
  expect(Array.from(out.indices.slice(18))).toEqual([9,10,11,11,10,12,13,14,15,15,14,16,17,11,13,17,12,14]);
 });
 it('uses transformed float width with strict <2 threshold',()=>{
  for(const [width,scale,vertices] of [[1.9999998807907104,1,8],[2,1,9],[1,2,9],[3,.5,8]] as const){
   const source=input(3,width);source.rowMajor=identity.map((v,i)=>i===0||i===5||i===10?scale:v);
   expect(sourceProcessingOpenStrokeBuffers(source).positions.length/4).toBe(vertices);
  }
 });
 it('preserves duplicate and nonfinite points, raw differences and signed zero widths',()=>{
  const source=input(3);source.positions.set([0,0,0,0,0,0,NaN,1,0]);
  const out=sourceProcessingOpenStrokeBuffers(source);
  expect(out.positions.length/4).toBe(9);expect(vec(out.directions,0)).toEqual([0,0,0,1]);
  expect(Number.isNaN(out.directions[16])).toBe(true);expect(vec(out.directions,8)).toEqual([0,0,0,0]);
  const singular=input(3);singular.rowMajor=identity.slice();singular.rowMajor[0]=0;
  const zero=sourceProcessingOpenStrokeBuffers(singular);expect(Object.is(zero.directions[3],0)).toBe(true);expect(Object.is(zero.directions[7],-0)).toBe(true);
  const translated=input(3);translated.rowMajor=identity.slice();translated.rowMajor[3]=16777216;
  const t=sourceProcessingOpenStrokeBuffers(translated);expect(t.positions[0]).toBe(t.positions[8]);expect(t.directions[0]).toBe(1);
 });
 it('recovers a wide rollover bevel with previous edge START color and local ushort indices',()=>{
  // Source PC50: 32768 <= base +4 +1. 6553 edges occupy 32764 vertices.
  const source=input(6555),out=sourceProcessingOpenStrokeBuffers(source);
  expect(out.caches).toEqual([{vertexOffset:0,indexOffset:0,vertexCount:32764,indexCount:78630},{vertexOffset:32764,indexOffset:78630,vertexCount:7,indexCount:12}]);
  expect(Array.from(out.indices.slice(-12))).toEqual([0,1,2,2,1,3,4,5,0,4,6,1]);
  expect(vec(out.colors,32764)).toEqual(vec(source.colors,6553));
  for(const v of [32768,32769,32770])expect(vec(out.colors,v)).toEqual(vec(source.colors,6552));
  expect(vec(out.directions,32768)).toEqual([0,0,0,0]);expect(vec(out.directions,32769)).toEqual([-1,-1,0,-1]);expect(vec(out.directions,32770)).toEqual([-1,-1,0,1]);
 });
 it('rolls a thin cache before exactly filling 32768 and does not add joins',()=>{
  const out=sourceProcessingOpenStrokeBuffers(input(8193,1));
  expect(out.caches).toEqual([{vertexOffset:0,indexOffset:0,vertexCount:32764,indexCount:49146},{vertexOffset:32764,indexOffset:49146,vertexCount:4,indexCount:6}]);
  expect(Array.from(out.indices.slice(-6))).toEqual([0,1,2,2,1,3]);
 });
 it('flushes only after a whole shape when total vertices reach 32768, then starts a fresh cache',()=>{
  const out=sourceProcessingOpenStrokeBuffers(input(6558,2,[0,6555,6558]));
  expect(out.caches).toEqual([{vertexOffset:0,indexOffset:0,vertexCount:32764,indexCount:78630},{vertexOffset:32764,indexOffset:78630,vertexCount:7,indexCount:12},{vertexOffset:32771,indexOffset:78642,vertexCount:9,indexCount:18}]);
  expect(Array.from(out.indices.slice(-18))).toEqual([0,1,2,2,1,3,4,5,6,6,5,7,8,2,4,8,3,5]);
 });
 it('allows more than 200 points and rejects malformed owned input before expansion',()=>{
  expect(sourceProcessingOpenStrokeBuffers(input(201)).positions.length/4).toBe(999);
  for(const offsets of [[1,3],[0,2],[0,3,2,3]])expect(()=>sourceProcessingOpenStrokeBuffers(input(3,2,offsets))).toThrow(/offsets|buffers/);
  for(const width of [0,-1,Infinity,NaN,1e39])expect(()=>sourceProcessingOpenStrokeBuffers(input(3,width))).toThrow(/width/);
  const bad=input(3);bad.colors[0]=NaN;expect(()=>sourceProcessingOpenStrokeBuffers(bad)).toThrow(/RGBA/);
  expect(sourceProcessingOpenStrokeBuffers(input(0))).toMatchObject({caches:[],indices:new Uint16Array(0)});
 });
 it('bounds complete expanded storage before output allocation and responds to cancellation',()=>{
  expect(()=>sourceProcessingOpenStrokeBuffers(input(1_100_000))).toThrow(/256 MiB/);
  let checks=0;
  try{sourceProcessingOpenStrokeBuffers({...input(20_000),isCancelled:()=>++checks>8});throw Error('missing cancellation');}catch(error){expect(error).toBeInstanceOf(SourceProcessingStrokeError);expect(error).toMatchObject({code:'cancelled',name:'AbortError'});}
 });
});
