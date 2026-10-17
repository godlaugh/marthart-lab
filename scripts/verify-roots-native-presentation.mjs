import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as netServer} from 'node:net';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2];if(!output)throw Error('Pass a new report path');
const sha=v=>createHash('sha256').update(v).digest('hex');
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const paths=[...await files('src'),'scripts/verify-roots-native-presentation.mjs'].sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',at:new Date().toISOString(),sourceBefore:await hashes(),pageErrors:[]};let server,browser,page;
const port=await new Promise((resolve,reject)=>{const socket=netServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(e=>e?reject(e):resolve(p));});});
try{
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();report.endpoint=server.resolvedUrls.local[0];
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/roots-native-presentation-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Roots native worker presentation</title>'}));await page.goto(report.endpoint+'roots-native-presentation-check');
 report.result=await page.evaluate(async()=>{
  const {Generator}=await import('/src/engine/client.ts'),{createScene,parseScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {createRootsNativeMath}=await import('/src/engine/rootsMathConfig.ts'),{defaultRootsPresentationConfiguration}=await import('/src/engine/rootsPresentationConfig.ts');
  const {RootsNativeDensityDisplay}=await import('/src/engine/rootsNativeDisplay.ts'),{prepareRootsProjection}=await import('/src/engine/rootsProjection.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
  const {RootsNativePointCloudGpu}=await import('/src/engine/rootsNativePointCloudGpu.ts'),{RootsPointCloudRing}=await import('/src/engine/rootsPointCloudRing.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts');
  const result=globalThis.__rootsPresentation={rows:[],checks:[],independentPoints:[],cleanup:[],workers:{created:0,terminated:0},browser:navigator.userAgent};
  const check=(v,id)=>{if(!v)throw Error(id);result.checks.push(id);};
  const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const exact=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
  const NativeWorker=globalThis.Worker;globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);result.workers.created++;let closed=false;const close=this.terminate.bind(this);this.terminate=()=>{if(!closed){closed=true;result.workers.terminated++;}close();};}};
  const generators=[],g=()=>{const owner=new Generator();generators.push(owner);return owner;};
  const c={time:0,width:97,height:73,quality:'export',rootsViewport:{logicalWidth:97,logicalHeight:73,referenceLogicalHeight:73,target:'primary'}};
  function scene(){
   const s=createScene(definition('roots'));s.id='native-presentation-fixed-linear';s.rootsMath=createRootsNativeMath();
   s.rootsMath.polynomial={variable:'z',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
   s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.05,.08]}];
   s.rootsMath.sampling={sampleCount:9,batchSize:2,workerCount:2,seed:'0',filter:''};s.rootsPresentation=defaultRootsPresentationConfiguration();s.rootsPresentation.camera.phi=0;s.rootsPresentation.dotSize=.1;
   s.rootsSourcePalette={colors:['#FF7020','#20EFFF']};Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:3,rootSamplingFps:10,rootStartTime:0,rootColor:'t2_real',rootSourceGamma:1,background:'#00000000'});
   return parseScene(JSON.stringify(s));
  }
  async function request(owner,s,context,label){
   const statuses=[],start=performance.now(),o=await owner.generate(s,context,undefined,v=>statuses.push(v));const elapsedMs=performance.now()-start;
   check(o.type==='raster'&&o.backend==='webgl2'&&o.pixels.length===context.width*context.height*4,label+' complete WebGL raster');
   check(o.rootsPresentation?.presentationAlpha==='opaque-framebuffer-rgb',label+' explicit alpha carrier');
   const row={label,elapsedMs,sha256:await hash(o.pixels),facts:o.rootsPresentation,roots:o.roots,rootsColor:o.rootsColor,stats:o.stats,statuses,warnings:o.warnings};result.rows.push(row);return{o,row};
  }
  // Independent point mathematics: the one root of z - t2 is t2. Retained
  // appendRoots converts root XY and imag(t2) to float, and reads current metric.
  function knownPoints(n,metric=.05,z=.08){const a=new Float32Array(n*4);for(let i=0;i<n;i++)a.set([.05,.08,z,metric],i*4);return a;}
  function plan(s,context=c){return prepareRootsProjection(s.rootsPresentation,{width:context.width,height:context.height,viewport:context.rootsViewport});}
  function densityExpected(s,n,metric=.05){const display=new RootsNativeDensityDisplay();try{return display.render(plan(s),knownPoints(n,metric),prepareRootsDensityColor(s)).pixels;}finally{display.dispose();check(!display.diagnostics().gpu,'density oracle owner released');}}
  function cloudExpected(s,n,z=.08){const ring=new RootsPointCloudRing({capacityPoints:Math.max(n,1),recentWindowPoints:Math.max(n,1)}),gpu=new RootsNativePointCloudGpu();try{ring.append(knownPoints(n,.05,z));const color=prepareRootsDensityColor(s);gpu.initialize(c.width,c.height);gpu.clear(color.backgroundPacked);gpu.draw(plan(s),color,ring);return gpu.readback();}finally{gpu.dispose();ring.dispose();check(gpu.diagnostics().handles===0,'cloud oracle owner released');}}
  try{
   const s=scene(),owner=g(),cold=await request(owner,s,c,'density-cold');
   check(cold.o.roots.attemptedSamples===3&&cold.o.rootsPresentation.newRawPoints===3&&cold.o.rootsPresentation.density.submittedFinitePointCount===3,'three independently known roots');
   check(exact(cold.o.pixels,densityExpected(s,3)),'worker image consumes independent linear roots and metric');result.independentPoints.push({formula:'z-t2',root:[.05,.08],raw:[Math.fround(.05),Math.fround(.08),Math.fround(.08),Math.fround(.05)],count:3});
   const repeat=await request(owner,s,c,'density-warm-repeat');check(repeat.row.sha256===cold.row.sha256&&repeat.o.rootsPresentation.newSamples===0,'same frame no arrivals identical image');
   s.settings.rootSourceBrightness=.2;const tone=await request(owner,s,c,'density-tone');check(tone.o.rootsPresentation.newRawPoints===0&&tone.o.roots.solverWork===cold.o.roots.solverWork&&tone.row.sha256!==cold.row.sha256,'tone reuses old ink');
   s.rootsPresentation.camera.theta=.31;const angle=await request(owner,s,c,'density-angle');check(angle.o.rootsPresentation.newSamples===0&&!angle.o.rootsPresentation.density.capture&&!angle.o.rootsPresentation.density.clearInk&&angle.row.sha256!==tone.row.sha256,'angle rotates existing ink');
   s.rootsPresentation.dotSize=.03;const dot=await request(owner,s,c,'density-dot');check(dot.row.sha256===angle.row.sha256&&dot.o.rootsPresentation.newSamples===0,'dot affects future points only');
   s.rootsPresentation.transform.offset=[3,0,0];const clear=await request(owner,s,c,'density-transform');check(clear.o.rootsPresentation.density.clearInk&&clear.o.rootsPresentation.density.submittedFinitePointCount===0&&clear.o.rootsPresentation.newSamples===0,'transform clears without replay');
   const next=await request(owner,s,{...c,time:.1},'density-next-arrivals');check(next.o.rootsPresentation.totalRawPoints===6&&next.o.rootsPresentation.newRawPoints===3&&next.o.rootsPresentation.density.submittedFinitePointCount===3,'new arrivals continue ordinal');
   const resized={...c,time:.1,width:113,height:79,rootsViewport:{logicalWidth:113,logicalHeight:79,referenceLogicalHeight:73,target:'offscreen'}};
   const size=await request(owner,s,resized,'density-size');check(size.o.rootsPresentation.density.clearInk&&!size.o.rootsPresentation.density.capture&&size.o.rootsPresentation.density.submittedFinitePointCount===0&&size.o.rootsPresentation.density.matrixReferenceViewport.physicalWidth===97,'size clears but retains original matrix');
   s.settings.rootColor='t2_imag';const metric=await request(owner,s,resized,'density-metric-same-frame');check(metric.o.rootsPresentation.newSamples===0&&metric.o.rootsPresentation.instance===1,'hot metric retains instance');
   const more=await request(owner,s,{...resized,time:.2},'density-new-metric-arrivals');check(more.o.rootsPresentation.newSamples===3&&more.o.rootsPresentation.density.submittedFinitePointCount===3&&more.o.rootsColor.metric==='t2_imag','future arrivals use changed metric');
   const back=await request(owner,s,{...resized,time:0},'density-backward');check(back.o.rootsPresentation.restartReason==='backward-seek'&&back.o.rootsPresentation.newSamples===3,'backseek explicit replay instance');
   const saved=parseScene(JSON.stringify(s)),coldSaved=g(),savedOut=await request(coldSaved,saved,{...resized,time:0},'density-save-cold');check(savedOut.row.sha256===back.row.sha256,'saved cold replay matches new instance');coldSaved.dispose();owner.dispose();
   // Metric mutation preserves the older metric within already accumulated ink.
   const mixed=scene(),mixedG=g();await request(mixedG,mixed,c,'metric-mixed-start');mixed.settings.rootColor='t2_imag';const mixedOut=await request(mixedG,mixed,{...c,time:.1},'metric-mixed-complete');
   const display=new RootsNativeDensityDisplay();try{const expected=display.renderBatches(plan(mixed),[knownPoints(3,.05),knownPoints(3,.08)],prepareRootsDensityColor(mixed));check(exact(mixedOut.o.pixels,expected.pixels),'existing metric stays immutable while future metric changes');}finally{display.dispose();}mixedG.dispose();
   const cloudScene=scene(),cloudG=g();await request(cloudG,cloudScene,c,'mode-density-start');cloudScene.rootsPresentation.mode='point-cloud';cloudScene.rootsPresentation.camera.phi=.55;
   const cloud=await request(cloudG,cloudScene,c,'mode-cloud-reset');check(cloud.o.rootsPresentation.restartReason==='mode'&&cloud.o.rootsPresentation.pointCloud.totalWrites==='3','mode switch starts new ring');
   const expectedCloud=cloudExpected(cloudScene,3),withoutZ=cloudExpected(cloudScene,3,0);check(exact(cloud.o.pixels,expectedCloud),'cloud consumes independent raw Z and metric');check(!exact(expectedCloud,withoutZ),'raw t2 imaginary Z changes actual cloud projection');
   const alphas=cloud.o.pixels.filter((_,i)=>i%4===3);check(alphas.some(v=>v<255)&&cloud.o.pixels.some((v,i)=>i%4!==3&&v>0),'cloud target retains alpha and visible RGB');
   cloudScene.rootsPresentation.transform.offset=[2,1,0];cloudScene.rootsPresentation.accumulation.enabled=true;const cloudWarm=await request(cloudG,cloudScene,c,'cloud-transform-wrapper');check(cloudWarm.o.rootsPresentation.newSamples===0&&cloudWarm.o.rootsPresentation.pointCloud.totalWrites==='3','cloud transform retains raw ring');
   cloudG.dispose();
   // 65,539 roots cross the session's 65,536 tuple borrow boundary. The direct
   // presentation comparison uses independently known roots, not a second solver.
   const large=scene();large.rootsMath.sampling.sampleCount=65539;large.settings.rootSamplesPerFrame=65539;const largeG=g();
   const largeOut=await request(largeG,large,c,'large-bounded-65539');check(largeOut.o.rootsPresentation.newRawPoints===65539&&largeOut.o.roots.complete&&largeOut.o.rootsPresentation.density.submittedFinitePointCount===65539,'large complete chunked stream');
   check(exact(largeOut.o.pixels,densityExpected(large,65539)),'chunked worker matches independent complete point stream');largeG.dispose();
   const recoveryG=g(),recoverScene=scene();let capacity;
   try{await recoveryG.generate(recoverScene,{...c,width:16384,height:2048});}catch(e){capacity=e.message;}
   check(capacity?.includes('768 MiB'),'capacity error is explicit before complete image allocation');const recovered=await request(recoveryG,recoverScene,c,'capacity-recovery');check(recovered.o.rootsPresentation.newSamples===3,'capacity recovery starts clean');
   const cancelled=recoveryG.generate(large,c).then(()=>({completed:true}),e=>({error:e.name}));recoveryG.cancel();check((await cancelled).error==='AbortError','Generator cancellation terminates owned worker');
   await request(recoveryG,recoverScene,c,'cancel-recovery');recoveryG.dispose();
   // Actual GenerationQueue retains the same worker across save ID changes.
   const queueG=g(),published=[],queueErrors=[],queueScene=scene();let resolveOutput;
   const queue=new GenerationQueue(queueG,{output:(o,t,s)=>{published.push({o,t,s});resolveOutput?.();},error:e=>queueErrors.push(e.message),busy:()=>{}});
   const wait=()=>new Promise((resolve,reject)=>{const id=setTimeout(()=>reject(Error('queue timeout')),15000);resolveOutput=()=>{clearTimeout(id);resolve();};});
   try{let ready=wait();queue.request(queueScene,{...c,rootsSessionId:'live-document'});await ready;const workers=result.workers.created;
    const savedQueue=structuredClone(queueScene);savedQueue.id+='-saved';savedQueue.settings.rootSourceBrightness=.3;ready=wait();queue.request(savedQueue,{...c,rootsSessionId:'live-document'});await ready;
    check(result.workers.created===workers&&published.at(-1).o.rootsPresentation.newSamples===0&&published.at(-1).o.rootsPresentation.instance===1,'save runtime token preserves actual worker and ink');
    ready=wait();queue.request(savedQueue,{...c,rootsSessionId:'reopened-document'});await ready;check(result.workers.created===workers+1&&published.at(-1).o.rootsPresentation.newSamples===3,'new load token creates new actual worker');check(!queueErrors.length,'queue completed without errors');
   }finally{queue.dispose();}
   return result;
  }finally{for(const owner of generators)owner.dispose();globalThis.Worker=NativeWorker;result.cleanup.push({allWorkersTerminated:result.workers.created===result.workers.terminated});if(result.workers.created!==result.workers.terminated)throw Error('Owned Worker cleanup failed');}
 });
 if(report.pageErrors.length)throw Error('Unexpected page error');report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};report.partial=await page?.evaluate(()=>globalThis.__rootsPresentation).catch(()=>undefined);process.exitCode=1;}
finally{
 const close=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,viteClosed:server?!server.httpServer?.listening:true,errors:close.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.cleanup.errors.length){report.status='failed';process.exitCode=1;}
 report.limitations=['Actual Generator/Worker/Queue executes the shared native solver and presentation. Original application/JVM and native thread timing were not executed.','Independent z-t2 roots, raw Z and metric fixtures test mathematical arrival plumbing; expected pixels reuse the separately verified presentation owners. This is not an independent shader/image proof.','Cold replay reconstructs document inputs, not paused original live ink or edit history. Same-time wrapper requests are draw/fade events under local caller scheduling.','Output preserves actual framebuffer alpha; host opacity and real App PNG/video workflows are separately verified.','65,539 complete arrivals test bounded batching. The original 47.55M throughput and 10M live session history are not measured here; 3M standalone GPU window is separate evidence.','Elapsed milliseconds describe completed requests, without before/after speed claims. Process-family CPU/RSS requires external supervisor; driver VRAM and agent tokens are unmeasured.'];
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,rows:report.result?.rows.length,checks:report.result?.checks.length,error:report.error?.message,cleanup:report.cleanup}));
}
