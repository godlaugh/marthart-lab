import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {definitions,fractalConfig} from '../src/scenes/complex';
import {FractalControls,visible2DFractalControls} from '../src/components/FractalControls';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,prepareFractalSourceNativePlan} from '../src/engine/fractalPrecision';
import {sceneAtTime} from '../src/engine/timeline';
import {generateScene} from '../src/engine/temporal';
import {sourceFractalRenderInput} from '../src/engine/sourceFractalRender';
import {parseFractalViewport} from '../src/engine/complexViewport';
import {I18nProvider,translate} from '../src/i18n';
import type {SceneDocument} from '../src/types';

const definition=definitions.find(d=>d.kind==='fractal')!;
const native=(formula:string,precision?:unknown)=>({config_version:'1.0.0',type:'FRACTAL',name:'Source numeric authoring',fractal:{formula_id:formula,type:'JULIA',...(precision===undefined?{}:{perturbation_precision:precision}),parameters:{exponent:[-2.5,18],relaxation:-.25,bailout:-3,julia_seed:[.2,-.1],start_value:[1,.3]}}});
const imported=(source:unknown)=>parseProjectFile(JSON.stringify(source)).scene;
const plan=(scene:SceneDocument)=>{const frame=sceneAtTime(scene,0);return prepareFractalSourceNativePlan(sourceFractalRenderInput(frame.evaluatedFractalScene),parseFractalViewport(frame.settings),{logicalWidth:17,logicalHeight:13,provenance:'requested-output-local'},{precision:scene.settings.perturbationPrecision});};
const markup=(scene:SceneDocument)=>renderToStaticMarkup(createElement(I18nProvider,{language:'en',children:createElement(FractalControls,{scene,onChange:()=>{},section:'formula'})}));

describe('source Newton/Nova authoring boundary',()=>{
 it.each(['newton','nova'])('imports canonical source metadata and preserves raw inputs independently: %s',formula=>{
  const raw=native(formula),scene=imported(raw),restored=parseScene(serializeScene(scene));
  expect(scene.settings).toMatchObject({fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,perturbationPrecision:'medium'});
  // StandardFormulaCatalog and the retained JsonFormulaParamBinder fixtures:
  // complex exponent stays double; scalar metadata has a zero lower bound.
  expect(scene.fractalSource).toEqual({model:'mathart-1.7.8-scene-v1',formula:{formulaId:formula,fractalType:'julia',power:2,formulaParams:[2,0,0,0],bailout:4,julia:[-.8,.156],parameters:{floats:{bailout:0,relaxation:0},complex:{exponent:[-2.5,18],...(formula==='nova'?{start_value:[1,.3],julia_seed:[.2,-.1]}:{})}}}});
  expect(restored.settings).toEqual(scene.settings);expect(restored.fractalSource).toEqual(scene.fractalSource);expect(restored.provenance?.original).toEqual(raw);
  const evaluated=sceneAtTime(restored,0).evaluatedFractalScene!.formula.native;
  expect(evaluated).toMatchObject({fractalType:formula==='newton'?'mandelbrot':'julia',power:-2,bailout:Math.fround(1e-12),formulaParams:[-2,0,0,0]});
  expect(evaluated.julia).toEqual(formula==='nova'?[.2,-.1]:[0,0]);

  const prepared=plan(restored);expect(prepared.ok).toBe(true);if(!prepared.ok)return;
  expect(prepared.value.bailout).toBe(Math.fround(1e-12));expect(prepared.value.shaderPower).toEqual([-2.5,18]);expect(prepared.value.shaderRelaxation).toBe(0);
  expect(prepared.value.authoredVariant).toBe(formula==='nova'?'julia':'mandelbrot');expect(prepared.value.isJulia).toBe(formula==='nova');
 });
 it('retains unknown parameter names without interpreting them as known metadata aliases',()=>{
  const raw=native('newton');raw.fractal.parameters={...raw.fractal.parameters,exponent:[3,0],power:[19,7]} as typeof raw.fractal.parameters;
  const scene=imported(raw),frame=sceneAtTime(scene,0).evaluatedFractalScene!;
  expect(scene.fractalSource!.formula.parameters!.complex).toEqual({exponent:[3,0]});expect(frame.formula.native.dynamicParams.slice(0,2)).toEqual([3,0]);expect(frame.formula.native.power).toBe(3);
  expect(scene.provenance?.original).toEqual(raw);
 });
 it.each([[undefined,'medium'],[null,'medium'],['LOW','low'],['Medium','medium'],['HIGH','high']])('normalizes supported native precision %j to %s',(raw,expected)=>{
  expect(imported(native('newton',raw)).settings.perturbationPrecision).toBe(expected);
 });
 it.each(['ULTRA','ultra','future-precision',''])('preserves unsupported native precision %j and explicitly rejects calculation',precision=>{
  const raw=native('nova',precision),scene=imported(raw),restored=parseScene(serializeScene(scene));
  expect(restored.settings.perturbationPrecision).toBe(precision);expect(restored.provenance?.original).toEqual(raw);
  expect(plan(restored)).toEqual({ok:false,error:{kind:'input',field:'precision',reason:'Source precision requires low, medium or high'}});
  expect(()=>generateScene(restored,{time:0,width:1,height:1,quality:'preview'})).toThrow('Source precision requires low, medium or high');
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
  expect(html).toContain('CPU is selected');expect(html).toContain('value="cpu" selected');expect(html).toContain(translate('en','Newton 使用参数平面；保留的 Julia 变体不参与画面计算。'));expect(html).not.toContain('control-convergenceMode');
  expect(fractalConfig(scene.settings).convergenceMode).toBe('step');expect(scene.settings.convergenceMode).toBe('residual');
  expect(()=>generateScene(scene,{time:0,width:1,height:1,quality:'preview'})).toThrow('需要 WebGL2');expect(serializeScene(scene)).toBe(before);
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
