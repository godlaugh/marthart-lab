import {describe,it,expect} from 'vitest';
import {SourceIteratedParameterRuntime,type SourceIteratedParameterAction} from '../src/engine/sourceIteratedParameterRuntime';
describe('Symmetry parameter runtime ownership and resource bounds',()=>{
 it('owns caller configuration and snapshots while failing closed after cancellation',()=>{
  let limit=1000,value=.95,controlValue=.95;const action:SourceIteratedParameterAction={kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:.1,edgeEasing:{window:.5,floor:.25,easing:'linear'}},duration:.2,easing:'linear'};
  const runtime=new SourceIteratedParameterRuntime({read:()=>value,write:(_,v)=>{value=v;},reserve:n=>{limit-=n;if(limit<0)throw new DOMException('cancelled','AbortError');}});runtime.begin([action]);
  const control=new SourceIteratedParameterRuntime({read:()=>controlValue,write:(_,v)=>{controlValue=v;},reserve:()=>{}});control.begin([structuredClone(action)]);
  action.configuration!.edgeEasing!.floor=1;const snapshot=runtime.snapshot();expect(Object.isFrozen(snapshot.scales)).toBe(true);runtime.advance(.1);runtime.update(.1);control.advance(.1);control.update(.1);expect(value).toBe(controlValue);expect(snapshot.scales.a).toBe(0);
  limit=0;expect(()=>runtime.update(.1)).toThrow('cancelled');expect(()=>runtime.snapshot()).toThrow('重建');expect(()=>runtime.begin([])).toThrow('重建');
 });
 it('charges repeated phase wrapping rather than approximating a large phase with modulo',()=>{
  let spent=0,writes=0;const runtime=new SourceIteratedParameterRuntime({read:()=>0,write:()=>{writes++;},reserve:n=>{spent+=n;if(spent>100)throw Error('work budget');}});
  runtime.begin([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:1e9},duration:0,easing:'linear'}]);runtime.advance(0);expect(()=>runtime.update(1)).toThrow('work budget');expect(writes).toBe(0);
 });
 it('rejects invalid action/configuration before reading or writing the target',()=>{
  let calls=0;const runtime=new SourceIteratedParameterRuntime({read:()=>{calls++;return 0;},write:()=>{calls++;},reserve:()=>{}});
  expect(()=>runtime.begin([{kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-Infinity,max:1,step:1},duration:1,easing:'linear'}])).toThrow('有限');expect(calls).toBe(0);
 });
});
