import type {ExportSessionTicket} from './exportSessionCleanup';

interface VideoResult {url:string;frames:number;}
interface VideoState {
 id:string;status:'encoding'|'finishing'|'complete'|'failed'|'cancelled';
 frames:number;expected:number;locked:boolean;finalFrames?:number;url?:string;error?:string;
}
type ResponseData=Pick<Response,'ok'|'status'|'json'>;
type Fetcher=(url:string,init:RequestInit)=>Promise<ResponseData>;
class HttpFailure extends Error {constructor(readonly status:number,message:string){super(message);}}
class TerminalFailure extends Error {}
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('录制服务返回的结果无效');
 return value as Record<string,unknown>;
};

/** One encoding session owns acknowledged uploads and its immutable finish
 * count. Unknown transport outcomes keep the caller's promise pending until
 * reconciliation or explicit retry/discard; they never release the live host. */
export class RecordingVideoDelivery {
 private acknowledged=0;
 private finalFrames?:number;
 private busy=false;
 constructor(private readonly ticket:ExportSessionTicket,private readonly expected:number,private readonly signal:AbortSignal,
  private readonly recover:(error:Error)=>Promise<void>,private readonly fetcher:Fetcher=(url,init)=>fetch(url,init),private readonly timeoutMs=60000){
  if(!Number.isSafeInteger(expected)||expected<1)throw Error('录制计划需要至少一个编码帧');
 }
 private check(){if(this.signal.aborted)throw new DOMException('导出已取消','AbortError');}
 private async request(suffix:string,init:RequestInit):Promise<unknown>{
  this.check();
  const response=await this.fetcher(`/api/exports/${this.ticket.id}${suffix}`,{...init,cache:'no-store',signal:AbortSignal.any([this.signal,AbortSignal.timeout(this.timeoutMs)])});
  let body:unknown;try{body=await response.json();}catch(error){if(response.status===404)throw new HttpFailure(404,'录制任务已不存在');throw error;}
  if(!response.ok){
   const detail=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).error:undefined;
   throw new HttpFailure(response.status,typeof detail==='string'?detail:`录制请求失败 (${response.status})`);
  }
  return body;
 }
 private result(value:unknown,count:number):VideoResult {
  const v=record(value),url=`/api/exports/${this.ticket.id}/file`;
  if(v.id!==this.ticket.id||v.url!==url||v.frames!==count)throw Error('录制完成响应的身份或帧数不匹配');
  return{url,frames:count};
 }
 private async state():Promise<VideoState>{
  let raw:unknown;try{raw=await this.request('',{method:'GET'});}catch(error){if(error instanceof HttpFailure&&error.status===404)throw new TerminalFailure(error.message);throw error;}
  const v=record(raw);
  if(v.id!==this.ticket.id||v.expected!==this.expected||!Number.isSafeInteger(v.frames)||Number(v.frames)<0||Number(v.frames)>this.expected||typeof v.locked!=='boolean'||typeof v.status!=='string'||!['encoding','finishing','complete','failed','cancelled'].includes(v.status)||v.finalFrames!==undefined&&(!Number.isSafeInteger(v.finalFrames)||Number(v.finalFrames)<1||Number(v.finalFrames)>this.expected))throw Error('录制任务状态无效');
  const state=v as unknown as VideoState;
  if(state.status==='failed'||state.status==='cancelled')throw new TerminalFailure(typeof state.error==='string'?state.error:'录制任务已失败或取消');
  return state;
 }
 private async perform<T>(send:()=>Promise<T>,reconcile:(state:VideoState)=>{done:true;value:T}|{done:false;retry:boolean}):Promise<T>{
  // One immediate retry after a confirmed server state. Further uncertainty
  // goes to the caller's explicit recovery UI rather than an unbounded poll.
  let automaticRetries=0;
  for(;;){
   this.check();let failure:unknown;
   try{return await send();}catch(error){failure=error;}
   this.check();
   try{
    const known=reconcile(await this.state());
    if(known.done)return known.value;
    if(known.retry&&automaticRetries++===0)continue;
   }catch(error){if(error instanceof TerminalFailure)throw error;failure=error;}
   this.check();await this.recover(failure instanceof Error?failure:new Error(String(failure)));automaticRetries=0;
  }
 }
 private async owned<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.busy)throw Error('录制传输仍在处理前一操作');
  this.busy=true;
  try{return await operation();}
  catch(error){
   // Cancellation and confirmed terminal failures abandon this encoding
   // session before the queue relinquishes its numerical owner. Failed
   // cleanup remains owned by ExportSessionCleanup after this object exits.
   if(this.signal.aborted||error instanceof TerminalFailure){
    try{await this.ticket.cleanup();}catch(cleanup){throw new AggregateError([error,cleanup],'录制结束但清理未完成');}
   }
   throw error;
  }finally{this.busy=false;}
 }
 upload(blob:Blob,index:number):Promise<void>{return this.owned(async()=>{
  if(this.finalFrames!==undefined||index!==this.acknowledged||index>=this.expected)throw Error('录制上传序号或完成状态无效');
  await this.perform(async()=>{
   const v=record(await this.request(`/frames?index=${index}`,{method:'POST',headers:{'content-type':'image/png'},body:blob}));
   if(v.frames!==index+1)throw Error('录制上传确认帧数不匹配');
  },state=>{
   if(state.status!=='encoding'||state.finalFrames!==undefined||state.frames<index||state.frames>index+1)throw new TerminalFailure('录制上传状态与当前连续帧不匹配');
   if(state.frames===index+1)return{done:true,value:undefined};
   return{done:false,retry:!state.locked};
  });
  this.acknowledged=index+1;
  this.check();
 });}
 finish(count:number):Promise<VideoResult>{return this.owned(async()=>{
  if(!Number.isSafeInteger(count)||count<1||count!==this.acknowledged||this.finalFrames!==undefined&&this.finalFrames!==count)throw Error('录制完成帧数必须等于已确认的连续上传帧');
  this.finalFrames=count;
  const result=await this.perform(async()=>this.result(await this.request('/finish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({finalFrames:count})}),count),state=>{
   if(state.frames!==count||state.finalFrames!==undefined&&state.finalFrames!==count)throw new TerminalFailure('录制任务的最终帧数不匹配');
   if(state.status==='complete'){
    if(state.finalFrames!==count)throw Error('录制完成状态缺少最终帧数');
    return{done:true,value:this.result(state,count)};
   }
   return{done:false,retry:!state.locked&&(state.status==='encoding'||state.status==='finishing')};
  });
  this.ticket.finished();return result;
 });}
}
