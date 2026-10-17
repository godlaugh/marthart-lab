import {afterEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {exploreComplex,ROOT_EXPLORER_STYLES} from '../src/engine/complexExplore';
import {createRootsNativeMath,defaultRootNativeParameter} from '../src/engine/rootsMathConfig';
import {prepareRootsNativePolynomial} from '../src/engine/rootsNativePolynomial';
import {RootsNativeError} from '../src/engine/rootsNativeExpression';
import * as jobs from '../src/engine/rootsMathJob';

const source=()=>{const s=createScene(definitions.find(d=>d.kind==='roots')!);s.rootsMath=createRootsNativeMath(3);s.rootsMath.sampling={...s.rootsMath.sampling,sampleCount:40,seed:'9223372036854775807'};return s;};
const options={kind:'roots' as const,seed:17,maxDegree:12,termCount:5,parameterCount:3,candidateCount:4,evaluationSamples:6};
afterEach(()=>vi.restoreAllMocks());

describe('native Roots exploration changes the active structured program',()=>{
 it.each(ROOT_EXPLORER_STYLES)('screens source %s candidates through the actual shared job',(style)=>{
  const s=source(),before=structuredClone(s);s.equations.polynomial='INVALID DORMANT MATHJS';s.settings.variable='not a variable';s.settings.rootIterations='inactive';s.settings.rootTolerance='inactive';s.settings.rangeMin=9;s.settings.rangeMax=-9;s.settings.rootParameters='invalid dormant JSON';
  const preserved=structuredClone(s),result=exploreComplex(s,{...options,style});expect(result.status,JSON.stringify(result)).toBe('found');
  const candidate=result.scene!;expect(candidate.rootsMath!.polynomial.coefficients).toHaveLength(5);expect(candidate.rootsMath!.polynomial.coefficients[0]).toEqual({exponent:'12',expression:'1'});
  expect(candidate.rootsMath!.sampling).toEqual(before.rootsMath!.sampling);expect(candidate.rootsMath!.solver).toEqual(before.rootsMath!.solver);
  expect(candidate.equations).toBe(s.equations);expect(candidate.settings).toBe(s.settings);expect(candidate.parameters).toBe(s.parameters);expect(candidate.palette).toBe(s.palette);expect(candidate.camera).toBe(s.camera);expect(s).toEqual(preserved);
  expect(candidate.rootsMath!.parameters.map(p=>p.name)).toEqual(['t1','t2','t3']);expect(result.candidate!.formula).not.toBe(s.equations.polynomial);expect(result.candidate!.formula).toContain('*x^12');expect(result.candidate!.evaluation.maximumResidual).toBeUndefined();expect(result.candidate!.evaluation.work).toBeGreaterThan(0);
  const compiled=prepareRootsNativePolynomial(candidate.rootsMath!.polynomial);expect(compiled.ok).toBe(true);if(compiled.ok){expect(compiled.value.maxRootCount).toBe(12);compiled.value.dispose();}
  const job=jobs.prepareRootsMathJob(candidate);try{
   const sample=job.sample(0,0,{sample:()=>{throw new Error('source must ignore caller RNG');},phase:()=>{throw new Error('source must ignore caller phase');}});expect(sample.status).toBe('solved');if(sample.status==='solved'){expect(sample.admitted).toBe(true);expect(sample.rootCount).toBe(12);expect(sample.residual).toBeNull();}
  }finally{job.dispose();}expect(job.diagnostics().workspaceBytes).toBe(0);
 });
 it('reuses the last normalized t binding while preserving names, other definitions and authored reverse ranges',()=>{
  const s=source();s.rootsMath!.parameters=[{...defaultRootNativeParameter('t1'),minRe:8,maxRe:-2},{...defaultRootNativeParameter(' t1 '),minRe:3,maxRe:2},{...defaultRootNativeParameter('t2'),minRe:1,maxRe:.5},{...defaultRootNativeParameter('自由.参数'),domain:'FIXED',value:[7,8]}];
  const result=exploreComplex(s,{...options,parameterDomain:'MIXED'});expect(result.status,JSON.stringify(result)).toBe('found');
  const ps=result.scene!.rootsMath!.parameters;expect(ps).toHaveLength(5);expect(ps[0]).toEqual(s.rootsMath!.parameters[0]);expect(ps[1]).toMatchObject({name:' t1 ',minRe:3,maxRe:2,domain:'UNIT_CIRCLE'});expect(ps[2]).toMatchObject({name:'t2',minRe:1,maxRe:.5,domain:'REAL_RANGE'});expect(ps[3]).toEqual(s.rootsMath!.parameters[3]);expect(ps[4]).toEqual(defaultRootNativeParameter('t3'));
  expect(s.rootsMath!.parameters).toHaveLength(4);
 });
 it('retains full ensemble partition and reproduces its screened prefix, not a synthetic short ensemble',()=>{
  const s=source(),o={...options,candidateCount:1},r=exploreComplex(s,o);expect(r.status,JSON.stringify(r)).toBe('found');const job=jobs.prepareRootsMathJob(r.scene!);let good=0,total=0;const bins=new Set<number>();
  try{for(let ordinal=0;ordinal<6;ordinal++){const row=job.sample(ordinal,0,{sample:()=>0,phase:()=>0});expect(row.status).toBe('solved');if(row.status!=='solved')continue;total+=row.rootCount;for(let k=0;k<row.rootCount;k++){const x=row.roots[2*k],y=row.roots[2*k+1],radius=Math.hypot(x,y);if(!Number.isFinite(radius)||radius>1e4)continue;good++;bins.add(Math.min(23,Math.floor(((Math.atan2(y,x)/(Math.PI*2)+1)%1)*24)));}}}finally{job.dispose();}
  expect(r.candidate!.evaluation.finiteRatio).toBe(good/total);expect(r.candidate!.evaluation.angularCoverage).toBe(bins.size/24);expect(r.scene!.rootsMath!.sampling).toEqual(s.rootsMath!.sampling);
  const again=exploreComplex(s,o);expect(again.scene).toEqual(r.scene);expect(again.candidate).toEqual(r.candidate);
 });
 it('bounds small configured ensembles and respects source filtering without fabricating usable samples',()=>{
  const s=source();s.rootsMath!.sampling.sampleCount=2;const small=exploreComplex(s,{...options,evaluationSamples:24});expect(small.status).toBe('found');expect(small.candidate!.evaluation.samples).toBe(2);expect(small.scene!.rootsMath!.sampling.sampleCount).toBe(2);
  s.rootsMath!.parameters[1]={...defaultRootNativeParameter('t2'),domain:'FIXED',value:[0,-1]};s.rootsMath!.sampling.filter='im(t2)>=0';const before=structuredClone(s),filtered=exploreComplex(s,{...options,parameterCount:1});expect(filtered.status).toBe('no-candidate');expect(filtered.accepted).toBe(0);expect(filtered.scene).toBeUndefined();expect(s).toEqual(before);
 });
 it('can replace an invalid active expression and retain unknown variable metadata without compiling dormant math',()=>{
  const s=source();s.rootsMath!.polynomial={variable:{sourceValue:1.5,numberToken:'1.5'},coefficients:[{exponent:'2',expression:'('}]};const r=exploreComplex(s,options);expect(r.status).toBe('found');expect(r.scene!.rootsMath!.polynomial.variable).toEqual(s.rootsMath!.polynomial.variable);
 });
 it('keeps a dormant native payload untouched while the old exploration path remains selected',()=>{
  const s=source();s.rootsMath!.model='local-v1';s.rootsMath!.polynomial.coefficients=[{exponent:'bad',expression:'('}];const old=structuredClone(s.rootsMath),r=exploreComplex(s,options);expect(r.status).toBe('found');expect(r.scene!.rootsMath).toEqual(old);expect(r.scene!.equations.polynomial).not.toBe(s.equations.polynomial);
 });
});

describe('exploration shared job lifetime and failure classification',()=>{
 function observe(){const prepare=jobs.prepareRootsMathJob,owned:jobs.RootsMathJob[]=[];vi.spyOn(jobs,'prepareRootsMathJob').mockImplementation((scene,hooks)=>{const job=prepare(scene,hooks);owned.push(job);return job;});return owned;}
 it('releases every accepted/rejected candidate job after screening',()=>{const owned=observe(),r=exploreComplex(source(),options);expect(r.attempted).toBe(4);expect(owned).toHaveLength(4);expect(owned.every(j=>j.diagnostics().disposed&&j.diagnostics().workspaceBytes===0)).toBe(true);});
 it('cancels within actual preparation/solver work and never returns a partially checked candidate',()=>{
  const owned=observe();let checks=0;const r=exploreComplex(source(),options,{isCancelled:()=>++checks>180});expect(r.status).toBe('cancelled');expect(r.scene).toBeUndefined();expect(owned.length).toBeGreaterThan(0);expect(owned.every(j=>j.diagnostics().disposed)).toBe(true);
 });
 it('propagates callback and capacity failures while disposing the actual owned job',()=>{
  const s=source(),prepare=jobs.prepareRootsMathJob;let last:jobs.RootsMathJob|undefined;const error=new RootsNativeError('capacity','injected actual job work boundary');
  vi.spyOn(jobs,'prepareRootsMathJob').mockImplementation((scene,hooks)=>{const job=prepare(scene,hooks);last=job;return{...job,sample(){throw error;}};});expect(()=>exploreComplex(s,options)).toThrow(error);expect(last!.diagnostics().disposed).toBe(true);vi.restoreAllMocks();
  const owned=observe(),callbackError=new Error('caller cancelled predicate failed');let checks=0;expect(()=>exploreComplex(s,options,{isCancelled(){if(++checks>180)throw callbackError;return false;}})).toThrow(callbackError);expect(owned.every(j=>j.diagnostics().disposed)).toBe(true);
 });
 it('reports iteration-limit approximate roots without inventing residual convergence',()=>{
  const s=source();s.rootsMath!.solver.maxIterations=1;const r=exploreComplex(s,{...options,maxDegree:8,termCount:3});expect(r.status,JSON.stringify(r)).toBe('found');expect(r.candidate!.evaluation.iterationLimited).toBe(6);expect(r.candidate!.evaluation.maximumResidual).toBeUndefined();expect(r.warnings.join(' ')).toContain('迭代上限');
 });
 it('stops at a work meter boundary and releases a partial candidate instead of publishing it',()=>{
  const prepare=jobs.prepareRootsMathJob;let last:jobs.RootsMathJob|undefined;
  vi.spyOn(jobs,'prepareRootsMathJob').mockImplementation((scene,hooks)=>{const job=prepare(scene,hooks);last=job;return{...job,sample(_ordinal,_time,_random,work){work!.onWork!(100_000_001);throw new Error('Work meter did not stop');}};});
  const r=exploreComplex(source(),options);expect(r.status).toBe('no-candidate');expect(r.attempted).toBe(0);expect(r.scene).toBeUndefined();expect(r.warnings.join(' ')).toContain('工作预算');expect(last!.diagnostics().disposed).toBe(true);
 });
 it('charges actual native work, ignoring inactive legacy iteration estimates',()=>{
  const s=source();s.settings.rootIterations=2147483647;s.rootsMath!.solver.maxIterations=1;const r=exploreComplex(s,{...options,candidateCount:2});expect(r.attempted).toBe(2);expect(r.warnings.join(' ')).not.toContain('工作预算');
 });
});
