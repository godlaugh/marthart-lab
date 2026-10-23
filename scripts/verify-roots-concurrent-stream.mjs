import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2]??'.cache/roots-concurrent-stream-20261023/browser',referenceRoot=process.argv[3]??'.cache/roots-completed-run-20261023';
await mkdir(root,{recursive:true});const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/engine/rootsConcurrentStream.ts','src/engine/rootsPending.ts','src/engine/rootsComputation.ts','src/engine/rootsComputationPool.ts','src/engine/rootsComputation.worker.ts','src/engine/rootsNativeDisplay.ts','scripts/verify-roots-concurrent-stream.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),sourceBefore:await hashes(),scope:'Actual asynchronous stream, bounded per-display consumption and production GPU; derived 1024-sample native inputs. Local splat budget 7/reference heap 0 deliberately stresses backlog; not native wall-clock/frame-count or public App parity.',inputs:[],results:[]};
for(const name of ['one','four']){const path=referenceRoot+'/'+name+'-input.json',text=await readFile(path,'utf8'),nativeFrame=referenceRoot+'/final/native-'+name+'/present-frame-59.rgba';report.inputs.push({name,path,text,sha256:sha(text),nativeFrame,nativeFrameSha256:sha(await readFile(nativeFrame)),parentReport:referenceRoot+'/comparison.json',parentReportSha256:sha(await readFile(referenceRoot+'/comparison.json'))});}
let server,browser;const start=performance.now();
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/stream-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/native-frame/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').at(-1),input=report.inputs.find(i=>i.name===name);assert.ok(input);await r.fulfill({body:await readFile(input.nativeFrame)});});
 await page.goto(server.resolvedUrls.local[0]+'stream-check');
 for(const input of report.inputs)report.results.push(await page.evaluate(async input=>{
  const {RootsConcurrentStream}=await import('/src/engine/rootsConcurrentStream.ts'),{RootsNativeDensityDisplay}=await import('/src/engine/rootsNativeDisplay.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsProjection}=await import('/src/engine/rootsProjection.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
  const scene=parseLegacyScene(input.text).scene,color=prepareRootsDensityColor(scene),plan=prepareRootsProjection(scene.rootsPresentation,{width:500,height:600,viewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}});
  const make=()=>new RootsConcurrentStream(scene.rootsMath,color.metric,{maxSplatPointsPerFrame:7,referenceHeapBytes:0},{maximumWorkers:4,maximumBytes:128*1024*1024});
  const check=(v,message)=>{if(!v)throw Error(message);},pause=()=>new Promise(r=>setTimeout(r,1));
  async function blocked(stream){const deadline=performance.now()+20000;while(true){const s=stream.facts.pool;if(s.state==='failed')stream.drain('density');if(s.queuedBatches===s.queueCapacity&&s.waitingBatches===s.workerCount)return;check(performance.now()<deadline,'producer startup/backpressure deadline');await pause();}}
  const stream=make(),display=new RootsNativeDensityDisplay(),frames=[];let output,progress,final,after,completeButPendingFrames=0;
  try{
   stream.start();await blocked(stream);const taken=stream.facts.pool.taken;
   try{stream.drain('density',undefined,{isCancelled:()=>true});throw Error('pre-cancel should reject');}catch(error){check(error.name==='AbortError','wrong cancellation failure');}
   check(stream.facts.pool.taken===taken&&!stream.facts.disposed,'pre-cancel changed stream');
   const deadline=performance.now()+30000;
   for(let frame=0;frame<2000;frame++){
    stream.drain('density');const before=stream.facts;if(before.pool.computationComplete&&!before.canFinishAfterDisplay)completeButPendingFrames++;
    const consumed=stream.consumeDensity(slices=>display.advanceBatches(plan,(function*(){for(const s of slices)yield s.points;})(),color));
    const f=stream.facts;frames.push({frame,points:consumed.consumedPoints,pending:f.pending.pendingPoints,queued:f.pending.queuedBatches,mathComplete:f.pool.computationComplete,canFinishAfterDisplay:f.canFinishAfterDisplay});
    if(f.canFinishAfterDisplay)break;
    check(performance.now()<deadline,'stream completion deadline');await pause();
   }
   final=stream.facts;progress=stream.progress;check(final.canFinishAfterDisplay,'pending stream did not complete');check(completeButPendingFrames>0,'did not exercise calculation-before-drawing completion');
   output=display.present(color);check(output.facts.submittedFinitePointCount===10240,'lost or duplicated GPU points');
  }finally{stream.dispose();display.dispose();after={stream:stream.facts,display:display.diagnostics()};}
  const nativeRaw=new Uint8Array(await(await fetch('/native-frame/'+input.name)).arrayBuffer());check(nativeRaw.length===output.pixels.length&&nativeRaw.length===500*600*4,'invalid framebuffer size');
  const expected=new Uint8ClampedArray(nativeRaw.length);for(let y=0;y<600;y++)expected.set(nativeRaw.subarray((599-y)*2000,(600-y)*2000),y*2000);
  let differentPixels=0,maxDifference=0;for(let i=0;i<expected.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(expected[i+k]-output.pixels[i+k]);changed||=d>0;maxDifference=Math.max(maxDifference,d);}differentPixels+=Number(changed);}
  check(differentPixels===0,'frame-budgeted async GPU output differs from native');
  const cancel=make();let cancelBefore,cancelAfter;
  try{cancel.start();await blocked(cancel);cancel.drain('density');cancelBefore=cancel.facts;check(cancelBefore.pending.pendingPoints>0,'cancellation lacked retained points');}finally{cancel.dispose();cancelAfter=cancel.facts;}
  check(cancelAfter.reservedBytes===0&&cancelAfter.pool.ownedWorkers===0&&cancelAfter.pending.retainedBytes===0,'cancelled stream retained resources');
  return{name:input.name,frames,progress,final,completeButPendingFrames,color:{differentPixels,maxDifference},cleanup:after,cancel:{before:cancelBefore,after:cancelAfter}};
 },input));
 await new Promise(r=>setTimeout(r,100));assert.equal(page.workers().length,0);report.remainingWorkers=0;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();assert.deepEqual(report.sourceAfter,report.sourceBefore);report.seconds=(performance.now()-start)/1000;report.cleanup={browserClosed:true,viteClosed:true};await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,results:report.results.map(r=>({name:r.name,frames:r.frames.length,completeButPendingFrames:r.completeButPendingFrames,color:r.color,points:r.progress.rootPoints,cleanup:r.cleanup.stream.reservedBytes}))}));}
