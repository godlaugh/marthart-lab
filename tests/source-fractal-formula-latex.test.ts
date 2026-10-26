import {describe,expect,it} from 'vitest';
import {sourceFractalFormulaReal,sourceFractalFormulaComplex,sourceFractalFormulaLatex} from '../src/engine/sourceFractalFormulaLatex';
import {importSourceFractalFormulaConfiguration} from '../src/engine/sourceFractalFormulaRuntime';
import oracle from './fixtures/source-fractal-formula-labels/source.json';
import powerOracle from './fixtures/source-fractal-mandelbrot-julia-labels/source.json';

function number(input:{bits:string}):number {const bytes=new DataView(new ArrayBuffer(8));bytes.setBigUint64(0,BigInt(`0x${input.bits}`));return bytes.getFloat64(0);}
describe('original JVM source formula formatter oracle',()=>{
 it.each(oracle.real)('formats real $id',sample=>expect(sourceFractalFormulaReal(number(sample.input))).toBe(sample.output));
 it.each(oracle.complex)('formats complex $id',sample=>expect(sourceFractalFormulaComplex(sample.input?.map(number)??null)).toBe(sample.output));
 it.each(oracle.formula.filter(sample=>!sample.id.startsWith('fallback-')))('formats initial config $id',sample=>{
  const parsed=importSourceFractalFormulaConfiguration(sample.input.fractal);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error(parsed.error.reason);
  expect(sourceFractalFormulaLatex(parsed.value.configuration)).toBe(sample.output);
 });
 it.each(powerOracle.formula)('formats original Mandelbrot/Julia config $id',sample=>{
  const parsed=importSourceFractalFormulaConfiguration(sample.input.fractal);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error(parsed.error.reason);
  expect(sourceFractalFormulaLatex(parsed.value.configuration)).toBe(sample.output);
 });
 it.each([{}, {formula_id:''}, {formula_id:'\u2003'}, {type:'JULIA',formula:'z_n^9 + c'}])('keeps unretained legacy strings outside registered template support: %j',input=>{
  const parsed=importSourceFractalFormulaConfiguration(input);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error(parsed.error.reason);
  expect(()=>sourceFractalFormulaLatex(parsed.value.configuration)).toThrow('尚未验证');
 });
 it('keeps unverified registry templates and unknown IDs unsupported',()=>{
  const parsed=importSourceFractalFormulaConfiguration({formula_id:'phoenix'});expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error(parsed.error.reason);
  expect(()=>sourceFractalFormulaLatex(parsed.value.configuration)).toThrow('尚未验证');
  expect(importSourceFractalFormulaConfiguration({formula_id:'unknown_registry_id',formula:'z_n^9 + c'}).ok).toBe(false);
 });
});
