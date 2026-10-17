import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {RootsDensitySession,generateRootsDensity,rootsSchedule,rootsCompletionTime} from '../src/scenes/rootsDensity';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {prepareRootsMathJob,RootsMathSession} from '../src/engine/rootsMathJob';
import {RootsNativeError} from '../src/engine/rootsNativeExpression';
import type {RootNativeParameter,SceneDocument,SceneOutput} from '../src/types';
import fixture from './fixtures/roots/native-sampling-source.json';
const context={time:0,quality:'export' as const,width:32,height:24};
const row=(name:string,domain:RootNativeParameter['domain']='REAL_RANGE'):RootNativeParameter=>({name,domain,minRe:-5,maxRe:5,minIm:-1,maxIm:1,value:[2,3]});
function scene():SceneDocument {
 const s=createScene(definitions.find(d=>d.kind==='roots')!);s.rootsMath=createRootsNativeMath();
 s.rootsMath.polynomial={variable:'not-a-binding',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-(real+rectangle)'}]};
 s.rootsMath.parameters=[row('fixed','FIXED'),row('real'),{...row('rectangle','COMPLEX_RECT'),minRe:-1,maxRe:1}];
 s.rootsMath.sampling={sampleCount:10,batchSize:3,workerCount:3,seed:'0',filter:''};
 Object.assign(s.settings,{rootsMode:'single',presentation:'points',rootRender:'FLAT',rootColor:'radius',rootScale:1,rootScaleY:1,rotation:0,filter:'ALL',rootSamplesPerFrame:3,rootSamplingFps:10,rootStartTime:0,rootDensityBackend:'cpu',densityView:'manual',densityCenterX:0,densityCenterY:0,densitySpan:12});
 return s;
}
const raster=(o:SceneOutput)=>{if(o.type!=='raster')throw new Error('Expected raster');return o;};
const geometry=(o:SceneOutput)=>{if(o.type!=='geometry')throw new Error('Expected geometry');return o;};
const render=(s:SceneDocument,time=.3,owner?:RootsDensitySession)=>raster(generateRootsDensity(s,{...context,time},owner));
const noLegacyRandom={sample:()=>{throw new Error('source used legacy sample RNG');},phase:()=>{throw new Error('source used legacy phase RNG');}};
describe('source Roots public production pipeline',()=>{
 it.each(fixture.partitionAndDomain)('single geometry preserves independent worker streams N=$sampleCount W=$configuredWorkers seed=$seed',f=>{
  const s=scene();Object.assign(s.rootsMath!.sampling,{sampleCount:f.sampleCount,workerCount:f.configuredWorkers,seed:f.seed});
  const o=geometry(generateScene(s,context));
  const expected=f.workers.flatMap(w=>w.samples).flatMap(v=>[Math.fround(v.real+v.rectangle[0]),Math.fround(v.rectangle[1]),0]);
  expect(Array.from(o.positions)).toEqual(expected);expect(o.stats).toMatchObject({samples:f.sampleCount,generated:f.sampleCount,invalid:0});
 });
 it('ignores dormant local equations/settings/scalars but preserves them through save and reload',()=>{
  const s=scene(),expected=geometry(generateScene(s,context));
  s.equations.polynomial='broken((';Object.assign(s.settings,{seed:'not-a-number',rootIterations:-1,rootTolerance:0,variable:'?',sampleCount:0,rootParameters:'{bad',rootSampleFilter:'bad',rootFilterParameter:'missing'});s.parameters={time:123,real:456};
  const loaded=parseScene(JSON.stringify(s)),o=geometry(generateScene(loaded,context));
  expect(o.positions).toEqual(expected.positions);expect(loaded.equations).toEqual(s.equations);expect(loaded.rootsMath).toEqual(s.rootsMath);
 });
 it('uses full ensemble scheduling, independent of dormant sample count, seed and batch aliases',()=>{
  const s=scene();Object.assign(s.settings,{rootTotalSamples:99,rootBatchSize:999,seed:99});
  expect(rootsSchedule(s.settings,s.rootsMath)).toMatchObject({total:10,batch:3,seed:'0'});expect(rootsCompletionTime(s.settings,s.rootsMath)).toBe(.3);
  const o=render(s);expect(o.roots).toMatchObject({totalSamples:10,attemptedSamples:10,acceptedPolynomials:10,rootPoints:10,complete:true,math:{logicalWorkers:3,replayOrder:'global-ordinal',residualMeasured:false}});expect(o.roots?.maxResidual).toBe(null);
 });
 it('preserves warm/repeat/backseek/reload/transfer outputs and batch independence',()=>{
  const s=scene();s.settings.rootsMode='progressive';const owner=new TemporalGenerationSession();
  generateScene(s,context,owner);generateScene(s,{...context,time:.1},owner);const warm=raster(generateScene(s,{...context,time:.3},owner)),cold=render(s);
  expect(warm.pixels).toEqual(cold.pixels);expect(warm.roots).toEqual(cold.roots);
  expect(raster(generateScene(s,{...context,time:.3},owner)).temporal?.cacheHits).toBe(1);
  expect(raster(generateScene(s,{...context,time:.1},owner)).pixels).toEqual(render(s,.1).pixels);
  structuredClone(warm,{transfer:[warm.pixels.buffer]});expect(raster(generateScene(s,{...context,time:.3},owner)).pixels).toEqual(cold.pixels);
  expect(render(parseScene(JSON.stringify(s))).pixels).toEqual(cold.pixels);
  for(const batchSize of [1,4,1000]){const variant=structuredClone(s);variant.rootsMath!.sampling.batchSize=batchSize;const o=render(variant);expect(o.pixels).toEqual(cold.pixels);expect(o.roots).toEqual(cold.roots);}
  owner.reset();expect(owner.diagnostics().roots.retainedBytes).toBe(0);
 });
 it('replays changed geometry while retaining the prepared source mathematics',()=>{
  const s=scene(),owner=new RootsDensitySession();render(s,.3,owner);const prepared=owner.diagnostics().math.preparedJobs;
  s.settings.rootOffsetX=1;s.settings.rotation=.2;const changed=render(s,.3,owner);
  expect(changed.temporal?.cacheHits).toBe(0);expect(owner.diagnostics().math.preparedJobs).toBe(prepared);expect(changed.pixels).toEqual(render(s).pixels);
  s.rootsMath!.solver.tolerance=1e-8;render(s,.3,owner);expect(owner.diagnostics().math.preparedJobs).toBe(prepared+1);owner.reset();expect(owner.diagnostics().math.retainedJobs).toBe(0);
 });
 it('invalidates changed active mathematics and worker partition, but reuses dormant local edits',()=>{
  const s=scene(),owner=new RootsDensitySession(),a=render(s,.3,owner);
  const dormant=structuredClone(s);dormant.equations.polynomial='(';dormant.parameters={real:123};dormant.settings.seed='bad';dormant.settings.rootTotalSamples=0;
  const b=render(dormant,.3,owner);expect(b.temporal?.cacheHits).toBe(1);expect(b.pixels).toEqual(a.pixels);
  const changed=structuredClone(s);changed.rootsMath!.sampling.workerCount=1;const c=render(changed,.3,owner);expect(c.temporal?.cacheHits).toBe(0);expect(c.pixels).toEqual(render(changed).pixels);expect(c.pixels).not.toEqual(a.pixels);
  changed.rootsMath!.polynomial.coefficients[1].expression='-1';expect(render(changed,.3,owner).pixels).toEqual(render(changed).pixels);
 });
 it('admits source finite approximations after one iteration without applying a residual gate',()=>{
  const s=scene();s.rootsMath!.parameters=[];s.rootsMath!.polynomial.coefficients=[{exponent:'5',expression:'1'},{exponent:'1',expression:'1'},{exponent:'0',expression:'-1'}];s.rootsMath!.solver.maxIterations=1;s.rootsMath!.sampling.sampleCount=2;
  const o=render(s);expect(o.roots).toMatchObject({acceptedPolynomials:2,nonconvergentSamples:2,rootPoints:10,maxResidual:null,math:{iterationLimitSamples:2}});expect(o.stats.invalid).toBe(0);expect(o.density!.occupiedPixels).toBeGreaterThan(0);
  expect(geometry(generateScene(s,context)).positions.length).toBe(30);
 });
 it.each([49,64,128])('supports declared degree %i through the actual generation buffer',degree=>{
  const s=scene();s.rootsMath!.parameters=[];s.rootsMath!.polynomial.coefficients=[{exponent:String(degree),expression:'1'},{exponent:'0',expression:'-1'}];s.rootsMath!.sampling.sampleCount=2;
  const o=render(s);expect(o.roots).toMatchObject({rootPoints:degree*2,acceptedPolynomials:2});expect(o.stats.invalid).toBe(0);expect(geometry(generateScene(s,context)).positions.length).toBe(degree*6);
 });
 it('treats explicit zero polynomial as empty solved output and unknown bindings as sample failures',()=>{
  const s=scene();s.rootsMath!.polynomial.coefficients=[];
  expect(render(s).roots).toMatchObject({acceptedPolynomials:10,invalidSamples:0,rootPoints:0});
  s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'time'}];s.parameters={time:2};
  expect(render(s).roots).toMatchObject({acceptedPolynomials:0,invalidSamples:10,rootPoints:0});
  s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'unknown(1)'}];expect(render(s).roots?.invalidSamples).toBe(10);
 });
 it('filters before evaluating, consumes all parameter draws, and uses final trimmed bindings for color',()=>{
  const s=scene();s.rootsMath!.sampling.filter='im(t2)>=0';s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'missing'}];
  expect(render(s).roots).toMatchObject({filteredSamples:10,invalidSamples:0});
  s.rootsMath!.sampling.filter='';s.rootsMath!.parameters=[{...row(' t2','FIXED'),value:[1,0]},{...row('t2 ','FIXED'),value:[.25,0]}];s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}];
  const job=prepareRootsMathJob(s);try{const result=job.sample(0,0,noLegacyRandom);expect(result.status).toBe('solved');if(result.status==='solved'){expect(result.parameters.t2).toEqual([.25,0]);expect(result.roots[0]).toBe(.25);}expect(job.parameters).toHaveLength(1);}finally{job.dispose();}
 });
 it('counts nonfinite terminal roots before upper-half filtering and distinguishes roots from samples',()=>{
  const s=scene();s.rootsMath!.parameters=[];s.rootsMath!.sampling.sampleCount=1;
  s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'1e-160'},{exponent:'0',expression:'1e308*i'}];
  for(const filter of ['ALL','UPPER_HALF']){s.settings.filter=filter;const single=geometry(generateScene(s,context)),density=render(s);expect(single.stats).toMatchObject({samples:1,generated:0,invalid:1});expect(density.density).toMatchObject({inputPoints:1,invalid:1});}
  s.rootsMath!.polynomial.coefficients=[{exponent:'2',expression:'1'},{exponent:'0',expression:'1/0'}];
  const o=geometry(generateScene(s,context));expect(o.stats).toMatchObject({samples:1,invalid:2});expect(o.warnings).toContain('2 个根点非有限或超出坐标范围，已跳过。');
 });
 it('fails closed on syntax/capacity and clears session ownership on cancellation',()=>{
  const s=scene(),owner=new RootsDensitySession();render(s,0,owner);let checks=0;
  expect(()=>owner.generate(s,{...context,time:.3,isCancelled:()=>++checks>5})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);expect(render(s,.3,owner).pixels).toEqual(render(s).pixels);
  s.rootsMath!.polynomial.coefficients=[{exponent:'2147483647',expression:'0'}];expect(()=>render(s,.3,owner)).toThrow(/budget/);expect(owner.diagnostics().retainedBytes).toBe(0);
  s.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'('}];expect(()=>render(s,.3,owner)).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('reuses mathematical workspaces across presentation frames and releases invalidated jobs',()=>{
  const s=scene(),owner=new RootsMathSession(),a=owner.get(s),first=a.sample(0,0,noLegacyRandom);expect(first.status).toBe('solved');
  s.settings.rootOffsetX=3;s.palette.offset=.5;expect(owner.get(s)).toBe(a);
  const before=a.diagnostics().workspaceBytes;expect(before).toBeGreaterThan(0);a.sample(1,0,noLegacyRandom);expect(a.diagnostics().workspaceBytes).toBe(before);
  s.rootsMath!.sampling.seed='1';expect(owner.get(s)).not.toBe(a);expect(a.diagnostics()).toEqual({workspaceBytes:0,disposed:true});owner.dispose();expect(owner.diagnostics().retainedJobs).toBe(0);
 });
 it('propagates original callback failures for both mathematical models',()=>{
  for(const native of [true,false]){
   const s=scene();if(!native){delete s.rootsMath;s.equations.polynomial='z^5+z-1';}
   const job=prepareRootsMathJob(s),failure=new RootsNativeError('evaluation','caller failure');
   try{expect(()=>job.sample(0,0,{sample:()=>.4,phase:()=>.5},{onWork:()=>{throw failure;}})).toThrow(failure);expect(()=>job.sample(0,0,{sample:()=>.4,phase:()=>.5},{isCancelled:()=>{throw failure;}})).toThrow(failure);}finally{job.dispose();}
  }
 });
});
