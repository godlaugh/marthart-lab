import {chromium} from '@playwright/test';
import {sourceNativeVerificationServer} from './lib/source-native-verification-server.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2];if(!output)throw Error('Pass a fresh report path');
const paths=['src/scenes/sourcePerlin.ts','src/engine/sourcePerlinLive.ts','src/engine/sourcePerlinResponse.ts','src/engine/temporal.ts','src/engine/client.ts','src/engine/generate.worker.ts','src/engine/generationInput.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/types.ts','scripts/verify-source-perlin-live.mjs'];
const hashes=()=>Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])).then(Object.fromEntries);
const report={status:'running',sourceBefore:await hashes(),errors:[],scope:'Real production Generator Worker and GenerationQueue with Chrome WebGL2; no replaced numerical producers. Validates live transport, playback/capture/recording identity and deferred queue handoff. Not an original-app pixel oracle or public UI acceptance.'};
let host,server,browser,page;const deadline=setTimeout(()=>void browser?.close(),30000),started=performance.now();
try{
 const arg=process.argv.indexOf('--native-backend');host=await sourceNativeVerificationServer(output+'.service',arg<0?undefined:process.argv[arg+1]);server=host.server;report.nativeBackend=host.backend;browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/perlin-live-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Perlin live transport</title>'}));await page.goto(server.resolvedUrls.local[0]+'perlin-live-check');await page.unroute('**/perlin-live-check');
 report.result=await page.evaluate(async native=>{
  const {Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts');
  const result=globalThis.__perlinLiveResult={checks:[],frames:[],workers:{created:0,terminated:0},browser:navigator.userAgent};
  const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);result.workers.created++;this.addEventListener('message',({data})=>{if(data.operation?.startsWith('source-recording')){const out=data.result?.warmup??data.result?.preview??data.output;(result.recordingWire??=[]).push({operation:data.operation,error:data.error,context:data.result?.context,sceneId:data.result?.scene?.id,live:out?.perlinLive,sourceFrame:out?.sourcePerlinFrame,width:out?.width,height:out?.height});}});let ended=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!ended){ended=true;result.workers.terminated++;}stop();};}};
  const check=(v,id)=>{if(!v)throw Error(id);result.checks.push(id);};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hash=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const scene=()=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'live transport',settings:{render_mode:'GPU',seed:'1771842692935',particle_count:12,gpu_texture_style:3},timeline:[{type:'wait',duration:.2}]})).scene;
  const context=(token='live')=>({time:999,quality:'preview',width:48,height:36,sourcePerlinViewport:{width:48,height:36,pixelDensity:1},sourceViewport:{logicalWidth:48,logicalHeight:36,referenceLogicalHeight:36,target:'primary',projectionPass:'perspective'},perlinLive:{sessionId:token,paletteRevision:0,clock:{paused:true,timestampMs:1000}}});
  const g=new Generator(),s=scene(),c=context(),cold=structuredClone(s);let queue,control;
  const record=async(label,o)=>{check(o.type==='raster'&&o.backend===(native?'native':'webgl2')&&(!native||o.sourcePixelRenderer?.backend==='native')&&o.perlinLive&&o.sourcePerlinFrame,label+' actual GPU raster');result.frames.push({label,renderer:o.sourcePixelRenderer,live:o.perlinLive,frame:o.sourcePerlinFrame,width:o.width,height:o.height,rgbaSha256:await hash(o.pixels)});};
  try{
   let o=await g.generate(s,c);await record('initial',o);check(o.perlinLive.sceneTime===0,'initial paused uses retained source time instead of UI time999');
   await g.setPerlinPaused(o,false,1000);c.perlinLive.clock={paused:false,timestampMs:1100};o=await g.generate(s,c);await record('running',o);check(o.perlinLive.renderKind==='update'&&o.perlinLive.sceneTime>0,'injected live update advances');
   await g.setPerlinPaused(o,true,1100);c.perlinLive.clock={paused:true,timestampMs:9000};const paused=await g.generate(s,c);await record('paused',paused);check(same(o.perlinLive.frame,paused.perlinLive.frame)&&paused.perlinLive.renderKind==='snapshot','pause snapshot preserves actual frame');
   s.perlinSource.palette=[0x40112233,0x80112233];c.perlinLive.paletteRevision=1;const hot=await g.generate(s,c);await record('hot-palette',hot);
   check(same(hot.perlinLive,{...paused.perlinLive,paletteRevision:1})&&same(hot.sourcePerlinFrame,paused.sourcePerlinFrame),'hot palette keeps live clock, construction and updates');
   check(await hash(hot.pixels)!==await hash(paused.pixels),'hot palette changes actual GPU pixels');
   const capture=await g.capturePerlinPaused(hot,{width:19,height:13},1);await record('capture-preview',capture.preview);check(same(capture.capture.perlinLive.frame,paused.perlinLive.frame)&&same(capture.preview.perlinLive.frame,paused.perlinLive.frame),'capture and primary preserve paused frame');check(capture.capture.width===19&&capture.capture.height===13,'capture requested size');
   control=new Generator();const controlPreview=await control.generate(cold,context('cold-reference'));
   const controlRecording=await control.beginSourceRecording(controlPreview,{width:24,height:18,simulationFps:30});
   const recording=await g.beginSourceRecording(capture.preview,{width:24,height:18,simulationFps:30});await record('recording-warmup',recording.warmup);check(recording.warmup.perlinLive.clockSource==='fixed-step','recording fixed clock');
   check(same(recording.scene.perlinSource.palette,s.perlinSource.palette),'recording keeps authored palette in its public document');
   check(await hash(recording.warmup.pixels)===await hash(controlRecording.warmup.pixels),'recording pixels use original cold palette after live recoloring');
   await control.finishSourceRecording(controlRecording.handle);control.dispose();control=undefined;
   for(let i=1;i<=recording.clock.lastDisplayFrame;i++)await record('recording-'+i,await g.nextSourceRecordingFrame(recording.handle,i));
   const stopped=await g.finishSourceRecording(recording.handle);await record('stopped',stopped.preview);check(stopped.context.perlinLive.sessionId===c.perlinLive.sessionId&&!stopped.context.perlinLive.clock.paused&&stopped.context.perlinLive.startAt===undefined,'recording restores live token and running clock');check(stopped.preview.perlinLive.renderKind==='snapshot'&&stopped.preview.perlinLive.constructions===recording.warmup.perlinLive.constructions,'finish redraw does not reconstruct');
   await g.setPerlinPaused(stopped.preview,true);check(true,'finished preview grants playback capability');
   const afterStop=await g.generate(stopped.scene,{...stopped.context,perlinLive:{...stopped.context.perlinLive,clock:{paused:true}}});await record('after-stop',afterStop);
   check(await hash(afterStop.pixels)===await hash(stopped.preview.pixels),'authored palette is not silently reapplied after recording handoff');
   const reapplyContext={...stopped.context,perlinLive:{...stopped.context.perlinLive,paletteRevision:2,clock:{paused:true}}};
   const reapplied=await g.generate(stopped.scene,reapplyContext);await record('equal-palette-reapplied',reapplied);
   check(same(reapplied.perlinLive,{...afterStop.perlinLive,paletteRevision:2})&&same(reapplied.sourcePerlinFrame,afterStop.sourcePerlinFrame),'equal-color command preserves model, clock and camera');
   check(await hash(reapplied.pixels)!==await hash(afterStop.pixels),'equal-color command after recording changes actual GPU pixels');
   const retry=await g.generate(stopped.scene,reapplyContext);await record('equal-command-retry',retry);
   check(same(retry.perlinLive,reapplied.perlinLive)&&await hash(retry.pixels)===await hash(reapplied.pixels),'retrying the same command preserves delivered pixels and revision');g.dispose();
   const qg=new Generator(),qs=scene(),qc=context('queue');let latest,resolveOutput,busy=false;const outputs=[],errors=[];
   queue=new GenerationQueue(qg,{output:(o,time,doc)=>{latest=o;outputs.push({time,name:doc.name,width:o.width,live:o.perlinLive});resolveOutput?.();},error:e=>errors.push(e.message),busy:value=>{busy=value;}});
   const next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('queue response deadline')),10000);resolveOutput=()=>{clearTimeout(timer);resolveOutput=undefined;resolve();};});
   const idle=async()=>{for(let i=0;i<300&&busy;i++)await new Promise(r=>setTimeout(r,10));check(!busy,'queue releases completed request');};
   let delivered=next();queue.request(qs,qc);await delivered;await idle();
   const before=latest.perlinLive.frame;await queue.setPerlinPaused(false);await queue.setPerlinPaused(true);const renamed={...qs,name:'renamed before recording'};delivered=next();queue.request(renamed,qc,0,'metadata');await delivered;await idle();check(same(before,latest.perlinLive.frame),'queue metadata keeps paused frame and draws snapshot');
   let release;const gate=new Promise(r=>release=r);let entered;const startGate=new Promise(r=>entered=r);const recordingTask=queue.recordSource(latest,{width:24,height:18,simulationFps:30},{start:()=>{entered();return gate;},frame:()=>{}});await Promise.race([startGate,recordingTask.then(()=>{throw Error('recording ended before consumer start');})]);
   const deferred={...renamed,name:'explicit deferred rename'};queue.request(deferred,{...qc,width:50});release();await recordingTask;
   for(let i=0;i<300&&(outputs.at(-1)?.name!==deferred.name||latest.width!==50);i++)await new Promise(r=>setTimeout(r,10));
   check(!errors.length,'queue no errors');check(outputs.at(-1)?.name===deferred.name,'deferred authored rename survives recording');check(latest.width===50,'deferred viewport generation completes');check(latest.perlinLive.sessionId==='queue','deferred request retains source live session');check(outputs.at(-1).time===latest.perlinLive.sceneTime,'queue publishes delivered source time');
   // A newer hot command authored during recording must survive the stop
   // context, which still acknowledges the older sequence.
   let releaseHot,enteredHot;const hotGate=new Promise(r=>releaseHot=r),hotStart=new Promise(r=>enteredHot=r);
   const hotRecording=queue.recordSource(latest,{width:24,height:18,simulationFps:30},{start:()=>{enteredHot();return hotGate;},frame:()=>{}});
   await Promise.race([hotStart,hotRecording.then(()=>{throw Error('recording ended before hot consumer start');})]);
   const deferredHot={...deferred,perlinSource:{...deferred.perlinSource,palette:[0x20123456,0x20123456]}};
   queue.request(deferredHot,{...qc,width:50,perlinLive:{...qc.perlinLive,paletteRevision:1}});releaseHot();await hotRecording;
   for(let i=0;i<300&&latest.perlinLive.paletteRevision!==1;i++)await new Promise(r=>setTimeout(r,10));
   check(latest.perlinLive.paletteRevision===1,'new palette command authored during recording survives handoff');
   check(!errors.length,'deferred palette command produces no queue errors');
   queue.dispose();queue=undefined;check(result.workers.created===result.workers.terminated,'all owned workers terminated');result.queueOutputs=outputs;return result;
  }finally{queue?.dispose();control?.dispose();g.dispose();}
 },host.native);
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.errors.length)throw Error('Source changed or page error');report.status='passed';
}catch(e){report.status='failed';report.error={message:e.message,stack:e.stack};report.partial=await page?.evaluate(()=>globalThis.__perlinLiveResult).catch(()=>undefined);process.exitCode=1;}
finally{clearTimeout(deadline);await browser?.close();await host?.close();report.remainingServiceProcesses=host?.service?.ownedProcessCount??0;report.seconds=(performance.now()-started)/1000;report.closed={browser:true,vite:true};await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,seconds:report.seconds,checks:report.result?.checks.length,error:report.error?.message,output}));}
