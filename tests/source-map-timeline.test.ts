import {importSourceMapColor} from '../src/engine/sourceMapRuntimeColors';
import {afterEach,describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {SourceIteratedTimelineSession,sourceIterationUpdateEvent,sourceIterationParameterFrame,clearSourceIteratedTimelineCache} from '../src/engine/sourceIteratedTimeline';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
const F=Math.fround;
const start=(parameters:unknown)=>({method:'paramStart',args:{parameters}});
const animate=(actions:unknown[],duration=0)=>({type:'animate',duration,easing:'LINEAR',actions});
function scene(timeline:unknown[]=[],parameters:Record<string,number>={a:.25}){
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map queue',parameters,equations:{x_next:'x+a',y_next:'y',z_next:'0'},settings:{batch_size:8,burn_in_steps:3,iterations_per_frame:2},timeline})).scene;
 s.timeline.fps=60;s.timeline.duration=1;return s;
}
afterEach(clearSourceIteratedTimelineCache);
describe('Map source queue through public documents and evaluated fields',()=>{
 it('imports and round trips ordered operations with original numeric spelling',()=>{
  const input=scene([animate([start({a:{min:-1,max:1,step:.1}}),{method:'paramStop',args:{parameters:{a:{}}}}])]);
  const s=parseScene(serializeScene(input));expect(s.timeline).toEqual(input.timeline);expect(s.settings.mapParameterModel).toBe('map-registry-1.7.8');
  expect(s.timeline.tracks[0].actions![0].mapParameters![0].configuration!.step).toBe(F(.1));
  expect(s.timeline.tracks[0].actions![1].mapParameters![0].scope).toEqual({kind:'named',name:'a'});
  expect(s.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','parameters','a','step'],token:'0.1'});
 });
 it('owns constructor acknowledgement, including zero-update and paused displays',()=>{
  const idle=new SourceIteratedTimelineSession(scene());expect(idle.snapshot().parameters!.changed).toBe(false);
  expect(idle.step(0,{paused:true}).parameters!.changed).toBe(false);expect(idle.display().update.calls).toEqual([]);
  const owner=new SourceIteratedTimelineSession(scene([animate([start({a:{min:.5,max:.5,step:0}})]),{type:'wait',duration:.1}]));
  const replay=owner.step(F(1/60),{acknowledgeParameters:false});expect(replay.parameters!.values.a).toBe(.5);expect(replay.parameters!.changed).toBe(false);
  const pause=owner.step(1,{paused:true});expect(pause.update.calls).toEqual([]);expect(pause.parameters!.changed).toBe(true);
  expect(owner.step(1,{paused:true}).parameters!.changed).toBe(false);expect(owner.step(0).parameters!.changed).toBe(false);
 });
 it('captures distinct parameters for each ordered call without reseeding construction',()=>{
  const input=scene([animate([start({a:{min:-1,max:1,step:.003,edgeEasing:{floor:1}}})]),{type:'wait',duration:.1}]),before=structuredClone(input),base=prepareIteratedFrame(input,0,0,input);
  const evaluated=sceneAtTime(input,2/60),event=sourceIterationUpdateEvent(evaluated)!,job=prepareIteratedFrame(evaluated,2/60,2,input);
  expect(event.calls).toHaveLength(2);expect(event.calls[0].parameters!.a).not.toBe(event.calls[1].parameters!.a);expect(evaluated.parameters).toEqual(event.calls[1].parameters);
  if(job.field.kind!=='map')throw Error('Map field required');expect(job.field.parameters.a).toBe(evaluated.parameters.a);expect(job.config.sourceInitialSeed).toBe(base.config.sourceInitialSeed);expect(job.structuralKey).toBe(base.structuralKey);expect(input).toEqual(before);
  expect(sourceIterationUpdateEvent(sceneAtTime(input,.5))!.calls).toHaveLength(1);
 });
 it('keeps fixed, live, cold, backward and saved reconstruction equivalent',()=>{
  const input=scene([animate([start({a:{min:-1,max:1,step:.003,edgeEasing:{floor:1}}})]),{type:'wait',duration:.1}]),fixed=new SourceIteratedTimelineSession(input),live=new SourceIteratedTimelineSession(input);
  for(let i=0;i<15;i++){const a=fixed.evaluate(i/60),b=live.step(F(1/60));expect({...b,frame:{...b.frame,time:a.frame.time}}).toEqual(a);}
  const expected=sceneAtTime(input,.1);sceneAtTime(input,.5);expect(sceneAtTime(input,.1).parameters).toEqual(expected.parameters);clearSourceIteratedTimelineCache();expect(sceneAtTime(parseScene(serializeScene(input)),.1).parameters).toEqual(expected.parameters);
 });
 it('retains sub-Float32 changes until the double accumulation threshold is crossed',()=>{
  const input=scene([animate([start({a:{min:-1,max:1,step:4e-10,edgeEasing:{floor:1}}})]),{type:'wait',duration:1}]);
  const frames=Array.from({length:8},(_,i)=>sceneAtTime(input,i/60));expect(new Set(frames.map(s=>F(s.parameters.a))).size).toBe(1);
  const changes=frames.map(s=>sourceIterationParameterFrame(s)!.changed);expect(changes).toContain(false);expect(changes).toContain(true);
 });
 it('dispatches reserved color targets independently from same-named formula parameters',()=>{
  const input=scene([animate([start({colorSpeed:{min:10,max:10,step:0},colorPhase:{min:-10,max:-10,step:0}})])],{a:.25,colorSpeed:123,colorPhase:456});
  const owner=new SourceIteratedTimelineSession(input),first=owner.step(F(1/60));expect(first.parameters).toEqual({values:input.parameters,changed:false});expect(first.mapColors).toEqual({colorSpeed:2,colorPhase:0});
  const frame=sceneAtTime(input,0);expect(frame.parameters).toEqual(input.parameters);expect(frame.settings.colorSpeed).toBe(2);expect(frame.settings.colorPhase).toBe(0);
  const job=prepareIteratedFrame(frame,0,0,input);if(job.field.kind!=='map')throw Error('Map field required');expect(job.field.parameters.colorSpeed).toBe(123);expect(job.config.colorSpeed).toBe(2);expect(job.config.colorPhase).toBe(0);
 });
 it('preserves distinct source project and runtime color parsing',()=>{
  const raw={config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Colors',parameters:{a:0},equations:{x_next:'x',y_next:'y'},settings:{batch_size:8,color_speed:'PI/4',color_phase:'PI*50'},timeline:[]};
  const project=parseProjectFile(JSON.stringify(raw)).scene,runtime=parseLegacyScene(JSON.stringify(raw),{sourceEntry:'runtime-config'}).scene;
  expect(project.settings.colorSpeed).toBe(F(.22));expect(project.settings.colorPhase).toBe(180);expect(runtime.settings.colorSpeed).toBe(F(Math.PI/4));expect(runtime.settings.colorPhase).toBe(F(Math.PI*50));
  expect(scene().settings.colorPhase).toBe(180);
  for(const entry of ['project','runtime-config'] as const){expect(importSourceMapColor('colorSpeed',-100,entry)).toEqual({ok:true,value:F(.1)});expect(importSourceMapColor('colorPhase',1e100,entry)).toEqual({ok:true,value:360});expect(importSourceMapColor('colorPhase','NaN',entry).ok).toBe(false);}
  expect(importSourceMapColor('colorSpeed','0x1.8p-1','project')).toEqual({ok:true,value:.75});
 });
 it('includes color initial inputs in timeline cache identity',()=>{
  const input=scene();input.settings.colorSpeed=.2;input.settings.colorPhase=75;expect(sceneAtTime(input,0).settings.colorSpeed).toBe(F(.2));
  const changed=structuredClone(input);changed.settings.colorSpeed=.8;changed.settings.colorPhase=270;expect(sceneAtTime(changed,0).settings.colorSpeed).toBe(F(.8));expect(sceneAtTime(changed,0).settings.colorPhase).toBe(270);
 });
 it('preserves unmarked saved documents and rejects malformed or mixed contracts even with no tracks',()=>{
  const input=scene(),old=structuredClone(input);delete old.settings.mapParameterModel;
  expect(parseScene(serializeScene(old)).settings.mapParameterModel).toBeUndefined();expect(sourceIterationParameterFrame(sceneAtTime(old,0))).toBeUndefined();
  for(const mutate of [(s:typeof input)=>{s.settings.mapParameterModel='unknown';},(s:typeof input)=>{delete s.mapSource;},(s:typeof input)=>{delete s.sourceCamera;}]){const bad=structuredClone(input);mutate(bad);expect(()=>parseScene(serializeScene(bad))).toThrow();}
  const mixed=scene([animate([start({a:{}})])]);mixed.timeline.tracks[0].actions![0].symmetryParameters=[];expect(()=>parseScene(serializeScene(mixed))).toThrow();
 });
});
