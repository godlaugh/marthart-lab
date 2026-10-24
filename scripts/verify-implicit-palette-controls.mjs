/** Actual public Generator -> Worker -> CPU geometry/recording acceptance.
 * The control-free generateScene path is a separate local reference workflow,
 * not an independent math implementation or original-application oracle.
 * No App UI, original/native pixel parity, PNG or encoded video claim. */
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {measureFamily} from './browser-process-cost.mjs';

const script='scripts/verify-implicit-palette-controls.mjs';
const out=process.argv[2]??`.cache/implicit-palette-controls-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^implicit-palette-controls-[^/]+(?:\/run-[a-zA-Z0-9_-]+)?$/,'Use a new owned cache directory');
await mkdir(dirname(out),{recursive:true});await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashes(){
 const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(tsx?|json|css)$/.test(p)).map(p=>'src/'+p);
 paths.push(script,'scripts/browser-process-cost.mjs','package.json','package-lock.json');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const paletteA=['#80112233','#40Dd5522','#0000AAFF'];
const paletteB=['#20aa22ff','#AACC6600','#8033DD99'];
const paletteC=['#102244EE','#7FAA22BB','#0033DD88'];
const fixture={config_version:'1.0.0',type:'IMPLICIT',name:'Implicit explicit palette control',equation:{f:'x^2+y^2-z^2-1'},palette:paletteA,
 settings:{x_segments:8,y_segments:8,z_segments:8,x_min:-2,x_max:2,y_min:-2,y_max:2,z_min:-2,z_max:2,scale_x:35,scale_y:35,scale_z:35,offset_x:0,offset_y:0,offset_z:0,
  mesh_mode:'CPU',render_mode:'WIREFRAME',mesh_fill:true,mesh_fill_opacity:.7,line_weight:.8,dot_size:1.2,background_color:'#000000'},
 camera:{phi:'PI/2',theta:'0',gamma:'0'},parameters:{},main_equation:{enabled:false},timeline:[{type:'wait',duration:.5}]};
const report={status:'prepared',at:new Date().toISOString(),directory:out,nodeVersion:process.version,nodeExecutable:process.execPath,
 scope:'Finite source CPU Implicit mesh/slices through public Generator and real Worker. Explicit cold/current palette ownership, ordered commands, cold recording reset, author retention, continuation and actual geometry equality against the control-free local generation path. Owned headless Chrome only.',
 limits:['No App palette UI, native renderer, original JVM, original whole-image parity, PNG export or encoded MP4 is exercised. Public recording WebGL RGBA is compared byte-for-byte against separately generated cold geometry drawn with the existing local WebGL renderer.',
  'One 8×8×8 static formula fixture and a short wait queue. Actual timing is injected only through the existing supported Implicit clock API.',
  'The reference uses existing generateScene without implicitControls, with explicitly expected cold colors or independently opaque hot color strings; it is not an independent numerical implementation.',
  'Process CPU/RSS are sampled, include passive byte copies/hashing and browser/Vite overhead; short-lived processes may be missed. Tokens and GPU VRAM are unmeasured.',
  'Legacy/control cost comparison uses one fresh Worker per variant and eight warm redraws with identical static geometry; browser/module caches are warm. No statistical speedup claim.'],
 fixtureBoundary:'The legacy runtime-config bootstrap uses compatible RGB colors; immediately after parsing, the explicit new implicitSourcePalette owner receives original raw ARGB A. This does not claim raw ARGB runtime-config import support.',
 checks:[],rows:[],pageErrors:[],artifacts:[]};
await writeFile(out+'/verifier.mjs',await readFile(script));await writeFile(out+'/input.json',JSON.stringify(fixture,null,2)+'\n');report.sourceBefore=await hashes();
let server,browser,context,page;const started=performance.now(),workers=new Set();

/** Copies actual incoming geometry before production consumers can transfer it.
 * The bound is explicit and no event, response or request is substituted. */
function installObserver(){
 const a=window.__implicitControlWire={sequence:0,workerSequence:0,rows:[],retainedBytes:0,requests:[],terminated:[]},Native=window.Worker;
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.auditId=++a.workerSequence;this.addEventListener('message',({data})=>{
   if(!['generate','source-recording-begin','source-recording-frame','source-recording-finish','implicit-paused-capture','implicit-playback'].includes(data?.operation)||data.status)return;
   const geometry=[];for(const [role,output]of [['output',data.output],['warmup',data.result?.warmup],['preview',data.result?.preview],['capture',data.result?.capture]])if(output?.type==='geometry'){
    const copy=structuredClone(output),p=copy.sourceImplicitPresentation;
    const arrays=[copy.positions,copy.indices,copy.sourceImplicitMesh?.normals,p?.fillColors,p?.wire?.positions,p?.wire?.colors,p?.wire?.alphas].filter(Boolean);
    a.retainedBytes+=arrays.reduce((n,b)=>n+b.byteLength,0);if(a.retainedBytes>64*1024**2||a.rows.length>=256)throw Error('Bounded Implicit control observer exceeded');geometry.push({role,output:copy});
   }
   a.rows.push({sequence:++a.sequence,worker:this.auditId,id:data.id,operation:data.operation,sourceId:data.sourceId,recordingId:data.recordingId,error:data.error,retainedSourceId:data.retainedSourceId,geometry,
    result:data.result&&{scene:structuredClone(data.result.scene),context:structuredClone(data.result.context),clock:structuredClone(data.result.clock)}});
  });}
  postMessage(message,...args){if(message?.operation)a.requests.push({worker:this.auditId,operation:message.operation,id:message.id,scene:structuredClone(message.scene),context:structuredClone(message.context),sourceId:message.sourceId,recordingId:message.recordingId});return super.postMessage(message,...args);}
  terminate(){a.terminated.push(this.auditId);return super.terminate();}
 };
}

try{
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('webgl')},server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();context=await browser.newContext({viewport:{width:800,height:600},deviceScaleFactor:1});
 page=await context.newPage();page.on('worker',worker=>{workers.add(worker);worker.on('close',()=>workers.delete(worker));});page.on('pageerror',error=>report.pageErrors.push(error.message));await page.addInitScript(installObserver);
 await page.route('**/implicit-control-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Owned headless Implicit control verification</title>'}));
 await page.route('**/implicit-control-artifact/*',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);assert.match(name,/^[a-z0-9-]+\.(actual|expected)\.bin$/);const bytes=route.request().postDataBuffer();assert.ok(bytes.length<=8*1024**2);const path=out+'/'+name;await writeFile(path,bytes);report.artifacts.push({path,bytes:bytes.length,sha256:sha(bytes)});await route.fulfill({status:200,body:'ok'});});
 await page.goto(server.resolvedUrls.local[0]+'implicit-control-check');
 let failure;report.measurements=await measureFamily(process.pid,async()=>{
  const begin=performance.now();try{
   report.result=await page.evaluate(async({fixture,paletteB,paletteC})=>{
    const {Generator}=await import('/src/engine/client.ts');
    const {parseLegacyScene}=await import('/src/engine/legacyImport.ts');
    const {generateScene}=await import('/src/engine/temporal.ts');
    const {GeometryRecordingRenderer}=await import('/src/engine/renderGeometryRecording.ts');
    const {sourceRecordingSize}=await import('/src/engine/sourceRecordingSize.ts');
    const {sourceDrawingCleanupCount}=await import('/src/engine/sourceDrawingResources.ts');
    const {ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts');
    const {ordinarySourceCameraInitial}=await import('/src/engine/ordinarySourceCamera.ts');
    const {resolveOrdinarySourceCameraTimeline}=await import('/src/engine/ordinarySourceCameraTimeline.ts');
    const audit=window.__implicitControlWire,result=window.__implicitControlResult={checks:[],rows:[],rasters:[],faults:[],cost:[]};
    const same=(a,b)=>{if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((key,i)=>key===bk[i]&&same(a[key],b[key]));};
    const check=(condition,message)=>{if(!condition)throw Error(message);result.checks.push(message);};
    const bytes=value=>new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const original=parseLegacyScene(JSON.stringify({...fixture,palette:fixture.palette.map(color=>'#'+color.slice(-6))})).scene;original.implicitSourcePalette={colors:[...fixture.palette]};
    const appliedB=structuredClone(original);appliedB.implicitSourcePalette={colors:paletteB};appliedB.equations.f='x^2+y^2-z^2-.5';appliedB.settings.scaleX=45;appliedB.settings.transparentBackground=true;appliedB.settings.showGrid=true;appliedB.settings.showAxes=true;appliedB.settings.background='#FF443322';appliedB.sourceCamera.configuration.theta=.3;appliedB.timeline.tracks[0].duration=2;const originalSnapshot=structuredClone(original),authorSnapshot=structuredClone(appliedB);
    const opaqueC=paletteC.map(color=>'#ff'+color.slice(-6));
    const withHot=(scene,colors)=>({...structuredClone(scene),implicitSourcePalette:{colors}});
    const initialContext={time:0,width:192,height:144,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(original,192,144,'primary',144)};
    let author=original,context={...initialContext,implicitControls:{sessionId:'implicit-palette-main',acknowledgedRevision:0,commands:[]}},revision=0,latest;
    const g=new Generator(),generators=[g],referenceRenderers=[];
    const geometryFields=output=>({positions:output.positions,indices:output.indices,normals:output.sourceImplicitMesh?.normals,fill:output.sourceImplicitPresentation?.fillColors,
     'wire-positions':output.sourceImplicitPresentation?.wire?.positions,'wire-colors':output.sourceImplicitPresentation?.wire?.colors,'wire-alpha':output.sourceImplicitPresentation?.wire?.alphas});
    async function digestGeometry(output){const fields=geometryFields(output),digests={};for(const[key,value]of Object.entries(fields))digests[key]=value?{type:value.constructor.name,length:value.length,bytes:value.byteLength,sha256:await hash(bytes(value))}:null;return digests;}
    function response(after,operation){const row=audit.rows.findLast(row=>row.sequence>after&&row.operation===operation&&!row.error);check(!!row,operation+': actual Worker response observed');return row;}
    async function compare(label,actual,expectedScene,expectedContext){
     check(actual?.type==='geometry'&&!!actual.sourceImplicitPresentation,label+': real source CPU geometry');
     const referenceContext={...expectedContext,time:actual.sourceCameraFrame?.sceneTime??actual.sourceCameraFrame?.time??expectedContext.time,sourceViewport:actual.sourceCameraFrame.viewport};delete referenceContext.implicitControls;delete referenceContext.implicitLive;
     const reference=generateScene(expectedScene,referenceContext),a=geometryFields(actual),b=geometryFields(reference),summary={label,actual:await digestGeometry(actual),expected:await digestGeometry(reference),controls:structuredClone(actual.implicitControls),frame:structuredClone(actual.sourceCameraFrame),implicit:structuredClone(actual.implicit),recording:structuredClone(actual.implicitRecording),parameters:structuredClone(actual.sourceImplicitParameters),display:structuredClone(actual.sourceImplicitPresentation.display),background:actual.sourceBackgroundColor};
     result.rows.push(summary);
     for(const key of Object.keys(a)){
      const av=a[key],bv=b[key];check(!!av===!!bv,label+': '+key+' presence');if(!av)continue;
      const aa=bytes(av),bb=bytes(bv);let different=0,first=-1;for(let i=0;i<Math.max(aa.length,bb.length);i++)if(aa[i]!==bb[i]){different++;if(first<0)first=i;}
      if(different||av.constructor.name!==bv.constructor.name){summary.mismatch={key,differentBytes:different,firstByte:first};const safe=label.toLowerCase().replace(/[^a-z0-9]+/g,'-');for(const[side,array]of [['actual',aa],['expected',bb]])await fetch('/implicit-control-artifact/'+safe+'-'+key+'.'+side+'.bin',{method:'POST',body:array});}
      check(!different&&av.constructor.name===bv.constructor.name,label+': complete '+key+' bytes equal control-free reference');
     }
     check(actual.positions.length>0&&actual.sourceImplicitPresentation.fillColors.length===actual.positions.length/3*4,label+': nonempty geometry has complete fill RGBA');
     check(same(actual.sourceCameraFrame.camera,reference.sourceCameraFrame.camera),label+': effective camera matches intended cold scene');
     check(same(actual.sourceImplicitPresentation.display,reference.sourceImplicitPresentation.display)&&actual.sourceBackgroundColor===reference.sourceBackgroundColor,label+': delivered background transparency, grid and axes match intended cold scene');
     return {summary,reference};
    }
    async function compareRaster(label,actual,reference,renderer){
     const expected=await renderer.render(reference,()=>false),a=actual.pixels,b=expected.pixels;let different=0,first=-1;
     for(let i=0;i<Math.max(a.length,b.length);i++)if(a[i]!==b[i]){different++;if(first<0)first=i;}
     const summary={label,width:actual.width,height:actual.height,actualSha256:await hash(a),expectedSha256:await hash(b),differentBytes:different,firstByte:first};result.rasters.push(summary);
     if(different){const safe=label.toLowerCase().replace(/[^a-z0-9]+/g,'-');for(const[side,pixels]of [['actual',a],['expected',b]])await fetch('/implicit-control-artifact/'+safe+'-rgba.'+side+'.bin',{method:'POST',body:pixels});}
     check(actual.width===expected.width&&actual.height===expected.height&&!different,label+': complete actual recording RGBA equals separately generated cold WebGL frame');
    }
    function receipt(output){const r=output.implicitControls;check(r?.sessionId===context.implicitControls.sessionId&&Number.isSafeInteger(r.revision)&&Number.isSafeInteger(r.applyRevision)&&Number.isSafeInteger(r.resetRevision),'Actual Implicit receipt has exact session and integer revisions');return r;}
    function acknowledge(output){const r=receipt(output);revision=r.revision;context={...context,implicitControls:{sessionId:r.sessionId,acknowledgedRevision:revision,commands:[]}};}
    async function generate(label,commands,expected){if(commands.some(command=>command.kind==='apply'||command.kind==='restart')){context={...context,time:0};delete context.implicitLive;}const request={...context,implicitControls:{...context.implicitControls,acknowledgedRevision:revision,commands}},mark=audit.sequence;const output=await g.generate(author,request),wire=response(mark,'generate');check(wire.geometry.length===1,label+': exactly one actual Worker geometry');await compare(label,wire.geometry[0].output,expected,request);check(same(output.implicitControls,wire.geometry[0].output.implicitControls),label+': client preserves Worker receipt');context=request;acknowledge(output);latest=output;return output;}
    async function record(label,expectedCold){
     const referenceRenderer=new GeometryRecordingRenderer(expectedCold,sourceRecordingSize({width:64,height:48},1));referenceRenderers.push(referenceRenderer);
     const before=receipt(latest),mark=audit.sequence,start=await g.beginSourceRecording(latest,{width:64,height:48,simulationFps:4,actualFrameRate:20}),begin=response(mark,'source-recording-begin'),warmup=begin.geometry.find(g=>g.role==='warmup')?.output;
     check(same(start.scene,author)&&same(begin.result.scene,author),label+': begin preserves staged author');
     const r=receipt(warmup);check(r.revision===before.revision&&r.applyRevision===before.applyRevision&&r.resetRevision===before.resetRevision+1,label+': recording resets cold state exactly once');
     check(same(start.context.implicitControls,{sessionId:r.sessionId,acknowledgedRevision:r.revision,commands:[]}),label+': start normalizes acknowledged commands');
     const expectedLayout=resolveOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(expectedCold),expectedCold.timeline.tracks,4,{particleActions:'implicit'});
     check(start.clock.updates===Math.max(1,expectedLayout.updates),label+': queue length comes from cold timeline');
     const warmupReference=await compare(label+' warmup',warmup,expectedCold,start.context);check(start.warmup.type==='raster'&&start.warmup.width===192&&start.warmup.height===144,label+': public lease returns actual recording raster');
     check(same(start.warmup.implicitControls,r),label+': public raster retains actual warmup control receipt');await compareRaster(label+' warmup',start.warmup,warmupReference.reference,referenceRenderer);
     let last=warmup;for(let frame=1;frame<=start.clock.lastDisplayFrame;frame++){
      const at=audit.sequence,raster=await g.nextSourceRecordingFrame(start.handle,frame,20),event=response(at,'source-recording-frame'),actual=event.geometry[0]?.output;
      check(same(actual.implicitControls,r),label+': frame '+frame+' retains recording receipt');const frameReference=await compare(label+' frame '+frame,actual,expectedCold,start.context);check(raster.type==='raster'&&raster.pixels.length===192*144*4,label+': frame '+frame+' public pixels delivered');check(same(raster.implicitControls,r),label+': frame '+frame+' public raster preserves actual receipt');await compareRaster(label+' frame '+frame,raster,frameReference.reference,referenceRenderer);last=actual;
     }
     const stopAt=audit.sequence,stop=await g.finishSourceRecording(start.handle,1000),event=response(stopAt,'source-recording-finish'),preview=event.geometry.find(g=>g.role==='preview')?.output;
     check(same(stop.scene,author)&&same(event.result.scene,author),label+': finish preserves staged author');check(same(preview.implicitControls,r),label+': finish does not reset twice');
     const {viewport:_,...lastFrame}=last.sourceCameraFrame,{viewport:__,...stopFrame}=preview.sourceCameraFrame;check(same(lastFrame,stopFrame),label+': finish does not advance numerical frame');await compare(label+' finish',preview,expectedCold,stop.context);
     check(same(stop.context.implicitControls,{sessionId:r.sessionId,acknowledgedRevision:r.revision,commands:[]}),label+': stop normalizes acknowledged commands');check(!g.hasSourceRecording(start.handle),label+': recording capability released');
     referenceRenderer.dispose();
     context=structuredClone(stop.context);latest=stop.preview;acknowledge(latest);await g.setImplicitPaused(latest,true,1001);context={...context,implicitLive:{...context.implicitLive,clock:{paused:true,timestampMs:1001}}};
     return generate(label+' paused continuation',[],expectedCold);
    }
    async function rejected(label,request){
     const beforeWorkers=audit.workerSequence,before=receipt(latest),prior=latest,mark=audit.sequence,requestsBefore=audit.requests.length;let error;try{await g.generate(author,request);}catch(e){error={name:e.name,message:e.message,previewRetained:e.previewRetained};}
     check(!!error,label+': invalid request rejects');check(error.name==='ImplicitControlGenerationError'&&error.previewRetained===true,label+': public error explicitly confirms old preview retained');check(audit.workerSequence===beforeWorkers,label+': no replacement Worker constructed');const response=audit.rows.findLast(row=>row.sequence>mark&&row.operation==='generate'&&row.error);result.faults.push({label,error,before,transportRequests:audit.requests.length-requestsBefore,workerResponse:response&&{error:response.error,retainedSourceId:response.retainedSourceId}});latest=prior;return error;
    }
    try{
     await generate('cold Apply A',[{revision:1,kind:'apply',scene:original}],original);const initial=await digestGeometry(latest),coldReceipt=receipt(latest);
     author=appliedB;await generate('staged author B without command',[],original);check(same(await digestGeometry(latest),initial),'Staged palette, formula, transform, camera and timeline do not change actual geometry');
     const hotExpected=withHot(original,opaqueC);await generate('hot C',[{revision:2,kind:'palette',colors:paletteC}],hotExpected);const hot=await digestGeometry(latest);check(!same(hot.fill,initial.fill),'Hot C changes actual fill colors');check(same(hot.positions,initial.positions)&&receipt(latest).resetRevision===coldReceipt.resetRevision,'Hot C preserves shape and reset identity');
     const alpha=latest.sourceImplicitPresentation.fillColors;check(Array.from({length:alpha.length/4},(_,i)=>alpha[i*4+3]).every(v=>v===Math.fround(Math.trunc(Math.fround(Math.fround(1)*Math.fround(.7))*255)/255)),'Hot colors use opaque source alpha before mesh fill opacity');
     await generate('empty hot command',[{revision:3,kind:'palette',colors:[]}],hotExpected);check(same(await digestGeometry(latest),hot),'Empty hot list preserves exact current geometry colors');
     await generate('fresh same-value C',[{revision:4,kind:'palette',colors:paletteC}],hotExpected);check(receipt(latest).revision===4&&receipt(latest).resetRevision===coldReceipt.resetRevision,'Same-value palette action acknowledges a new revision without reset');
     await rejected('revision gap',{...context,implicitControls:{...context.implicitControls,commands:[{revision:6,kind:'palette',colors:paletteC}]}});
     await rejected('future acknowledgement',{...context,implicitControls:{...context.implicitControls,acknowledgedRevision:5,commands:[]}});
     const invalidApply=structuredClone(appliedB);invalidApply.equations.f='sin(';await rejected('invalid equation Apply',{...context,time:0,implicitControls:{...context.implicitControls,commands:[{revision:5,kind:'apply',scene:invalidApply}]}});check(result.faults.at(-1).transportRequests===1&&Number.isSafeInteger(result.faults.at(-1).workerResponse?.retainedSourceId),'Invalid equation reaches the actual Worker and preserves its completed source identity');
     await record('record cold A',original);check(same((await digestGeometry(latest)).fill,initial.fill),'Record handoff restores cold ARGB fill instead of hot opaque colors');
     const stopped=receipt(latest);await generate('fresh C after record',[{revision:5,kind:'palette',colors:paletteC}],hotExpected);check(receipt(latest).resetRevision===stopped.resetRevision&&same((await digestGeometry(latest)).fill,hot.fill),'Fresh same-value C is effective after recording reset');
     await generate('explicit restart A',[{revision:6,kind:'restart'}],original);check(receipt(latest).resetRevision===stopped.resetRevision+1&&receipt(latest).applyRevision===1,'Restart uses last full Apply and increments one reset');
     await generate('full Apply B',[{revision:7,kind:'apply',scene:appliedB}],appliedB);const fullB=await digestGeometry(latest),bReceipt=receipt(latest);check(bReceipt.applyRevision===7&&!same(fullB.positions,initial.positions),'Apply commits staged shape and palette');
     await generate('same-value Apply B',[{revision:8,kind:'apply',scene:appliedB}],appliedB);check(receipt(latest).resetRevision===bReceipt.resetRevision+1&&same(await digestGeometry(latest),fullB),'Same-value full Apply resets once without geometry drift');
     await record('record applied B',appliedB);check(same((await digestGeometry(latest)).fill,fullB.fill),'Recording now uses applied B alpha and colors');
     const captureAt=audit.sequence,priorFrame=structuredClone(latest.sourceCameraFrame),pair=await g.captureImplicitPaused(latest,{width:192,height:144},1),capture=response(captureAt,'implicit-paused-capture');
     for(const role of ['capture','preview']){const output=capture.geometry.find(g=>g.role===role)?.output;await compare('paused capture '+role,output,appliedB,context);const{viewport:_,...a}=output.sourceCameraFrame,{viewport:__,...b}=priorFrame;check(same(a,b),'Paused '+role+' geometry retains actual numerical frame');}
     check(pair.capture.type==='raster'&&pair.capture.pixels.length===192*144*4,'Public paused capture delivers bounded actual raster');check(same(pair.capture.implicitControls,latest.implicitControls)&&same(pair.preview.implicitControls,latest.implicitControls),'Public paused capture raster and preview retain exact acknowledged control receipt');latest=pair.preview;
     check(same(original,originalSnapshot)&&same(author,authorSnapshot)&&same(author.implicitSourcePalette.colors,paletteB),'Caller cold A and staged author raw B remain unchanged throughout commands and recording');
     // A separate owner proves cancellation/loss cannot silently reconstruct a
     // stale acknowledged session; no preserved-preview claim is made here.
     const cancelled=new Generator();generators.push(cancelled);const lossContext={...initialContext,implicitControls:{sessionId:'implicit-cancelled',acknowledgedRevision:0,commands:[{revision:1,kind:'apply',scene:original}]}};
     await cancelled.generate(original,lossContext);const pending=cancelled.generate(original,{...initialContext,implicitControls:{sessionId:'implicit-cancelled',acknowledgedRevision:1,commands:[{revision:2,kind:'palette',colors:paletteC}]}}).then(()=>({resolved:true}),error=>({error:String(error)}));cancelled.cancel();const cancellation=await pending;check(!!cancellation.error,'In-flight cancellation rejects actual public generation');
     let staleError;try{await cancelled.generate(original,{...initialContext,implicitControls:{sessionId:'implicit-cancelled',acknowledgedRevision:1,commands:[]}});}catch(error){staleError=String(error);}check(!!staleError,'Lost Worker rejects acknowledged-only context instead of reconstructing author');
     const recovered=await cancelled.generate(original,{...initialContext,implicitControls:{sessionId:'implicit-reapplied',acknowledgedRevision:0,commands:[{revision:1,kind:'apply',scene:original}]}});await compare('explicit Apply after cancellation',recovered,original,initialContext);result.cancellation={cancellation,staleError};cancelled.dispose();
     g.dispose();
     // Sequential equivalent cold/warm workload; no other browser work runs.
     for(const controlled of [false,true]){
      const benchmark=new Generator();generators.push(benchmark);const mode=controlled?'controls':'legacy',costContext={...initialContext,...(controlled?{implicitControls:{sessionId:'implicit-cost',acknowledgedRevision:0,commands:[{revision:1,kind:'apply',scene:original}]}}:{})};
      const start=performance.now(),cold=await benchmark.generate(original,costContext),coldMs=performance.now()-start,digests=[await digestGeometry(cold)];if(controlled)costContext.implicitControls={sessionId:'implicit-cost',acknowledgedRevision:1,commands:[]};
      const warm=performance.now();for(let i=0;i<8;i++)digests.push(await digestGeometry(await benchmark.generate(original,costContext)));const warmMs=performance.now()-warm;
      result.cost.push({mode,coldMs,warmMs,warmFrames:8,digests});benchmark.dispose();
     }
     check(same(result.cost[0].digests,result.cost[1].digests),'Legacy/control cost workload has identical complete geometry byte digests for every frame');
     check(sourceDrawingCleanupCount()===0,'No retired drawing resources remain after raster comparisons');result.observer={workers:audit.workerSequence,terminated:audit.terminated,retainedBytes:audit.retainedBytes,responses:audit.rows.length};return result;
    }finally{for(const owner of generators)owner.dispose();for(const renderer of referenceRenderers)renderer.dispose();}
   },{fixture,paletteB,paletteC});
  }catch(error){failure=error;report.result=await page.evaluate(()=>window.__implicitControlResult).catch(()=>undefined);}
  return{elapsedMs:performance.now()-begin,costScope:'Finite public Worker workflow and sequential equivalent cold/warm comparison; warm browser/Vite'};
 });
 if(failure)throw failure;assert.deepEqual(report.pageErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page)report.lastWire=await page.evaluate(()=>{const a=window.__implicitControlWire;return a.rows.slice(-4).map(({geometry,...row})=>({...row,geometry:geometry.map(({role,output})=>({role,controls:output.implicitControls,frame:output.sourceCameraFrame,recording:output.implicitRecording}))}));}).catch(()=>undefined);}
finally{
 report.cleanup=[];for(const [resource,close]of [['context',()=>context?.close()],['browser',()=>browser?.close()],['vite',()=>server?.close()]])try{await close();report.cleanup.push({resource,status:'fulfilled'});}catch(error){report.cleanup.push({resource,status:'rejected',error:String(error)});}
 report.remainingWorkers=workers.size;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||report.remainingWorkers||report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 report.checks=report.result?.checks??[];report.rows=report.result?.rows??[];
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');const cost=report.measurements?.processFamily;
 await writeFile(out+'/README.md',`# Implicit 色板控制后端验收\n\n状态：${report.status}；${report.checks.length} 项检查；总耗时 ${(report.elapsedMs/1000).toFixed(3)} 秒。\n\n${cost?`采样 CPU ${(cost.observedCpuMs/1000).toFixed(3)} 秒；峰 RSS ${cost.sampledPeakRssKiB} KiB；采样错误 ${cost.samplingErrors.length}。\n\n`:''}源文件${report.sourceStable?'稳定':'发生变化'}，剩余观测 Worker ${report.remainingWorkers}。\n\n${report.error?`\`\`\`\n${report.error}\n\`\`\`\n\n`:''}${report.limits.map(v=>'- '+v).join('\n')}\n\n实际 Worker 几何、完整字段 SHA、控制回执、录制重置、成本与清理记录见 report.json。\n`);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,rows:report.rows.length,error:report.error,elapsedMs:report.elapsedMs,sourceStable:report.sourceStable,directory:out}));
}
