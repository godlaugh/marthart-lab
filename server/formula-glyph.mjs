import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {stat,readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const MAGIC=0x4d414731,MAX_PIXELS=16_000_000,MAX_BYTES=MAX_PIXELS*4+16;
const failure=(kind,message)=>({ok:false,error:{kind,message}});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function runtimeFiles(javaHome){
 const root=await realpath(javaHome),files=new Set(),visited=new Set(),layout=[];let bytes=0;
 async function walk(file){
  const resolved=await realpath(file);if(resolved!==root&&!resolved.startsWith(root+path.sep))throw new Error('字形运行时不能引用目录外的文件');
  layout.push([path.relative(root,file),path.relative(root,resolved)]);if(layout.length>10000)throw new Error('字形运行时目录结构超出预算');
  if(visited.has(resolved))return;visited.add(resolved);if(visited.size>10000)throw new Error('字形运行时文件数量超出预算');
  const info=await stat(resolved);
  if(info.isDirectory()){for(const name of (await readdir(resolved)).sort())await walk(path.join(resolved,name));}
  else if(info.isFile()){bytes+=info.size;if(bytes>512*1024**2||info.size>256*1024**2)throw new Error('字形运行时超出身份检查预算');files.add(resolved);}else throw new Error('字形运行时含不支持的文件类型');
 }
 for(const name of ['bin/java','release','lib','conf'])await walk(path.join(root,name));
 return {files:[...files].sort(),layout:JSON.stringify(layout)};
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function identity(file){
 const before=await stat(file);if(!before.isFile()||before.size>256*1024**2)throw new Error('字形后端文件无效');
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
 const after=await stat(file);if(!sameFile(before,after))throw new Error('字形后端在初始化时发生变化');
 return {path:file,sha256:hash.digest('hex'),info:after};
}
/** Parses the private worker's bounded binary response; no image decode or
 * premultiplication occurs. Errors remain separate from valid empty alpha. */
export function decodeFormulaGlyph(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>MAX_BYTES||bytes.readUInt32BE(0)!==MAGIC)return failure('protocol','字形进程返回了无效的响应');
 const width=bytes.readUInt32BE(4),height=bytes.readUInt32BE(8),length=bytes.readUInt32BE(12);
 if(length!==bytes.length-16)return failure('protocol','字形响应长度不一致');
 if(width===0){
  if(length>1024||![1,2,3].includes(height))return failure('protocol','字形错误响应无效');
  let message;try{message=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(16));}catch{return failure('protocol','字形错误文本无效');}
  return failure({1:'unsupported',2:'invalid-input',3:'capacity'}[height],message);
 }
 if(width>16384||height<1||height>16384||width*height>MAX_PIXELS||length!==width*height*4)return failure('protocol','字形图像尺寸无效');
 return {ok:true,value:{width,height,pixels:bytes.subarray(16),format:'straight-rgba8',fontSize:50}};
}
function requestBytes(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['latex','color'].includes(k))||typeof input.latex!=='string'||!input.latex.length||input.latex.length>8192||typeof input.color!=='string'||!/^#[0-9a-f]{6}$/i.test(input.color))return failure('invalid-input','字形请求需要有界公式与六位 RGB 颜色');
 // Encoding must not silently replace an unpaired UTF-16 surrogate.
 const text=Buffer.from(input.latex,'utf8');if(text.toString('utf8')!==input.latex)return failure('invalid-input','公式包含无效 Unicode');
 const header=Buffer.alloc(12);header.writeUInt32BE(MAGIC);header.writeUInt32BE(text.length,4);header.writeUInt32BE(parseInt(input.color.slice(1),16),8);
 return {ok:true,value:Buffer.concat([header,text])};
}
/** One owner for each child handle until close. Explicit configuration only:
 * never searches MathArt.app or installs/falls back to a system Java. */
