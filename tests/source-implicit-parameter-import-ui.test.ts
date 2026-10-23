import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import native from './fixtures/source-implicit-presentation/parameters.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {serializeScene,parseScene} from '../src/engine/document';
import {SOURCE_IMPLICIT_PARAMETER_MODEL as model,SOURCE_SURFACE_PARAMETER_DEFAULT} from '../src/engine/sourceRegistryParameterConfig';
import {RegistryParameterActionsEditor,registryParameterActionsForMethod,Timeline} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {parameterTimelineReferences} from '../src/engine/sceneParameters';
import {createAnimationTrack} from '../src/engine/timeline';
const source=(actions:unknown[],settings={})=>({...structuredClone(native.cases[0].input.project),settings:{...native.cases[0].input.project.settings,...settings},timeline:[{type:'animate',duration:1,actions}]});
const read=(actions:unknown[],settings={})=>parseProjectFile(JSON.stringify(source(actions,settings))).scene;
const render=(children:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children}));
describe('Implicit source parameter import, persistence and editing',()=>{
 it('preserves exact scalar evidence through save/load and resolves inheritance once',()=>{
  const scene=read([{method:'paramStart',args:[{edgeEasing:{window:.2},parameters:{a:{min:.1,max:'a+1',step:.03,edgeEasing:{floor:.7}}}}]}],{param_edge_easing:{window:.4,floor:.5,easing:'LINEAR'}});
  expect(scene.timeline.tracks[0].actions![0].implicitParameters).toEqual([{model,scope:{kind:'named',name:'a'},configuration:{min:Math.fround(.1),max:2,step:Math.fround(.03),edgeEasing:{window:.2,floor:.7,easing:'linear'}}}]);
  const reopened=parseScene(serializeScene(scene));expect(reopened.timeline).toEqual(scene.timeline);expect(reopened.provenance!.sourceNumberTokens).toEqual(scene.provenance!.sourceNumberTokens);
  expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','0','parameters','a','step'],token:'0.03'});
 });
 it('skips absent/primitive args and disabled children; only exact FRACTAL domain excludes actions',()=>{
  const scene=read([{method:'paramStart'},{method:'paramStart',args:4},{method:'paramStart',args:{parameters:{a:{enable:false,step:null},b:4}}},{method:'paramStart',args:{targetDomain:'fractal',parameters:{a:{}}}},{method:'paramStart',enabled:false,args:{targetDomain:' FRACTAL ',parameters:{a:{}}}},{method:'paramStart',args:{a:{min:1}}}]);
  const actions=scene.timeline.tracks[0].actions!;expect(actions).toHaveLength(2);expect(actions[0].implicitParameters).toEqual([{model,scope:{kind:'named',name:'a'},configuration:SOURCE_SURFACE_PARAMETER_DEFAULT}]);expect(actions[1].implicitParameters).toEqual([{model,scope:{kind:'all'}}]);
 });
 it('retains ignored overflow evidence without interpreting disabled entries',()=>{
  const raw=JSON.stringify(source([{method:'paramStart',args:{parameters:{a:{enable:false,step:1}}}},{method:'paramStop',args:{parameters:{a:{step:2}}}}])).replace('"step":1','"step":1e999').replace('"step":2','"step":-1e999');
  const scene=parseScene(serializeScene(parseProjectFile(raw).scene));expect(scene.provenance!.sourceNumberTokens!.filter(x=>x.token.includes('999'))).toHaveLength(2);expect(scene.timeline.tracks[0].actions).toHaveLength(1);
 });
 it('switches methods with the source model and saves actual editor patches',()=>{
  const scene=read([{method:'paramStart',args:{parameters:{a:{}}}}]),action=scene.timeline.tracks[0].actions![0];
  const stopped={...action,method:'paramStop',...registryParameterActionsForMethod(scene,action,'paramStop')};scene.timeline.tracks[0].actions![0]=stopped;
  expect(parseScene(serializeScene(scene)).timeline.tracks[0].actions![0].implicitParameters).toEqual([{model,scope:{kind:'named',name:'a'}}]);
  const started=registryParameterActionsForMethod(scene,stopped,'paramStart');expect(started.implicitParameters![0].configuration).toEqual(SOURCE_SURFACE_PARAMETER_DEFAULT);
  const html=render(createElement(RegistryParameterActionsEditor,{model,values:started.implicitParameters,method:'paramStart',onChange:()=>{throw Error('render mutation');}}));expect(html).toContain('implicit-parameter-actions');expect(html).toContain('Step per frame');expect(html).not.toContain('rad/s');
  const timeline=render(createElement(Timeline,{scene,time:0,playing:false,onTime:()=>{},onPlay:()=>{},onChange:()=>{}}));expect(timeline).not.toContain('<option value="param">');expect(()=>createAnimationTrack(scene,'param')).toThrow('隐式源队列');
 });
 it('bounds nested registry work before admission and retains named editor references',()=>{
  const parameters=Object.fromEntries(Array.from({length:4096},(_,i)=>[`p${i}`,{}]));expect(()=>read([{method:'paramStart',args:{parameters}}])).toThrow('4096');
  const scene=read([{method:'paramStart',enabled:false,args:{parameters:{a:{}}}},{method:'paramStop',args:{parameters:{a:{}}}}]);
  expect(parameterTimelineReferences(scene).map(({target,kind,enabled})=>({target,kind,enabled}))).toEqual([{target:'parameters.a',kind:'value',enabled:true},{target:'parameters.a',kind:'stop',enabled:true}]);
  const old={id:'old',method:'paramStart',sourceEffect:'unmapped' as const};scene.timeline.tracks[0].actions![0]={...old,...registryParameterActionsForMethod(scene,old,'paramStart')};
  expect(parseScene(serializeScene(scene)).timeline.tracks[0].actions![0].implicitParameters).toEqual([{model,scope:{kind:'all'}}]);
 });
 it('rejects mixed families and keeps old unconfigured actions explicit',()=>{
  const scene=read([{method:'paramStart',args:{parameters:{a:{}}}}]);scene.timeline.tracks[0].actions![0].parameters=[];expect(()=>parseScene(serializeScene(scene))).toThrow('隐式源参数');
  const html=render(createElement(RegistryParameterActionsEditor,{model,method:'paramStart',onChange:()=>{}}));expect(html).toContain('Configure source parameters');expect(html).not.toContain('Step per frame');
 });
});
