import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

// Actual local Generator/Worker/GPU/App. Passive observation only: no output
// replacement, mocked pixels, solver hooks or native application execution.
// Parent runs this script only after production freezes.
const scriptPath='scripts/verify-project-resolution-ui.mjs';
const directory=`.cache/project-resolution-ui-run-${Date.now()}`;
const artifact=name=>`${directory}/${name}`,sha=v=>createHash('sha256').update(v).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{type:'bigint',decimal:x.toString()}:x,2)+'\n';
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function files(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+entry.name;if(entry.isDirectory())out.push(...await files(p));else if(entry.isFile())out.push(p);else throw Error('Unsupported source entry '+p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),scriptPath].sort().map(async p=>[p,sha(await readFile(p))])));
await mkdir(directory,{recursive:true});await writeFile(artifact('verifier.mjs'),await readFile(scriptPath),{flag:'wx'});
const started=performance.now(),report={at:new Date().toISOString(),status:'running',scope:'Actual App file import, project-dimension drafts/Apply/Undo, first measured request, playback reset/resume, hot host resize, quality budgets, persistence, same-Worker paused PNG and another-family 8192×64 still-image export. Independent F32 CSS fit reference. No original application/JVM, Compose/JOGL/DPI runtime or anchored 300ms policy execution.',sourceBefore:await hashes(),artifacts:{directory},checks:{},stages:[]};
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
 const canvasObservation=()=>{const canvas=document.querySelector('[data-testid=art-canvas]');if(!canvas)return null;const parent=canvas.parentElement,box=canvas.getBoundingClientRect(),host=parent.getBoundingClientRect(),style=getComputedStyle(parent);return{at:performance.now(),available:{width:host.width-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth)-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height:host.height-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth)-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)},host:{left:host.left,top:host.top,width:host.width,height:host.height},canvas:{left:box.left,top:box.top,width:box.width,height:box.height},buffer:{width:canvas.width,height:canvas.height},inline:Object.fromEntries(['width','height','left','top','right','bottom'].map(k=>[k,canvas.style[k]]))};};
 window.__canvasObservation=canvasObservation;
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
  postMessage(message,...args){if(['generate','roots-paused-capture'].includes(message.operation)){const sent={request:structuredClone(message),sequence:++audit.issued,workerId:this.workerId,sentAt:performance.now(),canvasObservation:canvasObservation()};this.sent.set(message.id,sent);audit.requests.push(sent);}return super.postMessage(message,...args);}
  terminate(){if(!this.ended){this.ended=true;audit.terminated++;}return super.terminate();}
 };
}
async function installRenderer(){await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),set=ArtRenderer.prototype.setOutput;window.__rendered=[];ArtRenderer.prototype.setOutput=function(o,s,...args){const result=set.call(this,o,s,...args),owner=window.__captureAudit.owners.get(o);window.__rendered.push({sceneId:s.id,sequence:owner?.sequence,workerId:owner?.workerId,role:owner?.role,at:performance.now(),canvasObservation:window.__canvasObservation()});return result;};});}
const mark=()=>page.evaluate(()=>window.__captureAudit.issued);
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const fresh=async(before,id,time)=>{await page.waitForFunction(({before,id,time})=>window.__captureAudit.completed.some(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id&&(time===undefined||Math.abs(r.request.context.time-time)<1e-9)),{before,id,time});await ready();const row=await page.evaluate(({before,id,time})=>window.__captureAudit.completed.findLast(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id&&(time===undefined||Math.abs(r.request.context.time-time)<1e-9)),{before,id,time});await page.waitForFunction(r=>window.__rendered.some(x=>x.sequence===r.sequence&&x.workerId===r.workerId),row);return row;};
const observeCapture=async(before)=>{await page.waitForFunction(before=>window.__captureAudit.completed.some(r=>r.sequence>before&&r.request.operation==='roots-paused-capture'),before);return page.evaluate(before=>window.__captureAudit.completed.findLast(r=>r.sequence>before&&r.request.operation==='roots-paused-capture'),before);};
async function openExport(width,height){await page.getByRole('button',{name:'Export artwork',exact:true}).click();check(await page.getByRole('combobox',{name:'Export resolution',exact:true}).inputValue()==='custom','project dimensions did not initialize custom export');check(Number(await page.getByRole('spinbutton',{name:'Export width',exact:true}).inputValue())===width&&Number(await page.getByRole('spinbutton',{name:'Export height',exact:true}).inputValue())===height,'export defaults differ from authored project dimensions');}
async function downloadCapture(name,expectedWorker,width,height,scale=1){
 const before=await mark(),workers=await page.evaluate(()=>window.__captureAudit.created);const downloading=page.waitForEvent('download',{timeout:20000});await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await downloading;await download.saveAs(artifact(name+'.png'));const row=await observeCapture(before);
 check(row.workerId===expectedWorker&&await page.evaluate(()=>window.__captureAudit.created)===workers,'current PNG created a replacement Worker');check(row.capture.width===width*scale&&row.capture.height===height*scale,'capture size differs from base dimensions × selected upscale');check(JSON.stringify(row.capture.rootsPresentation.physicalSize)===JSON.stringify([width,height]),'upscale changed the geometric base target');check(row.capture.rootsPausedImage?.enhancement==='mathart-1.7.8-scale1'&&row.capture.rootsPausedImage.scale===scale&&JSON.stringify(row.capture.rootsPausedImage.baseSize)===JSON.stringify([width,height])&&row.capture.rootsPausedImage.resampling===(scale===1?'none':'openjdk21-software-bicubic')&&row.capture.rootsPausedImage.originalRuntimeCompared===false,'missing explicit enhanced/upscaled image facts');
 const bytes=await readFile(artifact(name+'.png')),decoded=decodePng(bytes),expected=Buffer.from(await page.evaluate(sequence=>Array.from(window.__captureAudit.pixels.get(sequence+':capture')),row.sequence));
 const comparison=compare(decoded.rgba,expected);check(decoded.width===width*scale&&decoded.height===height*scale&&comparison.changedChannels===0,'PNG changed enhanced capture RGBA or alpha');
 await page.waitForFunction(row=>window.__rendered.some(x=>x.sequence===row.sequence&&x.workerId===row.workerId&&x.role==='preview'),row);
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();return{row,comparison,sha256:sha(bytes),bytes:bytes.length};
}

