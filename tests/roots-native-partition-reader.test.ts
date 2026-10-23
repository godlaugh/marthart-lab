import {describe,expect,it} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsMathJob} from '../src/engine/rootsMathJob';
import {RootsNativePointReader,createRootsNativeProgress} from '../src/engine/rootsNativePointReader';
import {prepareRootsWorkerPartitions} from '../src/engine/rootsSourceRandom';

function scene(){
 const s=withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());
 s.rootsMath!.polynomial={variable:'z',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
 s.rootsMath!.parameters=[{name:'t2',domain:'COMPLEX_RECT',minRe:-2,maxRe:3,minIm:-4,maxIm:5,value:[0,0]}];
 s.rootsMath!.sampling={sampleCount:17,batchSize:3,workerCount:4,seed:'-91',filter:''};
 return s;
}
describe('partition-local point counters and global sample identity',()=>{
 it.each(['points','count-only'] as const)('reads unequal worker partitions independently (%s)',storage=>{
  const s=scene(),whole=prepareRootsMathJob(s),state=createRootsNativeProgress(17),reader=new RootsNativePointReader(whole,state,storage),expected:unknown[]=[];
  try{for(let i=0;i<17;i++){const r=reader.read(0,'t2_imag');expected.push(storage==='points'?Array.from(r.points!):r.pointCount);}}finally{reader.dispose();whole.dispose();}
  const plan=prepareRootsWorkerPartitions(17,4,-91n);if(!plan.ok)throw Error('partition setup');
  // Out-of-order workers cannot change ordinal identity, even with unequal spans.
  const actual:unknown[]=new Array(17);
  for(const index of [3,1,0,2]){
   const partition=plan.value.partition(index),math=prepareRootsMathJob(s),local=createRootsNativeProgress(partition.count),part=new RootsNativePointReader(math,local,storage,()=>{},partition.start);
   try{
    for(let i=0;i<partition.count;i++){const r=part.read(0,'t2_imag');actual[partition.start+i]=storage==='points'?Array.from(r.points!):r.pointCount;expect(local.attemptedSamples).toBe(i+1);}
    expect(local.rootPoints).toBe(partition.count);expect(local.totalSamples).toBe(partition.count);
    expect(()=>part.read(0,'t2_imag')).toThrow(/已结束/);
   }finally{part.dispose();math.dispose();}
  }
  expect(actual).toEqual(expected);
 });
 it('validates the entire range before allocating and preserves cancellation without consuming its first sample',()=>{
  const math=prepareRootsMathJob(scene());let allocations=0;
  try{
   for(const [start,count] of [[-1,1],[.5,1],[17,1],[16,2],[Number.MAX_SAFE_INTEGER,1],[0,0],[0,NaN]])
    expect(()=>new RootsNativePointReader(math,createRootsNativeProgress(count),'points',()=>{allocations++;},start)).toThrow(/范围/);
   expect(allocations).toBe(0);
   const state=createRootsNativeProgress(4),r=new RootsNativePointReader(math,state,'points',()=>{allocations++;},13);
   try{
    expect(()=>r.read(0,'t2_imag',{isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));expect(state.attemptedSamples).toBe(0);
    expect(r.read(0,'t2_imag').pointCount).toBe(1);expect(state.attemptedSamples).toBe(1);
    state.totalSamples=5;expect(()=>r.read(0,'t2_imag')).toThrow(/计数范围/);expect(state.attemptedSamples).toBe(1);
   }finally{r.dispose();}
  }finally{math.dispose();}
 });
 it('counts filtered samples locally without shifting the next global ordinal',()=>{
  const s=scene();s.rootsMath!.sampling.filter='im(t2)>=0';
  const math=prepareRootsMathJob(s),state=createRootsNativeProgress(4),r=new RootsNativePointReader(math,state,'points',()=>{},13);
  try{for(let i=0;i<4;i++)r.read(0,'t2_imag');expect(state.attemptedSamples).toBe(4);expect(state.filteredSamples+state.acceptedPolynomials).toBe(4);expect(state.filteredSamples).toBeGreaterThan(0);}finally{r.dispose();math.dispose();}
 });
});