export async function createFormulaGlyphService({javaHome,jarPath,helperJarPath,helperJarSha256,timeoutMs=10000,killGraceMs=1000,maxActive=1}={}){
 if(![javaHome,jarPath,helperJarPath].every(p=>typeof p==='string'&&path.isAbsolute(p)))throw new Error('字形后端需要显式的独立运行时、上游库和自有 helper JAR 绝对路径');
 if(helperJarSha256!==undefined&&(typeof helperJarSha256!=='string'||!/^[a-f0-9]{64}$/.test(helperJarSha256)))throw new Error('字形 helper 摘要格式无效');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isInteger(killGraceMs)||killGraceMs<1||killGraceMs>5000||!Number.isInteger(maxActive)||maxActive<1||maxActive>2)throw new Error('字形进程资源设置无效');
 [javaHome,jarPath,helperJarPath]=await Promise.all([javaHome,jarPath,helperJarPath].map(p=>realpath(p)));
 if([jarPath,helperJarPath].some(file=>file.includes(path.delimiter)))throw new Error('字形 JAR 路径包含 Java classpath 分隔符');
 const javaPath=path.join(javaHome,'bin/java'),runtime=await runtimeFiles(javaHome);
 // Canonical execution paths and a sealed helper JAR prevent a retargeted
 // caller symlink or added classpath-directory classes from changing execution.
 const files=[...runtime.files,jarPath,helperJarPath];
 const identities=[];for(const file of files)identities.push(await identity(file));
 if(helperJarSha256!==undefined&&identities.find(file=>file.path===helperJarPath)?.sha256!==helperJarSha256)throw new Error('字形 helper 与指定摘要不符');
 if(identities.find(file=>file.path===jarPath)?.sha256!=='6d04c3843fc98d2eea9ba4cff0be7b80540ca75c5a4e0b3463fd1219c48cc65d')throw new Error('字形后端需要未经修改的官方 JLaTeXMath 1.0.7');
 const rendererIdentity=digest(Buffer.from(JSON.stringify({host:[process.platform,process.arch,os.release(),os.version()],layout:runtime.layout,files:identities.map(({path,sha256})=>({path,sha256}))})));
 const active=new Set();let closing=false,closePromise,freshnessPromise;
 // Share only an in-flight filesystem inspection, never cache a completed
 // health result. Both consumers validate the same owned backend identity.
 async function checkFreshness(){
  if(closing)return failure('closed','字形服务已关闭');
  freshnessPromise??=(async()=>{
   try{
    if((await runtimeFiles(javaHome)).layout!==runtime.layout)return failure('unavailable','字形运行时目录已变化，请重新初始化');
    for(const old of identities){const current=await stat(old.path);if(!sameFile(old.info,current))return failure('unavailable','字形后端文件已变化，请重新初始化');}
    return {ok:true};
   }catch{return failure('unavailable','字形后端文件不可用');}
  })().finally(()=>{freshnessPromise=undefined;});
  const result=await freshnessPromise;
  return closing?failure('closed','字形服务已关闭'):result;
 }
 async function health(){
  let result=await checkFreshness();
  if(closing)result=failure('closed','字形服务已关闭');
  return result.ok?{available:true,rendererIdentity,fontSize:50,format:'straight-rgba8'}:{available:false,error:result.error};
 }
 async function render(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='signal')||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))return failure('invalid-input','字形取消参数无效');
  const {signal}=options;
  try{if(signal)Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal);}catch{return failure('invalid-input','字形取消信号无效');}
  const request=requestBytes(input);if(!request.ok)return request;
  if(closing)return failure('closed','字形服务已关闭');
  if(signal?.aborted)return failure('cancelled','字形生成已取消');
  if(active.size>=maxActive)return failure('capacity','字形生成并发已满');
  // Reserve before the asynchronous freshness check, so simultaneous callers
  // cannot both pass the capacity gate. Close owns this reservation as well.
  let finish;const done=new Promise(resolve=>{finish=resolve;});const job={done,cancel:()=>{}};active.add(job);
  let cancelled=false;job.cancel=()=>{cancelled=true;};const cancel=()=>job.cancel();
  try{
   if(signal)EventTarget.prototype.addEventListener.call(signal,'abort',cancel,{once:true});
   const fresh=await checkFreshness();
   if(cancelled||signal?.aborted||closing)return failure('cancelled','字形生成已取消');
   if(!fresh.ok)return fresh;
   return await new Promise(resolve=>{
    // Keep arbitrary launcher/font/library overrides out of the rendering
    // identity. The private worker needs no inherited application environment.
    const env={PATH:path.dirname(javaPath),LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TMPDIR:os.tmpdir(),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,TEMP:os.tmpdir(),TMP:os.tmpdir()}:{})};
    const child=spawn(javaPath,['-Djava.awt.headless=true','-Dfile.encoding=UTF-8','-Xmx256m','-cp',`${helperJarPath}${path.delimiter}${jarPath}`,'mathartlab.glyph.FormulaGlyph'],{stdio:['pipe','pipe','pipe'],env,windowsHide:true});
    job.child=child;
    let chunks=[],size=0,stderrSize=0,reason,killTimer;
    const stop=(kind,message)=>{if(reason)return;reason=failure(kind,message);child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),killGraceMs);killTimer.unref();};
    job.cancel=()=>stop('cancelled','字形生成已取消');
    const timer=setTimeout(()=>stop('timeout','字形生成超时'),timeoutMs);timer.unref();
    child.stdout.on('data',chunk=>{if(reason)return;size+=chunk.length;if(size>MAX_BYTES){chunks=[];stop('capacity','字形响应超出图像预算');}else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{stderrSize+=chunk.length;if(stderrSize>16384)stop('runtime','字形进程错误输出过多');});
    child.stdin.on('error',()=>{}); // The close/error event owns final outcome.
    child.once('error',()=>{reason??=failure('unavailable','无法启动字形运行时');});
    child.once('close',(code)=>{clearTimeout(timer);clearTimeout(killTimer);if(reason)return resolve(reason);if(code!==0)return resolve(failure('runtime','字形进程未正常退出'));const result=decodeFormulaGlyph(Buffer.concat(chunks,size));if(result.ok)result.value.rendererIdentity=rendererIdentity;resolve(result);});
    child.stdin.end(request.value);
    if(cancelled||signal?.aborted||closing)job.cancel();
   });
  }catch{return failure('unavailable','字形后端文件不可用');}
  finally{try{if(signal)EventTarget.prototype.removeEventListener.call(signal,'abort',cancel);}finally{active.delete(job);finish();}}
 }
 return {render,health,rendererIdentity,get activeCount(){return active.size;},get processCount(){return [...active].filter(job=>job.child).length;},close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{for(const job of active)job.cancel();await Promise.all([...active].map(job=>job.done).concat(freshnessPromise?[freshnessPromise]:[]));})();return closePromise;}};
}
