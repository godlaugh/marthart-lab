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
 if(b.readUInt32LE(0)!==0x31464c4d||![1,2,3,4,5,6,7].includes(version)||b.readUInt32LE(8)!==b.length||(version>=2&&b.length<(version>=5?88:version===4?84:version===3?60:56)))return failure('input','原生帧头部无效');
 // v1 is retained for saved diagnostic evidence; it always means no MSAA.
 const samples=version>=2?b.readUInt32LE(52):0;
 if(samples>0x7fffffff)return failure('input','原生帧采样数无效');
 const generation=b.readUInt32LE(12),sequence=b.readUInt32LE(16),width=b.readUInt32LE(20),height=b.readUInt32LE(24);
 if(!generation||!sequence||!width||width>16384||!height||height>16384||width*height>16_000_000||b.length*4+width*height*(12+8*samples)>BUDGET)return failure('capacity','原生帧身份、尺寸或容量无效');
 if(version===7&&b.readUInt32LE(60)===3){
  const operation=b.readUInt32LE(64),resource=b.subarray(72,88).toString('hex');
  if(operation<1||operation>5||b.readUInt32LE(68)!==16||resource==='0'.repeat(32)||!b.subarray(28,60).every(n=>n===0))return failure('input','迭代原生绘制头部无效');
  if(operation===4){if(width!==1||height!==1||b.length!==88)return failure('input','迭代原生绘制释放范围无效');return{ok:true,value:{generation,sequence,width,height,samples,control:true,operation,resource,family:'iterated-render'}};}
  if(b.length<{1:168,2:136,3:144,5:168}[operation]||b.readUInt32LE(88)!==16)return failure('input','迭代原生绘制请求截断');
  const stateResource=b.subarray(92,108).toString('hex'),expectedIndex=b.readUInt32LE(108),expectedDisplays=b.readUInt32LE(112),totalCount=b.readUInt32LE(116),record=operation===2?b.readUInt32LE(124):undefined;
  if(stateResource==='0'.repeat(32)||!totalCount||totalCount>8000000||operation===1&&expectedDisplays!==0||operation===2&&(expectedDisplays===0xffffffff||b.readUInt32LE(120)>1||record>1||!Number.isFinite(b.readFloatLE(128))||b.readFloatLE(128)<0||b.readFloatLE(128)>1||![1,2].includes(b.readUInt32LE(132)))||operation===3&&!expectedDisplays)return failure('input','迭代原生绘制检查点无效');
  if(b.length*6+128+(operation===3?width*height*8:0)>BUDGET)return failure('capacity','迭代原生绘制协议与读取超过容量');
  return{ok:true,value:{generation,sequence,width,height,samples,control:operation!==3,operation,resource,family:'iterated-render',stateResource,expectedIndex,expectedDisplays,totalCount,record:record===1}};
 }
 if(version===6||version===7){
  const operation=b.readUInt32LE(64),resource=b.subarray(72,88).toString('hex');
  if(version===7&&operation!==3||width!==1||height!==1||b.readUInt32LE(60)!==2||operation<1||operation>5||b.readUInt32LE(68)!==16||resource==='0'.repeat(32)||!b.subarray(28,60).every(n=>n===0))return failure('input','迭代原生计算头部无效');
  const shift=version===7?4:0,minimum={1:100,2:116,3:108+shift,4:100,5:88}[operation];if(b.length<minimum)return failure('input','迭代原生计算请求截断');
  const expectedIndex=operation>=2&&operation<=4?b.readUInt32LE(88):undefined,totalCount=operation===1?b.readUInt32LE(88):undefined,offset=operation===2||operation===4?b.readUInt32LE(92):0,readCount=operation===4?b.readUInt32LE(96):0,steps=operation===3?b.readUInt32LE(100+shift):0;
  const uploadBytes=operation===2?b.readUInt32LE(96):0;
  if(operation===1&&(totalCount<1||totalCount>8000000)||operation===2&&(expectedIndex!==0||!uploadBytes||uploadBytes%16||uploadBytes/16>65536||b.length!==100+uploadBytes)||operation===3&&(expectedIndex===0xffffffff||b.readUInt32LE(92)>1||![2,3].includes(b.readUInt32LE(96+shift))||steps>256||shift&&(b.readUInt32LE(96)>1||b.readUInt32LE(92)>b.readUInt32LE(96)))||operation===4&&(b.length!==100||!readCount||readCount>65536||offset+readCount>8000000)||operation===5&&b.length!==88)return failure('input','迭代原生计算范围或检查点无效');
  if(b.length*6+readCount*48+64>BUDGET)return failure('capacity','迭代原生计算协议与读取超过容量');
  return{ok:true,value:{generation,sequence,width,height,samples,control:true,operation,resource,family:'iterated',expectedIndex,totalCount,offset,readCount,steps,uploaded:operation===2?offset+uploadBytes/16:undefined}};
 }
 if(version===5){
  const operation=b.readUInt32LE(64),resource=b.subarray(72,88).toString('hex'),control=operation!==2&&operation!==4,accumulate=operation===2||operation===5;
  if(b.readUInt32LE(60)!==1||operation<1||operation>5||b.readUInt32LE(68)!==16||resource==='0'.repeat(32)||!b.subarray(28,60).every(n=>n===0)||(operation===1||operation===3)&&(width!==1||height!==1)||accumulate&&b.length<108||operation===4&&b.length<96)return failure('input','Samila 原生帧头部无效');
  const expectedIndex=accumulate||operation===4?b.readUInt32LE(88):undefined,baseBatch=accumulate?b.readUInt32LE(96):0,passes=accumulate?b.readUInt32LE(100):0;
  if(accumulate&&(expectedIndex===0xffffffff||b.readUInt32LE(92)>1||baseBatch<1||baseBatch>8000000||![1,6].includes(passes)))return failure('input','Samila 原生显示检查点无效');
  if(b.length*6+width*height*8+64>BUDGET)return failure('capacity','Samila 原生帧容量无效');
  return {ok:true,value:{generation,sequence,width,height,samples,control,operation,resource,family:'samila',expectedIndex,steps:baseBatch*passes}};
 }
 const operation=version===4?b.readUInt32LE(60):undefined;if(operation!==undefined&&(operation<1||operation>4))return failure('input','原生状态操作无效');
 const control=operation!==undefined&&operation!==3;if(control&&(width!==1||height!==1))return failure('input','原生状态确认尺寸无效');
 const resource=operation===undefined?undefined:b.subarray(68,84).toString('hex');if(operation!==undefined&&(b.readUInt32LE(64)!==16||resource==='0'.repeat(32)))return failure('input','原生状态资源身份无效');
 return {ok:true,value:{generation,sequence,width,height,samples,control,operation,resource,family:operation===undefined?undefined:'bouncing'}};
}
function responseHeader(bytes,expected){
 if(bytes.readUInt32LE(0)!==0x31524c4d||bytes.readUInt32LE(4)!==1)return failure('protocol','原生响应版本无效');
 const length=bytes.readUInt32LE(8),generation=bytes.readUInt32LE(12),sequence=bytes.readUInt32LE(16),width=bytes.readUInt32LE(20),height=bytes.readUInt32LE(24),status=bytes.readUInt32LE(28),format=bytes.readUInt32LE(32),payloadBytes=bytes.readUInt32LE(36),contextSerial=bytes.readUInt32LE(40);
 if(generation!==expected.generation||sequence!==expected.sequence||width!==expected.width||height!==expected.height)return failure('protocol','原生响应不属于当前帧');
 if(length!==HEADER+payloadBytes||status>6||(status===0?(format!==(expected.family==='iterated-render'?5:expected.family==='iterated'?4:expected.family==='samila'?3:expected.control?2:1)||!contextSerial||payloadBytes!==(expected.family==='iterated-render'?128+(expected.control?0:width*height*4):expected.family==='iterated'?64+expected.readCount*24:expected.family==='samila'?64+(expected.control?0:width*height*4):expected.control?4:width*height*4)):(format!==0||payloadBytes>MAX_ERROR)))return failure('protocol','原生响应长度或格式无效');
 return {ok:true,value:{generation,sequence,width,height,status,format,payloadBytes,contextSerial}};
}
function samilaResponse(payload,expected){
 const word=n=>payload.readUInt32LE(n),index=word(24),disposition=word(28),steps=word(32),accepted=word(36),clipped=word(40),invalid=word(44),occupied=word(48),maxCount=payload.readFloatLE(52),invalidInk=word(56);
 if(word(0)!==1||word(4)!==expected.operation||payload.subarray(8,24).toString('hex')!==expected.resource||word(60)!==0||!Number.isFinite(maxCount)||maxCount<0)return failure('protocol','Samila 原生响应身份或统计无效');
 if(expected.operation===2||expected.operation===5){
  if(disposition!==0||index!==expected.expectedIndex+1||steps!==expected.steps||accepted+clipped+invalid!==steps)return failure('protocol','Samila 原生累积检查点或覆盖无效');
  if(expected.operation===5&&!payload.subarray(48,60).every(n=>n===0))return failure('protocol','Samila step 包含未经测量的呈现统计');
 }
 if(expected.operation===2||expected.operation===4){
  if(disposition!==0||occupied>expected.width*expected.height||invalidInk!==0)return failure('protocol','Samila 原生呈现统计无效');
  if(expected.operation===4&&(index!==expected.expectedIndex||!payload.subarray(32,48).every(n=>n===0)))return failure('protocol','Samila 只呈现事务推进了采样');
 }
 if(expected.operation===1||expected.operation===3){if(!payload.subarray(32,64).every(n=>n===0)||expected.operation===1&&(index!==0||disposition!==0)||expected.operation===3&&(disposition!==1&&disposition!==2||disposition===2&&index!==0))return failure('protocol','Samila 原生控制响应无效');}
 return {ok:true,value:{index,disposition}};
}
function iteratedResponse(payload,expected){
 const word=n=>payload.readUInt32LE(n),index=word(24),disposition=word(28),uploaded=word(32),total=word(36),offset=word(40),count=word(44),steps=word(48),kind=expected.operation;
 if(word(0)!==2||word(4)!==kind||payload.subarray(8,24).toString('hex')!==expected.resource||!payload.subarray(52,64).every(n=>n===0)||total>8000000||uploaded>total)return failure('protocol','迭代原生响应身份或容量无效');
 if(kind===5){if((disposition!==1&&disposition!==2)||disposition===1&&!total||disposition===2&&(index||uploaded||total)||offset||count||steps)return failure('protocol','迭代原生释放响应无效');return{ok:true};}
 if(disposition!==0||!total||steps!==expected.steps||offset!==(kind===4?expected.offset:0)||count!==expected.readCount)return failure('protocol','迭代原生响应操作范围无效');
 if(kind===1&&(index!==0||uploaded!==0||total!==expected.totalCount)||kind===2&&(index!==0||uploaded!==expected.uploaded)||kind===3&&(index!==expected.expectedIndex+1||uploaded!==total)||kind===4&&(index!==expected.expectedIndex||uploaded!==total||offset+count>total))return failure('protocol','迭代原生确认进度无效');
 for(let i=0;i<count;i++)if(word(64+i*24+20)>1)return failure('protocol','迭代原生有效标记无效');return{ok:true};
}
function iteratedRenderResponse(payload,expected){
 const word=n=>payload.readUInt32LE(n),kind=expected.operation,stateResource=payload.subarray(24,40).toString('hex'),index=word(40),displays=word(44),disposition=word(48),count=word(52),width=word(56),height=word(60),invalid=word(64)+word(68)*4294967296,accepted=word(72),clipped=word(76),sampleInvalid=word(80),occupied=word(84),maxCount=payload.readFloatLE(88);
 const metadata={resource:expected.resource,family:'iterated-render',stateResource,index,displays,count,width,height};
 if(word(0)!==3||word(4)!==kind||payload.subarray(8,24).toString('hex')!==expected.resource||!payload.subarray(92,128).every(n=>n===0))return failure('protocol','迭代原生绘制响应身份或保留字段无效');
 if(kind===4){
  if(![1,2].includes(disposition)||!payload.subarray(64,128).every(n=>n===0))return failure('protocol','迭代原生绘制释放未确认');
  if(disposition===2){if(!payload.subarray(24,48).every(n=>n===0)||!payload.subarray(52,128).every(n=>n===0))return failure('protocol','不存在的迭代原生绘制资源包含状态');}
  else if(stateResource==='0'.repeat(32)||!count||count>8000000||!width||width>16384||!height||height>16384||width*height>16000000||expected.owned&&['stateResource','index','displays','count','width','height'].some(k=>metadata[k]!==expected.owned[k]))return failure('protocol','迭代原生绘制释放不属于保留的资源');
  return{ok:true,value:metadata};
 }
 if(disposition!==0||stateResource!==expected.stateResource||index!==expected.expectedIndex||displays!==expected.expectedDisplays+(kind===2?1:0)||count!==expected.totalCount||width!==expected.width||height!==expected.height)return failure('protocol','迭代原生绘制确认检查点或尺寸不符');
 // A later compute advance does not change the last index drawn into this ink.
 if(expected.owned&&(kind===1||['stateResource','count','width','height'].some(k=>metadata[k]!==expected.owned[k])||expected.expectedDisplays!==expected.owned.displays||(kind===3||kind===5)&&index!==expected.owned.index))return failure('protocol','迭代原生绘制确认与自有资源不符');
 if((kind===1||kind===5)&&!payload.subarray(64,128).every(n=>n===0)||kind===2&&(!Number.isSafeInteger(invalid)||accepted+clipped>count||sampleInvalid!==(expected.record?count-accepted-clipped:0)||!payload.subarray(84,128).every(n=>n===0))||kind===3&&(!payload.subarray(64,84).every(n=>n===0)||occupied>width*height||!Number.isFinite(maxCount)||maxCount<0))return failure('protocol','迭代原生绘制统计覆盖无效');
 return{ok:true,value:metadata};
}
const releaseOperation={bouncing:4,samila:3,iterated:5,'iterated-render':4};
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
 let owner,job,closing=false,closePromise,resetPromise,sessionStarts=0;const retainedResources=new Map();
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
     let result,resourceMetadata;if(meta.status){let message;try{message=new TextDecoder('utf-8',{fatal:true}).decode(pixels);}catch{retire(o,failure('protocol','原生错误消息不是 UTF-8'));return;}result=failure({1:'input',2:'unsupported',3:'capacity',4:'runtime',5:'state-lost',6:'ownership'}[meta.status],message);}
     else if(j.expected.family==='iterated-render'){const parsed=iteratedRenderResponse(pixels,j.expected);if(!parsed.ok){retire(o,parsed);return;}resourceMetadata=parsed.value;result={ok:true,value:{generation:meta.generation,sequence:meta.sequence,width:meta.width,height:meta.height,pixels,format:'iterated-render-v1',rowOrder:j.expected.control?'none':'bottom-up',contextSerial:meta.contextSerial,sessionSerial:o.serial,rendererIdentity}};}
     else if(j.expected.family==='iterated'){const parsed=iteratedResponse(pixels,j.expected);if(!parsed.ok){retire(o,parsed);return;}result={ok:true,value:{generation:meta.generation,sequence:meta.sequence,width:meta.width,height:meta.height,pixels,format:'iterated-v1',rowOrder:'none',contextSerial:meta.contextSerial,sessionSerial:o.serial,rendererIdentity}};}
     else if(j.expected.family==='samila'){const parsed=samilaResponse(pixels,j.expected);if(!parsed.ok){retire(o,parsed);return;}result={ok:true,value:{generation:meta.generation,sequence:meta.sequence,width:meta.width,height:meta.height,pixels,format:'samila-v1',rowOrder:j.expected.control?'none':'bottom-up',contextSerial:meta.contextSerial,sessionSerial:o.serial,rendererIdentity}};}
     else result={ok:true,value:{generation:meta.generation,sequence:meta.sequence,width:meta.width,height:meta.height,pixels,format:meta.format===2?'u32le':'rgba8',rowOrder:meta.format===2?'none':'bottom-up',contextSerial:meta.contextSerial,sessionSerial:o.serial,rendererIdentity}};
     if(meta.status===4){
      // Ink cleanup can fail after a context error. Only close proves that every
      // child owner is gone; never publish an available lease from an error ACK.
      if(j.expected.family==='iterated-render'||[...retainedResources.values()].some(r=>r.family==='iterated-render')){retire(o,result);return;}
      retainedResources.clear();
     }
     if(result.ok&&j.expected.family){
      const key=j.expected.family+':'+j.expected.resource;
      if(j.expected.family==='iterated'&&j.expected.operation===5&&[...retainedResources.values()].some(r=>r.family==='iterated-render'&&r.stateResource===j.expected.resource)){retire(o,failure('protocol','迭代计算释放未保留仍有子墨迹的所有者'));return;}
      if(j.expected.operation===releaseOperation[j.expected.family])retainedResources.delete(key);
      else if(resourceMetadata)retainedResources.set(key,resourceMetadata);
      else if(j.expected.operation===1)retainedResources.set(key,{family:j.expected.family,resource:j.expected.resource});
     }
     finish(j,result);return;
    }
   }
  });
  child.once('close',()=>{
   o.closed=true;clearTimeout(o.force);clearTimeout(o.cleanup);if(owner===o){owner=undefined;retainedResources.clear();}
   if(job?.owner===o)finish(job,o.reason??failure('runtime','原生进程在交付完整帧前退出'));done();
  });
  return o;
 }
 function render(packet,options={}){
  if(!options||typeof options!=='object'||Object.keys(options).some(k=>k!=='signal')||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))return Promise.resolve(failure('input','原生渲染取消参数无效'));
  const signal=options.signal;
  if(closing)return Promise.resolve(failure('closed','原生渲染服务已关闭'));
  if(signal?.aborted)return Promise.resolve(failure('cancelled','原生渲染已取消'));
  if(job||owner?.reason||resetPromise)return Promise.resolve(failure('capacity','原生渲染已有请求或正在清理'));
  const header=inspectSourceFrameHeader(packet);if(!header.ok)return Promise.resolve(header);
  // Own the bytes before any await, so later caller edits cannot change a frame.
  const input=Buffer.from(packet),expected={...header.value,owned:retainedResources.get(header.value.family+':'+header.value.resource)};
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
 async function retireAndWait(reason){
  const o=owner;if(job&&!job.owner)finish(job,reason);if(o){retire(o,reason);if(o.cleanupExpired)kill(o,'SIGKILL');}
  if(!o)return{ok:true};let timer;const result=await Promise.race([o.done.then(()=>({ok:true})),new Promise(resolve=>{timer=setTimeout(()=>resolve(failure('cleanup','原生进程未确认退出，仍由服务持有')),cleanupMs);})]);clearTimeout(timer);return result;
 }
 return{render,health,rendererIdentity,get retainedResource(){return retainedResources.values().next().value?.resource;},get retainedResourceCount(){return retainedResources.size;},get canAcquireLease(){return !closing&&!job&&!owner?.reason&&!resetPromise&&!retainedResources.size;},get processCount(){return owner?1:0;},get processObservation(){return owner?{pid:owner.child.pid,sessionSerial:owner.serial,retiring:!!owner.reason}:null;},get activeCount(){return job?1:0;},get sessionStarts(){return sessionStarts;},
  reset(){
   if(closing)return Promise.resolve(failure('closed','原生渲染服务已关闭'));
   if(!resetPromise)resetPromise=retireAndWait(failure('state-lost','原生页面连接已关闭')).finally(()=>{resetPromise=undefined;});return resetPromise;
  },
  close(){
   if(closePromise)return closePromise;closing=true;
   closePromise=retireAndWait(failure('closed','原生渲染服务已关闭')).then(result=>{if(!result.ok)closePromise=undefined;return result;});return closePromise;
  }
 };
}
