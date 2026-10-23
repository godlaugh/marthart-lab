/** Original Implicit recording-clock diagnostics, not a product recording API.
 * Compare every pre-branding pixel and F32 camera fact after explicitly selecting
 * recording FPS; retain authored-FPS differences to expose the integration gap. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
import {isDeepStrictEqual} from 'node:util';
const root=process.argv[2],directory=process.argv[3];assert.ok(root&&directory,'Reference directory and new output directory required');await mkdir(directory);
const sha=b=>createHash('sha256').update(b).digest('hex'),referenceHashes={};
const read=async path=>{const bytes=await readFile(path);referenceHashes[path]=sha(bytes);return bytes;};
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p),'scripts/verify-source-implicit-recording-clock.mjs','desktop/graphics.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,sha(await readFile(path))])));
let browser,vite,service;const started=performance.now(),report={scope:'Diagnostic recording FPS selection and sequential clock, actual Generator/Worker/native full-artwork frames. No App recording integration or native encoded video equivalence claim.',cases:[],referenceHashes,sourceBefore:await hashes()};
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

 const result=await page.evaluate(async({input,count})=>{
  const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport,ordinarySourceCameraInitial}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts'),{OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline}=await import('/src/engine/ordinarySourceCameraTimeline.ts');
  const encode=bytes=>{const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(chunks.join(''));};
  const scene=parseLegacyScene(JSON.stringify(input.project)).scene,g=new Generator(),resources=new SourceDrawingResources(),rows=[],originalFps=scene.timeline.fps,clock=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(scene),scene.timeline.tracks,input.simulationFps,{}),layout=resolveOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(scene),scene.timeline.tracks,input.simulationFps);
  const context={width:384,height:288,quality:'export',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,384,288,'offscreen',486)};
  try{
   for(let i=0;i<count;i++){
    const baseline=await g.generate(scene,{...context,time:i/input.simulationFps});
    const sequential=clock.step(Math.fround(1/Math.fround(input.simulationFps)),{actualFrameRate:input.steps[i].actualFrameRate});
    const candidate=structuredClone(scene);candidate.timeline.fps=input.simulationFps;
    const output=await g.generate(candidate,{...context,time:i/input.simulationFps}),renderer=resources.renderer;renderer.setSize(384,288,1);renderer.setOutput(output,{...candidate,evaluatedSourceCamera:output.sourceCameraFrame},false);
    const frame=renderer.sourceDrawingFrame(1,i+1);if(!frame.ok)throw Error(JSON.stringify(frame.error));const raster=await renderSourceNativeFrame(frame.value);
    rows.push({baseline:baseline.sourceCameraFrame,candidate:output.sourceCameraFrame,sequential,pixels:encode(raster.pixels)});
   }
   return {originalFps,layout,rows};
  }finally{g.dispose();resources.dispose();clock.reset();}
 },{input,count:reference.length});
 assert.equal(Math.max(1,result.layout.updates),reference.length);
 const row={name,originalFps:result.originalFps,simulationFps:input.simulationFps,layout:result.layout,frames:[]};report.cases.push(row);
 for(let i=0;i<reference.length;i++){
  const ref=reference[i],local=result.rows[i];assert.equal(ref.frame,i);assert.equal(ref.width,384);assert.equal(ref.height,288);assert.equal(ref.rowOrder,'bottom-up');assert.equal(ref.artworkReference,'before-branding.rgba');assert.equal(ref.complete,i===reference.length-1);assert.equal(ref.rendering,true);
  const bytes=await read(root+'/native-'+name+'/frame-'+i+'/'+ref.artworkReference);assert.equal(bytes.length,384*288*4);const top=Buffer.alloc(bytes.length);for(let y=0;y<288;y++)bytes.copy(top,y*384*4,(287-y)*384*4,(288-y)*384*4);
  const pixels=Buffer.from(local.pixels,'base64');assert.equal(pixels.length,bytes.length);let differingPixels=0,maxDelta=0;for(let p=0;p<top.length;p+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(top[p+c]-pixels[p+c]);maxDelta=Math.max(maxDelta,d);changed ||=d!==0;}if(changed)differingPixels++;}
  const camera={...ref.camera};delete camera.phiRate;delete camera.thetaRate;delete camera.gammaRate;
  assert.deepEqual(local.sequential.camera,camera);assert.equal(local.sequential.sceneTime,ref.sceneTime);assert.equal(local.sequential.rawDt,ref.rawDt);assert.equal(local.sequential.queueComplete,ref.complete);assert.deepEqual(local.candidate.camera,camera);assert.equal(differingPixels,0,'Full original artwork differs');assert.deepEqual(local.sequential.rates,[ref.camera.phiRate,ref.camera.thetaRate,ref.camera.gammaRate]);
  row.frames.push({index:i,differingPixels,maxDelta,baselineCameraMatches:isDeepStrictEqual(local.baseline.camera,camera),reference:ref,candidate:local.candidate,sequential:local.sequential});
  await writeFile(directory+'/'+name+'-'+i+'.rgba',pixels);
 }
 console.log(JSON.stringify({name,diffs:row.frames.map(f=>f.differingPixels)}));
 }
 return{};});report.processFamily=measured.processFamily;report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}
finally{const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(x=>x.status==='rejected').map(x=>String(x.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error}));if(report.status!=='passed')process.exitCode=1;}
