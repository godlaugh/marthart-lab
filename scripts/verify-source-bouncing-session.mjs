/** Public generator/worker composition check. The reference deliberately reuses
 * verified lower-level owners: this is NOT an independent native pixel oracle. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
const script='scripts/verify-source-bouncing-session.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat(script).sort().map(async p=>[p,hash(await readFile(p))])));
const report={scope:'Real Chrome public generateScene and Generator module Worker; direct GPU owner composition equivalence, not independent native JVM/JOGL pixel parity; no UI/native importer/MP4 acceptance.',originalRuntimeCompared:false,sourceBefore:await hashes(),startedAt:new Date().toISOString(),status:'failed'};
let server,browser;
try {
 const reservation=tcpServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});report.browser=await browser.version();
 const browserContext=await browser.newContext();const page=await browserContext.newPage();page.setDefaultTimeout(120000);const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 await page.route('**/bouncing-session-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Bouncing session verifier</title>'}));
 // Observe actual worker transfer detachment without changing its generation code.
 await browserContext.route('**/src/engine/generate.worker.ts*',async route=>{
  report.workerInstrumentedRequests=(report.workerInstrumentedRequests??0)+1;const response=await route.fetch(),body=await response.text();
  await route.fulfill({response,body:`const auditPost=self.postMessage.bind(self);self.postMessage=function(value,transfer){const arrays=Array.isArray(transfer)?transfer:transfer?.transfer??[];const before=arrays.map(v=>v.byteLength);auditPost(value,transfer);if(value?.output?.type==='raster')auditPost({__bouncingTransfer:{before,after:arrays.map(v=>v.byteLength),checkpoint:value.output.sourceBouncingFrame?.checkpoint}});};\n${body}`});
 });
 await page.goto(`http://127.0.0.1:${port}/bouncing-session-verifier`);
 report.result=await page.evaluate(async()=>{
  const [{generateScene,TemporalGenerationSession},{Generator},{createScene,serializeScene,parseScene},{definition},doc,clock,{generateSourceBouncingSeeds},{SourceBouncingGpu},{prepareSourceCamera}]=await Promise.all([
   import('/src/engine/temporal.ts'),import('/src/engine/client.ts'),import('/src/engine/document.ts'),import('/src/scenes/index.ts'),import('/src/engine/sourceBouncingDocument.ts'),import('/src/engine/sourceBouncingReplay.ts'),import('/src/engine/sourceBouncingSeeds.ts'),import('/src/engine/sourceBouncingGpu.ts'),import('/src/engine/sourceCamera.ts')]);
  const check=(condition,message)=>{if(!condition)throw Error(message);},unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const result={cases:[],failures:[],resourceScope:'Main-page GL create/delete handles and context identities only. Worker termination tracked; Worker GL handles are not instrumented.',workerTransfers:[]};
  const proto=WebGL2RenderingContext.prototype,originals=[],live=new Map();
  for(const kind of ['Texture','Framebuffer','Buffer','VertexArray','Program','Shader','Renderbuffer'])for(const operation of ['create','delete']){
   const name=operation+kind,original=proto[name];originals.push([name,original]);proto[name]=function(...args){let groups=live.get(this);if(!groups){groups=new Map();live.set(this,groups);}let objects=groups.get(kind);if(!objects){objects=new Set();groups.set(kind,objects);}const value=original.apply(this,args);if(operation==='create'&&value)objects.add(value);else if(operation==='delete')objects.delete(args[0]);return value;};
  }
  const outstanding=()=>[...live.values()].reduce((n,groups)=>n+[...groups.values()].reduce((n,s)=>n+s.size,0),0);
  const NativeWorker=window.Worker,workers=[];
  window.Worker=class extends NativeWorker {constructor(...args){super(...args);this.auditTerminated=false;workers.push(this);this.addEventListener('message',e=>{if(e.data?.__bouncingTransfer)result.workerTransfers.push(e.data.__bouncingTransfer);});}terminate(){this.auditTerminated=true;super.terminate();}};
  const owner=new TemporalGenerationSession(),generator=new Generator();
  let phase='fixture';
  try {
   const payload=unwrap(doc.importSourceBouncingDocument({settings:{particle_count:32,seed:'-9223372036854775808',sub_steps:2,time_step:.02,initial_speed:1.5,scale_x:80,scale_y:80,dot_size:3,record_duration:.1},palette:['#FF2040','#40C0FF'],camera:{phi:0,theta:0,gamma:.12}})).payload;
   const scene={...createScene(definition('bouncing')),id:'source-bouncing-session-fixture',bouncingSource:payload,settings:{},equations:{},parameters:{},timeline:{duration:10,fps:30,loop:false,tracks:[]}};
   const seed=clock.sourceBouncingSeedCheckpoint();
   const context=(checkpoint,width=240,height=180)=>({time:checkpoint.sceneTime,width,height,quality:'export',sourcePointPixelDensity:1,sourceBouncingFrame:checkpoint,sourceViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:180,target:'offscreen',projectionPass:'perspective'}});
   const at=n=>unwrap(clock.planSourceBouncingFixedReplay({updates:n,fps:30})).checkpoint;
   const direct=(s,ctx)=>{
    const p=unwrap(doc.prepareSourceBouncingScene(s)),seeds=unwrap(generateSourceBouncingSeeds(p.configuration)),gpu=new SourceBouncingGpu(seeds.state);
    try{for(let i=0;i<ctx.sourceBouncingFrame.simulationUpdates;i++)gpu.advance(seeds.update);const camera=unwrap(prepareSourceCamera(doc.sourceBouncingCameraInput(p),ctx.sourceViewport));check(camera.kind==='known','Known camera required');return gpu.render({width:ctx.width,height:ctx.height,cameraPlan:camera.plan,visualConfiguration:p.visual,initialSpeed:p.configuration.initialSpeed,boundary:seeds.update.boundary});}finally{gpu.dispose();}
   };
   const compare=async(name,s,ctx,mode='main')=>{
    phase=name;const transferCount=result.workerTransfers.length;const output=mode==='worker'?await generator.generate(s,ctx):generateScene(s,ctx,owner);
    check(output.type==='raster'&&output.backend==='webgl2'&&output.cameraResolved===true,name+': raster contract');
    check(output.pixels instanceof Uint8ClampedArray&&output.pixels.length===ctx.width*ctx.height*4,name+': pixel transport');
    check(JSON.stringify(output.sourceBouncingFrame.checkpoint)===JSON.stringify(ctx.sourceBouncingFrame),name+': checkpoint binding');
    check(JSON.stringify(output.sourceBouncingFrame.viewport)===JSON.stringify(ctx.sourceViewport),name+': viewport binding');
    check(output.sourceBouncingFrame.pixelDensity===ctx.sourcePointPixelDensity,name+': measured density binding');
    check(output.sourceBouncingFrame.camera.phi===s.bouncingSource.camera.phi&&output.sourceBouncingFrame.camera.gamma===s.bouncingSource.camera.gamma,name+': camera binding');
    if(mode==='worker'){const deadline=performance.now()+2000;while(result.workerTransfers.length===transferCount&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));check(result.workerTransfers.length>transferCount,name+': missing transfer observation');}
    const expected=direct(s,ctx);check(expected.pixels.length===output.pixels.length&&expected.pixels.every((v,i)=>v===output.pixels[i]),name+': direct owner pixel mismatch');
    let minimumAlpha=255,maximumAlpha=0;for(let i=3;i<output.pixels.length;i+=4){minimumAlpha=Math.min(minimumAlpha,output.pixels[i]);maximumAlpha=Math.max(maximumAlpha,output.pixels[i]);}
    const summary={name,mode,minimumAlpha,maximumAlpha,checkpoint:ctx.sourceBouncingFrame,size:[ctx.width,ctx.height],pixelDensity:output.sourceBouncingFrame.pixelDensity,logicalSize:[output.sourceBouncingFrame.viewport.logicalWidth,output.sourceBouncingFrame.viewport.logicalHeight],pixelSha256:await digest(output.pixels),...(mode==='main'?{session:owner.sourceBouncing.diagnostics()}:{})};result.cases.push(summary);return summary;
   };
   const initial=await compare('paused-seed',scene,context(seed));
   check(initial.minimumAlpha===255,'Opaque Processing target completion lost alpha');
   const translucent=structuredClone(scene);translucent.bouncingSource.visual.backgroundColor=0x80112233;
   const translucentImage=await compare('translucent-target-preserves-alpha',translucent,context(seed));check(translucentImage.minimumAlpha<255,'Target completion forced translucent background opaque');
   const first=unwrap(clock.stepSourceBouncingRealtime(seed,{deltaTime:0,paused:false}));check(first.sceneTime===0&&first.simulationUpdates===1,'First dt0 must integrate');
   const firstImage=await compare('first-realtime-dt-zero',scene,context(first));check(initial.pixelSha256!==firstImage.pixelSha256,'Fixture fails to visibly distinguish dt0 update');
   check(unwrap(clock.stepSourceBouncingRealtime(first,{deltaTime:9,paused:true})).simulationUpdates===1,'Paused clock moved');
   await compare('absolute-jump-12',scene,context(at(12)));
   await compare('reverse-seek-3',scene,context(at(3)));
   // Compare context identities BEFORE allocating the fresh direct GPU reference.
   const resize=context(at(3),300,200),contextsBeforeResize=live.size,renderedBefore=owner.sourceBouncing.diagnostics().gpu.rendered;
   generateScene(scene,resize,owner);check(live.size===contextsBeforeResize&&owner.sourceBouncing.diagnostics().gpu.rendered===renderedBefore+1,'Resize reseeded GPU');
   await compare('resize-preserves-particles',scene,resize);
   const dense={...resize,sourcePointPixelDensity:2,sourceViewport:{...resize.sourceViewport,logicalWidth:resize.width/2,logicalHeight:resize.height/2}};
   const densityContexts=live.size,densityPasses=owner.sourceBouncing.diagnostics().gpu.passes;
   generateScene(scene,dense,owner);check(live.size===densityContexts&&owner.sourceBouncing.diagnostics().gpu.passes===densityPasses,'Density change reseeded or advanced physics');
   await compare('density-two-preserves-particles',scene,dense);
   const edited=structuredClone(scene);edited.bouncingSource.visual.palette={kind:'colors',colors:['#40FF80']};edited.bouncingSource.visual.dotSize=4;edited.bouncingSource.camera.gamma=Math.fround(.4);
   const contextsBeforeVisual=live.size,passes=owner.sourceBouncing.diagnostics().gpu.passes;
   generateScene(edited,resize,owner);check(live.size===contextsBeforeVisual&&owner.sourceBouncing.diagnostics().gpu.passes===passes,'Visual edit reseeded/advanced');
   await compare('display-edit-preserves-particles',edited,resize);
   const initialized=structuredClone(edited);initialized.bouncingSource.configuration.seed='42';const contextsBeforeInit=live.size;
   generateScene(initialized,resize,owner);check(live.size===contextsBeforeInit+1,'Initialization edit did not rebuild');await compare('initialization-edit-rebuild',initialized,resize);
   const reopened=parseScene(serializeScene(initialized));check(JSON.stringify(reopened.bouncingSource)===JSON.stringify(initialized.bouncingSource),'Canonical payload save/reopen loss');
   await compare('save-parse-reopen',reopened,resize);
   const recording=unwrap(clock.planSourceBouncingRecording({from:at(7),fps:30,recordDuration:payload.recordDuration}));
   check(recording.start.simulationUpdates===7&&recording.start.sceneTime===0&&recording.warmup.simulationUpdates===8&&recording.frames[0].simulationUpdates===9,'Recording N+1/N+2 ordering');
   await compare('record-start-preserves-N',scene,context(recording.start));await compare('record-unencoded-warmup-N-plus-1',scene,context(recording.warmup));
   for(let i=0;i<recording.frames.length;i++)await compare('record-encoded-'+i,scene,context(recording.frames[i]));
   result.recording=recording;
   const expectFailure=(name,run)=>{phase=name;let failure;try{run();}catch(e){failure=e;}check(failure,name+': expected error');result.failures.push({name,nameOfError:failure.name,message:failure.message});return failure;};
   expectFailure('time-checkpoint-mismatch',()=>generateScene(scene,{...context(at(2)),time:1},owner));check(owner.sourceBouncing.diagnostics().retainedBytes===0,'Invalid request leaked state');
   expectFailure('unknown-projection',()=>generateScene(scene,{...context(seed),sourceViewport:{...context(seed).sourceViewport,projectionPass:'unknown'}},owner));
   await compare('recover-after-invalid-input',scene,context(at(2)));
   const cancelled=expectFailure('main-cancel-existing-session',()=>generateScene(scene,{...context(at(3)),isCancelled:()=>true},owner));check(cancelled.name==='AbortError','Main cancel lost AbortError');check(outstanding()===0,'Cancellation leaked GL');
   await compare('main-cancel-recovery',scene,context(at(2)));
   phase='cleanup-fault';const deleteFramebuffer=proto.deleteFramebuffer;let inject=true,cleanupError;
   proto.deleteFramebuffer=function(value){if(inject){inject=false;throw Error('Injected framebuffer deletion failure');}return deleteFramebuffer.call(this,value);};
   try{owner.reset();}catch(e){cleanupError=e;}finally{proto.deleteFramebuffer=deleteFramebuffer;}
   check(cleanupError?.cleanupPending&&owner.sourceBouncing.diagnostics().gpu?.handles>0,'Failed cleanup ownership not retained');
   cleanupError.retryCleanup();check(!cleanupError.cleanupPending&&outstanding()===0,'Cleanup retry failed');result.failures.push({name:'cleanup-fault-retains-owner-and-retries',nameOfError:cleanupError.name,message:cleanupError.message});
   await compare('cleanup-error-recovery',scene,context(at(1)));const handles=outstanding();cleanupError.retryCleanup();check(outstanding()===handles,'Retired cleanup error destroyed newer generation');
   owner.reset();check(outstanding()===0,'Main cleanup leaked');
   await compare('worker-seed',scene,context(seed),'worker');await compare('worker-dt-zero',scene,context(first),'worker');await compare('worker-jump',scene,context(at(12)),'worker');await compare('worker-reverse',scene,context(at(3)),'worker');
   await compare('worker-density-two',scene,dense,'worker');
   phase='worker-invalid';let workerFailure;try{await generator.generate(scene,{...context(at(3)),time:8});}catch(e){workerFailure=e;}check(workerFailure,'Worker invalid request accepted');result.failures.push({name:'worker-invalid-time',message:workerFailure.message});
   await compare('worker-error-recovery',scene,context(at(2)),'worker');
   phase='worker-cancel';const pending=generator.generate(scene,context(at(100))),rejected=pending.then(()=>null,e=>e);generator.cancel();const abort=await rejected;check(abort?.name==='AbortError','Worker cancel did not reject AbortError');result.failures.push({name:'worker-cancel',message:abort.message});
   await compare('worker-cancel-recreate',reopened,resize,'worker');
   // Allow the independent audit telemetry event immediately after output.
   await new Promise(resolve=>setTimeout(resolve,30));check(result.workerTransfers.length>=6,'Missing actual worker transfer observations: '+result.workerTransfers.length);
   check(result.workerTransfers.every(t=>t.before.some(n=>n>0)&&t.after.every(n=>n===0)),'Worker output transfer did not detach');
   generator.dispose();check(workers.every(w=>w.auditTerminated),'Generator retained a Worker after dispose');
   check(outstanding()===0,'Final main-page GL leak');result.mainPageContextsCreated=live.size;result.outstandingMainPageHandles=outstanding();result.workers={created:workers.length,terminated:workers.filter(w=>w.auditTerminated).length};return result;
  }catch(error){throw Error(phase+': '+error.message,{cause:error});}finally{generator.dispose();owner.reset();for(const[name,original]of originals)proto[name]=original;window.Worker=NativeWorker;}
 });
 report.pageErrors=pageErrors;if(pageErrors.length)throw Error('Browser page errors: '+pageErrors.join('\n'));report.status='passed';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();report.sourceUnchanged=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceUnchanged){report.status='failed';report.error=(report.error??'')+'\nProduction/script sources changed during verification';process.exitCode=1;}report.finishedAt=new Date().toISOString();await mkdir('.cache',{recursive:true});await writeFile('.cache/v2-source-bouncing-session.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.result?.cases.length,failures:report.result?.failures.length,sourceUnchanged:report.sourceUnchanged,error:report.error,report:'.cache/v2-source-bouncing-session.json'},null,2));}
