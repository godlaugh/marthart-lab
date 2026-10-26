import {encodeSourceFractalNativeRequest,captureSourceFractalNativeResponseBinding,decodeSourceFractalNativeResponse,sourceFractalNativeResponseBytes,type SourceFractalNativeRequest,type SourceFractalNativeResponse,type SourceFractalNativeRetainedTarget} from './sourceFractalNativeProtocol';
import {encodeSourceIteratedRenderNativeRequest,captureSourceIteratedRenderNativeResponseBinding,decodeSourceIteratedRenderNativeResponse,type SourceIteratedRenderNativeRequest,type SourceIteratedRenderNativeResponse} from './sourceIteratedRenderNativeProtocol';
import {encodeSourceIteratedNativeRequest,captureSourceIteratedNativeResponseBinding,decodeSourceIteratedNativeResponse,sourceIteratedNativeResponseBytes,type SourceIteratedNativeRequest,type SourceIteratedNativeResponse} from './sourceIteratedNativeProtocol';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from './sourceDrawingFrame';

import {SourceNativeError} from './sourceNativeError';
export {SourceNativeError} from './sourceNativeError';
import {sourceNativeLeaseToken,ensureSourceNativeLease} from './sourceNativeLease';
import {encodeSourceNativeDrawingRequest,decodeSourceNativeDrawingResponse,type SourceNativeDrawingRequest,type SourceNativeDrawingResponse,type SourceNativeDrawingFrame} from './sourceDrawingNativeProtocol';
import type {SourceDrawingPlan} from './sourceDrawingSnapshot';
import {encodeSourceSamilaNativeRequest,decodeSourceSamilaNativeResponse,type SourceSamilaNativeRequest,type SourceSamilaNativeResponse,type SourceSamilaNativeRetainedTarget} from './sourceSamilaNativeProtocol';
export interface SourceNativePixels {width:number;height:number;pixels:Uint8ClampedArray;rendererIdentity:string;generation:number;sequence:number;requestBytes:number}
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw signal.reason instanceof SourceNativeError?signal.reason:new DOMException('原生帧已取消','AbortError');};
async function bytes(response:Response,limit:number,signal:AbortSignal){
 if(!response.body)throw new SourceNativeError('protocol','原生响应缺少内容');
 const reader=response.body.getReader(),output=new Uint8Array(limit);let length=0;
 try{while(true){check(signal);const next=await reader.read();if(next.done)break;if(next.value.length>limit-length)throw new SourceNativeError('capacity','原生响应超过容量');output.set(next.value,length);length+=next.value.length;}
  return output.subarray(0,length);
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function header(response:Response,name:string){const value=response.headers.get(name);if(!value||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new SourceNativeError('protocol','原生响应头无效');return Number(value);}
const errorKinds=new Set(['input','capacity','closed','unavailable','cancelled','timeout','runtime','protocol','unsupported','cleanup','state-lost','ownership']);
/** Only the gateway's occupied transport slot is retryable, never a memory
 * capacity failure or a guessed message string. */
class SourceNativeBusyError extends SourceNativeError {constructor(message:string){super('capacity',message);}}
async function remoteError(response:Response,signal:AbortSignal):Promise<never>{
 let value:Record<string,unknown>;try{const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,8192,signal)));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new SourceNativeError('protocol','原生后端错误响应不是对象');value=parsed as Record<string,unknown>;}catch(error){if(signal.aborted)throw error;throw new SourceNativeError('protocol','原生后端错误响应无效');}
 const kind=typeof value.kind==='string'&&errorKinds.has(value.kind)?value.kind:response.status===503?'unavailable':response.status===429?'capacity':'runtime';
 if(value.retryable!==undefined&&(typeof value.retryable!=='boolean'||value.retryable&&(response.status!==429||value.kind!=='capacity')))throw new SourceNativeError('protocol','原生后端重试标记无效');
 if(value.gpuStage!==undefined&&(value.kind!=='runtime'||typeof value.gpuStage!=='string'||!['context','compile','link','allocation','render','readback'].includes(value.gpuStage)))throw new SourceNativeError('protocol','原生 GPU 失败阶段无效');
 const message=typeof value.error==='string'?value.error:'原生渲染失败';
 if(value.retryable===true)throw new SourceNativeBusyError(message);
 throw new SourceNativeError(kind,message,value.gpuStage as import('./sourceNativeError').SourceNativeGpuStage|undefined);
}
export interface SourceNativeAcknowledgement {generation:number;sequence:number;uploadedParticles:number;rendererIdentity:string;requestBytes:number}
export interface SourceNativeSamilaResponse extends SourceSamilaNativeResponse {width:number;height:number;generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
export interface SourceNativeIteratedResponse extends SourceIteratedNativeResponse {width:number;height:number;generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
export interface SourceNativeIteratedRenderResponse extends SourceIteratedRenderNativeResponse {generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
export interface SourceNativeFractalResponse extends SourceFractalNativeResponse {generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
type NativeRequest={family:'drawing-chunks';frame:SourceNativeDrawingRequest}|{family:'fractal';frame:SourceFractalNativeRequest}|{family:'drawing';frame:SourceDrawingFrame}|{family:'samila';frame:SourceSamilaNativeRequest}|{family:'iterated';frame:SourceIteratedNativeRequest}|{family:'iterated-render';frame:SourceIteratedRenderNativeRequest};
type DrawingResponse=SourceNativeDrawingResponse&{format:'drawing-v1';generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number};
type NativeResponse=DrawingResponse|({format:'fractal-v1'}&SourceNativeFractalResponse)|({format:'rgba8'}&SourceNativePixels)|({format:'u32le'}&SourceNativeAcknowledgement)|({format:'samila-v1'}&SourceNativeSamilaResponse)|({format:'iterated-v1'}&SourceNativeIteratedResponse)|({format:'iterated-render-v1'}&SourceNativeIteratedRenderResponse);
type NativeOptions={signal?:AbortSignal;retainedBytes?:number};
/** One shared browser slot, no background queue. Callers retain presentation
 * ownership and must await this frame or explicitly cancel it before replacing
 * it. The loopback gateway separately coordinates other windows/consumers. */
let active:symbol|undefined;
async function exchange(request:NativeRequest,options:NativeOptions&{samilaRetainedTarget?:SourceSamilaNativeRetainedTarget;fractalRetainedTarget?:SourceFractalNativeRetainedTarget;drawingSlot?:symbol;drawingChunks?:number;drawingPacket?:Uint8Array}):Promise<NativeResponse>{
 const frame=request.frame,chunks=request.family==='drawing-chunks',fractal=request.family==='fractal',samila=request.family==='samila',iterated=request.family==='iterated',render=request.family==='iterated-render',control=request.family==='drawing-chunks'?request.frame.operation.kind!=='finish':request.family==='fractal'||request.family==='iterated'||(request.family==='iterated-render'?request.frame.operation.kind!=='present':request.family==='samila'?!['display','present'].includes(request.frame.operation.kind):!!request.frame.bouncing&&request.frame.bouncing.kind!=='draw');
 check(options.signal);if(!options.drawingSlot&&pendingDrawing&&!active)await releaseSourceNativeDrawingFrame();check(options.signal);if(options.drawingSlot){if(active!==options.drawingSlot)throw new SourceNativeError('ownership','分块绘制不属于当前事务');}else{if(active||pendingDrawing)throw new SourceNativeError('capacity','当前页面已有原生帧或待清理事务');active=Symbol();}
 const controller=new AbortController(),cancel=()=>controller.abort(options.signal?.reason),timer=setTimeout(()=>controller.abort(new SourceNativeError('timeout','原生帧传输超时')),20000);
 options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  const encoding={isCancelled:()=>controller.signal.aborted,retainedBytes:options.retainedBytes},packet=options.drawingPacket?{ok:true as const,value:options.drawingPacket}:request.family==='drawing-chunks'?encodeSourceNativeDrawingRequest(request.frame,encoding):request.family==='fractal'?encodeSourceFractalNativeRequest(request.frame,{...encoding,retainedTarget:options.fractalRetainedTarget}):request.family==='iterated-render'?encodeSourceIteratedRenderNativeRequest(request.frame,encoding):request.family==='iterated'?encodeSourceIteratedNativeRequest(request.frame,encoding):request.family==='samila'?encodeSourceSamilaNativeRequest(request.frame,{...encoding,retainedTarget:options.samilaRetainedTarget}):encodeSourceDrawingFrame(request.frame,encoding);if(!packet.ok)throw new SourceNativeError(packet.error.kind,packet.error.reason);
  const expected={generation:frame.generation,sequence:frame.sequence,width:request.family==='iterated'?1:request.frame.width,height:request.family==='iterated'?1:request.frame.height};
  const fractalBinding=request.family==='fractal'?captureSourceFractalNativeResponseBinding(request.frame):undefined;
  const iteratedBinding=request.family==='iterated'?captureSourceIteratedNativeResponseBinding(request.frame):undefined,renderBinding=request.family==='iterated-render'?captureSourceIteratedRenderNativeResponseBinding(request.frame):undefined;
  const response=await fetch('/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...(sourceNativeLeaseToken()?{'x-source-lease':sourceNativeLeaseToken()!}:{})},body:packet.value as Uint8Array<ArrayBuffer>,signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok)await remoteError(response,controller.signal);
  const identity=response.headers.get('x-source-renderer');
  if(response.headers.get('content-type')!=='application/octet-stream'||response.headers.get('x-source-format')!==(chunks?'drawing-v1':fractal?'fractal-v1':render?'iterated-render-v1':iterated?'iterated-v1':samila?'samila-v1':control?'u32le':'rgba8')||response.headers.get('x-source-row-order')!==(control?'none':'bottom-up')||!identity||!/^[a-f0-9]{64}$/.test(identity))throw new SourceNativeError('protocol','原生响应格式或后端身份无效');
  for(const [name,value]of Object.entries(expected))if(header(response,'x-source-'+name)!==value)throw new SourceNativeError('protocol','原生响应与请求帧不一致');
  const length=chunks?64+(control?0:expected.width*expected.height*4):fractalBinding?sourceFractalNativeResponseBytes(fractalBinding):renderBinding?128+(renderBinding.kind==='present'?renderBinding.width*renderBinding.height*4:0):iteratedBinding?sourceIteratedNativeResponseBytes(iteratedBinding):samila?64+(control?0:expected.width*expected.height*4):expected.width*expected.height*4;if(header(response,'content-length')!==length)throw new SourceNativeError('protocol','原生像素长度无效');
  const raw=await bytes(response,length,controller.signal);if(raw.length!==length)throw new SourceNativeError('protocol','原生像素响应截断');
  const fractalResult=fractalBinding?decodeSourceFractalNativeResponse(raw,fractalBinding):undefined;
  const samilaResult=request.family==='samila'?decodeSourceSamilaNativeResponse(raw,request.frame):undefined,iteratedResult=iteratedBinding?decodeSourceIteratedNativeResponse(raw,iteratedBinding):undefined,renderResult=renderBinding?decodeSourceIteratedRenderNativeResponse(raw,renderBinding):undefined;
  const contextSerial=chunks||fractal||samila||iterated||render?header(response,'x-source-context'):0,sessionSerial=chunks||fractal||samila||iterated||render?header(response,'x-source-session'):0;
  if(request.family==='drawing-chunks'){let result:SourceNativeDrawingResponse;try{result=decodeSourceNativeDrawingResponse(raw,request.frame,options.drawingChunks!);}catch(error){throw new SourceNativeError('protocol',error instanceof Error?error.message:'分块响应无效');}if(!sessionSerial||result.disposition==='owned'&&!contextSerial)throw new SourceNativeError('protocol','分块原生context身份无效');check(controller.signal);return{format:'drawing-v1',...expected,...result,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};}
  if(fractalResult){if(!sessionSerial||fractalResult.disposition==='owned'&&!contextSerial)throw new SourceNativeError('protocol','分形原生 context 身份无效');check(controller.signal);return{format:'fractal-v1',...expected,...fractalResult,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};}
  if(samila&&(!sessionSerial||samilaResult?.disposition==='owned'&&!contextSerial))throw new SourceNativeError('protocol','Samila 原生 context 身份无效');
  if(iteratedResult){if(!sessionSerial||iteratedResult.disposition==='owned'&&!contextSerial)throw new SourceNativeError('protocol','迭代原生 context 身份无效');check(controller.signal);return{format:'iterated-v1',...expected,...iteratedResult,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};}
  if(renderResult&&(!sessionSerial||renderResult.disposition==='owned'&&!contextSerial))throw new SourceNativeError('protocol','迭代原生绘制 context 身份无效');
  if(renderResult&&control){check(controller.signal);return{format:'iterated-render-v1',...expected,...renderResult,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};}
  if(samila&&control){check(controller.signal);return{format:'samila-v1',...expected,...samilaResult!,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};}
  if(control){check(controller.signal);return{format:'u32le',generation:frame.generation,sequence:frame.sequence,uploadedParticles:new DataView(raw.buffer,raw.byteOffset,4).getUint32(0,true),rendererIdentity:identity,requestBytes:packet.value.byteLength};}
  const pixels=renderResult?.pixels??samilaResult?.pixels??new Uint8ClampedArray(raw.buffer,raw.byteOffset,raw.byteLength),stride=expected.width*4,row=new Uint8ClampedArray(stride);
  for(let y=0;y<Math.floor(expected.height/2);y++){check(controller.signal);const a=y*stride,b=(expected.height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}
  check(controller.signal);if(renderResult)return{format:'iterated-render-v1',...expected,...renderResult,pixels,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};
  if(samilaResult)return{format:'samila-v1',...expected,...samilaResult,pixels,rendererIdentity:identity,contextSerial,sessionSerial,requestBytes:packet.value.byteLength};
  return{format:'rgba8',...expected,pixels,rendererIdentity:identity,requestBytes:packet.value.byteLength};
 }catch(error){controller.abort();throw error;}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(!options.drawingSlot)active=undefined;}
}

export async function renderSourceNativeFrame(frame:SourceDrawingFrame,options:NativeOptions={}):Promise<SourceNativePixels>{
 if(frame.bouncing&&frame.bouncing.kind!=='draw')throw new SourceNativeError('input','状态控制请求需要确认接口');
 const result=await exchange({family:'drawing',frame},options);if(result.format!=='rgba8')throw new SourceNativeError('protocol','原生绘图响应类型不符');return result;
}
export async function controlSourceBouncingState(frame:SourceDrawingFrame,options:NativeOptions={}):Promise<SourceNativeAcknowledgement>{
 if(!frame.bouncing||frame.bouncing.kind==='draw')throw new SourceNativeError('input','状态确认接口不能绘图');
 const result=await exchange({family:'drawing',frame},options);if(result.format!=='u32le')throw new SourceNativeError('protocol','原生状态确认类型不符');
 const expected=frame.bouncing.kind==='upload'?frame.bouncing.offset+frame.bouncing.particles.length/4:0;if(result.uploadedParticles!==expected)throw new SourceNativeError('protocol','原生状态上传进度与请求不符');return result;
}

/** Uses the same page request slot and lease as every other native family. */
export async function exchangeSourceSamilaNative(request:SourceSamilaNativeRequest,options:NativeOptions&{retainedTarget?:SourceSamilaNativeRetainedTarget}={}):Promise<SourceNativeSamilaResponse>{
 const result=await exchange({family:'samila',frame:request},{...options,samilaRetainedTarget:options.retainedTarget});if(result.format!=='samila-v1')throw new SourceNativeError('protocol','Samila 原生响应类型不符');return result;
}

/** Bounded diagnostic state exchange shares the same request slot and lease. */
export async function exchangeSourceIteratedNative(request:SourceIteratedNativeRequest,options:NativeOptions={}):Promise<SourceNativeIteratedResponse>{
 const result=await exchange({family:'iterated',frame:request},options);if(result.format!=='iterated-v1')throw new SourceNativeError('protocol','迭代原生响应类型不符');return result;
}

/** Retained ink shares the page slot and lease with its compute owner. */
export async function exchangeSourceIteratedRenderNative(request:SourceIteratedRenderNativeRequest,options:NativeOptions={}):Promise<SourceNativeIteratedRenderResponse>{
 const result=await exchange({family:'iterated-render',frame:request},options);if(result.format!=='iterated-render-v1')throw new SourceNativeError('protocol','迭代原生绘制响应类型不符');return result;
}

/** Ordered sample records share the page slot and lease; they are not image rows. */
export async function exchangeSourceFractalNative(request:SourceFractalNativeRequest,options:NativeOptions&{retainedTarget?:SourceFractalNativeRetainedTarget}={}):Promise<SourceNativeFractalResponse>{
 const result=await exchange({family:'fractal',frame:request},{...options,fractalRetainedTarget:options.retainedTarget});if(result.format!=='fractal-v1')throw new SourceNativeError('protocol','分形原生响应类型不符');return result;
}


type DrawingCustody={frame:SourceNativeDrawingFrame;resource:string;index:number;chunks:number;identity?:string;context?:number;session?:number};
let pendingDrawing:DrawingCustody|undefined;
const drawingFailure=(error:unknown)=>error instanceof Error?error.message:String(error);
function drawingIdentity(state:DrawingCustody,response:DrawingResponse){
 if(state.identity&&(state.identity!==response.rendererIdentity||state.context!==response.contextSerial||state.session!==response.sessionSerial))throw new SourceNativeError('state-lost','分块绘制的原生上下文已变化');
 state.identity=response.rendererIdentity;state.context=response.contextSerial;state.session=response.sessionSerial;
}
async function drawingExchange(state:DrawingCustody,operation:SourceNativeDrawingRequest['operation'],slot:symbol,signal?:AbortSignal,retainedBytes=0,drawingPacket?:Uint8Array){
 const result=await exchange({family:'drawing-chunks',frame:{...state.frame,operation}},{signal,retainedBytes,drawingSlot:slot,drawingChunks:state.chunks,drawingPacket});
 if(result.format!=='drawing-v1')throw new SourceNativeError('protocol','分块绘制响应类型不符');return result;
}
async function releaseDrawing(slot:symbol){
 const state=pendingDrawing;if(!state)return;
 // fetch abort can precede the gateway's cancelled request/child retirement.
 // Keep custody and the page slot through explicitly retryable busy replies.
 // One deadline covers lease, retries and ACK; never inherit the draw signal.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new SourceNativeError('timeout','原生帧清理等待超时')),20000);
 let result:DrawingResponse,attempt=0;
 try{
  await ensureSourceNativeLease(controller.signal);
  while(true){
   check(controller.signal);
   try{result=await drawingExchange(state,{kind:'release',resource:state.resource,expectedIndex:state.index},slot,controller.signal);break;}
   catch(error){if(!(error instanceof SourceNativeBusyError))throw error;check(controller.signal);}
   await new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(wait);reject(controller.signal.reason);},wait=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(250,25*2**attempt++));
    controller.signal.addEventListener('abort',cancel,{once:true});
   });
  }
 }finally{clearTimeout(timer);}
 if(result.disposition==='owned')throw new SourceNativeError('protocol','分块资源释放未确认');
 if(result.disposition==='released')drawingIdentity(state,result);
 if(pendingDrawing===state)pendingDrawing=undefined;
}
/** Retry only this retained transaction's cleanup. Failure keeps custody. */
export async function releaseSourceNativeDrawingFrame():Promise<void>{
 if(active)throw new SourceNativeError('capacity','原生绘制尚未完成，不能并发清理');if(!pendingDrawing)return;const slot=Symbol();active=slot;
 try{await releaseDrawing(slot);}finally{active=undefined;}
}
/** Holds the shared page slot through begin, every acknowledged chunk, final
 * readback and explicit release. No partial image escapes this transaction. */
