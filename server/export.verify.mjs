import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,readdir,rm,writeFile,chmod,stat} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createExportServer} from './index.mjs';
const exec=promisify(execFile),services=new Set(),directories=[];let red,blue,jpeg,wrongSize;
const evidence=[];
async function fixture(color,codec='png',size='64x48'){
 const {stdout}=await exec('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=${color}:s=${size}:r=6`,'-frames:v','1','-f','image2pipe','-vcodec',codec,'pipe:1'],{encoding:'buffer',maxBuffer:8*1024**2});return stdout;
}
async function service(options={}){
 const root=options.root??await mkdtemp(path.join(tmpdir(),'mathart-export-test-'));if(!options.root)directories.push(root);
 const app=await createExportServer({root,...options});services.add(app);const address=await app.listen(0);
 return {app,root,url:`http://127.0.0.1:${address.port}`};
}
async function stop(app){await app.close();services.delete(app);assert.equal(app.ownedProcessCount,0,'all owned encoder and health children must close');}
async function request(s,route,options={},status=200){const r=await fetch(s.url+route,options),data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const create=(s,params={})=>request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:64,height:48,fps:6,frames:3,format:'mp4',...params})},201);
const frame=(s,id,index,bytes=red,status=200)=>request(s,`/api/exports/${id}/frames${index===undefined?'':`?index=${index}`}`,{method:'POST',headers:{'content-type':'image/png'},body:bytes},status);
const finish=(s,id,finalFrames,status=200)=>request(s,`/api/exports/${id}/finish`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({finalFrames})},status);
function pendingRequest(s,route,headers={}){
 let resolve,reject;const response=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const req=http.request(s.url+route,{method:'POST',headers},res=>{
  const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(error){reject(error);}});res.once('error',reject);
 });req.once('error',reject);return{req,response};
}
async function until(fn,timeout=3000){const start=Date.now();while(!await fn()){if(Date.now()-start>timeout)assert.fail('condition timed out');await new Promise(r=>setTimeout(r,20));}}
before(async()=>{[red,blue,jpeg,wrongSize]=await Promise.all([fixture('red'),fixture('blue'),fixture('red','mjpeg'),fixture('red','png','32x32')]);});
after(async()=>{for(const s of services)await s.close();for(const dir of directories)await rm(dir,{recursive:true,force:true});console.log('Real FFmpeg/ffprobe evidence: '+JSON.stringify(evidence));});

test('PNG/JPEG bytes persist exactly and downloads survive service restart',async()=>{
 const s=await service(),saved=[];
 for(const [type,bytes] of [['image/png',red],['image/jpeg',jpeg]]){
  const info=await request(s,'/api/images',{method:'POST',headers:{'content-type':type},body:bytes},201);assert.equal(info.bytes,bytes.length);assert.match(info.id,/^[0-9a-f-]{36}$/);
  assert.deepEqual(await readFile(path.join(s.root,path.basename(info.url))),bytes);
  const response=await fetch(s.url+info.url);assert.equal(response.headers.get('content-type'),type);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);saved.push([info,bytes]);
 }
 await stop(s.app);const restarted=await service({root:s.root});
 for(const [info,bytes] of saved){const r=await fetch(restarted.url+info.url);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);}
 await stop(restarted.app);
});

for(const format of ['mp4','webm','gif'])test(`real ${format} encoding preserves dimensions and all three submitted frames`,async()=>{
 const s=await service();const health=await request(s,'/api/health');assert.equal(health.ffmpeg,true);const {id}=await create(s,{format});
 for(const [i,bytes] of [red,blue,red].entries())assert.equal((await frame(s,id,i,bytes)).frames,i+1);
 const result=await request(s,`/api/exports/${id}/finish`,{method:'POST'});assert.equal(result.frames,3);assert.ok(result.bytes>0);
 const file=path.join(s.root,`${id}.${format}`);assert.equal((await stat(file)).size,result.bytes);
 const {stdout}=await exec('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json',file]);
 const video=JSON.parse(stdout).streams[0];assert.equal(video.width,64);assert.equal(video.height,48);assert.equal(Number(video.nb_read_frames),3);evidence.push({format,...video,bytes:result.bytes});
 // Decode again: distinct input frames must remain distinct after lossy encoding/palette conversion.
 const decoded=await exec('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:1024**2});
 const stride=64*48*3;assert.equal(decoded.stdout.length,3*stride);assert.notDeepEqual(decoded.stdout.subarray(0,stride),decoded.stdout.subarray(stride,2*stride));
 const bytes=await readFile(file);const download=await fetch(s.url+result.url);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 await stop(s.app);const restarted=await service({root:s.root});assert.equal((await fetch(restarted.url+result.url)).status,200);await stop(restarted.app);
});

