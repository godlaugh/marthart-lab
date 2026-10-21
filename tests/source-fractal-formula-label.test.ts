import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {defaultFormulas,formulaLabels,formulaPresentation,mainEquation,validateFormulaPresentation} from '../src/engine/formulas';
import {renderFormulaSvg} from '../src/engine/formulaSvg';
import {parseScene,serializeScene} from '../src/engine/document';

const source=(extra:Record<string,unknown>={},timeline:unknown[]=[])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Source label',fractal:{formula_id:'nova',type:'JULIA',parameters:{exponent:[3,0],relaxation:.5,bailout:.001,julia_seed:[.123456789012345,-.23456789012345]},...extra},timeline})).scene;

describe('source formula text is bound to construction input, independently of animated native slots',()=>{
 it('keeps initial template text while real source parameter animation changes native slots',()=>{
  const scene=source({},[{type:'animate',duration:0,actions:[{method:'paramStart',args:[{parameters:{exponent:{min:2,max:4,step:.01}}}]}]},{type:'wait',duration:2}]);
  scene.formulas=defaultFormulas();scene.formulas.main.visible=true;
  Object.assign(scene.settings,{formula:'mandelbulb_3d',power:'invalid',variant:'invalid',relaxation:'invalid'});
  const initial=formulaPresentation(scene),first=sceneAtTime(scene,0),later=sceneAtTime(scene,.5),before=structuredClone(later);
  expect(later.evaluatedFractalScene!.formula.native.dynamicParams[0]).not.toBe(first.evaluatedFractalScene!.formula.native.dynamicParams[0]);
  expect(formulaPresentation(later)).toEqual(initial);expect(formulaLabels(first)).toEqual(initial.labels);
  expect(initial.labels[0].latex).toBe(String.raw`z_{n+1} = z_n - 0.5 \frac{z_n^3 - 1}{3 z_n^{3-1}} + 0.1235 - 0.2346i`);
  expect(renderFormulaSvg(initial.labels[0].latex,'#ffffff').source).toContain('<path');expect(later).toEqual(before);
 });
 it('reconstructs template text from the newly loaded canonical config through save/reopen',()=>{
  const scene=source(),novaText=mainEquation(scene);
  expect(novaText).toContain(' + 0.1235 - 0.2346i');
  scene.fractalSource!.formula={...scene.fractalSource!.formula,formulaId:'newton',parameters:{floats:{relaxation:.5,bailout:Math.fround(.001)},complex:{exponent:[4,0]}}};
  expect(scene.settings.formula).toBe('nova');const restored=parseScene(serializeScene(scene)),newtonText=mainEquation(restored);
  expect(newtonText).toBe(String.raw`z_{n+1} = z_n - 0.5 \frac{z_n^4 - 1}{4 z_n^{4-1}}`);
 });
 it('uses catalog label defaults for absent and sparse ParamSets, not legacy or shader fallback power',()=>{
  const scene=source({formula_id:'newton',power:7,parameters:{}});
  scene.fractalSource!.formula={...scene.fractalSource!.formula,parameters:{floats:{},complex:{}}};
  const sparse=sceneAtTime(scene,0);expect(sparse.evaluatedFractalScene!.formula.native.power).toBe(7);expect(mainEquation(sparse)).toContain('z_n^3');
  scene.fractalSource!.formula={...scene.fractalSource!.formula,parameters:undefined};const absent=sceneAtTime(scene,0);
  expect(absent.evaluatedFractalScene!.formula.native.dynamicParams.slice(0,3)).toEqual([0,0,0]);expect(mainEquation(absent)).toContain('z_n^3');
 });
 it('preserves explicit custom main text as a local extension and returns authoritative empty labels',()=>{
  const scene=source();scene.formulas=defaultFormulas();scene.formulas.main.visible=true;expect(formulaLabels(scene)[0].latex).toContain('z_n^3');
  scene.formulas.main.latex='z_{n+1}=f(z_n)';expect(formulaLabels(scene)[0].latex).toBe('z_{n+1}=f(z_n)');
  scene.formulas.main.visible=false;expect(formulaPresentation(scene)).toEqual({referenceWidth:1280,referenceHeight:720,labels:[]});
 });
 it('validates delivered label bounds, identity and visibility without trusting transport casts',()=>{
  const scene=source();scene.formulas=defaultFormulas();scene.formulas.main.visible=true;const valid=formulaPresentation(scene);
  for(const value of [null,[],{...valid,referenceWidth:Infinity},{...valid,labels:[{...valid.labels[0],visible:false}]},{...valid,labels:[{...valid.labels[0],scale:NaN}]},{...valid,labels:[valid.labels[0],valid.labels[0]]}])expect(()=>validateFormulaPresentation(value)).toThrow();
  const parsed=validateFormulaPresentation(valid);parsed.labels[0].latex='external';expect(valid.labels[0].latex).not.toBe('external');
 });
});
