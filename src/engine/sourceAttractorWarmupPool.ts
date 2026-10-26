import {GenerationCleanupState} from './generationCleanup';
import {assertSourceAttractorWarmupPlan,SOURCE_ATTRACTOR_WARMUP_LIMITS,SourceAttractorWarmupError,type SourceAttractorWarmupPlan,type SourceAttractorWarmupMotion,type SourceAttractorWarmupRequest} from './sourceAttractorWarmup';

export interface SourceAttractorWarmupWorkerPort {
 onmessage:((event:MessageEvent<unknown>)=>void)|null;
 onerror:((event:ErrorEvent)=>void)|null;
 onmessageerror:((event:MessageEvent<unknown>)=>void)|null;
 postMessage(value:SourceAttractorWarmupRequest,transfer:Transferable[]):void;
 terminate():void;
}
export type SourceAttractorWarmupWorkerFactory=()=>SourceAttractorWarmupWorkerPort;
const makeWorker:SourceAttractorWarmupWorkerFactory=()=>new Worker(new URL('./sourceAttractorWarmup.worker.ts',import.meta.url),{type:'module'});
interface Peer {readonly port:SourceAttractorWarmupWorkerPort;pending?:number;}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
/** A pool exists only for one admitted initialization. Successful output is
 * published after every slice ACK and worker termination. Failed termination
 * retains the exact port for explicit reset/retry, never a new generation. */
export class SourceAttractorWarmupPool {
 private peers=new Set<Peer>();private readonly cleanup=new GenerationCleanupState();
 private active?:{fail:(error:unknown)=>void};private sequence=0;
 private last={workers:0,slices:0,completedSlices:0,work:0,reservedBytes:0};
 constructor(private readonly factory:SourceAttractorWarmupWorkerFactory=makeWorker){}
 diagnostics(){return{...this.last,ownedWorkers:this.peers.size,pending:!!this.active};}
 private stop(){this.cleanup.reset(()=>{const errors:unknown[]=[];for(const peer of this.peers){try{peer.port.terminate();peer.port.onmessage=null;peer.port.onerror=null;peer.port.onmessageerror=null;this.peers.delete(peer);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'吸引子预热 worker 清理失败');});}
 reset(){if(this.active){this.active.fail(new SourceAttractorWarmupError('cancelled','原版吸引子预热已取消'));return;}this.stop();}
 run(plan:SourceAttractorWarmupPlan,isCancelled?:()=>boolean):Promise<SourceAttractorWarmupMotion> {
  if(this.active||this.peers.size)throw new SourceAttractorWarmupError('protocol','预热资源仍被上一任务持有');
  this.cleanup.prepare();assertSourceAttractorWarmupPlan(plan);
  if(isCancelled?.())throw new SourceAttractorWarmupError('cancelled','原版吸引子预热已取消');
  if(!plan.equation.source)throw new SourceAttractorWarmupError('input','并行预热缺少公式生产者输入');
  const job=++this.sequence;if(!Number.isSafeInteger(job))throw new SourceAttractorWarmupError('capacity','预热任务序号已耗尽');
  // Pin every mutable input before the first asynchronous ACK. Delayed slices
  // cannot observe caller mutation of the otherwise typed prepared plan.
  const seeds=plan.raw.slice(),expectedSteps=plan.steps.slice();
  const raw=new Float32Array(plan.raw.length),steps=new Float64Array(plan.dt.length),dt=plan.dt.slice();
  this.last={workers:plan.workers,slices:plan.slices.length,completedSlices:0,work:plan.work,reservedBytes:plan.reservedBytes};
  return new Promise((resolve,reject)=>{
   let terminal=false,next=0,timer:ReturnType<typeof setInterval>|undefined;const start=performance.now();
   const finish=(failure?:unknown)=>{
    if(terminal)return;terminal=true;if(timer!==undefined)clearInterval(timer);this.active=undefined;
    try{this.stop();}catch(error){reject(failure?new AggregateError([failure,error],'预热失败且资源清理未完成'):error);return;}
    if(failure){reject(failure);return;}
    resolve({raw,dt,steps,work:plan.work,execution:'workers',workers:plan.workers,slices:plan.slices.length,reservedBytes:plan.reservedBytes});
   };
   this.active={fail:finish};
   const dispatch=(peer:Peer)=>{
    if(next===plan.slices.length)return;
    const slice=next++,part=plan.slices[slice],input=seeds.slice(part.offset*3,(part.offset+part.count)*3),time=dt.slice(part.offset,part.offset+part.count),counts=expectedSteps.slice(part.offset,part.offset+part.count);
    peer.pending=slice;
    peer.port.postMessage({kind:'warmup',job,slice,offset:part.offset,source:plan.equation.source!,operations:plan.equation.operations,raw:input,dt:time,steps:counts},[input.buffer,time.buffer,counts.buffer]);
   };
   const receive=(peer:Peer,value:unknown)=>{
    if(terminal)return;
    try{
     if(!object(value)||value.job!==job||value.slice!==peer.pending||peer.pending===undefined)throw new SourceAttractorWarmupError('protocol','预热响应不属于当前 worker 分片');
     if(value.kind==='failure')throw new SourceAttractorWarmupError('worker',typeof value.message==='string'?value.message:'预热 worker 失败');
     const part=plan.slices[peer.pending],positions=value.raw,counts=value.steps;
     if(value.kind!=='complete'||value.offset!==part.offset||value.work!==part.work||!(positions instanceof Float32Array)||positions.length!==part.count*3||!(counts instanceof Int32Array)||counts.length!==part.count)throw new SourceAttractorWarmupError('protocol','预热响应尺寸或工作量无效');
     for(const array of [positions,counts])if(!(array.buffer instanceof ArrayBuffer)||array.byteOffset!==0||array.byteLength!==array.buffer.byteLength)throw new SourceAttractorWarmupError('protocol','预热响应不是独占完整数组');
     for(let i=0;i<counts.length;i++)if(counts[i]!==expectedSteps[part.offset+i])throw new SourceAttractorWarmupError('protocol','预热 worker 未完成全部积分步');
     raw.set(positions,part.offset*3);steps.set(counts,part.offset);peer.pending=undefined;this.last.completedSlices++;
     if(isCancelled?.()){finish(new SourceAttractorWarmupError('cancelled','原版吸引子预热已取消'));return;}
     if(this.last.completedSlices===plan.slices.length){finish();return;}dispatch(peer);
    }catch(error){finish(error);}
   };
   try{
    // Create and own all ports before dispatch, including synchronous test
    // transports; a partial launch always has an exact cleanup owner.
    for(let i=0;i<plan.workers;i++){const peer:Peer={port:this.factory()};this.peers.add(peer);peer.port.onmessage=event=>receive(peer,event.data);peer.port.onerror=event=>finish(new SourceAttractorWarmupError('worker',event.message||'预热 worker 退出'));peer.port.onmessageerror=()=>finish(new SourceAttractorWarmupError('protocol','预热响应无法反序列化'));}
    if(!plan.slices.length){finish();return;}
    timer=setInterval(()=>{try{if(isCancelled?.())finish(new SourceAttractorWarmupError('cancelled','原版吸引子预热已取消'));else if(performance.now()-start>SOURCE_ATTRACTOR_WARMUP_LIMITS.timeoutMs)finish(new SourceAttractorWarmupError('capacity','预热超过本地 60 秒任务期限'));}catch(error){finish(error);}},10);
    for(const peer of this.peers){if(terminal)break;dispatch(peer);}
   }catch(error){finish(error);}
  });
 }
}
