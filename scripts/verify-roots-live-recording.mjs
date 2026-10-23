import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=process.argv[2]??'.cache/roots-live-recording-20261023/owner';
await mkdir(out,{recursive:true});
const inputPath='.cache/roots-completed-run-20261023/one-input.json',input=await readFile(inputPath,'utf8');
const files=['src/engine/rootsNativePresentationSession.ts','src/engine/rootsLive.ts','scripts/verify-roots-live-recording.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Direct production RootsNativePresentationSession in headless Chrome, real computation Workers and WebGL. Recording owner lifecycle, not public Generator/Worker transport, App UI, FFmpeg or native full-image parity.',input:{path:inputPath,sha256:sha(input)},before:await hashes()};
const started=performance.now();let server,browser;
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/record-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'record-check');
 report.results=await page.evaluate(async input=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{RootsNativePresentationSession}=await import('/src/engine/rootsNativePresentationSession.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},reject=(fn,pattern)=>{let failed=false;try{fn();}catch(e){failed=pattern.test(e.message);}check(failed,'expected rejection '+pattern);};
  const sleep=()=>new Promise(r=>setTimeout(r,2));
  const results=[];
  for(const mode of ['density','point-cloud']){
   const scene=parseLegacyScene(input).scene;scene.rootsPresentation.mode=mode;scene.rootsPresentation.pending={model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:7,referenceHeapBytes:0};
   const ctx={time:0,width:192,height:144,quality:'preview',rootsViewport:{logicalWidth:96,logicalHeight:72,referenceLogicalHeight:486,target:'primary'},rootsLive:{sessionId:'record-'+mode,maximumWorkers:4,clock:{paused:true,timestampMs:1000}}};
   const owner=new RootsNativePresentationSession();
   try{
    let before;for(let i=0;i<2000;i++){before=owner.generate(scene,ctx);if(before.rootsLive.autoRecording.complete)break;await sleep();}
    check(before.roots.rootPoints===10240&&before.rootsLive.autoRecording.complete,'preview did not finish');
    const prior=owner.diagnostics().instance;
    reject(()=>owner.beginRecording(scene,ctx,{width:64,height:48,simulationFps:0}),/帧率/);
    reject(()=>owner.beginRecording(scene,ctx,{width:1e6,height:48,simulationFps:30}),/像素预算/);
    reject(()=>owner.beginRecording(scene,{...ctx,width:200},{width:64,height:48,simulationFps:30}),/视口/);
    check(owner.matchesCompletedPrimary(scene,ctx)&&owner.diagnostics().instance===prior,'invalid begin destroyed preview');
    const start=owner.beginRecording(scene,ctx,{width:64,height:48,simulationFps:30}),dt=Math.fround(1/Math.fround(30));
    start.scene.rootsMath.sampling.sampleCount=1;start.context.rootsViewport.logicalWidth=1;
    let frame=start.warmup;const instance=frame.rootsPresentation.instance;
    check(instance===prior+1&&frame.roots.rootPoints===0,'begin reused prior math/history');
    check(frame.width===192&&frame.height===144&&frame.rootsPresentation.target==='offscreen','record target');
    check(frame.rootsLive.frame.rawDt===dt&&frame.rootsLive.recording.warmup&&frame.rootsLive.clockSource==='render-fixed-step','warmup did not update');
    check(!('encodedFrames' in start.clock)&&!('lastDisplayFrame' in start.clock),'invented future completion ordinal');
    reject(()=>owner.setPaused(true),/录制/);reject(()=>owner.generate(scene,ctx),/录制/);reject(()=>owner.nextRecordingFrame({},1),/身份/);reject(()=>owner.nextRecordingFrame(start.handle,2),/连续/);
    check(owner.ownsRecording(start.handle),'invalid action revoked owner');
    const rows=[];let pendingAfterMath=0;
    for(let i=1;!frame.rootsLive.recording.complete&&i<3000;i++){
     await sleep();frame=owner.nextRecordingFrame(start.handle,i);const f=frame.rootsLive;
     check(f.frame.rawDt===dt&&f.recording.displayFrame===i&&!f.recording.warmup,'fixed step/ordinal drift');
     check(f.recording.complete===f.autoRecording.complete,'completion not observed on actual frame');
     if(f.stream.pool.computationComplete&&!f.recording.complete)pendingAfterMath++;
     rows.push({i,samples:frame.roots.attemptedSamples,pending:f.stream.pending.pendingPoints,complete:f.recording.complete});
    }
    check(frame.rootsLive.recording.complete&&frame.roots.rootPoints===10240,'last points were omitted');
    if(mode==='density')check(pendingAfterMath>0,'missing after-math pending draw witness');
    else check(frame.rootsPresentation.pointCloud.totalWrites==='10240','cloud point loss/duplication');
    reject(()=>owner.nextRecordingFrame(start.handle,rows.length+1),/完成/);
    const last=frame.rootsLive.frame,stopped=owner.finishRecording(start.handle,5000);
    check(stopped.preview.rootsPresentation.instance===instance&&JSON.stringify(stopped.preview.rootsLive.frame)===JSON.stringify(last),'stop reconstructed or advanced scene');
    check(!stopped.preview.rootsLive.paused&&!stopped.preview.rootsLive.recording&&stopped.preview.rootsPresentation.target==='primary','stop did not resume live primary');
    check(owner.matchesCompletedPrimary(stopped.scene,stopped.context),'stop failed to bind completed primary');
    const returned=owner.finishRecording(start.handle,8000);returned.scene.rootsMath.sampling.sampleCount=1;returned.context.rootsViewport.logicalWidth=1;
    const repeat=owner.finishRecording(start.handle,9000);check(repeat.preview.rootsLive.frame.frame===last.frame,'retry stop advanced frame');
    const resumed=owner.generate(stopped.scene,{...stopped.context,rootsLive:{...stopped.context.rootsLive,clock:{paused:false,timestampMs:5033}}});
    check(Math.abs(resumed.rootsLive.frame.rawDt-.033)<1e-6,'stop resetTime ran twice or reused recording duration');
    reject(()=>owner.finishRecording(start.handle),/身份/);
    results.push({mode,encodedFrames:rows.length,pendingAfterMath,lastFrame:last,rows,resumed:resumed.rootsLive.frame});
   }finally{owner.reset();check(owner.diagnostics().retainedBytes===0,'owner resources retained');}
  }
  // A short animation owns completion even while a large sampling run remains.
  const scene=parseLegacyScene(input).scene;scene.rootsMath.sampling.sampleCount=1_000_000;scene.rootsPresentation.pending={model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:7,referenceHeapBytes:0};
  scene.timeline.tracks=[{id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:.001,easing:'linear',enabled:true,pingPong:false}];
  const ctx={time:0,width:96,height:72,quality:'preview',rootsViewport:{logicalWidth:48,logicalHeight:36,referenceLogicalHeight:486,target:'primary'},rootsLive:{sessionId:'short-animation',maximumWorkers:4,clock:{paused:true,timestampMs:1000}}};
  const owner=new RootsNativePresentationSession();
  try{
   owner.generate(scene,ctx);const start=owner.beginRecording(scene,ctx,{width:32,height:24,simulationFps:30});
   check(start.warmup.rootsLive.recording.complete&&!start.warmup.rootsLive.stream.pool.computationComplete,'animation did not win warmup completion');
   const stop=owner.finishRecording(start.handle,1000),instance=stop.preview.rootsPresentation.instance;
   const later=owner.generate(stop.scene,{...stop.context,rootsLive:{...stop.context.rootsLive,clock:{paused:false,timestampMs:1033}}});
   check(later.rootsPresentation.instance===instance,'warmup stop recreated computation');
   // Manual stop with active workers preserves their ownership and current time.
   scene.timeline.tracks[0].duration=60;owner.generate(scene,{...ctx,rootsLive:{...ctx.rootsLive,clock:{paused:true}}});
   let cancel=false;const manual=owner.beginRecording(scene,{...ctx,isCancelled:()=>cancel},{width:32,height:24,simulationFps:30});
   cancel=true;reject(()=>owner.nextRecordingFrame(manual.handle,1),/cancel|取消/i);check(owner.ownsRecording(manual.handle),'pre-cancel lost recording');
   const manualStop=owner.finishRecording(manual.handle,2000);
   check(manualStop.preview.rootsLive.frame.frame===manual.warmup.rootsLive.frame.frame&&!manualStop.preview.rootsLive.stream.pool.computationComplete,'manual stop advanced or disposed producer');
   owner.setPaused(true);reject(()=>owner.finishRecording(manual.handle),/身份/);
   let armed=false,checks=0;const failing=owner.beginRecording(manualStop.scene,{...manualStop.context,isCancelled:()=>armed&&++checks>=3},{width:32,height:24,simulationFps:30});
   armed=true;reject(()=>owner.nextRecordingFrame(failing.handle,1),/cancel|取消/i);
   check(!owner.ownsRecording(failing.handle)&&owner.diagnostics().retainedBytes===0,'mid-update failure retained recording/workers');
   results.push({warmupCompletion:true,manualStop:true,preCancelRetained:true,activeWorkers:manualStop.preview.rootsLive.stream.pool.ownedWorkers,controlRevokedHandoff:true,midUpdateCancellationCleaned:true});
  }finally{owner.reset();check(owner.diagnostics().retainedBytes===0,'manual resources retained');}
  return results;
 },input);
 await new Promise(r=>setTimeout(r,250));assert.equal(page.workers().length,0);report.remainingWorkers=0;report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.after=await hashes();assert.deepEqual(report.before,report.after);report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,remainingWorkers:report.remainingWorkers,results:report.results?.map(r=>({mode:r.mode,encodedFrames:r.encodedFrames,pendingAfterMath:r.pendingAfterMath,warmupCompletion:r.warmupCompletion,manualStop:r.manualStop}))}));}
