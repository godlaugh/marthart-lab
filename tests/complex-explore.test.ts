import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions,compileComplex,compilePolynomial,prepareRootSampling} from '../src/scenes/complex';
import {exploreComplex,ROOT_EXPLORER_STYLES,DOMAIN_FORMULA_FAMILIES} from '../src/engine/complexExplore';
import {random} from '../src/engine/expression';
import {parseRootParameters} from '../src/engine/rootParameters';
const scene=(kind:'domain'|'roots')=>createScene(definitions.find(d=>d.kind===kind)!);
const context={time:0,quality:'preview' as const,width:32,height:24};
describe('roots formula search',()=>{
 it('searches and screens all six named styles through the real polynomial solver',()=>{
  for(const [style]of ROOT_EXPLORER_STYLES){
   const s=scene('roots'),before=JSON.stringify(s);s.settings.sampleCount=16;
   const result=exploreComplex(s,{kind:'roots',seed:17,style,maxDegree:12,termCount:5,parameterCount:3,candidateCount:4,evaluationSamples:6});
   expect(result.status,style+JSON.stringify(result)).toBe('found');expect(result.attempted).toBe(4);expect(result.accepted).toBeGreaterThan(0);expect(result.candidate!.evaluation.finiteRatio).toBeGreaterThanOrEqual(.95);expect(result.candidate!.evaluation.maximumResidual).toBeLessThanOrEqual(1e-8);
   const candidate=result.scene!;expect(candidate.camera).toBe(s.camera);expect(candidate.palette).toBe(s.palette);for(let i=1;i<=3;i++)expect(candidate.equations.polynomial).toContain('t'+i);
   const polynomial=compilePolynomial(candidate.equations.polynomial,'z',['t1','t2','t3']);const coefficients=polynomial(prepareRootSampling(candidate.settings).sample(random(77)));
   expect(coefficients.length-1).toBe(12);expect(coefficients.filter(z=>Math.hypot(...z)>0)).toHaveLength(5);
   const rendered=definitions.find(d=>d.kind==='roots')!.generate(parseScene(JSON.stringify(candidate)),context);expect(rendered.stats.generated,style).toBeGreaterThan(50);
   expect(s.equations.polynomial).toBe(JSON.parse(before).equations.polynomial);
  }
 });
 it('repeats exact seeded equations/scores and honors explicit sampling ranges',()=>{
  const s=scene('roots');s.settings.rangeMin=2;s.settings.rangeMax=3;const options={kind:'roots' as const,seed:99,style:'BRANCH_WEB' as const,maxDegree:10,termCount:4,parameterCount:3,parameterDomain:'MIXED' as const,candidateCount:4,evaluationSamples:4};
  const a=exploreComplex(s,options),b=exploreComplex(s,options);expect(a.status).toBe('found');expect(a.scene).toEqual(b.scene);expect(a.candidate).toEqual(b.candidate);expect(parseRootParameters(a.scene!.settings).map(p=>[p.domain,p.minRe,p.maxRe])).toEqual([['UNIT_CIRCLE',2,3],['REAL_RANGE',2,3],['UNIT_CIRCLE',2,3]]);
  const sample=prepareRootSampling(a.scene!.settings).sample(random(5));expect(sample.t2[0]).toBeGreaterThanOrEqual(2);expect(sample.t2[0]).toBeLessThanOrEqual(3);expect(sample.t2[1]).toBe(0);
 });
 it('really samples t3 and keeps older two-factor seed sequences unchanged by an inactive third factor',()=>{
  const s=scene('roots');Object.assign(s.settings,{sampleCount:3,domain1:'FIXED',domain2:'FIXED',domain3:'FIXED',fixed3Real:.5,fixed3Imag:.75});s.equations.polynomial='z-t3';
  const result=definitions.find(d=>d.kind==='roots')!.generate(s,context);expect(result.type).toBe('geometry');if(result.type!=='geometry')return;expect(Array.from(result.positions)).toEqual([.5,.75,0,.5,.75,0,.5,.75,0]);
  const old=random(42),oldAngle=old()*Math.PI*2;const next=prepareRootSampling(scene('roots').settings).sample(random(42));expect(next.t1[0]).toBe(Math.cos(oldAngle));expect(next.t3).toEqual([1,0]);
 });
 it('reports the completed work when the requested search exceeds the solver budget',()=>{
  const s=scene('roots');s.settings.rootIterations=1000;const result=exploreComplex(s,{kind:'roots',seed:19,maxDegree:36,termCount:10,parameterCount:3,candidateCount:24,evaluationSamples:24});
  expect(result.attempted).toBeLessThan(24);expect(result.warnings.join(' ')).toContain('预算');
 });
});
describe('domain formula search',()=>{
 it('screens all nine families in the current viewport, independently of level-curve templates',()=>{
  for(const [family]of DOMAIN_FORMULA_FAMILIES.slice(1)){
   const s=scene('domain');Object.assign(s.settings,{centerX:.2,centerY:-.1,rotation:.25,scale:1.4,phaseDensity:11,iterationEnabled:true});s.equations.next='w';
   const before=structuredClone(s),result=exploreComplex(s,{kind:'domain',seed:12,family,candidateCount:3});expect(result.status,family+JSON.stringify(result)).toBe('found');expect(result.candidate!.family).toBe(family);expect(result.candidate!.evaluation.samples).toBe(221);expect(result.candidate!.evaluation.finiteRatio).toBeGreaterThanOrEqual(.9);
   const candidate=result.scene!;expect(candidate.palette).toEqual(before.palette);expect(candidate.camera).toEqual(before.camera);expect(candidate.settings).toMatchObject({centerX:.2,centerY:-.1,rotation:.25,scale:1.4,phaseDensity:11,iterationEnabled:false});expect(candidate.equations.next).toBe('w');expect(result.warnings.join(' ')).toContain('关闭旧迭代');
   expect(compileComplex(candidate.equations.f)( {...candidate.parameters,z:[.2,.4]}).every(Number.isFinite)).toBe(true);const output=definitions.find(d=>d.kind==='domain')!.generate(parseScene(JSON.stringify(candidate)),context);expect(output.stats.generated).toBeGreaterThan(32*24*.9);expect(s).toEqual(before);
  }
 });
 it('returns no candidate rather than fabricating success for a numerically constant viewport',()=>{
  const s=scene('domain');Object.assign(s.settings,{centerX:1e12,centerY:1e12,scale:1e12});const result=exploreComplex(s,{kind:'domain',family:'MOBIUS_ORBIT',seed:8,candidateCount:3});expect(result.status).toBe('no-candidate');expect(result.scene).toBeUndefined();expect(result.accepted).toBe(0);
 });
 it('is reproducible and changes formula across seeds',()=>{
  const s=scene('domain'),a=exploreComplex(s,{kind:'domain',seed:42}),b=exploreComplex(s,{kind:'domain',seed:42}),c=exploreComplex(s,{kind:'domain',seed:43});expect(a.scene).toEqual(b.scene);expect(a.candidate).toEqual(b.candidate);expect(a.scene!.equations.f).not.toBe(c.scene!.equations.f);
 });
});
describe('search ownership and input boundary',()=>{
 it('cancels without leaking a previously accepted candidate and emits ordered progress',()=>{
  const s=scene('domain'),progress:number[]=[];let cancelled=false;const result=exploreComplex(s,{kind:'domain',seed:1,candidateCount:12},{isCancelled:()=>cancelled,onProgress:p=>{progress.push(p.attempt);cancelled=true;}});expect(progress).toEqual([1]);expect(result.status).toBe('cancelled');expect(result.scene).toBeUndefined();
 });
 it('rejects invalid dimensions, types, seed and enum values rather than silently clamping',()=>{
  const r=scene('roots');for(const options of [{seed:NaN},{seed:-1},{maxDegree:3},{maxDegree:37},{termCount:11},{parameterCount:4},{candidateCount:0},{evaluationSamples:100},{style:'UNKNOWN'},{parameterDomain:'INVALID'}])expect(()=>exploreComplex(r,{kind:'roots',seed:1,...options} as any)).toThrow();
  expect(()=>exploreComplex(scene('domain'),{kind:'roots',seed:1})).toThrow();expect(()=>exploreComplex(scene('domain'),{kind:'domain',seed:1,family:'UNKNOWN'} as any)).toThrow();r.settings.rangeMin=3;r.settings.rangeMax=2;expect(()=>exploreComplex(r,{kind:'roots',seed:1})).toThrow();
 });
});
