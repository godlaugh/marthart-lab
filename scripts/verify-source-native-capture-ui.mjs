/** Actual import/export controls, queue, Worker, native host, PNG download and
 * cancellation. Image parity with the original is a separate matched-input test. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodePng} from './lib/verify-png.mjs';
const root=process.argv[2]??'.cache/source-native-capture-ui',sha=b=>createHash('sha256').update(b).digest('hex');await mkdir(root,{recursive:true});
const referenceRoot=process.argv[3]??'.cache/surface-native-reference-20261023';
assert.ok(process.env.MATHART_SOURCE_RENDERER_BACKEND,'Explicit native backend required');
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p),...(await readdir('server',{recursive:true})).filter(p=>/\.(mjs|m)$/.test(p)).map(p=>'server/'+p),'scripts/verify-source-native-capture-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),referenceRoot,scope:'Three caller-selected Surface configurations through actual UI; downloaded PNGs checked against the delivered base frame and shared formula/enhancement encoder. Controlled delayed transport tests cancellation, not original app parity.',cases:[],sourceBefore:await hashes()};let app,vite,browser;
try{
 app=await createExportServer({root:root+'/exports',sourceRendererBackend:JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND)),glyphBackend:JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json')),allowedOrigins:['http://127.0.0.1:5179']});const address=await app.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port:5179,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 for(const name of ['cornucopia','sphere','mobius']){
  const page=await browser.newPage({viewport:{width:1360,height:900}}),row={name,downloads:[],nativeRequests:0,errors:[]};report.cases.push(row);page.setDefaultTimeout(20000);page.on('pageerror',e=>row.errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/source-renderer/frames'))row.nativeRequests++;});
  await page.addInitScript(()=>{window.__captures=[];const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.output?.surfaceLive)window.__lastSurface=data.output.surfaceLive;});}};});
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:5179/fixture');
  await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});});
  // Install an observer before App imports the same module; return values and
  // errors are unchanged. This records the producer used by the real control.
  await page.route('**/src/main.tsx',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:`import {Generator as AuditGenerator} from '/src/engine/client.ts';const originalCapture=AuditGenerator.prototype.captureSurfacePaused;AuditGenerator.prototype.captureSurfacePaused=async function(...args){try{const result=await originalCapture.apply(this,args);window.__latestCapture=result;window.__captures.push({producer:result.capture.sourcePixelRenderer,frame:result.preview.surfaceLive.frame});return result;}catch(error){window.__lastCaptureError=String(error);throw error;}};\n`+body});});
  await page.goto('http://127.0.0.1:5179/');const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));await ready();
  const ref=referenceRoot+(name==='mobius'?'/mesh':'')+'/native-'+name,run=JSON.parse(await readFile(ref+'/run.json')),input=await readFile(run.source);assert.equal(sha(input),run.sourceSha256);row.inputSha256=sha(input);row.authoredRenderMode=JSON.parse(input).settings.render_mode;
  await page.locator('input[type=file]').setInputFiles({name:name+'.json',mimeType:'application/json',buffer:input});await page.waitForFunction(()=>window.__lastSurface?.paused&&window.__lastSurface.frame.sceneTime===0);await ready();
  const before=await page.evaluate(()=>window.__lastSurface.frame);await page.getByRole('button',{name:'Export artwork',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Surface image source',exact:true}).inputValue(),'current');
  await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('500');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('600');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
  for(let i=0;i<2;i++){
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending,file=root+'/'+name+'-'+i+'.png';await download.saveAs(file);assert.equal(await download.failure(),null);
   const bytes=await readFile(file),png=decodePng(bytes);assert.equal(png.width,500);assert.equal(png.height,600);const capture=await page.evaluate(()=>window.__captures.at(-1));assert.equal(capture.producer.backend,'native');assert.deepEqual(capture.frame,before);
   const gpu=await page.evaluate(()=>({mesh:!!window.__latestCapture.preview.sourceGpuMesh,points:!!window.__latestCapture.preview.sourceGpuPoints}));row.deliveredGpu=gpu;assert.equal(gpu.mesh||gpu.points,row.authoredRenderMode==='GPU');
   const expected=await page.evaluate(async()=>{const{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts');return Array.from(new Uint8Array(await(await encodeFormulaRaster(window.__latestCapture.capture,'image/png')).arrayBuffer()));});assert.deepEqual(png.rgba,decodePng(Buffer.from(expected)).rgba);
   row.downloads.push({file,sha256:sha(bytes),producer:capture.producer});
  }
  assert.equal(row.downloads[0].sha256,row.downloads[1].sha256);assert.equal(row.nativeRequests,2);
  if(name==='mobius'){
   let intercepted;const held=new Promise(resolve=>{intercepted=resolve;});let pendingRoute;
   await page.route('**/api/source-renderer/frames',route=>{pendingRoute=route;intercepted();});const delivered=await page.evaluate(()=>window.__captures.length);
   await page.getByRole('button',{name:'Start export',exact:true}).click();await held;await page.getByRole('button',{name:'Cancel export',exact:true}).click();
   await page.getByRole('button',{name:'Start export',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>window.__lastCaptureError?.includes('取消')||window.__lastCaptureError?.includes('abort'));
   assert.equal(await page.evaluate(()=>window.__captures.length),delivered);await pendingRoute.abort().catch(()=>{});await page.unroute('**/api/source-renderer/frames');
   const again=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const file=root+'/mobius-after-cancel.png';await(await again).saveAs(file);assert.equal(sha(await readFile(file)),row.downloads[0].sha256);row.cancelledRequestDidNotDeliver=true;row.recoveredAfterCancel=true;
  }
  assert.deepEqual(row.errors,[]);row.status='passed';await page.screenshot({path:root+'/'+name+'-ui.png'});await page.close();console.log(JSON.stringify({name,status:row.status,nativeRequests:row.nativeRequests}));
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}finally{
 const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),app?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=app?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(report.cleanupErrors.length||report.remainingProcesses!==0||!report.sourceStable){report.status='failed';process.exitCode=1;}await writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,report:root+'/report.json'}));
}