test('manual partial finish seals the real accepted prefix while preserving its planned maximum',async()=>{
 const s=await service(),{id}=await create(s,{frames:5});await frame(s,id,0,red);await frame(s,id,1,blue);
 const result=await finish(s,id,2),state=await request(s,`/api/exports/${id}`);assert.equal(result.frames,2);
 assert.deepEqual(state,{id,status:'complete',frames:2,expected:5,locked:false,finalFrames:2,url:result.url,bytes:result.bytes});
 const file=path.join(s.root,`${id}.mp4`),{stdout}=await exec('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json',file]);
 const video=JSON.parse(stdout).streams[0];assert.equal(Number(video.nb_read_frames),2);assert.equal(video.width,64);assert.equal(video.height,48);evidence.push({partial:true,plannedFrames:5,finalFrames:2,...video});
 assert.deepEqual(await finish(s,id,2),result);await finish(s,id,3,409);await request(s,`/api/exports/${id}/finish`,{method:'POST'},409);
 await frame(s,id,2,red,409);assert.deepEqual(await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'}),{cancelled:false,complete:true});
 assert.equal((await stat(file)).size,result.bytes);await stop(s.app);
});

test('invalid partial finish parameters and prefix mismatches never seal or consume input',async()=>{
 const s=await service(),{id}=await create(s);
 for(const finalFrames of [0,-1,1.5,4,'1',null])await finish(s,id,finalFrames,400);
 for(const body of ['{','null','[]','{"other":1}'])await request(s,`/api/exports/${id}/finish`,{method:'POST',headers:{'content-type':'application/json'},body},400);
 await request(s,`/api/exports/${id}/finish`,{method:'POST',headers:{'content-type':'text/plain'},body:'{"finalFrames":1}'},415);
 await finish(s,id,1,409);await frame(s,id,0);await finish(s,id,2,409);await frame(s,id,1,blue);await finish(s,id,1,409);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'encoding');assert.equal(state.expected,3);assert.equal(state.frames,2);assert.equal(state.locked,false);assert.equal(state.finalFrames,undefined);
 assert.equal((await finish(s,id,2)).frames,2);await stop(s.app);
});

test('finish refuses an active upload and rechecks accepted frames after its own JSON body arrives',async()=>{
 const s=await service(),{id}=await create(s),upload=pendingRequest(s,`/api/exports/${id}/frames?index=0`,{'content-type':'image/png','content-length':red.length});
 upload.req.write(red.subarray(0,20));await until(async()=>!!(await request(s,`/api/exports/${id}`)).locked);
 await finish(s,id,1,409);assert.equal((await request(s,`/api/exports/${id}`)).finalFrames,undefined);
 upload.req.end(red.subarray(20));assert.deepEqual(await upload.response,{status:200,body:{frames:1}});
 const sealing=pendingRequest(s,`/api/exports/${id}/finish`,{'content-type':'application/json'});sealing.req.write('{"finalFrames":1');
 await frame(s,id,1,blue);sealing.req.end('}');assert.equal((await sealing.response).status,409);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.frames,2);assert.equal(state.expected,3);assert.equal(state.finalFrames,undefined);assert.equal(state.locked,false);
 await finish(s,id,2);await stop(s.app);
});

