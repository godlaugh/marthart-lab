/** Public controls of the bundled application, with an isolated profile and
 * hidden windows. No source module injection or external renderer override. */
import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import net from 'node:net';
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
const [bundleArg,outArg]=process.argv.slice(2);assert(bundleArg&&outArg,'Supply app bundle and new output directory');
const bundle=path.resolve(bundleArg),out=path.resolve(outArg);await mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex'),resources=bundle+'/Contents/Resources',manifest=JSON.parse(await readFile(resources+'/source-renderer/manifest.json'));
const native=resources+'/source-renderer/'+manifest.executable,asar=resources+'/app.asar';assert.equal(sha(await readFile(native)),manifest.sha256);
const report={status:'running',at:new Date().toISOString(),bundle,manifest,asarSha256:sha(await readFile(asar)),scriptSha256:sha(await readFile(new URL(import.meta.url))),runs:[],wire:[],errors:[],scope:'Public packaged speed import/edit, real bundled native renderer and complete application exit/reopen. No original GUI, second device or new original-image comparison.'};
const exec=promisify(execFile),started=performance.now();
const rows=async()=>{const{stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=']);return stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);assert(m);return{pid:+m[1],ppid:+m[2],pgid:+m[3],start:m[4]};});};
const closed=async origin=>new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:Number(new URL(origin).port)});socket.setTimeout(1500,()=>{socket.destroy();reject(Error('App port timeout'));});socket.once('connect',()=>{socket.destroy();reject(Error('App port still open'));});socket.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];
let app,page,processOwner,run;
async function closeApp(){
 if(!app)return;await app.close();app=undefined;
 run.exitCode=processOwner.exitCode;assert.equal(run.exitCode,0);
 run.processGroupAfter=(await rows()).filter(p=>p.pgid===run.owner.pgid);assert.deepEqual(run.processGroupAfter,[]);
 await closed(run.origin);run.portClosed=true;
}
try{
 for(const phase of ['initial','reopen']){
  const mark=report.wire.length;
  app=await _electron.launch({executablePath:bundle+'/Contents/MacOS/MathArt Lab 2 Preview',args:['--mathart-hidden','--mathart-user-data='+out+'/profile'],env,timeout:30000});
  processOwner=app.process();const owner=(await rows()).find(row=>row.pid===processOwner.pid);assert(owner);assert.equal(owner.pgid,owner.pid);
  const runtime=await app.evaluate(({app,BrowserWindow})=>({name:app.getName(),version:app.getVersion(),userData:app.getPath('userData'),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length}));
  assert.equal(runtime.version,'2.0.0-preview.8');assert.equal(runtime.visibleWindows,0);
  page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(String(error)));
  run={phase,owner,runtime,origin:new URL(page.url()).origin};report.runs.push(run);
  page.on('response',response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return;try{const header=inspectSourceFrameHeader(response.request().postDataBuffer());assert(header.ok);if(header.value.family==='bouncing')report.wire.push({...header.value,status:response.status(),renderer:response.headers()['x-source-renderer']});}catch(error){report.errors.push(String(error));}});
  const ready=()=>page.waitForFunction(()=>{const status=document.querySelector('.status-bar')?.textContent;return (status?.includes('Ready')||status?.includes('就绪'))&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');});
  await ready();run.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));assert.equal(run.health.available,true);
  const field=page.getByTestId('source-bouncing-initialSpeed');
  if(phase==='initial'){
   await page.getByTitle('工作区设置',{exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close settings',exact:true}).click();
   const source={config_version:'1.0',type:'BOUNCING_PARTICLES',name:'Packaged speed acceptance',settings:{particle_count:64,seed:2,initial_speed:101,dot_size:3}};
   report.source=source;await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'speed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
   await field.waitFor();await ready();assert.equal(await field.inputValue(),'101');
   await page.getByTestId('source-bouncing-seek').fill('3');await page.getByTestId('source-bouncing-seek').press('Enter');
   await page.waitForFunction(()=>document.querySelector('[data-testid="source-bouncing-update-count"]')?.textContent==='Update count 3');await ready();
   const editMark=report.wire.length;
   await field.fill('102');await field.blur();await page.waitForFunction(()=>document.querySelector('[data-testid="source-bouncing-update-count"]')?.textContent==='Update count 0');await ready();
   assert.equal(await field.inputValue(),'102');assert(report.wire.slice(editMark).some(row=>row.operation===1),'Author-only edit did not create fresh native simulation state');
   await page.getByRole('button',{name:'Save',exact:true}).click();
  }else{
   await field.waitFor();await ready();assert.equal(await field.inputValue(),'102');
   assert.notEqual(run.origin,report.runs[0].origin);assert.equal(run.runtime.userData,report.runs[0].runtime.userData);
  }
  await page.waitForFunction(()=>{const workspace=JSON.parse(localStorage.getItem('mathart-lab-v1')??'null'),scene=workspace?.drafts?.[workspace.active]??workspace?.scenes?.find(s=>s.id===workspace.active);return scene?.bouncingSource?.authoring?.initialSpeed===102&&scene.bouncingSource.configuration.initialSpeed===100;});
  run.saved=await page.evaluate(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return (w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active)).bouncingSource;});
  if(phase==='reopen')assert.deepEqual(run.saved,report.runs[0].saved);
  assert(report.wire.slice(mark).some(row=>row.operation===2&&row.status===200&&row.renderer===run.health.rendererIdentity),'Bundled native renderer did not present');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length),0);
  await page.screenshot({path:out+'/'+phase+'.png'});await closeApp();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page&&!page.isClosed()){report.body=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 try{await closeApp();}catch(error){report.status='failed';report.cleanupError=String(error);process.exitCode=1;}
 report.asarStable=report.asarSha256===sha(await readFile(asar));report.nativeStable=manifest.sha256===sha(await readFile(native));
 if(!report.asarStable||!report.nativeStable||report.errors.length){report.status='failed';process.exitCode=1;}
 report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:out+'/report.json'}));
}
