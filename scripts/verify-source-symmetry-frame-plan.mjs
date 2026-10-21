/** Real GPU / public generation checks of source update-vs-display scheduling.
 * The source queue semantics are derived from retained Scene/Mobject bytecode;
 * this does not execute the original native application window. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const sources=['src/engine/iteratedDensityGpu.ts','src/engine/sourceSymmetryFramePlan.ts','src/engine/sourceSymmetryGradient.ts','src/engine/sourceSymmetryTimeline.ts','src/engine/sourceSymmetryParameterRuntime.ts','src/engine/sourceSymmetryParameterIdentity.ts','src/engine/sourceRegistryParameterConfig.ts','src/engine/timeline.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-symmetry-frame-plan.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot()},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts');
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareIteratedFrame,IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts'),{prepareSourceSymmetryFramePlan}=await import('/src/engine/sourceSymmetryFramePlan.ts');
  const {ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])),mass=ink=>ink.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
  const make=(custom,timeline=[])=>{const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Frame cadence',settings:{batch_size:9,burn_in_steps:3,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ffffff'],...(custom?{equation:{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(.01,0.,0.);m=.01;}'}}:{}),timeline})).scene;s.settings.iterationsPerFrame=2;return parseScene(serializeScene(s));};
  const rows=[];
  for(const custom of [false,true]){
   const scene=make(custom),gpu=new IteratedDensityGpu(),row={storage:custom?'texture':'buffer',frames:[]};rows.push(row);let warm=false,previous,expected,previousMass;
   try{for(const [frame,updated]of [false,true,false,true,false].entries()){
    const job=prepareIteratedFrame(scene,frame/scene.timeline.fps,frame);job.symmetryFrame=prepareSourceSymmetryFramePlan({frameIndex:frame,updated},warm,job.config.burn,job.config.iterations);warm=job.symmetryFrame.warmupApplied;
    if(frame===0)expected=iteratedInitialChunk(job.config,0,job.config.count);
    const facts=gpu.step(job,{width:64,height:48,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},resetParticles:frame===0,clearInk:frame===0}),particles=gpu.readParticles(),inkMass=mass(gpu.readback());
    if(frame===0){assert(equal(particles.positionsAndMetric,expected),'Initial seed changed on display');assert(particles.validity.every(v=>v===1),'Initial seeds invalid');assert(particles.invalidCounts.every(v=>v===0),'Initial error counter dirty');assert(inkMass>0,'Initial seeds not drawn');}
    if(!updated&&previous){assert(equal(particles.positionsAndMetric,previous.positionsAndMetric),'Display advanced particles');assert(equal(particles.validity,previous.validity),'Display changed validity');assert(facts.steps===0&&facts.invalid===0,'Display counted math events');assert(inkMass>previousMass,'Display did not accumulate existing particles');}
    if(custom){for(let k=0;k<job.symmetryFrame.warmupSteps+job.symmetryFrame.iterationSteps;k++)for(let i=0;i<expected.length;i+=4){expected[i]=Math.fround(expected[i]+Math.fround(.01));expected[i+3]=Math.fround(.01);}assert(equal(particles.positionsAndMetric,expected),'Custom independent float recurrence differs');}
    assert(facts.steps===job.config.count*(job.symmetryFrame.warmupSteps+job.symmetryFrame.iterationSteps),'Work accounting');
    row.frames.push({frame,updated,steps:facts.steps,inkMass,plan:job.symmetryFrame});previous=particles;previousMass=inkMass;
   }
   // Reset an existing allocation: both metadata and positions must come from seeds.
   const reset=prepareIteratedFrame(scene,0,0);reset.symmetryFrame=prepareSourceSymmetryFramePlan({frameIndex:0,updated:false},false,reset.config.burn,reset.config.iterations);
   gpu.step(reset,{width:64,height:48,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},resetParticles:true,clearInk:true});const resetState=gpu.readParticles();assert(equal(resetState.positionsAndMetric,iteratedInitialChunk(reset.config,0,reset.config.count))&&resetState.invalidCounts.every(v=>v===0)&&resetState.validity.every(v=>v===1),'Reset failed');row.resetPassed=true;
   }finally{gpu.dispose();assert(gpu.diagnostics().retainedBytes===0,'GPU cleanup retained bytes');}
  }
  // Nonfinite results remain invalid on display; their old counters must not
  // be recounted as new mathematical failures, and reset must clear them.
  const invalidScene=make(true);invalidScene.equations.glsl='void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(1./(p.z-p.z));m=1.;}';
  const invalidGpu=new IteratedDensityGpu(),invalidRows=[];
  try{for(let frame=0;frame<3;frame++){
   const job=prepareIteratedFrame(invalidScene,frame/30,frame),updated=frame===0;job.symmetryFrame=prepareSourceSymmetryFramePlan({frameIndex:frame,updated},frame!==0,job.config.burn,job.config.iterations);
   const facts=invalidGpu.step(job,{width:32,height:24,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},resetParticles:frame!==1,clearInk:frame!==1}),particles=invalidGpu.readParticles();
   if(frame===0)assert(facts.invalid>0&&particles.validity.every(v=>v===0),'Nonfinite fixture did not become invalid');
   if(frame===1)assert(facts.invalid===0&&facts.sampleInvalid===job.config.count&&particles.validity.every(v=>v===0),'Frozen invalid sample counted as new math');
   if(frame===2)assert(facts.invalid===0&&particles.validity.every(v=>v===1)&&particles.invalidCounts.every(v=>v===0),'Reset retained failed metadata');
   invalidRows.push({frame,steps:facts.steps,invalid:facts.invalid,sampleInvalid:facts.sampleInvalid});
  }}finally{invalidGpu.dispose();assert(invalidGpu.diagnostics().retainedBytes===0,'Invalid state cleanup');}
  const publicRows=[];
  for(const custom of [false,true])for(const queue of ['empty','zero','short']){
   const scene=make(custom,queue==='empty'?[]:[{type:'wait',duration:queue==='zero'?0:.1}]),session=new IteratedDensitySession(),row={custom,queue,frames:[]};publicRows.push(row);
   const context=time=>({time,quality:'export',width:64,height:48,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48)});
   try{let last;
    for(const time of [0,.1,.2,.3]){const output=session.generate(scene,context(time));assert(output.type==='raster'&&output.backend==='webgl2','Public GPU output unavailable');assert(output.symmetryFrame,'Missing source frame facts');
     if(queue==='empty')assert(output.stats.samples===0&&!output.symmetryFrame.warmupApplied,'Empty queue performed math');
     if(time>=.2&&last){assert(output.stats.samples===last.stats.samples,'Finished queue kept iterating');assert(output.temporal.recordedPoints>last.temporal.recordedPoints,'Finished queue stopped display');}
     row.frames.push({time,steps:output.stats.samples,displayFrames:output.temporal.frames,recordedPoints:output.temporal.recordedPoints,plan:output.symmetryFrame});last=output;
    }
    const backward=session.generate(scene,context(0)),fresh=new IteratedDensitySession();try{const expected=fresh.generate(scene,context(0));assert(equal(backward.pixels,expected.pixels)&&backward.stats.samples===expected.stats.samples,'Backward reconstruction differs');}finally{fresh.reset();assert(fresh.diagnostics().retainedBytes===0,'Fresh session cleanup');}row.backwardPassed=true;
   }finally{session.reset();assert(session.diagnostics().retainedBytes===0,'Public session cleanup');}
  }
  return{environment:navigator.userAgent,rows,invalidRows,publicRows};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