test('conditional dialog cleanup preserves a completed video while explicit default DELETE still removes it',async()=>{
 const s=await service(),{id}=await create(s,{frames:1});await frame(s,id,0);
 const result=await request(s,`/api/exports/${id}/finish`,{method:'POST'}),file=path.join(s.root,`${id}.mp4`),saved=await readFile(file);
 const conditional=await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'});
 assert.deepEqual(conditional,{cancelled:false,complete:true});
 assert.equal((await request(s,`/api/exports/${id}`)).status,'complete');
 assert.deepEqual(await readFile(file),saved);assert.deepEqual(Buffer.from(await(await fetch(s.url+result.url)).arrayBuffer()),saved);
 // Retry remains safe after the client lost its previous finish/cleanup response.
 assert.deepEqual(await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'}),conditional);
 await request(s,`/api/exports/${id}`,{method:'DELETE'});assert.deepEqual(await readdir(s.root),[]);
 await request(s,`/api/exports/${id}`,{},404);await request(s,result.url,{},404);
 // The additive condition still performs real cancellation of an unfinished encoder.
 const active=await create(s,{frames:1});await request(s,`/api/exports/${active.id}?onlyUnfinished=true`,{method:'DELETE'});
 assert.equal(s.app.ownedProcessCount,0);assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

test('preview origin can persist images while unlisted ports and explicit origin overrides remain restricted',async()=>{
 const s=await service();
 for(const origin of ['http://127.0.0.1:5179','http://localhost:5179']){
  const image=await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png',origin},body:red},201);
  assert.deepEqual(Buffer.from(await (await fetch(s.url+image.url)).arrayBuffer()),red);
 }
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png',origin:'http://127.0.0.1:5180'},body:red},403);
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png',origin:'http://127.0.0.1:5179','sec-fetch-site':'cross-site'},body:red},403);
 const restricted=await service({allowedOrigins:[]});
 await request(restricted,'/api/images',{method:'POST',headers:{'content-type':'image/png',origin:'http://127.0.0.1:5179'},body:red},403);
 await stop(s.app);await stop(restricted.app);
});

test('rejects unsafe origins, bad hosts, MIME mismatch, corrupt images and bounded uploads',async()=>{
 const s=await service({limits:{maxImageBytes:Math.max(red.length,jpeg.length)+20}});
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png',origin:'https://example.com'},body:red},403);
 await new Promise((resolve,reject)=>{const req=http.get(s.url+'/api/health',{headers:{host:'evil.example'}},res=>{assert.equal(res.statusCode,403);res.resume();res.once('end',resolve);});req.once('error',reject);});
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/gif'},body:red},415);
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png'},body:jpeg},400);
 const corrupted=Buffer.from(red);corrupted[corrupted.length-5]^=1;await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png'},body:corrupted},400);
 await request(s,'/api/images',{method:'POST',headers:{'content-type':'image/png'},body:Buffer.alloc(Math.max(red.length,jpeg.length)+21)},413);
 await request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:'{'},400);
 assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

test('frame order/dimensions are checked without consuming a rejected frame; incomplete finish is refused',async()=>{
 const s=await service(),{id}=await create(s);
 await frame(s,id,undefined,red,409);await frame(s,id,1,red,409);await frame(s,id,0,wrongSize,400);
 await request(s,`/api/exports/${id}/finish`,{method:'POST'},409);await frame(s,id,0);await frame(s,id,0,red,409);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.frames,1);
 await request(s,`/api/exports/${id}`,{method:'DELETE'});assert.equal(s.app.ownedProcessCount,0);assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

test('missing encoder is a failed creation, with no leaked reservations or child',async()=>{
 const s=await service({ffmpegPath:'/nonexistent/mathart-test-ffmpeg',limits:{maxDiskBytes:128,maxOutputBytes:128}});
 assert.equal((await request(s,'/api/health')).ffmpeg,false);
 for(let i=0;i<2;i++)await request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:64,height:48,fps:6,frames:1,format:'mp4'})},503);
 await until(()=>s.app.ownedProcessCount===0);assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

test('active job and total pixel/input/disk budgets fail explicitly',async()=>{
 const s=await service({limits:{maxActive:1,maxInputBytes:red.length-1,maxFramePixels:64*48*3,maxDiskBytes:1024**3,maxOutputBytes:1024**3}}),{id}=await create(s);
 await request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:64,height:48,fps:6,frames:3,format:'mp4'})},409);
 await request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:64,height:48,fps:6,frames:4,format:'mp4'})},413);
 await frame(s,id,0,red,413);await until(()=>s.app.ownedProcessCount===0);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'failed');assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
 const disk=await service({limits:{maxDiskBytes:red.length-1}});await request(disk,'/api/images',{method:'POST',headers:{'content-type':'image/png'},body:red},507);assert.deepEqual(await readdir(disk.root),[]);await stop(disk.app);
});

test('disconnect during frame upload cancels its encoder and removes its partial file',async()=>{
 const s=await service(),{id}=await create(s);
 await new Promise(resolve=>{const req=http.request(s.url+`/api/exports/${id}/frames?index=0`,{method:'POST',headers:{'content-type':'image/png','content-length':red.length+100}},()=>{});req.on('error',()=>resolve());req.write(red.subarray(0,20));setTimeout(()=>req.destroy(),40);});
 await until(()=>s.app.ownedProcessCount===0);assert.deepEqual(await readdir(s.root),[]);assert.equal((await request(s,`/api/exports/${id}`)).status,'cancelled');await stop(s.app);
});

