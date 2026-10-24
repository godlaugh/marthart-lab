/** Real Generator/Worker/CPU sampling/WebGL control-owner acceptance.
 * Run only after the Roots control contract and its consumers are stable.
 * Observers copy actual color plans and batches; they do not replace outputs,
 * commands, clocks, sampling or scheduling. No App, desktop, JVM or MP4 claim. */
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {measureFamily} from './browser-process-cost.mjs';

const script='scripts/verify-roots-control-owner.mjs';
const out=process.argv[2]??`.cache/roots-control-owner-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^roots-control-owner-[^/]+(?:\/run-[a-zA-Z0-9_-]+)?$/,'Use a new owned cache directory');
await mkdir(dirname(out),{recursive:true});await mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function hashes(){
 const paths=[];for(const p of await readdir('src',{recursive:true}))if(/\.(ts|tsx|json|css)$/.test(p))paths.push('src/'+p);
 paths.push(script,'scripts/browser-process-cost.mjs','package.json','package-lock.json');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const channel='roots-control-observation-'+Date.now();
const report={status:'prepared',at:new Date().toISOString(),directory:out,nodeVersion:process.version,nodeExecutable:process.execPath,
 scope:'Two public Generator paths through actual generation Worker, CPU computation Workers and WebGL: cold A/hot B/record A/finish A/fresh same-value hot B/full Apply B/record B. Exact prepared LUT and completed RGBA, staged author fields, same-size paused capture. No App UI, original JVM or MP4 execution.',
 limits:['One fixed sampling Worker and finite synthetic fixture; no claim about multiple-worker arrival order or native full-image parity.','Capture uses identical physical/logical targets; arbitrary-size density capture is not claimed.','Saved PNG files visualize actual delivered RGBA through a browser canvas; they do not establish the App PNG export path.','Passive batch/color hashing and serialization are included in sampled cost. The sequential legacy/control comparison has one run per variant, a warm browser and fresh Workers; no statistical speedup or token-cost claim.'],
 cases:[],transportFaults:[],costComparison:[],pageErrors:[]};
await writeFile(out+'/verifier.mjs',await readFile(script));report.sourceBefore=await hashes();
let server,browser,page;const started=performance.now();

// This independent channel never enters a production Worker message handler.
const observerPrelude=`
const audit=globalThis.__rootsControlObserver??=(function(){
 const channel=new BroadcastChannel(${JSON.stringify(channel)}),poolIds=new WeakMap(),colors=new WeakMap();let sequence=0,nextPool=0;
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const emit=(row,bytes)=>{row.sequence=++sequence;const copy=bytes?.slice();if(copy)hash(copy).then(digest=>channel.postMessage({...row,sha256:digest})).catch(error=>channel.postMessage({kind:'observer-error',error:String(error)}));else channel.postMessage(row);};
 return{poolIds,colors,emit,poolId(pool){if(!poolIds.has(pool))poolIds.set(pool,++nextPool);return poolIds.get(pool);}};
})();
`;
const poolObserver=observerPrelude+`
const nativeStart=RootsComputationPool.prototype.start,nativeTake=RootsComputationPool.prototype.take;
RootsComputationPool.prototype.start=function(...args){const result=nativeStart.apply(this,args);audit.emit({kind:'pool-start',pool:audit.poolId(this),plan:this.describe()});return result;};
RootsComputationPool.prototype.take=function(...args){const batch=nativeTake.apply(this,args);if(batch)audit.emit({kind:'batch',pool:audit.poolId(this),workerIndex:batch.workerIndex,batchSequence:batch.sequence,terminal:batch.terminal,bytes:batch.points.byteLength,progress:structuredClone(batch.progress),invalidRoots:batch.invalidRoots},new Uint8Array(batch.points.buffer,batch.points.byteOffset,batch.points.byteLength));return batch;};
`;
const sessionObserver=observerPrelude+`
const nativeRead=RootsNativePresentationSession.prototype.readDisplay,nativeRun=RootsNativePresentationSession.prototype.runLive,nativeCapture=RootsNativePresentationSession.prototype.capturePaused;
if(typeof nativeRead!=='function'||typeof nativeRun!=='function'||typeof nativeCapture!=='function')throw Error('Roots observer no longer matches production methods');
RootsNativePresentationSession.prototype.readDisplay=function(plan,color,...args){const result=nativeRead.call(this,plan,color,...args);audit.colors.set(this,{lut:Array.from(color.lut),plan:structuredClone(plan),tone:{brightness:color.brightness,contrast:color.contrast,gamma:color.gamma,dynamicRange:color.dynamicRange,saturation:color.saturation,paletteOffset:color.paletteOffset}});return result;};
function observed(owner,output,method){const color=audit.colors.get(owner);if(!color)throw Error('No real prepared color observed');audit.emit({kind:'frame',method,pool:owner.concurrent?.pool?audit.poolId(owner.concurrent.pool):null,color:structuredClone(color),width:output.width,height:output.height,roots:structuredClone(output.roots),presentation:structuredClone(output.rootsPresentation),live:structuredClone(output.rootsLive)},output.pixels);}
RootsNativePresentationSession.prototype.runLive=function(...args){const output=nativeRun.apply(this,args);observed(this,output,'runLive');return output;};
RootsNativePresentationSession.prototype.capturePaused=function(...args){const pair=nativeCapture.apply(this,args);observed(this,pair.capture,'capture');observed(this,pair.preview,'capture-preview');return pair;};
`;
const enhancementObserver=observerPrelude+`
const nativeEnhancement=enhanceSourcePausedImage;
enhanceSourcePausedImage=function(pixels,width,height){const id=crypto.randomUUID();audit.emit({kind:'enhancement-input',id,width,height},pixels);const output=nativeEnhancement(pixels,width,height);audit.emit({kind:'enhancement-output',id,width,height},output);return output;};
`;

const paletteA=['#80112233','#ffDD5522','#00AAFF'];
const paletteB=['#80553311','#AA00FFCC','#DD44FF'];
function fixture(mode){return{config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Roots controls '+mode,
 polynomial:{variable:'z',coefficients:{2:'1',0:'t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},sampling:{sample_count:256,batch_size:64,seed:91},
 palette:paletteA,camera:{phi:'0',theta:'0',gamma:'0'},settings:{render_mode:mode,worker_count:1,max_splat_points_per_frame:64,color_metric:'im(t2)',scale_x:35,scale_y:35,scale_z:35,dot_size:.03,brightness:1,contrast:1,gamma:2.2,dynamic_range:.9,saturation:1,background_color:'#000000'},timeline:[]};}

try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:900,height:700},deviceScaleFactor:1});
 for(const [file,extra]of [['rootsComputationPool.ts',poolObserver],['rootsNativePresentationSession.ts',sessionObserver],['sourcePausedImage.ts',enhancementObserver]])await context.route('**/src/engine/'+file+'*',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({response,body:await response.text()+'\n'+extra});});
 page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));page.setDefaultTimeout(30000);
 await page.addInitScript(name=>{window.__rootsOwnerAudit=[];window.__rootsOwnerChannel=new BroadcastChannel(name);window.__rootsOwnerChannel.onmessage=e=>window.__rootsOwnerAudit.push(e.data);},channel);
 await page.route('**/roots-owner-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Owned headless Roots control verifier</title><canvas id="actual-capture"></canvas>'}));
 const artifacts=[];
 await page.route('**/roots-owner-artifact/*',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^(density|point-cloud)-[a-z0-9-]+\.(png|rgba)$/);const bytes=route.request().postDataBuffer();assert.ok(bytes.length<=192*144*4+4096);const path=out+'/'+name;await writeFile(path,bytes);artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});await route.fulfill({status:200,body:'ok'});});
 await page.goto(server.resolvedUrls.local[0]+'roots-owner-check');
 let workflowFailure;
 report.measurements=await measureFamily(process.pid,async()=>{
  const begin=performance.now();
  try{
  for(const sourceMode of ['GPU_DENSITY','GPU_3D']){
   await page.evaluate(()=>{window.__rootsOwnerAudit=[];});
   const input=fixture(sourceMode);await writeFile(out+'/'+sourceMode+'-input.json',JSON.stringify(input,null,2)+'\n');
   console.log(JSON.stringify({phase:sourceMode}));
   const result=await page.evaluate(async({input,paletteB})=>{
    const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
    const checks=[],rows=[],equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),check=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const sleep=()=>new Promise(r=>setTimeout(r,2)),audit=window.__rootsOwnerAudit;
    const original=parseLegacyScene(JSON.stringify(input)).scene,mode=original.rootsPresentation.mode,g=new Generator();
    check(original.rootsPresentation.accumulation.enabled===false,'fixture disables accumulated point-cloud redraw history');
    const b={...structuredClone(original),rootsSourcePalette:{colors:paletteB}};
    const staged=structuredClone(b);staged.rootsPresentation.mode=mode==='density'?'point-cloud':'density';staged.rootsPresentation.camera.phi=.4;
    staged.timeline.tracks=[{id:'unapplied-wait',type:'wait',target:'timeline.wait',label:'staged only',from:0,to:0,start:0,duration:60,easing:'linear',pingPong:false,enabled:true}];
    let author=original,revision=0,context={time:0,width:192,height:144,quality:'preview',rootsPixelDensity:1,rootsViewport:{logicalWidth:192,logicalHeight:144,referenceLogicalHeight:144,target:'primary'},rootsLive:{sessionId:'owner-'+mode,maximumWorkers:1,clock:{paused:true,timestampMs:1000},controls:{acknowledgedRevision:0,commands:[]}}};
    const expectedA=Array.from(prepareRootsDensityColor(original).lut),expectedB=Array.from(prepareRootsDensityColor(b).lut);
    async function observation(output,after,method='runLive'){
     const digest=await hash(output.pixels);for(let i=0;i<2000;i++){
      const error=audit.find(x=>x.kind==='observer-error');if(error)throw Error(error.error);
      const found=audit.slice(after).find(x=>x.kind==='frame'&&x.method===method&&(method==='capture'||x.sha256===digest)&&x.presentation.instance===output.rootsPresentation.instance&&x.live.frame.frame===output.rootsLive.frame.frame&&equal(x.live.controls,output.rootsLive.controls));
      if(found)return found;await sleep();
     }throw Error('Passive real-frame/color observation timed out');
    }
    async function observed(label,action,expected,method='runLive'){
     const at=audit.length,output=await action(),facts=await observation(output,at,method),receipt=output.rootsLive.controls;
     check(receipt&&Number.isSafeInteger(receipt.revision)&&Number.isSafeInteger(receipt.applyRevision)&&Number.isSafeInteger(receipt.resetRevision),label+': explicit control receipt');
     check(equal(facts.color.lut,expected),label+': actual prepared GPU LUT equals intended palette');
     check(output.rootsPresentation.mode===mode&&facts.color.plan.camera.phi===original.rootsPresentation.camera.phi,label+': staged mode/camera did not leak');
     check(!output.rootsLive.autoRecording.hasAnimations,label+': staged timeline did not leak');
     check(output.width===192&&output.height===144&&equal(output.rootsPresentation.logicalSize,[192,144]),label+': exact physical/logical targets');
     rows.push({label,output:{...output,pixels:undefined},rgbaSha256:facts.sha256,observation:facts});return output;
    }
    function acknowledge(output){revision=output.rootsLive.controls.revision;context={...context,time:output.rootsLive.sceneTime,rootsLive:{...context.rootsLive,controls:{acknowledgedRevision:revision,commands:[]}}};}
    async function generate(label,commands,expected){context={...context,rootsLive:{...context.rootsLive,controls:{acknowledgedRevision:revision,commands}}};const output=await observed(label,()=>g.generate(author,context),expected);acknowledge(output);return output;}
    function complete(output){const s=output.rootsLive.stream;return output.rootsLive.autoRecording.complete&&s.canFinishAfterDisplay&&s.pool.computationComplete&&s.pool.queuedBatches===0&&s.pool.waitingBatches===0&&s.pending.queuedBatches===0&&s.pending.pendingPoints===0&&s.pending.finishedWorkers===s.pending.workerCount;}
    async function drain(output,label,expected){for(let i=0;!complete(output)&&i<500;i++){await sleep();output=await generate(label+' drain '+i,[],expected);}check(complete(output),label+': all computation/arrival/pending/display completion facts');check(output.roots.attemptedSamples===256&&output.roots.rootPoints===512,label+': complete exact finite sample/root counts');return output;}
    function retained(before,after,label){check(before.rootsPresentation.instance===after.rootsPresentation.instance,label+': retains computation instance');check(after.roots.attemptedSamples===before.roots.attemptedSamples&&after.roots.rootPoints===before.roots.rootPoints,label+': retains completed samples');check(after.rootsLive.sceneTime===before.rootsLive.sceneTime,label+': paused clock retained');check(after.rootsLive.controls.resetRevision===before.rootsLive.controls.resetRevision,label+': no reset command');}
    async function capture(before,label,expected){
     const at=audit.length,pair=await g.captureRootsPaused(before,{width:192,height:144},1);
     const raw=await observation(pair.capture,at,'capture'),refresh=await observation(pair.preview,at,'capture-preview');
     check(equal(raw.color.lut,expected)&&equal(refresh.color.lut,expected),label+': capture and refresh use current LUT');
     check(raw.sha256===await hash(before.pixels)&&refresh.sha256===raw.sha256,label+': capture and refresh exactly retain completed RGBA');
     const deliveredSha256=await hash(pair.capture.pixels);let enhancement;
     for(let i=0;i<1000;i++){const events=audit.slice(at),input=events.find(e=>e.kind==='enhancement-input'&&e.sha256===raw.sha256),output=input&&events.find(e=>e.kind==='enhancement-output'&&e.id===input.id&&e.sha256===deliveredSha256);if(output){enhancement={input,output};break;}await sleep();}
     check(enhancement,label+': actual raw capture passes through enhancement into delivered capture');
     check(equal(pair.capture.rootsLive.frame,before.rootsLive.frame)&&equal(pair.preview.rootsLive.frame,before.rootsLive.frame),label+': no capture clock advance');
     const canvas=document.querySelector('#actual-capture');canvas.width=192;canvas.height=144;canvas.getContext('2d').putImageData(new ImageData(pair.capture.pixels,192,144),0,0);
     const png=await new Promise(r=>canvas.toBlob(r,'image/png'));for(const [ext,bytes]of [['png',png],['rgba',pair.capture.pixels]]){const response=await fetch('/roots-owner-artifact/'+mode+'-'+label+'.'+ext,{method:'POST',body:bytes});check(response.ok,label+': captured artifact '+ext);}
     rows.push({label,operation:'capture',rawRgbaSha256:raw.sha256,deliveredRgbaSha256:deliveredSha256,enhancement,capture:{...pair.capture,pixels:undefined},preview:{...pair.preview,pixels:undefined},observations:[raw,refresh]});acknowledge(pair.preview);return pair.preview;
    }
    async function record(before,label,expected){
     const at=audit.length,start=await g.beginSourceRecording(before,{width:64,height:48,simulationFps:30});
     check(equal(start.scene,author),label+': begin retains exact authored scene');
     let output=start.warmup,facts=await observation(output,at);check(equal(facts.color.lut,expected),label+': warmup uses intended cold LUT');
     const warmup=output.rootsLive;check(warmup.controls.resetRevision===before.rootsLive.controls.resetRevision+1,label+': recording explicitly resets once');check(warmup.controls.revision===revision,label+': recording does not invent authored command');
     check(warmup.controls.applyRevision===before.rootsLive.controls.applyRevision,label+': recording keeps cold Apply identity');
     check(equal(start.context.rootsLive.controls,{acknowledgedRevision:revision,commands:[]}),label+': begin context carries normalized acknowledged receipt');
     rows.push({label:label+' warmup',scene:start.scene,context:start.context,clock:start.clock,output:{...output,pixels:undefined},observation:facts});
     let count=0;while(!output.rootsLive.recording.complete&&count<300){await sleep();count++;output=await observed(label+' frame '+count,()=>g.nextSourceRecordingFrame(start.handle,count),expected);}
     check(output.rootsLive.recording.complete&&complete(output),label+': observed natural display completion');check(output.roots.rootPoints===512,label+': recording retains all actual roots');
     const last=output,stopAt=audit.length,stop=await g.finishSourceRecording(start.handle),stopFacts=await observation(stop.preview,stopAt);
     check(equal(stop.scene,author),label+': finish retains exact authored scene');check(equal(stop.preview.rootsLive.frame,last.rootsLive.frame),label+': finish does not advance final frame');
     check(equal(stop.preview.rootsLive.controls,warmup.controls),label+': finish retains exact recording receipt');
     check(equal(stop.context.rootsLive.controls,{acknowledgedRevision:revision,commands:[]}),label+': finish context carries normalized acknowledged receipt');
     check(equal(stopFacts.color.lut,expected),label+': finish remains on recording LUT');check(stopFacts.sha256===await hash(last.pixels),label+': same-size handoff retains last RGBA');check(!g.hasSourceRecording(start.handle),label+': recording capability released');
     rows.push({label:label+' finish',scene:stop.scene,context:stop.context,preview:{...stop.preview,pixels:undefined},observation:stopFacts,recordedFrames:count});
     context=structuredClone(stop.context);await g.setRootsPaused(stop.preview,true);context.rootsLive.clock={paused:true,timestampMs:1000};acknowledge(stop.preview);
     return generate(label+' ordinary paused redraw',[],expected);
    }
    try{
     let output=await generate('initial apply A',[{kind:'apply',revision:1,scene:original}],expectedA);output=await drain(output,'initial A',expectedA);const initial=output,hashA=await hash(output.pixels);
     author=staged;output=await generate('hot B with staged mode camera timeline',[{kind:'palette',revision:revision+1,palette:b.rootsSourcePalette}],expectedB);retained(initial,output,'hot B');check(output.rootsLive.controls.applyRevision===initial.rootsLive.controls.applyRevision,'hot B retains cold A Apply identity');const hashB=await hash(output.pixels);check(hashA!==hashB,'A and B actual completed images differ');
     output=await generate('ordinary staged redraw',[],expectedB);output=await capture(output,'before-record-b',expectedB);
     output=await record(output,'record-a',expectedA);check(await hash(output.pixels)===hashA,'cold A reconstruction matches initial completed RGBA');output=await capture(output,'after-record-a',expectedA);
     const stopped=output;output=await generate('fresh same-value hot B',[{kind:'palette',revision:revision+1,palette:b.rootsSourcePalette}],expectedB);retained(stopped,output,'fresh hot B');check(await hash(output.pixels)===hashB,'same-value fresh hot command restores exact B image');
     author=b;output=await generate('discard staged fields without apply',[],expectedB);const prior=output;
     output=await generate('explicit full Apply B',[{kind:'apply',revision:revision+1,scene:b}],expectedB);check(output.rootsLive.controls.applyRevision===revision&&output.rootsLive.controls.resetRevision===prior.rootsLive.controls.resetRevision+1,'full Apply commits new cold config and resets once');output=await drain(output,'full Apply B',expectedB);check(await hash(output.pixels)===hashB,'full Apply B completed image equals prior hot B');
     output=await record(output,'record-b',expectedB);check(await hash(output.pixels)===hashB,'record B completion retains B image');await capture(output,'after-record-b',expectedB);
     // Let passive hashes arrive; every terminal batch must be represented.
     const pools=[...new Set(rows.map(r=>r.observation?.pool).filter(Boolean))];for(let i=0;i<1000&&!pools.every(pool=>audit.some(a=>a.kind==='batch'&&a.pool===pool&&a.terminal));i++)await sleep();
     const batches=pools.map(pool=>({pool,rows:audit.filter(a=>a.kind==='batch'&&a.pool===pool).sort((a,b)=>a.batchSequence-b.batchSequence)}));
     for(const p of batches){check(p.rows.length>0&&p.rows.at(-1).terminal,'CPU pool '+p.pool+': terminal consumed batch observed');check(p.rows.reduce((n,b)=>n+b.bytes,0)===512*16,'CPU pool '+p.pool+': all actual root bytes observed');for(let i=0;i<p.rows.length;i++)check(p.rows[i].batchSequence===i&&p.rows[i].workerIndex===0,'CPU pool '+p.pool+': one ordered worker batch '+i);}
     const shape=p=>p.rows.map(({sha256,bytes,progress,terminal})=>({sha256,bytes,progress,terminal}));for(const p of batches.slice(1))check(equal(shape(p),shape(batches[0])),'CPU pool '+p.pool+': exact consumed batch bytes/counters equal initial A');
     return{status:'passed',mode,checks,rows,batches,initialRgbaSha256:hashA,hotRgbaSha256:hashB};
    }finally{g.dispose();}
   },{input,paletteB});
   report.cases.push(result);await page.waitForTimeout(250);assert.equal(page.workers().length,0,'All generation and computation Workers must exit between cases');
  }
  await page.evaluate(()=>{window.__rootsOwnerAudit=[];});
  report.queueRecording=await page.evaluate(async({input,paletteB})=>{
   const {Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts'),{RootsControlJournal}=await import('/src/engine/rootsControlJournal.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
   const original=parseLegacyScene(JSON.stringify(input)).scene,author={...structuredClone(original),rootsSourcePalette:{colors:paletteB}},deferred=structuredClone(author);
   author.rootsPresentation.mode='point-cloud';author.rootsPresentation.camera.phi=.4;author.timeline.tracks=[{id:'stage',type:'wait',target:'timeline.wait',label:'staged',from:0,to:0,start:0,duration:60,easing:'linear',pingPong:false,enabled:true}];
   deferred.rootsPresentation=structuredClone(author.rootsPresentation);deferred.rootsPresentation.camera.phi=.8;deferred.timeline=structuredClone(author.timeline);deferred.name='Deferred author B';
   const sessionId='queue-control-owner',journal=new RootsControlJournal(sessionId,original),g=new Generator(),events=[],checks=[],wire=[];
   window.__rootsOwnerScenario={type:'queue',events,checks,wire};
   const check=(v,m)=>{if(!v)throw Error(m);checks.push(m);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sleep=()=>new Promise(r=>setTimeout(r,2));
   const native=g.generate;g.generate=async function(scene,context,...args){wire.push({scene:structuredClone(scene),controls:structuredClone(context.rootsLive.controls)});events.push({kind:'send',revision:context.rootsLive.controls.commands.at(-1)?.revision??context.rootsLive.controls.acknowledgedRevision});return native.call(this,scene,context,...args);};
   let latest,latestSource,outputs=0,failure,stopped,shouldStop=false;
   const context=()=>({time:latest?.rootsLive.sceneTime??0,width:192,height:144,quality:'preview',rootsPixelDensity:1,rootsViewport:{logicalWidth:192,logicalHeight:144,referenceLogicalHeight:144,target:'primary'},rootsLive:{sessionId,maximumWorkers:1,clock:{paused:true,timestampMs:1000},controls:journal.request()}});
   const queue=new GenerationQueue(g,{busy:()=>{},error:error=>{failure=error;},output:(output,_time,source)=>{latest=output;latestSource=source;outputs++;events.push({kind:'output',controls:structuredClone(output.rootsLive.controls)});},rootsControlAcknowledged:(id,receipt)=>{events.push({kind:'ack',receipt:structuredClone(receipt)});journal.acknowledge(id,receipt);},recordingStopped:(stop,source)=>{stopped=stop;events.push({kind:'stop',receipt:structuredClone(journal.receipt)});check(equal(source,author)&&equal(stop.scene,deferred),'queue identifies original recording author and preserves newest deferred author');check(journal.receipt.revision===2&&journal.receipt.resetRevision===2,'queue acknowledges recording reset before stop callback');}});
   async function request(scene){const before=outputs;queue.request(scene,context());for(let i=0;i<2000&&outputs===before&&!failure;i++)await sleep();if(failure)throw failure;check(outputs>before,'queue request delivered real Worker output');return latest;}
   try{
    await request(original);for(let i=0;i<500&&!latest.rootsLive.stream.canFinishAfterDisplay;i++)await request(original);check(latest.roots.rootPoints===512&&journal.receipt.revision===1,'queue initial Apply completes real CPU samples and ack');
    journal.enqueue({kind:'palette',palette:author.rootsSourcePalette});await request(author);check(journal.receipt.revision===2&&journal.pendingCount===0,'queue consumes hot B before recording');
    await queue.recordSource(latest,{width:64,height:48,simulationFps:30},{
     start:async start=>{check(start.warmup.rootsLive.controls.resetRevision===2&&journal.receipt.resetRevision===2,'queue acknowledges warmup reset');check(start.warmup.rootsPresentation.mode==='density'&&!start.warmup.rootsLive.autoRecording.hasAnimations,'queue recording excludes staged mode/timeline');},
     shouldStop:()=>shouldStop,
     frame:async(output,index)=>{check(index===0&&output.rootsLive.controls.revision===2,'queue recording consumes one real cold frame');journal.enqueue({kind:'palette',palette:deferred.rootsSourcePalette});queue.request(deferred,context());shouldStop=true;},
     complete:async()=>{},
    });
    for(let i=0;i<2000&&latest?.rootsLive.controls.revision!==3&&!failure;i++)await sleep();if(failure)throw failure;
    check(stopped&&latest.rootsLive.controls.revision===3,'deferred hot command executes after real recording finish');
    check(equal(latestSource,deferred),'deferred output retains newest staged author');check(latest.rootsPresentation.mode==='density'&&!latest.rootsLive.autoRecording.hasAnimations,'deferred author stage does not become applied mode/timeline');
    const sent=wire.at(-1).controls;check(sent.acknowledgedRevision===2&&sent.commands.length===1&&sent.commands[0].kind==='palette'&&sent.commands[0].revision===3&&equal(sent.commands[0].palette,deferred.rootsSourcePalette),'deferred transport carries ack 2 and only fresh hot 3');
    check(journal.receipt.revision===3&&journal.receipt.applyRevision===1&&journal.receipt.resetRevision===2&&journal.pendingCount===0,'journal consumes hot 3 without changing cold/reset identity');
    check(events.findIndex(e=>e.kind==='stop')<events.findIndex(e=>e.kind==='send'&&e.revision===3),'stop acknowledgement precedes deferred hot transport');
    const expected=Array.from(prepareRootsDensityColor(original).lut),hot=Array.from(prepareRootsDensityColor(deferred).lut),audit=window.__rootsOwnerAudit;
    for(let i=0;i<1000&&!audit.some(r=>r.kind==='frame'&&r.live.controls?.revision===3);i++)await sleep();
    const cold=audit.filter(r=>r.kind==='frame'&&r.live.controls?.revision===2&&r.live.controls?.resetRevision===2),newHot=audit.findLast(r=>r.kind==='frame'&&r.live.controls?.revision===3);
    check(cold.length>0&&cold.every(r=>equal(r.color.lut,expected)),'real queue recording and handoff prepared LUT stays cold A');
    check(newHot&&equal(newHot.color.lut,hot),'real deferred frame prepared LUT is B');
    return{status:'passed',checks,events,wire,stop:{scene:stopped.scene,context:stopped.context,preview:{...stopped.preview,pixels:undefined}},last:{source:latestSource,output:{...latest,pixels:undefined}},observations:{cold,newHot}};
   }finally{queue.dispose();g.dispose();}
  },{input:fixture('GPU_DENSITY'),paletteB});
  await page.waitForTimeout(250);assert.equal(page.workers().length,0,'Queue case must release all Workers');
  await page.evaluate(()=>{window.__rootsOwnerAudit=[];});
  report.retainedRejections=await page.evaluate(async({input,paletteB})=>{
   const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
   const original=parseLegacyScene(JSON.stringify(input)).scene,author={...structuredClone(original),rootsSourcePalette:{colors:paletteB}},g=new Generator(),audit=window.__rootsOwnerAudit,checks=[],rejections=[];
   const check=(v,m)=>{if(!v)throw Error(m);checks.push(m);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sleep=()=>new Promise(r=>setTimeout(r,2));
   const context={time:0,width:192,height:144,quality:'preview',rootsPixelDensity:1,rootsViewport:{logicalWidth:192,logicalHeight:144,referenceLogicalHeight:144,target:'primary'},rootsLive:{sessionId:'retained-control',maximumWorkers:1,clock:{paused:true,timestampMs:1000},controls:{acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:original}]}}};
   let output,stop;
   try{
    output=await g.generate(original,context);context.rootsLive.controls={acknowledgedRevision:1,commands:[]};
    for(let i=0;i<500&&!output.rootsLive.stream.canFinishAfterDisplay;i++){await sleep();output=await g.generate(original,context);}
    context.rootsLive.controls={acknowledgedRevision:1,commands:[{kind:'palette',revision:2,palette:author.rootsSourcePalette}]};output=await g.generate(author,context);
    check(output.roots.rootPoints===512,'retained fixture has completed samples');const before=structuredClone(output.rootsLive.controls),instance=output.rootsPresentation.instance;
    for(let i=0;i<1000&&!audit.some(r=>r.kind==='pool-start');i++)await sleep();const pools=audit.filter(r=>r.kind==='pool-start').length;check(pools===1,'one owned computation pool before rejected edits');
    const bad=[['malformed-tone',{acknowledgedRevision:2,commands:[{kind:'tone',revision:3,tone:{brightness:NaN}}]}],['future-ack',{acknowledgedRevision:3,commands:[]}],['reused-revision-payload',{acknowledgedRevision:1,commands:[{kind:'palette',revision:2,palette:original.rootsSourcePalette}]}]];
    for(const [fault,controls]of bad){
     let error;try{await g.generate(author,{...context,rootsLive:{...context.rootsLive,controls}});}catch(cause){error=cause;}
     check(error&&error.previewRetained===true,fault+': explicit retained-preview rejection');
     const at=audit.length,pair=await g.captureRootsPaused(output,{width:192,height:144},1);check(equal(pair.preview.rootsLive.controls,before)&&pair.preview.rootsPresentation.instance===instance,fault+': old receipt and instance survive capture');
     check(pair.preview.pixels.every((x,i)=>x===output.pixels[i]),fault+': old completed preview pixel bytes survive capture');
     const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''),rawHash=await digest(output.pixels),deliveredHash=await digest(pair.capture.pixels);let linked=false;
     for(let i=0;i<1000&&!linked;i++){const events=audit.slice(at),raw=events.find(a=>a.kind==='enhancement-input'&&a.sha256===rawHash);linked=!!raw&&events.some(a=>a.kind==='enhancement-output'&&a.id===raw.id&&a.sha256===deliveredHash);if(!linked)await sleep();}
     check(linked,fault+': retained raw snapshot reaches actual enhanced capture');
     check(audit.filter(r=>r.kind==='pool-start').length===pools,fault+': no CPU sampler reconstruction');
     output=pair.preview;rejections.push({fault,error:String(error),previewRetained:error.previewRetained,receipt:pair.preview.rootsLive.controls,instance:pair.preview.rootsPresentation.instance});
    }
    const started=await g.beginSourceRecording(output,{width:64,height:48,simulationFps:30});let frame=started.warmup,index=0;
    while(!frame.rootsLive.recording.complete&&index<300){await sleep();frame=await g.nextSourceRecordingFrame(started.handle,++index);}
    check(frame.rootsLive.recording.complete&&frame.roots.rootPoints===512,'retained old completion can still record all real roots');stop=await g.finishSourceRecording(started.handle);
    check(equal(stop.scene,author)&&stop.preview.rootsLive.controls.revision===2&&stop.preview.rootsLive.controls.applyRevision===1,'retained recording preserves author and cold Apply identity');
    for(let i=0;i<1000&&!audit.some(a=>a.kind==='frame'&&a.live.controls?.resetRevision===2);i++)await sleep();
    const actual=audit.filter(a=>a.kind==='frame'&&a.live.controls?.resetRevision===2),cold=Array.from(prepareRootsDensityColor(original).lut);check(actual.length>0&&actual.every(a=>equal(a.color.lut,cold)),'retained recording actually uses cold A prepared LUT');
   }finally{g.dispose();}
   const replacement=new Generator(),lost={...context,rootsLive:{...context.rootsLive,controls:{acknowledgedRevision:2,commands:[]}}};let lostError;
   const poolCount=audit.filter(a=>a.kind==='pool-start').length;
   try{try{await replacement.generate(author,lost);}catch(cause){lostError=cause;}check(lostError&&/重新 Apply/.test(String(lostError)),'fresh Worker with ack only explicitly requires Apply');check(audit.filter(a=>a.kind==='pool-start').length===poolCount,'missing owner does not reconstruct from authored B');}finally{replacement.dispose();}
   return{status:'passed',checks,rejections,recordingStop:{scene:stop.scene,context:stop.context,preview:{...stop.preview,pixels:undefined}},workerLoss:{error:String(lostError),requiresApply:true}};
  },{input:fixture('GPU_DENSITY'),paletteB});
  await page.waitForTimeout(250);assert.equal(page.workers().length,0,'Rejected commands and Worker-loss cases must release all Workers');
  report.transportFaults=await page.evaluate(async input=>{
   const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts');
   const NativeWorker=globalThis.Worker,results=[];
   // Only the received transport envelope is corrupted. Real CPU/GPU work
   // precedes each injection, and its unmodified facts are retained below.
   for(const fault of ['stop-revision','stop-reset','frame-mode','frame-animations','frame-formula']){
    let injected=false,originalFacts;
    globalThis.Worker=class extends NativeWorker{
     set onmessage(handler){super.onmessage=event=>{
      const data=event.data,operation=fault.startsWith('stop-')?'source-recording-finish':'source-recording-frame';
      if(!injected&&data.operation===operation&&!data.error){
       const output=data.output??data.result.preview;injected=true;
       originalFacts={controls:structuredClone(output.rootsLive.controls),mode:output.rootsPresentation.mode,hasAnimations:output.rootsLive.autoRecording.hasAnimations,formula:structuredClone(output.formulaPresentation),rootPoints:output.roots.rootPoints,backend:output.backend};
       if(fault==='stop-revision')output.rootsLive.controls.revision++;
       if(fault==='stop-reset')output.rootsLive.controls.resetRevision++;
       if(fault==='frame-mode'){output.rootsPresentation.mode='point-cloud';output.rootsLive.autoRecording.mode='point-cloud';}
       if(fault==='frame-animations')output.rootsLive.autoRecording.hasAnimations=true;
       if(fault==='frame-formula'){if(!output.formulaPresentation.labels.length)throw Error('Formula fault requires a real formula');output.formulaPresentation.labels[0].latex='corrupted formula';}
      }
      handler(event);
     };}
    };
    const raw=structuredClone(input);raw.main_equation={enabled:true,latex:'z^2+t_2=0',color:'#FFFFFF',position:[0,0],scale:.25};
    const scene=parseLegacyScene(JSON.stringify(raw)).scene,g=new Generator();let start,error;
    const context={time:0,width:192,height:144,quality:'preview',rootsPixelDensity:1,rootsViewport:{logicalWidth:192,logicalHeight:144,referenceLogicalHeight:144,target:'primary'},rootsLive:{sessionId:'fault-'+fault,maximumWorkers:1,clock:{paused:true,timestampMs:1000},controls:{acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}}};
    try{
     const preview=await g.generate(scene,context);start=await g.beginSourceRecording(preview,{width:64,height:48,simulationFps:30});
     try{if(fault.startsWith('stop-'))await g.finishSourceRecording(start.handle);else await g.nextSourceRecordingFrame(start.handle,1);}catch(cause){error=cause;}
     if(!injected||!error||error.recordingRetained!==false||g.hasSourceRecording(start.handle))throw Error('Production transport did not revoke corrupt '+fault+' response: '+String(error));
     results.push({fault,rejected:true,recordingRetained:false,originalFacts,error:String(error),scope:'Injected protocol-envelope corruption after real Worker/GPU output; not a simulated mathematical provider or observed external fault.'});
    }finally{g.dispose();globalThis.Worker=NativeWorker;}
   }
   return results;
  },fixture('GPU_DENSITY'));
  await page.waitForTimeout(250);assert.equal(page.workers().length,0,'Fault cases must release generation and computation Workers');report.remainingWorkers=0;
  }catch(error){workflowFailure=error;}
  return{elapsedMs:performance.now()-begin,costScope:'Two actual Worker matrices after Vite/browser setup; includes passive hashing and artifact persistence'};
 });
 if(workflowFailure)throw workflowFailure;
 // Equivalent single-run cost witnesses, sequentially in the same warm browser.
 // Each owns a fresh Generator/generation Worker and the same finite sampler.
 for(const explicitControls of [false,true]){
  await page.evaluate(()=>{window.__rootsOwnerAudit=[];});
  const cost=await measureFamily(process.pid,async()=>{
   const begin=performance.now();
   const result=await page.evaluate(async({input,explicitControls})=>{
    const {Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts');
    const scene=parseLegacyScene(JSON.stringify(input)).scene,g=new Generator(),hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''),sleep=()=>new Promise(r=>setTimeout(r,2));
    let context={time:0,width:192,height:144,quality:'preview',rootsPixelDensity:1,rootsViewport:{logicalWidth:192,logicalHeight:144,referenceLogicalHeight:144,target:'primary'},rootsLive:{sessionId:'cost-'+explicitControls,maximumWorkers:1,clock:{paused:true,timestampMs:1000},...(explicitControls?{controls:{acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}}:{})}};
    const start=performance.now();let output,initialUpdates=0;
    try{
     for(let i=0;i<500;i++){output=await g.generate(scene,context);initialUpdates++;if(explicitControls)context.rootsLive.controls={acknowledgedRevision:output.rootsLive.controls.revision,commands:[]};if(output.rootsLive.autoRecording.complete&&output.rootsLive.stream.canFinishAfterDisplay)break;await sleep();}
     if(!output?.rootsLive.autoRecording.complete||output.roots.attemptedSamples!==256||output.roots.rootPoints!==512)throw Error('Cost fixture did not complete');
     const coldInitializationMs=performance.now()-start,rgbaSequence=[await hash(output.pixels)],redrawStart=performance.now();
     for(let i=0;i<32;i++){output=await g.generate(scene,context);if(output.roots.attemptedSamples!==256||output.roots.rootPoints!==512||output.rootsLive.sceneTime!==0)throw Error('Equivalent completed redraw state drifted');rgbaSequence.push(await hash(output.pixels));}
     const pausedRedrawMs=performance.now()-redrawStart,audit=window.__rootsOwnerAudit;
     for(let i=0;i<1000&&!audit.some(a=>a.kind==='batch'&&a.terminal);i++)await sleep();
     const batches=audit.filter(a=>a.kind==='batch').sort((a,b)=>a.batchSequence-b.batchSequence).map(({sha256,bytes,progress,terminal})=>({sha256,bytes,progress,terminal}));
     if(batches.reduce((n,b)=>n+b.bytes,0)!==512*16||!batches.at(-1)?.terminal)throw Error('Equivalent CPU batch evidence incomplete');
     return{explicitControls,coldInitializationMs,initialUpdates,pausedRedrawMs,pausedRedrawFrames:32,rgbaSequence,batches,final:{roots:output.roots,controls:output.rootsLive.controls}};
    }finally{g.dispose();}
   },{input:fixture('GPU_DENSITY'),explicitControls});
   await page.waitForTimeout(250);assert.equal(page.workers().length,0,'Cost case must release all Workers');
   return{...result,elapsedMs:performance.now()-begin,costScope:'One fresh Generator/Worker initialization plus 32 completed paused redraws; same already-warm Chrome/Vite, observer overhead included; single-run measurement'};
  });
  report.costComparison.push(cost);
 }
 assert.deepEqual(report.costComparison[0].rgbaSequence,report.costComparison[1].rgbaSequence,'Legacy and controls completed RGBA sequences must match');
 assert.deepEqual(report.costComparison[0].batches,report.costComparison[1].batches,'Legacy and controls actual CPU batches must match');
 report.costEquivalence={rgbaSequence:true,consumedCpuBatches:true,tokenUsage:'unmeasured',statisticalClaim:'none: one sequential run per variant'};
 report.artifacts=artifacts;assert.deepEqual(report.pageErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page){report.lastObserver=await page.evaluate(()=>window.__rootsOwnerAudit?.slice(-20)).catch(()=>undefined);report.failedScenario=await page.evaluate(()=>window.__rootsOwnerScenario).catch(()=>undefined);}}
finally{
 report.cleanup=[];for(const [resource,close]of [['browser',()=>browser?.close()],['vite',()=>server?.close()]]){try{await close();report.cleanup.push({resource,status:'fulfilled'});}catch(error){report.cleanup.push({resource,status:'rejected',error:String(error)});report.status='failed';process.exitCode=1;}}
 report.elapsedMs=performance.now()-started;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(out+'/README.md',`# Roots 命令所有者无窗口验证\n\n状态：${report.status}；完成 ${report.cases.length}/2 组、${report.cases.reduce((n,c)=>n+c.checks.length,0)} 项主矩阵检查、${report.transportFaults.length}/5 个负向协议响应检查。\n\n实际 Queue 录制延期命令：${report.queueRecording?.status??'未完成'}；拒绝后旧画面能力及 Worker 丢失：${report.retainedRejections?.status??'未完成'}。\n\n本次经过实际 Generator、generation Worker、CPU 求根 Worker 与 WebGL；没有 App UI、原版或 MP4 运行声明。\n\n${report.error?'失败：\n\n```\n'+report.error+'\n```\n\n':''}${report.limits.map(x=>'- '+x).join('\n')}\n\n总耗时 ${(report.elapsedMs/1000).toFixed(3)} 秒；源码${report.sourceStable?'稳定':'变化'}。成本、逐帧 prepared LUT、真实 RGBA 摘要、CPU 批次摘要与清理见 report.json。\n\n${report.costComparison.map(c=>`- ${c.explicitControls?'显式 controls':'legacy 无 controls'}：fresh Worker 初始化 ${c.coldInitializationMs.toFixed(3)} ms；32 次暂停重绘 ${c.pausedRedrawMs.toFixed(3)} ms；采样进程族 CPU ${c.processFamily.observedCpuMs} ms，峰值 RSS ${c.processFamily.sampledPeakRssKiB} KiB。`).join('\n')}\n\n等效 RGBA 序列/CPU 批次摘要：${report.costEquivalence?'均相等':'尚未确认'}；token 成本未测。\n`);
 console.log(JSON.stringify({status:report.status,directory:out,cases:report.cases.length,checks:report.cases.reduce((n,c)=>n+c.checks.length,0),transportFaults:report.transportFaults.length,elapsedMs:report.elapsedMs,sourceStable:report.sourceStable,error:report.error,cleanup:report.cleanup}));
}
