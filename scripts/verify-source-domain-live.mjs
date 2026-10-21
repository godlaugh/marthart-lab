/** Real browser/Worker transport verification; no native GUI pixel claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/domain-live-public-${Date.now()}`;
await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',node:process.version,scope:'Unmodified Generator + Worker + retained Domain host + CPU/WebGL renderer + GenerationQueue in headless Chrome. Explicit timestamps/FPS are test inputs.',limits:['No original GUI, native GL pixels, or whole-window parity.','The App still uses fixed Domain replay until gestures, hot parameters, current PNG and recording are wired together.','Native numerical observations are separately retained; local renderer repeatability is not native pixel parity.']};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-domain-live.mjs'].sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));}
report.sourceBefore=await hashes();
const started=performance.now(),errors=[];let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/domain-live-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain live verification</title>'}));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/domain-live-verifier`);
 report.result=await page.evaluate(async()=>{
  const {Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{sourceQueuePresentedScene}=await import('/src/engine/sourceQueuePresentation.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},equal=(a,b,m)=>check(JSON.stringify(a)===JSON.stringify(b),m);
  const digest=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),b=>b.toString(16).padStart(2,'0')).join('');
  const make=backend=>{const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain live public',domainColoring:{formula:'z^3 - 1'},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'domainRotate',args:[1]}]}]})).scene;s.settings.domainBackend=backend;s.timeline.fps=4;s.formulas=defaultFormulas();s.formulas.main.visible=true;s.formulas.main.latex='captured';return s;};
  const context=(sessionId,revision=0,paused=false,timestampMs=1000,extra={})=>({time:999,width:79,height:53,quality:'export',domainLive:{sessionId,revision,clock:{paused,timestampMs},actualFrameRate:23,...extra}});
  const rows=[];
  for(const backend of ['cpu','gpu']){
   const g=new Generator(),s=make(backend),id='direct-'+backend;
   try{
    const coldStart=performance.now(),initial=await g.generate(s,context(id)),coldMs=performance.now()-coldStart;check(initial.domainRender.effective.backend===(backend==='gpu'?'webgl2':'cpu'),'requested real backend missing');
    check(initial.domainLive.updateOrdinal===0&&initial.domainLive.sceneTime===0&&initial.domainRender.view.rotation===0,'first update is not zero');
    const warmStart=performance.now(),moving=await g.generate(s,context(id,0,false,1250)),warmMs=performance.now()-warmStart;check(moving.domainRender.view.rotation===.125&&moving.domainLive.sceneTime===.25,'original numerical rotation mismatch');
    await g.setDomainPaused(moving,true,1500);
    const paused=await g.generate(s,context(id,0,true,20000,{actualFrameRate:8}));
    check(paused.domainLive.renderKind==='snapshot'&&paused.domainLive.updateOrdinal===1&&paused.domainLive.actualFrameRate===23&&paused.domainLive.rawDt===0,'paused repaint consumed a numerical update');
    check(await digest(paused.pixels)===await digest(moving.pixels),'paused pixels changed');
    const draft=structuredClone(s);draft.settings.centerX=99;draft.equations.f='z';draft.formulas.main.latex='staged';
    const staged=await g.generate(draft,context(id,0,true,21000,{actualFrameRate:12}));
    equal(staged.formulaPresentation,initial.formulaPresentation,'staged formulas replaced captured formulas');check(await digest(staged.pixels)===await digest(paused.pixels),'same revision edited retained scene');
    await g.setDomainPaused(staged,false,30000);
    const resumed=await g.generate(s,context(id,0,false,30250));check(resumed.domainRender.view.rotation===.375&&resumed.domainLive.sceneTime===.5,'resume included paused wall time');
    await g.setDomainPaused(resumed,true,31000);
    const applied=structuredClone(s);applied.settings.centerX=3;applied.formulas.main.latex='applied';
    const apply=await g.generate(draft,context(id,1,true,32000,{configuration:applied}));
    check(apply.domainLive.updateOrdinal===0&&apply.domainLive.sceneTime===0&&apply.domainRender.view.rotation===0,'paused full Apply failed to reload');
    const shown=sourceQueuePresentedScene(draft,apply);check(shown.settings.centerX===3&&shown.equations.f===s.equations.f,'display used staged document instead of delivered facts');
    check(apply.formulaPresentation.labels.some(label=>label.latex==='applied'),'Apply did not replace captured formulas');applied.settings.centerX=101;shown.settings.centerX=202;
    const retained=await g.generate(draft,context(id,1,true,33000));check(retained.domainLive.presentation.settings.centerX===3,'configuration or presentation aliased owner');
    let rejected=false;try{await g.setDomainPaused(apply,false,34000);}catch{rejected=true;}check(rejected,'stale completed image controlled host');
    const seek=await g.generate(s,context(id+'-seek',0,true,0,{startAt:.75,actualFrameRate:19}));check(seek.domainLive.renderKind==='snapshot'&&seek.domainLive.updateOrdinal===3&&seek.domainRender.view.rotation===1.25,'local fixed reconstruction mismatch');
    // A failed transport request retires the worker. No stale frame regains control.
    let failed=false;try{await g.generate(s,context(id+'-seek',0,true,1,{actualFrameRate:NaN,startAt:.75}));}catch{failed=true;}check(failed,'invalid FPS accepted');
    let stale=false;try{await g.setDomainPaused(seek,false);}catch{stale=true;}check(stale,'failed request retained uncertain playback');
    const recovered=await g.generate(s,context(id+'-recovered'));check(recovered.domainLive.updateOrdinal===0,'fresh worker recovery failed');
    rows.push({backend:initial.domainRender.effective.backend,completedRequestMs:{coldWorker:coldMs,warmRetainedWorker:warmMs},first:initial.domainLive,rotations:[initial,moving,resumed,seek].map(o=>o.domainRender.view.rotation),pauseStable:true,pausedApplyReloaded:true,formulasCaptured:true,staleRejected:true,failedOwnerRetired:true,recovered:true,pixels:{initial:await digest(initial.pixels),moving:await digest(moving.pixels),paused:await digest(paused.pixels),apply:await digest(apply.pixels)}});
   }finally{g.dispose();}
  }
  // Queue coalescing uses real Worker completions, not a substitute renderer.
  const qscene=make('cpu'),g=new Generator(),published=[],queueErrors=[],waiters=[];
  const q=new GenerationQueue(g,{output:(o,time,s)=>{published.push({o,time,s});for(const notify of waiters.splice(0))notify();},error:e=>{queueErrors.push(e.message);for(const notify of waiters.splice(0))notify();},busy:()=>{}});
  async function until(predicate){const end=performance.now()+15000;while(!predicate()){if(queueErrors.length)throw Error(queueErrors.join('\n'));if(performance.now()>end)throw Error('queue timeout');await new Promise(resolve=>{let done=false;const finish=()=>{if(!done){done=true;resolve();}};waiters.push(finish);setTimeout(finish,50);});}}
  try{
   q.request(qscene,context('queue'));
   const captured=structuredClone(qscene);captured.settings.centerX=4;
   q.request(captured,context('queue',1,false,1250,{configuration:captured}));
   const staged=structuredClone(captured);staged.settings.centerX=99;
   q.request(staged,context('queue',1,false,1500));captured.settings.centerX=999;
   await until(()=>published.some(r=>r.o.domainLive?.revision===1));
   check(published.length===1,'obsolete coalesced result was published');const applied=published[0];
   check(applied.o.domainLive.presentation.settings.centerX===4,'coalescing dropped or aliased full Apply event');check(applied.time===applied.o.domainLive.sceneTime,'queue exposed requested fake time');
   await q.setDomainPaused(true);
   q.request(staged,context('queue',1,true,20000,{actualFrameRate:9}));await until(()=>published.length===2);
   check(published[1].o.domainLive.updateOrdinal===applied.o.domainLive.updateOrdinal,'pause generated another update');
   const renamed={...staged,name:'Renamed metadata'};q.request(renamed,context('queue',1,true,25000,{actualFrameRate:18}),0,'metadata');await until(()=>published.length===3);
   check(published[2].o===published[1].o,'metadata rendered another frame');
   await q.setDomainPaused(false);q.request(renamed,context('queue',1,false,30000));await until(()=>published.length===4);
   check(published[3].o.domainLive.updateOrdinal===applied.o.domainLive.updateOrdinal+1,'queue resume did not use retained owner');
  }finally{q.dispose();}
  check(!queueErrors.length,'unexpected queue errors');return{direct:rows,queue:{coalescedApply:true,obsoleteSuppressed:true,pausedSnapshot:true,metadataReused:true,resumeRetained:true,errors:queueErrors}};
 });
 if(errors.length)throw Error(errors.join('\n'));report.status='passed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup=cleanup.map((r,i)=>({resource:['browser','vite'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));
 report.errors=errors;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';
 await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');await writeFile(`${directory}/report.md`,['# Domain 实时 Worker 验证','',`结果：**${report.status}**；运行期间源码稳定：**${report.sourceStable}**。`,'',report.scope,'',...(report.error?[report.error,'']:[]),...report.limits.map(s=>'- '+s),''].join('\n'));
 console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,elapsedMs:report.elapsedMs,path:`${directory}/report.json`}));if(report.status!=='passed')process.exitCode=1;
}
