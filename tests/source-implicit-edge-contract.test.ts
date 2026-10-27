import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {RegistryParameterActionsEditor} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {SOURCE_IMPLICIT_PARAMETER_MODEL as model} from '../src/engine/sourceRegistryParameterConfig';
import native from './fixtures/source-implicit-presentation/parameters.json';

function source(global:unknown={},action:unknown={},parameter:unknown={}){
 const project=structuredClone(native.cases[0].input.project);
 return{...project,settings:{...project.settings,param_edge_easing:global},timeline:[{type:'animate',duration:1,actions:[{method:'paramStart',args:{edgeEasing:action,parameters:{a:{min:.5,max:1.5,step:.02,edgeEasing:parameter}}}}]}]};
}
const imported=(raw:ReturnType<typeof source>)=>parseProjectFile(JSON.stringify(raw)).scene;
function edge(scene:ReturnType<typeof imported>){return scene.timeline.tracks[0].actions![0].implicitParameters![0].configuration!.edgeEasing;}

describe('Implicit 1.7.8 edge fields versus the retained public guide',()=>{
 it('keeps attack/release as inactive source evidence through public import and save/reopen',()=>{
  const raw=source({attackRatio:.3,releaseRatio:.4},{attackRatio:.1,releaseRatio:.9},{attackRatio:.8,releaseRatio:.2,easing:'SINE_OUT'}),scene=imported(raw);
  expect(edge(scene)).toEqual({window:.5,floor:.25,easing:'sine-out'});
  const reopened=parseScene(serializeScene(scene));
  expect(edge(reopened)).toEqual(edge(scene));expect(reopened.provenance!.original).toEqual(raw);
  expect(scene.provenance!.warnings.some(w=>w.includes('attackRatio'))).toBe(true);
  expect(scene.provenance!.warnings.some(w=>w.includes('releaseRatio'))).toBe(true);
 });
 it('resolves only window/floor/easing by global → action → named-parameter inheritance',()=>{
  const raw=source({window:.8,floor:.2,easing:'SINE_IN'},{window:.3,attackRatio:.9},{floor:.6,releaseRatio:.8}),scene=imported(raw),reopened=parseScene(serializeScene(scene));
  expect(edge(scene)).toEqual({window:.3,floor:.6,easing:'sine-in'});expect(edge(reopened)).toEqual(edge(scene));
  expect(reopened.provenance!.original).toEqual(raw);
  expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args','edgeEasing','window'],token:'0.3'});
 });
 it('keeps invalid scalar text and lowercase easing at their source-inherited values',()=>{
  const scene=imported(source({window:.8,floor:.2,easing:'SINE_IN'},{window:'PI/2',easing:'linear'},{floor:'0.6'}));
  expect(edge(scene)).toEqual({window:.8,floor:.6,easing:'sine-in'});
  expect(edge(parseScene(serializeScene(scene)))).toEqual(edge(scene));
 });
 it.each(['attackRatio','releaseRatio'])('rejects %s in canonical executable configuration instead of inventing an alias',key=>{
  const scene=imported(source());Object.assign(edge(scene),{[key]:.4});
  expect(()=>parseScene(serializeScene(scene))).toThrow('未知字段');
 });
 it('presents phase-window and speed-floor controls with the existing source model',()=>{
  const scene=imported(source()),values=scene.timeline.tracks[0].actions![0].implicitParameters;
  const html=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(RegistryParameterActionsEditor,{model,values,method:'paramStart',onChange:()=>{throw Error('render must not mutate');}})}));
  expect(html).toContain('Turning-point window (rad)');expect(html).toContain('Minimum speed ratio');
  expect(html).not.toContain('attackRatio');expect(html).not.toContain('releaseRatio');
 });
});
