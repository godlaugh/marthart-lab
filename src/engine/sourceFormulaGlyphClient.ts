/** Borrowed immutable glyph data. Consumers may upload/read pixels, but must
 * never write, transfer, or detach their buffer. Cache hits do not copy per frame. */
export interface SourceFormulaGlyph {
 readonly width:number;
 readonly height:number;
 readonly pixels:Uint8Array<ArrayBuffer>;
 readonly fontSize:50;
 readonly rendererIdentity:string;
}
export class SourceFormulaGlyphError extends Error {
 constructor(readonly kind:'input'|'capacity'|'unavailable'|'protocol'|'network'|'timeout',message:string){super(message);this.name='SourceFormulaGlyphError';}
}
const MAX_PIXELS=16_000_000,MAX_BYTES=MAX_PIXELS*4,MAX_DIMENSION=16384;
// A presented frame permits 33 labels. Admit two overlapping consumers, while
// retaining at most one maximum-size glyph's worth of cached pixel storage.
const MAX_TASKS=66,MAX_CACHE_ENTRIES=66,MAX_CACHE_BYTES=64*1024**2;
const CACHE=new Map<string,SourceFormulaGlyph>();let cachedBytes=0,currentIdentity:string|undefined;
interface Shared<T>{controller:AbortController;promise:Promise<T>;waiters:number;settled:boolean;}
const flights=new Map<string,Shared<SourceFormulaGlyph>>();let healthFlight:Shared<string>|undefined,reservations=0;
const abortError=()=>new DOMException('公式字形请求已取消','AbortError');
function checkAbort(signal?:AbortSignal){if(signal?.aborted)throw abortError();}
function clearCache(){CACHE.clear();cachedBytes=0;}
function observeIdentity(identity:string){if(currentIdentity!==identity){clearCache();currentIdentity=identity;}}
function invalidateIdentity(){clearCache();currentIdentity=undefined;}
function makeShared<T>(run:(signal:AbortSignal)=>Promise<T>):Shared<T>{
 const shared:Shared<T>={controller:new AbortController(),promise:undefined!,waiters:0,settled:false};
 shared.promise=Promise.resolve().then(()=>run(shared.controller.signal));
 // Handle both outcomes even after the final subscriber has already cancelled.
 void shared.promise.then(()=>{shared.settled=true;},()=>{shared.settled=true;});return shared;
}
function subscribe<T>(shared:Shared<T>,signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)return Promise.reject(abortError());
 shared.waiters++;
 return new Promise<T>((resolve,reject)=>{
  let finished=false;
  const finish=(error:unknown,value?:T)=>{
   if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);shared.waiters--;
   if(error!==undefined)reject(error);else resolve(value!);
  };
  const cancel=()=>{finish(abortError());if(!shared.waiters&&!shared.settled)shared.controller.abort();};
  signal?.addEventListener('abort',cancel,{once:true});
  void shared.promise.then(value=>finish(undefined,value),error=>finish(error));
  if(signal?.aborted)cancel();
 });
}
interface SlotWaiter {signal:AbortSignal;grant:()=>void;cancel:()=>void;}
const waiting:SlotWaiter[]=[];let busy=false;
function acquire(signal:AbortSignal):Promise<()=>void>{
 checkAbort(signal);
 return new Promise((resolve,reject)=>{
  const entry:SlotWaiter={signal,grant:()=>{
   signal.removeEventListener('abort',entry.cancel);busy=true;let released=false;
   resolve(()=>{if(released)return;released=true;busy=false;const next=waiting.shift();next?.grant();});
  },cancel:()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);reject(abortError());}};
  if(!busy)entry.grant();else{waiting.push(entry);signal.addEventListener('abort',entry.cancel,{once:true});}
 });
}
function unsignedHeader(headers:Headers,name:string,limit:number):number{
 const raw=headers.get(name);if(raw===null||!/^[1-9]\d*$/.test(raw))throw new SourceFormulaGlyphError('protocol',`字形响应缺少有效 ${name}`);
 const value=Number(raw);if(!Number.isSafeInteger(value)||value>limit)throw new SourceFormulaGlyphError('protocol',`字形响应 ${name} 超出预算`);return value;
}
function validIdentity(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function mediaType(response:Response){return response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();}
/** Preallocate only the admitted payload. Streaming prevents a lying or absent
 * Content-Length from making arrayBuffer()/json() allocate without a bound. */
async function boundedBody(response:Response,limit:number,signal:AbortSignal,exact?:number):Promise<Uint8Array<ArrayBuffer>>{
 if(!response.body)throw new SourceFormulaGlyphError('protocol','字形响应缺少正文');
 const reader=response.body.getReader(),bytes=new Uint8Array(exact??limit);let offset=0,complete=false;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  checkAbort(signal);
  for(;;){const result=await reader.read();checkAbort(signal);if(result.done)break;
   if(!(result.value instanceof Uint8Array)||result.value.byteLength>bytes.byteLength-offset)throw new SourceFormulaGlyphError('protocol','字形响应正文超出声明或预算');
   bytes.set(result.value,offset);offset+=result.value.byteLength;
  }
  if(exact!==undefined&&offset!==exact)throw new SourceFormulaGlyphError('protocol','字形响应正文长度不一致');
  complete=true;return exact===undefined?bytes.slice(0,offset):bytes;
 }finally{signal.removeEventListener('abort',cancel);if(!complete)try{await reader.cancel();}catch{/* Network ownership is also cancelled by its controller. */}reader.releaseLock();}
}
async function discard(response:Response){try{await response.body?.cancel();}catch{/* Preserve the protocol error that caused cancellation. */}}
async function jsonBody(response:Response,signal:AbortSignal):Promise<unknown>{
 if(mediaType(response)!=='application/json'){await discard(response);throw new SourceFormulaGlyphError('protocol','字形服务需要 JSON 响应');}
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096)){await discard(response);throw new SourceFormulaGlyphError('protocol','字形服务 JSON 响应超出预算');}
 const bytes=await boundedBody(response,4096,signal,length===null?undefined:Number(length));
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SourceFormulaGlyphError('protocol','字形服务返回无效 JSON');}
}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
async function statusError(response:Response,signal:AbortSignal):Promise<never>{
 let detail='';
 if(mediaType(response)==='application/json'){
  const body=await jsonBody(response,signal);if(object(body)&&typeof body.error==='string'&&body.error.length<=1024)detail=`：${body.error}`;
 }else await discard(response);
 throw new SourceFormulaGlyphError(response.status===429?'capacity':response.status===503?'unavailable':'protocol',`公式字形服务返回 HTTP ${response.status}${detail}`);
}
/** The server's maximum worker time is 60s plus 5s termination grace. Keep a
 * finite extra 10s transport allowance; health has its own shorter deadline. */
