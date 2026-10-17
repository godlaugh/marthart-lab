/** Complete source-frame recording-plan tasks. Run one case per external
 * process-family measurement; this script never starts the original app/JVM. */
import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const caseName=process.env.SPIROGRAPH_QUEUE_CASE;
const output=process.env.SPIROGRAPH_QUEUE_REPORT;
const cases=Object.fromEntries([10,100,1000].flatMap(count=>[['short',.001],['quarter',.25]].map(([label,duration])=>[`${count}-${label}`,{count,duration}])));
if(!output||(!Object.hasOwn(cases,caseName??'')&&caseName!=='boundaries'))throw Error('Set SPIROGRAPH_QUEUE_CASE to 10/100/1000-short/quarter or boundaries and an explicit new SPIROGRAPH_QUEUE_REPORT');
try{await stat(output);throw Error('Refusing to overwrite existing report '+output);}catch(error){if(error.code!=='ENOENT')throw error;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceFiles(directory){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())result.push(...await sourceFiles(path));else if(/\.(ts|tsx|json)$/.test(entry.name))result.push(path);}return result;}
const paths=[...(await sourceFiles('src')),'scripts/verify-spirograph-clock-queue-cost.mjs','.cache/measure-navigation-task.py'].sort();
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:hash(await readFile(path))})));
const report={startedAt:new Date().toISOString(),caseName,case:cases[caseName]??null,sourceStart:await snapshot(),scope:'One isolated 60 fps source-frame recording queue; three new-worker cold tasks and the same-worker warm task after each. Final actual Generator raster requests are timed separately. No original app/JVM.',limits:['Cold means a fresh production Generator Worker, not a flushed OS/browser/Vite cache. Warm repeats the identical complete recording plan in that same Worker.','Plan completion is checked against actual final delivered frame facts; this cost measurement is not an independent native arithmetic oracle.','The external 50 ms process-family observer supplies elapsed/CPU/peak sampled RSS. Per-task page timings do not supply CPU or process memory.','Retained-byte diagnostics are estimated numeric checkpoint payloads, not JS heap, RSS or GPU memory.','The boundaries case is not a performance comparison. It inserts only a pre-planning worker notification through Vite in memory to prove cancellation after entering the actual handler.','Original live timing, Processing raster, VRAM, token counts and tool fees are unmeasured.']};
const taskStarted=Date.now();
let server,browser,page;
let enteredTransformCount=0;
try{
 const plugins=caseName==='boundaries'?[{name:'queue-cancel-entry-evidence',enforce:'pre',transform(code,id){if(!id.split('?')[0].endsWith('/src/engine/generate.worker.ts'))return;
  const needle="if(event.data.operation==='spirograph-recording-plan'){";
  if(!code.includes(needle))throw Error('Worker entry contract changed; cannot prove entered cancellation');
  enteredTransformCount++;
  return{code:code.replace(needle,needle+"\n      self.postMessage({__spirographQueueEntered:true,requestId:event.data.id});"),map:null};
 }}]:[];
 server=await createServer({plugins,server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});page=await browser.newPage();
 await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Spirograph queue cost</title>'}));await page.goto(origin,{timeout:10000});
 await page.exposeFunction('queueCostProgress',async value=>{report.partial=value;await writeFile(output,JSON.stringify(report,null,2)+'\n');});
 report.result=await page.evaluate(async({caseName,selected,budgetMs})=>{
  const {Generator}=await import('/src/engine/client.ts');
  const result=globalThis.__queueCostResult={rows:[],terminal:[],boundaries:[],workers:{created:0,active:0},input:null,inputSha256:null};
  const check=(ok,label)=>{if(!ok)throw Error(label);};
  const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const textSha=value=>sha(new TextEncoder().encode(JSON.stringify(value)));
  const progress=()=>globalThis.queueCostProgress(result);
  const NativeWorker=globalThis.Worker;let entryListener;
  globalThis.Worker=class extends NativeWorker {
   constructor(...args){super(...args);this.queueOwned=true;result.workers.created++;result.workers.active++;this.addEventListener('message',event=>{if(event.data?.__spirographQueueEntered)entryListener?.(event.data.requestId);});}
   terminate(){if(this.queueOwned){this.queueOwned=false;result.workers.active--;}return super.terminate();}
  };
  const fixture=(count,duration)=>({version:1,id:`queue-cost-${count}-${duration}`,name:'Source queue measurement',kind:'spirograph',equations:{},parameters:{},favorite:false,
   settings:{spirographVersion:'mathart-1.7.8-v1',spirographClock:'source-frame-v1',spirographSimulationFps:60,spiroView:'native',count:128,animate:true,rotationSpeed:0,rotation:0,scale:1,showTrace:true,transparentBackground:false,background:'#080b12',startEaseEnabled:false,endEaseEnabled:false,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,
    layers:JSON.stringify([{id:'orbit',name:'Infinite queue probe',statorRadius:20,rotors:[{radius:8,mode:'inside'}],penDistance:6,speed:.7,autoStopOnClosure:false,showGuides:false,visible:true,enabled:true,strokeColor:'#ffffff',strokeWidth:1,opacity:1}])},
   palette:{name:'plain',stops:['#000000','#ffffff'],mode:'linear',offset:0,cycles:1},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},spirographFrameEvents:[],
   timeline:{duration:Math.max(.1,count*duration),fps:30,loop:false,schedule:'spirograph-sequence-v1',tracks:Array.from({length:count},(_,i)=>({id:'rotate-'+i,type:'animate',target:'camera.actions',enabled:true,start:0,duration,from:0,to:0,easing:'linear',actions:[{id:'rate-'+i,method:'spirographRotate',enabled:true,args:{speed:[-.2,.3,.125,-.1][i%4]}}]}))}});
  let activeGenerator=null;
  // Leaves browser startup/teardown headroom within the requested 60 second cell.
  let rejectBudget;const budget=new Promise((_,reject)=>{rejectBudget=reject;});
  const watchdog=setTimeout(()=>{activeGenerator?.cancel();rejectBudget(Error('Queue measurement exceeded its 55 second task budget'));},budgetMs);
  try{return await Promise.race([(async()=>{
   if(caseName!=='boundaries'){
    const scene=fixture(selected.count,selected.duration);result.input=scene;result.inputSha256=await textSha(scene);
    let expectedPlan,expectedTerminalHash;
    for(let repeat=0;repeat<3;repeat++){
     const g=activeGenerator=new Generator();
     try{
      for(const condition of ['cold-new-worker','warm-same-worker']){
       const start=performance.now(),plan=await g.planSpirographRecording(scene,0,60),elapsedMs=performance.now()-start;
       check(plan.finished&&plan.updates>=selected.count&&plan.encodedFrames===plan.updates-1&&plan.firstEncodedUpdate===2,'Recording plan did not complete every queue entry');
       if(expectedPlan)check(JSON.stringify(expectedPlan)===JSON.stringify(plan),'Cold/warm plan facts drifted');else expectedPlan=plan;
       result.rows.push({repeat,condition,elapsedMs,inputSha256:result.inputSha256,queueLength:selected.count,authoredClipSeconds:selected.duration,simulationFps:60,plan,warmOrdinal:condition==='warm-same-worker'?1:0});await progress();
      }
      const request={time:0,width:64,height:48,quality:'export',spirographFrame:{frame:expectedPlan.updates,recording:{startFrame:0,fps:60}}};
      const start=performance.now(),out=await g.generate(scene,request),elapsedMs=performance.now()-start,f=out.spirographFrame;
      check(out.type==='raster'&&out.width===64&&out.height===48&&out.pixels.length===64*48*4,'Terminal Generator raster incomplete');
      check(f?.recordingFinished&&f.queueFinished&&f.queueIndex===selected.count&&f.frame===expectedPlan.updates&&f.encodedFrames===expectedPlan.encodedFrames,'Terminal frame disagrees with completed plan');
      check(f.clips.length===selected.count&&f.clips.every(c=>c.startFrame!==null&&c.endFrame!==null),'At least one queue entry was not executed');
      const signature=await textSha({frame:f,pixelSha256:await sha(out.pixels)});if(expectedTerminalHash)check(signature===expectedTerminalHash,'Terminal source/raster facts drifted');else expectedTerminalHash=signature;
      result.terminal.push({repeat,elapsedMs,producerElapsedMs:out.stats.elapsedMs,request,frame:f.frame,absoluteFrame:f.absoluteFrame,sceneTime:f.sceneTime,queueIndex:f.queueIndex,rotationRadians:f.rotationRadians,phases:f.phases,encodedFrames:f.encodedFrames,recordingFinished:f.recordingFinished,signature});await progress();
     }finally{g.dispose();activeGenerator=null;}
     check(result.workers.active===0,'A Generator Worker remained owned after dispose');
    }
   }else{
    const small=fixture(10,.25),long=fixture(1000,20),g=activeGenerator=new Generator();
    try{
     await g.planSpirographRecording(small,0,60); // actual warm worker, no import-only cancellation
     let entered=false,resolveEntry;
     const entry=new Promise(resolve=>{resolveEntry=resolve;});
     entryListener=()=>{entered=true;g.cancel();resolveEntry();};
     const outcome=g.planSpirographRecording(long,0,60).then(value=>({value}),error=>({error:error.name,message:error.message}));
     await entry;const cancelled=await outcome;entryListener=undefined;
     check(entered&&cancelled.error==='AbortError','Warm worker planning did not enter and cancel');check(result.workers.active===0,'Cancelled Worker still owned');
     const recovery=await g.planSpirographRecording(small,0,60);check(recovery.finished&&recovery.encodedFrames>0,'Cancellation recovery failed');
     result.boundaries.push({kind:'entered-warm-worker-cancel-and-recover',inputSha256:await textSha(long),entered,error:cancelled.error,recovery,workerGenerations:result.workers.created});
    }finally{g.dispose();activeGenerator=null;entryListener=undefined;}
    // Public session lifetime with read-only inspection of existing internal
    // core diagnostics; no production API or state is altered by this probe.
    const {SpirographFrameSession}=await import('/src/engine/spirographFramePlan.ts'),session=new SpirographFrameSession();
    const scene=fixture(1000,.25),plan=session.recordingPlan(scene,0,60);
    const preview=session.replay,recording=session.recording;
    check(preview&&recording,'Session did not retain the expected owned plans');
    const before={preview:preview.diagnostics(),recording:recording.diagnostics()};
    check(before.preview.retainedCheckpoints<=6&&before.recording.retainedCheckpoints<=6,'Checkpoint cache is unbounded');
    session.reset();const after={preview:preview.diagnostics(),recording:recording.diagnostics()};
    check(after.preview.disposed&&after.recording.disposed&&after.preview.retainedCheckpoints===0&&after.recording.retainedCheckpoints===0,'Session reset did not dispose both replay owners');
    result.boundaries.push({kind:'session-complete-reset',plan,before,after,inputSha256:await textSha(scene),inspection:'Read-only access to TypeScript-private JS fields for diagnostics, not a public consumer contract'});
   }
   check(result.workers.active===0,'Worker ownership leaked');await progress();return result;
  })(),budget]);}finally{clearTimeout(watchdog);activeGenerator?.dispose();globalThis.Worker=NativeWorker;}
 },{caseName,selected:cases[caseName]??null,budgetMs:Math.max(1000,55000-(Date.now()-taskStarted))});
 report.browser=browser.version();
}catch(error){report.error=String(error?.stack??error);try{report.partial=await page?.evaluate(()=>globalThis.__queueCostResult);}catch{}}
finally{
 await browser?.close();await server?.close();report.enteredTransformCount=enteredTransformCount;
 report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);
 report.finishedAt=new Date().toISOString();report.status=!report.error&&report.sourceStable?'passed':'failed';
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,caseName,status:report.status,sourceStable:report.sourceStable,plans:report.result?.rows.length,terminals:report.result?.terminal.length,error:report.error}));if(report.status!=='passed')process.exitCode=1;
}
