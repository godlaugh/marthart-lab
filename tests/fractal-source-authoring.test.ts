import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {definitions,fractalConfig} from '../src/scenes/complex';
import {FractalControls,visible2DFractalControls} from '../src/components/FractalControls';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,prepareFractalSourcePlan} from '../src/engine/fractalPrecision';
import {parseFractalViewport} from '../src/engine/complexViewport';
import {I18nProvider,translate} from '../src/i18n';
import type {SceneDocument} from '../src/types';

const definition=definitions.find(d=>d.kind==='fractal')!;
const native=(formula:string,precision?:unknown)=>({config_version:'1.0.0',type:'FRACTAL',name:'Source numeric authoring',fractal:{formula_id:formula,type:'JULIA',...(precision===undefined?{}:{perturbation_precision:precision}),parameters:{power:[-2.5,18],relaxation:-.25,bailout:-3,julia_seed:[.2,-.1],start_value:[1,.3]}}});
const imported=(source:unknown)=>parseProjectFile(JSON.stringify(source)).scene;
const plan=(scene:SceneDocument)=>prepareFractalSourcePlan(fractalConfig(scene.settings),parseFractalViewport(scene.settings),{logicalWidth:17,logicalHeight:13,provenance:'requested-output-local'},{precision:scene.settings.perturbationPrecision});
const markup=(scene:SceneDocument)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(FractalControls,{scene,onChange:()=>{},section:'formula'})}));

describe('source Newton/Nova authoring boundary',()=>{
 it.each(['newton','nova'])('imports explicit source numerics and retains finite source inputs: %s',formula=>{
  const raw=native(formula),scene=imported(raw),restored=parseScene(serializeScene(scene));
  expect(scene.settings).toMatchObject({fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,perturbationPrecision:'medium',variant:'julia',convergenceMode:'step',power:-2.5,powerImag:18,relaxation:-.25,tolerance:-3});
  expect(restored.settings).toEqual(scene.settings);expect(restored.provenance?.original).toEqual(raw);
  const prepared=plan(restored);expect(prepared.ok).toBe(true);if(!prepared.ok)return;
  expect(prepared.value.bailout).toBe(Math.fround(1e-12));expect(prepared.value.shaderPower).toEqual([-2.5,18]);expect(prepared.value.shaderRelaxation).toBe(-.25);
  expect(prepared.value.authoredVariant).toBe('julia');expect(prepared.value.isJulia).toBe(formula==='nova');
 });
 it.each([[undefined,'medium'],[null,'medium'],['LOW','low'],['Medium','medium'],['HIGH','high']])('normalizes supported native precision %j to %s',(raw,expected)=>{
  expect(imported(native('newton',raw)).settings.perturbationPrecision).toBe(expected);
 });
 it.each(['ULTRA','ultra','future-precision',''])('preserves unsupported native precision %j and explicitly rejects calculation',precision=>{
  const raw=native('nova',precision),scene=imported(raw),restored=parseScene(serializeScene(scene));
  expect(restored.settings.perturbationPrecision).toBe(precision);expect(restored.provenance?.original).toEqual(raw);
  expect(plan(restored)).toEqual({ok:false,error:{kind:'input',field:'precision',reason:'Source precision requires low, medium or high'}});
  expect(()=>definition.generate(restored,{time:0,width:1,height:1,quality:'preview'})).toThrow('Source precision requires low, medium or high');
  expect(markup(restored)).toContain(`value="${precision}" selected`);
 });
 it('does not upgrade a saved local Newton document or native non-Newton precision',()=>{
  const scene=createScene(definition);Object.assign(scene.settings,{formula:'newton',convergenceMode:'legacy',variant:'julia',fractalBackend:'cpu'});
  const restored=imported(JSON.parse(serializeScene(scene)));expect(restored.settings.fractalNumericProfile).toBeUndefined();expect(fractalConfig(restored.settings).convergenceMode).toBe('legacy');
  expect(markup(restored)).toContain('control-convergenceMode');
  const other=imported({config_version:'1.0.0',type:'FRACTAL',name:'Local Mandelbrot',fractal:{formula_id:'mandelbrot',perturbation_precision:'ULTRA'}});
  expect(other.settings.fractalNumericProfile).toBeUndefined();expect(other.settings.perturbationPrecision).toBe('ultra');
 });
 it('shows source constraints while keeping CPU and dormant author choices unchanged',()=>{
  const scene=imported(native('newton'));Object.assign(scene.settings,{convergenceMode:'residual',fractalBackend:'cpu'});const before=serializeScene(scene),html=markup(scene);
  expect(html).toContain('CPU is selected');expect(html).toContain('value="cpu" selected');expect(html).toContain('Newton always uses the parameter plane');expect(html).not.toContain('control-convergenceMode');
  expect(fractalConfig(scene.settings).convergenceMode).toBe('step');expect(scene.settings.convergenceMode).toBe('residual');
  expect(()=>definition.generate(scene,{time:0,width:1,height:1,quality:'preview'})).toThrow('需要 WebGL2');expect(serializeScene(scene)).toBe(before);
  const loaded=parseScene(before);expect(loaded.settings).toEqual(scene.settings);
 });
 it('uses source finite domains without altering compatible control ranges',()=>{
  const scene=imported(native('nova')),source=visible2DFractalControls(definition.controls,scene.settings),compatible=visible2DFractalControls(definition.controls,{...scene.settings,fractalNumericProfile:'local-v1'});
  for(const key of ['power','powerImag','relaxation','tolerance']){const spec=source.find(c=>c.key===key)!;expect(spec.min,key).toBeUndefined();expect(spec.max,key).toBeUndefined();expect(compatible.find(c=>c.key===key)?.min,key).not.toBeUndefined();}
  expect(source.find(c=>c.key==='perturbationPrecision')?.options?.map(o=>o.value)).toEqual(['low','medium','high']);expect(source.find(c=>c.key==='convergenceMode')).toBeUndefined();
 });
 it('keeps a source selection dormant on another formula and retains the local mode control',()=>{
  const scene=createScene(definition);Object.assign(scene.settings,{formula:'magnet1',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,convergenceMode:'residual'});
  const before=serializeScene(scene),html=markup(scene);expect(html).toContain('source numeric rules are inactive');expect(html).toContain('control-convergenceMode');expect(fractalConfig(scene.settings).convergenceMode).toBe('residual');expect(serializeScene(scene)).toBe(before);
 });
 it('translates runtime notices without inventing translations for opaque reason codes',()=>{
  expect(translate('en','参考轨道不可用（NOVA_REF_DERIV_SINGULAR）；使用普通 GPU 迭代。')).toBe('Reference orbit unavailable (NOVA_REF_DERIV_SINGULAR); using ordinary GPU iteration.');
  expect(translate('en','MathArt Newton/Nova 数值规则需要 WebGL2；如需 CPU，请选择本地数值规则。')).toContain('require WebGL2');
 });
});