test('service shutdown signals only its own children and escalates an encoder ignoring SIGTERM',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'mathart-encoder-fixture-'));directories.push(directory);
 const fixture=path.join(directory,'encoder.mjs'),ready=path.join(directory,'ready');await writeFile(fixture,`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(ready)},'ready');process.stdin.resume();setInterval(()=>{},1000);\n`);await chmod(fixture,0o755);
 const s=await service({ffmpegPath:fixture,limits:{killGraceMs:50}});await create(s);await until(async()=>{try{await stat(ready);return true;}catch{return false;}});assert.equal(s.app.ownedProcessCount,1);
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try{await stop(s.app);assert.equal(unrelated.exitCode,null);assert.equal(unrelated.signalCode,null);assert.deepEqual(await readdir(s.root),[]);}finally{unrelated.kill();await new Promise(r=>unrelated.once('close',r));}
});

test('idle encoder is reaped and a new export can use its released slot',async()=>{
 const s=await service({limits:{idleTimeoutMs:80,maxActive:1}}),{id}=await create(s);
 await until(()=>s.app.ownedProcessCount===0);assert.equal((await request(s,`/api/exports/${id}`)).status,'failed');
 await create(s);await stop(s.app);assert.deepEqual(await readdir(s.root),[]);
});

test('real encoder output size failure never publishes a partial file',async()=>{
 const s=await service({limits:{maxOutputBytes:128}}),{id}=await create(s,{frames:1});await frame(s,id,0);
 const r=await fetch(s.url+`/api/exports/${id}/finish`,{method:'POST'}),body=await r.json();assert.ok([409,500,507].includes(r.status),JSON.stringify(body));assert.ok(body.error);
 await until(()=>s.app.ownedProcessCount===0);assert.deepEqual(await readdir(s.root),[]);await request(s,`/api/exports/${id}/file`,{},409);await stop(s.app);
});

async function hangingEncoder(){
 const directory=await mkdtemp(path.join(tmpdir(),'mathart-hanging-encoder-'));directories.push(directory);
 const fixture=path.join(directory,'encoder.mjs'),ready=path.join(directory,'ready');
 await writeFile(fixture,`#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(ready)},'ready');process.stdin.resume();setInterval(()=>{},1000);\n`);await chmod(fixture,0o755);
 return {fixture,ready,async wait(){await until(async()=>{try{await stat(ready);return true;}catch{return false;}});}};
}

async function gatedEncoder(frames=2){
 // Deterministic protocol fixture, not media evidence. Real partial MP4 frame
 // counts are tested above with installed FFmpeg/ffprobe.
 const directory=await mkdtemp(path.join(tmpdir(),'mathart-gated-encoder-'));directories.push(directory);
 const fixture=path.join(directory,'encoder.mjs'),ended=path.join(directory,'ended'),release=path.join(directory,'release');
 await writeFile(fixture,`#!/usr/bin/env node\nimport {writeFileSync,writeSync,existsSync} from 'node:fs';process.stdin.resume();process.stdin.once('end',()=>{writeFileSync(${JSON.stringify(ended)},'ended');const timer=setInterval(()=>{if(!existsSync(${JSON.stringify(release)}))return;clearInterval(timer);writeFileSync(process.argv.at(-1),Buffer.alloc(32,7));writeSync(3,'frame=${frames}\\n');},10);});\n`);await chmod(fixture,0o755);
 return{fixture,async sealed(){await until(async()=>{try{await stat(ended);return true;}catch{return false;}});},async release(){await writeFile(release,'release');}};
}

test('same-seal finishes share finalization and conflicting seals or uploads cannot change it',async()=>{
 const encoder=await gatedEncoder(),s=await service({ffmpegPath:encoder.fixture}),{id}=await create(s,{frames:5});await frame(s,id,0);await frame(s,id,1);
 const first=finish(s,id,2);await encoder.sealed();const second=finish(s,id,2);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'finishing');assert.equal(state.finalFrames,2);assert.equal(state.expected,5);assert.equal(state.locked,false);
 await finish(s,id,3,409);await frame(s,id,2,red,409);assert.equal(s.app.ownedProcessCount,1);
 await encoder.release();const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(a.frames,2);assert.equal(s.app.ownedProcessCount,0);
 assert.deepEqual(await finish(s,id,2),a);await stop(s.app);
});

