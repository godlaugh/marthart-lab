import {encodeSourceDrawingFrame,type SourceDrawingFrame} from './sourceDrawingFrame';

export class SourceNativeError extends Error {
 constructor(readonly kind:string,message:string){super(message);this.name='SourceNativeError';}
}
export interface SourceNativePixels {width:number;height:number;pixels:Uint8ClampedArray;rendererIdentity:string;generation:number;sequence:number}
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw signal.reason instanceof SourceNativeError?signal.reason:new DOMException('原生帧已取消','AbortError');};
async function bytes(response:Response,limit:number,signal:AbortSignal){
 if(!response.body)throw new SourceNativeError('protocol','原生响应缺少内容');
 const reader=response.body.getReader(),output=new Uint8Array(limit);let length=0;
 try{while(true){check(signal);const next=await reader.read();if(next.done)break;if(next.value.length>limit-length)throw new SourceNativeError('capacity','原生响应超过容量');output.set(next.value,length);length+=next.value.length;}
  return output.subarray(0,length);
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function header(response:Response,name:string){const value=response.headers.get(name);if(!value||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new SourceNativeError('protocol','原生响应头无效');return Number(value);}
const errorKinds=new Set(['input','capacity','closed','unavailable','cancelled','timeout','runtime','protocol','unsupported','cleanup']);
async function remoteError(response:Response,signal:AbortSignal):Promise<never>{
 let value:{kind?:unknown;error?:unknown};try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,8192,signal)));}catch(error){if(signal.aborted)throw error;throw new SourceNativeError('protocol','原生后端错误响应无效');}
 const kind=typeof value.kind==='string'&&errorKinds.has(value.kind)?value.kind:response.status===503?'unavailable':response.status===429?'capacity':'runtime';
 throw new SourceNativeError(kind,typeof value.error==='string'?value.error:'原生渲染失败');
}
/** One shared browser slot, no background queue. Callers retain presentation
 * ownership and must await this frame or explicitly cancel it before replacing
 * it. The loopback gateway separately coordinates other windows/consumers. */
let active=false;
export async function renderSourceNativeFrame(frame:SourceDrawingFrame,options:{signal?:AbortSignal;retainedBytes?:number}={}):Promise<SourceNativePixels>{
 check(options.signal);if(active)throw new SourceNativeError('capacity','当前页面已有原生帧请求');active=true;
 const controller=new AbortController(),cancel=()=>controller.abort(options.signal?.reason),timer=setTimeout(()=>controller.abort(new SourceNativeError('timeout','原生帧传输超时')),20000);
 options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  const packet=encodeSourceDrawingFrame(frame,{isCancelled:()=>controller.signal.aborted,retainedBytes:options.retainedBytes});if(!packet.ok)throw new SourceNativeError(packet.error.kind,packet.error.reason);
  const expected={generation:frame.generation,sequence:frame.sequence,width:frame.width,height:frame.height};
  const response=await fetch('/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream'},body:packet.value as Uint8Array<ArrayBuffer>,signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok)await remoteError(response,controller.signal);
  const identity=response.headers.get('x-source-renderer');
  if(response.headers.get('content-type')!=='application/octet-stream'||response.headers.get('x-source-format')!=='rgba8'||response.headers.get('x-source-row-order')!=='bottom-up'||!identity||!/^[a-f0-9]{64}$/.test(identity))throw new SourceNativeError('protocol','原生响应格式或后端身份无效');
  for(const [name,value]of Object.entries(expected))if(header(response,'x-source-'+name)!==value)throw new SourceNativeError('protocol','原生响应与请求帧不一致');
  const length=expected.width*expected.height*4;if(header(response,'content-length')!==length)throw new SourceNativeError('protocol','原生像素长度无效');
  const raw=await bytes(response,length,controller.signal);if(raw.length!==length)throw new SourceNativeError('protocol','原生像素响应截断');
  const pixels=new Uint8ClampedArray(raw.buffer,raw.byteOffset,raw.byteLength),stride=expected.width*4,row=new Uint8ClampedArray(stride);
  for(let y=0;y<Math.floor(expected.height/2);y++){check(controller.signal);const a=y*stride,b=(expected.height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}
  check(controller.signal);return{...expected,pixels,rendererIdentity:identity};
 }catch(error){controller.abort();throw error;}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);active=false;}
}
