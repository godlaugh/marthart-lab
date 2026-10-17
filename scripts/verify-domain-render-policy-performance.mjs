// Isolated equivalent successful Generator cost tasks; no fault injection.
import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const performanceSide=process.env.DOMAIN_POLICY_PERFORMANCE_SIDE;
if(!['old','current'].includes(performanceSide))throw Error('Expected old/current performance side');
const output=process.env.DOMAIN_REPORT;
if(!output)throw Error('Explicit new output path required');
const sha=x=>createHash('sha256').update(x).digest('hex');
const frozen=JSON.parse(await readFile('.cache/domain-render-policy-browser-attempt1.json','utf8'));
const paths=[...frozen.sourceStart.map(r=>r.path),'scripts/verify-domain-render-policy-performance.mjs','.cache/measure-navigation-task.py'];
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:sha(await readFile(path))})));
const baselineRoot='.cache/domain-parameter-registry-baseline-1723',manifest=await readFile(baselineRoot+'/manifest.json'),baseline=JSON.parse(manifest);
for(const [p,digest] of Object.entries(baseline.sourceManifest))if(sha(await readFile(baselineRoot+'/'+p.replace(/^studio\//,'')))!==digest)throw Error('Frozen baseline changed '+p);
const report={startedAt:new Date().toISOString(),scope:'Equivalent complete 640x360 export-quality successful production Generator requests; old 1723 and current in separate processes.',baseline:{path:baselineRoot,manifestSha256:sha(manifest),verifiedFiles:Object.keys(baseline.sourceManifest).length},sourceStart:await snapshot(),limits:['Only one finite formula at 640x360, 3 repetitions per backend; small sample timings may be noisy.','Cold includes fresh worker import/compile; host OS/browser caches are not flushed. Warm reuses that same worker.','No fault hook, no native application execution, no universal speedup or whole-system resource claim.','Process-family CPU and sampled RSS are measured by the separate 50ms runner; VRAM, tokens and tool fees are unmeasured.']};
let browser;const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
try{await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route(origin,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain policy cost</title>'}));await page.goto(origin);
  report.performance=await page.evaluate(async(side)=>{
   const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
   const {Generator}=side==='old'?await import('/.cache/domain-parameter-registry-baseline-1723/src/engine/client.ts'):await import('/src/engine/client.ts');
   const scene=createScene(definition('domain'));scene.id='domain-render-policy-cost-fixture';scene.equations={f:'sin(z)*cos(z)+.2'};scene.parameters={};scene.timeline.tracks=[];
   Object.assign(scene.settings,{domainIterationVersion:'local-v1',domainColorVersion:'local-v1',domainViewportVersion:'local-v1',iterationEnabled:false,supersampling:1,rotation:.37,scale:1.3});delete scene.settings.domainRenderPolicy;
   const context={width:640,height:360,time:0,quality:'export'},rows=[],hash=async p=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',p))].map(v=>v.toString(16).padStart(2,'0')).join('');
   for(const backend of ['cpu','gpu'])for(let repeat=0;repeat<3;repeat++){
    const g=new Generator();scene.settings.domainBackend=backend;
    try{for(const state of ['cold-new-worker','warm-same-worker']){const start=performance.now(),out=await g.generate(scene,context),elapsedMs=performance.now()-start;if(out.type!=='raster'||out.width!==640||out.height!==360)throw Error('Performance task incomplete');if(out.backend!==(backend==='cpu'?'cpu':'webgl2'))throw Error('Unexpected performance backend '+out.backend);rows.push({side,backend,repeat,state,elapsedMs,producerElapsedMs:out.stats.elapsedMs,actualBackend:out.backend,width:out.width,height:out.height,stats:out.stats,sha256:await hash(out.pixels)});}}finally{g.dispose();}
   }
   for(const backend of ['cpu','gpu'])if(new Set(rows.filter(r=>r.backend===backend).map(r=>r.sha256)).size!==1)throw Error('Same backend task hashes changed');
   return{side,rows,request:{scene,context},cold:'Fresh production Generator worker, including startup/import/compile; OS/browser caches not cleared.',warm:'Same worker, same document and dimensions, no new mathematical-state cache claim.'};
  },performanceSide);
report.browser=browser.version();
}catch(error){report.error=String(error.stack??error);}finally{await browser?.close();await server.close();report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.status=!report.error&&report.sourceStable?'passed':'failed';await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,side:performanceSide,rows:report.performance?.rows.length,error:report.error}));if(report.status!=='passed')process.exitCode=1;}
