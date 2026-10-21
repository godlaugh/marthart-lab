/** Actual production Map replay through headless Chrome WebGL. Scheduling is
 * checked against native helper rules, positions against an independent F32
 * translation. No original JOGL execution or whole-window parity is claimed. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const sources=['src/engine/sourceIteratedReplaySession.ts','src/engine/sourceIterationFramePlan.ts','src/engine/iteratedDensityGpu.ts','src/engine/sourceMapMath.ts','src/engine/sourceMapConfig.ts','src/engine/sourceMapInitialSeed.ts','src/engine/iteratedSeed.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-map-replay-gpu.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async path=>[path,sha(await readFile(path))])));
const report={status:'running',nativeWindowExecuted:false,nativeHelperFixtureSha256:sha(await readFile('tests/fixtures/map/replay-runtime.json')),sourceBefore:await snapshot(),limits:['This executes local production WebGL, not original MathArt JOGL or a native window.','Zero-width 2D initial ranges make all initial particles exactly zero. This does not independently exercise native random seeding; the initialization fixture covers that boundary.','Exact trajectory checks use a bounded power-of-two translation. They do not prove arbitrary map formulas or final native image parity.']},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{SourceIteratedReplaySession}=await import('/src/engine/sourceIteratedReplaySession.ts');
  const check=(value,message)=>{if(!value)throw Error(message);},F=Math.fround,equal=(a,b)=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i])),gain=2**-16;
  const options={width:48,height:32,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2}},idle={updates:[],paused:true,parameterChanged:false,cameraChanged:false};
  // Explicit visible footprint: a native one-pixel disc at pixel boundaries
  // can have zero covered fragments. This probe checks replay, not coverage.
  const make=(burn,count=4,iterations=2)=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map replay GPU',equations:{x_next:'x+gain',y_next:'y',z_next:'0'},parameters:{gain},settings:{dot_size:4,dimension:2,batch_size:count,burn_in_steps:burn,iterations_per_frame:iterations,accumulation_decay:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0,scale_x:1,scale_y:1,scale_z:1},timeline:[]}),{sourceEntry:'runtime-config'}).scene;
  const advance=(state,stepGain,steps)=>{for(let k=0;k<steps;k++)for(let i=0;i<state.length;i+=4){const previous=state[i];state[i]=F(previous+F(stepGain));state[i+3]=F(Math.abs(F(state[i]-previous)));}};
  const read=(owner,expected,label)=>{const state=owner.readParticles();check(equal(state.positionsAndMetric,expected),`${label}: first actual=${Array.from(state.positionsAndMetric).slice(0,8)}, expected=${Array.from(expected).slice(0,8)}`);check(state.invalidCounts.every(value=>value===0)&&state.validity.every(value=>value===1),label+': valid source state');};
  const rows=[];
  for(const [burn,updating,fps,initialUpdating=updating]of [[0,false,60],[100,false,60],[1000,false,60],[100,true,60],[100,false,30],[100,true,60,false]]){
   const scene=make(burn),job=prepareIteratedFrame(scene,0,0),owner=new SourceIteratedReplaySession('map',fps),row={burn,updating,fps,initialUpdating,frames:[]};rows.push(row);let expected=new Float32Array(job.config.count*4),warmup=false;
   const normalUpdates=updating?[job.field,job.field]:[];
   try{
    check(job.field.kind==='map'&&job.field.mathModel==='mathart-1.7.8-gpu-v1'&&!!job.config.sourceInitialSeed,'Source Map producer not selected');
    owner.requestReplay();check(!owner.usesReplayDisplay,'Pending pre-initialization replay should not select replay');
    const initialCalls=initialUpdating?2:0,first=owner.display(job,options,{...idle,paused:!initialUpdating,updates:initialUpdating?[job.field,job.field]:[]});
    if(initialUpdating){advance(expected,gain,burn+initialCalls*job.config.iterations);warmup=true;}
    check(!first.replayed&&first.passes===1&&!owner.diagnostics().replayPending,'Initialization did not discard pending replay');read(owner,expected,'initial');
    owner.requestReplay();let remainingBurn=burn,remainingDraw=Math.max(64,Math.min(256,burn)),index=0,recorded=0,previousMass;
    const targetFrames=Math.max(1,Math.floor(F(F(.5)*F(Math.max(1,fps)))+.5)),burnBudget=Math.min(12,Math.max(8,Math.min(64,burn)));
    do{
     const ordinary=updating?(warmup?0:burn)+normalUpdates.length*job.config.iterations:0;
     // The normal updates still run, but the first replay display discards
     // that old trajectory by resetting to the constructor's all-zero seed.
     if(index===0)expected=new Float32Array(expected.length);else advance(expected,gain,ordinary);
     const b=Math.min(remainingBurn,burnBudget),count=Math.min(remainingDraw,8,index===0?(remainingDraw>=16?2:remainingDraw>0?1:0):Math.max(1,Math.ceil(remainingDraw/Math.max(1,targetFrames-index))));
     advance(expected,gain,b+count*job.config.iterations);
     const result=owner.display(job,options,{...idle,paused:!updating,updates:normalUpdates,parameterChanged:true,cameraChanged:true});
     remainingBurn-=b;remainingDraw-=count;if(count>0)index++;recorded+=count;warmup=remainingBurn===0&&remainingDraw===0;
     read(owner,expected,`replay burn=${burn}, frame=${row.frames.length}`);
     check(result.replayed&&result.passes===count&&result.accumulationPasses===recorded,'Replay draw budget/sample count');
     check(result.gpu.steps===job.config.count*(ordinary+b+count*job.config.iterations),'GPU did not execute ordered update plus replay work');
     check(result.remainingBurnInSteps===remainingBurn&&result.remainingReplaySteps===remainingDraw&&result.replayActive===!warmup,'Replay remaining state');
     const ink=owner.readback();check(ink.every(Number.isFinite),'Nonfinite accumulation');const mass=ink.reduce((sum,value,i)=>sum+(i%4===3?value:0),0);check(mass>0,'Replay failed to draw visible particles');if(count===0&&previousMass!==undefined)check(mass===previousMass,'Burn-only display changed ink');previousMass=mass;
     row.frames.push({passes:count,steps:result.gpu.steps,burnRemaining:remainingBurn,drawRemaining:remainingDraw,mass});check(row.frames.length<100,'Replay failed to terminate');
    }while(remainingBurn>0||remainingDraw>0);
    check(!owner.usesReplayDisplay&&owner.diagnostics().warmupApplied,'Completed replay remains active');
    const paused=owner.display(job,options,idle);read(owner,expected,'paused ordinary');check(paused.gpu.steps===0&&paused.accumulationPasses===recorded+1,'Paused ordinary display advanced or lost ink');
    check(!owner.display(job,options,{...idle,parameterChanged:true}).cleared,'Paused parameter edit cleared ink');
    check(owner.display(job,options,{...idle,cameraChanged:true}).cleared,'Paused camera event did not clear ink');
    check(owner.display(job,options,{...idle,paused:false,parameterChanged:true}).cleared,'Playing parameter event did not clear ink');
    owner.requestReplay();const restart=owner.display(job,options,idle),particles=owner.readParticles().positionsAndMetric,ink=owner.readback();owner.requestReplay();const repeat=owner.display(job,options,idle);
    check(restart.passes===2&&repeat.accumulationPasses===2&&equal(particles,owner.readParticles().positionsAndMetric)&&equal(ink,owner.readback()),'Repeated explicit replay did not restore same seed and ink');
   }finally{owner.reset();check(owner.diagnostics().gpu.retainedBytes===0,'Main replay owner leaked GPU storage');}
  }
  // Distinct call snapshots expose an accidental replacement of both updates
  // with the final field. The reference never consumes executor phases.
  const scene=make(3),job=prepareIteratedFrame(scene,0,0),firstGain=2**-15,firstField=prepareIteratedFrame({...scene,parameters:{...scene.parameters,gain:firstGain}},0,0,scene).field,orderedOwner=new SourceIteratedReplaySession('map',60),orderedRows=[];let ordered=new Float32Array(job.config.count*4);
  try{
   for(let frame=0;frame<3;frame++){
    if(frame===1){orderedOwner.requestReplay();ordered=new Float32Array(ordered.length);advance(ordered,gain,3+2*2);}
    else{advance(ordered,firstGain,3+2);advance(ordered,gain,2);if(frame===2)advance(ordered,gain,3*2);}
    const result=orderedOwner.display(job,options,{...idle,paused:false,updates:[firstField,job.field]});read(orderedOwner,ordered,'distinct ordered update frame '+frame);orderedRows.push({frame,steps:result.gpu.steps,phases:result.phases});
   }
  }finally{orderedOwner.reset();check(orderedOwner.diagnostics().gpu.retainedBytes===0,'Ordered owner leaked');}
  const resizeRows=[];
  for(const active of [false,true]){
   const owner=new SourceIteratedReplaySession('map',60),frame=prepareIteratedFrame(make(100),0,0);
   try{
    owner.display(frame,options,{...idle,paused:false,updates:[frame.field]});owner.requestReplay();if(active)owner.display(frame,options,idle);
    const before=owner.diagnostics(),particles=owner.readParticles().positionsAndMetric;check(owner.willReplayDisplay(48,32)&&!owner.willReplayDisplay(49,33),'Resize replay lookahead');
    const result=owner.display(frame,{...options,width:49,height:33},idle),after=owner.diagnostics();
    check(result.resized&&!result.replayed&&!result.replayActive&&result.accumulationPasses===1,'Resize did not cancel pending/active replay');
    check(equal(particles,owner.readParticles().positionsAndMetric),'Resize replaced or advanced particles');
    check(after.warmupApplied===before.warmupApplied&&after.remainingBurnInSteps===before.remainingBurnInSteps&&after.remainingReplaySteps===before.remainingReplaySteps,'Resize changed retained warmup/progress');
    const restored=owner.display(frame,options,idle);check(restored.resized&&restored.accumulationPasses===1&&equal(particles,owner.readParticles().positionsAndMetric),'Returning target lost retained particle state');
    resizeRows.push({active,before,after,restoredPasses:restored.accumulationPasses});
   }finally{owner.reset();check(owner.diagnostics().gpu.retainedBytes===0,'Resize owner leaked');}
  }
  const representativeOwner=new SourceIteratedReplaySession('map',60),largeJob=prepareIteratedFrame(make(100,4096),0,0),largeOptions={...options,width:320,height:240};let representative;
  try{const start=performance.now();representativeOwner.display(largeJob,largeOptions,idle);representativeOwner.requestReplay();let result,frames=0,steps=0;do{result=representativeOwner.display(largeJob,largeOptions,idle);frames++;steps+=result.gpu.steps;check(frames<100,'Representative replay did not end');}while(result.replayActive);const expected=new Float32Array(largeJob.config.count*4);advance(expected,gain,100+100*2);read(representativeOwner,expected,'representative final');check(result.accumulationPasses===100&&frames===30,'Representative budget');representative={particles:4096,width:320,height:240,frames,steps,passes:result.accumulationPasses,elapsedMs:performance.now()-start,gpu:representativeOwner.diagnostics().gpu};}finally{representativeOwner.reset();check(representativeOwner.diagnostics().gpu.retainedBytes===0,'Representative owner leaked');}
  return{rows,orderedRows,resizeRows,representative,environment:navigator.userAgent};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Sources changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(result=>result.status);if(report.cleanup.some(status=>status!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
