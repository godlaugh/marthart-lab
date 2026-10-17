import type {RootsProgress} from '../types';
import type {Complex} from './complexMath';
import type {RootsMathJob} from './rootsMathJob';
import type {RootsMetricKind} from './rootsDensityColor';
import type {RootsNativeWorkHooks} from './rootsNativeExpression';
import {prepareRootsNativeArrival} from './rootsSampling';
import {RootsGpuError,rootsGpuCancel} from './rootsGpuFailure';

const noLegacyRandom={sample:()=>{throw new Error('Native Roots cannot use legacy random');},phase:()=>{throw new Error('Native Roots cannot use legacy phase');}};
export const createRootsNativeProgress=(total:number):RootsProgress=>({totalSamples:total,attemptedSamples:0,acceptedPolynomials:0,filteredSamples:0,invalidSamples:0,nonconvergentSamples:0,rootPoints:0,solverIterations:0,solverWork:0,maxResidual:null,complete:false});
export interface RootsNativePointSample {
 readonly filtered:boolean;readonly pointCount:number;readonly invalidRoots:number;
 /** Borrowed only until the next read/dispose; omitted by the count-only reader. */
 readonly points?:Float32Array;
}
/** The shared boundary from one mathematical sample to source raw float points.
 * Queue planning executes the same math and finite-double admission; it only
 * omits raw storage. Metrics/float overflow do not change that admission. */
export class RootsNativePointReader {
 private buffer?:Float32Array;private disposed=false;
 private root:Complex=[0,0];private metric?:RootsMetricKind;
 private arrival?:ReturnType<typeof prepareRootsNativeArrival>;
 get retainedBytes(){return this.buffer?.byteLength??0;}
 constructor(private readonly math:RootsMathJob,private readonly state:RootsProgress,storage:'points'|'count-only',admit:(bytes:number)=>void=()=>{}) {
  if(math.model!=='mathart-1.7.8-v1'||!Number.isSafeInteger(math.maxRootCount)||math.maxRootCount<0)throw new RootsGpuError('源复根点读取器需要有效源数学工作区','input');
  const bytes=storage==='points'?math.maxRootCount*16:0;
  if(!Number.isSafeInteger(bytes))throw new RootsGpuError('源复根单样本点表示容量溢出','capacity');
  admit(bytes);
  if(storage==='points')this.buffer=new Float32Array(math.maxRootCount*4);
 }
 read(time:number,metric:RootsMetricKind,hooks:RootsNativeWorkHooks={}):RootsNativePointSample {
  if(this.disposed)throw new RootsGpuError('源复根点读取器已释放','input');
  rootsGpuCancel(hooks.isCancelled);
  hooks.onWork?.(1);
  if(this.state.attemptedSamples>=this.state.totalSamples)throw new RootsGpuError('源复根采样已结束','input');
  if(this.metric!==metric){this.metric=metric;this.arrival=prepareRootsNativeArrival(metric);}
  const state=this.state,sampled=this.math.sample(state.attemptedSamples,time,noLegacyRandom,hooks);
  state.attemptedSamples++;
  if(sampled.status==='filtered'){state.filteredSamples++;return{filtered:true,pointCount:0,invalidRoots:0,points:this.buffer?.subarray(0,0)};}
  if(sampled.status==='invalid'){state.invalidSamples++;return{filtered:false,pointCount:0,invalidRoots:0,points:this.buffer?.subarray(0,0)};}
  if(!Number.isSafeInteger(state.solverWork+sampled.work)||!Number.isSafeInteger(state.solverIterations+sampled.iterations))throw new RootsGpuError('源复根累计求解计数超出精确整数范围','capacity');
  state.solverWork+=sampled.work;state.solverIterations+=sampled.iterations;
  if(sampled.iterationLimit)state.nonconvergentSamples++;
  if(!sampled.admitted)return{filtered:false,pointCount:0,invalidRoots:0,points:this.buffer?.subarray(0,0)};
  if(!Number.isSafeInteger(sampled.rootCount)||sampled.rootCount<0||sampled.rootCount>this.math.maxRootCount||sampled.rootCount*2>sampled.roots.length)throw new RootsGpuError('源求根结果超出已声明单样本容量','input');
  state.acceptedPolynomials++;
  hooks.onWork?.(sampled.rootCount);
  let count=0,invalidRoots=0;
  for(let i=0;i<sampled.rootCount;i++){
   if((i&1023)===0)rootsGpuCancel(hooks.isCancelled);
   this.root[0]=sampled.roots[i*2];this.root[1]=sampled.roots[i*2+1];
   const point=this.arrival!(this.root,sampled.parameters);
   if(point.kind==='invalid'){invalidRoots++;continue;}
   if(!Number.isSafeInteger(state.rootPoints+1))throw new RootsGpuError('源复根点计数超出精确整数范围','capacity');
   this.buffer?.set(point.values,count*4);count++;state.rootPoints++;
  }
  return{filtered:false,pointCount:count,invalidRoots,points:this.buffer?.subarray(0,count*4)};
 }
 dispose(){this.buffer=undefined;this.disposed=true;}
}
