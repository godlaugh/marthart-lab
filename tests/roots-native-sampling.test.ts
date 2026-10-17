import {describe,it,expect} from 'vitest';
import type {RootNativeParameter,RootsMathConfiguration} from '../src/types';
import {prepareRootsNativeSampling,type PreparedRootsNativeSampling} from '../src/engine/rootsNativeSampling';
import {RootsNativeError,type RootsNativeResult} from '../src/engine/rootsNativeExpression';
import fixtures from './fixtures/roots/native-sampling-source.json';
const row=(name:string,domain:RootNativeParameter['domain']='REAL_RANGE'):RootNativeParameter=>({name,domain,minRe:-5,maxRe:5,minIm:-1,maxIm:1,value:[2,3]});
const settings=(patch:Partial<RootsMathConfiguration['sampling']>={}):RootsMathConfiguration['sampling']=>({sampleCount:10,batchSize:256,workerCount:1,seed:'0',filter:'',...patch});
const unwrap=<T>(r:RootsNativeResult<T>):T=>{if(!r.ok)throw r.error;return r.value;};
const plan=(rows:RootNativeParameter[],patch:Partial<RootsMathConfiguration['sampling']>={})=>unwrap(prepareRootsNativeSampling(rows,settings(patch)));
const copy=(p:PreparedRootsNativeSampling,ordinal:number)=>{
 const s=unwrap(p.sampleAt(ordinal));return{...s,values:new Map([...s.values].map(([k,v])=>[k,[...v]]))};
};
describe('source Roots worker-domain sample owner',()=>{
 it.each(fixtures.partitionAndDomain)('matches independent complete streams for N=$sampleCount W=$configuredWorkers seed=$seed',fixture=>{
  const p=plan([row('fixed','FIXED'),row('real'),{...row('rectangle','COMPLEX_RECT'),minRe:-1,maxRe:1}],{sampleCount:fixture.sampleCount,workerCount:fixture.configuredWorkers,seed:fixture.seed});
  expect(p.drawsPerSample).toBe(fixture.drawsPerSample);
  for(const worker of fixture.workers)for(const expected of worker.samples){
   const got=copy(p,expected.ordinal);
   expect(got.workerIndex).toBe(worker.worker);
   expect(got.workerSampleOrdinal).toBe(expected.ordinal-worker.start);
   expect(got.values.get('fixed')).toEqual(expected.fixed);
   expect(got.values.get('real')).toEqual([expected.real,0]);
   expect(got.values.get('rectangle')).toEqual(expected.rectangle);
  }
 });
 it('seeks into any worker stream without consuming another worker or solver phase',()=>{
  const fixture=fixtures.partitionAndDomain[0],p=plan([row('fixed','FIXED'),row('real'),{...row('rectangle','COMPLEX_RECT'),minRe:-1,maxRe:1}],{sampleCount:fixture.sampleCount,workerCount:fixture.configuredWorkers,seed:fixture.seed});
  const cases=fixture.workers.flatMap(w=>w.samples);
  for(const ordinal of [9,0,6,1,7,2,9,3,4,5]){
   const expected=cases.find(x=>x.ordinal===ordinal)!,got=copy(p,ordinal);
   expect(got.values.get('real')).toEqual([expected.real,0]);
   expect(got.values.get('rectangle')).toEqual(expected.rectangle);
  }
  expect(p.diagnostics().randomInstances).toBe(1);
 });
 it('samples each colliding trimmed name before keeping the final value',()=>{
  const p=plan([row('t2 '),row(' t2'),row('last')]);
  const got=copy(p,0);expect(p.names).toEqual(['t2','last']);expect(p.drawsPerSample).toBe(3);
  expect(got.values.get('t2')).toEqual([-5+0.24053641567148587*10,0]);
  expect(got.values.get('last')).toEqual([-5+0.6374174253501083*10,0]);
 });
 it('uses Java blank then trim, preserving exact case and prototype-like names',()=>{
  const p=plan([row('\0','FIXED'),row('\u00a0','FIXED'),row('constructor','FIXED'),row('__proto__','FIXED'),row('T2','FIXED')],{filter:'im(t2)>=0'});
  const got=copy(p,0);expect([...got.values.keys()]).toEqual(['','\u00a0','constructor','__proto__','T2']);expect(got.passesFilter).toBe(false);
  expect(prepareRootsNativeSampling([row('\u3000')],settings())).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('retains source circle operation order and zero-draw fixed values',()=>{
  const p=plan([row('fixed','FIXED'),row('circle','UNIT_CIRCLE'),row('real')]);
  const got=copy(p,0),theta=(0.730967787376657*Math.PI)*2;
  expect(got.values.get('circle')).toEqual([Math.cos(theta),Math.sin(theta)]);
  expect(got.values.get('real')).toEqual([-5+0.24053641567148587*10,0]);
  expect(p.drawsPerSample).toBe(2);
 });
 it('sorts ranges once, consumes a draw for a degenerate range, and retains overflow',()=>{
  const p=plan([{...row('flat'),minRe:2,maxRe:2},{...row('reversed'),minRe:5,maxRe:-5},{...row('overflow'),minRe:-Number.MAX_VALUE,maxRe:Number.MAX_VALUE}]);
  const got=copy(p,0);
  expect(got.values.get('flat')).toEqual([2,0]);
  expect(got.values.get('reversed')).toEqual([-5+0.24053641567148587*10,0]);
  expect(got.values.get('overflow')?.[0]).toBe(Infinity);
 });
 it('normalizes only ASCII spaces in the source filter and handles missing/negative/zero t2',()=>{
  for(const filter of [' Im( t2 ) >= 0 ',' T2.IM >=0 ']){
   const missing=plan([],{filter});expect(copy(missing,0).passesFilter).toBe(false);
   for(const im of [-1,-0,0,1]){const p=plan([{...row('t2','FIXED'),value:[-0,im]}],{filter});const got=copy(p,0);expect(got.passesFilter).toBe(im>=0);expect(Object.is(got.values.get('t2')?.[0],-0)).toBe(false);}
  }
  expect(copy(plan([],{filter:'im(\tt2)>=0'}),0).passesFilter).toBe(true);
  expect(copy(plan([],{filter:'unknown'}),0).passesFilter).toBe(true);
 });
 it('bounds lazy worker state even when configuredWorkers exceeds the sample count',()=>{
  const p=plan([row('x')],{sampleCount:2,workerCount:2147483647});
  expect(p.partitions.workerCount).toBe(2);expect(copy(p,1).workerIndex).toBe(1);expect(p.diagnostics().randomInstances).toBe(1);
 });
 it('does not use JavaScript parsing for authored signed-long seeds',()=>{
  const a=plan([row('x')],{seed:'+０００１'}),b=plan([row('x')],{seed:'1'});
  expect(copy(a,0).values).toEqual(copy(b,0).values);
  expect(prepareRootsNativeSampling([],settings({seed:'9223372036854775808'}))).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('borrows a stable map and releases owned state on dispose',()=>{
  const p=plan([row('x')]),first=unwrap(p.sampleAt(0)),old=first.values.get('x')![0],second=unwrap(p.sampleAt(1));
  expect(second.values).toBe(first.values);expect(first.values.get('x')![0]).not.toBe(old);
  p.reset();expect(p.diagnostics().nextOrdinal).toBe(null);expect(copy(p,0).values.get('x')?.[0]).toBe(old);
  p.dispose();expect(first.values.size).toBe(0);expect(p.diagnostics()).toEqual({definitions:0,bindings:0,randomInstances:0,nextOrdinal:null});expect(p.sampleAt(0)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('recovers the exact sample after cancellation or an external work failure mid-draw',()=>{
  const rows=[row('x'),row('y','COMPLEX_RECT')],p=plan(rows);let checks=0;
  expect(()=>p.sampleAt(0,{isCancelled:()=>++checks===4})).toThrow(DOMException);
  expect(copy(p,0)).toEqual(copy(plan(rows),0));
  const failure=new Error('request work limit');let work=0;
  expect(()=>p.sampleAt(1,{onWork:n=>{work+=n;if(work>3)throw failure;}})).toThrow(failure);
  expect(copy(p,1)).toEqual(copy(plan(rows),1));
  const capacity=new RootsNativeError('capacity','parent budget');expect(()=>p.sampleAt(2,{onWork:()=>{throw capacity;}})).toThrow(capacity);
  expect(copy(p,2)).toEqual(copy(plan(rows),2));
 });
 it('rejects invalid ordinals and never mutates source definitions',()=>{
  const rows=[{...row('x'),minRe:10,maxRe:-10}],before=structuredClone(rows),p=plan(rows);
  for(const ordinal of [-1,10,.5,NaN,Infinity])expect(p.sampleAt(ordinal)).toMatchObject({ok:false,error:{kind:'input'}});
  copy(p,0);expect(rows).toEqual(before);
 });
});
