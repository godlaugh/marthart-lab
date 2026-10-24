/** Equivalent public Roots Manual edits across two complete source trees.
 * --prepare-only archives/pins sources without starting Vite or a browser. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,mkdtemp,symlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer as tcpServer} from 'node:net';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {measureFamily} from './browser-process-cost.mjs';

const {values}=parseArgs({options:{'prepare-only':{type:'boolean',default:false},directory:{type:'string',default:'.cache/roots-control-ui-cost-20261024'}}});
const scriptPath=fileURLToPath(import.meta.url),root=resolve(dirname(scriptPath),'..'),script=relative(root,scriptPath);
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fileSha(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const baselineCommit=git(['rev-parse','d6bf8dd^{commit}']).trim(),head=git(['rev-parse','HEAD']).trim();
const parent=resolve(root,values.directory);assert.match(relative(resolve(root,'.cache'),parent),/^roots-control-ui-cost-[^/]+$/,'Keep evidence in an owned Roots cost directory');
await mkdir(parent,{recursive:true});const directory=await mkdtemp(resolve(parent,'run-')),baselineRoot=resolve(directory,'baseline');await mkdir(baselineRoot);
const archive=resolve(directory,'baseline.tar');git(['archive','--format=tar','--output='+archive,baselineCommit]);
execFileSync('tar',['-xf',archive,'-C',baselineRoot],{cwd:root});await symlink(resolve(root,'node_modules'),resolve(baselineRoot,'node_modules'),'dir');
const baselineFiles=git(['ls-tree','-rz','--name-only',baselineCommit]).split('\0').filter(Boolean);
const archivedHashes=Object.fromEntries(await Promise.all(baselineFiles.map(async path=>[path,await fileSha(resolve(baselineRoot,path))])));
async function sourceHashes(sourceRoot){
 const names=(await readdir(resolve(sourceRoot,'src'),{recursive:true})).filter(p=>/\.(ts|tsx|json|css)$/.test(p)).map(p=>'src/'+p);
 names.push('index.html','package.json','package-lock.json','vite.config.ts');
 return Object.fromEntries(await Promise.all(names.sort().map(async path=>[path,await fileSha(resolve(sourceRoot,path))])));
}
const currentBefore=await sourceHashes(root),baselineBefore=await sourceHashes(baselineRoot);
assert.equal(currentBefore['package-lock.json'],baselineBefore['package-lock.json'],'Existing dependencies must match both pinned lockfiles');
const colors=['#a13377','#2244cc','#dd8811','#4488aa','#bb33dd','#11aa88'];
const fixture={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Roots equal Manual palette workload',
 polynomial:{variable:'z',coefficients:{2:'1',0:'t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},sampling:{sample_count:256,batch_size:64,seed:91},
 palette:['#112233','#dd5522','#00aaff'],camera:{phi:'0',theta:'0',gamma:'0'},
 settings:{render_mode:'DENSITY',worker_count:1,max_splat_points_per_frame:64,color_metric:'im(t2)',scale_x:35,scale_y:35,scale_z:35,dot_size:.03,brightness:1,contrast:1,gamma:2.2,dynamic_range:.9,saturation:1,background_color:'#000000'},timeline:[]};
const report={status:'prepared',at:new Date().toISOString(),directory,baselineCommit,head,node:process.version,nodeExecutable:process.execPath,
 command:[process.execPath,scriptPath,...process.argv.slice(2)],scriptSha256:await fileSha(scriptPath),processSamplerSha256:await fileSha(resolve(root,'scripts/browser-process-cost.mjs')),
 comparison:'Complete git archive d6bf8dd versus the complete current working source tree. Baseline has no current source substitutions. Both use the existing identical lockfile dependencies through a node_modules symlink, with separate Vite dependency caches and fresh headless Chrome families.',
 scope:'Paused public App Roots density, one actual CPU sampling Worker, seed91, 256 polynomial samples and batch64, fixed browser1120x800/DPR1/project aspect480x360/low preview quality. Complete initial image, then exactly six first-color Manual RGB changes through the public color input, each awaited through production Generator and actual ArtRenderer delivery.',
 measurement:'Cold phase: first App navigation/Worker setup, initial completed sampling and Appearance opening. Warm phase: six committed UI RGB change events and complete resulting frames. Process-family CPU deltas and summed RSS peaks use the verifier Node PID, covering this Node/Vite process and its Chrome descendants, sampled at boundaries/every250ms. Archive extraction, Vite/Chrome launch and workspace preparation are outside phases. The same Node process serves both variants sequentially; module/JIT/OS/driver caches are not flushed. Passive hashing/observation is included. One run per variant, no statistical speedup claim.',
 unmeasured:['Agent token usage','GPU device time and VRAM','Transient RSS peaks/short-lived processes missed by ps sampling','Original application behavior/cost','Flushed-cache cold performance','Browser/server startup and archive preparation'],
 fixture,edits:colors,sourceBefore:{before:baselineBefore,after:currentBefore},archive:{path:archive,sha256:await fileSha(archive),files:baselineFiles.length,sourceHashes:archivedHashes,nodeModulesTarget:resolve(root,'node_modules')},results:[],failures:[],nativeParity:false};
await writeFile(resolve(directory,'benchmark.mjs'),await readFile(scriptPath));
const persist=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await persist();
const freePort=async()=>{const s=tcpServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const port=s.address().port;await new Promise((ok,no)=>s.close(e=>e?no(e):ok()));return port;};

function installAudit(channel){
 const a=window.__rootsPaletteCost={sequence:0,rows:[],renders:[],owners:new WeakMap(),observations:[],workers:{created:0,terminated:0},
  hash:async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')};
 a.channel=new BroadcastChannel(channel);a.channel.onmessage=e=>a.observations.push(e.data);
 const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);a.workers.created++;let ended=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!ended){ended=true;a.workers.terminated++;}stop();};}};
}
const generatorObserver=`
if(typeof window!=='undefined'){
 const native=Generator.prototype.generate;
 Generator.prototype.generate=async function(scene,input,...args){
  const a=window.__rootsPaletteCost,row={sequence:++a.sequence,scene:structuredClone(scene),input:structuredClone(input)};a.rows.push(row);
  try{const output=await native.call(this,scene,input,...args);row.output={type:output.type,backend:output.backend,width:output.width,height:output.height,roots:output.roots,rootsLive:output.rootsLive,rootsPresentation:output.rootsPresentation};
   if(output.pixels){row.rgbaSha256=await a.hash(output.pixels);row.pixelBytes=output.pixels.byteLength;}
   a.owners.set(output,row.sequence);return output;
  }catch(e){row.error=String(e);throw e;}
 };
}`;
const rendererObserver=`
if(typeof window!=='undefined'){const native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,...args){const result=native.call(this,output,...args),a=window.__rootsPaletteCost,sequence=a?.owners.get(output);if(sequence)a.renders.push(sequence);return result;};}
`;
function poolObserver(channel){return`
const rootsCostAudit=globalThis.__rootsCostPoolObserver??=(function(){const channel=new BroadcastChannel(${JSON.stringify(channel)}),ids=new WeakMap();let next=0;return{pool(p){if(!ids.has(p))ids.set(p,++next);return ids.get(p);},emit(row,bytes){if(bytes){const copy=bytes.slice();crypto.subtle.digest('SHA-256',copy).then(hash=>channel.postMessage({...row,sha256:Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('')})).catch(e=>channel.postMessage({kind:'observer-error',error:String(e)}));}else channel.postMessage(row);}};})();
const rootsCostStart=RootsComputationPool.prototype.start,rootsCostTake=RootsComputationPool.prototype.take;
RootsComputationPool.prototype.start=function(...args){const result=rootsCostStart.apply(this,args);rootsCostAudit.emit({kind:'pool-start',pool:rootsCostAudit.pool(this),plan:this.describe()});return result;};
RootsComputationPool.prototype.take=function(...args){const b=rootsCostTake.apply(this,args);if(b)rootsCostAudit.emit({kind:'batch',pool:rootsCostAudit.pool(this),sequence:b.sequence,workerIndex:b.workerIndex,terminal:b.terminal,bytes:b.points.byteLength,progress:structuredClone(b.progress),invalidRoots:b.invalidRoots},new Uint8Array(b.points.buffer,b.points.byteOffset,b.points.byteLength));return b;};
`;}

if(values['prepare-only'])console.log(JSON.stringify({status:'prepared-only',directory,baselineCommit,browserStarted:false}));
else{
 const started=performance.now();report.status='running';
 for(const variant of ['before','after']){
  const sourceRoot=variant==='before'?baselineRoot:root,row={variant,sourceRoot,status:'running',phases:[],pageErrors:[],loadedSources:{},cleanup:[]};report.results.push(row);
  let server,browserServer,browser,page,deadline;
  try{
   const channel='roots-palette-cost-'+variant+'-'+Date.now(),port=await freePort();
   const additions={'src/engine/client.ts':generatorObserver,'src/engine/renderer.ts':rendererObserver,'src/engine/rootsComputationPool.ts':poolObserver(channel)};
   server=await createServer({root:sourceRoot,configFile:resolve(sourceRoot,'vite.config.ts'),envDir:sourceRoot,cacheDir:resolve(directory,variant+'-vite-cache'),mode:'preview-v2',plugins:[{
    name:'roots-cost-passive-observers',enforce:'pre',async load(id){const path=id.split('?')[0],name=relative(sourceRoot,path);if(name.startsWith('src/')&&/\.(tsx?|json|css)$/.test(name))row.loadedSources[name]=await fileSha(path);return null;},
    transform(code,id){const extra=additions[relative(sourceRoot,id.split('?')[0])];return extra?{code:code+'\n'+extra,map:null}:null;},
   }],server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});
   await server.listen();browserServer=await chromium.launchServer({channel:'chrome',headless:true});const child=browserServer.process();assert.ok(child.pid);
   row.process={verifierRootPid:process.pid,chromeRootPid:child.pid,spawnfile:child.spawnfile,spawnargs:child.spawnargs};
   browser=await chromium.connect(browserServer.wsEndpoint());row.browser=browser.version();page=await browser.newPage({viewport:{width:1120,height:800},deviceScaleFactor:1});page.setDefaultTimeout(60000);page.on('pageerror',e=>row.pageErrors.push(String(e)));page.on('crash',()=>row.pageErrors.push('page crashed'));await page.addInitScript(installAudit,channel);
   deadline=setTimeout(()=>{row.deadlineExpired=true;void browserServer?.close().catch(()=>{});},180000);
   const origin=server.resolvedUrls.local[0];await page.route('**/api/health',r=>r.fulfill({status:503,body:'No export service used by this benchmark'}));await page.route('**/roots-palette-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'roots-palette-fixture');
   row.fixture=await page.evaluate(async raw=>{
    const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');
    const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.id='roots-palette-cost';scene.projectResolution={width:480,height:360};
    if(scene.formulas)for(const item of Object.values(scene.formulas))if(item&&typeof item==='object'&&'visible'in item)item.visible=false;
    if(scene.rootsPresentation?.previewMode!=='live-worker-arrival-v1')throw Error('Fixture did not select actual live Roots');
    saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
   },fixture);
   const catalog=Object.assign({},...await Promise.all(['metadata','components','application'].map(async n=>JSON.parse(await readFile(resolve(sourceRoot,'src/locales/'+n+'.en.json'),'utf8'))))),label=s=>catalog[s]??s;
   const ready=async(after=0)=>{
    await page.waitForFunction(after=>{const a=window.__rootsPaletteCost,r=a.rows.findLast(r=>r.scene.id==='roots-palette-cost');return r?.sequence>after&&r.rgbaSha256&&r.output?.rootsLive?.stream.canFinishAfterDisplay&&a.renders.includes(r.sequence)&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},after);
    const frame=await page.evaluate(()=>window.__rootsPaletteCost.rows.findLast(r=>r.scene.id==='roots-palette-cost'));
    assert.equal(frame.output.type,'raster');assert.equal(frame.output.backend,'webgl2');assert.equal(frame.output.rootsLive.paused,true);assert.equal(frame.output.rootsLive.sceneTime,0);assert.equal(frame.output.rootsPresentation.mode,'density');assert.equal(frame.output.rootsPresentation.target,'primary');assert.equal(frame.output.rootsLive.stream.pool.workerCount,1);assert.equal(frame.output.roots.attemptedSamples,256);assert.equal(frame.output.roots.rootPoints,512);assert.equal(frame.pixelBytes,frame.output.width*frame.output.height*4);
    await page.waitForFunction(taken=>{const a=window.__rootsPaletteCost;return a.observations.filter(r=>r.kind==='batch').length===taken;},frame.output.rootsLive.stream.pool.taken);return frame;
   };
   row.phases.push(await measureFamily(process.pid,async()=>{
    const t=performance.now();await page.goto(origin);const first=await ready();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel(label('复根源颜色'),{exact:true}).waitFor();const anchor=await ready();assert.equal(anchor.sequence,first.sequence,'Appearance opening emitted generation');
    return{phase:'cold-app-and-completed-density',elapsedMs:performance.now()-t,frames:[anchor]};
   }));
   row.phases.push(await measureFamily(process.pid,async()=>{
    const t=performance.now(),frames=[],anchor=row.phases[0].frames[0];
    for(const color of colors){
     const seq=await page.evaluate(()=>window.__rootsPaletteCost.sequence),editStarted=performance.now();
     // A single committed native input event, rather than Playwright fill's
     // input+change pair, keeps the public authoring action count identical.
     await page.getByLabel(label('复根源颜色'),{exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}));},color);
     const current=await ready(seq);current.editElapsedMs=performance.now()-editStarted;current.editedColor=color;
     assert.equal(current.sequence,seq+1,'One committed RGB change issued more than one generation');assert.equal(current.scene.rootsSourcePalette.colors[0].toLowerCase(),'#ff'+color.slice(1));assert.equal(current.output.rootsPresentation.instance,anchor.output.rootsPresentation.instance);assert.equal(current.output.rootsLive.sessionId,anchor.output.rootsLive.sessionId);assert.deepEqual(current.output.roots,anchor.output.roots);assert.equal(current.output.rootsLive.stream.pool.taken,anchor.output.rootsLive.stream.pool.taken);assert.equal(current.output.rootsPresentation.newSamples,0);assert.equal(current.output.width,anchor.output.width);assert.equal(current.output.height,anchor.output.height);frames.push(current);
    }
    return{phase:'warm-six-manual-rgb-edits',elapsedMs:performance.now()-t,frames};
   }));
   row.observations=await page.evaluate(()=>window.__rootsPaletteCost.observations);assert.equal(row.observations.filter(r=>r.kind==='pool-start').length,1,'Palette edits rebuilt CPU sampling');assert.equal(row.observations.filter(r=>r.kind==='observer-error').length,0);
   const batches=row.observations.filter(r=>r.kind==='batch').sort((a,b)=>a.sequence-b.sequence);assert.equal(batches.at(-1)?.terminal,true);assert.equal(batches.at(-1)?.progress.attemptedSamples,256);row.batches=batches;
   row.audit=await page.evaluate(()=>({workers:window.__rootsPaletteCost.workers,requests:window.__rootsPaletteCost.rows.length,errors:window.__rootsPaletteCost.rows.filter(r=>r.error)}));assert.deepEqual(row.audit.errors,[]);assert.deepEqual(row.pageErrors,[]);
   for(const phase of row.phases)assert.deepEqual(phase.processFamily.samplingErrors,[]);
   for(const [name,digest]of Object.entries(row.loadedSources))assert.equal(digest,report.sourceBefore[variant][name],'Loaded source mismatch: '+name);
   for(const name of ['src/App.tsx','src/components/RootsDensityColorControls.tsx','src/engine/client.ts','src/engine/rootsNativePresentationSession.ts','src/engine/rootsComputationPool.ts'])assert.ok(row.loadedSources[name],'Missing actual loaded source identity: '+name);
   row.status='completed';
  }catch(error){row.status='failed';row.error=String(error.stack??error);row.lastAudit=await page?.evaluate(()=>({rows:window.__rootsPaletteCost?.rows.slice(-3),observations:window.__rootsPaletteCost?.observations})).catch(()=>undefined);row.body=await page?.locator('body').innerText().catch(()=>undefined);report.failures.push(variant+': '+row.error);}
  finally{
   clearTimeout(deadline);
   for(const [resource,close]of [['browser',()=>browser?.close()],['ownedChromeFamily',()=>browserServer?.close()],['vite',()=>server?.close()]])try{await close();row.cleanup.push({resource,status:'fulfilled'});}catch(error){row.cleanup.push({resource,status:'rejected',error:String(error)});report.failures.push(variant+': '+resource+' cleanup failed');}
   if(browserServer){const child=browserServer.process();row.chromeExit={exitCode:child.exitCode,signalCode:child.signalCode};if(child.exitCode===null&&child.signalCode===null)report.failures.push(variant+': owned Chrome exit unconfirmed');}
   await persist();console.log(JSON.stringify({variant,status:row.status,error:row.error,phases:row.phases.map(p=>({phase:p.phase,elapsedMs:p.elapsedMs,cpuMs:p.processFamily.observedCpuMs,peakRssKiB:p.processFamily.sampledPeakRssKiB}))}));
  }
 }
 const sequence=row=>row.phases.flatMap(phase=>phase.frames.map(frame=>({rgbaSha256:frame.rgbaSha256,pixelBytes:frame.pixelBytes,width:frame.output.width,height:frame.output.height,palette:frame.scene.rootsSourcePalette,roots:frame.output.roots,submitted:frame.output.rootsPresentation.density.submittedFinitePointCount})));
 report.equalCompleteRgbaSequence=report.results.every(r=>r.status==='completed')&&JSON.stringify(sequence(report.results[0]))===JSON.stringify(sequence(report.results[1]));
 report.equalConsumedCpuBatches=report.results.every(r=>r.status==='completed')&&JSON.stringify(report.results[0].batches)===JSON.stringify(report.results[1].batches);
 if(!report.equalCompleteRgbaSequence)report.failures.push('Initial plus six completed RGBA frames did not match across versions');
 if(!report.equalConsumedCpuBatches)report.failures.push('Consumed CPU batch bytes/progress did not match across versions');
 report.sourceAfter={before:await sourceHashes(baselineRoot),after:await sourceHashes(root)};report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable)report.failures.push('Sources changed during measurement');
 report.elapsedMs=performance.now()-started;report.status=report.failures.length?'failed':'measured';await persist();console.log(JSON.stringify({status:report.status,directory,equalCompleteRgbaSequence:report.equalCompleteRgbaSequence,equalConsumedCpuBatches:report.equalConsumedCpuBatches,failures:report.failures}));if(report.failures.length)process.exitCode=1;
}
