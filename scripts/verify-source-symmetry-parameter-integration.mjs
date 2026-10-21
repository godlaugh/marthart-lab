/** Actual WebGL parameter uniforms and public generation; no original window. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const snapshot=async()=>{const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.parentPath+'/'+x.name);files.push('scripts/verify-source-symmetry-parameter-integration.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));};
const report={status:'running',nativeWindowExecuted:false,sourceBefore:await snapshot()},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts');
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareIteratedFrame,IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts'),{prepareSourceSymmetryFramePlan}=await import('/src/engine/sourceSymmetryFramePlan.ts');
  const {ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');
  const {sourceSymmetryUpdateEvent,sourceSymmetryParameterFrame,clearSourceSymmetryTimelineCache}=await import('/src/engine/sourceSymmetryTimeline.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const make=(custom,name='lambda',step=.003)=>{
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Parameter GPU',parameters:{lambda:.25,gain:.25},settings:{batch_size:9,burn_in_steps:2,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ffffff'],...(custom?{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}:{}),timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{[name]:{min:-1,max:1,step,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:.1}]})).scene;
   s.timeline.fps=60;s.settings.iterationsPerFrame=2;return parseScene(serializeScene(s));
  };
  const scene=make(true,'gain'),gpu=new IteratedDensityGpu(),uniformFrames=[];let warm=false,expected;
  try{for(let frame=0;frame<12;frame++){
   const snapshot=sceneAtTime(scene,frame/60),job=prepareIteratedFrame(snapshot,frame/60,frame,scene),event=sourceSymmetryUpdateEvent(snapshot);
   job.symmetryFrame=prepareSourceSymmetryFramePlan(event,warm,job.config.burn,job.config.iterations);warm=job.symmetryFrame.warmupApplied;
   if(!expected)expected=iteratedInitialChunk(job.config,0,job.config.count);
   const gain=Math.fround(snapshot.parameters.gain);
   for(let k=0;k<job.symmetryFrame.warmupSteps+job.symmetryFrame.iterationSteps;k++)for(let i=0;i<expected.length;i+=4){expected[i]=Math.fround(expected[i]+gain);expected[i+3]=gain;}
   const facts=gpu.step(job,{width:64,height:48,projection:'xy',padding:0,bounds:{minX:-2,maxX:8,minY:-2,maxY:2},resetParticles:frame===0,clearInk:frame===0||sourceSymmetryParameterFrame(snapshot).changed});
   assert(equal(gpu.readParticles().positionsAndMetric,expected),'Uniform recurrence mismatch frame '+frame);
   uniformFrames.push({frame,gain,updated:event.updated,steps:facts.steps});
  }}finally{gpu.dispose();assert(gpu.diagnostics().retainedBytes===0,'Uniform GPU cleanup');}
  assert(new Set(uniformFrames.map(x=>x.gain)).size>2,'Parameter never animated');assert(uniformFrames.at(-1).steps===0,'Finished queue advanced GPU');
  const rows=[];
  for(const [custom,name,step]of[[false,'lambda',8e-10],[false,'unused.name',.003],[true,'gain',.003]]){
   clearSourceSymmetryTimelineCache();const scene=make(custom,name,step),session=new IteratedDensitySession(),row={custom,name,step,frames:[]};rows.push(row);let expectedClears=0;
   const context=time=>({time,quality:'export',width:64,height:48,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48)});
   try{for(let frame=0;frame<12;frame++){
    const snapshot=sceneAtTime(scene,frame/60),parameter=sourceSymmetryParameterFrame(snapshot);if(frame===0||parameter.changed)expectedClears++;
    const output=session.generate(scene,context(frame/60)),diag=session.diagnostics();assert(output.type==='raster'&&output.backend==='webgl2','Source GPU unavailable');assert(diag.clears===expectedClears,'Public accumulation clear mismatch '+name+' frame '+frame);assert(diag.replays===1,'Parameter restarted particle seed');
    row.frames.push({frame,value:snapshot.parameters[name],changed:parameter.changed,clears:diag.clears,steps:output.stats.samples});
   }
   const backward=session.generate(scene,context(2/60)),fresh=new IteratedDensitySession();try{const expected=fresh.generate(parseScene(serializeScene(scene)),context(2/60));assert(equal(backward.pixels,expected.pixels)&&equal(session.snapshotInk(),fresh.snapshotInk()),'Backward/save/reopen differs');}finally{fresh.reset();assert(fresh.diagnostics().retainedBytes===0,'Fresh cleanup');}
   row.backwardAndSavePassed=true;
   if(step<1e-9){assert(new Set(row.frames.map(x=>Math.fround(x.value))).size===1,'Threshold fixture changed Float32');assert(row.frames.some(x=>!x.changed)&&row.frames.filter(x=>x.changed).length>1,'Threshold fixture missed accumulation');}
   assert(row.frames.at(-1).steps===row.frames.at(-2).steps,'Completed public queue kept iterating');
   }finally{session.reset();assert(session.diagnostics().retainedBytes===0,'Public cleanup');}
  }
  return{environment:navigator.userAgent,uniformFrames,rows};
 });
 report.sourceAfter=await snapshot();if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Source changed during verification');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
