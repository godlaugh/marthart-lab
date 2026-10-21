import {describe,expect,it} from 'vitest';
import {SourceFractalParameterRuntime,type SourceFractalParameterAction,type SourceFractalParameterDefinition} from '../src/engine/sourceFractalParameterRuntime';
import oracle from './fixtures/source-fractal-parameter/source.json';

interface Write {name:string;value:number;imaginary?:number;}
type Operation={kind:'begin';actions:SourceFractalParameterAction[]}|{kind:'interpolate';eased:number;finished:boolean}|{kind:'update';dt:number;fps:number}|({kind:'write'}&Write)|{kind:'stop'};
interface State {running:boolean;order:string[];scales:Record<string,number>;scalarPhases:Record<string,number>;complexPhases:Record<string,number>;fixedImaginary:Record<string,number>;values:Record<string,number|number[]|null>;}
interface Sample {input:{id:string;initial:Write[];observed:{name:string;kind:'float'|'complex'}[];operations:Operation[]};initial:State;steps:State[];}
const samples=oracle.cases as unknown as Sample[];
function close(actual:unknown,expected:unknown,path='state'):void {
 if(typeof expected==='number'){expect(typeof actual,path).toBe('number');expect(Math.abs((actual as number)-expected),path).toBeLessThanOrEqual(Math.max(1,Math.abs(expected))*3e-13);return;}
 if(Array.isArray(expected)){expect(Array.isArray(actual),path).toBe(true);expect((actual as unknown[]).length,path).toBe(expected.length);expected.forEach((v,i)=>close((actual as unknown[])[i],v,`${path}[${i}]`));return;}
 if(expected!==null&&typeof expected==='object'){expect(Object.keys(actual as object).sort(),path).toEqual(Object.keys(expected).sort());for(const [key,value]of Object.entries(expected))close((actual as Record<string,unknown>)[key],value,`${path}.${key}`);return;}
 expect(actual,path).toEqual(expected);
}
describe('original FractalParameterAnimator numerical oracle',()=>{
 for(const sample of samples)it(sample.input.id,()=>{
  const definitions=new Map(sample.input.observed.map(x=>[x.name,{kind:x.kind} satisfies SourceFractalParameterDefinition]));
  const values=structuredClone(sample.initial.values);let work=0;
  const runtime=new SourceFractalParameterRuntime({definition:name=>definitions.get(name),readScalar:name=>typeof values[name]==='number'?values[name] as number:undefined,readComplex:name=>Array.isArray(values[name])?values[name] as [number,number]:undefined,writeScalar:(name,value)=>{values[name]=Math.fround(value);},writeComplex:(name,re,im)=>{values[name]=[re,im];},reserve:n=>{work+=n;if(work>100_000)throw Error('fixture work limit');}});
  const state=():State=>{const s=runtime.snapshot(),field=(key:'scale'|'scalarPhase'|'complexPhase'|'fixedImaginary')=>Object.fromEntries(s.entries.flatMap(e=>e[key]===undefined?[]:[[e.name,e[key]!]]));return{running:s.running,order:s.entries.map(e=>e.name),scales:field('scale'),scalarPhases:field('scalarPhase'),complexPhases:field('complexPhase'),fixedImaginary:field('fixedImaginary'),values:structuredClone(values)};};
  close(state(),sample.initial);
  sample.input.operations.forEach((operation,index)=>{
   if(operation.kind==='begin')runtime.begin(operation.actions);
   else if(operation.kind==='interpolate')runtime.interpolate(operation.eased,operation.finished);
   else if(operation.kind==='update')runtime.update(operation.dt,operation.fps);
   else if(operation.kind==='stop')runtime.stop();
   else values[operation.name]=operation.imaginary===undefined?Math.fround(operation.value):[operation.value,operation.imaginary];
   close(state(),sample.steps[index],`${sample.input.id} step${index+1}`);
  });expect(work).toBeGreaterThan(0);
 });
 it('does not read or write unknown metadata and does not promote scalar suffixes to complex',()=>{
  const calls:string[]=[];let value=3;
  const r=new SourceFractalParameterRuntime({definition:n=>n==='power'?{kind:'float'}:undefined,readScalar:n=>{calls.push('read:'+n);return value;},readComplex:()=>{throw Error('scalar suffix cannot be complex');},writeScalar:(n,v)=>{calls.push('write:'+n);value=Math.fround(v);},writeComplex:()=>{throw Error('unexpected complex write');},reserve:()=>{}});
  r.begin([{kind:'start',scope:{kind:'named',name:'missing'},configuration:{min:-1,max:1,step:.1}},{kind:'start',scope:{kind:'named',name:'power_im'},configuration:{min:2,max:8,step:.1}}]);r.interpolate(1,true);r.update(1/60,60);
  expect(calls).toEqual(['read:power','write:power']);expect(value).toBeGreaterThan(3);
 });
 it('restores transient zero-duration NaN scale before an update and stops using failed state after cancellation',()=>{
  let cancelled=false,value=3;
  const r=new SourceFractalParameterRuntime({definition:()=>({kind:'float'}),readScalar:()=>value,readComplex:()=>undefined,writeScalar:(_n,v)=>{value=v;},writeComplex:()=>{},reserve:()=>{if(cancelled)throw new DOMException('cancelled','AbortError');}});
  r.begin([{kind:'start',scope:{kind:'named',name:'power'},configuration:{min:2,max:8,step:.1}}]);r.interpolate(NaN,true);r.update(1/60,60);expect(Number.isFinite(value)).toBe(true);expect(r.snapshot().entries[0].scale).toBe(1);
  cancelled=true;expect(()=>r.update(1/60,60)).toThrow('cancelled');expect(()=>r.snapshot()).toThrow('需要重建');expect(()=>r.update(1/60,60)).toThrow('需要重建');
 });
 it('preserves distinct scalar and complex phase maps when active metadata changes',()=>{
  let complex=false,scalar=.3,pair:[number,number]=[.2,.75];
  const r=new SourceFractalParameterRuntime({definition:()=>({kind:complex?'complex':'float'}),readScalar:()=>scalar,readComplex:()=>pair,writeScalar:(_n,v)=>{scalar=v;},writeComplex:(_n,re,im)=>{pair=[re,im];},reserve:()=>{}});
  r.begin([{kind:'start',scope:{kind:'named',name:'parameter'},configuration:{min:-1,max:1,step:.1}}]);r.interpolate(1,true);r.update(1/60,60);const scalarPhase=r.snapshot().entries[0].scalarPhase;expect(scalarPhase).toBeDefined();complex=true;r.update(1/60,60);const entry=r.snapshot().entries[0];expect(entry.scalarPhase).toBe(scalarPhase);expect(entry.complexPhase).toBeDefined();expect(pair[1]).toBe(0);
 });
});
