import type {SourceBouncingConfiguration} from './sourceBouncingConfig';
import type {generateSourceBouncingSeeds} from './sourceBouncingSeeds';
import {requireSourceBouncing} from './sourceBouncingLimits';
type Seeds=Extract<ReturnType<typeof generateSourceBouncingSeeds>,{ok:true}>['value'];
/** This worker owns only local CPU computation. Termination never abandons a
 * remote resource; the page owns native state before and after the transfer. */
export function sourceBouncingSeedsInWorker(configuration:SourceBouncingConfiguration,signal:AbortSignal){
 return new Promise<Seeds>((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException('初始化已取消','AbortError'));return;}
  let worker:Worker|undefined;
  const finish=()=>{signal.removeEventListener('abort',cancel);if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();worker=undefined;}};
  const cancel=()=>{finish();reject(new DOMException('初始化已取消','AbortError'));};
  try{worker=new Worker(new URL('./sourceBouncingSeeds.worker.ts',import.meta.url),{type:'module'});signal.addEventListener('abort',cancel,{once:true});
   worker.onmessage=({data}:MessageEvent<ReturnType<typeof generateSourceBouncingSeeds>>)=>{try{const seed=requireSourceBouncing(data);if(!(seed.state instanceof Float32Array)||seed.state.length!==configuration.particleCount*4||seed.diagnostics.generated!==configuration.particleCount)throw Error('初始粒子响应不完整');finish();resolve(seed);}catch(error){finish();reject(error);}};
   worker.onerror=event=>{finish();reject(Error(event.message||'初始粒子后台失败'));};worker.onmessageerror=()=>{finish();reject(Error('初始粒子后台响应无效'));};worker.postMessage(configuration);
  }catch(error){finish();reject(error);}
 });
}
