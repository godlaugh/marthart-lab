/** Source-bound Samila hot lifecycle verification in owned headless Chrome.
 * node scripts/verify-source-samila-hot-lifecycle.mjs [report-dir]
 * Explicit event expectations come from fixed MathArt bytecode, not a second
 * implementation of the production dirty/resize state machine. Controlled
 * entropy is a verification seam, not native ThreadLocalRandom identity.
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const directory=process.argv[2]??'.cache/source-samila-hot-lifecycle';
if(directory==='--help'){console.log('node scripts/verify-source-samila-hot-lifecycle.mjs [report-dir]');process.exit(0);}
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message);};
const script=fileURLToPath(import.meta.url),manifestPath='.cache/v2-samila-hot-source/manifest.json',auditPath='.cache/v2-samila-hot-lifecycle-audit.md';
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const p=e.parentPath+'/'+e.name;return[p,sha(await readFile(p))];})));
await mkdir(directory,{recursive:true});
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
check(manifest.artifactSha256==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','unexpected original artifact');
check(sha(await readFile(manifest.artifact))===manifest.artifactSha256,'original artifact changed');
for(const member of manifest.members)check(sha(await readFile(member.evidence))===member.evidenceSha256,'decoded evidence changed: '+member.evidence);
const memberValidation=JSON.parse(execFileSync('python3',['-c',`import sys,json,zipfile,hashlib
m=json.load(open(sys.argv[1]));z=zipfile.ZipFile(m['artifact']);r=[]
for v in m['members']:
 h=hashlib.sha256(z.read(v['entry'])).hexdigest()
 assert h==v['classSha256'],v['entry']
 r.append({'entry':v['entry'],'sha256':h})
print(json.dumps(r))`,manifestPath],{encoding:'utf8'}));
const sourceEvidence={artifact:manifest.artifact,artifactSha256:manifest.artifactSha256,manifestSha256:sha(await readFile(manifestPath)),auditSha256:sha(await readFile(auditPath)),members:memberValidation,nativeExecution:false};
// Independent, hand-enumerated source transactions. No product function computes
// these expected counters/anchors/word counts. Each row means one actual display.
const sourceEvents={
 citations:{display:'SamilaMobject.display PCs 103,107,174-232,245-278,281-309',resize:'ensureAccumulationBuffers PCs 46-71,331-336',parameters:'updateParameter PCs 21,47; hasParameterChangedForAccumulation PCs 104-122 (double >1e-9)',capture:'MathArt.draw PCs 360-409,497; savePausedFrameInternal PCs 90-124'},
 repeated:[{event:'initial',count:1,multiplier:1,anchor:0,words:1},{event:'same-time',count:2,multiplier:1,anchor:0,words:2}],
 parameters:[{event:'initial',value:0,count:1,multiplier:1,anchor:0,words:1},{event:'equal setter',value:0,count:1,multiplier:1,anchor:0,words:2},{event:'below threshold setter',value:5e-10,count:1,multiplier:1,anchor:0,words:3},{event:'above retained snapshot threshold',value:2e-9,count:6,multiplier:6,anchor:0,words:4}],
 resize:[{event:'initial',count:1,multiplier:1,anchor:0,words:1},{event:'theta only .5',count:2,multiplier:1,anchor:0,words:2},{event:'dirty transform plus resize',count:1,multiplier:1,anchor:0,words:3},{event:'parameter change plus resize',count:6,multiplier:6,anchor:.5,words:4}],
 captureSame:[{event:'initial',count:1,multiplier:1,anchor:0,words:1},{event:'export',count:2,multiplier:1,anchor:0,words:2},{event:'primary',count:3,multiplier:1,anchor:0,words:3}],
 captureDifferent:[{event:'initial',count:1,multiplier:1,anchor:0,words:1},{event:'resized export',count:1,multiplier:1,anchor:0,words:2},{event:'resized primary',count:1,multiplier:1,anchor:0,words:3}],
};
await writeFile(directory+'/source-events.json',JSON.stringify({sourceEvidence,sourceEvents},null,2));
const started=performance.now(),report={status:'running',sourceEvidence,scriptSha256:sha(await readFile(script)),sourceBefore:await hashes(),sourceEvents,nativeParity:false,limits:['Expected event order/counters/anchor rules are derived from fixed original bytecode; no native GUI or native runtime is executed.','Controlled seed words establish lifecycle behavior, not native ThreadLocalRandom identity.','The independent ink schedule shares local shader arithmetic and low-level GPU resources; it does not establish native pixel parity.','Explicit parameter setters exercise the mobject/timeline contract; original generic parameter UI dispatch is not assumed.','Elapsed wall time is functional verification only, not a performance measurement.']};
let browser,server,page;
try{
 server=await createServer({server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();
 await page.route('**/hot-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'hot-fixture');
 report.browserVersion=browser.version();
 report.result=await page.evaluate(async({sourceEvents})=>{
  const {SourceSamilaSession}=await import('/src/engine/sourceSamilaSession.ts');
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{initializeSamilaCamera}=await import('/src/engine/samilaCamera.ts');
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{prepareSourceSamilaSplat}=await import('/src/engine/sourceSamilaSplat.ts');
  let assertions=0;const assert=(value,message)=>{assertions++;if(!value)throw Error(message);};
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const words=[0,-1,-2147483648,2147483647,42,71,101,102,103,104,105,106,107,108,109,110];
  const scene=()=>{const s=createScene(definition('samila'));s.timeline.tracks=[];s.timeline.schedule='samila-scene-sequence-v1';s.timeline.fps=30;s.timeline.duration=20;s.equations={f1:'.1+a',f2:'.2'};s.parameters={a:0};s.palette={name:'white',stops:['#ffffff','#ffffff'],mode:'linear',cycles:1,offset:0};
   s.settings=initializeSamilaCamera({...s.settings,iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:13,samilaHistoryModel:'bounded-v2',densityToneModel:'samila-normalized-v2',samilaProjectionModel:'source-ndc-v1',samilaMathModel:'mathart-1.7.8',samilaSplatModel:'samila-splat-1.7.8',samilaSamplingModel:'samila-pcg-1.7.8',samilaPresentationModel:'samila-present-1.7.8',start:-Math.PI,stop:Math.PI,mapping:'f1_f2',projection:'cartesian',scaleX:.33,scaleY:.33,offsetX:0,offsetY:0,rotation:0,samilaCameraTheta:0,samilaSpotSize:.03,alpha:.2,showTrails:false,accumulationDecay:1});return s;};
  const context=(id='hot')=>({time:0,width:64,height:48,quality:'export',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:id,pixelDensity:1}});
  const result={cases:[]};window.__hotEvidence=result;
  const run=async(name,body)=>{const row={name,status:'running'},owners=[];result.cases.push(row);const create=()=>{let calls=0;const owner=new SourceSamilaSession({samilaSeedProvider:()=>{assert(calls<words.length,'seed fixture exhausted');return words[calls++];}});owners.push(owner);return{owner,calls:()=>calls};};
   try{await body(row,create,()=>{const owner=new IteratedDensityGpu();owners.push(owner);return owner;});row.status='passed';}catch(error){row.status='failed';row.error=String(error.stack??error);}finally{row.cleanup=owners.map(owner=>{try{owner.reset();const diagnostics=owner.diagnostics();assert(diagnostics.retainedBytes===0,'hot GPU reset resources');return{status:'fulfilled',diagnostics};}catch(error){row.status='failed';return{status:'rejected',error:String(error),diagnostics:owner.diagnostics()};}});}
  };
  const remember=async(row,session,out,expected)=>{
   assert(out.type==='raster'&&out.backend==='webgl2','real WebGL output');const facts=out.samilaLive;assert(facts,'live facts missing');
   const ink=session.owner.snapshotInk(),entry={event:expected.event,live:facts,sampling:out.samilaSampling,stats:out.stats,temporal:out.temporal,seedCalls:session.calls(),inkSha256:await digest(ink.buffer),rgbaSha256:await digest(out.pixels.buffer),diagnostics:session.owner.diagnostics()};(row.events??=[]).push(entry);
   assert(facts.accumulationPasses===expected.count,expected.event+': accumulation counter');assert(facts.anchorTheta===Math.fround(expected.anchor),expected.event+': anchor');assert(session.calls()===expected.words,expected.event+': random words');assert(out.samilaSampling?.sampleCount===13*expected.multiplier,expected.event+': sample count');assert(out.samilaSampling?.frameSeed===(words[expected.words-1]>>>0),expected.event+': one controlled word');assert(ink.some(v=>v!==0)&&ink.every(Number.isFinite),'nonblank finite ink');return entry;
  };
  await run('same-time fresh display',async(row,create)=>{const session=create(),s=scene(),c=context();for(const expected of sourceEvents.repeated)await remember(row,session,session.owner.generate(s,c),expected);assert(row.events[0].inkSha256!==row.events[1].inkSha256,'same-time display retained cached ink');assert(session.owner.matchesCompletedPrimary(s,c),'completed primary eligibility');});
  await run('equal and threshold parameter setters',async(row,create)=>{const session=create(),s=scene(),c=context();for(const [i,expected]of sourceEvents.parameters.entries()){if(i)session.owner.applyHot({kind:'parameter',name:'a',value:expected.value});await remember(row,session,session.owner.generate(s,c),expected);}assert(row.events[0].inkSha256===row.events[1].inkSha256,'equal setter must clear old ink');});
  const {prepareDensityTone}=await import('/src/engine/density.ts'),{prepareSamilaView}=await import('/src/engine/samilaCamera.ts');
  const referenceSizes=new WeakMap();
  const reference=async(owner,s,expected,{width=64,height=48,clear=true,theta=0}={})=>{
   const index=expected.words-1,job=prepareIteratedFrame(s,0,index);job.field={...job.field,rotation:Math.fround(Math.fround(Number(s.settings.rotation))+Math.fround(expected.anchor))};
   job.history={model:'bounded-v2',clear,passes:expected.multiplier,samples:13*expected.multiplier,randomFrames:[],densityCeiling:300,next:{parameters:{...s.parameters},fieldKey:job.fieldKey}};
   job.samilaSplat=prepareSourceSamilaSplat(s,{width,height,primaryPixelHeight:1080,path:'points'});
   job.samilaSampling={model:'samila-pcg-1.7.8',frameSeed:words[index]>>>0,sampleCount:13*expected.multiplier,baseBatchSize:13,displayIndex:index,seedSource:'injected',replay:'hot-display'};
   const previousSize=referenceSizes.get(owner),stats=owner.step(job,{resetParticles:previousSize!==width+'x'+height,clearInk:clear,width,height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}}),ink=owner.readback();
   referenceSizes.set(owner,width+'x'+height);
   const tone=prepareDensityTone(s.palette,s.settings,{kind:'samila',historyModel:'bounded-v2',width,height,completedPasses:expected.count,baseBatchSize:13,alpha:job.config.alpha,combinedDecay:job.config.decay,splat:{model:job.samilaSplat.model,nominalRadius:job.samilaSplat.nominalRadius}});
   const view=prepareSamilaView({model:'anchored-theta-v1',time:0,theta},expected.anchor,width,height,0),shown=owner.present(tone,undefined,view);
   return {stats,inkSha256:await digest(ink.buffer),rgbaSha256:await digest(shown.pixels.buffer)};
  };
  await run('source event schedule independent ink',async(row,create,newGpu)=>{
   const session=create(),ref=newGpu(),s=scene(),c=context();
   for(const [i,expected]of sourceEvents.parameters.entries()){
    if(i)session.owner.applyHot({kind:'parameter',name:'a',value:expected.value});
    const actual=await remember(row,session,session.owner.generate(s,c),expected),r=structuredClone(s);r.parameters.a=expected.value;
    const exp=await reference(ref,r,expected,{clear:true});actual.reference=exp;assert(actual.inkSha256===exp.inkSha256,'explicit parameter schedule ink');assert(actual.rgbaSha256===exp.rgbaSha256,'explicit parameter schedule present');
   }
  });
  await run('theta only and resize dirty ordering',async(row,create,newGpu)=>{
   const session=create(),ref=newGpu(),s=scene(),c=context(),r=structuredClone(s);
   for(const [i,expected]of sourceEvents.resize.entries()){
    if(i===1){s.settings.samilaCameraTheta=.5;r.settings.samilaCameraTheta=.5;}
    if(i===2){session.owner.applyHot({kind:'transform',scaleX:.5,scaleY:.4,offsetX:.1,offsetY:0});Object.assign(r.settings,{scaleX:.5,scaleY:.4,offsetX:.1,offsetY:0});c.width=80;c.height=52;}
    if(i===3){session.owner.applyHot({kind:'parameter',name:'a',value:.1});r.parameters.a=.1;c.width=72;c.height=56;}
    const actual=await remember(row,session,session.owner.generate(s,c),expected),exp=await reference(ref,r,expected,{width:c.width,height:c.height,clear:i!==1,theta:i? .5:0});actual.reference=exp;
    assert(actual.inkSha256===exp.inkSha256,'explicit resize/anchor schedule ink');assert(actual.rgbaSha256===exp.rgbaSha256,'explicit resize/anchor schedule present');
   }
  });
  for(const different of [false,true])await run('paused capture '+(different?'different targets':'same targets'),async(row,create,newGpu)=>{
   const session=create(),ref=newGpu(),s=scene(),c=context(),expected=different?sourceEvents.captureDifferent:sourceEvents.captureSame;
   await remember(row,session,session.owner.generate(s,c),expected[0]);await reference(ref,s,expected[0]);
   const size=different?{width:80,height:52}:{width:64,height:48},result=session.owner.capturePaused(s,{...c,...size});
   row.captures=[];
   for(const [i,out]of [result.capture,result.preview].entries()){
    const e=expected[i+1],exp=await reference(ref,s,e,{...(i===0?size:{}),clear:different});
    const entry={live:out.samilaLive,sampling:out.samilaSampling,rgbaSha256:await digest(out.pixels.buffer),reference:exp};row.captures.push(entry);
    assert(out.samilaLive.accumulationPasses===e.count&&out.samilaLive.anchorTheta===e.anchor,'capture source event count/anchor');assert(out.samilaLive.target===(i===0?'offscreen':'primary'),'capture target role');assert(out.samilaSampling.frameSeed===(words[e.words-1]>>>0)&&out.samilaSampling.sampleCount===13,'capture fresh word and 1N');assert(entry.rgbaSha256===exp.rgbaSha256,'capture explicit schedule full RGBA');assert(out.temporal.time===0,'capture clock advanced');
   }
   assert(session.calls()===3,'capture exactly two fresh random words');assert(session.owner.matchesCompletedPrimary(s,c),'capture refresh retains primary eligibility');assert(await digest(session.owner.snapshotInk().buffer)===row.captures[1].reference.inkSha256,'capture final primary ink');
  });
  await run('preflight preserves primary and words',async(row,create)=>{
   const session=create(),s=scene(),c=context();session.owner.generate(s,c);const before=await digest(session.owner.snapshotInk().buffer),diagnostics=JSON.stringify(session.owner.diagnostics());row.failures=[];
   for(const attempt of [()=>session.owner.capturePaused(s,{...c,width:0}),()=>session.owner.capturePaused(s,c,{additionalBytes:768*1024*1024}),()=>session.owner.capturePaused(s,{...c,isCancelled:()=>true})]){
    let error;try{attempt();}catch(e){error={name:e.name,message:e.message};}row.failures.push(error);assert(error,'preflight unexpectedly succeeded');assert(session.calls()===1,'preflight consumed entropy');assert(session.owner.matchesCompletedPrimary(s,c),'preflight invalidated primary');assert(await digest(session.owner.snapshotInk().buffer)===before,'preflight changed ink');assert(JSON.stringify(session.owner.diagnostics())===diagnostics,'preflight changed live diagnostics');
   }
   const captured=session.owner.capturePaused(s,c);assert(captured.preview.samilaLive.accumulationPasses===3&&session.calls()===3,'preflight valid retry');
  });
  await run('partial draw failure invalidates primary and retries fresh',async(row,create)=>{
   const session=create(),s=scene(),c=context();session.owner.generate(s,c);const proto=WebGL2RenderingContext.prototype,native=proto.drawArrays;let thrown=false;
   try{proto.drawArrays=function(mode,first,count){const value=native.call(this,mode,first,count);if(!thrown&&(mode===this.POINTS&&count===13||mode===this.TRIANGLES&&count===78)){thrown=true;throw Error('injected after native splat draw');}return value;};let error;try{session.owner.generate(s,c);}catch(e){error={name:e.name,message:e.message};}row.failure=error;assert(thrown&&error,'partial draw fault not exercised');}finally{proto.drawArrays=native;}
   assert(session.calls()===2,'partial draw consumes its random word');assert(!session.owner.matchesCompletedPrimary(s,c),'ambiguous partial draw retained primary');let rejected=false;try{session.owner.snapshotInk();}catch{rejected=true;}assert(rejected,'partial failed ink exposed');row.afterFailure=session.owner.diagnostics();
   const retry=session.owner.generate(s,c);assert(retry.samilaLive.accumulationPasses===1&&session.calls()===3,'retry silently reused old ink or old seed');row.retry=retry.samilaLive;
  });
  await run('capture second-display failure invalidates primary',async(row,create)=>{
   const session=create(),s=scene(),c=context();session.owner.generate(s,c);const proto=WebGL2RenderingContext.prototype,native=proto.drawArrays;let splats=0;
   try{proto.drawArrays=function(mode,first,count){const value=native.call(this,mode,first,count);if((mode===this.POINTS&&count===13||mode===this.TRIANGLES&&count===78)&&++splats===2)throw Error('injected after second capture splat');return value;};let error;try{session.owner.capturePaused(s,c);}catch(e){error={name:e.name,message:e.message};}row.failure=error;assert(splats===2&&error,'second capture display fault not exercised');}finally{proto.drawArrays=native;}
   assert(session.calls()===3,'partial capture consumed exactly export and primary words');assert(!session.owner.matchesCompletedPrimary(s,c),'partial capture incorrectly retained completed preview');let rejected=false;try{session.owner.snapshotInk();}catch{rejected=true;}assert(rejected,'partial capture exposed uncertain ink');row.afterFailure=session.owner.diagnostics();
   const retry=session.owner.generate(s,c);assert(session.calls()===4&&retry.samilaLive.accumulationPasses===1,'partial capture retry did not rebuild with new entropy');row.retry=retry.samilaLive;
  });
  await run('public Generator Worker retained capture',async(row)=>{
   const Native=window.Worker,audit={created:0,terminated:0,requests:[],responses:[]};let generator;
   window.Worker=class extends Native{
    constructor(...args){super(...args);this.auditId=++audit.created;this.addEventListener('message',({data})=>{if(['generate','samila-paused-capture'].includes(data.operation))audit.responses.push({worker:this.auditId,operation:data.operation,id:data.id,sessionId:data.sessionId,error:data.error,retainedSourceId:data.retainedSourceId});});}
    postMessage(data,...rest){audit.requests.push({worker:this.auditId,operation:data.operation,id:data.id,sessionId:data.sessionId});return super.postMessage(data,...rest);}
    terminate(){audit.terminated++;return super.terminate();}
   };
   try{
    const {Generator}=await import('/src/engine/client.ts');generator=new Generator();const s=scene(),c=context('worker-hot');
    const first=await generator.generate(s,c),second=await generator.generate(s,c);
    assert(first.samilaLive?.accumulationPasses===1&&second.samilaLive?.accumulationPasses===2,'Worker same-time fresh display');
    const same=await generator.captureSamilaPaused(second,{width:64,height:48});
    assert(same.capture.samilaLive?.accumulationPasses===3&&same.preview.samilaLive?.accumulationPasses===4,'Worker same-size two displays');
    assert(same.capture.samilaLive?.target==='offscreen'&&same.preview.samilaLive?.target==='primary','Worker capture roles');
    let error;try{await generator.captureSamilaPaused(same.preview,{width:0,height:48});}catch(e){error={name:e.name,message:e.message,previewRetained:e.previewRetained};}
    assert(error?.previewRetained===true,'Worker preflight must explicitly retain current owner');
    const different=await generator.captureSamilaPaused(same.preview,{width:80,height:52});
    assert(different.capture.width===80&&different.capture.height===52&&different.preview.width===64&&different.preview.height===48,'Worker capture target/primary dimensions');
    assert(different.capture.samilaLive?.accumulationPasses===1&&different.preview.samilaLive?.accumulationPasses===1,'Worker resize single ink pair');
    const requests=audit.requests.length;let rejected=false;try{await generator.captureSamilaPaused(second,{width:64,height:48});}catch{rejected=true;}
    assert(rejected&&audit.requests.length===requests,'stale public output rejected before Worker');
    assert(audit.created===1&&audit.terminated===0&&new Set(audit.requests.map(r=>r.sessionId)).size===1,'capture must retain one Worker session');
    assert(same.preview.temporal.time===second.temporal.time&&different.preview.temporal.time===second.temporal.time,'capture does not advance simulation');
    row.outputs={first:first.samilaLive,second:second.samilaLive,same:{capture:same.capture.samilaLive,preview:same.preview.samilaLive},different:{capture:different.capture.samilaLive,preview:different.preview.samilaLive}};row.preflight=error;
    row.rgba={sameCapture:await digest(same.capture.pixels.buffer),samePreview:await digest(same.preview.pixels.buffer),differentCapture:await digest(different.capture.pixels.buffer),differentPreview:await digest(different.preview.pixels.buffer)};
   }finally{generator?.dispose();window.Worker=Native;row.audit=audit;assert(audit.created===audit.terminated,'public Worker cleanup');}
  });
  result.assertions=assertions;return result;
 },{sourceEvents});
 report.status=report.result.cases.every(r=>r.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page&&!report.result)try{report.result=await page.evaluate(()=>window.__hotEvidence);}catch{}}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map((r,i)=>({resource:['browser','vite'][i],status:r.status,...r.status==='rejected'?{error:String(r.reason)}:{}}));
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||report.cleanup.some(r=>r.status!=='fulfilled'))report.status='failed';
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));await writeFile(directory+'/report.md',`# Samila hot lifecycle\n\n${report.status}; source stable ${report.sourceStable}; ${(report.elapsedMs/1000).toFixed(2)} s (functional run).\n\n${report.error??''}\n\n| Case | Status | Failure |\n|---|---|---|\n${report.result?.cases?.map(r=>`| ${r.name} | ${r.status} | ${r.error??''} |`).join('\n')??''}\n\n${report.limits.map(x=>'- '+x).join('\n')}\n`);
 console.log(JSON.stringify({status:report.status,directory,sourceStable:report.sourceStable,elapsedMs:report.elapsedMs,error:report.error,cases:report.result?.cases?.map(r=>({name:r.name,status:r.status,error:r.error}))}));if(report.status!=='passed')process.exitCode=1;
}
