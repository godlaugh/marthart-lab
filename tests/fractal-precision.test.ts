import {describe,it,expect} from 'vitest';
import {dd,ddAdd,ddSub,ddMul,ddDiv,dc,dcNumbers,dcPow,dcSub} from '../src/engine/doubleDouble';
import {doubleDoubleOrbit,precisePixel,referenceOrbit,supportsDoubleDouble,type FractalViewport} from '../src/engine/fractalPrecision';
import {createScene,parseScene} from '../src/engine/document';
import {definitions,fractalConfig,fractalOrbit,fractalEquationLatex} from '../src/scenes/complex';
import {renderFormulaSvg} from '../src/engine/formulaSvg';
import {FractalGpu} from '../src/engine/fractalGpu';
import {parseLegacyScene} from '../src/engine/legacyImport';
const scene=()=>createScene(definitions[0]);
const view:FractalViewport={centerX:-.75,centerY:.1,centerXLow:0,centerYLow:0,zoom:1e20,rotation:0};
describe('DoubleDouble arithmetic and coordinates',()=>{
 it('retains low components below double precision and recovers cancellation',()=>{
  const a=dd(1,1e-30);expect(a[0]).toBe(1);expect(a[1]).toBe(1e-30);expect(ddSub(a,dd(1))[0]).toBe(1e-30);
  const product=ddMul(dd(1,2**-54),dd(1,-(2**-54)));expect(product[0]).toBe(1);expect(product[1]).toBe(-(2**-108));
  const quotient=ddDiv(dd(1),dd(3));expect(quotient[1]).not.toBe(0);expect(Math.abs(ddSub(ddMul(quotient,dd(3)),dd(1))[0])).toBeLessThan(1e-31);
  expect(ddAdd(dd(1e16),dd(1))).toEqual([1e16,1]);
  expect(ddMul(dd(1e308),dd(1e-308)).every(Number.isFinite)).toBe(true);
 });
 it('distinguishes adjacent 1e20 zoom pixels and preserves rotation and center low parts',()=>{
  const left=precisePixel(2,3,8,8,view),right=precisePixel(3,3,8,8,view);
  expect(dcNumbers(left)[0]).toBe(dcNumbers(right)[0]);expect(dcSub(right,left)[0][0]).toBeCloseTo(5e-21,32);
  const low=precisePixel(2,3,8,8,{...view,centerXLow:1e-25});expect(dcSub(low,left)[0][0]).toBeCloseTo(1e-25,32);
  const rotated=precisePixel(3.5,2.5,8,8,{...view,rotation:Math.PI/2});expect(dcSub(rotated,dc(view.centerX,view.centerY))[0][0]).toBeCloseTo(-5e-21,32);
 });
 it('computes complex integer powers and enforces the domain',()=>{expect(dcNumbers(dcPow(dc(1,1),4))).toEqual([-4,0]);expect(()=>dcPow(dc(1,1),33)).toThrow();});
 it('agrees with ordinary iteration on well conditioned points across supported families',()=>{
  for(const formula of ['mandelbrot','julia','newton','nova'])for(const point of [[-.5,.2],[1,.3],[2,.4]] as [number,number][]){
   const config=fractalConfig({...scene().settings,formula,power:3,startReal:1,iterations:40});const ordinary=fractalOrbit(point,config),precise=doubleDoubleOrbit(dc(...point),config);
   expect(precise.count,formula).toBe(ordinary.count);expect(precise.inside).toBe(ordinary.inside);expect(precise.invalid).toBe(ordinary.invalid);expect(precise.z[0]).toBeCloseTo(ordinary.z[0],7);expect(precise.z[1]).toBeCloseTo(ordinary.z[1],7);
  }
 });
 it('preserves a low center term in the DD orbit and rejects unsupported deep precision',()=>{
  const config=fractalConfig({...scene().settings,iterations:1});const ref=referenceOrbit(config,{...view,centerX:0,centerY:0,centerXLow:1e-25});expect(ref.length).toBe(2);expect(ref.values[4]).toBeCloseTo(1e-25,31);
  expect(supportsDoubleDouble({...config,power:[2.5,0]})).toBe(false);expect(supportsDoubleDouble({...config,formula:'phoenix'})).toBe(false);expect(()=>doubleDoubleOrbit(dc(0,0),{...config,formula:'phoenix'})).toThrow();
 });
});
describe('fractal render strategies',()=>{
 it('emits independent increasing progress frames and a fully evaluated final frame',()=>{
  const s=scene();Object.assign(s.settings,{fractalBackend:'cpu',renderMethod:'multi-pass',iterations:40});const progress:any[]=[];
  const final=definitions[0].generate(s,{time:0,quality:'preview',width:64,height:48,onProgress:o=>progress.push(o)});
  expect(progress.map(o=>[o.width,o.height])).toEqual([[8,6],[16,12],[32,24]]);expect(final.type).toBe('raster');if(final.type!=='raster')return;
  for(const o of progress){expect(o.pixels.buffer).not.toBe(final.pixels.buffer);expect(o.stats.generated).toBe(o.width*o.height);}expect(final.stats.generated).toBe(64*48);progress[2].pixels.fill(0);expect(final.pixels.some(v=>v!==0)).toBe(true);
 });
 it('uses bounded guessing with explicit approximation and forces full evaluation for export',()=>{
  const s=scene();Object.assign(s.settings,{fractalBackend:'cpu',renderMethod:'guessing',iterations:40,centerX:0,zoom:20});
  const preview=definitions[0].generate(s,{time:0,quality:'preview',width:64,height:48});expect(preview.stats.samples).toBeLessThan(64*48);expect(preview.warnings?.join(' ')).toContain('孤岛');
  const final=definitions[0].generate(s,{time:0,quality:'export',width:64,height:48});expect(final.stats.samples).toBe(64*48);expect(final.warnings?.join(' ')).toContain('One Pass');
 });
 it('renders DD beyond the old zoom ceiling and roundtrips its low components',()=>{
  const s=scene();Object.assign(s.settings,{fractalBackend:'cpu',renderMethod:'one-pass',zoom:1e20,centerXLow:1e-25,iterations:20});const restored=parseScene(JSON.stringify(s));
  const result=definitions[0].generate(restored,{time:0,quality:'preview',width:8,height:8});expect(result.stats.generated).toBe(64);expect(result.warnings?.join(' ')).toContain('DoubleDouble');expect(restored.settings.centerXLow).toBe(1e-25);
 });
 it('falls back honestly when GPU is unavailable and rejects invalid options',()=>{
  const gpu=new FractalGpu(),config=fractalConfig(scene().settings);expect(gpu.sample(new Float32Array([0,0]),1,1,view,config).warning).toContain('OffscreenCanvas');gpu.dispose();
  for(const settings of [{renderMethod:'bad'},{perturbationPrecision:'bad'},{fractalBackend:'bad'},{zoom:1e29}]){const s=scene();Object.assign(s.settings,settings);expect(()=>definitions[0].generate(s,{time:0,quality:'preview',width:1,height:1})).toThrow();}
 });
 it('imports native rendering names while preserving ignored initial high/low fields in provenance',()=>{
  const imported=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'Precise original',fractal:{formula_id:'mandelbrot',render_method:'MULTIPASS',perturbation_precision:'ULTRA',center_hi_lo:[-.743,1e-25,.131,-1e-25],zoom:1e20}}));
  const restored=parseScene(JSON.stringify(imported.scene));expect(restored.settings).toMatchObject({renderMethod:'multi-pass',perturbationPrecision:'ultra',centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1e20});
  expect(imported.source).toMatchObject({fractal:{center_hi_lo:[-.743,1e-25,.131,-1e-25]}});
  const local=scene();Object.assign(local.settings,{centerX:-.743,centerXLow:1e-25,centerY:.131,centerYLow:-1e-25});expect(parseScene(JSON.stringify(local)).settings).toMatchObject({centerXLow:1e-25,centerYLow:-1e-25});
 });
});
describe('fractal equation display contract',()=>{
 it('renders every actual formula and reflects coefficients, initial values and Julia constants',()=>{
  const s=scene();for(const item of definitions[0].controls.find(c=>c.key==='formula')!.options!){Object.assign(s.settings,{formula:item.value,power:item.value==='mandelbulb_3d'?8:3});const latex=fractalEquationLatex(s.settings);expect(renderFormulaSvg(latex,'#ffffff').source,item.value).toContain('<path');}
  Object.assign(s.settings,{formula:'phoenix',feedback:-.27,feedbackImag:.32,phoenixPower2:3,startReal:.125,variant:'julia',juliaReal:.37});const latex=fractalEquationLatex(s.settings);expect(latex).toContain('-0.27');expect(latex).toContain('0.32');expect(latex).toContain('z_{n-1}^{3}');expect(latex).toContain('z_0=w');expect(latex).toContain('0.37');
 });
});
