import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {measureFamily} from './browser-process-cost.mjs';

const sessionMode=process.argv.includes('--session');
const includeBoundary=sessionMode||process.argv.includes('--boundary');
const sha=b=>createHash('sha256').update(b).digest('hex');
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const hashes=async()=>{
 const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/benchmark-source-bouncing-display.mjs','scripts/browser-process-cost.mjs').sort();
 return Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
};
const report={at:new Date().toISOString(),sessionMode,includeBoundary,scope:'Complete configuration projection, all source initial particles, GPU upload, 31 explicit update+point-render tasks at640x360, each full RGBA8 readback and SHA256, disposal. Fixed shared Scene camera phi=F(pi/2),theta=gamma=0; not native Bouncing configuration camera. No source replay-clock or boundary composition claim.',measurement:'Each fixture has one cold-first and one warm-fresh task in its own newly launched Chrome family, after module loading. Both tasks create a fresh particle/GPU owner. Elapsed includes initialization, all31updates/frames/hashes and disposal; browser/module startup excluded. ps sampled every250ms and task boundaries, summed CPU deltas by PID/start time and aggregate RSS. Sampling may miss short-lived children and instantaneous RSS peaks. Cold is not flushed OS/driver cache; warm RSS includes browser state from cold task. Node/Vite and VRAM excluded.',baseline:'No equivalent previous source-style point renderer; old local sampler/collision/render model is not an equivalent task.',unmeasured:['Agent token usage','Original JVM/JOGL cost and full-frame parity','GPU device time and VRAM','Browser startup and module import cost','Boundary drawing, source scene replay and public PNG/MP4 workflows'],nativeFullFrameParity:false,results:[]};
if(includeBoundary){report.scope='Complete source initialization,31update+particle+closedboundary frames at640x360, full RGBA8 hash and disposal. Fixed shared Scene camera phi=F(pi/2),theta=gamma=0; not native Bouncing configuration camera. No replay-clock/public workflow claim.';report.unmeasured=report.unmeasured.map(s=>s.replace('Boundary drawing, source scene replay','Source scene replay'));report.baseline='No earlier complete source closed-boundary task; particle-only workload differs and is reported separately.';}
if(sessionMode){report.scope='Public generateScene + TemporalGenerationSession, complete source initialization,31 fixed-FPS30 checkpoint updates and particle+closedboundary frames at640x360, every full RGBA8 hash and disposal. Explicit payload camera phi=F(pi/2),theta=gamma=0 matches direct --boundary experiment; NOT native Bouncing configuration default. No import/UI/export workflow claim.';report.baseline='Equivalent direct SourceBouncingGpu --boundary task: same source fixtures, all31 updates, fixed experimental camera, dimensions, hashes and process-family measurement. Compare complete elapsed/CPU/RSS; session preparation is not the direct seedElapsedMs phase.';report.unmeasured=report.unmeasured.map(s=>s.replace('Source scene replay and public PNG/MP4 workflows','Native import/UI and public PNG/MP4 workflows'));}
let server,browserServer,browser;
try{
 const before=await hashes(),jarHash=sha(await readFile(jar));if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Pinned JAR differs');
 const exampleText=execFileSync('python3',['-c',"import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read('data/Bouncing/bouncing1.json').decode())",jar],{encoding:'utf8'});
 report.reference={jar,jarHash,exampleSha256:sha(exampleText)};
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 for(const [name,raw] of [['default200000',{}],['builtin-bouncing1-2000000',JSON.parse(exampleText)]]){
  browserServer=await chromium.launchServer({channel:'chrome',headless:true});const rootPid=browserServer.process().pid;if(!rootPid)throw Error('Owned browser PID unavailable');
  browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/bouncing-cost',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'bouncing-cost');
  report.browserVersion=browser.version();report.nodeVersion=process.version;
  await page.evaluate(async ({raw,includeBoundary,sessionMode})=>{
   const {importSourceBouncingConfig}=await import('/src/engine/sourceBouncingConfig.ts'),{generateSourceBouncingSeeds}=await import('/src/engine/sourceBouncingSeeds.ts'),{importSourceBouncingVisualConfig}=await import('/src/engine/sourceBouncingVisualConfig.ts'),{SourceBouncingGpu}=await import('/src/engine/sourceBouncingGpu.ts'),{prepareSourceCamera,SOURCE_CAMERA_MODEL}=await import('/src/engine/sourceCamera.ts');
   const sessionModules=sessionMode?{...await import('/src/engine/temporal.ts'),...await import('/src/engine/sourceBouncingDocument.ts'),...await import('/src/engine/sourceBouncingReplay.ts'),...await import('/src/engine/document.ts'),...await import('/src/scenes/index.ts')}:undefined;
   const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
   window.__bouncingCost=async()=>{
    const start=performance.now(),frames=[];let engine,session,row;
    try{
     if(sessionMode){
      const payload=take(sessionModules.importSourceBouncingDocument(raw)).payload;
      payload.camera={phi:Math.fround(Math.PI/2),theta:0,gamma:0};
      const scene={...sessionModules.createScene(sessionModules.definition('bouncing')),bouncingSource:payload,settings:{},equations:{},parameters:{},timeline:{duration:10,fps:30,loop:false,tracks:[]}};
      const viewport={logicalWidth:640,logicalHeight:360,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'};
      session=new sessionModules.TemporalGenerationSession();let checkpoint=sessionModules.sourceBouncingSeedCheckpoint();
      const preparationElapsedMs=performance.now()-start;
      for(let i=0;i<31;i++){
       const begin=performance.now();checkpoint=take(sessionModules.planSourceBouncingFixedReplay({from:checkpoint,updates:i+1,fps:30})).checkpoint;
       const output=sessionModules.generateScene(scene,{time:checkpoint.sceneTime,sourceBouncingFrame:checkpoint,sourceViewport:viewport,width:640,height:360,quality:'export'},session);
       if(output.type!=='raster'||output.backend!=='webgl2'||!output.cameraResolved||JSON.stringify(output.sourceBouncingFrame?.checkpoint)!==JSON.stringify(checkpoint))throw Error('Wrong public frame identity or backend');
       const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');
       frames.push({index:i,sha256:hash,elapsedMs:performance.now()-begin,checkpoint});
      }
      const owner=session.sourceBouncing.diagnostics(),diagnostics=owner.gpu;
      if(owner.simulationUpdates!==31||!diagnostics||diagnostics.passes!==31||diagnostics.rendered!==31||diagnostics.boundaryDraws!==31||diagnostics.readbackBytes!==31*640*360*4)throw Error('Incomplete session task or unexpected particle readback');
      row={status:'completed',count:payload.configuration.particleCount,preparationElapsedMs,frames,diagnostics,sessionDiagnostics:owner};
     }else{
     const config=take(importSourceBouncingConfig(raw)).configuration,visual=take(importSourceBouncingVisualConfig(raw)).configuration,seed=take(generateSourceBouncingSeeds(config));
     const camera=take(prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}},{logicalWidth:640,logicalHeight:360,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'}));if(camera.kind!=='known')throw Error(camera.reason);
     engine=new SourceBouncingGpu(seed.state);const initialized=performance.now();
     for(let i=0;i<31;i++){
      const begin=performance.now();engine.advance(seed.update);const output=engine.render({width:640,height:360,cameraPlan:camera.plan,visualConfiguration:visual,initialSpeed:config.initialSpeed,...(includeBoundary?{boundary:seed.update.boundary}:{})});
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');
      frames.push({index:i,sha256:hash,elapsedMs:performance.now()-begin});
     }
     const diagnostics=engine.diagnostics();if(diagnostics.passes!==31||diagnostics.rendered!==31||diagnostics.readbackBytes!==31*640*360*4)throw Error('Incomplete task or unexpected particle readback');if(diagnostics.boundaryDraws!==(includeBoundary?31:0))throw Error('Incomplete boundary draw sequence');
     row={status:'completed',count:config.particleCount,seedElapsedMs:initialized-start,frames,diagnostics};
     }
    }catch(error){row={status:'failed',frames,error:String(error)};}
    finally{try{session?.reset();if(session&&(session.diagnostics().retainedBytes||session.sourceBouncing.diagnostics().gpu))throw Error('Session owner not disposed');engine?.dispose();if(engine&&(!engine.diagnostics().disposed||engine.diagnostics().handles))throw Error('Owner not disposed');}catch(error){row={...row,status:'failed',cleanupError:String(error)};}}
    return{...row,elapsedMs:performance.now()-start};
   };
  },{raw,includeBoundary,sessionMode});
  const rows=[];for(const temperature of ['cold-first-task','warm-fresh-task']){const row=await measureFamily(rootPid,()=>page.evaluate(()=>window.__bouncingCost()));rows.push({temperature,...row});if(row.status!=='completed'||row.processFamily.samplingErrors.length)throw Error(name+': '+JSON.stringify(row));}
  const repeatStable=rows[0].frames.every((frame,i)=>frame.sha256===rows[1].frames[i].sha256);report.results.push({name,rows,repeatStable,errors});if(!repeatStable||errors.length)throw Error('Cold/warm output mismatch or page errors');
  await browser.close();browser=undefined;await browserServer.close();browserServer=undefined;
 }
 report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);if(!report.sourceStable)throw Error('Sources changed during benchmark');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 report.cleanup=[];for(const [name,resource] of [['browser',browser],['owned-browser-server',browserServer],['vite',server]])if(resource)try{await resource.close();report.cleanup.push({name,status:'closed'});}catch(error){report.cleanup.push({name,status:'failed',error:String(error)});report.status='failed';process.exitCode=1;}
 await writeFile(sessionMode?'.cache/v2-source-bouncing-session-cost.json':includeBoundary?'.cache/v2-source-bouncing-boundary-cost.json':'.cache/v2-source-bouncing-display-cost.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,results:report.results.map(({name,repeatStable,rows})=>({name,repeatStable,rows:rows.map(({temperature,count,elapsedMs,seedElapsedMs,preparationElapsedMs,processFamily})=>({temperature,count,elapsedMs,seedElapsedMs,preparationElapsedMs,processFamily}))}))},null,2));
}
