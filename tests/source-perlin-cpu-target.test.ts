import {describe,it,expect} from 'vitest';
import {SourcePerlinCpuTarget} from '../src/engine/sourcePerlinCpuTarget';
import {sourceProcessingOpenStrokeBuffers} from '../src/engine/sourceProcessingStroke';
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const options={width:31,height:27,density:1,samples:0 as const,initialColor:[0,0,0,0] as const};
const frame={projection:identity,background:[0,0,0,.2] as const,accumulation:true,primitives:[]};
const empty={positions:new Float32Array(),colors:new Float32Array(),directions:new Float32Array(),indices:new Uint16Array(),caches:[]};
describe('Perlin CPU target pre-allocation contracts',()=>{
 for(const [label,primitive] of [
  ['missing buffers',{kind:'lines'}],
  ['null cache',{kind:'lines',buffers:{...empty,caches:[null]}}],
  ['empty caches',{kind:'lines',buffers:{...empty,caches:Array(10000).fill({vertexOffset:0,indexOffset:0,vertexCount:0,indexCount:0})}}],
  ['out-of-range local index',{kind:'lines',buffers:{positions:new Float32Array(12),colors:new Float32Array(12),directions:new Float32Array(12),indices:new Uint16Array([0,1,3]),caches:[{vertexOffset:0,indexOffset:0,vertexCount:3,indexCount:3}]}}],
 ] as const)it(`rejects ${label} before WebGL creation with an owned error`,()=>{
  const target=new SourcePerlinCpuTarget(options);
  expect(()=>target.draw({...frame,primitives:[primitive]} as never)).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>target.readPixels()).toThrow(expect.objectContaining({code:'failed'}));target.dispose();
 });
 it('checks cancellation while validating cache coverage',()=>{
  const b={positions:new Float32Array(12),colors:new Float32Array(12),directions:new Float32Array(12),indices:new Uint16Array([0,1,2]),caches:[{vertexOffset:0,indexOffset:0,vertexCount:3,indexCount:3}]};
  const target=new SourcePerlinCpuTarget(options);let calls=0;
  expect(()=>target.draw({...frame,primitives:[{kind:'lines',buffers:b}]},()=>++calls===3)).toThrow(expect.objectContaining({code:'cancelled'}));
  expect(calls).toBe(3);target.dispose();
 });
 it('rejects missing open-stroke input and matrix using its boundary error',()=>{
  for(const value of [null,{}, {positions:new Float32Array(),polygonOffsets:new Uint32Array([0]),colors:new Float32Array(),lineWidth:1}]){
   expect(()=>sourceProcessingOpenStrokeBuffers(value as never)).toThrow(expect.objectContaining({code:'input'}));
  }
 });
});
