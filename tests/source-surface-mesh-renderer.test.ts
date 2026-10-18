import {describe,it,expect} from 'vitest';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {createSourceSurfaceMeshFill,sourceSurfaceMeshAppearance,sourceMeshEyeVertices,sourceSurfaceMeshFillColors} from '../src/engine/sourceSurfaceMeshRenderer';
import {outputBuffers} from '../src/engine/outputBuffers';
import type {GeometryOutput} from '../src/types';
const parsed=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:100,logicalHeight:100,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'});
if(!parsed.ok||parsed.value.kind!=='known')throw Error('camera fixture');
const plan=parsed.value.plan;
const output=():GeometryOutput=>({type:'geometry',topology:'mesh',positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2]),sourceMeshColors:new Uint32Array([0xffff0000,0xff00ff00,0xff0000ff]),sourceMeshAppearance:sourceSurfaceMeshAppearance(true,.9)});
describe('CPU source mesh fill boundary',()=>{
 it('clamps native fill opacity then truncates float alpha independently of palette alpha',()=>{
  expect(sourceSurfaceMeshAppearance(true,.9).fillAlphaByte).toBe(229);
  expect(sourceSurfaceMeshAppearance(true,-2).fillAlphaByte).toBe(0);
  expect(sourceSurfaceMeshAppearance(false,2)).toMatchObject({fillEnabled:false,fillAlphaByte:255});
  for(const n of [NaN,Infinity,1e39])expect(()=>sourceSurfaceMeshAppearance(true,n)).toThrow();
 });
 it('rounds each CPU modelview product and sum before the GPU projection',()=>{
  const custom={...plan,modelView:{...plan.modelView,rowMajor:[1,1,-1,0,0,1,0,0,0,0,1,0,0,0,0,1]}};
  expect(Array.from(sourceMeshEyeVertices(new Float32Array([16777216,1,16777216]),custom))).toEqual([0,1,16777216,1]);
 });
 it('preserves packed colors for transfer, borrows indices, and owns converted RGBA/positions',()=>{
  const data=output(),copy=data.positions.slice(),mesh=createSourceSurfaceMeshFill(data,plan);
  expect(mesh.geometry.getAttribute('color').itemSize).toBe(4);
  expect(outputBuffers({...data,stats:{samples:3,generated:3,invalid:0}})).toContain(data.sourceMeshColors!.buffer);
  expect(mesh.geometry.getIndex()!.array).toBe(data.indices);
  expect(mesh.geometry.getAttribute('position').array).not.toBe(data.positions);
  expect(mesh.geometry.getAttribute('position').itemSize).toBe(4);
  mesh.geometry.dispose();mesh.material.dispose();expect(data.positions).toEqual(copy);
 });
 it('interprets zero-alpha packed blue/black as native fill(int) grayscale for every byte value',()=>{
  const packed=Uint32Array.from({length:256},(_,i)=>i|0x40000000),colors=sourceSurfaceMeshFillColors(packed,0);
  for(let i=0;i<256;i++)expect(Array.from(colors.slice(i*4,i*4+4))).toEqual([Math.fround(i/255),Math.fround(i/255),Math.fround(i/255),1]);
  expect(Array.from(sourceSurfaceMeshFillColors(new Uint32Array([0xffff0000,0xff00ff00]),0))).toEqual([1,0,0,0,0,1,0,0]);
  expect(Array.from(sourceSurfaceMeshFillColors(new Uint32Array([0xff]),1))).toEqual([0,0,1,Math.fround(1/255)]);
 });
 it('rejects incompatible/malformed frames before constructing GPU resources',()=>{
  for(const changed of [{topology:'points' as const},{sourceMeshColors:new Uint32Array(2)},{indices:new Uint32Array([0,1,3])},{indices:new Uint32Array(2)},{sourceMeshAppearance:{...sourceSurfaceMeshAppearance(true,1),fillAlphaByte:1.5}}])expect(()=>createSourceSurfaceMeshFill({...output(),...changed},plan)).toThrow();
 });
 it('transfers source wire pairs once without detaching retained owner snapshots',()=>{
  const out={...output(),sourceMeshWireframe:{positions:new Float32Array([0,0,0,1,2,3]),packedColor:0x80445566,lineWidth:1,mode:'coupled' as const},stats:{samples:3,generated:3,invalid:0}};
  const retained=structuredClone(out),buffers=outputBuffers(out);
  expect(buffers.filter(buffer=>buffer===out.sourceMeshWireframe.positions.buffer)).toHaveLength(1);
  const received=structuredClone(out,{transfer:buffers});
  expect(out.sourceMeshWireframe.positions.byteLength).toBe(0);
  expect(received.sourceMeshWireframe).toEqual(retained.sourceMeshWireframe);
  expect(retained.sourceMeshWireframe.positions.byteLength).toBe(24);
 });
});
