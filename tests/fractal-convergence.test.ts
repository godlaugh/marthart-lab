import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions,fractalConfig,fractalOrbit} from '../src/scenes/complex';
import {dc} from '../src/engine/doubleDouble';
import {doubleDoubleOrbit} from '../src/engine/fractalPrecision';
import {convergenceColorIndex,convergenceStep,convergenceTolerance} from '../src/engine/fractalConvergence';
import {parseFractalColors,shadeFractalOrbit,fractalColorControls} from '../src/engine/fractalColor';
import {paletteColor} from '../src/engine/palette';
import {FractalGpu} from '../src/engine/fractalGpu';
import {visible2DFractalControls} from '../src/components/FractalControls';
import {parseLegacyScene} from '../src/engine/legacyImport';

const definition=definitions.find(d=>d.kind==='fractal')!;
const config=(extra={})=>fractalConfig({...definition.defaults.settings,formula:'newton',power:2,iterations:40,tolerance:.1,convergenceMode:'step',...extra});
describe('Newton/Nova step-convergence contract',()=>{
 it('retains the measured exit instead of the earlier polynomial-residual stop',()=>{
  const c=config(),o=fractalOrbit([2,0],c),last=1.025,next=(last+1/last)/2;
  expect(o).toMatchObject({count:3,inside:false,invalid:false,converged:true,convergence:{iteration:2}});
  expect(o.z[0]).toBeCloseTo(next,14);expect(o.convergence!.distance).toBeCloseTo(Math.abs(next-last),15);
  expect(fractalOrbit([2,0],{...c,convergenceMode:'legacy'})).toMatchObject({count:2,inside:true,converged:true});
  expect(convergenceStep(.1,0,.1,0)).toBeUndefined();expect(convergenceStep(NaN,0,.1,0)).toBeUndefined();
  expect(convergenceStep(1e200,0,1e201,0)).toEqual({iteration:0,metric:'step',distance:1e200,colorResidual:1e200});
  expect(fractalOrbit([1e200,0],config({power:1,iterations:1,tolerance:1e201}))).toMatchObject({inside:false,converged:true,convergence:{distance:1e200}});
 });
 it('holds a singular Newton derivative before Nova adds its constant',()=>{
  expect(fractalOrbit([0,0],config())).toMatchObject({z:[0,0],count:1,inside:false,invalid:false,convergence:{iteration:0,distance:0}});
  expect(fractalOrbit([2,0],config({formula:'nova',startReal:0,iterations:1}))).toMatchObject({z:[2,0],count:1,inside:true,invalid:false,converged:false});
  expect(fractalOrbit([0,0],config({convergenceMode:'legacy'})).invalid).toBe(true);
 });
 it('distinguishes iteration exhaustion and nonfinite math from convergence',()=>{
  expect(fractalOrbit([2,0],config({iterations:1}))).toMatchObject({count:1,inside:true,converged:false});
  const large=fractalOrbit([1e13,0],config({iterations:2}));expect(large).toMatchObject({count:2,inside:true,converged:false});
  const overflow=fractalOrbit([1e100,0],config({power:32}));expect(overflow.invalid).toBe(true);expect(overflow.convergence).toBeUndefined();
 });
 it('uses the same exit contract for DD while retaining sub-double displacements',()=>{
  const ordinary=fractalOrbit([2,.2],config()),precise=doubleDoubleOrbit(dc(2,.2),config());
  expect(precise.count).toBe(ordinary.count);expect(precise.inside).toBe(false);expect(precise.convergence!.distance).toBeCloseTo(ordinary.convergence!.distance,15);
  const tiny=doubleDoubleOrbit(dc(1,0,1e-20),config({tolerance:1e-14}));
  expect(tiny.convergence!.distance/1e-20).toBeCloseTo(1,12);expect(fractalOrbit([1,0],config()).convergence!.distance).toBe(0);
 });
 it('derives Nova tolerance from actual resolution and zoom without mutating the user value',()=>{
  const nova=config({formula:'nova',tolerance:.01});
  expect(convergenceTolerance(nova,1,400,200)).toBe(.01);
  expect(convergenceTolerance(nova,100,400,200)).toBe(.0064);
  expect(convergenceTolerance(nova,1e12,400,200)).toBe(.00001);
  expect(convergenceTolerance(config({formula:'nova',tolerance:1e-14}),1e20,400,200)).toBe(1e-12);
  expect(convergenceTolerance(config(),1e20,400,200)).toBe(.1);expect(nova.tolerance).toBe(.01);
  expect(convergenceTolerance(config({tolerance:0}),1,400,200)).toBe(1e-12);
  expect(fractalOrbit([2,0],config({tolerance:2})).convergence!.iteration).toBe(0);
  expect(()=>config({tolerance:-1})).toThrow();expect(()=>config({convergenceMode:'legacy',tolerance:2})).toThrow();
 });
 it('colors a convergent exit using outside residual smoothing independent of exponent and escape settings',()=>{
  const c=config(),o=fractalOrbit([2,0],c),s=createScene(definition);
  Object.assign(s.settings,{outsideColorDensity:1,outsideTransfer:'none',outsideGradientOffset:0,insideColoring:'none',insideSolidColor:'#000000',outsideColoring:'smooth_mandelbrot'});
  const index=.05*(3-Math.log2(-Math.log(Math.abs(o.z[0]-1.025))));
  expect(convergenceColorIndex(o.convergence!)).toBeCloseTo(index,12);
  expect(fractalColorControls(parseFractalColors(s).outside,true).some(c=>c.key.includes('Smooth'))).toBe(false);
  expect(fractalColorControls({...parseFractalColors(s).inside,algorithm:'smooth_mandelbrot'}).some(c=>c.key.includes('Smooth'))).toBe(false);
  const color=shadeFractalOrbit(o,c,parseFractalColors(s));expect(color).toEqual(paletteColor(s.palette,convergenceColorIndex(o.convergence!)));
  Object.assign(s.settings,{outsideSmoothSource:'complex',outsideSmoothReal:8,outsideSmoothImag:3,outsideSmoothBailout:100});
  expect(shadeFractalOrbit(o,c,parseFractalColors(s))).toEqual(color);
  s.settings.outsideColoring='basic';expect(shadeFractalOrbit(o,c,parseFractalColors(s))).toEqual(paletteColor(s.palette,.02));
  expect(Number.isFinite(convergenceColorIndex({iteration:0,colorResidual:0}))).toBe(true);
 });
 it('keeps prior CPU image goldens and missing-mode document compatibility',()=>{
  const hashes={newton:'c8a1b7197cff2c1b0a1b3121c8e4ad450ec5ac549e6108c8e8bb18e534f6113e',nova:'ae5a1be4a6c8ea007a367376cdf53ad6403237a95144050ab36ad503a4314722'};
  for(const formula of ['newton','nova'] as const)for(const colorVersion of [1,2]){
   const s=createScene(definition);Object.assign(s.settings,{formula,fractalColorVersion:colorVersion,insideColoring:'decomposition',outsideColoring:'smooth_mandelbrot',fractalBackend:'cpu',renderMethod:'one-pass',power:3,startReal:1,iterations:40,centerX:0,centerY:0,zoom:1});delete s.settings.convergenceMode;delete s.settings.fractalDistanceVersion;
   const out=definition.generate(parseScene(JSON.stringify(s)),{time:0,quality:'export',width:40,height:30});expect(out.type).toBe('raster');if(out.type!=='raster')throw Error('raster required');
   expect(createHash('sha256').update(out.pixels).digest('hex')).toBe(hashes[formula]);
  }
 });
 it('preserves the explicit mode on reload and reports actual CPU use for GPU requests',()=>{
  const s=createScene(definition);Object.assign(s.settings,{formula:'newton',power:2,convergenceMode:'step',fractalBackend:'webgl2',renderMethod:'one-pass'});
  const reloaded=parseScene(JSON.stringify(s)),out=definition.generate(reloaded,{time:0,quality:'export',width:32,height:24});
  expect(reloaded.settings.convergenceMode).toBe('step');expect(out.backend).toBe('cpu');expect(out.stats.samples).toBe(768);expect(out.stats.generated).toBe(768);expect(out.warnings!.join(' ')).toContain('保留残差');
  const gpu=new FractalGpu();expect(gpu.sample(new Float32Array([0,0]),1,1,{centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0},config()).warning).toContain('保留残差');gpu.dispose();
  expect(visible2DFractalControls(definition.controls,s.settings).map(c=>c.key)).toContain('convergenceMode');
  expect(visible2DFractalControls(definition.controls,{...s.settings,formula:'mandelbrot'}).map(c=>c.key)).not.toContain('convergenceMode');
  expect(()=>fractalConfig({...s.settings,convergenceMode:'unknown'})).toThrow();
 });
 it('imports source bailout as convergence tolerance including zero, large values and the observed default',()=>{
  for(const formula of ['newton','nova'])for(const tolerance of [undefined,0,.02,2,-1]){
   const source={config_version:'1.0.0',type:'FRACTAL',name:'Convergence import',fractal:{formula_id:formula,parameters:tolerance===undefined?{}:{bailout:tolerance,convergent_bailout:-2,exponent1:9}}};
   const imported=parseLegacyScene(JSON.stringify(source));expect(imported.source).toEqual(source);
   expect(imported.scene.settings).toMatchObject({convergenceMode:'step',tolerance:tolerance===undefined?.001:tolerance,bailout:4});
   expect(imported.scene.settings.power).toBe(3);
   if(formula==='nova')expect(imported.scene.settings).toMatchObject({startReal:1,startImag:0,juliaReal:0,juliaImag:0});
   expect(imported.warnings.join(' ')).toContain('逻辑 PGraphics');expect(fractalConfig(imported.scene.settings).convergenceMode).toBe('step');
  }
 });
});
