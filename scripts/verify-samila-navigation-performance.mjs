import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const paths=['src/engine/samilaViewport.ts','src/engine/iteratedIdentity.ts','src/scenes/iteratedDensity.ts','src/engine/iteratedDensityGpu.ts','src/engine/iteratedGpuSamila.ts','src/engine/iteratedSeed.ts','src/engine/samilaCamera.ts','src/engine/samilaHistory.ts','src/engine/timeline.ts','src/engine/density.ts','src/engine/densityGpuTone.ts'];
const snapshot=()=>Promise.all(paths.map(async path=>({path:'studio/'+path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={startedAt:new Date().toISOString(),sourceStart:await snapshot(),jobs:[],limits:['New temporary-navigation feature: no equivalent previous-version completed task exists; no before/after acceleration claim.','Each cold image and each completed gesture samples all 100,000 points and produces full requested RGBA8 dimensions. The separate unchanged-document request is presentation-only, not an equivalent-work baseline.','Cold means a new production session/context in an already-loaded fresh browser; browser/driver disk shader caches are not disabled. Repeated gestures change the runtime identity and intentionally clear/resample, so they are not an unchanged GPU-state cache hit.','generationMs surrounds the synchronous production generate call. Capturing the gesture, hashing all pixels and report serialization are separate work included in the outer process runner, not generationMs.','CPU and WebGL2 are separately requested and verified. No native real-time, native pixel parity or cross-backend equality claim. This is one ordered run on one machine, not a statistical benchmark.','The external measure-navigation-task.py runner owns CPU/process-family sampled RSS measurements. GPU memory, full transient peaks and agent-token costs are unmeasured here.']};
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});let browser;
try{
 await mkdir('.cache',{recursive:true});await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Samila completed navigation task measurement</title>'}));await page.goto(origin);
 await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts'),{initializeSamilaCamera}=await import('/src/engine/samilaCamera.ts'),{captureSamilaViewport,navigateSamilaViewport}=await import('/src/engine/samilaViewport.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  window.navigationCost=async({backend,width,height,gestures})=>{
   let document=createScene(definition('samila'));document.id='samila-navigation-cost';document.equations={f1:'sin(a*x*y)+cos(b*x^2)',f2:'cos(c*x+y)+sin(d*y^4)'};document.parameters={a:1.3,b:1.7,c:1.1,d:.9};document.timeline.tracks=[];
   document.settings=initializeSamilaCamera({...document.settings,iteratedBackend:backend,batchSize:100000,iteratedFps:10,iteratedStartTime:0,seed:7,densityView:'manual',densitySpan:6,densityCenterX:0,densityCenterY:0,scaleX:1.2,scaleY:.8,offsetX:.2,offsetY:-.3,pointSize:2,showTrails:false,accumulationDecay:1,alpha:1,mapping:'f1_f2',projection:'cartesian',start:-Math.PI,stop:Math.PI,rotation:0,rotationSpeed:0,iteratedColor:'noise',paletteMode:'source',samilaCameraTheta:.4});
   const context={time:0,width,height,quality:'export'},owner=new IteratedDensitySession(),rows=[];let output,initialHash;
   const generate=async(label,gesture)=>{
    const before=performance.now();output=owner.generate(document,context);const generationMs=performance.now()-before;
    assert(output.type==='raster'&&output.width===width&&output.height===height&&output.pixels.length===width*height*4,'full output dimensions differ');assert(output.backend===(backend==='gpu'?'webgl2':'cpu'),'requested backend fell back: '+output.warnings?.join('; '));assert(output.temporal.frames===1&&output.temporal.recordedPoints===100000,'request did not complete exactly 100000 samples');assert(output.stats.generated>0,'empty representative image');
    const digest=await hash(output.pixels),facts=owner.diagnostics();rows.push({label,gesture,generationMs,width:output.width,height:output.height,rgbaBytes:output.pixels.byteLength,backend:output.backend,toneBackend:output.density.toneBackend,sha256:digest,stats:output.stats,temporal:output.temporal,density:{accepted:output.density.accepted,clipped:output.density.clipped,occupiedPixels:output.density.occupiedPixels},owner:facts});return digest;
   };
   try{
    initialHash=await generate('cold-first-image');const unchanged=await generate('unchanged-presentation-only');assert(unchanged===initialHash,'unchanged presentation changed pixels');
    for(let i=0;i<gestures;i++){
     const captured=captureSamilaViewport(document,output),gesture=i%2===0?{kind:'pan',dx:3,dy:-2,width,height}:{kind:'zoom',wheelCount:i%4===1?-.5:.25};
     document={...document,runtimeSamilaViewport:navigateSamilaViewport(captured,gesture,i+1)};await generate('completed-gesture-'+(i+1),gesture);
    }
    const costs=rows.slice(2).map(row=>row.generationMs),sorted=[...costs].sort((a,b)=>a-b);
    return{requestedBackend:backend,width,height,batchSize:100000,completedGestures:gestures,rows,summary:{coldGenerationMs:rows[0].generationMs,unchangedPresentationOnlyMs:rows[1].generationMs,gestureTotalMs:costs.reduce((a,b)=>a+b,0),gestureMeanMs:costs.reduce((a,b)=>a+b,0)/costs.length,gestureMedianMs:(sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2,gestureMinMs:sorted[0],gestureMaxMs:sorted.at(-1)}};
   }finally{owner.reset();assert(owner.diagnostics().retainedBytes===0,'session reset retained state');}
  };
 });
 for(const dimensions of[{width:640,height:360,gestures:10},{width:3840,height:2160,gestures:3}])for(const backend of['cpu','gpu']){
  console.log(JSON.stringify({starting:{backend,...dimensions}}));const outerStart=performance.now(),result=await page.evaluate(args=>window.navigationCost(args),{backend,...dimensions});report.jobs.push({...result,outerTaskWallMs:performance.now()-outerStart});console.log(JSON.stringify({completed:{backend,...dimensions,...result.summary}}));
 }
 report.pageErrors=errors;report.browser=browser.version();
}catch(error){report.error=String(error.stack??error);}finally{await browser?.close();await server.close();}
report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.finishedAt=new Date().toISOString();report.status=!report.error&&report.sourceStable&&report.jobs.length===4&&report.pageErrors?.length===0?'passed':'failed';await writeFile('.cache/samila-navigation-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,sourceStable:report.sourceStable,error:report.error}));if(report.status!=='passed')process.exitCode=1;
