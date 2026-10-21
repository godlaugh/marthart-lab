import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {RegistryParameterActionsEditor,registryParameterActionsForMethod} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {parameterTimelineReferences} from '../src/engine/sceneParameters';
import {SOURCE_MAP_PARAMETER_MODEL as model,SOURCE_MAP_PARAMETER_DEFAULT,parseSourceMapParameterActions} from '../src/engine/sourceRegistryParameterConfig';
import type {AnimationAction,AnimationTrack} from '../src/types';
const scene=()=>{const value=createScene(definition('map'));value.settings.mapParameterModel=model;return value;};
const render=(action:AnimationAction)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(RegistryParameterActionsEditor,{model,values:action.mapParameters,method:action.method as 'paramStart'|'paramStop',onChange:()=>{throw Error('render mutation');}})}));
describe('Map source registry authoring and parameter references',()=>{
 it('creates explicit all operations when switching a fresh action to Start or Stop',()=>{
  const source=scene(),action={id:'new',method:'rotateTheta'},before=structuredClone(source);
  for(const method of ['paramStart','paramStop'] as const){const next=registryParameterActionsForMethod(source,action,method);expect(parseSourceMapParameterActions(next.mapParameters,method)).toEqual([{model,scope:{kind:'all'}}]);expect(next.surfaceParameters).toBeUndefined();expect(next.symmetryParameters).toBeUndefined();}
  expect(source).toEqual(before);
 });
 it('preserves named identity while removing Start config for Stop and rebuilding Map defaults for Start',()=>{
  const source=scene(),action:AnimationAction={id:'a',method:'paramStart',mapParameters:[{model,scope:{kind:'named',name:'a.b'},configuration:{...SOURCE_MAP_PARAMETER_DEFAULT,min:9,max:-7,step:-.3}}]},before=structuredClone(action);
  const stopped={...action,method:'paramStop',...registryParameterActionsForMethod(source,action,'paramStop')};
  expect(parseSourceMapParameterActions(stopped.mapParameters,'paramStop')).toEqual([{model,scope:{kind:'named',name:'a.b'}}]);
  const started={...stopped,method:'paramStart',...registryParameterActionsForMethod(source,stopped,'paramStart')};
  expect(started.mapParameters![0].configuration).toEqual(SOURCE_MAP_PARAMETER_DEFAULT);expect(started.mapParameters![0].configuration).not.toBe(SOURCE_MAP_PARAMETER_DEFAULT);expect(started.mapParameters![0].configuration!.edgeEasing).not.toBe(SOURCE_MAP_PARAMETER_DEFAULT.edgeEasing);
  const unchanged=registryParameterActionsForMethod(source,action,'paramStart');expect(unchanged.mapParameters).toEqual(action.mapParameters);expect(action).toEqual(before);
  expect(registryParameterActionsForMethod(source,started,'rotatePhi').mapParameters).toBeUndefined();
 });
 it('renders Map registry defaults with exact source names and no local target selector',()=>{
  const action:AnimationAction={id:'ui',method:'paramStart',mapParameters:[{model,scope:{kind:'named',name:' a.b '},configuration:{...SOURCE_MAP_PARAMETER_DEFAULT}}]},before=structuredClone(action),html=render(action);
  expect(html).toContain('data-testid="map-parameter-actions"');expect(html).toContain('value=" a.b "');expect(html).toContain('value="-1"');expect(html).toContain('Step per frame');expect(html).toContain('All parameter animations');expect(html).not.toContain('rad/s');expect(action).toEqual(before);
  const stop={...action,method:'paramStop',...registryParameterActionsForMethod(scene(),action,'paramStop')};expect(render(stop)).not.toContain('Step per frame');
 });
 it('requires an explicit user edit before manufacturing source data for old or malformed actions',()=>{
  const old=render({id:'old',method:'paramStart'});expect(old).toContain('Configure source parameters');expect(old).not.toContain('Step per frame');
  const wrong={id:'wrong',method:'paramStart',mapParameters:[{model:'symmetry-registry-1.7.8',scope:{kind:'all'}}]} as unknown as AnimationAction;expect(render(wrong)).toContain('role="alert"');
  const local=createScene(definition('map'));expect(registryParameterActionsForMethod(local,{id:'local',method:'paramStart'},'paramStart').mapParameters).toBeUndefined();
 });
 it('keeps color references in settings and exact other names in formula parameters regardless of the action checkbox',()=>{
  const source=scene();const track:AnimationTrack={id:'track',type:'animate',target:'',start:0,duration:1,from:0,to:1,easing:'linear',enabled:true,pingPong:false,actions:[{id:'start',method:'paramStart',enabled:false,mapParameters:['colorSpeed','colorPhase',' colorSpeed ','colorPhase.extra','a.b'].map(name=>({model,scope:{kind:'named',name},configuration:{...SOURCE_MAP_PARAMETER_DEFAULT}}))},{id:'stop',method:'paramStop',mapParameters:[{model,scope:{kind:'named',name:'a.b'}},{model,scope:{kind:'all'}}]}]};source.timeline.tracks=[track];
  const expected=['settings.colorSpeed','settings.colorPhase','parameters. colorSpeed ','parameters.colorPhase.extra','parameters.a.b','parameters.a.b'];expect(parameterTimelineReferences(source).map(r=>r.target)).toEqual(expected);expect(parameterTimelineReferences(source).map(r=>r.kind)).toEqual(['value','value','value','value','value','stop']);expect(parameterTimelineReferences(source).every(r=>r.enabled)).toBe(true);
  track.enabled=false;expect(parameterTimelineReferences(source).every(r=>!r.enabled)).toBe(true);
 });
});
