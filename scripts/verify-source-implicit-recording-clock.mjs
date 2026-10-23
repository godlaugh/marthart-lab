/** Compare original pre-branding pixels and F32 camera facts. Default mode
 * diagnoses explicit FPS selection; --worker-recording verifies the real Worker
 * recording lifecycle with authored FPS unchanged. Neither exercises App video. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
import {isDeepStrictEqual} from 'node:util';
const workerRecording=process.argv[4]==='--worker-recording';assert.ok(process.argv[4]===undefined||workerRecording);
const root=process.argv[2],directory=process.argv[3];assert.ok(root&&directory,'Reference directory and new output directory required');await mkdir(directory);
const sha=b=>createHash('sha256').update(b).digest('hex'),referenceHashes={};
const read=async path=>{const bytes=await readFile(path);referenceHashes[path]=sha(bytes);return bytes;};
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p),'scripts/verify-source-implicit-recording-clock.mjs','desktop/graphics.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,sha(await readFile(path))])));
let browser,vite,service;const started=performance.now(),report={workerRecording,scope:workerRecording?'Owned recording through a real browser Worker and native full-artwork rendering, authored FPS unchanged. No public client/App integration or encoded video equivalence claim.':'Diagnostic recording FPS selection and sequential clock, actual Generator/Worker/native full-artwork frames. No App recording integration or native encoded video equivalence claim.',cases:[],referenceHashes,sourceBefore:await hashes()};
try{
 assert.ok(process.env.MATHART_SOURCE_RENDERER_BACKEND);
 assert.equal(sha(await read('../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar')),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 service=await createExportServer({root:directory+'/service',allowedOrigins:['http://127.0.0.1:5178'],sourceRendererBackend:JSON.parse(await read(process.env.MATHART_SOURCE_RENDERER_BACKEND))});const a=await service.listen(0);
 vite=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:5178,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${a.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});const page=await browser.newPage();
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:5178/fixture');
 const names=JSON.parse(await read(root+'/cases.json'));assert.ok(Array.isArray(names)&&names.length>0&&names.length<=8&&new Set(names).size===names.length&&names.every(n=>typeof n==='string'&&/^[a-z0-9-]+$/.test(n)));
 const measured=await measureFamily(process.pid,async()=>{
 for(const name of names){
 const native=root+'/native-'+name,run=JSON.parse(await read(native+'/run.json')),source=await read(root+'/inputs/'+name+'.json'),input=JSON.parse(source),reference=JSON.parse(await read(native+'/frames.json'));
 assert.equal(run.exit,0);assert.equal(run.timedOut,false);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(sha(source),run.sourceSha256);assert.equal(sha(await read(native+'/NativeSceneProbe.java')),run.probeSha256);
 assert.doesNotMatch(run.stderr,/GL_INVALID|OpenGL error|Exception/);for(const action of ['VIEW','RUN','EXPORT'])assert.ok(run.stdout.includes('allowed='+action+':true'));assert.match(run.stdout,/objects=0,visible=0/);assert.ok(!run.stdout.split('\n').some(line=>line.startsWith('windows=')&&!line.includes('objects=0,visible=0')));
 for(const file of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[file],run.userFilesAfter[file]);
 assert.ok(reference.length>0&&reference.length<=40&&reference.at(-1).complete);assert.equal(input.project.type,'IMPLICIT');assert.equal(input.project.main_equation.enabled,false);
 assert.ok(Number.isInteger(input.simulationFps)&&input.simulationFps>=1&&input.simulationFps<=120&&input.steps.length>=reference.length);

 const result=await page.evaluate(async({input,count,workerRecording})=>{
  const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport,ordinarySourceCameraInitial}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts'),{OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline}=await import('/src/engine/ordinarySourceCameraTimeline.ts');
  const encode=bytes=>{const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(chunks.join(''));};
  const scene=parseLegacyScene(JSON.stringify(input.project)).scene,g=new Generator(),resources=new SourceDrawingResources(),rows=[],originalFps=scene.timeline.fps,clock=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(scene),scene.timeline.tracks,input.simulationFps,{}),layout=resolveOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(scene),scene.timeline.tracks,input.simulationFps);
  let worker,sequence=0,start,stop,rerecord;const pending=new Map();
  const wire=(request)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Worker response timed out'));},30000);pending.set(id,{operation:request.operation,resolve,reject,timer});worker.postMessage({sessionId:17,id,...request});});
  const context={width:384,height:288,quality:'export',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,384,288,'offscreen',486)};
  try{
   if(workerRecording){
    const url=(await import('/src/engine/generate.worker.ts?worker&url')).default;worker=new Worker(url,{type:'module'});
    worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p||data.operation!==p.operation)return;pending.delete(data.id);clearTimeout(p.timer);if('error' in data)p.reject(Error(data.error));else p.resolve(data);};
    const preview=await wire({operation:'generate',scene,context:{time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)}});
    start=await wire({operation:'source-recording-begin',sourceId:preview.id,options:{width:128,height:96,simulationFps:input.simulationFps,actualFrameRate:input.steps[0].actualFrameRate}});
   }
   for(let i=0;i<count;i++){
    const baseline=workerRecording?undefined:await g.generate(scene,{...context,time:i/input.simulationFps});
    const sequential=clock.step(Math.fround(1/Math.fround(input.simulationFps)),{actualFrameRate:input.steps[i].actualFrameRate});
    const candidate=structuredClone(scene);if(!workerRecording)candidate.timeline.fps=input.simulationFps;
    const output=workerRecording?(i===0?start.result.warmup:(await wire({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:i,actualFrameRate:input.steps[i].actualFrameRate})).output):await g.generate(candidate,{...context,time:i/input.simulationFps}),renderer=resources.renderer;renderer.setSize(384,288,1);renderer.setOutput(output,{...candidate,evaluatedSourceCamera:output.sourceCameraFrame},false);
    const frame=renderer.sourceDrawingFrame(1,i+1);if(!frame.ok)throw Error(JSON.stringify(frame.error));const raster=await renderSourceNativeFrame(frame.value);
    rows.push({baseline:baseline?.sourceCameraFrame,candidate:output.sourceCameraFrame,implicitRecording:output.implicitRecording,sequential,pixels:encode(raster.pixels)});
   }
   if(workerRecording){
    const ended=await wire({operation:'source-recording-finish',recordingId:start.recordingId});
    stop={camera:ended.result.preview.sourceCameraFrame,context:ended.result.context,sceneUnchanged:JSON.stringify(ended.result.scene)===JSON.stringify(scene),hasRecordingFacts:ended.result.preview.implicitRecording!==undefined};
    const again=await wire({operation:'source-recording-begin',sourceId:ended.id,options:{width:128,height:96,simulationFps:input.simulationFps,actualFrameRate:input.steps[0].actualFrameRate}});rerecord={clock:again.result.clock,camera:again.result.warmup.sourceCameraFrame};await wire({operation:'source-recording-finish',recordingId:again.recordingId});
   }
   return {originalFps,layout,rows,clock:start?.result.clock,stop,rerecord};
  }finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Worker disposed'));}pending.clear();worker?.terminate();g.dispose();resources.dispose();clock.reset();}
 },{input,count:reference.length,workerRecording});
 assert.equal(Math.max(1,result.layout.updates),reference.length);
 if(workerRecording){assert.equal(result.clock.updates,reference.length);assert.equal(result.clock.encodedFrames,reference.length-1);assert.equal(result.stop.sceneUnchanged,true);assert.equal(result.stop.hasRecordingFacts,false);assert.equal(result.stop.context.time,reference.at(-1).sceneTime);assert.equal(result.stop.camera.frameIndex,reference.length-1);assert.equal(result.stop.camera.viewport.target,'primary');assert.deepEqual(result.stop.camera.camera,result.rows.at(-1).candidate.camera);assert.deepEqual(result.rerecord.clock,result.clock);assert.deepEqual(result.rerecord.camera.camera,result.rows[0].candidate.camera);}
 const row={name,workerClock:result.clock,stop:result.stop,rerecord:result.rerecord,originalFps:result.originalFps,simulationFps:input.simulationFps,layout:result.layout,frames:[]};report.cases.push(row);
 for(let i=0;i<reference.length;i++){
  const ref=reference[i],local=result.rows[i];assert.equal(ref.frame,i);assert.equal(ref.width,384);assert.equal(ref.height,288);assert.equal(ref.rowOrder,'bottom-up');assert.equal(ref.artworkReference,'before-branding.rgba');assert.equal(ref.complete,i===reference.length-1);assert.equal(ref.rendering,true);
  const bytes=await read(root+'/native-'+name+'/frame-'+i+'/'+ref.artworkReference);assert.equal(bytes.length,384*288*4);const top=Buffer.alloc(bytes.length);for(let y=0;y<288;y++)bytes.copy(top,y*384*4,(287-y)*384*4,(288-y)*384*4);
  const pixels=Buffer.from(local.pixels,'base64');assert.equal(pixels.length,bytes.length);let differingPixels=0,maxDelta=0;for(let p=0;p<top.length;p+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(top[p+c]-pixels[p+c]);maxDelta=Math.max(maxDelta,d);changed ||=d!==0;}if(changed)differingPixels++;}
  const camera={...ref.camera};delete camera.phiRate;delete camera.thetaRate;delete camera.gammaRate;
  assert.deepEqual(local.sequential.camera,camera);assert.equal(local.sequential.sceneTime,ref.sceneTime);assert.equal(local.sequential.rawDt,ref.rawDt);assert.equal(local.sequential.queueComplete,ref.complete);assert.deepEqual(local.candidate.camera,camera);assert.equal(differingPixels,0,'Full original artwork differs');assert.deepEqual(local.sequential.rates,[ref.camera.phiRate,ref.camera.thetaRate,ref.camera.gammaRate]);
  if(workerRecording){assert.deepEqual(local.implicitRecording,{displayFrame:i,simulationFps:input.simulationFps,actualFrameRate:Math.fround(input.steps[i].actualFrameRate),warmup:i===0,complete:ref.complete});assert.equal(local.candidate.sceneTime,ref.sceneTime);assert.equal(local.candidate.rawDt,ref.rawDt);assert.equal(local.candidate.queueComplete,ref.complete);assert.equal(local.candidate.frameIndex,i);assert.deepEqual(local.candidate.rates,[ref.camera.phiRate,ref.camera.thetaRate,ref.camera.gammaRate]);}
  row.frames.push({index:i,implicitRecording:local.implicitRecording,differingPixels,maxDelta,baselineCameraMatches:local.baseline?isDeepStrictEqual(local.baseline.camera,camera):null,reference:ref,candidate:local.candidate,sequential:local.sequential});
  await writeFile(directory+'/'+name+'-'+i+'.rgba',pixels);
 }
 console.log(JSON.stringify({name,diffs:row.frames.map(f=>f.differingPixels)}));
 }
 return{};});report.processFamily=measured.processFamily;report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}
finally{const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(x=>x.status==='rejected').map(x=>String(x.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error}));if(report.status!=='passed')process.exitCode=1;}
