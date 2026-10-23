import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2]??'.cache/roots-computation-pool-20261023',referenceRoot=process.argv[3]??'.cache/roots-completed-run-20261023';
await mkdir(root,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['src/engine/rootsComputation.ts','src/engine/rootsComputationPool.ts','src/engine/rootsComputation.worker.ts','src/engine/rootsNativePointReader.ts','src/engine/rootsPending.ts','src/engine/rootsMathJob.ts','src/engine/rootsNativeSampling.ts','scripts/verify-roots-partition-workers.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(p))])));
const sourceBefore=await hashes(),inputs=[];
for(const name of ['one','four']){
 const path=referenceRoot+'/'+name+'-input.json';
 const text=await readFile(path,'utf8'),nativePointsPath=referenceRoot+'/'+name+'-native-points.bin',parentComparisonPath=referenceRoot+'/comparison.json';
 const nativeFramePath=referenceRoot+'/final/native-'+name+'/present-frame-59.rgba';
 inputs.push({name,text,path,nativeFramePath,nativeFrameSha256:sha(await readFile(nativeFramePath)),sha256:sha(text),nativePointsPath,nativePointsSha256:sha(await readFile(nativePointsPath)),parentComparisonPath,parentComparisonSha256:sha(await readFile(parentComparisonPath))});
}
const nestedHost=`
import {RootsComputationPool} from '/src/engine/rootsComputationPool.ts';
import {parseLegacyScene} from '/src/engine/legacyImport.ts';
import {prepareRootsDensityColor} from '/src/engine/rootsDensityColor.ts';
let pool;const pause=()=>new Promise(r=>setTimeout(r,1));
onmessage=async ({data})=>{try{
 if(data.kind==='start'){
  const scene=parseLegacyScene(data.text).scene;pool=new RootsComputationPool(scene.rootsMath,prepareRootsDensityColor(scene).metric,{maximumWorkers:4,maximumBytes:128*1024*1024});pool.start();
  const deadline=performance.now()+20000;
  while(true){const s=pool.snapshot();if(s.state==='failed')pool.take();if(s.queuedBatches===s.queueCapacity&&s.waitingBatches===s.workerCount)break;if(performance.now()>deadline)throw Error('nested blocked deadline');await pause();}
  postMessage({kind:'blocked',snapshot:pool.snapshot()});return;
 }
 let points=0;const deadline=performance.now()+20000;
 if(data.kind==='drain')while(!pool.snapshot().computationComplete){const b=pool.take();if(b)points+=b.points.length/4;else await pause();if(performance.now()>deadline)throw Error('nested drain deadline');}
 else if(data.kind!=='cancel')throw Error('unexpected nested request');
 const before=pool.snapshot();pool.dispose();postMessage({kind:'done',points,before,after:pool.snapshot()});close();
 }catch(error){pool?.dispose();postMessage({kind:'failed',error:String(error)});close();}};
`;
let server,browser;const report={at:new Date().toISOString(),scope:'Production computation pool and browser workers; bounded transfer, completion and cleanup. Not yet integrated into preview or recording.',sourceBefore,inputs,results:[]};
const started=performance.now();
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'nested-roots-host',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/nested-roots-host.js'){res.setHeader('Content-Type','text/javascript');res.end(nestedHost);}else next();});}}]});
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/partition-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/native-points/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1);assert.ok(['one','four'].includes(name));await r.fulfill({body:await readFile(referenceRoot+'/'+name+'-native-points.bin')});});
 await page.route('**/native-frame/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1);assert.ok(['one','four'].includes(name));await r.fulfill({body:await readFile(referenceRoot+'/final/native-'+name+'/present-frame-59.rgba')});});
 await page.goto(server.resolvedUrls.local[0]+'partition-check');
 for(const input of inputs){
  report.results.push(await page.evaluate(async input=>{
   const {RootsComputationPool}=await import('/src/engine/rootsComputationPool.ts');
   const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsMathJob}=await import('/src/engine/rootsMathJob.ts'),{RootsNativePointReader,createRootsNativeProgress}=await import('/src/engine/rootsNativePointReader.ts'),{prepareRootsDensityColor,prepareRootsMetricValue}=await import('/src/engine/rootsDensityColor.ts'),{prepareRootsProjection,transformRootsPoint}=await import('/src/engine/rootsProjection.ts');
   const scene=parseLegacyScene(input.text).scene,workerCount=scene.rootsMath.sampling.workerCount,capacity=2*workerCount,metric=prepareRootsDensityColor(scene).metric;
   const pause=ms=>new Promise(r=>setTimeout(r,ms)),check=(x,message)=>{if(!x)throw Error(message);};
   function pool(){const p=new RootsComputationPool(scene.rootsMath,metric,{maximumWorkers:4,maximumBytes:128*1024*1024});p.start();return p;}
   async function until(predicate,p){const deadline=performance.now()+20000;while(!predicate()){if(p.snapshot().state==='failed')p.take();check(performance.now()<deadline,'worker progress deadline');await pause(5);}if(p.snapshot().state==='failed')p.take();}
   const p=pool(),batches=[],arrivals=[],terminal=new Map();let blockedOffers,blockedStable;
   try{
    await until(()=>p.snapshot().queuedBatches===capacity&&p.snapshot().waitingBatches===workerCount,p);blockedOffers=p.snapshot().offers;await pause(100);blockedStable=p.snapshot().offers===blockedOffers;check(blockedStable,'producer advanced without queue credit');
    await until(()=>{
     const m=p.take();if(m){batches.push(m.points);arrivals.push({worker:m.workerIndex,sequence:m.sequence,points:m.points.length/4,attempted:m.progress.attemptedSamples,terminal:m.terminal});if(m.terminal){check(!terminal.has(m.workerIndex),'duplicate terminal');terminal.set(m.workerIndex,m.progress);}}
     return terminal.size===workerCount;
    },p);
    check(p.snapshot().queuedBatches===0&&p.snapshot().waitingBatches===0,'terminal before queue empty');
   }catch(error){p.dispose();throw error;}
   const raw=new Float32Array(batches.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of batches){raw.set(b,offset);offset+=b.length;}
   const math=prepareRootsMathJob(scene),state=createRootsNativeProgress(math.ensemble.sampleCount),r=new RootsNativePointReader(math,state,'points'),serial=[];
   try{while(state.attemptedSamples<state.totalSamples)serial.push(...r.read(0,metric).points);}finally{r.dispose();math.dispose();}
   function unmatched(a,b){const counts=new Map(),key=(a,i)=>Array.from(new Uint32Array(a.buffer,a.byteOffset+4*i,4)).join(',');for(let i=0;i<a.length;i+=4){const k=key(a,i);counts.set(k,(counts.get(k)??0)+1);}let missing=0;for(let i=0;i<b.length;i+=4){const k=key(b,i),n=counts.get(k)??0;if(n)counts.set(k,n-1);else missing++;}return{missing,remaining:[...counts.values()].reduce((a,b)=>a+b,0)};}
   const serialComparison=unmatched(new Float32Array(serial),raw);check(serialComparison.missing===0&&serialComparison.remaining===0,'partition sample identity changed');
   const plan=prepareRootsProjection(scene.rootsPresentation,{width:500,height:600,viewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}}),world=[];
   for(let i=0;i<raw.length;i+=4){const point=transformRootsPoint(plan,[raw[i],raw[i+1],raw[i+2]]);check(point.kind==='point','unexpected transformed point rejection');world.push(...point.world,prepareRootsMetricValue(raw[i+3]).clamped);}
   const native=new Float32Array(await(await fetch('/native-points/'+input.name)).arrayBuffer()),nativeComparison=unmatched(native,new Float32Array(world));
   const {RootsNativeDensityDisplay}=await import('/src/engine/rootsNativeDisplay.ts'),display=new RootsNativeDensityDisplay();let frame;
   try{
    const output=display.renderBatches(plan,batches,prepareRootsDensityColor(scene)),nativeRaw=new Uint8Array(await(await fetch('/native-frame/'+input.name)).arrayBuffer());
    check(nativeRaw.length===500*600*4&&output.pixels.length===nativeRaw.length,'framebuffer dimensions');
    const expected=new Uint8ClampedArray(nativeRaw.length);for(let y=0;y<600;y++)expected.set(nativeRaw.subarray((599-y)*2000,(600-y)*2000),y*2000);
    let differentPixels=0,maxDifference=0;for(let i=0;i<expected.length;i+=4){let different=false;for(let k=0;k<4;k++){const d=Math.abs(expected[i+k]-output.pixels[i+k]);different||=d>0;maxDifference=Math.max(maxDifference,d);}differentPixels+=Number(different);}
    const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
    frame={differentPixels,maxDifference,productSha256:await digest(output.pixels),nativeSha256:await digest(expected),submittedPoints:output.facts.submittedFinitePointCount};check(differentPixels===0,'Concurrent arrival final image differs');
   }finally{display.dispose();}
   const final=p.snapshot();p.dispose();const cancelled=pool();try{await until(()=>cancelled.snapshot().queuedBatches===capacity&&cancelled.snapshot().waitingBatches===workerCount,cancelled);}finally{cancelled.dispose();}
   return{name:input.name,workerCount,points:raw.length/4,blockedOffers,blockedStable,bounds:{capacity,maximumQueuedAtBarrier:capacity,maximumWaitingAtBarrier:workerCount},final,frame,terminalProgress:[...terminal.values()],serialComparison,nativeComparison,arrivals,cancelledAtFullQueue:true};
  },input));
 }
 report.nested=await page.evaluate(async input=>{
  const results=[];
  for(const action of ['drain','cancel'])results.push(await new Promise((resolve,reject)=>{
   const host=new Worker('/nested-roots-host.js',{type:'module'}),timeout=setTimeout(()=>finish(Error('nested host deadline')),30000);let blocked;
   function finish(error,value){clearTimeout(timeout);host.terminate();if(error)reject(error);else resolve(value);}
   host.onerror=e=>finish(Error(e.message));host.onmessage=({data})=>{if(data.kind==='blocked'){blocked=data.snapshot;host.postMessage({kind:action});}else if(data.kind==='done')finish(null,{action,blocked,...data});else finish(Error(data.error));};
   host.postMessage({kind:'start',text:input.text});
  }));return results;
 },inputs.find(i=>i.name==='four'));
 for(const nested of report.nested){assert.equal(nested.after.ownedWorkers,0);assert.equal(nested.after.state,'disposed');if(nested.action==='drain'){assert.equal(nested.points,10240);assert.equal(nested.before.computationComplete,true);}else assert.equal(nested.before.computationComplete,false);}
 await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,100));
 assert.equal(page.workers().length,0,'Probe workers survived termination');
 for(const r of report.results){assert.equal(r.points,10240);assert.equal(r.terminalProgress.reduce((n,p)=>n+p.attemptedSamples,0),1024);assert.equal(r.nativeComparison.missing,r.name==='one'?395:420);assert.equal(r.nativeComparison.remaining,r.nativeComparison.missing);}
 report.status='passed';report.workerCleanup={remainingWorkers:page.workers().length};
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.sourceAfter=await hashes();assert.deepEqual(report.sourceBefore,report.sourceAfter);report.seconds=(performance.now()-started)/1000;report.cleanup={browserClosed:true,viteClosed:true};await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,workerCleanup:report.workerCleanup,results:report.results.map(({arrivals,...r})=>r)}));
}
