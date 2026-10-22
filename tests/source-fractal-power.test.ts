import {describe,expect,it} from 'vitest';
import native from './fixtures/source-fractal-power-reference/native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {sourceFractalRenderInput} from '../src/engine/sourceFractalRender';
import {supportsSourceFractalLive} from '../src/engine/sourceFractalDocument';
import {buildFractalSourceReference,parseFractalSourceNativePlan,FRACTAL_SOURCE_POWER_PROFILE,FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import {fractalViewportRules,juliaSeedAtPointer,applyFractalJuliaSeed} from '../src/engine/complexViewport';
import {decodeFractalSourceTerminal} from '../src/engine/fractalNativeNewtonRaster';
const load=(formula='mandelbrot',power=2,parameters:unknown={power,bailout:4,julia_seed:[-.12,.034]})=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Source power',fractal:{formula_id:formula,power,parameters,iterations:12,zoom:100,center:[-.13,.017]}})).scene;
const plan=(scene=load())=>{
 const frame=sceneAtTime(scene,0),input=sourceFractalRenderInput(frame.evaluatedFractalScene);
 return parseFractalSourceNativePlan(input,{centerX:-.13,centerXLow:1e-19,centerY:.017,centerYLow:-1e-20,zoom:100,rotation:0},{logicalWidth:96,logicalHeight:72,provenance:'source-logical'},{precision:'medium'});
};
describe('source power profile production boundary',()=>{
 it.each(native.cases)('matches original JVM reference bytes for $formula power $power',row=>{
  const p=plan(load(row.formula,row.power)),reference=buildFractalSourceReference(p);
  expect(p.profile).toBe(FRACTAL_SOURCE_POWER_PROFILE);expect(p.perturbation).toMatchObject({enabled:true,reason:'ELIGIBLE'});
  expect(reference.kind).toBe('ready');if(reference.kind!=='ready')throw Error(reference.reason);
  expect(reference.length).toBe(row.length);expect(Array.from(new Uint32Array(reference.values.buffer))).toEqual(row.bits);
 });
 it('preserves imported parameters, source timeline and save/reopen identity',()=>{
  const original=load(),scene=parseScene(serializeScene(original));expect(scene.fractalSource).toEqual(original.fractalSource);expect(supportsSourceFractalLive(scene)).toBe(true);
  const frame=sceneAtTime(scene,0);expect(frame.evaluatedFractalScene?.formula.native).toMatchObject({power:2,bailout:4});expect(frame.evaluatedFractalScene?.scene.frame).toBeGreaterThan(0);
  expect(fractalViewportRules(scene.settings.fractalNumericProfile as typeof FRACTAL_SOURCE_POWER_PROFILE,'mandelbrot')).toMatchObject({sourceArithmetic:true,verticalRange:2,yDirection:'down'});
  expect(fractalViewportRules('local-v1','mandelbrot').verticalRange).toBe(4);expect(fractalViewportRules(FRACTAL_SOURCE_NUMERIC_PROFILE,'mandelbrot').verticalRange).toBe(4);
 });
 it('distinguishes sparse host perturbation gate from ordinary shader power',()=>{
  const absent=load('mandelbrot',7,undefined);absent.fractalSource={...absent.fractalSource!,formula:{...absent.fractalSource!.formula,parameters:undefined}};
  const p=plan(absent);expect(p.uniformPower).toBe(7);expect(p.shaderPower[0]).toBe(7);expect(p.perturbation).toMatchObject({enabled:false,reason:'POWER_FAMILY_CONDITION'});
  expect(plan(load('mandelbrot',2.5)).perturbation).toMatchObject({enabled:false,reason:'NON_INTEGER_POWER_UNSUPPORTED'});
 });
 it('uses the source plane for pointer Julia and changes its owning formula',()=>{
  const scene=load();scene.settings={...scene.settings,centerX:0,centerY:0,zoom:1};
  const picked=juliaSeedAtPointer(scene.settings,75,75,100,100);expect(picked.juliaReal).toBe(.5);expect(picked.juliaImag).toBe(.5);
  const julia=applyFractalJuliaSeed(scene,picked);expect(julia.fractalSource?.formula).toMatchObject({formulaId:'julia',fractalType:'julia',parameters:{complex:{julia_seed:[.5,.5]}}});expect(plan(julia).isJulia).toBe(true);
 });
 it('retains escape independently from iteration limit and convergence',()=>{
  expect(decodeFractalSourceTerminal(3,32768,12)).toMatchObject({escaped:true,converged:false,steps:4});
  expect(decodeFractalSourceTerminal(11,0,12)).toMatchObject({escaped:false,converged:false,steps:12});
  expect(()=>decodeFractalSourceTerminal(0,32769,12)).toThrow();
 });
});
