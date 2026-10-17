import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Workload comparison of two local implementations. This does not run MathArt
// or replace pixels, clocks, solvers, shaders, or GPU calls in either owner.
const scriptPath='scripts/benchmark-roots-paused-compat.mjs';
const archive='.cache/roots-scene-timeline-baseline-3175';
const archivedSource=archive+'/source/studio/src';
const fixturesDirectory='.cache/roots-native-presentation-import-ui-run-1792112826806';
const directory=process.argv[2]??`.cache/roots-paused-compat-benchmark-${Date.now()}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message);};
// Ring diagnostics intentionally retain BigInt write ordinals. The evidence
// boundary preserves their exact decimal values with an explicit type tag.
function stringifyExact(value,space=0){return JSON.stringify(value,(_key,item)=>typeof item==='bigint'?{$type:'bigint',decimal:item.toString()}:item,space);}
async function files(directory){const out=[];for(const e of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+e.name;if(e.isDirectory())out.push(...await files(path));else if(e.isFile())out.push(path);else throw Error('Unexpected source entry: '+path);}return out;}
async function snapshot(){const paths=[...await files('src'),...await files(archivedSource),scriptPath,archive+'/manifest.json','package-lock.json',archive+'/source/studio/package-lock.json',fixturesDirectory+'/density-saved.mathart.json',fixturesDirectory+'/point-cloud-saved.mathart.json'];return Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,sha(await readFile(path))])));}
await mkdir(directory,{recursive:false});
const report={at:new Date().toISOString(),status:'running',scope:'Actual owned Chrome, equivalent complete camera-only cold-seek workloads: physically archived 3175 clock/session versus current session with separate capture targets and retained completed-frame metadata, with gradients dormant. Both advance every display frame and return one final presentation readback. Full RGBA and solver counts must match before paired timings are reported; paused PNG workload costs are measured separately.',serialization:{bigInt:'Objects with $type=bigint and decimal hold exact BigInt values, including diagnostics.ring.totalWrites; never converted to Number. The same encoding is used for structural roots-counter comparison.'},directory,sourceBefore:await snapshot(),pageErrors:[],cases:[]};
await writeFile(directory+'/benchmark.mjs',await readFile(scriptPath),{flag:'wx'});
const manifest=JSON.parse(await readFile(archive+'/manifest.json','utf8'));
let server,browser,page;

// Independent LINEAR-only F32 transcription, also checked against the retained
// 4-FPS hand vector. No production clock/easing/sceneAtTime is used here.
function cameraReference(fps,target,initial,clips){
 const F=Math.fround,dt=F(1/fps),camera=Object.fromEntries(Object.entries(initial).map(([k,v])=>[k,F(v)]));
 let rates=[0,0,0],index=0,runtime=0,current=false,startZoom=0,startRates=[],sceneTime=0,activeDt=0;
 for(let frame=0;frame<=target;frame++){
  if(index<clips.length){
   let remaining=current?Math.max(0,F(F(clips[index].duration)-runtime)):0;
   for(let i=index+(current?1:0);i<clips.length;i++)remaining=F(remaining+Math.max(0,F(clips[i].duration)));
   activeDt=remaining>0?Math.min(dt,remaining):0;sceneTime=F(sceneTime+activeDt);
   const clip=clips[index];if(!current){current=true;runtime=0;startZoom=camera.zoom;startRates=[...rates];}
   runtime=F(runtime+activeDt);const p=Math.max(0,Math.min(1,F(runtime/F(clip.duration))));
   if(clip.zoom!==undefined)camera.zoom=F(startZoom+F(F(F(clip.zoom)-startZoom)*p));
   if(clip.rates)rates=clip.rates.map((v,i)=>F(startRates[i]+F(F(F(v)-startRates[i])*p)));
   if(runtime>=F(clip.duration)){if(clip.rates)rates=clip.rates.map(F);index++;runtime=0;current=false;}
  }else{activeDt=dt;sceneTime=F(sceneTime+dt);}
  ['phi','theta','gamma'].forEach((key,i)=>camera[key]=F(camera[key]+F(rates[i]*dt)));
 }
 return{camera,rates,rawDt:dt,activeDt,sceneTime,queueIndex:index,queueComplete:index>=clips.length};
}
try{
 check(manifest.baseline===3175&&manifest.status==='verified_physical_copies','Expected the verified physical 3175 source archive');
 for(const [path,digest] of Object.entries(report.sourceBefore))if(path.startsWith(archivedSource+'/'))check(manifest.sourceManifest['studio/src/'+path.slice(archivedSource.length+1)]===digest,'Archived source hash mismatch: '+path);
 report.archive={path:archive,manifestSha256:report.sourceBefore[archive+'/manifest.json'],module:archivedSource+'/engine/rootsNativePresentationSession.ts',moduleSha256:report.sourceBefore[archivedSource+'/engine/rootsNativePresentationSession.ts'],verifiedSourceFiles:Object.keys(report.sourceBefore).filter(p=>p.startsWith(archivedSource+'/')).length,modified:false};
 report.dependencies={currentLock:report.sourceBefore['package-lock.json'],archivedLock:report.sourceBefore[archive+'/source/studio/package-lock.json'],sameLockedDependencies:report.sourceBefore['package-lock.json']===report.sourceBefore[archive+'/source/studio/package-lock.json'],runtimeNode:process.version};
 const hand=[.0625,.1875,.375,.625,.75,.75,.75];
 report.referenceSanity=hand.map((expected,frame)=>({frame,expected,actual:cameraReference(4,frame,{phi:0,theta:0,gamma:0,zoom:1},[{duration:1,rates:[1,0,0]},{duration:.5,rates:[0,0,0]}]).camera.phi}));
 check(report.referenceSanity.every(x=>x.actual===x.expected),'Independent hand-vector mismatch');
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});
 report.browserVersion=browser.version();report.endpoint=server.resolvedUrls.local[0];
 for(const [mode,fps,rates] of [['density',12,[0,0,.8]],['point-cloud',60,[.3,.4,.5]]]){
  const scene=JSON.parse(await readFile(`${fixturesDirectory}/${mode}-saved.mathart.json`,'utf8'));
  check(scene.rootsPresentation?.mode===mode&&scene.rootsMath?.sampling.sampleCount===100,'Accepted document fixture has drifted');
  scene.id='benchmark-roots-camera-'+mode;scene.name=scene.id;
  Object.assign(scene.settings,{rootSamplesPerFrame:1,rootSamplingFps:fps,rootStartTime:0});
  scene.rootsPresentation.accumulation.enabled=mode==='point-cloud';
  const initial=Object.fromEntries(['phi','theta','gamma','zoom'].map(k=>[k,scene.rootsPresentation.camera[k]]));
  const clips=[{duration:.5,rates},{duration:.5,zoom:.75},{duration:.5,rates:[0,0,0]},{duration:.5}];
  scene.timeline={duration:2,fps,loop:false,schedule:'roots-camera-sequence-v1',tracks:clips.map((clip,i)=>({id:'clip-'+i,label:'Benchmark clip '+i,type:i===3?'wait':'animate',target:'timeline.wait',from:0,to:0,start:0,duration:clip.duration,easing:'linear',pingPong:false,enabled:true,...(i===3?{}:{actions:[{id:'action-'+i,method:i===0?'ambient':i===1?'zoom':'stopAmbient',enabled:true,args:i===0?{phiSpeed:rates[0],thetaSpeed:rates[1],gammaSpeed:rates[2]}:i===1?{value:.75}:{}}]})}))};
  const targetFrame=Math.floor(1.75*fps),references=Array.from({length:targetFrame+1},(_,frame)=>cameraReference(fps,frame,initial,clips));
  const item={mode,fps,width:640,height:360,targetFrame,time:targetFrame/fps,displayFrames:targetFrame+1,fixture:scene,referenceFrames:references,rows:[],comparisons:[]};report.cases.push(item);
  await writeFile(`${directory}/${mode}-fixture.json`,JSON.stringify({scene,references},null,2)+'\n',{flag:'wx'});
  page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.route('**/roots-camera-benchmark',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local Roots camera workload</title>'}));
  await page.goto(report.endpoint+'roots-camera-benchmark');
  const oldUrl='/@fs/'+resolve(archivedSource+'/engine/rootsNativePresentationSession.ts');
  const loadStarted=performance.now();
  try{item.moduleLoad=await page.evaluate(async oldUrl=>{
   const [oldModule,newModule]=await Promise.all([import(oldUrl),import('/src/engine/rootsNativePresentationSession.ts')]);
   window.__bench={owners:{old:oldModule.RootsNativePresentationSession,current:newModule.RootsNativePresentationSession},rows:[],images:new Map(),active:undefined};
   // Observation only: every wrapped call invokes the actual native WebGL method.
   const prototype=WebGL2RenderingContext.prototype,originals=[],allocationPairs={createProgram:'deleteProgram',createShader:'deleteShader',createBuffer:'deleteBuffer',createTexture:'deleteTexture',createFramebuffer:'deleteFramebuffer',createVertexArray:'deleteVertexArray'};
   const deletions=Object.fromEntries(Object.entries(allocationPairs).map(([a,d])=>[d,a]));
   const names=[...Object.keys(allocationPairs),...Object.values(allocationPairs),'compileShader','linkProgram','drawArrays','drawElements','readPixels','getBufferSubData'];
   for(const name of names){const original=prototype[name];if(typeof original!=='function')continue;originals.push([name,original]);prototype[name]=function(...args){const s=window.__bench.active;if(s){s.calls[name]=(s.calls[name]??0)+1;s.contexts.add(this);}const result=original.apply(this,args);if(s){if(allocationPairs[name]&&result)s.live[name].add(result);else if(deletions[name])s.live[deletions[name]].delete(args[0]);if(name==='readPixels'){const target=args[6];if(ArrayBuffer.isView(target))s.readbackDestinationBytes+=target.byteLength;}}return result;};}
   window.__bench.newStats=()=>({calls:{},contexts:new Set(),live:Object.fromEntries(Object.keys(allocationPairs).map(k=>[k,new Set()])),readbackDestinationBytes:0});
   window.__bench.restore=()=>{for(const [name,original] of originals)prototype[name]=original;};
   return{oldModuleLoaded:true,currentModuleLoaded:true,userAgent:navigator.userAgent,oldUrl};
  },oldUrl);}catch(error){item.moduleLoad={error:String(error),oldUrl,archiveWasNotCopiedOrChanged:true};throw Error('Cannot load both physical production modules through Vite: '+error.message);}
  item.moduleLoad.elapsedWallMs=performance.now()-loadStarted;
  // Alternate route order after the first pair. Each run owns a fresh session
  // and GPU context; only browser/driver/module caches may remain warm.
  for(let repeat=0;repeat<3;repeat++)for(const route of repeat===1?['current','old']:['old','current']){
   await page.requestGC(); // Outside timing; does not assert actual GC/VRAM release.
   const row=await page.evaluate(async({scene,references,targetFrame,fps,route,repeat,width,height})=>{
    const state=window.__bench,Owner=state.owners[route],stats=state.newStats();state.active=stats;
    const fixture=structuredClone(scene),context={time:targetFrame/fps,width,height,quality:'export',rootsSessionId:'benchmark-instance',rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:height,target:'primary'}};
    const finalReference=references[targetFrame];
    let output,diagnostics,owner,bodyError,cleanupError,calls=0;const started=performance.now();let generatedAt;
    try{
     owner=new Owner();
     output=owner.generate(fixture,context);calls++;
     generatedAt=performance.now();diagnostics=owner.diagnostics();
    }catch(error){bodyError=error;}finally{try{owner?.reset();}catch(error){cleanupError=error;}}
    const finished=performance.now(),afterCleanup=owner?.diagnostics();state.active=undefined;
    const row={route,repeat,temperature:repeat===0?'first-instance':'warm-device-cache-new-instance',elapsedMs:finished-started,generationMs:generatedAt===undefined?undefined:generatedAt-started,cleanupMs:generatedAt===undefined?undefined:finished-generatedAt,generateCalls:calls,observedGl:{calls:stats.calls,contexts:stats.contexts.size,readbackDestinationBytes:stats.readbackDestinationBytes,liveHandlesAfterCleanup:Object.fromEntries(Object.entries(stats.live).map(([k,set])=>[k,set.size]))},diagnostics,afterCleanup,cleanupError:cleanupError?.message,error:bodyError?.message};
    state.rows.push(row);
    if(bodyError||cleanupError)throw new AggregateError([bodyError,cleanupError].filter(Boolean),'Actual production workload failed');
    if(afterCleanup.retainedBytes!==0||afterCleanup.density||afterCleanup.cloud||afterCleanup.ring)throw Error('Session retained resources after reset');
    if(Object.values(row.observedGl.liveHandlesAfterCleanup).some(n=>n!==0))throw Error('Observed GL handles were not explicitly released');
    if(output.type!=='raster'||output.backend!=='webgl2'||output.pixels.length!==width*height*4)throw Error('Expected complete actual WebGL raster');
    if(output.roots.attemptedSamples!==Math.min(scene.rootsMath.sampling.sampleCount,targetFrame+1)||output.rootsPresentation.totalRawPoints!==2*output.roots.attemptedSamples||output.roots.invalidSamples!==0)throw Error('Final mathematical arrival counts mismatch');
    {
     const c=output.rootsPresentation.cameraTimeline;
     if(!c||c.framesAdvanced!==targetFrame+1||c.displayFrames!==targetFrame+1||c.readbacks!==1)throw Error('Current cold seek did not advance all frames with one final presentation readback');
     for(const key of ['phi','theta','gamma','zoom'])if(c.camera[key]!==finalReference.camera[key])throw Error('Current camera differs from independent reference: '+key);
     for(const key of ['rawDt','activeDt','sceneTime','queueIndex','queueComplete'])if(c[key]!==finalReference[key])throw Error('Current clock differs from independent reference: '+key);
    }
    let nonzeroRgb=0;for(let i=0;i<output.pixels.length;i+=4)if(output.pixels[i]||output.pixels[i+1]||output.pixels[i+2])nonzeroRgb++;
    if(!nonzeroRgb)throw Error('Final fixture is entirely black');
    row.nonzeroRgb=nonzeroRgb;row.roots=output.roots;row.facts=output.rootsPresentation;row.warnings=output.warnings;
    row.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output.pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');
    state.images.set(route+'-'+repeat,output.pixels);
    return row;
   },{scene,references,targetFrame,fps,route,repeat,width:item.width,height:item.height});
   item.rows.push(row);
   await writeFile(`${directory}/${mode}-${route}-${repeat}.json`,stringifyExact(row,2)+'\n',{flag:'wx'});
  }
  item.comparisons=await page.evaluate(()=>{
   const images=window.__bench.images,comparisons=[];
   const compare=(a,b)=>{const x=images.get(a),y=images.get(b);let changedChannels=0,maxDifference=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d)changedChannels++;maxDifference=Math.max(d,maxDifference);}return{left:a,right:b,channels:x.length,changedChannels,maxDifference};};
   for(let repeat=0;repeat<3;repeat++){comparisons.push(compare('old-'+repeat,'current-'+repeat));if(repeat)for(const route of ['old','current'])comparisons.push(compare(route+'-0',route+'-'+repeat));}
   return comparisons;
  });
  check(item.comparisons.every(c=>c.changedChannels===0),'Final full RGBA differs; timings do not establish equivalent-work improvement');
  for(let repeat=0;repeat<3;repeat++){
   const old=item.rows.find(r=>r.route==='old'&&r.repeat===repeat),current=item.rows.find(r=>r.route==='current'&&r.repeat===repeat);
   check(stringifyExact(old.roots)===stringifyExact(current.roots),'Final mathematical counters differ between routes');
  }
  item.matchedTimings=Array.from({length:3},(_,repeat)=>{const old=item.rows.find(r=>r.route==='old'&&r.repeat===repeat),current=item.rows.find(r=>r.route==='current'&&r.repeat===repeat);return{repeat,temperature:old.temperature,oldCompletedMs:old.elapsedMs,currentCompletedMs:current.elapsedMs,oldPerCurrent:old.elapsedMs/current.elapsedMs,oldGenerateCalls:old.generateCalls,currentGenerateCalls:current.generateCalls,oldGlReadPixels:old.observedGl.calls.readPixels??0,currentGlReadPixels:current.observedGl.calls.readPixels??0,oldPrograms:old.observedGl.calls.createProgram??0,currentPrograms:current.observedGl.calls.createProgram??0};});
  await page.evaluate(()=>window.__bench.restore());await page.close();page=undefined;
 }
 check(report.pageErrors.length===0,'Unexpected browser page error');report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};report.partial=await page?.evaluate(()=>({rows:window.__bench?.rows})).catch(()=>undefined);process.exitCode=1;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,viteClosed:server?!server.httpServer?.listening:true,errors:closed.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};
 report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable||!report.cleanup.browserClosed||!report.cleanup.viteClosed||report.cleanup.errors.length){report.status='failed';process.exitCode=1;}
 report.limitations=[
  'Old route executes the physical archived 3175 local session, not the original application. Both routes consume exactly the same explicit camera-only timeline; retained gradient fields are absent. Independent LINEAR-only F32 values check both final clock states.',
  'Only two finite workloads are measured: density at 12 FPS and accumulated point cloud at 60 FPS, 640x360, 100-sample x^2-0.04*t2 ensemble. No other scenes, duration, resolution, easing, worker concurrency, UI, or original runtime speed claim follows.',
  'Session construction, all generation/readback calls, and reset are timed; module loading, reference/fixture construction, hashing and pixel comparisons are separate. Public Worker transport, App layout and encoding are excluded.',
  'First-instance means the first measured session of that route in this page. GPU process/driver shader caches cannot be reset or observed, so this is not a proven cold GPU cache. Two new-instance repeats retain browser/device caches; route order alternates after the first pair.',
  'A garbage collection request is made before each run outside timing; actual collection and driver VRAM release are not inferred. Session diagnostics and observed GL handle deletion are checked independently.',
  'Actual readPixels counts include allocation probes and readback verification; they are deliberately distinct from the presentation readback strategy (both final only). Counters observe real calls without suppressing or substituting work.',
  'Whole process-family CPU time, peak RSS, process cleanup and wall time require the external measurement supervisor. JavaScript elapsed values alone do not establish CPU, memory, driver VRAM, or agent token savings.',
 ];
 await writeFile(directory+'/report.json',stringifyExact(report,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({report:directory+'/report.json',status:report.status,sourceStable:report.sourceStable,cases:report.cases.length,error:report.error?.message,cleanup:report.cleanup}));
}
