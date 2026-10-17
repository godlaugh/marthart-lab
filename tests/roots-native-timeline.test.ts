import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {withRootsMathModel,rootMathAnimationTargetEnabled} from '../src/engine/rootsMathConfig';
import {analyzeEquationDraft} from '../src/engine/equationEditor';
import {createAnimationTrack,readAnimationValue,sceneAtTime,timelineWarnings} from '../src/engine/timeline';
import {Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {definitions} from '../src/scenes';
import type {AnimationTrack,SceneDocument} from '../src/types';
const local=()=>createScene(definitions.find(d=>d.kind==='roots')!);
const native=()=>withRootsMathModel(local(),'mathart-1.7.8-v1');
const numeric=(target:string,from:number,to:number,id=target):AnimationTrack=>({id,type:'numeric',target,from,to,start:0,duration:2,easing:'linear',enabled:true,pingPong:false});
const range=(target:string)=>({target,min:-2,max:2,step:.1,enabled:true});
function timeline(scene:SceneDocument,tracks:AnimationTrack[]){return {...scene,timeline:{...scene.timeline,duration:5,tracks}};}
describe('Roots source math authoring and timeline applicability',()=>{
 it('does not compile dormant local formulas or parameter definitions in the equation editor',()=>{
  const source=native();source.settings.rootParameters='invalid JSON';source.equations.polynomial='sin(';source.parameters={a:2};
  const before=structuredClone(source),analysis=analyzeEquationDraft(source,source.equations).polynomial;
  expect(analysis.error).toBeUndefined();expect(analysis.suggestions).toEqual([]);expect(analysis.warnings?.join()).toContain('休眠');expect(source).toEqual(before);
  expect(analyzeEquationDraft(withRootsMathModel(source,'local-v1'),source.equations).polynomial.error).toBeDefined();
 });
 it('retains numeric, oscillator and action tracks while their old math targets stay inactive',()=>{
  const source=native();source.parameters={a:8};
  const tracks=[numeric('parameters.a',8,20),numeric('settings.rootIterations',150,200),{...numeric('parameters.a',8,20,'osc'),type:'param' as const,parameterAnimations:[range('parameters.a')]},{...numeric('camera.actions',0,0,'action'),type:'animate' as const,actions:[{id:'start',method:'paramStart',parameters:[range('settings.fixed1Real')]},{id:'stop',method:'paramStop',args:{target:'settings.fixed1Real'}}]}];
  const document=timeline(source,tracks),before=structuredClone(document);
  for(const at of [0,1,4,1]){const frame=sceneAtTime(document,at);expect(frame.parameters).toEqual(source.parameters);expect(frame.settings.rootIterations).toBe(source.settings.rootIterations);expect(frame.settings.fixed1Real).toBe(source.settings.fixed1Real);expect(frame.rootsMath).toEqual(source.rootsMath);}
  expect(document).toEqual(before);expect(timelineWarnings(document).join()).toContain('保留时长但未执行');expect(parseScene(JSON.stringify(persistentScene(document))).timeline).toEqual(document.timeline);
  expect(()=>readAnimationValue(document,'parameters.a')).toThrow('未执行');expect(rootMathAnimationTargetEnabled(document,'settings.seed')).toBe(false);
 });
 it('restores saved local track behavior on explicit local selection',()=>{
  const source=native();source.parameters={a:8};const s=timeline(source,[numeric('parameters.a',8,20)]);
  expect(sceneAtTime(s,1).parameters.a).toBe(8);const restored=withRootsMathModel(s,'local-v1');expect(sceneAtTime(restored,1).parameters.a).toBe(14);expect(restored.timeline).toEqual(s.timeline);
 });
 it('keeps source tone, projection and local replay timing active',()=>{
  const source=native();source.settings.rootSourcePaletteOffset=0;const s=timeline(source,[numeric('settings.rootSourcePaletteOffset',0,2),numeric('settings.rootScale',1,3),numeric('settings.rootSamplesPerFrame',128,256)]);
  const frame=sceneAtTime(s,1);expect(frame.settings.rootSourcePaletteOffset).toBe(1);expect(frame.settings.rootScale).toBe(2);expect(frame.settings.rootSamplesPerFrame).toBe(192);expect(timelineWarnings(s).join()).not.toContain('旧采样与求解');
 });
 it('owns complete mathematical snapshots across cold, warm and changed documents',()=>{
  const source=timeline(native(),[numeric('settings.rootScale',1,3)]),a=sceneAtTime(source,1);
  a.rootsMath!.polynomial.coefficients[0].expression='mutated output';a.rootsMath!.parameters[0].value[0]=99;
  expect(sceneAtTime(source,1).rootsMath).toEqual(source.rootsMath);expect(source.rootsMath!.parameters[0].value[0]).toBe(0);
  source.rootsMath!.polynomial.coefficients[0].expression='123';source.rootsMath!.sampling.seed='9223372036854775807';
  expect(sceneAtTime(source,.5).rootsMath).toEqual(source.rootsMath);expect(sceneAtTime(structuredClone(source),.5).rootsMath).toEqual(source.rootsMath);
  const empty={...source,timeline:{...source.timeline,tracks:[]}},frame=sceneAtTime(empty,1);frame.rootsMath!.sampling.seed='0';expect(empty.rootsMath!.sampling.seed).toBe('9223372036854775807');
 });
 it('does not interpret unresolved label metadata as finite animation values',()=>{
  const source=timeline(native(),[numeric('settings.rootScale',1,3)]);source.rootsMath!.polynomial.variable={sourceValue:Infinity,numberToken:'1e999'};
  const frame=sceneAtTime(source,1);expect(frame.rootsMath!.polynomial.variable).toEqual(source.rootsMath!.polynomial.variable);expect(frame.settings.rootScale).toBe(2);
 });
 it('offers active defaults and displays retained inactive tracks without new choices',()=>{
  const source=native();source.parameters={a:8};source.settings.rootDensityColorVersion='mathart-1.7.8-metric-v1';source.settings.rootsMode='progressive';
  expect(createAnimationTrack(source).target).toBe('settings.rootSourcePaletteOffset');
  const s=timeline(source,[numeric('parameters.a',8,20)]),markup=renderToStaticMarkup(createElement(I18nProvider,{language:'zh',children:createElement(Timeline,{scene:s,time:1,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}})}));
  expect(markup).toContain('相关轨道保留时长但未执行');expect(markup).not.toContain('<option value="parameters.a">');expect(markup).not.toContain('<option value="settings.rootIterations">');expect(s.timeline.tracks[0].target).toBe('parameters.a');
 });
});
