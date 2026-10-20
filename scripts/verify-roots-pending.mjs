import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

// Actual local Generator/Worker/GPU/App. Passive observation only: no output
// replacement, mocked pixels, solver hooks or native application execution.
// Parent runs this script only after production freezes.
const scriptPath='scripts/verify-roots-pending.mjs';
const directory=`.cache/roots-pending-run-${Date.now()}`;
const artifact=name=>`${directory}/${name}`,sha=v=>createHash('sha256').update(v).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{type:'bigint',decimal:x.toString()}:x,2)+'\n';
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function files(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+entry.name;if(entry.isDirectory())out.push(...await files(p));else if(entry.isFile())out.push(p);else throw Error('Unsupported source entry '+p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),scriptPath].sort().map(async p=>[p,sha(await readFile(p))])));
await mkdir(directory,{recursive:true});await writeFile(artifact('verifier.mjs'),await readFile(scriptPath),{flag:'wx'});
const started=performance.now(),report={at:new Date().toISOString(),status:'running',scope:'Actual local pending-profile Generator/Worker, independent finite-root count vectors, warm/cold/backseek, raw FIFO retention through display transforms, render-only capture consumption, cloud behavior, real count-only recording planning, actual App import/upgrade/edit/save/reopen and byte-exact downloaded PNG. No original application/JVM or native concurrent arrival schedule is executed.',sourceBefore:await hashes(),artifacts:{directory},checks:{},stages:[]};
const catalogs=Object.assign({},...await Promise.all(['metadata','components','application'].map(async n=>JSON.parse(await readFile(`src/locales/${n}.en.json`,'utf8')))));
const label=s=>{check(Object.hasOwn(catalogs,s),'Missing English selector key: '+s);return catalogs[s];};let server,browser,context,page,failure;
async function stage(name,run){const t=performance.now();report.stages.push({name,status:'running',atMs:t-started});await writeFile(artifact('progress.json'),json(report));let timer;try{const value=await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Stage timeout: ${name}`)),60000);})]);Object.assign(report.stages.at(-1),{status:'passed',elapsedMs:performance.now()-t});await writeFile(artifact('progress.json'),json(report));return value;}catch(error){Object.assign(report.stages.at(-1),{status:'failed',elapsedMs:performance.now()-t,error:String(error)});throw error;}finally{clearTimeout(timer);}}
// Decode the actual PNG bytes outside canvas. Canvas drawImage would itself
// premultiply/unpremultiply alpha and could conceal a lossy PNG producer.
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');let width,height,channels,compressed=[];
 for(let at=8;at<bytes.length;){const n=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);check(at+12+n<=bytes.length,'truncated PNG chunk');if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data[8]===8&&[2,6].includes(data[9])&&data[12]===0,'unsupported PNG encoding');channels=data[9]===6?4:3;}if(name==='IDAT')compressed.push(data);at+=12+n;if(name==='IEND')break;}
 check(width&&height&&channels,'missing PNG header');const raw=inflateSync(Buffer.concat(compressed)),stride=width*channels;check(raw.length===(stride+1)*height,'PNG row length');const rows=Buffer.alloc(stride*height),rgba=Buffer.alloc(width*height*4);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?rows[y*stride+x-channels]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=channels?rows[(y-1)*stride+x-channels]:0;rows[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 for(let p=0;p<width*height;p++){rgba[p*4]=rows[p*channels];rgba[p*4+1]=rows[p*channels+1];rgba[p*4+2]=rows[p*channels+2];rgba[p*4+3]=channels===4?rows[p*channels+3]:255;}return{width,height,rgba};
}
function compare(a,b){check(a.length===b.length,'different RGBA byte counts');let changedChannels=0,maxDifference=0,alphaChanges=0,nonOpaquePixels=0;const colors=new Set();for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){changedChannels++;if(i%4===3)alphaChanges++;}maxDifference=Math.max(maxDifference,d);if(i%4===0){colors.add(a[i]*65536+a[i+1]*256+a[i+2]);if(a[i+3]!==255)nonOpaquePixels++;}}return{channels:a.length,changedChannels,maxDifference,alphaChanges,nonOpaquePixels,distinctRgb:colors.size};}
function installObservation(){
 const NativeWorker=window.Worker;
 const audit=window.__captureAudit={issued:0,completed:[],errors:[],created:0,terminated:0,owners:new WeakMap(),pixels:new Map(),requests:[],downloads:0};
 const metadata=o=>{const{pixels,...rest}=o;return rest;};
 window.Worker=class extends NativeWorker{
  workerId;ended=false;sent=new Map();
  constructor(...args){super(...args);this.workerId=++audit.created;this.addEventListener('message',({data})=>{
   if(!['generate','roots-paused-capture'].includes(data.operation)||data.progress)return;const sent=this.sent.get(data.id);if(!sent||sent.request.sessionId!==data.sessionId)return;
   if(data.error){audit.errors.push({...sent,error:data.error,retainedSourceId:data.retainedSourceId});this.sent.delete(data.id);return;}
   const output=data.operation==='generate'?data.output:data.result?.preview;if(!output)return;
   const row={...sent,output:metadata(output),...(data.result?{capture:metadata(data.result.capture)}:{})};
   const remember=(value,role)=>{audit.owners.set(value,{...row,role});if(value.pixels)audit.pixels.set(row.sequence+':'+role,value.pixels.slice());};
   remember(output,'preview');if(data.result)remember(data.result.capture,'capture');audit.completed.push(row);this.sent.delete(data.id);while(audit.pixels.size>48)audit.pixels.delete(audit.pixels.keys().next().value);
  });}
  postMessage(message,...args){if(['generate','roots-paused-capture'].includes(message.operation)){const sent={request:structuredClone(message),sequence:++audit.issued,workerId:this.workerId};this.sent.set(message.id,sent);audit.requests.push(sent);}return super.postMessage(message,...args);}
  terminate(){if(!this.ended){this.ended=true;audit.terminated++;}return super.terminate();}
 };
}
async function installRenderer(){await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),set=ArtRenderer.prototype.setOutput;window.__rendered=[];ArtRenderer.prototype.setOutput=function(o,s,...args){const result=set.call(this,o,s,...args),owner=window.__captureAudit.owners.get(o);window.__rendered.push({sceneId:s.id,sequence:owner?.sequence,workerId:owner?.workerId,role:owner?.role});return result;};});}
const mark=()=>page.evaluate(()=>window.__captureAudit.issued);
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const fresh=async(before,id,time)=>{await page.waitForFunction(({before,id,time})=>window.__captureAudit.completed.some(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id&&(time===undefined||Math.abs(r.request.context.time-time)<1e-9)),{before,id,time});await ready();const row=await page.evaluate(({before,id,time})=>window.__captureAudit.completed.findLast(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id&&(time===undefined||Math.abs(r.request.context.time-time)<1e-9)),{before,id,time});await page.waitForFunction(r=>window.__rendered.some(x=>x.sequence===r.sequence&&x.workerId===r.workerId),row);return row;};
const observeCapture=async(before)=>{await page.waitForFunction(before=>window.__captureAudit.completed.some(r=>r.sequence>before&&r.request.operation==='roots-paused-capture'),before);return page.evaluate(before=>window.__captureAudit.completed.findLast(r=>r.sequence>before&&r.request.operation==='roots-paused-capture'),before);};
async function openExport(width,height,scale=1){await page.getByRole('button',{name:'Export artwork',exact:true}).click();check(await page.getByRole('combobox',{name:label('复根图像来源'),exact:true}).inputValue()==='current','native PNG did not select current paused scene');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(width));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(height));await page.getByRole('combobox',{name:label('PNG 放大倍率'),exact:true}).selectOption(String(scale));}
async function downloadCapture(name,expectedWorker,width,height,scale=1){
 const before=await mark(),workers=await page.evaluate(()=>window.__captureAudit.created);const downloading=page.waitForEvent('download',{timeout:20000});await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await downloading;await download.saveAs(artifact(name+'.png'));const row=await observeCapture(before);
 check(row.workerId===expectedWorker&&await page.evaluate(()=>window.__captureAudit.created)===workers,'current PNG created a replacement Worker');check(row.capture.width===width*scale&&row.capture.height===height*scale,'capture size differs from base dimensions × selected upscale');check(JSON.stringify(row.capture.rootsPresentation.physicalSize)===JSON.stringify([width,height]),'upscale changed the geometric base target');check(row.capture.rootsPausedImage?.enhancement==='mathart-1.7.8-scale1'&&row.capture.rootsPausedImage.scale===scale&&JSON.stringify(row.capture.rootsPausedImage.baseSize)===JSON.stringify([width,height])&&row.capture.rootsPausedImage.resampling===(scale===1?'none':'openjdk21-software-bicubic')&&row.capture.rootsPausedImage.originalRuntimeCompared===false,'missing explicit enhanced/upscaled image facts');
 const bytes=await readFile(artifact(name+'.png')),decoded=decodePng(bytes),expected=Buffer.from(await page.evaluate(sequence=>Array.from(window.__captureAudit.pixels.get(sequence+':capture')),row.sequence));
 const comparison=compare(decoded.rgba,expected);check(decoded.width===width*scale&&decoded.height===height*scale&&comparison.changedChannels===0,'PNG changed enhanced capture RGBA or alpha');
 await page.waitForFunction(row=>window.__rendered.some(x=>x.sequence===row.sequence&&x.workerId===row.workerId&&x.role==='preview'),row);
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();return{row,comparison,sha256:sha(bytes),bytes:bytes.length};
}

// These vectors are hand-derived from whole-sample publication, FIFO draining
// and one density splat per display. They do not call any production queue,
// planner, roots sampler or clock to produce their expectations.
const vectors={
 linear:{description:'Eight one-root samples; B=3, two samples/display, S=1, one worker; P is well above the tiny backlog.',
  attempted:[2,4,6,8,8,8,8,8,8],builder:[2,1,0,0,0,0,0,0,0],
  produced:[2,4,6,8,8,8,8,8,8],published:[0,3,6,8,8,8,8,8,8],
  consumed:[0,1,2,3,4,5,6,7,8],pending:[0,2,4,5,4,3,2,1,0],finished:[0,0,0,1,1,1,1,1,1]},
 quadratic:{description:'Eight two-root samples; B=5 publishes batches of six, not batches of five.',
  attempted:[2,4,6,8],builder:[4,2,0,0],produced:[4,8,12,16],published:[0,6,12,16],consumed:[0,1,2,3],pending:[0,5,10,13],finished:[0,0,0,1]},
 adaptive:{description:'Same linear fixture with explicit referenceHeapBytes=0: P=max(2*3*1,4*1)=6. Frame2 backlog5 receives multiplier4.',
  attempted:[2,4,6,8,8,8],builder:[2,1,0,0,0,0],produced:[2,4,6,8,8,8],published:[0,3,6,8,8,8],consumed:[0,1,5,6,7,8],pending:[0,2,1,2,1,0],finished:[0,0,0,1,1,1]},
 blockedTerminal:{description:'Six linear samples, perFrame6, B1/S1/heap0: Q2/P4. Producer blocks after its third then fifth sample; final terminal cannot publish until the next frame.',
  attempted:[3,5,6,6],builder:[1,1,0,0],blocked:[1,1,0,0],published:[2,4,6,6],consumed:[1,4,5,6],pending:[1,0,1,0],finishWaiting:[0,0,1,0],finished:[0,0,0,1]},
};
report.reference={vectors,originalRuntimeExecuted:false,sourceAudit:'.cache/roots-pending-queue-next.json',sourceAuditSha256:sha(await readFile('.cache/roots-pending-queue-next.json'))};

try{
 await stage('launch',async()=>{
  server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});
  context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000);await context.addInitScript(installObservation);page=await context.newPage();
  report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Pending Roots verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');
 });
 report.checks.worker=await stage('real-worker-pending',()=>page.evaluate(async vectors=>{
  const{Generator}=await import('/src/engine/client.ts'),{createScene,parseScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const{createRootsNativeMath}=await import('/src/engine/rootsMathConfig.ts'),{defaultRootsPresentationConfiguration}=await import('/src/engine/rootsPresentationConfig.ts');
  const{RootsNativeDensityDisplay}=await import('/src/engine/rootsNativeDisplay.ts'),{prepareRootsProjection}=await import('/src/engine/rootsProjection.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts'),{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const result=window.__direct={rows:[],checks:[],plans:[],cleanup:[]},owners=[];
  const make=()=>{const g=new Generator();owners.push(g);return g;};
  const check=(ok,message)=>{if(!ok)throw Error(message);result.checks.push(message);};
  const exact=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const meta=o=>{const{pixels,...rest}=o;return rest;};
  const counts=o=>o.rootsPresentation.pending;
  const c={time:0,width:97,height:73,quality:'export',rootsSessionId:'pending-direct',rootsViewport:{logicalWidth:97,logicalHeight:73,referenceLogicalHeight:73,target:'primary'}};
  function scene(mode='density'){
   const s=createScene(definition('roots'));s.id='pending-'+mode;s.name='Pending '+mode;s.rootsMath=createRootsNativeMath(1);
   s.rootsMath.polynomial={variable:'z',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
   s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.05,.08]}];
   s.rootsMath.sampling={sampleCount:8,batchSize:3,workerCount:1,seed:'91',filter:''};
   s.rootsPresentation=defaultRootsPresentationConfiguration();Object.assign(s.rootsPresentation,{mode,dotSize:.08,pending:{model:'roots-pending-ordinal-v1',maxSplatPointsPerFrame:1,referenceHeapBytes:4294967296}});s.rootsPresentation.camera.phi=0;
   s.rootsSourcePalette={colors:['#FF7020','#20EFFF']};
   Object.assign(s.settings,{rootsMode:'progressive',rootSamplesPerFrame:2,rootSamplingFps:4,rootStartTime:0,rootColor:'t2_real',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceBrightness:.4,rootSourceGamma:1,background:'#000000',showAxes:false,showGrid:false});
   s.timeline={schedule:'roots-scene-sequence-v1',duration:3,fps:4,loop:false,playbackMode:'once',tracks:[]};
   return parseScene(JSON.stringify(s));
  }
  async function generate(g,s,frame,name){
   const start=performance.now(),o=await g.generate(s,{...c,time:frame/4});
   check(o.type==='raster'&&o.backend==='webgl2'&&o.rootsPresentation?.pending?.policy==='roots-pending-ordinal-v1',name+' delivers actual pending GPU raster');
   const clock=o.rootsPresentation.cameraTimeline;check(clock?.frame===frame&&clock.completedFrames===frame+1&&clock.readbacks===1,name+' correct actual frame and readback');
   result.rows.push({name,frame,elapsedMs:performance.now()-start,sha256:await digest(o.pixels),output:meta(o)});return o;
  }
  function assertVector(o,v,i,name){
   const p=counts(o),keys={attempted:'attemptedSamples',builder:'builderPoints',produced:'producedPoints',published:'publishedPoints',consumed:'consumedPoints',pending:'pendingPoints',finished:'finishedWorkers'};
   for(const [a,b]of Object.entries(keys))check(p[b]===v[a][i],`${name} frame${i} ${b}=${v[a][i]} (actual ${p[b]})`);
   check(p.queuedBatches===0&&p.queuedPoints===0&&p.blockedPoints===0,name+' drained whole published queue without discarding builder');
   check(o.roots.attemptedSamples===v.attempted[i]&&o.rootsPresentation.totalRawPoints===v.produced[i],name+' producer counts agree with independent finite-root count');
   check(o.rootsPresentation.density.submittedFinitePointCount===v.consumed[i],name+' density only submits consumed points');
  }
  function fixedPoints(n){const points=new Float32Array(n*4);for(let i=0;i<n;i++)points.set([.05,.08,.08,.05],i*4);return points;}
  const projection=(s,target='primary')=>prepareRootsProjection(s.rootsPresentation,{width:97,height:73,viewport:{logicalWidth:97,logicalHeight:73,referenceLogicalHeight:73,target}});
  function expectedKnownPixels(s,n,target='primary',enhance=false){
   const display=new RootsNativeDensityDisplay();try{const color=prepareRootsDensityColor(s);display.advanceBatches(projection(s,target),[fixedPoints(n)],color);const raw=display.present(color).pixels;return enhance?enhanceSourcePausedImage(raw,97,73):raw;}finally{display.dispose();}
  }
  try{
   const s=scene(),g=make(),warm=[];
   for(let frame=0;frame<=8;frame++){const o=await generate(g,s,frame,'linear warm');assertVector(o,vectors.linear,frame,'linear');check(o.rootsPresentation.autoRecording.complete===(frame===8),'empty scene recording completes only after all eight points are drawn');warm.push(o);}
   check(warm[3].roots.complete===true&&!warm[3].rootsPresentation.autoRecording.complete&&counts(warm[3]).pendingPoints===5,'math completion is not pending recording completion');
   result.linearVector=vectors.linear;
   const cold=make(),cold3=await generate(cold,s,3,'linear cold frame3');assertVector(cold3,vectors.linear,3,'cold');
   check(exact(cold3.pixels,warm[3].pixels)&&JSON.stringify(counts(cold3))===JSON.stringify(counts(warm[3])),'cold seek reproduces warm raw queue and pixels');
   check(cold3.rootsPresentation.cameraTimeline.framesAdvanced===4&&warm[3].rootsPresentation.cameraTimeline.framesAdvanced===1,'cold seek really replayed four display frames');
   const back=await generate(g,s,1,'linear backward frame1');assertVector(back,vectors.linear,1,'backseek');
   check(back.rootsPresentation.restartReason==='backward-seek'&&back.rootsPresentation.instance!==warm[8].rootsPresentation.instance&&exact(back.pixels,warm[1].pixels),'backseek rebuilds rather than reusing future pending points');

   const q=scene();q.id='pending-quadratic';q.rootsMath.polynomial.coefficients=[{exponent:'2',expression:'1'},{exponent:'0',expression:'-0.04'}];q.rootsMath.sampling.batchSize=5;const qg=make();
   for(let frame=0;frame<4;frame++)assertVector(await generate(qg,q,frame,'quadratic overshoot'),vectors.quadratic,frame,'two-root batch');
   const a=scene();a.id='pending-adaptive';a.rootsPresentation.pending.referenceHeapBytes=0;const ag=make();
   for(let frame=0;frame<6;frame++){const o=await generate(ag,a,frame,'adaptive');assertVector(o,vectors.adaptive,frame,'adaptive');check(counts(o).maximumPendingPoints===6,'explicit heap0 gives P6 without changing local allocation limits');}

   const hotScene=scene(),hg=make(),beforeHot=await generate(hg,hotScene,2,'before hot transform');
   hotScene.rootsPresentation.transform.offset[0]=12;
   const hot=await generate(hg,hotScene,2,'same-frame hot transform');
   check(hot.rootsPresentation.instance===beforeHot.rootsPresentation.instance&&hot.rootsPresentation.restartReason===null&&hot.rootsPresentation.newSamples===0&&hot.rootsPresentation.newRawPoints===0&&hot.roots.solverWork===beforeHot.roots.solverWork,'hot transform retains sampler, solver work and instance');
   check(counts(hot).pumpCalls===counts(beforeHot).pumpCalls&&counts(hot).producedPoints===6&&counts(hot).consumedPoints===3&&counts(hot).pendingPoints===3,'hot transform consumes one old raw point, not newly solved points');
   check(hot.rootsPresentation.density.clearInk&&hot.rootsPresentation.density.submittedFinitePointCount===1&&exact(hot.pixels,expectedKnownPixels(hotScene,1)),'hot transform clears previous ink and projects only retained remaining raw point at new offset');
   const hotCold=await generate(make(),hotScene,2,'cold transformed contrast');
   check(hotCold.rootsPresentation.density.submittedFinitePointCount===2&&!exact(hot.pixels,beforeHot.pixels),'hot remaining-only submission differs from cold count and visibly uses the new transform');
   result.hotTransform={before:meta(beforeHot),hot:meta(hot),cold:meta(hotCold),hotAndColdPixelsEqual:exact(hot.pixels,hotCold.pixels),scope:'Coincident fixed roots can normalize to equal visible intensity; the independently specified one-point raster, changed offset, raw FIFO counters and submitted N distinguish the hot operation.'};

   const cg=make(),captureScene=scene(),beforeCapture=await generate(cg,captureScene,2,'before paused capture'),workersBefore=window.__captureAudit.created;
   const pair=await cg.captureRootsPaused(beforeCapture,{width:97,height:73});
   for(const [role,o,consumed,pending]of [['capture',pair.capture,3,3],['preview',pair.preview,4,2]]){
    const p=counts(o),b=counts(beforeCapture),f=o.rootsPresentation;
    check(window.__captureAudit.created===workersBefore&&f.instance===beforeCapture.rootsPresentation.instance&&f.newSamples===0&&f.newRawPoints===0&&o.roots.solverWork===beforeCapture.roots.solverWork,'paused '+role+' reuses real Worker/math');
    check(p.attemptedSamples===6&&p.pumpCalls===b.pumpCalls&&p.producedPoints===6&&p.consumedPoints===consumed&&p.pendingPoints===pending,'paused '+role+' consumes retained FIFO only');
    check(f.pausedCapture?.arrivals==='retained-local-pending'&&f.pausedCapture.clockAdvanced===false&&f.cameraTimeline.framesAdvanced===0,'paused '+role+' reports no clock advance');
    for(const key of ['frame','completedFrames','sceneTime','camera','rates','gradient','queueComplete'])check(JSON.stringify(f.cameraTimeline[key])===JSON.stringify(beforeCapture.rootsPresentation.cameraTimeline[key]),'paused '+role+' preserves clock '+key);
   }
   check(counts(pair.preview).drainCalls-counts(beforeCapture).drainCalls===3&&counts(pair.preview).splatCalls-counts(beforeCapture).splatCalls===2,'paused capture plus preview performs three drains and two splats');
   check(exact(pair.capture.pixels,expectedKnownPixels(captureScene,3,'offscreen',true))&&exact(pair.preview.pixels,expectedKnownPixels(captureScene,4)),'paused capture and primary refresh match independently specified cumulative fixed raw roots');
   result.pausedCapture={before:meta(beforeCapture),capture:meta(pair.capture),preview:meta(pair.preview),captureSha256:await digest(pair.capture.pixels),previewSha256:await digest(pair.preview.pixels)};

   const cloud=scene('point-cloud'),cloudWide=structuredClone(cloud);cloudWide.id='pending-cloud-large-S';cloudWide.rootsPresentation.pending.maxSplatPointsPerFrame=999;
   const cloudA=make(),cloudB=make(),cloudFrames=[];
   for(let frame=0;frame<4;frame++){
    const x=await generate(cloudA,cloud,frame,'cloud S1'),y=await generate(cloudB,cloudWide,frame,'cloud S999'),expected=[0,3,6,8][frame];
    check(x.rootsPresentation.pointCloud.retainedPoints===expected&&y.rootsPresentation.pointCloud.retainedPoints===expected&&counts(x).pendingPoints===0&&counts(y).pendingPoints===0&&counts(x).consumedPoints===0&&counts(y).consumedPoints===0,'cloud receives whole batches with no density pending splat');
    check(exact(x.pixels,y.pixels),'cloud image independent of density S at frame '+frame);cloudFrames.push({frame,expectedRing:expected,sha256:await digest(x.pixels)});
   }result.cloudFrames=cloudFrames;

   const blocked=scene();blocked.id='pending-terminal-blocked';blocked.rootsMath.sampling.sampleCount=6;blocked.rootsMath.sampling.batchSize=1;blocked.settings.rootSamplesPerFrame=6;blocked.rootsPresentation.pending.referenceHeapBytes=0;
   const bg=make(),v=vectors.blockedTerminal;
   for(let frame=0;frame<4;frame++){
    const o=await generate(bg,blocked,frame,'bounded-queue terminal'),p=counts(o);
    for(const [key,field]of Object.entries({attempted:'attemptedSamples',builder:'builderPoints',blocked:'blockedPoints',published:'publishedPoints',consumed:'consumedPoints',pending:'pendingPoints',finishWaiting:'finishWaitingWorkers',finished:'finishedWorkers'}))check(p[field]===v[key][frame],`bounded queue frame${frame} ${field}=${v[key][frame]} (actual ${p[field]})`);
    check(p.queueCapacity===2&&p.maximumPendingPoints===4&&o.rootsPresentation.autoRecording.complete===(frame===3),'bounded queue retains terminal until an actual later pump/drain');
   }

   // Planning is actual Worker RPC using count-only storage and real solver;
   // expected end frames are hand-derived above, never taken from the planner.
   for(const [name,source,updates,reason]of [['linear',s,9,'pending-drained'],['adaptive',a,6,'pending-drained'],['cloud',cloud,4,'pending-drained'],['blocked-terminal',blocked,4,'pending-drained']]){
    const pg=make(),plan=await pg.planRootsFreshRecording(source,4,7);check(plan.updates===updates&&plan.encodedFrames===updates-1&&plan.encoderFps===7&&plan.simulationFps===4&&plan.completionReason===reason,'actual planner '+name+' matches independent terminal frame');
    check(plan.pendingPlanning?.storage==='count-only'&&plan.pendingPlanning.mathWorkUnits>0&&plan.pendingPlanning.finalQueue.storage==='count-only','actual planner executes real math with count-only queue');
    const recording=make();let last;
    for(let frame=0;frame<updates;frame++){last=await generate(recording,source,frame,'recording '+name);check(last.rootsPresentation.autoRecording.complete===(frame===updates-1),'planner '+name+' agrees with actual display completion at every frame');}
    result.plans.push({name,plan,actualLast:meta(last)});
   }
   const short=scene();short.id='pending-short-animation';short.timeline.tracks=[{id:'short',type:'wait',target:'timeline.wait',label:'Native wait',from:0,to:0,easing:'linear',pingPong:false,start:0,duration:.25,enabled:true}];
   const shortPlan=await make().planRootsFreshRecording(short,4,7),shortFrame=await generate(make(),short,0,'animation-priority completion');
   check(shortPlan.updates===1&&shortPlan.encodedFrames===0&&shortPlan.completionReason==='animation-queue'&&shortFrame.rootsPresentation.autoRecording.complete,'animation completion takes priority over unfinished samples/pending');
   check(counts(shortFrame).builderPoints===2&&counts(shortFrame).finishedWorkers===0&&shortFrame.roots.attemptedSamples===2,'animation priority did not silently finish outstanding sampling');result.plans.push({name:'animation-priority',plan:shortPlan,actualLast:meta(shortFrame)});
   result.savedFixture=scene();return result;
  }finally{for(const g of owners)g.dispose();result.cleanup.push({created:window.__captureAudit.created,terminated:window.__captureAudit.terminated});check(window.__captureAudit.created===window.__captureAudit.terminated,'all direct Workers terminated');}
 },vectors));

 await stage('app-initialize',async()=>{
  await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('roots'));s.id='pending-start';s.settings.rootsMode='single';s.settings.sampleCount=1;s.equations.polynomial='z^2-1';saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
  await page.route('**/api/health',r=>r.fulfill({status:503,contentType:'text/plain',body:'Actual local PNG Blob export'}));await page.goto(server.resolvedUrls.local[0]);await ready();await installRenderer();
 });
 report.checks.app=await stage('actual-app-import-upgrade-save-png',async()=>{
  const result={},native={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Roots pending native import',polynomial:{variable:'z',coefficients:{1:'1',0:'-t2'}},root_parameters:{t2:{domain:'FIXED',re:.05,im:.08}},sampling:{sample_count:8,batch_size:3,seed:'91'},palette:['#FF7020','#20EFFF'],camera:{phi:0,theta:0,gamma:0},settings:{render_mode:'GPU_DENSITY',worker_count:1,max_splat_points_per_frame:1,dot_size:.08,color_metric:'re(t2)',brightness:.4,gamma:1,background_color:'#000000'},timeline:[]};
  const nativeText=JSON.stringify(native,null,2);await writeFile(artifact('native.json'),nativeText,{flag:'wx'});
  let before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'pending-native.json',mimeType:'application/json',buffer:Buffer.from(nativeText)});
  await page.waitForFunction(before=>window.__captureAudit.completed.some(x=>x.sequence>before&&x.request.operation==='generate'&&x.request.scene.name==='Roots pending native import'),before);
  let imported=await page.evaluate(before=>window.__captureAudit.completed.findLast(x=>x.sequence>before&&x.request.operation==='generate'&&x.request.scene.name==='Roots pending native import'),before),id=imported.request.scene.id;
  imported=await fresh(before,id,0);await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
  const config=imported.request.scene.rootsPresentation.pending;
  check(config.model==='roots-pending-ordinal-v1'&&config.maxSplatPointsPerFrame===1&&config.referenceHeapBytes===4294967296,'native import did not explicitly select reference pending profile');
  check(imported.request.scene.rootsMath.sampling.batchSize===3&&JSON.stringify(imported.request.scene.provenance.original)===JSON.stringify(native),'native batch source or provenance changed');
  check(imported.request.scene.provenance.sourceNumberTokens.some(x=>JSON.stringify(x.path)===JSON.stringify(['sampling','batch_size'])&&x.token==='3')&&imported.request.scene.provenance.sourceNumberTokens.some(x=>JSON.stringify(x.path)===JSON.stringify(['settings','max_splat_points_per_frame'])&&x.token==='1'),'consumed batch/S lexical identity not retained');
  check(imported.output.rootsPresentation.pending?.maxSplatPointsPerFrame===1,'imported profile did not reach actual Worker');result.imported=imported;

  // Canonical saved local clock is explicitly authored here, not invented as
  // a native JSON field. This saved-document fixture models pre-upgrade omission.
  const legacy=structuredClone(report.checks.worker.savedFixture);legacy.id='pending-upgrade-saved';legacy.name='Saved immediate Roots profile';delete legacy.rootsPresentation.pending;
  const legacyText=json(legacy);await writeFile(artifact('saved-omission.mathart.json'),legacyText,{flag:'wx'});
  before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'saved-omission.mathart.json',mimeType:'application/json',buffer:Buffer.from(legacyText)});let row=await fresh(before,legacy.id,0);id=legacy.id;
  check(!Object.hasOwn(row.request.scene.rootsPresentation,'pending')&&!row.output.rootsPresentation.pending&&row.output.rootsPresentation.density.submittedFinitePointCount===2,'saved omission was silently migrated');result.legacyOmission=row;
  await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();before=await mark();await page.getByRole('button',{name:label('启用批次队列并重新采样'),exact:true}).click();let upgraded=await fresh(before,id,0);
  check(upgraded.workerId===row.workerId&&upgraded.output.rootsPresentation.instance!==row.output.rootsPresentation.instance&&upgraded.output.rootsPresentation.restartReason==='pending-policy','explicit queue upgrade did not rebuild presentation inside the same Worker');
  check(upgraded.request.scene.rootsPresentation.pending.maxSplatPointsPerFrame===20000&&upgraded.output.rootsPresentation.pending.builderPoints===2&&upgraded.output.rootsPresentation.density.submittedFinitePointCount===0,'explicit upgrade did not restart whole-batch sampling');result.upgraded=upgraded;
  before=await mark();await page.getByRole('spinbutton',{name:label('每帧基础绘制点数'),exact:true}).fill('1');row=await fresh(before,id,0);
  check(row.workerId===upgraded.workerId&&row.output.rootsPresentation.instance!==upgraded.output.rootsPresentation.instance&&row.output.rootsPresentation.restartReason==='pending-policy'&&row.output.rootsPresentation.pending.maxSplatPointsPerFrame===1,'budget edit did not rebuild pending policy');result.budgetEdited=row;
  before=await mark();const slider=page.getByRole('slider',{name:'Time position',exact:true});await slider.focus();await slider.press('Home');await slider.press('ArrowRight');await slider.press('ArrowRight');const time=Number(await slider.inputValue());row=await fresh(before,id,time);
  check(row.output.rootsPresentation.cameraTimeline.frame===2&&row.output.rootsPresentation.pending.pendingPoints===4&&row.output.rootsPresentation.pending.consumedPoints===2,'App real slider did not consume the expected two displays');result.selected={time,row,keyboard:['Home','ArrowRight','ArrowRight']};

  // Save may present the same density frame once more and splat one existing
  // pending point. It must not reset, resample or pretend that Save is inert.
  const beforeSave=row;before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,id,time);
  check(row.workerId===beforeSave.workerId&&row.output.rootsPresentation.instance===beforeSave.output.rootsPresentation.instance&&row.output.rootsPresentation.newSamples===0&&row.output.rootsPresentation.pending.pumpCalls===beforeSave.output.rootsPresentation.pending.pumpCalls,'Save reset or sampled the retained pending instance');result.saved=row;
  const downloading=page.waitForEvent('download',{timeout:20000});await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();await(await downloading).saveAs(artifact('saved-pending.mathart.json'));
  const savedText=await readFile(artifact('saved-pending.mathart.json'),'utf8'),saved=JSON.parse(savedText),parsed=await page.evaluate(async text=>{const{parseScene}=await import('/src/engine/document.ts');return parseScene(text);},savedText);
  check(JSON.stringify(parsed.rootsPresentation.pending)===JSON.stringify(row.request.scene.rootsPresentation.pending)&&parsed.rootsMath.sampling.batchSize===3,'pending configuration or sole batch-size owner failed actual download roundtrip');
  check(!Object.hasOwn(saved,'evaluatedRootsCamera')&&!Object.hasOwn(saved,'rootsSessionId')&&!Object.hasOwn(saved.rootsPresentation,'instance')&&!Object.hasOwn(saved.rootsPresentation.pending,'pendingPoints'),'saved document leaked runtime camera/queue/session facts');result.downloaded={scene:parsed,sha256:sha(savedText)};
  const previous=row;before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'reopen-pending.mathart.json',mimeType:'application/json',buffer:Buffer.from(savedText)});row=await fresh(before,id,0);
  check(row.workerId!==previous.workerId&&row.request.context.rootsSessionId!==previous.request.context.rootsSessionId&&row.output.rootsPresentation.pending.builderPoints===2&&row.output.rootsPresentation.pending.consumedPoints===0,'reopen did not start a new saved pending instance');result.reopened=row;
  before=await mark();await slider.focus();await slider.press('Home');await slider.press('ArrowRight');await slider.press('ArrowRight');const selected=Number(await slider.inputValue());row=await fresh(before,id,selected);
  check(row.output.rootsPresentation.cameraTimeline.frame===2&&row.output.rootsPresentation.pending.pendingPoints===4,'reopened queue does not replay frame2');
  await openExport(257,193);result.png=await downloadCapture('pending-paused-257x193',row.workerId,257,193);
  const capture=result.png.row.capture,refresh=result.png.row.output,b=row.output.rootsPresentation.pending;
  check(capture.rootsPresentation.pending.pumpCalls===b.pumpCalls&&refresh.rootsPresentation.pending.pumpCalls===b.pumpCalls&&capture.rootsPresentation.pending.consumedPoints===b.consumedPoints+1&&refresh.rootsPresentation.pending.consumedPoints===b.consumedPoints+2,'App PNG did not consume exactly two retained splats without pumping');
  check(capture.rootsPresentation.density.clearInk&&refresh.rootsPresentation.density.clearInk&&capture.rootsPresentation.density.submittedFinitePointCount===1&&refresh.rootsPresentation.density.submittedFinitePointCount===1,'offscreen/primary resize did not clear prior ink while retaining pending FIFO');
  check(result.png.comparison.distinctRgb>1,'pending capture PNG is uniform despite known remaining visible point');
  await page.screenshot({path:artifact('pending-ui.png')});

  // Also roundtrip the actually imported native document, independently from
  // the manually authored saved-omission upgrade fixture above.
  before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'native-return.json',mimeType:'application/json',buffer:Buffer.from(nativeText)});
  await page.waitForFunction(before=>window.__captureAudit.completed.some(x=>x.sequence>before&&x.request.operation==='generate'&&x.request.scene.name==='Roots pending native import'),before);
  let nativeRow=await page.evaluate(before=>window.__captureAudit.completed.findLast(x=>x.sequence>before&&x.request.operation==='generate'&&x.request.scene.name==='Roots pending native import'),before);nativeRow=await fresh(before,nativeRow.request.scene.id,0);
  before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();nativeRow=await fresh(before,nativeRow.request.scene.id,0);
  const nativeDownload=page.waitForEvent('download',{timeout:20000});await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();await(await nativeDownload).saveAs(artifact('native-saved.mathart.json'));
  const nativeSavedText=await readFile(artifact('native-saved.mathart.json'),'utf8'),nativeSaved=JSON.parse(nativeSavedText);
  check(JSON.stringify(nativeSaved.provenance)===JSON.stringify(nativeRow.request.scene.provenance)&&JSON.stringify(nativeSaved.rootsPresentation.pending)===JSON.stringify(config),'native source/profile lost on actual save');
  before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'native-reopened.mathart.json',mimeType:'application/json',buffer:Buffer.from(nativeSavedText)});const nativeReopened=await fresh(before,nativeSaved.id,0);
  check(nativeReopened.workerId!==nativeRow.workerId&&JSON.stringify(nativeReopened.request.scene.provenance)===JSON.stringify(nativeSaved.provenance)&&nativeReopened.output.rootsPresentation.pending.policy==='roots-pending-ordinal-v1','native reopen did not preserve profile/provenance in a fresh Worker');result.nativeSaved={sha256:sha(nativeSavedText),reopened:nativeReopened};
  return result;
 });
 report.checks.actualPlayPause=await stage('actual-play-distinct-sampling-display-fps',async()=>{
  const fixture=structuredClone(report.checks.worker.savedFixture);fixture.id='pending-play-fps';fixture.name='Pending independent sample/display FPS';fixture.rootsMath.sampling.sampleCount=100;fixture.settings.rootSamplingFps=8;fixture.timeline.fps=4;
  const text=json(fixture);await writeFile(artifact('play-8-sample-4-display.mathart.json'),text,{flag:'wx'});
  const before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'pending-play.mathart.json',mimeType:'application/json',buffer:Buffer.from(text)});const initial=await fresh(before,fixture.id,0);
  check(initial.request.scene.settings.rootSamplingFps===8&&initial.output.rootsPresentation.cameraTimeline.fps===4&&initial.output.rootsPresentation.cameraTimeline.frame===0,'actual Play fixture did not retain independent sampling and display FPS');
  const playStart=await mark();await page.getByRole('button',{name:label('播放'),exact:true}).click();
  await page.waitForFunction(({id,start})=>new Set(window.__captureAudit.completed.filter(x=>x.sequence>start&&x.request.operation==='generate'&&x.request.scene.id===id&&x.output.rootsPresentation?.cameraTimeline?.frame>0&&window.__rendered.some(y=>y.sequence===x.sequence&&y.workerId===x.workerId)).map(x=>x.output.rootsPresentation.cameraTimeline.frame)).size>=3,{id:fixture.id,start:playStart});
  const pauseStart=await mark();await page.getByRole('button',{name:label('暂停'),exact:true}).click();await page.getByRole('button',{name:label('播放'),exact:true}).waitFor({state:'visible'});await ready();
  const rows=await page.evaluate(({id,start})=>window.__captureAudit.completed.filter(x=>x.sequence>start&&x.request.operation==='generate'&&x.request.scene.id===id),{id:fixture.id,start:playStart});
  const presented=await page.evaluate(()=>window.__rendered.map(x=>({sequence:x.sequence,workerId:x.workerId}))),advancing=[],renderOnly=[];
  let previous=initial;
  for(const row of rows){
   const clock=row.output.rootsPresentation.cameraTimeline,p=row.output.rootsPresentation.pending,prev=previous.output.rootsPresentation;
   check(row.workerId===initial.workerId&&row.output.rootsPresentation.instance===initial.output.rootsPresentation.instance,'Play/Pause replaced the source instance');
   if(clock.framesAdvanced>0){
    check(clock.framesAdvanced===1&&clock.frame===prev.cameraTimeline.frame+1,'8Hz sample clock caused a skipped or repeated 4Hz display advance');
    check(p.pumpCalls===prev.pending.pumpCalls+1&&p.splatCalls===prev.pending.splatCalls+1,'new display frame did not pump and splat exactly once');
    check(Math.abs(row.request.context.time-clock.frame/4)<1e-9,'actual Play uses sampling time increments instead of source display frame boundaries');advancing.push(row);
   }else{
    check(clock.frame===prev.cameraTimeline.frame&&p.pumpCalls===prev.pending.pumpCalls&&p.splatCalls===prev.pending.splatCalls+1&&row.output.rootsPresentation.newSamples===0,'render-only refresh advanced sampling or lost its one density splat');
    check(advancing.length===0||row.sequence>pauseStart,'an extra same-frame density draw occurred during ongoing Play');renderOnly.push(row);
   }
   previous=row;
  }
  check(advancing.length>=3&&advancing.filter(row=>presented.some(x=>x.sequence===row.sequence&&x.workerId===row.workerId)).length>=3,'Play did not deliver three increasing actual presented frames');
  const selectedTimeText=await page.getByRole('slider',{name:'Time position',exact:true}).inputValue();check(Math.abs(Number(selectedTimeText)-previous.request.context.time)<1e-9,'paused result is not the currently selected UI frame');
  await page.screenshot({path:artifact('pending-play-paused.png')});
  return{fixture,initial,playStart,pauseStart,advancing,renderOnly,paused:previous,selectedTimeText,scope:'Real Play/Pause at sample FPS8 and camera/display FPS4. Only entry/Pause render-only refreshes may consume another retained density splat; every newly advanced display frame pumps/splats exactly once.'};
 });
 check(!report.pageErrors.length,'unexpected page errors');report.status='passed';
}catch(error){
 failure=error;report.status='failed';report.error={message:error.message,stack:error.stack};
 if(page&&!page.isClosed()){await page.screenshot({path:artifact('failure.png')}).catch(()=>{});report.failure=await page.evaluate(()=>{const a=window.__captureAudit;return{direct:window.__direct,audit:a?{issued:a.issued,completed:a.completed,errors:a.errors,created:a.created,terminated:a.terminated}:undefined,body:document.body?.innerText};}).catch(()=>null);}
}finally{
 const closing=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,viteClosed:server?!server.httpServer?.listening:true,errors:closing.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 report.limitations=['No original application, JVM, native concurrent scheduling or measured Runtime.maxMemory. Explicit local ordinal arrival injection occurs once per display frame.','The source-derived count vectors do not call production queue/planner code. Actual fixed-root display comparisons reuse the independently tested local projection/GPU/color owners, not an independent Processing image oracle.','The 4 GiB heap is an explicit saved reference policy. Heap0 only exercises the small adaptive threshold; neither is a local allocation budget.','Recording tests use real Generator planning and real generated display completion at every planned frame. This script does not invoke an encoder or claim video bytes.','PNG is actual same-Worker paused capture and direct PNG decode over every RGBA byte, not a cold substitute.','Stage/request wall times are recorded. Process-family CPU/RSS need the external observer; VRAM and agent tokens are unmeasured.'];
 if(!report.sourceStable||report.cleanup.errors.length){report.status='failed';failure??=Error('Source drift or cleanup failure');}
 await writeFile(artifact('report.json'),json(report),{flag:'wx'});console.log(json({report:artifact('report.json'),status:report.status,error:report.error?.message,sourceStable:report.sourceStable,cleanup:report.cleanup}));
}
if(failure)throw failure;
