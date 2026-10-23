import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2]??'.cache/roots-partition-workers-20261023';
await mkdir(root,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['src/engine/rootsNativePointReader.ts','src/engine/rootsPending.ts','src/engine/rootsMathJob.ts','src/engine/rootsNativeSampling.ts','scripts/verify-roots-partition-workers.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,sha(await readFile(p))])));
const sourceBefore=await hashes(),inputs=[];
for(const name of ['one','four']){
 const path='.cache/roots-completed-run-20261023/'+name+'-input.json';
 const text=await readFile(path,'utf8'),nativePointsPath='.cache/roots-completed-run-20261023/'+name+'-native-points.bin',parentComparisonPath='.cache/roots-completed-run-20261023/comparison.json';
 inputs.push({name,text,path,sha256:sha(text),nativePointsPath,nativePointsSha256:sha(await readFile(nativePointsPath)),parentComparisonPath,parentComparisonSha256:sha(await readFile(parentComparisonPath))});
}
// Exploratory transport, not a production preview policy. One outstanding offer
// per worker; a bounded owner FIFO grants a credit only after admitting it.
const workerSource=`
import {parseLegacyScene} from '/src/engine/legacyImport.ts';
import {prepareRootsMathJob} from '/src/engine/rootsMathJob.ts';
import {RootsNativePointReader,createRootsNativeProgress} from '/src/engine/rootsNativePointReader.ts';
import {prepareRootsWorkerPartitions} from '/src/engine/rootsSourceRandom.ts';
import {RootsPendingQueue,prepareRootsPendingPlan} from '/src/engine/rootsPending.ts';
import {prepareRootsDensityColor} from '/src/engine/rootsDensityColor.ts';
let math,reader,queue,state,index,metric,done=false,busy=false,sequence=0;
async function next(){
 if(busy||done)throw Error('invalid producer credit');busy=true;
 try{
  let sinceYield=0;
  while(queue.snapshot().queuedBatches===0&&state.attemptedSamples<state.totalSamples){
   const sample=reader.read(0,metric);queue.appendSample(index,sample.points,{filtered:sample.filtered});
   if(state.attemptedSamples===state.totalSamples)queue.finishWorker(index);
   if(++sinceYield===128){sinceYield=0;await new Promise(r=>setTimeout(r,0));}
  }
  const chunks=[];let length=0;
  const drained=queue.drain('point-cloud',s=>{const a=new Float32Array(s.points);chunks.push(a);length+=a.length;});
  const points=new Float32Array(length);let offset=0;for(const c of chunks){points.set(c,offset);offset+=c.length;}
  const terminal=drained.terminals===1;
  if(terminal){done=true;reader.dispose();queue.dispose();math.dispose();}
  postMessage({kind:'offer',index,sequence:sequence++,points,terminal,progress:{...state}},[points.buffer]);
 }finally{busy=false;}
}
onmessage=async ({data})=>{try{
 if(data.kind==='start'){
  if(math)throw Error('duplicate initialization');index=data.index;
  const scene=parseLegacyScene(data.text).scene;math=prepareRootsMathJob(scene);
  const e=math.ensemble,parts=prepareRootsWorkerPartitions(e.sampleCount,e.configuredWorkers,BigInt(e.seed));if(!parts.ok)throw Error(parts.error.reason);
  const p=parts.value.partition(index);state=createRootsNativeProgress(p.count);
  reader=new RootsNativePointReader(math,state,'points',()=>{},p.start);metric=prepareRootsDensityColor(scene).metric;
  queue=new RootsPendingQueue(prepareRootsPendingPlan({batchSize:e.batchSize,workerCount:parts.value.workerCount,maxPointsPerSample:math.maxRootCount,maxSplatPointsPerFrame:20000,referenceHeapBytes:0}),{storage:'points'});
 }else if(data.kind!=='credit')throw Error('unknown message');
 await next();
 }catch(error){reader?.dispose();queue?.dispose();math?.dispose();postMessage({kind:'failed',error:String(error)});}
};
`;
await writeFile(root+'/worker-probe.js',workerSource);
let server,browser;const report={at:new Date().toISOString(),scope:'Actual browser workers with bounded exploratory credit transport; production math/point/queue boundaries. Not integrated into preview or recording.',sourceBefore,inputs,results:[]};
const started=performance.now();
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'roots-partition-probe',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/partition-probe.js'){res.setHeader('Content-Type','text/javascript');res.end(workerSource);}else next();});}}]});
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/partition-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/native-points/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1);assert.ok(['one','four'].includes(name));await r.fulfill({body:await readFile('.cache/roots-completed-run-20261023/'+name+'-native-points.bin')});});
 await page.goto(server.resolvedUrls.local[0]+'partition-check');
 for(const input of inputs){
  report.results.push(await page.evaluate(async input=>{
   const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsMathJob}=await import('/src/engine/rootsMathJob.ts'),{RootsNativePointReader,createRootsNativeProgress}=await import('/src/engine/rootsNativePointReader.ts'),{prepareRootsDensityColor,prepareRootsMetricValue}=await import('/src/engine/rootsDensityColor.ts'),{prepareRootsProjection,transformRootsPoint}=await import('/src/engine/rootsProjection.ts');
   const scene=parseLegacyScene(input.text).scene,workerCount=scene.rootsMath.sampling.workerCount,capacity=2*workerCount,metric=prepareRootsDensityColor(scene).metric;
   const pause=ms=>new Promise(r=>setTimeout(r,ms)),check=(x,message)=>{if(!x)throw Error(message);};
   function pool(){
    const workers=[],fifo=[],waiting=[],sequences=new Array(workerCount).fill(0),offered=new Array(workerCount).fill(false);let failure,maxQueued=0,maxWaiting=0,offers=0,closed=false;
    function admit(message){fifo.push(message);maxQueued=Math.max(maxQueued,fifo.length);offered[message.index]=false;if(!message.terminal)workers[message.index].postMessage({kind:'credit'});}
    for(let index=0;index<workerCount;index++){
     const w=new Worker('/partition-probe.js',{type:'module'});workers.push(w);
     w.onerror=e=>{failure=Error(e.message);};w.onmessage=({data:m})=>{try{
      if(closed)return;if(m.kind==='failed')throw Error(m.error);
      check(m.kind==='offer'&&m.index===index&&m.sequence===sequences[index]++&&!offered[index],'invalid offer identity');
      check(m.points instanceof Float32Array&&m.points.length%4===0,'invalid raw tuples');offers++;offered[index]=true;
      if(fifo.length<capacity)admit(m);else{waiting.push(m);maxWaiting=Math.max(maxWaiting,waiting.length);check(waiting.length<=workerCount,'unbounded pending offers');}
     }catch(e){failure=e;}};
     w.postMessage({kind:'start',index,text:input.text});
    }
    return{fifo,waiting,get offers(){return offers;},get failure(){return failure;},get bounds(){return{capacity,maxQueued,maxWaiting};},take(){const m=fifo.shift();if(m&&waiting.length)admit(waiting.shift());return m;},close(){closed=true;for(const w of workers)w.terminate();fifo.length=waiting.length=0;}};
   }
   async function until(predicate,p){const deadline=performance.now()+20000;while(!predicate()){if(p.failure)throw p.failure;check(performance.now()<deadline,'worker progress deadline');await pause(5);}if(p.failure)throw p.failure;}
   const p=pool(),batches=[],arrivals=[],terminal=new Map();let blockedOffers,blockedStable;
   try{
    await until(()=>p.fifo.length===capacity&&p.waiting.length===workerCount,p);blockedOffers=p.offers;await pause(100);blockedStable=p.offers===blockedOffers;check(blockedStable,'producer advanced without queue credit');
    await until(()=>{
     const m=p.take();if(m){batches.push(m.points);arrivals.push({worker:m.index,sequence:m.sequence,points:m.points.length/4,attempted:m.progress.attemptedSamples,terminal:m.terminal});if(m.terminal){check(!terminal.has(m.index),'duplicate terminal');terminal.set(m.index,m.progress);}}
     return terminal.size===workerCount;
    },p);
    check(p.fifo.length===0&&p.waiting.length===0,'terminal before queue empty');
   }finally{p.close();}
   const raw=new Float32Array(batches.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of batches){raw.set(b,offset);offset+=b.length;}
   const math=prepareRootsMathJob(scene),state=createRootsNativeProgress(math.ensemble.sampleCount),r=new RootsNativePointReader(math,state,'points'),serial=[];
   try{while(state.attemptedSamples<state.totalSamples)serial.push(...r.read(0,metric).points);}finally{r.dispose();math.dispose();}
   function unmatched(a,b){const counts=new Map(),key=(a,i)=>Array.from(new Uint32Array(a.buffer,a.byteOffset+4*i,4)).join(',');for(let i=0;i<a.length;i+=4){const k=key(a,i);counts.set(k,(counts.get(k)??0)+1);}let missing=0;for(let i=0;i<b.length;i+=4){const k=key(b,i),n=counts.get(k)??0;if(n)counts.set(k,n-1);else missing++;}return{missing,remaining:[...counts.values()].reduce((a,b)=>a+b,0)};}
   const serialComparison=unmatched(new Float32Array(serial),raw);check(serialComparison.missing===0&&serialComparison.remaining===0,'partition sample identity changed');
   const plan=prepareRootsProjection(scene.rootsPresentation,{width:500,height:600,viewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}}),world=[];
   for(let i=0;i<raw.length;i+=4){const point=transformRootsPoint(plan,[raw[i],raw[i+1],raw[i+2]]);check(point.kind==='point','unexpected transformed point rejection');world.push(...point.world,prepareRootsMetricValue(raw[i+3]).clamped);}
   const native=new Float32Array(await(await fetch('/native-points/'+input.name)).arrayBuffer()),nativeComparison=unmatched(native,new Float32Array(world));
   const cancelled=pool();try{await until(()=>cancelled.fifo.length===capacity&&cancelled.waiting.length===workerCount,cancelled);}finally{cancelled.close();}
   return{name:input.name,workerCount,points:raw.length/4,blockedOffers,blockedStable,bounds:p.bounds,terminalProgress:[...terminal.values()],serialComparison,nativeComparison,arrivals,cancelledAtFullQueue:true};
  },input));
 }
 await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,100));
 assert.equal(page.workers().length,0,'Probe workers survived termination');
 for(const r of report.results){assert.equal(r.points,10240);assert.equal(r.terminalProgress.reduce((n,p)=>n+p.attemptedSamples,0),1024);assert.equal(r.nativeComparison.missing,r.name==='one'?395:420);assert.equal(r.nativeComparison.remaining,r.nativeComparison.missing);}
 report.status='passed';report.workerCleanup={remainingWorkers:page.workers().length};
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.sourceAfter=await hashes();assert.deepEqual(report.sourceBefore,report.sourceAfter);report.seconds=(performance.now()-started)/1000;report.cleanup={browserClosed:true,viteClosed:true};await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,workerCleanup:report.workerCleanup,results:report.results.map(({arrivals,...r})=>r)}));
}
