import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [side,output]=process.argv.slice(2);
if(!['old','current'].includes(side)||!output)throw Error('Usage: old|current output.json');
const baseline='.cache/roots-density-baseline-2280',sha=x=>createHash('sha256').update(x).digest('hex');
async function tree(directory){const rows=[];for(const entry of await readdir(directory,{withFileTypes:true})){const p=directory+'/'+entry.name;if(entry.isDirectory())rows.push(...await tree(p));else if(entry.isFile())rows.push(p);}return rows;}
const paths=[...(side==='current'?await tree('src'):[]),'scripts/verify-roots-native-workflows.mjs','tests/fixtures/roots/native-sampling-source.json',...await tree(baseline+'/src')].sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',side,at:new Date().toISOString(),sourceBefore:await hashes(),pageErrors:[]};
const vectors=JSON.parse(await readFile('tests/fixtures/roots/native-sampling-source.json','utf8'));
let server,browser,page;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/roots-native-workflows',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Roots native workflow validation</title>'}));await page.goto(server.resolvedUrls.local[0]+'roots-native-workflows');
 report.result=await page.evaluate(async({side,baseline,vectors})=>{
  const root=side==='old'?'/'+baseline:'',{Generator}=await import(root+'/src/engine/client.ts'),{createScene}=await import('/'+baseline+'/src/engine/document.ts'),{definitions}=await import('/'+baseline+'/src/scenes/complex.ts');
  const check=(v,s)=>{if(!v)throw Error(s);},digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const NativeWorker=globalThis.Worker;let created=0,terminated=0;
  globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);created++;const finish=this.terminate.bind(this);let closed=false;this.terminate=()=>{if(!closed){closed=true;terminated++;}finish();};}};
  const rows=[],checks=[],base=createScene(definitions.find(d=>d.kind==='roots'));
  function local(backend){const s=structuredClone(base);s.id='roots-native-equivalent-legacy';s.timeline={duration:2,fps:30,loop:false,playbackMode:'once',tracks:[]};s.equations.polynomial='z^5-t1';Object.assign(s.settings,{rootsMode:'progressive',rootTotalSamples:4096,rootSamplesPerFrame:4096,rootSamplingFps:30,rootBatchSize:256,rootDensityBackend:backend,rootColor:'radius',rootSplat:'pixel'});return s;}
  const task=async(g,s,c,metadata)=>{
   const start=performance.now(),out=await g.generate(s,c),completeTaskMs=performance.now()-start,bytes=out.type==='raster'?out.pixels:out.positions;
   check(!!bytes,'output missing');if(out.type==='raster')check(bytes.length===c.width*c.height*4,'incomplete raster');
   const row={...metadata,inputSha256:await digest(new TextEncoder().encode(JSON.stringify({scene:s,context:c}))),outputSha256:await digest(bytes),completeTaskMs,outputType:out.type,actualBackend:out.backend,roots:out.roots,rootsColor:out.rootsColor,temporal:out.temporal,stats:{samples:out.stats.samples,generated:out.stats.generated,invalid:out.stats.invalid},width:c.width,height:c.height,outputBytes:bytes.byteLength,warnings:out.warnings};rows.push(row);return{out,row};
  };
  try{
   for(const backend of ['cpu','webgl2'])for(let repetition=0;repetition<3;repetition++){
    const g=new Generator(),s=local(backend),c={time:0,width:640,height:360,quality:'export'};
    try{const a=await task(g,s,c,{case:'legacy-equivalent',backend,repetition,state:'cold-new-worker'}),b=await task(g,s,c,{case:'legacy-equivalent',backend,repetition,state:'warm-same-worker'});check(a.out.backend===backend&&b.out.backend===backend,'legacy requested backend not used');check(a.out.roots.complete&&a.out.roots.attemptedSamples===4096,'legacy incomplete ensemble');check(a.row.outputSha256===b.row.outputSha256&&b.out.temporal.cacheHits===1,'legacy replay mismatch');}finally{g.dispose();}
   }
   if(side==='current'){
    const{createRootsNativeMath}=await import('/src/engine/rootsMathConfig.ts');
    const row=(name,domain='REAL_RANGE')=>({name,domain,minRe:-5,maxRe:5,minIm:-1,maxIm:1,value:[2,3]});
    const source=()=>{const s=local('cpu');s.id='roots-native-source';s.rootsMath=createRootsNativeMath();s.rootsMath.polynomial={variable:'metadata',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-(real+rectangle)'}]};s.rootsMath.parameters=[row('fixed','FIXED'),row('real'),{...row('rectangle','COMPLEX_RECT'),minRe:-1,maxRe:1}];s.rootsMath.sampling={sampleCount:10,batchSize:3,workerCount:3,seed:'0',filter:''};Object.assign(s.settings,{rootSamplesPerFrame:3,rootSamplingFps:10,densityView:'manual',densityCenterX:0,densityCenterY:0,densitySpan:12});return s;};
    for(const vector of vectors.partitionAndDomain){const s=source(),g=new Generator();Object.assign(s.rootsMath.sampling,{sampleCount:vector.sampleCount,workerCount:vector.configuredWorkers,seed:vector.seed});Object.assign(s.settings,{rootsMode:'single',presentation:'points'});try{const {out,row:result}=await task(g,s,{time:0,width:160,height:120,quality:'export'},{case:'independent-source-worker-stream',seed:vector.seed,workers:vector.configuredWorkers});check(out.type==='geometry','single source did not produce geometry');const expected=vector.workers.flatMap(w=>w.samples).flatMap(v=>[Math.fround(v.real+v.rectangle[0]),Math.fround(v.rectangle[1]),0]);check(out.positions.length===expected.length&&out.positions.every((n,i)=>Object.is(n,expected[i])),'worker geometry disagrees with independent stream');checks.push({case:result.case,seed:vector.seed,positions:expected.length/3,exact:true});}finally{g.dispose();}}
    for(const backend of ['cpu','webgl2']){
     const s=source();s.settings.rootDensityBackend=backend;s.settings.rootDensityColorVersion='mathart-1.7.8-metric-v1';s.rootsSourcePalette={colors:['#ff0055','#44eeaa','#0055ff']};const g=new Generator(),cold=new Generator(),c={time:.3,width:160,height:120,quality:'export'};
     try{
      await task(g,s,{...c,time:0},{case:'source-progressive',backend,state:'first-frame'});const a=await task(g,s,c,{case:'source-progressive',backend,state:'warm-completion'}),b=await task(cold,s,c,{case:'source-progressive',backend,state:'cold-completion'});
      check(a.out.backend===backend&&a.out.roots.complete&&a.out.roots.math.logicalWorkers===3,'source backend/ensemble facts wrong');check(a.row.outputSha256===b.row.outputSha256&&JSON.stringify(a.out.roots)===JSON.stringify(b.out.roots),'source cold/warm mismatch');
      const back=await task(g,s,{...c,time:.1},{case:'source-progressive',backend,state:'backseek'});check(back.out.roots.attemptedSamples===6,'backseek wrong ordinal');
      const repeat=await task(g,s,c,{case:'source-progressive',backend,state:'forward-replay'});check(repeat.row.outputSha256===a.row.outputSha256,'backseek changed source image');
      s.settings.seed='dormant-invalid';s.equations.polynomial='(';const dormant=await task(g,s,c,{case:'source-progressive',backend,state:'dormant-edit'});check(dormant.row.outputSha256===a.row.outputSha256&&dormant.out.temporal.cacheHits===1,'inactive local edit changed source');
      s.rootsMath.sampling.workerCount=1;const partition=await task(g,s,c,{case:'source-progressive',backend,state:'partition-edit'});check(partition.out.temporal.cacheHits===0&&partition.row.outputSha256!==a.row.outputSha256,'source worker partition edit ignored');
      const huge=structuredClone(s);huge.rootsMath.polynomial.coefficients=[{exponent:'2147483647',expression:'1'}];let failed=false;try{await g.generate(huge,c);}catch(error){failed=/budget|workspace/i.test(String(error));}check(failed,'source capacity failure was swallowed');
      const recovered=await task(g,s,c,{case:'source-progressive',backend,state:'recover-after-capacity'});check(recovered.row.outputSha256===partition.row.outputSha256,'worker failed to recover after capacity');
      checks.push({case:'source-progressive',backend,warmColdBackseek:true,inactiveInputsPreserved:true,activePartitionInvalidated:true,capacityRecovery:true});
     }finally{g.dispose();cold.dispose();}
    }
    for(const mode of ['source-default-aberth','source-iteration-limit']){
     const s=source(),g=new Generator();s.rootsMath=createRootsNativeMath(3);s.rootsMath.sampling.sampleCount=64;s.settings.rootSamplesPerFrame=64;
     if(mode==='source-iteration-limit'){s.rootsMath.polynomial.coefficients=[{exponent:'5',expression:'1'},{exponent:'1',expression:'1'},{exponent:'0',expression:'-1'}];s.rootsMath.solver.maxIterations=1;}
     try{const a=await task(g,s,{time:0,width:320,height:240,quality:'export'},{case:mode,state:'cold-new-worker'});check(a.out.roots.complete&&a.out.roots.acceptedPolynomials===64&&a.out.roots.solverIterations>0,'actual Aberth workflow was not completed');if(mode==='source-iteration-limit')check(a.out.roots.rootPoints===320&&a.out.roots.math.iterationLimitSamples===64&&a.out.stats.invalid===0,'finite iteration-limit roots were discarded');const b=await task(g,s,{time:0,width:320,height:240,quality:'export'},{case:mode,state:'warm-same-worker'});check(a.row.outputSha256===b.row.outputSha256&&b.out.temporal.cacheHits===1,'Aberth warm output changed');}finally{g.dispose();}
    }
    for(const backend of ['cpu','webgl2']){
     const s=source(),g=new Generator();s.rootsMath.polynomial.coefficients=[{exponent:'5',expression:'1'},{exponent:'0',expression:'-real'}];s.rootsMath.sampling.sampleCount=4096;s.rootsMath.sampling.workerCount=4;Object.assign(s.settings,{rootSamplesPerFrame:4096,rootDensityBackend:backend,rootDensityColorVersion:'mathart-1.7.8-metric-v1'});s.rootsSourcePalette={colors:['#ff0055','#44eeaa','#0055ff']};const c={time:0,width:3840,height:2160,quality:'export'};
     try{const a=await task(g,s,c,{case:'source-4k-complete',backend,state:'cold-new-worker'});check(a.out.backend===backend&&a.out.roots.complete&&a.out.roots.attemptedSamples===4096&&a.out.roots.rootPoints===20480,'source4K incomplete');s.settings.rootSourceGamma=1;s.settings.rootSourcePaletteOffset=.17;const b=await task(g,s,c,{case:'source-4k-complete',backend,state:'warm-tone-same-ink'});check(b.out.temporal.cacheHits===1&&b.out.roots.solverWork===a.out.roots.solverWork,'source4K tone edit recalculated math');check(b.row.outputSha256!==a.row.outputSha256,'source4K tone edit ignored');}finally{g.dispose();}
    }
   }
   check(created===terminated,'owned worker cleanup incomplete');return{rows,checks,workers:{created,terminated},userAgent:navigator.userAgent};
  }finally{globalThis.Worker=NativeWorker;}
 },{side,baseline,vectors});
 if(report.pageErrors.length)throw Error(report.pageErrors.join(';'));report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.cleanup.errors.length){report.status='failed';process.exitCode=1;}
 report.limitations=['No original application/JVM was executed. Exact independent stream checks cover JavaRandom integer recurrence and the stated source-derived arithmetic; they do not establish all native JVM/libm low bits.','The current source math model is a different contract from the legacy baseline; only identical legacy inputs are before/after performance comparisons.','Complete-task time includes worker response and excludes per-task SHA calculation. Cold means a new Generator/worker; Chrome, Vite, OS and driver caches remain shared.','Stable ordinal replay preserves logical worker streams, not native OS arrival order. Projection, point kernels and source pixel equivalence remain outside this math batch.','Full 4K and 4096 source samples are completed, not 47.55M throughput evidence. Sampled process-family CPU/RSS comes from the external runner; driver VRAM and agent tokens are unmeasured.'];
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,status:report.status,tasks:report.result?.rows.length,sourceStable:report.sourceStable,error:report.error?.message,cleanup:report.cleanup}));
}