test('sealed finish survives response disconnect and exposes a queryable, retryable result',async()=>{
 const encoder=await gatedEncoder(),s=await service({ffmpegPath:encoder.fixture}),{id}=await create(s,{frames:5});await frame(s,id,0);await frame(s,id,1);
 const first=pendingRequest(s,`/api/exports/${id}/finish`,{'content-type':'application/json'}),lost=first.response.catch(error=>error);first.req.end('{"finalFrames":2}');await encoder.sealed();first.req.destroy();await lost;
 const pending=await request(s,`/api/exports/${id}`);assert.equal(pending.status,'finishing');assert.equal(pending.finalFrames,2);assert.equal(s.app.ownedProcessCount,1);
 const retry=finish(s,id,2);await encoder.release();const result=await retry,state=await request(s,`/api/exports/${id}`);
 assert.equal(state.status,'complete');assert.equal(state.url,result.url);assert.equal(state.frames,2);assert.equal(state.expected,5);assert.deepEqual(await finish(s,id,2),result);await stop(s.app);
});

test('explicit cancellation before JSON seal or after seal prevents later publication',async()=>{
 const s=await service(),{id}=await create(s);await frame(s,id,0);
 const unfinished=pendingRequest(s,`/api/exports/${id}/finish`,{'content-type':'application/json'});unfinished.req.write('{"finalFrames":1');
 await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'});unfinished.req.end('}');assert.equal((await unfinished.response).status,409);
 assert.deepEqual(await readdir(s.root),[]);await request(s,`/api/exports/${id}`,{},404);await stop(s.app);
 const encoder=await gatedEncoder(),sealed=await service({ffmpegPath:encoder.fixture}),active=await create(sealed,{frames:5});await frame(sealed,active.id,0);await frame(sealed,active.id,1);
 const pending=fetch(sealed.url+`/api/exports/${active.id}/finish`,{method:'POST',headers:{'content-type':'application/json'},body:'{"finalFrames":2}'});await encoder.sealed();
 assert.deepEqual(await request(sealed,`/api/exports/${active.id}?onlyUnfinished=true`,{method:'DELETE'}),{cancelled:true});
 const failure=await pending;assert.ok([499,500].includes(failure.status));await failure.arrayBuffer();assert.deepEqual(await readdir(sealed.root),[]);assert.equal(sealed.app.ownedProcessCount,0);await stop(sealed.app);
});

test('cancel racing final commit either removes the unfinished output or preserves the completed file',async()=>{
 const encoder=await gatedEncoder(),s=await service({ffmpegPath:encoder.fixture}),{id}=await create(s,{frames:5});await frame(s,id,0);await frame(s,id,1);
 const pending=fetch(s.url+`/api/exports/${id}/finish`,{method:'POST',headers:{'content-type':'application/json'},body:'{"finalFrames":2}'});await encoder.sealed();
 await encoder.release();const cancellation=await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'}),response=await pending,result=await response.json();
 if(cancellation.cancelled){assert.ok([499,500].includes(response.status),JSON.stringify(result));assert.deepEqual(await readdir(s.root),[]);await request(s,`/api/exports/${id}`,{},404);}
 else{assert.deepEqual(cancellation,{cancelled:false,complete:true});assert.equal(response.status,200);assert.equal((await stat(path.join(s.root,`${id}.mp4`))).size,result.bytes);}
 assert.equal(s.app.ownedProcessCount,0);await stop(s.app);
});

test('partial finalization checks encoded frames against its seal and cleans a mismatching encoder',async()=>{
 const encoder=await gatedEncoder(5),s=await service({ffmpegPath:encoder.fixture}),{id}=await create(s,{frames:5});await frame(s,id,0);await frame(s,id,1);
 const pending=finish(s,id,2,500);await encoder.sealed();await encoder.release();assert.match((await pending).error,/5\/2/);
 const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'failed');assert.equal(state.expected,5);assert.equal(state.finalFrames,2);assert.deepEqual(await readdir(s.root),[]);await finish(s,id,2,409);await stop(s.app);
});

