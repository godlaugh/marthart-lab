/** Retained original ensureAccumulationBuffers bytecode defines lifecycle;
 * actual Chrome WebGL exercises the production resize and replay owners. This is not an original JOGL/window comparison. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const sources=['src/engine/sourceIteratedReplaySession.ts','src/engine/sourceIterationFramePlan.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-symmetry-resize.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot()},start=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts');
  const {SourceIteratedReplaySession}=await import('/src/engine/sourceIteratedReplaySession.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const {prepareSourceIterationFramePlan}=await import('/src/engine/sourceIterationFramePlan.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const particlesEqual=(a,b)=>equal(a.positionsAndMetric,b.positionsAndMetric)&&equal(a.validity,b.validity)&&equal(a.invalidCounts,b.invalidCounts);
  const options={width:48,height:32,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2}},idle={updates:[],paused:true,parameterChanged:false,cameraChanged:false};
  const make=(custom,burn=100)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Resize lifecycle',settings:{batch_size:4,burn_in_steps:burn,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ffffff'],...(custom?{equation:{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(.00001,0.,0.);m=.00001;}'}}:{}),timeline:[]})).scene;
  const rows=[];
  for(const custom of [false,true])for(const mode of ['ordinary','pending','active','burn-tail']){
   const scene=make(custom,mode==='burn-tail'?1000:100),job=prepareIteratedFrame(scene,0,0),owner=new SourceIteratedReplaySession('symmetry',60);
   try{
    owner.display(job,options,{...idle,updates:[job.field],paused:false});
    if(mode!=='ordinary')owner.requestReplay();
    if(mode==='active'||mode==='burn-tail'){
     do{owner.display(job,options,idle);}while(mode==='burn-tail'&&owner.diagnostics().remainingReplaySteps>0);
    }
    const before=owner.diagnostics(),particles=owner.readParticles();
    assert(owner.willReplayDisplay(48,32)===(mode!=='ordinary'),'Same target replay prediction');assert(!owner.willReplayDisplay(63,37),'Resize must cancel display replay');
    const result=owner.display(job,{...options,width:63,height:37},idle),after=owner.diagnostics();
    assert(result.resized&&result.cleared&&!result.replayed&&!result.replayActive&&result.accumulationPasses===1&&result.gpu.steps===0,'Resize lifecycle');
    assert(particlesEqual(owner.readParticles(),particles),'Resize lost particle/metadata state');assert(owner.readback().length===63*37*4,'New target dimensions');
    assert(result.warmupApplied===before.warmupApplied&&after.remainingBurnInSteps===before.remainingBurnInSteps&&after.remainingReplaySteps===before.remainingReplaySteps,'Resize reset preserved runtime counters');
    const next=owner.display(job,{...options,width:63,height:37},idle);assert(!next.resized&&!next.cleared&&next.accumulationPasses===2,'Same target did not accumulate');
    assert(particlesEqual(owner.readParticles(),particles),'Second paused display advanced particles');
    owner.requestReplay();assert(owner.willReplayDisplay(63,37),'New edit after resize ignored');const restarted=owner.display(job,{...options,width:63,height:37},idle);assert(restarted.replayed&&!restarted.resized&&restarted.accumulationPasses===2,'New edit failed to replay');
    rows.push({custom,mode,before:{warmup:before.warmupApplied,burn:before.remainingBurnInSteps,draw:before.remainingReplaySteps},resized:result,retainedBytes:after.gpu.retainedBytes});
   }finally{owner.reset();assert(owner.diagnostics().gpu.retainedBytes===0,'Resize owner cleanup');}
  }
  // An active replay leaves warmup false. Ordinary updates happen before the
  // native resize cancels replay: full warmup + both calls, with no seed reset.
  const scene=make(true,3);scene.settings.iterationsPerFrame=2;const job=prepareIteratedFrame(scene,0,0),owner=new SourceIteratedReplaySession('symmetry',60);
  try{
   owner.display(job,options,{...idle,updates:[job.field],paused:false});owner.requestReplay();owner.display(job,options,idle);
   const expected=owner.readParticles().positionsAndMetric;for(let k=0;k<7;k++)for(let i=0;i<expected.length;i+=4){expected[i]=Math.fround(expected[i]+Math.fround(.00001));expected[i+3]=Math.fround(.00001);}
   const result=owner.display(job,{...options,width:63,height:37},{...idle,updates:[job.field,job.field],paused:false});
   assert(result.gpu.steps===28&&result.warmupApplied&&!result.replayed&&equal(owner.readParticles().positionsAndMetric,expected),'Unpaused resize changed update order or seed');
  }finally{owner.reset();}
  const prepare=()=>{const job=prepareIteratedFrame(make(true,3),0,0);job.iterationFrame=prepareSourceIterationFramePlan('symmetry',{frameIndex:0,updateCount:1},false,3,job.config.iterations);const gpu=new IteratedDensityGpu();gpu.step(job,{...options,resetParticles:true,clearInk:true});return{gpu,job};};
  // A no-op must preserve existing ink and frame sequence; invalid admission
  // must preserve a valid allocation. No GPU state is reconstructed here.
  const direct=prepare();try{
   const before=direct.gpu.readParticles(),ink=direct.gpu.readback(),diag=direct.gpu.diagnostics();assert(!direct.gpu.resizeAccumulation(48,32),'Same dimensions allocated');assert(equal(direct.gpu.readback(),ink),'No-op cleared ink');
   for(const [w,h]of [[0,32],[1.5,32],[16384,16384]]){let threw=false;try{direct.gpu.resizeAccumulation(w,h);}catch{threw=true;}assert(threw&&particlesEqual(direct.gpu.readParticles(),before),'Invalid size destroyed particles');}
   assert(direct.gpu.resizeAccumulation(63,37),'Target not resized');assert(direct.gpu.readback().every(v=>v===0),'New target not cleared');assert(particlesEqual(direct.gpu.readParticles(),before),'Attachment replacement changed particle bytes');assert(direct.gpu.diagnostics().frame===diag.frame,'Attachment replacement consumed a frame');
   const bytes=direct.gpu.diagnostics().retainedBytes;for(let i=0;i<8;i++){direct.gpu.resizeAccumulation(48,32);direct.gpu.resizeAccumulation(63,37);assert(direct.gpu.diagnostics().retainedBytes===bytes&&particlesEqual(direct.gpu.readParticles(),before),'Repeated resize retained storage or changed particles');}
  }finally{direct.gpu.dispose();}
  const canceled=prepare();let cancellationChecks=0,cancellation;
  try{try{canceled.gpu.resizeAccumulation(63,37,()=>++cancellationChecks>1);}catch(error){cancellation=error.name;}assert(cancellation==='AbortError'&&canceled.gpu.diagnostics().retainedBytes===0,'Mid-resize cancellation did not release mutated state');}finally{canceled.gpu.dispose();}
  // Inject allocation plus cleanup failure into real WebGL calls. Ownership
  // must retain the new texture alongside the old resources for reset retry.
  const fault=prepare(),prototype=WebGL2RenderingContext.prototype,texImage=prototype.texImage2D,remove=prototype.deleteTexture;
  let allocationFails=true,deletionFails=true,caught;
  prototype.texImage2D=function(...args){if(allocationFails)throw Error('injected allocation');return texImage.apply(this,args);};
  prototype.deleteTexture=function(...args){if(deletionFails)throw Error('injected deletion');return remove.apply(this,args);};
  try{
   try{fault.gpu.resizeAccumulation(63,37);}catch(error){caught=String(error);}
   assert(caught&&fault.gpu.diagnostics().cleanupPending&&fault.gpu.diagnostics().pendingAllocationBytes===63*37*16,'Failed resize lost allocation ownership');
   let blocked=false;try{fault.gpu.resizeAccumulation(48,32);}catch{blocked=true;}assert(blocked,'Cleanup failure allowed reuse');
   allocationFails=false;deletionFails=false;fault.gpu.reset();assert(fault.gpu.diagnostics().retainedBytes===0&&!fault.gpu.diagnostics().cleanupPending,'Cleanup retry leaked storage');
  }finally{prototype.texImage2D=texImage;prototype.deleteTexture=remove;fault.gpu.dispose();}
  return{rows,unpausedResizePassed:true,noOpAndAdmissionPassed:true,repeatedResizePassed:true,cancellationPassed:true,allocationCleanupRetryPassed:true,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Sources changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-start;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
