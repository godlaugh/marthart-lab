import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {sceneAtTime} from '../src/engine/timeline';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {replaySourceSurfaceHost} from '../src/engine/sourceSurfaceScene';
import {outputBuffers} from '../src/engine/outputBuffers';
import {supportsParticleTracking} from '../src/engine/sceneCamera';
function scene(){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Mesh replay',equations:{x:'u',y:'v',z:'u+v'},settings:{surface_mode:'MESH',mesh_u_segments:3,mesh_v_segments:5,u_min:0,u_max:6,v_min:0,v_max:10,speed_u:2,speed_v:-1,scale_x:1,scale_y:1,scale_z:1,background_color:'#804080C0'},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'track',args:[7]}]}]})).scene;
 s.timeline.fps=4;return s;
}
const output=(s:ReturnType<typeof scene>,time:number)=>{
 const out=generateScene(s,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)});
 if(out.type!=='geometry')throw Error('geometry required');return out;
};
describe('public source mesh replay and publication',()=>{
 it('keeps inclusive rendered grid separate from the moving tracked particle across reverse seeks',()=>{
  const s=parseScene(serializeScene(scene()));expect(supportsParticleTracking(s)).toBe(true);
  let original:Float32Array|undefined;
  for(const time of [.25,1,0,.25]){
   const out=output(s,time);expect(out.topology).toBe('mesh');expect(out.sourceMeshWireframe?.mode).toBe('coupled');
   expect(out.sourceSurfaceBackgroundColor).toBe(0x804080c0);expect(out.positions.length).toBe(45);
   expect(Array.from(out.positions.slice(0,9))).toEqual([0,0,0,3,0,3,6,0,6]);
   if(original)expect(out.positions).toEqual(original);original=out.positions.slice();
   expect(out.sourceCameraFrame?.camera.center).toEqual(time===0?[1,2,3]:[3,3.5,6.5]);
   expect(sceneAtTime(s,time).evaluatedSourceCamera?.camera).toEqual(out.sourceCameraFrame?.camera);
  }
 });
 it('does not reuse detached published buffers or mutate authored canonical settings',()=>{
  const s=scene(),saved=serializeScene(s),a=output(s,.25),expected=a.positions.slice();
  structuredClone(a,{transfer:outputBuffers(a)});expect(a.positions.byteLength).toBe(0);
  expect(output(s,.25).positions).toEqual(expected);expect(serializeScene(s)).toBe(saved);
  const evaluated=sceneAtTime(s,0);evaluated.surfaceSource!.domain.uMax=77;expect(s.surfaceSource!.domain.uMax).toBe(6);
 });
 it('includes canonical configuration in authoring and replay identities',()=>{
  const s=scene(),before=output(s,0);s.surfaceSource!.transform.offsetX=10;
  const after=output(s,0);expect(after.positions[0]).toBe(before.positions[0]+10);
  expect(sceneAtTime(s,0).evaluatedSourceCamera?.camera).toEqual(after.sourceCameraFrame?.camera);
  s.surfaceSource!.domain.uMin=-0;expect(Object.is(sceneAtTime(s,0).surfaceSource!.domain.uMin,-0)).toBe(true);
  s.surfaceSource!.domain.uMin=0;expect(Object.is(sceneAtTime(s,0).surfaceSource!.domain.uMin,-0)).toBe(false);
 });
 it('does not interpret unused local trail settings as source mesh configuration',()=>{
  const s=scene();s.settings.trailWidth=-99;
  const restored=parseScene(serializeScene(s));expect(restored.settings.trailWidth).toBe(-99);
  expect(output(restored,0).positions).toEqual(output(scene(),0).positions);
 });
 it('publishes final static display after the queue stops without copying intermediate frames',()=>{
  const s=scene();s.surfaceSource!.mesh.uSegments=60;s.surfaceSource!.mesh.vSegments=60;
  const long=replaySourceSurfaceHost(s,10,'all'),early=replaySourceSurfaceHost(s,1,'all');
  expect((long.host.snapshot() as {mesh:{geometry?:{positions:Float32Array}}}).mesh.geometry?.positions).toEqual((early.host.snapshot() as {mesh:{geometry?:{positions:Float32Array}}}).mesh.geometry?.positions);
  expect(long.host.snapshot().frameIndex).toBe(40);expect(long.host.snapshot().workUnits).toBeLessThan(20_000_000);
  const tracked=replaySourceSurfaceHost(s,10,'tracked');expect(tracked.frame.camera).toEqual(long.frame.camera);
  expect(()=>tracked.host.snapshot()).toThrow('相机查询');
 });
 it('supports line-only decoupled rendering with an explicit empty fill and admits one-sample axes',()=>{
  const s=scene();Object.assign(s.surfaceSource!.mesh,{fillEnabled:false,wireframeDecoupled:true,wireframeUSegments:1,wireframeVSegments:2});
  const out=output(s,0);expect(out.positions.length).toBe(0);expect(out.indices!.length).toBe(0);expect(out.sourceMeshColors!.length).toBe(0);
  expect(out.sourceMeshWireframe?.mode).toBe('decoupled');expect(out.sourceMeshWireframe!.positions.length).toBeGreaterThan(0);
  Object.assign(s.surfaceSource!.mesh,{uSegments:1,vSegments:1,wireframeDecoupled:false});expect(output(s,0).indices!.length).toBe(0);
 });
 it('checks cancellation before publishing an output',()=>{
  const s=scene();expect(()=>generateScene(s,{time:1,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64),isCancelled:()=>true})).toThrow(/取消/);
 });
});
