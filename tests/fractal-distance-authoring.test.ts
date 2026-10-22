import {prepareFractalSourceColor} from '../src/engine/fractalSourceColor';
import {sceneAtTime} from '../src/engine/timeline';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseFractalColors,fractalColorControls} from '../src/engine/fractalColor';
import {definitions,fractalConfig} from '../src/scenes/complex';
import {FractalControls} from '../src/components/FractalControls';
import {I18nProvider} from '../src/i18n';
import type {SceneDocument} from '../src/types';

const definition=definitions.find(d=>d.kind==='fractal')!;
const source=(params?:unknown)=>({config_version:'1.0.0',type:'FRACTAL',name:'DE source parameters',fractal:{formula_id:'mandelbrot',type:'MANDELBROT',parameters:{power:7}},color:{outside:{algorithm_id:'distance_estimator',...(params===undefined?{}:{algorithm_params:params})}}});
const importSource=(raw:unknown)=>parseProjectFile(JSON.stringify(raw));
const image=(scene:SceneDocument)=>definition.generate(scene,{quality:'export',time:0,width:16,height:12});
const ui=(scene:SceneDocument)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(FractalControls,{scene,onChange:()=>{},section:'color'})}));

describe('explicit distance-estimation authoring and native JSON boundary',()=>{
 it('keeps omitted saved-document semantics and raw requested algorithms through reload',()=>{
  const scene=createScene(definition);delete scene.settings.fractalDistanceVersion;
  Object.assign(scene.settings,{formula:'lambda',outsideColoring:'distance_estimator',outsideDistancePower:7,fractalBackend:'cpu'});
  const loaded=parseScene(JSON.stringify(persistentScene(scene)));
  expect(loaded.settings.fractalDistanceVersion).toBeUndefined();expect(loaded.settings.outsideColoring).toBe('distance_estimator');expect(loaded.settings.outsideDistancePower).toBe(7);
  expect(()=>image(loaded)).toThrow('仅支持');expect(ui(loaded)).toContain('Saved-document compatibility (2097)');expect(ui(loaded)).toContain('Distance estimation supports only');
 });
 it('keeps authored DE and inactive Smooth parameters when source rules use a fallback',()=>{
  const scene=createScene(definition);Object.assign(scene.settings,{fractalDistanceVersion:'mathart-1.7.8-v1',fractalColorVersion:2,formula:'lambda',outsideColoring:'distance_estimator',outsideDistancePower:9,outsideSmoothSource:'power',outsideSmoothPower:13,fractalBackend:'cpu',iterations:12});
  const before=JSON.stringify(scene),loaded=parseScene(JSON.stringify(persistentScene(scene))),out=image(loaded);
  expect(out.type).toBe('raster');expect(fractalConfig(loaded.settings).distance?.capability.supported).toBe(false);expect(JSON.stringify(scene)).toBe(before);expect(loaded.settings).toEqual(scene.settings);
  const html=ui(loaded);expect(html).toContain('fractal-distance-fallback');expect(html).toContain('so Smooth is used');expect(html).toContain('inactive Smooth parameters');expect(html).not.toContain('Distance estimation supports only');expect(html).toContain('value="distance_estimator" selected');
 });
 it('uses the same capability facts for noninteger/complex-power notices and leaves DE available',()=>{
  for(const [power,powerImag,text]of [[2.5,0,'Noninteger powers'],[2,1,'Complex powers']] as const){
   const scene=createScene(definition);Object.assign(scene.settings,{fractalDistanceVersion:'mathart-1.7.8-v1',formula:'mandelbrot',power,powerImag,outsideColoring:'distance_estimator'});
   expect(fractalConfig(scene.settings).distance?.capability.supported).toBe(false);const html=ui(scene);expect(html).toContain(text);expect(html).toContain('control-outsideDistancePower');
  }
 });
 it('keeps valid requested color controls visible while an unrelated formula input is invalid',()=>{
  const scene=createScene(definition);Object.assign(scene.settings,{fractalDistanceVersion:'mathart-1.7.8-v1',formula:'mandelbrot',iterations:0,outsideColoring:'distance_estimator',outsideDistancePower:19});
  const html=ui(scene);expect(html).toContain('role="alert"');expect(html).toContain('value="distance_estimator" selected');expect(html).toContain('control-outsideDistancePower');expect(html).toContain('value="19"');
 });
 it('exposes the source power range without changing the compatible control range',()=>{
  const scene=createScene(definition);Object.assign(scene.settings,{fractalDistanceVersion:'mathart-1.7.8-v1',outsideColoring:'distance_estimator',outsideDistancePower:120});
  const loaded=parseScene(JSON.stringify(scene)),style=parseFractalColors(loaded).outside;
  expect(style.distancePower).toBe(120);expect(fractalColorControls(style,false,true).find(c=>c.key==='outsideDistancePower')?.max).toBeUndefined();expect(fractalColorControls(style,false,false).find(c=>c.key==='outsideDistancePower')?.max).toBe(100);
 });
 it.each([undefined,{}])('imports omitted/empty registered DE parameters as metadata 2, not formula power 7: %j',params=>{
  const raw=source(params),result=importSource(raw),scene=result.scene;
  expect(sceneAtTime(scene,0).evaluatedFractalScene!.formula.native.power).toBe(7);expect(scene.fractalSourceColor!.outside.parameters.power).toBe(2);expect(prepareFractalSourceColor({configuration:scene.fractalSourceColor!,formulaPower:7,bailout:4}).outside.p0[2]).toBe(2);expect(scene.provenance?.original).toEqual(raw);expect(importSource(scene).scene).toEqual(scene);
 });
 it.each([[null,2],[true,2],[[],2],[{},2],[0,2],[1,2],[3.1,Math.fround(3.1)],[120,120],[1e50,2],['NaN',2],['Infinity',2],['2 + 3',5],['invalid(',2]])('applies source binder scalar conversion %j -> %s without losing provenance',(rawPower,expected)=>{
  const raw=source({power:rawPower}),scene=importSource(raw).scene;expect(scene.fractalSourceColor!.outside.parameters.power).toBe(expected);expect(scene.provenance?.original).toEqual(raw);expect(parseScene(JSON.stringify(scene)).fractalSourceColor!.outside.parameters.power).toBe(expected);
 });
 it.each([null,[],4,''])('rejects a present non-object algorithm_params container: %j',params=>{
  expect(()=>importSource(source(params))).toThrow(/color.outside.algorithm_params.*object/);
 });
 it.each(['inside','outside'] as const)('validates the native parameter container once for every algorithm: %s',side=>{
  for(const algorithm_id of ['none','basic','smooth_mandelbrot','direct_domain']){
   for(const algorithm_params of [null,[],4,'']){
    const raw={...source(),color:{[side]:{algorithm_id,algorithm_params}}};expect(()=>importSource(raw)).toThrow(new RegExp(`color.${side}.algorithm_params.*object`));
   }
   for(const params of [undefined,{}]){
    const raw={...source(),color:{[side]:{algorithm_id,...(params===undefined?{}:{algorithm_params:params})}}};expect(importSource(raw).scene.fractalSourceColor![side].algorithm).toBe(algorithm_id);
   }
  }
 });
 it('keeps local scalar resource admission explicit rather than silently defaulting',()=>{
  expect(()=>importSource(source({power:'9'.repeat(65537)}))).toThrow(/budget exceeded|容量/);
 });
});
