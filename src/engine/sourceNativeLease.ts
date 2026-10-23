import {SourceNativeError} from './sourceNativeError';
type Lease={token:string;controller:AbortController;ready:Promise<void>;done:Promise<void>;connected:boolean};
let lease:Lease|undefined;
export const sourceNativeLeaseToken=()=>lease?.connected&&!lease.controller.signal.aborted?lease.token:undefined;
// Back/forward cache can freeze a page while leaving fetches alive. Closing
// on pagehide complements socket closure on browser/process exit.
const retireLease=()=>lease?.controller.abort();
if(typeof window!=='undefined')window.addEventListener('pagehide',retireLease);
import.meta.hot?.dispose(()=>{retireLease();if(typeof window!=='undefined')window.removeEventListener('pagehide',retireLease);});
/** A response stream binds the native process to this page's actual network
 * lifetime. Reload/crash closes it even when JavaScript cannot run disposal. */
export async function ensureSourceNativeLease(signal:AbortSignal):Promise<void>{
 if(signal.aborted)throw new DOMException('原生连接已取消','AbortError');
 if(lease?.controller.signal.aborted)await lease.done;
 if(!lease){
  const controller=new AbortController();let resolve!:()=>void,reject!:(error:unknown)=>void;
  const current:Lease={token:crypto.randomUUID().replaceAll('-',''),controller,connected:false,ready:new Promise<void>((a,b)=>{resolve=a;reject=b;}),done:Promise.resolve()};lease=current;
  const timer=setTimeout(()=>controller.abort(new SourceNativeError('timeout','原生页面连接超时')),20000);
  current.done=(async()=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   try{
    let response:Response,retries=0;const deadline=performance.now()+4000;
    while(true){
     response=await fetch('/api/source-renderer/lease/'+current.token,{signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
     if(response.ok)break;
     const error=await response.json();
     if(response.status===429&&error.kind==='capacity'&&performance.now()<deadline){await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(wait);reject(new DOMException('原生连接已取消','AbortError'));},wait=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},Math.min(250,25*2**retries++));controller.signal.addEventListener('abort',cancel,{once:true});});continue;}
     throw new SourceNativeError(typeof error.kind==='string'?error.kind:'unavailable',typeof error.error==='string'?error.error:'无法建立原生页面连接');
    }
    if(response.headers.get('content-type')!=='application/octet-stream'||!response.body)throw new SourceNativeError('protocol','原生页面连接格式无效');
    reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
    while(true){const next=await reader.read();if(next.done)throw new SourceNativeError('state-lost','原生页面连接已关闭');if(next.value.byteLength>64)throw new SourceNativeError('protocol','原生页面心跳超出容量');pending+=decoder.decode(next.value,{stream:true});
     let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line!==(current.connected?'.':'READY'))throw new SourceNativeError('protocol','原生页面心跳无效');if(!current.connected){current.connected=true;clearTimeout(timer);resolve();}}
     if(pending.length>5)throw new SourceNativeError('protocol','原生页面心跳截断');
    }
   }catch(error){reject(error);}
   finally{clearTimeout(timer);current.connected=false;controller.abort();await reader?.cancel().catch(()=>{});reader?.releaseLock();if(lease===current)lease=undefined;}
  })();
 }
 const current=lease,cancel=()=>{if(!current.connected)current.controller.abort();};signal.addEventListener('abort',cancel,{once:true});
 try{await current.ready;if(signal.aborted)throw new DOMException('原生连接已取消','AbortError');}finally{signal.removeEventListener('abort',cancel);}
}
