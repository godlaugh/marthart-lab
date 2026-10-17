import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions,fractalConfig,fractalOrbit} from '../src/scenes/complex';
import {convergenceColorIndex} from '../src/engine/fractalConvergence';
import {parseFractalColors,shadeFractalOrbit} from '../src/engine/fractalColor';
import {paletteColor} from '../src/engine/palette';
import {visible2DFractalControls} from '../src/components/FractalControls';
import {FractalGpu} from '../src/engine/fractalGpu';
import {parseLegacyScene} from '../src/engine/legacyImport';

const definition=definitions.find(d=>d.kind==='fractal')!;
const config=(formula:string,extra={})=>fractalConfig({...definition.defaults.settings,formula,convergenceMode:'residual',power:4,iterations:1,tolerance:1,bailout:4,startReal:0,startImag:0,juliaReal:0,juliaImag:0,...extra});
describe('Magnet and Binocular residual exit production contract',()=>{
 it('keeps Magnet I stopping distance separate from the shader zero coloring residual',()=>{
  // c=0,z0=0 gives ((-1)/(-2))²=1/4; distance to1=3/4.
  const o=fractalOrbit([0,0],config('magnet1'));
  expect(o).toMatchObject({z:[.25,0],inside:false,converged:true,count:1,colorIteration:0,convergence:{iteration:0,metric:'fixed-point',distance:.75,colorResidual:0}});
  expect(convergenceColorIndex(o.convergence!)).toBeCloseTo(.05*(1-Math.log(-Math.log(1e-30))/.69314718056),14);
 });
 it('uses different Magnet II Julia and Mandelbrot criteria and preserves strict boundaries',()=>{
  // c=0,z0=0 gives (2/3)²=4/9. Step4/9<.5 while distance to1=5/9>.5.
  const julia=fractalOrbit([0,0],config('magnet2',{variant:'julia',tolerance:.5}));
  expect(julia).toMatchObject({inside:false,converged:true,convergence:{metric:'step'}});
  expect(julia.convergence!.distance).toBeCloseTo(4/9,14);expect(julia.convergence!.colorResidual).toBe(julia.convergence!.distance);
  expect(fractalOrbit([0,0],config('magnet2',{tolerance:.5}))).toMatchObject({inside:true,converged:false,colorIteration:0});
  const fixed=fractalOrbit([0,0],config('magnet2'));expect(fixed.convergence!.metric).toBe('fixed-point');expect(fixed.convergence!.colorResidual).toBeCloseTo(5/9,14);
  expect(fractalOrbit([0,0],config('magnet1',{tolerance:.75})).converged).toBe(false);
  expect(fractalOrbit([0,0],config('magnet1',{tolerance:0})).converged).toBe(false);
 });
 it('gates Magnet convergence by strict escape radius and uses source singular safe division',()=>{
  // c=3 gives4: equality with escape radius must escape even with a loose convergence tolerance.
  expect(fractalOrbit([3,0],config('magnet1',{tolerance:10}))).toMatchObject({z:[4,0],inside:false,converged:false,colorIteration:0});
  expect(fractalOrbit([2,0],config('magnet1',{tolerance:0}))).toMatchObject({z:[0,0],inside:true,invalid:false,converged:false});
  expect(fractalOrbit([2,0],{...config('magnet1',{tolerance:.01}),convergenceMode:'legacy'}).invalid).toBe(true);
  expect(config('magnet1',{bailout:0}).bailout).toBe(1e-6);
  expect(fractalOrbit([0,0],config('magnet1',{startReal:1e200})).invalid).toBe(true);
 });
 it('retains Binocular step residual, exhaustion and divergent-sentinel outcomes',()=>{
  // z0=1,m=4 gives (1+1+1)/(2-1+1)=1.5.
  const o=fractalOrbit([1,0],config('binocular'));
  expect(o).toMatchObject({z:[1.5,0],inside:false,converged:true,convergence:{metric:'step',distance:.5,colorResidual:.5}});
  expect(fractalOrbit([1,0],config('binocular',{tolerance:.5}))).toMatchObject({inside:true,converged:false});
  expect(fractalOrbit([0,0],config('binocular',{denomOffset:0}))).toMatchObject({z:[1e30,0],inside:false,invalid:false,converged:false});
  expect(fractalOrbit([1,0],config('binocular',{relaxation:0.01,tolerance:0})).converged).toBe(false);
  expect(fractalOrbit([1,0],config('binocular',{relaxation:0,tolerance:0}))).toMatchObject({convergence:{metric:'step',distance:0,colorResidual:0},inside:false});
 });
 it('routes residual exits to outside colors and leaves escaped exponent controls meaningful',()=>{
  const s=createScene(definition);Object.assign(s.settings,{fractalColorVersion:2,insideColoring:'none',insideSolidColor:'#000000',outsideColoring:'smooth_mandelbrot',outsideColorDensity:1,outsideTransfer:'none',outsideGradientOffset:0});
  const c=config('magnet2'),o=fractalOrbit([0,0],c);
  const color=shadeFractalOrbit(o,c,parseFractalColors(s));expect(color).toEqual(paletteColor(s.palette,convergenceColorIndex(o.convergence!)));
  Object.assign(s.settings,{outsideSmoothSource:'complex',outsideSmoothReal:8,outsideSmoothImag:3,outsideSmoothBailout:100});expect(shadeFractalOrbit(o,c,parseFractalColors(s))).toEqual(color);
  s.settings.outsideColoring='basic';expect(shadeFractalOrbit(o,c,parseFractalColors(s))).toEqual(paletteColor(s.palette,0));
 });
 it('preserves the six prior legacy images when mode is absent or explicitly legacy',()=>{
  const hashes=[['magnet1','mandelbrot','699ae9edbc30851e7ee3871aadac7d5148c61097811286a396ef06626c71aa8c'],['magnet1','julia','7aaf351c387c09679eb5dbd595b5a4729bb7d1ac7b9db2dd4b30f2409c2199fb'],['magnet2','mandelbrot','c95e436f862e140940e1906f42c70775f9acfb6813da13de9594700481dcf22a'],['magnet2','julia','c884ea2b858213c38ff86d7ec61bd5ce0711d1ff7f6a1d755f2760e747bf9a18'],['binocular','mandelbrot','fe5a400385d291999c28ba875a2c0fbf8fbe98fbd3d2a7874d30f8db51ba72f7'],['binocular','julia','fe5a400385d291999c28ba875a2c0fbf8fbe98fbd3d2a7874d30f8db51ba72f7']];
  for(const[formula,variant,hash]of hashes)for(const mode of [undefined,'legacy']){
   const s=createScene(definition);Object.assign(s.settings,{formula,variant,fractalColorVersion:2,fractalBackend:'cpu',renderMethod:'one-pass',iterations:40,power:4,tolerance:.001,centerX:1,centerY:0,zoom:1});if(mode)s.settings.convergenceMode=mode;else delete s.settings.convergenceMode;
   const out=definition.generate(parseScene(JSON.stringify(s)),{time:0,quality:'export',width:40,height:30});if(out.type!=='raster')throw Error('raster required');expect(createHash('sha256').update(out.pixels).digest('hex')).toBe(hash);
  }
 });
 it('imports actual source fields, defaults and large or zero convergence thresholds without reinterpreting them as escape',()=>{
  for(const formula of ['magnet1','magnet2','binocular'])for(const bailout of [undefined,0,.001,2,-1]){
   const source={config_version:'1.0.0',type:'FRACTAL',name:'Residual import',fractal:{formula_id:formula,parameters:bailout===undefined?{}:{bailout}}};
   const imported=parseLegacyScene(JSON.stringify(source)),s=imported.scene.settings;expect(imported.source).toEqual(source);expect(s.convergenceMode).toBe('residual');expect(s.fractalColorVersion).toBe(2);
   if(formula==='binocular'){expect(s.tolerance).toBe(bailout===undefined?.001:Math.max(0,bailout));expect(s.power).toBe(4);}
   else{expect(s.bailout).toBe(bailout===undefined?30:Math.max(0,bailout));expect(s.tolerance).toBe(formula==='magnet1'?.001:.00005);}
   expect(s.juliaReal).toBe(0);expect(s.juliaImag).toBe(0);expect(()=>fractalConfig(s)).not.toThrow();
  }
  const explicit={config_version:'1.0.0',type:'FRACTAL',name:'Explicit Magnet',fractal:{formula_id:'magnet2',parameters:{perturbation:[.2,.3],parameter:[.4,.5],julia_seed:[.6,.7],start_value:[.8,.9],convergent_bailout:0}}};
  const imported=parseLegacyScene(JSON.stringify(explicit));expect(imported.source).toEqual(explicit);expect(imported.scene.settings).toMatchObject({startReal:.2,startImag:.3,juliaReal:.4,juliaImag:.5,tolerance:0});
  const aliases={...explicit,fractal:{formula_id:'magnet2',parameters:{julia_seed:[.6,.7],start_value:[.8,.9]}}};const retained=parseLegacyScene(JSON.stringify(aliases));expect(retained.source).toEqual(aliases);expect(retained.scene.settings).toMatchObject({startReal:0,startImag:0,juliaReal:0,juliaImag:0});expect(retained.warnings.join(' ')).toContain('未把旧别名当作回退');
 });
 it('rejects contradictory legacy color settings instead of calling escape-style colors residual smoothing',()=>{
  const s=createScene(definition);Object.assign(s.settings,{formula:'magnet1',convergenceMode:'residual',fractalColorVersion:1});delete s.settings.fractalDistanceVersion;expect(()=>definition.generate(s,{time:0,quality:'export',width:16,height:12})).toThrow('独立内外着色');
 });
 it('runs full requested pixels and preserves mode when WebGL2 is unavailable',()=>{
  const s=createScene(definition);Object.assign(s.settings,{formula:'magnet2',convergenceMode:'residual',fractalBackend:'webgl2',renderMethod:'one-pass',iterations:24});const restored=parseScene(JSON.stringify(s));
  const out=definition.generate(restored,{time:0,quality:'export',width:32,height:24});expect(out.backend).toBe('cpu');expect(out.stats.samples).toBe(768);expect(out.warnings!.join(' ')).toContain('OffscreenCanvas');expect(restored.settings.convergenceMode).toBe('residual');
  const controls=visible2DFractalControls(definition.controls,s.settings);expect(controls.find(c=>c.key==='convergenceMode')!.options!.map(o=>o.value)).toEqual(['legacy','residual']);expect(controls.find(c=>c.key==='tolerance')!.min).toBe(0);
  const gpu=new FractalGpu();expect(gpu.sample(new Float32Array([0,0]),1,1,{centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0},config('magnet2')).warning).toContain('OffscreenCanvas');gpu.dispose();
 });
});
