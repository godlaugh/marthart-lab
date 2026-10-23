import {measureFamily} from './browser-process-cost.mjs';
/** Public Surface App/Worker/service/FFmpeg verification; no native GUI parity. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodePng} from './lib/verify-png.mjs';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');


const native=process.env.VITE_SOURCE_RENDERER==='native';
const directory=process.argv[2]??`.cache/surface-ui-${Date.now()}`,artifact=n=>`${directory}/${n}`;
await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',native,scope:'Actual Surface recording UI, unmodified Worker/client/renderer, formula composition, local service and FFmpeg. CPU/GPU points and mesh; DPR 1/2.',limits:['No native GUI/JOGL or whole-window parity.','Browser-observed draw intervals are not original PApplet timing.','PNG formula pixels and video decoding are checked; original glyph/whole-image pixels are not an oracle here.','Process-family CPU/RSS are sampled estimates, including browser/server/FFmpeg descendants; short-lived processes may be missed. Token cost and VRAM unmeasured. Fresh page per case; not an equivalent cold/warm performance comparison.'],cases:[]};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),...(await files('server')),'scripts/verify-source-surface-recording-ui.mjs','scripts/lib/verify-png.mjs','scripts/browser-process-cost.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
report.sourceBefore=await hashes();const started=performance.now();let server,browser,exportServer,page;
function installAudit(){
 const Native=window.Worker,a=window.__surfaceAudit={sequence:0,workers:0,requests:[],completed:[],errors:[],hashes:[]};
 const strip=(o,row,key)=>{const {pixels,positions,colors,indices,normals,...facts}=o;if(pixels){const copy=pixels.slice();a.hashes.push(crypto.subtle.digest('SHA-256',copy).then(h=>row[key+'Hash']=Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,'0')).join('')));}return facts;};
 window.Worker=class extends Native{
  sent=new Map();constructor(...args){super(...args);this.auditId=++a.workers;this.addEventListener('message',({data})=>{const sent=this.sent.get(data.id);if(!sent||data.operation!==sent.request.operation)return;if(data.operation==='generate'&&!data.output&&!data.error)return;const row={...sent,response:{...data}};if(data.output){row.output=strip(data.output,row,'rgba');delete row.response.output;}if(data.result){row.response.result={...data.result};for(const key of ['warmup','capture','preview'])if(data.result[key])row.response.result[key]=strip(data.result[key],row,key);}if(data.error)a.errors.push(row);a.completed.push(row);this.sent.delete(data.id);});}
  postMessage(message,...args){const request=structuredClone(message);if(request.pixels){request.pixelsLength=request.pixels.length;delete request.pixels;}const row={worker:this.auditId,sequence:++a.sequence,request};a.requests.push(row);this.sent.set(message.id,row);return super.postMessage(message,...args);}
 };
}
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
async function audit(){return page.evaluate(async()=>{const a=window.__surfaceAudit;await Promise.all(a.hashes);return{requests:a.requests,completed:a.completed,errors:a.errors};});}
async function last(){const a=await audit(),row=a.completed.findLast(r=>r.output?.surfaceLive&&r.output?.sourceCameraFrame?.viewport.target==='primary');check(row,'no primary Surface output');return row;}
async function pause(){if(await page.getByRole('button',{name:'Pause',exact:true}).count()){const seq=(await audit()).requests.at(-1)?.sequence??0;await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(seq=>window.__surfaceAudit.completed.some(r=>r.sequence>seq&&r.request.operation==='surface-playback'&&r.response.paused===true),seq);}await ready();return last();}
async function run(backend,mode,origin){
 const key=backend+'-'+mode,row={backend,mode,status:'running',steps:[]};report.cases.push(row);const errors=[],uploads=[],http=[];
 try{
  page=await browser.newPage({viewport:{width:1360,height:900},deviceScaleFactor:backend==='gpu'?2:1,acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installAudit);
  if(native)await page.route('**/src/main.tsx',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:`import {Generator as AuditGenerator} from '/src/engine/client.ts';window.__nativeRecordingFrames=[];for(const method of ['beginSourceRecording','nextSourceRecordingFrame']){const original=AuditGenerator.prototype[method];AuditGenerator.prototype[method]=async function(...args){const result=await original.apply(this,args);const frame=method==='beginSourceRecording'?result.warmup:result;window.__nativeRecordingFrames.push(frame.sourcePixelRenderer);return result;};}\n`+body});});
  page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()==='POST'&&path==='/api/exports')http.push(JSON.parse(r.postData()));if(r.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(path))uploads.push({index:Number(new URL(r.url()).searchParams.get('index')),bytes:r.postDataBuffer()});});
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  const document=await page.evaluate(async ({backend,mode})=>{
   const {createScene,saveWorkspace,serializeScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts');
   const initial=createScene(definition('surface'));Object.assign(initial.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[initial],active:initial.id,theme:'dark',language:'en',render:{quality:backend==='gpu'?'high':'low',frameRate:20}});
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Surface recording '+backend+' '+mode,parameters:{a:.25},equations:{x:'a+u',y:'v',z:'0'},camera:{phi:.25,theta:-.3,gamma:.5},settings:{render_mode:backend.toUpperCase(),surface_mode:mode,u_segments:10,v_segments:10,mesh_u_segments:10,mesh_v_segments:10,u_min:-1,u_max:1,v_min:-1,v_max:1,scale_x:20,scale_y:20,scale_z:20,speed_u:0,speed_v:0,show_trails:false,mesh_wireframe:false},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{step:.1,min:-1,max:1}}}},{method:'ambient',args:[.1,.2,.3]}]}]})).scene;
   s.formulas=defaultFormulas();Object.assign(s.formulas,{referenceWidth:64,referenceHeight:48});Object.assign(s.formulas.main,{visible:true,latex:'x',color:'#ff00ff',x:2,y:2,scale:.3});return serializeScene(s);
  },{backend,mode});
  await page.goto(origin);await ready();await page.locator('input[type=file]').setInputFiles({name:'surface.json',mimeType:'application/json',buffer:Buffer.from(document)});
  await page.waitForFunction(()=>window.__surfaceAudit.completed.some(r=>r.output?.surfaceLive));await ready();
  const imported=await last();check(imported.output.surfaceLive.paused&&imported.output.surfaceLive.frame.sceneTime===0,'import not paused at origin');check(imported.request.context.sourcePointPixelDensity===(backend==='gpu'?2:1),'actual preview density differs from fixture');row.steps.push({name:'import',frame:imported});
  await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Surface recording',exact:true}).waitFor();await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('64');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('48');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('4');
  const videoDownload=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'Start recording',exact:true}).click();const video=await videoDownload,videoPath=artifact(key+'-recording.mp4');await video.saveAs(videoPath);
  await page.waitForFunction(()=>window.__surfaceAudit.completed.some(r=>r.request.operation==='source-recording-finish'));
  const a=await audit(),start=a.completed.findLast(r=>r.request.operation==='source-recording-begin'),frames=a.completed.filter(r=>r.request.operation==='source-recording-frame'&&r.sequence>start.sequence),stop=a.completed.findLast(r=>r.request.operation==='source-recording-finish');
  check(start.response.result.clock.encodedFrames===3&&frames.length===3&&uploads.length===3,'warmup/encoded frame count mismatch');
  for(const frame of frames){const live=frame.output.surfaceLive;check(Number.isFinite(frame.request.actualFrameRate)&&Object.is(live.recording.actualFrameRate,Math.fround(frame.request.actualFrameRate)),'App lost independent observed FPS');check(live.frame.rawDt===.25&&live.recording.simulationFps===4,'simulation clock differs');}
  check(stop.response.result.preview.surfaceLive.frame.frameIndex===3&&!stop.response.result.preview.surfaceLive.paused,'stop advanced or paused scene');check(http.at(-1).profile==='mathart'&&http.at(-1).inputWidth===192&&http.at(-1).inputHeight===144,'encoder input did not preserve 3x source target');
  for(const upload of uploads){const png=decodePng(upload.bytes);check(png.width===192&&png.height===144,'uploaded PNG dimensions differ');let magenta=0;for(let i=0;i<png.rgba.length;i+=4)if(png.rgba[i]>180&&png.rgba[i+1]<80&&png.rgba[i+2]>180)magenta++;check(magenta>5,'uploaded video frame lacks magenta formula pixels');upload.formulaPixels=magenta;}
  const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt,duration','-of','json',videoPath],{encoding:'utf8'})).streams[0];check(metadata.width===64&&metadata.height===48&&Number(metadata.nb_read_frames)===3&&metadata.r_frame_rate==='4/1'&&Number(metadata.duration)===.75,'decoded video dimensions/count/rate differ');
  const raw=execFileSync('ffmpeg',['-v','error','-i',videoPath,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024});check(raw.length===64*48*3*3&&!raw.subarray(0,64*48*3).equals(raw.subarray(-64*48*3)),'decoded video has no animation');
  await page.getByRole('button',{name:'Close export',exact:true}).click();await page.waitForFunction(sequence=>window.__surfaceAudit.completed.some(r=>r.sequence>sequence&&r.output?.surfaceLive?.frame.frameIndex>3),stop.sequence);await pause();await page.screenshot({path:artifact(key+'-after.png')});
  row.steps.push({name:'recording',start,frames,stop,metadata,uploads:uploads.map(u=>({index:u.index,sha256:sha(u.bytes),formulaPixels:u.formulaPixels})),observations:frames.map(f=>f.request.actualFrameRate)});
  for(const mode of ['stop','cancel','zero-frame-stop']){
   await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Surface recording',exact:true}).waitFor();
   for(const [name,value] of [['Export width','64'],['Export height','48'],['Export frame rate','4']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
   const sequence=(await audit()).requests.at(-1).sequence,priorUploads=uploads.length,downloads=[];const onDownload=d=>downloads.push(d);page.on('download',onDownload);
   let release,arrive,held=false,sessionId;const gate=new Promise(resolve=>arrive=resolve),released=new Promise(resolve=>release=resolve);
   const routeHandler=async route=>{const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST'&&path==='/api/exports'){
     const response=await route.fetch();sessionId=(await response.json()).id;
     if(mode==='zero-frame-stop'){held=true;arrive();await released;}return route.fulfill({response});
    }
    if(request.method()==='POST'&&path.endsWith('/frames')&&!held){held=true;arrive();await released;}return route.continue();
   };
   await page.route('**/api/exports**',routeHandler);
   try{
    row.activeInterruption=mode;
    await page.getByRole('button',{name:'Start recording',exact:true}).click();
    let timer;try{await Promise.race([gate,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('interruption gate timeout')),25000))]);}finally{clearTimeout(timer);}
    await page.getByRole('button',{name:mode==='cancel'?'Cancel export':'Stop and save',exact:true}).click();release();
    await page.waitForFunction(sequence=>window.__surfaceAudit.completed.some(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish'),sequence);
    await page.getByRole('button',{name:'Start recording',exact:true}).waitFor();
    const interrupted=await audit(),begin=interrupted.completed.find(r=>r.sequence>sequence&&r.request.operation==='source-recording-begin'),delivered=interrupted.completed.filter(r=>r.sequence>sequence&&r.request.operation==='source-recording-frame'),finish=interrupted.completed.find(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish');
    const expected=mode==='zero-frame-stop'?0:1;check(delivered.length===expected&&uploads.length-priorUploads===expected,'interruption requested an extra frame');
    check(finish.response.result.preview.surfaceLive.frame.frameIndex===expected&&!finish.response.result.preview.surfaceLive.paused,'interruption failed to restore exact retained state');
    if(mode==='stop'){
     check(downloads.length===1,'partial stop did not save exactly one video');const path=artifact(key+'-partial.mp4');await downloads[0].saveAs(path);
     const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',path],{encoding:'utf8'})).streams[0];check(Number(stream.nb_read_frames)===1,'partial video count differs');
    }else{
     check(downloads.length===0,'discarded/zero-frame recording downloaded');check((await page.request.get(origin+'api/exports/'+sessionId)).status()===404,'discarded/zero-frame session remains');
     if(mode==='zero-frame-stop')await page.locator('.export-error').filter({hasText:'No frames to save'}).waitFor();
    }
    row.steps.push({name:mode,begin,delivered,finish,downloads:downloads.length});
   }finally{release();await page.unroute('**/api/exports**',routeHandler);page.off('download',onDownload);}
   await page.getByRole('button',{name:'Close export',exact:true}).click();await pause();
  }
  if(native){
   await page.getByRole('button',{name:'Record',exact:true}).click();
   const sequence=(await audit()).requests.at(-1).sequence,priorCreate=http.length,priorUploads=uploads.length,priorFrames=await page.evaluate(()=>window.__nativeRecordingFrames.length);
   let arrive,release,held=false;const arrived=new Promise(r=>arrive=r),released=new Promise(r=>release=r);
   const nativeGate=async route=>{if(held)return route.continue();held=true;arrive();await released;await route.abort('aborted').catch(()=>{});};
   await page.route('**/api/source-renderer/frames',nativeGate);
   try{
    await page.getByRole('button',{name:'Start recording',exact:true}).click();let timer;try{await Promise.race([arrived,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('native frame gate timeout')),25000))]);}finally{clearTimeout(timer);}
    await page.getByRole('button',{name:'Cancel export',exact:true}).click();
    // The original fetch must reject on cancellation before this intercepted
    // network request is released. Otherwise stop cannot complete here.
    await page.waitForFunction(sequence=>window.__surfaceAudit.completed.some(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish'),sequence);
    await page.getByRole('button',{name:'Start recording',exact:true}).waitFor();
    check(http.length===priorCreate&&uploads.length===priorUploads,'cancelled warmup created encoder work');
    check(await page.evaluate(()=>window.__nativeRecordingFrames.length)===priorFrames,'cancelled native warmup was delivered');
    const finish=(await audit()).completed.find(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish');check(finish.response.result.preview.surfaceLive.frame.frameIndex===0,'cancelled native warmup advanced frame');
    row.steps.push({name:'native-warmup-cancel',finish,encoderCreated:false,lateFrameDelivered:false});
   }finally{release();await page.unroute('**/api/source-renderer/frames',nativeGate);}
   await page.getByRole('button',{name:'Close export',exact:true}).click();await pause();
  }
  // Exercise the ordinary Export entry too. Lose successful upload/finalize
  // replies, then one status reply: recovery must retain the same recording.
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();
  await page.getByRole('button',{name:'Animation video',exact:true}).click();
  check(await page.getByRole('combobox',{name:'Surface video mode',exact:true}).inputValue()==='retained','export did not default to retained recording');
  for(const [name,value] of [['Export width','65'],['Export height','49'],['Export frame rate','4']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  const seq=(await audit()).requests.at(-1).sequence,uploadStart=uploads.length,createStart=http.length;
  let lostUpload=false,lostFinish=false,lostStatus=false,finishedId;
  const recovery=async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(request.method()==='POST'&&path.endsWith('/frames')&&!lostUpload){lostUpload=true;const response=await route.fetch();check(response.ok(),'real upload failed before injection');return route.abort('failed');}
   if(request.method()==='POST'&&path.endsWith('/finish')&&!lostFinish){lostFinish=true;const response=await route.fetch();check(response.ok(),'real finish failed before injection');finishedId=(await response.json()).id;return route.abort('failed');}
   if(request.method()==='GET'&&path==='/api/exports/'+finishedId&&!lostStatus){lostStatus=true;const response=await route.fetch();check(response.ok(),'real status failed before injection');return route.abort('failed');}
   return route.continue();
  };
  await page.route('**/api/exports**',recovery);
  try{
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
   await page.getByRole('button',{name:'Retry save',exact:true}).waitFor();const uncertain=await audit();
   check(!uncertain.requests.some(r=>r.sequence>seq&&r.request.operation==='source-recording-finish'),'unknown save outcome released numerical owner');
   check(uncertain.completed.filter(r=>r.sequence>seq&&r.request.operation==='source-recording-frame').length===3,'unknown save changed frame count');
   await page.getByRole('button',{name:'Retry save',exact:true}).click();const video=await download,path=artifact(key+'-recovered.mp4');await video.saveAs(path);
   await page.waitForFunction(seq=>window.__surfaceAudit.completed.some(r=>r.sequence>seq&&r.request.operation==='source-recording-finish'),seq);
   check(lostUpload&&lostFinish&&lostStatus&&http.length===createStart+1&&uploads.length===uploadStart+3,'recovery recreated session or re-uploaded a confirmed frame');
   const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,duration','-of','json',path],{encoding:'utf8'})).streams[0];
   check(stream.width===64&&stream.height===48&&Number(stream.nb_read_frames)===3&&Number(stream.duration)===.75,'recovered file metadata differs');
   const inputWidth=backend==='gpu'?196:195,inputHeight=backend==='gpu'?148:147;
   check(http.at(-1).inputWidth===inputWidth&&http.at(-1).inputHeight===inputHeight,'odd target density rounding differs');
   row.steps.push({name:'export-recovery',lostUpload,lostFinish,lostStatus,session:finishedId,metadata:stream,inputWidth,inputHeight,retainedWhileUncertain:true});
  }finally{await page.unroute('**/api/exports**',recovery);}
  await page.getByRole('button',{name:'Close export',exact:true}).click();await pause();
  // An actually empty queue ends in warmup: no encoder session or dummy frame.
  const empty=JSON.parse(document);empty.timeline.tracks=[];
  const beforeEmpty=(await audit()).requests.at(-1).sequence;
  await page.locator('input[type=file]').setInputFiles({name:'surface-empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(empty))});
  await page.waitForFunction(seq=>window.__surfaceAudit.completed.some(r=>r.sequence>seq&&r.output?.surfaceLive),beforeEmpty);await ready();
  await page.getByRole('button',{name:'Record',exact:true}).click();
  for(const [name,value] of [['Export width','64'],['Export height','48'],['Export frame rate','4']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  const emptyStart=(await audit()).requests.at(-1).sequence,priorCreate=http.length,priorUploads=uploads.length;
  await page.getByRole('button',{name:'Start recording',exact:true}).click();await page.locator('.export-error').filter({hasText:'No frames to save'}).waitFor();
  await page.waitForFunction(seq=>window.__surfaceAudit.completed.some(r=>r.sequence>seq&&r.request.operation==='source-recording-finish'),emptyStart);
  const emptyAudit=await audit(),emptyBegin=emptyAudit.completed.find(r=>r.sequence>emptyStart&&r.request.operation==='source-recording-begin');
  check(emptyBegin.response.result.clock.encodedFrames===0&&http.length===priorCreate&&uploads.length===priorUploads,'empty queue fabricated an encoder session/frame');
  row.steps.push({name:'empty-queue',clock:emptyBegin.response.result.clock,encoderCreated:false});
  check(!emptyAudit.errors.length&&!errors.length,'runtime reported errors');if(native){row.nativeFrames=await page.evaluate(()=>window.__nativeRecordingFrames);check(row.nativeFrames.length>0&&row.nativeFrames.every(f=>f?.backend==='native'),'Recording did not deliver native pixels');}row.status='passed';
 }catch(error){row.status='failed';row.error=error.stack??String(error);if(page)await page.screenshot({path:artifact(key+'-failure.png')}).catch(()=>{});}
 finally{if(page){row.audit=await audit().catch(()=>undefined);await page.close();page=undefined;}console.log(key+': '+row.status+(row.error?' '+row.error:''));}
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});}),origin=`http://127.0.0.1:${port}/`;
 exportServer=await createExportServer({root:artifact('service'),allowedOrigins:[origin.slice(0,-1)],sourceRendererBackend:native?JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND)):undefined});const address=await exportServer.listen(0);server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const measured=await measureFamily(process.pid,async()=>{for(const backend of ['cpu','gpu'])for(const mode of ['POINTS','MESH'])await run(backend,mode,origin);return{};});report.processFamily=measured.processFamily;report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=error.stack??String(error);}
finally{const cleanup=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=cleanup.map(r=>r.status);report.remainingProcesses=exportServer?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(report.remainingProcesses!==0||!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:artifact('report.json'),elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;}

