import {describe,it,expect} from 'vitest';
import {prepareSourceBouncingUpdate,sourceBouncingGpuLayout,sourceBouncingGpuDisplayLayout,SourceBouncingGpu,type SourceBouncingUpdate,type SourceBouncingGpuDisplay} from '../src/engine/sourceBouncingGpu';
import {importSourceBouncingVisualConfig} from '../src/engine/sourceBouncingVisualConfig';
import {prepareSourceCamera,SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';
import cameraFixture from './fixtures/source-camera/transforms.json';

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
 it('includes polygon area and recovery edge scans in pre-context work admission',()=>{
  const gpu=new SourceBouncingGpu(new Float32Array(200000*4));
  try{
   expect(()=>gpu.advance({...input,subSteps:16,boundary:{kind:'polygon',vertices:Array.from({length:64},(_,i)=>[Math.cos(i*Math.PI/32),Math.sin(i*Math.PI/32)] as const)}})).toThrow('碰撞边工作量');
   expect(gpu.diagnostics()).toMatchObject({contextOwned:false,handles:0,passes:0,collisionEdgeWork:0});
  }finally{gpu.dispose();}
 });
});

describe('Bouncing particle display admission before allocating GPU resources',()=>{
 function options():SourceBouncingGpuDisplay{
  const row=cameraFixture.cases[0],camera=prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'},frame:row.frame},row.viewport),visual=importSourceBouncingVisualConfig({});
  if(!camera.ok||camera.value.kind!=='known'||!visual.ok)throw Error('Invalid retained fixture');
  return{width:320,height:180,cameraPlan:camera.value.plan,visualConfiguration:visual.value.configuration,initialSpeed:1};
 }
 function rejects(input:SourceBouncingGpuDisplay,match:string){
  const gpu=new SourceBouncingGpu(new Float32Array([0,0,1,0]));
  try{expect(()=>gpu.render(input)).toThrow(match);expect(gpu.diagnostics()).toMatchObject({contextOwned:false,handles:0,rendered:0,readbackBytes:0,failed:true});}
  finally{gpu.dispose();}
 }
 it('rejects impossible raster requests without obtaining a browser context',()=>{
  for(const width of [0,-1,.5,NaN,Infinity,16385])rejects({...options(),width},'画布');
  rejects({...options(),width:16384,height:16384},'画布');
  expect(sourceBouncingGpuDisplayLayout(1920,1080).bytes).toBeGreaterThan(1920*1080*8);
 });
 it('rejects corrupted camera upload arrays before initialization',()=>{
  const input=options();input.cameraPlan.projection.columnMajor[5]=NaN;rejects(input,'Float32');
 });
 it('rejects excessive point coverage without silently clamping dot size',()=>{
  const input=options();input.visualConfiguration.dotSize=1e6;rejects(input,'点片元');
 });
 it('accounts for the whole state and image together before opening a context',()=>{
  const gpu=new SourceBouncingGpu(new Float32Array(2000000*4));
  try{expect(()=>gpu.render({...options(),width:4096,height:4096})).toThrow('合计');expect(gpu.diagnostics()).toMatchObject({contextOwned:false,handles:0,rendered:0});}
  finally{gpu.dispose();}
 });
});
