import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const run=promisify(execFile),sha=data=>createHash('sha256').update(data).digest('hex');
const reportPath='.cache/v2-source-attractor-gpu-public-cost.json';
const sourceHashes=async()=>{
 const paths=(await readdir('src',{recursive:true})).filter(path=>/\.(ts|tsx|json)$/.test(path)).map(path=>'src/'+path);
 paths.push('scripts/benchmark-source-attractor-gpu-public.mjs');paths.sort();
 return Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
};
function cpuSeconds(text){
 const [daysPart,timePart]=text.includes('-')?text.split('-'):['0',text],parts=timePart.split(':').map(Number);
 if(parts.some(n=>!Number.isFinite(n))||!Number.isFinite(Number(daysPart)))throw Error('Unrecognized ps CPU time '+text);
 return Number(daysPart)*86400+parts.reverse().reduce((sum,n,i)=>sum+n*60**i,0);
}
async function familySnapshot(rootPid){
 const {stdout}=await run('ps',['-axo','pid=,ppid=,time=,rss=,lstart='],{maxBuffer:8*1024*1024});
 const rows=stdout.trim().split('\n').map(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);if(!match)throw Error('Unrecognized ps row');
  return{pid:Number(match[1]),ppid:Number(match[2]),cpuSeconds:cpuSeconds(match[3]),rssKiB:Number(match[4]),identity:match[1]+':'+match[5]};
 });
 const included=new Set([rootPid]);let changed=true;while(changed){changed=false;for(const row of rows)if(included.has(row.ppid)&&!included.has(row.pid)){included.add(row.pid);changed=true;}}
 if(!rows.some(row=>row.pid===rootPid))throw Error('Owned browser root process disappeared');
 return rows.filter(row=>included.has(row.pid));
}
async function measureFamily(rootPid,task){
 const seen=new Map(),failures=[];let samples=0,peakRssKiB=0,maxProcesses=0,stopped=false,timer;
 const sample=async baseline=>{
  try{
   const rows=await familySnapshot(rootPid);samples++;peakRssKiB=Math.max(peakRssKiB,rows.reduce((n,r)=>n+r.rssKiB,0));maxProcesses=Math.max(maxProcesses,rows.length);
   for(const row of rows){const old=seen.get(row.identity);if(old)old.maximum=Math.max(old.maximum,row.cpuSeconds);else seen.set(row.identity,{pid:row.pid,baseline:baseline?row.cpuSeconds:0,maximum:row.cpuSeconds});}
  }catch(error){failures.push(String(error));}
 };
 await sample(true);
 const tick=async()=>{await sample(false);if(!stopped)timer=setTimeout(()=>{pending=tick();},250);};let pending=Promise.resolve();timer=setTimeout(()=>{pending=tick();},250);
 let result;try{result=await task();}finally{stopped=true;clearTimeout(timer);await pending;await sample(false);}
 return{...result,processFamily:{rootPid,samples,observedProcesses:seen.size,maxConcurrentProcesses:maxProcesses,sampledPeakRssKiB:failures.length?null:peakRssKiB,observedCpuMs:failures.length?null:1000*[...seen.values()].reduce((n,p)=>n+Math.max(0,p.maximum-p.baseline),0),samplingErrors:failures}};
}
const report={at:new Date().toISOString(),scope:'31 independent public generateScene queries at 30 FPS, each followed by actual sceneAtTime camera query, at 640x360; default source GPU 200000 particles, Lorenz, 5 substeps, source default variable dt and zero warmup. Complete RGBA8 readback, camera agreement and SHA256 included.',comparison:{baseline:null,comparable:false,reason:'No equivalent earlier native-style GPU public workflow baseline exists. CPU Euler/trails is a different task and is not used as a speed baseline.'},measurement:'One owned headless Chrome process family; first cold task then fresh warm task in the same page after module loading. Each task imports, serializes and reopens its input, then performs 31 independent requests with fresh GPU contexts; no evolving state is shared between queries. Chrome launch, Vite/module compilation and module import excluded from task elapsed. Cold does not mean flushed filesystem/GPU-driver caches. ps samples every 250ms plus boundaries; CPU is summed cumulative process time deltas keyed by PID and start time, including newly observed descendants. Exited processes between samples can make CPU an underestimate; sampled aggregate RSS is a lower bound on instantaneous peak, not peak VRAM. Sampling overhead is included; Node/Vite processes and unrelated Chrome instances excluded.',unmeasured:['Agent token usage','Native JVM/JOGL timing or image parity','GPU device time and VRAM','Browser launch and module loading elapsed','PNG/MP4 encoding','CPU consumed by browser children that start and exit entirely between ps snapshots'],nativeParity:false,results:[]};
let browserServer,browser,server;
try{
 const before=await sourceHashes();
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browserServer=await chromium.launchServer({channel:'chrome',headless:true});const rootPid=browserServer.process().pid;if(!rootPid)throw Error('Owned Chrome PID unavailable');
 browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/gpu-cost',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'gpu-cost');
 report.browserVersion=browser.version();report.nodeVersion=process.version;
 await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts'),{generateScene}=await import('/src/engine/temporal.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');
  const source={config_version:'1.0.0',type:'ATTRACTOR',name:'Default GPU complete-query cost',equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},settings:{render_mode:'GPU',sub_steps:5,scale_x:6,scale_y:6,scale_z:6,offset_z:-150},camera:{phi:Math.PI/2,theta:0,gamma:0},timeline:[{type:'animate',duration:2,easing:'LINEAR',actions:[{method:'rotatePhi',args:[.5]},{method:'track',args:[7]}]}]};
  window.__gpuCostTask=async()=>{
   const started=performance.now(),frames=[];let outputBytes=0;const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
   try{
    const scene=parseScene(serializeScene(parseProjectFile(JSON.stringify(source)).scene));scene.timeline.fps=30;
    if(scene.attractorSource.configuration.particleCountGPU!==200000||scene.attractorSource.configuration.stepsPerFrame!==5)throw Error('Source default workload changed');
    for(let i=0;i<31;i++){
     const time=i/30,begin=performance.now(),output=generateScene(scene,{time,width:640,height:360,quality:'export',sourceViewport:{logicalWidth:640,logicalHeight:360,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'}}),generated=performance.now();
     const camera=sceneAtTime(scene,time).evaluatedSourceCamera,queried=performance.now();
     if(output.type!=='raster'||output.backend!=='webgl2'||output.stats.generated!==200000||output.pixels.length!==640*360*4)throw Error('Incomplete default GPU public output');
     if(!camera||camera.frameIndex!==output.sourceCameraFrame.frameIndex||JSON.stringify(camera.camera)!==JSON.stringify(output.sourceCameraFrame.camera))throw Error('Public camera query differs from generated frame');
     outputBytes+=output.pixels.byteLength;
     frames.push({index:i,time,frameIndex:camera.frameIndex,generated:output.stats.generated,generationMs:generated-begin,cameraQueryMs:queried-generated,pixelsSha256:await digest(output.pixels),cameraSha256:await digest(new TextEncoder().encode(JSON.stringify(camera.camera)))});
    }
    return{status:'completed',elapsedMs:performance.now()-started,outputBytes,frames,configuration:scene.attractorSource.configuration};
   }catch(error){return{status:'failed',elapsedMs:performance.now()-started,outputBytes,frames,error:{name:error.name,code:error.code??null,message:error.message}};}
  };
 });
 for(const temperature of ['cold-first-task','warm-fresh-task']){
  const row=await measureFamily(rootPid,()=>page.evaluate(()=>window.__gpuCostTask()));report.results.push({temperature,...row});
  if(row.status!=='completed')throw Error(temperature+': '+row.error.message);
 }
 const [cold,warm]=report.results;report.repeatStable=cold.frames.every((frame,i)=>frame.pixelsSha256===warm.frames[i]?.pixelsSha256&&frame.cameraSha256===warm.frames[i]?.cameraSha256);
 if(!report.repeatStable)throw Error('Fresh cold/warm outputs differ');if(errors.length)throw Error('Browser errors: '+errors.join('; '));
 const after=await sourceHashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(after);report.sources=after;if(!report.sourceStable)throw Error('Source changed during measurement');
 report.pageErrors=errors;report.status='passed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup=cleanup.map((result,i)=>({resource:['browser-connection','vite'][i],status:result.status,...(result.status==='rejected'?{error:String(result.reason)}:{})}));
 try{await browserServer?.close();report.cleanup.push({resource:'owned-browser-process',status:'fulfilled'});}catch(error){report.cleanup.push({resource:'owned-browser-process',status:'rejected',error:String(error)});}
 if(report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,repeatStable:report.repeatStable,results:report.results.map(({temperature,status,elapsedMs,outputBytes,frames,processFamily,error})=>({temperature,status,elapsedMs,outputBytes,completedQueries:frames.length,processFamily,error}))},null,2));
}