async function network<T>(path:string,init:RequestInit,signal:AbortSignal,timeoutMs:number,read:(response:Response,signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{
  checkAbort(signal);const response=await fetch(path,{...init,signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  checkAbort(signal);return await read(response,controller.signal);
 }catch(error){
  if(signal.aborted)throw abortError();if(timedOut)throw new SourceFormulaGlyphError('timeout','公式字形服务请求超时');
  if(error instanceof SourceFormulaGlyphError)throw error;
  throw new SourceFormulaGlyphError('network',`无法读取公式字形服务：${error instanceof Error?error.message:'网络错误'}`);
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}
/** Freshness is checked for every completed call, never a time-based health
 * cache. Concurrent waiters may share only an unfinished health request. */
export function sourceFormulaRendererIdentity(signal?:AbortSignal):Promise<string>{
 if(signal?.aborted)return Promise.reject(abortError());
 let shared=healthFlight;
 if(!shared||shared.settled||shared.controller.signal.aborted){
  shared=makeShared(async inner=>{
   try{
    const identity=await network('/api/formula-glyph/health',{method:'GET'},inner,15000,async(response,requestSignal)=>{
     if(response.status!==200)return statusError(response,requestSignal);
     const body=await jsonBody(response,requestSignal);
     if(!object(body)||typeof body.available!=='boolean')throw new SourceFormulaGlyphError('protocol','公式字形健康响应无效');
     if(!body.available)throw new SourceFormulaGlyphError('unavailable','独立公式字形后端尚未配置或不可用');
     if(body.fontSize!==50||body.format!=='straight-rgba8'||!validIdentity(body.rendererIdentity))throw new SourceFormulaGlyphError('protocol','公式字形渲染身份或格式无效');
     return body.rendererIdentity;
    });
    checkAbort(inner);observeIdentity(identity);return identity;
   }catch(error){if(!inner.aborted&&healthFlight===owned)invalidateIdentity();throw error;}
  });healthFlight=shared;
  const owned=shared;void shared.promise.then(()=>{if(healthFlight===owned)healthFlight=undefined;},()=>{if(healthFlight===owned)healthFlight=undefined;});
 }
 return subscribe(shared,signal);
}
async function loadGlyph(latex:string,color:string,signal:AbortSignal):Promise<SourceFormulaGlyph>{
 const release=await acquire(signal);
 try{
  checkAbort(signal);const identity=await sourceFormulaRendererIdentity(signal);checkAbort(signal);
  const key=JSON.stringify([identity,latex,color]),cached=CACHE.get(key);
  if(cached){CACHE.delete(key);CACHE.set(key,cached);return cached;}
  const glyph=await network('/api/formula-glyph',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latex,color})},signal,75000,async(response,requestSignal)=>{
   if(response.status!==200)return statusError(response,requestSignal);
   let width:number,height:number,length:number;
   try{
    if(mediaType(response)!=='application/octet-stream'||response.headers.get('content-encoding')!==null&&response.headers.get('content-encoding')!=='identity')throw new SourceFormulaGlyphError('protocol','字形响应格式必须为未压缩 straight RGBA8');
    if(response.headers.get('x-glyph-font-size')!=='50'||response.headers.get('x-glyph-format')!=='straight-rgba8'||response.headers.get('x-glyph-renderer')!==identity)throw new SourceFormulaGlyphError('protocol','字形响应的字号、格式或渲染身份不一致');
    width=unsignedHeader(response.headers,'x-glyph-width',MAX_DIMENSION);height=unsignedHeader(response.headers,'x-glyph-height',MAX_DIMENSION);
    if(width*height>MAX_PIXELS)throw new SourceFormulaGlyphError('protocol','字形像素数量超出预算');
    length=unsignedHeader(response.headers,'content-length',MAX_BYTES);if(length!==width*height*4)throw new SourceFormulaGlyphError('protocol','字形尺寸与正文长度不一致');
   }catch(error){await discard(response);throw error;}
   const pixels=await boundedBody(response,length,requestSignal,length);
   return Object.freeze({width,height,pixels,fontSize:50 as const,rendererIdentity:identity});
  });
  checkAbort(signal);if(currentIdentity!==identity)throw new SourceFormulaGlyphError('protocol','公式字形后端在请求期间发生变化');
  while(CACHE.size>=MAX_CACHE_ENTRIES||cachedBytes+glyph.pixels.byteLength>MAX_CACHE_BYTES){const first=CACHE.keys().next().value;if(first===undefined)break;cachedBytes-=CACHE.get(first)!.pixels.byteLength;CACHE.delete(first);}
  CACHE.set(key,glyph);cachedBytes+=glyph.pixels.byteLength;return glyph;
 }finally{release();}
}
export function sourceFormulaGlyph(latex:string,color:string,signal?:AbortSignal):Promise<SourceFormulaGlyph>{
 if(signal?.aborted)return Promise.reject(abortError());
 if(typeof latex!=='string'||!latex.length||latex.length>8192||typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||new TextDecoder().decode(new TextEncoder().encode(latex))!==latex)return Promise.reject(new SourceFormulaGlyphError('input','字形请求需要有界公式、有效 Unicode 与六位 RGB 颜色'));
 const key=JSON.stringify([latex,color]);let shared=flights.get(key);
 if(!shared||shared.settled||shared.controller.signal.aborted){
  if(reservations>=MAX_TASKS)return Promise.reject(new SourceFormulaGlyphError('capacity','待处理公式字形超过两个完整帧的标注预算'));
  reservations++;shared=makeShared(inner=>loadGlyph(latex,color,inner));flights.set(key,shared);
  const owned=shared;const cleanup=()=>{reservations--;if(flights.get(key)===owned)flights.delete(key);};void shared.promise.then(cleanup,cleanup);
 }
 return subscribe(shared,signal);
}
