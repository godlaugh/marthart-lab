import {encodeSourceIteratedRenderNativeRequest,captureSourceIteratedRenderNativeResponseBinding,decodeSourceIteratedRenderNativeResponse,type SourceIteratedRenderNativeRequest,type SourceIteratedRenderNativeResponse} from './sourceIteratedRenderNativeProtocol';
import {encodeSourceIteratedNativeRequest,captureSourceIteratedNativeResponseBinding,decodeSourceIteratedNativeResponse,sourceIteratedNativeResponseBytes,type SourceIteratedNativeRequest,type SourceIteratedNativeResponse} from './sourceIteratedNativeProtocol';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from './sourceDrawingFrame';

import {SourceNativeError} from './sourceNativeError';
export {SourceNativeError} from './sourceNativeError';
import {sourceNativeLeaseToken} from './sourceNativeLease';
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
async function remoteError(response:Response,signal:AbortSignal):Promise<never>{
 let value:Record<string,unknown>;try{const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,8192,signal)));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new SourceNativeError('protocol','原生后端错误响应不是对象');value=parsed as Record<string,unknown>;}catch(error){if(signal.aborted)throw error;throw new SourceNativeError('protocol','原生后端错误响应无效');}
 const kind=typeof value.kind==='string'&&errorKinds.has(value.kind)?value.kind:response.status===503?'unavailable':response.status===429?'capacity':'runtime';
 throw new SourceNativeError(kind,typeof value.error==='string'?value.error:'原生渲染失败');
}
export interface SourceNativeAcknowledgement {generation:number;sequence:number;uploadedParticles:number;rendererIdentity:string;requestBytes:number}
export interface SourceNativeSamilaResponse extends SourceSamilaNativeResponse {width:number;height:number;generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
export interface SourceNativeIteratedResponse extends SourceIteratedNativeResponse {width:number;height:number;generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
export interface SourceNativeIteratedRenderResponse extends SourceIteratedRenderNativeResponse {generation:number;sequence:number;rendererIdentity:string;contextSerial:number;sessionSerial:number;requestBytes:number;}
type NativeRequest={family:'drawing';frame:SourceDrawingFrame}|{family:'samila';frame:SourceSamilaNativeRequest}|{family:'iterated';frame:SourceIteratedNativeRequest}|{family:'iterated-render';frame:SourceIteratedRenderNativeRequest};
type NativeResponse=({format:'rgba8'}&SourceNativePixels)|({format:'u32le'}&SourceNativeAcknowledgement)|({format:'samila-v1'}&SourceNativeSamilaResponse)|({format:'iterated-v1'}&SourceNativeIteratedResponse)|({format:'iterated-render-v1'}&SourceNativeIteratedRenderResponse);
type NativeOptions={signal?:AbortSignal;retainedBytes?:number};
/** One shared browser slot, no background queue. Callers retain presentation
 * ownership and must await this frame or explicitly cancel it before replacing
 * it. The loopback gateway separately coordinates other windows/consumers. */
let active=false;
async function exchange(request:NativeRequest,options:NativeOptions&{samilaRetainedTarget?:SourceSamilaNativeRetainedTarget}):Promise<NativeResponse>{
 const frame=request.frame,samila=request.family==='samila',iterated=request.family==='iterated',render=request.family==='iterated-render',control=request.family==='iterated'||(request.family==='iterated-render'?request.frame.operation.kind!=='present':request.family==='samila'?!['display','present'].includes(request.frame.operation.kind):!!request.frame.bouncing&&request.frame.bouncing.kind!=='draw');
 check(options.signal);if(active)throw new SourceNativeError('capacity','当前页面已有原生帧请求');active=true;
 const controller=new AbortController(),cancel=()=>controller.abort(options.signal?.reason),timer=setTimeout(()=>controller.abort(new SourceNativeError('timeout','原生帧传输超时')),20000);
 options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  const encoding={isCancelled:()=>controller.signal.aborted,retainedBytes:options.retainedBytes},packet=request.family==='iterated-render'?encodeSourceIteratedRenderNativeRequest(request.frame,encoding):request.family==='iterated'?encodeSourceIteratedNativeRequest(request.frame,encoding):request.family==='samila'?encodeSourceSamilaNativeRequest(request.frame,{...encoding,retainedTarget:options.samilaRetainedTarget}):encodeSourceDrawingFrame(request.frame,encoding);if(!packet.ok)throw new SourceNativeError(packet.error.kind,packet.error.reason);
  const expected={generation:frame.generation,sequence:frame.sequence,width:request.family==='iterated'?1:request.frame.width,height:request.family==='iterated'?1:request.frame.height};
  const iteratedBinding=request.family==='iterated'?captureSourceIteratedNativeResponseBinding(request.frame):undefined,renderBinding=request.family==='iterated-render'?captureSourceIteratedRenderNativeResponseBinding(request.frame):undefined;
  const response=await fetch('/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...(sourceNativeLeaseToken()?{'x-source-lease':sourceNativeLeaseToken()!}:{})},body:packet.value as Uint8Array<ArrayBuffer>,signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok)await remoteError(response,controller.signal);
  const identity=response.headers.get('x-source-renderer');
  if(response.headers.get('content-type')!=='application/octet-stream'||response.headers.get('x-source-format')!==(render?'iterated-render-v1':iterated?'iterated-v1':samila?'samila-v1':control?'u32le':'rgba8')||response.headers.get('x-source-row-order')!==(control?'none':'bottom-up')||!identity||!/^[a-f0-9]{64}$/.test(identity))throw new SourceNativeError('protocol','原生响应格式或后端身份无效');
  for(const [name,value]of Object.entries(expected))if(header(response,'x-source-'+name)!==value)throw new SourceNativeError('protocol','原生响应与请求帧不一致');
  const length=renderBinding?128+(renderBinding.kind==='present'?renderBinding.width*renderBinding.height*4:0):iteratedBinding?sourceIteratedNativeResponseBytes(iteratedBinding):samila?64+(control?0:expected.width*expected.height*4):expected.width*expected.height*4;if(header(response,'content-length')!==length)throw new SourceNativeError('protocol','原生像素长度无效');
  const raw=await bytes(response,length,controller.signal);if(raw.length!==length)throw new SourceNativeError('protocol','原生像素响应截断');
  const samilaResult=request.family==='samila'?decodeSourceSamilaNativeResponse(raw,request.frame):undefined,iteratedResult=iteratedBinding?decodeSourceIteratedNativeResponse(raw,iteratedBinding):undefined,renderResult=renderBinding?decodeSourceIteratedRenderNativeResponse(raw,renderBinding):undefined;
  const contextSerial=samila||iterated||render?header(response,'x-source-context'):0,sessionSerial=samila||iterated||render?header(response,'x-source-session'):0;
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
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);active=false;}
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
