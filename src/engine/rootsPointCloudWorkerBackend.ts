import type {RootsPointCloudAsyncBackend,RootsPointCloudAsyncDisplay,RootsPointCloudTarget} from './rootsPointCloudAsync';
import type {RootsPointPrograms} from './rootsPointCloudDrawing';
import type {RootsPointBrokerCall,RootsPointBrokerCoverage,RootsPointBrokerResult} from './rootsPointCloudBrokerProtocol';
import {RootsGpuError,rootsGpuCancel} from './rootsGpuFailure';

const MAX_BYTES=768*1024*1024;
function require(ok:unknown,message:string):asserts ok {if(!ok)throw new RootsGpuError(message,'input');}
type Target={width:number;height:number;displayIndex:number;pointSizeRange:readonly[number,number]};
/** Worker-side drawing adapter only. It streams independent prepared chunks;
 * the presentation session owns both solver clocks and retained pixel copies. */
export class RootsPointCloudWorkerBackend implements RootsPointCloudAsyncBackend {
 private readonly targets=new Map<RootsPointCloudTarget,Target>();
 private active?:Promise<unknown>;private displayId=0;
 constructor(private readonly call:RootsPointBrokerCall){}
 private run<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.active)return Promise.reject(new RootsGpuError('复根原生操作尚未确认','input'));
  const pending=operation(),settled=pending.finally(()=>{if(this.active===settled)this.active=undefined;});this.active=settled;return settled;
 }
 private async rpc<K extends RootsPointBrokerResult['kind']>(command:Parameters<RootsPointBrokerCall>[0]&{kind:K},displayId:number){
  const result=await this.call(command,displayId);require(result&&result.kind===command.kind,'复根原生响应操作不匹配');return result as Extract<RootsPointBrokerResult,{kind:K}>;
 }
 initialize(target:RootsPointCloudTarget,size:{width:number;height:number},programs:RootsPointPrograms){
  return this.run(async()=>{
   const width=size.width,height=size.height,old=this.targets.get(target);
   if(old)require(old.width===width&&old.height===height,'复根尺寸变化前必须释放旧目标');
   const result=await this.rpc({kind:'initialize',target,size:{width,height},programs},0);
   require(result.width===width&&result.height===height&&Array.isArray(result.pointSizeRange)&&result.pointSizeRange.length===2&&result.pointSizeRange.every(Number.isFinite)&&result.pointSizeRange[0]>0&&result.pointSizeRange[1]>=Math.max(1,result.pointSizeRange[0]),'复根原生设备范围无效');
   if(old)require(old.pointSizeRange.every((n,i)=>n===result.pointSizeRange[i]),'复根原生设备范围变化');
   const pointSizeRange=Object.freeze([...result.pointSizeRange]) as readonly[number,number];
   this.targets.set(target,{width,height,displayIndex:old?.displayIndex??0,pointSizeRange});return{pointSizeRange};
  });
 }
 display(target:RootsPointCloudTarget,input:RootsPointCloudAsyncDisplay){
  return this.run(async()=>{
   const state=this.targets.get(target);require(state,'复根原生目标尚未初始化');
   const {chunks,metadata,workerRetainedBytes,isCancelled}=input;
   require(Number.isSafeInteger(workerRetainedBytes)&&workerRetainedBytes>=0,'复根 Worker 保留容量无效');
   if(workerRetainedBytes+chunks.chunkPoints*16+state.width*state.height*8>MAX_BYTES)throw new RootsGpuError('复根 Worker 分块和像素交付超过 768 MiB','capacity');
   require(this.displayId<0xffffffff&&state.displayIndex<0xffffffff,'复根原生显示序号已耗尽');
   rootsGpuCancel(isCancelled);chunks.assertCurrent();const displayId=++this.displayId;
   const totalChunks=chunks.rangeCounts.reduce((sum,n)=>sum+Math.ceil(n/chunks.chunkPoints),0),displayIndex=state.displayIndex;
   const coverage=(r:RootsPointBrokerCoverage,received:number,next:number,finished=false)=>{
    require(r.displayIndex===displayIndex+(finished?1:0)&&r.totalPoints===chunks.pointCount&&r.totalChunks===totalChunks&&r.receivedPoints===received&&r.nextChunk===next&&r.pointDraws===next&&r.fadeDraws===Number(metadata.fade!==undefined)&&r.clears===Number(metadata.clear!==undefined),'复根原生确认未覆盖完整点流');
   };
   const began=await this.rpc({kind:'begin',target,metadata,rangeCounts:chunks.rangeCounts,chunkPoints:chunks.chunkPoints},displayId);
   coverage(began,0,0);chunks.assertCurrent();rootsGpuCancel(isCancelled);
   let received=0,ordinal=0;
   for(const chunk of chunks){
    rootsGpuCancel(isCancelled);chunks.assertCurrent();
    require(chunk.ordinal===ordinal&&chunk.points.buffer instanceof ArrayBuffer&&chunk.points.byteOffset===0&&chunk.points.byteLength===chunk.points.buffer.byteLength&&chunk.points.length===chunk.pointCount*4,'复根异步上传必须持有独立完整分块');
    const count=chunk.pointCount;
    const ack=await this.rpc({kind:'append',target,ordinal:chunk.ordinal,rangeIndex:chunk.rangeIndex,rangeOffset:chunk.rangeOffset,points:chunk.points},displayId);
    received+=count;ordinal++;coverage(ack,received,ordinal);chunks.assertCurrent();rootsGpuCancel(isCancelled);
   }
   require(received===chunks.pointCount&&ordinal===totalChunks,'复根分块计划提前结束');
   const result=await this.rpc({kind:'finish',target},displayId);coverage(result,received,ordinal,true);
   require(result.width===state.width&&result.height===state.height&&result.pixels instanceof Uint8ClampedArray&&result.pixels.buffer instanceof ArrayBuffer&&result.pixels.length===state.width*state.height*4&&typeof result.rendererIdentity==='string'&&/^[a-f0-9]{64}$/.test(result.rendererIdentity)&&Number.isSafeInteger(result.generation)&&result.generation>0&&Number.isSafeInteger(result.sequence)&&result.sequence>0,'复根原生完整像素响应无效');
   // Acknowledge the actual completed display before observing cancellation.
   state.displayIndex=result.displayIndex;chunks.assertCurrent();rootsGpuCancel(isCancelled);
   return{width:result.width,height:result.height,pixels:result.pixels,rendererIdentity:result.rendererIdentity,generation:result.generation,sequence:result.sequence,requestBytes:result.requestBytes,displayIndex:result.displayIndex};
  });
 }
 release(target?:RootsPointCloudTarget):Promise<void>{
  return this.run(async()=>{await this.rpc({kind:'release',...(target?{target}:{})},0);if(target)this.targets.delete(target);else this.targets.clear();});
 }
 async settle():Promise<void>{await this.active?.catch(()=>{});}
}
