import {describe,it,expect} from 'vitest';
import {parse,ConstantNode} from 'mathjs';
import {compileDomainNativeNode,compileDomainNativeGlslNode,domainNativeFunctionNames,domainNativeGlslPrelude,formatDomainNativeGlslFloat,type DomainNativeStage} from '../src/engine/domainNativeArithmetic';
import type {ComplexScope} from '../src/engine/complexMath';
import vectors from './fixtures/domain-native/arithmetic-ordinary.json';

// MathJS is used only to construct arithmetic AST fixtures here. Production
// grammar is owned by the separate native parser, not this numerical module.
const run=(formula:string,scope:ComplexScope={},stage:DomainNativeStage='cpu',parameters=Object.keys(scope))=>compileDomainNativeNode(parse(formula),new Set(parameters),stage)(scope);

describe('native Domain arithmetic CPU contract',()=>{
 it.each(vectors.vectors)('independent principal-value oracle: $formula',({formula,z,p,expected})=>{
  // p is a complex coordinate in the test AST, not a scalar source parameter.
  const actual=run(formula.replace(/\bp\b/g,'c'),{z:z as [number,number],c:p as [number,number]});
  for(let i=0;i<2;i++)expect(actual[i]).toBeCloseTo(expected[i],13);
 });
 it('has exactly the source function vocabulary, including arccsc but no local aliases',()=>{
  expect(new Set(domainNativeFunctionNames).size).toBe(28);
  expect(domainNativeFunctionNames).toContain('arccsc');
  expect(()=>run('arcsin(z)',{z:[.3,.4]})).toThrow();
  expect(()=>run('sin(z,c)',{z:[.3,.4],c:[1,0]})).toThrow();
  expect(()=>run('pow(z)',{z:[.3,.4]})).toThrow();
 });
 it('keeps epsilon division and epsilon log at zero and tiny divisors',()=>{
  expect(run('z/c',{z:[1,2],c:[0,0]})).toEqual([0,0]);
  expect(run('z/c',{z:[1,0],c:[1e-12,0]})[0]).toBeCloseTo(999999.0000009999,8);
  expect(run('log(z)',{z:[0,0]})).toEqual([-41.44653167389282,0]);
  expect(run('log(z)',{z:[-0,-0]})).toEqual([-41.44653167389282,-Math.PI]);
 });
 it('uses general power for both operator and call even at integer and zero exponents',()=>{
  for(const formula of ['z^2','pow(z,2)']){
   const zero=run(formula,{z:[0,0]});
   // Python libm and V8 exp differ by one ulp here; epsilon power is nonzero.
   expect(zero[0]/1e-36).toBeCloseTo(1,14);expect(zero[1]).toBe(0);
   expect(run(formula,{z:[-1,0]})).toEqual([1,-2.4492935982947064e-16]);
  }
  expect(run('z^0',{z:[0,0]})).toEqual([1,0]);
  expect(run('z^0',{z:[Infinity,0]}).every(Number.isNaN)).toBe(true);
 });
 it('preserves polar root and signed branch-cut input',()=>{
  expect(run('sqrt(z)',{z:[-4,0]})).toEqual([1.2246467991473532e-16,2]);
  expect(run('sqrt(z)',{z:[-4,-0]})).toEqual([1.2246467991473532e-16,-2]);
  expect(Object.is(run('asin(z)',{z:[0,0]})[1],-0)).toBe(true);
  expect(Object.is(run('atan(z)',{z:[0,0]})[0],-0)).toBe(true);
 });
 it('retains native overflow instead of stable local arithmetic',()=>{
  expect(run('z/c',{z:[1e308,1e308],c:[1e308,1e308]}).every(Number.isNaN)).toBe(true);
  expect(run('abs(z)',{z:[1e308,1e308]})).toEqual([1.4142135623730951e308,0]);
  expect(run('exp(z)',{z:[1000,0]})).toEqual([Infinity,NaN]);
  expect(compileDomainNativeNode(new ConstantNode(Infinity),new Set(),'cpu')({})).toEqual([Infinity,0]);
 });
 it('owns reserved symbols, missing parameter zero and absent w scope',()=>{
  expect(run('i+pi+e',{i:99,pi:99,e:99})).toEqual([Math.PI+Math.E,1]);
  expect(run('w',{z:[2,-3]})).toEqual([2,-3]);
  expect(run('w',{z:[2,-3],w:[4,5]})).toEqual([4,5]);
  expect(run('time+a',{time:8,a:7},'cpu',[])).toEqual([0,0]);
  expect(run('a',{},'cpu',['a'])).toEqual([0,0]);
  expect(run('a',Object.create({a:99}) as ComplexScope,'cpu',['a'])).toEqual([0,0]);
  expect(run('constructor',Object.fromEntries([['constructor',7]]),'cpu',['constructor'])).toEqual([7,0]);
  expect(run('a',{A:7},'cpu',['A'])).toEqual([0,0]);
  expect(()=>run('a',{a:[1,2]})).toThrow('实数');
 });
});

