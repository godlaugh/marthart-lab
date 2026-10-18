import {describe,it,expect} from 'vitest';
import {prepareSourceRealExpression as prepare} from '../src/engine/domainSourceScalar';
function expression(text:string,names:string[]=['u','v']){const r=prepare(text,names);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
describe('source FastExpression reusable runtime variable slots',()=>{
 it('reuses variable slots without retaining arrays or folding values into syntax',()=>{
  const e=expression('2u+v^2'),values=[1,3];expect(e.evaluate(values)).toBe(11);values[0]=5;expect(e.evaluate(values)).toBe(19);expect(e.evaluate([0,2])).toBe(4);expect(()=>e.evaluate([1])).toThrow('slot count');
 });
 it('uses last exact-case binding, including shadowed coordinates and named constants',()=>{
  expect(expression('u+PI+pi',['u','PI','u']).evaluate([1,8,3])).toBe(11+Math.PI);
  expect(expression('α+u',['α','u']).evaluate([4,2])).toBe(6);
  expect(expression('sin(0)+sin',['sin']).evaluate([3])).toBe(3);
 });
 it.each([['-u^2',-9],['2^u^2',512],['min(u)',0],['pow(u)',0],['sin(u,1/0)',Math.sin(3)],['min(u,v,8)',2],['max(u,v,8)',8],['pow(u,v,1/0)',9],['atan2(u,v,1/0)',Math.atan2(3,2)],['round(-1.5)',-1],['2(u+v)',10],['π+u',Math.PI+3]] as const)('preserves source grammar/evaluation %s',(text,value)=>expect(expression(text).evaluate([3,2])).toBe(value));
 it.each(['unknown+u','u+t','sin (u)','sin()','1e3+u','sin(u,unknown)'])('does not silently replace invalid formulas with zero: %s',text=>expect(prepare(text,['u'])).toMatchObject({ok:false,error:{kind:'input'}}));
 it('preserves nonfinite arithmetic for the producing geometry boundary to handle',()=>{expect(expression('u/0').evaluate([1,0])).toBe(Infinity);expect(expression('u/0').evaluate([0,0])).toBeNaN();});
 it('bounds compiled syntax and variable layout before runtime allocation',()=>{
  expect(prepare('('.repeat(129)+'u'+')'.repeat(129),['u'])).toMatchObject({ok:false,error:{kind:'capacity',resource:'depth'}});
  expect(prepare('u',Array.from({length:8195},()=>''))).toMatchObject({ok:false,error:{kind:'capacity',resource:'variables'}});
 });
});
