/** Public Implicit palette UI, real CPU geometry, native rendering and PNG.
 * Observers retain facts after production work; they never replace scene math,
 * responses, clocks, palette generation or delivered pixels. Owned headless only. */
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {relative,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {verifyRecordingVideo} from './lib/verify-recording-video.mjs';
import {measureFamily} from './browser-process-cost.mjs';

const script='scripts/verify-implicit-gradient-palette.mjs';
const out=process.argv[2]??`.cache/implicit-gradient-app-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^implicit-gradient-app-[^/]+$/,'Use a new .cache/implicit-gradient-app-* directory');
await mkdir('.cache',{recursive:true});await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const backendPath=process.env.MATHART_SOURCE_RENDERER_BACKEND;
assert.ok(backendPath,'Set MATHART_SOURCE_RENDERER_BACKEND to an existing built native backend.json');
const backend=JSON.parse(await readFile(backendPath,'utf8'));
const colors=['#80123456','#FFdd5522','#00AAff','#204060A0',...Array.from({length:28},(_,i)=>'#'+(0x203040+i*290321).toString(16).padStart(6,'0'))];
colors[15]='#40336699';colors[31]='#80aBcDeF';
const ramp=[{x:0,y:0},{x:1,y:1}];
const input={config_version:'1.0.0',type:'IMPLICIT',name:'Implicit raw palette and generators',
 equation:{f:'x^2+y^2-z^2-1'},palette:colors,
 settings:{x_segments:8,y_segments:8,z_segments:8,x_min:-2,x_max:2,y_min:-2,y_max:2,z_min:-2,z_max:2,
  scale_x:60,scale_y:60,scale_z:60,offset_x:0,offset_y:0,offset_z:0,mesh_mode:'CPU',render_mode:'WIREFRAME',
  mesh_fill:true,mesh_fill_opacity:.7,line_weight:.8,dot_size:1.2,background_color:'#000000'},
 camera:{phi:'PI/2',theta:'0',gamma:'0'},main_equation:{enabled:false},parameters:{},timeline:[{type:'wait',duration:.5}],
 color:{use_cosine_palette:true,use_curve_palette:true,cosine_a:[.35,.45,.55],cosine_b:[.4,.3,.2],cosine_c:[1,1,1],cosine_d:[0,.1,.2],curve_red:ramp,curve_green:ramp,curve_blue:ramp}};
const report={status:'running',at:new Date().toISOString(),directory:out,nodeVersion:process.version,nodeExecutable:process.execPath,nativeBackend:{path:backendPath,configuration:backend},
 scope:'Actual App Implicit palette controls, ProjectState import, explicit cold/current owner, native display, recording reset, two real MP4 deliveries and paused PNG enhancement. Only owned headless Chrome and the existing local native renderer; no original application/JVM execution.',
 limits:['One 8×8×8 static CPU mesh/slice main fixture with 32 raw colors; separate empty/single raw palette cases. GPU/particle modes and general formula space are not covered.',
  'The local control-free generation path and existing native renderer provide expected geometry/pixels; this is not an independent math implementation or original-application parity claim.',
  'Paused PNG compares native base pixels to actual enhancement Worker input and its completed Blob to downloaded PNG, not enhanced pixels to unprocessed pixels.',
  'Two finite recordings compare every uploaded PNG to actual native frame RGBA after the required opaque-alpha video conversion, then every decoded MP4 RGB channel to separate raw-input FFmpeg encoding.',
  'CPU/RSS include passive observers, Chrome, Vite, native service and FFmpeg. No equivalent before/after timing or token/GPU-VRAM measurement.'],
 checks:[],steps:[],pageErrors:[]};
const check=(condition,label)=>{assert.ok(condition,label);report.checks.push(label);};
async function hashes(){
 const paths=[];for(const root of ['src','server'])for(const path of await readdir(root,{recursive:true}))if(/\.(ts|tsx|json|css|mjs|m|h)$/.test(path))paths.push(root+'/'+path);
 paths.push(script,'scripts/lib/verify-png.mjs','scripts/lib/verify-recording-video.mjs','scripts/browser-process-cost.mjs','desktop/graphics.mjs','package.json','package-lock.json',backendPath,backend.executablePath,...(process.env.MATHART_NATIVE_BUILD_MANIFEST?[process.env.MATHART_NATIVE_BUILD_MANIFEST]:[]));
 return Object.fromEntries(await Promise.all(paths.sort().map(async path=>[path,sha(await readFile(path))])));
}
await writeFile(out+'/verifier.mjs',await readFile(script));await writeFile(out+'/input.json',JSON.stringify(input,null,2)+'\n');report.sourceBefore=await hashes();
let browser,server,service,context,page,activeVideo,phase='setup';const started=performance.now(),workers=new Set();

function installAudit(){
 const a=window.__implicitGradient={sequence:0,presentationSequence:0,workerSequence:0,calls:[],renders:[],presentations:[],wire:[],pngJobs:[],hashes:[],terminated:[],imageEncodes:[],pixelReads:[],recordings:[],captures:[],pauses:[],frames:[],frameBytes:0,geometries:[],geometryBytes:0,lastAuthor:null,owners:new WeakMap(),activeImage:null,
  sha:async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')};
 a.hash=(bytes,owner,key)=>{const copy=new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength).slice();a.hashes.push(a.sha(copy).then(hash=>{owner[key]=hash;}));};
 a.meta=output=>{
  const row={type:output.type,backend:output.backend,implicit:structuredClone(output.implicit),sourceCameraFrame:structuredClone(output.sourceCameraFrame),sourceImplicitParameters:structuredClone(output.sourceImplicitParameters),formulaPresentation:structuredClone(output.formulaPresentation),sourcePixelRenderer:structuredClone(output.sourcePixelRenderer),implicitControls:structuredClone(output.implicitControls),implicitLive:structuredClone(output.implicitLive),implicitRecording:structuredClone(output.implicitRecording),sourceBackgroundColor:output.sourceBackgroundColor};
  for(const key of ['positions','indices','pixels'])if(output[key])a.hash(output[key],row,key+'Sha256');
  if(output.sourceImplicitMesh?.normals)a.hash(output.sourceImplicitMesh.normals,row,'normalsSha256');
  if(output.sourceImplicitPresentation){const p=output.sourceImplicitPresentation;row.presentation={model:p.model,fill:p.fill,lineWeight:p.lineWeight,referencePixelDensity:p.referencePixelDensity,fillValues:p.fillColors.length,display:structuredClone(p.display)};a.hash(p.fillColors,row.presentation,'fillSha256');if(p.wire){row.presentation.wireValues=p.wire.colors.length;row.presentation.wireSamples=p.wire.samples;a.hash(p.wire.positions,row.presentation,'wirePositionSha256');a.hash(p.wire.colors,row.presentation,'wireColorSha256');a.hash(p.wire.alphas,row.presentation,'wireAlphaSha256');}}
  return row;
 };
 a.canvas=canvas=>{
  const gl=canvas.getContext('webgl2');if(!gl||gl.isContextLost())throw Error('Actual native canvas WebGL2 unavailable');const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const first=(pixels[0]<<16)|(pixels[1]<<8)|pixels[2];let nonuniformPixels=0;for(let i=0;i<pixels.length;i+=4)if(((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2])!==first)nonuniformPixels++;
  const row={width:canvas.width,height:canvas.height,nonuniformPixels};a.hash(pixels,row,'rgbaSha256');return row;
 };
 const Native=window.Worker;
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.auditId=++a.workerSequence;this.addEventListener('message',({data})=>{
   if(data?.operation==='encode-source-paused-png'){const job=a.pngJobs.find(j=>j.worker===this.auditId);if(job&&data.result?.blob){job.width=data.result.width;job.height=data.result.height;a.hashes.push(data.result.blob.arrayBuffer().then(bytes=>a.sha(bytes)).then(hash=>{job.pngSha256=hash;}));}else if(job)job.error=data.error;}
   if(data?.status||data?.error)return;
   for(const [role,output] of [['output',data?.output],['warmup',data?.result?.warmup],['preview',data?.result?.preview],['capture',data?.result?.capture]])if(output?.type==='geometry'&&output.sourceImplicitPresentation){
    const p=output.sourceImplicitPresentation,bytes=[output.positions,output.indices,output.sourceImplicitMesh?.normals,p.fillColors,p.wire?.positions,p.wire?.colors,p.wire?.alphas].filter(Boolean).reduce((n,x)=>n+x.byteLength,0);
    if(a.geometryBytes+bytes>64*1024**2||a.geometries.length>=256)throw Error('Bounded geometry observer exceeded');a.geometryBytes+=bytes;a.geometries.push({sequence:++a.sequence,operation:data.operation,role,output:structuredClone(output)});
   }
  });}
  postMessage(message,...args){
   if(message?.operation==='generate'&&message.scene?.kind==='implicit')a.wire.push({id:message.id,name:message.scene.name,hasEditor:Object.hasOwn(message.scene,'implicitPaletteEditor'),hasCommandEditor:message.context?.implicitControls?.commands.some(c=>c.kind==='apply'&&Object.hasOwn(c.scene,'implicitPaletteEditor'))??false,palette:structuredClone(message.scene.implicitSourcePalette),legacyStops:structuredClone(message.scene.palette.stops),context:structuredClone(message.context)});
   if(message?.operation==='encode-source-paused-png'){const job={worker:this.auditId,image:a.activeImage?.id,capture:a.captures.at(-1)?.sequence,baseWidth:message.width,baseHeight:message.height,scale:message.scale};a.pngJobs.push(job);a.hash(message.pixels,job,'inputRgbaSha256');}
   return super.postMessage(message,...args);
  }
  terminate(){a.terminated.push(this.auditId);return super.terminate();}
 };
}
const generatorObserver=`
if(typeof window!=='undefined'){const a=window.__implicitGradient,native=Generator.prototype.generate;
 Generator.prototype.generate=async function(scene,input,...args){const row={sequence:++a.sequence,scene:structuredClone(scene),input:structuredClone(input)};a.calls.push(row);a.lastAuthor=row.scene;try{const output=await native.call(this,scene,input,...args);row.output=a.meta(output);a.owners.set(output,{sequence:row.sequence});return output;}catch(error){row.error=String(error);row.previewRetained=error.previewRetained;throw error;}};
 for(const method of ['beginSourceRecording','finishSourceRecording']){const original=Generator.prototype[method];Generator.prototype[method]=async function(...args){const row={sequence:++a.sequence,method};a.recordings.push(row);try{const result=await original.apply(this,args);row.scene=structuredClone(result.scene);row.context=structuredClone(result.context);row.clock=structuredClone(result.clock);const output=result.warmup??result.preview;row.output=a.meta(output);if(result.warmup){a.frameBytes+=output.pixels.byteLength;if(a.frameBytes>96*1024**2)throw Error('Bounded recording observer exceeded');a.frames.push({sequence:row.sequence,warmup:true,output:structuredClone(output)});}a.owners.set(output,{sequence:row.sequence});row.completed=true;return result;}catch(error){row.error=String(error);throw error;}};}
 const next=Generator.prototype.nextSourceRecordingFrame;Generator.prototype.nextSourceRecordingFrame=async function(...args){const result=await next.apply(this,args),row={sequence:++a.sequence,method:'nextSourceRecordingFrame',output:a.meta(result)};a.recordings.push(row);if(a.frames.length>=128||a.frameBytes+result.pixels.byteLength>96*1024**2)throw Error('Bounded recording frame observer exceeded');a.frameBytes+=result.pixels.byteLength;a.frames.push({sequence:row.sequence,output:structuredClone(result)});return result;};
 const pause=Generator.prototype.setImplicitPaused;Generator.prototype.setImplicitPaused=async function(output,paused,...args){const row={sequence:++a.sequence,paused};a.pauses.push(row);const result=await pause.call(this,output,paused,...args);row.completed=true;return result;};
 const capture=Generator.prototype.captureImplicitPaused;Generator.prototype.captureImplicitPaused=async function(...args){const result=await capture.apply(this,args),row={sequence:++a.sequence,capture:a.meta(result.capture),output:a.meta(result.preview)};a.captures.push(row);a.owners.set(result.preview,{sequence:row.sequence});return result;};
}
`;
const rendererObserver=`
if(typeof window!=='undefined'){const native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=native.call(this,output,scene,...args),a=window.__implicitGradient,owner=a.owners.get(output);if(owner)a.renders.push({owner,sceneId:scene.id,output:a.meta(output)});return result;};}
`;
const nativeObserver=`
if(typeof window!=='undefined'){const native=SourceNativeViewport.prototype.submit;SourceNativeViewport.prototype.submit=function(request){const a=window.__implicitGradient,row={sequence:++a.presentationSequence};a.presentations.push(row);return native.call(this,{...request,prepare:(...args)=>{const result=request.prepare(...args);row.owner=a.renders.at(-1)?.owner;if(result.frame)row.frame={width:result.frame.width,height:result.frame.height,samples:result.frame.samples};return result;},ready:()=>{request.ready();row.ready=true;row.canvas=a.canvas(this.canvas);},failed:error=>{row.error=String(error);request.failed(error);}});};}
`;
const pixelsObserver=`
if(typeof window!=='undefined'){const native=readSourceDrawingPixels;readSourceDrawingPixels=async function(...args){const result=await native(...args),a=window.__implicitGradient,row={image:a.activeImage?.id,width:args[1],height:args[2],sourcePixelRenderer:structuredClone(result.sourcePixelRenderer)};a.pixelReads.push(row);a.hash(result.pixels,row,'rgbaSha256');return result;};}
`;
const imageObserver=`
if(typeof window!=='undefined'){const native=encodeSourceGeometryImage;encodeSourceGeometryImage=async function(renderer,scene,output,options){const a=window.__implicitGradient,row={id:a.imageEncodes.length+1,owner:a.owners.get(output),purpose:options.purpose,output:a.meta(output)};a.imageEncodes.push(row);a.activeImage=row;try{const result=await native(renderer,scene,output,options);a.hashes.push(result.arrayBuffer().then(bytes=>a.sha(bytes)).then(hash=>{row.pngSha256=hash;}));row.completed=true;return result;}catch(error){row.error=String(error);throw error;}finally{a.activeImage=null;}};}
`;
let activeName=input.name;
const button=name=>page.getByRole('button',{name,exact:true});
const editor=()=>page.getByTestId('source-implicit-palette');
const mode=()=>editor().getByRole('combobox',{name:'Source palette generation mode',exact:true});
const field=key=>editor().getByTestId('source-bouncing-generator-'+key);
const palette=state=>state.scene.implicitSourcePalette;
const editorState=state=>state.scene.implicitPaletteEditor;
const sequence=()=>page.evaluate(()=>window.__implicitGradient.sequence);
async function ready(after=-1){
 await page.waitForFunction(({after,name})=>{const a=window.__implicitGradient,c=a.calls.findLast(c=>c.scene.kind==='implicit'&&c.input.sourceViewport?.target==='primary');return c?.sequence>after&&c.scene.name===name&&c.output?.presentation?.fillSha256&&c.output.positionsSha256&&a.presentations.some(p=>p.owner?.sequence===c.sequence&&p.ready&&p.canvas?.rgbaSha256)&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},{after,name:activeName});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return page.evaluate(()=>{const a=window.__implicitGradient,c=a.calls.findLast(c=>c.scene.kind==='implicit'&&c.input.sourceViewport?.target==='primary');return{...c,presented:a.presentations.findLast(p=>p.owner?.sequence===c.sequence&&p.ready)};});
}
function sameGeometry(before,after,label){
 for(const key of ['positionsSha256','indicesSha256'])check(before.output[key]===after.output[key],label+': unchanged '+key);
 check(before.output.presentation.wirePositionSha256===after.output.presentation.wirePositionSha256,label+': unchanged source slice positions');
 assert.deepEqual(before.output.sourceCameraFrame,after.output.sourceCameraFrame);check(true,label+': camera and time remain unchanged');
 check(after.presented.canvas.nonuniformPixels>0,label+': real native canvas contains visible artwork');
}
async function edit(before,action,label,{changed=false}={}){
 phase=label;const mark=await sequence();await action();const after=await ready(mark);sameGeometry(before,after,label);
 if(changed){check(before.output.presentation.fillSha256!==after.output.presentation.fillSha256,label+': actual mesh fill colors change');check(before.presented.canvas.rgbaSha256!==after.presented.canvas.rgbaSha256,label+': actual native canvas pixels change');}
 return after;
}
async function commit(key,value){await field(key).fill(String(value));await field(key).press('Enter');}
async function tabs(before,label){
 phase=label;const calls=await page.evaluate(()=>window.__implicitGradient.calls.length),original=before.presented.canvas.rgbaSha256;
 await button('Geometry & parameters').click();await button('Appearance').click();await mode().waitFor();await page.waitForTimeout(200);
 check(await page.evaluate(n=>window.__implicitGradient.calls.length===n,calls),label+': tab mount performs no generation');const after=await ready();
 assert.deepEqual(palette(after),palette(before));check(after.presented.canvas.rgbaSha256===original,label+': tab mount preserves actual pixels');return after;
}
async function downloadProject(name){const download=page.waitForEvent('download');await page.getByTitle('Export project JSON',{exact:true}).click();const path=out+'/'+name+'.json';await(await download).saveAs(path);return{path,value:JSON.parse(await readFile(path,'utf8'))};}
async function png(name,state){
 phase=name+':paused PNG';await button('Export artwork').click();await button('Still image').click();
 await page.getByRole('combobox',{name:'Implicit surface image source',exact:true}).selectOption('current');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('256');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('192');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
 const before=await sequence(),download=page.waitForEvent('download',{timeout:60000});await button('Start export').click();const path=out+'/'+name+'.png';await(await download).saveAs(path);
 const facts=await page.evaluate(async before=>{const a=window.__implicitGradient;await Promise.all(a.hashes);const capture=a.captures.findLast(c=>c.sequence>before);return{capture,job:a.pngJobs.findLast(p=>p.capture===capture?.sequence),terminated:a.terminated,calls:a.calls.filter(c=>c.sequence>before)};},before);
 check(facts.capture?.capture.sourcePixelRenderer?.backend==='native','PNG captures actual native retained framebuffer');
 assert.deepEqual(facts.capture.capture.implicitControls,state.output.implicitControls);check(true,'PNG preserves current acknowledged control receipt');
 check(facts.calls.length===0,'Current PNG does not reconstruct the authored scene');
 check(facts.job?.inputRgbaSha256===facts.capture.capture.pixelsSha256,'Enhancement Worker receives exact actual native base RGBA');
 const bytes=await readFile(path),decoded=decodePng(bytes),distinct=new Set();for(let i=0;i<decoded.rgba.length;i+=4)distinct.add(decoded.rgba.readUInt32LE(i));
 check(decoded.width===256&&decoded.height===192&&distinct.size>8,'PNG has requested dimensions and nonuniform artwork');check(sha(bytes)===facts.job.pngSha256,'Downloaded PNG equals actual enhancement Worker Blob');check(facts.terminated.includes(facts.job.worker),'PNG enhancement Worker released');
 await button('Close export').click();return{path,pngSha256:sha(bytes),rgbaSha256:sha(decoded.rgba),width:decoded.width,height:decoded.height,distinctColors:distinct.size,...facts};
}
async function current(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.evaluate(async()=>{const a=window.__implicitGradient;await Promise.all(a.hashes);const p=a.presentations.findLast(p=>p.ready),r=a.renders.findLast(r=>r.owner.sequence===p?.owner?.sequence),call=a.calls.findLast(c=>c.output);return{scene:a.lastAuthor,input:call?.input,output:r?.output,presented:p};});}
async function pause(){if(await button('Pause').count())await button('Pause').click();await button('Play').waitFor();await page.waitForFunction(()=>{const a=window.__implicitGradient;return a.pauses.at(-1)?.paused===true&&a.pauses.at(-1)?.completed;});await page.waitForFunction(()=>!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));await page.waitForTimeout(150);}
async function fullApply(label){phase=label;const mark=await sequence();await page.getByTestId('implicit-apply').click();return ready(mark);}
async function unchangedAction(before,action,label){phase=label;const wire=await page.evaluate(()=>window.__implicitGradient.wire.length);await action();await page.waitForTimeout(200);const after=await current();sameGeometry(before,after,label);check(before.presented.canvas.rgbaSha256===after.presented.canvas.rgbaSha256,label+': no image change');const commands=await page.evaluate(n=>window.__implicitGradient.wire.slice(n).flatMap(w=>w.context?.implicitControls?.commands??[]),wire);check(commands.length===0,label+': no runtime control command');return after;}
async function record(name,author,cold){
 phase=name;activeVideo={creates:[],uploads:[],expected:[]};await page.evaluate(()=>{const a=window.__implicitGradient;a.frames=[];a.frameBytes=0;});
 await button('Record').click();await page.getByRole('dialog',{name:'Implicit surface recording',exact:true}).waitFor();for(const[label,value]of [['Export width','128'],['Export height','96'],['Export frame rate','4']])await page.getByRole('spinbutton',{name:label,exact:true}).fill(value);
 const before=await sequence(),download=page.waitForEvent('download',{timeout:90000});await button('Start recording').click();const path=out+'/'+name+'.mp4';await(await download).saveAs(path);await page.waitForFunction(n=>window.__implicitGradient.recordings.some(r=>r.sequence>n&&r.method==='finishSourceRecording'&&r.completed),before);
 const rows=await page.evaluate(async n=>{const a=window.__implicitGradient;await Promise.all(a.hashes);return a.recordings.filter(r=>r.sequence>n);},before),begin=rows.find(r=>r.method==='beginSourceRecording'),stop=rows.find(r=>r.method==='finishSourceRecording'),frames=rows.filter(r=>r.method==='nextSourceRecordingFrame');
 assert.deepEqual(clone(begin.scene),author);assert.deepEqual(clone(stop.scene),author);check(true,name+': recording keeps exact serialized author, after runtime projection');check(begin.output.sourcePixelRenderer?.backend==='native'&&frames.every(f=>f.output.sourcePixelRenderer?.backend==='native'),name+': all recording frames use actual native renderer');
 check(begin.clock.encodedFrames===frames.length&&frames.length>0&&frames.at(-1).output.implicitRecording.complete,name+': cold queue completes naturally');assert.deepEqual(stop.output.implicitControls,begin.output.implicitControls);check(true,name+': finish keeps acknowledged recording receipt');
 await button('Close export').click();await pause();
 const reference=await page.evaluate(async({before,cold})=>{
  const a=window.__implicitGradient,{generateScene}=await import('/src/engine/temporal.ts'),{GeometryRecordingRenderer}=await import('/src/engine/renderGeometryRecording.ts'),{sourceRecordingSize}=await import('/src/engine/sourceRecordingSize.ts');
  const render=new GeometryRecordingRenderer(cold,sourceRecordingSize({width:128,height:96},1)),controller=new AbortController(),geometries=a.geometries.filter(g=>g.sequence>before&&(g.operation==='source-recording-begin'&&g.role==='warmup'||g.operation==='source-recording-frame'&&g.role==='output')),raw=a.frames.filter(f=>f.sequence>before),result=[];
  const fields=o=>({positions:o.positions,indices:o.indices,normals:o.sourceImplicitMesh?.normals,fill:o.sourceImplicitPresentation.fillColors,wirePositions:o.sourceImplicitPresentation.wire?.positions,wireColors:o.sourceImplicitPresentation.wire?.colors,wireAlpha:o.sourceImplicitPresentation.wire?.alphas});
  try{for(let i=0;i<geometries.length;i++){
   const actual=geometries[i].output,frame=actual.sourceCameraFrame,viewport=frame.viewport,expected=generateScene(cold,{time:frame.sceneTime??frame.time,width:384,height:288,quality:'export',sourcePointPixelDensity:1,sourceViewport:viewport}),fa=fields(actual),fb=fields(expected),digests={};
   for(const key of Object.keys(fa)){const av=fa[key],bv=fb[key];if(!!av!==!!bv)throw Error('Recording reference field presence '+key);if(!av)continue;const aa=new Uint8Array(av.buffer,av.byteOffset,av.byteLength),bb=new Uint8Array(bv.buffer,bv.byteOffset,bv.byteLength);if(aa.length!==bb.length||aa.some((v,j)=>v!==bb[j]))throw Error('Recording complete geometry bytes differ '+key);digests[key]=await a.sha(aa);}
   if(JSON.stringify(actual.sourceImplicitPresentation.display)!==JSON.stringify(expected.sourceImplicitPresentation.display)||actual.sourceBackgroundColor!==expected.sourceBackgroundColor||JSON.stringify(frame.camera)!==JSON.stringify(expected.sourceCameraFrame.camera))throw Error('Recording effective cold presentation mismatch');
   const raster=await render.render(expected,()=>false,{signal:controller.signal,generation:10000,sequence:i+1}),pixels=raw[i]?.output.pixels;if(!pixels||pixels.length!==raster.pixels.length||pixels.some((v,j)=>v!==raster.pixels[j]))throw Error('Recording complete native cold RGBA mismatch');
   result.push({index:i,warmup:!!raw[i].warmup,geometryDigests:digests,rgbaSha256:await a.sha(pixels),controls:actual.implicitControls,frame});
   if(!raw[i].warmup){const opaque=pixels.slice();for(let j=3;j<opaque.length;j+=4)opaque[j]=255;const response=await fetch('/implicit-expected-frame/'+(i-1),{method:'POST',body:opaque});if(!response.ok)throw Error('Expected frame transfer failed');}
  }}finally{render.dispose();}return result;
 },{before,cold});
 report.recordingAttempts??=[];report.recordingAttempts.push({name,begin,stop,frames,reference,creates:activeVideo.creates,uploads:activeVideo.uploads.map(u=>({index:u.index,bytes:u.bytes.length,sha256:sha(u.bytes)})),expected:activeVideo.expected.map(bytes=>({bytes:bytes.length,sha256:sha(bytes)}))});
 check(reference.length===frames.length+1,name+': complete geometry and native RGBA match independent cold workflow for warmup and every frame');check(activeVideo.creates.length===1&&activeVideo.uploads.length===frames.length&&activeVideo.expected.length===frames.length,name+': every actual frame uploaded exactly once');
 for(let i=0;i<frames.length;i++){const upload=activeVideo.uploads[i],decoded=decodePng(upload.bytes);check(upload.index===i&&decoded.rgba.equals(activeVideo.expected[i]),name+': uploaded PNG '+i+' equals native RGBA after source video alpha rule');}
 const settings=activeVideo.creates[0],verification=verifyRecordingVideo(path,settings,activeVideo.expected,out+'/'+name+'-reference.mp4');activeVideo=undefined;
 const after=await current();return{path,sha256:sha(await readFile(path)),begin,stop,frames,reference,settings,verification,after};
}

async function run(origin){
 page=await context.newPage();page.on('worker',worker=>{workers.add(worker);worker.on('close',()=>workers.delete(worker));});page.on('pageerror',error=>report.pageErrors.push(error.message));page.setDefaultTimeout(30000);await page.addInitScript(installAudit);
 page.on('request',request=>{if(!activeVideo||request.method()!=='POST')return;const u=new URL(request.url());if(u.pathname==='/api/exports')activeVideo.creates.push(JSON.parse(request.postData()));if(u.pathname.startsWith('/api/exports/')&&u.pathname.endsWith('/frames'))activeVideo.uploads.push({index:Number(u.searchParams.get('index')),bytes:request.postDataBuffer()});});
 await page.route('**/implicit-expected-frame/*',async route=>{const index=Number(new URL(route.request().url()).pathname.split('/').at(-1));check(activeVideo&&index===activeVideo.expected.length,'Expected recording frames arrive in order');activeVideo.expected.push(route.request().postDataBuffer());await route.fulfill({status:200,body:'ok'});});
 await page.route('**/implicit-gradient-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'implicit-gradient-fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),s=createScene(definition('spirograph'));saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});});await page.goto(origin);
 phase='public project import';await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'implicit-gradient.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
 let state=await ready();report.imported=state;const coldA=(await downloadProject('original-cold-A')).value;assert.deepEqual(palette(state),{colors});check(true,'Public ProjectState import retains every raw string and the 32nd tail');
 check(editorState(state)?.useCosine===false&&editorState(state)?.useCurve===false,'Implicit project import clears both source generator flags');check(Math.abs(editorState(state).cosine.a[0]-.35)<1e-6&&editorState(state).colorCount===25,'Project import retains source coefficients and bounded editor count');
 await button('Geometry & parameters').click();state=await unchangedAction(state,()=>page.locator('#control-scaleX').fill('45'),'User stage before first Appearance');
 const mountWire=await page.evaluate(()=>window.__implicitGradient.wire.length);await button('Appearance').click();await mode().waitFor();await page.waitForTimeout(200);check(await mode().inputValue()==='manual','Imported double flags display Manual');check(await page.evaluate(n=>window.__implicitGradient.wire.slice(n).every(w=>!w.context?.implicitControls?.commands.length),mountWire),'Opening full-length Appearance alone submits no runtime command');check(state.presented.canvas.nonuniformPixels>0,'Initial native canvas contains visible artwork');const originalCanvas=state.presented.canvas.rgbaSha256;
 state=await unchangedAction(state,()=>button('Undo').click(),'Undo across first Appearance');check((await downloadProject('first-open-undo')).value.settings.scaleX===60,'First Appearance initialization does not consume user Undo');
 state=await unchangedAction(state,()=>button('Redo').click(),'Redo across first Appearance');check((await downloadProject('first-open-redo')).value.settings.scaleX===45,'First Appearance initialization does not clear user Redo');
 state=await unchangedAction(state,()=>button('Undo').click(),'Restore initial author scale');check((await downloadProject('first-open-restored')).value.settings.scaleX===60,'History leaves original author shape for palette matrix');
 const seekBefore=state,seekMark=await sequence();await page.getByRole('slider',{name:'Time position',exact:true}).evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'0.2');el.dispatchEvent(new Event('input',{bubbles:true}));});state=await ready(seekMark);
 assert.deepEqual(state.output.implicitControls,seekBefore.output.implicitControls);check(state.input.time===.2&&(state.output.sourceCameraFrame.sceneTime??state.output.sourceCameraFrame.time)>.15,'Nonzero fixed seek preserves control receipt and changes actual output time');
 await button('Geometry & parameters').click();const seekZeroMark=await sequence();await page.getByTestId('implicit-restart').click();const sought=state;state=await ready(seekZeroMark);check(state.output.implicitControls.revision===sought.output.implicitControls.revision+1&&state.output.implicitControls.resetRevision===sought.output.implicitControls.resetRevision+1&&state.input.time===0&&state.output.sourceCameraFrame.frameIndex===0&&state.output.sourceCameraFrame.sceneTime===report.imported.output.sourceCameraFrame.sceneTime,'Seek zero restarts at initial frame facts with new revision and reset');report.fixedSeek={before:seekBefore,nonzero:sought,zero:state};
 await button('Appearance').click();await mode().waitFor();
 phase='raw editor and history';await editor().getByRole('spinbutton',{name:'Source color index',exact:true}).fill('16');
 const picker=await edit(state,()=>editor().locator('input[type="color"][aria-label="Source color"]').evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#aa11dd');el.dispatchEvent(new Event('change',{bubbles:true}));}),'RGB picker target',{changed:true});
 assert.deepEqual(palette(picker).colors.filter((_,i)=>i!==15),colors.filter((_,i)=>i!==15));check(palette(picker).colors[15]==='#AA11DD','Picker writes only the target as uppercase six-digit RGB');
 state=await edit(picker,()=>editor().getByRole('textbox',{name:'Original source color',exact:true}).fill('#40aBcDeF'),'Raw text edit',{changed:true});check(palette(state).colors[15]==='#40aBcDeF','Raw editor preserves exact spelling and alpha');
 state=await edit(state,()=>button('Undo').click(),'Undo raw text');assert.deepEqual(palette(state),palette(picker));state=await edit(state,()=>button('Undo').click(),'Undo picker');assert.deepEqual(palette(state),{colors});report.steps.push({name:'raw-history',picker,restored:state});
 await button('Geometry & parameters').click();state=await unchangedAction(state,()=>page.locator('#control-scaleX').fill('45'),'Stage scale');
 const panelMark=await sequence();await page.locator('.track-labels button').first().click();state=await ready(panelMark);report.timelinePanelBaseline=state;state=await unchangedAction(state,()=>page.getByRole('spinbutton',{name:'Clip duration',exact:true}).fill('1'),'Stage timeline');
 const staged=(await downloadProject('staged-shape-timeline')).value;check(staged.settings.scaleX===45&&staged.timeline.tracks[0].duration===1,'Public project export contains staged shape and timeline');
 await button('Appearance').click();await mode().waitFor();state=await current();
 state=await edit(state,()=>mode().selectOption('cosine'),'Select Cosine',{changed:true});
 check(await field('count').inputValue()==='25'&&Math.abs(Number(await field('a-0').inputValue())-.35)<1e-6,'First Cosine uses imported coefficients and count without losing raw snapshot');
 state=await edit(state,()=>commit('count',9),'Cosine count 9',{changed:true});check(palette(state).colors.length===9,'Count controls actual discrete palette');
 state=await edit(state,()=>commit('a-0',.25),'Cosine A R',{changed:true});const cosine=state;
 state=await edit(state,()=>commit('count',5),'Cosine count 5',{changed:true});state=await edit(state,()=>commit('count',9),'Cosine count restored',{changed:true});assert.deepEqual(palette(state),palette(cosine));
 state=await tabs(state,'Cosine tab remount');check(await mode().inputValue()==='cosine'&&Number(await field('a-0').inputValue())===.25&&await field('count').inputValue()==='9','Mode, shared count and Cosine parameters survive remount');
 state=await edit(state,()=>mode().selectOption('curve'),'Select Curve',{changed:true});assert.deepEqual(palette(state).colors,['#000000','#202020','#404040','#606060','#808080','#9F9F9F','#BFBFBF','#DFDFDF','#FFFFFF']);check(true,'Imported Curve ramps bake exact 9 discrete colors');
 state=await edit(state,()=>editor().getByRole('button',{name:'Add node',exact:true}).click(),'Add Curve node');const beforePoint=state;
 state=await edit(state,()=>commit('point-y',.9),'Change Curve point',{changed:true});check(palette(state).colors[4]==='#E68080','Curve point changes baked middle red');const custom=state;
 state=await edit(state,()=>button('Undo').click(),'Undo Curve point');assert.deepEqual(palette(state),palette(beforePoint));
 state=await edit(state,()=>button('Redo').click(),'Redo Curve point');assert.deepEqual(palette(state),palette(custom));check(state.presented.canvas.rgbaSha256===custom.presented.canvas.rgbaSha256,'Redo restores exact generated image');
 state=await tabs(state,'Curve tab remount');check(await editor().getByTestId('source-gradient-curve').locator('circle').count()===3&&await field('count').inputValue()==='9','Curve nodes and count survive panel remount');
 state=await edit(state,()=>mode().selectOption('manual'),'Manual restoration',{changed:true});assert.deepEqual(palette(state),{colors});assert.deepEqual(editorState(state).cosine,editorState(custom).cosine);assert.deepEqual(editorState(state).curves,editorState(custom).curves);
 check(!editorState(state).useCosine&&!editorState(state).useCurve&&state.presented.canvas.rgbaSha256!==originalCanvas,'Manual restores raw strings, alpha and tail in author while runtime remains opaque and parameters stay');
 check(await page.evaluate(()=>{const output=window.__implicitGradient.geometries.findLast(g=>g.operation==='generate')?.output,rgba=output?.sourceImplicitPresentation.fillColors;return rgba?.length>0&&Array.from({length:rgba.length/4},(_,i)=>rgba[i*4+3]).every(v=>v===Math.fround(178/255));}),'Manual restoration follows hot opaque color alpha before 0.7 fill opacity');
 state=await edit(state,()=>mode().selectOption('curve'),'Revisit Curve',{changed:true});assert.deepEqual(palette(state),palette(custom));
 const baked=clone(palette(state));state=await edit(state,()=>editor().getByRole('button',{name:'Apply as manual palette',exact:true}).click(),'Apply as Manual');assert.deepEqual(palette(state),baked);check(await mode().inputValue()==='manual','Bake retains generated colors and clears flags');
 state=await edit(state,()=>mode().selectOption('cosine'),'Cosine after bake',{changed:true});state=await edit(state,()=>mode().selectOption('manual'),'Manual after bake',{changed:true});assert.deepEqual(palette(state),baked);check(true,'Baked palette becomes subsequent Manual restoration snapshot');
 report.steps.push({name:'generators',cosine,custom,baked,restored:state});
 state=await edit(state,()=>mode().selectOption('curve'),'Curve before Save');const recordingEditor=clone(editorState(state)),recordingPalette=clone(palette(state));

 const authorB=(await downloadProject('author-before-record-A')).value;report.videoA=await record('cold-A',authorB,coldA);state=report.videoA.after;
 assert.deepEqual((await downloadProject('author-after-record-A')).value,authorB);check(await mode().inputValue()==='curve'&&await field('count').inputValue()==='9','Recording stop preserves active generator mode and count');
 assert.deepEqual(editorState(state),recordingEditor);check(state.output.presentation.fillSha256===report.imported.output.presentation.fillSha256,'Cold A handoff restores original ARGB fill while author B stays');report.pngA=await png('cold-A-current',state);
 const afterCold=await current(),coldReceipt=afterCold.output.implicitControls;state=await edit(afterCold,()=>editor().getByRole('button',{name:'Apply as manual palette',exact:true}).click(),'Fresh same-color hot B after recording',{changed:true});assert.deepEqual(palette(state),recordingPalette);check(state.output.implicitControls.revision===coldReceipt.revision+1&&state.output.implicitControls.resetRevision===coldReceipt.resetRevision,'Same discrete colors are reapplied after cold recording without reset');
 await button('Geometry & parameters').click();const appliedB=await fullApply('Full Apply staged B');check(appliedB.output.implicitControls.resetRevision===state.output.implicitControls.resetRevision+1&&appliedB.output.positionsSha256!==state.output.positionsSha256,'Full Apply commits staged geometry and resets once');
 const sameApply=await fullApply('Same-value full Apply B');check(sameApply.output.implicitControls.resetRevision===appliedB.output.implicitControls.resetRevision+1&&sameApply.output.presentation.fillSha256===appliedB.output.presentation.fillSha256,'Same-value full Apply resets with identical colors');
 const mark=await sequence();await page.getByTestId('implicit-restart').click();state=await ready(mark);check(state.output.implicitControls.resetRevision===sameApply.output.implicitControls.resetRevision+1&&state.output.positionsSha256===appliedB.output.positionsSha256,'Public restart uses last applied B');
 const coldB=(await downloadProject('applied-cold-B')).value;report.videoB=await record('applied-B',coldB,coldB);state=report.videoB.after;report.pngB=await png('applied-B-current',state);
 await button('Appearance').click();await mode().waitFor();state=await edit(await current(),()=>mode().selectOption('curve'),'Curve before Save');const savedEditor=clone(editorState(state)),savedPalette=clone(palette(state));
 phase='Save and reopen';await button('Save').click();check(await mode().inputValue()==='curve'&&await field('count').inputValue()==='9','Save retains active session generator mode and count');
 const saved=await downloadProject('saved-project');assert.deepEqual(saved.value.implicitSourcePalette,savedPalette);assert.deepEqual(saved.value.provenance.original,input);check(!Object.hasOwn(saved.value,'implicitPaletteEditor'),'Saved project excludes transient generator state and preserves original evidence');
 const beforeReload=await current();assert.deepEqual(editorState(beforeReload),savedEditor);await page.reload();state=await ready();assert.deepEqual(palette(state),savedPalette);check(!Object.hasOwn(state.scene,'implicitPaletteEditor'),'Reload does not hydrate old generator state from provenance');
 await button('Appearance').click();await mode().waitFor();check(await mode().inputValue()==='manual','Saved local project reopens Manual');report.saved={path:saved.path,value:saved.value,reopened:state};
 state=await edit(state,()=>mode().selectOption('cosine'),'Cosine defaults after local reopen',{changed:true});check(Number(await field('a-0').inputValue())===.5,'Local reopen uses default coefficients, distinct from imported original parameters');state=await edit(state,()=>mode().selectOption('curve'),'Curve defaults after local reopen',{changed:true});check(await editor().getByTestId('source-gradient-curve').locator('circle').count()===2,'Local reopen uses default Curve ramps');
 await button('Geometry & parameters').click();phase='Invalid Apply preserves preview';const beforeBad=await current(),badMark=await sequence();await page.locator('.equation-editors textarea').fill('sin(');await page.getByTestId('implicit-apply').click();await page.waitForFunction(n=>window.__implicitGradient.calls.some(c=>c.sequence>n&&c.error),badMark);
 const bad=await page.evaluate(n=>window.__implicitGradient.calls.findLast(c=>c.sequence>n&&c.error),badMark);check(bad.previewRetained===true,'Public invalid Apply reaches worker and explicitly retains old preview');const afterBad=await current();check(afterBad.presented.canvas.rgbaSha256===beforeBad.presented.canvas.rgbaSha256,'Invalid Apply preserves actual visible canvas');await page.locator('.equation-editors textarea').fill(input.equation.f);state=await fullApply('Repair invalid Apply');check(!state.error&&state.output.implicitControls.revision>=1,'Repaired public Apply establishes a valid owner');report.invalidApply={bad,repaired:state};
 await button('Appearance').click();state=await edit(state,()=>mode().selectOption('manual'),'Manual after repaired Apply');state=await edit(state,()=>editor().getByRole('button',{name:'Restore six default colors',exact:true}).click(),'Default palette');const defaults=state;state=await edit(state,()=>editor().getByRole('button',{name:'Restore six default colors',exact:true}).click(),'Same-value default palette');assert.deepEqual(palette(state),palette(defaults));check(state.output.implicitControls.revision===defaults.output.implicitControls.revision+1&&state.output.implicitControls.resetRevision===defaults.output.implicitControls.resetRevision,'Same-value public palette action sends a fresh hot command');
 await page.screenshot({path:out+'/implicit-app.png'});report.boundaries=[];
 for(const raw of [[],['#80123456']]){
  await button('Geometry & parameters').click();const source={...clone(input),name:'Implicit palette length '+raw.length,palette:raw};activeName=source.name;phase=activeName;const beforeImport=await sequence();await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:'implicit-boundary.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});const initial=await ready(beforeImport);assert.deepEqual(palette(initial),{colors:raw});
  const beforeOpen=await page.evaluate(()=>window.__implicitGradient.wire.length);await button('Appearance').click();await mode().waitFor();await page.waitForTimeout(200);const padded=(await downloadProject('boundary-'+raw.length+'-padded')).value,expected=raw.length?[...raw,'#F97316']:['#3B82F6','#22D3EE'];assert.deepEqual(padded.implicitSourcePalette,{colors:expected});
  const opened=await current();check(opened.output.implicitControls.resetRevision===initial.output.implicitControls.resetRevision&&opened.output.presentation.fillSha256===initial.output.presentation.fillSha256,'First Appearance padding preserves original cold runtime '+raw.length);check(await page.evaluate(n=>window.__implicitGradient.wire.slice(n).every(w=>!w.context?.implicitControls?.commands.length),beforeOpen),'Appearance padding sends no hot control '+raw.length);
  await button('Geometry & parameters').click();await button('Appearance').click();await mode().waitFor();assert.deepEqual((await downloadProject('boundary-'+raw.length+'-remount')).value.implicitSourcePalette,padded.implicitSourcePalette);check(true,'Appearance remount does not repeat padding '+raw.length);
  state=await edit(opened,()=>mode().selectOption('cosine'),'Boundary generator '+raw.length);check(await field('count').inputValue()==='8','Empty/single captures generator count before padding '+raw.length);state=await edit(state,()=>mode().selectOption('manual'),'Boundary Manual '+raw.length);assert.deepEqual(palette(state),padded.implicitSourcePalette);await button('Geometry & parameters').click();const applied=await fullApply('Apply padded palette '+raw.length);check(applied.output.implicitControls.resetRevision>opened.output.implicitControls.resetRevision,'Explicit Apply commits padded author '+raw.length);report.boundaries.push({raw,initial,padded,opened,applied});
 }
 report.wire=await page.evaluate(()=>window.__implicitGradient.wire);report.workerObservation=await page.evaluate(()=>{const a=window.__implicitGradient;return{created:a.workerSequence,terminated:a.terminated,retainedGeometryBytes:a.geometryBytes,geometries:a.geometries.length,presentations:a.presentations.length};});check(report.wire.length>0&&report.wire.every(w=>!w.hasEditor&&!w.hasCommandEditor),'Actual Worker transport excludes editor parameters, flags and Manual snapshots');check(report.pageErrors.length===0,'No unhandled App errors');
}

try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
 service=await createExportServer({root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`],sourceRendererBackend:backend});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:key=>switches.get(key)??'',appendSwitch:(key,value)=>switches.set(key,value)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([key,value])=>'--'+key+'='+value)});report.browser=browser.version();context=await browser.newContext({viewport:{width:1360,height:1000},deviceScaleFactor:1,acceptDownloads:true});
 for(const [file,observer] of [['client.ts',generatorObserver],['renderer.ts',rendererObserver],['sourceNativeViewport.ts',nativeObserver],['sourceDrawingPixels.ts',pixelsObserver],['sourceGeometryImage.ts',imageObserver]])await context.route('**/src/engine/'+file+'*',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({response,body:await response.text()+'\n'+observer});});
 let failure;report.measurements=await measureFamily(process.pid,async()=>{const start=performance.now();try{await run(server.resolvedUrls.local[0]);}catch(error){failure=error;}return{elapsedMs:performance.now()-start,costScope:'Public native App workflow after Vite/service/browser setup'};});if(failure)throw failure;report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.lastAudit=await page.evaluate(()=>{const a=window.__implicitGradient;return{calls:a.calls.slice(-4),presentations:a.presentations.slice(-4),wire:a.wire.slice(-4),imageEncodes:a.imageEncodes,pixelReads:a.pixelReads,pngJobs:a.pngJobs};}).catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 report.cleanup=[];for(const [resource,close] of [['context',()=>context?.close()],['browser',()=>browser?.close()],['vite',()=>server?.close()],['export-service',()=>service?.close()]])try{await close();report.cleanup.push({resource,status:'fulfilled'});}catch(error){report.cleanup.push({resource,status:'rejected',error:String(error)});}
 report.remainingWorkers=workers.size;report.remainingServiceProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||report.remainingWorkers||report.remainingServiceProcesses||report.cleanup.some(c=>c.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');const m=report.measurements?.processFamily;
 await writeFile(out+'/README.md',`# Implicit 色板生成器实际 App 验收\n\n状态：${report.status}；${report.checks.length} 项检查；总耗时 ${(report.elapsedMs/1000).toFixed(3)} 秒。\n\n${m?`采样 CPU ${(m.observedCpuMs/1000).toFixed(3)} 秒，峰 RSS ${m.sampledPeakRssKiB} KiB，采样错误 ${m.samplingErrors.length}。\n\n`:''}源码${report.sourceStable?'稳定':'发生变化'}；剩余观测 Worker ${report.remainingWorkers}，服务子进程 ${report.remainingServiceProcesses}。\n\n${report.error?`失败阶段：${report.phase}\n\n\`\`\`\n${report.error}\n\`\`\`\n\n`:''}${report.limits.map(v=>'- '+v).join('\n')}\n\n${report.pngB?'[当前 PNG](applied-B-current.png) · [实际 MP4](applied-B.mp4) · [App 截图](implicit-app.png) · [保存项目](saved-project.json)\n\n':''}完整原始调用、实际 mesh/canvas/PNG 哈希、来源及资源记录见 report.json。\n`);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,phase:report.phase,error:report.error,elapsedMs:report.elapsedMs,sourceStable:report.sourceStable,directory:out}));
}
