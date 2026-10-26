/** Actual production session → native HTTP/CGL, with original binary references.
 * Observers forward calls and ACKs unchanged, then use the production exchange
 * for bounded read-only diagnostics. A second run omits those diagnostics.
 * OUTPUT --native-backend SEALED.json --baseline ORIGINAL_DIR --warmup ORIGINAL_DIR
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer as tcp} from 'node:net';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium} from '@playwright/test';
import {createExportServer} from '../server/index.mjs';

const args=process.argv.slice(2),flag=n=>args[args.indexOf(n)+1],sha=b=>createHash('sha256').update(b).digest('hex');
assert(args[0]&&!args[0].startsWith('--')&&['--native-backend','--baseline','--warmup'].every(n=>args.includes(n)),'Supply output, sealed native backend and both original reference directories');
const out=resolve(args[0]),backendFile=resolve(flag('--native-backend')),backend=JSON.parse(await readFile(backendFile));
assert.equal(sha(await readFile(backend.executablePath)),backend.executableSha256);
await mkdir(dirname(out),{recursive:true});await mkdir(out);
const writeJson=async(p,d)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(d,null,2)+'\n');};
const observerFile='src/engine/sourceNativeClient.ts',anchor='export async function exchangeSourceAttractorNative(',releaseAnchor='export async function releaseSourceAttractorNative(';
function wrap(code){assert.equal(code.split(anchor).length,2,'Native exchange observer anchor changed');assert.equal(code.split(releaseAnchor).length,2,'Native release observer anchor changed');return code.replace(anchor,'async function __attractorRuntimeExchange(').replace(releaseAnchor,'async function __attractorRuntimeRelease(')+`
export async function exchangeSourceAttractorNative(...args:Parameters<typeof __attractorRuntimeExchange>){
 const result=await __attractorRuntimeExchange(...args);
 const observe=(globalThis as any).__attractorRuntimeObserve;
 if(observe)await observe(args[0],result,__attractorRuntimeExchange,args[1]);
 return result;
}
export async function releaseSourceAttractorNative(...args:Parameters<typeof __attractorRuntimeRelease>){
 const result=await __attractorRuntimeRelease(...args);
 const observe=(globalThis as any).__attractorRuntimeObserve;
 if(observe)await observe(args[0],result,__attractorRuntimeExchange);
 return result;
}
`;}
await transformWithEsbuild(wrap(await readFile(observerFile,'utf8')),observerFile,{loader:'ts'});
async function pins(){const files=(await Promise.all(['src','server'].map(async p=>(await readdir(p,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name)))).flat();files.push('scripts/verify-attractor-native-runtime.mjs',backendFile,backend.executablePath);return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(p))])));}
const report={status:'running',at:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceBefore:await pins(),backend,cases:[],checks:[],pageErrors:[],cleanup:[],limits:['Two constructed original inputs, fixed 30 fps, samples0, 500x600 on this Mac. No original window or cross-device claim.','Diagnostic read requests and binary writes add overhead; not a performance benchmark.','Original metadata is read as evidence; original run outputs bind binary hashes. Original GL1282 host warning remains.']};
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);};
let browser,page,vite,service,deadline,currentFiles={},captureDirectory;
const started=performance.now();
async function readOriginal(reference,label,file){const name=label+'/'+file,b=await readFile(resolve(reference.root,name));assert.equal(sha(b),reference.run.outputs[name]?.sha256??reference.run.outputs[name],`Original binary pin ${name}`);return b;}
function exact(a,b,label){check(a.length===b.length&&a.equals(b),label+` (reference=${sha(a)}, actual=${sha(b)})`);}
function flip(bytes,width,height){const result=Buffer.alloc(bytes.length),stride=width*4;for(let y=0;y<height;y++)bytes.copy(result,(height-1-y)*stride,y*stride,(y+1)*stride);return result;}
try{
 const port=await new Promise((done,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):done(p));});});
 const origin=`http://127.0.0.1:${port}`;
 service=await createExportServer({root:out+'/service',sourceRendererBackend:backend,allowedOrigins:[origin]});const address=await service.listen(0);
 vite=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},plugins:[{name:'attractor-native-runtime-observer',enforce:'pre',async transform(code,id){if(id.split('?')[0]!==resolve(observerFile))return;return transformWithEsbuild(wrap(code),id,{loader:'ts'});}}],logLevel:'error'});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:405,height:486},deviceScaleFactor:2});page.on('pageerror',e=>report.pageErrors.push(String(e)));
 deadline=setTimeout(()=>void browser.close().catch(()=>{}),240000);
 await page.route('**/native-attractor-runtime',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Native Attractor runtime verification</title>'}));
 await page.exposeFunction('__attractorRuntimeFile',async(name,base64)=>{assert(captureDirectory&&/^[a-zA-Z0-9_.-]+$/.test(name),'Unsafe diagnostic file');const b=Buffer.from(base64,'base64');assert(!currentFiles[name],'Duplicate diagnostic file');currentFiles[name]={bytes:b.length,sha256:sha(b)};await writeFile(resolve(captureDirectory,name),b);});
 await page.goto(origin+'/native-attractor-runtime');
 report.health=await page.evaluate(()=>fetch('/api/source-renderer/health').then(r=>r.json()));check(report.health.available===true,'sealed native service available');
 await page.evaluate(async()=>{
  const [{SourceAttractorNativeBackend},{SourceAttractorSession},{parseProjectFile},{prepareSourceAttractorScene},{prepareOrdinarySourceFrame},{SOURCE_CAMERA_MODEL}]=await Promise.all([import('/src/engine/sourceAttractorNativeBackend.ts'),import('/src/scenes/sourceAttractor.ts'),import('/src/engine/legacyImport.ts'),import('/src/engine/sourceAttractorDocument.ts'),import('/src/engine/ordinarySourceCamera.ts'),import('/src/engine/sourceCamera.ts')]);
  const s=window.__nativeAttractor={SourceAttractorNativeBackend,SourceAttractorSession,parseProjectFile,prepareSourceAttractorScene,prepareOrdinarySourceFrame,SOURCE_CAMERA_MODEL,enabled:true,selected:false,events:[],resources:new Map(),diagSequence:0,cancelAfterPass:false,cancelled:false};
  s.save=async(name,bytes)=>{let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));await window.__attractorRuntimeFile(name,btoa(str));};
  window.__attractorRuntimeObserve=async(request,result,exchange,options)=>{
   const op=request.operation,meta={...result};delete meta.pixels;delete meta.records;
   const row={kind:op.kind,request:{generation:request.generation,sequence:request.sequence,width:request.width,height:request.height,resource:op.resource},response:meta};s.events.push(row);
   if(op.kind==='create')s.resources.set(op.resource,{count:op.count,texSize:op.texSize});
   if(op.kind==='release'){if(result.disposition==='released'||result.disposition==='absent')s.resources.delete(op.resource);return;}
   if(op.kind==='upload'){row.offset=op.offset;row.arrayBytes=op.positions.byteLength+op.texIndex.byteLength+op.colors.byteLength;}
   if(!s.enabled)return;
   if(op.kind==='upload'){row.offset=op.offset;row.uploads={};for(const name of ['positions','texIndex','colors']){const a=op[name],file=`upload-${op.offset}-${name}.f32le`;await s.save(file,new Uint8Array(a.buffer,a.byteOffset,a.byteLength));row.uploads[name]=file;}}
   const read=async(target,file,count)=>{
    const pieces=[];for(let offset=0;offset<count;){const n=Math.min(count-offset,262144);const response=await exchange({generation:0x7fff0000,sequence:++s.diagSequence,width:1,height:1,operation:{kind:'read',resource:op.resource,expectedIndex:result.passIndex,expectedRenderIndex:result.renderIndex,expectedUploaded:result.uploaded,expectedCount:result.count,expectedTexSize:result.texSize,target,offset,count:n}},{retainedBytes:(options?.retainedBytes??0)+(op.kind==='render'?16*result.accumWidth*result.accumHeight+4*result.width*result.height:0)});
     if(!(response.records instanceof Uint8Array)||response.records.length!==n*16)throw Error('Incomplete actual native diagnostic read');pieces.push(response.records);offset+=n;
    }const bytes=new Uint8Array(count*16);let at=0;for(const p of pieces){bytes.set(p,at);at+=p.length;}await s.save(file,bytes);return file;
   };
   if(op.kind==='pass'){row.pass=op.pass;row.state=await read('state',`pass-${result.passIndex}-state.f32le`,result.texSize**2);if(s.cancelAfterPass){s.cancelAfterPass=false;s.cancelled=true;}if(s.loseAfterPass){s.loseAfterPass=false;throw Error('Injected client delivery failure after actual native pass ACK');}}
   if(op.kind==='render'){row.state=await read('state','gpu-state.f32le',result.texSize**2);if(s.selected)row.accumulation=await read('accumulation','accum.f32le',result.accumWidth*result.accumHeight);}
  };
 });
 for(const [name,key] of [['baseline','--baseline'],['warmup','--warmup']]){
  const root=resolve(flag(key)),run=JSON.parse(await readFile(root+'/run.json')),input=await readFile(root+'/source.json');assert.equal(run.exit,0);assert.equal(run.jarUnchanged,true);assert.equal(run.sourceUnchanged,true);assert.equal(sha(input),run.plan.sourceSha256);
  const reference={root,run},entries=await readdir(root),steps=entries.filter(x=>/^step-\d+$/.test(x)).map(x=>+x.slice(5)).sort((a,b)=>a-b),completion=steps.at(-1);assert.equal(steps.length,completion);
  const item={name,reference:root,referenceRunSha256:sha(await readFile(root+'/run.json')),inputSha256:sha(input),completion,runs:[]};report.cases.push(item);
  const frames=[{label:'paused-initial',ordinal:0},...steps.map(n=>({label:`step-${n}`,ordinal:n})),{label:'post-complete',ordinal:completion+1},{label:'paused-final',ordinal:completion+1}];
  for(const observed of [true,false]){
   const variant=observed?'observed':'control',result={variant,frames:[]};item.runs.push(result);
   await page.evaluate(({text,observed})=>{const s=window.__nativeAttractor;s.enabled=observed;s.scene=s.parseProjectFile(text).scene;s.prepared=s.prepareSourceAttractorScene(s.scene);s.session=new s.SourceAttractorSession({asyncBackend:o=>new s.SourceAttractorNativeBackend(o)});s.cancelled=false;}, {text:input.toString(),observed});
   try{for(const frame of frames){
    const originalState=JSON.parse(await readFile(root+'/'+frame.label+'/state.json')),selected=Object.hasOwn(run.outputs,frame.label+'/math.rgba');
    captureDirectory=resolve(out,name,variant,frame.label);await mkdir(captureDirectory,{recursive:true});currentFiles={};
    const data=await page.evaluate(async({ordinal,selected})=>{
     const s=window.__nativeAttractor;s.events=[];s.selected=selected;
     const viewport={logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'};let output,diagnostics;
     if(ordinal===0){const owner=new s.SourceAttractorNativeBackend(s.prepared);try{await owner.initialize();output=await owner.render({width:500,height:600,cameraPlan:s.prepareOrdinarySourceFrame({model:s.SOURCE_CAMERA_MODEL,time:0,frameIndex:0,camera:s.prepared.camera,viewport}),backgroundColor:s.prepared.backgroundColor});diagnostics=owner.diagnostics();}finally{await owner.dispose();}}
     else{output=await s.session.generateAsync(s.scene,{time:(ordinal-1)/30,width:500,height:600,quality:'export',sourceViewport:viewport,sourcePointPixelDensity:2,isCancelled:()=>s.cancelled});diagnostics=s.session.diagnostics();}
     await s.save('output-top-down.rgba',new Uint8Array(output.pixels.buffer,output.pixels.byteOffset,output.pixels.byteLength));
     return{events:s.events,diagnostics,frame:output.sourceCameraFrame,formulaPresentation:output.formulaPresentation,backend:output.backend,sourcePixelRenderer:output.sourcePixelRenderer,pixelDensity:output.sourceAttractorPixelDensity,resources:s.resources.size};
    },{ordinal:frame.ordinal,selected});
    const saved={...frame,selected,...data,files:currentFiles};result.frames.push(saved);await writeJson(captureDirectory+'/frame.json',saved);
    check(data.sourcePixelRenderer?.backend==='native'&&data.sourcePixelRenderer.identity===report.health.rendererIdentity,name+'/'+frame.label+' actual native pixel producer');
    check(data.events.length>0&&data.events.every(e=>e.response.rendererIdentity===report.health.rendererIdentity&&e.response.contextSerial>0&&e.response.sessionSerial>0),name+'/'+frame.label+' sealed runtime identities');
    if(observed){
     exact(await readOriginal(reference,frame.label,'gpu-state.f32le'),await readFile(captureDirectory+'/gpu-state.f32le'),name+'/'+frame.label+' full state including padding');
     if(selected){exact(await readOriginal(reference,frame.label,'accum.f32le'),await readFile(captureDirectory+'/accum.f32le'),name+'/'+frame.label+' full accumulation');exact(flip(await readOriginal(reference,frame.label,'math.rgba'),500,600),await readFile(captureDirectory+'/output-top-down.rgba'),name+'/'+frame.label+' delivered full math RGBA');}
     const normal=(await readFile(root+'/'+frame.label+'/draws.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(d=>d.stage==='update');
     const warmup=(await readFile(root+'/primary-paused/draws.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(d=>d.stage==='update');
     const passes=data.events.filter(e=>e.kind==='pass'),warm=passes.filter(e=>e.pass.warmup),active=passes.filter(e=>!e.pass.warmup);
     check(active.length===normal.length,name+'/'+frame.label+' actual normal pass count');check(warm.length===((frame.ordinal===0||frame.ordinal===1)?warmup.length:0),name+'/'+frame.label+' actual warmup pass count');
     for(const [actual,expected,source]of [[warm,warmup,'primary-paused'],[active,normal,frame.label]])for(let i=0;i<actual.length;i++)exact(await readOriginal(reference,source,expected[i].rgbaFile),await readFile(captureDirectory+'/'+actual[i].state),name+'/'+frame.label+' actual pass '+actual[i].response.passIndex);
     if(frame.ordinal>0)check(data.pixelDensity===2&&data.frame.viewport.target==='offscreen',name+'/'+frame.label+' production output density/viewport');
    }else exact(await readFile(resolve(out,name,'observed',frame.label,'output-top-down.rgba')),await readFile(captureDirectory+'/output-top-down.rgba'),name+'/'+frame.label+' observer-disabled control');
    check(originalState.activeOrdinal===frame.ordinal,name+'/'+frame.label+' actual original ordinal');
   }}finally{await page.evaluate(async()=>{const s=window.__nativeAttractor;await s.session.resetAsync();if(s.resources.size)throw Error('Actual native resources remain after reset');});}
  }
 }
 // Real asynchronous owner lifecycle. The lost-ACK case explicitly injects a
 // client-delivery failure after a successful native operation; it is not a
 // claim of an actual network or driver fault.
 report.lifecycle=[];
 async function lifecycle(label,request){
  captureDirectory=resolve(out,'lifecycle',label);await mkdir(captureDirectory,{recursive:true});currentFiles={};
  const data=await page.evaluate(async request=>{
   const s=window.__nativeAttractor;s.events=[];s.selected=false;s.enabled=!request.large;s.cancelled=false;s.cancelAfterPass=!!request.cancel;s.loseAfterPass=!!request.loseAck;
   if(request.input){s.scene=s.parseProjectFile(request.input).scene;s.session=new s.SourceAttractorSession({asyncBackend:o=>new s.SourceAttractorNativeBackend(o)});}
   const width=request.width??500,height=request.height??600,viewport={logicalWidth:width/2,logicalHeight:height/2,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'};
   let output,error;try{output=await s.session.generateAsync(s.scene,{time:request.time??0,width,height,quality:'export',sourceViewport:viewport,sourcePointPixelDensity:2,isCancelled:()=>s.cancelled});await s.save('output-top-down.rgba',new Uint8Array(output.pixels.buffer,output.pixels.byteOffset,output.pixels.byteLength));}catch(e){error={name:e.name,message:e.message};}
   return{events:s.events,error,resources:s.resources.size,diagnostics:s.session.diagnostics(),stats:output?.stats,sourcePixelRenderer:output?.sourcePixelRenderer,width:output?.width,height:output?.height};
  },request);
  const row={label,...data,files:currentFiles};report.lifecycle.push(row);await writeJson(captureDirectory+'/frame.json',row);return row;
 }
 const warmupInput=await readFile(resolve(flag('--warmup'),'source.json'),'utf8');
 const first=await lifecycle('initial',{input:warmupInput}),repeat=await lifecycle('repeat',{});
 check(!first.error&&!repeat.error,'native lifecycle initial/repeat complete');check(repeat.events.every(e=>e.kind!=='pass'),'repeated time submits no update');
 exact(await readFile(out+'/lifecycle/initial/output-top-down.rgba'),await readFile(out+'/lifecycle/repeat/output-top-down.rgba'),'same-time image exact');
 const forward=await lifecycle('forward',{time:.5}),resized=await lifecycle('resize',{time:.5,width:504,height:608}),restored=await lifecycle('resize-back',{time:.5});
 check(!forward.error&&!resized.error&&!restored.error,'forward/resize/restore complete');check(resized.width===504&&resized.height===608&&resized.events.every(e=>e.kind!=='pass'),'resize keeps actual state and uses requested dimensions');
 exact(await readFile(out+'/lifecycle/forward/gpu-state.f32le'),await readFile(out+'/lifecycle/resize/gpu-state.f32le'),'resize keeps all state bits');
 exact(await readFile(out+'/lifecycle/forward/output-top-down.rgba'),await readFile(out+'/lifecycle/resize-back/output-top-down.rgba'),'resize back restores exact pixels');
 const reverse=await lifecycle('reverse',{});check(!reverse.error,'reverse seek completes');const releaseAt=reverse.events.findIndex(e=>e.kind==='release'),createAt=reverse.events.findIndex(e=>e.kind==='create');check(releaseAt>=0&&createAt>releaseAt,'reverse confirms old release before new creation');exact(await readFile(out+'/lifecycle/initial/output-top-down.rgba'),await readFile(out+'/lifecycle/reverse/output-top-down.rgba'),'reverse rebuild pixels exact');
 for(const [label,option] of [['cancel-after-ack','cancel'],['lost-ack','loseAck']]){
  const failure=await lifecycle(label,{time:1/30,[option]:true});check(!!failure.error&&failure.resources===0,label+' rejects output and releases actual native resource');if(option==='cancel')check(failure.error.name==='AbortError','soft cancel returns AbortError');else check(failure.error.message.includes('Injected client delivery failure'),'lost ACK test remains explicitly injected');
  const pass=failure.events.findLast(e=>e.kind==='pass'),released=failure.events.findLast(e=>e.kind==='release');check(pass&&released&&released.response.passIndex===pass.response.passIndex&&released.response.resource===pass.response.resource,label+' cleanup accounts for native committed checkpoint');check(!failure.files['output-top-down.rgba'],label+' publishes no raster');
  const recovery=await lifecycle(label+'-recovery',{});check(!recovery.error,'recovery after '+label);exact(await readFile(out+'/lifecycle/initial/output-top-down.rgba'),await readFile(out+'/lifecycle/'+label+'-recovery/output-top-down.rgba'),'recovery pixels '+label);
 }
 await page.evaluate(async()=>{await window.__nativeAttractor.session.resetAsync();if(window.__nativeAttractor.resources.size)throw Error('Lifecycle resources remain');});
 const large=JSON.parse(await readFile(resolve(flag('--baseline'),'source.json'),'utf8'));large.name='Native Attractor two-million capacity diagnostic';large.settings.particle_count_gpu=2000000;await writeJson(out+'/large-input.json',large);
 const capacityCase=await lifecycle('two-million',{input:JSON.stringify(large),large:true,width:1024,height:1024});check(!capacityCase.error&&capacityCase.width===1024&&capacityCase.height===1024&&capacityCase.stats.samples===2000000&&capacityCase.stats.generated===2000000,'two-million particles preserved through actual native generation');
 const uploads=capacityCase.events.filter(e=>e.kind==='upload'),last=uploads.at(-1);check(uploads.length>1&&uploads.every(e=>e.arrayBytes<=4*1024*1024)&&last.response.count===2000000&&last.response.uploaded===last.response.texSize**2,'actual multi-chunk upload includes whole square without particle reduction');
 await page.evaluate(async()=>{await window.__nativeAttractor.session.resetAsync();if(window.__nativeAttractor.resources.size)throw Error('Large native resource remains');});
 check(!report.pageErrors.length,'no application page errors');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 clearTimeout(deadline);
 for(const [name,owner]of [['browser',browser],['vite',vite],['service',service]])if(owner)try{await owner.close();report.cleanup.push({name,status:'closed'});}catch(error){report.cleanup.push({name,status:'failed',error:String(error)});report.status='failed';process.exitCode=1;}
 report.ownedProcesses=service?.ownedProcessCount??0;report.sourceAfter=await pins();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(report.ownedProcesses||!report.sourceStable){report.status='failed';process.exitCode=1;}
 report.elapsedMs=performance.now()-started;await writeJson(out+'/report.json',report);console.log(JSON.stringify({status:report.status,checks:report.checks.length,sourceStable:report.sourceStable,ownedProcesses:report.ownedProcesses,report:out+'/report.json',error:report.error}));
}
