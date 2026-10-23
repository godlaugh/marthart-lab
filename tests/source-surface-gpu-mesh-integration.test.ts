import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport,prepareOrdinarySourceFrame} from '../src/engine/ordinarySourceCamera';
import {SourceSurfaceHost} from '../src/engine/sourceSurfaceHost';
import {replaySourceSurfaceHost} from '../src/engine/sourceSurfaceScene';
import {outputBuffers} from '../src/engine/outputBuffers';
import {createSourceSurfaceGpuMesh} from '../src/engine/sourceSurfaceGpuMeshRenderer';
import {snapshotSourceDrawings} from '../src/engine/sourceDrawingSnapshot';
import {encodeSourceDrawingFrame} from '../src/engine/sourceDrawingFrame';

function source(settings:Record<string,unknown>={},timeline:unknown[]=[{type:'wait',duration:2}]){return{config_version:'1.0.0',type:'SURFACE',name:'GPU mesh',parameters:{a:0},equations:{x:'u',y:'v',z:'a*u*v'},palette:['#80FF0000','#4000FF00'],camera:{phi:0,theta:0,gamma:0},settings:{render_mode:'GPU',surface_mode:'MESH',mesh_u_segments:2,mesh_v_segments:2,u_min:0,u_max:1,v_min:0,v_max:1,speed_u:1,speed_v:0,scale_x:1,scale_y:1,scale_z:1,show_trails:true,...settings},timeline};}
function read(raw=source()){const s=parseProjectFile(JSON.stringify(raw)).scene;s.timeline.fps=4;return s;}
function output(s:ReturnType<typeof read>,time=0){const out=generateScene(s,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)});if(out.type!=='geometry'||!out.sourceGpuMesh)throw Error('GPU mesh required');return out;}
function host(s=read(),coverage:'all'|'tracked'='all'){return new SourceSurfaceHost({configuration:s.surfaceSource!,equations:s.equations,parameters:s.parameters,palette:s.surfaceSourcePalette,frameRate:4,coverage});}
function step(h:SourceSurfaceHost,i:number,publish=true){h.update({frameIndex:i,time:(i+1)/4,deltaTime:.25});h.displayFrame(i,publish);}
function mesh(h:SourceSurfaceHost){const s=h.snapshot();if(s.mode!=='mesh'||!s.mesh.gpuMesh)throw Error('mesh');return s.mesh.gpuMesh;}
const request=(index:number)=>({trackId:'track',actionIndex:0,action:{id:'target',method:'track',args:{index}}});

