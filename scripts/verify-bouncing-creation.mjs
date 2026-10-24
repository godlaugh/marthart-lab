/** Real preview-v2 App actions against canonical creation recipes. Original
 * inputs are read-only oracles for payload identity, not a new runtime capture.
 * Rendering/playback use the selected real native or WebGL backend. */
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {measureFamily} from './browser-process-cost.mjs';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';

const out=process.argv[2],webgl=process.argv.includes('--webgl');
assert.ok(out&&!out.startsWith('--'),'Supply a new output directory');
await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={status:'running',at:new Date().toISOString(),backend:webgl?'webgl':'native',checks:[],cases:[],pageErrors:[],scope:'Actual preview-v2 App new scene, seven full-count templates, folder creation, play/seek and persistence. Complete payload identity against pinned original/guide inputs; no new original runtime, pixel-parity or performance improvement claim.'};
const check=(value,message)=>{assert.ok(value,message);report.checks.push(message);};
async function hashes(){
 const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p);
 paths.push('scripts/verify-bouncing-creation.mjs','scripts/lib/source-bouncing-original.mjs','scripts/browser-process-cost.mjs','tests/fixtures/source-bouncing-guide-compositions/cases.json','tests/fixtures/source-bouncing-native-animation/presets.json','server/index.mjs','server/source-renderer.mjs');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const root='../.cache/mathart-investigation/MathArt.app/Contents/app/resources/data/Bouncing';
