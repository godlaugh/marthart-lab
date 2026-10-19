import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {gradientAnimationCapabilities} from '../src/engine/gradientOffsets';
import {SOURCE_SURFACE_GRADIENT_DEFAULT} from '../src/engine/sourceSurfaceGradientConfig';
import {SurfaceGradientEditor} from '../src/components/Timeline';
import {I18nProvider} from '../src/i18n';
import type {GradientAnimation} from '../src/types';

const source=(actions:unknown[],settings:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SURFACE',name:'Gradient import',equations:{x:'u',y:'v',z:'0'},settings:{u_segments:2,v_segments:2,speed_u:0,speed_v:0,...settings},palette:['#FF0000','#0000FF'],timeline:[{type:'animate',duration:1,actions}]});
const imported=(args:unknown)=>parseProjectFile(JSON.stringify(source([{method:'gradientStart',args}])));
const config=(args:unknown)=>imported(args).scene.timeline.tracks[0].actions![0]?.gradient;
const render=(value?:GradientAnimation)=>renderToStaticMarkup(createElement(I18nProvider,{language:'zh',children:createElement(SurfaceGradientEditor,{config:value,onChange:()=>{throw Error('render must not mutate');}})}));

describe('Surface source gradient public import and authoring',()=>{
 it('selects source CPU geometry for a gradient-only timeline and round-trips its source configuration',()=>{
  const {scene,warnings}=imported({mode:'CROSS_FADE',interpolation:'OKLCH',speed:'0x1.2p6',affectInside:false,affectOutside:false});
  expect(scene.settings.surfaceGeometryVersion).toBe('mathart-1.7.8-points-v1');
  expect(scene.surfaceSourcePalette).toEqual({colors:['#FF0000','#0000FF']});
  expect(scene.timeline.tracks[0].actions![0].gradient).toEqual({...SOURCE_SURFACE_GRADIENT_DEFAULT,mode:'cross_fade',interpolation:'oklch',speed:72});
  expect(parseScene(serializeScene(scene)).timeline).toEqual(scene.timeline);
  expect(warnings.some(w=>w.includes('固定同时作用于两侧'))).toBe(true);
  expect(warnings.some(w=>w.includes('既有本地解析'))).toBe(false);
  expect(gradientAnimationCapabilities(scene)).toMatchObject({localPalette:false,offsets:true,defaultAnimation:SOURCE_SURFACE_GRADIENT_DEFAULT});
 });
 it('reads a direct object or only the first array object, never a later configuration',()=>{
  expect(config([{mode:'PALETTE_MORPH',speed:24},{speed:99}])).toEqual({...SOURCE_SURFACE_GRADIENT_DEFAULT,mode:'palette_morph',speed:24});
  for(const args of [[],[null,{mode:'CROSS_FADE',speed:99}]])expect(config(args)).toEqual(SOURCE_SURFACE_GRADIENT_DEFAULT);
  for(const args of [undefined,null,17,'{}'])expect(config(args)).toBeUndefined();
 });
 it('preserves skipped unknown modes and FRACTAL targets without activating local palette actions',()=>{
  const raw=source([{method:'gradientStart',args:[{mode:'unknown'}]},{method:'gradientStart',args:{targetDomain:'fRaCtAl'}},{method:'gradientStart',args:{targetDomain:' FRACTAL ',speed:13}}]);
  const {scene}=parseProjectFile(JSON.stringify(raw));
  expect(scene.timeline.tracks[0].duration).toBe(1);expect(scene.timeline.tracks[0].actions).toHaveLength(1);
  expect(scene.timeline.tracks[0].actions![0].gradient!.speed).toBe(13);expect(scene.provenance!.original).toEqual(raw);
  const skipped=imported({mode:'unknown'}).scene;expect(skipped.timeline.tracks[0].actions).toEqual([]);
 });
 it('retains numeric tokens for selected payloads through save/reopen',()=>{
  for(const array of [false,true]){
   const raw=JSON.stringify(source([{method:'gradientStart',args:array?[{speed:1}]:{speed:1}}])).replace('"speed":1','"speed":1e999');
   const scene=parseProjectFile(raw).scene,reopened=parseScene(serializeScene(scene));
   expect(reopened.timeline.tracks[0].actions![0].gradient!.speed).toBe(60);
   expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['timeline','0','actions','0','args',...(array?['0']:[]),'speed'],token:'1e999'});
  }
 });
 it('retains a skipped target payload and numeric fallback argument as evidence without applying them',()=>{
  const text=JSON.stringify(source([{method:'gradientStart',args:{targetDomain:'FRACTAL',speed:1}},{method:'gradientStart',args:2},{method:'gradientStart',args:[]}])).replace('"speed":1','"speed":1e999').replace('"args":2','"args":-1e999');
  const scene=parseScene(serializeScene(parseProjectFile(text).scene));expect(scene.timeline.tracks[0].actions).toHaveLength(1);
  expect(scene.timeline.tracks[0].actions![0].gradient).toEqual(SOURCE_SURFACE_GRADIENT_DEFAULT);
  expect(scene.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['timeline','0','actions','0','args','speed'],token:'1e999'},{path:['timeline','0','actions','1','args'],token:'-1e999'}]));
 });
 it('keeps source clip enable semantics, ignores action enable, and does not parse disabled clip payloads',()=>{
  const raw=source([{method:'gradientStart',enabled:false,args:{speed:-9}},{method:'gradientStop',args:{ignored:true}}]);
  const {scene}=parseProjectFile(JSON.stringify({...raw,timeline:[...raw.timeline,{type:'animate',enabled:false,actions:[{method:'gradientStart',args:{speed:{bad:true}}}]}]}));
  expect(scene.timeline.tracks).toHaveLength(1);expect(scene.timeline.tracks[0].actions!.map(a=>[a.method,a.enabled])).toEqual([['gradientStart',true],['gradientStop',true]]);
  expect(scene.timeline.tracks[0].actions![0].gradient!.speed).toBe(0);
 });
 it('imports initial CPU mesh gradients into their own geometry model while rejecting GPU',()=>{
  const actions=[{method:'gradientStart',args:{mode:'CROSS_FADE',interpolation:'OKLCH',speed:24}}];
  for(const settings of [{render_mode:'GPU'},{surface_mode:'MESH',render_mode:'GPU'}])expect(()=>parseProjectFile(JSON.stringify(source(actions,settings)))).toThrow('GPU');
  const original=source(actions,{surface_mode:'MESH'}),{scene}=parseProjectFile(JSON.stringify(original));
  expect(scene.settings.surfaceGeometryVersion).toBe('mathart-1.7.8-surface-v1');
  expect(scene.surfaceSource).toMatchObject({mode:'mesh',nativeBackend:'cpu',mesh:{uSegments:2,vSegments:2}});
  expect(scene.surfaceSourcePalette).toEqual({colors:['#FF0000','#0000FF']});
  expect(scene.timeline.tracks[0].actions![0].gradient).toEqual({...SOURCE_SURFACE_GRADIENT_DEFAULT,mode:'cross_fade',interpolation:'oklch',speed:24});
  const reopened=parseScene(serializeScene(scene));expect(reopened.surfaceSource).toEqual(scene.surfaceSource);expect(reopened.timeline).toEqual(scene.timeline);expect(reopened.provenance!.original).toEqual(original);
  expect(gradientAnimationCapabilities(scene)).toMatchObject({localPalette:false,offsets:true,defaultAnimation:SOURCE_SURFACE_GRADIENT_DEFAULT});
 });
 it('offers all source modes and color interpolation without regional toggles or local palette controls',()=>{
  const value={...SOURCE_SURFACE_GRADIENT_DEFAULT},before=structuredClone(value),html=render(value);
  for(const option of ['hue_rotate','offset_cycle','palette_morph','cross_fade','rgb','linear','oklab','oklch'])expect(html).toContain(`value="${option}"`);
  expect(html).toContain('渐变速度 °/s');expect(html).toContain('相位曲线与循环颜色插值');expect(html).toContain('data-testid="surface-gradient-config"');
  expect(html).not.toContain('type="checkbox"');expect(html).not.toContain('type="color"');expect(value).toEqual(before);
 });
 it('translates the source gradient editor without mutating its configuration',()=>{
  const value={...SOURCE_SURFACE_GRADIENT_DEFAULT},before=structuredClone(value);
  const html=renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(SurfaceGradientEditor,{config:value,onChange:()=>{throw Error('render must not mutate');}})}));
  expect(html).toContain('Phase curve and cyclic color interpolation');expect(html).toContain('The gradient affects both sides of the surface.');expect(value).toEqual(before);
 });
 it('retains malformed saved configuration and requests explicit repair without silently applying defaults',()=>{
  for(const value of [undefined,{...SOURCE_SURFACE_GRADIENT_DEFAULT,affectInside:false}]){
   const before=structuredClone(value),html=render(value);expect(html).toContain('data-testid="surface-gradient-unconfigured"');expect(html).toContain('设置源渐变配置');expect(html).not.toContain('渐变速度 °/s');expect(value).toEqual(before);
  }
 });
});