describe('native GPU reference and GLSL lowering',()=>{
 it('rounds bindings and arithmetic stages, and keeps overflowing length',()=>{
  expect(run('a',{a:16777217},'gpu')).toEqual([16777216,0]);
  expect(run('a+b-a',{a:16777216,b:1},'gpu')).toEqual([0,0]);
  expect(run('a+b-a',{a:16777216,b:1},'cpu')).toEqual([1,0]);
  expect(run('abs(z)',{z:[2e20,0]},'gpu')).toEqual([Infinity,0]);
  expect(run('abs(z)',{z:[Infinity,NaN]},'cpu')).toEqual([Infinity,0]);
  expect(Number.isNaN(run('abs(z)',{z:[Infinity,NaN]},'gpu')[0])).toBe(true);
  expect(run('a',{a:1e300},'gpu')).toEqual([Infinity,0]);
 });
 it('preserves distinct GPU composition and source constants',()=>{
  expect(Object.is(run('atan(z)',{z:[0,0]},'gpu')[0],0)).toBe(true);
  expect(run('pi+e',{},'gpu')).toEqual([5.859874725341797,0]);
  expect(run('z/c',{z:[1,0],c:[1e-12,0]},'gpu')).toEqual([999998.9375,0]);
 });
 it('keeps general native pow lowering and maps ln without expanding aliases',()=>{
  expect(compileDomainNativeGlslNode(parse('z^2'),[])).toBe('c_pow(z,vec2(2.0,0.0))');
  expect(compileDomainNativeGlslNode(parse('pow(z,2)'),[])).toBe('c_pow(z,vec2(2.0,0.0))');
  expect(compileDomainNativeGlslNode(parse('ln(z)'),[])).toBe('c_log(z)');
  expect(compileDomainNativeGlslNode(parse('arccsc(z)'),[])).toBe('c_arccsc(z)');
  expect(()=>compileDomainNativeGlslNode(parse('arcsin(z)'),[])).toThrow();
 });
 it('uses numeric uniform slots, reserved precedence and unbound default zero',()=>{
  expect(compileDomainNativeGlslNode(parse('a+b'),['a'])).toBe('c_add(vec2(parameter0,0.0),vec2(0.0))');
  expect(compileDomainNativeGlslNode(parse('e'),['e'])).toBe('vec2(2.71828182846,0.0)');
  expect(compileDomainNativeGlslNode(parse('w'),[])).toBe('w');
  expect(compileDomainNativeGlslNode(parse('A'),['a'])).toBe('vec2(0.0)');
 });
 it('does not inherit the local float32-normal literal guard or fabricate nonfinite GLSL literals',()=>{
  expect(compileDomainNativeGlslNode(new ConstantNode(1e-50),[])).toBe('vec2(1e-50,0.0)');
  expect(compileDomainNativeGlslNode(new ConstantNode(1e100),[])).toBe('vec2(1e+100,0.0)');
  expect(()=>compileDomainNativeGlslNode(new ConstantNode(Infinity),[])).toThrow('非有限');
 });
 it('formats exact Java longs including d2l saturation at positive 2^63',()=>{
  expect(formatDomainNativeGlslFloat(-0)).toBe('0.0');
  expect(formatDomainNativeGlslFloat(1000000000000000100)).toBe('1000000000000000128.0');
  expect(formatDomainNativeGlslFloat(2**63)).toBe('9223372036854775807.0');
  expect(formatDomainNativeGlslFloat(-(2**63))).toBe('-9223372036854775808.0');
  expect(formatDomainNativeGlslFloat(2**63-1024)).toBe('9223372036854774784.0');
  expect(formatDomainNativeGlslFloat(2**63+2048)).toBe(String(2**63+2048)+'.0');
  expect(formatDomainNativeGlslFloat(-(2**63)-2048)).toBe(String(-(2**63)-2048)+'.0');
 });
 it('keeps native epsilon/power and does not request local orbit repair',()=>{
  expect(domainNativeGlslPrelude).toContain('float d = dot(b, b) + 1e-18;');
  expect(domainNativeGlslPrelude).toContain('return c_exp(c_mul(c_log(z), w));');
  expect(domainNativeGlslPrelude).not.toContain('complexRepair=true');
  expect(domainNativeGlslPrelude).not.toContain('c_pow_int');
  expect(domainNativeGlslPrelude).toContain('bool cFinite2(vec2 v)');
 });
});
