import type {RootParameter,SceneDocument} from '../types';
import type {Complex} from './complexMath';
import {numberSetting} from './expression';
import {prepareRootSampling} from './rootsParameterSampling';
import {compilePolynomial,solvePolynomial} from './polynomial';
import {parseRootsMath,usesRootsNativeMath} from './rootsMathConfig';
import {prepareRootsNativePolynomial,type PreparedRootsNativePolynomial} from './rootsNativePolynomial';
import {prepareRootsNativeSampling,type PreparedRootsNativeSampling} from './rootsNativeSampling';
import {createRootsNativeSolver,type RootsNativeSolver} from './rootsNativeSolver';
import {RootsNativeError,type RootsNativeWorkHooks} from './rootsNativeExpression';

export type RootMathSample={status:'filtered'}|{status:'invalid'}|{
 status:'solved';admitted:boolean;
 /** Borrowed until the next sample/reset/dispose. */
 roots:Float64Array;rootCount:number;parameters:Readonly<Record<string,Complex>>;
 iterations:number;work:number;residual:number|null;iterationLimit:boolean;
};
export interface RootsMathJob {
 readonly model:'local-v1'|'mathart-1.7.8-v1';
 readonly maxRootCount:number;readonly workspaceCapacityBytes:number;readonly parameters:readonly RootParameter[];
 readonly ensemble?:{sampleCount:number;batchSize:number;workers:number;configuredWorkers:number;seed:string};
 /** Legacy callers supply their established sample and phase streams. The
  * source model uses only its owned, ordinal-addressed Java worker streams. */
 sample(ordinal:number,time:number,random:{sample:()=>number;phase:()=>number},hooks?:RootsNativeWorkHooks):RootMathSample;
 reset():void;dispose():void;diagnostics():{workspaceBytes:number;disposed:boolean};
}
class CallbackFailure {constructor(readonly original:unknown){}}
const protectedHooks=(hooks:RootsNativeWorkHooks):RootsNativeWorkHooks=>({
 isCancelled:()=>{try{return hooks.isCancelled?.()??false;}catch(error){throw new CallbackFailure(error);}},
 onWork:n=>{try{hooks.onWork?.(n);}catch(error){throw new CallbackFailure(error);}},
});
/** The only production boundary selecting root expression/solver/RNG semantics.
 * Expected per-sample evaluation failures can be counted. Capacity, cancellation
 * and caller failures never become an apparently successful empty sample. */
