import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {definitions,fractalConfig,fractalOrbit,fractalEquationLatex} from '../src/scenes/complex';
import {visible2DFractalControls} from '../src/components/FractalControls';
import {sceneAtTime} from '../src/engine/timeline';
const scene=()=>createScene(definitions[0]);
const imported=(formula:string,parameters:Record<string,unknown>,type='JULIA',timeline:unknown[]=[])=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'formula semantics',fractal:{formula_id:formula,type,parameters},timeline}));
describe('Phoenix executable exponent semantics and Lambda source precedence',()=>{
 it('retains fractional source settings but produces shared integer exponent facts',()=>{
  const s=scene();Object.assign(s.settings,{formula:'phoenix',power:2.49,powerImag:.8,phoenixPower2:2.49});
  expect(fractalConfig(s.settings)).toMatchObject({power:[2,0],phoenixPower2:2});
  s.settings.power=2.5;s.settings.phoenixPower2=2.5;expect(fractalConfig(s.settings)).toMatchObject({power:[3,0],phoenixPower2:3});
  expect(parseScene(JSON.stringify(s)).settings.power).toBe(2.5);expect(fractalEquationLatex(s.settings)).toContain('z_{n-1}^{3}');
  s.settings.power=.1;s.settings.phoenixPower2=0;expect(fractalConfig(s.settings)).toMatchObject({power:[2,0],phoenixPower2:1});
 });
 it('matches an independent real three-step recurrence and preserves zero-history semantics',()=>{
  for(const rawHistory of [0,.49,1,1.49,1.5,2.5]){
   const s=scene();Object.assign(s.settings,{formula:'phoenix',variant:'mandelbrot',iterations:3,power:2.6,startReal:.2,startImag:0,feedback:.1,feedbackImag:0,phoenixPower2:rawHistory,bailout:100});
   let z=.2,previous=0;const exponent=Math.max(1,Math.floor(rawHistory+.5));for(let i=0;i<3;i++){const next=z**3+.15+.1*previous**exponent;previous=z;z=next;}
   const orbit=fractalOrbit([.15,0],fractalConfig(s.settings));expect(orbit.invalid).toBe(false);expect(orbit.z[0]).toBeCloseTo(z,14);expect(orbit.z[1]).toBe(0);
  }
 });
 it('preserves old independent complex powers when the mode is absent',()=>{
  const s=scene();Object.assign(s.settings,{formula:'phoenix',power:2.4,powerImag:.3,phoenixPower2:3});delete s.settings.phoenixExponentMode;
  const parsed=parseScene(JSON.stringify(s));expect(fractalConfig(parsed.settings).power).toEqual([2.4,.3]);
  expect(visible2DFractalControls(definitions[0].controls,s.settings).map(c=>c.key)).toContain('powerImag');
  s.settings.phoenixExponentMode='rounded';expect(visible2DFractalControls(definitions[0].controls,s.settings).map(c=>c.key)).not.toContain('powerImag');
 });
 it('rejects invalid exponent policies and out-of-bound finite inputs at the producer',()=>{
  expect(()=>fractalConfig({formula:'phoenix',phoenixExponentMode:'unknown'})).toThrow();
  for(const phoenixPower2 of [-1,33,Infinity,NaN])expect(()=>fractalConfig({formula:'phoenix',phoenixPower2})).toThrow();
 });
 it('imports Phoenix catalog defaults and actually animates fractional exponent2 through the shared owner',()=>{
  const out=imported('phoenix',{exponent1:2.7,exponent2:1.25,distortion:[.3,.1]},'JULIA',[{type:'animate',duration:0,actions:[{method:'paramStart',args:[{parameters:{exponent2:{min:1,max:3,step:.01}}}]}]},{type:'wait',duration:3}]);
  expect(out.scene.settings).toMatchObject({phoenixExponentMode:'rounded',phoenixPower2:1.25,juliaReal:0,juliaImag:0});
  const after=sceneAtTime(out.scene,1);expect(after.settings.phoenixPower2).not.toBe(1.25);expect(Number.isInteger(after.settings.phoenixPower2)).toBe(false);expect(Number.isInteger(fractalConfig(after.settings).phoenixPower2)).toBe(true);
 });
 it('uses the Lambda JSON binder default seed instead of inventing an independent coefficient',()=>{
  const result=imported('lambda',{lambda:[3,.2]});expect(result.scene.settings).toMatchObject({juliaReal:.6,juliaImag:0,startReal:.5,startImag:0});
  expect((result.source as any).fractal.parameters.lambda).toEqual([3,.2]);expect(result.warnings.join()).toContain('没有独立 lambda 加法项');
  const c=fractalConfig({...result.scene.settings,iterations:1}),orbit=fractalOrbit([.25,0],c);expect(orbit.z).toEqual([.6*.25*.75,0]);
  const explicit=imported('lambda',{lambda:[3,.2],julia_seed:[.8,.1]});expect(explicit.scene.settings).toMatchObject({juliaReal:.8,juliaImag:.1});
  const mandelbrot=fractalOrbit([.8,0],fractalConfig({...result.scene.settings,variant:'mandelbrot',iterations:1}));expect(mandelbrot.z).toEqual([.2,0]);
 });
});
