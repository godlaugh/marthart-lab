import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {defaultFormulas,formulaLabels,mainEquation} from '../src/engine/formulas';
import {renderFormulaSvg} from '../src/engine/formulaSvg';
import {parseScene,serializeScene} from '../src/engine/document';

const source=(extra:Record<string,unknown>={},timeline:unknown[]=[])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Native label',fractal:{formula_id:'nova',type:'JULIA',parameters:{exponent:[3,0],relaxation:.5,bailout:.001,julia_seed:[.123456789012345,-.23456789012345]},...extra},timeline})).scene;

describe('source formula annotations share the delivered native frame',()=>{
 it('updates formula labels from mapped parameter animation without reading stale settings',()=>{
  const scene=source({},[{type:'animate',duration:0,actions:[{method:'paramStart',args:[{parameters:{exponent:{min:2,max:4,step:.01}}}]}]},{type:'wait',duration:2}]);
  scene.formulas=defaultFormulas();scene.formulas.main.visible=true;
  // These dormant values must not even be parsed by the source label path.
  Object.assign(scene.settings,{formula:'mandelbulb_3d',power:'invalid',variant:'invalid',relaxation:'invalid'});
  const first=sceneAtTime(scene,0),later=sceneAtTime(scene,.5),before=structuredClone(later),a=formulaLabels(first)[0].latex,b=formulaLabels(later)[0].latex;
  expect(later.evaluatedFractalScene!.formula.native.dynamicParams[0]).not.toBe(first.evaluatedFractalScene!.formula.native.dynamicParams[0]);
  expect(b).toContain(`z_n^{${later.evaluatedFractalScene!.formula.native.dynamicParams[0]}}`);expect(b).toContain('z_n-0.5');expect(b).toContain('0.123456789012345');expect(b).toContain('0.23456789012345');expect(b).not.toBe(a);
  expect(renderFormulaSvg(b,'#ffffff').source).toContain('<path');expect(later).toEqual(before);
 });
 it('follows the native formula and variant after a source-only formula switch',()=>{
  const scene=source(),nova=sceneAtTime(scene,0),novaText=mainEquation(nova);
  expect(novaText).toContain('+c');expect(novaText).toContain('z_0=w');expect(novaText).toContain('0.123456789012345');
  scene.fractalSource!.formula={...scene.fractalSource!.formula,formulaId:'newton',parameters:{floats:{relaxation:.5,bailout:Math.fround(.001)},complex:{exponent:[4,0]}}};
  expect(scene.settings.formula).toBe('nova');const restored=parseScene(serializeScene(scene)),newton=sceneAtTime(restored,0),newtonText=mainEquation(newton);
  expect(newton.evaluatedFractalScene!.formula.native.fractalType).toBe('mandelbrot');expect(newtonText).toContain('z_n^{4}');expect(newtonText).not.toContain('+c');expect(newtonText).toContain('c=w');expect(newtonText).not.toContain('0.123456789012345');
 });
 it('distinguishes sparse fallback shader power from the native reference power',()=>{
  const scene=source({formula_id:'newton',power:7,parameters:{}}),evaluated=sceneAtTime(scene,0);
  // Empty JSON binder materializes the catalog exponent, independently of the
  // legacy power. Explicitly sparse saved maps retain native legacy power 7.
  scene.fractalSource!.formula={...scene.fractalSource!.formula,parameters:{floats:{},complex:{}}};
  const sparse=sceneAtTime(scene,0);expect(sparse.evaluatedFractalScene!.formula.native.power).toBe(7);
  expect(mainEquation(evaluated)).toContain('z_n^{3}');expect(mainEquation(sparse)).toContain('z_n^{3}');expect(mainEquation(sparse)).not.toContain('z_n^{7}');
  scene.fractalSource!.formula={...scene.fractalSource!.formula,parameters:undefined};const absent=sceneAtTime(scene,0);expect(absent.evaluatedFractalScene!.formula.native.dynamicParams.slice(0,3)).toEqual([0,0,0]);expect(mainEquation(absent)).toContain('z_n^{0}');
 });
 it('requires evaluated facts for an automatic source label but preserves an explicit authored label',()=>{
  const scene=source();scene.formulas=defaultFormulas();scene.formulas.main.visible=true;
  expect(()=>formulaLabels(scene)).toThrow('时间线求值');scene.formulas.main.latex='z_{n+1}=f(z_n)';expect(formulaLabels(scene)[0].latex).toBe('z_{n+1}=f(z_n)');
 });
});
