/** Actual packaged controls and downloads. No source modules or engine patches
 * are loaded into the application. Cross-package PNG checks are local workflow
 * regression evidence, not additional original-application image oracles. */
import {_electron} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
import {decodePng} from './lib/verify-png.mjs';
const [bundleArg,referenceArg]=process.argv.slice(2);assert(bundleArg&&referenceArg,'Supply packaged bundle and passed production report');
const bundle=path.resolve(bundleArg),reference=JSON.parse(await readFile(referenceArg,'utf8'));assert.equal(reference.status,'passed');assert.equal(reference.ui.status,'passed');
await mkdir('.cache',{recursive:true});const root=await mkdtemp(path.resolve('.cache/fractal-native-desktop-')),sha=b=>createHash('sha256').update(b).digest('hex'),resources=bundle+'/Contents/Resources',manifest=JSON.parse(await readFile(resources+'/source-renderer/manifest.json','utf8'));
assert.equal(sha(await readFile(resources+'/source-renderer/'+manifest.executable)),manifest.sha256);
const report={at:new Date().toISOString(),bundle,directory:root,reference:referenceArg,referenceSha256:sha(await readFile(referenceArg)),nativeManifest:manifest,appAsarSha256:sha(await readFile(resources+'/app.asar')),wire:[],images:[],errors:[],originalExecuted:false,scope:'Hidden packaged Fractal import, native preview, current/replay PNG; PNG RGBA compared with the separately passed public Generator/UI run on this Mac.'};
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];
const exec=promisify(execFile),started=performance.now(),pending=new Set();let app,page,origin,pid,pgid,ownedProcess;
const rows=async()=>{const{stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart=']);return stdout.trim().split('\n').map(x=>{const m=x.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);assert(m);return{pid:+m[1],ppid:+m[2],pgid:+m[3],start:m[4]};});};
try{
 app=await _electron.launch({executablePath:bundle+'/Contents/MacOS/MathArt Lab 2 Preview',args:['--mathart-hidden','--mathart-user-data='+root+'/profile'],env,timeout:30000});ownedProcess=app.process();pid=ownedProcess.pid;const owner=(await rows()).find(p=>p.pid===pid);assert(owner);assert.equal(owner.pgid,pid);pgid=pid;report.processOwner=owner;
 report.runtime=await app.evaluate(({app,BrowserWindow})=>({name:app.getName(),version:app.getVersion(),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length}));assert.equal(report.runtime.version,'2.0.0-preview.7');assert.equal(report.runtime.visibleWindows,0);
 await app.evaluate(({session})=>{globalThis.__fractalDownloads=[];session.fromPartition('persist:mathart-lab').on('will-download',(_event,item)=>{const row={state:'pending'};globalThis.__fractalDownloads.push(row);item.once('done',(_event,state)=>{row.state=state;row.path=item.getSavePath();});});});
 page=await app.firstWindow();await page.setViewportSize({width:1120,height:760});page.setDefaultTimeout(30000);origin=new URL(page.url()).origin;report.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));assert.equal(report.health.available,true);page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('response',response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return;const task=(async()=>{const header=inspectSourceFrameHeader(response.request().postDataBuffer());assert(header.ok);const row={...header.value,status:response.status(),renderer:response.headers()['x-source-renderer']};report.wire.push(row);if(row.family==='fractal'){assert.equal(row.status,200);assert.equal(row.renderer,report.health.rendererIdentity);if(row.operation===3){const bytes=await response.body();assert.equal(bytes.byteLength,64);row.disposition=bytes.readUInt32LE(28);assert.ok([1,2].includes(row.disposition));}}})().catch(e=>report.errors.push(String(e)));pending.add(task);task.finally(()=>pending.delete(task));});
 const ready=()=>page.waitForFunction(()=>{const s=document.querySelector('.status-bar')?.textContent,ready=(s?.includes('Ready')||s?.includes('就绪'))&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');if(!ready){window.__fractalReadySince=undefined;return false;}window.__fractalReadySince??=performance.now();return performance.now()-window.__fractalReadySince>=200;});
 await ready();await page.getByTitle('工作区设置',{exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close settings',exact:true}).click();
 const raw=structuredClone(reference.ui.source??JSON.parse(await readFile('tests/fixtures/source-fractal-cgl/mandelbrot.json','utf8')));raw.name='Native Fractal application acceptance';raw.timeline=[{type:'wait',duration:.08}];await page.locator('input[type=file]').setInputFiles({name:'fractal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
 await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),raw.name);await ready();
 const measure=()=>page.evaluate(()=>{const canvas=document.querySelector('.art-canvas'),box=canvas.parentElement,style=getComputedStyle(box);return{logicalWidth:Math.round(parseFloat(style.width)),logicalHeight:Math.round(parseFloat(style.height)),devicePixelRatio,windowWidth:innerWidth,windowHeight:innerHeight};});
 report.viewportBefore=await measure();const referenceViewport=reference.ui.preview.context.fractalViewport;
 // Chromium/Electron font metrics can leave a different canvas height at the
 // same outer window size. Compare formula pixels only at the same explicit
 // logical canvas dimensions; never hide or rewrite the produced label.
 if(reference.ui.preview.output.formulas?.layout==='source-surface-centered-v1'){
  const before=report.viewportBefore;
  if(before.logicalHeight!==referenceViewport.logicalHeight||before.logicalWidth!==referenceViewport.logicalWidth){await page.evaluate(()=>{window.__fractalReadySince=undefined;});await page.setViewportSize({width:before.windowWidth+referenceViewport.logicalWidth-before.logicalWidth,height:before.windowHeight+referenceViewport.logicalHeight-before.logicalHeight});await ready();}
  report.viewportAfter=await measure();assert.equal(report.viewportAfter.logicalHeight,referenceViewport.logicalHeight);assert.equal(report.viewportAfter.logicalWidth,referenceViewport.logicalWidth);
 }
 await Promise.all([...pending]);assert(report.wire.some(r=>r.family==='fractal'&&r.operation===2));await page.screenshot({path:root+'/preview.png'});
 for(const mode of ['current','replay']){
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Fractal image source',exact:true}).selectOption(mode);if(mode==='current')await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('96');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('80');
  const mark=report.wire.length,index=await app.evaluate(()=>globalThis.__fractalDownloads.length);await page.getByRole('button',{name:'Start export',exact:true}).click();let download;const deadline=performance.now()+30000;while(performance.now()<deadline){download=await app.evaluate((_args,index)=>globalThis.__fractalDownloads[index],index);if(download?.state&&download.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(download?.state,'completed');await Promise.all([...pending]);const png=decodePng(await readFile(download.path));assert.equal(png.width,96);assert.equal(png.height,80);assert.equal(sha(png.rgba),reference.ui[mode].decoded.rgbaSha256);const wire=report.wire.slice(mark).filter(r=>r.family==='fractal');assert(wire.some(r=>r.operation===2));if(mode==='replay'){assert(wire.some(r=>r.operation===1));assert(wire.some(r=>r.operation===3&&[1,2].includes(r.disposition)));}report.images.push({mode,file:download.path,rgbaSha256:sha(png.rgba),wire});await writeFile(root+'/'+mode+'.png',await readFile(download.path));await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page){await page.screenshot({path:root+'/failed.png'}).catch(()=>{});report.body=await page.locator('body').innerText().catch(()=>null);}}
finally{
 await Promise.allSettled([...pending]);try{await app?.close();report.applicationExitCode=ownedProcess?.exitCode;assert.equal(report.applicationExitCode,0);report.processGroupAfter=pgid?(await rows()).filter(p=>p.pgid===pgid):[];assert.deepEqual(report.processGroupAfter,[]);if(origin)await new Promise((resolve,reject)=>{const socket=net.createConnection({port:Number(new URL(origin).port),host:'127.0.0.1'});socket.setTimeout(1500,()=>{socket.destroy();reject(Error('App port timeout'));});socket.once('connect',()=>{socket.destroy();reject(Error('App port still open'));});socket.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(e));});report.closed=true;}catch(error){report.status='failed';report.cleanupError=String(error);process.exitCode=1;}report.seconds=(performance.now()-started)/1000;await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:root+'/report.json'}));
}
