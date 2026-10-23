import {prepareRootsComputationPlan,RootsComputationProducer,RootsComputationError} from './rootsComputation';
const scope=self as DedicatedWorkerGlobalScope;
let producer:RootsComputationProducer|undefined,busy=false,finished=false,sequence=0;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
async function produce(){
 if(!producer||busy||finished)throw new RootsComputationError('protocol','Invalid producer credit');
 busy=true;
 try{
  while(true){
   const result=producer.step(128);
   if(result.kind==='yield'){await new Promise<void>(resolve=>setTimeout(resolve,0));continue;}
   finished=result.batch.terminal;sequence++;
   scope.postMessage({kind:'batch',batch:result.batch},[result.batch.points.buffer]);
   if(finished)scope.close();return;
  }
 }finally{busy=false;}
}
scope.onmessage=async ({data}:MessageEvent<unknown>)=>{
 try{
  if(!record(data))throw new RootsComputationError('protocol','Worker request must be an object');
  if(data.kind==='start'){
   if(producer||finished)throw new RootsComputationError('protocol','Producer already started');
   if(typeof data.workerIndex!=='number'||!Number.isSafeInteger(data.workerIndex))throw new RootsComputationError('input','Invalid worker index');
   if(!record(data.limits))throw new RootsComputationError('input','Missing worker budgets');
   const result=prepareRootsComputationPlan(data.configuration,data.metric,{maximumWorkers:data.limits.maximumWorkers as number,maximumBytes:data.limits.maximumBytes as number});
   if(!result.ok)throw result.error;
   producer=new RootsComputationProducer(result.value,data.workerIndex);
  }else if(data.kind!=='credit'||data.sequence!==sequence)throw new RootsComputationError('protocol','Unexpected producer sequence');
  await produce();
 }catch(error){
  finished=true;producer?.dispose();
  scope.postMessage({kind:'failure',error:{kind:error instanceof RootsComputationError?error.kind:'worker',message:error instanceof Error?error.message:String(error)}});scope.close();
 }
};
