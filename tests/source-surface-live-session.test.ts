import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {describe,expect,it} from 'vitest';
import type {GenerateContext,SceneOutput} from '../src/types';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSurfaceLiveSession,type SourceSurfaceLiveContext} from '../src/engine/sourceSurfaceLiveSession';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {generateSourceSurface} from '../src/scenes/sourceSurface';
import {outputBuffers} from '../src/engine/outputBuffers';
import {snapshotGenerationInput} from '../src/engine/generationInput';

function scene(backend='CPU',mode='POINTS',count=3){
 return parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Live surface',equations:{x:'a+u',y:'v',z:'0'},parameters:{a:.25},settings:{render_mode:backend,surface_mode:mode,u_segments:count,v_segments:count,mesh_u_segments:count,mesh_v_segments:count,u_min:0,u_max:1,v_min:0,v_max:1,scale_x:1,scale_y:1,scale_z:1,speed_u:0,speed_v:0,show_trails:false,mesh_wireframe:false},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.1}}}}]},{type:'wait',duration:59}]})).scene;
}
const viewport=ordinarySourceViewport(scene(),64,48,'primary',48);
function context(timestampMs=1000,overrides:Partial<SourceSurfaceLiveContext>={}):GenerateContext{return{time:999,quality:'preview',width:64,height:48,sourceViewport:viewport,surfaceLive:{sessionId:'surface',revision:0,clock:{paused:false,timestampMs},actualFrameRate:37,...overrides}};}
function geometry(out:SceneOutput){if(out.type!=='geometry')throw Error('geometry');return out;}
function value(out:SceneOutput){const o=geometry(out);return o.sourceGpuPoints?.parameters[0]??o.sourceGpuMesh?.parameters[0]??o.positions[0];}
function comparable(out:SceneOutput){const {surfaceLive:_live,stats,...rest}=geometry(out);return{...rest,stats:{...stats,elapsedMs:0}};}

