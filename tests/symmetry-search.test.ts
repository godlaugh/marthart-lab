import {describe,it,expect} from 'vitest';
import fixtures from './fixtures/symmetry/search-1.7.8.json';
import {evaluateSymmetryCandidate,symmetrySearchStep} from '../src/scenes/symmetrySearch';
import {exploreSymmetry,symmetryStep,type SymmetryParameters} from '../src/scenes/iterated';

describe('retained 1.7.8 Symmetry search diagnostic',()=>{
 for(const row of fixtures.cases)it(`matches independently interpreted bytecode: ${row.id}`,()=>{
  const raw=row.parameters as Record<string,number>,p:SymmetryParameters={lambda:raw.lambda,alpha:raw.alpha,beta:raw.beta,gamma:raw.gamma,omega:raw.omega,n:raw.symmetry_degree,template:row.template as 'standard'|'modified',delta:raw.delta,deltaPower:raw.delta_power};
  const before=JSON.stringify(p),result=evaluateSymmetryCandidate(p);
  expect(result.accepted).toBe(row.expected.accepted);expect(result.score).toBeCloseTo(row.expected.score,13);expect(JSON.stringify(p)).toBe(before);
 });
 const identity:SymmetryParameters={lambda:1,alpha:0,beta:0,gamma:0,omega:0,n:2};
 it('uses both fixed probes, absolute viewport cells and visible-point mean without autofitting',()=>{
  const result=evaluateSymmetryCandidate(identity);
  expect(result).toMatchObject({sampled:4400,finiteRatio:1,visibleRatio:1,occupied:2,coverageRatio:2/5184,accepted:false,reason:'thresholds'});
  expect(result.center![0]).toBeCloseTo((.001+.11)/2,12);expect(result.center![1]).toBeCloseTo((.002-.07)/2,12);
  const zero=evaluateSymmetryCandidate({...identity,lambda:0});expect(zero.center).toEqual([0,0]);expect(zero.occupied).toBe(1);expect(zero.accepted).toBe(false);
 });
 it('distinguishes warmup failure from a full probe with later escaped samples',()=>{
  const early=evaluateSymmetryCandidate({...identity,lambda:100}),late=evaluateSymmetryCandidate({...identity,lambda:1.05});
  expect(early).toMatchObject({reason:'warmup-diverged',score:-1,sampled:0,accepted:false});
  expect(late).toMatchObject({reason:'thresholds',sampled:4400,accepted:false});expect(late.finiteRatio).toBeGreaterThan(0);expect(late.finiteRatio).toBeLessThan(.99);
 });
 it('can cancel within a probe without mutating the supplied parameters',()=>{
  const before=JSON.stringify(identity);let checks=0;
  expect(()=>evaluateSymmetryCandidate(identity,()=>++checks===8)).toThrow('取消');expect(checks).toBe(8);expect(JSON.stringify(identity)).toBe(before);
 });
 it('keeps mathematical parity with ordinary renderer points and the source search-only tiny-radius rule explicit',()=>{
  const p:SymmetryParameters={lambda:-2.3,alpha:2,beta:.2,gamma:.3,omega:.04,n:5,template:'modified',delta:.7,deltaPower:3};
  for(const [x,y]of [[.3,-.2],[-.4,.7],[0,0]]){
   const searched=symmetrySearchStep(x,y,p),rendered=symmetryStep(x,y,p);searched.forEach((v,i)=>expect(v).toBeCloseTo(rendered[i],12));
  }
  const tiny=symmetrySearchStep(3e-7,4e-7,p);expect(tiny).toEqual(symmetrySearchStep(3e-7,4e-7,{...p,delta:0}));expect(tiny).not.toEqual(symmetryStep(3e-7,4e-7,p));
 });
 it('preserves the local no-accepted-candidate failure instead of returning a rejected source fallback',()=>{
  const options={profile:'cloak' as const,degree:5,candidates:1},before=JSON.stringify(options);
  expect(()=>exploreSymmetry(1,options)).toThrow('未找到');expect(JSON.stringify(options)).toBe(before);
 });
 it('returns only candidates passing the source diagnostic while retaining the local deterministic search contract',()=>{
  const a=exploreSymmetry(1,{profile:'cloak',degree:5,candidates:60}),b=exploreSymmetry(1,{profile:'cloak',degree:5,candidates:60});expect(a).toEqual(b);
  expect(a.metrics).toMatchObject({model:'mathart-1.7.8-search-v1',accepted:true,sampled:4400});expect(a.settings.degree).toBe(5);
  expect(a.metrics.finiteRatio).toBeGreaterThanOrEqual(.99);expect(a.metrics.visibleRatio).toBeGreaterThanOrEqual(.3);expect(a.metrics.coverageRatio).toBeGreaterThanOrEqual(.003);expect(a.metrics.coverageRatio).toBeLessThanOrEqual(.28);expect(a.metrics.centerOffset).toBeLessThanOrEqual(1.8);
 });
});
