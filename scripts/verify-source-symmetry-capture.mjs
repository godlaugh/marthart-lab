/** Real WebGL owner and Worker capture lifecycle; no native window parity. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>{const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.parentPath+'/'+x.name);files.push('scripts/verify-source-symmetry-capture.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const report={status:'running',originalWindowExecuted:false,sourceBefore:await snapshot()},started=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{SourceSymmetrySession}=await import('/src/engine/sourceSymmetrySession.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{Generator}=await import('/src/engine/client.ts');
  const {enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])),rejects=fn=>{let error;try{fn();}catch(e){error=e;}assert(error,'Expected rejection');return String(error);};
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Capture',parameters:{gain:.001},settings:{batch_size:32,burn_in_steps:4,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ed6538'],equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'},timeline:[{type:'wait',duration:.1}]})).scene;
  const c={time:0,quality:'preview',width:96,height:64,sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,48,32,'primary',32),sourceSymmetryToneReference:{width:96,height:64},symmetryLive:{sessionId:'capture',renderFps:60,replayRevision:0,startAt:0,clock:{paused:true,timestampMs:1000}}};
  const rows=[];
  for(const replay of [false,true])for(const resize of [false,true]){
   const owner=new SourceSymmetrySession();
   try{
    let current={...c,symmetryLive:structuredClone(c.symmetryLive)},initial=owner.generate(scene,current);
    if(replay){current={...current,symmetryLive:{...current.symmetryLive,replayRevision:1}};initial=owner.generate(scene,current);assert(initial.symmetryLive.display.replayActive,'Replay setup');}
    const before=owner.diagnostics(),particles=owner.readParticles().positionsAndMetric,request={...current,width:resize?65:96,height:resize?45:64};
    const result=owner.capturePaused(scene,request),after=owner.diagnostics(),{capture,preview}=result;
    assert(capture.width===(resize?66:96)&&capture.height===(resize?46:64),'Physical density rounding');
    assert(capture.sourceCameraFrame.viewport.target==='offscreen'&&preview.sourceCameraFrame.viewport.target==='primary','Target roles');
    assert(preview.width===96&&preview.height===64&&after.displays===before.displays+2,'Exactly two displays and restoration');
    assert(capture.symmetryLive.objectUpdates===0&&preview.symmetryLive.objectUpdates===0&&preview.symmetryLive.sceneTime===initial.symmetryLive.sceneTime,'Paused capture updated particles/clock');
    assert(JSON.stringify(after.anchor)===JSON.stringify(before.anchor),'Resize changed captured camera anchor');
    assert(capture.sourceSymmetryPresentation.reference.width===96&&capture.sourceSymmetryPresentation.reference.height===64,'Offscreen tone lost primary reference');
    assert(owner.matchesCompletedPrimary(scene,current),'Restored owner lost capability');
    if(resize){assert(!capture.symmetryLive.display.replayed&&!preview.symmetryLive.display.replayed&&!after.replay.replayActive,'Resize retained replay');assert(capture.symmetryLive.display.accumulationPasses===1&&preview.symmetryLive.display.accumulationPasses===1,'Resize did not clear ink');}
    else if(replay){assert(capture.symmetryLive.display.replayed&&preview.symmetryLive.display.replayed,'Same-size capture failed replay');assert(after.replay.remainingReplaySteps<before.replay.remainingReplaySteps,'Replay failed to advance');}
    else assert(preview.symmetryLive.display.accumulationPasses===initial.symmetryLive.display.accumulationPasses+2,'Ordinary capture did not accumulate twice');
    if(!replay||resize)assert(equal(owner.readParticles().positionsAndMetric,particles),'Ordinary paused capture changed particles');
    const stable=owner.diagnostics().displays;
    const tooLarge=rejects(()=>owner.capturePaused(scene,{...current,width:8192,height:2048}));assert(owner.matchesCompletedPrimary(scene,current)&&owner.diagnostics().displays===stable,'Capacity rejection damaged preview');
    rejects(()=>owner.capturePaused({...scene,parameters:{gain:.2}},current));assert(owner.matchesCompletedPrimary(scene,current),'Foreign request damaged preview');
    let n=0;rejects(()=>owner.capturePaused(scene,{...current,isCancelled:()=>++n>3}));assert(!owner.matchesCompletedPrimary(scene,current)&&owner.diagnostics().retainedBytes===0,'Partial capture retained ambiguous owner');
    owner.generate(scene,c);assert(owner.matchesCompletedPrimary(scene,c),'Fresh retry after cancellation');
    rows.push({replay,resize,before:initial.symmetryLive,capture:capture.symmetryLive,preview:preview.symmetryLive,tooLarge});
   }finally{owner.reset();assert(owner.diagnostics().retainedBytes===0,'Leaked resources');}
  }
  const isolated=new SourceSymmetrySession();
  try{const input={...c,sourceSymmetryToneReference:{...c.sourceSymmetryToneReference}};isolated.generate(scene,input);input.sourceSymmetryToneReference.width=13;const captured=isolated.capturePaused(scene,c);assert(captured.preview.sourceSymmetryPresentation.reference.width===96,'Caller mutation changed retained primary reference');}finally{isolated.reset();}
  // Actual Worker capability, pause transition, postprocessing and retry.
  const g=new Generator(),expectedOwner=new SourceSymmetrySession();
  try{
   const running={...c,symmetryLive:{...c.symmetryLive,clock:{paused:false,timestampMs:1000}}};
   let output=await g.generate(scene,running);expectedOwner.generate(scene,running);
   await g.setSymmetryPaused(output,true,1000);expectedOwner.setPaused(true,1000);
   const paused={...running,symmetryLive:{...running.symmetryLive,clock:{...running.symmetryLive.clock,paused:true}}};
   let rejected=false;try{await g.captureSymmetryPaused({...output},{width:96,height:64});}catch{rejected=true;}assert(rejected,'Copied output selected Worker owner');
   try{await g.captureSymmetryPaused(output,{width:8192,height:2048});throw Error('capacity accepted');}catch(e){assert(e.previewRetained===true,'Worker failed retained preflight acknowledgement');}
   const actual=await g.captureSymmetryPaused(output,{width:65,height:45}),expected=expectedOwner.capturePaused(scene,{...paused,width:65,height:45});
   assert(equal(actual.capture.pixels,enhanceSourcePausedImage(expected.capture.pixels,66,46)),'Worker full enhanced RGBA mismatch');
   assert(equal(actual.preview.pixels,expected.preview.pixels),'Worker primary restoration mismatch');
   assert(actual.capture.sourcePausedImage.baseSize[0]===66&&actual.capture.sourcePausedImage.scale===1,'Worker enhancement facts');
   output=actual.preview;const again=await g.captureSymmetryPaused(output,{width:96,height:64},3);assert(again.capture.width===288&&again.capture.height===192&&again.capture.sourcePausedImage.scale===3,'Capture capability/upscale not renewed');
   await g.setSymmetryPaused(again.preview,false,1100);
   const resumed=await g.generate(scene,{...running,symmetryLive:{...running.symmetryLive,clock:{paused:false,timestampMs:1200}}});assert(Math.abs(resumed.symmetryLive.rawDt-.1)<1e-6,'Capture altered resume clock');
  }finally{g.dispose();expectedOwner.reset();}
  return{rows,workerPassed:true,fullEnhancedRgbaCompared:true,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