export function prepareRootsMathJob(scene:SceneDocument,hooks:RootsNativeWorkHooks={}):RootsMathJob {
 if(usesRootsNativeMath(scene)){
  const config=parseRootsMath(scene.rootsMath);
  let polynomial:PreparedRootsNativePolynomial|undefined,sampling:PreparedRootsNativeSampling|undefined,solver:RootsNativeSolver|undefined;
  try{
   const p=prepareRootsNativePolynomial(config.polynomial,hooks);if(!p.ok)throw p.error;polynomial=p.value;
   const s=prepareRootsNativeSampling(config.parameters,config.sampling,hooks);if(!s.ok)throw s.error;sampling=s.value;
   solver=createRootsNativeSolver();
  }catch(error){polynomial?.dispose();sampling?.dispose();solver?.dispose();throw error;}
  const p=polynomial,s=sampling,solve=solver,parameters=[...s.bindings.values()].map(row=>({...row,value:[...row.value] as Complex}));
  // One stable adapter for presentation consumers. Tuples remain owned by the
  // sampler, and are never copied once per root or interpreted again here.
  const values:Record<string,Complex>=Object.create(null);let bound=false,disposed=false;
  const fail=(error:RootsNativeError):RootMathSample=>{if(error.kind==='evaluation')return{status:'invalid'};throw error;};
  return{
   model:config.model,maxRootCount:p.maxRootCount,workspaceCapacityBytes:p.workspaceBytes+(p.maxRootCount+1)*64,parameters,
   ensemble:{sampleCount:config.sampling.sampleCount,batchSize:config.sampling.batchSize,workers:s.partitions.workerCount,configuredWorkers:config.sampling.workerCount,seed:config.sampling.seed},
   sample(ordinal,_time,_random,work={}){
    if(disposed)throw new Error('Root mathematical job was disposed');
    const sample=s.sampleAt(ordinal,work);if(!sample.ok)return fail(sample.error);
    if(!sample.value.passesFilter)return{status:'filtered'};
    if(!bound){for(const [name,value] of sample.value.values)values[name]=value as Complex;bound=true;}
    const coefficients=p.evaluate(sample.value.values,work);if(!coefficients.ok)return fail(coefficients.error);
    const result=solve.solve(coefficients.value,{...config.solver,...work});if(!result.ok)return fail(result.error);
    const r=result.value;
    return{status:'solved',admitted:true,roots:r.roots,rootCount:r.rootCount,parameters:values,iterations:r.iterations,work:r.work,residual:null,iterationLimit:r.stop==='iteration-limit'};
   },
   reset(){s.reset();},
   dispose(){if(disposed)return;disposed=true;p.dispose();s.dispose();solve.dispose();for(const key of Object.keys(values))delete values[key];},
   diagnostics(){return{workspaceBytes:disposed?0:p.workspaceBytes+solve.diagnostics().workspaceBytes,disposed};},
  };
 }
 const settings=scene.settings,sampling=prepareRootSampling(settings,Object.keys(scene.parameters));
 const polynomial=compilePolynomial(scene.equations.polynomial??'z^8+t1*z^3+t2',String(settings.variable??'z'),[...Object.keys(scene.parameters),...sampling.names,'time']);
 const maxIterations=numberSetting(settings,'rootIterations',150,1,2000),tolerance=numberSetting(settings,'rootTolerance',1e-8,1e-14,.01);
 if(!Number.isInteger(maxIterations))throw new Error('求根迭代次数须为整数');
 const filter=String(settings.rootSampleFilter??'all'),filterName=String(settings.rootFilterParameter??'t2');
 if(!['all','parameter-imag-nonnegative'].includes(filter))throw new Error('rootSampleFilter 不支持 '+filter);
 if(filter!=='all'&&!sampling.names.includes(filterName))throw new Error('采样过滤参数不存在：'+filterName);
 const scalar={...scene.parameters};let roots=new Float64Array(96),disposed=false;
 return{
  model:'local-v1',maxRootCount:48,workspaceCapacityBytes:96*8,parameters:sampling.parameters,
  sample(_ordinal,time,random,hooks={}){
   if(disposed)throw new Error('Root mathematical job was disposed');
   if(hooks.isCancelled?.())throw new DOMException('复根求解已取消','AbortError');
   const parameters=sampling.sample(random.sample);
   if(filter!=='all'&&!(parameters[filterName][1]>=0))return{status:'filtered'};
   let coefficients:Complex[];try{coefficients=polynomial({...scalar,time,...parameters});}catch{return{status:'invalid'};}
   const phase=random.phase();
   let result;
   try{result=solvePolynomial(coefficients,maxIterations,tolerance,phase,protectedHooks(hooks));}
   catch(error){if(error instanceof CallbackFailure)throw error.original;if(error instanceof DOMException&&error.name==='AbortError')throw error;return{status:'invalid'};}
   for(let i=0;i<result.roots.length;i++){roots[i*2]=result.roots[i][0];roots[i*2+1]=result.roots[i][1];}
   return{status:'solved',admitted:result.converged,roots,rootCount:result.roots.length,parameters,iterations:result.iterations,work:result.work,residual:result.residual,iterationLimit:!result.converged};
  },
  reset(){roots.fill(0);},dispose(){disposed=true;roots=new Float64Array();},
  diagnostics(){return{workspaceBytes:roots.byteLength,disposed};},
 };
}
/** One owned prepared job survives frames while its mathematical inputs match.
 * Source presentation edits do not recompile coefficients or reset RNG state. */
export class RootsMathSession {
 private key='';private job?:RootsMathJob;private preparedJobs=0;
 get(scene:SceneDocument,hooks:RootsNativeWorkHooks={}):RootsMathJob {
  const key=JSON.stringify(usesRootsNativeMath(scene)?scene.rootsMath:{equations:scene.equations,parameters:scene.parameters,settings:scene.settings});
  if(this.job&&key===this.key)return this.job;
  this.dispose();const job=prepareRootsMathJob(scene,hooks);this.job=job;this.key=key;this.preparedJobs++;return job;
 }
 reset(){this.job?.reset();}
 dispose(){this.job?.dispose();this.job=undefined;this.key='';}
 diagnostics(){return{workspaceBytes:this.job?.diagnostics().workspaceBytes??0,keyBytes:this.key.length*2,retainedJobs:this.job?1:0,preparedJobs:this.preparedJobs};}
}
