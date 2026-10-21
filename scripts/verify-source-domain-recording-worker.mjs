/** Real Generator/Worker/Queue Domain recording transport; no native GUI claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/domain-recording-worker-${Date.now()}`;
await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',scope:'Unmodified Generator/Worker/Queue Domain recording with real CPU/WebGL rendering and saved original JVM numerical evidence.',limits:['No App recording UI or encoder exercised.','Observed FPS sequence is injected from saved JVM evidence, not measured native window timing.','No original GUI/JOGL pixels or whole-window parity.']};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-domain-recording-worker.mjs','tests/fixtures/source-domain-clock/recording.json'].sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));}
report.sourceBefore=await hashes();
const started=performance.now(),errors=[];let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/domain-recording-worker-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain recording owner verification</title>'}));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/domain-recording-worker-verifier`);
 const fixture=JSON.parse(await readFile('tests/fixtures/source-domain-clock/recording.json','utf8'));
 report.result=await page.evaluate(async fixture=>{
  const {Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},equal=(a,b,m)=>check(JSON.stringify(a)===JSON.stringify(b),m);
  const bits=x=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,x);return v.getUint32(0).toString(16).padStart(8,'0');};
  const digest=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),b=>b.toString(16).padStart(2,'0')).join('');
  const rows=[];
  for(const backend of ['cpu','gpu'])for(const density of [1,2,3]){
   const row=fixture.cases.find(c=>c.name==='recording-config60-observed37-24-12');
   const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'retained recording',domainColoring:{formula:'z^3-1'},...row.input})).scene;
   scene.parameters={a:row.initial.values.a.value,b:row.initial.values.b.value};Object.assign(scene.settings,{domainBackend:backend,scale:row.initial.values.scale.value,rotation:row.initial.rotation.value,paletteOffset:row.initial.paletteOffset.value,...(backend==='cpu'?{domainRenderPolicy:'source-cpu-always-v1'}:{})});
   scene.formulas=defaultFormulas();scene.formulas.main.visible=true;scene.formulas.main.latex='captured';
   const c={time:0,width:48*density,height:32*density,quality:'export',domainTarget:{logicalWidth:48,logicalHeight:32,pixelDensity:density},domainLive:{sessionId:`${backend}-${density}`,revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29,viewport:{logicalWidth:48,logicalHeight:32,pixelDensity:density}}};
   const owner=new Generator(),cold=performance.now(),primary=await owner.generate(scene,c),initialMs=performance.now()-cold;
   check(primary.domainRender.effective.backend===(backend==='gpu'?'webgl2':'cpu'),'requested backend absent');
   await owner.updateDomainParameters(primary,{...scene,parameters:{...scene.parameters,a:.8}},[['a',.8]]);await owner.navigateDomainPaused(primary,{kind:'pan',dx:5,dy:2});
   const draft=structuredClone(scene);draft.equations.f='(';draft.formulas.main.latex='staged';
   const staged=await owner.generate(draft,c);
   const beginAt=performance.now(),start=await owner.beginSourceRecording(staged,{width:53,height:37,simulationFps:60,actualFrameRate:row.frames[0].state.pAppletFrameRate.value}),beginMs=performance.now()-beginAt,frames=[];
   for(const expected of row.frames){
    const t=performance.now(),out=expected.index===0?start.warmup:await owner.nextSourceRecordingFrame(start.handle,expected.index,expected.state.pAppletFrameRate.value),elapsedMs=performance.now()-t;
    const s=out.domainLive.presentation.evaluatedDomainScene,e=expected.state;
    for(const [label,value] of [['rotation',s.rotation],['rotationRate',s.rotationRate],['sceneTime',s.clock.sceneTime],['rawDt',s.clock.rawDt],['paletteOffset',s.paletteOffset]])check(bits(value)===e[label].bits,`${label} differs from original JVM frame ${expected.index}`);
    check(Math.abs(s.parameters.a-e.values.a.value)<1e-13&&s.parameters.b===e.values.b.value,'observed FPS did not drive parameters');
    check(out.domainLive.actualFrameRate===e.pAppletFrameRate.value&&out.domainLive.clockSource==='fixed-step','mixed observed/simulation clocks');
    check(out.domainLive.recording.complete===expected.actualAutoRecordingComplete,'completion differs from original');
    check(out.domainRender.effective.backend===(backend==='gpu'?'webgl2':'cpu'),'recording changed requested backend');
    check(out.width===Math.floor(159/density+.5)*density&&out.height===Math.floor(111/density+.5)*density,'recording size lost source 3x/density rounding');
    check(out.formulaPresentation.labels[0].latex==='captured'&&out.domainLive.presentation.equations.f===scene.equations.f,'draft entered recording');
    frames.push({displayFrame:expected.index,warmup:expected.index===0,actualFrameRate:e.pAppletFrameRate.value,parameterA:s.parameters.a,sceneTime:s.clock.sceneTime,rgba:await digest(out.pixels),width:out.width,height:out.height,target:out.domainRender.target,elapsedMs});
   }
   check(new Set(frames.map(f=>f.rgba)).size>1,'recording rendered no pixel changes');
   let missing=false;try{await owner.nextSourceRecordingFrame(start.handle,1);}catch{missing=true;}check(missing,'invalid frame sequence accepted');
   const stop=await owner.finishSourceRecording(start.handle);
   equal(stop.scene,draft,'finish discarded author draft');
   check(stop.preview.domainLive.updateOrdinal===row.frames.length-1&&stop.preview.domainLive.sceneTime===row.frames.at(-1).state.sceneTime.value,'finish advanced numerical state');
   check(stop.preview.domainLive.renderKind==='snapshot'&&stop.preview.domainLive.target==='primary'&&!stop.preview.domainLive.paused&&!stop.preview.domainLive.recording,'invalid primary handoff');
   check(stop.preview.width===c.width&&stop.preview.height===c.height,'primary dimensions not restored');
   check(!owner.hasSourceRecording(start.handle),'finish retained stale handle');
   await owner.setDomainPaused(stop.preview,true);await owner.setDomainPaused(stop.preview,false,2000);
   const resumed=await owner.generate(draft,{...stop.context,domainLive:{...stop.context.domainLive,clock:{paused:false,timestampMs:2250},actualFrameRate:43}});
   check(resumed.domainLive.updateOrdinal===row.frames.length&&resumed.domainLive.rawDt===.25&&resumed.domainLive.actualFrameRate===43,'resume consumed incorrect time/update');
   owner.dispose();rows.push({backend,density,initialMs,beginMs,clock:start.clock,frames,fullApplyAnchor:true,stagedDraftPreserved:true,stopNoAdvance:true,resumePassed:true});
  }
  const queueRows=[];
  for(const mode of ['complete','manual','cancel','invalid-observation','staged','apply']){
   const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'queue recording',domainColoring:{formula:'z^3-1'},timeline:[{type:'wait',duration:.1}]})).scene;
   scene.settings.domainRenderPolicy='source-cpu-always-v1';
   const context={time:0,width:48,height:32,quality:'export',domainTarget:{logicalWidth:48,logicalHeight:32,pixelDensity:1},domainLive:{sessionId:'queue-'+mode,revision:0,clock:{paused:true},actualFrameRate:29,viewport:{logicalWidth:48,logicalHeight:32,pixelDensity:1}}};
   const generator=new Generator(),published=[],errors=[],stops=[],controller=new AbortController();let busy=false,observations=0,encoded=0,completion,draft;
   const queue=new GenerationQueue(generator,{output:(output,time,scene)=>published.push({output,time,scene}),error:e=>errors.push(e.message),busy:v=>{busy=v;},recordingStopped:stop=>stops.push(stop)});
   const until=async predicate=>{const end=performance.now()+15000;while(!predicate()){if(errors.length)throw Error(errors.join('\n'));if(performance.now()>end)throw Error('queue timed out');await new Promise(r=>setTimeout(r,10));}};
   try{
    queue.request(scene,context);await until(()=>published.length===1&&!busy);
    let rejected=false;try{await queue.recordSource(published[0].output,{width:16,height:12,simulationFps:60,actualFrameRate:37},{frame:()=>{}});}catch{rejected=true;}check(rejected,'Domain queue accepted missing FPS observer');
    let failure;
    try{await queue.recordSource(published[0].output,{width:16,height:12,simulationFps:60,actualFrameRate:37},{
     actualFrameRate:()=>{observations++;return mode==='invalid-observation'&&observations===2?NaN:observations===1?24:12;},
     shouldStop:()=>mode==='manual'&&encoded===1,
     start:start=>{check(start.warmup.domainLive.actualFrameRate===37,'queue changed warmup observation');},
     frame:async(frame,index)=>{
      check(index===encoded&&frame.domainLive.actualFrameRate===(index===0?24:12),'queue lost frame observation or order');encoded++;
      await new Promise(r=>setTimeout(r,5));check(observations===encoded,'queue requested a frame before consumer completed');
      if(mode==='cancel')controller.abort();
      if(encoded===1&&(mode==='staged'||mode==='apply')){
       draft=structuredClone(scene);draft.settings.centerX=3;if(mode==='staged')draft.equations.f='(';
       queue.request(draft,{...context,domainLive:{...context.domainLive,revision:mode==='apply'?1:0,...(mode==='apply'?{configuration:draft}:{})}});
      }
     },complete:(_start,result)=>{completion=result;}
    },controller.signal);}catch(e){failure=e;}
    await until(()=>!busy);
    check(stops.length===1,'queue did not finish retained recording exactly once');
    check(!failure||mode==='cancel'||mode==='invalid-observation','unexpected recording failure');
    if(mode==='cancel')check(failure?.name==='AbortError'&&encoded===1,'cancel did not stop after in-flight frame');
    if(mode==='invalid-observation')check(!!failure&&encoded===1&&stops[0].preview.domainLive.updateOrdinal===1,'invalid observation advanced host or lost stop');
    if(mode==='manual')check(completion?.reason==='manual-stop'&&completion.encodedFrames===1,'manual completion differs');
    if(mode==='complete')check(completion?.reason==='queue-complete'&&encoded===5,'queue completion count differs');
    if(draft){const last=published.at(-1);check(last.scene===draft,'deferred author identity lost');check(last.output.domainLive.presentation.settings.centerX===(mode==='apply'?3:scene.settings.centerX),'staged/full Apply distinction lost');check(last.output.domainLive.revision===(mode==='apply'?1:0),'deferred revision lost');}
    queueRows.push({mode,observations,encoded,completion,failure:failure?.name,stopOrdinal:stops[0].preview.domainLive.updateOrdinal,passed:true});
   }finally{queue.dispose();}
  }
  return {direct:rows,queue:queueRows};
 },fixture);
 if(errors.length)throw Error(errors.join('\n'));
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.elapsedMs=performance.now()-started;report.errors=errors;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:`${directory}/report.json`,elapsedMs:report.elapsedMs,error:report.error}));
}
