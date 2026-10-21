/** Real App + Worker + local service + ffprobe evidence for current-document,
 * source-queue Fractal queue replay. No retained MathArt recording/native parity.
 * Usage: node scripts/verify-source-fractal-recording-public.mjs [report directory]
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

const directory=process.argv[2]??`.cache/fractal-recording-public-${Date.now()}`;
await mkdir(directory,{recursive:true});
const artifact=name=>directory+'/'+name,started=performance.now();
const report={at:new Date().toISOString(),status:'running',directory,nativeParity:false,
 scope:'Public App current-document fresh-canvas source-queue replay; real Worker planning/rendering, service uploads, downloaded MP4 and ffprobe. Whole RGBA uploads are compared to Worker pixels before transfer. This is local integration evidence, not original retained recording.',
 limits:['No native window/JOGL/encoder comparison.','Fresh current configuration; no original last-applied UI snapshot claim.','Small density1 and density2 cases; no long-run or capacity benchmark.','Elapsed wall time only; CPU time, peak process-family/GPU memory and token cost unmeasured.'],cases:[]};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),...(await files('server')),'scripts/verify-source-fractal-recording-public.mjs'].sort().map(async path=>[path,sha(await readFile(path))])));
report.sourceBefore=await hashes();await writeFile(artifact('verifier.mjs'),await readFile('scripts/verify-source-fractal-recording-public.mjs'));
let browser,server,exportServer,page;
function installAudit(){
 const Native=window.Worker,a=window.__recordingAudit={sequence:0,workers:0,terminated:[],requests:[],completed:[],errors:[],http:[],pixels:new Map()};
 window.Worker=class extends Native{
  sent=new Map();ended=false;
  constructor(...args){super(...args);this.worker=++a.workers;this.addEventListener('message',({data})=>{
   const sent=this.sent.get(data.id);if(!sent||data.operation!==sent.request.operation)return;
   if(data.error){a.errors.push({...sent,error:data.error});this.sent.delete(data.id);return;}
   if(data.output){const{pixels,...output}=data.output;if(pixels)a.pixels.set(sent.sequence,pixels.slice());a.completed.push({...sent,output});this.sent.delete(data.id);}
   else if(data.operation==='fractal-recording-plan'&&data.result){a.completed.push({...sent,result:structuredClone(data.result)});this.sent.delete(data.id);}
  });}
  postMessage(message,...args){if(['generate','fractal-recording-plan'].includes(message.operation)){const sent={worker:this.worker,sequence:++a.sequence,request:structuredClone(message)};a.requests.push(sent);this.sent.set(message.id,sent);}return super.postMessage(message,...args);}
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
const animation=duration=>({type:'animate',duration,easing:'LINEAR',actions:[{method:'rotation',args:[.4]},{method:'paramStart',args:{parameters:{exponent_re:{min:2,max:4,step:.05}}}},{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:30,interpolation:'RGB'}}]});
const cases=[
 {name:'newton-exact-boundary',formula:'newton',timeline:[wait(.5)],simulationFps:4,encoderFps:7,updates:2},
 {name:'newton-above-boundary',formula:'newton',timeline:[wait(.5001)],simulationFps:4,encoderFps:7,updates:3},
 {name:'nova-animated',formula:'nova',timeline:[animation(1)],simulationFps:8,encoderFps:6,updates:8,evolves:true},
 {name:'newton-short-children',formula:'newton',timeline:[wait(.01),wait(.01),wait(.01)],simulationFps:4,encoderFps:7,updates:3},
 {name:'newton-empty-queue',formula:'newton',timeline:[],simulationFps:4,encoderFps:6,updates:1},
 {name:'nova-zero-wait',formula:'nova',timeline:[wait(0)],simulationFps:4,encoderFps:6,updates:1},
 {name:'nova-density2-odd',formula:'nova',timeline:[animation(.5)],simulationFps:8,encoderFps:8,updates:4,evolves:true,density:2,width:161,height:121},
 {name:'newton-cancel-retry',formula:'newton',timeline:[animation(1)],simulationFps:8,encoderFps:6,updates:8,cancel:true,evolves:true},
];
const dimensions=c=>{const width=c.width??160,height=c.height??120,density=c.density??1;return {requestedWidth:width,requestedHeight:height,width:width-width%2,height:height-height%2,inputWidth:Math.floor(Math.fround(Math.fround(width*3)/density)+.5)*density,inputHeight:Math.floor(Math.fround(Math.fround(height*3)/density)+.5)*density,density};};
async function openVideo(c){
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('button',{name:'Animation video',exact:true}).click();
 const mode=page.getByRole('combobox',{name:'Fractal video mode',exact:true});check(await mode.inputValue()==='source','source queue is not default');
 await mode.selectOption('source');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(c.width??160));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(c.height??120));
 await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill(String(c.encoderFps));
 await page.getByRole('spinbutton',{name:'Recording simulation FPS',exact:true}).fill(String(c.simulationFps));
 check(await page.getByRole('spinbutton',{name:'Export duration',exact:true}).count()===0,'duration control remains active in source mode');
}
function verifyFrames(c,a,after,row,uploads){
 const plans=a.completed.filter(r=>r.sequence>after&&r.request.operation==='fractal-recording-plan');check(plans.length===1,'expected exactly one real Worker plan');
 const plan=plans[0],p=plan.result,d=dimensions(c);row.plan=p;
 check(p.policy==='fresh-local-source-queue-replay'&&p.updates===c.updates&&p.encodedFrames===c.updates-1&&p.warmupUpdates===1&&p.simulationFps===c.simulationFps&&p.encoderFps===c.encoderFps,'plan differs from independently specified boundary count');
 const frames=a.completed.filter(r=>r.sequence>after&&r.worker===plan.worker&&r.request.operation==='generate');
 check(frames.length===c.updates,'rendered update count differs from plan');
 check(a.requests.filter(r=>r.sequence>after&&r.request.operation==='generate').every(r=>r.worker===plan.worker),'export mixed Worker owners');
 check(plan.worker!==row.previewWorker,'export reused the retained preview Worker');
 check(a.terminated.includes(plan.worker),'completed export Worker was not terminated');check(!a.terminated.includes(row.previewWorker),'export terminated the preview Worker');
 if(row.cancelledAttempt)check(plan.worker!==row.cancelledAttempt.recordingWorker,'retry reused cancelled Worker');
 row.frames=frames.map((r,i)=>{
  const f=r.output.fractalRecording;
  check(r.request.context.time===0&&r.request.context.fractalRecording.displayFrame===i&&r.request.context.fractalRecording.simulationFps===c.simulationFps,'explicit ordinal mismatch '+i);
  check(f?.displayFrame===i&&f.complete===(i===c.updates-1)&&f.warmup===(i===0),'actual frame completion mismatch '+i);
  check(Number.isFinite(f.sceneTime)&&Number.isInteger(f.queueIndex)&&f.simulationFps===c.simulationFps,'actual queue facts absent '+i);

  if(i===c.updates-1)check(f.queueIndex===c.timeline.length,'terminal queue index differs from authored children');
  check(r.output.width===d.inputWidth&&r.output.height===d.inputHeight&&r.output.type==='raster','unexpected raster dimensions');
  check(r.output.backend==='webgl2'&&r.output.fractalRender?.formula===c.formula,'actual native render backend/formula mismatch');
  check(JSON.stringify(r.output.fractalRender.logicalSize)===JSON.stringify([d.inputWidth/d.density,d.inputHeight/d.density]),'density-rounded logical canvas mismatch');
  check(r.request.scene.timeline.fps===c.simulationFps,'export scene lost simulation FPS');
  return{index:i,encodedIndex:i?i-1:null,worker:r.worker,sequence:r.sequence,time:r.request.context.time,sourceFrame:f,rgbaSha256:r.rgbaSha256};
 });
 check(uploads.length===c.updates-1,'warmup uploaded or encoded upload missing');
 for(let i=0;i<uploads.length;i++){check(uploads[i].index===i,'upload order mismatch');const png=decodePng(uploads[i].bytes);check(png.width===d.inputWidth&&png.height===d.inputHeight,'upload dimensions');check(sha(png.rgba)===frames[i+1].rgbaSha256,'entire uploaded RGBA differs from Worker '+i);uploads[i].rgbaSha256=sha(png.rgba);}
 const creates=a.http.filter(r=>r.method==='POST'&&r.path==='/api/exports');
 if(c.updates===1)check(creates.length===0,'empty recording created a server video');
 else{check(creates.length===1,'wrong video session count');check(creates[0].completed.includes(frames[0].sequence),'server session created before real warmup completed');}
 if(c.evolves)check(new Set(frames.slice(1).map(r=>r.rgbaSha256)).size>1,'multiframe recording is static');
 check(a.errors.length===0,'unexpected Worker error');return frames;
}
async function verifyDownload(c,download,row,uploads){
 const d=dimensions(c),path=artifact(c.name+'.mp4');await download.saveAs(path);const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',path],{encoding:'utf8'})).streams[0];
 check(metadata.width===d.width&&metadata.height===d.height&&Number(metadata.nb_read_frames)===c.updates-1&&metadata.r_frame_rate===c.encoderFps+'/1','ffprobe size/count/rate mismatch');
 const rgb=execFileSync('ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:16*1024*1024}),stride=d.width*d.height*3;
 check(rgb.length===(c.updates-1)*stride,'decoded MP4 frame length mismatch');if(c.evolves)check(!rgb.subarray(0,stride).equals(rgb.subarray(rgb.length-stride)),'decoded first/last frames are identical');const lossyErrors=[];
 check(['yuv444p','yuvj444p'].includes(metadata.pix_fmt)&&metadata.color_range==='pc'&&metadata.color_space==='bt709','source MP4 metadata mismatch');
 for(let i=0;i<uploads.length;i++){const png=decodePng(uploads[i].bytes),reference=execFileSync('ffmpeg',['-v','error','-f','rawvideo','-pix_fmt','rgba','-s',png.width+'x'+png.height,'-i','pipe:0','-vf','scale='+d.width+':'+d.height+':flags=lanczos','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:png.rgba,maxBuffer:16*1024*1024});let total=0,max=0;for(let j=0;j<stride;j++){const d=Math.abs(rgb[i*stride+j]-reference[j]);total+=d;max=Math.max(max,d);}lossyErrors.push({index:i,meanAbsoluteRgbError:total/stride,maxAbsoluteRgbError:max});check(total/stride<8,'encoded RGB differs beyond local H264 tolerance');}
 row.video={path,colorMetadataLimitations:['The installed ffprobe reports full-range YUV444 and bt709 matrix. Transfer/primaries are recorded as observed; missing fields are unknown, not proof of propagation.'],sha256:sha(await readFile(path)),metadata,lossyErrors,tolerance:'mean RGB absolute error <8 per frame, H264 chroma/loss allowance; full PNG RGBA equality is exact'};
}
async function runCase(c,original,origin){
 const row={name:c.name,formula:c.formula,status:'running',expectedUpdates:c.updates,expectedEncodedFrames:c.updates-1,timeline:c.timeline,simulationFps:c.simulationFps,encoderFps:c.encoderFps},start=performance.now();report.cases.push(row);
 const uploads=[],http=[],pageErrors=[],consoleErrors=[],downloads=[];let release;
 try{
  page=await browser.newPage({viewport:{width:1280,height:850},deviceScaleFactor:c.density??1,acceptDownloads:true});page.setDefaultTimeout(20000);
  page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('download',d=>downloads.push(d));
  page.on('request',r=>{const u=new URL(r.url());if(!u.pathname.startsWith('/api/exports'))return;http.push({method:r.method(),path:u.pathname,query:u.search,...(u.pathname==='/api/exports'&&r.method()==='POST'?{body:r.postDataJSON()}:{} )});if(r.method()==='POST'&&/\/frames$/.test(u.pathname))uploads.push({index:Number(u.searchParams.get('index')),bytes:r.postDataBuffer()});});
  await page.addInitScript(installAudit);await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  await page.evaluate(async(density)=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:density===2?'standard':'low',frameRate:30}});},c.density??1);await page.goto(origin);await ready();
  const source={config_version:'1.0.0',type:'FRACTAL',name:c.name,fractal:{formula_id:c.formula,iterations:24,parameters:{exponent:[3,.25],bailout:.001,relaxation:1}},timeline:c.timeline};await writeFile(artifact(c.name+'-input.json'),JSON.stringify(source,null,2)+'\n');
  await page.locator('input[type=file]').setInputFiles({name:c.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  await page.waitForFunction(name=>window.__recordingAudit.completed.some(r=>r.request.scene?.name===name),c.name);await ready();
  const preview=(await audit()).completed.findLast(r=>r.request.scene?.name===c.name);row.previewWorker=preview.worker;row.preview=preview.output.fractalRender;
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
   const cancelledAudit=await audit(),cancelledWorker=cancelledAudit.completed.findLast(r=>r.request.operation==='fractal-recording-plan')?.worker;check(cancelledWorker&&cancelledAudit.terminated.includes(cancelledWorker),'cancelled recording Worker was not terminated');check(!cancelledAudit.terminated.includes(row.previewWorker),'cancel terminated preview Worker');
   row.cancelledAttempt={recordingWorker:cancelledWorker,uploads:uploads.map(u=>({index:u.index,pngSha256:sha(u.bytes)})),http:[...http],worker:cancelledAudit,sessionRemoved:true,downloads:0,note:'Only the first actual upload request was delayed; genuine body/service/Worker unchanged. Released immediately after public Cancel.'};
   await page.unroute('**/api/exports/*/frames?index=0');uploads.length=0;http.length=0;
   await page.evaluate(()=>{window.__recordingAudit.http=[];window.__recordingAudit.errors=[];});
  }
  const after=await page.evaluate(()=>window.__recordingAudit.sequence),downloadPromise=c.updates>1?page.waitForEvent('download',{timeout:90000}):null;downloadPromise?.catch(()=>{});await page.getByRole('button',{name:'Start export',exact:true}).click();
  if(c.updates===1){await page.locator('.export-error').filter({hasText:'The Fractal queue ended during warmup with no frames to encode; extend the queue.'}).waitFor();await page.getByRole('button',{name:'Start export',exact:true}).waitFor();check(downloads.length===0,'zero-frame recording downloaded a file');row.userError=await page.locator('.export-error').allTextContents();}
  else{await downloadPromise.then(d=>verifyDownload(c,d,row,uploads));}
  await page.getByRole('button',{name:'Start export',exact:true}).waitFor();await page.waitForFunction(()=>{const a=window.__recordingAudit,plan=a.completed.findLast(r=>r.request.operation==='fractal-recording-plan');return plan&&a.terminated.includes(plan.worker);});
  const a=await audit();verifyFrames(c,a,after,row,uploads);row.workerAudit=a;row.http=http;row.uploads=uploads.map(u=>({index:u.index,bytes:u.bytes.length,pngSha256:sha(u.bytes),rgbaSha256:u.rgbaSha256}));
  const creates=http.filter(r=>r.method==='POST'&&r.path==='/api/exports');if(c.updates>1){const d=dimensions(c),b=creates[0]?.body;check(b.frames===c.updates-1&&b.fps===c.encoderFps&&b.profile==='mathart'&&b.quality==='high'&&b.width===d.width&&b.height===d.height&&b.inputWidth===d.inputWidth&&b.inputHeight===d.inputHeight,'service lost count/rate/native size/quality');}else check(!creates.length,'zero frames reached service');
  check(pageErrors.length===0,'browser page error');check(consoleErrors.length===0,'browser console error');await page.screenshot({path:artifact(c.name+'.png')});row.status='passed';
 }catch(error){row.status='failed';row.error=String(error);row.stack=error.stack;row.http=http;row.workerAudit=await audit().catch(()=>null);row.body=await page?.locator('body').innerText().catch(()=>null);await page?.screenshot({path:artifact(c.name+'-failed.png')}).catch(()=>{});}
 finally{release?.();row.pageErrors=pageErrors;row.consoleErrors=consoleErrors;row.elapsedMs=performance.now()-start;try{await page?.close();row.pageClosed=true;}catch(error){row.status='failed';row.cleanupError=String(error);}page=undefined;await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${row.name}: ${row.status}${row.error?' '+row.error:''}`);}
}
try{
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',jarBytes=await readFile(jar);check(sha(jarBytes)==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','fixed artifact changed');report.source={jarSha256:sha(jarBytes),clockFixture:'tests/fixtures/source-fractal-clock/source.json',clockSha256:sha(await readFile('tests/fixtures/source-fractal-clock/source.json'))};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});}),origin=`http://127.0.0.1:${port}/`;
 exportServer=await createExportServer({root:artifact('service'),allowedOrigins:[origin.slice(0,-1)]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const c of cases)await runCase(c,null,origin);
 report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=closed.map((r,i)=>({resource:['browser','vite','export-server'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(closed.some(r=>r.status==='rejected')||!report.sourceStable)report.status='failed';if(report.status!=='passed')process.exitCode=1;
 await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');
 const lines=['# Fractal queue replay public verification','',`Status: **${report.status}**; source stable: **${report.sourceStable}**; elapsed: ${(report.elapsedMs/1000).toFixed(1)} s.`,'',report.scope,'','| Case | Result | Updates / encoded | Video |','| --- | --- | --- | --- |',...report.cases.map(c=>`| ${c.name} | ${c.status}${c.error?' — '+c.error:''} | ${c.plan?.updates??'?'} / ${c.plan?.encodedFrames??'?'} | ${c.video?.path??'none'} |`),'','Plan updates count driver displays. Empty queues display warmup once with one completed-object update and zero uploads. Exact PNG RGBA comparison covers every uploaded frame. ffprobe checks encoded frame count, dimensions and encoder FPS. Cancellation holds only the first upload, then checks public cancellation, server removal and successful retry.','',...report.limits.map(s=>'- '+s),'',`Complete evidence: ${artifact('report.json')}`,''];await writeFile(artifact('report.md'),lines.join('\n'));console.log(JSON.stringify({status:report.status,sourceStable:report.sourceStable,passed:report.cases.filter(c=>c.status==='passed').length,total:report.cases.length,report:artifact('report.md')}));
}
