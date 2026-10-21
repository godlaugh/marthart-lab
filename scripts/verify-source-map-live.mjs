/** Shared live owner exercised with real WebGL and Worker. Expectations use
 * original bytecode dispatch rules and independent exact F32 translations. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>{const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.parentPath+'/'+x.name);files.push('scripts/verify-source-map-live.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot(),limits:['Original native host/JOGL not executed.','Exact power-of-two translation and zero-width seed ranges isolate dispatch; arbitrary formula precision and RNG already have separate fixtures.','Public controls and downloads are covered separately by the iterated UI verification scripts; this script verifies the shared core and actual Worker.']},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {editSourceMapScene}=await import('/src/engine/sourceMapScene.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{Generator}=await import('/src/engine/client.ts'),{TemporalGenerationSession,generateScene}=await import('/src/engine/temporal.ts'),{IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},F=Math.fround,equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])),gain=2**-16;
  const rejects=(fn,label)=>{let error;try{fn();}catch(e){error=e;}assert(error,label);return String(error);};
  const make=(timeline=[{type:'wait',duration:.15}],dot=4)=>{const s=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map live',equations:{x_next:'x+gain',y_next:'y',z_next:'0'},parameters:{gain,colorSpeed:.75},settings:{dot_size:dot,dimension:2,batch_size:4,burn_in_steps:3,iterations_per_frame:2,accumulation_decay:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0,scale_x:1,scale_y:1,scale_z:1,color_speed:.5,color_phase:180,background_color:'#80123456'},timeline}),{sourceEntry:'runtime-config'}).scene;s.timeline.fps=10;return s;};
  let scene=make();
  const context=(paused,timestampMs,revision=0,width=48,height=32)=>({time:0,quality:'preview',width,height,sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,width,height,'primary',height),sourceMapToneReference:{width:48,height:32},mapLive:{sessionId:'map-live',renderFps:60,replayRevision:revision,clock:{paused,timestampMs}}});
  const advance=(state,steps,delta=gain)=>{for(let k=0;k<steps;k++)for(let i=0;i<state.length;i+=4){const before=state[i];state[i]=F(before+F(delta));state[i+3]=F(Math.abs(F(state[i]-before)));}};
  const owner=new SourceIteratedSession('map'),rows=[];let expected=new Float32Array(16);
  try{
   for(const [timestampMs,count] of [[1000,2],[1100,2],[1250,2],[1400,1]]){
    advance(expected,(rows.length?0:3)+count*2);const output=owner.generate(scene,context(false,timestampMs));
    assert(output.mapLive.objectUpdates===count,'Independent 2/2/2/1 native dispatch');assert(equal(owner.readParticles().positionsAndMetric,expected),'Independent F32 particle trajectory '+timestampMs);rows.push(output.mapLive);
   }
   owner.setPaused(true,1400);const before=owner.diagnostics(),paused=owner.generate(scene,context(true,9000));
   assert(paused.mapLive.objectUpdates===0&&equal(owner.readParticles().positionsAndMetric,expected),'Paused display advanced particles');assert(paused.mapLive.display.accumulationPasses===before.replay.accumulationPasses+1,'Paused display did not add ink');
   scene={...scene,sourceCamera:{...scene.sourceCamera,frame:{...scene.sourceCamera.frame,phi:.2}}};
   const angle=owner.generate(scene,context(true,9000));assert(angle.mapLive.display.cleared&&angle.mapLive.display.accumulationPasses===1,'Map angle did not clear ink while paused');
   scene={...scene,settings:{...scene.settings,scaleX:1.2}};const replay=owner.generate(scene,context(true,9000,1));expected=new Float32Array(16);advance(expected,3+2*2);
   assert(replay.mapLive.display.replayed&&equal(owner.readParticles().positionsAndMetric,expected),'Transform replay seed/budget');
   const anchor=JSON.stringify(owner.diagnostics().anchor);scene={...scene,sourceCamera:{...scene.sourceCamera,frame:{...scene.sourceCamera.frame,phi:.4}}};owner.generate(scene,context(true,9000,1));assert(JSON.stringify(owner.diagnostics().anchor)===anchor,'Replay captured camera');
   const beforeResize=owner.readParticles().positionsAndMetric,resized=owner.generate(scene,context(true,9000,1,63,37));assert(resized.mapLive.display.resized&&!resized.mapLive.display.replayed&&equal(beforeResize,owner.readParticles().positionsAndMetric),'Resize did not cancel replay with retained particles');
   owner.setPaused(false,10000);const resumed=owner.generate(scene,context(false,10100,1,63,37));assert(Math.abs(resumed.mapLive.rawDt-.1)<1e-6&&resumed.sourceCameraFrame.camera.phi===before.frame.frame.camera.phi,'Pause clock/angle restore');
   const stable=owner.diagnostics().displays;rejects(()=>owner.generate(scene,context(true,10200,1,63,37)),'Missing pause control accepted');rejects(()=>owner.generate(scene,context(false,10200,0,63,37)),'Stale replay event accepted');assert(owner.diagnostics().displays===stable,'Rejected controls changed state');
  }finally{owner.reset();assert(owner.diagnostics().retainedBytes===0,'Core leaked');}
  // A hot iteration edit retains the already evolved particles and changes
  // the next update's actual GPU iteration count, without another burn-in.
  scene=make([]);const iterations=new SourceIteratedSession('map');let iterationFacts;
  try{
   const before=iterations.generate(scene,context(false,1000)),expected=new Float32Array(iterations.readParticles().positionsAndMetric);
   iterations.setPaused(true,1000);scene=editSourceMapScene(scene,{...scene,settings:{...scene.settings,iterationsPerFrame:3}});
   const hot=context(true,1100);hot.mapLive.mapEdits={runtimeRevision:1,dotSizeRevision:0};
   const paused=iterations.generate(scene,hot);assert(equal(expected,iterations.readParticles().positionsAndMetric)&&!paused.mapLive.display.replayed&&paused.mapLive.sceneTime===before.mapLive.sceneTime,'Hot iteration edit reset particles/time');
   iterations.setPaused(false,1200);advance(expected,3);
   const next={...hot,mapLive:{...hot.mapLive,clock:{paused:false,timestampMs:1300}}},resumed=iterations.generate(scene,next);
   assert(resumed.mapLive.objectUpdates===1&&equal(expected,iterations.readParticles().positionsAndMetric),'Hot iteration edit failed independent three-step trajectory');
   assert(resumed.stats.samples-before.stats.samples===12,'Hot iteration edit repeated burn-in or ignored count');
   iterationFacts={before:before.mapLive,paused:paused.mapLive,resumed:resumed.mapLive,sampleDelta:resumed.stats.samples-before.stats.samples};
  }finally{iterations.reset();}
  // Animated color target is separate from a same-named GLSL parameter and
  // never requests replay; an explicit runtime-settings call compares the
  // current animated value even when authored values have not changed.
  scene=make([{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{colorSpeed:{min:.1,max:2,step:.01,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:1}]);
  const colors=new SourceIteratedSession('map');let colorFacts;
  try{
   colors.generate(scene,context(false,1000));const animated=colors.generate(scene,context(false,1100)),diag=colors.diagnostics();
   assert(!animated.mapLive.display.replayed&&diag.frame.mapColors.colorSpeed!==F(.5),'Animated color failed or requested replay');assert(diag.frame.parameters.values.colorSpeed===.75,'Color target changed GLSL parameter');
   colors.setPaused(true,1100);const hot=context(true,1200);hot.mapLive.mapEdits={runtimeRevision:1,dotSizeRevision:0};const output=colors.generate(scene,hot);
   assert(output.mapLive.display.replayed&&colors.diagnostics().frame.mapColors.colorSpeed===F(.5),'Equal-authored runtime event did not restore animated color and replay');
   for(const settings of [{colorSpeed:.6},{normalizedBrightness:.7},{accumulationDecay:.8},{stepMetricMin:.1}])rejects(()=>colors.generate({...scene,settings:{...scene.settings,...settings}},hot),'Grouped runtime setting without event accepted');
   colorFacts={animated:diag.frame.mapColors,afterHot:colors.diagnostics().frame.mapColors};
  }finally{colors.reset();assert(colors.diagnostics().retainedBytes===0,'Color owner leaked');}
  // Constructor .5 remains .5 at displayScale=4. Explicit dot-size setter
  // clamps before scaling, and does not request replay or reconstruct.
  scene=make([],.5);const dots=new SourceIteratedSession('map');let dotFacts;
  try{
   const c=context(true,1000,0,192,128);c.sourceViewport=ordinarySourceViewport(scene,192,128,'offscreen',32);c.sourcePointPixelDensity=1;
   const first=dots.generate(scene,c),hot={...c,mapLive:{...c.mapLive,mapEdits:{runtimeRevision:0,dotSizeRevision:1}}},second=dots.generate(scene,hot),third=dots.generate(scene,hot);
   assert(first.mapSplat.radius===2&&second.mapSplat.radius===4&&third.mapSplat.radius===4,'Dot constructor/setter scale semantics');assert(!second.mapLive.display.replayed&&second.mapLive.display.displayIndex===1,'Dot setter recreated or replayed');dotFacts={constructor:first.mapSplat,hot:second.mapSplat};
  }finally{dots.reset();}
  // Paused capture performs export display, paused update, primary display.
  const captures=[];
  for(const replay of [false,true])for(const resize of [false,true]){
   scene=make();const captureOwner=new SourceIteratedSession('map');let c=context(true,1000);c.mapLive.startAt=0;c.sourcePointPixelDensity=2;c.width=96;c.height=64;c.sourceViewport=ordinarySourceViewport(scene,48,32,'primary',32);c.sourceMapToneReference={width:96,height:64};
   try{
    let initial=captureOwner.generate(scene,c);if(replay){c={...c,mapLive:{...c.mapLive,replayRevision:1}};initial=captureOwner.generate(scene,c);}
    const before=captureOwner.diagnostics(),particles=captureOwner.readParticles().positionsAndMetric,{capture,preview}=captureOwner.capturePaused(scene,{...c,width:resize?65:96,height:resize?45:64}),after=captureOwner.diagnostics();
    assert(after.displays===before.displays+2&&capture.mapLive.objectUpdates===0&&preview.mapLive.objectUpdates===0,'Capture sequence');assert(capture.width===(resize?66:96)&&capture.sourceMapPresentation.reference.width===96,'Capture size/reference');
    assert(preview.mapLive.sceneTime===initial.mapLive.sceneTime&&captureOwner.matchesCompletedPrimary(scene,c),'Capture changed clock/capability');
    if(resize){assert(!capture.mapLive.display.replayed&&!preview.mapLive.display.replayed&&preview.mapLive.display.accumulationPasses===1,'Resize capture retained replay/ink');}
    else if(replay)assert(capture.mapLive.display.replayed&&preview.mapLive.display.replayed,'Same-size capture failed replay');
    else assert(preview.mapLive.display.accumulationPasses===initial.mapLive.display.accumulationPasses+2,'Ordinary capture lost ink');
    if(!replay||resize)assert(equal(particles,captureOwner.readParticles().positionsAndMetric),'Paused capture advanced particles');
    const stable=after.displays;rejects(()=>captureOwner.capturePaused(scene,{...c,width:8192,height:2048}),'Capture capacity accepted');assert(captureOwner.diagnostics().displays===stable,'Preflight damaged owner');
    let n=0;rejects(()=>captureOwner.capturePaused(scene,{...c,isCancelled:()=>++n>3}),'Capture cancellation ignored');assert(captureOwner.diagnostics().retainedBytes===0,'Cancelled capture retained resources');captures.push({replay,resize,capture:capture.mapLive.display,preview:preview.mapLive.display});
   }finally{captureOwner.reset();}
  }
  // Fixed reconstruction equality covers the whole final RGBA and ink, while
  // direct dispatch above has independent arithmetic expectations.
  scene=make();const temporal=new TemporalGenerationSession(),fixed=new IteratedDensitySession();let reconstruction;
  try{const live=context(true,1000);live.mapLive.startAt=.2;const output=generateScene(scene,live,temporal),cold={...live,time:.2};delete cold.mapLive;const expected=fixed.generate(scene,cold);assert(equal(output.pixels,expected.pixels)&&equal(temporal.sourceMap.snapshotInk(),fixed.snapshotInk()),'Fixed reconstruction mismatch');reconstruction={samples:output.stats.samples,frames:output.temporal.frames};generateScene(scene,cold,temporal);assert(temporal.sourceMap.diagnostics().retainedBytes===0,'Leaving live retained owner');}finally{temporal.reset();fixed.reset();}
  const worker=new Generator();let workerFacts;
  try{
   const first=await worker.generate(scene,context(false,1000)),second=await worker.generate(scene,context(false,1100));
   assert(first.mapLive.objectUpdates===2&&second.mapLive.objectUpdates===2&&second.mapLive.display.displayIndex===1,'Actual Worker lost Map live transport');
   const denied=async(fn,message)=>{let error;try{await fn();}catch(e){error=e;}assert(error,message);return error;};
   await denied(()=>worker.setSymmetryPaused(second,true),'Map output accepted by Symmetry playback');
   await denied(()=>worker.captureMapPaused({...second},{width:24,height:16}),'Copied output acquired capability');
   await worker.setMapPaused(second,true,1100);
   const capacity=await denied(()=>worker.captureMapPaused(second,{width:16384,height:16384},5),'Oversized live capture accepted');
   assert(capacity.previewRetained===true,'Preflight lost confirmed Map capability');
   const saved=await worker.captureMapPaused(second,{width:24,height:16},3);
   assert(saved.capture.width===72&&saved.capture.height===48&&saved.capture.sourcePausedImage.scale===3,'Worker capture upscale missing');
   assert(saved.capture.sourceMapPresentation.reference.width===48&&saved.preview.mapLive.display.displayIndex===second.mapLive.display.displayIndex+2,'Capture reference or two-display sequence changed');
   await denied(()=>worker.setMapPaused(second,false),'Superseded capture source remained usable');
   await worker.setMapPaused(saved.preview,false,2000);
   const resumed=await worker.generate(scene,context(false,2100));assert(Math.abs(resumed.mapLive.rawDt-.1)<1e-6,'Worker resume used wrong clock');
   const pending=worker.setMapPaused(resumed,true,2100).catch(e=>e);worker.cancel();assert((await pending).name==='AbortError','Cancel did not retire pending Map control');
   workerFacts={first:first.mapLive,second:second.mapLive,capture:saved.capture.mapLive,preview:saved.preview.mapLive,resumed:resumed.mapLive,capacityRetained:capacity.previewRetained,scale:saved.capture.sourcePausedImage};
  }finally{worker.dispose();}
  return{rows,iterationFacts,colorFacts,dotFacts,captures,reconstruction,workerFacts,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
