/** Native replay helpers/bytecode define scheduling; actual Chrome WebGL runs
 * the production executor. This is not an original JOGL/window comparison. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const sources=['src/engine/sourceIteratedReplaySession.ts','src/engine/sourceIterationFramePlan.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-symmetry-replay-gpu.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot()},start=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts'),{SourceIteratedReplaySession}=await import('/src/engine/sourceIteratedReplaySession.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},F=Math.fround,equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const options={width:48,height:32,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2}},idle={updates:[],paused:true,parameterChanged:false,cameraChanged:false};
  const make=(burn,count=4)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Replay GPU',settings:{batch_size:count,burn_in_steps:burn,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ffffff'],equation:{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(.00001,0.,0.);m=.00001;}'},timeline:[]})).scene;
  const rows=[];
  for(const [burn,updating,fps,initialUpdating=updating]of [[0,false,60],[100,false,60],[1000,false,60],[100,true,60],[100,false,30],[100,true,60,false]]){
   const scene=make(burn);scene.timeline.fps=24;scene.settings.iterationsPerFrame=2;const owner=new SourceIteratedReplaySession('symmetry',fps),job=prepareIteratedFrame(scene,0,0),seeds=iteratedInitialChunk(job.config,0,job.config.count),row={burn,updating,fps,initialUpdating,frames:[]};rows.push(row);let expected=new Float32Array(seeds),serial=0;
   const advance=n=>{for(let k=0;k<n;k++)for(let i=0;i<expected.length;i+=4){expected[i]=F(expected[i]+F(.00001));expected[i+3]=F(.00001);}};
   const display=event=>owner.display({...job,frame:serial++},options,event);
   try{
    owner.requestReplay();assert(!owner.usesReplayDisplay,'Pre-init replay should be cleared by initialization');
    const first=display({...idle,updates:initialUpdating?[job.field]:[],paused:!initialUpdating});if(initialUpdating)advance(burn+job.config.iterations);assert(!first.replayed&&first.passes===1,'Initialization incorrectly replayed');assert(equal(owner.readParticles().positionsAndMetric,expected),'Ordinary initial recurrence');
    owner.requestReplay();assert(owner.usesReplayDisplay,'Explicit edit did not request replay');
    let remainingBurn=burn,remainingDraw=Math.max(64,Math.min(256,burn)),index=0,recorded=0,previousMass;
    while(remainingBurn>0||remainingDraw>0){
     // Independent recurrence and schedule from native helper rules. The GPU
     // executor's emitted phases are not used to calculate expected positions.
     const b=Math.min(remainingBurn,Math.min(12,Math.max(8,Math.min(64,burn))));
     const count=Math.min(remainingDraw,8,index===0?(remainingDraw>=16?2:remainingDraw>0?1:0):Math.ceil(remainingDraw/Math.max(1,fps/2-index)));
     const ordinary=updating?(index===0&&initialUpdating?job.config.iterations:burn+job.config.iterations):0;
     if(index===0)expected=new Float32Array(seeds);else advance(ordinary);
     advance(b+count*job.config.iterations);
     const result=display({...idle,updates:updating?[job.field]:[],paused:!updating,parameterChanged:true,cameraChanged:true});
     assert(equal(owner.readParticles().positionsAndMetric,expected),`Trajectory mismatch burn=${burn}, update=${updating}, frame=${row.frames.length}, fps=${job.config.fps}, passes=${result.passes}/${count}, actual=${Array.from(owner.readParticles().positionsAndMetric).slice(0,4)}, expected=${Array.from(expected).slice(0,4)}`);
     remainingBurn-=b;remainingDraw-=count;if(count>0)index++;recorded+=count;
     assert(result.passes===count&&result.accumulationPasses===recorded,'Native display sample count');assert(result.gpu.steps===job.config.count*(ordinary+b+count*job.config.iterations),'Actual GPU work count');assert(result.replayActive===(remainingBurn>0||remainingDraw>0),'Replay completion');
     const ink=owner.readback(),mass=ink.reduce((s,v,i)=>s+(i%4===3?v:0),0);if(count===0&&previousMass!==undefined)assert(mass===previousMass,'Burn-only tail changed ink');previousMass=mass;
     row.frames.push({passes:count,steps:result.gpu.steps,burnRemaining:remainingBurn,drawRemaining:remainingDraw,mass});assert(row.frames.length<100,'Unbounded replay');
    }
    assert(owner.diagnostics().warmupApplied&&!owner.usesReplayDisplay,'Replay did not complete');
    const last=display(idle);assert(last.passes===1&&last.accumulationPasses===recorded+1&&last.gpu.steps===0,'Paused ordinary display after replay');assert(equal(owner.readParticles().positionsAndMetric,expected),'Paused display advanced particles');
    const pausedChange=display({...idle,parameterChanged:true});assert(!pausedChange.cleared&&pausedChange.accumulationPasses===recorded+2,'Paused parameter write cleared ink');
    const cameraChange=display({...idle,cameraChanged:true});assert(cameraChange.cleared&&cameraChange.accumulationPasses===1,'Paused camera change failed to clear ink');
    const playingChange=display({...idle,paused:false,parameterChanged:true});assert(playingChange.cleared&&playingChange.accumulationPasses===1,'Unpaused parameter write failed to clear ink');
    // Equal-value edits are still events, and interrupt a previous replay.
    owner.requestReplay();const restart=display(idle),restartParticles=owner.readParticles().positionsAndMetric,restartInk=owner.readback();assert(restart.cleared&&restart.accumulationPasses===2,'Restart did not clear and seed');
    owner.requestReplay();const repeat=display(idle);assert(repeat.accumulationPasses===2&&equal(owner.readParticles().positionsAndMetric,restartParticles)&&equal(owner.readback(),restartInk),'Repeated explicit edit ignored');
   }finally{owner.reset();assert(owner.diagnostics().gpu.retainedBytes===0,'Retained GPU storage after reset');}
  }
  // Two ordinary calls carry distinct parameter snapshots before the display
  // replay. Warmup belongs to the first call; replay uses the final snapshot.
  const ordered=make(3);ordered.equations.glsl='uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}';ordered.parameters.gain=.00002;ordered.settings.iterationsPerFrame=2;
  const orderedJob=prepareIteratedFrame(ordered,0,0),firstField=prepareIteratedFrame({...ordered,parameters:{...ordered.parameters,gain:.00001}},0,0,ordered).field,orderedOwner=new SourceIteratedReplaySession('symmetry',60),orderedRows=[];
  let expected=iteratedInitialChunk(orderedJob.config,0,orderedJob.config.count);
  const advanceOrdered=(gain,steps)=>{for(let k=0;k<steps;k++)for(let i=0;i<expected.length;i+=4){expected[i]=F(expected[i]+F(gain));expected[i+3]=F(gain);}};
  try{for(let frame=0;frame<3;frame++){
   if(frame===1)orderedOwner.requestReplay();
   if(frame===1)expected=iteratedInitialChunk(orderedJob.config,0,orderedJob.config.count);
   else{advanceOrdered(.00001,5);advanceOrdered(.00002,2);}
   if(frame===1)advanceOrdered(.00002,7); // burn 3 + first two draw passes
   if(frame===2)advanceOrdered(.00002,6); // ceil(62 / 29) draw passes
   const result=orderedOwner.display(orderedJob,options,{...idle,updates:[firstField,orderedJob.field],paused:false});
   assert(equal(orderedOwner.readParticles().positionsAndMetric,expected),'Ordered replay parameter recurrence frame '+frame);orderedRows.push({frame,phases:result.phases,steps:result.gpu.steps});
  }}finally{orderedOwner.reset();assert(orderedOwner.diagnostics().gpu.retainedBytes===0,'Ordered replay cleanup');}
  // Exercise the original built-in field's buffer storage as well as custom
  // GLSL texture storage. A repeated event must reproduce identical seed/ink.
  const builtin=make(3);delete builtin.equations.glsl;const builtinJob=prepareIteratedFrame(builtin,0,0),builtinOwner=new SourceIteratedReplaySession('symmetry',60);
  try{assert(builtinJob.field.kind==='symmetry','Built-in fixture not selected');builtinOwner.display(builtinJob,options,idle);builtinOwner.requestReplay();builtinOwner.display(builtinJob,options,idle);const particles=builtinOwner.readParticles().positionsAndMetric,ink=builtinOwner.readback();builtinOwner.requestReplay();builtinOwner.display(builtinJob,options,idle);assert(equal(particles,builtinOwner.readParticles().positionsAndMetric)&&equal(ink,builtinOwner.readback()),'Built-in seed/ink replay differs');}finally{builtinOwner.reset();}
  // Larger completed workload: native built-in field, 65,536 particles and a
  // 640×480 accumulation target. No per-frame particle/ink readback overhead.
  const large=make(100,65536);delete large.equations.glsl;const largeJob=prepareIteratedFrame(large,0,0),largeOwner=new SourceIteratedReplaySession('symmetry',60),largeOptions={...options,width:640,height:480};let representative;
  try{const started=performance.now();largeOwner.display(largeJob,largeOptions,{...idle,updates:[largeJob.field],paused:false});largeOwner.requestReplay();let result,frames=0,steps=0;do{result=largeOwner.display(largeJob,largeOptions,idle);frames++;steps+=result.gpu.steps;assert(frames<100,'Large replay did not complete');}while(result.replayActive);const ink=largeOwner.readback();assert(ink.every(Number.isFinite),'Large replay produced invalid ink');representative={particles:largeJob.config.count,width:640,height:480,frames,steps,passes:result.accumulationPasses,elapsedMs:performance.now()-started,gpu:largeOwner.diagnostics().gpu};assert(frames===30&&result.accumulationPasses===100,'Large replay schedule');}finally{largeOwner.reset();assert(largeOwner.diagnostics().gpu.retainedBytes===0,'Large replay cleanup');}
  // Failure after mutation cannot be silently resumed. Reset is explicit.
  const scene=make(0),job=prepareIteratedFrame(scene,0,0),failed=new SourceIteratedReplaySession('symmetry',60);let calls=0;
  try{let thrown=false;try{failed.display(job,{...options,isCancelled:()=>++calls>6},idle);}catch{thrown=true;}assert(thrown&&failed.diagnostics().failed,'Cancellation did not fail closed');let rejected=false;try{failed.display(job,options,idle);}catch{rejected=true;}assert(rejected,'Failed generation resumed implicitly');failed.reset();assert(failed.display(job,options,idle).passes===1,'Explicit reset did not recover');}finally{failed.reset();}
  return{rows,orderedRows,representative,cancellationPassed:true,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Sources changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-start;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
