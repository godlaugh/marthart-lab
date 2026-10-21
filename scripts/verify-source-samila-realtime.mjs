/** Independent fixed-bytecode millis traces -> actual scalar owner + WebGL.
 * Run from studio/: python3 scripts/source-samila-realtime-oracle.py
 * node scripts/verify-source-samila-realtime.mjs [report-dir]
 * No GUI, native clock/RNG or original-runtime pixel identity is claimed.
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as tcp} from 'node:net';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
if(process.argv.includes('--help')){console.log('node scripts/verify-source-samila-realtime.mjs [report-dir]');process.exit(0);}
const directory=process.argv[2]??'.cache/source-samila-realtime',sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(directory,{recursive:true});
execFileSync('python3',['scripts/source-samila-realtime-oracle.py','--check']);
const fixturePath='.cache/samila-realtime-oracle/fixture.json',fixtureBytes=await readFile(fixturePath),fixture=JSON.parse(fixtureBytes);
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const p=e.parentPath+'/'+e.name;return[p,sha(await readFile(p))];})));
const report={status:'running',fixtureSha256:sha(fixtureBytes),provenance:fixture.provenance,scriptSha256:sha(await readFile(new URL(import.meta.url))),sourceBefore:await hashes(),limits:['Expected state comes from independently transcribed fixed-JAR bytecode and the retained easing interpreter; original Java and native UI are not executed.','Camera/queue float32 comparisons are bit-exact. Parameter doubles allow normalized absolute error 2e-12 for host libm.','Controlled integer milliseconds and seed words test semantics, not real native timing or RNG identity.','Scalar trace covers all three paused-angle edits; GPU uses the public theta-only edit seam, separately from the three-angle trace.','Only elapsed functional wall time is measured; CPU, process-family peak memory, native cadence and performance are unmeasured.']},started=performance.now();
let browser,server,page;
try {
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();report.browserVersion=browser.version();
 await page.route('**/realtime-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'realtime-fixture');
 report.result=await page.evaluate(async fixture=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{SourceSamilaHostClock}=await import('/src/engine/sourceSamilaHostClock.ts'),{SourceSamilaTimelineSession}=await import('/src/engine/sourceSamilaReplay.ts'),{SourceSamilaSession}=await import('/src/engine/sourceSamilaSession.ts');
  const result={cases:[],assertions:0};window.__realtimeEvidence=result;
  const bits=value=>{const d=new DataView(new ArrayBuffer(4));d.setFloat32(0,value);return d.getUint32(0).toString(16).padStart(8,'0');};
  const assert=(v,m)=>{result.assertions++;if(!v)throw Error(m);};
  const compare=(actual,expected,label)=>{
   for(const k of ['sceneTime','rawDt','activeDt'])assert(bits(actual[k])===bits(expected[k]),`${label} ${k}: ${actual[k]} != ${expected[k]}`);
   for(const k of ['queueIndex','queueComplete','parameterWriteRevision'])assert(actual[k]===expected[k],`${label} ${k}: ${actual[k]} != ${expected[k]}`);
   for(const k of ['phi','theta','gamma'])assert(bits(actual.camera[k])===expected.cameraBits[k],`${label} camera.${k}: ${actual.camera[k]} != ${expected.camera[k]}`);
   assert(JSON.stringify(Object.keys(actual.parameters).sort())===JSON.stringify(Object.keys(expected.parameters).sort()),label+' parameter keys');
   for(const [k,v]of Object.entries(expected.parameters))assert(Number.isFinite(actual.parameters[k])&&Math.abs(actual.parameters[k]-v)/Math.max(1,Math.abs(v))<=2e-12,`${label} parameter ${k}: ${actual.parameters[k]} != ${v}`);
  };
  const run=async(name,body)=>{const row={name,status:'running',events:[]};result.cases.push(row);try{await body(row);row.status='passed';}catch(e){row.status='failed';row.error=String(e.stack??e);}};
  for(const item of fixture.cases)await run('scalar: '+item.name,async row=>{
   let scene=parseLegacyScene(JSON.stringify(item.raw)).scene,timeline,clock,paused=item.paused??false;
   const init=()=>{timeline=new SourceSamilaTimelineSession(scene,true);clock=new SourceSamilaHostClock(paused,timeline.snapshot().camera);};init();
   try{for(const entry of item.expected){const event=entry.input;
    if(event.kind==='apply'){timeline.reset();scene=parseLegacyScene(JSON.stringify(event.raw??item.raw)).scene;init();}
    else if(event.kind==='pause'||event.kind==='resume'){paused=event.kind==='pause';const restore=clock.setPaused(paused,timeline.snapshot().camera,event.millis);if(restore)timeline.writeAngles(restore);}
    else if(event.kind==='camera')timeline.writeAngles(event.angles);
    else if(event.kind==='update')timeline.step(clock.update({paused,timestampMs:event.millis}),paused);
    const actual=timeline.snapshot(),host=clock.diagnostics();row.events.push({input:event,actual,host});
    // Display/capture/transition do not themselves call Scene.update. Their
    // source expected zero delta describes the event, not a new frame snapshot.
    compare({...actual,rawDt:entry.updated?actual.rawDt:0,activeDt:entry.updated?actual.activeDt:0},entry.expected,event.kind+'#'+entry.ordinal);
    assert(bits(host.lastTime)===entry.lastTimeBits,'lastTime bits');assert(host.paused===entry.paused,'paused state');for(const k of ['phi','theta','gamma'])assert(bits(host.savedAngles[k])===bits(entry.savedAngles[k]),'saved '+k);
   }}finally{timeline.reset();row.cleanup='reset';}
  });
  // Full GPU pipeline exercises every trace without a private three-angle setter.
  for(const item of fixture.cases.filter(c=>!c.events.some(e=>e.kind==='camera')))await run('WebGL: '+item.name,async row=>{
   let scene=parseLegacyScene(JSON.stringify(item.raw)).scene,paused=item.paused??false,epoch=0,words=0,output,context;
   const owner=new SourceSamilaSession({samilaSeedProvider:()=>++words});
   const setContext=millis=>{context={time:0,width:64,height:48,quality:'export',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:item.name+'-'+epoch,pixelDensity:1,clock:{paused,timestampMs:millis}}};};
   try{for(const entry of item.expected){const event=entry.input,before=owner.diagnostics(),beforeWords=words;
    if(event.kind==='apply'){owner.reset();scene=parseLegacyScene(JSON.stringify(event.raw??item.raw)).scene;epoch++;output=undefined;}
    else if(event.kind==='pause'||event.kind==='resume'){paused=event.kind==='pause';owner.setPaused(paused,event.millis);context.samilaLive.clock.paused=paused;assert(words===beforeWords,'transition drew/consumed seed');assert(owner.diagnostics().displayIndex===before.displayIndex,'transition display changed');}
    else if(event.kind==='capture'){const result=owner.capturePaused(scene,context);output=result.preview;assert(words===beforeWords+2,'capture requires two display words');assert(JSON.stringify(owner.diagnostics().runtime)===JSON.stringify(before.runtime),'capture advanced runtime');}
    else if(event.kind==='update'){setContext(event.millis);output=owner.generate(scene,context);assert(output.backend==='webgl2','not real WebGL');assert(words===beforeWords+1,'display random word count');}
    if(event.kind==='apply')continue;
    const diagnostics=owner.diagnostics(),actual=diagnostics.runtime;row.events.push({input:event,actual,host:diagnostics.hostClock,live:output?.samilaLive,parameters:diagnostics.parameters,words});assert(actual,'missing runtime');
    compare({...actual,rawDt:entry.updated?actual.rawDt:0,activeDt:entry.updated?actual.activeDt:0,camera:actual,parameters:diagnostics.parameters},entry.expected,event.kind+'#'+entry.ordinal);
    assert(bits(diagnostics.hostClock.lastTime)===entry.lastTimeBits,'GPU host lastTime');assert(actual.paused===entry.paused,'GPU paused');
   }}finally{owner.reset();row.cleanup=owner.diagnostics();assert(row.cleanup.retainedBytes===0,'GPU cleanup retained resources');}
  });
  await run('WebGL paused theta edit, capture and resume restore',async row=>{
   const item=fixture.cases[0],scene=parseLegacyScene(JSON.stringify(item.raw)).scene;let words=0;const owner=new SourceSamilaSession({samilaSeedProvider:()=>++words}),c={time:0,width:64,height:48,quality:'export',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:'theta-restore',pixelDensity:1,clock:{paused:false,timestampMs:1000}}};
   try{owner.generate(scene,c);c.samilaLive.clock.timestampMs=1030;owner.generate(scene,c);const saved=owner.diagnostics().runtime;owner.setPaused(true);c.samilaLive.clock.paused=true;
    scene.settings.samilaCameraTheta=2;c.samilaLive.clock.timestampMs=19000;const edited=owner.generate(scene,c);assert(edited.samilaLive.runtime.theta===2,'paused authored theta edit');assert(edited.samilaLive.runtime.sceneTime===saved.sceneTime,'paused edit advanced time');
    const beforeCapture=owner.diagnostics(),beforeWords=words;owner.capturePaused(scene,c);assert(words===beforeWords+2,'capture display words');assert(JSON.stringify(owner.diagnostics().runtime)===JSON.stringify(beforeCapture.runtime),'capture advanced queue');
    const beforeResume=words;owner.setPaused(false,20000);assert(words===beforeResume,'resume consumed seed');const restored=owner.diagnostics().runtime;for(const k of ['phi','theta','gamma'])assert(bits(restored[k])===bits(saved[k]),'resume failed '+k+' restoration');
    c.samilaLive.clock={paused:false,timestampMs:20000};const next=owner.generate(scene,c);assert(next.samilaLive.runtime.rawDt===0,'resume interval included paused time');assert(next.samilaLive.runtime.sceneTime===saved.sceneTime,'resume zero-dt time');row.events.push({saved,edited:edited.samilaLive.runtime,beforeCapture:beforeCapture.runtime,restored,next:next.samilaLive.runtime,words});
   }finally{owner.reset();row.cleanup=owner.diagnostics();assert(row.cleanup.retainedBytes===0,'GPU cleanup');}
  });
  result.passed=result.cases.filter(r=>r.status==='passed').length;result.failed=result.cases.length-result.passed;return result;
 },fixture);
 report.status=report.result.failed?'failed':'passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);if(page&&!report.result)try{report.result=await page.evaluate(()=>window.__realtimeEvidence);}catch{}}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map((r,i)=>({resource:['browser','vite'][i],status:r.status,...r.status==='rejected'?{error:String(r.reason)}:{}}));report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||report.cleanup.some(r=>r.status!=='fulfilled'))report.status='failed';
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));await writeFile(directory+'/report.md',`# Samila realtime clock verification\n\n${report.status}; ${report.result?.passed??0}/${report.result?.cases.length??0} cases; ${report.result?.assertions??0} assertions; ${(report.elapsedMs/1000).toFixed(2)} s; source stable ${report.sourceStable}.\n\n${report.error??''}\n\n| Case | Status | Error |\n|---|---|---|\n${report.result?.cases.map(r=>`| ${r.name} | ${r.status} | ${r.error??''} |`).join('\n')??''}\n\n${report.limits.map(x=>'- '+x).join('\n')}\n`);console.log(JSON.stringify({status:report.status,directory,sourceStable:report.sourceStable,elapsedMs:report.elapsedMs,passed:report.result?.passed,failed:report.result?.failed,error:report.error}));if(report.status!=='passed')process.exitCode=1;
}
