import {describe,it,expect} from 'vitest';
import vectors from './fixtures/fractal/source-reference-vectors.json';
import {
 FRACTAL_SOURCE_NUMERIC_PROFILE,parseFractalNumericProfile,parseFractalSourcePlan,
 prepareFractalSourcePlan,buildFractalSourceReference,FractalSourceReferenceCache,
 validateFractalSourcePlan,type FractalSourcePrecisionInput,
} from '../src/engine/fractalSourcePrecision';
import type {FractalViewport} from '../src/engine/complexViewport';

const base:FractalSourcePrecisionInput={formula:'newton',variant:'mandelbrot',power:[2,0],start:[1,0],julia:[.01,.03],iterations:8,tolerance:1e-6,relaxation:1};
const view:FractalViewport={centerX:2,centerXLow:0,centerY:0,centerYLow:0,zoom:100,rotation:0};
const size={logicalWidth:97,logicalHeight:73,provenance:'source-logical' as const};
const plan=(c:Partial<FractalSourcePrecisionInput>={},v:Partial<FractalViewport>={},s:Partial<typeof size>={})=>parseFractalSourcePlan({...base,...c},{...view,...v},{...size,...s},{precision:'high'});

describe('explicit source numeric contract',()=>{
 it('owns the marker, preserving omission/local and rejecting unknown versions',()=>{
  expect(parseFractalNumericProfile(undefined)).toBe('local-v1');expect(parseFractalNumericProfile('local-v1')).toBe('local-v1');
  expect(parseFractalNumericProfile(FRACTAL_SOURCE_NUMERIC_PROFILE)).toBe(FRACTAL_SOURCE_NUMERIC_PROFILE);
  for(const invalid of [null,'',true,{},'mathart-1.7.8','future'])expect(()=>parseFractalNumericProfile(invalid)).toThrow('Unknown');
 });
 it('uses only explicitly supplied supported source precision presets',()=>{
  for(const [precision,value] of [['low',.01],['medium',1e-4],['high',1e-6]] as const)
   expect(parseFractalSourcePlan(base,view,size,{precision}).perturbation.threshold).toBe(Math.fround(value));
  for(const precision of [undefined,null,'ultra','HIGH',0])expect(prepareFractalSourcePlan(base,view,size,{precision})).toMatchObject({ok:false,error:{kind:'input',field:'precision'}});
 });
 it('keeps authoring values but maps Newton to Mandel and Nova start/Julia separately',()=>{
  const n=plan({variant:'julia',julia:[.25,-.5],start:[3,4]});expect(n.authoredVariant).toBe('julia');expect(n.isJulia).toBe(false);expect(n.reference.initialZ).toEqual([[2,0],[0,0]]);
  const m=plan({formula:'nova',start:[3,4]});expect(m.sourceJuliaConstant).toEqual([3,4]);expect(m.reference.initialZ).toEqual([[3,0],[4,0]]);expect(m.reference.constant).toEqual([[2,0],[0,0]]);
  const j=plan({formula:'nova',variant:'julia',julia:[.25,-.5]});expect(j.reference.initialZ).toEqual([[2,0],[0,0]]);expect(j.reference.constant).toEqual([[.25,0],[-.5,0]]);
 });
 it('applies F32 strict near-integer admission and the double zoom gate',()=>{
  expect(plan({}, {zoom:99.999999999}).perturbation).toMatchObject({enabled:false,reason:'ZOOM_BELOW_GATE'});
  expect(plan({}, {zoom:100}).perturbation.enabled).toBe(true);
  expect(plan({power:[2+2**-22,0]}).perturbation.enabled).toBe(true);
  expect(plan({power:[2+2**-19,0]}).perturbation.enabled).toBe(false);
  expect(plan({power:[2,Math.fround(1e-6)]}).perturbation.enabled).toBe(false);
  expect(plan({power:[1,0]}).perturbation.reason).toBe('NEWTON_POWER_CONDITION');
 });
 it('keeps source reference linear powers without aliasing shader capped powers',()=>{
  for(const p of [16,17,18,32,33,1000])expect(plan({power:[p,0]})).toMatchObject({shaderIntegerPower:p,reference:{power:p}});
  expect(prepareFractalSourcePlan({...base,power:[1e6,0],iterations:2048},view,size,{precision:'high'})).toMatchObject({ok:false,error:{kind:'capacity',field:'referenceWork'}});
  expect(plan({power:[2.49999999,0]})).toMatchObject({shaderIntegerPower:3,reference:{power:2},perturbation:{enabled:false}});
 });
 it('preserves shader relaxation while the host reference replaces nonpositive relaxation',()=>{
  for(const r of [0,-0,-.5]){const p=plan({relaxation:r});expect(Object.is(p.shaderRelaxation,Math.fround(r))).toBe(true);expect(p.reference.relaxation).toBe(1);}
  expect(plan({relaxation:.7}).reference.relaxation).toBe(Math.fround(.7));
 });
 it('splits shader center from DD parts without the reference collapse',()=>{
  const p=plan({}, {centerXLow:2**-54,centerY:.25,centerYLow:2**-60});expect(p.shaderCenter).toEqual([2,Math.fround(2**-54),.25,Math.fround(2**-60)]);
  const r=buildFractalSourceReference(p);expect(r.kind).toBe('ready');if(r.kind==='ready')expect(Array.from(r.values.slice(0,4))).toEqual([2,0,.25,0]);
 });
 it('binds near-origin shift to source logical size without a zoom factor',()=>{
  const a=plan({}, {centerX:0,zoom:100},{logicalHeight:23}),b=plan({}, {centerX:0,zoom:1e20},{logicalHeight:47});
  expect(a.reference.nearZeroShift).toBe(1/23);expect(b.reference.nearZeroShift).toBe(1/47);expect(a.key).not.toBe(b.key);
  expect(plan({}, {centerX:1e-24}).reference.nearZeroShift).toBe(0);
 });
 it('exposes source glitch factors at both clamp endpoints and midpoint',()=>{
  expect(plan().perturbation).toMatchObject({absFactor:4096,relLimit:1e6});
  expect(plan({}, {zoom:1e16}).perturbation).toMatchObject({absFactor:5120,relLimit:5.5e6});
  expect(plan({}, {zoom:1e30}).perturbation).toMatchObject({absFactor:6144,relLimit:1e7});
 });
 it('retains source-derived infinite squared tolerance instead of silently narrowing it',()=>{
  expect(plan({tolerance:1e30}).toleranceSquaredReference).toBe(Infinity);expect(plan({tolerance:-1}).bailout).toBe(Math.fround(1e-12));
  const p=plan({formula:'nova',tolerance:.01},{zoom:1000});expect(p.toleranceSquaredReference).toBeGreaterThan(0);expect(p.toleranceSquaredReference).toBeLessThan(Math.fround(.01)**2);
 });
 it('owns immutable facts and rejects forged plans and invalid represented inputs',()=>{
  const p=plan();expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.reference.initialZ[0])).toBe(true);
  expect(()=>validateFractalSourcePlan({...p})).toThrow('prepared');
  expect(prepareFractalSourcePlan({...base,formula:'magnet'},view,size,{precision:'high'})).toMatchObject({ok:false,error:{field:'formula'}});
  for(const c of [{power:[NaN,0]},{iterations:4097},{relaxation:1e300}])expect(prepareFractalSourcePlan({...base,...c} as FractalSourcePrecisionInput,view,size,{precision:'high'}).ok).toBe(false);
 });
});

