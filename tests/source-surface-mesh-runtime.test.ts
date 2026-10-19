import {describe,expect,it} from 'vitest';
import {createSourceSurfaceMeshRuntime,type SourceSurfaceMeshRuntimeOptions} from '../src/engine/sourceSurfaceMeshRuntime';
import {importSourceSurfaceMeshConfig} from '../src/engine/sourceSurfaceMeshConfig';
import {prepareSourceSurfaceFunction,type SourceSurfaceFunction} from '../src/engine/sourceSurfaceFunction';
import type {OrdinaryCameraTargetRequest} from '../src/engine/ordinarySourceCameraTimeline';

const F=Math.fround;
function setup(settings:Record<string,unknown>={},equations={x:'u',y:'v',z:'0'},parameters:Record<string,number>={},overrides:Partial<SourceSurfaceMeshRuntimeOptions>={}){
 const parsed=importSourceSurfaceMeshConfig({surface_mode:'mesh',mesh_u_segments:3,mesh_v_segments:2,mesh_wireframe:false,u_min:0,u_max:1,v_min:0,v_max:1,scale_x:1,scale_y:1,scale_z:1,speed_u:.3,speed_v:-.2,...settings});
 if(!parsed.ok)throw Error(JSON.stringify(parsed.error));const configuration=parsed.value.configuration,t=configuration.transform;
 const prepared=prepareSourceSurfaceFunction({equations,parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 const surfaceFunction=overrides.surfaceFunction??prepared.create();
 const options:SourceSurfaceMeshRuntimeOptions={configuration,surfaceFunction,operationsPerPosition:prepared.operations,frameRate:4,...overrides};
 return{runtime:createSourceSurfaceMeshRuntime(options),surfaceFunction,options};
}
function request(index:number):OrdinaryCameraTargetRequest{return{action:{id:'track',method:'track',args:{index}},trackId:'track',actionIndex:0};}
const frame=(frameIndex:number,deltaTime=.25)=>({frameIndex,time:F((frameIndex+1)*.25),deltaTime});
const point=(values:Float32Array,index=0)=>Array.from(values.slice(index*3,index*3+3));

describe('one native CPU MeshSurface runtime lifetime',()=>{
 it('retains one mutable tracking dot for all build-time bindings while the rendered grid remains stationary',()=>{
  const {runtime}=setup(),first=runtime.bind(request(0)),last=runtime.bind(request(5.9));
  if(first.kind!=='bound'||last.kind!=='bound')throw Error('bound targets required');
  expect(first.readPosition()).toEqual([F(F(2)*F(1/3)),.5,0]);expect(last.readPosition()).toEqual(first.readPosition());
  runtime.update(frame(0,.5));runtime.display(0);
  expect(first.readPosition()).toEqual([F(F(F(2)*F(1/3))+F(.5*F(.3))),F(.5+F(.5*F(-.2))),0]);
  expect(last.readPosition()).toEqual(first.readPosition());
  expect(point(runtime.snapshot().geometry!.positions,5)).toEqual([1,1,0]);
  expect(runtime.snapshot().tracked.index).toBe(5);
 });
 it('initializes tracking from count/2 without a track action and uses source wrap/bounce recurrence',()=>{
  const {runtime}=setup({mesh_u_segments:2,speed_u:1,speed_v:2,periodic_u:true,flowing_u:true,periodic_v:true,flowing_v:false});
  runtime.bind(request(3));runtime.update(frame(0,.75));runtime.display(0);
  expect(runtime.snapshot().tracked).toMatchObject({u:.25,v:1,speedU:1,speedV:-2,position:[.25,1,0]});
  runtime.update(frame(1,.75));runtime.display(1);
  expect(runtime.snapshot().tracked).toMatchObject({u:0,v:0,speedU:1,speedV:2,position:[0,0,0]});
  const other=setup().runtime;other.update(frame(0,0));other.display(0);
  expect(other.snapshot().tracked.index).toBe(3);expect(other.snapshot().tracked.position).toEqual([F(1/3),.5,0]);
 });
 it('updates named parameters before stationary grid and moving tracker, with unknown bindings remaining no-ops',()=>{
  const {runtime,surfaceFunction}=setup({speed_u:0,speed_v:0},{x:'a+u',y:'v',z:'a'},{a:2});
  runtime.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:7,max:7,step:0}},{kind:'start',scope:{kind:'named',name:'missing'},configuration:{min:99,max:99,step:0}}]);
  runtime.interpolateParameterActions(1,true);runtime.update(frame(0));runtime.display(0);
  expect(surfaceFunction.read('a')).toBe(7);expect(point(runtime.snapshot().geometry!.positions)).toEqual([7,0,7]);
  expect(runtime.snapshot().tracked.position).toEqual([F(7+F(1/3)),.5,7]);
  expect(runtime.snapshot().diagnostics.some(x=>x.includes('1 个未声明参数'))).toBe(true);
 });
 it('keeps zero-dt parameter updates inert and standalone finish stops before the final object update',()=>{
  const {runtime,surfaceFunction}=setup({speed_u:0,speed_v:0},{x:'a+u',y:'v',z:'0'},{a:0});
  runtime.beginParameterClip([{name:'a',min:-10,max:10,step:1,edgeEasing:{window:.4,floor:1,easing:'linear'}}]);
  runtime.update(frame(0,0));runtime.display(0);expect(surfaceFunction.read('a')).toBe(0);
  runtime.update(frame(1));runtime.display(1);expect(surfaceFunction.read('a')).toBe(10*Math.sin(.1));
  runtime.finishParameterClip();runtime.update(frame(2));runtime.display(2);expect(surfaceFunction.read('a')).toBe(10*Math.sin(.1));
  expect(runtime.snapshot().animationTime).toBe(.75);
 });
 it('does not advance gradient phase or apply extra smoothing during Mesh.update, including waits',()=>{
  const {runtime}=setup({},undefined,{}, {palette:{colors:['#FF0000','#00FF00','#0000FF']}});
  runtime.beginGradientActions([{kind:'start',config:{mode:'cross_fade',interpolation:'rgb',speed:90}}]);
  runtime.interpolateGradientActions(.5,false);runtime.update(frame(0));runtime.display(0);
  const initial=runtime.snapshot(),colors=Array.from(initial.packedColors);
  expect(initial.gradient.running).toBe(true);expect(initial.gradient.progress).toBe(0);
  runtime.beginGradientActions([]);runtime.update(frame(1));runtime.display(1);
  expect(runtime.snapshot().gradient.progress).toBe(0);expect(runtime.snapshot().paletteState).toEqual(initial.paletteState);expect(Array.from(runtime.snapshot().packedColors)).toEqual(colors);
  runtime.beginGradientActions([{kind:'stop'}]);runtime.interpolateGradientActions(1,true);runtime.update(frame(2));runtime.display(2);
  expect(runtime.snapshot().gradient.running).toBe(false);expect(runtime.snapshot().gradient.progress).toBe(0);
 });
 it('captures U shift at each explicit display lifecycle rather than lazily in snapshot',()=>{
  const settings={mesh_wrap_u:true,mesh_v_segments:5,speed_u:0,speed_v:0},equations={x:'u',y:'v+a*u',z:'u*v*.17'};
  const {runtime,surfaceFunction}=setup(settings,equations,{a:.17});
  runtime.update(frame(0));runtime.display(0);const first=runtime.snapshot(),shift=first.geometry!.seams.shiftU;
  surfaceFunction.write('a',.63);runtime.update(frame(1));runtime.display(1);
  expect(runtime.snapshot().geometry!.seams.shiftU).toBe(shift);
  const finalOnly=setup(settings,equations,{a:.63}).runtime;finalOnly.update(frame(0));finalOnly.display(0);
  expect(finalOnly.snapshot().geometry!.seams.shiftU).not.toBe(shift);
  expect(()=>setup(settings,equations,{a:.17}).runtime.snapshot()).toThrow('先执行显示帧');
 });
 it('continues explicit displays after the update queue ends and returns stable independently owned snapshots',()=>{
  const {runtime}=setup();runtime.update(frame(0));runtime.display(0);
  const initial=runtime.snapshot();expect(runtime.snapshot()).toBe(initial);
  runtime.display(1);const later=runtime.snapshot();expect(later).not.toBe(initial);
  expect(later.tracked).toEqual(initial.tracked);expect(later.animationTime).toBe(initial.animationTime);
  expect(later.geometry!.positions).not.toBe(initial.geometry!.positions);
  initial.geometry!.positions[0]=999;expect(later.geometry!.positions[0]).toBe(0);
 });
 it('reuses only private geometry buffers and survives mutation and transfer of every public frame buffer',()=>{
  const {runtime}=setup({mesh_wireframe:true});runtime.update(frame(0));runtime.display(0);const initial=runtime.snapshot();
  const positions=initial.geometry!.positions.slice(),wire=initial.wireframe!.positions.slice(),packed=initial.packedColors.slice();
  initial.geometry!.seams.shiftU=999;initial.geometry!.positions.fill(999);initial.wireframe!.positions.fill(999);initial.packedColors.fill(0);
  const g=initial.geometry!;
  const buffers=[g.positions.buffer,g.normals.buffer,g.triangles.buffer,g.sourceColorIndices.buffer,g.wireframeIndexedTriangles.buffer,g.wireframeUSeamQuads.buffer,initial.wireframe!.positions.buffer,initial.packedColors.buffer];
  structuredClone(initial,{transfer:buffers});expect(g.positions.byteLength).toBe(0);
  runtime.update(frame(1));runtime.display(1);const next=runtime.snapshot();
  expect(next.geometry!.positions).toEqual(positions);expect(next.wireframe!.positions).toEqual(wire);expect(next.packedColors).toEqual(packed);expect(next.geometry!.seams.shiftU).toBe(0);
 });
 it('invalidates geometry by the exact function revision, including signed zero, and updates only line width for lineScale',()=>{
  const {runtime,surfaceFunction}=setup({mesh_wireframe:true},{x:'u',y:'v',z:'1/a'},{a:1});
  runtime.display(0,1);const first=runtime.snapshot();surfaceFunction.write('a',0);runtime.display(1,0);
  expect(runtime.snapshot().geometry!.positions[2]).toBe(Infinity);expect(runtime.snapshot().wireframe!.lineWidth).toBeGreaterThan(first.wireframe!.lineWidth);
  surfaceFunction.write('a',-0);runtime.display(2,-1);expect(runtime.snapshot().geometry!.positions[2]).toBe(-Infinity);
  surfaceFunction.write('a',1);runtime.display(3,NaN);expect(runtime.snapshot().geometry!.positions).toEqual(first.geometry!.positions);
  expect(runtime.snapshot().wireframe!.positions).toEqual(first.wireframe!.positions);
 });
 it('avoids pure full-grid work on unchanged revisions but recomputes on parameter writes',()=>{
  let samples=0;
  const base=prepareSourceSurfaceFunction({equations:{x:'u+a',y:'v',z:'0'},parameters:{a:0},scales:[1,1,1],offsets:[0,0,0]}).create();
  const counted:SourceSurfaceFunction={...base,get revision(){return base.revision;},position:(...args)=>{samples++;return base.position(...args);}};
  const {runtime}=setup({mesh_wireframe:true},undefined,{}, {surfaceFunction:counted});runtime.update(frame(0));runtime.display(0);
  const first=samples;runtime.update(frame(1));runtime.display(1);expect(samples-first).toBe(1); // actual moving tracked dot
  base.write('a',2);const before=samples;runtime.update(frame(2));runtime.display(2);expect(samples-before).toBeGreaterThan(10);
  const changed=runtime.snapshot().geometry!.positions.slice();base.write('a',2);const same=samples;runtime.update(frame(3));runtime.display(3);
  expect(samples-same).toBe(1);expect(runtime.snapshot().geometry!.positions).toEqual(changed);
 });
 it('keeps old function/target identities isolated from replacement objects while shared base constants seed recreation',()=>{
  const old=setup({speed_u:0,speed_v:0},{x:'a+u',y:'v',z:'0'},{a:2}),binding=old.runtime.bind(request(0));
  if(binding.kind!=='bound')throw Error('bound');
  old.runtime.beginParameterClip([{name:'a',min:7,max:7,step:0}]);old.runtime.update(frame(0));old.runtime.display(0);
  const next=setup({speed_u:0,speed_v:0},{x:'a+u',y:'v',z:'0'},{a:2},{surfaceFunction:old.surfaceFunction.recreate()});
  // Replacing a host option field must not retarget an already-owned runtime.
  old.options.surfaceFunction=next.surfaceFunction;
  old.runtime.beginParameterClip([{name:'a',min:9,max:9,step:0}]);old.runtime.update(frame(1));old.runtime.display(1);
  next.runtime.update(frame(5));next.runtime.display(5);
  expect(binding.readPosition()).toEqual([9,0,0]);expect(point(next.runtime.snapshot().geometry!.positions)).toEqual([7,0,0]);
 });
 it('maps native packed colors to vertices without early RGB/alpha interpretation',()=>{
  const {runtime}=setup({mesh_fill_opacity:1.7},undefined,{}, {palette:{colors:['#00FF0000','#4000FF00','#FF0000FF']}});
  runtime.display(0);const out=runtime.snapshot();expect(out.fillOpacity).toBe(F(1.7));
  expect(out.packedColors[0]).toBe(0x00ff0000);expect(out.packedColors[1]).toBe(0x4000ff00);
  // Native shifted sampling wraps coordinate1 even on a noncyclic surface.
  expect(out.packedColors[2]).toBe(0x00ff0000);expect(out).not.toHaveProperty('colors');
  const blue=setup({mesh_fill_opacity:0},undefined,{}, {palette:{colors:['#FF0000FF']}}).runtime;
  blue.display(0);expect(blue.snapshot().packedColors[0]).toBe(0xff0000ff);expect(blue.snapshot().fillOpacity).toBe(0);
 });
 it('routes decoupled-only wireframe without initializing fill geometry and couples wire edges to the same frame',()=>{
  const independent=setup({mesh_fill:false,mesh_wireframe:true,wireframe_decoupled:true,wireframe_u_segments:1,wireframe_v_segments:0}).runtime;
  independent.display(0);expect(independent.snapshot().geometry).toBeUndefined();expect(independent.snapshot().wireframe?.mode).toBe('decoupled');expect(independent.snapshot().wireframe?.positions.length).toBe(2*128*6);
  const coupled=setup({mesh_fill:false,mesh_wireframe:true}).runtime;coupled.display(0);
  expect(coupled.snapshot().geometry).toBeDefined();expect(coupled.snapshot().wireframe?.mode).toBe('coupled');
 });
 it('preserves nonfinite untracked grid samples for whole-quad filtering and no-op trail toggles',()=>{
  const {runtime}=setup({speed_u:0,speed_v:0},{x:'u',y:'v',z:'1/(1-u)'},{});
  runtime.setRecordingTrails(true);runtime.update(frame(0));runtime.display(0);
  expect(runtime.snapshot().geometry!.triangles.length).toBe(6);expect(runtime.snapshot().geometry!.positions[8]).toBe(Infinity);
  runtime.setRecordingTrails(false);runtime.update(frame(1));runtime.display(1);expect(runtime.snapshot()).not.toHaveProperty('trails');
 });
 it('cancels/bounds before work and poisons interrupted state including previously captured bindings',()=>{
  let cancelled=false;const {runtime}=setup({},undefined,{}, {isCancelled:()=>cancelled}),binding=runtime.bind(request(0));
  cancelled=true;expect(()=>runtime.update(frame(0))).toThrow('已取消');cancelled=false;
  expect(()=>runtime.display(0)).toThrow('已取消');if(binding.kind==='bound')expect(()=>binding.readPosition()).toThrow('已取消');
  let samples=0;const base=prepareSourceSurfaceFunction({equations:{x:'u',y:'v',z:'0'},parameters:{},scales:[1,1,1],offsets:[0,0,0]}).create();
  const counted:SourceSurfaceFunction={...base,position:(...args)=>{samples++;return base.position(...args);}};
  expect(()=>setup({},undefined,{}, {surfaceFunction:counted,reserve:()=>{throw Error('shared budget');}})).toThrow('shared budget');expect(samples).toBe(0);
 });
 it('rejects missing GPU compiler and inconsistent update/display ordering without modifying other owners',()=>{
  const replacement=setup({surface_mode:'points'}).runtime;replacement.display(0);expect(replacement.snapshot().geometry).toBeDefined();
  expect(()=>setup({render_mode:'GPU'})).toThrow('编译函数');expect(()=>setup({mesh_u_segments:513})).toThrow('1–512');
  const a=setup().runtime;a.update(frame(0));a.display(0);expect(()=>a.update(frame(0))).toThrow('帧顺序');
  const b=setup().runtime;b.display(0);expect(()=>b.display(2)).toThrow('帧顺序');
  const c=setup().runtime;c.update(frame(0));expect(()=>c.update(frame(1))).toThrow('对应显示帧');
 });
});
