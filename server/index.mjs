import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readdir,lstat,unlink,rename,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.cache/exports');
const formats={mp4:{mime:'video/mp4',args:['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart']},webm:{mime:'video/webm',args:['-c:v','libvpx-vp9','-crf','25','-b:v','0']},gif:{mime:'image/gif',args:['-vf','split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse']}};

// MathArt 1.7.8 config default is high; its UI offers these four qualities.
const mathartQuality={low:{preset:'veryfast',crf:'28'},medium:{preset:'medium',crf:'23'},high:{preset:'slow',crf:'18',tune:'animation'},production:{preset:'veryslow',crf:'10',tune:'animation'}};
const mathartMp4Args=['-c:v','libx264','-pix_fmt','yuv444p','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','iec61966-2-1','-movflags','+faststart+write_colr'];
function encoderArguments(format,profile,scale,quality){
 const filters=[...(scale?[scale]:[]),...(format==='gif'?['split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse']:[])];
 const q=mathartQuality[quality??'high'];
 const codec=profile==='mathart'?[...mathartMp4Args,'-preset',q.preset,'-crf',q.crf,...(q.tune?['-tune',q.tune]:[])]:format==='gif'?[]:formats[format].args;
 return [...(filters.length?['-vf',filters.join(',')]:[]),...codec];
}
const imageFormats={'image/png':'png','image/jpeg':'jpg'};
const uuidPattern='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ownedName=new RegExp(`^${uuidPattern}\\.(png|jpg|mp4|webm|gif)$`);
const defaults={maxActive:2,maxUploads:2,maxRecords:128,maxFiles:10000,maxImageBytes:64*1024**2,maxFrameBytes:64*1024**2,maxPixels:7680*4320,maxFrames:432000,maxFramePixels:100e9,maxInputBytes:4*1024**3,maxOutputBytes:2*1024**3,maxDiskBytes:8*1024**3,bodyTimeoutMs:60000,idleTimeoutMs:300000,finishTimeoutMs:120000,writeTimeoutMs:60000,killGraceMs:1500,healthTimeoutMs:3000};
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function json(res,status,data){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));}
function mediaType(req){return req.headers['content-type']?.split(';')[0].trim().toLowerCase();}
function readBody(req,max,timeoutMs){
 return new Promise((resolve,reject)=>{
  let size=0,chunks=[],settled=false;
  const cleanup=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('aborted',aborted);req.off('error',error);};
  const fail=e=>{if(settled)return;settled=true;cleanup();chunks=[];req.resume();reject(e);};
  const data=chunk=>{size+=chunk.length;if(size>max)fail(new HttpError(413,'请求内容超过资源上限'));else chunks.push(chunk);};
  const end=()=>{if(settled)return;settled=true;cleanup();resolve(Buffer.concat(chunks,size));};
  const aborted=()=>fail(new HttpError(499,'客户端已断开'));
  const error=e=>fail(e);
  const timer=setTimeout(()=>fail(new HttpError(408,'上传超时')),timeoutMs);timer.unref();
  req.on('data',data);req.once('end',end);req.once('aborted',aborted);req.once('error',error);
  const length=req.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>max))fail(new HttpError(413,'请求内容超过资源上限'));
  else if(req.aborted)aborted();
 });
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function pngSize(bytes){
 if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new HttpError(400,'PNG 数据无效');
 let offset=8,width=0,height=0,hasData=false,ended=false;
 while(offset<bytes.length){
  if(bytes.length-offset<12)throw new HttpError(400,'PNG 数据截断');
  const length=bytes.readUInt32BE(offset),end=offset+12+length;
  if(end>bytes.length)throw new HttpError(400,'PNG 数据截断');
  const type=bytes.toString('ascii',offset+4,offset+8);
  if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw new HttpError(400,'PNG 校验失败');
  if(offset===8){
   if(type!=='IHDR'||length!==13)throw new HttpError(400,'PNG 缺少 IHDR');
   width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);
   if(!width||!height)throw new HttpError(400,'PNG 尺寸无效');
  }else if(type==='IHDR')throw new HttpError(400,'PNG 重复 IHDR');
  if(type==='IDAT')hasData=true;
  if(type==='IEND'){if(length!==0||end!==bytes.length||!hasData)throw new HttpError(400,'PNG 结束块无效');ended=true;break;}
  offset=end;
 }
 if(!ended)throw new HttpError(400,'PNG 缺少结束块');return {width,height};
}
function jpegSize(bytes){
 if(bytes.length<10||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new HttpError(400,'JPEG 数据无效或截断');
 let offset=2,size;
 while(offset<bytes.length-2){
  if(bytes[offset++]!==255)throw new HttpError(400,'JPEG 标记无效');
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];
  if(offset+2>bytes.length)throw new HttpError(400,'JPEG 数据截断');
  const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw new HttpError(400,'JPEG 数据截断');
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(length<8)throw new HttpError(400,'JPEG 帧头无效');size={width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};
  }
  if(marker===0xda){if(!size||!size.width||!size.height)throw new HttpError(400,'JPEG 尺寸无效');return size;}
  offset+=length;
 }
 throw new HttpError(400,'JPEG 缺少图像数据');
}
function localOrigin(req,allowed){
 try{
  const authority=req.headers.host;if(!authority||!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(authority))return false;new URL(`http://${authority}`);
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const origin=req.headers.origin;
  return !origin||allowed.has(origin)||origin===`http://${req.headers.host}`;
 }catch{return false;}
}

