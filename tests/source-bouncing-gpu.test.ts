import {describe,it,expect} from 'vitest';
import {prepareSourceBouncingUpdate,sourceBouncingGpuLayout,SourceBouncingGpu,type SourceBouncingUpdate} from '../src/engine/sourceBouncingGpu';

const input:SourceBouncingUpdate={subSteps:2,timeStep:.012,particleRadius:.006,boundary:{kind:'circle',center:[0,0],radius:.55}};
describe('native Bouncing update uniform boundary',()=>{
 it('rounds at the uniform upload boundary and owns detached immutable coordinates',()=>{
  const before=structuredClone(input),source=structuredClone(input),u=prepareSourceBouncingUpdate(source);
  expect(u.timeStep).toBe(Math.fround(.012));expect(u.particleRadius).toBe(Math.fround(.006));
  if(u.boundary.kind!=='circle'||source.boundary.kind!=='circle')throw Error('circle');
  expect(u.boundary.radius).toBe(Math.fround(.55));Reflect.set(source.boundary.center,0,100);
  expect(u.boundary.center).toEqual([0,0]);expect(input).toEqual(before);expect(Object.isFrozen(u.boundary.center)).toBe(true);
 });
 it('preserves shader-only hostile inputs without pretending they pass native JSON clamps',()=>{
  const u=prepareSourceBouncingUpdate({...input,subSteps:-5,timeStep:-0,particleRadius:-.25,boundary:{kind:'ellipse',center:[1,2],a:-1,b:0}});
  expect(u.subSteps).toBe(-5);expect(Object.is(u.timeStep,-0)).toBe(true);expect(u.particleRadius).toBe(-.25);expect(u.boundary).toMatchObject({a:-1,b:0});
 });
 it('keeps polygon order, duplicates, winding and degenerate values instead of local exact-solver repairs',()=>{
  const vertices:[[number,number],[number,number],[number,number]]=[[1,0],[1,0],[0,0]],u=prepareSourceBouncingUpdate({...input,boundary:{kind:'polygon',vertices}});
  expect(u.boundary).toEqual({kind:'polygon',vertices});vertices[0][0]=99;expect(u.boundary).not.toEqual({kind:'polygon',vertices});
  expect(prepareSourceBouncingUpdate({...input,boundary:{kind:'polygon',vertices:[]}}).boundary).toEqual({kind:'polygon',vertices:[]});
 });
 it('rejects unrepresentable upload values and actual shader array overflow',()=>{
  for(const value of [NaN,Infinity,1e100])expect(()=>prepareSourceBouncingUpdate({...input,timeStep:value})).toThrow('Float32');
  for(const subSteps of [.5,2147483648,-2147483649])expect(()=>prepareSourceBouncingUpdate({...input,subSteps})).toThrow('int32');
  expect(()=>prepareSourceBouncingUpdate({...input,boundary:{kind:'polygon',vertices:Array.from({length:65},()=>[0,0] as const)}})).toThrow('64');
 });
 it('admits the two-million supplied-state workload without allocating it in metadata checks',()=>{
  expect(sourceBouncingGpuLayout(2000000)).toMatchObject({count:2000000,size:1415,texels:2002225});
  expect(()=>sourceBouncingGpuLayout(5000000)).toThrow('256 MiB');
  for(const count of [0,-1,.5,NaN,2147483648])expect(()=>sourceBouncingGpuLayout(count)).toThrow();
 });
 it('owns initialization without a context and supports cancellation/disposal before use',()=>{
  const data=new Float32Array([0,0,1,0]),owner=new SourceBouncingGpu(data,()=>true);
  expect(owner.diagnostics()).toMatchObject({contextOwned:false,handles:0,passes:0});
  expect(()=>owner.advance(input)).toThrow('取消');owner.dispose();owner.dispose();expect(owner.diagnostics()).toMatchObject({contextOwned:false,handles:0,disposed:true});
  expect(()=>new SourceBouncingGpu(new Float32Array(3))).toThrow('RGBA');
 });
});
