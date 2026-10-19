import {describe,expect,it} from 'vitest';
import {SourceSurfaceHost,type SourceSurfaceHostOptions} from '../src/engine/sourceSurfaceHost';
import {importSourceSurfaceMeshConfig} from '../src/engine/sourceSurfaceMeshConfig';
import type {OrdinaryCameraTargetRequest} from '../src/engine/ordinarySourceCameraTimeline';
import {evaluateOrdinarySourceCameraTimeline,resolveOrdinarySourceCameraTimeline} from '../src/engine/ordinarySourceCameraTimeline';
import type {AnimationTrack} from '../src/types';
import {sourceSurfaceTransitionFrame} from '../src/engine/sourceSurfaceTransition';

const F=Math.fround;
function setup(settings:Record<string,unknown>={},overrides:Partial<SourceSurfaceHostOptions>={}){
 const parsed=importSourceSurfaceMeshConfig({surface_mode:'POINTS',u_segments:2,v_segments:2,mesh_u_segments:3,mesh_v_segments:2,u_min:0,u_max:2,v_min:0,v_max:2,scale_x:1,scale_y:1,scale_z:1,speed_u:1,speed_v:0,show_trails:true,mesh_wireframe:false,...settings});
 if(!parsed.ok)throw Error(JSON.stringify(parsed.error));
 const options:SourceSurfaceHostOptions={configuration:parsed.value.configuration,equations:{x:'a+u',y:'v',z:'0'},parameters:{a:0},frameRate:4,coverage:'all',...overrides};
 return{host:new SourceSurfaceHost(options),options};
}
const request=(index:number):OrdinaryCameraTargetRequest=>({trackId:'track',actionIndex:0,action:{id:'target',method:'track',args:{index}}});
function step(host:SourceSurfaceHost,frameIndex:number,final=true,dt=.25){host.update({frameIndex,time:F((frameIndex+1)*.25),deltaTime:dt});host.displayFrame(frameIndex,final);}
function bound(host:SourceSurfaceHost,index:number){const binding=host.bind(request(index));if(binding.kind!=='bound')throw Error('Expected source target');return binding;}
function coordinates(host:SourceSurfaceHost){const snapshot=host.snapshot();if('gpuPoints' in snapshot)throw Error('CPU coordinates expected');return Array.from(snapshot.mode==='mesh'?snapshot.mesh.geometry!.positions:snapshot.points.positions);}

