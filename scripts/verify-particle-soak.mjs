import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,cp,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// A duration-based stability check of real production sessions, not an FPS benchmark.
const reportPath=process.argv.find(v=>v.startsWith('--report='))?.slice(9)??'coverage/particle-soak.json';
const seconds=Number(process.argv.find(v=>v.startsWith('--seconds='))?.split('=')[1]??300);
if(!Number.isFinite(seconds)||seconds<10||seconds>900)throw Error('seconds must be 10..900');
const sourcePaths=['src/scenes/iteratedDensity.ts','src/engine/iteratedDensityGpu.ts','src/engine/samilaHistory.ts','src/engine/samilaTone.ts','src/engine/density.ts','src/engine/densityGpuTone.ts','src/engine/expression.ts','src/scenes/particles.ts','scripts/verify-particle-soak.mjs'];
async function sources(root='.') {return Promise.all(sourcePaths.map(async file=>({path:'studio/'+file,sha256:createHash('sha256').update(await readFile(path.join(file.startsWith('src/')?root:'.',file))).digest('hex')})));}
function family(){
 const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,time='],{encoding:'utf8'}).trim().split('\n').map(line=>{const[pid,ppid,rss,time]=line.trim().split(/\s+/);const parts=time.split(':').map(Number);return{pid:+pid,ppid:+ppid,rss:+rss,cpu:parts.reduce((a,v)=>a*60+v,0)};});
 const ids=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const row of rows)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}
 const own=rows.filter(row=>ids.has(row.pid));return{rssKiB:own.reduce((a,v)=>a+v.rss,0),cpuSeconds:own.reduce((a,v)=>a+v.cpu,0),processCount:own.length};
}
const beforeSources=await sources(),runtimeSnapshot=await mkdtemp(path.resolve('.cache/particle-soak-source-'));
await cp('src',path.join(runtimeSnapshot,'src'),{recursive:true});
if(JSON.stringify(beforeSources)!==JSON.stringify(await sources(runtimeSnapshot)))throw Error('Source changed while freezing runtime snapshot');
const server=await createServer({root:runtimeSnapshot,configFile:false,server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[process.cwd()]}},logLevel:'error'});
await server.listen();const origin=server.resolvedUrls.local[0].replace(/\/$/,'');let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Particle session stability</title>'}));await page.goto(origin+'/');
 await page.evaluate(async()=>{
  const resources={};for(const name of ['Buffer','Texture','Framebuffer','VertexArray','TransformFeedback','Program','Shader']){const owned=new Set();resources[name]=owned;const proto=WebGL2RenderingContext.prototype,create=proto['create'+name],drop=proto['delete'+name];proto['create'+name]=function(...args){const value=create.apply(this,args);if(value)owned.add(value);return value;};proto['delete'+name]=function(value){owned.delete(value);return drop.call(this,value);};}
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{IteratedDensitySession}=await import('/src/scenes/iteratedDensity.ts');
  const check=(ok,message)=>{if(!ok)throw Error(message);},slots=['cpu','gpu'].map(backend=>{const scene=createScene(definition('samila'));scene.parameters={};scene.equations={f1:'sin(x)+cos(y)',f2:'sin(y)-cos(x)'};scene.timeline.tracks=[];Object.assign(scene.settings,{iteratedMode:'continuous',iteratedBackend:backend,samilaHistoryModel:'bounded-v2',densityToneModel:'white-point-v1',batchSize:backend==='gpu'?50000:4096,iteratedFps:10,densityView:'manual',densitySpan:5,densityCenterX:0,densityCenterY:0,mapping:'f1_f2',projection:'cartesian',rotation:0,rotationSpeed:0,pointSize:1,showTrails:true,trailLifetime:4,alpha:.1,start:-Math.PI,stop:Math.PI});return{backend,scene,session:new IteratedDensitySession(),output:null,retained:null,latencies:[],frames:0};});
  let index=0,initialResources;
  const resourceCounts=()=>Object.fromEntries(Object.entries(resources).map(([name,set])=>[name,set.size]));
  window.particleSoak={
   step(){const results=[];for(const slot of slots){const start=performance.now(),output=slot.session.generate(slot.scene,{time:index/10,width:160,height:120,quality:'export'}),d=slot.session.diagnostics();slot.latencies.push(performance.now()-start);slot.frames++;check(output.type==='raster','raster required');check(output.backend===(slot.backend==='gpu'?'webgl2':'cpu'),'backend changed: '+output.warnings?.join(';'));check(output.stats.invalid===0&&output.stats.generated>0,'invalid or empty output');check(d.frame===index,'frame index drift');if(slot.retained!==null)check(d.retainedBytes===slot.retained,'owned retained buffers grew with time');slot.retained=d.retainedBytes;check(slot.backend==='gpu'||d.samilaCompiledExpressions===2,'CPU evaluator retention');slot.output=output;results.push({backend:slot.backend,diagnostics:d,generated:output.stats.generated,maxCount:output.density.maxCount});}const counts=resourceCounts();if(initialResources)check(JSON.stringify(counts)===JSON.stringify(initialResources),'Live GL handle counts grew during fixed workload');else initialResources=counts;return{frame:index++,time:(index-1)/10,results,resources:counts};},
   async finish(){const results=[];for(const slot of slots){const pixels=slot.output.pixels,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(x=>x.toString(16).padStart(2,'0')).join('');check(pixels.some((v,i)=>i%4!==3&&v!==0),'black output');const before=slot.session.diagnostics();slot.session.reset();const after=slot.session.diagnostics();check(after.retainedBytes===0&&after.samilaCompiledExpressions===0,'session retained resources after reset');const sorted=slot.latencies.sort((a,b)=>a-b);results.push({backend:slot.backend,batchSize:slot.scene.settings.batchSize,frames:slot.frames,finalTime:(index-1)/10,pixelHash:hash,before,after,latencyMs:{median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)}});}const counts=resourceCounts();check(Object.values(counts).every(x=>x===0),'GL resources not released '+JSON.stringify(counts));return{results,cleanup:counts};},
   identity(){const gl=new OffscreenCanvas(1,1).getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info'),result={renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};gl.getExtension('WEBGL_lose_context')?.loseContext();return result;}
  };
 });
 const started=performance.now(),initialFamily=family(),samples=[];let nextSample=0,frames=0,peakRssKiB=0,last;
 while(performance.now()-started<seconds*1000){
  const tick=performance.now();last=await page.evaluate(()=>window.particleSoak.step());frames++;
  const elapsed=performance.now()-started;
  if(elapsed>=nextSample){const usage=family();peakRssKiB=Math.max(peakRssKiB,usage.rssKiB);samples.push({elapsedMs:elapsed,...usage,...last});nextSample=elapsed+5000;if(samples.length%6===1)console.log(JSON.stringify({elapsedSeconds:Math.round(elapsed/1000),frame:last.frame,rssKiB:usage.rssKiB,retainedBytes:last.results.map(r=>r.diagnostics.retainedBytes)}));}
  const delay=Math.max(0,100-(performance.now()-tick));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
 }
 const wallMs=performance.now()-started,finalFamily=family(),finished=await page.evaluate(()=>window.particleSoak.finish()),gpuIdentity=await page.evaluate(()=>window.particleSoak.identity());
 const runtimeSourcesAfter=await sources(runtimeSnapshot);if(JSON.stringify(runtimeSourcesAfter)!==JSON.stringify(beforeSources))throw Error('Frozen runtime sources changed during soak');
 const report={runtimeSnapshot,at:new Date().toISOString(),status:errors.length?'failed':'passed',requestedSeconds:seconds,wallMs,frames,width:160,height:120,simulationFps:10,browser:browser.version(),gpuIdentity,samples,finished,pageErrors:errors,resources:{sampledPeakAggregateRssKiB:Math.max(peakRssKiB,finalFamily.rssKiB),familyCpuSecondsDelta:finalFamily.cpuSeconds-initialFamily.cpuSeconds},sourceSnapshots:beforeSources,sourceSnapshotsAfter:runtimeSourcesAfter,workspaceSourceSnapshotsAfter:await sources(),limitations:['Runtime imports use a retained frozen source copy; workspace edits during the run do not update the measured code.','One local machine, two fixed Samila sessions, five-minute scope by default; no all-scene or cross-GPU stability claim.','Low-resolution160x120 CPU4096/GPU50000 batch stability workload, not high-resolution or native performance equivalence.','Runs are paced to no faster than10 requests/second; actual render latency is observed under other local work and not a benchmark.','Known typed/GPU resource counts are checked on every output. Five-second sampled aggregate RSS includes shared pages and this Vite/browser/Node process family, excludes VRAM and is not an exact peak.','Process CPU is sampled live descendant accounting; exited-child CPU may be omitted. No original application executed.']};
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,wallMs,frames,cleanup:finished.cleanup,resources:report.resources}));if(errors.length)process.exitCode=1;
}finally{await browser?.close();await server.close();}
