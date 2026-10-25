/** Real WebGL sync/awaited-backend equivalence. No CGL or original-app claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(v=>v.isFile()).map(v=>v.parentPath+'/'+v.name).concat('scripts/verify-source-iterated-async.mjs').sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={status:'running',scope:'Actual WebGL through synchronous and awaited execution of one SourceIteratedSession; no native backend, original application or cross-device claim',sourceBefore:await snapshot()},start=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.results=await page.evaluate(async()=>{
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{editSourceMapScene}=await import('/src/engine/sourceMapScene.ts'),{editSourceSymmetryConfiguration}=await import('/src/engine/sourceSymmetryConfig.ts');
  const assert=(value,message)=>{if(!value)throw Error(message);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));const results=[];
  for(const family of ['map','symmetry']){
   const parse=family==='map'?parseLegacyScene:parseProjectFile;let scene=parse(JSON.stringify({config_version:'1.0.0',name:'Awaited real GPU',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',parameters:family==='map'?{gain:.0001}:{alpha:2.5},equations:family==='map'?{x_next:'x+gain',y_next:'y',z_next:'0'}:undefined,settings:{batch_size:256,burn_in_steps:20,iterations_per_frame:1},timeline:[{type:'wait',duration:.1}]}),{sourceEntry:'runtime-config'}).scene;scene.timeline.fps=30;
   const key=family==='map'?'mapLive':'symmetryLive';let c={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),[key]:{sessionId:'async-gpu',renderFps:30,replayRevision:0,clock:{paused:false,timestampMs:1000}}};
   const sync=new SourceIteratedSession(family);const retained=[];let gpu;
   const asyncOwner=new SourceIteratedSession(family,{asyncBackend:()=>{gpu=new IteratedDensityGpu();retained.push(gpu);const current=gpu;return{
    step:async(job,options)=>current.step(job,options),resizeAccumulation:async(w,h)=>current.resizeAccumulation(w,h),present:async(tone,view)=>current.present(tone,undefined,view),validateAccumulationCapture:(...args)=>current.validateAccumulationCapture(...args),diagnostics:()=>current.diagnostics(),dispose:async()=>current.dispose(),
   };}});
   const rows=[];
   const check=(label,a,b)=>{
    assert(equal(a.pixels,b.pixels),family+' '+label+' RGBA');const x=sync.readParticles(),y=gpu.readParticles();for(const k of ['positionsAndMetric','invalidCounts','validity'])assert(equal(x[k],y[k]),family+' '+label+' '+k);
    assert(equal(sync.snapshotInk(),gpu.readback()),family+' '+label+' ink');assert(JSON.stringify(a[key].display)===JSON.stringify(b[key].display),family+' '+label+' display');assert(JSON.stringify(a.stats)===JSON.stringify(b.stats),family+' '+label+' stats');rows.push({label,width:a.width,height:a.height,pixels:a.pixels.length/4,particles:x.validity.length,display:a[key].display.displayIndex,passes:a[key].display.accumulationPasses});
   };
   try{
    for(const timestampMs of [1000,1016,1032]){c[key].clock.timestampMs=timestampMs;check('running-'+timestampMs,sync.generate(scene,c),await asyncOwner.generateAsync(scene,c));}
    sync.setPaused(true,1032);asyncOwner.setPaused(true,1032);c[key].clock={paused:true,timestampMs:1032};
    const candidate={...scene,parameters:{...scene.parameters,[family==='map'?'gain':'alpha']:.25}},hot=family==='map'?editSourceMapScene(scene,candidate,'parameters'):editSourceSymmetryConfiguration(scene,candidate,'parameters');sync.updateParameters(scene,hot,c);asyncOwner.updateParameters(scene,hot,c);scene=hot;
    check('navigation',sync.navigatePaused(scene,c,{kind:'wheel',count:1}),await asyncOwner.navigatePausedAsync(scene,c,{kind:'wheel',count:1}));
    c[key].replayRevision++;check('replay',sync.generate(scene,c),await asyncOwner.generateAsync(scene,c));
    const a=sync.capturePaused(scene,{...c,width:96,height:72,quality:'export'}),b=await asyncOwner.capturePausedAsync(scene,{...c,width:96,height:72,quality:'export'});assert(equal(a.capture.pixels,b.capture.pixels),family+' offscreen capture pixels');check('restored-primary',a.preview,b.preview);
    const ra=sync.beginRecording(scene,c,{width:64,height:48,simulationFps:30}),rb=await asyncOwner.beginRecordingAsync(scene,c,{width:64,height:48,simulationFps:30});check('recording-warmup',ra.warmup,rb.warmup);
    for(let i=1;i<=ra.clock.lastDisplayFrame;i++)check('recording-'+i,sync.nextRecordingFrame(ra.handle,i),await asyncOwner.nextRecordingFrameAsync(rb.handle,i));
    const before=asyncOwner.diagnostics().displays;sync.finishRecording(ra.handle,2000);asyncOwner.finishRecording(rb.handle,2000);assert(asyncOwner.diagnostics().displays===before,'stop unexpectedly displayed');
   }finally{sync.reset();await asyncOwner.resetAsync();assert(sync.diagnostics().retainedBytes===0&&asyncOwner.diagnostics().retainedBytes===0&&retained.every(v=>v.diagnostics().retainedBytes===0),family+' cleanup');}
   results.push({family,rows,allExact:true,retainedBytes:0});
  }return results;
 });report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack??error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}report.seconds=(performance.now()-start)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,seconds:report.seconds,sourceStable:report.sourceStable,results:report.results,error:report.error}));}
