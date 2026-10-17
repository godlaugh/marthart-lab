import{describe,it,expect}from'vitest';import{compileImplicitContinuity,adjacentImplicitFloat}from'../src/engine/implicitContinuity';
import{compileRealWithFacts}from'../src/engine/expression';
const certificate=(source:string)=>compileImplicitContinuity(compileRealWithFacts(source).facts);
const edge=(f:string,a:number,b:number,scope:Record<string,number>={})=>certificate(f).continuous([a,0,0],[b,0,0],scope);
describe('fail-closed local implicit continuity certificates',()=>{
 it('rounds to adjacent doubles at zero, subnormal, finite extrema and negative values',()=>{
  for(const x of[1,-1,1e-300,-1e-300,1e100,-1e100]){const up=adjacentImplicitFloat(x,true),down=adjacentImplicitFloat(x,false);expect(up).toBeGreaterThan(x);expect(down).toBeLessThan(x);expect(adjacentImplicitFloat(up,false)).toBe(x);expect(adjacentImplicitFloat(down,true)).toBe(x);}
  expect(adjacentImplicitFloat(0,true)).toBe(Number.MIN_VALUE);expect(adjacentImplicitFloat(-0,false)).toBe(-Number.MIN_VALUE);expect(adjacentImplicitFloat(Number.MIN_VALUE,false)).toBe(0);expect(adjacentImplicitFloat(-Number.MIN_VALUE,true)).toBe(-0);expect(adjacentImplicitFloat(Number.MAX_VALUE,true)).toBe(Infinity);expect(adjacentImplicitFloat(Infinity,false)).toBe(Number.MAX_VALUE);expect(adjacentImplicitFloat(-Infinity,true)).toBe(-Number.MAX_VALUE);expect(adjacentImplicitFloat(NaN,true)).toBeNaN();
 });
 it('certifies polynomial, safe division, integer powers and continuously bounded roots',()=>{
  for(const f of['x^8-2*x^6+x^2-.1','sin(x)+cos(x)','sqrt(x^2+1)','abs(x)','min(x,1)','max(x,-1)','1/(x^2+1)','pow(x,2)','x^-2'])expect(edge(f,.1,.2)).toBe(true);
  expect(edge('sqrt(x)',0,1)).toBe(true);expect(edge('x^2',-1,1)).toBe(true);
 });
 it('refuses closed-interval poles, negative powers, unknown and discrete branches',()=>{
  for(const f of['1/x','x^-1','pow(x,-2)','tan(x)','x<0 ? x-.001 : 1e12','floor(x)','sign(x)','sqrt(x)','0*(1/x)','x^.5'])expect(edge(f,-1,1)).toBe(false);
  expect(edge('1/x',0,1)).toBe(false);expect(edge('1/x',-1,-0)).toBe(false);expect(edge('x^65',1,2)).toBe(false);expect(edge('x*x',1e308,1.1e308)).toBe(false);
 });
 it('does not lose zero through rounded cancellation or underflow in a denominator',()=>{
  expect(edge('1/((x+1e16)-1e16)',1,1)).toBe(false);expect(edge('1/(x*x)',Number.MIN_VALUE,Number.MIN_VALUE*2)).toBe(false);expect(edge('1/(sin(x)+1)',0,1)).toBe(false);
 });
 it('binds each edge and parameter scope fresh with the normal constant-overriding owner',()=>{
  const cert=certificate('sqrt(x+e)').continuous;expect(cert([0,0,0],[1,0,0],{e:1})).toBe(true);expect(cert([0,0,0],[1,0,0],{e:-2})).toBe(false);expect(cert([3,0,0],[4,0,0],{e:-2})).toBe(true);expect(edge('cos(PI*x)',0,1)).toBe(true);expect(edge('sin(x)',NaN,1)).toBe(false);
 });
 it('treats unavailable symbol values as unknown without changing evaluator failures',()=>{const proof=certificate('missing*x');expect(proof.continuous([-1,0,0],[1,0,0],{})).toBe(false);expect(proof.crossing([-1,0,0],[1,0,0],{},0,1,-1,1)).toBe(false);});
 it('uses the full raw-coordinate edge box, not only a finite midpoint or transformed endpoint',()=>{
  const cert=certificate('sqrt(x-y)').continuous;expect(cert([1,0,0],[2,.5,0],{})).toBe(true);expect(cert([0,0,0],[1,1,0],{})).toBe(false);expect(edge('1/(x-.1)',0,.2)).toBe(false);
 });
 it('requires independently enclosed point signs before a continuous expression can certify a crossing',()=>{
  const proof=certificate('(x+1e16)-1e16-.1');expect(proof.continuous([0,0,0],[2,0,0],{})).toBe(true);expect(proof.crossing([0,0,0],[2,0,0],{},0,1,-.1,1.9)).toBe(false);
  expect(certificate('x-.1').crossing([-1,0,0],[1,0,0],{},0,1,-1.1,.9)).toBe(true);expect(certificate('x-.1').crossing([-1,0,0],[1,0,0],{},0,-1,1.1,-.9)).toBe(true);expect(certificate('x-.1').crossing([-1,0,0],[1,0,0],{},0,1,1.1,-.9)).toBe(false);
  for(const source of['sqrt()','pow(1)','pow(1,2,3)','min()'])expect(certificate(source).continuous([0,0,0],[1,0,0],{})).toBe(false);
 });

});