test('finish timeout during rename cleans the final destination and releases its disk accounting',async t=>{
 const encoder=await gatedEncoder(1),s=await service({ffmpegPath:encoder.fixture,limits:{finishTimeoutMs:1000,maxActive:1,maxOutputBytes:64,maxDiskBytes:64}}),{id}=await create(s,{frames:1});await frame(s,id,0);await encoder.release();
 const originalRename=fsPromises.rename,target=path.join(s.root,`${id}.mp4`);let entered=false,release;
 const gate=new Promise(resolve=>{release=resolve;});
 // Top-level tests in this file run serially. Patch only this session's rename
 // and always restore the builtin binding before another test can execute.
 const patched=t.mock.method(fsPromises,'rename',async(from,to)=>{if(to===target){entered=true;await gate;}return originalRename(from,to);});syncBuiltinESMExports();
 let finishing;
 try{
  finishing=finish(s,id,1,500);await until(()=>entered);
  await until(async()=>(await request(s,`/api/exports/${id}`)).status==='failed');
  release();assert.match((await finishing).error,/超时/);assert.deepEqual(await readdir(s.root),[]);assert.equal(s.app.ownedProcessCount,0);
  await request(s,`/api/exports/${id}/file`,{},409);
  // A leaked files/storedBytes entry would make this exact-capacity reservation
  // fail even if the first partial path had already been removed.
  const next=await create(s,{frames:1});await request(s,`/api/exports/${next.id}`,{method:'DELETE'});assert.deepEqual(await readdir(s.root),[]);
 }finally{release();patched.mock.restore();syncBuiltinESMExports();await finishing?.catch(()=>{});await stop(s.app);}
});

test('a late finish timeout cannot revoke a completed result, while explicit DELETE still can',async t=>{
 const originalSetTimeout=globalThis.setTimeout;let lateTimeout;
 const patched=t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay===3001)lateTimeout=()=>callback(...args);return originalSetTimeout(callback,delay,...args);});
 let s;
 try{
  s=await service({limits:{finishTimeoutMs:3001}});const {id}=await create(s,{frames:1});await frame(s,id,0);
  const result=await finish(s,id,1),file=path.join(s.root,`${id}.mp4`),bytes=await readFile(file);assert.equal(typeof lateTimeout,'function');lateTimeout();
  const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'complete');assert.equal(state.url,result.url);assert.deepEqual(await readFile(file),bytes);assert.deepEqual(await finish(s,id,1),result);
  assert.deepEqual(await request(s,`/api/exports/${id}?onlyUnfinished=true`,{method:'DELETE'}),{cancelled:false,complete:true});
  await request(s,`/api/exports/${id}`,{method:'DELETE'});assert.deepEqual(await readdir(s.root),[]);await request(s,`/api/exports/${id}`,{},404);
 }finally{patched.mock.restore();if(s)await stop(s.app);}
});