describe('retained Surface generation boundary',()=>{
 for(const backend of ['CPU','GPU'])for(const mode of ['POINTS','MESH']){
  it(`${backend} ${mode} retains one producer and survives transferred buffers, pause and resume`,()=>{
   const s=scene(backend,mode),owner=new SourceSurfaceLiveSession();
   const first=geometry(owner.generate(s,context())),moving=geometry(owner.generate(s,context(1250)));
   expect(first.surfaceLive?.frame.sceneTime).toBe(0);expect(moving.surfaceLive?.frame.sceneTime).toBe(.25);expect(value(moving)).not.toBe(value(first));
   const saved=structuredClone(comparable(moving));structuredClone(moving,{transfer:outputBuffers(moving)});
   const current=geometry(owner.current(s,context(1250)));expect(comparable(current)).toEqual(saved);expect(current.surfaceLive?.frame.frameIndex).toBe(1);
   structuredClone(current,{transfer:outputBuffers(current)});
   owner.setPaused(true);const pausedContext=context(9000,{clock:{paused:true,timestampMs:9000}}),paused=geometry(owner.generate(s,pausedContext));
   expect(paused.surfaceLive).toMatchObject({paused:true,renderKind:'snapshot',constructions:1,frame:{frameIndex:1,sceneTime:.25}});expect(comparable(paused)).toEqual(saved);
   const again=geometry(owner.current(s,pausedContext));expect(comparable(again)).toEqual(saved);
   owner.setPaused(false,10000);const resumed=geometry(owner.generate(s,context(10250)));
   expect(resumed.surfaceLive).toMatchObject({constructions:1,frame:{frameIndex:2,sceneTime:.5,rawDt:.25}});expect(value(resumed)).not.toBe(value(again));
  });
  it(`${backend} ${mode} preserves fixed geometry and resumes from reconstructed scene time`,()=>{
   const s=scene(backend,mode),owner=new SourceSurfaceLiveSession(),c=context(0,{clock:{paused:true},startAt:.3});
   const actual=owner.generate(s,c),expected=generateSourceSurface(s,{...c,time:.3,surfaceLive:undefined});
   // Fixed replay labels a request at .3, while a live snapshot labels the
   // actual state after its ten Float32 updates. Geometry/camera stay exact.
   const fixed=geometry(expected),time=geometry(actual).surfaceLive!.frame.sceneTime;
   fixed.sourceCameraFrame!.time=time;fixed.temporal!.time=time;fixed.temporal!.windowStart=time;
   expect(comparable(actual)).toEqual(comparable(fixed));expect(owner.diagnostics().constructions).toBe(1);
  });
 }
 for(const backend of ['CPU','GPU'])for(const mode of ['POINTS','MESH'])it(`${backend} ${mode} edits the current function without rebuilding or advancing a paused session`,()=>{
  const s=scene(backend,mode),owner=new SourceSurfaceLiveSession(),c=context(0,{clock:{paused:true,timestampMs:0}});
  const before=geometry(owner.generate(s,c));
  owner.updateParameter(s,c,'a',.75);
  const changed=geometry(owner.current(s,c));
  expect(changed.surfaceLive?.frame).toEqual(before.surfaceLive?.frame);expect(changed.surfaceLive?.constructions).toBe(1);
  expect(value(changed)).toBe(backend==='CPU'&&mode==='POINTS'?.25:.75);
  expect(s.parameters.a).toBe(.25);
  owner.updateParameter(s,c,'undeclared',99);expect(value(owner.current(s,c))).toBe(value(changed));
  for(const value of [NaN,Infinity,-Infinity])expect(()=>owner.updateParameter(s,c,'a',value)).toThrow('有限数值');
  expect(()=>owner.updateParameter(s,{...c,surfaceLive:{...c.surfaceLive!,revision:99}},'a',.9)).toThrow('匹配');
  expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  owner.setPaused(false,1000);owner.generate(s,context(1000));
  const resumed=geometry(owner.generate(s,context(1250)));
  expect(resumed.surfaceLive?.constructions).toBe(1);expect(value(resumed)).not.toBe(value(changed));
 });
 for(const backend of ['CPU','GPU'])for(const mode of ['POINTS','MESH'])it(`${backend} ${mode} prepares current capture without replay and retains transferable primary buffers`,()=>{
  const s=scene(backend,mode),owner=new SourceSurfaceLiveSession(),c={...context(0,{clock:{paused:true}}),sourcePointPixelDensity:2};
  const before=geometry(owner.generate(s,c));owner.updateParameter(s,c,'a',.75);
  const capture=owner.capturePaused(s,c,{width:127,height:95},3);
  expect(capture.capture.surfaceLive?.frame).toEqual(before.surfaceLive?.frame);expect(capture.preview.surfaceLive?.frame).toEqual(before.surfaceLive?.frame);
  expect(capture.capture.sourceCameraFrame?.viewport).toMatchObject({target:'offscreen',logicalWidth:64,logicalHeight:48,referenceLogicalHeight:48});
  expect(capture.preview.sourceCameraFrame?.viewport.target).toBe('primary');
  expect(value(capture.capture)).toBe(backend==='CPU'&&mode==='POINTS'?.25:.75);expect(capture.scene.parameters.a).toBe(.25);
  const saved=structuredClone(comparable(capture.preview));structuredClone(capture,{transfer:[...outputBuffers(capture.capture),...outputBuffers(capture.preview)]});
  expect(comparable(owner.current(s,c))).toEqual(saved);expect(owner.diagnostics().constructions).toBe(1);
  expect(()=>owner.capturePaused(s,c,{width:20000,height:20000},1)).toThrow();expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>owner.capturePaused(s,c,{width:64,height:48},2 as never)).toThrow('倍率');expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
 });
 it('captures a full revision, ignores staged edits and replaces it only at an explicit new revision',()=>{
  const s=scene(),captured=structuredClone(s),draft=structuredClone(s);draft.equations.x='(';
  const owner=new SourceSurfaceLiveSession(),c=context(0,{configuration:captured,clock:{paused:true}});
  expect(value(owner.generate(draft,c))).toBe(.25);captured.parameters.a=99;
  expect(value(owner.generate(draft,context(0,{clock:{paused:true}})))).toBe(.25);
  const applied=structuredClone(s);applied.parameters.a=.75;
  expect(value(owner.generate(applied,context(0,{revision:1,configuration:applied,clock:{paused:true}})))).toBe(.75);
  expect(owner.diagnostics().constructions).toBe(2);
 });
 it('rejects stale controls and invalid observations without consuming the valid owner',()=>{
  const s=scene(),owner=new SourceSurfaceLiveSession(),c=context();owner.generate(s,c);
  expect(()=>owner.generate(s,context(1250,{clock:{paused:true}}))).toThrow('setPaused');
  expect(()=>owner.generate(s,context(1250,{actualFrameRate:NaN}))).toThrow('有限 Float32');
  expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  expect(()=>owner.current(s,context(1000,{revision:3}))).toThrow('匹配');
  expect(geometry(owner.generate(s,context(1250))).surfaceLive?.frame.sceneTime).toBe(.25);
 });
 it('keeps a partially failed owner unusable until an explicit new revision',()=>{
  const s=scene(),owner=new SourceSurfaceLiveSession();owner.generate(s,context());let checks=0;
  expect(()=>owner.generate(s,{...context(1250),isCancelled:()=>++checks>3})).toThrow('取消');
  expect(owner.diagnostics().failed).toBe(true);
  expect(()=>owner.generate(s,context(1500))).toThrow('新会话或配置版本');
  expect(geometry(owner.generate(s,context(1500,{revision:1}))).surfaceLive?.frame.sceneTime).toBe(0);
 });
 it('bounds complete requests without spending a lifetime replay budget during normal playback',()=>{
  const s=scene('CPU','POINTS',48),owner=new SourceSurfaceLiveSession();s.timeline.fps=30;
  expect(()=>generateSourceSurface(s,{...context(),time:40,surfaceLive:undefined})).toThrow('2000 万');
  for(let i=0;i<=400;i++)owner.generate(s,context(1000+i*100));
  expect(owner.diagnostics()).toMatchObject({failed:false,constructions:1,frame:{frameIndex:400}});
  // A large single seek still shares one budget; it is not split into free frames.
  expect(()=>owner.generate(s,context(0,{revision:1,startAt:40}))).toThrow('2000 万');
 });
 it('uses the normal generation owner and releases live state when leaving it',()=>{
  const s=scene(),owner=new TemporalGenerationSession();
  generateScene(s,context(),owner);const moved=geometry(generateScene(s,context(1250),owner));expect(moved.surfaceLive?.constructions).toBe(1);
  generateScene(s,{...context(),time:0,surfaceLive:undefined},owner);
  const fresh=geometry(generateScene(s,context(2000),owner));expect(fresh.surfaceLive?.frame.sceneTime).toBe(0);expect(fresh.surfaceLive?.constructions).toBe(1);
 });
 it('copies all explicit live inputs at the transport boundary',()=>{
  const c=context(1234,{configuration:scene(),startAt:.5}),saved=snapshotGenerationInput(c);c.surfaceLive!.configuration!.parameters.a=9;c.surfaceLive!.clock.timestampMs=1;
  expect(saved.surfaceLive?.configuration?.parameters.a).toBe(.25);expect(saved.surfaceLive?.clock.timestampMs).toBe(1234);expect(saved.surfaceLive?.startAt).toBe(.5);
 });
});
