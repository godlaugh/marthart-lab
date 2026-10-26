/** Packaged Attractor controls, bundled-native v13 acknowledgements and actual PNG
 * downloads, followed by complete exit/reopen. No source substitution or GUI focus; a passive fetch observer copies receipts.
 * Usage: node scripts/verify-attractor-native-desktop.mjs BUNDLE SOURCE_CONFIG OUTPUT
 * OUTPUT must be new; its private profile is reused only for this verifier's
 * second launch. Only the source name is changed to identify the imported scene. */
import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
import {pngFacts} from './domain-native-production-ui.mjs';

const [bundleArg,configArg,outArg]=process.argv.slice(2);
assert(bundleArg&&configArg&&outArg,'Supply BUNDLE SOURCE_CONFIG OUTPUT');
const bundle=path.resolve(bundleArg),config=path.resolve(configArg),out=path.resolve(outArg),profile=path.join(out,'profile');
const originalBytes=await readFile(config),original=JSON.parse(originalBytes);
assert(original&&typeof original==='object'&&!Array.isArray(original),'Expected original Attractor JSON');
assert(String(original.type).toUpperCase()==='ATTRACTOR','Expected original ATTRACTOR type');
const source=structuredClone(original);source.name='Packaged Attractor acceptance';
const withoutName=({name:_,...rest})=>rest;assert.deepEqual(withoutName(source),withoutName(original),'Only the source name may change');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),resources=path.join(bundle,'Contents/Resources'),asar=path.join(resources,'app.asar');
const manifestPath=path.join(resources,'source-renderer/manifest.json'),manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);
assert.equal(manifest.schemaVersion,1);assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);assert.equal(manifest.executable,'source-cgl-renderer');
const nativeExecutable=await realpath(path.join(resources,'source-renderer',manifest.executable));assert.equal(sha(await readFile(nativeExecutable)),manifest.sha256);
// Same sealed executable/path/host identity contract as the actual service.
const expectedRenderer=sha(JSON.stringify({executable:nativeExecutable,executableSha256:manifest.sha256,host:[process.platform,process.arch,os.release(),os.version()]}));
await mkdir(out,{recursive:false});await writeFile(path.join(out,'input.json'),JSON.stringify(source,null,2)+'\n');
const report={status:'running',at:new Date().toISOString(),bundle,sourceConfig:config,sourceSha256:sha(originalBytes),source,manifest,manifestSha256:sha(manifestBytes),expectedRenderer,asarSha256:sha(await readFile(asar)),runs:[],wire:[],errors:[],scope:'Hidden packaged preview.11 Attractor import, native preview, 96x80 replay PNG, Save, complete exit, reopen and aligned replay PNG on the same Mac. Both launches use public Return to start; this does not claim persistence of the playhead or original GUI/cross-device parity. The original JSON is unchanged except its name.'};
const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','MATHART_SOURCE_RENDERER_BACKEND','MATHART_GLYPH_BACKEND','VITE_SOURCE_RENDERER'])delete env[key];
const exec=promisify(execFile),started=performance.now();let app,page,processOwner,run;
const rows=async()=>{const{stdout}=await exec('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart='],{maxBuffer:2*1024*1024});return stdout.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);assert(m,'Invalid process observation');return{pid:+m[1],ppid:+m[2],pgid:+m[3],start:m[4]};});};
const portClosed=async origin=>new Promise((resolve,reject)=>{
 const socket=net.createConnection({host:'127.0.0.1',port:Number(new URL(origin).port)});
 socket.setTimeout(1500,()=>{socket.destroy();reject(Error('Closed application port timed out'));});
 socket.once('connect',()=>{socket.destroy();reject(Error('Application port is still listening'));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
});
async function closeApp(){
 if(!app)return;
 await app.close();app=undefined;
 run.exitCode=processOwner.exitCode;run.signalCode=processOwner.signalCode;assert.equal(run.exitCode,0,'Application shutdown failed');
 if(run.owner){run.processGroupAfter=(await rows()).filter(p=>p.pgid===run.owner.pgid);assert.deepEqual(run.processGroupAfter,[],'Owned Electron/native process group remains');}
 if(run.origin){await portClosed(run.origin);run.portClosed=true;}
}
async function assertHidden(){
 const observed=await app.evaluate(({BrowserWindow})=>({visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length,showEvents:globalThis.__attractorVisibleEvents??[]}));
 assert.equal(observed.visibleWindows,0);assert.deepEqual(observed.showEvents,[],'A hidden test window became visible');return observed;
}
const ready=()=>page.waitForFunction(()=>{const text=document.querySelector('.status-bar')?.textContent;return(text?.includes('Ready')||text?.includes('就绪'))&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');});
const nativeRows=mark=>report.wire.slice(mark).filter(row=>row.version===13&&row.status===200&&row.renderer===expectedRenderer&&row.validated);
function completedFrames(mark){
 const wires=nativeRows(mark);
 return wires.filter((row,i)=>row.operation===3&&wires.slice(0,i).some(begin=>begin.operation===1&&begin.resource===row.resource&&begin.chunks===row.ack.chunks)&&wires.slice(i+1).some(release=>release.operation===4&&release.resource===row.resource&&release.ack.disposition===1&&release.ack.index===row.ack.index&&release.ack.finished));
}
async function waitForNative(mark,label){
 const deadline=performance.now()+30000;
 while(!completedFrames(mark).length&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert(completedFrames(mark).length,label+' did not complete and release a bundled native v13 frame');
}
async function downloadPng(mode){
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 // Source CPU Attractor currently uses a fixed replay image, with no retained-mode selector.
 assert.equal(mode,'replay');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('96');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('80');
 const index=await app.evaluate(()=>globalThis.__attractorDownloads.length),mark=report.wire.length;await page.getByRole('button',{name:'Start export',exact:true}).click();
 let download;const deadline=performance.now()+30000;
 while(performance.now()<deadline){
  download=await app.evaluate((_electron,i)=>globalThis.__attractorDownloads[i],index);if(download?.state&&download.state!=='pending')break;
  const errors=await page.locator('.export-modal .export-error[role=alert]:visible, .export-dialog .error-card:visible').allTextContents();if(errors.length)throw Error(errors.join('\n'));
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.equal(download?.state,'completed','Attractor PNG download failed or timed out');
 const completedPath=await realpath(download.path),downloads=await realpath(path.join(profile,'downloads'));
 assert(completedPath.startsWith(downloads+path.sep),'Download escaped the explicitly owned profile');
 const bytes=await readFile(completedPath),decoded=pngFacts(bytes);assert.equal(decoded.width,96);assert.equal(decoded.height,80);assert(decoded.colors>1,'Attractor PNG is a single color');
 const wires=completedFrames(mark).filter(row=>row.width===96&&row.height===80); assert(wires.length,mode+' PNG had no matching 96x80 native acknowledgement');
 const file=path.join(out,run.phase+'-'+mode+'.png');await writeFile(file,bytes);
 run.images.push({mode,file,download:completedPath,pngSha256:sha(bytes),decoded,native: wires});
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await assertHidden();
}
try{
 for(const phase of ['initial','reopen']){
  const mark=report.wire.length;run={phase,images:[]};report.runs.push(run);
  app=await _electron.launch({executablePath:path.join(bundle,'Contents/MacOS/MathArt Lab 2 Preview'),args:['--mathart-hidden','--mathart-user-data='+profile],env,timeout:30000});
  processOwner=app.process();run.owner=(await rows()).find(row=>row.pid===processOwner.pid);assert(run.owner,'Launched application owner missing');assert.equal(run.owner.pgid,run.owner.pid,'Expected a dedicated owned Electron process group');
  run.runtime=await app.evaluate(({app,BrowserWindow,session})=>{
   globalThis.__attractorDownloads=[];globalThis.__attractorVisibleEvents=[];
   const observe=window=>window.on('show',()=>globalThis.__attractorVisibleEvents.push({id:window.id,at:Date.now()}));
   BrowserWindow.getAllWindows().forEach(observe);app.on('browser-window-created',(_event,window)=>observe(window));
   session.fromPartition('persist:mathart-lab').on('will-download',(_event,item)=>{const row={state:'pending'};globalThis.__attractorDownloads.push(row);item.once('done',(_event,state)=>{row.state=state;row.path=item.getSavePath();});});
   return{name:app.getName(),version:app.getVersion(),userData:app.getPath('userData'),platform:process.platform,arch:process.arch,visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length};
  });
  assert.equal(run.runtime.name,'MathArt Lab 2 Preview');assert.equal(run.runtime.version,'2.0.0-preview.11');assert.equal(run.runtime.visibleWindows,0);assert.equal(path.resolve(run.runtime.userData),profile);assert.equal(run.runtime.platform,process.platform);assert.equal(run.runtime.arch,process.arch);
  page=await app.firstWindow();page.setDefaultTimeout(30000);run.origin=new URL(page.url()).origin;assert.equal(new URL(run.origin).hostname,'127.0.0.1');page.on('pageerror',error=>report.errors.push(String(error)));
  await page.exposeFunction('__attractorNativeEvidence',async evidence=>{
   try{
   const packet=Buffer.from(evidence.packet,'base64'),parsed=inspectSourceFrameHeader(packet);assert(parsed.ok,'Malformed native request header');
   const headers=evidence.headers,row={phase,version:packet.readUInt32LE(4),...parsed.value,status:evidence.status,renderer:headers['x-source-renderer']};report.wire.push(row);
   if(row.status===429&&row.operation===4){const failure=JSON.parse(evidence.errorText);if(failure.kind==='capacity'&&failure.retryable===true){row.retryableBusy=true;return;}}
   assert.equal(row.status,200);assert.equal(row.renderer,expectedRenderer,'Native response did not come from the sealed bundled executable');
   if(row.version===13){
    assert.equal(row.family,'drawing');assert([0,4].includes(row.samples));assert.equal(headers['x-source-format'],'drawing-v1');assert.equal(headers['x-source-row-order'],row.operation===3?'bottom-up':'none');
    for(const key of ['generation','sequence','width','height'])assert.equal(Number(headers['x-source-'+key]),row[key],'Native ACK '+key+' mismatch');
    const expectedLength=64+(row.operation===3?row.width*row.height*4:0);assert.equal(Number(headers['content-length']),expectedLength);assert.equal(evidence.payloadBytes,expectedLength);
    const payload=Buffer.from(evidence.responseHeader,'base64');assert.equal(payload.length,64);
    const u=n=>payload.readUInt32LE(n);assert.equal(u(0),5);assert.equal(u(4),row.operation);assert.equal(payload.subarray(8,24).toString('hex'),row.resource);assert.equal(u(32),row.width);assert.equal(u(36),row.height);assert(payload.subarray(48,64).every(n=>n===0));
    row.ack={index:u(24),disposition:u(28),chunks:u(40),finished:u(44)===1};assert(u(44)<=1);
    if(row.operation===4&&row.ack.disposition!==2)assert(row.ack.index>=row.expectedIndex&&row.ack.index<=row.ack.chunks);else if(row.operation!==4)assert.equal(row.ack.index,row.expectedIndex+(row.operation===2?1:0));
    if(row.operation===4){assert([1,2].includes(row.ack.disposition));if(row.ack.disposition===2){assert.equal(row.ack.index,0);assert.equal(row.ack.chunks,0);assert.equal(row.ack.finished,false);}}else{assert.equal(row.ack.disposition,0);assert.equal(row.ack.finished,row.operation===3);}
    if(row.operation===1)assert.equal(row.ack.chunks,row.chunks);if(row.operation===3){assert.equal(row.ack.index,row.ack.chunks);assert.match(evidence.pixelsSha256,/^[a-f0-9]{64}$/);row.rgbaBottomUpSha256=evidence.pixelsSha256;}
    row.validated=true;
   }
   }catch(error){report.errors.push(String(error.stack??error));}
  });
  await page.evaluate(()=>{
   // Electron may evict Network.getResponseBody before CDP reads it. Clone
   // the actual response here instead; return the original response unchanged.
   const originalFetch=window.fetch;
   const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
   window.fetch=async function(input,init){
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(url.pathname!=='/api/source-renderer/frames')return originalFetch.call(this,input,init);
    if(!ArrayBuffer.isView(init?.body))throw Error('Expected actual native packet bytes');
    const packet=encode(new Uint8Array(init.body.buffer,init.body.byteOffset,init.body.byteLength));
    const response=await originalFetch.call(this,input,init),raw=new Uint8Array(await response.clone().arrayBuffer());
    const pixelsSha256=raw.length>64?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw.subarray(64))),x=>x.toString(16).padStart(2,'0')).join(''):undefined;
    await window.__attractorNativeEvidence({packet,responseHeader:encode(raw.subarray(0,64)),payloadBytes:raw.length,pixelsSha256,status:response.status,errorText:response.ok?undefined:new TextDecoder().decode(raw),headers:Object.fromEntries(response.headers)});
    return response;
   };
  });
  await ready();run.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(response=>response.json()));assert.equal(run.health.available,true);assert.equal(run.health.rendererIdentity,expectedRenderer);
  if(phase==='initial'){
   await page.getByTitle('工作区设置',{exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await page.getByRole('button',{name:'Close settings',exact:true}).click();
   const importMark=report.wire.length;await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'attractor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await waitForNative(importMark,'Imported Attractor preview');
  }
  await page.waitForFunction(name=>document.querySelector('.project-title')?.textContent.includes(name),source.name);await ready();await page.getByTestId('native-art-canvas').waitFor({state:'visible'});
  assert(await page.getByRole('button',{name:'Play',exact:true}).count(),'Attractor preview must remain paused');
  assert(await page.getByRole('button',{name:'Play',exact:true}).isEnabled(),'Valid original Attractor playback is blocked by timeline validation');
  // Returning to the same zero time is legitimately a no-op. First move one
  // authored frame through the real range input, then test an actual rewind.
  const forwardMark=report.wire.length,slider=page.getByRole('slider',{name:'Time position',exact:true});await slider.focus();await slider.press('Home');await slider.press('ArrowRight');
  await page.waitForFunction(()=>Number(document.querySelector('.timeline .scrubber')?.value)>0);await waitForNative(forwardMark,'One-frame seek');await ready();
  const resetMark=report.wire.length;await page.getByTitle('Return to start',{exact:true}).click();await waitForNative(resetMark,'Return to start');await ready();
  assert(await page.getByRole('button',{name:'Play',exact:true}).count(),'Return to start unexpectedly resumed playback');run.alignment={control:'Return to start',paused:true,native: nativeRows(resetMark)};
  for(const mode of ['replay'])await downloadPng(mode);
  if(phase==='initial'){
   await page.getByRole('button',{name:'Save',exact:true}).click();
   await page.waitForFunction(name=>{const workspace=JSON.parse(localStorage.getItem('mathart-lab-v1'));return workspace.scenes.some(scene=>scene.id===workspace.active&&scene.name===name&&scene.kind==='attractor');},source.name);
  }
  run.saved=await page.evaluate(()=>{const workspace=JSON.parse(localStorage.getItem('mathart-lab-v1'));return workspace.drafts?.[workspace.active]??workspace.scenes.find(scene=>scene.id===workspace.active);});
  assert.equal(run.saved.kind,'attractor');assert.equal(run.saved.name,source.name);assert.equal(run.saved.attractorSource?.configuration?.nativeBackend,'cpu');
  if(phase==='reopen'){
   assert.deepEqual(run.saved,report.runs[0].saved,'Saved Attractor source data changed after exit/reopen');
   assert.equal(run.images[0].decoded.rgbaSha256,report.runs[0].images[0].decoded.rgbaSha256,'Save/exit/reopen and Return to start changed the replay PNG');
  }
  assert(completedFrames(mark).length,'Launch completed no released bundled native v13 frame');run.hidden=await assertHidden();await page.screenshot({path:path.join(out,phase+'.png')});await closeApp();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){
 report.status='failed';report.error=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});report.body=await page?.locator('body').innerText().catch(()=>undefined);
}finally{
 try{await closeApp();}catch(error){report.status='failed';report.cleanupError=String(error.stack??error);process.exitCode=1;}
 report.asarUnchanged=report.asarSha256===sha(await readFile(asar));report.nativeUnchanged=manifest.sha256===sha(await readFile(nativeExecutable));report.manifestUnchanged=report.manifestSha256===sha(await readFile(manifestPath));report.sourceUnchanged=report.sourceSha256===sha(await readFile(config));
 if(!report.asarUnchanged||!report.nativeUnchanged||!report.manifestUnchanged||!report.sourceUnchanged){report.status='failed';process.exitCode=1;}
 report.seconds=(performance.now()-started)/1000;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:path.join(out,'report.json')}));
}
