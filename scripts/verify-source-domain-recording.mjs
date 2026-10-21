/** Real CPU/WebGL retained owner in headless Chrome. Worker/client/UI routing
 * and encoding are deliberately outside this verifier's current scope. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/domain-recording-owner-${Date.now()}`;
await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',scope:'Retained Domain owner with real CPU/WebGL rendering; saved original JVM numerical recording fixture.',limits:['No Worker/client/queue recording connection, App recording UI or encoder exercised.','Observed FPS sequence is injected from saved JVM evidence, not measured native window timing.','No original GUI/JOGL pixels or whole-window parity.']};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-domain-recording.mjs','tests/fixtures/source-domain-clock/recording.json'].sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));}
report.sourceBefore=await hashes();
const started=performance.now(),errors=[];let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/domain-recording-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain recording owner verification</title>'}));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/domain-recording-verifier`);
 const fixture=JSON.parse(await readFile('tests/fixtures/source-domain-clock/recording.json','utf8'));
 report.result=await page.evaluate(async fixture=>{
  const {SourceDomainLiveSession}=await import('/src/engine/sourceDomainLiveSession.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts');
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
   const owner=new SourceDomainLiveSession(),cold=performance.now(),primary=owner.generate(scene,c),initialMs=performance.now()-cold;
   check(primary.domainRender.effective.backend===(backend==='gpu'?'webgl2':'cpu'),'requested backend absent');
   owner.updateParameters(scene,c,[['a',.8]]);owner.navigatePaused(scene,c,{kind:'pan',dx:5,dy:2});
   const draft=structuredClone(scene);draft.equations.f='(';draft.formulas.main.latex='staged';
   const beginAt=performance.now(),start=owner.beginRecording(draft,c,{width:53,height:37,simulationFps:60,actualFrameRate:row.frames[0].state.pAppletFrameRate.value}),beginMs=performance.now()-beginAt,frames=[];
   for(const expected of row.frames){
    const t=performance.now(),out=expected.index===0?start.warmup:owner.nextRecordingFrame(start.handle,expected.index,expected.state.pAppletFrameRate.value),elapsedMs=performance.now()-t;
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
   const before=owner.diagnostics().host,stop=owner.finishRecording(start.handle,2000);
   equal(before.state,owner.diagnostics().host.state,'finish advanced numerical state');equal(stop.scene,draft,'finish discarded author draft');
   check(stop.preview.domainLive.renderKind==='snapshot'&&stop.preview.domainLive.target==='primary'&&!stop.preview.domainLive.paused&&!stop.preview.domainLive.recording,'invalid primary handoff');
   check(stop.preview.width===c.width&&stop.preview.height===c.height,'primary dimensions not restored');
   const stopped=owner.diagnostics().host,retry=owner.finishRecording(start.handle,9000);equal(owner.diagnostics().host,stopped,'finish retry reset time');check(await digest(retry.preview.pixels)===await digest(stop.preview.pixels),'finish retry pixels changed');
   const resumed=owner.generate(draft,{...stop.context,domainLive:{...stop.context.domainLive,clock:{paused:false,timestampMs:2250},actualFrameRate:43}});
   check(resumed.domainLive.updateOrdinal===row.frames.length&&resumed.domainLive.rawDt===.25&&resumed.domainLive.actualFrameRate===43,'resume consumed incorrect time/update');
   owner.reset();rows.push({backend,density,initialMs,beginMs,clock:start.clock,frames,fullApplyAnchor:true,stagedDraftPreserved:true,stopNoAdvance:true,retryNoAdvance:true,resumePassed:true});
  }
  return rows;
 },fixture);
 if(errors.length)throw Error(errors.join('\n'));
 report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.elapsedMs=performance.now()-started;report.errors=errors;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,report:`${directory}/report.json`,elapsedMs:report.elapsedMs,error:report.error}));
}
