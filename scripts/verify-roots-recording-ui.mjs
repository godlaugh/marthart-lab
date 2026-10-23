import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodePng} from './lib/verify-png.mjs';
import {verifyRecordingVideo} from './lib/verify-recording-video.mjs';
const out=process.argv[2]??'.cache/roots-recording-video-20261023/ui';await mkdir(out,{recursive:true});
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
const raw=JSON.parse(await readFile('.cache/roots-completed-run-20261023/one-input.json','utf8'));raw.sampling.sample_count=128;raw.settings.dot_size=.03;raw.settings.max_splat_points_per_frame=256;
const paths=['scripts/lib/verify-recording-video.mjs','scripts/lib/verify-png.mjs','src/engine/sourceFormulaCompositor.ts','src/engine/formulaCanvas.ts','src/engine/rootsNativeViewTransform.ts','src/engine/rootsNativeDensityGpu.ts','src/engine/rootsNativePresentationSession.ts','src/engine/sourceRootsRecordingLease.ts','src/engine/generationInput.ts','src/types.ts','src/locales/components.en.json','src/App.tsx','src/components/ExportDialog.tsx','src/engine/recordingVideoDelivery.ts','server/index.mjs','scripts/verify-roots-recording-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Actual Roots App/Worker/GPU/glyph service/FFmpeg. Dynamic completion, manual stop, cancel, warmup-only, recovery and real decoded video. No original full-video pixel-parity claim.',sourceBefore:await hashes(),cases:[]};
let server,service,browser,page;const started=performance.now();
function audit(){const W=window.Worker,a=window.__record={sequence:0,rows:[],errors:[],captures:[],captureBytes:0};window.Worker=class extends W{
 pending=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=this.pending.get(data.id);if(!request||request.operation!==data.operation)return;this.pending.delete(data.id);if(request.operation==='source-recording-frame'&&data.output?.pixels){const bytes=data.output.pixels.byteLength;if(a.captures.length>=128||a.captureBytes+bytes>96*1024**2)throw Error('Recording audit capture budget');const copy=structuredClone(data.output);a.captureBytes+=bytes;a.captures.push({sequence:request.sequence,output:copy});}const strip=o=>{if(!o)return;const{pixels,...facts}=o;return facts;},row={sequence:request.sequence,request,output:strip(data.output),error:data.error};if(data.result)row.result={...data.result,warmup:strip(data.result.warmup),preview:strip(data.result.preview)};a.rows.push(row);if(data.error)a.errors.push(row);});}
 postMessage(m,...args){this.pending.set(m.id,{...structuredClone(m),sequence:++a.sequence});return super.postMessage(m,...args);}
};}
async function run(kind,origin){
 const row={kind,status:'running'},creates=[],uploads=[],finishes=[],expectedFrames=[];report.cases.push(row);
 page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:kind==='cloud'?2:1,acceptDownloads:true});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(audit);
 page.on('request',r=>{const u=new URL(r.url());if(r.method()==='POST'&&u.pathname==='/api/exports')creates.push(JSON.parse(r.postData()));if(r.method()==='POST'&&u.pathname.endsWith('/frames'))uploads.push({index:Number(u.searchParams.get('index')),bytes:r.postDataBuffer()});if(r.method()==='POST'&&u.pathname.endsWith('/finish'))finishes.push(JSON.parse(r.postData()));});
 const value=structuredClone(raw);if(kind==='animated')value.timeline=JSON.parse(await readFile('.cache/roots-animated-reference-20261023/input.json','utf8')).timeline;value.name='Roots video '+kind;
 if(kind==='cloud')value.settings.render_mode='GPU_3D';
 if(['manual','cancel','warmup'].includes(kind)){value.sampling.sample_count=1_000_000;value.timeline=[{type:'wait',duration:kind==='warmup'?.001:60}];}
 row.inputSha256=sha(JSON.stringify(value));await writeFile(out+'/'+kind+'-input.json',JSON.stringify(value,null,2)+'\n');
 try{
  await page.route('**/expected-frame/*',async route=>{const index=Number(new URL(route.request().url()).pathname.split('/').at(-1));check(index===expectedFrames.length,'Expected frame order');const bytes=route.request().postDataBuffer();check(index<128&&expectedFrames.reduce((n,b)=>n+b.length,0)+bytes.length<=96*1024**2,'Expected frame budget');expectedFrames.push(bytes);await route.fulfill({status:200,body:'ok'});});
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
  for(const [name,v]of[['Export width',kind==='animated'?'256':kind==='cloud'?'65':'64'],['Export height',kind==='animated'?'192':kind==='cloud'?'49':'48'],['Export frame rate',kind==='animated'?'30':'12']])await page.getByRole('spinbutton',{name,exact:true}).fill(v);
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
   check(creates[0].width===(kind==='animated'?256:64)&&creates[0].height===(kind==='animated'?192:48)&&creates[0].fps===(kind==='animated'?30:12),'Requested video dimensions/rate changed');
   check(uploads.every((r,i)=>r.index===i),'non-contiguous uploads');check(finishes.every(f=>f.finalFrames===uploads.length),'finish count mismatch');
   const file=out+'/'+kind+'.mp4';await downloads[0].saveAs(file);
   const expectedFacts=await page.evaluate(async boundary=>{
    const{compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts');
    const captures=window.__record.captures.filter(c=>c.sequence>boundary),facts=[];
    for(let i=0;i<captures.length;i++){
     const{output:o,sequence}=captures[i],pixels=await compositeSourceFormulaPixels(o.pixels,o.width,o.height,o.formulaPresentation);
     const response=await fetch('/expected-frame/'+i,{method:'POST',body:pixels});if(!response.ok)throw Error('Expected frame transport failed');
     facts.push({index:i,sequence,width:o.width,height:o.height,frame:o.rootsLive.frame.frame,sceneTime:o.rootsLive.sceneTime,camera:o.rootsLive.frame.camera,gradient:o.rootsLive.frame.gradient.offset});
    }window.__record.captures=[];return facts;
   },boundary);
   check(expectedFrames.length===uploads.length&&expectedFacts.length===frames.length,'Worker/output/upload count differs');
   for(let i=0;i<uploads.length;i++){const png=decodePng(uploads[i].bytes);check(png.width===creates[0].inputWidth&&png.height===creates[0].inputHeight,'input size mismatch');check(png.rgba.equals(expectedFrames[i]),'Uploaded PNG differs from composed Worker frame '+i);check(expectedFacts[i].sequence===frames[i].sequence,'Worker frame order mismatch');}
   const verified=verifyRecordingVideo(file,creates[0],expectedFrames,out+'/'+kind+'-raw-reference.mp4');
   row.video={path:file,sha256:sha(await readFile(file)),...verified,workerFrames:expectedFacts,allUploadedPngsExact:true};
   if(kind==='animated'){check(verified.distinctFrames>1&&verified.sequenceSensitivity,'Animated video did not change');check(new Set(expectedFacts.map(f=>JSON.stringify(f.camera))).size>1,'Animated camera did not change');check(new Set(expectedFacts.map(f=>f.gradient)).size>1,'Animated gradient did not change');}
   if(kind==='cloud')check(frames.at(-1).output.rootsPresentation.mode==='point-cloud','cloud mode not exercised');
   if(kind==='density'||kind==='cloud'||kind==='playing'||kind==='animated')check(frames.at(-1).output.roots.rootPoints===1280&&frames.at(-1).output.rootsLive.recording.complete,'natural completion omitted roots');
   if(kind==='recovery')check(lostUpload&&lostFinish&&lostStatus,'recovery not exercised');
  }
  await page.screenshot({path:out+'/'+kind+'-complete.png'});check(errors.length===0,'page errors '+errors.join(';'));row.status='passed';
 }catch(e){row.status='failed';row.error=e.stack??String(e);await page.screenshot({path:out+'/'+kind+'-failure.png'}).catch(()=>{});row.body=await page.locator('body').innerText();row.audit=await page.evaluate(()=>{const{captures,...facts}=window.__record;return{...facts,capturedFrames:captures.length};});}
 finally{await page.close();page=undefined;console.log(JSON.stringify({kind,status:row.status,error:row.error,frames:row.displayFrames}));}
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
 const backend=JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json','utf8'));service=await createExportServer({root:out+'/exports',glyphBackend:backend,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const kind of ['density','cloud','playing','animated','manual','cancel','warmup','recovery']){await run(kind,server.resolvedUrls.local[0]);if(report.cases.at(-1).status!=='passed')break;}
 report.status=report.cases.length===8&&report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(e){report.status='failed';report.error=e.stack??String(e);}
finally{await browser?.close();await server?.close();await service?.close();report.remainingServiceProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.seconds=(performance.now()-started)/1000;if(!report.sourceStable||report.remainingServiceProcesses!==0)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,remainingServiceProcesses:report.remainingServiceProcesses}));if(report.status!=='passed')process.exitCode=1;}
