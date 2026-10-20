/** Real App + Worker + local service + ffprobe evidence for current-document,
 * fresh-canvas Perlin queue replay. No retained MathArt recording/native parity.
 * Usage: node scripts/verify-source-perlin-recording-public.mjs [report directory]
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const check=(value,message)=>{if(!value)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
 let width=0,height=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  check(at+12<=bytes.length,'truncated PNG chunk');const length=bytes.readUInt32BE(at),end=at+length+12;
  check(end<=bytes.length,'truncated PNG payload');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  check(((crc^-1)>>>0)===bytes.readUInt32BE(end-4),'PNG CRC mismatch');
  if(type==='IHDR'){check(length===13&&!width,'invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data.subarray(8).equals(Buffer.from([8,6,0,0,0])),'expected non-interlaced RGBA8 PNG');}
  else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){check(length===0&&end===bytes.length,'invalid PNG end');ended=true;}
  at=end;
 }
 check(width>0&&height>0&&ended&&compressed.length,'incomplete PNG');const stride=width*4,raw=inflateSync(Buffer.concat(compressed));check(raw.length===(stride+1)*height,'invalid PNG row length');const rgba=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG row filter');for(let x=0;x<stride;x++){const a=x>=4?rgba[y*stride+x-4]:0,b=y?rgba[(y-1)*stride+x]:0,c=y&&x>=4?rgba[(y-1)*stride+x-4]:0;rgba[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,rgba};
}

const directory=process.argv[2]??`.cache/perlin-recording-public-${Date.now()}`;
await mkdir(directory,{recursive:true});
const artifact=name=>directory+'/'+name,started=performance.now();
const report={at:new Date().toISOString(),status:'running',directory,nativeParity:false,
 scope:'Public App current-document fresh-canvas source-queue replay; real Worker planning/rendering, service uploads, downloaded MP4 and ffprobe. Whole RGBA uploads are compared to Worker pixels before transfer. This is local integration evidence, not original retained recording.',
 limits:['No native JVM/JOGL comparison.','No claim about last-applied original JSON or export framebuffer reuse.','Small density1 cases only; no long-run or capacity benchmark.','Elapsed wall time only; CPU time, peak process-family/GPU memory and token cost unmeasured.'],cases:[]};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),...(await files('server')),'scripts/verify-source-perlin-recording-public.mjs'].sort().map(async path=>[path,sha(await readFile(path))])));
report.sourceBefore=await hashes();await writeFile(artifact('verifier.mjs'),await readFile('scripts/verify-source-perlin-recording-public.mjs'));
let browser,server,exportServer,page;
function installAudit(){
 const Native=window.Worker,a=window.__recordingAudit={sequence:0,workers:0,terminated:[],requests:[],completed:[],errors:[],http:[],pixels:new Map()};
 window.Worker=class extends Native{
  sent=new Map();ended=false;
  constructor(...args){super(...args);this.worker=++a.workers;this.addEventListener('message',({data})=>{
   const sent=this.sent.get(data.id);if(!sent||data.operation!==sent.request.operation)return;
   if(data.error){a.errors.push({...sent,error:data.error});this.sent.delete(data.id);return;}
   if(data.output){const{pixels,...output}=data.output;if(pixels)a.pixels.set(sent.sequence,pixels.slice());a.completed.push({...sent,output});this.sent.delete(data.id);}
   else if(data.operation==='perlin-recording-plan'&&data.result){a.completed.push({...sent,result:structuredClone(data.result)});this.sent.delete(data.id);}
  });}
  postMessage(message,...args){if(['generate','perlin-recording-plan'].includes(message.operation)){const sent={worker:this.worker,sequence:++a.sequence,request:structuredClone(message)};a.requests.push(sent);this.sent.set(message.id,sent);}return super.postMessage(message,...args);}
  terminate(){if(!this.ended){a.terminated.push(this.worker);this.ended=true;}return super.terminate();}
 };
 const nativeFetch=window.fetch;
 window.fetch=function(input,init){const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/exports'))a.http.push({path:url.pathname,query:url.search,method:init?.method??'GET',completed:a.completed.map(r=>r.sequence)});return nativeFetch.call(this,input,init);};
}
async function audit(){return page.evaluate(async()=>{const a=window.__recordingAudit;return{requests:a.requests,completed:await Promise.all(a.completed.map(async row=>({...row,...(a.pixels.has(row.sequence)?{rgbaSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.pixels.get(row.sequence)))).map(v=>v.toString(16).padStart(2,'0')).join('')}:{} )}))),errors:a.errors,http:a.http,workers:a.workers,terminated:a.terminated};});}
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const wait=(duration)=>({type:'wait',duration,easing:'LINEAR'});
// Binary-exact 1/4 and 1/8 update steps make the expected boundary counts
// independent literals, not another invocation of the product plan helper.
const cases=[
 {name:'cpu-exact-boundary',backend:'CPU',timeline:[wait(.5)],simulationFps:4,encoderFps:7,updates:2},
 {name:'cpu-above-boundary',backend:'CPU',timeline:[wait(.5001)],simulationFps:4,encoderFps:7,updates:3},
 {name:'cpu-multiple-frames',backend:'CPU',timeline:[wait(1)],simulationFps:8,encoderFps:6,updates:8,evolves:true},
 {name:'gpu-multiple-frames',backend:'GPU',timeline:[wait(1)],simulationFps:8,encoderFps:5,updates:8,evolves:true},
 {name:'gpu-short-children',backend:'GPU',timeline:[wait(.01),wait(.01),wait(.01)],simulationFps:4,encoderFps:7,updates:3},
 {name:'cpu-empty-queue',backend:'CPU',timeline:[],simulationFps:4,encoderFps:6,updates:1},
 {name:'gpu-zero-wait',backend:'GPU',timeline:[wait(0)],simulationFps:4,encoderFps:6,updates:1},
 {name:'cpu-cancel-retry',backend:'CPU',timeline:[wait(1)],simulationFps:8,encoderFps:6,updates:8,cancel:true,evolves:true},
];
async function openVideo(c){
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('button',{name:'Animation video',exact:true}).click();
 const mode=page.getByRole('combobox',{name:'Perlin video mode',exact:true});check(await mode.inputValue()==='duration','duration mode no longer default');
 check(await mode.locator('option[value=source]').textContent()==='Replay until source queue ends','source mode label changed');await mode.selectOption('source');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('192');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('128');
 await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill(String(c.encoderFps));
 await page.getByRole('spinbutton',{name:'Recording simulation FPS',exact:true}).fill(String(c.simulationFps));
 check(await page.getByRole('spinbutton',{name:'Export duration',exact:true}).count()===0,'duration control remains active in source mode');
}
function verifyFrames(c,a,after,row,uploads){
 const plans=a.completed.filter(r=>r.sequence>after&&r.request.operation==='perlin-recording-plan');check(plans.length===1,'expected exactly one real Worker plan');
 const plan=plans[0],p=plan.result;row.plan=p;
 check(p.policy==='fresh-local-source-queue-replay'&&p.updates===c.updates&&p.encodedFrames===c.updates-1&&p.warmupUpdates===1&&p.simulationFps===c.simulationFps&&p.encoderFps===c.encoderFps,'plan differs from independently specified boundary count');
 const frames=a.completed.filter(r=>r.sequence>after&&r.worker===plan.worker&&r.request.operation==='generate');
 check(frames.length===c.updates,'rendered update count differs from plan');
 check(a.requests.filter(r=>r.sequence>after&&r.request.operation==='generate').every(r=>r.worker===plan.worker),'export mixed Worker owners');
 check(plan.worker!==row.previewWorker,'export reused the retained preview Worker');
 check(a.terminated.includes(plan.worker),'completed export Worker was not terminated');check(!a.terminated.includes(row.previewWorker),'export terminated the preview Worker');
 if(row.cancelledAttempt)check(plan.worker!==row.cancelledAttempt.recordingWorker,'retry reused cancelled Worker');
 row.frames=frames.map((r,i)=>{
  const f=r.output.sourcePerlinFrame;
  check(r.request.context.time===i/c.simulationFps,'warmup/encoded request time mismatch '+i);
  check(f?.frameIndex===i&&f.queueComplete===(i===c.updates-1),'actual frame completion mismatch '+i);
  check(Number.isFinite(f.sceneTime)&&Number.isInteger(f.queueIndex)&&f.updates===(c.timeline.length?i+1:0),'actual queue facts absent '+i);
  check(f.samples===0&&f.sourceViewport.pixelDensity===1,'export lost noSmooth/source density');
  if(i===c.updates-1)check(f.queueIndex===c.timeline.length,'terminal queue index differs from authored children');
  check(r.output.width===192&&r.output.height===128&&r.output.type==='raster','unexpected raster dimensions');
  check(r.output.backend===(c.backend==='GPU'?'webgl2':'cpu'),'actual render backend mismatch');
  check(JSON.stringify(f.sourceViewport)===JSON.stringify(row.sourceViewport),'source viewport was invented from export dimensions');
  check(r.request.scene.timeline.fps===c.simulationFps,'export scene lost simulation FPS');
  return{index:i,encodedIndex:i?i-1:null,worker:r.worker,sequence:r.sequence,time:r.request.context.time,sourceFrame:f,rgbaSha256:r.rgbaSha256};
 });
 check(uploads.length===c.updates-1,'warmup uploaded or encoded upload missing');
 for(let i=0;i<uploads.length;i++){check(uploads[i].index===i,'upload order mismatch');const png=decodePng(uploads[i].bytes);check(png.width===192&&png.height===128,'upload dimensions');check(sha(png.rgba)===frames[i+1].rgbaSha256,'entire uploaded RGBA differs from Worker '+i);uploads[i].rgbaSha256=sha(png.rgba);}
 const creates=a.http.filter(r=>r.method==='POST'&&r.path==='/api/exports');
 if(c.updates===1)check(creates.length===0,'empty recording created a server video');
 else{check(creates.length===1,'wrong video session count');check(creates[0].completed.includes(frames[0].sequence),'server session created before real warmup completed');}
 if(c.evolves)check(new Set(frames.slice(1).map(r=>r.rgbaSha256)).size>1,'multiframe recording is static');
 check(a.errors.length===0,'unexpected Worker error');return frames;
}
async function verifyDownload(c,download,row,uploads){
 const path=artifact(c.name+'.mp4');await download.saveAs(path);const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration','-of','json',path],{encoding:'utf8'})).streams[0];
 check(metadata.width===192&&metadata.height===128&&Number(metadata.nb_read_frames)===c.updates-1&&metadata.r_frame_rate===c.encoderFps+'/1','ffprobe size/count/rate mismatch');
 const rgb=execFileSync('ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:16*1024*1024}),stride=192*128*3;
 check(rgb.length===(c.updates-1)*stride,'decoded MP4 frame length mismatch');const lossyErrors=[];
 for(let i=0;i<uploads.length;i++){const png=decodePng(uploads[i].bytes);let total=0,max=0;for(let j=0;j<stride;j++){const d=Math.abs(rgb[i*stride+j]-png.rgba[Math.floor(j/3)*4+j%3]);total+=d;max=Math.max(max,d);}lossyErrors.push({index:i,meanAbsoluteRgbError:total/stride,maxAbsoluteRgbError:max});check(total/stride<8,'encoded RGB differs beyond local H264 tolerance');}
 row.video={path,sha256:sha(await readFile(path)),metadata,lossyErrors,tolerance:'mean RGB absolute error <8 per frame, H264 chroma/loss allowance; full PNG RGBA equality is exact'};
}
async function runCase(c,original,origin){
 const row={name:c.name,backend:c.backend,status:'running',expectedUpdates:c.updates,expectedEncodedFrames:c.updates-1,expectedModelUpdates:c.timeline.length?c.updates:0,timeline:c.timeline,simulationFps:c.simulationFps,encoderFps:c.encoderFps},start=performance.now();report.cases.push(row);
 const uploads=[],http=[],pageErrors=[],consoleErrors=[],downloads=[];let release;
 try{
  page=await browser.newPage({viewport:{width:1280,height:850},deviceScaleFactor:1,acceptDownloads:true});page.setDefaultTimeout(20000);
  page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('download',d=>downloads.push(d));
  page.on('request',r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/api/exports'))return;http.push({method:r.method(),path:u.pathname,query:u.search,...(u.pathname==='/api/exports'&&r.method()==='POST'?{body:r.postDataJSON()}:{} )});if(r.method()==='POST'&&/\/frames$/.test(u.pathname))uploads.push({index:Number(u.searchParams.get('index')),bytes:r.postDataBuffer()});});
  await page.addInitScript(installAudit);await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});await page.goto(origin);await ready();
  const source=structuredClone(original);source.name=c.name;Object.assign(source.settings,{render_mode:c.backend,particle_count:32,step_size:2,dot_size:10,line_weight:3});source.timeline=c.timeline;row.derivedSettings={render_mode:c.backend,particle_count:32,step_size:2,dot_size:10,line_weight:3};await writeFile(artifact(c.name+'-input.json'),JSON.stringify(source,null,2)+'\n');
  await page.locator('input[type=file]').setInputFiles({name:c.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  await page.waitForFunction(name=>window.__recordingAudit.completed.some(r=>r.request.scene?.name===name),c.name);await ready();
  const preview=(await audit()).completed.findLast(r=>r.request.scene?.name===c.name);row.previewWorker=preview.worker;row.sourceViewport=preview.output.sourcePerlinFrame.sourceViewport;
  await openVideo(c);
  if(c.cancel){
   let heldResolve;const held=new Promise(resolve=>heldResolve=resolve),gate=new Promise(resolve=>release=resolve);let captured=false;
   await page.route('**/api/exports/*/frames?index=0',async route=>{if(!captured){captured=true;heldResolve();await gate;}await route.continue();});
   await page.getByRole('button',{name:'Start export',exact:true}).click();await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel upload gate timeout')),20000))]);
   await page.getByRole('button',{name:'Cancel export',exact:true}).click();release();
   await page.getByRole('button',{name:'Start export',exact:true}).waitFor();await page.waitForFunction(()=>window.__recordingAudit.http.some(r=>r.method==='DELETE'));
   const deletion=http.find(r=>r.method==='DELETE');check(deletion,'cancellation did not DELETE its service session');
   const response=await page.request.get(origin.replace(/\/$/,'')+deletion.path);check(response.status()===404,'cancelled service session still retained');
   check(downloads.length===0&&!http.some(r=>/\/finish$/.test(r.path)),'cancelled export downloaded/finished');
   const cancelledAudit=await audit(),cancelledWorker=cancelledAudit.completed.findLast(r=>r.request.operation==='perlin-recording-plan')?.worker;check(cancelledWorker&&cancelledAudit.terminated.includes(cancelledWorker),'cancelled recording Worker was not terminated');check(!cancelledAudit.terminated.includes(row.previewWorker),'cancel terminated preview Worker');
   row.cancelledAttempt={recordingWorker:cancelledWorker,uploads:uploads.map(u=>({index:u.index,pngSha256:sha(u.bytes)})),http:[...http],worker:cancelledAudit,sessionRemoved:true,downloads:0,note:'Only the first actual upload request was delayed; genuine body/service/Worker unchanged. Released immediately after public Cancel.'};
   await page.unroute('**/api/exports/*/frames?index=0');uploads.length=0;http.length=0;
   await page.evaluate(()=>{window.__recordingAudit.http=[];window.__recordingAudit.errors=[];});
  }
  const after=await page.evaluate(()=>window.__recordingAudit.sequence),downloadPromise=c.updates>1?page.waitForEvent('download',{timeout:90000}):null;downloadPromise?.catch(()=>{});await page.getByRole('button',{name:'Start export',exact:true}).click();
  if(c.updates===1){await page.locator('.export-error').filter({hasText:'The Perlin queue ended during warmup with no frames to encode; extend the queue.'}).waitFor();await page.getByRole('button',{name:'Start export',exact:true}).waitFor();check(downloads.length===0,'zero-frame recording downloaded a file');row.userError=await page.locator('.export-error').allTextContents();}
  else{await downloadPromise.then(d=>verifyDownload(c,d,row,uploads));}
  await page.getByRole('button',{name:'Start export',exact:true}).waitFor();await page.waitForFunction(()=>{const a=window.__recordingAudit,plan=a.completed.findLast(r=>r.request.operation==='perlin-recording-plan');return plan&&a.terminated.includes(plan.worker);});
  const a=await audit();verifyFrames(c,a,after,row,uploads);row.workerAudit=a;row.http=http;row.uploads=uploads.map(u=>({index:u.index,bytes:u.bytes.length,pngSha256:sha(u.bytes),rgbaSha256:u.rgbaSha256}));
  const creates=http.filter(r=>r.method==='POST'&&r.path==='/api/exports');if(c.updates>1)check(creates[0]?.body.frames===c.updates-1&&creates[0]?.body.fps===c.encoderFps,'service creation lost count/rate');else check(!creates.length,'zero frames reached service');
  check(pageErrors.length===0,'browser page error');check(consoleErrors.length===0,'browser console error');await page.screenshot({path:artifact(c.name+'.png')});row.status='passed';
 }catch(error){row.status='failed';row.error=String(error);row.stack=error.stack;row.http=http;row.workerAudit=await audit().catch(()=>null);row.body=await page?.locator('body').innerText().catch(()=>null);await page?.screenshot({path:artifact(c.name+'-failed.png')}).catch(()=>{});}
 finally{release?.();row.pageErrors=pageErrors;row.consoleErrors=consoleErrors;row.elapsedMs=performance.now()-start;try{await page?.close();row.pageClosed=true;}catch(error){row.status='failed';row.cleanupError=String(error);}page=undefined;await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${row.name}: ${row.status}${row.error?' '+row.error:''}`);}
}
try{
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',jarBytes=await readFile(jar);check(sha(jarBytes)==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','fixed artifact changed');const member=execFileSync('python3',['-c',"import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('data/Noise/noise.json'))",jar]);report.source={jarSha256:sha(jarBytes),member:'data/Noise/noise.json',memberSha256:sha(member)};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});}),origin=`http://127.0.0.1:${port}/`;
 exportServer=await createExportServer({root:artifact('service'),allowedOrigins:[origin.slice(0,-1)]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const c of cases)await runCase(c,JSON.parse(member),origin);
 report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=closed.map((r,i)=>({resource:['browser','vite','export-server'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(closed.some(r=>r.status==='rejected')||!report.sourceStable)report.status='failed';if(report.status!=='passed')process.exitCode=1;
 await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');
 const lines=['# Perlin queue replay public verification','',`Status: **${report.status}**; source stable: **${report.sourceStable}**; elapsed: ${(report.elapsedMs/1000).toFixed(1)} s.`,'',report.scope,'','| Case | Result | Updates / encoded | Video |','| --- | --- | --- | --- |',...report.cases.map(c=>`| ${c.name} | ${c.status}${c.error?' — '+c.error:''} | ${c.plan?.updates??'?'} / ${c.plan?.encodedFrames??'?'} | ${c.video?.path??'none'} |`),'','Plan updates count driver displays; sourcePerlinFrame.updates counts model updates. Empty queues display warmup once with zero model updates and zero uploads. Exact PNG RGBA comparison covers every uploaded frame. ffprobe checks encoded frame count, dimensions and encoder FPS. Cancellation holds only the first upload, then checks public cancellation, server removal and successful retry.','',...report.limits.map(s=>'- '+s),'',`Complete evidence: ${artifact('report.json')}`,''];await writeFile(artifact('report.md'),lines.join('\n'));console.log(JSON.stringify({status:report.status,sourceStable:report.sourceStable,passed:report.cases.filter(c=>c.status==='passed').length,total:report.cases.length,report:artifact('report.md')}));
}