// Independent transcription of the retained F32 aspect/min operations. CSS
// centering and rounding to App logical integers are the local adapter contract.
// No projectViewportFit/previewDimensions producer is used as an oracle.
function expectedFit(width,height,resolution){
 if(!resolution)return{width,height,left:0,top:0};
 const f=Math.fround,w=f(width),h=f(height),ratio=f(f(resolution.width)/f(resolution.height));
 const fw=Math.min(w,f(h*ratio)),fh=Math.min(h,f(w/ratio));
 return{width:fw,height:fh,left:(width-fw)/2,top:(height-fh)/2};
}
function expectedRaster(width,height,quality){const budget=quality==='low'?480*360:quality==='standard'?720*540:1920*1080,k=Math.sqrt(budget/(width*height));return{width:Math.max(1,Math.min(16384,Math.floor(width*k))),height:Math.max(1,Math.min(16384,Math.floor(height*k)))};}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function assertRequestFit(row,resolution,quality='low'){
 check(same(row.request.scene.projectResolution,resolution),'request carries the wrong project pair');
 const observed=row.canvasObservation;check(observed&&observed.available.width>0&&observed.available.height>0,'missing measured request-time canvas');
 const fit=expectedFit(observed.available.width,observed.available.height,resolution),logical={width:Math.round(fit.width),height:Math.round(fit.height)},physical=expectedRaster(logical.width,logical.height,quality);
 // Chromium layout snaps CSS positions to its subpixel grid and CSSOM rounds
 // serialized floats; allow at most two 1/64 CSS pixels, never a whole pixel.
 const actual={width:observed.canvas.width,height:observed.canvas.height,left:observed.canvas.left-observed.host.left,top:observed.canvas.top-observed.host.top};
 const deltas=Object.fromEntries(Object.keys(actual).map(k=>[k,Math.abs(actual[k]-fit[k])]));
 check(Object.values(deltas).every(v=>v<=1/32),'request canvas is not independently fitted: '+json({fit,actual,deltas}));
 check(row.request.context.width===physical.width&&row.request.context.height===physical.height,'preview math dimensions ignore quality budget or fitted aspect');
 check(row.request.context.quality===(quality==='high'?'export':'preview'),'request quality does not match selected quality');
 if(row.request.scene.kind==='roots'){
  const v=row.request.context.rootsViewport,facts=row.output?.rootsPresentation;
  check(v?.logicalWidth===logical.width&&v.logicalHeight===logical.height&&v.referenceLogicalHeight===logical.height&&v.target==='primary','primary logical/reference size does not match actual fitted measurement');
  if(facts)check(same(facts.logicalSize,[logical.width,logical.height])&&same(facts.physicalSize,[physical.width,physical.height])&&facts.referenceLogicalHeight===logical.height&&facts.target==='primary','Worker output facts do not match request dimensions');
 }
 if(!resolution)check(Object.values(observed.inline).every(v=>v===''),'Follow viewport left fixed-project inline geometry behind');
 return{fit,actual,deltas,logical,physical,quality,scope:'Two 1/64 CSS-pixel layout quantization bound; exact integer logical and mathematical request sizes.'};
}
async function requestsAfter(before,id){return page.evaluate(({before,id})=>window.__captureAudit.requests.filter(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id),{before,id});}
async function lastRow(id){return page.evaluate(id=>window.__captureAudit.completed.findLast(r=>r.request.operation==='generate'&&r.request.scene.id===id),id);}
async function importText(text,name,sceneName){const before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(text)});await page.waitForFunction(({before,sceneName})=>window.__captureAudit.completed.some(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.name===sceneName),{before,sceneName});const first=await page.evaluate(({before,sceneName})=>window.__captureAudit.completed.find(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.name===sceneName),{before,sceneName});return{before,row:await fresh(before,first.request.scene.id,0)};}
const sizing=()=>page.getByRole('combobox',{name:label('尺寸模式'),exact:true});
const applyButton=()=>page.getByRole('button',{name:label('应用项目尺寸'),exact:true});
async function draftPair(width,height){await sizing().selectOption('fixed');await page.getByRole('spinbutton',{name:label('项目宽度'),exact:true}).fill(String(width));await page.getByRole('spinbutton',{name:label('项目高度'),exact:true}).fill(String(height));}
async function applyPair(row,width,height){await draftPair(width,height);const before=await mark();await applyButton().click();const next=await fresh(before,row.request.scene.id,0);const requests=await requestsAfter(before,row.request.scene.id);check(requests.length>0&&requests[0].request.context.time===0,'Apply did not start from frame zero');check(next.workerId!==row.workerId&&next.request.context.rootsSessionId!==row.request.context.rootsSessionId,'project pair Apply reused the old Roots instance token/Worker');for(const request of requests)assertRequestFit(request,{width,height});return{row:next,requests,fit:assertRequestFit(next,{width,height})};}
async function pause(){const button=page.getByRole('button',{name:label('暂停'),exact:true});if(await button.count())await button.click();await ready();}
async function waitPresentedCount(before,id,count){await page.waitForFunction(({before,id,count})=>window.__captureAudit.completed.filter(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.scene.id===id&&window.__rendered.some(x=>x.sequence===r.sequence&&x.workerId===r.workerId)).length>=count,{before,id,count});}

