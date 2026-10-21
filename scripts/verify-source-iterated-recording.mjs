/** Actual WebGL recording owner. Finite-Wait clocks use an independent bytecode
 * transcript; particle recurrence uses independent Float32 arithmetic. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>{const paths=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);paths.push('scripts/verify-source-iterated-recording.mjs');return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const golden=JSON.parse(await readFile('tests/fixtures/source-perlin/recording-clock.json','utf8'));
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot(),clockProvenance:golden.provenance,limits:['Core recording owner, not public Worker/UI video transport.','Finite Wait reference is a static transcript, not original JVM execution.','Seed generator has separate native fixtures; this checks independent recurrence after that initial seed.']};let server,browser;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async golden=>{
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])),F=Math.fround,gain=2**-16;
  const deny=(fn,m)=>{let e;try{fn();}catch(error){e=error;}check(e,m);return e;};
  const make=(family,durations)=>{const s=(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Recording lifecycle',parameters:{gain},settings:{dimension:2,batch_size:4,burn_in_steps:3,iterations_per_frame:2,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0},palette:['#ffffff','#ffffff'],...(family==='map'?{equations:{x_next:'x+gain',y_next:'y',z_next:'0'}}:{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}),timeline:[]}),{sourceEntry:'runtime-config'}).scene;
   s.timeline.tracks=durations.map((duration,i)=>({id:'w'+i,type:'wait',target:'camera.actions',duration,start:0,from:0,to:0,enabled:true,pingPong:false,easing:'linear'}));return s;};
  const context=(s,density=1)=>({time:0,quality:'preview',width:48*density,height:32*density,sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(s,48,32,'primary',32),[s.kind==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:48*density,height:32*density},[s.kind==='map'?'mapLive':'symmetryLive']:{sessionId:'initial',renderFps:60,replayRevision:0,clock:{paused:true,timestampMs:1000}}});
  const rows=[];
  for(const family of ['map','symmetry'])for(const row of golden){
   const scene=make(family,row.durations),c=context(scene),owner=new SourceIteratedSession(family),key=family==='map'?'mapLive':'symmetryLive';
   try{
    owner.generate(scene,c);const expected=iteratedInitialChunk(prepareIteratedFrame(scene,0,0).config,0,4);let totalSteps=0;
    const before=owner.diagnostics();for(const changed of [{width:c.width+1},{height:c.height+1},{quality:'export'}])deny(()=>owner.beginRecording(scene,{...c,...changed},{width:16,height:12,simulationFps:row.fps}),'Forged primary context admitted');deny(()=>owner.beginRecording(scene,c,{width:16384,height:16384,simulationFps:row.fps}),'Oversized recording admitted');check(owner.matchesCompletedPrimary(scene,c)&&owner.diagnostics().displays===before.displays,'Preflight changed preview');
    const start=owner.beginRecording(scene,c,{width:16,height:12,simulationFps:row.fps});check(start.clock.encodedFrames===row.encodedFrames&&start.clock.updates===row.stopOrdinal,'Independent stop ordinal');
    deny(()=>owner.generate(scene,c),'Generation admitted during recording');deny(()=>owner.setPaused(true),'Playback admitted during recording');deny(()=>owner.capturePaused(scene,c),'Capture admitted during recording');deny(()=>owner.nextRecordingFrame({},1),'Forged recording handle');
    for(const f of row.frames){
     const frame=f.ordinal===1?start.warmup:owner.nextRecordingFrame(start.handle,f.ordinal-1),live=frame[key],updates=f.managerFinishedAtFrameStart?1:2,steps=(f.ordinal===1?3:0)+updates*2;totalSteps+=steps;
     for(let step=0;step<steps;step++)for(let i=0;i<expected.length;i+=4){const old=expected[i];expected[i]=F(old+gain);expected[i+3]=family==='map'?F(Math.abs(F(expected[i]-old))):gain;}
     check(equal(owner.readParticles().positionsAndMetric,expected),'Independent particle recurrence '+family+'/'+row.name+'/'+f.ordinal);
     check(live.rawDt===f.rawDt&&live.sceneTime===f.sceneTime&&live.queueIndex===f.queueIndex&&live.queueComplete===f.queueComplete,'Independent clock '+family+'/'+row.name+'/'+f.ordinal);
     check(live.objectUpdates===updates&&live.display.displayIndex===f.ordinal-1&&live.display.accumulationPasses===f.ordinal,'One export display per recording update');
     check(frame.width===48&&frame.height===36&&frame.sourceCameraFrame.viewport.target==='offscreen'&&frame.iteratedRecording.warmup===f.warmup,'Export target / warmup');
     check(frame.stats.samples===4*totalSteps&&frame[key].clock==='fixed-source-queue'&&frame[key].clockSource==='fixed-step','Recording facts');
    }
    deny(()=>owner.nextRecordingFrame(start.handle,row.stopOrdinal),'Frame after queue completion');const beforeStop=owner.diagnostics(),ink=owner.snapshotInk(),pixels=owner.readParticles().positionsAndMetric;
    const stopped=owner.finishRecording(start.handle,10000);check(owner.diagnostics().displays===beforeStop.displays&&equal(ink,owner.snapshotInk())&&equal(pixels,owner.readParticles().positionsAndMetric)&&!owner.diagnostics().clock.paused,'Stop mutated frame or paused');
    check(!owner.ownsRecording(start.handle),'Stop retained old recording handle');deny(()=>owner.finishRecording(start.handle),'Duplicate stop accepted');
    stopped.context[key].clock.timestampMs=10100;const resumed=owner.generate(stopped.scene,stopped.context);check(Math.abs(resumed[key].rawDt-.1)<1e-6&&resumed[key].objectUpdates===1&&resumed[key].display.displayIndex===row.stopOrdinal,'Live resume recreated scene or wrong clock');
    rows.push({family,name:row.name,encodedFrames:start.clock.encodedFrames,updates:row.stopOrdinal,particleComponents:expected.length*row.stopOrdinal,resumed:resumed[key]});
   }finally{owner.reset();check(owner.diagnostics().retainedBytes===0,'Recording owner leaked');}
  }
  const boundaries=[];
  for(const family of ['map','symmetry']){
   const scene=make(family,[.3]);scene.timeline.tracks.unshift({id:'ambient',type:'animate',target:'camera.actions',duration:0,start:0,from:0,to:1,enabled:true,pingPong:false,easing:'linear',actions:[{id:'ambient',method:'ambient',args:{phiSpeed:.25,thetaSpeed:.5,gammaSpeed:.75}}]});const c=context(scene,2),key=family==='map'?'mapLive':'symmetryLive',owner=new SourceIteratedSession(family);
   try{
    owner.generate(scene,c);const hot={...scene,name:'Metadata retained',settings:{...scene.settings,scaleX:2,pointSize:5}},hc={...c,[key]:{...c[key],replayRevision:1,...(family==='map'?{mapEdits:{runtimeRevision:0,dotSizeRevision:1}}:{})}};owner.generate(hot,hc);
    const start=owner.beginRecording(hot,hc,{width:17,height:13,simulationFps:10});check(start.scene.name===hot.name&&start.scene.settings.scaleX===scene.settings.scaleX&&start.scene.settings.pointSize===scene.settings.pointSize,'Recording did not restore applied config');check(start.warmup.width===52&&start.warmup.height===40,'Density / triple-scale rounding');
    const frame=owner.nextRecordingFrame(start.handle,1),finalCamera=structuredClone(frame.sourceCameraFrame.camera),stop=owner.finishRecording(start.handle,10000);check(JSON.stringify(owner.diagnostics().frame.frame.camera)===JSON.stringify(finalCamera),'Stop reset camera');check(frame[key].queueComplete===false&&stop.context.time===frame[key].sceneTime,'Early stop did not keep actual state');
    stop.context[key].clock.timestampMs=10100;const live=owner.generate(stop.scene,stop.context);check(live[key].objectUpdates===2&&live[key].sessionId===frame[key].sessionId,'Early stop lost unfinished queue');for(const [axis,rate] of [['phi',.25],['theta',.5],['gamma',.75]])check(live.sourceCameraFrame.camera[axis]===F(finalCamera[axis]+F(F(rate)*live[key].rawDt)),'Stop/resume restored old angle '+axis);
    owner.setPaused(true,10100);stop.context[key].clock.paused=true;const paused=owner.generate(stop.scene,stop.context);check(paused[key].objectUpdates===0,'Explicit post-stop pause failed');
    const cancelContext={...stop.context,isCancelled:()=>cancelled};let cancelled=false;owner.generate(stop.scene,cancelContext);const next=owner.beginRecording(stop.scene,cancelContext,{width:16,height:12,simulationFps:10});cancelled=true;check(deny(()=>owner.nextRecordingFrame(next.handle,1),'Cancelled recording continued').name==='AbortError','Cancellation error');check(!owner.ownsRecording(next.handle)&&owner.diagnostics().retainedBytes===0,'Cancelled runtime retained resources');
    cancelled=false;owner.generate(scene,c);const release=owner.beginRecording(scene,c,{width:16,height:12,simulationFps:10}),resource=owner.replay,reset=resource.reset.bind(resource);resource.reset=()=>{throw Error('injected release failure');};
    deny(()=>owner.reset(),'Release failure ignored');check(owner.ownsRecording(release.handle),'Failed cleanup lost recording ownership');deny(()=>owner.nextRecordingFrame(release.handle,1),'Failed resource accepted frame');resource.reset=reset;owner.reset();check(!owner.ownsRecording(release.handle)&&owner.diagnostics().retainedBytes===0,'Cleanup retry failed');
    boundaries.push({family,appliedSnapshot:true,earlyStop:true,cameraContinues:true,densityRounding:true,cancellation:true,failedCleanupRetainsOwner:true});
   }finally{owner.reset();}
  }
  return{rows,boundaries};
 },golden.cases);
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs,cases:report.result?.rows.length}));}
