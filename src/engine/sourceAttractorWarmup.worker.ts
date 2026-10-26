import {executeSourceAttractorWarmup,type SourceAttractorWarmupRequest} from './sourceAttractorWarmup';
const scope=self as DedicatedWorkerGlobalScope;
scope.onmessage=({data}:MessageEvent<SourceAttractorWarmupRequest>)=>{
 try{const result=executeSourceAttractorWarmup(data);scope.postMessage(result,[result.raw.buffer,result.steps.buffer]);}
 catch(error){scope.postMessage({kind:'failure',job:data?.job,slice:data?.slice,message:error instanceof Error?error.message:String(error)});scope.close();}
};
