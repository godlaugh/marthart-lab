/** Packaged, hidden source Implicit GPU-material smoke. No development server,
 * source replacement, visible window, original runtime or GPU parity claim.
 * Usage: node scripts/verify-implicit-native-desktop.mjs BUNDLE SOURCE_JSON NEW_OUTPUT
 * CPU preflight: node scripts/verify-implicit-native-desktop.mjs --check-sources */
import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {decodePng} from './lib/verify-png.mjs';

const SOURCE='.cache/source-implicit-gpu-reference-20261027/source-gpu.json',INPUT_SHA='9e774614618f7a10c02ad737fcf9acac0d80bba9271c6123cc4d45d1a5b0cf40';
const sha=b=>createHash('sha256').update(b).digest('hex'),files=['scripts/verify-implicit-native-desktop.mjs','scripts/lib/verify-png.mjs'];
const pins=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(f))])));
if(process.argv[2]==='--check-sources'){
 assert.equal(process.argv.length,3);assert.equal(sha(await readFile(SOURCE)),INPUT_SHA);
 console.log(JSON.stringify({status:'cpu-ready',source:SOURCE,sourceSha256:INPUT_SHA,pins:await pins(),execution:'No Electron/native/GPU started'}));process.exit(0);
}
assert.equal(process.argv.length,5,'Supply BUNDLE SOURCE_JSON NEW_OUTPUT');
const [bundle,sourcePath,out]=process.argv.slice(2).map(p=>path.resolve(p)),profile=path.join(out,'profile'),input=await readFile(sourcePath),source=JSON.parse(input);
assert.equal(sha(input),INPUT_SHA);assert.equal(source.type,'IMPLICIT');assert.equal(source.settings.mesh_mode,'GPU');assert.equal(source.settings.x_segments,60);assert.equal(source.settings.y_segments,60);assert.equal(source.settings.z_segments,60);
const resources=path.join(bundle,'Contents/Resources'),asar=path.join(resources,'app.asar'),manifestPath=path.join(resources,'source-renderer/manifest.json'),manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);
assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);assert.equal(manifest.executable,'source-cgl-renderer');
const helper=await realpath(path.join(resources,'source-renderer',manifest.executable));assert.equal(sha(await readFile(helper)),manifest.sha256);
const identity=sha(JSON.stringify({executable:helper,executableSha256:manifest.sha256,host:[process.platform,process.arch,os.release(),os.version()]}));
await mkdir(out,{recursive:false});await writeFile(path.join(out,'input.json'),input);
const report={status:'running',at:new Date().toISOString(),scope:'Single hidden packaged preview.16: public exact-source import, source GPU material with CPU mesh computation, bundled native frame receipts, actual 500x600 PNG and source formula/glyph markers, full exit cleanup.',limits:['No original image comparison, first/dirty viewport parity, recording, save/reopen or other families are claimed.','Observers copy/hash actual payloads and add scheduling cost; elapsed time is not a throughput benchmark.','Formula markers, actual glyph receipts, composition input and encoded download are bound; this is not an independent glyph-placement oracle.'],command:{node:process.version,argv:process.argv.slice(1)},bundle,sourcePath,sourceSha256:sha(input),manifest,manifestSha256:sha(manifestBytes),asarSha256:sha(await readFile(asar)),helper,rendererIdentity:identity,verifierBefore:await pins(),wire:[],worker:[],glyph:[],errors:[]};
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];
const exec=promisify(execFile),started=performance.now();let app,page,child;
const processes=async()=>{const{stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=']);return stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);assert(m);return{pid:+m[1],ppid:+m[2],pgid:+m[3],start:m[4]};});};
const portClosed=port=>new Promise((resolve,reject)=>{const s=net.createConnection({host:'127.0.0.1',port});s.setTimeout(1500,()=>{s.destroy();reject(Error('Port close timeout'));});s.once('connect',()=>{s.destroy();reject(Error('Owned port remains open'));});s.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});
const ready=()=>page.waitForFunction(()=>/Ready|就绪/.test(document.querySelector('.status-bar')?.textContent??'')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
async function hidden(){const result=await app.evaluate(({BrowserWindow})=>({visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length,showEvents:globalThis.__implicitShows}));assert.equal(result.visibleWindows,0);assert.deepEqual(result.showEvents,[]);return result;}
function install(){
 if(window.__implicitSmoke)return;const state=window.__implicitSmoke={pending:0,sequence:0,workerId:0};
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const encode=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);};
 const observe=fn=>{state.pending++;Promise.resolve().then(fn).catch(e=>window.__implicitError(String(e.stack??e))).finally(()=>state.pending--);};
 const NativeWorker=window.Worker;window.Worker=new Proxy(NativeWorker,{construct(Target,args){const w=new Target(...args),workerId=++state.workerId,post=w.postMessage.bind(w),requests=new Map();
  w.postMessage=function(m,...rest){
   if(m?.operation==='generate')requests.set(m.id,structuredClone({id:m.id,sceneId:m.scene.id,sceneKind:m.scene.kind,formulaLayout:m.scene.formulas?.layout,context:m.context}));
   if(m?.operation==='encode-source-paused-png'){const pixels=m.pixels.slice(),row={kind:'encode-input',workerId,id:m.id,sequence:++state.sequence,width:m.width,height:m.height,scale:m.scale};observe(async()=>window.__implicitEvidence({...row,pixels:encode(pixels),sha256:await hash(pixels)}));}
   return post(m,...rest);
  };
  w.addEventListener('message',({data:d})=>{
   if(d?.operation==='generate'&&d.output?.sourceImplicitPresentation){const o=d.output,p=o.sourceImplicitPresentation,row={kind:'generate',workerId,id:d.id,sequence:++state.sequence,request:requests.get(d.id),output:structuredClone({type:o.type,backend:o.backend,positions:o.positions.length,model:p.model,meshMode:p.meshMode,meshComputation:p.meshComputation,referencePixelDensity:p.referencePixelDensity,formulaPresentation:o.formulaPresentation,sourceCameraFrame:o.sourceCameraFrame,implicit:o.implicit})};observe(()=>window.__implicitEvidence(row));requests.delete(d.id);}
   if(d?.operation==='encode-source-paused-png'&&d.result?.blob){const blob=d.result.blob,row={kind:'encode-output',workerId,id:d.id,sequence:++state.sequence,width:d.result.width,height:d.result.height};observe(async()=>{const b=new Uint8Array(await blob.arrayBuffer());return window.__implicitEvidence({...row,png:encode(b),sha256:await hash(b)});});}
  });return w;
 }});
 const fetch=window.fetch;window.fetch=async function(input,init){
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),native=url.pathname==='/api/source-renderer/frames',glyph=url.pathname==='/api/formula-glyph';
  if(!native&&!glyph)return fetch.call(this,input,init);
  const body=init?.body,bytes=native&&ArrayBuffer.isView(body)?new Uint8Array(body.buffer,body.byteOffset,body.byteLength):undefined;
  const facts=bytes?{header:Array.from(bytes.subarray(0,60)),length:bytes.length}:undefined,request=glyph?JSON.parse(body):undefined;
  const response=await fetch.call(this,input,init);
  try{const b=new Uint8Array(await response.clone().arrayBuffer());await window.__implicitEvidence({kind:native?'native':'glyph',sequence:++state.sequence,facts,request,status:response.status,headers:Object.fromEntries(response.headers),bytes:b.length,sha256:await hash(b),...(native&&facts&&new DataView(Uint8Array.from(facts.header).buffer).getUint32(20,true)===500?{pixels:encode(b)}:{})});}catch(e){await window.__implicitError(String(e.stack??e));}return response;
 };
}
try{
 app=await _electron.launch({executablePath:path.join(bundle,'Contents/MacOS/MathArt Lab 2 Preview'),args:['--mathart-hidden','--mathart-user-data='+profile],env,timeout:30000});child=app.process();report.owner=(await processes()).find(p=>p.pid===child.pid);assert(report.owner);assert.equal(report.owner.pgid,child.pid);
 report.runtime=await app.evaluate(({app,BrowserWindow,session})=>{globalThis.__implicitShows=[];globalThis.__implicitDownloads=[];const watch=w=>w.on('show',()=>globalThis.__implicitShows.push({id:w.id,at:Date.now()}));BrowserWindow.getAllWindows().forEach(watch);app.on('browser-window-created',(_e,w)=>watch(w));session.fromPartition('persist:mathart-lab').on('will-download',(_e,item)=>{const d={state:'pending'};globalThis.__implicitDownloads.push(d);item.once('done',(_e,state)=>{d.state=state;d.path=item.getSavePath();});});return{name:app.getName(),version:app.getVersion(),userData:app.getPath('userData'),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length};});
 assert.equal(report.runtime.version,'2.0.0-preview.16');assert.equal(report.runtime.name,'MathArt Lab 2 Preview');assert.equal(path.resolve(report.runtime.userData),profile);assert.equal(report.runtime.visibleWindows,0);
 page=await app.firstWindow();page.setDefaultTimeout(60000);report.origin=new URL(page.url()).origin;assert.equal(new URL(report.origin).hostname,'127.0.0.1');page.on('pageerror',e=>report.errors.push(String(e.stack??e)));
 await page.exposeFunction('__implicitError',e=>report.errors.push(e));
 await page.exposeFunction('__implicitEvidence',async row=>{try{
  if(row.pixels||row.png){const bytes=Buffer.from(row.pixels??row.png,'base64');assert.equal(sha(bytes),row.sha256);row.file=path.join(out,`${row.sequence}-${row.kind}.${row.png?'png':'rgba'}`);await writeFile(row.file,bytes);delete row.pixels;delete row.png;}
  if(row.kind==='native'){
   const h=Buffer.from(row.facts.header),u=n=>h.readUInt32LE(n);assert.equal(u(0),0x31464c4d);assert([3,12].includes(u(4)),'Expected complete generic source drawing, not another retained family');assert.equal(u(8),row.facts.length);row.frame={version:u(4),generation:u(12),sequence:u(16),width:u(20),height:u(24),samples:u(52)};
   assert.equal(row.status,200);assert.equal(row.headers['x-source-renderer'],identity);assert.equal(row.headers['x-source-format'],'rgba8');assert.equal(row.headers['x-source-row-order'],'bottom-up');for(const k of ['generation','sequence','width','height'])assert.equal(Number(row.headers['x-source-'+k]),row.frame[k]);assert(Number(row.headers['x-source-context'])>0);assert(Number(row.headers['x-source-session'])>0);assert.equal(row.bytes,row.frame.width*row.frame.height*4);assert.equal(Number(row.headers['content-length']),row.bytes);row.validated=true;report.wire.push(row);
  }else if(row.kind==='glyph'){assert.equal(row.status,200);assert.equal(row.headers['x-glyph-format'],'straight-rgba8');assert.equal(row.bytes,Number(row.headers['x-glyph-width'])*Number(row.headers['x-glyph-height'])*4);report.glyph.push(row);}else report.worker.push(row);
 }catch(e){report.errors.push(String(e.stack??e));}});
 await page.evaluate(install);await ready();report.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));assert.equal(report.health.available,true);assert.equal(report.health.rendererIdentity,identity);report.glyphHealth=await page.evaluate(()=>fetch('/api/formula-glyph/health').then(r=>r.json()));assert.equal(report.glyphHealth.available,true);
 await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'implicit-gpu.json',mimeType:'application/json',buffer:input});await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),source.name);await ready();await page.getByTestId('native-art-canvas').waitFor({state:'visible'});await page.waitForFunction(()=>window.__implicitSmoke.pending===0);
 const preview=report.worker.findLast(w=>w.kind==='generate');assert(preview);assert.equal(preview.output.type,'geometry');assert.equal(preview.output.backend,'cpu');assert.equal(preview.output.model,'mathart-1.7.8-gpu-material-v1');assert.equal(preview.output.meshMode,'GPU');assert.equal(preview.output.meshComputation,'source-cpu-fallback');assert(preview.output.positions>0);assert.equal(preview.output.formulaPresentation.layout,'source-surface-centered-v1');assert.equal(preview.output.formulaPresentation.labels.length,1);assert.equal(preview.request.formulaLayout,'source-surface-centered-v1');report.preview=preview;assert(report.wire.some(w=>w.validated&&w.frame.samples>0));report.hiddenBefore=await hidden();
 await page.getByRole('button',{name:/^(Export artwork|导出作品)$/}).click();await page.getByRole('combobox',{name:/^(Export resolution|导出分辨率)$/}).selectOption('custom');await page.getByRole('spinbutton',{name:/^(Export width|导出宽度)$/}).fill('500');await page.getByRole('spinbutton',{name:/^(Export height|导出高度)$/}).fill('600');
 const mark=report.worker.length,wireMark=report.wire.length;await page.getByRole('button',{name:/^(Start export|开始导出)$/}).click();
 let download;for(let deadline=performance.now()+90000;performance.now()<deadline;){download=await app.evaluate(()=>globalThis.__implicitDownloads[0]);if(download?.state&&download.state!=='pending')break;assert.deepEqual(report.errors,[]);await new Promise(r=>setTimeout(r,100));}assert.equal(download?.state,'completed');await page.waitForFunction(()=>window.__implicitSmoke.pending===0);
 const downloaded=await realpath(download.path),downloads=await realpath(path.join(profile,'downloads'));assert(downloaded.startsWith(downloads+path.sep));const png=await readFile(downloaded),decoded=decodePng(png);assert.equal(decoded.width,500);assert.equal(decoded.height,600);await writeFile(path.join(out,'implicit-500x600.png'),png);
 const exports=report.worker.slice(mark),inputs=exports.filter(w=>w.kind==='encode-input'),outputs=exports.filter(w=>w.kind==='encode-output');assert.equal(inputs.length,1);assert.equal(outputs.length,1);assert.equal(inputs[0].workerId,outputs[0].workerId);assert.equal(inputs[0].id,outputs[0].id);assert.deepEqual([inputs[0].width,inputs[0].height,inputs[0].scale],[500,600,1]);assert.equal(outputs[0].sha256,sha(png));
 const draw=report.wire.slice(wireMark).filter(w=>w.validated&&w.frame.width===500&&w.frame.height===600&&w.frame.samples===0);assert.equal(draw.length,1);const bottom=await readFile(draw[0].file),top=Buffer.alloc(bottom.length);for(let y=0;y<600;y++)bottom.copy(top,y*2000,(599-y)*2000,(600-y)*2000);const composed=await readFile(inputs[0].file);assert.notEqual(sha(top),sha(composed),'No observed formula contribution');for(let i=3;i<composed.length;i+=4)assert.equal(composed[i],decoded.rgba[i],'PNG alpha differs from actual composition');
 for(const l of preview.output.formulaPresentation.labels){const g=report.glyph.find(g=>g.request.latex===l.latex&&g.request.color.toLowerCase()===l.color.toLowerCase());assert(g);assert.equal(g.headers['x-glyph-renderer'],report.glyphHealth.rendererIdentity);}
 report.png={path:path.join(out,'implicit-500x600.png'),sha256:sha(png),rgbaSha256:sha(decoded.rgba),native:draw[0],composition:inputs[0],encoded:outputs[0]};await page.getByRole('button',{name:/^(Close export|关闭导出)$/}).click();await ready();report.hiddenAfter=await hidden();assert.deepEqual(report.errors,[]);await page.screenshot({path:path.join(out,'hidden-final.png')});report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;report.body=await page?.locator('body').innerText().catch(()=>undefined);await page?.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});
}finally{
 try{if(app){const owned=(await processes()).filter(p=>p.pgid===report.owner?.pgid);report.ownedBeforeExit=owned;let ports=[];try{const{stdout}=await exec('/usr/sbin/lsof',['-nP','-a','-p',owned.map(p=>p.pid).join(','),'-iTCP','-sTCP:LISTEN','-Fn']);ports=[...new Set([...stdout.matchAll(/^n[^\n]*:(\d+)$/gm)].map(m=>+m[1]))];}catch(e){if(e.code!==1)throw e;}report.ownedPorts=ports;await app.close();app=undefined;report.exitCode=child.exitCode;assert.equal(child.exitCode,0);report.remainingOwnedProcesses=(await processes()).filter(p=>p.pgid===report.owner.pgid);assert.deepEqual(report.remainingOwnedProcesses,[]);for(const port of new Set([...ports,Number(new URL(report.origin).port)]))await portClosed(port);report.portsClosed=true;}}catch(e){report.status='failed';report.cleanupError=String(e.stack??e);process.exitCode=1;}
 report.asarUnchanged=sha(await readFile(asar))===report.asarSha256;report.helperUnchanged=sha(await readFile(helper))===manifest.sha256;report.manifestUnchanged=sha(await readFile(manifestPath))===report.manifestSha256;report.sourceUnchanged=sha(await readFile(sourcePath))===report.sourceSha256;report.verifierAfter=await pins();report.verifierStable=JSON.stringify(report.verifierBefore)===JSON.stringify(report.verifierAfter);if(!report.asarUnchanged||!report.helperUnchanged||!report.manifestUnchanged||!report.sourceUnchanged||!report.verifierStable){report.status='failed';process.exitCode=1;}
 report.seconds=(performance.now()-started)/1000;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,cleanupError:report.cleanupError,report:path.join(out,'report.json')}));
}
