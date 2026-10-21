/** Actual Generator + Worker + WebGL + queue. No original JVM or UI encoder claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const script='scripts/verify-source-iterated-recording-worker.mjs';
const snapshot=async()=>{const paths=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);paths.push(script);return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const golden=JSON.parse(await readFile('tests/fixtures/source-perlin/recording-clock.json','utf8'));
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot(),clockProvenance:golden.provenance,limits:['Real browser Worker and GPU; UI/FFmpeg integration is separate.','Finite Wait reference is a static bytecode transcript, not original JVM/JOGL execution.']};let server,browser;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async golden=>{
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},reject=async(fn,m)=>{let e;try{await fn();}catch(error){e=error;}check(e,m);return e;};
  const gain=2**-16;
  const make=(family,durations)=>{const s=(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Worker recording',parameters:{gain},settings:{dimension:2,batch_size:4,burn_in_steps:3,iterations_per_frame:2,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0},palette:['#ffffff','#ffffff'],...(family==='map'?{equations:{x_next:'x+gain',y_next:'y',z_next:'0'}}:{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}),timeline:[]}),{sourceEntry:'runtime-config'}).scene;
   s.timeline.tracks=durations.map((duration,i)=>({id:'w'+i,type:'wait',target:'camera.actions',duration,start:0,from:0,to:0,enabled:true,pingPong:false,easing:'linear'}));return s;};
  const context=(s,density=1)=>({time:0,quality:'preview',width:48*density,height:32*density,sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(s,48,32,'primary',32),[s.kind==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:48*density,height:32*density},[s.kind==='map'?'mapLive':'symmetryLive']:{sessionId:'initial',renderFps:60,replayRevision:0,clock:{paused:true}}});
  const Native=window.Worker,audit={created:0,terminated:0,requests:[]};window.Worker=class extends Native{constructor(...args){super(...args);audit.created++;}postMessage(m,...args){audit.requests.push(structuredClone(m));return super.postMessage(m,...args);}terminate(){audit.terminated++;return super.terminate();}};
  const rows=[];
  for(const family of ['map','symmetry'])for(const row of golden){
   const scene=make(family,row.durations),c=context(scene),key=family==='map'?'mapLive':'symmetryLive',generator=new Generator(),options={width:16,height:12,simulationFps:row.fps};
   try{
    const preview=await generator.generate(scene,c),created=audit.created,terminated=audit.terminated;
    await reject(()=>generator.beginSourceRecording({...preview},options),'Copied completed output accepted');
    const capacity=await reject(()=>generator.beginSourceRecording(preview,{...options,width:16384,height:16384}),'Capacity accepted');check(capacity.previewRetained&&!capacity.recordingRetained,'Preflight lost current capability');
    const start=await generator.beginSourceRecording(preview,options);check(start.clock.encodedFrames===row.encodedFrames&&start.clock.firstEncodedUpdate===(row.encodedFrames?2:null),'Independent clock mismatch');
    await reject(()=>generator.nextSourceRecordingFrame({...start.handle},1),'Copied handle accepted');await reject(()=>generator.generate(scene,c),'Generation interleaved');
    await reject(()=>generator.nextSourceRecordingFrame(start.handle,2),'Skipped frame accepted');check(generator.hasSourceRecording(start.handle),'Order rejection revoked lease');
    for(const f of row.frames){const frame=f.ordinal===1?start.warmup:await generator.nextSourceRecordingFrame(start.handle,f.ordinal-1),live=frame[key];check(frame.width===48&&frame.height===36&&frame.pixels.byteLength===48*36*4,'Raster transport');check(live.rawDt===f.rawDt&&live.sceneTime===f.sceneTime&&live.queueIndex===f.queueIndex&&live.queueComplete===f.queueComplete,'Independent clock transport');check(frame.iteratedRecording.displayFrame===f.ordinal-1&&frame.iteratedRecording.warmup===f.warmup,'Warmup/frame identity');}
    await reject(()=>generator.nextSourceRecordingFrame(start.handle,row.stopOrdinal),'Frame after completion accepted');
    const stop=await generator.finishSourceRecording(start.handle);check(!generator.hasSourceRecording(start.handle),'Finish retained handle');check(stop.preview[key].clock==='realtime-source-queue'&&!stop.context[key].clock.paused,'Finish failed realtime resume');check(stop.context.time===stop.preview[key].sceneTime,'Published stop time not actual primary time');check(stop.preview.sourceCameraFrame.viewport.target==='primary'&&stop.preview.width===c.width&&stop.preview.height===c.height,'Primary restoration');
    await reject(()=>generator.finishSourceRecording(start.handle),'Stale finish accepted');
    await generator[family==='map'?'setMapPaused':'setSymmetryPaused'](stop.preview,true);
    const pausedContext={...stop.context,[key]:{...stop.context[key],clock:{paused:true}}},paused=await generator.generate(stop.scene,pausedContext);check(paused[key].objectUpdates===0&&paused[key].sessionId===stop.preview[key].sessionId,'Post-stop pause reconstructed or advanced');
    const again=await generator.beginSourceRecording(paused,options);await generator.finishSourceRecording(again.handle);check(audit.created===created&&audit.terminated===terminated,'Recording replaced preview Worker');rows.push({family,name:row.name,encodedFrames:row.encodedFrames,sameWorker:true,pauseAndRerecord:true});
   }finally{generator.dispose();}
  }
  const queueCases=[];
  for(const family of ['map','symmetry'])for(const action of ['complete','cancel','consumer-failure','resize']){
   const scene=make(family,[.5]),key=family==='map'?'mapLive':'symmetryLive',c=context(scene,2),generator=new Generator();let output,stopped,busy=false;const errors=[],controller=new AbortController();
   let resolvePreview;const ready=new Promise(resolve=>resolvePreview=resolve);const queue=new GenerationQueue(generator,{output:(o)=>{output=o;resolvePreview();},recordingStopped:s=>{stopped=s;},error:e=>errors.push(String(e)),busy:v=>busy=v});
   try{
    queue.request(scene,c);await ready;for(let i=0;busy&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));check(!busy,'Initial queue did not settle');const created=audit.created,terminated=audit.terminated,frames=[];let begin;
    const task=queue.recordSource(output,{width:17,height:13,simulationFps:10},{start:s=>{begin=s;check(s.warmup.width===52&&s.warmup.height===40,'Inherited density rounding');},frame:async(frame,index)=>{frames.push(index);const requests=audit.requests.length;await new Promise(resolve=>setTimeout(resolve,15));check(audit.requests.length===requests,'Queue ignored consumer backpressure');if(index===0){if(action==='cancel')controller.abort();if(action==='consumer-failure')throw Error('injected encoder failure');if(action==='resize')queue.request(scene,{...c,width:120,height:80,sourceViewport:ordinarySourceViewport(scene,60,40,'primary',40)});}}},controller.signal);
    if(action==='cancel'||action==='consumer-failure'){const error=await reject(()=>task,'Expected consumer cancellation/failure');check(action==='cancel'?error.name==='AbortError':error.message==='injected encoder failure','Original failure replaced');check(frames.length===1,'Delivered frame after consumer stop');}else await task;
    for(let i=0;busy&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));check(!busy&&!errors.length&&stopped,'Queue did not finish');check(audit.created===created&&audit.terminated===terminated,'Queue replaced Worker');check(stopped.context[key].sessionId===begin.context[key].sessionId&&!stopped.context[key].clock.paused,'Queue lost new live session');
    if(action==='resize')check(output.width===120&&output.height===80&&output[key].sessionId===begin.context[key].sessionId,'Deferred viewport discarded or old session reused');
    else{await queue[family==='map'?'setMapPaused':'setSymmetryPaused'](true);check(!errors.length,'Queue lost completed playback capability');}
    queueCases.push({family,action,frames:frames.length,dimensions:[output.width,output.height],sessionRetained:true});
   }finally{queue.dispose();}
  }
  return{rows,queueCases,audit:{created:audit.created,terminated:audit.terminated,requests:audit.requests.length}};
 },golden.cases);
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs,cases:report.result?.rows.length,queueCases:report.result?.queueCases.length}));}
