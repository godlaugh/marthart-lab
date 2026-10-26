/** Packaged public controls, native HTTP acknowledgements, PNG downloads and
 * complete application exit/reopen. No source module injection or GUI focus. */
import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import net from 'node:net';
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
import {pngFacts} from './domain-native-production-ui.mjs';
const [bundleArg,referenceArg,outArg]=process.argv.slice(2);assert(bundleArg&&referenceArg&&outArg,'Supply bundle, passed native UI report, output directory');
const bundle=path.resolve(bundleArg),out=path.resolve(outArg),reference=JSON.parse(await readFile(referenceArg));assert.equal(reference.status,'passed');assert.equal(reference.ui.status,'passed');await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),resources=bundle+'/Contents/Resources',manifest=JSON.parse(await readFile(resources+'/source-renderer/manifest.json')),asar=resources+'/app.asar';
assert.equal(sha(await readFile(resources+'/source-renderer/'+manifest.executable)),manifest.sha256);
const source=structuredClone(reference.ui.source);source.name='Packaged Domain acceptance';
const report={status:'running',at:new Date().toISOString(),bundle,reference:referenceArg,referenceSha256:sha(await readFile(referenceArg)),source,manifest,asarSha256:sha(await readFile(asar)),runs:[],wire:[],errors:[],scope:'Hidden packaged Domain import/current+replay PNG/native preview/save/exit/reopen on the same Mac. Comparison aligns both launches with the public Return to start control; it does not claim the playhead position persists. No original GUI or second-device claim.'};
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];
const exec=promisify(execFile),started=performance.now(),pending=new Set();let app,page,processOwner,run;
const rows=async()=>{const{stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=']);return stdout.trim().split('\n').map(x=>{const m=x.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);assert(m);return{pid:+m[1],ppid:+m[2],pgid:+m[3],start:m[4]};});};
const closed=async origin=>new Promise((resolve,reject)=>{const s=net.createConnection({host:'127.0.0.1',port:Number(new URL(origin).port)});s.setTimeout(1500,()=>{s.destroy();reject(Error('App port timeout'));});s.once('connect',()=>{s.destroy();reject(Error('App port still open'));});s.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});
async function closeApp(){if(!app)return;await Promise.allSettled([...pending]);await app.close();app=undefined;run.exitCode=processOwner.exitCode;assert.equal(run.exitCode,0);run.processGroupAfter=(await rows()).filter(p=>p.pgid===run.owner.pgid);assert.deepEqual(run.processGroupAfter,[]);await closed(run.origin);run.portClosed=true;}
try{
 for(const phase of ['initial','reopen']){
  const mark=report.wire.length;app=await _electron.launch({executablePath:bundle+'/Contents/MacOS/MathArt Lab 2 Preview',args:['--mathart-hidden','--mathart-user-data='+out+'/profile'],env,timeout:30000});processOwner=app.process();const owner=(await rows()).find(r=>r.pid===processOwner.pid);assert(owner);assert.equal(owner.pgid,owner.pid);
  const runtime=await app.evaluate(({app,BrowserWindow})=>({version:app.getVersion(),userData:app.getPath('userData'),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length}));assert.equal(runtime.version,'2.0.0-preview.9');assert.equal(runtime.visibleWindows,0);
  await app.evaluate(({session})=>{globalThis.__domainDownloads=[];session.fromPartition('persist:mathart-lab').on('will-download',(_event,item)=>{const row={state:'pending'};globalThis.__domainDownloads.push(row);item.once('done',(_event,state)=>{row.state=state;row.path=item.getSavePath();});});});
  page=await app.firstWindow();await page.setViewportSize({width:1120,height:760});page.setDefaultTimeout(30000);run={phase,owner,runtime,origin:new URL(page.url()).origin,images:[]};report.runs.push(run);page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('response',response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return;const task=(async()=>{const header=inspectSourceFrameHeader(response.request().postDataBuffer());assert(header.ok);const row={...header.value,status:response.status(),renderer:response.headers()['x-source-renderer']};report.wire.push(row);assert.equal(row.status,200);})().catch(e=>report.errors.push(String(e)));pending.add(task);task.finally(()=>pending.delete(task));});
  const ready=()=>page.waitForFunction(()=>{const t=document.querySelector('.status-bar')?.textContent;return(t?.includes('Ready')||t?.includes('就绪'))&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');});
  await ready();run.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));assert.equal(run.health.available,true);
  if(phase==='initial'){
   await page.getByTitle('工作区设置',{exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close settings',exact:true}).click();
   await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'domain.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  }
  await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),source.name);await page.getByTestId('domain-render-summary').waitFor();await ready();run.summary=await page.getByTestId('domain-render-summary').innerText();assert.match(run.summary,/原生 GPU|Native GPU/);assert(await page.getByRole('button',{name:'Play',exact:true}).count(),'Imported/reopened source stays paused');
  // Startup preview can be a deterministic first-frame reconstruction. Compare
  // images only after the same public Return to start action on both launches.
  const resetMark=report.wire.length;await page.getByTitle('Return to start',{exact:true}).click();const resetDeadline=performance.now()+30000;while(!report.wire.slice(resetMark).some(r=>!r.family&&r.status===200)&&performance.now()<resetDeadline)await new Promise(r=>setTimeout(r,50));assert(report.wire.slice(resetMark).some(r=>!r.family&&r.status===200),'Return to start did not redraw');await ready();run.alignedSummary=await page.getByTestId('domain-render-summary').innerText();if(phase==='reopen')assert.equal(run.alignedSummary,report.runs[0].alignedSummary);
  for(const mode of phase==='initial'?['current','replay']:['current']){
   await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Domain image source',exact:true}).selectOption(mode);if(mode==='current')await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('96');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('80');
   const index=await app.evaluate(()=>globalThis.__domainDownloads.length);await page.getByRole('button',{name:'Start export',exact:true}).click();let download;const deadline=performance.now()+30000;
   while(performance.now()<deadline){download=await app.evaluate((_args,i)=>globalThis.__domainDownloads[i],index);if(download?.state&&download.state!=='pending')break;const errors=await page.locator('.export-dialog .error-card').allTextContents();if(errors.length)throw Error(errors.join('\n'));await new Promise(r=>setTimeout(r,50));}
   assert.equal(download?.state,'completed');const bytes=await readFile(download.path),decoded=pngFacts(bytes);assert.equal(decoded.width,96);assert.equal(decoded.height,80);assert(decoded.colors>1);const file=out+'/'+phase+'-'+mode+'.png';await writeFile(file,bytes);run.images.push({mode,file,pngSha256:sha(bytes),decoded});await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
  }
  if(phase==='initial')await page.getByRole('button',{name:'Save',exact:true}).click();
  run.saved=await page.evaluate(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);});assert.equal(run.saved.kind,'domain');assert.equal(run.saved.parameters.a,1);
  if(phase==='reopen'){assert.deepEqual(run.saved,report.runs[0].saved);assert.equal(run.images[0].decoded.rgbaSha256,report.runs[0].images[0].decoded.rgbaSha256,'Save/exit/reopen and Return to start preserve aligned current PNG');}
  await Promise.all([...pending]);assert(report.wire.slice(mark).some(r=>!r.family&&r.status===200&&r.renderer===run.health.rendererIdentity),'Bundled renderer did not acknowledge a Domain drawing');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length),0);await page.screenshot({path:out+'/'+phase+'.png'});await closeApp();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:out+'/failed.png'}).catch(()=>{});report.body=await page?.locator('body').innerText().catch(()=>undefined);}
finally{try{await closeApp();}catch(error){report.status='failed';report.cleanupError=String(error);process.exitCode=1;}report.asarUnchanged=report.asarSha256===sha(await readFile(asar));if(!report.asarUnchanged){report.status='failed';process.exitCode=1;}report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:out+'/report.json'}));}
