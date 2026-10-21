import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {resolveFractalParameterBinding,complexCompanion,fractalParameterTargets} from '../src/engine/fractalParameterBindings';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
const scene=(formula:string)=>{const s=createScene(definitions[0]);s.settings.formula=formula;s.timeline.tracks=[];return s;};
const imported=(formula:string,parameters:Record<string,unknown>,settings:Record<string,unknown>={})=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'binding',fractal:{formula_id:formula,parameters:settings},timeline:[{type:'animate',duration:0,actions:[{method:'paramStart',args:[{parameters}]}]},{type:'wait',duration:4}]}));
describe('source formula parameter binding ownership',()=>{
 it('distinguishes scalar power from full complex exponent and suffix modes',()=>{expect(resolveFractalParameterBinding(scene('mandelbrot'),'power')).toEqual({target:'settings.power'});expect(resolveFractalParameterBinding(scene('newton'),'exponent')).toEqual({target:'settings.power',binding:{mode:'complex-full',imaginaryTarget:'settings.powerImag'}});expect(resolveFractalParameterBinding(scene('newton'),'exponent_im')).toEqual({target:'settings.powerImag'});expect(resolveFractalParameterBinding(scene('spiral_septagon'),'exponent_im')).toEqual({target:'settings.power'});expect(resolveFractalParameterBinding(scene('newton'),'start_value_re')).toBeUndefined();});
 it('covers each implemented complex slot and keeps unsupported independent slots unknown',()=>{for(const [formula,name,real,imag]of [['mandelbrot','start_point','startReal','startImag'],['nova','start_value','startReal','startImag'],['julia','julia_seed','juliaReal','juliaImag'],['phoenix','distortion','feedback','feedbackImag'],['magnet1','perturbation','startReal','startImag'],['magnet2','parameter','juliaReal','juliaImag'],['binocular','quad_coeff','quadReal','quadImag'],['binocular','const_term','constReal','constImag'],['binocular','z0_coeff','z0Real','z0Imag']]){const s=scene(formula);expect(resolveFractalParameterBinding(s,name)).toEqual({target:'settings.'+real,binding:{mode:'complex-full',imaginaryTarget:'settings.'+imag}});expect(resolveFractalParameterBinding(s,name+'_re')).toEqual({target:'settings.'+real});expect(resolveFractalParameterBinding(s,name+'_im')).toEqual({target:'settings.'+imag});expect(complexCompanion(s,'settings.'+real)).toBe('settings.'+imag);expect(fractalParameterTargets(s)).toContain('settings.'+imag);}expect(resolveFractalParameterBinding(scene('lambda'),'lambda')).toBeUndefined();expect(resolveFractalParameterBinding(scene('phoenix'),'exponent2')).toEqual({target:'settings.phoenixPower2'});});
 it.each(['newton','nova'])('keeps %s full-complex identity and maps the captured imaginary component through native state',formula=>{
  const {scene:s}=imported(formula,{exponent:{min:2,max:4,step:.01}},{exponent:[3,.7]});
  const action=s.timeline.tracks[0].fractalSource!.parameters[0];
  expect(action).toMatchObject({kind:'start',scope:{kind:'named',name:'exponent'},configuration:{min:2,max:4,step:Math.fround(.01)}});
  expect(s.timeline.tracks[0].actions).toBeUndefined();
  const frame=sceneAtTime(s,2).evaluatedFractalScene!;
  const exponent=frame.formula.parameters.complex.exponent;
  expect(exponent[0]).toBeGreaterThan(3);expect(exponent[0]).toBeLessThanOrEqual(4);expect(exponent[1]).toBe(.7);
  expect(frame.formula.native.power).toBe(Math.floor(exponent[0]+.5));
  expect(frame.formula.native.formulaParams).toEqual([frame.formula.native.power,1,0,0]);
  expect(frame.formula.native.dynamicParams.slice(0,4)).toEqual([Math.fround(exponent[0]),Math.fround(.7),1,Math.fround(.001)]);
  expect(s.fractalSource!.formula.parameters!.complex.exponent).toEqual([3,.7]);
  const restored=parseScene(JSON.stringify(s));
  expect(restored.timeline.tracks[0].fractalSource).toEqual(s.timeline.tracks[0].fractalSource);
  expect(restored.fractalSource).toEqual(s.fractalSource);
  expect(sceneAtTime(restored,2).evaluatedFractalScene).toEqual(frame);
 });
 it.each(['newton','nova'])('keeps %s real and imaginary registry oscillators independent',formula=>{
  const {scene:s}=imported(formula,{exponent_re:{min:2,max:4,step:.01},exponent_im:{min:-1,max:1,step:-.01}},{exponent:[3,0]});
  const actions=s.timeline.tracks[0].fractalSource!.parameters;
  expect(actions).toHaveLength(2);expect(actions.map(a=>a.scope)).toEqual(expect.arrayContaining([{kind:'named',name:'exponent_re'},{kind:'named',name:'exponent_im'}]));
  const frame=sceneAtTime(s,1).evaluatedFractalScene!,exponent=frame.formula.parameters.complex.exponent;
  expect(exponent[0]).toBeGreaterThan(3);expect(exponent[0]).toBeLessThanOrEqual(4);
  expect(exponent[1]).toBeLessThan(0);expect(exponent[1]).toBeGreaterThanOrEqual(-1);
  expect(frame.formula.native.dynamicParams.slice(0,2)).toEqual(exponent.map(Math.fround));
  expect(frame.formula.native.power).toBe(Math.floor(exponent[0]+.5));
  expect(s.fractalSource!.formula.parameters!.complex.exponent).toEqual([3,0]);
 });
 // Original JVM fixtures cover unknown metadata and full/component names;
 // the public scene boundary must preserve their identity before that owner.
 it.each([['newton','start_value'],['nova','Exponent_im ']])('retains unknown %s metadata name %j without changing native state',(formula,name)=>{
  const known={exponent:{min:2,max:4,step:.01}},unknown={min:-5,max:5,step:.5};
  const result=imported(formula,{...known,[name]:unknown},{exponent:[3,.7]});
  const control=imported(formula,known,{exponent:[3,.7]}).scene;
  expect(result.source).toHaveProperty(['timeline','0','actions','0','args','0','parameters',name],unknown);
  const restored=parseScene(JSON.stringify(result.scene));
  expect(restored.timeline.tracks[0].fractalSource!.parameters).toContainEqual(expect.objectContaining({kind:'start',scope:{kind:'named',name}}));
  for(const time of [0,1,2]){
   const actual=sceneAtTime(restored,time).evaluatedFractalScene!,expected=sceneAtTime(control,time).evaluatedFractalScene!;
   expect(actual.formula).toEqual(expected.formula);expect(actual.scene.object).toEqual(expected.scene.object);
   expect(actual.formula.parameters.complex).not.toHaveProperty(name);expect(actual.formula.parameters.floats).not.toHaveProperty(name);
  }
 });
 it('validates source parameter payload and nested edge data before evaluation or persistence',()=>{
  const {scene:s}=imported('nova',{exponent:{min:2,max:4,step:.01}});
  const mixed=JSON.parse(JSON.stringify(s));
  mixed.timeline.tracks[0].fractalSource.parameters[0].binding={mode:'complex-full',imaginaryTarget:'settings.zoom'};
  expect(()=>sceneAtTime(mixed,1)).toThrow('未知字段');expect(()=>parseScene(JSON.stringify(mixed))).toThrow('未知字段');
  const badEdge=JSON.parse(JSON.stringify(s));
  badEdge.timeline.tracks[0].fractalSource.parameters[0].configuration.edgeEasing.easing='unknown';
  expect(()=>sceneAtTime(badEdge,1)).toThrow('未知端点缓动');expect(()=>parseScene(JSON.stringify(badEdge))).toThrow('未知端点缓动');
 });
});