describe('retained independent Java DD/reference vectors',()=>{
 for(const row of vectors.vectors)it(row.input.name,()=>{
  const i=row.input,expected=row.expected;
  const p=plan({formula:i.formula,variant:i.variant,power:[i.power,0],relaxation:i.relaxation,iterations:i.iterations,start:[i.mappedJulia[0],i.mappedJulia[1]],julia:[i.mappedJulia[0],i.mappedJulia[1]]},
   {centerX:i.center[0],centerXLow:i.center[1],centerY:i.center[2],centerYLow:i.center[3]}, {logicalWidth:i.width,logicalHeight:i.height});
  expect(p.reference.initialZ).toEqual(expected.initialZ);expect(p.reference.constant).toEqual(expected.constant);expect(p.reference.relaxation).toBe(expected.relax);
  const actual=buildFractalSourceReference(p);expect(actual.kind).toBe(expected.kind);expect(actual.length).toBe(expected.length);
  if(actual.kind==='unavailable'){expect(actual.reason).toBe(expected.reason);expect(actual.failedStep).toBe(expected.failedStep);expect(actual.bytes).toBe(0);}
  else {expect(actual.layout).toBe(expected.layout);const values=expected.values??Array.from({length:expected.length*4},(_,n)=>expected.repeatTuple![n%4]);expect(Array.from(actual.values)).toEqual(values);expect(actual.bytes).toBe(expected.length*16);}
 });
});

