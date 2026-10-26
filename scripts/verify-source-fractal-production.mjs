import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer as createSocketServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
import {verifyFractalNativeUi} from './fractal-native-production-ui.mjs';
assert.equal(process.platform,'darwin');
const workflowsOnly=process.argv.includes('--workflows-only'),uiOnly=process.argv.includes('--ui-only');
const started=performance.now();await mkdir('.cache',{recursive:true});const root=await mkdtemp(path.resolve('.cache/fractal-native-production-'));
const fixture=JSON.parse(await readFile('tests/fixtures/source-fractal-cgl/reference.json','utf8')),input=await readFile('tests/fixtures/source-fractal-cgl/mandelbrot.json','utf8');
assert.deepEqual(fixture.cases.map(c=>c.name),['shallow','deep-1e5','deep-1e9']);
const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(input),fixture.inputSha256);
const report={at:new Date().toISOString(),directory:root,scope:'Production Generator native live/current-capture/cold/retained-recording workflows and actual App import/preview. Fixed mathematical raster references remain separate from whole-window/original animation acceptance.',commands:[],cases:[],originalExecuted:false};
const sourcePaths=(await readdir('src',{recursive:true})).filter(p=>/\.(tsx?|json|css)$/.test(p)).map(p=>'src/'+p).concat((await readdir('server',{recursive:true})).filter(p=>/\.(mjs|m|h)$/.test(p)).map(p=>'server/'+p),'scripts/verify-source-fractal-production.mjs','scripts/fractal-native-production-ui.mjs','tests/fixtures/source-fractal-cgl/reference.json','tests/fixtures/source-fractal-cgl/mandelbrot.json','package-lock.json','package.json','vite.config.ts','index.html');
const snapshot=async()=>Object.fromEntries(await Promise.all(sourcePaths.sort().map(async p=>[p,sha(await readFile(p))])));report.sourcesBefore=await snapshot();
let server,browser,service;
async function command(executable,args,tag){
 const start=performance.now();
 const row=await new Promise(resolve=>{
  const child=spawn(executable,args,{detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
  let stdout='',stderr='',error,timedOut=false,force;
  child.stdout.on('data',d=>{stdout=(stdout+d).slice(-16384);});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-16384);});child.on('error',e=>{error=String(e);});
  const signal=s=>{try{if(child.pid)process.kill(-child.pid,s);}catch(e){if(e.code!=='ESRCH')error=String(e);}};
  const timer=setTimeout(()=>{timedOut=true;signal('SIGTERM');force=setTimeout(()=>signal('SIGKILL'),1000);},45000);
  child.on('close',(exit,signal)=>{clearTimeout(timer);clearTimeout(force);let processGroupExists=false;if(child.pid)try{process.kill(-child.pid,0);processGroupExists=true;}catch(e){if(e.code!=='ESRCH')error=String(e);}resolve({tag,executable,args,pid:child.pid,exit,signal,error,timedOut,processGroupExists,stdout,stderr,seconds:(performance.now()-start)/1000});});
 });report.commands.push(row);assert.equal(row.exit,0,JSON.stringify(row));assert.equal(row.error,undefined);assert.equal(row.timedOut,false);assert.equal(row.processGroupExists,false);return row;
}
try{
 const measured=await measureFamily(process.pid,async()=>{
 const binary=root+'/renderer';await command('/usr/bin/clang',['-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',binary],'compile');
 report.executableSha256=sha(await readFile(binary));
 const reservation=createSocketServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 service=await createExportServer({sourceRendererBackend:{executablePath:binary,executableSha256:report.executableSha256,timeoutMs:20000},root:root+'/exports',allowedOrigins:[`http://127.0.0.1:${port}`]});const api=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${api.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-automation','--enable-angle-features=disableProgramCaching']});const cdp=await browser.newBrowserCDPSession();report.browserProcesses=await cdp.send('SystemInfo.getProcessInfo');
 const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 for(const item of workflowsOnly||uiOnly?[]:fixture.cases){
  const value=JSON.parse(input);Object.assign(value.fractal,item.fractalChanges);const time=performance.now();
  const result=await page.evaluate(async({input,width,height,logicalWidth,logicalHeight})=>{
   const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{Generator}=await import('/src/engine/client.ts');
   const scene=parseProjectFile(JSON.stringify(input)).scene,generator=new Generator(),context={time:0,quality:'export',width,height,fractalPixelDensity:2,fractalViewport:{logicalWidth,logicalHeight,target:'primary'},fractalLive:{sessionId:crypto.randomUUID(),revision:0,intent:'apply',clock:{paused:true},actualFrameRate:30}},frames=[];let final;
   try{for(let i=0;i<4;i++){const output=await generator.generate(scene,context);if(output.type!=='raster'||output.backend!=='native'||output.fractalRender.execution.backend!=='native'||output.sourcePixelRenderer?.backend!=='native'||output.fractalLive.clockSource!=='page-wall-clock')throw Error('Public live generator did not return native facts');frames.push({display:output.fractalRender.display,execution:output.fractalRender.execution,reference:output.fractalRender.reference,color:output.fractalRender.color,retained:output.fractalRender.retained});final=output;}
    if(final.fractalRender.display.needsAnotherDisplay)throw Error('Live display did not stabilize');return{pixels:Array.from(final.pixels),frames};
   }finally{generator.dispose();await generator.settledNativeCleanup();}
  },{input:value,width:fixture.width,height:fixture.height,logicalWidth:fixture.logicalWidth,logicalHeight:fixture.logicalHeight});
  const top=Buffer.from(result.pixels),bottom=Buffer.alloc(top.length);for(let y=0;y<fixture.height;y++)top.copy(bottom,(fixture.height-1-y)*fixture.width*4,y*fixture.width*4,(y+1)*fixture.width*4);assert.equal(sha(bottom),item.rgbaSha256,item.name+' public mathematical RGBA');await writeFile(root+'/'+item.name+'.rgba',bottom);
  report.cases.push({name:item.name,seconds:(performance.now()-time)/1000,rgbaSha256:sha(bottom),frames:result.frames});console.log(JSON.stringify({name:item.name,status:'passed',frames:result.frames.length}));
 }
 if(!uiOnly){report.workflows=await page.evaluate(async input=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{Generator}=await import('/src/engine/client.ts'),{withFractalFreshRecording}=await import('/src/engine/sourceFractalRecording.ts');
  const check=(ok,message)=>{if(!ok)throw Error(message);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const source=structuredClone(input);source.timeline=[{type:'wait',duration:.08}];const scene=parseProjectFile(JSON.stringify(source)).scene;scene.timeline.fps=30;
  const generator=new Generator(),cold=new Generator(),context={time:0,quality:'export',width:96,height:80,fractalPixelDensity:2,fractalViewport:{logicalWidth:48,logicalHeight:40,target:'primary'},fractalLive:{sessionId:crypto.randomUUID(),revision:0,intent:'apply',clock:{paused:true},actualFrameRate:30}};let output,restoreFetch;
  const result={};
  try{
   for(let i=0;i<4;i++)output=await generator.generate(scene,context);const before=structuredClone(output.fractalLive);
   const capture=await generator.captureFractalPaused(output,{width:96,height:80},3);check(same(capture.capture.fractalLive.presentation.evaluatedFractalScene,before.presentation.evaluatedFractalScene),'capture advanced scene');check(capture.capture.sourceCurrentImage.scale===3&&capture.capture.width===96,'capture skipped ordered composition');check(await hash(capture.capture.pixels)===await hash(output.pixels),'stable same-size capture changed pixels');output=capture.preview;result.capture={samePixels:true,sameState:true,metadata:capture.capture.sourceCurrentImage};
   const invalid=structuredClone(scene);invalid.settings.perturbationPrecision='UNKNOWN';let rejected;
   try{await generator.generate(invalid,{...context,fractalLive:{...context.fractalLive,revision:1,intent:'hot',configuration:invalid}});}catch(e){rejected=e;}
   check(rejected?.previewRetained===true,'invalid hot edit did not retain prior preview');await generator.setFractalPaused(output,true);result.invalidHotRetained=true;
   const start=await generator.beginSourceRecording(output,{width:96,height:80,simulationFps:30});check(start.clock.lastDisplayFrame>=1&&start.clock.lastDisplayFrame<=5,'unexpected small recording length');check(start.warmup.width===288&&start.warmup.height===240,'recording must keep original 3x physical render buffer');const recorded=[start.warmup];
   let wrong;try{await generator.nextSourceRecordingFrame(start.handle,2);}catch(e){wrong=e;}check(wrong?.recordingRetained===true,'out-of-order frame did not preserve recording');generator.cancel();check(generator.hasSourceRecording(start.handle),'queue cancellation destroyed live recording');
   for(let frame=1;frame<=start.clock.lastDisplayFrame;frame++)recorded.push(await generator.nextSourceRecordingFrame(start.handle,frame));
   const fresh=withFractalFreshRecording(scene,30),coldContext={time:0,quality:'export',width:288,height:240,fractalPixelDensity:2,fractalViewport:{logicalWidth:144,logicalHeight:120,target:'offscreen'}},rows=[];
   for(let frame=0;frame<recorded.length;frame++){
    const independent=await cold.generate(fresh,{...coldContext,fractalRecording:{displayFrame:frame,simulationFps:30}}),actual=recorded[frame];check(await hash(actual.pixels)===await hash(independent.pixels),'retained/cold pixel disagreement '+JSON.stringify({frame,retained:{display:actual.fractalRender.display,state:actual.fractalLive?.presentation.evaluatedFractalScene},cold:{display:independent.fractalRender.display,state:independent.fractalRecording},firstActual:Array.from(actual.pixels.slice(0,24)),firstCold:Array.from(independent.pixels.slice(0,24))}));check(same(actual.fractalRecording,independent.fractalRecording),'retained/cold clock disagreement');rows.push({frame,sha256:await hash(actual.pixels),facts:actual.fractalRecording,display:actual.fractalRender.display});
   }
   const terminal=recorded.at(-1).fractalLive,stop=await generator.finishSourceRecording(start.handle,1000);check(stop.preview.fractalLive.updateOrdinal===terminal.updateOrdinal&&stop.preview.fractalLive.rawDt===0&&same(stop.preview.fractalLive.presentation.evaluatedFractalScene,terminal.presentation.evaluatedFractalScene),'stop advanced numerical frame');check(!generator.hasSourceRecording(start.handle),'finished recording lease still live');output=stop.preview;result.recording={clock:start.clock,frames:rows,stopUnadvanced:true};
   await generator.setFractalPaused(output,true);const paused={...stop.context,fractalLive:{...stop.context.fractalLive,clock:{paused:true}}};
   const originalFetch=window.fetch;let observe,release;const observed=new Promise(resolve=>{observe=resolve;}),held=new Promise(resolve=>{release=resolve;});let used=false;
   window.fetch=async(...args)=>{const response=await originalFetch(...args);if(!used&&String(args[0]).includes('/api/source-renderer/frames')){used=true;observe();await held;}return response;};restoreFetch=()=>{window.fetch=originalFetch;release();};
   const pending=generator.generate(scene,paused),caught=pending.catch(e=>e);await observed;generator.cancel();check((await caught).name==='AbortError','cancel did not reject publication');let cleaned=false;const cleanup=generator.settledNativeCleanup().then(()=>{cleaned=true;});await Promise.resolve();check(!cleaned,'cleanup dropped an in-flight owner');release();await cleanup;restoreFetch();restoreFetch=undefined;
   const neighbor=await cold.generate(fresh,{...coldContext,fractalRecording:{displayFrame:recorded.length-1,simulationFps:30}});check(await hash(neighbor.pixels)===rows.at(-1).sha256,'cancelling live owner changed independent resource');
   const recovered=await generator.generate(scene,{...context,fractalLive:{...context.fractalLive,sessionId:crypto.randomUUID()}});check(recovered.backend==='native','native recovery failed');result.cancellation={pendingAckWaited:true,neighborPreserved:true,recovered:true};
   // Drop already-committed real responses to exercise unknown transport state.
   // These are explicit fault injections, never reference pixels or success ACKs.
   let dropSample=true,dropRelease=true;const events=[];
   window.fetch=async(...args)=>{const body=args[1]?.body,view=body instanceof Uint8Array?new DataView(body.buffer,body.byteOffset,body.byteLength):undefined,op=view&&view.byteLength>=88&&view.getUint32(4,true)===11?view.getUint32(64,true):0;const response=await originalFetch(...args);if(op)events.push({op,status:response.status});if(op===2&&dropSample){dropSample=false;throw new TypeError('injected lost committed sample response');}if(op===3&&dropRelease){dropRelease=false;throw new TypeError('injected lost committed release response');}return response;};restoreFetch=()=>{window.fetch=originalFetch;};
   // Arm faults only for finish: warmup must be a successful actual draw.
   dropSample=false;dropRelease=false;const failureStart=await generator.beginSourceRecording(recovered,{width:96,height:80,simulationFps:30});events.length=0;dropSample=true;dropRelease=true;
   let firstFinish;try{await generator.finishSourceRecording(failureStart.handle,1100);}catch(e){firstFinish=e;}check(firstFinish?.recordingRetained===true&&generator.hasSourceRecording(failureStart.handle),'unconfirmed release lost recording ownership');const samples=events.filter(e=>e.op===2).length;
   let retryFinish;try{await generator.finishSourceRecording(failureStart.handle,1200);}catch(e){retryFinish=e;}check(retryFinish?.recordingRetained===false&&!generator.hasSourceRecording(failureStart.handle),'confirmed release did not retire failed recording');check(events.filter(e=>e.op===2).length===samples,'cleanup retry redrew failed finish');check(events.filter(e=>e.op===3).length===2,'release did not retry exact native owner');result.finishFailure={fault:'lost real sample and release responses',events:structuredClone(events),releaseOnlyRetry:true,retiredAfterAck:true};
   dropSample=true;dropRelease=false;events.length=0;let coldFailed;try{await cold.generate(fresh,{...coldContext,fractalRecording:{displayFrame:0,simulationFps:30}});}catch(e){coldFailed=e;}check(coldFailed,'cold injected failure not observed');const retried=await cold.generate(fresh,{...coldContext,fractalRecording:{displayFrame:0,simulationFps:30}});check(await hash(retried.pixels)===rows[0].sha256,'cold explicit retry failed to rebuild the same frame');result.coldFailure={fault:'lost real sample response',events:structuredClone(events),explicitRetrySamePixels:true};restoreFetch();restoreFetch=undefined;
   const afterFailure=await generator.generate(scene,{...context,fractalLive:{...context.fractalLive,sessionId:crypto.randomUUID()}});check(afterFailure.backend==='native','post-failure new session recovery failed');return result;
  }finally{restoreFetch?.();generator.dispose();cold.dispose();await generator.settledNativeCleanup();await cold.settledNativeCleanup();}
 },JSON.parse(input));console.log(JSON.stringify({workflows:'passed',recordingFrames:report.workflows.recording.frames.length}));}
 if(!workflowsOnly){await page.close();report.probeClosedBeforeUi=true;report.ui=await verifyFractalNativeUi(browser,server.resolvedUrls.local[0],root,JSON.parse(input));console.log(JSON.stringify({ui:'passed'}));}
 assert.equal(report.cases.length,workflowsOnly||uiOnly?0:3);report.referenceCasesSkipped=workflowsOnly||uiOnly;report.workflowsSkipped=uiOnly;report.uiSkipped=workflowsOnly;return {};});report.processFamily=measured.processFamily;report.measurement='250ms sampled Node/Chrome/native process family across compile, setup and all cases, excluding final cleanup. CPU may omit short-lived descendants; RSS sums shared pages and is a sampled lower bound on instantaneous peak. Each case creates a fresh native resource, then reuses it; OS/driver caches are not flushed. No equivalent prior native HTTP workflow exists for a before/after speed claim. GPU/VRAM and per-operation CPU/RSS are unmeasured.';report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.ownedProcesses=service?.ownedProcessCount;report.browserClosed=!browser?.isConnected();report.serverClosed=!server?.httpServer?.listening;
 report.browserProcessAfter=(report.browserProcesses?.processInfo??[]).filter(p=>p.type==='browser').map(p=>{let exists;try{process.kill(p.id,0);exists=true;}catch(e){exists=e.code==='ESRCH'?false:'unknown';}return{pid:p.id,exists};});
 report.sourcesAfter=await snapshot();report.sourcesStable=JSON.stringify(report.sourcesBefore)===JSON.stringify(report.sourcesAfter);if(!report.sourcesStable||report.cleanupErrors.length||report.ownedProcesses!==0||!report.browserClosed||!report.serverClosed||report.browserProcessAfter.some(p=>p.exists!==false)){report.status='failed';report.error??='Source changed or cleanup incomplete';process.exitCode=1;}report.seconds=(performance.now()-started)/1000;await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:root+'/report.json'}));
}