test('finish deadline fails explicitly and kills an encoder that never exits',async()=>{
 const hanging=await hangingEncoder(),s=await service({ffmpegPath:hanging.fixture,limits:{finishTimeoutMs:60,killGraceMs:30}}),{id}=await create(s,{frames:1});await hanging.wait();await frame(s,id,0);
 const failure=await request(s,`/api/exports/${id}/finish`,{method:'POST'},500);assert.match(failure.error,/超时/);assert.equal(s.app.ownedProcessCount,0);assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

test('disconnected sealed finish still observes its service-owned deadline and releases the encoder',async()=>{
 const hanging=await hangingEncoder(),s=await service({ffmpegPath:hanging.fixture,limits:{finishTimeoutMs:150,killGraceMs:30}}),{id}=await create(s,{frames:1});await hanging.wait();await frame(s,id,0);
 const first=pendingRequest(s,`/api/exports/${id}/finish`),lost=first.response.catch(error=>error);first.req.end();await until(async()=>(await request(s,`/api/exports/${id}`)).status==='finishing');first.req.destroy();await lost;
 await until(()=>s.app.ownedProcessCount===0);assert.deepEqual(await readdir(s.root),[]);const state=await request(s,`/api/exports/${id}`);assert.equal(state.status,'failed');assert.match(state.error,/超时/);await stop(s.app);
});

test('slow frame upload times out, returns an error and releases the encoder',async()=>{
 const s=await service({limits:{bodyTimeoutMs:80,killGraceMs:30}}),{id}=await create(s);
 await new Promise((resolve,reject)=>{const req=http.request(s.url+`/api/exports/${id}/frames?index=0`,{method:'POST',headers:{'content-type':'image/png','content-length':red.length+100}},res=>{assert.equal(res.statusCode,408);res.resume();res.on('end',resolve);});req.on('error',reject);req.write(red.subarray(0,20));});
 await until(()=>s.app.ownedProcessCount===0);assert.deepEqual(await readdir(s.root),[]);await stop(s.app);
});

for(const format of ['mp4','webm','gif'])test(`scaled ${format} accepts only declared input dimensions and emits requested output`,async()=>{
 const s=await service(),large=await fixture('blue','png','192x144'),{id}=await create(s,{format,inputWidth:192,inputHeight:144});
 await frame(s,id,0,red,400);for(let i=0;i<3;i++)await frame(s,id,i,large);
 await request(s,`/api/exports/${id}/finish`,{method:'POST'});const file=path.join(s.root,`${id}.${format}`),{stdout}=await exec('ffprobe',['-v','error','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',file]);
 const v=JSON.parse(stdout).streams[0];assert.equal(v.width,64);assert.equal(v.height,48);assert.equal(Number(v.nb_read_frames),3);evidence.push({scaled:format,...v});await stop(s.app);
});

test('scaled input budgets, paired dimensions and encoder profile are validated before spawning',async()=>{
 const s=await service({limits:{maxPixels:192*144,maxFramePixels:192*144*3}});
 for(const [params,status] of [[{inputWidth:192},400],[{inputWidth:192,inputHeight:null},400],[{inputWidth:192,inputHeight:145},413],[{inputWidth:192,inputHeight:144,frames:4},413],[{profile:'mathart',format:'gif'},400],[{profile:'unknown'},400],[{quality:'high'},400],[{profile:'mathart',quality:'unknown'},400]]){
  await request(s,'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:64,height:48,fps:6,frames:3,format:'mp4',...params})},status);
  assert.equal(s.app.ownedProcessCount,0);
 }
 await stop(s.app);
});

for(const [quality,preset,crf,tune] of [['low','veryfast','28'],['medium','medium','23'],['high','slow','18','animation'],['production','veryslow','10','animation']])test(`MathArt ${quality} profile matches independently encoded raw RGBA at decoded-frame boundary`,async()=>{
 // Independent original argv, transcribed from VideoRecorder.buildFfmpegCommand.
 // PNG transport must preserve actual source bytes, including alpha; comparison
 // uses the same installed FFmpeg, not a claim about the original bundled runtime.
 const s=await service(),png=(await exec('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=s=192x144:r=6','-frames:v','1','-vf','format=rgba','-f','image2pipe','-c:v','png','pipe:1'],{encoding:'buffer',maxBuffer:2*1024**2})).stdout;
 const input=path.join(s.root,'reference-input.png');await writeFile(input,png);
 const rgba=(await exec('ffmpeg',['-v','error','-i',input,'-f','rawvideo','-pix_fmt','rgba','pipe:1'],{encoding:'buffer',maxBuffer:2*1024**2})).stdout;
 const reference=path.join(s.root,'reference.mp4');
 const args=['-v','error','-y','-f','rawvideo','-vcodec','rawvideo','-s','192x144','-r','6','-pix_fmt','rgba','-i','-','-c:v','libx264','-pix_fmt','yuv444p','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','iec61966-2-1',...(tune?['-tune',tune]:[]),'-crf',crf,'-preset',preset,'-movflags','+faststart+write_colr','-vf','scale=64:48:flags=lanczos','-threads','2',reference];
 await new Promise((resolve,reject)=>{const child=spawn('ffmpeg',args,{stdio:['pipe','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(error)));child.stdin.end(Buffer.concat([rgba,rgba,rgba]));});
 const {id}=await create(s,{profile:'mathart',quality,inputWidth:192,inputHeight:144});for(let i=0;i<3;i++)await frame(s,id,i,png);await request(s,`/api/exports/${id}/finish`,{method:'POST'});
 const actual=path.join(s.root,`${id}.mp4`),probe=async file=>JSON.parse((await exec('ffprobe',['-v','error','-count_frames','-show_entries','stream=width,height,nb_read_frames,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',file])).stdout).streams[0],a=await probe(actual),r=await probe(reference);assert.deepEqual(a,r);
 const decode=async file=>(await exec('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:2*1024**2})).stdout;assert.deepEqual(await decode(actual),await decode(reference));evidence.push({quality,decodedRawReferenceEqual:true,...a});await stop(s.app);
});
