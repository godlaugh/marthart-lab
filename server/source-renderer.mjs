import {spawn} from 'node:child_process';
import {realpath,stat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const BUDGET=256*1024*1024,HEADER=44,MAX_ERROR=8192;
const failure=(kind,message)=>({ok:false,error:{kind,message}});
const sha=b=>createHash('sha256').update(b).digest('hex');
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export function inspectSourceFrameHeader(packet){
 if(!(packet instanceof Uint8Array)||!(packet.buffer instanceof ArrayBuffer)||packet.byteLength<52||packet.byteLength>BUDGET/4)return failure('input','原生帧缓冲无效');
 const b=Buffer.from(packet.buffer,packet.byteOffset,packet.byteLength);
 const version=b.readUInt32LE(4);
 if(b.readUInt32LE(0)!==0x31464c4d||![1,2].includes(version)||b.readUInt32LE(8)!==b.length||(version===2&&b.length<56))return failure('input','原生帧头部无效');
 // v1 is retained for saved diagnostic evidence; it always means no MSAA.
 const samples=version===2?b.readUInt32LE(52):0;
 if(samples>0x7fffffff)return failure('input','原生帧采样数无效');
 const generation=b.readUInt32LE(12),sequence=b.readUInt32LE(16),width=b.readUInt32LE(20),height=b.readUInt32LE(24);
 if(!generation||!sequence||!width||width>16384||!height||height>16384||width*height>16_000_000||b.length*4+width*height*(12+8*samples)>BUDGET)return failure('capacity','原生帧身份、尺寸或容量无效');
 return {ok:true,value:{generation,sequence,width,height,samples}};
}
function responseHeader(bytes,expected){
 if(bytes.readUInt32LE(0)!==0x31524c4d||bytes.readUInt32LE(4)!==1)return failure('protocol','原生响应版本无效');
 const length=bytes.readUInt32LE(8),generation=bytes.readUInt32LE(12),sequence=bytes.readUInt32LE(16),width=bytes.readUInt32LE(20),height=bytes.readUInt32LE(24),status=bytes.readUInt32LE(28),format=bytes.readUInt32LE(32),payloadBytes=bytes.readUInt32LE(36),contextSerial=bytes.readUInt32LE(40);
 if(generation!==expected.generation||sequence!==expected.sequence||width!==expected.width||height!==expected.height)return failure('protocol','原生响应不属于当前帧');
 if(length!==HEADER+payloadBytes||status>4||(status===0?(format!==1||!contextSerial||payloadBytes!==width*height*4):(format!==0||payloadBytes>MAX_ERROR)))return failure('protocol','原生响应长度或格式无效');
 return {ok:true,value:{generation,sequence,width,height,status,payloadBytes,contextSerial}};
}
/** Owns the actual ChildProcess handle until close, never locates/kills a PID.
 * This helper executes no shell and spawns no subprocesses. A failed cleanup
 * retains its owner and blocks replacements. One request; no unbounded queue.
 * Explicit sealed executable only: no runtime build, search, install or fallback.
 */
export async function createSourceRendererService({executablePath,executableSha256,timeoutMs=10000,killGraceMs=250,cleanupMs=3000}={}){
 if(typeof executablePath!=='string'||!path.isAbsolute(executablePath)||typeof executableSha256!=='string'||!/^[a-f0-9]{64}$/.test(executableSha256))throw Error('原生渲染需要显式的程序绝对路径和 SHA-256');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isInteger(killGraceMs)||killGraceMs<1||killGraceMs>5000||!Number.isInteger(cleanupMs)||cleanupMs<=killGraceMs||cleanupMs>15000)throw Error('原生渲染进程预算无效');
 const executable=await realpath(executablePath),before=await stat(executable);
 if(!before.isFile()||before.size>16*1024*1024)throw Error('原生渲染程序文件无效');
 const bytes=await readFile(executable),identity=await stat(executable);
 if(!sameFile(before,identity)||sha(bytes)!==executableSha256)throw Error('原生渲染程序身份不符');
 const rendererIdentity=sha(JSON.stringify({executable,executableSha256,host:[process.platform,process.arch,os.release(),os.version()]}));
 let owner,job,closing=false,closePromise,sessionStarts=0;
 const finish=(j,result)=>{
  if(j.finished)return;j.finished=true;clearTimeout(j.timer);j.signal?.removeEventListener('abort',j.cancel);
  if(job===j)job=undefined;j.resolve(result);
 };
 function kill(o,signal){
  // Node invalidates the process handle on exit. Do not fall back to process.kill
  // or a saved numeric PID when the handle is gone or signaling fails.
  if(!o.closed&&o.child.exitCode===null&&o.child.signalCode===null)try{o.child.kill(signal);}catch{ /* retain ownership until close or cleanup failure */ }
 }
 function retire(o,reason){
  if(o.closed)return;
  if(!o.reason){o.reason=reason;kill(o,'SIGTERM');o.force=setTimeout(()=>kill(o,'SIGKILL'),killGraceMs);o.force.unref();
   o.cleanup=setTimeout(()=>{o.cleanupExpired=true;if(job?.owner===o)finish(job,failure('cleanup','原生进程未确认退出，保留占用并拒绝替换'));},cleanupMs);o.cleanup.unref();
  }
 }
 function start(){
  const child=spawn(executable,['--stdio'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'},windowsHide:true});
  let done;const o={child,serial:++sessionStarts,closed:false,reason:undefined,last:undefined,header:Buffer.alloc(HEADER),headerUsed:0,payload:undefined,payloadUsed:0,response:undefined,stderrBytes:0,done:new Promise(resolve=>{done=resolve;})};owner=o;
  child.stdin.on('error',()=>retire(o,failure('runtime','原生请求管道已关闭')));
  child.on('error',()=>retire(o,failure('unavailable','无法启动原生渲染程序')));
  child.stderr.on('data',chunk=>{o.stderrBytes+=chunk.length;if(o.stderrBytes>16384)retire(o,failure('runtime','原生进程诊断输出超出预算'));});
  child.stdout.on('data',chunk=>{
   if(o.reason)return;
   const j=job;if(owner!==o||!j||j.owner!==o){retire(o,failure('protocol','收到无请求或过期的原生响应'));return;}
   let offset=0;
   while(offset<chunk.length){
    if(o.headerUsed<HEADER){const n=Math.min(HEADER-o.headerUsed,chunk.length-offset);chunk.copy(o.header,o.headerUsed,offset,offset+n);o.headerUsed+=n;offset+=n;if(o.headerUsed<HEADER)continue;
     const parsed=responseHeader(o.header,j.expected);if(!parsed.ok){retire(o,parsed);return;}o.response=parsed.value;o.payload=Buffer.allocUnsafe(parsed.value.payloadBytes);o.payloadUsed=0;
    }
    const n=Math.min(o.payload.length-o.payloadUsed,chunk.length-offset);chunk.copy(o.payload,o.payloadUsed,offset,offset+n);o.payloadUsed+=n;offset+=n;
    if(o.payloadUsed===o.payload.length){
     if(offset!==chunk.length){retire(o,failure('protocol','原生响应附带额外字节'));return;}
     const meta=o.response,pixels=o.payload;o.headerUsed=0;o.payload=undefined;o.response=undefined;
     let result;if(meta.status){let message;try{message=new TextDecoder('utf-8',{fatal:true}).decode(pixels);}catch{retire(o,failure('protocol','原生错误消息不是 UTF-8'));return;}result=failure({1:'input',2:'unsupported',3:'capacity',4:'runtime'}[meta.status],message);}
     else result={ok:true,value:{generation:meta.generation,sequence:meta.sequence,width:meta.width,height:meta.height,pixels,format:'rgba8',rowOrder:'bottom-up',contextSerial:meta.contextSerial,sessionSerial:o.serial,rendererIdentity}};
     finish(j,result);return;
    }
   }
  });
  child.once('close',()=>{
   o.closed=true;clearTimeout(o.force);clearTimeout(o.cleanup);if(owner===o)owner=undefined;
   if(job?.owner===o)finish(job,o.reason??failure('runtime','原生进程在交付完整帧前退出'));done();
  });
  return o;
 }
 function render(packet,options={}){
  if(!options||typeof options!=='object'||Object.keys(options).some(k=>k!=='signal')||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))return Promise.resolve(failure('input','原生渲染取消参数无效'));
  const signal=options.signal;
  if(closing)return Promise.resolve(failure('closed','原生渲染服务已关闭'));
  if(signal?.aborted)return Promise.resolve(failure('cancelled','原生渲染已取消'));
  if(job||owner?.reason)return Promise.resolve(failure('capacity','原生渲染已有请求或正在清理'));
  const header=inspectSourceFrameHeader(packet);if(!header.ok)return Promise.resolve(header);
  // Own the bytes before any await, so later caller edits cannot change a frame.
  const input=Buffer.from(packet),expected=header.value;
  return new Promise(resolve=>{
   const j={expected,resolve,signal,finished:false,owner:undefined};job=j;
   j.cancel=()=>{if(j.finished)return;if(j.owner)retire(j.owner,failure('cancelled','原生渲染已取消'));else finish(j,failure('cancelled','原生渲染已取消'));};
   signal?.addEventListener('abort',j.cancel,{once:true});
   j.timer=setTimeout(()=>{if(j.owner)retire(j.owner,failure('timeout','原生渲染超时'));else finish(j,failure('timeout','原生渲染启动超时'));},timeoutMs);j.timer.unref();
   (async()=>{
    try{
     const current=await stat(executable);if(j.finished)return;if(closing){finish(j,failure('closed','原生渲染服务已关闭'));return;}
     if(!sameFile(identity,current)){const reason=failure('unavailable','原生程序已变化，请重新初始化');if(owner){j.owner=owner;retire(owner,reason);}else finish(j,reason);return;}
     const o=owner??start();j.owner=o;
     if(o.reason){retire(o,o.reason);return;}
     if(o.last&&(expected.generation<o.last.generation||(expected.generation===o.last.generation&&expected.sequence<=o.last.sequence))){finish(j,failure('input','同一原生会话的帧身份必须递增'));return;}
     o.last=expected;o.stderrBytes=0;o.child.stdin.write(input,error=>{if(error)retire(o,failure('runtime','无法写入原生帧'));});
     if(signal?.aborted||closing)j.cancel();
    }catch{if(j.finished)return;const reason=failure('unavailable','原生程序不可用');j.owner??=owner;if(j.owner)retire(j.owner,reason);else finish(j,reason);}
   })();
  });
 }
 async function health(){
  if(closing)return{available:false,error:{kind:'closed',message:'原生渲染服务已关闭'}};
  try{const current=await stat(executable);if(closing)return{available:false,error:{kind:'closed',message:'原生渲染服务已关闭'}};if(sameFile(identity,current))return{available:!owner?.reason,rendererIdentity,...(owner?.reason?{error:owner.reason.error}:{})};}catch{}
  const reason=failure('unavailable','原生程序已变化或不可用，请重新初始化');if(owner)retire(owner,reason);return{available:false,error:reason.error};
 }
 return{render,health,rendererIdentity,get processCount(){return owner?1:0;},get processObservation(){return owner?{pid:owner.child.pid,sessionSerial:owner.serial,retiring:!!owner.reason}:null;},get activeCount(){return job?1:0;},get sessionStarts(){return sessionStarts;},
  close(){
   if(closePromise)return closePromise;closing=true;
   closePromise=(async()=>{
    const o=owner;if(job&&!job.owner)finish(job,failure('closed','原生渲染服务已关闭'));if(o){retire(o,failure('closed','原生渲染服务已关闭'));if(o.cleanupExpired)kill(o,'SIGKILL');}
    if(!o)return{ok:true};let timer;const result=await Promise.race([o.done.then(()=>({ok:true})),new Promise(resolve=>{timer=setTimeout(()=>resolve(failure('cleanup','原生进程未确认退出，仍由服务持有')),cleanupMs);})]);clearTimeout(timer);return result;
   })().then(result=>{if(!result.ok)closePromise=undefined;return result;});return closePromise;
  }
 };
}