describe('native CPU surface main-object lifecycle',()=>{
 it('changes points → mesh → points and updates each fresh object on its creation frame',()=>{
  const {host,options}=setup(),saved=structuredClone(options.configuration);
  step(host,0);expect(host.snapshot()).toMatchObject({mode:'points',generation:0,frameIndex:0});
  expect(coordinates(host)).toEqual([.25,0,0,.25,1,0,1.25,0,0,1.25,1,0]);
  host.switchMode('mesh');step(host,1);
  expect(host.snapshot()).toMatchObject({mode:'mesh',generation:1,frameIndex:1,mesh:{tracked:{u:F(F(2/3)+.25),v:1}}});
  expect(coordinates(host)).toEqual([0,0,0,1,0,0,2,0,0,0,2,0,1,2,0,2,2,0]);
  host.switchMode('points');step(host,2);
  expect(host.snapshot()).toMatchObject({mode:'points',generation:2,frameIndex:2});
  expect(coordinates(host)).toEqual([.25,0,0,.25,1,0,1.25,0,0,1.25,1,0]);
  const snapshot=host.snapshot();if(!('points' in snapshot))throw Error('points');
  expect(snapshot.points.trails!.records).toBe(4);expect(snapshot.points.trails!.oldestTime).toBe(.75);
  expect(options.configuration).toEqual(saved);
 });
 it('keeps every captured point target frozen at the old object when switching',()=>{
  const {host}=setup(),first=bound(host,0),last=bound(host,3);
  step(host,0);expect(first.readPosition()).toEqual([.25,0,0]);expect(last.readPosition()).toEqual([1.25,1,0]);
  host.switchMode('mesh');step(host,1);step(host,2);
  expect(first.readPosition()).toEqual([.25,0,0]);expect(last.readPosition()).toEqual([1.25,1,0]);
  host.switchMode('points');step(host,3);expect(first.readPosition()).toEqual([.25,0,0]);
 });
 it('owns configuration and runtime choices independently of subsequent caller edits',()=>{
  const {host,options}=setup();options.coverage='tracked';options.frameRate=120;options.configuration.mesh.uSegments=0;options.parameters={a:999};
  step(host,0);host.switchMode('mesh');step(host,1);expect(coordinates(host)[0]).toBe(0);
 });
 it('keeps all mesh bindings on the one initial tracking vector, including after replacement',()=>{
  const {host}=setup({surface_mode:'MESH'}),first=bound(host,0),last=bound(host,5);
  expect(first.readPosition()).toEqual([F(F(2)*F(2/3)),1,0]);expect(last.readPosition()).toEqual(first.readPosition());
  step(host,0);const frozen=first.readPosition();host.switchMode('points');step(host,1);step(host,2);
  expect(first.readPosition()).toEqual(frozen);expect(last.readPosition()).toEqual(frozen);
 });
 it('copies current constants at replacement without carrying the old parameter registry to the new object',()=>{
  const {host}=setup();
  host.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:7,max:7,step:0}}]);host.interpolateParameterActions(1,true);
  step(host,0);expect(coordinates(host)[0]).toBe(7.25);
  host.switchMode('mesh');step(host,1);expect(coordinates(host)[0]).toBe(7);
  // A later action still writes the initial object's registry. It is no longer
  // updated by Scene, so even a fixed-range entry cannot change any constants.
  host.beginParameterActions([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:99,max:99,step:0}}]);host.interpolateParameterActions(1,true);
  step(host,2);expect(coordinates(host)[0]).toBe(7);
  host.switchMode('points');step(host,3);expect(coordinates(host)[0]).toBe(7.25);
 });
 it('keeps subsequent gradient and trail actions on the retired initial object',()=>{
  const {host}=setup();step(host,0);host.switchMode('mesh');step(host,1);const before=host.snapshot();
  host.beginGradientActions([{kind:'start',config:{mode:'cross_fade',interpolation:'oklab',speed:90}}]);host.interpolateGradientActions(1,true);
  host.setRecordingTrails(false);step(host,2);const after=host.snapshot();
  if(before.mode!=='mesh'||after.mode!=='mesh')throw Error('mesh');
  expect(after.mesh.gradient).toEqual(before.mesh.gradient);expect(after.mesh.packedColors).toEqual(before.mesh.packedColors);
  host.switchMode('points');step(host,3);const points=host.snapshot();if(!('points' in points))throw Error('points');
  expect(points.points.trails!.records).toBe(4);
 });
 it('same-mode requests retain particle history and object generation',()=>{
  const {host}=setup();step(host,0);host.switchMode('points');step(host,1);
  const frame=host.snapshot();expect(frame.generation).toBe(0);expect(coordinates(host)[0]).toBe(.5);
  if(!('points' in frame))throw Error('points');expect(frame.points.trails!.records).toBe(8);
 });
 it('runs the same tracked recurrence for camera-only queries across both directions',()=>{
  const full=setup().host,tracked=setup({}, {coverage:'tracked'}).host;
  const a=bound(full,3),b=bound(tracked,3);
  for(let i=0;i<5;i++){if(i===1){full.switchMode('mesh');tracked.switchMode('mesh');}if(i===3){full.switchMode('points');tracked.switchMode('points');}step(full,i);step(tracked,i);expect(b.readPosition()).toEqual(a.readPosition());}
  expect(()=>tracked.snapshot()).toThrow('相机查询不能交付');
 });
 it('does not publish intermediate mesh buffers or mutate previously delivered frames',()=>{
  const {host}=setup({surface_mode:'MESH'});step(host,0);const old=host.snapshot();if(old.mode!=='mesh')throw Error('mesh');
  old.mesh.geometry!.positions.fill(999);host.switchMode('points');step(host,1);host.switchMode('mesh');step(host,2,false);
  step(host,3,true);expect(coordinates(host)[0]).toBe(0);expect(old.mesh.geometry!.positions[0]).toBe(999);
 });
 it('preserves the global scene time after queue completion without continuing object updates',()=>{
  const {host}=setup();step(host,0);host.switchMode('mesh');step(host,1);const before=host.snapshot();
  host.displayFrame(2,true);const after=host.snapshot();if(before.mode!=='mesh'||after.mode!=='mesh')throw Error('mesh');
  expect(after.mesh.animationTime).toBe(before.mesh.animationTime);expect(after.mesh.tracked).toEqual(before.mesh.tracked);
 });
 it('defers inactive point capacity admission until switching and fails without a partial publication',()=>{
  const {host}=setup({surface_mode:'MESH',u_segments:0});step(host,0);host.switchMode('mesh');
  expect(()=>host.switchMode('points')).toThrow('1–512');expect(host.mode).toBe('mesh');expect(host.generation).toBe(0);
  expect(()=>host.snapshot()).toThrow('1–512');
 });
 it('rejects switching after the object update and rejects binding after construction',()=>{
  const one=setup().host;one.update({frameIndex:0,time:.25,deltaTime:.25});expect(()=>one.switchMode('mesh')).toThrow('先于');
  const two=setup().host;step(two,0);expect(()=>two.bind(request(0))).toThrow('首次运行前');
 });
 it('aggregates work across replacements and preserves cancellation as a terminal failure',()=>{
  const {host}=setup({u_segments:32,v_segments:32,mesh_u_segments:32,mesh_v_segments:32});
  let exhausted=false;
  for(let i=0;i<1000;i++){try{host.switchMode(i%2?'mesh':'points');step(host,i);}catch(error){expect(String(error)).toContain('累计超过');exhausted=true;break;}}
  expect(exhausted).toBe(true);expect(host.workUnits).toBeGreaterThan(20_000_000);
  let cancelled=false;const other=setup({}, {isCancelled:()=>cancelled}).host;step(other,0);cancelled=true;
  expect(()=>other.switchMode('mesh')).toThrow('取消');cancelled=false;expect(()=>other.snapshot()).toThrow('取消');
 });
});

