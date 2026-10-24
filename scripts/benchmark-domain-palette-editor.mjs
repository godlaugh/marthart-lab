/** Equal public Manual edits before/after the Domain generator session owner.
 * Only owned headless Chrome is used. --prepare-only does not launch it. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer as tcpServer} from 'node:net';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {measureFamily} from './browser-process-cost.mjs';

const root=resolve('.'),script='scripts/benchmark-domain-palette-editor.mjs',sha=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const baseline=git(['rev-parse','511dee4^{commit}']).trim(),names=['src/App.tsx','src/components/DomainColorControls.tsx'];
const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,{before:git(['show',baseline+':'+name]),after:await readFile(name,'utf8')}])));
const sourceHashes=async()=>{
 const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(tsx?|json|css)$/.test(p)).map(p=>'src/'+p);
 paths.push(script,'scripts/browser-process-cost.mjs','package-lock.json','vite.config.ts');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
};
await mkdir('.cache/domain-palette-editor-cost-20261024',{recursive:true});
const directory=await mkdtemp('.cache/domain-palette-editor-cost-20261024/run-');
const report={status:'prepared',directory,at:new Date().toISOString(),baseline,head:git(['rev-parse','HEAD']).trim(),node:process.version,
 scope:'Two sequential owned Chrome families. Same project, GPU formula z^3-1, paused public App, six first-color Manual edits with completed actual RGBA delivery. New Cosine/Curve features have separate functional verification.',
 comparison:'Only App.tsx and DomainColorControls.tsx are replaced with pinned baseline sources; every other dependency is current for both variants. This isolates App/editor owner cost, not two complete historical versions.',
 measurement:'Cold includes App navigation/module import, initial render and Appearance opening after empty-page workspace preparation. Warm includes six UI edits and completed Worker/renderer delivery, with full RGBA SHA256. Browser launch, Vite setup and fixture preparation excluded. Chrome family ps CPU deltas/RSS sampled at boundaries and every250ms; missed short-lived children/transient peaks possible. No OS/driver cache flush. One sample per variant; no generalized speedup claim.',
 unmeasured:['Agent tokens','Node/Vite CPU and memory','GPU device time/VRAM','Original application cost or effects','Browser launch/Vite setup/fixture preparation'],sourceBefore:await sourceHashes(),sourcePins:Object.fromEntries(names.map(n=>[n,{before:sha(source[n].before),after:sha(source[n].after)}])),results:[],failures:[]};
await writeFile(directory+'/benchmark.mjs',await readFile(script));
for(const name of names)for(const variant of ['before','after'])await writeFile(directory+'/'+variant+'-'+name.split('/').at(-1),source[name][variant]);
const persist=()=>writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');await persist();
const freePort=async()=>{const s=tcpServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const port=s.address().port;await new Promise((ok,no)=>s.close(e=>e?no(e):ok()));return port;};
function installAudit(){
 window.__domainPaletteCost={sequence:0,rows:[],renders:[],owners:new WeakMap(),workers:{created:0,terminated:0}};
 const Native=window.Worker,a=window.__domainPaletteCost;
 window.Worker=class extends Native{constructor(...args){super(...args);a.workers.created++;let ended=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!ended){ended=true;a.workers.terminated++;}stop();};}};
}
const generatorAudit=`
if(typeof window!=='undefined'){
 const native=Generator.prototype.generate;
 Generator.prototype.generate=async function(scene,input,...args){
  const a=window.__domainPaletteCost,row={sequence:++a.sequence,scene:structuredClone(scene),input:structuredClone(input)};a.rows.push(row);
  try{const o=await native.call(this,scene,input,...args);row.output={type:o.type,backend:o.backend,width:o.width,height:o.height,domainLive:o.domainLive,domainRender:o.domainRender};
   if(o.pixels)row.rgbaSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',o.pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');
   a.owners.set(o,row.sequence);return o;
  }catch(e){row.error=String(e);throw e;}
 };
}`;
const rendererAudit=`
if(typeof window!=='undefined'){
 const native=ArtRenderer.prototype.setOutput;
 ArtRenderer.prototype.setOutput=function(output,...args){const result=native.call(this,output,...args),a=window.__domainPaletteCost,sequence=a?.owners.get(output);if(sequence)a.renders.push(sequence);return result;};
}`;
if(process.argv.includes('--prepare-only'))console.log(JSON.stringify({status:'prepared-only',directory,browserStarted:false}));
else{
 const started=performance.now();report.status='running';
 for(const variant of ['before','after']){
  const row={variant,status:'running',phases:[],pageErrors:[],substitutions:[],cleanup:[]};report.results.push(row);
  let server,browserServer,browser,page,deadline;
  try{
   const port=await freePort();
   server=await createServer({root,mode:'preview-v2',plugins:[{name:'domain-editor-baseline',enforce:'pre',load(id){
    const name=names.find(n=>resolve(n)===id.split('?')[0]);if(!name)return null;row.substitutions.push({name,sha256:sha(source[name][variant])});return{code:source[name][variant],map:null};
   },transform(code,id){const path=id.split('?')[0];return path===resolve('src/engine/client.ts')?{code:code+generatorAudit,map:null}:path===resolve('src/engine/renderer.ts')?{code:code+rendererAudit,map:null}:null;}}],server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});
   await server.listen();browserServer=await chromium.launchServer({channel:'chrome',headless:true});
   const process=browserServer.process();assert.ok(process.pid);row.rootPid=process.pid;row.spawnfile=process.spawnfile;row.spawnargs=process.spawnargs;
   browser=await chromium.connect(browserServer.wsEndpoint());row.browser=browser.version();page=await browser.newPage({viewport:{width:1120,height:800},deviceScaleFactor:1});page.setDefaultTimeout(30000);page.on('pageerror',e=>row.pageErrors.push(String(e)));await page.addInitScript(installAudit);
   deadline=setTimeout(()=>{row.deadlineExpired=true;void browserServer?.close().catch(()=>{});},120000);
   const origin=server.resolvedUrls.local[0];await page.route('**/domain-palette-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'domain-palette-fixture');
   await page.evaluate(async()=>{
    const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');
    const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain palette equal workload',palette:['#80112233','#44DD88','#3355EE'],settings:{render_mode:'GPU'},domainColoring:{formula:'z^3-1'},timeline:[{type:'wait',duration:3}]})).scene;
    scene.id='domain-palette-cost';scene.settings.domainBackend='gpu';scene.settings.domainRenderPolicy='selected-rules-1723';
    if(scene.formulas)for(const value of Object.values(scene.formulas))if(value&&typeof value==='object'&&'visible'in value)value.visible=false;
    saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'high',frameRate:30}});
   });
   const ready=async(after=0,sceneTime=Math.fround(1/30))=>{
    await page.waitForFunction(after=>{const a=window.__domainPaletteCost,r=a.rows.findLast(r=>r.scene.id==='domain-palette-cost');return r?.sequence>after&&r.rgbaSha256&&a.renders.includes(r.sequence)&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},after);
    const r=await page.evaluate(()=>window.__domainPaletteCost.rows.findLast(r=>r.scene.id==='domain-palette-cost'));
    assert.equal(r.output.backend,'webgl2');assert.equal(r.output.domainRender.effective.color,'mathart-1.7.8-gpu');assert.equal(r.output.domainLive.paused,true);assert.equal(r.output.domainLive.sceneTime,sceneTime);assert.equal(r.output.domainLive.updateOrdinal,0);return r;
   };
   row.phases.push(await measureFamily(process.pid,async()=>{const t=performance.now();await page.goto(origin);const initial=await ready();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Source color',{exact:true}).waitFor();const displayed=await ready();assert.equal(displayed.sequence,initial.sequence,'Appearance hydration emitted a generation');return{phase:'cold-app-and-appearance',elapsedMs:performance.now()-t,frames:[displayed]};}));
   row.phases.push(await measureFamily(process.pid,async()=>{
    const t=performance.now(),frames=[];let prior=row.phases[0].frames[0];
    for(const color of ['#a13377','#2244cc','#dd8811','#4488aa','#bb33dd','#11aa88']){
     const seq=await page.evaluate(()=>window.__domainPaletteCost.sequence);await page.getByLabel('Source color',{exact:true}).fill(color);const current=await ready(seq,0);
     assert.equal(current.scene.domainSourcePalette.colors[0].toUpperCase(),'#80'+color.slice(1).toUpperCase());assert.ok(current.output.domainLive.revision>prior.output.domainLive.revision);assert.equal(current.output.domainLive.sessionId,prior.output.domainLive.sessionId);frames.push(current);prior=current;
    }
    return{phase:'warm-six-manual-edits',elapsedMs:performance.now()-t,frames};
   }));
   assert.equal(row.pageErrors.length,0);for(const phase of row.phases)assert.deepEqual(phase.processFamily.samplingErrors,[]);
   row.audit=await page.evaluate(()=>({workers:window.__domainPaletteCost.workers,requests:window.__domainPaletteCost.rows.length}));
   for(const name of names)assert.ok(row.substitutions.some(x=>x.name===name&&x.sha256===report.sourcePins[name][variant]));
   row.status='completed';
  }catch(error){row.status='failed';row.error=String(error);row.lastAudit=await page?.evaluate(()=>window.__domainPaletteCost?.rows.slice(-2)).catch(()=>undefined);report.failures.push(variant+': '+row.error);}
  finally{
   clearTimeout(deadline);
   for(const [resource,close]of [['browser',()=>browser?.close()],['ownedChromeFamily',()=>browserServer?.close()],['vite',()=>server?.close()]])try{await close();row.cleanup.push({resource,status:'fulfilled'});}catch(e){row.cleanup.push({resource,status:'rejected',error:String(e)});report.failures.push(variant+': '+resource+' cleanup failed');}
   if(browserServer)row.chromeExit={exitCode:browserServer.process().exitCode,signalCode:browserServer.process().signalCode};await persist();
   console.log(JSON.stringify({variant,status:row.status,error:row.error,phases:row.phases.map(p=>({phase:p.phase,elapsedMs:p.elapsedMs,cpuMs:p.processFamily.observedCpuMs,peakRssKiB:p.processFamily.sampledPeakRssKiB}))}));
  }
 }
 const signatures=r=>r.phases.flatMap(p=>p.frames.map(f=>({rgba:f.rgbaSha256,width:f.output.width,height:f.output.height,palette:f.scene.domainSourcePalette})));
 report.equalPixelSequence=report.results.every(r=>r.status==='completed')&&JSON.stringify(signatures(report.results[0]))===JSON.stringify(signatures(report.results[1]));
 if(!report.equalPixelSequence)report.failures.push('Equivalent manual workload did not produce equal complete pixel sequences');
 report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)report.failures.push('Sources changed during comparison');
 report.elapsedMs=performance.now()-started;report.status=report.failures.length?'failed':'measured';await persist();console.log(JSON.stringify({status:report.status,directory,failures:report.failures}));if(report.failures.length)process.exitCode=1;
}