describe('reference capacity, cancellation and cache ownership',()=>{
 it('does not allocate for an unavailable gate and rejects cancellation first',()=>{
  const p=plan({}, {zoom:1});let allocations=0;expect(buildFractalSourceReference(p,{onBytes:()=>allocations++})).toMatchObject({kind:'unavailable',reason:'ZOOM_BELOW_GATE'});expect(allocations).toBe(0);
  expect(()=>buildFractalSourceReference(p,{isCancelled:()=>true})).toThrow('cancelled');
 });
 it('reports complete bounded allocation before construction and can cancel during generation',()=>{
  const p=plan({iterations:4096},{centerX:1});const bytes:number[]=[];
  const r=buildFractalSourceReference(p,{onBytes:b=>bytes.push(b)});expect(bytes).toEqual([32768]);expect(r.length).toBe(2048);
  let calls=0;expect(()=>buildFractalSourceReference(p,{isCancelled:()=>++calls===9})).toThrow('cancelled');
  const budgetError=new Error('caller capacity');expect(()=>buildFractalSourceReference(p,{onBytes:()=>{throw budgetError;}})).toThrow(budgetError);
 });
 it('checks cancellation inside an admitted long linear reference power',()=>{
  const p=plan({power:[100000,0],iterations:1},{centerX:1});expect(p.reference.workUnits).toBe(100017);
  let checks=0;expect(()=>buildFractalSourceReference(p,{isCancelled:()=>++checks===4})).toThrow('cancelled');expect(checks).toBe(4);
 });
 it('commits cache only after successful generation and accounts retained plus new array',()=>{
  const cache=new FractalSourceReferenceCache(),p=plan();const a=cache.prepare(p);expect(a.cacheHit).toBe(false);expect(cache.prepare(p).reference).toBe(a.reference);
  const other=plan({}, {centerX:1.5});let bytes=0;
  expect(()=>cache.prepare(other,{onBytes:b=>{bytes=b;throw Error('budget');}})).toThrow('budget');expect(bytes).toBe(256);expect(cache.prepare(p).reference).toBe(a.reference);
  expect(()=>cache.prepare(other,{isCancelled:()=>true})).toThrow('cancelled');expect(cache.prepare(p).cacheHit).toBe(true);
  cache.dispose();expect(cache.diagnostics().retainedBytes).toBe(0);expect(cache.prepare(p).cacheHit).toBe(false);
 });
 it('keys every actual input, dimensions, signed zero and provenance without retaining raw inputs',()=>{
  const c={...base,start:[1,0] as [number,number]},v={...view};const p=parseFractalSourcePlan(c,v,size,{precision:'high'});c.start[0]=7;v.centerX=9;expect(p.reference.initialZ[0][0]).toBe(2);
  const keys=[p,plan({relaxation:-0}),plan({}, {rotation:-0}),plan({}, {},{logicalWidth:98}),parseFractalSourcePlan(base,view,{...size,provenance:'canvas-logical-local'},{precision:'high'}),parseFractalSourcePlan(base,view,size,{precision:'medium'})].map(x=>x.key);expect(new Set(keys).size).toBe(keys.length);
 });
 it('caches tagged unavailable results while preserving failure reasons',()=>{
  const cache=new FractalSourceReferenceCache(),p=plan({formula:'nova',start:[0,0]});const a=cache.prepare(p);expect(a.reference).toMatchObject({kind:'unavailable',reason:'NOVA_REF_DERIV_SINGULAR',failedStep:0});expect(cache.prepare(p)).toMatchObject({cacheHit:true});expect(cache.diagnostics().retainedBytes).toBe(0);
 });
 it('checks final cancellation before returning or publishing the new cache entry',()=>{
  const cache=new FractalSourceReferenceCache(),prior=plan();const old=cache.prepare(prior);let calls=0;
  expect(()=>cache.prepare(plan({iterations:1},{centerX:1}),{isCancelled:()=>++calls===5})).toThrow('cancelled');expect(cache.prepare(prior).reference).toBe(old.reference);
 });
});
