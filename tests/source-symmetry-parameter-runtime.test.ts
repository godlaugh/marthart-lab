import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {SourceSymmetryParameterRuntime,type SourceSymmetryParameterAction} from '../src/engine/sourceSymmetryParameterRuntime';
import {isJavaBlank} from '../src/engine/sourceJavaText';
type State={built?:SourceSymmetryParameterAction[];running:boolean;values:Record<string,number>;phases:Record<string,number>;scales:Record<string,number>;children:{runtime:number;finished:boolean}[]};
type Case={id:string;initial:State;steps:{dt:number;rate?:number}[];frames:State[]};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/parameter-runtime.json',import.meta.url),'utf8')) as {cases:Case[]};
const numbers=(actual:Readonly<Record<string,number>>,expected:Record<string,number>,label:string)=>{expect(Object.keys(actual).sort(),label).toEqual(Object.keys(expected).sort());for(const key of Object.keys(expected))expect(actual[key],label+'/'+key).toBeCloseTo(expected[key],12);};
describe('original Symmetry parameter child clocks and scalar registry',()=>{
 for(const row of fixture.cases)it(row.id+' reproduces all native snapshots',()=>{
  const values=new Map(Object.entries(row.initial.values));let work=0;
  // The runtime owns clocks/registry. This named-value adapter deliberately
  // checks scalar writes only; it does not claim shader/replay flag parity.
  const runtime=new SourceSymmetryParameterRuntime({read:name=>isJavaBlank(name)?undefined:values.get(name),write:(name,value)=>{if(!isJavaBlank(name))values.set(name,value);},reserve:n=>{work+=n;if(work>100000)throw Error('work budget');}});
  row.steps.forEach((step,i)=>{work=0;if(row.frames[i].built)runtime.begin(row.frames[i].built!);runtime.advance(step.dt);runtime.update(step.dt,step.rate??60);const actual=runtime.snapshot(),expected=row.frames[i];
   expect(actual.running,'frame '+i).toBe(expected.running);expect(actual.children,'child frame '+i).toEqual(expected.children);
   numbers(actual.phases,expected.phases,'phases frame '+i);numbers(actual.scales,expected.scales,'scales frame '+i);numbers(Object.fromEntries(values),expected.values,'values frame '+i);
  });
 });
 it('owns caller configuration and snapshots while failing closed after cancellation',()=>{
  let limit=1000,value=.95,controlValue=.95;const action:SourceSymmetryParameterAction={kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:.1,edgeEasing:{window:.5,floor:.25,easing:'linear'}},duration:.2,easing:'linear'};
  const runtime=new SourceSymmetryParameterRuntime({read:()=>value,write:(_,v)=>{value=v;},reserve:n=>{limit-=n;if(limit<0)throw new DOMException('cancelled','AbortError');}});runtime.begin([action]);
  const control=new SourceSymmetryParameterRuntime({read:()=>controlValue,write:(_,v)=>{controlValue=v;},reserve:()=>{}});control.begin([structuredClone(action)]);
  action.configuration!.edgeEasing!.floor=1;const snapshot=runtime.snapshot();expect(Object.isFrozen(snapshot.scales)).toBe(true);runtime.advance(.1);runtime.update(.1);control.advance(.1);control.update(.1);expect(value).toBe(controlValue);expect(snapshot.scales.a).toBe(0);
  limit=0;expect(()=>runtime.update(.1)).toThrow('cancelled');expect(()=>runtime.snapshot()).toThrow('重建');expect(()=>runtime.begin([])).toThrow('重建');
 });
 it('charges repeated phase wrapping rather than approximating a large phase with modulo',()=>{
  let spent=0,writes=0;const runtime=new SourceSymmetryParameterRuntime({read:()=>0,write:()=>{writes++;},reserve:n=>{spent+=n;if(spent>100)throw Error('work budget');}});
  runtime.begin([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:1e9},duration:0,easing:'linear'}]);runtime.advance(0);expect(()=>runtime.update(1)).toThrow('work budget');expect(writes).toBe(0);
 });
 it('rejects invalid action/configuration before reading or writing the target',()=>{
  let calls=0;const runtime=new SourceSymmetryParameterRuntime({read:()=>{calls++;return 0;},write:()=>{calls++;},reserve:()=>{}});
  expect(()=>runtime.begin([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-Infinity,max:1,step:1},duration:1,easing:'linear'}])).toThrow('有限');expect(calls).toBe(0);
 });
});
