import {prepareSourcePausedPng,type SourcePausedPngRequest,type SourcePausedPngResponse} from './sourcePausedPngContract';
export interface SourcePausedPngOptions {signal?:AbortSignal;isCancelled?:()=>boolean;}
const cancelled=(options?:SourcePausedPngOptions)=>!!options?.signal?.aborted||!!options?.isCancelled?.();
function check(options?:SourcePausedPngOptions){if(cancelled(options))throw new DOMException('当前帧 PNG 导出已取消','AbortError');}

/** Borrow caller pixels. Transfer an owned compact copy to a one-job worker so
 * enhancement, bicubic and PNG compression cannot block UI cancellation or
 * invalidate the retained scene. Every terminal path releases this worker. */
export async function encodeSourcePausedPng(pixels:Uint8ClampedArray,width:number,height:number,scale:1|3|5,options?:SourcePausedPngOptions):Promise<Blob>{
 check(options);
 if(!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==width*height*4)throw new Error('当前帧 PNG 需要完整且未共享的 RGBA 图像');
 const plan=prepareSourcePausedPng(width,height,scale,pixels.buffer.byteLength);
 const input=pixels.slice();check(options);
 return new Promise<Blob>((resolve,reject)=>{
  let worker:Worker|undefined,settled=false;
  const finish=(error?:Error,blob?:Blob)=>{
   if(settled)return;settled=true;options?.signal?.removeEventListener('abort',abort);
   if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();}
   if(error)reject(error);else resolve(blob!);
  };
  const abort=()=>finish(new DOMException('当前帧 PNG 导出已取消','AbortError'));
  try{
   worker=new Worker(new URL('./sourcePausedPng.worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=({data}:MessageEvent<SourcePausedPngResponse>)=>{
    if(cancelled(options)){abort();return;}
    if(data?.operation!=='encode-source-paused-png'||data.id!==1){finish(new Error('当前帧 PNG 响应身份无效'));return;}
    if('error' in data){finish(new Error(typeof data.error==='string'?data.error:'当前帧 PNG 后处理失败'));return;}
    const result=data.result;
    if(!result||result.width!==plan.width||result.height!==plan.height||!(result.blob instanceof Blob)||result.blob.type!=='image/png'||!result.blob.size){finish(new Error('当前帧 PNG 响应图像无效'));return;}
    finish(undefined,result.blob);
   };
   worker.onerror=event=>finish(new Error(event.message||'当前帧 PNG 工作进程失败'));
   worker.onmessageerror=()=>finish(new Error('当前帧 PNG 响应无法读取'));
   options?.signal?.addEventListener('abort',abort,{once:true});
   if(cancelled(options)){abort();return;}
   const request:SourcePausedPngRequest={operation:'encode-source-paused-png',id:1,pixels:input,width,height,scale};
   worker.postMessage(request,[input.buffer]);
  }catch(error){finish(error instanceof Error?error:new Error(String(error)));}
 });
}