describe('native GPU Mesh public lifetime',()=>{
 it('exports owned GPU fill/wire snapshots with integer flags, parameters and explicit empty samplers',()=>{
  const out=output(read()),objects=createSourceSurfaceGpuMesh(out.sourceGpuMesh!,prepareOrdinarySourceFrame(out.sourceCameraFrame!)),meshes=[objects.fill!,objects.wire!];
  try{
   const snapshot=snapshotSourceDrawings(meshes);expect(snapshot.ok).toBe(true);if(!snapshot.ok)throw Error(snapshot.error.reason);
   expect(snapshot.value.commands).toHaveLength(2);expect(snapshot.value.textures).toHaveLength(2);
   for(const texture of snapshot.value.textures){expect([texture.width,texture.height]).toEqual([1,1]);expect(Array.from(texture.pixels)).toEqual([0,0,0,0]);}
   const flags=snapshot.value.commands[0].uniforms.find(u=>u.name==='isPeriodic')!;expect(flags.kind).toBe('ivec2');if(flags.kind==='sampler2d')throw Error('numeric flags');expect(flags.values).toBeInstanceOf(Int32Array);
   const parameters=snapshot.value.commands[0].uniforms.find(u=>u.name==='params')!;if(parameters.kind==='sampler2d')throw Error('numeric params');expect(parameters.count).toBe(32);
   const captured=parameters.values.slice();out.sourceGpuMesh!.parameters.fill(99);expect(parameters.values).toEqual(captured);
   const packet=encodeSourceDrawingFrame({generation:1,sequence:1,width:96,height:64,samples:0,clear:[0,0,0,1],drawing:snapshot.value});expect(packet.ok).toBe(true);
  }finally{for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}}
  expect(snapshotSourceDrawings(meshes).ok).toBe(false);
 });
 it('releases each owned empty sampler with its material',()=>{
  const out=output(read()),objects=createSourceSurfaceGpuMesh(out.sourceGpuMesh!,prepareOrdinarySourceFrame(out.sourceCameraFrame!));let released=0;
  for(const mesh of [objects.fill!,objects.wire!]){mesh.material.uniforms.texMap.value.addEventListener('dispose',()=>released++);mesh.geometry.dispose();mesh.material.dispose();}
  expect(released).toBe(2);
 });
 it('imports and saves one canonical GPU mesh with inclusive zero-speed seeds, not CPU positions',()=>{
  const s=read(),out=output(parseScene(serializeScene(s)));expect(s.settings.computeBackend).toBe('webgl2');expect(out.backend).toBe('webgl2');expect(out.positions).toHaveLength(0);expect(out.indices).toBeUndefined();expect(out.trails).toBeUndefined();expect(out.sourceMeshAppearance).toBeUndefined();
  expect(Array.from(out.sourceGpuMesh!.seeds)).toEqual([0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,0]);expect(Array.from(out.sourceGpuMesh!.triangles)).toEqual([0,1,3,0,3,2]);
  expect(parseScene(serializeScene(s)).surfaceSource).toEqual(s.surfaceSource);
 });
 it('freezes topology when animated parameters change, and rebuilds only after palette change',()=>{
  const h=host();step(h,0);const original=mesh(h);expect(original.shapeGeneration).toBe(1);
  h.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:3,max:3,step:0}}]);h.interpolateParameterActions(1,true);step(h,1);
  const animated=mesh(h);expect(animated.parameters[0]).toBe(3);expect(animated.triangles).toEqual(original.triangles);expect(animated.shapeFunctionRevision).toBe(original.shapeFunctionRevision);expect(animated.shapeGeneration).toBe(1);
  h.beginGradientActions([{kind:'start',config:{mode:'cross_fade',interpolation:'rgb',speed:90}}]);h.interpolateGradientActions(.5,false);step(h,2);
  const changed=mesh(h);expect(changed.shapeGeneration).toBeGreaterThan(1);expect(Array.from(changed.triangles)).toEqual([0,1,2,1,3,2]);expect(changed.shapeFunctionRevision).toBeGreaterThan(original.shapeFunctionRevision);expect(original.parameters[0]).toBe(0);
 });
 it('refreshes geometric closure uniforms without rebuilding shape after parameter change',()=>{
  const raw=source({mesh_u_segments:4,mesh_v_segments:3});raw.equations={x:'cos(TWO_PI*u)+a*u',y:'sin(TWO_PI*u)',z:'v'};const h=host(read(raw));step(h,0);const first=mesh(h);expect(first.periodic[0]).toBe(1);
  h.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:10,max:10,step:0}}]);h.interpolateParameterActions(1,true);step(h,1);const last=mesh(h);
  expect(last.periodic[0]).toBe(0);expect(last.triangles).toEqual(first.triangles);expect(last.shapeGeneration).toBe(1);
 });
 it('keeps all mesh track actions bound to one configured-speed dot while mesh seeds stay stationary',()=>{
  for(const coverage of ['all','tracked'] as const){const h=host(read(),coverage),a=h.bind(request(0)),b=h.bind(request(3));if(a.kind!=='bound'||b.kind!=='bound')throw Error('binding');step(h,0);expect(a.readPosition()).toEqual([.75,.5,0]);expect(b.readPosition()).toEqual(a.readPosition());}
 });
 it('builds shape during intermediate display and keeps completed queues from advancing time',()=>{
  const h=host();step(h,0,false);h.displayFrame(1,true);const first=mesh(h);expect(first.shapeGeneration).toBe(1);expect(first.time).toBe(.25);h.displayFrame(2,true);expect(mesh(h)).toEqual(first);
 });
 it('matches backward replay and freezes uniforms/time after source queue completion',()=>{
  const s=read(source({},[{type:'param',duration:.5,parameters:{a:{min:1,max:2,step:.1}}},{type:'wait',duration:.5}]));
  const middle=output(s,.25).sourceGpuMesh;output(s,5);expect(output(s,.25).sourceGpuMesh).toEqual(middle);expect(output(s,5).sourceGpuMesh).toEqual(output(s,1).sourceGpuMesh);
 });
 it('converts GPU transitions to holds and preserves unsupported target source text',()=>{
  const s=read(source({},[{type:'surface_mode_transition',duration:.5,to:'POINTS'},{type:'wait',duration:.5}]));expect(s.timeline.tracks[0].type).toBe('wait');expect(output(s,.75).topology).toBe('mesh');expect(output(s,.75).sourceSurfaceOverlayAlpha).toBeUndefined();
 });
 it('preserves authored opacity and width while applying native setter constraints in render facts',()=>{
  const s=read(source({mesh_fill_opacity:1.5,mesh_line_weight:-2})),out=output(s);expect(s.surfaceSource!.mesh.fillOpacity).toBe(1.5);expect(s.surfaceSource!.mesh.lineWeight).toBe(-2);expect(out.sourceGpuMesh!.fillOpacity).toBe(1);expect(out.sourceGpuMesh!.lineWeight).toBe(Math.fround(.1));
 });
 it('retains shader-owned invalid positions instead of substituting CPU triangles',()=>{
  const raw=source({mesh_u_segments:3});raw.equations.x='sqrt(u-.5)';const out=output(read(raw));expect(out.sourceGpuMesh!.triangles.length).toBeGreaterThan(0);expect(out.positions).toHaveLength(0);
 });
 it('omits visible decoupled wire while preserving fill and the authored mode',()=>{
  const s=read(source({wireframe_decoupled:true,wireframe_u_segments:3,wireframe_v_segments:2}));
  const out=output(s),objects=createSourceSurfaceGpuMesh(out.sourceGpuMesh!,prepareOrdinarySourceFrame(out.sourceCameraFrame!));expect(objects.fill).toBeDefined();expect(objects.wire).toBeUndefined();objects.fill!.geometry.dispose();objects.fill!.material.dispose();
 });
 it('transfers all shape buffers without detaching retained replay state',()=>{
  const s=read(),out=output(s),expected=out.sourceGpuMesh!.seeds.slice(),buffers=outputBuffers(out);expect(buffers).toContain(out.sourceGpuMesh!.triangles.buffer);expect(buffers).toContain(out.sourceGpuMesh!.packedColors.buffer);expect(buffers).toContain(out.sourceGpuMesh!.parameters.buffer);
  structuredClone(out,{transfer:buffers});expect(out.sourceGpuMesh!.seeds.byteLength).toBe(0);expect(output(s).sourceGpuMesh!.seeds).toEqual(expected);
 });
 it('keeps capacity, cancellation and saved backend mismatches explicit',()=>{
  expect(()=>read(source({mesh_u_segments:513}))).toThrow('1–512');const s=read();expect(()=>replaySourceSurfaceHost(s,1,'all',()=>true)).toThrow('取消');s.settings.computeBackend='cpu';expect(()=>parseScene(serializeScene(s))).toThrow('后端');
 });
});
