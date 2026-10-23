import {chromium} from '@playwright/test';
import {createServer,build,preview} from 'vite';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output=process.argv[2]??'.cache/roots-live-preview-20261023/browser',reference=process.argv[3]??'.cache/roots-completed-run-20261023';
const bundled=process.argv.includes('--bundle');
await mkdir(output,{recursive:true});const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/engine/rootsLive.ts','src/engine/rootsNativePresentationSession.ts','src/engine/rootsConcurrentStream.ts','src/engine/client.ts','src/engine/generate.worker.ts','src/engine/generationProtocol.ts','src/engine/temporal.ts','scripts/verify-roots-live-preview.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),sourceBefore:await hashes(),scope:'Public Generator → generation Worker → nested computation Workers → retained native GPU presentation. Paused background progress, drain completion, playback controls, capture and cleanup. Fixed-camera native base framebuffer only, not full PNG/video or App UI.',inputs:[],results:[]};
for(const name of ['one','four']){const path=reference+'/'+name+'-input.json',text=await readFile(path,'utf8'),frame=reference+'/final/native-'+name+'/present-frame-59.rgba';report.inputs.push({name,path,text,sha256:sha(text),frame,frameSha256:sha(await readFile(frame))});}
let server,browser;const started=performance.now();
try{
 if(bundled){
  const fixture=path.resolve(output,'fixture'),dist=path.resolve(output,'dist');await mkdir(fixture,{recursive:true});
  await writeFile(fixture+'/index.html','<!doctype html><script type="module" src="/main.js"></script>');
  await writeFile(fixture+'/main.js',"import {Generator} from '@studio/engine/client.ts';import {parseLegacyScene} from '@studio/engine/legacyImport.ts';window.rootsRuntime={Generator,parseLegacyScene};");
  await build({configFile:false,root:fixture,resolve:{alias:{'@studio':path.resolve('src')}},build:{outDir:dist,emptyOutDir:true},logLevel:'warn'});
  server=await preview({configFile:false,root:fixture,build:{outDir:dist},preview:{host:'127.0.0.1',port:0}});
 }else{server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();}
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/live-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/native/*',async r=>{const input=report.inputs.find(x=>x.name===new URL(r.request().url()).pathname.split('/').at(-1));await r.fulfill({body:await readFile(input.frame)});});
 await page.goto(server.resolvedUrls.local[0]+(bundled?'':'live-check'));if(bundled)await page.waitForFunction(()=>!!window.rootsRuntime);
 for(const input of report.inputs)report.results.push(await page.evaluate(async input=>{
  const {Generator}=window.rootsRuntime??await import('/src/engine/client.ts'),{parseLegacyScene}=window.rootsRuntime??await import('/src/engine/legacyImport.ts');
  const scene=parseLegacyScene(input.text).scene;scene.rootsPresentation.pending={model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:7,referenceHeapBytes:0};
  const check=(v,m)=>{if(!v)throw Error(m);},sleep=()=>new Promise(r=>setTimeout(r,2));
  const g=new Generator(),ctx={time:0,width:500,height:600,quality:'preview',rootsViewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'},rootsLive:{sessionId:'live-'+input.name,clock:{paused:true,timestampMs:1000},maximumWorkers:4}};
  const rows=[];let out,pendingAfterMath=0,capture,pause;
  try{
   const deadline=performance.now()+90000;
   for(let n=0;n<2000;n++){
    out=await g.generate(scene,ctx);const f=out.rootsLive;check(f&&f.paused&&f.sceneTime===0,'paused scene clock advanced');
    rows.push({n,samples:out.roots.attemptedSamples,points:out.roots.rootPoints,pending:f.stream.pending.pendingPoints,complete:f.autoRecording.complete});
    if(f.stream.pool.computationComplete&&!f.autoRecording.complete)pendingAfterMath++;
    if(f.autoRecording.complete)break;check(performance.now()<deadline,'completion deadline');await sleep();
   }
   check(out.rootsLive.autoRecording.complete&&out.roots.rootPoints===10240,'incomplete public live output');check(pendingAfterMath>0,'did not observe pending GPU after math completion');
   const raw=new Uint8Array(await(await fetch('/native/'+input.name)).arrayBuffer());let differentPixels=0,maxDifference=0;
   for(let y=0;y<600;y++)for(let x=0;x<500;x++){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(out.pixels[(y*500+x)*4+k]-raw[((599-y)*500+x)*4+k]);changed||=d>0;maxDifference=Math.max(maxDifference,d);}differentPixels+=Number(changed);}
   check(differentPixels===0,'public live output differs from native base framebuffer');
   ctx.rootsViewport.target='primary';out=await g.generate(scene,ctx);const instance=out.rootsPresentation.instance;
   await g.setRootsPaused(out,false,2000);ctx.rootsLive.clock={paused:false,timestampMs:2033};out=await g.generate(scene,ctx);
   const resumed=out.rootsLive.frame;check(Math.abs(resumed.rawDt-.033)<.000001,'resume included paused duration');
   await g.setRootsPaused(out,true);ctx.rootsLive.clock={paused:true,timestampMs:9000};const immediate=await g.captureRootsPaused(out,{width:500,height:600,logicalWidth:250,logicalHeight:300});check(immediate.preview.rootsLive.paused&&immediate.preview.rootsLive.frame.rawDt===out.rootsLive.frame.rawDt,'control then capture advanced the clock');out=await g.generate(scene,ctx);check(out.rootsPresentation.instance===instance&&out.rootsLive.frame.rawDt===0,'pause rebuilt or advanced');pause={resumed,paused:out.rootsLive.frame};
   await g.setRootsPaused(out,false,9500);await g.setRootsPaused(out,true);
   const pair=await g.captureRootsPaused(out,{width:500,height:600,logicalWidth:250,logicalHeight:300});
   check(JSON.stringify(pair.capture.rootsLive.frame)===JSON.stringify(out.rootsLive.frame)&&JSON.stringify(pair.preview.rootsLive.frame)===JSON.stringify(out.rootsLive.frame),'capture advanced scene clock');
   check(pair.capture.rootsPresentation.pausedCapture.samplesGenerated===null&&pair.capture.rootsPresentation.pausedCapture.arrivals==='concurrent-pending','capture misreported producer status');capture={capture:pair.capture.rootsLive,preview:pair.preview.rootsLive};
   // Explicit old context still uses ordinal replay and retires live producers.
   const old={...ctx};delete old.rootsLive;out=await g.generate(scene,old);check(!out.rootsLive&&out.rootsPresentation.streamPolicy==='global-ordinal','saved replay silently upgraded');
   // Mode change constructs a new arrival owner and submits all points to the cloud ring.
   scene.rootsPresentation.mode='point-cloud';let cloud;
   for(let n=0;n<500;n++){cloud=await g.generate(scene,ctx);if(cloud.rootsLive.autoRecording.complete)break;await sleep();}
   check(cloud.rootsLive.autoRecording.complete&&cloud.rootsPresentation.pointCloud.totalWrites==='10240','cloud stream lost or duplicated points');
   // Capture while points remain pending refreshes delivery counters without a clock tick.
   scene.rootsPresentation.mode='density';let pendingCapture;
   for(let n=0;n<500;n++){out=await g.generate(scene,ctx);if(out.rootsLive.stream.pending.pendingPoints>0)break;await sleep();}
   check(out.rootsLive.stream.pending.pendingPoints>0,'missing pending capture witness');
   const pendingPair=await g.captureRootsPaused(out,{width:500,height:600,logicalWidth:250,logicalHeight:300});
   for(const frame of [pendingPair.capture,pendingPair.preview])check(frame.rootsPresentation.attemptedSamples===frame.roots.attemptedSamples&&frame.rootsPresentation.totalRawPoints===frame.roots.rootPoints&&frame.stats.samples===frame.roots.attemptedSamples,'capture delivery counters stale');
   pendingCapture={before:out.roots.attemptedSamples,capture:pendingPair.capture.roots.attemptedSamples,preview:pendingPair.preview.roots.attemptedSamples};
   // Direct pause changes reject and retire the owner; a fresh request recovers.
   let rejected=false;try{await g.generate(scene,{...ctx,rootsLive:{...ctx.rootsLive,clock:{paused:false,timestampMs:10000}}});}catch(error){rejected=/setPaused/.test(error.message);}
   check(rejected,'implicit pause transition was accepted');
   await g.generate(scene,ctx);g.cancel();
   return{name:input.name,frames:rows.length,pendingAfterMath,color:{differentPixels,maxDifference},rows,pause,capture,ordinalRetained:true,cloudPoints:cloud.rootsPresentation.pointCloud.totalWrites,implicitPauseRejected:rejected,pendingCapture,cancelled:true};
  }finally{g.dispose();}
 },input));
 await new Promise(r=>setTimeout(r,250));assert.equal(page.workers().length,0);report.remainingWorkers=0;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();if(server){if(bundled)await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));else await server.close();}report.bundled=bundled;report.sourceAfter=await hashes();assert.deepEqual(report.sourceAfter,report.sourceBefore);report.seconds=(performance.now()-started)/1000;await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,seconds:report.seconds,results:report.results.map(r=>({name:r.name,frames:r.frames,pendingAfterMath:r.pendingAfterMath,color:r.color,ordinalRetained:r.ordinalRetained,cancelled:r.cancelled})),remainingWorkers:report.remainingWorkers}));}
