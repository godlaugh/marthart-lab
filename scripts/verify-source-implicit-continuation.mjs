/** Original controlled-clock stop/pause/resume versus public Generator + real
 * Worker. Artwork uses the reference offscreen projection for both sides;
 * this does not claim primary-window pixels, App controls or native MP4 parity. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
const [root,directory]=process.argv.slice(2);assert.ok(root&&directory);await mkdir(directory);
const sha=b=>createHash('sha256').update(b).digest('hex'),referenceHashes={};
const read=async path=>{const b=await readFile(path);referenceHashes[path]=sha(b);return b;};
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p),'scripts/verify-source-implicit-continuation.mjs','desktop/graphics.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
let browser,vite,service;const started=performance.now(),report={scope:'Controlled-clock original MathArt stop/pause/resume versus public Generator and real Worker. Paused states use actual captureImplicitPaused with owned geometry; other states use diagnostic offscreen projection. No primary GUI or original encoded PNG/MP4 claim.',cases:[],referenceHashes,sourceBefore:await hashes()};
try{
 assert.equal(sha(await read('../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar')),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 service=await createExportServer({root:directory+'/service',allowedOrigins:['http://127.0.0.1:5178'],sourceRendererBackend:JSON.parse(await read(process.env.MATHART_SOURCE_RENDERER_BACKEND))});const a=await service.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':'"native"'},server:{host:'127.0.0.1',port:5178,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${a.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 const page=await browser.newPage();await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:5178/fixture');
 const names=JSON.parse(await read(root+'/cases.json'));assert.ok(Array.isArray(names)&&names.length>0&&names.length<=8&&new Set(names).size===names.length&&names.every(n=>/^[a-z0-9-]+$/.test(n)));
 const measured=await measureFamily(process.pid,async()=>{
 for(const name of names){
  const native=root+'/native-'+name,run=JSON.parse(await read(native+'/run.json')),source=await read(root+'/inputs/'+name+'.json'),input=JSON.parse(source),reference=JSON.parse(await read(native+'/frames.json'));
  assert.equal(run.exit,0);assert.equal(run.timedOut,false);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(sha(source),run.sourceSha256);assert.equal(sha(await read(native+'/NativeSceneProbe.java')),run.probeSha256);
  assert.doesNotMatch(run.stderr,/GL_INVALID|OpenGL error|Exception/);for(const action of ['VIEW','RUN','EXPORT'])assert.ok(run.stdout.includes('allowed='+action+':true'));
  assert.match(run.stdout,/objects=0,visible=0/);assert.ok(!run.stdout.split('\n').some(l=>l.startsWith('windows=')&&!l.includes('objects=0,visible=0')));
  for(const file of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[file],run.userFilesAfter[file]);
  assert.equal(reference.length,input.steps.length);assert.ok(reference.length<=40);assert.equal(input.project.type,'IMPLICIT');assert.equal(input.project.main_equation.enabled,false);
  const rows=await page.evaluate(async input=>{
   const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts');
   const scene=parseLegacyScene(JSON.stringify(input.project)).scene,g=new Generator(),resources=new SourceDrawingResources(),rows=[];
   const context={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
   let output=await g.generate(scene,context),start,stop,index=0,paused=false;
   const encode=b=>{const chunks=[];for(let i=0;i<b.length;i+=32768)chunks.push(String.fromCharCode(...b.subarray(i,i+32768)));return btoa(chunks.join(''));};
   try{for(let i=0;i<input.steps.length;i++){
    const step=input.steps[i];let raster;
    if(step.action==='record'){
     if(!start){start=await g.beginSourceRecording(output,{width:128,height:96,simulationFps:input.simulationFps,actualFrameRate:step.actualFrameRate});output=start.warmup;}
     else output=await g.nextSourceRecordingFrame(start.handle,++index,step.actualFrameRate);
     raster=output;
    }else if(step.action==='stop'){stop=await g.finishSourceRecording(start.handle,step.timestampMs);output=stop.preview;}
    else if(step.action==='pause'||step.action==='resume'){paused=step.action==='pause';await g.setImplicitPaused(output,paused,step.timestampMs);}
    else output=await g.generate(stop.scene,{...stop.context,time:999,implicitLive:{...stop.context.implicitLive,actualFrameRate:step.actualFrameRate,clock:{paused,timestampMs:step.timestampMs}}});
    if(paused){const pair=await g.captureImplicitPaused(output,{width:384,height:288},1);output=pair.preview;raster=pair.capture;}
    if(!raster){
     // Keep numerical output intact. Only this diagnostic rendering copy selects
     // the same physical offscreen projection as the original reference host.
     const diagnostic={...output,sourceCameraFrame:{...output.sourceCameraFrame,viewport:ordinarySourceViewport(scene,384,288,'offscreen',486)}};
     const renderer=resources.renderer;renderer.setSize(384,288,1);renderer.setOutput(diagnostic,{...scene,evaluatedSourceCamera:diagnostic.sourceCameraFrame},false);
     const drawing=renderer.sourceDrawingFrame(1,i+1);if(!drawing.ok)throw Error(JSON.stringify(drawing.error));raster=await renderSourceNativeFrame(drawing.value);
    }
    rows.push({frame:output.sourceCameraFrame,action:step.action,paused,live:output.implicitLive,capture:raster.sourceCurrentImage,pixels:encode(raster.pixels)});
   }return rows;}finally{g.dispose();resources.dispose();}
  },input);
  const result={name,frames:[]};report.cases.push(result);
  for(let i=0;i<reference.length;i++){
   const ref=reference[i],local=rows[i],frame=local.frame,step=input.steps[i];assert.equal(ref.action,step.action);assert.equal(ref.timestampMs,step.timestampMs);assert.equal(ref.frame,i);assert.equal(ref.width,384);assert.equal(ref.height,288);assert.equal(ref.rowOrder,'bottom-up');assert.equal(ref.artworkReference,'before-branding.rgba');
   const camera={...ref.camera};delete camera.phiRate;delete camera.thetaRate;delete camera.gammaRate;
   assert.deepEqual(frame.camera,camera);assert.equal(frame.sceneTime,ref.sceneTime);assert.equal(frame.rawDt,ref.rawDt);assert.equal(frame.queueComplete,ref.complete);assert.equal(local.paused,ref.paused);assert.equal(ref.rendering,step.action==='record');assert.deepEqual(frame.rates,[ref.camera.phiRate,ref.camera.thetaRate,ref.camera.gammaRate]);
   const bytes=await read(native+'/frame-'+i+'/'+ref.artworkReference),pixels=Buffer.from(local.pixels,'base64');assert.equal(bytes.length,384*288*4);assert.equal(pixels.length,bytes.length);let differingPixels=0,maxDelta=0;
   for(let y=0;y<288;y++)for(let x=0;x<384;x++){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(bytes[((287-y)*384+x)*4+c]-pixels[(y*384+x)*4+c]);changed ||=d!==0;maxDelta=Math.max(maxDelta,d);}if(changed)differingPixels++;}
   result.frames.push({index:i,action:step.action,differingPixels,maxDelta,reference:ref,candidate:frame,live:local.live,capture:local.capture});assert.equal(differingPixels,0,'Original offscreen artwork differs');
   await writeFile(directory+'/'+name+'-'+i+'.rgba',pixels);
  }
  console.log(JSON.stringify({name,frames:rows.length,diffs:result.frames.map(f=>f.differingPixels)}));
 }return{};});report.processFamily=measured.processFamily;report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}
finally{const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error}));if(report.status!=='passed')process.exitCode=1;}
