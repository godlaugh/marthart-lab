import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2];if(!output)throw Error('Pass a fresh report path');
const paths=['src/engine/rootsNativeDisplay.ts','src/engine/rootsNativeDensityGpu.ts','src/engine/rootsProjection.ts','src/engine/rootsPresentationConfig.ts','src/engine/rootsNativeInk.ts','src/engine/rootsDensityColor.ts','src/engine/generationCleanup.ts','src/engine/rootsGpuFailure.ts','scripts/verify-roots-native-display.mjs'];
const hash=v=>createHash('sha256').update(v).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',sourceStart:await hashes(),pageErrors:[]};let server,browser,page;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/native-display-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Roots source display lifecycle</title>'}));await page.goto(server.resolvedUrls.local[0]+'native-display-check');
 report.results=await page.evaluate(async()=>{
  const {RootsNativeDensityDisplay}=await import('/src/engine/rootsNativeDisplay.ts'),{defaultRootsPresentationConfiguration}=await import('/src/engine/rootsPresentationConfig.ts'),{prepareRootsProjection}=await import('/src/engine/rootsProjection.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
  const result=globalThis.__nativeDisplayResult={browser:navigator.userAgent,checks:[],frames:[],cleanup:[]};
  const check=(condition,id)=>{if(!condition)throw Error(id);result.checks.push(id);};
  const owners=[],own=()=>{const o=new RootsNativeDensityDisplay();owners.push(o);return o;};
  const empty=new Float64Array(0),raw=new Float64Array([5,3,0,.25,-8,-4,0,.75]),same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
  const config=defaultRootsPresentationConfiguration();config.camera.phi=0;config.transform.scale=[1,1,1];config.dotSize=.1;
  const plan=(c=config,w=47,h=31)=>prepareRootsProjection(c,{width:w,height:h,viewport:{logicalWidth:w,logicalHeight:h,referenceLogicalHeight:h,target:'primary'}});
  const color=(brightness=1)=>prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceGamma:1,rootSourceBrightness:brightness,background:'#000000'},rootsSourcePalette:{colors:['#FFFFFF']}});
  const frame=(o,p,points=empty,tone=color(),options={})=>{const start=performance.now(),v=o.render(p,points,tone,options);result.frames.push({elapsedMs:performance.now()-start,facts:v.facts,accumulated:v.accumulated,displayed:v.displayed});return v;};
  try{
   for(const kernel of['auto','points','quad']){
    const o=own(),p=plan(),first=frame(o,p,raw,color(),{kernel}),again=frame(o,p,empty,color(),{kernel});
    check(first.facts.submittedFinitePointCount===2&&first.accumulated.totalMass>0,'initial-visible-'+kernel);
    check(same(first.pixels,again.pixels)&&again.facts.submittedFinitePointCount===2,'warm-no-resubmission-'+kernel);
    const changed=structuredClone(config);changed.camera.theta=.31;const angle=frame(o,plan(changed),empty,color(),{kernel});
    check(!angle.facts.capture&&!angle.facts.clearInk&&angle.facts.submittedFinitePointCount===2&&angle.accumulated.totalMass===first.accumulated.totalMass&&!same(first.pixels,angle.pixels),'angle-keeps-anchor-and-ink-'+kernel);
    changed.dotSize=.001;const dot=frame(o,plan(changed),empty,color(),{kernel});
    check(!dot.facts.clearInk&&same(dot.pixels,angle.pixels),'dot-affects-only-future-'+kernel);
    const recolor=frame(o,plan(changed),empty,color(.1),{kernel});
    check(recolor.facts.submittedFinitePointCount===2&&recolor.accumulated.totalMass===first.accumulated.totalMass&&!same(recolor.pixels,dot.pixels),'tone-does-not-replay-'+kernel);
    changed.transform.offset=[9,1,0];const cleared=frame(o,plan(changed),empty,color(),{kernel});
    check(cleared.facts.clearReasons.includes('transform')&&!cleared.facts.capture&&cleared.facts.submittedFinitePointCount===0&&cleared.accumulated.totalMass===0&&cleared.facts.consumedInputPoints===2,'transform-clears-without-replay-'+kernel);
    frame(o,plan(changed),raw,color(),{kernel});const anchor=o.diagnostics().anchor;
    const resized=frame(o,plan(changed,53,37),empty,color(),{kernel});
    check(resized.facts.clearReasons.includes('physical-size')&&!resized.facts.capture&&resized.facts.submittedFinitePointCount===0&&o.diagnostics().anchor===anchor,'resize-clears-retains-anchor-'+kernel);
    const next=frame(o,plan(changed,53,37),raw,color(),{kernel});check(next.facts.submittedFinitePointCount===2&&next.facts.consumedInputPoints===6,'resize-consumes-only-new-input-'+kernel);
    changed.camera.zoom+=.1;const zoom=frame(o,plan(changed,53,37),empty,color(),{kernel});
    check(zoom.facts.capture&&zoom.facts.clearReasons.includes('camera-projection')&&zoom.facts.submittedFinitePointCount===0,'zoom-captures-clears-'+kernel);
    o.dispose();check(!o.diagnostics().gpu,'disposed-'+kernel);
   }
   const o=own(),p=plan();
   const finite=frame(o,p,new Float64Array([0,0,0,Infinity,1e30,0,0,-Infinity,Infinity,0,0,NaN]));
   check(finite.facts.newInvalidPoints===1&&finite.facts.submittedFinitePointCount===2,'finite-admission-before-metric-clamp-including-clipped');
   let error;try{o.render(p,new Float64Array([0,0,0,NaN]),color());}catch(e){error=e;}
   check(error?.failureKind==='input'&&!o.diagnostics().gpu,'metric-nan-propagates-and-resets');
   frame(o,p,raw);let polls=0;error=undefined;
   try{o.render(p,raw,color(),{isCancelled:()=>++polls>2});}catch(e){error=e;}
   check(error?.name==='AbortError'&&!o.diagnostics().gpu,'cancel-resets-owned-partial-display');
   const fresh=frame(o,p,raw);check(fresh.facts.submittedFinitePointCount===2,'cancel-recovery-new-instance');
   const context=o.gpu.gl,remove=context.deleteTexture;context.deleteTexture=function(){throw Error('controlled delete failure');};
   let cleanupError;try{o.reset();}catch(e){cleanupError=e;}finally{context.deleteTexture=remove;}
   check(cleanupError?.name==='GenerationCleanupError'&&cleanupError.cleanupPending&&o.diagnostics().gpu.handles>0,'cleanup-ticket-retains-handles');
   const recovered=frame(o,p,raw),before=o.diagnostics().gpu.submittedPoints;cleanupError.retryCleanup();
   check(!cleanupError.cleanupPending&&o.diagnostics().gpu.submittedPoints===before&&recovered.facts.submittedFinitePointCount===2,'cleanup-retry-old-ticket-cannot-clear-new-instance');
   let pointError;const cloud=structuredClone(config);cloud.mode='point-cloud';try{o.render(plan(cloud),raw,color());}catch(e){pointError=e;}
   check(pointError?.failureKind==='input'&&!o.diagnostics().gpu,'point-cloud-is-not-silently-density');
   const single=own(),split=own(),batchPlan=plan();
   const singleFrame=single.render(batchPlan,raw,color()),batchFrame=split.renderBatches(batchPlan,[raw.subarray(0,4),raw.subarray(4)],color());
   check(same(singleFrame.pixels,batchFrame.pixels)&&batchFrame.facts.newInputPoints===2&&batchFrame.facts.submittedFinitePointCount===2,'split-batches-equal-single-render');
   const producerError=Error('controlled arrival iterator failure');function* failedBatches(){yield raw;throw producerError;}
   let batchError;try{split.renderBatches(batchPlan,failedBatches(),color());}catch(e){batchError=e;}
   check(batchError===producerError&&!split.diagnostics().gpu,'throwing-batch-iterator-releases-partial-ink');
   const retryFrame=split.renderBatches(batchPlan,[raw],color());check(same(singleFrame.pixels,retryFrame.pixels)&&retryFrame.facts.submittedFinitePointCount===2,'batch-iterator-failure-recovery');
   return result;
  }finally{for(const o of owners){o.dispose();result.cleanup.push({released:!o.diagnostics().gpu});}}
 });
 report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable||report.pageErrors.length)throw Error('Source drift or page error');report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};report.partial=await page?.evaluate(()=>globalThis.__nativeDisplayResult).catch(()=>undefined);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.closed={browser:true,vite:true};
 report.limitations=['Real Chrome WebGL2 executes the new display owner; original application/JVM/OpenGL4.1 is not executed.','Lifecycle assertions derive from retained static display/resize/camera methods. Pixel equality is a local retained-state regression, not an independent shader oracle; separate native-projection and ink-view verifiers cover shader arithmetic.','This is a display-stage integration probe. Main application authoring, source import, solver clock, worker, point-cloud, paused export and video are not connected or accepted by this report.','The caller supplies point arrival order; this does not reconstruct original thread timing. CPU tone is explicit, and no source native fallback is claimed.'];
 await mkdir('.cache',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,error:report.error?.message,checks:report.results?.checks.length,frames:report.results?.frames.length}));
}
