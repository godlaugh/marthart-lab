import {chromium} from '@playwright/test';
import {createServer,build,preview} from 'vite';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=process.argv[2]??'.cache/roots-recording-transport-20261023/browser',bundled=process.argv.includes('--bundle');await mkdir(out,{recursive:true});
const inputPath='.cache/roots-completed-run-20261023/one-input.json',input=await readFile(inputPath,'utf8');
const files=['src/engine/client.ts','src/engine/generate.worker.ts','src/engine/sourceRootsRecordingLease.ts','src/engine/sourceRecordingClock.ts','src/engine/generationQueue.ts','src/engine/generationProtocol.ts','scripts/verify-roots-recording-transport.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Production Generator and GenerationQueue recording through actual generation Worker, computation Workers and GPU; no App UI/FFmpeg or new native image parity.',input:{path:inputPath,sha256:sha(input)},before:await hashes()};
let server,browser;const started=performance.now();
try{
 if(bundled){
  const fixture=path.resolve(out,'fixture'),dist=path.resolve(out,'dist');await mkdir(fixture,{recursive:true});await writeFile(fixture+'/index.html','<script type="module" src="/main.js"></script>');
  await writeFile(fixture+'/main.js',"import {Generator} from '@studio/engine/client.ts';import {GenerationQueue} from '@studio/engine/generationQueue.ts';import {parseLegacyScene} from '@studio/engine/legacyImport.ts';window.rootsRecording={Generator,GenerationQueue,parseLegacyScene};");
  await build({configFile:false,root:fixture,resolve:{alias:{'@studio':path.resolve('src')}},build:{outDir:dist,emptyOutDir:true},logLevel:'warn'});server=await preview({configFile:false,root:fixture,build:{outDir:dist},preview:{host:'127.0.0.1',port:0}});
 }else{server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();}
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route('**/transport-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+(bundled?'':'transport-check'));if(bundled)await page.waitForFunction(()=>!!window.rootsRecording);
 report.results=await page.evaluate(async input=>{
  const runtime=window.rootsRecording??{...await import('/src/engine/client.ts'),...await import('/src/engine/generationQueue.ts'),...await import('/src/engine/legacyImport.ts')};
  const {Generator,GenerationQueue,parseLegacyScene}=runtime,check=(v,m)=>{if(!v)throw Error(m);},sleep=()=>new Promise(r=>setTimeout(r,2)),results=[];
  for(const kind of ['density-one','density-four','cloud-four','consumer-mutation','warmup','manual','abort','deferred']){
   const scene=parseLegacyScene(input).scene;scene.rootsMath.sampling.workerCount=kind.includes('four')?4:1;scene.rootsPresentation.pending={model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:7,referenceHeapBytes:0};
   if(kind==='cloud-four')scene.rootsPresentation.mode='point-cloud';
   if(['warmup','manual','abort','deferred'].includes(kind)){scene.rootsMath.sampling.sampleCount=1000000;scene.timeline.tracks=[{id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:kind==='warmup'?.001:60,easing:'linear',enabled:true,pingPong:false}];}
   const ctx={time:0,width:96,height:72,quality:'preview',rootsPixelDensity:2,rootsViewport:{logicalWidth:48,logicalHeight:36,referenceLogicalHeight:486,target:'primary'},rootsLive:{sessionId:kind,maximumWorkers:4,clock:{paused:true,timestampMs:1000}}};
   const g=new Generator();let firstResolve,firstReject,latest,stop,callbackError,handle,count=0,last,warmup,completion,shouldStop=false,deferredOutput;
   const first=new Promise((r,j)=>{firstResolve=r;firstReject=j;}),queue=new GenerationQueue(g,{output:o=>{latest=o;firstResolve(o);if(o.type==='raster'&&o.width===100)deferredOutput=o;},error:e=>{callbackError=e;firstReject(e);},busy:()=>{},recordingStopped:s=>{stop=s;}});
   const signal=new AbortController();
   try{
    // Preview without a measured display density remains valid; recording
    // must reject it rather than infer DPI from preview downsampling.
    const missing={...ctx};delete missing.rootsPixelDensity;
    const unknown=await g.generate(scene,missing);let unknownRejected=false;try{await g.beginSourceRecording(unknown,{width:32,height:24,simulationFps:30});}catch(e){unknownRejected=e.previewRetained===true;}check(unknownRejected,'recording guessed unknown density');
    queue.request(scene,ctx);const initial=await first;await sleep();
    let invalid=false;try{await g.beginSourceRecording(initial,{width:32,height:24,simulationFps:0});}catch(e){invalid=e.previewRetained===true;}check(invalid,'invalid options did not retain preview');
    let failed;
    try{await queue.recordSource(initial,{width:32,height:24,simulationFps:30},{
     start:async s=>{handle=s.handle;warmup=s.warmup;check(s.clock.completionReason==='observed-roots-display'&&!('encodedFrames'in s.clock),'predicted count leaked');check(s.warmup.rootsLive.frame.rawDt===Math.fround(1/30),'warmup fixed clock');let rejected=false;try{await g.nextSourceRecordingFrame(handle,2);}catch(e){rejected=e.recordingRetained===true;}check(rejected,'out-of-order frame accepted/revoked recording');},
     shouldStop:()=>shouldStop,
     frame:async(o,index)=>{check(index===count&&o.rootsLive.recording.displayFrame===index+1,'frame sequence');count++;last=o;check(count<3000,'completion never arrived');await sleep();
      if(kind==='consumer-mutation')o.rootsLive.recording.complete=true;
      if(kind==='abort')signal.abort();if(kind==='manual'&&count===3)shouldStop=true;
      if(kind==='deferred'&&count===1){queue.request(scene,{...ctx,width:100,rootsViewport:{...ctx.rootsViewport,logicalWidth:50}});shouldStop=true;}
     },complete:async(_s,c)=>{completion=c;check(g.hasSourceRecording(handle),'host released before encoder completion');await sleep();},
    },signal.signal);}catch(e){failed=e;}
    if(kind==='abort'){check(failed?.name==='AbortError'&&count===1,'abort not propagated');}
    else{if(failed)throw failed;check(!callbackError,'queue callback failure '+callbackError);check(completion.encodedFrames===count,'completion count');check(stop&&stop.preview.rootsLive.frame.frame===(last??warmup).rootsLive.frame.frame,'stop advanced clock');check(!stop.preview.rootsLive.paused,'stop paused');
     if(kind==='warmup')check(count===0&&completion.reason==='queue-complete','warmup completion encoded a frame');
     else if(kind==='manual'||kind==='deferred')check(completion.reason==='manual-stop','manual completion reason');
     else check(last.roots.rootPoints===10240&&last.rootsLive.recording.complete,'natural completion lost points');
    }
    check(!g.hasSourceRecording(handle),'recording lease leaked');
    if(kind==='deferred'){for(let n=0;n<500&&!deferredOutput&&!callbackError;n++)await sleep();check(deferredOutput&&!callbackError&&!deferredOutput.rootsLive.paused&&deferredOutput.rootsPresentation.instance===stop.preview.rootsPresentation.instance,'deferred viewport lost resumed instance');}
    results.push({kind,frames:count,completion,stoppedFrame:stop?.preview.rootsLive.frame.frame,remainingRecording:g.hasSourceRecording(handle),deferredResumed:!!deferredOutput,aborted:failed?.name==='AbortError'});
   }finally{queue.dispose();g.dispose();}
  }
  // Faults are injected only at the main-thread transport boundary. The real
  // Worker/GPU still produces the frame; these are protocol rejection/recovery
  // checks, not native rendering evidence or actual network failures.
  const NativeWorker=globalThis.Worker;
  for(const fault of ['ordinal','completion','counter','camera','identity','formula','dimensions','stop-advance','stop-formula','stop-viewport','lost-warmup','lost-frame']){
   let injected=false;
   globalThis.Worker=class extends NativeWorker {
    set onmessage(handler){super.onmessage=e=>{
     const d=e.data,operation=fault==='lost-warmup'?'source-recording-begin':fault.startsWith('stop-')?'source-recording-finish':'source-recording-frame';
     if(!injected&&d.operation===operation&&!d.error){
      injected=true;
      if(fault==='lost-warmup'||fault==='lost-frame'){
       handler(new MessageEvent('message',{data:{operation:d.operation,id:d.id,sessionId:d.sessionId,error:'injected publication observation failure',retainedRecordingId:d.recordingId}}));return;
      }
      const frame=d.output??d.result.preview;
      if(fault==='ordinal')frame.rootsLive.recording.displayFrame++;
      if(fault==='completion')frame.rootsLive.recording.complete=!frame.rootsLive.recording.complete;
      if(fault==='counter'){frame.rootsLive.autoRecording.pendingPoints=NaN;frame.rootsLive.stream.pending.pendingPoints=NaN;}
      if(fault==='camera')frame.rootsLive.frame.camera={};
      if(fault==='identity')frame.rootsLive.sessionId='foreign';
      if(fault==='formula')frame.formulaPresentation.labels[0].latex='foreign';
      if(fault==='dimensions')frame.width++;
      if(fault==='stop-advance')frame.rootsLive.frame.frame++;
      if(fault==='stop-formula')frame.formulaPresentation.labels[0].latex='foreign';
      if(fault==='stop-viewport')frame.rootsPresentation.logicalSize[0]++;
     }
     handler(e);
    };}
   };
   const g=new Generator(),scene=parseLegacyScene(input).scene;let start,failed;
   const ctx={time:0,width:96,height:72,quality:'preview',rootsPixelDensity:2,rootsViewport:{logicalWidth:48,logicalHeight:36,referenceLogicalHeight:486,target:'primary'},rootsLive:{sessionId:'fault-'+fault,maximumWorkers:4,clock:{paused:true,timestampMs:1000}}};
   try{
    const before=await g.generate(scene,ctx);
    try{
     start=await g.beginSourceRecording(before,{width:32,height:24,simulationFps:30});
     if(fault.startsWith('stop-'))await g.finishSourceRecording(start.handle);else await g.nextSourceRecordingFrame(start.handle,1);
    }catch(e){failed=e;}
    check(injected&&failed,'fault not exercised '+fault);
    const retained=fault.startsWith('lost-');
    check(failed.recordingRetained===retained,'incorrect fault ownership '+fault);
    if(retained){const handle=failed.handle??start.handle;check(g.hasSourceRecording(handle),'recoverable owner lost');const stopped=await g.finishSourceRecording(handle);check(stopped.preview.rootsLive.frame.frame===(fault==='lost-warmup'?1:2),'stop after lost response advanced state');check(!g.hasSourceRecording(handle),'recovery lease leaked');}
    else check(!g.hasSourceRecording(start?.handle),'invalid response retained authority');
    results.push({fault,rejected:true,retainedAndStopped:retained});
   }finally{g.dispose();globalThis.Worker=NativeWorker;}
  }
  return results;
 },input);
 await new Promise(r=>setTimeout(r,250));assert.equal(page.workers().length,0);report.remainingWorkers=0;report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();if(server){if(bundled)await new Promise((r,j)=>server.httpServer.close(e=>e?j(e):r()));else await server.close();}report.after=await hashes();assert.deepEqual(report.before,report.after);report.seconds=(performance.now()-started)/1000;report.bundled=bundled;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,remainingWorkers:report.remainingWorkers,results:report.results}));}
