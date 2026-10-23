/** Real App preview, display pixels, playback backpressure and resize cancellation. */
import {measureFamily} from './browser-process-cost.mjs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.argv[2];assert.ok(directory);await mkdir(directory);
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|css)$/.test(p)).map(p=>'src/'+p),'scripts/verify-source-native-viewport.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const started=performance.now();
const report={at:new Date().toISOString(),scope:'Actual App uses native Surface preview; full displayed framebuffer compared with corresponding native response for unlabelled frames. Source formula readiness is observed. Playback cannot advance while presentation is held; resize cancels stale delivery. This does not compare the full original GUI.',sourceBefore:await hashes(),cases:[]};let app,vite,browser,currentPage;const releases=[];
try{
 assert.ok(process.env.MATHART_SOURCE_RENDERER_BACKEND);
 app=await createExportServer({root:directory+'/service',sourceRendererBackend:JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND)),glyphBackend:JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json')),allowedOrigins:['http://127.0.0.1:5179']});const address=await app.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':'"native"'},server:{host:'127.0.0.1',port:5179,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 const measured=await measureFamily(process.pid,async()=>{
 for(const name of ['cpu-animated-points','gpu-animated-mesh','source-formulas','local-formulas']){
  const page=await browser.newPage({viewport:{width:1360,height:900}});currentPage=page;page.setDefaultTimeout(20000);
  const row={name,errors:[],requests:[],commits:[]};report.cases.push(row);page.on('pageerror',e=>row.errors.push(e.message));
  const expected=new Map();let hold=false,heldResolve,release;const held=new Promise(r=>heldResolve=r),gate=new Promise(r=>release=r);releases.push(release);
  await page.route('**/api/source-renderer/frames',async route=>{
   const delay=hold;hold=false;
   const response=await route.fetch(),body=await response.body(),headers=response.headers(),key=headers['x-source-generation']+':'+headers['x-source-sequence'];
   expected.set(key,sha(body));row.requests.push({key,width:Number(headers['x-source-width']),height:Number(headers['x-source-height']),samples:route.request().postDataBuffer().readUInt32LE(52)});
   if(delay){heldResolve();await gate;}
   await route.fulfill({response,body}).catch(()=>{});
  });
  await page.addInitScript(()=>{window.__nativeCommits=[];window.__nativeErrors=[];window.__updates=0;const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.output?.surfaceLive){window.__updates++;window.__surface=data.output.surfaceLive;}});}};});
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:5179/fixture');
  const input=JSON.parse(await readFile('.cache/source-native-recording-parity-20261024/inputs/'+(name.endsWith('formulas')?'cpu-animated-points':name)+'.json'));if(name==='source-formulas'){const labelled=JSON.parse(await readFile('.cache/source-surface-transition-formulas-20261024/reference/inputs/cpu-transition-formulas-4fps.json'));input.project.main_equation=labelled.project.main_equation;input.project.formulas=labelled.project.formulas;}input.localFormula=name==='local-formulas';row.inputSha256=sha(Buffer.from(JSON.stringify(input)));
  await page.evaluate(async input=>{const{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');const scene=parseProjectFile(JSON.stringify(input.project)).scene;if(input.localFormula)scene.formulas={referenceWidth:800,referenceHeight:600,main:{visible:true,x:40,y:80,scale:1,color:'#ffffff',latex:'x^2+y^2'},additional:[]};saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});},input);
  await page.route('**/src/main.tsx',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:`import {SourceNativeViewport as AuditViewport} from '/src/engine/sourceNativeViewport.ts';const submit=AuditViewport.prototype.submit;AuditViewport.prototype.submit=function(request){let snapshot;const canvas=this.canvas;return submit.call(this,{...request,failed:error=>{window.__nativeErrors.push(String(error));request.failed(error);},prepare:(...args)=>snapshot=request.prepare(...args),ready:()=>{request.ready();const gl=canvas.getContext('webgl2'),bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const frame=snapshot.frame,record={key:frame?frame.generation+':'+frame.sequence:'raster',width:canvas.width,height:canvas.height,labels:request.formulas.labels.length};window.__nativeCommits.push(record);crypto.subtle.digest('SHA-256',bytes).then(hash=>record.sha256=Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join(''));}});};\n`+body});});
  let glyphRelease,glyphArrived;const glyphGate=new Promise(r=>glyphRelease=r),glyphHeld=new Promise(r=>glyphArrived=r);releases.push(glyphRelease);
  if(name==='source-formulas')await page.route('**/api/formula-glyph',async route=>{glyphArrived();await glyphGate;await route.continue();});
  await page.goto('http://127.0.0.1:5179/');
  if(name==='source-formulas'){
   let timer;try{await Promise.race([glyphHeld,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('No formula preparation request')),20000))]);}finally{clearTimeout(timer);}
   await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__nativeCommits.length),0);assert.equal(await page.locator('[data-testid=native-art-canvas]').isVisible(),false);row.noPartialFrameWhileGlyphPending=true;glyphRelease();
  }
  await page.waitForFunction(()=>window.__nativeCommits?.some(c=>c.sha256)&&!document.querySelector('.error-card'));
  assert.equal(await page.locator('[data-testid=native-art-canvas]').isVisible(),true);assert.equal(await page.locator('[data-testid=art-canvas]').evaluate(e=>getComputedStyle(e).opacity),'0');
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__nativeCommits.filter(c=>c.sha256).length>=4);
  hold=true;let holdTimer;try{await Promise.race([held,new Promise((_,reject)=>holdTimer=setTimeout(()=>reject(Error('Native request was not scheduled')),20000))]);}finally{clearTimeout(holdTimer);}
  const stoppedAt=await page.evaluate(()=>({updates:window.__updates,commits:window.__nativeCommits.length}));
  await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>({updates:window.__updates,commits:window.__nativeCommits.length})),stoppedAt);row.backpressure=true;
  await page.setViewportSize({width:1400,height:920});
  await page.waitForFunction(count=>window.__nativeCommits.filter(c=>c.sha256).length>count,stoppedAt.commits);row.resizeCompletedBeforeOldDelivery=true;
  await page.getByRole('button',{name:'Pause',exact:true}).click();release();
  await page.waitForTimeout(150);await page.waitForFunction(()=>window.__nativeCommits.every(c=>c.sha256));
  row.commits=await page.evaluate(()=>window.__nativeCommits);
  for(const commit of row.commits){if(name.endsWith('formulas')){assert.ok(commit.labels>0);assert.notEqual(commit.sha256,expected.get(commit.key),'Formula pixels were not composed');}else{assert.equal(commit.labels,0);assert.equal(commit.sha256,expected.get(commit.key),'Displayed framebuffer differs from delivered native pixels');}}
  assert.ok(row.requests.some(r=>r.samples===4));assert.deepEqual(row.errors,[]);assert.equal(await page.locator('.error-card').count(),0);
  row.status='passed';await page.screenshot({path:directory+'/'+name+'.png'});await page.close();console.log(JSON.stringify({name,status:row.status,commits:row.commits.length,requests:row.requests.length}));
 }
 return {};});report.processFamily=measured.processFamily;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(currentPage){report.failureState=await currentPage.evaluate(()=>({errors:window.__nativeErrors,commits:window.__nativeCommits,updates:window.__updates,alerts:[...document.querySelectorAll('.error-card,[role=alert]')].map(e=>e.textContent),status:document.querySelector('.status-bar')?.textContent})).catch(()=>null);await currentPage.screenshot({path:directory+'/failure.png'}).catch(()=>{});}}
finally{
 for(const release of releases)release();
 const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),app?.close()]);report.cleanupErrors=cleanup.filter(x=>x.status==='rejected').map(x=>String(x.reason));report.remainingProcesses=app?.ownedProcessCount;report.elapsedMs=performance.now()-started;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(report.cleanupErrors.length||report.remainingProcesses!==0||!report.sourceStable)report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:directory+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
