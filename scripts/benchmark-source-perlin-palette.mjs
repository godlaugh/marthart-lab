/** Isolated SourcePerlinSession before/after cost, through the real Generator
 * Worker and headless Chrome WebGL2. No original application or visible GUI.
 * --prepare-only records the pinned sources/plan without launching Vite/Chrome.
 * --edits 4 is an explicit equal-workload alternative to the default 8 edits.
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as socketServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {measureFamily} from './browser-process-cost.mjs';

const {values}=parseArgs({options:{
 'prepare-only':{type:'boolean',default:false},
 directory:{type:'string',default:'.cache/perlin-palette-cost-20261024'},
 edits:{type:'string',default:'8'},
}});
const edits=Number(values.edits);
if(![4,8].includes(edits))throw Error('--edits must explicitly select 4 or 8');
const scriptPath=fileURLToPath(import.meta.url),root=resolve(dirname(scriptPath),'..');
const requestedDirectory=resolve(root,values.directory),sourcePath=resolve(root,'src/scenes/sourcePerlin.ts');
const sourceName='src/scenes/sourcePerlin.ts',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const baselineCommit=git(['rev-parse','78767059^{commit}']).trim();
const source={before:git(['show',baselineCommit+':'+sourceName]),after:await readFile(sourcePath,'utf8')};
if(source.before===source.after)throw Error('Before/after SourcePerlinSession sources are identical');
const sourceHashes=async()=>{
 const files=(await readdir(resolve(root,'src'),{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p);
 files.push('scripts/benchmark-source-perlin-palette.mjs','scripts/browser-process-cost.mjs','package-lock.json','vite.config.ts');
 return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(resolve(root,p)))])));
};
const beforeHashes=await sourceHashes();
const cases=[{id:'gpu',backend:'GPU',style:'PARTICLES'}];
// Each attempt has its own directory. A later explicit four-edit retry cannot
// overwrite a failed eight-edit run or present it as a successful full task.
await mkdir(requestedDirectory,{recursive:true});
const directory=await mkdtemp(resolve(requestedDirectory,'run-'));
const report={status:'prepared',at:new Date().toISOString(),baselineCommit,head:git(['rev-parse','HEAD']).trim(),directory,edits,cases,
 command:[process.execPath,scriptPath,...process.argv.slice(2)],
 scope:'Actual production Generator -> module Worker -> SourcePerlinSession -> WebGL2 GPU backend, fixed 48x36 density1, seed 1771842692935, 128 CPU particles allocated by the common source model. Initial preview, one controlled 100ms live tick, pause, then equal nonempty palette edits while paused.',
 comparison:'Only src/scenes/sourcePerlin.ts is replaced by its pinned baseline via a Vite load plugin. Every other dependency is current working source for both variants. This isolates the session change; it is not a checkout or benchmark of the entire historical revision.',
 measurement:'Separate sequential Chrome family and Vite server for each variant/case. Cold phase includes first Worker import, initialization, initial preview, one running frame, pause controls and paused anchor. Warm phase is all palette edits on that retained owner. Every requested raster is fully delivered/read back and SHA256 hashed. Browser phase elapsed excludes process launch and page/main-module import. ps samples at boundaries and every250ms: CPU deltas by PID/start-time, summed RSS peak; sampling can miss transient peaks/short-lived children. Node/Vite CPU and memory are excluded. OS/driver caches are not flushed; warm RSS is total family RSS, not allocation delta. One sample per case/variant, no statistical speedup claim.',
 semanticDifference:'The baseline rebuilds source simulation/resources after each palette edit; the candidate retains the paused simulation and clock while recoloring. Actions and dimensions match, but resulting state/work and pixels need not match. No cross-version pixel-equivalence or native-parity claim.',
 unmeasured:['Agent token usage','GPU device time and VRAM','Original JVM/JOGL behavior and cost','Visible App/Inspector acceptance','Browser launch and page/main-module import cost','Node/Vite process cost','Flushed filesystem/driver-cache cold performance'],
 sourceSessionSha256:{before:sha(source.before),after:sha(source.after)},scriptSha256:beforeHashes['scripts/benchmark-source-perlin-palette.mjs'],sourceBefore:beforeHashes,
 node:process.version,results:[],failures:[],nativeParity:false,pixelEquivalenceClaim:false,
};
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'before-sourcePerlin.ts'),source.before);
await writeFile(resolve(directory,'after-sourcePerlin.ts'),source.after);
await writeFile(resolve(directory,'benchmark.mjs'),await readFile(scriptPath));
const persist=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
if(values['prepare-only']){
 console.log(JSON.stringify({status:'prepared-only',directory,baselineCommit,sourceSessionSha256:report.sourceSessionSha256,edits,measurementExecuted:false}));
}else{
 const started=performance.now();report.status='running';
 const freePort=async()=>{const s=socketServer();await new Promise((ok,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',ok);});const port=s.address().port;await new Promise((ok,fail)=>s.close(e=>e?fail(e):ok()));return port;};
 for(const fixture of cases)for(const variant of ['before','after']){
  const row={variant,case:fixture.id,status:'running',sourceSessionSha256:report.sourceSessionSha256[variant],errors:[],phases:[],cleanup:[]};
  report.results.push(row);let server,browserServer,browser,page,deadline;const substitutions=[];
  try{
   const port=await freePort();
   server=await createServer({root,mode:'preview-v2',plugins:[{name:'pinned-perlin-session-cost',enforce:'pre',load(id){
    if(id.split('?')[0]!==sourcePath)return null;
    substitutions.push({id,sha256:sha(source[variant])});return{code:source[variant],map:null};
   }}],server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});
   await server.listen();
   browserServer=await chromium.launchServer({channel:'chrome',headless:true});
   const child=browserServer.process(),rootPid=child.pid;if(!rootPid)throw Error('Owned Chrome root PID unavailable');
   row.process={rootPid,spawnfile:child.spawnfile,spawnargs:child.spawnargs};
   browser=await chromium.connect(browserServer.wsEndpoint());row.browser=browser.version();
   page=await browser.newPage({viewport:{width:320,height:240},deviceScaleFactor:1});page.setDefaultTimeout(120000);
   page.on('pageerror',e=>row.errors.push(String(e)));page.on('crash',()=>row.errors.push('page crashed'));
   // Owned-family close bounds a hung WebGL/Worker task without signaling unrelated PIDs.
   deadline=setTimeout(()=>{row.deadlineExpired=true;void browserServer?.close().catch(e=>row.errors.push(String(e)));},120000);
   await page.route('**/perlin-palette-cost',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Perlin palette cost</title>'}));
   await page.goto(server.resolvedUrls.local[0]+'perlin-palette-cost');
   await page.evaluate(async({fixture,edits})=>{
    const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts');
    const audit=globalThis.__perlinPaletteCost={workers:{created:0,terminated:0},frames:[],phases:[],disposed:false};
    const NativeWorker=globalThis.Worker;
    globalThis.Worker=class extends NativeWorker{
     constructor(...args){super(...args);audit.workers.created++;let ended=false;const stop=this.terminate.bind(this);this.terminate=()=>{if(!ended){ended=true;audit.workers.terminated++;}stop();};}
    };
    const scene=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Palette cost '+fixture.id,
     palette:['#FF2244','#44CC88','#3355EE'],settings:{render_mode:fixture.backend,cpu_render_style:fixture.style,
      seed:'1771842692935',particle_count:128,curve_count:12,curve_length:12,gpu_texture_style:3,
      dot_size:2,show_trails:false,accumulation:false},timeline:[{type:'wait',duration:2}]})).scene;
    scene.id='perlin-palette-cost-'+fixture.id;
    if(!scene.perlinSource||scene.perlinSource.backend!==fixture.backend.toLowerCase()||scene.perlinSource.cpuStyle!==(fixture.style==='FIELD_CURVES'?'field-curves':'particles')||scene.perlinSource.particles.count!==128||scene.perlinSource.curves.count!==12||scene.perlinSource.curves.length!==12)throw Error('Benchmark fixture was not imported exactly');
    const context={time:0,quality:'preview',width:48,height:36,sourcePerlinViewport:{width:48,height:36,pixelDensity:1},
     sourceViewport:{logicalWidth:48,logicalHeight:36,referenceLogicalHeight:36,target:'primary',projectionPass:'perspective'},
     perlinLive:{sessionId:'palette-cost-'+fixture.id,clock:{paused:true,timestampMs:1000}}};
    const generator=new Generator();let latest;
    const hash=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const frame=async(label,palette)=>{
     const started=performance.now();if(palette)scene.perlinSource.palette=[...palette];
     const output=await generator.generate(scene,context);latest=output;
     if(output.type!=='raster'||output.backend!=='webgl2'||output.width!==48||output.height!==36||output.pixels.byteLength!==48*36*4||!output.perlinLive||!output.sourcePerlinFrame)throw Error(label+': incomplete actual WebGL2 delivery');
     const evidence={label,palette:[...scene.perlinSource.palette],live:output.perlinLive,frame:output.sourcePerlinFrame,
      rgbaSha256:await hash(output.pixels),pixelBytes:output.pixels.byteLength,elapsedMs:performance.now()-started};
     audit.frames.push(evidence);return evidence;
    };
    globalThis.__perlinPalettePhase=async phase=>{
     const started=performance.now(),from=audit.frames.length;let status='completed',error;
     try{
      if(phase==='cold-initialization-and-paused-anchor'){
       await frame('initial');await generator.setPerlinPaused(latest,false,1000);
       context.perlinLive.clock={paused:false,timestampMs:1100};await frame('running-100ms');
       await generator.setPerlinPaused(latest,true,1100);context.perlinLive.clock={paused:true,timestampMs:9000};
       await frame('paused-anchor');
      }else{
       const palettes=Array.from({length:edits},(_,i)=>[
        (0xff000000|((i+1)*23<<16)|0x3377)>>>0,(0xff000000|0x220000|((i+1)*19<<8)|0xcc)>>>0,
        (0xff000000|0x997700|(i+1)*29)>>>0]);
       for(let i=0;i<palettes.length;i++)await frame('palette-'+i,palettes[i]);
      }
     }catch(e){status='failed';error={message:String(e.message??e),stack:e.stack};}
     const result={phase,status,error,elapsedMs:performance.now()-started,frames:audit.frames.slice(from),workers:{...audit.workers}};
     audit.phases.push(result);return result;
    };
    globalThis.__disposePerlinPaletteCost=()=>{generator.dispose();audit.disposed=true;return{workers:{...audit.workers},disposed:audit.disposed};};
   },{fixture,edits});
   for(const phase of ['cold-initialization-and-paused-anchor','warm-paused-palette-edits']){
    const start=performance.now();const measured=await measureFamily(rootPid,()=>page.evaluate(p=>globalThis.__perlinPalettePhase(p),phase));
    row.phases.push({...measured,controllerElapsedMs:performance.now()-start});await persist();
    if(measured.status!=='completed')throw Error(phase+': '+JSON.stringify(measured.error));
    if(measured.processFamily.samplingErrors.length)throw Error('Process-family sampling failed: '+measured.processFamily.samplingErrors.join('; '));
   }
   const [cold,warm]=row.phases,anchor=cold.frames.at(-1);
   if(cold.frames.length!==3||warm.frames.length!==edits||!anchor.live.paused||anchor.live.sceneTime<=0)throw Error('Incomplete common workload or invalid paused anchor');
   const counts=warm.frames.map(f=>f.live.constructions);
   row.observed={anchorConstructions:anchor.live.constructions,editConstructions:counts,
    editSceneTimes:warm.frames.map(f=>f.live.sceneTime),editUpdates:warm.frames.map(f=>f.frame.updates),anchorSceneTime:anchor.live.sceneTime,anchorUpdates:anchor.frame.updates,
    frames:3+edits,pixelBytes:(3+edits)*48*36*4,paletteChanges:edits};
   // releaseRuntime resets the exposed constructions counter to zero before
   // rebuilding. Do not misreport that counter as lifetime constructions.
   const initial=cold.frames[0];
   row.observed.constructionCounterMeaning='Current runtime counter; baseline releaseRuntime resets it, so equal counters alone do not prove retained resources.';
   row.observed.editsResetToInitial=warm.frames.map(f=>f.live.sceneTime===initial.live.sceneTime&&f.frame.updates===initial.frame.updates&&f.frame.frameIndex===initial.frame.frameIndex);
   if(variant==='before'&&row.observed.editsResetToInitial.some(v=>!v))throw Error('Baseline palette edit did not reproduce the initial clock/update state');
   if(variant==='after'&&warm.frames.some(f=>f.live.constructions!==anchor.live.constructions||f.live.sceneTime!==anchor.live.sceneTime||f.frame.updates!==anchor.frame.updates||f.frame.frameIndex!==anchor.frame.frameIndex))throw Error('Candidate changed paused construction/clock/update state');
   if(warm.frames.some(f=>!f.live.paused)||row.errors.length)throw Error('Playback/page error during paused workload');
   row.workerCleanup=await page.evaluate(()=>globalThis.__disposePerlinPaletteCost());
   if(row.workerCleanup.workers.created!==1||row.workerCleanup.workers.terminated!==1)throw Error('Expected one owned real Worker, disposed at completion');
   if(!substitutions.length||substitutions.some(s=>s.sha256!==row.sourceSessionSha256))throw Error('Pinned Vite session override was not used');
   row.status='completed';
  }catch(error){
   row.status='failed';row.error={message:String(error.message??error),stack:error.stack};
   row.partial=await page?.evaluate(()=>globalThis.__perlinPaletteCost).catch(()=>null);
   report.failures.push(fixture.id+'/'+variant+': '+row.error.message);
  }finally{
   clearTimeout(deadline);row.substitutions=substitutions;
   if(page&&!row.workerCleanup)row.workerCleanup=await page.evaluate(()=>globalThis.__disposePerlinPaletteCost?.()).catch(e=>({error:String(e)}));
   for(const [resource,close] of [['browserConnection',()=>browser?.close()],['ownedChromeFamily',()=>browserServer?.close()],['vite',()=>server?.close()]]){
    try{await close();row.cleanup.push({resource,status:'fulfilled'});}catch(e){row.cleanup.push({resource,status:'rejected',error:String(e)});report.failures.push(fixture.id+'/'+variant+': '+resource+' cleanup failed');}
   }
   row.chromeExit=browserServer?{exitCode:browserServer.process().exitCode,signalCode:browserServer.process().signalCode}:null;
   await persist();console.log(JSON.stringify({variant,case:fixture.id,status:row.status,error:row.error?.message,phases:row.phases.map(p=>({phase:p.phase,elapsedMs:p.elapsedMs,cpuMs:p.processFamily.observedCpuMs,peakRssKiB:p.processFamily.sampledPeakRssKiB}))}));
  }
 }
 report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(beforeHashes)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable)report.failures.push('Working sources changed during the comparison');
 report.comparisons=cases.map(c=>{
  const pair=report.results.filter(r=>r.case===c.id),a=pair.find(r=>r.variant==='before'),b=pair.find(r=>r.variant==='after');
  return{case:c.id,complete:a?.status==='completed'&&b?.status==='completed',equalRequestedEdits:edits,pixelEquivalenceClaim:false,
   phases:['cold-initialization-and-paused-anchor','warm-paused-palette-edits'].map(phase=>{
    const before=a?.phases.find(p=>p.phase===phase),after=b?.phases.find(p=>p.phase===phase);
    const facts=p=>p?{elapsedMs:p.elapsedMs,observedCpuMs:p.processFamily.observedCpuMs,sampledPeakRssKiB:p.processFamily.sampledPeakRssKiB,completedFrames:p.frames.length}:null;
    return{phase,before:facts(before),after:facts(after)};
   })};
 });
 report.elapsedMs=performance.now()-started;report.status=report.failures.length?'failed':'measured';
 await persist();console.log(JSON.stringify({status:report.status,directory,failures:report.failures,elapsedMs:report.elapsedMs}));
 if(report.failures.length)process.exitCode=1;
}
