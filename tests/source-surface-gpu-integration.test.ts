import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {replaySourceSurfaceHost} from '../src/engine/sourceSurfaceScene';
import {SourceSurfaceHost} from '../src/engine/sourceSurfaceHost';
import {outputBuffers} from '../src/engine/outputBuffers';

function source(settings:Record<string,unknown>={},timeline:unknown[]=[{type:'wait',duration:2}]){return{config_version:'1.0.0',type:'SURFACE',name:'GPU points',parameters:{a:0},equations:{x:'a+u',y:'v',z:'0'},palette:['#80FF0000','#4000FF00'],settings:{render_mode:'GPU',surface_mode:'POINTS',u_segments:2,v_segments:2,u_min:0,u_max:2,v_min:0,v_max:2,speed_u:1,speed_v:0,scale_x:1,scale_y:1,scale_z:1,show_trails:true,...settings},timeline};}
function read(raw=source()){const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.timeline.fps=4;return scene;}
function output(s:ReturnType<typeof read>,time=0){const out=generateScene(s,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)});if(out.type!=='geometry'||!out.sourceGpuPoints)throw Error('GPU point frame required');return out;}
function host(s=read(),coverage:'all'|'tracked'='all'){return new SourceSurfaceHost({configuration:s.surfaceSource!,equations:s.equations,parameters:s.parameters,palette:s.surfaceSourcePalette,frameRate:4,coverage});}
const request=(index:number)=>({trackId:'track',actionIndex:0,action:{id:'target',method:'track',args:{index}}});

describe('public native GPU point surface',()=>{
 it('preserves canonical backend and initial GPU seeds through save/reopen without CPU positions or trails',()=>{
  const s=read(),reopened=parseScene(serializeScene(s));expect(reopened.surfaceSource).toEqual(s.surfaceSource);expect(reopened.provenance!.original).toEqual(source());
  const out=output(reopened);expect(out.backend).toBe('webgl2');expect(out.positions).toHaveLength(0);expect(out.trails).toBeUndefined();expect(out.stats.generated).toBe(4);
  expect(Array.from(out.sourceGpuPoints!.seeds)).toEqual([0,0,1,0,0,1,1,0,1,0,1,0,1,1,1,0]);expect(out.sourceGpuPoints!.time).toBe(.25);
  expect(out.sourceSurfaceOverlayAlpha).toBeUndefined();expect(out.sourceCameraFrame).toBeDefined();
 });
 it('converts GPU mode transitions to holds before interpreting target and easing',()=>{
  const raw=source({},[{type:'surface_mode_transition',duration:.5,to:{unknown:true},easing:{invalid:true}},{type:'wait',duration:.5}]),s=read(raw);
  expect(s.timeline.tracks[0]).toMatchObject({type:'wait',duration:.5,easing:'linear'});expect(s.provenance!.original).toEqual(raw);
  expect(output(s,.5).sourceGpuPoints!.time).toBe(.75);expect(output(s,10).sourceGpuPoints!.time).toBe(1);
  const invalid=structuredClone(s);invalid.timeline.tracks[0]={...invalid.timeline.tracks[0],type:'surface_mode_transition',surfaceMode:'mesh'};expect(()=>parseScene(serializeScene(invalid))).toThrow('GPU');
 });
 it('replays parameters into GLSL uniforms, preserves static tint under gradient actions, and seeks deterministically',()=>{
  const s=read(source({},[{type:'animate',duration:1,actions:[{method:'paramStart',args:{parameters:{a:{min:2,max:2,step:0}}}},{method:'gradientStart',args:[{mode:'HUE_ROTATE',speed:90}]}]},{type:'wait',duration:1}]));
  const baseline=output(read()),before=output(s,.5);expect(before.sourceGpuPoints!.parameters[0]).toBe(2);expect(before.sourceGpuPoints!.tint).toEqual(baseline.sourceGpuPoints!.tint);
  output(s,1.5);const again=output(parseScene(serializeScene(s)),.5);expect(again.sourceGpuPoints).toEqual(before.sourceGpuPoints);expect(again.sourceCameraFrame).toEqual(before.sourceCameraFrame);
 });
 it('updates only the last setup tracked dot and leaves previous distinct captures frozen',()=>{
  const full=host(),sparse=host(read(),'tracked');
  for(const h of [full,sparse]){
   const first=h.bind(request(0)),last=h.bind(request(3));if(first.kind!=='bound'||last.kind!=='bound')throw Error('binding');
   h.update({frameIndex:0,time:.25,deltaTime:.25});h.displayFrame(0,true);
   expect(first.readPosition()).toEqual([0,0,0]);expect(last.readPosition()).toEqual([1.25,1,0]);
  }
  expect(()=>sparse.snapshot()).toThrow('相机查询');
 });
 it('retains nonfinite unused tracking facts and admits finite GPU regions until the camera consumes an invalid target',()=>{
  const raw=source({speed_u:0});raw.equations.x='1/(u-1)';const s=read(raw);
  expect(output(s).stats.generated).toBe(4);
  const valid=structuredClone(raw);valid.timeline=[{type:'animate',duration:1,actions:[{method:'track',args:[0]}]}] as typeof valid.timeline;
  expect(output(read(valid)).sourceCameraFrame).toBeDefined();
  const invalid=structuredClone(raw);invalid.timeline=[{type:'animate',duration:1,actions:[{method:'track',args:[2]}]}] as typeof invalid.timeline;
  expect(()=>output(read(invalid))).toThrow('tracked[0]');
 });
 it('owns delivered GPU buffers across worker transfer and fresh replay',()=>{
  const s=read(),first=output(s),baseline=first.sourceGpuPoints!.seeds.slice(),buffers=outputBuffers(first);
  expect(buffers).toContain(first.sourceGpuPoints!.seeds.buffer);expect(buffers).toContain(first.sourceGpuPoints!.tint.buffer);expect(buffers).toContain(first.sourceGpuPoints!.parameters.buffer);
  structuredClone(first,{transfer:buffers});expect(first.sourceGpuPoints!.seeds.byteLength).toBe(0);expect(output(s).sourceGpuPoints!.seeds).toEqual(baseline);
 });
 it('preserves explicit errors for cancellation, incompatible saved backend',()=>{
  const s=read();expect(()=>replaySourceSurfaceHost(s,1,'all',()=>true)).toThrow('取消');
  expect(read(source({surface_mode:'MESH'})).surfaceSource!.mode).toBe('mesh');s.settings.computeBackend='cpu';expect(()=>parseScene(serializeScene(s))).toThrow();
 });
 it('rejects inactive GPU switch invocation instead of creating CPU geometry',()=>{expect(()=>host().switchMode('mesh')).toThrow('GPU');});
});