try{
 await stage('launch-and-initialize',async()=>{
  server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000);await context.addInitScript(installObservation);page=await context.newPage();report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Project dimensions verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');
  await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('roots'));s.id='project-resolution-start';s.name='Local omission startup';s.settings.rootsMode='single';s.settings.sampleCount=1;s.equations.polynomial='z^2-1';saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
  await page.route('**/api/health',r=>r.fulfill({status:503,contentType:'text/plain',body:'Use actual local PNG Blob export; this verifier does not test the image server.'}));await page.goto(server.resolvedUrls.local[0]);await ready();await installRenderer();
 });
 const native={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Project-resolution source Roots',resolution:{width:800,height:600},polynomial:{variable:'z',coefficients:{1:'1',0:'-t2'}},root_parameters:{t2:{domain:'FIXED',re:.05,im:.08}},sampling:{sample_count:100,batch_size:10,seed:'91'},palette:['#FF7020','#20EFFF'],camera:{phi:0,theta:0,gamma:0},settings:{render_mode:'GPU_DENSITY',worker_count:1,max_splat_points_per_frame:1,dot_size:.08,color_metric:'re(t2)',brightness:.4,gamma:1,background_color:'#000000'},timeline:[{type:'wait',duration:20}]};
 // Deliberate native numeric spellings; no fabricated native local clock keys.
 const nativeText=JSON.stringify(native,null,2).replace('"width": 800','"width": 800.0').replace('"height": 600','"height": 600e0');
 await writeFile(artifact('native-roots.json'),nativeText,{flag:'wx'});
 let row;
 report.checks.nativeImport=await stage('native-import-first-measured-request',async()=>{
  const loaded=await importText(nativeText,'native-roots.json',native.name);row=loaded.row;
  check(row.output.type==='raster'&&row.output.backend==='webgl2'&&row.output.rootsPresentation?.model==='mathart-1.7.8-v1','native Roots source presentation did not reach the real GPU Worker');
  check(same(row.request.scene.provenance.original,native),'native import changed source provenance');
  for(const [key,token]of [['width','800.0'],['height','600e0']])check(row.request.scene.provenance.sourceNumberTokens.some(x=>same(x.path,['resolution',key])&&x.token===token),'resolution numeric token was not preserved: '+key);
  const requests=await requestsAfter(loaded.before,row.request.scene.id);check(requests.length>0&&requests[0].request.context.time===0,'native initial request did not start at zero');for(const r of requests)assertRequestFit(r,{width:800,height:600});
  check(row.output.rootsPresentation.density.submittedFinitePointCount>0,'first measured native frame did not receive its initial visible point');
  await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();check(await sizing().inputValue()==='fixed','native resolution controls did not show fixed mode');await page.screenshot({path:artifact('native-import.png')});
  return{row,requests,fit:assertRequestFit(row,{width:800,height:600})};
 });
 report.checks.draftAndApply=await stage('draft-invalid-and-apply',async()=>{
  const before=await mark();await page.getByRole('spinbutton',{name:label('项目宽度'),exact:true}).fill('63');check(await applyButton().isDisabled(),'invalid project width can be applied');check(await page.getByRole('alert').count()>0,'invalid draft is not explained');
  await draftPair(900,600);await page.waitForTimeout(250);check((await requestsAfter(before,row.request.scene.id)).length===0,'dimension draft generated or reset the scene before Apply');
  const previous=row,result=await applyPair(row,900,600);row=result.row;return{previous,result,draftGeneratedRequests:0};
 });
 report.checks.playingSameAspectApply=await stage('play-same-aspect-apply-frame-zero-resume',async()=>{
  const previous=row,id=row.request.scene.id,playMark=await mark();await page.getByRole('button',{name:label('播放'),exact:true}).click();await waitPresentedCount(playMark,id,2);
  await draftPair(1800,1200);const beforeApply=await mark();await applyButton().click();
  await page.waitForFunction(({beforeApply,id,worker})=>window.__captureAudit.completed.filter(r=>r.sequence>beforeApply&&r.workerId!==worker&&r.request.operation==='generate'&&r.request.scene.id===id&&r.request.scene.projectResolution?.width===1800&&window.__rendered.some(x=>x.sequence===r.sequence&&x.workerId===r.workerId)).length>=3,{beforeApply,id,worker:previous.workerId});
  const pauseMark=await mark();await pause();row=await lastRow(id);
  const requests=(await requestsAfter(beforeApply,id)).filter(r=>r.request.scene.projectResolution?.width===1800),completed=await page.evaluate(({beforeApply,id})=>window.__captureAudit.completed.filter(r=>r.sequence>beforeApply&&r.request.operation==='generate'&&r.request.scene.id===id&&r.request.scene.projectResolution?.width===1800),{beforeApply,id});
  check(requests.length>=3&&requests[0].request.context.time===0&&completed[0].output.rootsPresentation.cameraTimeline.frame===0,'playing Apply missed the first source frame');
  check(requests[0].workerId!==previous.workerId&&requests[0].request.context.rootsSessionId!==previous.request.context.rootsSessionId,'same-ratio pair did not replace the runtime instance');
  const firstPresented=await page.evaluate(sequence=>window.__rendered.find(x=>x.sequence===sequence),requests[0].sequence);check(firstPresented&&requests[1].sentAt>=firstPresented.at,'play resumed before the new zero frame was actually presented');
  for(let i=0;i<requests.length;i++){assertRequestFit(requests[i],{width:1800,height:1200});if(i)check(requests[i].request.context.time>requests[i-1].request.context.time,'Apply auto-resume or Pause sent a duplicate/nonincreasing frame');}
  const settled=await mark();await page.waitForTimeout(200);check((await mark())===settled,'paused preview generated another request without a time change');
  // Resume has the same no-extra-splat requirement: its first request must
  // advance time, not merely restate the already completed paused frame.
  const paused=row,resumeMark=await mark();await page.getByRole('button',{name:label('播放'),exact:true}).click();await waitPresentedCount(resumeMark,id,2);await pause();row=await lastRow(id);const resumed=await requestsAfter(resumeMark,id);
  check(resumed.length>=2&&resumed[0].request.context.time>paused.request.context.time,'Resume generated the paused source frame again');for(let i=1;i<resumed.length;i++)check(resumed[i].request.context.time>resumed[i-1].request.context.time,'Resume/Pause duplicated a source frame');
  await page.screenshot({path:artifact('playing-apply-paused.png')});return{previous,playMark,beforeApply,pauseMark,requests,completed,firstPresented,paused,resumeMark,resumed,final:row,scope:'Real rendered Play frames, reset on pair Apply, presentation barrier, then real resumed frames; no mocked clock or output.'};
 });
 report.checks.undo=await stage('undo-project-pair',async()=>{
  const previous=row,before=await mark();await page.getByTitle(label('撤销'),{exact:true}).click();row=await fresh(before,previous.request.scene.id,0);
  check(same(row.request.scene.projectResolution,{width:900,height:600})&&row.workerId!==previous.workerId&&row.request.context.rootsSessionId!==previous.request.context.rootsSessionId,'Undo did not restore the prior pair with a fresh zero-time instance');return{previous,row,fit:assertRequestFit(row,{width:900,height:600})};
 });
 report.checks.hostResize=await stage('host-resize-keeps-instance',async()=>{
  const previous=row,before=await mark();await page.setViewportSize({width:1600,height:920});row=await fresh(before,previous.request.scene.id,0);
  check(row.workerId===previous.workerId&&row.request.context.rootsSessionId===previous.request.context.rootsSessionId&&row.output.rootsPresentation.instance===previous.output.rootsPresentation.instance,'host resize recreated the source instance');
  check(row.output.rootsPresentation.newSamples===0&&row.output.roots.solverWork===previous.output.roots.solverWork&&row.output.rootsPresentation.cameraTimeline.framesAdvanced===0,'host resize advanced solver/clock');
  check(!same(row.request.context.rootsViewport,previous.request.context.rootsViewport),'host resize did not change actual fitted logical dimensions');
  const requests=await requestsAfter(before,row.request.scene.id);for(const r of requests)assertRequestFit(r,{width:900,height:600});return{previous,row,requests,fit:assertRequestFit(row,{width:900,height:600})};
 });
 report.checks.quality=await stage('quality-changes-math-budget-not-project-pair',async()=>{
  const previous=row,before=await mark();await page.getByTitle(label('工作区设置'),{exact:true}).click();await page.getByRole('combobox',{name:label('渲染质量'),exact:true}).selectOption('standard');row=await fresh(before,previous.request.scene.id,0);await page.getByRole('button',{name:label('关闭设置'),exact:true}).click();
  check(row.workerId===previous.workerId&&row.request.context.rootsSessionId===previous.request.context.rootsSessionId&&row.output.rootsPresentation.newSamples===0,'quality change replaced or resampled the source instance');const standard=row,fit=assertRequestFit(row,{width:900,height:600},'standard');
  const back=await mark();await page.getByTitle(label('工作区设置'),{exact:true}).click();await page.getByRole('combobox',{name:label('渲染质量'),exact:true}).selectOption('low');row=await fresh(back,row.request.scene.id,0);await page.getByRole('button',{name:label('关闭设置'),exact:true}).click();return{previous,standard,fit,low:row,lowFit:assertRequestFit(row,{width:900,height:600})};
 });
 report.checks.followViewport=await stage('explicit-follow-viewport-omission',async()=>{
  const previous=row,beforeDraft=await mark();await sizing().selectOption('viewport');await page.waitForTimeout(150);check((await mark())===beforeDraft,'sizing-mode draft immediately changed the scene');const before=await mark();await applyButton().click();row=await fresh(before,previous.request.scene.id,0);
  check(!Object.hasOwn(row.request.scene,'projectResolution')&&row.workerId!==previous.workerId&&row.request.context.rootsSessionId!==previous.request.context.rootsSessionId,'Follow viewport did not remove the authored pair and restart');const fit=assertRequestFit(row,undefined);await page.screenshot({path:artifact('follow-viewport.png')});return{previous,row,fit};
 });
 report.checks.saveAndReopen=await stage('project-pair-json-save-reopen',async()=>{
  const changed=await applyPair(row,257,193);row=changed.row;const beforeSave=row,before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,row.request.scene.id,0);check(row.workerId===beforeSave.workerId&&row.request.context.rootsSessionId===beforeSave.request.context.rootsSessionId,'Save recreated the instance');
  const downloading=page.waitForEvent('download',{timeout:20000});await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();await(await downloading).saveAs(artifact('project.mathart.json'));
  const text=await readFile(artifact('project.mathart.json'),'utf8'),saved=JSON.parse(text),parsed=await page.evaluate(async text=>{const{parseScene}=await import('/src/engine/document.ts');return parseScene(text);},text);
  check(same(parsed.projectResolution,{width:257,height:193})&&same(parsed.provenance.original,native),'actual saved JSON failed project/source roundtrip');
  for(const[key,token]of [['width','800.0'],['height','600e0']])check(parsed.provenance.sourceNumberTokens.some(x=>same(x.path,['resolution',key])&&x.token===token),'source numeric lexeme disappeared after edited pair/save');
  check(!Object.hasOwn(saved,'evaluatedRootsCamera')&&!Object.hasOwn(saved,'rootsSessionId')&&!Object.hasOwn(saved,'rootsViewport')&&!Object.hasOwn(saved.rootsPresentation,'instance'),'runtime camera/session/measurement leaked into authored JSON');
  const previous=row,loaded=await importText(text,'project-reopened.mathart.json',saved.name);row=loaded.row;check(row.workerId!==previous.workerId&&row.request.context.rootsSessionId!==previous.request.context.rootsSessionId,'same-ID reopen did not reset the instance');
  const requests=await requestsAfter(loaded.before,row.request.scene.id);for(const r of requests)assertRequestFit(r,{width:257,height:193});check(requests[0].request.context.time===0&&row.output.rootsPresentation.density.submittedFinitePointCount>0,'reopen consumed its initial points at an old/unmeasured size');
  return{beforeSave,saved:parsed,sha256:sha(text),previous,row,requests,fit:assertRequestFit(row,{width:257,height:193})};
 });
 report.checks.pausedPng=await stage('paused-png-default-project-size-rgba-exact',async()=>{
  const before=row;await openExport(257,193);check(await page.getByRole('combobox',{name:label('复根图像来源'),exact:true}).inputValue()==='current','project-sized PNG did not use current paused mode');check(await page.getByRole('combobox',{name:label('PNG 放大倍率'),exact:true}).inputValue()==='1','unexpected default upscale');
  const result=await downloadCapture('paused-project-257x193',row.workerId,257,193);const b=before.output.rootsPresentation;
  for(const o of [result.row.capture,result.row.output]){const f=o.rootsPresentation;check(f.instance===b.instance&&f.newSamples===0&&f.newRawPoints===0&&o.roots.solverWork===before.output.roots.solverWork,'project-sized capture sampled new roots');for(const key of ['frame','completedFrames','sceneTime','camera','rates','gradient','queueComplete'])check(same(f.cameraTimeline[key],b.cameraTimeline[key]),'capture advanced clock state '+key);check(f.cameraTimeline.framesAdvanced===0&&f.pending.pumpCalls===b.pending.pumpCalls,'capture advanced a pump or clock');}
  check(same(result.row.capture.rootsPresentation.physicalSize,[257,193])&&result.row.capture.rootsPresentation.referenceLogicalHeight===b.referenceLogicalHeight,'capture used project height instead of actual primary reference height');
  check(result.comparison.channels===257*193*4&&result.comparison.changedChannels===0&&result.comparison.alphaChanges===0&&result.comparison.distinctRgb>1,'actual project PNG RGBA changed or contains no visible point');await page.screenshot({path:artifact('roots-final-ui.png')});return{before,...result};
 });
 report.checks.fractalAndWidePng=await stage('other-family-8192-by-64-still-image',async()=>{
  const nativeFractal={config_version:'1.0.0',type:'FRACTAL',name:'Wide project fractal',resolution:{width:8192,height:64},fractal:{formula_id:'mandelbrot',type:'MANDELBROT',iterations:8},color:{outside:{algorithm_id:'smooth_mandelbrot'},inside:{algorithm_id:'none'}}};
  const text=JSON.stringify(nativeFractal,null,2).replace('"width": 8192','"width": 8192e0').replace('"height": 64','"height": 64.0');await writeFile(artifact('native-fractal.json'),text,{flag:'wx'});const loaded=await importText(text,'native-fractal.json',nativeFractal.name),fractal=loaded.row;
  check(fractal.request.scene.kind==='fractal'&&same(fractal.request.scene.provenance.original,nativeFractal),'other family import did not preserve native source');const requests=await requestsAfter(loaded.before,fractal.request.scene.id);for(const r of requests)assertRequestFit(r,{width:8192,height:64});
  for(const[key,token]of [['width','8192e0'],['height','64.0']])check(fractal.request.scene.provenance.sourceNumberTokens.some(x=>same(x.path,['resolution',key])&&x.token===token),'other-family dimension token not retained');
  await openExport(8192,64);const width=page.getByRole('spinbutton',{name:'Export width',exact:true});check(await width.getAttribute('max')==='16384'&&await page.getByRole('button',{name:'Start export',exact:true}).isEnabled(),'still-image incorrectly inherits encoder width limit');
  await page.getByRole('button',{name:label('动画视频'),exact:true}).click();check(await width.getAttribute('max')==='7680'&&await page.getByRole('button',{name:'Start export',exact:true}).isDisabled(),'video width limit disappeared');await page.getByText(label('宽度需为 16–7680、高度需为 16–4320 的整数。'),{exact:true}).waitFor();
  await page.getByRole('button',{name:label('静态图像'),exact:true}).click();check(await width.getAttribute('max')==='16384'&&await page.getByRole('button',{name:'Start export',exact:true}).isEnabled(),'switching back to still-image retained video rejection');
  const before=await mark(),downloading=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'Start export',exact:true}).click();await(await downloading).saveAs(artifact('wide-8192x64.png'));
  const exported=await page.evaluate(before=>window.__captureAudit.completed.findLast(r=>r.sequence>before&&r.request.operation==='generate'&&r.request.context.quality==='export'&&r.request.context.width===8192&&r.request.context.height===64),before);check(exported&&exported.output.width===8192&&exported.output.height===64,'wide PNG did not use a real full-size Worker raster');
  await page.waitForFunction(sequence=>window.__rendered.some(x=>x.sequence===sequence),exported.sequence);const bytes=await readFile(artifact('wide-8192x64.png')),decoded=decodePng(bytes);check(decoded.width===8192&&decoded.height===64&&decoded.rgba.length===8192*64*4,'actual PNG was rejected, resized or truncated at video width limit');
  await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await page.screenshot({path:artifact('wide-fractal-ui.png')});return{fractal,requests,fit:assertRequestFit(fractal,{width:8192,height:64}),exported,png:{width:decoded.width,height:decoded.height,rgbaBytes:decoded.rgba.length,sha256:sha(bytes),bytes:bytes.length},scope:'Other-family source provenance/fit and actual large-width still-image encoding. Wide Fractal PNG is checked for completed producer/renderer identity and dimensions, not native image parity.'};
 });
 check(!report.pageErrors.length,'unexpected App page errors');report.audit=await page.evaluate(()=>({issued:window.__captureAudit.issued,created:window.__captureAudit.created,terminated:window.__captureAudit.terminated,errors:window.__captureAudit.errors,rendered:window.__rendered,status:document.querySelector('.status-bar')?.textContent}));check(!report.audit.errors.length,'unexpected Worker errors');report.status='passed';
}catch(error){failure=error;report.status='failed';report.error={message:error.message,stack:error.stack};if(page&&!page.isClosed()){await page.screenshot({path:artifact('failure.png')}).catch(()=>{});report.failure=await page.evaluate(()=>{const a=window.__captureAudit;return{audit:a?{issued:a.issued,requests:a.requests,completed:a.completed,errors:a.errors,created:a.created,terminated:a.terminated}:undefined,rendered:window.__rendered,body:document.body?.innerText};}).catch(()=>null);}}
finally{
 const closing=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,viteClosed:server?!server.httpServer?.listening:true,errors:closing.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};report.sourceAfter=await hashes();report.sourceStable=same(report.sourceBefore,report.sourceAfter);report.elapsedMs=performance.now()-started;
 report.limitations=['This is the local browser CSS adaptation of retained F32 aspect-fit arithmetic. No original app/JVM, Compose DP/roundToPx, JOGL surface density or monitor DPI is executed.','The original anchored no-override 300ms window-candidate reconstruction policy remains outside this implementation and verifier.','Native source JSON does not author the local sampling clock; the fixture leaves those defaults intact. Save stores explicitly edited project dimensions separately from original source numeric spellings.','Host resize is intentionally same-instance: density size changes may clear ink and consume retained pending points without resampling. Fixed-pair Apply/Undo/document reopen explicitly rebuild.','Paused PNG compares every enhanced same-Worker capture RGBA byte including alpha. This proves local direct PNG integration, not original native image parity.','The large-width second-family PNG checks actual completed export/renderer size and decoded image length; video limits are separately checked without running an encoder.','Task wall/stage times are recorded. External observer owns process-family CPU/RSS and residual-process verification; VRAM and agent tokens are unmeasured.'];
 if(!report.sourceStable||report.cleanup.errors.length){report.status='failed';failure??=Error('Source drift or cleanup failure');}await writeFile(artifact('report.json'),json(report),{flag:'wx'});console.log(json({report:artifact('report.json'),status:report.status,error:report.error?.message,sourceStable:report.sourceStable,cleanup:report.cleanup}));
}
if(failure)throw failure;

