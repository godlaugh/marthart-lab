/** Public Domain App/Worker/service/FFmpeg verification; no native GUI parity. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
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

const directory=process.argv[2]??`.cache/domain-ui-${Date.now()}`,artifact=n=>`${directory}/${n}`;
await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',scope:'Actual App controls, unmodified Worker, local export service and FFmpeg. CPU low-quality preview and GPU high-quality preview.',limits:['No native GUI/JOGL or whole-window parity.','Browser-observed draw intervals are not original PApplet timing.','PNG structure and video decoding are checked; original glyph/whole-image pixels are not an oracle here.'],cases:[]};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),...(await files('server')),'scripts/verify-source-domain-ui.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
report.sourceBefore=await hashes();const started=performance.now();let server,browser,exportServer,page;
function installAudit(){
 const Native=window.Worker,a=window.__domainAudit={sequence:0,workers:0,requests:[],completed:[],errors:[],hashes:[]};
 const strip=(o,row,key)=>{const {pixels,...facts}=o;if(pixels){const copy=pixels.slice();a.hashes.push(crypto.subtle.digest('SHA-256',copy).then(h=>row[key+'Hash']=Array.from(new Uint8Array(h),v=>v.toString(16).padStart(2,'0')).join('')));}return facts;};
 window.Worker=class extends Native{
  sent=new Map();constructor(...args){super(...args);this.auditId=++a.workers;this.addEventListener('message',({data})=>{const sent=this.sent.get(data.id);if(!sent||data.operation!==sent.request.operation)return;if(data.operation==='generate'&&!data.output&&!data.error)return;const row={...sent,response:{...data}};if(data.output){row.output=strip(data.output,row,'rgba');delete row.response.output;}if(data.result){row.response.result={...data.result};for(const key of ['warmup','capture','preview'])if(data.result[key])row.response.result[key]=strip(data.result[key],row,key);}if(data.error)a.errors.push(row);a.completed.push(row);this.sent.delete(data.id);});}
  postMessage(message,...args){const request=structuredClone(message);if(request.pixels){request.pixelsLength=request.pixels.length;delete request.pixels;}const row={worker:this.auditId,sequence:++a.sequence,request};a.requests.push(row);this.sent.set(message.id,row);return super.postMessage(message,...args);}
 };
}
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
async function audit(){return page.evaluate(async()=>{const a=window.__domainAudit;await Promise.all(a.hashes);return{requests:a.requests,completed:a.completed,errors:a.errors};});}
async function last(){const a=await audit(),row=a.completed.findLast(r=>r.output?.domainLive?.target==='primary');check(row,'no primary Domain output');return row;}
async function pause(){if(await page.getByRole('button',{name:'Pause',exact:true}).count()){const seq=(await audit()).requests.at(-1)?.sequence??0;await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(seq=>window.__domainAudit.completed.some(r=>r.sequence>seq&&r.request.operation==='domain-playback'&&r.response.paused===true),seq);}await ready();return last();}
async function waitOutput(sequence){await page.waitForFunction(sequence=>window.__domainAudit.completed.some(r=>r.sequence>sequence&&r.output?.domainLive?.target==='primary'),sequence);await ready();return last();}
async function run(backend,origin){
 const row={backend,status:'running',steps:[]};report.cases.push(row);const errors=[],uploads=[],http=[];
 try{
  page=await browser.newPage({viewport:{width:1360,height:900},deviceScaleFactor:backend==='gpu'?2:1,acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installAudit);
  page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()==='POST'&&path==='/api/exports')http.push(JSON.parse(r.postData()));if(r.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(path))uploads.push({index:Number(new URL(r.url()).searchParams.get('index')),bytes:r.postDataBuffer()});});
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  const document=await page.evaluate(async backend=>{
   const {createScene,saveWorkspace,serializeScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts');
   const initial=createScene(definition('surface'));Object.assign(initial.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[initial],active:initial.id,theme:'dark',language:'en',render:{quality:backend==='gpu'?'high':'low',frameRate:20}});
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain UI '+backend,domainColoring:{formula:'z^3-1'},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'domainRotate',args:[1]},{method:'paramStart',args:{parameters:{a:{step:.02,min:-1,max:1}}}}]}]})).scene;
   s.parameters={a:.2,b:.3};s.settings.domainBackend=backend;if(backend==='cpu')s.settings.domainRenderPolicy='source-cpu-always-v1';s.formulas=defaultFormulas();s.formulas.main.visible=true;s.formulas.main.latex='z^3-1';return serializeScene(s);
  },backend);
  await page.goto(origin);await ready();await page.locator('input[type=file]').setInputFiles({name:'domain.json',mimeType:'application/json',buffer:Buffer.from(document)});
  await page.waitForFunction(()=>window.__domainAudit.completed.some(r=>r.output?.domainLive));await ready();let current=await last();
  check(current.output.domainRender.effective.backend===(backend==='gpu'?'webgl2':'cpu'),'wrong actual backend');check(current.output.domainLive.paused&&current.output.domainLive.updateOrdinal===0,'import is not paused at fresh state');
  row.steps.push({name:'import',frame:current});await page.screenshot({path:artifact(backend+'-initial.png')});
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__domainAudit.completed.some(r=>r.output?.domainLive?.sceneTime>.15&&!r.output.domainLive.paused));current=await pause();
  const before=current.output.domainLive;check(before.sceneTime>0,'play did not advance');row.steps.push({name:'play-pause',frame:current});
  const seq=(await audit()).requests.at(-1).sequence;await page.locator('#param-a').fill('.7');await page.locator('#param-a').press('Enter');current=await waitOutput(seq);
  check(current.output.domainLive.updateOrdinal===before.updateOrdinal&&current.output.domainLive.sceneTime===before.sceneTime&&current.output.domainLive.revision===before.revision,'hot parameter rebuilt or advanced scene');check(current.output.domainLive.presentation.parameters.a===.7,'hot value not delivered');row.steps.push({name:'hot-parameter',frame:current});
  let at=(await audit()).requests.at(-1).sequence;const bounds=await page.getByTestId('art-canvas').boundingBox();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5+32,bounds.y+bounds.height*.5+12);await page.mouse.up();current=await waitOutput(at);
  check(current.request.operation==='domain-navigation'&&current.output.domainLive.presentation.settings.centerX!==before.presentation.settings.centerX,'drag did not use retained navigation');check(current.output.domainLive.updateOrdinal===before.updateOrdinal,'drag advanced scene');row.steps.push({name:'paused-pan',frame:current});
  at=(await audit()).requests.at(-1).sequence;await page.mouse.wheel(0,160);current=await waitOutput(at);check(current.request.event?.kind==='wheel'&&Number.isInteger(current.request.event.count),'wheel did not deliver integer count');row.steps.push({name:'paused-wheel',frame:current});
  at=(await audit()).requests.at(-1).sequence;await page.getByTestId('domain-apply').click();current=await waitOutput(at);
  check(current.output.domainLive.updateOrdinal===0&&current.output.domainLive.sceneTime===0&&current.output.domainLive.paused&&current.output.domainLive.revision>before.revision,'paused full Apply did not rebuild');check(current.output.domainLive.presentation.parameters.a===.7,'full Apply lost authored parameter');row.steps.push({name:'paused-full-apply',frame:current});
  const prior=current;await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Domain image source',exact:true}).selectOption('current');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('65');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('49');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('3');
  const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const png=await pngDownload,pngPath=artifact(backend+'-current.png');await png.saveAs(pngPath);const decoded=decodePng(await readFile(pngPath));
  const captured=(await audit()).completed.findLast(r=>r.request.operation==='domain-paused-capture'),pair=captured?.response.result;check(pair,'PNG did not use current capture');check(decoded.width===pair.capture.width*3&&decoded.height===pair.capture.height*3,'PNG density/upscale mismatch');check(pair.capture.domainLive.updateOrdinal===prior.output.domainLive.updateOrdinal&&pair.preview.domainLive.sceneTime===prior.output.domainLive.sceneTime,'current PNG advanced scene');check(pair.capture.formulaPresentation.labels.length>0,'PNG lost captured formula');row.steps.push({name:'current-png',width:decoded.width,height:decoded.height,sha256:sha(decoded.rgba),frame:captured});await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
  await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Domain recording',exact:true}).waitFor();await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('64');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('48');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('4');
  const videoDownload=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'Start recording',exact:true}).click();const video=await videoDownload,videoPath=artifact(backend+'-recording.mp4');await video.saveAs(videoPath);
  await page.waitForFunction(()=>window.__domainAudit.completed.some(r=>r.request.operation==='source-recording-finish'));
  const a=await audit(),start=a.completed.findLast(r=>r.request.operation==='source-recording-begin'),frames=a.completed.filter(r=>r.request.operation==='source-recording-frame'&&r.sequence>start.sequence),stop=a.completed.findLast(r=>r.request.operation==='source-recording-finish');
  check(start.response.result.clock.encodedFrames===3&&frames.length===3&&uploads.length===3,'warmup/encoded frame count mismatch');
  for(const frame of frames){const live=frame.output.domainLive;check(Number.isFinite(frame.request.actualFrameRate)&&Object.is(live.actualFrameRate,Math.fround(frame.request.actualFrameRate)),'App lost independent observed FPS');check(live.rawDt===.25&&live.recording.simulationFps===4,'simulation clock differs');}
  check(stop.response.result.preview.domainLive.updateOrdinal===3&&!stop.response.result.preview.domainLive.paused,'stop advanced or paused scene');check(http.at(-1).profile==='mathart'&&http.at(-1).inputWidth===192&&http.at(-1).inputHeight===144,'encoder input did not preserve 3x source target');
  const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt','-of','json',videoPath],{encoding:'utf8'})).streams[0];check(metadata.width===64&&metadata.height===48&&Number(metadata.nb_read_frames)===3&&metadata.r_frame_rate==='4/1','decoded video dimensions/count/rate differ');
  const raw=execFileSync('ffmpeg',['-v','error','-i',videoPath,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024});check(raw.length===64*48*3*3&&!raw.subarray(0,64*48*3).equals(raw.subarray(-64*48*3)),'decoded video has no animation');
  await page.getByRole('button',{name:'Close export',exact:true}).click();await page.waitForFunction(sequence=>window.__domainAudit.completed.some(r=>r.sequence>sequence&&r.output?.domainLive?.updateOrdinal>3),stop.sequence);await pause();await page.screenshot({path:artifact(backend+'-after.png')});
  row.steps.push({name:'recording',start,frames,stop,metadata,uploads:uploads.map(u=>({index:u.index,sha256:sha(u.bytes)})),observations:frames.map(f=>f.request.actualFrameRate)});
  for(const mode of ['stop','cancel','zero-frame-stop']){
   await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Domain recording',exact:true}).waitFor();
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
    await page.getByRole('button',{name:'Start recording',exact:true}).click();
    let timer;try{await Promise.race([gate,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('interruption gate timeout')),25000))]);}finally{clearTimeout(timer);}
    await page.getByRole('button',{name:mode==='cancel'?'Cancel export':'Stop and save',exact:true}).click();release();
    await page.waitForFunction(sequence=>window.__domainAudit.completed.some(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish'),sequence);
    await page.getByRole('button',{name:'Start recording',exact:true}).waitFor();
    const interrupted=await audit(),begin=interrupted.completed.find(r=>r.sequence>sequence&&r.request.operation==='source-recording-begin'),delivered=interrupted.completed.filter(r=>r.sequence>sequence&&r.request.operation==='source-recording-frame'),finish=interrupted.completed.find(r=>r.sequence>sequence&&r.request.operation==='source-recording-finish');
    const expected=mode==='zero-frame-stop'?0:1;check(delivered.length===expected&&uploads.length-priorUploads===expected,'interruption requested an extra frame');
    check(finish.response.result.preview.domainLive.updateOrdinal===expected&&!finish.response.result.preview.domainLive.paused,'interruption failed to restore exact retained state');
    if(mode==='stop'){
     check(downloads.length===1,'partial stop did not save exactly one video');const path=artifact(backend+'-partial.mp4');await downloads[0].saveAs(path);
     const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',path],{encoding:'utf8'})).streams[0];check(Number(stream.nb_read_frames)===1,'partial video count differs');
    }else{
     check(downloads.length===0,'discarded/zero-frame recording downloaded');check((await page.request.get(origin+'api/exports/'+sessionId)).status()===404,'discarded/zero-frame session remains');
     if(mode==='zero-frame-stop')await page.locator('.export-error').filter({hasText:'No frames to save'}).waitFor();
    }
    row.steps.push({name:mode,begin,delivered,finish,downloads:downloads.length});
   }finally{release();await page.unroute('**/api/exports**',routeHandler);page.off('download',onDownload);}
   await page.getByRole('button',{name:'Close export',exact:true}).click();await pause();
  }
  check(!(await audit()).errors.length&&!errors.length,'runtime reported errors');row.status='passed';
 }catch(error){row.status='failed';row.error=error.stack??String(error);if(page)await page.screenshot({path:artifact(backend+'-failure.png')}).catch(()=>{});}
 finally{if(page){row.audit=await audit().catch(()=>undefined);await page.close();page=undefined;}console.log(backend+': '+row.status+(row.error?' '+row.error:''));}
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});}),origin=`http://127.0.0.1:${port}/`;
 exportServer=await createExportServer({root:artifact('service'),allowedOrigins:[origin.slice(0,-1)]});const address=await exportServer.listen(0);server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();for(const backend of ['cpu','gpu'])await run(backend,origin);report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=error.stack??String(error);}
finally{const cleanup=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=cleanup.map(r=>r.status);report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:artifact('report.json'),elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;}

