import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {serializeScene,parseScene} from '../src/engine/document';
import {SOURCE_SURFACE_PARAMETER_MODEL as model,SOURCE_SURFACE_PARAMETER_DEFAULT} from '../src/engine/sourceRegistryParameterConfig';
import {RegistryParameterActionsEditor,SurfaceParameterClipEditor} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';
const source=(timeline:unknown[],settings={})=>({config_version:'1.0.0',type:'SURFACE',name:'Source parameter import',parameters:{a:2,b:3},equations:{x:'u+a',y:'v',z:'a'},settings:{u_segments:2,v_segments:2,speed_u:0,speed_v:0,show_trails:false,...settings},timeline});
const read=(timeline:unknown[],settings={})=>parseProjectFile(JSON.stringify(source(timeline,settings)));
const animate=(actions:unknown[])=>({type:'animate',duration:1,actions});
const render=(children:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children}));

describe('source Surface parameter public import and explicit editors',()=>{
 it('imports native named/all actions into the source model and preserves exact target names',()=>{
  const {scene}=read([animate([{method:'paramStart',args:[{parameters:{'unknown.key':{},a:{min:9,max:-2,step:'a/4'}}}]},{method:'paramStop',args:{parameters:{a:{step:null}}}},{method:'paramStart',args:[]}])]);
  const actions=scene.timeline.tracks[0].actions!;expect(scene.settings.surfaceGeometryVersion).toBe('mathart-1.7.8-points-v1');
  expect(actions.every(a=>a.parameters===undefined&&a.domainParameters===undefined)).toBe(true);
  expect(actions[0].surfaceParameters!.find(p=>p.scope.kind==='named'&&p.scope.name==='unknown.key')!.configuration).toEqual(SOURCE_SURFACE_PARAMETER_DEFAULT);
  expect(actions[0].surfaceParameters!.find(p=>p.scope.kind==='named'&&p.scope.name==='a')!.configuration).toMatchObject({min:9,max:-2,step:.5});
  expect(actions[1].surfaceParameters).toEqual([{model,scope:{kind:'named',name:'a'}}]);expect(actions[2].surfaceParameters).toEqual([{model,scope:{kind:'all'}}]);
  expect(parseScene(serializeScene(scene)).timeline).toEqual(scene.timeline);
 });
 it('inherits settings/action/named edge values once and retains native numeric tokens',()=>{
  const raw=source([animate([{method:'paramStart',args:[{edgeEasing:{window:.2},parameters:{a:{step:.1,edgeEasing:{floor:2}}}}]}])],{param_edge_easing:{window:.4,floor:.7,easing:'LINEAR'}});
  const {scene}=parseProjectFile(JSON.stringify(raw));expect(scene.timeline.tracks[0].actions![0].surfaceParameters![0].configuration!.edgeEasing).toEqual({window:.2,floor:2,easing:'linear'});
  const reopened=parseScene(serializeScene(scene));expect(reopened.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['settings','param_edge_easing','floor'],token:'0.7'},{path:['timeline','0','actions','0','args','0','parameters','a','step'],token:'0.1'}]));
 });
 it('skips absent args and disabled/malformed children while preserving a real empty-map all action',()=>{
  const {scene}=read([animate([{method:'paramStart'},{method:'paramStart',args:0},{method:'paramStart',args:{parameters:{a:{enable:false,step:null},b:3}}},{method:'paramStart',args:{parameters:{}}}])]);
  expect(scene.timeline.tracks[0].actions).toHaveLength(1);expect(scene.timeline.tracks[0].actions![0].surfaceParameters).toEqual([{model,scope:{kind:'all'}}]);
 });
 it('imports standalone replacement configs including disabled entries and primitive constants',()=>{
  const {scene}=read([{type:'param',duration:2,easing:'LINEAR',parameters:{a:{min:5,max:-5,step:-.1,enable:false},b:'PI',c:'0x1.8p2'},edgeEasing:{window:99}}]);
  const track=scene.timeline.tracks[0];expect(track.parameterAnimations).toBeUndefined();expect(track.surfaceParameterClip!.parameters).toEqual(expect.arrayContaining([{name:'a',min:5,max:-5,step:Math.fround(-.1),enabled:false},{name:'b',min:0,max:0,step:0,enabled:true},{name:'c',min:6,max:6,step:0,enabled:true}]));
  expect(parseScene(serializeScene(scene)).timeline).toEqual(scene.timeline);
 });
 it('keeps parameter numeric paths exact and rejects later array payloads or unknown fields',()=>{
  for(const path of [['timeline','0','actions','0','args','0','parameters','a.b','step'],['timeline','0','parameters','a.b'],['settings','param_edge_easing','floor']])expect(parseSourceNumberTokens([{path,token:'-0'}],'surface')).toEqual([{path,token:'-0'}]);
  for(const path of [['timeline','0','actions','0','args','1','parameters','a','step'],['timeline','0','parameters','a','unknown'],['settings','param_edge_easing','unknown']])expect(()=>parseSourceNumberTokens([{path,token:'1'}],'surface')).toThrow();
 });
 it('retains recognized numeric tokens in ignored disabled/stop/target-excluded configs without executing them',()=>{
  const raw=source([animate([{method:'paramStart',args:{targetDomain:'FRACTAL',parameters:{a:{step:1}}}},{method:'paramStop',args:[{parameters:{a:{step:2,edgeEasing:{floor:3}}}}]},{method:'paramStart',args:{parameters:{a:{enable:false,min:4},b:5}}}])]);
  const text=JSON.stringify(raw).replace('"step":1','"step":1e999').replace('"step":2','"step":-1e999').replace('"floor":3','"floor":1e999').replace('"min":4','"min":1e999').replace('"b":5','"b":1e999');
  const scene=parseScene(serializeScene(parseProjectFile(text).scene));expect(scene.timeline.tracks[0].actions).toHaveLength(1);expect(scene.timeline.tracks[0].actions![0].method).toBe('paramStop');
  expect(scene.provenance!.sourceNumberTokens!.filter(x=>x.token.includes('999'))).toHaveLength(5);
 });
 it('renders named/all source editing without local target selectors or phase units',()=>{
  const values=[{model,scope:{kind:'named' as const,name:'a.b'},configuration:{...SOURCE_SURFACE_PARAMETER_DEFAULT}}],before=structuredClone(values);
  const html=render(createElement(RegistryParameterActionsEditor,{model,values,method:'paramStart',onChange:()=>{throw Error('render mutation');}}));
  expect(html).toContain('data-testid="surface-parameter-actions"');expect(html).toContain('a.b');expect(html).toContain('Step per frame');expect(html).toContain('All parameter animations');expect(html).not.toContain('rad/s');expect(values).toEqual(before);
 });
 it('separates standalone replacement editing from named-action edge ramp controls',()=>{
  const value={model,parameters:[{name:'a',min:1,max:0,step:-.1,enabled:false}]};const html=render(createElement(SurfaceParameterClipEditor,{value,onChange:()=>{throw Error('render mutation');}}));
  expect(html).toContain('data-testid="surface-parameter-clip"');expect(html).toContain('A standalone parameter clip replaces the current parameter animations');expect(html).not.toContain('Edge window');expect(html).not.toContain('type="checkbox" checked=""');
 });
 it('does not manufacture source configuration when opening an old or malformed action',()=>{
  const html=render(createElement(RegistryParameterActionsEditor,{model,method:'paramStart',onChange:()=>{throw Error('render mutation');}}));expect(html).toContain('Configure source parameters');expect(html).not.toContain('Step per frame');
 });
});
