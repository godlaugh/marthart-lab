import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(value,message)=>{if(!value)throw Error(message);};
const prefix='.cache/iterated-edit-ui';
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).sort().map(async p=>['src/'+p,sha(await readFile('src/'+p))])));
const before=await hashes(),report={at:new Date().toISOString(),scope:'Actual App Map and builtin Symmetry numeric edits; independent Worker telemetry messages count genuine GL calls, cold Generator complete RGBA SHA256 comparison, project save/reopen and PNG. No native application or performance measurement.',nativeParity:false,cases:[]};
let server,service,browser,page,phase='setup';const pageErrors=[];
const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
try{
 const directory=await mkdtemp('.cache/iterated-edit-service-');service=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const addr=await service.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${addr.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1,acceptDownloads:true});
 // Only add observational GL wrappers and a separate audit request/reply. The
 // application's generation request/results and transferred pixels are untouched.
 await context.route('**/src/engine/generate.worker.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`
 const auditCounts={contexts:0,compileShader:0,linkProgram:0};const auditContexts=new WeakSet();
 const auditGet=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){const value=auditGet.apply(this,args);if(args[0]==='webgl2'&&value&&!auditContexts.has(value)){auditContexts.add(value);auditCounts.contexts++;}return value;};
 for(const name of ['compileShader','linkProgram']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){auditCounts[name]++;return original.apply(this,args);};}
 self.addEventListener('message',event=>{if(event.data?.__iteratedAudit==='stats'){event.stopImmediatePropagation();self.postMessage({__iteratedAudit:'stats',token:event.data.token,counts:{...auditCounts}});}});
 ${await response.text()}`});});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>pageErrors.push(e.message));
 await page.addInitScript(()=>{
  const Native=Worker;window.__editAudit={workers:[],requests:[],completed:[],errors:[],sequence:0};
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.auditCold=!!window.__editAudit.cold;this.auditId=window.__editAudit.workers.length;window.__editAudit.workers.push(this);this.sent=new Map();this.addEventListener('message',async({data})=>{
    if(data.error)window.__editAudit.errors.push(data.error);
    if(data.operation!=='generate'||!data.output?.pixels)return;
    const request=this.sent.get(data.id);if(!request)return;const o=data.output;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',o.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');
    window.__editAudit.completed.push({request,worker:this.auditId,id:data.id,sha:digest,width:o.width,height:o.height,backend:o.backend,warnings:o.warnings});
   });}
   postMessage(message,...args){if(message.operation==='generate'&&!this.auditCold){const request={...structuredClone(message),worker:this.auditId,sequence:++window.__editAudit.sequence};this.sent.set(message.id,request);window.__editAudit.requests.push(request);}return super.postMessage(message,...args);}
  };
  window.__workerStats=worker=>new Promise((resolve,reject)=>{const w=window.__editAudit.workers[worker],token=crypto.randomUUID(),timer=setTimeout(()=>{w.removeEventListener('message',listener);reject(Error('Worker statistics timeout'));},10000);function listener({data}){if(data.__iteratedAudit==='stats'&&data.token===token){clearTimeout(timer);w.removeEventListener('message',listener);resolve(data.counts);}}w.addEventListener('message',listener);w.postMessage({__iteratedAudit:'stats',token});});
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
 const fixtures=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scenes=['map','symmetry'].map(kind=>{const s=createScene(definition(kind));s.name=kind+' edit reuse';Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:1024,burnIn:20,iterationsPerFrame:3,iteratedFps:30,iteratedStartTime:0});s.timeline.tracks=[];s.timeline.loop=false;return s;});
  saveWorkspace(localStorage,{scenes:[scenes[0]],active:scenes[0].id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scenes;
 });
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 const settled=()=>page.waitForFunction(()=>{const r=window.__editAudit.requests.at(-1);return r&&window.__editAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);});
 const snapshot=()=>page.evaluate(()=>{const r=window.__editAudit.requests.at(-1);return window.__editAudit.completed.find(c=>c.worker===r.worker&&c.id===r.id);});
 const stats=worker=>page.evaluate(worker=>window.__workerStats(worker),worker);
 const cold=async frame=>page.evaluate(async request=>{
  const{Generator}=await import('/src/engine/client.ts'),g=new Generator();window.__editAudit.cold=true;try{const out=await g.generate(request.scene,request.context);return{backend:out.backend,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('')};}finally{g.dispose();window.__editAudit.cold=false;}
 },frame.request);
 const compareCold=async frame=>{check(frame.backend==='webgl2','App fell back from GPU');const result=await cold(frame);check(result.backend==='webgl2'&&result.sha===frame.sha,'App RGBA differs from independent cold Generator');return result;};
 const waitEdit=async(kind,key,value,mark)=>{await page.waitForFunction(({kind,key,value,mark})=>window.__editAudit.completed.some(c=>c.request.sequence>mark&&c.request.scene.kind===kind&&c.request.scene.parameters[key]===value&&c.request.context.quality!=='export'),{kind,key,value,mark});await ready();await settled();return snapshot();};
 await page.goto(origin);await ready();await settled();
 for(const fixture of fixtures){
  const kind=fixture.kind;phase=kind+' import';const importMark=await page.evaluate(()=>window.__editAudit.sequence);
  await page.locator('input[type=file]').setInputFiles({name:kind+'.mathart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(({kind,importMark})=>{const r=window.__editAudit.requests.at(-1);return r?.scene.kind===kind&&r.sequence>importMark;},{kind,importMark});await ready();await settled();let frame=await snapshot();await compareCold(frame);
  // Re-select the App frame after cold worker queries; these are intentionally
  // separate workers and never used as the live preview's telemetry baseline.
  const initial=frame,initialStats=await stats(frame.worker),key=kind==='map'?'a':'lambda',values=kind==='map'?[-1.73,-1.61]:[-2.22,-2.31],edits=[];
  for(const value of values){phase=kind+' numeric '+value;const mark=await page.evaluate(()=>window.__editAudit.sequence);const input=page.getByRole('spinbutton',{name:'Parameter '+key,exact:true});await input.click();await input.fill(String(value));frame=await waitEdit(kind,key,value,mark);check(frame.worker===initial.worker,'numeric edit replaced Worker');const observed=await stats(frame.worker);check(JSON.stringify(observed)===JSON.stringify(initialStats),'numeric edit created GL context or recompiled shader/program');check(frame.sha!==initial.sha,'numeric edit did not change pixels');const oracle=await compareCold(frame);edits.push({value,worker:frame.worker,counts:observed,sha:frame.sha,cold:oracle});}
  const row={kind,initial:{worker:initial.worker,counts:initialStats,sha:initial.sha},edits};
  if(kind==='map'){
   phase='map formula';const old=frame.request.scene.equations.x,next='0.91*('+old+')',mark=await page.evaluate(()=>window.__editAudit.sequence);await page.locator('.equation-field textarea').first().fill(next);await page.getByRole('button',{name:'Apply equations',exact:true}).click();
   await page.waitForFunction(({mark,next})=>window.__editAudit.completed.some(c=>c.request.sequence>mark&&c.request.scene.equations.x===next),{mark,next});await ready();await settled();frame=await snapshot();const changed=await stats(frame.worker);check(changed.compileShader>initialStats.compileShader&&changed.linkProgram>initialStats.linkProgram,'formula edit did not rebuild its GPU program');check(changed.contexts===initialStats.contexts&&frame.worker===initial.worker,'formula edit unnecessarily replaced context/Worker');row.formula={counts:changed,sha:frame.sha,cold:await compareCold(frame)};
  }
  phase=kind+' save';await page.getByRole('button',{name:'Save',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export project JSON',exact:true}).click();const path=prefix+'-'+kind+'.mathart.json';await(await download).saveAs(path);const saved=JSON.parse(await readFile(path,'utf8'));check(saved.parameters[key]===values.at(-1),'saved project lost numeric edit');if(kind==='map')check(saved.equations.x===frame.request.scene.equations.x,'saved project lost formula edit');
  await page.reload();await ready();await settled();frame=await snapshot();check(frame.request.scene.parameters[key]===values.at(-1),'workspace reopen lost edit');row.reopen={sha:frame.sha,cold:await compareCold(frame)};
  phase=kind+' PNG';await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');const pngWait=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const pngPath=prefix+'-'+kind+'.png';await(await pngWait).saveAs(pngPath);await page.getByText('File ready · Download',{exact:false}).waitFor();
  const exported=await page.evaluate(()=>window.__editAudit.completed.findLast(c=>c.request.context.quality==='export'));check(exported,'No genuine export Worker frame');const oracle=await compareCold(exported);const bytes=await readFile(pngPath);check(bytes.readUInt32BE(16)===257&&bytes.readUInt32BE(20)===193,'PNG dimensions differ');
  const rendered=await page.evaluate(async request=>{const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),g=new Generator(),r=new ArtRenderer(document.createElement('canvas'));window.__editAudit.cold=true;try{const out=await g.generate(request.scene,request.context);r.setSize(request.context.width,request.context.height,1);r.setOutput(out,sceneAtTime(request.scene,request.context.time),false);const blob=await r.blob('image/png');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');}finally{g.dispose();window.__editAudit.cold=false;r.dispose();r.renderer.forceContextLoss();}},exported.request);
  check(rendered===sha(bytes),'downloaded PNG differs from independently rendered cold output');row.png={width:257,height:193,sha:sha(bytes),workerRgba:exported.sha,cold:oracle,coldRenderedPng:rendered};await page.getByRole('button',{name:'Close export',exact:true}).click();report.cases.push(row);
 }
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sourceAfter);check(report.sourceStable,'Production source changed during verification');check(!pageErrors.length,'Page errors');report.workerErrors=await page.evaluate(()=>window.__editAudit.errors);check(!report.workerErrors.length,'Worker errors');report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error);report.stack=error.stack;if(page){await page.screenshot({path:prefix+'-failure.png'});report.body=await page.locator('body').innerText();report.audit=await page.evaluate(()=>({requests:window.__editAudit?.requests,completed:window.__editAudit?.completed,errors:window.__editAudit?.errors}));}process.exitCode=1;
}finally{
 report.pageErrors=pageErrors;report.cleanup=[];for(const [name,resource]of [['browser',browser],['vite',server],['export-service',service]])try{await resource?.close();report.cleanup.push({resource:name,status:'closed'});}catch(e){report.cleanup.push({resource:name,status:'failed',error:String(e)});report.status='failed';process.exitCode=1;}
 await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,cases:report.cases,sourceStable:report.sourceStable,cleanup:report.cleanup},null,2));
}
