/** Actual unified Symmetry timeline/replay/camera owner and public Worker; no original window. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>{const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.parentPath+'/'+x.name);files.push('scripts/verify-source-symmetry-live.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot()},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{prepareIteratedFrame,IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{Generator}=await import('/src/engine/client.ts'),{TemporalGenerationSession,generateScene}=await import('/src/engine/temporal.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},F=Math.fround,equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const make=()=>{const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Live owner',parameters:{gain:.00001},settings:{batch_size:4,burn_in_steps:3,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ffffff'],equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{gain:{min:0,max:.001,step:1e-7,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:.15}]})).scene;scene.timeline.fps=10;scene.timeline.duration=1;return scene;};
  let scene=make();
  const context=(paused,timestampMs,revision=0,width=48,height=32)=>({time:0,quality:'preview',width,height,sourceViewport:ordinarySourceViewport(scene,width,height,'primary',height),sourceSymmetryToneReference:{width:48,height:32},symmetryLive:{sessionId:'live-owner',renderFps:60,replayRevision:revision,clock:{paused,timestampMs}}});
  const owner=new SourceIteratedSession('symmetry'),rows=[];let expected=iteratedInitialChunk(prepareIteratedFrame(scene,0,0).config,0,4),warm=false;
  const advance=(gain,n)=>{for(let k=0;k<n;k++)for(let i=0;i<expected.length;i+=4){expected[i]=F(expected[i]+F(gain));expected[i+3]=F(gain);}};
  try{
   for(const timestampMs of [1000,1100,1250,1400]){
    const output=owner.generate(scene,context(false,timestampMs)),diag=owner.diagnostics(),calls=diag.frame.update.calls;
    for(const call of calls){advance(call.parameters.gain,(warm?0:3)+1);warm=true;}
    assert(equal(owner.readParticles().positionsAndMetric,expected),'Live ordered uniform recurrence '+timestampMs);rows.push(output.symmetryLive);
   }
   assert(JSON.stringify(rows.map(r=>r.objectUpdates))===JSON.stringify([2,2,2,1]),'Real-time source dispatch');
   const beforePause=owner.diagnostics();owner.setPaused(true,1400);assert(owner.diagnostics().displays===beforePause.displays&&owner.diagnostics().steps===beforePause.steps,'Pause drew or updated');
   scene={...scene,settings:{...scene.settings,scaleX:1.2}};
   const firstReplay=owner.generate(scene,context(true,1500,1));expected=iteratedInitialChunk(prepareIteratedFrame(scene,0,0).config,0,4);advance(owner.diagnostics().frame.parameters.values.gain,5);
   assert(firstReplay.symmetryLive.display.replayed&&equal(owner.readParticles().positionsAndMetric,expected),'Explicit transform replay did not reset seed');
   const anchor=JSON.stringify(owner.diagnostics().anchor);owner.setPaused(false,2000);
   const continued=owner.generate(scene,context(false,2100,1)),runtime=owner.diagnostics().frame;
   advance(runtime.parameters.values.gain,7); // ordinary burn 3 + update 1, then 3 replay passes
   assert(continued.symmetryLive.display.replayed&&equal(owner.readParticles().positionsAndMetric,expected),'Live queue did not precede replay');assert(!runtime.parameters.changed,'Replay acknowledged parameters');
   owner.setPaused(true,2100);scene={...scene,sourceCamera:{...scene.sourceCamera,frame:{...scene.sourceCamera.frame,phi:.3}}};
   owner.generate(scene,context(true,3000,1));assert(JSON.stringify(owner.diagnostics().anchor)===anchor,'Replay captured edited camera');
   const resized=owner.generate(scene,context(true,3000,1,63,37));assert(resized.symmetryLive.display.resized&&!resized.symmetryLive.display.replayed&&owner.diagnostics().frame.parameters.changed,'Resize failed to resume normal acknowledgement');assert(owner.diagnostics().anchor.lastCamera.phi===F(.3),'Resize failed to acknowledge camera');
   owner.setPaused(false,4000);const resumed=owner.generate(scene,context(false,4100,1,63,37));assert(resumed.sourceCameraFrame.camera.phi===beforePause.frame.frame.camera.phi,'Resume failed to restore saved angles');assert(Math.abs(resumed.symmetryLive.rawDt-.1)<1e-6,'Pause time leaked into resume');
   owner.setPaused(true,4100);const repeated=[];
   for(const revision of [2,3]){const output=owner.generate(scene,context(true,4200,revision,63,37));repeated.push({pixels:output.pixels,particles:owner.readParticles().positionsAndMetric});assert(output.symmetryLive.display.replayed,'Equal-value edit skipped replay');}
   assert(equal(repeated[0].pixels,repeated[1].pixels)&&equal(repeated[0].particles,repeated[1].particles),'Equal-value replay differs');
   const fpsContext=context(true,4300,4,63,37);fpsContext.symmetryLive.renderFps=120;owner.generate(scene,fpsContext);assert(owner.diagnostics().replay.targetRevealFrames===60,'Host FPS confused with timeline FPS');
   scene={...scene,parameters:{...scene.parameters,gain:.00002}};const replaced=owner.generate(scene,fpsContext);assert(replaced.symmetryLive.sceneTime===0&&owner.diagnostics().displays===1&&!replaced.symmetryLive.display.replayed,'Parameter edit failed to recreate scene');
   assert(equal(owner.readParticles().positionsAndMetric,iteratedInitialChunk(prepareIteratedFrame(scene,0,0).config,0,4)),'Paused replacement did not use initial seeds');
  }finally{owner.reset();assert(owner.diagnostics().retainedBytes===0,'Live owner cleanup');}
  // Rejected controls/edits leave the accepted owner intact. Cancellation
  // during reconstruction releases the partial GPU lifetime before retry.
  const guard=new SourceIteratedSession('symmetry');scene=make();
  try{
   guard.generate(scene,context(false,1000));const before=guard.diagnostics();
   const rejects=fn=>{let rejected=false;try{fn();}catch{rejected=true;}assert(rejected,'Invalid live operation accepted');};
   rejects(()=>guard.generate(scene,context(true,1100)));
   rejects(()=>guard.generate({...scene,settings:{...scene.settings,offsetX:.2}},context(false,1100)));
   const invalid=context(false,1100);invalid.symmetryLive.replayRevision=-1;rejects(()=>guard.generate(scene,invalid));
   assert(guard.diagnostics().displays===before.displays,'Rejected control changed display state');
   const backwards=guard.generate(scene,context(false,500));assert(backwards.symmetryLive.rawDt===-.5&&backwards.sourceCameraFrame.time===-.5,'Signed native wall-clock delta was rejected or clamped');
   guard.setPaused(true,500);const edit=context(true,600,2);guard.generate(scene,edit);const accepted=guard.diagnostics().displays;rejects(()=>guard.generate(scene,context(true,600,1)));assert(guard.diagnostics().displays===accepted,'Stale edit changed GPU state');
   const cancelled=context(false,1000);cancelled.symmetryLive={...cancelled.symmetryLive,sessionId:'cancelled',startAt:1};let probes=0;cancelled.isCancelled=()=>++probes>20;rejects(()=>guard.generate(scene,cancelled));assert(guard.diagnostics().retainedBytes===0,'Cancelled reconstruction retained GPU resources');
   guard.generate(scene,context(true,1000));assert(guard.diagnostics().displays===1,'Cancelled owner did not recover fresh');
  }finally{guard.reset();}
  // Local fixed reconstruction must render every frame, not just advance the
  // scalar queue and draw a final snapshot. Compare the entire public raster.
  scene=make();const temporal=new TemporalGenerationSession(),fixed=new IteratedDensitySession();let reconstruction;
  try{const live=context(true,1000);live.symmetryLive.startAt=.2;const output=generateScene(scene,live,temporal),cold={...live,time:.2};delete cold.symmetryLive;const expected=fixed.generate(scene,cold);assert(equal(output.pixels,expected.pixels)&&equal(temporal.sourceSymmetry.snapshotInk(),fixed.snapshotInk()),'Reconstructed live state differs from cold fixed replay');reconstruction={samples:output.stats.samples,frames:output.temporal.frames};generateScene(scene,cold,temporal);assert(temporal.sourceSymmetry.diagnostics().retainedBytes===0,'Leaving live mode retained owner');}finally{temporal.reset();fixed.reset();}
  // Exercise the actual Generator transport and Worker. Controls are bound to
  // exact delivered outputs; they do not themselves generate a display.
  const generator=new Generator(),workerRows=[];
  try{
   let output=await generator.generate(scene,context(false,1000));workerRows.push(output.symmetryLive);
   const old=output;await generator.setSymmetryPaused(output,true,1100);output=await generator.generate(scene,context(true,9000));workerRows.push(output.symmetryLive);assert(output.stats.samples===old.stats.samples&&output.symmetryLive.sceneTime===old.symmetryLive.sceneTime,'Worker pause updated math/time');
   let stale=false;try{await generator.setSymmetryPaused(old,false);}catch{stale=true;}assert(stale,'Stale output controlled current Worker');
   await generator.setSymmetryPaused(output,false,10000);output=await generator.generate(scene,context(false,10050));workerRows.push(output.symmetryLive);assert(Math.abs(output.symmetryLive.rawDt-.05)<1e-6,'Worker resume included paused time');
   let foreign=false;try{await generator.setSamilaPaused(output,true);}catch{foreign=true;}assert(foreign,'Wrong-family playback accepted');await generator.setSymmetryPaused(output,true,10050);
   const edit={...scene,settings:{...scene.settings,offsetX:.2}};output=await generator.generate(edit,context(true,11000,1));workerRows.push(output.symmetryLive);assert(output.symmetryLive.display.replayed,'Worker lost explicit edit revision');
  }finally{generator.dispose();}
  // Public queue + actual Worker: metadata must reuse the same delivered
  // capability, and a pause during an in-flight display waits for that display.
  const queuedGenerator=new Generator(),delivered=[];let waiting,queueError;
  const queue=new GenerationQueue(queuedGenerator,{output:(output,time,source)=>{delivered.push({output,time,source});waiting?.resolve(output);waiting=undefined;},busy:()=>{},error:error=>{queueError=error;waiting?.reject(error);waiting=undefined;}});
  const next=()=>new Promise((resolve,reject)=>{waiting={resolve,reject};});
  try{
   const a=next();queue.request(scene,context(false,1000));await a;await new Promise(resolve=>setTimeout(resolve,0));
   queue.request(scene,context(false,1100));await queue.setSymmetryPaused(true);
   const completed=delivered.at(-1).output,renamed={...scene,name:'Queue rename'};
   const b=next();queue.request(renamed,context(true,1100),0,'metadata');assert(await b===completed,'Queue metadata caused another Worker display');
   const edited={...renamed,settings:{...renamed.settings,scaleX:1.2}},c=next();queue.request(edited,context(true,1100,1));const replay=await c;assert(replay.symmetryLive.display.replayed&&replay.symmetryLive.objectUpdates===0,'Queued paused edit lost replay semantics');
   assert(!queueError,'Queue reported error');
  }finally{queue.dispose();}
  return{rows,reconstruction,workerRows,pausedAngleRestorePassed:true,resizeAcknowledgementPassed:true,equalValueReplayPassed:true,hostRenderFpsPassed:true,signedClockPassed:true,rejectedEventsPassed:true,cancellationPassed:true,queueWorkerPassed:true,parameterReplacementPassed:true,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
