/** Functional, complete-ink/statistics comparison across an explicit baseline and current tree.
 * node scripts/verify-source-samila-statistics-boundaries.mjs [report-dir] [baseline-root] [actual-root]
 * No shader patch. Force the real QUAD fallback by suppressing only the initial POINTS probe.
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
if(args[0]==='--help'){console.log('node scripts/verify-source-samila-statistics-boundaries.mjs [report-dir] [baseline-root] [actual-root]');process.exit(0);}
const [directory='.cache/samila-statistics-boundaries',baseline='.cache/samila-direct-baseline-47752045',actual='.']=args;
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=async root=>Object.fromEntries(await Promise.all((await readdir(root+'/src',{recursive:true,withFileTypes:true})).filter(x=>x.isFile()).map(async x=>{const p=x.parentPath+'/'+x.name;return[p.slice(root.length+1),sha(await readFile(p))];})));
await mkdir(directory,{recursive:true});
const report={status:'running',scriptSha256:sha(await readFile(fileURLToPath(import.meta.url))),shaderPatch:false,runs:[],limitations:['Functional verification only; concurrent root gates make elapsed wall time unsuitable for performance comparison.','Baseline/actual equality does not establish native parity. Finite points use constant formulas; invalid coverage propagates an overflowing finite-endpoint sampling span into x.','Actual probe fallback is induced by suppressing exactly the first POINTS probe draw, without changing shaders or production code.']};
const start=performance.now();
try{
for(const [label,input] of [['baseline',baseline],['actual',actual]]){
 const root=resolve(input),run={label,sourceRoot:root,sourceBefore:await hash(root)};report.runs.push(run);let server,browser;
 try{
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.setDefaultTimeout(60000);
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');run.browserVersion=browser.version();
  run.rows=await page.evaluate(async()=>{
   const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{initializeSamilaCamera}=await import('/src/engine/samilaCamera.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareSourceSamilaSplat}=await import('/src/engine/sourceSamilaSplat.ts'),{prepareSamilaHistoryFrame}=await import('/src/engine/samilaHistory.ts'),{SourceSamilaSamplingSession,prepareSourceSamilaSamplingBatch}=await import('/src/engine/sourceSamilaSampling.ts');
   const assert=(v,m)=>{if(!v)throw Error(m);},rows=[];
   const cases=[
    {name:'all-invalid-multiple-chunks',count:65537,multipliers:[6],f1:'x',range:[-3e38,3e38],expected:'invalid'},
    {name:'all-clipped-multiple-chunks',count:65537,multipliers:[6],f1:'100',expected:'clipped'},
    {name:'alpha-zero-still-accepted',count:65537,multipliers:[6],f1:'0',alpha:0,expected:'accepted'},
    {name:'same-owner-six-then-one',count:65537,multipliers:[6,1],f1:'0',expected:'accepted'},
    {name:'single-sample',count:1,multipliers:[1],f1:'0',expected:'accepted'},
    {name:'one-sample-final-chunk',count:10923,multipliers:[1],f1:'0',expected:'accepted'},
    {name:'five-sample-final-chunk',count:65537,multipliers:[1],f1:'0',expected:'accepted'},
   ];
   for(const spec of cases){
    const row={...spec,frames:[]},gpu=new IteratedDensityGpu(),sampling=new SourceSamilaSamplingSession({nextSeed:()=>-1});rows.push(row);
    const proto=WebGL2RenderingContext.prototype,native={drawArrays:proto.drawArrays,beginTransformFeedback:proto.beginTransformFeedback,endTransformFeedback:proto.endTransformFeedback};let suppressed=0,active=false,draws=[];
    try{
     proto.beginTransformFeedback=function(...a){const v=native.beginTransformFeedback.apply(this,a);active=true;return v;};
     proto.endTransformFeedback=function(...a){try{return native.endTransformFeedback.apply(this,a);}finally{active=false;}};
     proto.drawArrays=function(mode,first,count){if(!suppressed&&mode===this.POINTS&&count===16&&!active&&!this.isEnabled(this.RASTERIZER_DISCARD)){suppressed++;return;}if(active)draws.push({mode,first,count});return native.drawArrays.call(this,mode,first,count);};
     const scene=createScene(definition('samila'));scene.timeline.tracks=[];scene.timeline.fps=30;scene.equations={f1:spec.f1,f2:'0'};scene.parameters={};scene.palette={name:'white',stops:['#ffffff','#ffffff'],mode:'linear',cycles:1,offset:0};
     scene.settings=initializeSamilaCamera({...scene.settings,iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:spec.count,samilaHistoryModel:'bounded-v2',densityToneModel:'samila-normalized-v2',samilaProjectionModel:'source-ndc-v1',samilaMathModel:'mathart-1.7.8',samilaSplatModel:'samila-splat-1.7.8',samilaSamplingModel:'samila-pcg-1.7.8',start:spec.range?.[0]??-Math.PI,stop:spec.range?.[1]??Math.PI,mapping:'f1_f2',projection:'cartesian',scaleX:.33,scaleY:.33,offsetX:0,offsetY:0,rotation:0,samilaCameraTheta:0,samilaSpotSize:.03,alpha:spec.alpha??.2,showTrails:false,accumulationDecay:1});
     for(let frame=0;frame<spec.multipliers.length;frame++){
      const multiplier=spec.multipliers[frame],n=spec.count*multiplier,job=prepareIteratedFrame(scene,frame/30,frame);
      job.history=prepareSamilaHistoryFrame({parameters:job.field.parameters,fieldKey:job.fieldKey,frame,count:spec.count,record:true},multiplier===6?{parameters:{unused:1},fieldKey:job.fieldKey}:undefined,true);
      job.samilaSplat=prepareSourceSamilaSplat(scene,{width:64,height:48,primaryPixelHeight:1080,path:'points'});job.samilaSampling=prepareSourceSamilaSamplingBatch(sampling,frame,spec.count,multiplier);draws=[];
      const stats=gpu.step(job,{resetParticles:frame===0,clearInk:true,width:64,height:48,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}}),ink=gpu.readback();
      const inkSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',ink.buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');
      const result={frame,multiplier,n,stats,path:job.samilaSplat.path,draws:[...draws],inkSha256,inkBytes:ink.byteLength,nonzero:ink.filter(v=>v!==0).length,finite:ink.every(Number.isFinite)};row.frames.push(result);
      assert(result.path==='quad','actual QUAD fallback');assert(stats.steps===n,'steps count');
      for(const key of ['invalid','accepted','clipped'])assert(stats[key]===(key===spec.expected?n:0),`${key}: ${stats[key]}, expected ${key===spec.expected?n:0}`);
      assert(stats.sampleInvalid===(spec.expected==='invalid'?n:0),'sampleInvalid');assert(result.finite,'finite ink');
      assert(result.nonzero>0 === (spec.expected==='accepted'&&spec.alpha!==0),'ink blank/visible semantics');
      assert(draws.length===Math.ceil(n/10922),'chunk count');assert(draws.every(d=>d.mode===4&&d.count<=65532&&d.count%6===0),'quad triangle chunks');assert(draws.reduce((a,d)=>a+d.count,0)===n*6,'complete vertices');
     }
     assert(suppressed===1,'one initial probe suppressed');row.status='passed';
    }catch(error){row.status='failed';row.error=String(error.stack??error);}finally{
     Object.assign(proto,native);sampling.reset();row.suppressedProbeDraws=suppressed;
     try{gpu.reset();row.afterReset=gpu.diagnostics();assert(row.afterReset.retainedBytes===0,'GPU cleanup');}catch(error){row.status='failed';row.cleanupError=String(error.stack??error);}
    }
   }
   return rows;
  });
  run.status=run.rows.every(r=>r.status==='passed')?'passed':'failed';
 }catch(error){run.status='failed';run.error=String(error.stack??error);}finally{
  run.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>({status:r.status,...r.status==='rejected'?{error:String(r.reason)}:{}}));
  run.sourceAfter=await hash(root);run.sourceStable=JSON.stringify(run.sourceBefore)===JSON.stringify(run.sourceAfter);if(!run.sourceStable||run.cleanup.some(r=>r.status==='rejected'))run.status='failed';
 }
}
report.comparisons=(report.runs[0].rows??[]).flatMap(before=>before.frames.map((frame,index)=>{const after=report.runs[1].rows?.find(r=>r.name===before.name)?.frames[index];return{name:before.name,frame:index,inkExact:frame.inkSha256===after?.inkSha256,statsExact:JSON.stringify(frame.stats)===JSON.stringify(after?.stats),drawsExact:JSON.stringify(frame.draws)===JSON.stringify(after?.draws)};}));
report.status=report.runs.every(r=>r.status==='passed')&&report.comparisons.length===8&&report.comparisons.every(r=>r.inkExact&&r.statsExact&&r.drawsExact)?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}finally{
 report.elapsedMs=performance.now()-start;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));
 await writeFile(directory+'/report.md',`# Samila GPU statistics boundaries\n\nStatus: ${report.status}. Eight frames across seven cases; elapsed ${(report.elapsedMs/1000).toFixed(2)} s is not a performance measurement.\n\n| Case | Frame | Ink exact | Stats exact | Draw sequence exact |\n|---|---:|---|---|---|\n${report.comparisons?.map(r=>`| ${r.name} | ${r.frame} | ${r.inkExact} | ${r.statsExact} | ${r.drawsExact} |`).join('\n')??report.error}\n\n${report.runs.map(r=>`${r.label}: ${r.status}; source stable ${r.sourceStable}; cleanup ${r.cleanup?.every(c=>c.status==='fulfilled')}.\n${r.rows?.filter(x=>x.status!=='passed').map(x=>x.name+': '+x.error).join('\n')??r.error??''}`).join('\n\n')}\n\n${report.limitations.map(x=>'- '+x).join('\n')}\n`);
 console.log(JSON.stringify({status:report.status,directory,runs:report.runs.map(r=>({label:r.label,status:r.status,failed:r.rows?.filter(x=>x.status!=='passed').map(x=>({name:x.name,error:x.error}))})),comparisons:report.comparisons}));if(report.status!=='passed')process.exitCode=1;
}
