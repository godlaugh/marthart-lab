import {describe,it,expect} from 'vitest';
import {SourceFractalFormulaRuntime,bindSourceFractalFormulaParameters,createSourceFractalFormulaFromConfig,importSourceFractalFormulaConfiguration,type SourceFractalFormulaRuntimeOptions} from '../src/engine/sourceFractalFormulaRuntime';
import oracle from './fixtures/source-fractal-mapping/source.json';
import configs from './fixtures/source-fractal-mapping/configuration.json';
function close(actual:unknown,expected:unknown,path='state'):void{
 if(typeof expected==='number'){expect(typeof actual,path).toBe('number');expect(Math.abs((actual as number)-expected),path).toBeLessThanOrEqual(Math.max(1,Math.abs(expected))*3e-13);return;}
 if(Array.isArray(expected)){expect(Array.isArray(actual),path).toBe(true);expect((actual as unknown[]).length,path).toBe(expected.length);expected.forEach((v,i)=>close((actual as unknown[])[i],v,`${path}[${i}]`));return;}
 if(expected!==null&&typeof expected==='object'){expect(Object.keys(actual as object).sort(),path).toEqual(Object.keys(expected).sort());for(const[k,v]of Object.entries(expected))close((actual as Record<string,unknown>)[k],v,`${path}.${k}`);return;}
 expect(actual,path).toEqual(expected);
}
interface Operation {kind:string;name?:string;value?:number;imaginary?:number;real?:number;bailout?:number;progress?:number;parameters?:unknown;}
for(const sample of oracle.cases)it(`original mapping: ${sample.input.id}`,()=>{
 const native=sample.initial.native,formulaId=sample.input.formula;
 let runtime=new SourceFractalFormulaRuntime({formulaId,fractalType:native.fractalType,initialNative:native} as unknown as SourceFractalFormulaRuntimeOptions);
 let animation:{startBailout:number;startJulia:readonly[number,number];bailout?:number;real?:number;imaginary?:number}|undefined;
 for(const[index,raw]of sample.input.operations.entries()){
  const op=raw as Operation;
  if(op.kind==='remap')runtime.remap();
  else if(op.kind==='registry'){if(op.imaginary===undefined)runtime.writeScalar(op.name!,op.value!);else runtime.writeComplex(op.name!,op.value!,op.imaginary);}
  else if(op.kind==='bailout')runtime.setBailout(op.value!);
  else if(op.kind==='julia')runtime.setJuliaConstant(op.value!,op.imaginary!);
  else if(op.kind==='animationStart'){const n=runtime.snapshot().native;animation={startBailout:n.bailout,startJulia:n.julia,...op};}
  else if(op.kind==='animationUpdate'){
   const a=animation!,p=Math.fround(op.progress!);if(a.bailout!==undefined)runtime.setBailout(Math.fround(a.startBailout+Math.fround(Math.fround(a.bailout-a.startBailout)*p)));
   if(a.real!==undefined)runtime.setJuliaConstant(a.startJulia[0]+(a.real-a.startJulia[0])*p,a.startJulia[1]+(a.imaginary!-a.startJulia[1])*p);
  }else if(op.kind==='bind'){
   const bound=bindSourceFractalFormulaParameters(formulaId,op.parameters);expect(bound.ok).toBe(true);if(!bound.ok)throw Error(bound.error.reason);
   const n=runtime.snapshot().native;runtime=new SourceFractalFormulaRuntime({formulaId,fractalType:n.fractalType,initialNative:n,parameters:bound.value.parameters});runtime.remap();
  }
  const actual=runtime.snapshot(),read=Object.fromEntries(sample.input.observed.map(({name,kind})=>[name,(kind==='complex'?runtime.readComplex(name):runtime.readScalar(name))??null]));
  close({native:actual.native,stored:actual.parameters,read},sample.steps[index],`${sample.input.id} step ${index+1}`);
 }
});
describe('formula ownership and initial replacement boundaries',()=>{
 it('distinguishes absent, empty and bound default sets through initial applyConfig',()=>{
  const config={formulaId:'lambda',fractalType:'julia' as const,power:2,formulaParams:[2,0,0,0] as const,bailout:8,julia:[9,10] as const};
  const absent=createSourceFractalFormulaFromConfig(config),empty=createSourceFractalFormulaFromConfig({...config,parameters:{floats:{},complex:{}}});
  expect(absent.snapshot().native.julia).toEqual([9,10]);expect(absent.snapshot().native.bailout).toBe(8);expect(absent.snapshot().native.dynamicParams.every(v=>v===0)).toBe(true);
  expect(empty.snapshot().native.julia).toEqual([0,0]);expect(empty.snapshot().native.bailout).toBe(Math.fround(1e-6));expect(empty.snapshot().native.dynamicParams[4]).toBe(Math.fround(.6));
  const bound=bindSourceFractalFormulaParameters('lambda',{});if(!bound.ok)throw Error(bound.error.reason);
  const dense=createSourceFractalFormulaFromConfig({...config,parameters:bound.value.parameters});expect(dense.snapshot().native.julia).toEqual([.6,0]);expect(dense.snapshot().native.bailout).toBe(4);expect(dense.snapshot().parameters.complex.lambda).toEqual([.6,0]);
 });
 it('owns copies and rejects unknown formulas without treating settings as metadata',()=>{
  expect(()=>createSourceFractalFormulaFromConfig({formulaId:'unknown',fractalType:'mandelbrot',power:2,formulaParams:[2,0,0,0],bailout:4,julia:[0,0]})).toThrow('不支持');
  const r=createSourceFractalFormulaFromConfig({formulaId:'julia',fractalType:'mandelbrot',power:2,formulaParams:[2,0,0,0],bailout:4,julia:[0,0]});expect(r.definition('zoom')).toBeUndefined();const before=r.snapshot();r.writeScalar('missing',99);expect(r.snapshot()).toEqual(before);expect(Object.isFrozen(before.native.dynamicParams)).toBe(true);
  expect(()=>r.writeScalar('power',Infinity)).toThrow('必须有限');expect(()=>r.snapshot()).toThrow('需要重建');
 });
 it('retains unconsumed unknown binder fields and reports capacity as an error',()=>{
  const r=bindSourceFractalFormulaParameters('lambda',{lambda:[.2,.3,7],unknown:8});expect(r.ok).toBe(true);if(!r.ok)return;expect(r.value.consumedPaths).toEqual([['lambda','0'],['lambda','1']]);expect(r.value.numericPaths).toEqual([['lambda','0'],['lambda','1']]);
  expect(bindSourceFractalFormulaParameters('lambda',null)).toMatchObject({ok:false,error:{kind:'input'}});expect(bindSourceFractalFormulaParameters('julia',{power:'1'.repeat(65537)})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});

for(const sample of configs.cases)it(`original formula config: ${sample.input.id}`,()=>{
 const result=importSourceFractalFormulaConfiguration(sample.input.fractal);
 if(sample.input.id==='power-number-double'||sample.input.id==='power-number-long'){expect(result).toMatchObject({ok:false,error:{kind:'unsupported',path:['power']}});return;}
 expect(result.ok).toBe(true);if(!result.ok)throw Error(result.error.reason);close(result.value.configuration,sample.configuration,sample.input.id);
});
it('reports invalid original config shapes and preserves unknown fields',()=>{
 for(const raw of [{formula:null},{formula_params:[]},{julia_constant:null},{formula_id:'lambda',parameters:null}])expect(importSourceFractalFormulaConfiguration(raw)).toMatchObject({ok:false,error:{kind:'input'}});
 const value=importSourceFractalFormulaConfiguration({formula_id:'lambda',formulaId:'julia',formula_params:{power:2.5,unused:9},parameters:{lambda:[.2,.3,4],unknown:8}});expect(value.ok).toBe(true);if(!value.ok)return;
 expect(value.value.consumedPaths).not.toContainEqual(['formulaId']);expect(value.value.consumedPaths).not.toContainEqual(['formula_params','unused']);expect(value.value.consumedPaths).not.toContainEqual(['parameters','unknown']);expect(value.value.consumedPaths).not.toContainEqual(['parameters','lambda','2']);
});
