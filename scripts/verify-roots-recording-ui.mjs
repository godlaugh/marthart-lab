import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodePng} from './lib/verify-png.mjs';
const out=process.argv[2]??'.cache/roots-recording-video-20261023/ui';await mkdir(out,{recursive:true});
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
const raw=JSON.parse(await readFile('.cache/roots-completed-run-20261023/one-input.json','utf8'));raw.sampling.sample_count=128;raw.settings.dot_size=.03;raw.settings.max_splat_points_per_frame=256;
const paths=['src/engine/rootsNativePresentationSession.ts','src/engine/sourceRootsRecordingLease.ts','src/engine/generationInput.ts','src/types.ts','src/locales/components.en.json','src/App.tsx','src/components/ExportDialog.tsx','src/engine/recordingVideoDelivery.ts','server/index.mjs','scripts/verify-roots-recording-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Actual Roots App/Worker/GPU/glyph service/FFmpeg. Dynamic completion, manual stop, cancel, warmup-only, recovery and real decoded video. No original full-video pixel-parity claim.',sourceBefore:await hashes(),cases:[]};
let server,service,browser,page;const started=performance.now();
function audit(){const W=window.Worker,a=window.__record={sequence:0,rows:[],errors:[]};window.Worker=class extends W{
 pending=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=this.pending.get(data.id);if(!request||request.operation!==data.operation)return;this.pending.delete(data.id);const strip=o=>{if(!o)return;const{pixels,...facts}=o;return facts;},row={sequence:request.sequence,request,output:strip(data.output),error:data.error};if(data.result)row.result={...data.result,warmup:strip(data.result.warmup),preview:strip(data.result.preview)};a.rows.push(row);if(data.error)a.errors.push(row);});}
 postMessage(m,...args){this.pending.set(m.id,{...structuredClone(m),sequence:++a.sequence});return super.postMessage(m,...args);}
};}
const waitIdle=()=>page.waitForFunction(()=>!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
async function run(kind,origin){
 const row={kind,status:'running'},creates=[],uploads=[],finishes=[];report.cases.push(row);
 page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:kind==='cloud'?2:1,acceptDownloads:true});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(audit);
 page.on('request',r=>{const u=new URL(r.url());if(r.method()==='POST'&&u.pathname==='/api/exports')creates.push(JSON.parse(r.postData()));if(r.method()==='POST'&&u.pathname.endsWith('/frames'))uploads.push({index:Number(u.searchParams.get('index')),bytes:r.postDataBuffer()});if(r.method()==='POST'&&u.pathname.endsWith('/finish'))finishes.push(JSON.parse(r.postData()));});
 const value=structuredClone(raw);value.name='Roots video '+kind;
 if(kind==='cloud')value.settings.render_mode='GPU_3D';
 if(['manual','cancel','warmup'].includes(kind)){value.sampling.sample_count=1_000_000;value.timeline=[{type:'wait',duration:kind==='warmup'?.001:60}];}
 try{
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  await page.evaluate(async ({raw,kind})=>{const{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');const scene=parseLegacyScene(JSON.stringify(raw)).scene;saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:kind==='cloud'?'high':'low',frameRate:30}});},{raw:value,kind});
  await page.goto(origin);await page.waitForFunction(()=>window.__record.rows.some(r=>r.output?.rootsLive));
  // A paused live preview may still be drawing. Opening the dialog must wait
  // for an actual frame, not for completion of the million-sample fixture.
  if(kind==='playing'){await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__record.rows.some(r=>r.output?.rootsLive?.paused===false));}
  const startLabel=kind==='recovery'?'Start export':'Start recording';
  await page.getByRole('button',{name:kind==='recovery'?'Export artwork':'Record',exact:true}).click();
  if(kind==='recovery')await page.getByRole('button',{name:'Animation video',exact:true}).click();else await page.getByRole('dialog',{name:'Roots recording',exact:true}).waitFor();
  check(await page.getByRole('combobox',{name:'Roots video mode',exact:true}).inputValue()==='retained','recording entry did not select live mode');
  if(kind==='manual'){
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start recording'&&!b.disabled));const seq=await page.evaluate(()=>window.__record.sequence);
   await page.getByRole('button',{name:'Close export',exact:true}).click();await page.waitForFunction(seq=>window.__record.rows.some(r=>r.sequence>seq&&r.output?.rootsLive?.paused===true),seq);
   await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Roots recording',exact:true}).waitFor();row.pausedDrainResumedAfterClose=true;
  }
  for(const [name,v]of[['Export width',kind==='cloud'?'65':'64'],['Export height',kind==='cloud'?'49':'48'],['Export frame rate','12']])await page.getByRole('spinbutton',{name,exact:true}).fill(v);
  await page.getByRole('button',{name:startLabel,exact:true}).waitFor();
  const boundary=await page.evaluate(()=>window.__record.sequence);let lostUpload=false,lostFinish=false,lostStatus=false,finishedId;
  const handler=async route=>{const r=route.request(),p=new URL(r.url()).pathname;
   if(kind==='recovery'&&r.method()==='POST'&&p.endsWith('/frames')&&!lostUpload){lostUpload=true;check((await route.fetch()).ok(),'upload before injection');return route.abort('failed');}
   if(kind==='recovery'&&r.method()==='POST'&&p.endsWith('/finish')&&!lostFinish){lostFinish=true;const result=await route.fetch();check(result.ok(),'finish before injection');finishedId=(await result.json()).id;return route.abort('failed');}
   if(kind==='recovery'&&r.method()==='GET'&&p==='/api/exports/'+finishedId&&!lostStatus){lostStatus=true;return route.abort('failed');}
   return route.continue();
  };await page.route('**/api/exports**',handler);
  const downloads=[];page.on('download',d=>downloads.push(d));await page.getByRole('button',{name:startLabel,exact:true}).click();
  await page.waitForFunction(b=>window.__record.rows.some(r=>r.sequence>b&&r.request.operation==='source-recording-begin'),boundary);
  if(kind==='manual'||kind==='cancel'){
   await page.waitForFunction(b=>window.__record.rows.filter(r=>r.sequence>b&&r.request.operation==='source-recording-frame').length>=2,boundary);
   await page.screenshot({path:out+'/'+kind+'-recording.png'});
   check(!await page.locator('.export-info').innerText().then(s=>s.includes('%')),'unknown completion displayed percentage');
   await page.getByRole('button',{name:kind==='manual'?'Stop and save':'Cancel export',exact:true}).click();
  }
  if(kind==='recovery'){
   await page.getByRole('button',{name:'Retry save',exact:true}).waitFor({timeout:90000});
   check(await page.evaluate(b=>!window.__record.rows.some(r=>r.sequence>b&&r.request.operation==='source-recording-finish'),boundary),'unknown save released numerical owner');
   await page.getByRole('button',{name:'Retry save',exact:true}).click();
  }
  await page.waitForFunction(b=>window.__record.rows.some(r=>r.sequence>b&&r.request.operation==='source-recording-finish'),boundary,{timeout:90000});
  const a=await page.evaluate(b=>window.__record.rows.filter(r=>r.sequence>b),boundary),begin=a.find(r=>r.request.operation==='source-recording-begin'),frames=a.filter(r=>r.request.operation==='source-recording-frame'),stop=a.find(r=>r.request.operation==='source-recording-finish');
  check(!stop.error&&stop.result.preview.rootsLive.frame.frame===(frames.at(-1)?.output??begin.result.warmup).rootsLive.frame.frame,'stop advanced the clock');
  row.begin=begin;row.stop=stop;row.displayFrames=frames.length;row.creates=creates;row.uploads=uploads.map(x=>({index:x.index,sha256:sha(x.bytes)}));row.finishes=finishes;
  if(kind==='warmup'){check(creates.length===0&&uploads.length===0&&downloads.length===0,'warmup-only fabricated encoder');await page.locator('.export-error').filter({hasText:'No frames to save'}).waitFor();}
  else if(kind==='cancel'){check(downloads.length===0&&finishes.length===0,'cancel published a video');check((await readdir(out+'/exports')).every(n=>!n.includes('.partial.')),'cancel left partial file');}
  else{
   check(creates.length===1&&creates[0].frames===null,'unknown total was replaced with a plan');if(kind==='cloud')check(creates[0].inputWidth===196&&creates[0].inputHeight===148,'DPR 2 odd target rounding');check(uploads.length>0&&downloads.length===1,'video missing');
   check(uploads.every((r,i)=>r.index===i),'non-contiguous uploads');check(finishes.every(f=>f.finalFrames===uploads.length),'finish count mismatch');
   const file=out+'/'+kind+'.mp4';await downloads[0].saveAs(file);
   const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt,duration,color_range,color_space','-of','json',file],{encoding:'utf8'})).streams[0];
   check(meta.width===64&&meta.height===48&&Number(meta.nb_read_frames)===uploads.length&&meta.r_frame_rate==='12/1','video metadata mismatch');
   const decoded=execFileSync('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024**2});check(decoded.length===64*48*3*uploads.length,'decoded frame count');
   const colors=new Set();for(let i=0;i<decoded.length;i+=3)colors.add(decoded.subarray(i,i+3).toString('hex'));check(colors.size>8,'uniform video');
   const png=decodePng(uploads.at(-1).bytes);check(png.width===creates[0].inputWidth&&png.height===creates[0].inputHeight,'input size mismatch');
   row.video={path:file,sha256:sha(await readFile(file)),metadata:meta,decodedSha256:sha(decoded),colors:colors.size,lastPngSize:[png.width,png.height]};
   if(kind==='cloud')check(frames.at(-1).output.rootsPresentation.mode==='point-cloud','cloud mode not exercised');
   if(kind==='density'||kind==='cloud'||kind==='playing')check(frames.at(-1).output.roots.rootPoints===1280&&frames.at(-1).output.rootsLive.recording.complete,'natural completion omitted roots');
   if(kind==='recovery')check(lostUpload&&lostFinish&&lostStatus,'recovery not exercised');
  }
  await page.screenshot({path:out+'/'+kind+'-complete.png'});check(errors.length===0,'page errors '+errors.join(';'));row.status='passed';
 }catch(e){row.status='failed';row.error=e.stack??String(e);await page.screenshot({path:out+'/'+kind+'-failure.png'}).catch(()=>{});row.body=await page.locator('body').innerText();row.audit=await page.evaluate(()=>window.__record);}
 finally{await page.close();page=undefined;console.log(JSON.stringify({kind,status:row.status,error:row.error,frames:row.displayFrames}));}
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
 const backend=JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json','utf8'));service=await createExportServer({root:out+'/exports',glyphBackend:backend,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const kind of ['density','cloud','playing','manual','cancel','warmup','recovery']){await run(kind,server.resolvedUrls.local[0]);if(report.cases.at(-1).status!=='passed')break;}
 report.status=report.cases.length===7&&report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(e){report.status='failed';report.error=e.stack??String(e);}
finally{await browser?.close();await server?.close();await service?.close();report.remainingServiceProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.seconds=(performance.now()-started)/1000;if(!report.sourceStable)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,remainingServiceProcesses:report.remainingServiceProcesses}));if(report.status!=='passed')process.exitCode=1;}