export async function renderSourceNativeChunks(input:SourceNativeDrawingFrame,plan:SourceDrawingPlan,options:{signal?:AbortSignal}={}):Promise<SourceNativePixels>{
 const frame:SourceNativeDrawingFrame={...input,clear:[...input.clear]};check(options.signal);if(active)throw new SourceNativeError('capacity','当前页面已有原生帧请求');if(pendingDrawing)await releaseSourceNativeDrawingFrame();if(active)throw new SourceNativeError('capacity','清理后原生通道已由其它请求持有');
 const slot=Symbol();active=slot;let primary:unknown,result:SourceNativePixels|undefined;
 try{
  const begin={kind:'begin' as const,resource:crypto.randomUUID().replaceAll('-',''),chunkCount:plan.chunkCount,maxChunkBytes:plan.maxChunkBytes,metadataBytes:plan.admittedMetadataBytes,schedule:plan.schedule};
  const admitted=encodeSourceNativeDrawingRequest({...frame,operation:begin},{retainedBytes:plan.retainedBytes,isCancelled:()=>!!options.signal?.aborted});if(!admitted.ok)throw new SourceNativeError(admitted.error.kind,admitted.error.reason);
  await ensureSourceNativeLease(options.signal??new AbortController().signal);check(options.signal);
  const state:DrawingCustody={frame:{...frame,clear:[...frame.clear]},resource:begin.resource,index:0,chunks:plan.chunkCount};pendingDrawing=state;
  let reply:DrawingResponse;
  try{reply=await drawingExchange(state,begin,slot,options.signal,plan.retainedBytes,admitted.value);}catch(error){if(error instanceof SourceNativeError&&error.kind==='ownership')pendingDrawing=undefined;throw error;}
  drawingIdentity(state,reply);let requestBytes=reply.requestBytes;
  while(true){check(options.signal);const next=plan.next();if(!next.ok)throw new SourceNativeError(next.error.kind,next.error.reason);const chunk=next.value;if(!chunk)break;
   let chunkError:unknown;
   try{reply=await drawingExchange(state,{kind:'append',resource:state.resource,chunk},slot,options.signal);drawingIdentity(state,reply);state.index=reply.index;requestBytes+=reply.requestBytes;}
   catch(error){chunkError=error;}
   const released=chunk.release();if(!released.ok)throw new SourceNativeError('cleanup',`${chunkError?drawingFailure(chunkError)+'; ':''}分块释放失败: ${released.error.reason}`);if(chunkError)throw chunkError;
  }
  if(state.index!==state.chunks)throw new SourceNativeError('protocol','分块计划提前结束');
  reply=await drawingExchange(state,{kind:'finish',resource:state.resource,expectedIndex:state.index},slot,options.signal);drawingIdentity(state,reply);requestBytes+=reply.requestBytes;
  if(!reply.pixels)throw new SourceNativeError('protocol','分块完成响应缺少像素');const pixels=reply.pixels,stride=frame.width*4,row=new Uint8ClampedArray(stride);
  for(let y=0;y<Math.floor(frame.height/2);y++){check(options.signal);const a=y*stride,b=(frame.height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}check(options.signal);
  result={width:frame.width,height:frame.height,pixels,rendererIdentity:reply.rendererIdentity,generation:frame.generation,sequence:frame.sequence,requestBytes};
 }catch(error){primary=error;}
 try{await releaseDrawing(slot);}catch(error){primary=new SourceNativeError('cleanup',`${primary?drawingFailure(primary)+'; ':''}原生帧资源仍待清理: ${drawingFailure(error)}`);}
 finally{active=undefined;}
 if(primary)throw primary;if(!result)throw new SourceNativeError('protocol','分块绘制未完成');check(options.signal);return result;
}