const camera={phi:0,theta:0,gamma:0,zoom:1,focalDistance:250,center:[0,0,0] as [number,number,number]};
function clip(id:string,fields:Partial<AnimationTrack>):AnimationTrack{return{id,type:'wait',target:'surface',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false,...fields};}
function replay(tracks:AnimationTrack[],time:number,settings:Record<string,unknown>={}){
 const {host}=setup(settings);
 const frame=evaluateOrdinarySourceCameraTimeline(camera,tracks,4,time,{particleActions:'surface',surfaceMode:host.mode,createParticles:()=>host});
 return{frame,host,snapshot:host.snapshot()};
}
describe('source surface transition in the scene queue',()=>{
 it('fades in two independent phases, switches at equality, and clears the overlay on finish',()=>{
  const tracks=[clip('transition',{type:'surface_mode_transition',surfaceMode:'mesh'})];
  const rows=[0,.25,.5,.75,1].map(t=>replay(tracks,t));
  expect(rows.map(r=>r.frame.surfaceTransition)).toEqual([{mode:'points',overlayAlpha:128},{mode:'mesh',overlayAlpha:255},{mode:'mesh',overlayAlpha:128},{mode:'mesh',overlayAlpha:0},{mode:'mesh',overlayAlpha:0}]);
  expect(rows.map(r=>r.host.generation)).toEqual([0,1,1,1,1]);
  expect(rows[1].snapshot.mode).toBe('mesh');if(rows[1].snapshot.mode==='mesh')expect(rows[1].snapshot.mesh.animationTime).toBe(.5);
 });
 it('restores the camera snapshot at the switch while the original bound target remains captured',()=>{
  const tracks=[clip('camera',{type:'animate',duration:.5,actions:[{id:'ambient',method:'ambient',args:{phiSpeed:1,thetaSpeed:0,gammaSpeed:0}},{id:'track',method:'track',args:{index:0}}]}),clip('switch',{type:'surface_mode_transition',surfaceMode:'mesh'}),clip('track-again',{type:'animate',duration:.5,actions:[{id:'again',method:'track',args:{index:0}}]})];
  const before=replay(tracks,.5),at=replay(tracks,.75),after=replay(tracks,1.75);
  expect(before.frame.camera.phi).toBe(.625);expect(at.frame.camera.phi).toBe(.625);
  expect(before.frame.camera.center).toEqual([.75,0,0]);expect(at.frame.camera.center).toEqual([.75,0,0]);expect(after.frame.camera.center).toEqual([.75,0,0]);
  expect(at.frame.surfaceTransition).toEqual({mode:'mesh',overlayAlpha:255});
 });
 it('finishes same-mode requests in one update but keeps their source duration in the active-dt fold',()=>{
  const tracks=[clip('same',{type:'surface_mode_transition',surfaceMode:'points',duration:.1})],result=replay(tracks,0);
  expect(result.frame.queueComplete).toBe(true);expect(result.frame.sceneTime).toBe(F(.1));expect(result.host.generation).toBe(0);expect(coordinates(result.host)[0]).toBe(F(.1));
  const layout=resolveOrdinarySourceCameraTimeline(camera,tracks,4,{particleActions:'surface',surfaceMode:'points'});
  expect(layout.clips[0]).toMatchObject({start:0,duration:.25,sourceDuration:F(.1)});
  const different=resolveOrdinarySourceCameraTimeline(camera,[{...tracks[0],duration:2}],4,{particleActions:'surface',surfaceMode:'mesh'});
  const same=resolveOrdinarySourceCameraTimeline(camera,[{...tracks[0],duration:2}],4,{particleActions:'surface',surfaceMode:'points'});
  expect(different.span).toBe(2);expect(same.span).toBe(.25);
  expect(replay([{...tracks[0],duration:.00001}],0).frame.sceneTime).toBe(F(.0001));
 });
 it('keeps repeat switches, layout and backward seeks deterministic',()=>{
  const tracks=[clip('to-mesh',{type:'surface_mode_transition',surfaceMode:'mesh'}),clip('same',{type:'surface_mode_transition',surfaceMode:'mesh',duration:9}),clip('to-points',{type:'surface_mode_transition',surfaceMode:'points',duration:.5}),clip('wait',{duration:.5})];
  const layout=resolveOrdinarySourceCameraTimeline(camera,tracks,4,{particleActions:'surface',surfaceMode:'points'});
  expect(layout.clips.map(c=>[c.start,c.duration])).toEqual([[0,1],[1,.25],[1.25,.5],[1.75,.5]]);
  const at=replay(tracks,1.5);expect(at.host.generation).toBe(2);expect(at.snapshot.mode).toBe('points');
  replay(tracks,3);expect(replay(tracks,1.5).snapshot).toEqual(at.snapshot);
 });
 it('applies easing within each phase without moving the switch threshold',()=>{
  expect(sourceSurfaceTransitionFrame(.125,.25,'quad-in')).toEqual({switchMode:false,overlayAlpha:64});
  expect(sourceSurfaceTransitionFrame(.25,.25,'quad-in')).toEqual({switchMode:true,overlayAlpha:255});
  expect(sourceSurfaceTransitionFrame(.625,.25,'quad-in')).toEqual({switchMode:true,overlayAlpha:191});
  expect(sourceSurfaceTransitionFrame(.025,-1,'linear')).toEqual({switchMode:false,overlayAlpha:128});
  expect(sourceSurfaceTransitionFrame(F(.95),2,'linear')).toEqual({switchMode:true,overlayAlpha:255});
 });
 it('requires a host for mode transitions and validates source ratios',()=>{
  const tracks=[clip('switch',{type:'surface_mode_transition',surfaceMode:'mesh'})];
  expect(()=>evaluateOrdinarySourceCameraTimeline(camera,tracks,4,0,{particleActions:'surface',surfaceMode:'points'})).toThrow('主对象宿主');
  expect(()=>replay([{...tracks[0],surfaceFadeOutRatio:NaN}],0)).toThrow('淡出比例');
 });
});
