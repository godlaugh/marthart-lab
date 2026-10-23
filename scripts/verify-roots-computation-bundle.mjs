import {build,preview} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['src/engine/rootsComputation.ts','src/engine/rootsComputationPool.ts','src/engine/rootsComputation.worker.ts','src/engine/rootsMathJob.ts','src/engine/rootsNativePointReader.ts','scripts/verify-roots-computation-bundle.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(p))])));
const sourceBefore=await hashes();
const output=path.resolve(process.argv[2]??'.cache/roots-computation-pool-20261023/bundle'),fixture=path.join(output,'fixture'),dist=path.join(output,'dist');
await mkdir(fixture,{recursive:true});
await writeFile(path.join(fixture,'index.html'),'<!doctype html><script type="module" src="/main.js"></script>');
await writeFile(path.join(fixture,'main.js'),`
window.runRootsPool=(text,action)=>new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./host.js',import.meta.url),{type:'module'}),timeout=setTimeout(()=>finish(Error('bundle deadline')),30000);
 function finish(error,value){clearTimeout(timeout);worker.terminate();if(error)reject(error);else resolve(value);}
 worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(null,data);worker.onerror=e=>finish(Error(e.message));worker.postMessage({text,action});
});
`);
await writeFile(path.join(fixture,'host.js'),`
import {RootsComputationPool} from '@studio/engine/rootsComputationPool.ts';
import {parseLegacyScene} from '@studio/engine/legacyImport.ts';
import {prepareRootsDensityColor} from '@studio/engine/rootsDensityColor.ts';
onmessage=async ({data})=>{let pool;try{
 const scene=parseLegacyScene(data.text).scene;pool=new RootsComputationPool(scene.rootsMath,prepareRootsDensityColor(scene).metric,{maximumWorkers:4,maximumBytes:128*1024*1024});pool.start();
 let points=0;const deadline=performance.now()+20000;
 while(true){
  const s=pool.snapshot();if(s.state==='failed')pool.take();
  if(data.action==='cancel'){if(s.queuedBatches===s.queueCapacity&&s.waitingBatches===s.workerCount)break;}
  else{const batch=pool.take();if(batch)points+=batch.points.length/4;if(pool.snapshot().computationComplete)break;}
  if(performance.now()>deadline)throw Error('nested production pool deadline');await new Promise(r=>setTimeout(r,1));
 }
 const before=pool.snapshot();pool.dispose();postMessage({action:data.action,points,before,after:pool.snapshot()});close();
 }catch(error){pool?.dispose();postMessage({error:String(error)});close();}};
`);
let server,browser;const report={sourceBefore,at:new Date().toISOString(),scope:'Vite production bundle of nested host Worker and actual RootsComputationPool/worker entry, complete and full-queue cancel; not App UI integration.'},started=performance.now();
try{
 await build({configFile:false,root:fixture,resolve:{alias:{'@studio':path.resolve('src')}},build:{outDir:dist,emptyOutDir:true},logLevel:'warn'});
 server=await preview({configFile:false,root:fixture,build:{outDir:dist},preview:{host:'127.0.0.1',port:0}});
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>typeof window.runRootsPool==='function');
 const text=await readFile('.cache/roots-completed-run-20261023/four-input.json','utf8');report.input={path:'.cache/roots-completed-run-20261023/four-input.json',sha256:sha(text)};report.results=[];
 for(const action of ['complete','cancel']){const r=await page.evaluate(({text,action})=>window.runRootsPool(text,action),{text,action});assert.equal(r.after.ownedWorkers,0);assert.equal(r.after.state,'disposed');if(action==='complete'){assert.equal(r.points,10240);assert.equal(r.before.computationComplete,true);}else assert.equal(r.before.computationComplete,false);report.results.push(r);}
 await new Promise(r=>setTimeout(r,100));assert.equal(page.workers().length,0);report.remainingWorkers=0;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));report.sourceAfter=await hashes();assert.deepEqual(report.sourceAfter,report.sourceBefore);report.seconds=(performance.now()-started)/1000;report.cleanup={browserClosed:true,previewServerClosed:true};await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
