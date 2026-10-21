import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {serializeScene,parseScene} from '../src/engine/document';
import {sceneAtTime,resolveTimeline} from '../src/engine/timeline';
import {clearSourceSymmetryTimelineCache,replaySourceSymmetryTimeline,sourceSymmetryParameterFrame} from '../src/engine/sourceSymmetryTimeline';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {SOURCE_SYMMETRY_PARAMETER_MODEL as model} from '../src/engine/sourceRegistryParameterConfig';
import {RegistryParameterActionsEditor} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {parameterTimelineReferences} from '../src/engine/sceneParameters';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
const raw=(timeline:unknown[])=>({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Parameter integration',parameters:{lambda:.25,alpha:2,beta:.2,gamma:.1,omega:0,symmetry_degree:5,delta:.5,delta_power:3},settings:{batch_size:8,burn_in_steps:0},timeline});
const read=(timeline:unknown[])=>{const scene=parseProjectFile(JSON.stringify(raw(timeline))).scene;scene.timeline.fps=60;return scene;};
const start=(parameters:unknown)=>({method:'paramStart',args:{parameters}});
const animate=(actions:unknown[],duration=.2)=>({type:'animate',duration,easing:'LINEAR',actions});
afterEach(clearSourceSymmetryTimelineCache);
describe('Symmetry parameters from public project through shared display frames',()=>{
 it('imports ordered named/all operations and preserves their saved form and number provenance',()=>{
  const text=JSON.stringify(raw([animate([start({'a.b':{step:.1,min:9,max:-2},lambda:{}}),{method:'paramStop',args:[{parameters:{lambda:{step:2}}}]},{method:'paramStart',args:[]}])])).replace('"step":0.1','"step":1e-1');
  const scene=parseProjectFile(text).scene,reopened=parseScene(serializeScene(scene)),actions=reopened.timeline.tracks[0].actions!;
  expect(scene.settings.symmetryParameterModel).toBe(model);expect(reopened.timeline).toEqual(scene.timeline);
  expect(actions[0].symmetryParameters!.find(a=>a.scope.kind==='named'&&a.scope.name==='a.b')!.configuration).toMatchObject({step:Math.fround(.1),min:9,max:-2});
  expect(actions[1].symmetryParameters).toEqual([{model,scope:{kind:'named',name:'lambda'}}]);expect(actions[2].symmetryParameters).toEqual([{model,scope:{kind:'all'}}]);
  expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','parameters','a.b','step'],token:'1e-1'});
 });
 it('honors the outer args guard and preserves recognized but ignored numeric fields',()=>{
  const text=JSON.stringify(raw([animate([{method:'paramStart'}, {method:'paramStart',args:0},start({lambda:{enable:false,step:8}}),{method:'paramStart',args:{targetDomain:'FRACTAL',parameters:{lambda:{step:9}}}},start({})])])).replace('"step":8','"step":1e999').replace('"step":9','"step":-1e999');
  const scene=parseScene(serializeScene(parseProjectFile(text).scene));expect(scene.timeline.tracks[0].actions).toHaveLength(1);expect(scene.provenance!.sourceNumberTokens!.filter(x=>x.token.includes('999'))).toHaveLength(2);
 });
 it('writes parameters before GPU field preparation without changing authored construction or seed',()=>{
  const scene=read([animate([start({lambda:{min:.4,max:.4,step:0}}),{method:'gradientStart',args:{speed:60}},{method:'rotatePhi',args:[.5]}])]),before=structuredClone(scene),snapshot=sceneAtTime(scene,.1),job=prepareIteratedFrame(snapshot,.1,6,scene),base=prepareIteratedFrame(scene,0,0,scene);
  expect(snapshot.parameters.lambda).toBe(Math.fround(.4));expect(job.field.parameters.lambda).toBe(Math.fround(.4));expect(job.config.seed).toBe(base.config.seed);expect(job.structuralKey).toBe(base.structuralKey);expect(scene).toEqual(before);
  const full=replaySourceSymmetryTimeline(scene,.1);expect(full.palette.offset).not.toBe(scene.palette.offset);expect(snapshot.evaluatedSourceCamera).toEqual(full.frame);expect(snapshot.parameters).toEqual(full.parameters!.values);
 });
 it('keeps updating through waits and completed queues, and reconstructs cold/warm/backward values identically',()=>{
  const scene=read([animate([start({lambda:{step:.003,min:-1,max:1,edgeEasing:{floor:1}}})],.1),{type:'wait',duration:.1}]);
  scene.timeline.duration=1;
  const frames=Array.from({length:18},(_,i)=>sceneAtTime(scene,i/scene.timeline.fps));
  expect(frames[7].parameters.lambda).not.toBe(frames[5].parameters.lambda);expect(frames[17].parameters.lambda).toBeGreaterThan(frames[15].parameters.lambda);
  for(const i of [15,0,3,16,1]){const warm=sceneAtTime(scene,i/scene.timeline.fps);expect(warm.parameters).toEqual(frames[i].parameters);clearSourceSymmetryTimelineCache();expect(sceneAtTime(scene,i/scene.timeline.fps).parameters).toEqual(frames[i].parameters);}
 });
 it('acknowledges all double parameters at the native threshold, including sub-Float32 writes and unused names',()=>{
  const scene=read([animate([start({lambda:{step:8e-10,min:-1,max:1,edgeEasing:{floor:1}}})],0),{type:'wait',duration:1}]);
  const frames=Array.from({length:6},(_,i)=>{const s=sceneAtTime(scene,i/scene.timeline.fps);return {s,f:sourceSymmetryParameterFrame(s)!};});
  expect(frames.map(x=>x.f.changed)).toEqual([true,true,true,true,true,true]);
  expect(new Set(frames.map(x=>Math.fround(x.s.parameters.lambda))).size).toBe(1);expect(frames[2].s.parameters.lambda).not.toBe(frames[0].s.parameters.lambda);
  const extra=read([animate([start({'unused.name':{min:.5,max:.5}})])]);expect(sourceSymmetryParameterFrame(sceneAtTime(extra,0))!.values['unused.name']).toBe(.5);
 });
 it('preserves old unmarked documents and rejects foreign/mixed/missing parameter models',()=>{
  const scene=read([animate([start({lambda:{}})])]);const old=structuredClone(scene);delete old.settings.symmetryParameterModel;old.timeline.tracks[0].actions=[];
  expect(parseScene(serializeScene(old)).settings.symmetryParameterModel).toBeUndefined();expect(sourceSymmetryParameterFrame(sceneAtTime(old,.1))).toBeUndefined();
  for(const mutate of [(s:typeof scene)=>{delete s.settings.symmetryParameterModel;},(s:typeof scene)=>{s.timeline.tracks[0].actions![0].parameters=[];},(s:typeof scene)=>{delete s.timeline.tracks[0].actions![0].symmetryParameters;},(s:typeof scene)=>{s.settings.symmetryParameterModel='unknown';}]){const bad=structuredClone(scene);mutate(bad);expect(()=>parseScene(serializeScene(bad))).toThrow();}
 });
 it('keeps negative child duration while clamping the native parameter group duration',()=>{
  const scene=read([animate([start({lambda:{min:.5,max:.5}})],-1),{type:'wait',duration:.1}]);
  expect(scene.timeline.tracks[0].duration).toBe(-1);expect(resolveTimeline(scene).tracks[0].duration).toBe(1/scene.timeline.fps);expect(sceneAtTime(scene,0).parameters.lambda).toBe(.5);
 });
 it('registers only valid Symmetry action numeric paths, not Surface global or standalone fields',()=>{
  for(const path of [['timeline','0','actions','0','args','0','parameters','a.b','step'],['timeline','0','actions','0','args','edgeEasing','floor']])expect(parseSourceNumberTokens([{path,token:'-0'}],'symmetry')).toEqual([{path,token:'-0'}]);
  for(const path of [['timeline','0','actions','0','args','1','parameters','a','step'],['timeline','0','parameters','a','step'],['settings','param_edge_easing','floor']])expect(()=>parseSourceNumberTokens([{path,token:'1'}],'symmetry')).toThrow();
 });
 it('retains named references for deletion checks even when the source action checkbox is false',()=>{
  const scene=read([animate([start({'a.b':{}}),{method:'paramStop',args:{parameters:{lambda:{}}}}])]);scene.timeline.tracks[0].actions![0].enabled=false;
  expect(parameterTimelineReferences(scene)).toEqual([{target:'parameters.a.b',trackId:scene.timeline.tracks[0].id,kind:'value',enabled:true},{target:'parameters.lambda',trackId:scene.timeline.tracks[0].id,kind:'stop',enabled:true}]);
 });
 it('provides the same named/all editor with Symmetry defaults and exact names',()=>{
  const scene=read([animate([start({'a.b':{}})])]),values=scene.timeline.tracks[0].actions![0].symmetryParameters!,before=structuredClone(values);
  const html=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(RegistryParameterActionsEditor,{model,values,method:'paramStart',onChange:()=>{throw Error('render mutation');}})}));
  expect(html).toContain('data-testid="symmetry-parameter-actions"');expect(html).toContain('a.b');expect(html).toContain('Step per frame');expect(html).toContain('value="-1"');expect(values).toEqual(before);
 });
});
