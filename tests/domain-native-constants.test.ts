import {describe,it,expect} from 'vitest';
import {prepareDomainNativeConstant as prepare} from '../src/engine/domainNativeConstants';

describe('source Domain applyConfig constant owner',()=>{
 it.each(['z','z^2','z*z','1/z','exp(z)','sin(z)','sin (z)',' Z * Z '])('retains the initial finite-float parameter pair for exact %s',formula=>{
  const facts=prepare({formula,parameters:{a:16777217,b:.1}});expect(facts.baseConstant).toEqual([16777216,Math.fround(.1)]);expect(facts.effectiveConstant).toEqual(facts.baseConstant);expect(facts.sourceOverride).toBe('none');
 });
 it.each([['z^3',[0,0]],['z^1',[0,0]],['z^2-2',[2,0]],['z^3+2',[-2,0]],['z^99999999999999999999999-.1',[1,0]],[' z ^ 4 - 0.1 ',[Math.fround(.1),0]],['z^4+0',[-0,0]],['z^3-0',[0,0]],['z^3-2.0',[2,0]]])('uses the raw-text literal predicate for %s',(formula,expected)=>{
  const facts=prepare({formula:formula as string,authored:[7,8]});expect(facts.effectiveConstant).toEqual(expected);expect(facts.baseConstant).toEqual([7,8]);
 });
 it.each(['z+c','c','sin(','','z^3-2.','z^3-1e3','z^3\n','z\t'])('uses source fallback literal one for unrecognized raw %j',formula=>{
  expect(prepare({formula,authored:[7,8]})).toMatchObject({effectiveConstant:[1,0],sourceOverride:'fallback-literal'});
 });
 it('distinguishes explicitly authored scalars, missing axes, exact-case parameters and defaults',()=>{
  expect(prepare({formula:'z',parameters:{A:8,B:9}}).effectiveConstant).toEqual([1,0]);
  const input={formula:'z',authored:[0,undefined] as const,parameters:{a:8,b:3}},copy=JSON.stringify(input),facts=prepare(input);
  expect(facts).toMatchObject({baseOrigins:['authored','parameter'],rawBase:[0,3],effectiveConstant:[0,3]});expect(JSON.stringify(input)).toBe(copy);expect(Object.isFrozen(facts.effectiveConstant)).toBe(true);
 });
 it('uses finite-float defaults for a/b overflow but preserves formula literal overflow',()=>{
  const base=prepare({formula:'z',parameters:{a:1e100,b:-1e100}});expect(base.effectiveConstant).toEqual([1,0]);expect(base.diagnostics).toHaveLength(2);
  const literal=prepare({formula:'z^3+'+'9'.repeat(400)});expect(literal.effectiveConstant).toEqual([-Infinity,0]);expect(literal.diagnostics.join()).toContain('非有限');
 });
 it('can retain the captured pair independently of animated parameter values',()=>{
  const initial=prepare({formula:'z',parameters:{a:2,b:3}}),later=prepare({formula:'z',authored:initial.baseConstant,parameters:{a:5,b:6}});expect(later.effectiveConstant).toEqual([2,3]);
 });
});
