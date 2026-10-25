/** Public controls of a packaged, hidden Electron app. No engine patches or
 * external renderer configuration. Caller selects fixtures and a new output. */
import {_electron} from '@playwright/test';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {decodePng} from './lib/verify-png.mjs';
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
import {verifyPackagedGlyph} from './lib/verify-packaged-glyph.mjs';
import {verifyPackagedSamila} from './lib/verify-packaged-samila.mjs';
const [bundleArg,specArg,outArg]=process.argv.slice(2);assert(bundleArg&&specArg&&outArg,'Supply app bundle, fixture spec, new output directory');
const bundle=resolve(bundleArg),out=resolve(outArg);await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),resources=join(bundle,'Contents/Resources'),manifest=JSON.parse(await readFile(join(resources,'source-renderer/manifest.json'))),executable=join(bundle,'Contents/MacOS/MathArt Lab 2 Preview');
assert.equal(manifest.executable,'source-cgl-renderer');const nativePath=join(resources,'source-renderer',manifest.executable);assert.equal(sha(await readFile(nativePath)),manifest.sha256);
const specBytes=await readFile(specArg),spec=JSON.parse(specBytes),report={status:'running',bundle,specSha256:sha(specBytes),nativeManifest:manifest,appAsarSha256:sha(await readFile(join(resources,'app.asar'))),checks:[],errors:[],limits:['Actual packaged UI, native helper and PNG download on this Mac; original preview parity is covered separately. PNG uses the shared source image enhancement; it is not raw RGBA.','No source engine patches or renderer environment override. Hidden window and isolated test userData.','Current-scene native captures are always exercised. Cold replay is exercised only when spec.coldReplay is true; Custom Symmetry is exercised when supplied, including native GLSL application.']};
const compiled=await build({entryPoints:['src/engine/sourcePausedImage.ts'],bundle:true,platform:'node',format:'esm',write:false,metafile:true});
const {enhanceSourcePausedImage}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
report.expectedEnhancementSources=Object.fromEntries(await Promise.all(Object.keys(compiled.metafile.inputs).map(async p=>[p,sha(await readFile(p))])));
async function configureDisplayMetrics(page){
 // Retain small export/control responses for observation without filling the
 // DevTools body cache with full Retina preview frames. This does not change
 // the application's fetch, randomness, or response delivery.
 const network=await page.context().newCDPSession(page);await network.send('Network.enable',{maxTotalBufferSize:64*1024*1024,maxResourceBufferSize:4*1024*1024});report.networkObservation={maxTotalBufferSize:64*1024*1024,maxResourceBufferSize:4*1024*1024};
 if(spec.deviceScaleFactor===undefined)return;
 assert(Number.isFinite(spec.deviceScaleFactor)&&spec.deviceScaleFactor>0);
 const session=await page.context().newCDPSession(page);await session.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:spec.deviceScaleFactor,mobile:false});
 const actual=await page.evaluate(()=>window.devicePixelRatio);assert.equal(actual,spec.deviceScaleFactor);report.emulatedDisplay={deviceScaleFactor:actual,scope:'Chromium display-metrics emulation on this Mac; not a second physical device'};
}
const execFileAsync=promisify(execFile),appRuns=[];
async function processRows(){
 const {stdout}=await execFileAsync('/bin/ps',['-axo','pid=,ppid=,pgid=,rss=,time=,lstart='],{maxBuffer:2*1024*1024});
 return stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);assert(m,'Invalid ps row');return {pid:+m[1],ppid:+m[2],pgid:+m[3],rssKiB:+m[4],cpuTime:m[5],startTime:m[6]};});
}
async function observeApplication(app){
 const process=app.process(),rows=await processRows(),root=rows.find(p=>p.pid===process.pid);assert(root,'Launched Electron is missing');assert.equal(root.pgid,root.pid,'Expected a dedicated Playwright Electron process group');
 const record={pid:root.pid,startTime:root.startTime,samples:[]};appRuns.push(record);let timer,task,stopped=false;
 async function sample(){const rows=await processRows();const current=rows.find(p=>p.pid===root.pid);if(!current||current.startTime!==root.startTime)return;const members=rows.filter(p=>p.pgid===root.pgid);record.samples.push({epochMs:Date.now(),seconds:(performance.now()-started)/1000,rssKiB:members.reduce((n,p)=>n+p.rssKiB,0),processes:members});}
 async function tick(){await sample();if(!stopped)timer=setTimeout(()=>{task=tick().catch(error=>report.errors.push(String(error)));},500);}
 await tick();
 return async()=>{stopped=true;clearTimeout(timer);await task;record.exitCode=process.exitCode;record.signalCode=process.signalCode;record.processGroupAfter=(await processRows()).filter(p=>p.pgid===root.pgid);record.rssPeakKiB=Math.max(...record.samples.map(p=>p.rssKiB));assert.equal(record.exitCode,0,'Electron shutdown failed');assert.deepEqual(record.processGroupAfter,[],'Electron/native process group did not exit');};
}
async function closedOrigin(origin){
 const port=Number(new URL(origin).port);await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Closed app port timed out'));});socket.once('connect',()=>{socket.destroy();reject(Error('Closed app port still listening'));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));});
}
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];let application,page,finishObservation;const started=performance.now(),wire=[],pending=new Set(),presents=[];
try{
 application=await _electron.launch({executablePath:executable,args:['--mathart-hidden','--mathart-user-data='+out+'/profile'],env,timeout:30000});
 finishObservation=await observeApplication(application);
 report.runtime=await application.evaluate(({app,BrowserWindow})=>({name:app.getName(),version:app.getVersion(),userData:app.getPath('userData'),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length,electron:process.versions.electron}));assert.equal(report.runtime.visibleWindows,0);assert.equal(report.runtime.name,'MathArt Lab 2 Preview');
 report.hiddenActivation=await application.evaluate(({app,BrowserWindow})=>{app.emit('activate');app.emit('second-instance',{},[],process.cwd(),{});return {visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length};});assert.equal(report.hiddenActivation.visibleWindows,0);
 await application.evaluate(({session})=>{globalThis.__verificationDownloads=[];session.fromPartition('persist:mathart-lab').on('will-download',(_event,item)=>{const row={path:item.getSavePath(),state:'pending'};globalThis.__verificationDownloads.push(row);item.once('done',(_event,state)=>{row.state=state;row.path=item.getSavePath();});});});
 page=await application.firstWindow();await configureDisplayMetrics(page);page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(String(error)));
 const observeNativePage=page=>page.on('response',response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return;const task=(async()=>{const packet=response.request().postDataBuffer(),parsed=inspectSourceFrameHeader(packet);assert(parsed.ok);const row={...parsed.value,status:response.status()};wire.push(row);assert.equal(response.status(),200);
if(row.family==='samila'&&[1,3].includes(row.operation)){const bytes=await response.body();assert.equal(bytes.length,64);assert.equal(bytes.readUInt32LE(0),1);assert.equal(bytes.readUInt32LE(4),row.operation);assert.equal(bytes.subarray(8,24).toString('hex'),row.resource);row.disposition=bytes.readUInt32LE(28);assert(row.operation===1?row.disposition===0:[1,2].includes(row.disposition));}
// Preview requests may be cancelled by public controls; only retain the explicit
// 160x120 export payload. Request metadata still covers all native operations.
if(row.width===160&&row.height===120&&(row.family==='iterated-render'&&row.operation===3||row.family==='samila'&&[2,4].includes(row.operation))){const bytes=await response.body(),samila=row.family==='samila';assert.equal(bytes.readUInt32LE(0),samila?1:3);const width=samila?row.width:bytes.readUInt32LE(56),height=samila?row.height:bytes.readUInt32LE(60),offset=samila?64:128;assert.equal(bytes.length,offset+width*height*4);const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)bytes.copy(rgba,y*width*4,offset+(height-1-y)*width*4,offset+(height-y)*width*4);presents.push({family:row.family,width,height,rgba,wire:wire.indexOf(row)});if(presents.length>8)presents.shift();}})().catch(e=>report.errors.push(String(e)));pending.add(task);task.finally(()=>pending.delete(task));});
 observeNativePage(page);
 const ready=()=>page.waitForFunction(()=>{const s=document.querySelector('.status-bar')?.textContent;return (s?.includes('Ready')||s?.includes('就绪'))&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');});
 await ready();await page.getByTitle('工作区设置',{exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close settings',exact:true}).click();
 report.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));assert.equal(report.health.available,true);
 const download=async action=>{const index=await application.evaluate(()=>globalThis.__verificationDownloads.length);await action();const stop=performance.now()+30000;while(performance.now()<stop){const row=await application.evaluate((_args,n)=>globalThis.__verificationDownloads[n],index);if(row?.state!=='pending'&&row){assert.equal(row.state,'completed');return row.path;}const errors=await page.locator('.export-modal .export-error[role=alert]:visible').allTextContents();if(errors.length)throw Error('Packaged export failed: '+errors.join('; '));await new Promise(r=>setTimeout(r,50));}throw Error('Packaged download timed out');};
 if(spec.formulas)report.formulas=await verifyPackagedGlyph({page,ready,download,out,spec:spec.formulas});
 for(const fixture of spec.cases){
  if(fixture.family==='samila'){report.checks.push(await verifyPackagedSamila({fixture,page,ready,download,wire,pending,presents,out,enhanceSourcePausedImage,coldReplay:spec.coldReplay}));console.log(JSON.stringify({case:fixture.name,status:'passed',family:'samila'}));continue;}
  assert(['map','symmetry'].includes(fixture.family));const raw=await readFile(fixture.path);assert.equal(sha(raw),fixture.sha256);const source=JSON.parse(raw),custom=fixture.family==='symmetry'&&typeof source.equation?.glsl==='string'&&!!source.equation.glsl.trim(),createOperation=custom?7:6,advanceOperation=custom?9:3;const begin=wire.length;
  const importedResponse=(family,operation)=>page.waitForResponse(response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return false;const p=inspectSourceFrameHeader(response.request().postDataBuffer());return p.ok&&p.value.family===family&&p.value.operation===operation;});
  await Promise.all([importedResponse('iterated',createOperation),importedResponse('iterated-render',3),page.locator('input[type=file]').setInputFiles({name:fixture.name+'.json',mimeType:'application/json',buffer:raw})]);await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),JSON.parse(raw).name);await ready();await Promise.all([...pending]);assert(wire.slice(begin).some(r=>r.family==='iterated'&&r.operation===createOperation),'Actual UI did not create source-native owner');assert(wire.slice(begin).some(r=>r.family==='iterated-render'&&r.operation===3),'Actual UI did not present native pixels');
  let sourceEditing;
  if(custom){
   const editor=page.getByRole('textbox',{name:'Custom GLSL source',exact:true}),edited='#define PACKAGED_NATIVE_CHECK 1\n'+source.equation.glsl,mark=wire.length;
   await editor.fill(edited);await Promise.all([page.waitForResponse(response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return false;const p=inspectSourceFrameHeader(response.request().postDataBuffer());return p.ok&&p.value.family==='iterated-render'&&p.value.operation===3&&p.value.width!==64;}),page.getByRole('button',{name:'Validate and apply GLSL',exact:true}).click()]);await ready();await Promise.all([...pending]);
   const trace=wire.slice(mark),creates=trace.filter(r=>r.family==='iterated'&&r.operation===createOperation);assert.equal(creates.length,2,'Candidate validation and applied preview must own separate native programs');
   const retirement=trace.findIndex(r=>r.family==='iterated'&&r.operation===5&&r.resource===creates[0].resource),published=trace.indexOf(creates[1]);assert(retirement>=0&&retirement<published,'Applied preview started before candidate cleanup');
   assert(trace.some(r=>r.family==='iterated-render'&&r.operation===3&&r.width===64&&r.height===64),'No actual native candidate image');assert.equal(await editor.inputValue(),edited);sourceEditing={exactSource:edited,separateNativeOwners:true,cleanupBeforePublish:true};
  }
  const input=page.locator('#param-'+fixture.parameter),before=await input.inputValue(),creates=wire.filter(r=>r.family==='iterated'&&r.operation===createOperation).length,prior=wire.length;
  await input.fill(String(Number(before)+fixture.delta));await input.blur();await page.waitForFunction(()=>!document.querySelector('.rendering-badge'));await page.waitForTimeout(200);await ready();await Promise.all([...pending]);assert.notEqual(await input.inputValue(),before,'Hot parameter edit did not change the control value');assert.equal(wire.filter(r=>r.family==='iterated'&&r.operation===createOperation).length,creates,'Hot parameter edit recreated native state');
  const running=wire.length;await Promise.all([page.waitForResponse(response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return false;const parsed=inspectSourceFrameHeader(response.request().postDataBuffer());return parsed.ok&&parsed.value.family==='iterated'&&parsed.value.operation===advanceOperation&&parsed.value.steps>0;}),page.getByRole('button',{name:'Play',exact:true}).click()]);await page.getByRole('button',{name:'Pause',exact:true}).click();await ready();await Promise.all([...pending]);assert(wire.slice(running).some(r=>r.family==='iterated'&&r.operation===advanceOperation&&r.steps>0));assert.equal(wire.filter(r=>r.family==='iterated'&&r.operation===createOperation).length,creates,'Resume after hot edit recreated native compute state');
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:fixture.family==='map'?'Map image source':'Symmetry image source',exact:true}).inputValue(),'current');
  await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('160');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('120');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
  const first=wire.length,file=await download(()=>page.getByRole('button',{name:'Start export',exact:true}).click());await page.getByRole('button',{name:'Start export',exact:true}).waitFor({state:'visible'});await Promise.all([...pending]);const png=decodePng(await readFile(file));assert.equal(png.width,160);assert.equal(png.height,120);const native=presents.findLast(p=>p.wire>=first&&p.width===png.width&&p.height===png.height);assert(native,'No native present with PNG dimensions');await writeFile(out+'/'+fixture.name+'-native.rgba',native.rgba);await writeFile(out+'/'+fixture.name+'-download.rgba',png.rgba);const expected=enhanceSourcePausedImage(new Uint8ClampedArray(native.rgba),native.width,native.height);let diff=0;for(let k=0;k<png.rgba.length;k++)if(png.rgba[k]!==expected[k])diff++;report.comparison={fixture:fixture.name,width:png.width,height:png.height,nativeWire:native.wire,differences:diff,presents:presents.map(p=>({width:p.width,height:p.height,wire:p.wire,sha256:sha(p.rgba)}))};assert.equal(diff,0,'Downloaded PNG differs from native pixels after the source image enhancement');assert(wire.slice(first).some(r=>r.family==='iterated-render'&&r.operation===3));
  let coldReplay;
  if(spec.coldReplay){
   await page.getByRole('combobox',{name:fixture.family==='map'?'Map image source':'Symmetry image source',exact:true}).selectOption('replay');
   const coldRuns=[];
   for(let repeat=0;repeat<2;repeat++){
    const start=wire.length,file=await download(()=>page.getByRole('button',{name:'Start export',exact:true}).click());await page.getByRole('button',{name:'Start export',exact:true}).waitFor({state:'visible'});await Promise.all([...pending]);
    const png=decodePng(await readFile(file)),native=presents.findLast(p=>p.wire>=start&&p.width===png.width&&p.height===png.height);assert.equal(png.width,160);assert.equal(png.height,120);assert(native,'Cold PNG did not use native presentation');
    assert.equal(wire.slice(start).filter(r=>r.family==='iterated'&&r.operation===createOperation).length,1,'Cold export did not use a separate compute owner');
    assert.deepEqual(png.rgba,native.rgba,'Cold PNG differs from native output');
    await writeFile(out+'/'+fixture.name+'-cold-'+repeat+'.rgba',png.rgba);coldRuns.push({file,rgbaSha256:sha(png.rgba),nativeWire:native.wire,requests:wire.length-start});
   }
   assert.equal(coldRuns[0].rgbaSha256,coldRuns[1].rgbaSha256,'Repeated cold exports changed deterministic pixels');coldReplay={runs:coldRuns,nativePixelsExact:true,repeatedPixelsExact:true};
  }
  await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
  if(coldReplay){
   const createsAfterCold=wire.filter(r=>r.family==='iterated'&&r.operation===createOperation).length;
   await Promise.all([page.waitForResponse(response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return false;const p=inspectSourceFrameHeader(response.request().postDataBuffer());return p.ok&&p.value.family==='iterated'&&p.value.operation===advanceOperation&&p.value.steps>0;}),page.getByRole('button',{name:'Play',exact:true}).click()]);
   await page.getByRole('button',{name:'Pause',exact:true}).click();await ready();await Promise.all([...pending]);assert.equal(wire.filter(r=>r.family==='iterated'&&r.operation===createOperation).length,createsAfterCold,'Cold export replaced live preview owner');coldReplay.primaryResumedWithoutRecreation=true;
  }
  await page.screenshot({path:out+'/'+fixture.name+'.png'});
  report.checks.push({name:fixture.name,sourceSha256:fixture.sha256,sourceNativeCreate:true,nativeProfile:custom?'source-fragment':'source-prefix',sourceEditing,hotParameter:{name:fixture.parameter,before,after:await input.inputValue(),sameComputeOwner:true,positiveAdvanceAfterEdit:true,requests:wire.length-prior},download:file,width:png.width,height:png.height,rgbaSha256:sha(png.rgba),pngMatchesEnhancedNative:true,coldReplay});console.log(JSON.stringify({case:fixture.name,status:'passed',width:png.width,height:png.height}));
 }
 assert.deepEqual(report.errors,[]);
 const firstOrigin=new URL(page.url()).origin,last=spec.cases.at(-1),expectedName=JSON.parse(await readFile(last.path)).name,expectedParameter=await page.locator('#param-'+last.parameter).inputValue(),expectedCustomSource=report.checks.at(-1)?.sourceEditing?.exactSource,expectedSamilaEquation=report.checks.at(-1)?.sourceEditing?.samilaEquation;
 await application.close();await finishObservation();finishObservation=undefined;await closedOrigin(firstOrigin);
 application=await _electron.launch({executablePath:executable,args:['--mathart-hidden','--mathart-user-data='+out+'/profile'],env,timeout:30000});finishObservation=await observeApplication(application);
 page=await application.firstWindow();await configureDisplayMetrics(page);page.setDefaultTimeout(30000);page.on('pageerror',error=>report.errors.push(String(error)));observeNativePage(page);await ready();
 assert((await page.locator('.project-title').innerText()).includes(expectedName));assert.equal(await page.locator('#param-'+last.parameter).inputValue(),expectedParameter);if(expectedCustomSource)assert.equal(await page.getByRole('textbox',{name:'Custom GLSL source',exact:true}).inputValue(),expectedCustomSource);
 if(expectedSamilaEquation)assert.equal(await page.getByRole('textbox',{name:'f₁(x, y)',exact:true}).inputValue(),expectedSamilaEquation);
 let restoredNative;
 if(last.family==='samila'){const mark=wire.length;await Promise.all([page.waitForResponse(response=>{if(!response.url().endsWith('/api/source-renderer/frames'))return false;const p=inspectSourceFrameHeader(response.request().postDataBuffer());return p.ok&&p.value.family==='samila'&&p.value.operation===2;}),page.getByRole('button',{name:'Play',exact:true}).click()]);await page.getByRole('button',{name:'Pause',exact:true}).click();await ready();await Promise.all([...pending]);restoredNative=wire.slice(mark).find(r=>r.family==='samila'&&r.operation===2);assert(restoredNative,'Reopened Samila did not resume native display');}
 const restored=await application.evaluate(({app,BrowserWindow})=>({userData:app.getPath('userData'),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length}));assert.equal(restored.userData,report.runtime.userData);assert.equal(restored.visibleWindows,0);
 report.restore={...restored,nativeResumed:restoredNative,name:expectedName,parameter:expectedParameter,firstOrigin,secondOrigin:new URL(page.url()).origin};assert.notEqual(report.restore.secondOrigin,firstOrigin);assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page&&!page.isClosed()){report.body=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 await Promise.all([...pending]);report.wire=wire;try{const origin=page&&!page.isClosed()?new URL(page.url()).origin:undefined;await application?.close();await finishObservation?.();if(origin)await closedOrigin(origin);report.applicationClosed=true;}catch(e){report.closeError=String(e);report.status='failed';process.exitCode=1;}
 report.applicationRuns=appRuns;report.costScope='Electron and native-helper dedicated process groups sampled every 0.5s, excluding driver JS/esbuild; short peaks and GPU memory are unmeasured. Outer supervisor measures driver group separately.';
 report.appAsarStable=report.appAsarSha256===sha(await readFile(join(resources,'app.asar')));report.nativeStable=manifest.sha256===sha(await readFile(nativePath));if(!report.appAsarStable||!report.nativeStable||report.errors.length){report.status='failed';process.exitCode=1;}report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,seconds:report.seconds}));
}
