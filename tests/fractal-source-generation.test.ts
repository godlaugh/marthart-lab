import {afterEach,describe,expect,it,vi} from 'vitest';
import {definitions,fractalConfig,fractalOrbit} from '../src/scenes/complex';
import {createScene,parseScene} from '../src/engine/document';
import {fractalGpu} from '../src/engine/fractalGpu';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalSourcePrecision';
import {FractalSourceGpuError} from '../src/engine/fractalSourceGpuFailure';
import type {GenerateContext,Settings} from '../src/types';
const def=definitions.find(d=>d.kind==='fractal')!;
function scene(extra:Settings={}){const s=createScene(def);s.settings={...s.settings,formula:'nova',variant:'mandelbrot',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,startReal:1,startImag:0,power:3,powerImag:0,iterations:12,zoom:1000,centerX:.01,centerY:.01,fractalBackend:'webgl2',perturbationPrecision:'medium',renderMethod:'one-pass',...extra};return s;}
const context:GenerateContext={time:0,width:9,height:7,quality:'export'};
afterEach(()=>{vi.restoreAllMocks();fractalGpu.dispose();});
describe('source numeric selection across the public generation boundary',()=>{
 it('rejects unknown persisted rules rather than treating them as local',()=>{
  expect(()=>parseScene(JSON.stringify(scene({fractalNumericProfile:'future-source'})))).toThrow('Unknown fractal numeric profile');
 });
 it('does not run a source document through either direct CPU or requested CPU generation',()=>{
  const s=scene({fractalBackend:'cpu'}),sample=vi.spyOn(fractalGpu,'sample');
  expect(()=>def.generate(s,context)).toThrow('需要 WebGL2');expect(sample).not.toHaveBeenCalled();
  expect(()=>fractalOrbit([1,0],fractalConfig(s.settings))).toThrow('需要 WebGL2');
 });
 it.each(['ultra','unknown'])('retains an unsupported authored precision %s and rejects before GL',precision=>{
  const s=scene({perturbationPrecision:precision}),sample=vi.spyOn(fractalGpu,'sample');
  expect(()=>def.generate(s,context)).toThrow('Source precision requires');expect(s.settings.perturbationPrecision).toBe(precision);expect(sample).not.toHaveBeenCalled();
 });
 it('validates logical dimensions and target before preparing a GPU context',()=>{
  const sample=vi.spyOn(fractalGpu,'sample');
  expect(()=>def.generate(scene(),{...context,fractalViewport:{logicalWidth:NaN,logicalHeight:100,target:'primary'}})).toThrow();
  expect(()=>def.generate(scene(),{...context,fractalViewport:{logicalWidth:100,logicalHeight:100,target:'unknown' as 'primary'}})).toThrow('Unknown source fractal viewport target');
  for(const malformed of [null,{target:'primary',logicalWidth:null,logicalHeight:100},{target:'primary',logicalHeight:100}])expect(()=>def.generate(scene(),{...context,fractalViewport:malformed as unknown as GenerateContext['fractalViewport']})).toThrow();
  expect(sample).not.toHaveBeenCalled();
 });
 it('uses one requested logical plan for every progress raster and performs no probe draw',()=>{
  const plans:unknown[]=[],dimensions:number[][]=[],pointsSeen:number[][]=[];
  // Boundary stub only: this test proves routing, not shader correctness.
  vi.spyOn(fractalGpu,'sample').mockImplementation((points,w,h,_view,_config,_reference,_threshold,_colors,source)=>{
   expect(source).toBeDefined();plans.push(source!.plan);dimensions.push([w,h]);pointsSeen.push(Array.from(points));
   const values=new Float32Array(points.length*4);for(let i=0;i<points.length/2;i++){values[i*8]=1;values[i*8+3]=1;}
   return{values};
  });
  const s=scene({renderMethod:'multi-pass'}),before=structuredClone(s),progress:unknown[]=[];
  def.generate(s,{...context,quality:'preview',width:64,height:48,fractalViewport:{logicalWidth:900,logicalHeight:600,target:'primary'},onProgress:o=>progress.push(o)});
  expect(progress.length).toBe(3);expect(dimensions).toEqual([[8,6],[16,12],[32,24],[64,48]]);
  expect(plans.every(p=>p===plans[0])).toBe(true);expect(plans[0]).toMatchObject({logicalSize:[900,600],logicalSizeProvenance:'canvas-logical-local',formula:'nova'});
  expect(pointsSeen.every(points=>points.every(Number.isInteger))).toBe(true);expect(s).toEqual(before);
 });
 it('passes only actual integer raster samples to source Guessing',()=>{
  const samples=vi.spyOn(fractalGpu,'sample').mockImplementation(points=>{
   expect(points.every(Number.isInteger)).toBe(true);const values=new Float32Array(points.length*4);for(let i=0;i<points.length/2;i++){values[i*8]=1;values[i*8+3]=1;}return{values};
  });
  def.generate(scene({renderMethod:'guessing'}),{...context,quality:'preview'});expect(samples).toHaveBeenCalled();
 });
 it.each(['device','capacity','cleanup'] as const)('retains %s failures instead of silently recursing into independent CPU math',kind=>{
  const failure=new FractalSourceGpuError('source failed',kind),sample=vi.spyOn(fractalGpu,'sample').mockImplementation(()=>{throw failure;});
  expect(()=>def.generate(scene(),context)).toThrow(failure);expect(sample).toHaveBeenCalledTimes(1);
 });
 it('preserves AbortError cancellation before preparing or sampling GPU state',()=>{
  const sample=vi.spyOn(fractalGpu,'sample');expect(()=>def.generate(scene(),{...context,isCancelled:()=>true})).toThrowError(expect.objectContaining({name:'AbortError'}));expect(sample).not.toHaveBeenCalled();
 });
 it('does not publish a partially computed source image after cancellation',()=>{
  let cancelled=false;vi.spyOn(fractalGpu,'sample').mockImplementation(points=>{cancelled=true;const values=new Float32Array(points.length*4);for(let i=0;i<points.length/2;i++)values[i*8+3]=1;return{values};});
  expect(()=>def.generate(scene(),{...context,isCancelled:()=>cancelled})).toThrowError(expect.objectContaining({name:'AbortError'}));
 });
 it('keeps a source marker dormant for other formulas, including CPU rendering',()=>{
  const s=scene({formula:'mandelbrot',fractalBackend:'cpu',zoom:1,centerX:0,convergenceMode:'legacy'}),out=def.generate(s,context);
  expect(out.backend).toBe('cpu');expect(out.type==='raster'&&out.fractalRender).toBeUndefined();expect(s.settings.fractalNumericProfile).toBe(FRACTAL_SOURCE_NUMERIC_PROFILE);
 });
});