const raw={},referenceFiles={};
for(const name of ['bouncing1','bouncing2','bouncing1_formula1','bouncing1_formula2']){
 const path=`${root}/${name}.json`,bytes=await readFile(path);sourceBouncingOriginalPreset(bytes);referenceFiles[path]=sha(bytes);raw[name]=JSON.parse(bytes);
}
const recipes=JSON.parse(await readFile('tests/fixtures/source-bouncing-guide-compositions/cases.json','utf8'));
for(const [name,recipe] of Object.entries(recipes.cases)){
 raw[name]=structuredClone(raw[recipe.basePreset]);Object.assign(raw[name].settings,recipe.settings);if(recipe.polygon)raw[name].polygon=recipe.polygon;
}
const cases=[['source-spiral','Spiral bouncing','bouncing1'],['source-star','Star bouncing','bouncing2'],['source-formula-grid','Sine grid bouncing','bouncing1_formula1'],['source-formula-rings','Cosine rings bouncing','bouncing1_formula2'],['source-rose','Rose bouncing','guide-rose'],['source-hexagon','Hexagon bouncing','guide-hexagon'],['source-ellipse','Ellipse bouncing','guide-ellipse']];
report.sourceBefore=await hashes();report.references=referenceFiles;
let browser,server,service,page,phase='setup';
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 let proxy;
 if(!webgl){const backend=JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND,'utf8'));report.nativeBackend=backend;service=await createExportServer({sourceRendererBackend:backend,root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);proxy={'/api':`http://127.0.0.1:${address.port}`};}
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify(webgl?'webgl':'native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,...(proxy?{proxy}:{})},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1360,height:920},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript(()=>{window.__creationAudit={calls:[]};});
 await context.route('**/src/engine/client.ts',async route=>{
  const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst originalGenerate=Generator.prototype.generate;
Generator.prototype.generate=async function(scene,input,...args){
 if(scene.kind!=='bouncing')return originalGenerate.call(this,scene,input,...args);
 const entry={scene:structuredClone(scene),input:structuredClone(input)};window.__creationAudit.calls.push(entry);
 try{const output=await originalGenerate.call(this,scene,input,...args);entry.output={frame:output.sourceBouncingFrame,backend:output.sourcePixelRenderer?.backend??output.backend,width:output.width,height:output.height,pixelSha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output.pixels))).map(n=>n.toString(16).padStart(2,'0')).join(''),nonBlack:output.pixels.some((n,i)=>i%4!==3&&n!==0)};return output;}
 catch(error){entry.error=String(error);throw error;}
};`});
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/creation-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html></html>'}));await page.goto(origin+'creation-fixture');
 const expected=await page.evaluate(async raw=>{
  const {importSourceBouncingDocument}=await import('/src/engine/sourceBouncingDocument.ts');
  const {createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('spirograph'));saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return Object.fromEntries(Object.entries(raw).map(([name,input])=>{const result=importSourceBouncingDocument(input);if(!result.ok)throw Error(JSON.stringify(result.error));return[name,result.value.payload];}));
 },raw);
 const snapshot=()=>page.evaluate(()=>window.__creationAudit.calls.at(-1));
 const ready=async(name)=>{await page.waitForFunction(name=>{const call=window.__creationAudit.calls.at(-1);return call?.output&&(!name||call.scene.name===name)&&!document.querySelector('.error-card')&&!document.querySelector('.rendering-badge')&&!document.querySelector('[data-testid="source-bouncing-play"]')?.disabled;},name);return snapshot();};
 const inspect=async(label,source)=>{
  const current=await ready();assert.deepEqual(current.scene.bouncingSource,expected[source],`${label}: complete source payload`);report.checks.push(label+': complete payload matches pinned input');
  check(['settings','equations','parameters'].every(k=>Object.keys(current.scene[k]).length===0)&&current.scene.timeline.tracks.length===0,label+': source model has no legacy overrides');
  check(current.output.frame.checkpoint.simulationUpdates===0,label+': visible seed preview without autoplay');
  check(current.output.nonBlack&&current.output.width>0&&current.output.height>0,label+': actual visible raster');
  check(current.output.backend===(webgl?'webgl2':'native'),label+': requested backend rendered');
  return current;
 };
 const newScene=async(name,folder=false)=>{
  if(folder){await page.locator('.library-tabs button').filter({hasText:'My artworks'}).click();await page.getByTitle('Create scene here',{exact:true}).click();await page.locator('.library-actions button').filter({hasText:'Billiard particles'}).click();}
  else{await page.getByRole('button',{name:'New scene',exact:true}).click();await page.locator('.new-menu button').filter({hasText:'Billiard particles'}).click();}
  await page.getByRole('textbox',{name:'New scene name',exact:true}).fill(name);await page.getByRole('button',{name:'Confirm',exact:true}).click();await ready(name);
 };
 const measured=await measureFamily(process.pid,async()=>{
  const start=performance.now();await page.goto(origin);await page.getByTestId('creation-preview-note').waitFor();
  phase='new-scene';await newScene('Creation default');const first=await inspect('New scene','bouncing1');check(!first.scene.id.startsWith('preset:'),'New work has independent identity');
  const initialHash=first.output.pixelSha;
  phase='playback';await page.getByTestId('source-bouncing-play').click();await page.waitForFunction(()=>window.__creationAudit.calls.at(-1)?.output?.frame.checkpoint.simulationUpdates>=2);await page.getByTestId('source-bouncing-play').click();await ready();
  check((await snapshot()).output.frame.checkpoint.simulationUpdates>=2,'New scene plays actual simulation');
  await page.getByTestId('source-bouncing-seek').fill('0');await page.getByTestId('source-bouncing-seek').press('Enter');await page.waitForFunction(()=>window.__creationAudit.calls.at(-1)?.output?.frame.checkpoint.simulationUpdates===0);await ready();check((await snapshot()).output.pixelSha===initialHash,'Seek to seed restores identical pixels');
  phase='templates';await page.locator('.library-tabs button').filter({hasText:'Templates'}).click();
  for(const [id,label,source] of cases){
   await page.locator('.preset-card').filter({hasText:label}).click();await page.waitForFunction(id=>window.__creationAudit.calls.at(-1)?.scene.id===`preset:bouncing:${id}`,id);
   const current=await inspect(label,source);check(current.scene.id===`preset:bouncing:${id}`,label+': example identity');
   console.log('verified creation '+id);report.cases.push({id,source,particleCount:current.scene.bouncingSource.configuration.particleCount,payloadSha:sha(JSON.stringify(current.scene.bouncingSource)),output:current.output});
  }
  phase='example-save';await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.active&&!w.active.startsWith('preset:')&&w.scenes.find(s=>s.id===w.active)?.bouncingSource;});
  const saved=await page.evaluate(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.scenes.find(s=>s.id===w.active);});assert.deepEqual(saved.bouncingSource,expected['guide-ellipse']);check(saved.id!=='preset:bouncing:source-ellipse','Saving a built-in makes an independent work');
  await page.reload();await ready(saved.name);await inspect('Saved example reload','guide-ellipse');
  phase='folder-create';await newScene('Folder creation',true);const folder=await inspect('Folder creation','bouncing1');check(folder.scene.id!==first.scene.id,'Folder creation has an independent identity');
  await page.waitForFunction(id=>JSON.parse(localStorage.getItem('mathart-lab-v1')).scenes.some(s=>s.id===id),folder.scene.id);
  await page.reload();await ready('Folder creation');await inspect('Folder creation reload','bouncing1');
  await page.screenshot({path:out+'/creation.png'});return{elapsedMs:performance.now()-start};
 });report.measurements=measured;
 check(report.pageErrors.length===0,'No unhandled page errors');await browser.close();browser=undefined;
 if(service){const until=Date.now()+5000;while(service.ownedProcessCount&&Date.now()<until)await new Promise(r=>setTimeout(r,25));check(service.ownedProcessCount===0,'Browser exit retires native helper');}
 report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.last=await page.evaluate(()=>window.__creationAudit?.calls.slice(-2)).catch(()=>undefined);}process.exitCode=1;}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map(r=>r.status);report.remainingProcesses=service?.ownedProcessCount??0;
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referenceStable=(await Promise.all(Object.entries(referenceFiles).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);
 if(!report.sourceStable||!report.referenceStable||report.remainingProcesses||report.cleanup.includes('rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,phase:report.phase,error:report.error,report:out+'/report.json'}));
}