/** Creates an isolated service. Importing this module does not bind a port or install signal handlers. */
export async function createExportServer(options={}){
 const root=path.resolve(options.root??defaultRoot),limits={...defaults,...options.limits},ffmpegPath=options.ffmpegPath??'ffmpeg';
 await mkdir(root,{recursive:true});
 const allowed=new Set(options.allowedOrigins??['http://127.0.0.1:5177','http://localhost:5177','http://127.0.0.1:5179','http://localhost:5179','http://127.0.0.1:4173','http://localhost:4173']);
 for(const origin of allowed){const u=new URL(origin);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.origin!==origin)throw new Error('仅支持本机 HTTP 来源');}
 const sessions=new Map(),children=new Set(),files=new Map(),requests=new Set();let storedBytes=0,reservedBytes=0,reservedFiles=0,uploads=0,closing=false,healthPromise,healthAt=0;
 for(const name of await readdir(root)){const info=await lstat(path.join(root,name));if(!info.isFile())continue;storedBytes+=info.size;if(ownedName.test(name)){if(files.size>=limits.maxFiles)throw new Error('导出目录文件数量超过资源上限');files.set(name,info.size);}}
 function reserve(size){if(files.size+reservedFiles>=limits.maxFiles)throw new HttpError(507,'导出文件数量达到资源上限');if(storedBytes+reservedBytes+size>limits.maxDiskBytes)throw new HttpError(507,'导出目录已达到容量上限，请清理已保存文件');reservedBytes+=size;reservedFiles++;}
 function ownedSpawn(args,stdio=['pipe','ignore','pipe','pipe']){
  const child=spawn(ffmpegPath,args,{stdio});
  const record={child,ended:false};children.add(record);
  record.spawned=new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  // Every exit path resolves this promise, including executable-not-found.
  record.exited=new Promise(resolve=>{child.once('close',(code,signal)=>{record.ended=true;children.delete(record);resolve({code,signal});});});
  child.stdin?.on('error',()=>{});
  return record;
 }
 async function stop(record){
  if(!record||record.ended)return;
  // Only ChildProcess handles created here are signalled, never a discovered PID or process group.
  if(record.child.exitCode===null&&record.child.signalCode===null)record.child.kill('SIGTERM');
  let timer;try{await Promise.race([record.exited,new Promise(resolve=>{timer=setTimeout(resolve,limits.killGraceMs);})]);}finally{clearTimeout(timer);}
  if(!record.ended&&record.child.exitCode===null&&record.child.signalCode===null)record.child.kill('SIGKILL');
  await record.exited;
 }
 async function remove(file){try{await unlink(file);const name=path.basename(file),size=files.get(name);if(size!==undefined){storedBytes-=size;files.delete(name);}}catch(error){if(error.code!=='ENOENT')throw error;}}
 function release(s){if(s.reserved){reservedBytes-=s.reserved;reservedFiles--;s.reserved=0;}}
 function clearIdle(s){clearTimeout(s.idle);}
 function touch(s){clearIdle(s);if(s.status==='encoding'){s.idle=setTimeout(()=>void abort(s,'failed','上传等待超时').catch(()=>{}),limits.idleTimeoutMs);s.idle.unref();}}
 async function abort(s,status='cancelled',reason='导出已取消'){
  // Completion is an acknowledged result. A late failure/timeout cannot
  // revoke it; only explicit cancellation retains file-removal authority.
  if(s.status==='complete'&&status!=='cancelled')return;
  if(s.abortPromise)return s.abortPromise;
  s.status=status;s.error=reason;clearIdle(s);
  // An in-flight rename may publish bytes after failure was marked. Wait for
  // that owned commit before removing both possible destinations and their
  // accounting; no failed session may leave an inaccessible completed file.
  s.abortPromise=(async()=>{await stop(s.process);if(s.commitPromise)await s.commitPromise.catch(()=>{});await remove(s.partial);await remove(s.file);release(s);s.cleaned=true;})().catch(error=>{s.abortPromise=undefined;throw error;});
  return s.abortPromise;
 }
 function disconnect(req,res,s){
  const cancelled=()=>{if(!res.writableEnded)void abort(s,'cancelled','客户端已断开').catch(()=>{});};
  req.once('aborted',cancelled);res.once('close',cancelled);
  return ()=>{req.off('aborted',cancelled);res.off('close',cancelled);};
 }
 function finish(s,finalFrames){
  // expected remains the admitted planned maximum. Once sealed, the exact
  // accepted PNG prefix owns the encoder and every retry of its finalization.
  if(s.finalFrames!==undefined&&s.finalFrames!==finalFrames)throw new HttpError(409,'导出已封定其它完成帧数');
  if(s.status==='complete')return Promise.resolve(s.result);
  if(s.status==='finishing'&&s.finishPromise)return s.finishPromise;
  if(s.status!=='encoding'||s.locked||s.frames!==finalFrames)throw new HttpError(409,s.error||'完成帧数与已接收帧不匹配，或仍有帧正在上传');
  s.finalFrames=finalFrames;s.status='finishing';clearIdle(s);
  s.finishPromise=(async()=>{
   // Finalization belongs to the service after sealing, rather than to any
   // one HTTP response. Disconnects may retry this same result; explicit
   // DELETE, shutdown and the bounded timeout retain cancellation authority.
   const timer=setTimeout(()=>void abort(s,'failed','编码完成超时').catch(()=>{}),limits.finishTimeoutMs);timer.unref();
   try{
    s.process.child.stdin.end();const {code}=await s.process.exited;
    if(code!==0||s.status!=='finishing')throw new HttpError(500,s.error||'FFmpeg 编码失败');
    if(s.encodedFrames!==s.finalFrames)throw new HttpError(500,`编码帧数不匹配 (${s.encodedFrames}/${s.finalFrames})`);
    const info=await lstat(s.partial);if(!info.isFile()||info.size===0||info.size>limits.maxOutputBytes)throw new HttpError(507,'编码文件为空或超过容量上限');
    if(s.status!=='finishing')throw new HttpError(s.status==='cancelled'?499:500,s.error||'导出未能完成');
    s.commitPromise=(async()=>{
     await rename(s.partial,s.file);files.set(path.basename(s.file),info.size);storedBytes+=info.size;release(s);
     if(s.status==='finishing'){s.result={id:s.id,url:`/api/exports/${s.id}/file`,bytes:info.size,frames:s.finalFrames};s.status='complete';}
    })();await s.commitPromise;
    if(s.status!=='complete')throw new HttpError(s.status==='cancelled'?499:500,s.error||'导出未能完成');
    return s.result;
   }catch(error){await abort(s,s.status==='cancelled'?'cancelled':'failed',error.message);throw error;}finally{clearTimeout(timer);}
  })();
  return s.finishPromise;
 }
 async function withUpload(req,max,fn){
  if(uploads>=limits.maxUploads){req.resume();throw new HttpError(429,'同时上传数量超过资源上限');}
  uploads++;try{return await fn(await readBody(req,max,limits.bodyTimeoutMs));}finally{uploads--;}
 }
 async function download(req,res,name,mime){
  const handle=await open(path.join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW).catch(error=>{if(error.code==='ENOENT')throw new HttpError(404,'文件不存在');throw error;});
  try{
   const info=await handle.stat();if(!info.isFile())throw new HttpError(404,'文件不存在');
   res.writeHead(200,{'content-type':mime,'content-length':info.size,'content-disposition':`attachment; filename="MathArt-Lab.${name.split('.').at(-1)}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});
   if(req.method==='HEAD'){res.end();await handle.close();return;}
   const stream=handle.createReadStream();stream.once('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){await handle.close();throw error;}
 }
 async function health(){
  if(healthPromise&&Date.now()-healthAt<10000)return healthPromise;healthAt=Date.now();
  healthPromise=(async()=>{
   const p=ownedSpawn(['-version'],['ignore','pipe','ignore']);let version='';p.child.stdout.on('data',b=>{version=(version+b.toString()).slice(0,4096);});
   const timer=setTimeout(()=>void stop(p),limits.healthTimeoutMs);timer.unref();
   try{await p.spawned;const {code}=await p.exited;return {ok:true,ffmpeg:code===0,version:version.split('\n')[0]};}catch{return {ok:true,ffmpeg:false};}finally{clearTimeout(timer);}
  })();return healthPromise;
 }
 async function route(req,res){
  if(closing)throw new HttpError(503,'导出服务正在停止');
  if(!localOrigin(req,allowed))throw new HttpError(403,'不接受此来源或主机');
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,await health());
  if(req.method==='POST'&&url.pathname==='/api/images'){
   const extension=Object.hasOwn(imageFormats,mediaType(req))?imageFormats[mediaType(req)]:undefined;if(!extension)throw new HttpError(415,'需要 image/png 或 image/jpeg');
   return withUpload(req,limits.maxImageBytes,async bytes=>{
    const size=extension==='png'?pngSize(bytes):jpegSize(bytes);if(size.width>16384||size.height>16384||size.width*size.height>limits.maxPixels)throw new HttpError(413,'图像尺寸超过资源上限');
    reserve(bytes.length);const id=randomUUID(),name=`${id}.${extension}`,file=path.join(root,name),partial=file+'.partial';
    try{await writeFile(partial,bytes,{flag:'wx'});if(req.aborted||res.destroyed)throw new HttpError(499,'客户端已断开');await rename(partial,file);files.set(name,bytes.length);storedBytes+=bytes.length;json(res,201,{id,url:`/api/images/${name}`,bytes:bytes.length});}finally{reservedBytes-=bytes.length;reservedFiles--;await remove(partial);}
   });
  }
  const image=url.pathname.match(new RegExp(`^/api/images/(${uuidPattern}\\.(png|jpg))$`));
  if(image&&(req.method==='GET'||req.method==='HEAD'))return download(req,res,image[1],image[2]==='png'?'image/png':'image/jpeg');
  if(req.method==='POST'&&url.pathname==='/api/exports'){
   if(mediaType(req)!=='application/json')throw new HttpError(415,'需要 JSON 请求');
   let input;try{input=JSON.parse((await readBody(req,8192,limits.bodyTimeoutMs)).toString());}catch(e){if(e instanceof SyntaxError)throw new HttpError(400,'JSON 请求无效');throw e;}
   if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'导出参数无效');
   const {width,height,fps,format,frames}=input;
   const inputWidth=input.inputWidth===undefined?width:input.inputWidth,inputHeight=input.inputHeight===undefined?height:input.inputHeight;
   if((input.inputWidth===undefined)!==(input.inputHeight===undefined)||![inputWidth,inputHeight].every(Number.isSafeInteger)||inputWidth<1||inputHeight<1||inputWidth>16384||inputHeight>16384)throw new HttpError(400,'输入帧尺寸无效');
   if(input.quality!==undefined&&(input.profile!=='mathart'||!Object.hasOwn(mathartQuality,input.quality)))throw new HttpError(400,'视频质量无效');
   if(input.profile!==undefined&&(input.profile!=='mathart'||format!=='mp4'))throw new HttpError(400,'视频编码配置无效');
   if(!Object.hasOwn(formats,format)||![width,height,fps,frames].every(Number.isSafeInteger)||width<16||height<16||width>7680||height>4320||width%2||height%2||fps<1||fps>120||frames<1||frames>limits.maxFrames)throw new HttpError(400,'导出参数无效');
   if(Math.max(width*height,inputWidth*inputHeight)>limits.maxPixels||Math.max(width*height,inputWidth*inputHeight)*frames>limits.maxFramePixels)throw new HttpError(413,'导出总像素数超过资源上限');
   if([...sessions.values()].filter(s=>['encoding','finishing'].includes(s.status)).length>=limits.maxActive)throw new HttpError(409,'已有两个导出任务，请先完成或取消');
   for(const [id,s] of sessions){if(sessions.size<limits.maxRecords)break;if(s.status==='complete'||s.cleaned)sessions.delete(id);}
   if(sessions.size>=limits.maxRecords)throw new HttpError(429,'导出任务记录达到上限');
   reserve(limits.maxOutputBytes);
   const id=randomUUID(),file=path.join(root,`${id}.${format}`),partial=path.join(root,`${id}.partial.${format}`);
   const scale=inputWidth!==width||inputHeight!==height?`scale=${width}:${height}:flags=lanczos`:undefined;
   const codecArgs=encoderArguments(format,input.profile,scale,input.quality);
   let p;
   try{p=ownedSpawn(['-hide_banner','-loglevel','error','-nostdin','-y','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-threads','2','-i','pipe:0','-an','-filter_threads','2','-filter_complex_threads','2',...codecArgs,'-threads','2','-fs',String(limits.maxOutputBytes),'-progress','pipe:3','-nostats',partial]);}catch(error){reservedBytes-=limits.maxOutputBytes;reservedFiles--;throw error;}
   const s={id,file,partial,process:p,status:'encoding',format,width,height,inputWidth,inputHeight,fps,expected:frames,frames:0,encodedFrames:0,inputBytes:0,error:'',locked:false,reserved:limits.maxOutputBytes};sessions.set(id,s);
   const unwatch=disconnect(req,res,s);let progress='';
   p.child.stderr.on('data',chunk=>{s.error=(s.error+chunk.toString()).slice(-8000);});
   p.child.stdio[3].on('data',chunk=>{progress+=chunk.toString();let end;while((end=progress.indexOf('\n'))>=0){const line=progress.slice(0,end);progress=progress.slice(end+1);if(/^frame=\d+$/.test(line))s.encodedFrames=Number(line.slice(6));}progress=progress.slice(-4096);});
   p.exited.then(({code})=>{if(s.status==='encoding')void abort(s,'failed',s.error||`编码进程提前退出 (${code})`).catch(()=>{});});
   try{await p.spawned;if(s.status!=='encoding'||res.destroyed)throw new HttpError(499,'客户端已断开');touch(s);json(res,201,{id});}catch(error){await abort(s,'failed',error.message);throw new HttpError(503,'无法启动 FFmpeg: '+error.message);}finally{unwatch();}
   return;
  }
  const match=url.pathname.match(new RegExp(`^/api/exports/(${uuidPattern})(?:/(frames|finish|file))?$`));
  if(!match)throw new HttpError(404,'接口不存在');
  const id=match[1],action=match[2],s=sessions.get(id);
  if((req.method==='GET'||req.method==='HEAD')&&action==='file'){
   if(s&&s.status!=='complete')throw new HttpError(409,s.error||'文件尚未完成');
   const extension=s?.format??Object.keys(formats).find(f=>files.has(`${id}.${f}`));if(!extension)throw new HttpError(404,'文件不存在');
   return download(req,res,`${id}.${extension}`,formats[extension].mime);
  }
  if(!s)throw new HttpError(404,'导出任务不存在');
  if(req.method==='GET'&&!action)return json(res,200,{id,status:s.status,frames:s.frames,expected:s.expected,locked:s.locked,finalFrames:s.finalFrames,...(s.status==='complete'?{url:s.result.url,bytes:s.result.bytes}:{}),error:s.status==='failed'?s.error:undefined});
  if(req.method==='DELETE'&&!action){
   // A dialog can be cancelled/unmounted while the successful finish response
   // is still in flight. Conditional cleanup must not remove its completed file.
   // For unfinished sessions abort() synchronously marks cancelled before its
   // first await, so an in-flight commit cannot subsequently become complete.
   if(url.searchParams.get('onlyUnfinished')==='true'&&s.status==='complete')return json(res,200,{cancelled:false,complete:true});
   await abort(s);sessions.delete(id);return json(res,200,{cancelled:true});
  }
  if(req.method==='POST'&&action==='frames'){
   if(s.status!=='encoding')throw new HttpError(409,s.error||'任务已结束');
   if(mediaType(req)!=='image/png')throw new HttpError(415,'视频帧需要 image/png');
   const index=url.searchParams.get('index');if(index===null||!/^\d+$/.test(index)||!Number.isSafeInteger(Number(index))||Number(index)!==s.frames||s.frames>=s.expected||s.locked)throw new HttpError(409,'帧顺序不匹配');
   s.locked=true;clearIdle(s);const unwatch=disconnect(req,res,s);
   try{return await withUpload(req,limits.maxFrameBytes,async bytes=>{
    const size=pngSize(bytes);if(size.width!==s.inputWidth||size.height!==s.inputHeight)throw new HttpError(400,'PNG 帧尺寸不匹配');
    if(s.inputBytes+bytes.length>limits.maxInputBytes){await abort(s,'failed','累计帧数据超过资源上限');throw new HttpError(413,s.error);}
    if(s.status!=='encoding')throw new HttpError(409,s.error||'任务已结束');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void abort(s,'failed','编码写入超时');reject(new HttpError(504,'编码写入超时'));},limits.writeTimeoutMs);timer.unref();s.process.child.stdin.write(bytes,error=>{clearTimeout(timer);error?reject(error):resolve();});});
    if(s.status!=='encoding')throw new HttpError(409,s.error||'编码已停止');s.frames++;s.inputBytes+=bytes.length;json(res,200,{frames:s.frames});
   });}catch(error){if(!(error instanceof HttpError)||error.status===408||error.status===499)await abort(s,'failed',error.message);throw error;}finally{unwatch();s.locked=false;touch(s);}
  }
  if(req.method==='POST'&&action==='finish'){
   const body=await readBody(req,8192,limits.bodyTimeoutMs);let input={};
   if(body.length){
    if(mediaType(req)!=='application/json')throw new HttpError(415,'完成参数需要 JSON 请求');
    try{input=JSON.parse(body.toString());}catch{throw new HttpError(400,'JSON 请求无效');}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='finalFrames'))throw new HttpError(400,'完成参数无效');
   }
   const finalFrames=input.finalFrames===undefined?s.expected:input.finalFrames;
   if(!Number.isSafeInteger(finalFrames)||finalFrames<1||finalFrames>s.expected)throw new HttpError(400,'完成帧数必须在计划帧数范围内');
   // Upload, cancellation and another finish may have changed the session
   // while this body was arriving. Recheck and seal at the owning boundary.
   return json(res,200,await finish(s,finalFrames));
  }
  throw new HttpError(405,'不支持此操作');
 }
 const server=http.createServer((req,res)=>{const task=route(req,res).catch(error=>{if(res.headersSent){res.destroy();return;}req.resume();json(res,error.status??500,{error:error.message||'导出服务失败'});});requests.add(task);task.finally(()=>requests.delete(task));});
 server.requestTimeout=limits.bodyTimeoutMs;server.headersTimeout=Math.min(30000,limits.bodyTimeoutMs);server.keepAliveTimeout=5000;
 let closePromise;
 return {
  server,root,
  get ownedProcessCount(){return children.size;},
  async listen(port=5178){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});return server.address();},
  close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{
   const stopped=new Promise(resolve=>server.close(resolve));
   const results=await Promise.allSettled([...sessions.values()].filter(s=>s.status!=='complete'&&!s.cleaned).map(s=>abort(s)));
   await Promise.allSettled([...children].map(stop));server.closeAllConnections();await stopped;await Promise.allSettled([...requests]);
   const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  })();return closePromise;}
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const service=await createExportServer();const address=await service.listen(Number(process.env.MATHART_EXPORT_PORT??5178));
 console.log(`MathArt export service: http://127.0.0.1:${address.port}`);
 let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;try{await service.close();}catch(error){console.error(error);process.exitCode=1;}};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
