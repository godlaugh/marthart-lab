/** Additional hidden packaged-App workflows. Observers copy values after real
 * producer calls; they never supply roots, pixels, ACKs, or completion facts. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {decodePng} from './verify-png.mjs';
import {verifyRecordingVideo} from './verify-recording-video.mjs';
import {findFFmpeg} from '../../desktop/host.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
export function rootsWorkflowSource(source){
 const value=structuredClone(source);
 value.timeline=[
  {type:'animate',duration:1,easing:'LINEAR',actions:[{method:'ambient',args:[.3,.4,.5]},{method:'zoom',args:[1.25]},{method:'gradientStart',args:{mode:'OFFSET_CYCLE',interpolation:'LINEAR',speed:90}}]},
  {type:'wait',duration:6},
  {type:'animate',duration:1,easing:'LINEAR',actions:[{method:'stopAmbient'},{method:'gradientStop'}]},
  {type:'wait',duration:1},
 ];
 const {timeline:_before,...before}=source,{timeline:_after,...after}=value;
 assert.deepEqual(after,before);assert.equal(value.sampling.sample_count,131072);assert.equal(value.settings.worker_count,4);
 return value;
}

/** Installed before App construction. All callbacks return the original
 * response/result. Error reporting cannot throw into a production producer. */
export function installRootsWorkflowObserver(){
 if(window.__rootsWorkflows)return;
 const a=window.__rootsWorkflows={sequence:0,pending:0,recording:false,bytes:0,contexts:0},encode=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);};
 const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
 const observe=task=>{a.pending++;Promise.resolve().then(task).catch(e=>window.__rootsError(String(e.stack??e))).finally(()=>a.pending--);};
 const pixels=o=>{if(!o)return undefined;const{pixels,...facts}=o;return{facts:structuredClone(facts),pixels:pixels?.slice()};};
 const pack=async c=>c?{...c.facts,...(c.pixels?{rgbaSha256:await hash(c.pixels)}:{})}:undefined;
 const W=window.Worker;window.Worker=new Proxy(W,{construct(Target,args){const w=new Target(...args),requests=new Map(),post=w.postMessage.bind(w);
  w.postMessage=function(m,...rest){if(m?.operation==='generate'||m?.operation?.startsWith('source-recording-'))requests.set(m.id,{operation:m.operation,id:m.id,recordingId:m.recordingId,displayFrame:m.displayFrame,options:structuredClone(m.options),context:structuredClone(m.context),sceneKind:m.scene?.kind,sceneId:m.scene?.id,issued:++a.sequence});return post(m,...rest);};
  w.addEventListener('message',({data:d})=>{const request=requests.get(d?.id);if(!request||d.operation!==request.operation)return;requests.delete(d.id);
   if(d.operation==='generate'){if(!d.output?.rootsPresentation){const row={kind:'other-generate',sequence:++a.sequence,request,error:d.error,output:d.output?{type:d.output.type,backend:d.output.backend,stats:structuredClone(d.output.stats)}:undefined};observe(()=>window.__rootsWorkflow(row));}return;}
   const output=pixels(d.output),warmup=pixels(d.result?.warmup),preview=pixels(d.result?.preview),result=d.result?structuredClone({...d.result,warmup:undefined,preview:undefined}):undefined,row={kind:d.operation,sequence:++a.sequence,request,id:d.id,recordingId:d.recordingId,error:d.error};
   observe(async()=>window.__rootsWorkflow({...row,output:await pack(output),result:result?{...result,warmup:await pack(warmup),preview:await pack(preview)}:undefined}));
  });return w;
 }});
 // Match the actual source compositor shader. Observe the existing base upload
 // and existing readPixels, never add a GL read or alter framebuffer state.
 const context=HTMLCanvasElement.prototype.getContext,wrapped=new WeakSet();
 HTMLCanvasElement.prototype.getContext=function(...args){const gl=context.apply(this,args);if(args[0]!=='webgl2'||!gl||wrapped.has(gl))return gl;wrapped.add(gl);
  const id=++a.contexts,shaders=new Map(),programs=new Map();let current,base;
  const shaderSource=gl.shaderSource.bind(gl),attach=gl.attachShader.bind(gl),use=gl.useProgram.bind(gl),upload=gl.texImage2D.bind(gl),clear=gl.clear.bind(gl),read=gl.readPixels.bind(gl);
  const sourceProgram=()=>[...(programs.get(current)??[])].some(s=>(shaders.get(s)??'').includes('out vec4 color;void main(){color=texture(tex,uv);}'));
  gl.shaderSource=(s,text)=>{shaders.set(s,text);return shaderSource(s,text);};gl.attachShader=(p,s)=>{let list=programs.get(p);if(!list)programs.set(p,list=[]);list.push(s);return attach(p,s);};gl.useProgram=p=>{current=p;return use(p);};
  gl.clear=mask=>{base=undefined;return clear(mask);};
  gl.texImage2D=function(...v){const result=upload(...v);if(a.recording&&sourceProgram()&&!base&&v.length===9&&v[3]===gl.canvas.width&&v[4]===gl.canvas.height&&ArrayBuffer.isView(v[8]))base=new Uint8Array(v[8].buffer,v[8].byteOffset,v[8].byteLength).slice();return result;};
  gl.readPixels=function(...v){const result=read(...v);if(a.recording&&sourceProgram()&&base&&v[0]===0&&v[1]===0&&v[2]===gl.canvas.width&&v[3]===gl.canvas.height&&v[4]===gl.RGBA&&v[5]===gl.UNSIGNED_BYTE&&ArrayBuffer.isView(v[6])){
   const width=v[2],height=v[3],bottom=new Uint8Array(v[6].buffer,v[6].byteOffset,v[6].byteLength).slice(),top=new Uint8Array(bottom.length),stride=width*4,borrowed=base;for(let y=0;y<height;y++)top.set(bottom.subarray((height-1-y)*stride,(height-y)*stride),y*stride);
   const row={kind:'formula-readback',sequence:++a.sequence,contextId:id,width,height};a.bytes+=top.length;if(a.bytes>128*1024**2)observe(()=>{throw Error('Formula observer exceeds 128 MiB finite evidence budget');});else observe(async()=>window.__rootsWorkflow({...row,baseSha256:await hash(borrowed),rgbaSha256:await hash(top),rgba:encode(top)}));
  }return result;};return gl;
 };
 const fetch=window.fetch;window.fetch=async function(input,init){const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),method=init?.method??'GET';
  if(!u.pathname.startsWith('/api/exports'))return fetch.call(this,input,init);
  const body=init?.body,request=typeof body==='string'?body:undefined,blob=body instanceof Blob?body:undefined,issued=++a.sequence;
  const response=await fetch.call(this,input,init);
  try{const row={kind:'export-http',sequence:++a.sequence,issued,path:u.pathname,query:u.search,method,status:response.status,request:request?JSON.parse(request):undefined};
   if(blob&&u.pathname.endsWith('/frames')){const bytes=new Uint8Array(await blob.arrayBuffer());row.png=encode(bytes);row.pngSha256=await hash(bytes);}
   if(response.headers.get('content-type')?.includes('application/json'))row.response=await response.clone().json();await window.__rootsWorkflow(row);
  }catch(e){await window.__rootsError(String(e.stack??e));}return response;
 };
}

export async function receiveRootsWorkflow(row,out,rows){
 if(row.rgba){const bytes=Buffer.from(row.rgba,'base64');assert.equal(bytes.length,row.width*row.height*4);assert.equal(sha(bytes),row.rgbaSha256);row.rgbaFile=path.join(out,'formula-'+row.sequence+'.rgba');await writeFile(row.rgbaFile,bytes);delete row.rgba;}
 if(row.png){const bytes=Buffer.from(row.png,'base64');assert.equal(sha(bytes),row.pngSha256);row.pngFile=path.join(out,'upload-'+row.sequence+'.png');await writeFile(row.pngFile,bytes);delete row.png;}
 if(row.kind==='source-recording-begin')await writeFile(path.join(out,'begin-'+row.sequence+'.json'),JSON.stringify(row,null,2)+'\n');
 rows.push(row);
}

export async function verifyRootsDesktopWorkflows(e){
 const {app,page,report,run,owners,out,profile,input,source,ready,hidden,wait,nativeFrame,outputFacts,currentPng}=e;
 const dir=path.join(out,'workflows');await mkdir(dir,{recursive:true});run.workflows=[];
 const encoder=await page.evaluate(()=>window.mathartDesktop.preferences());assert(!encoder.ffmpegWarning,encoder.ffmpegWarning);assert.equal(await realpath(encoder.activeFFmpeg),await realpath(await findFFmpeg()));run.encoder={path:encoder.activeFFmpeg,sha256:sha(await readFile(encoder.activeFFmpeg)),oracle:'Same existing FFmpeg executable, independent raw RGBA input instead of accepted PNG stream'};
 const rows=report.workflow,mark=()=>rows.length,drain=()=>page.waitForFunction(()=>window.__rootsObserver.pending===0&&window.__rootsWorkflows.pending===0);
 const latest=()=>report.worker.findLast(w=>w.phase===run.phase&&w.kind==='generate'&&w.output.rootsPresentation);
 const importInput=async bytes=>{const n=report.worker.length;await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'roots.json',mimeType:'application/json',buffer:bytes});await wait(()=>report.worker.slice(n).some(w=>w.kind==='generate'&&w.output.rootsLive),'Imported actual Roots output');await ready();await drain();return latest();};
 const pause=async()=>{const b=page.getByRole('button',{name:'Pause',exact:true});if(await b.isVisible())await b.click();await page.getByRole('button',{name:'Play',exact:true}).waitFor();await ready();await drain();};
 const boundFrame=o=>{assert.equal(o.type,'raster');assert.equal(o.backend,'native');assert.equal(o.sourcePixelRenderer?.backend,'native');assert.equal(o.rootsPresentation?.mode,'point-cloud');assert.equal(o.roots.math.logicalWorkers,4);assert(o.roots.attemptedSamples<=131072);assert(o.roots.rootPoints<=1310720);assert.equal(o.formulaPresentation?.labels.length,3);const n=nativeFrame(o);assert(n?.validated,'Missing actual native finish');assert.equal(n.rgbaTopDownSha256,o.rgbaSha256);assert.equal(n.ack.receivedPoints,o.rootsPresentation.pointCloud.drawnPoints);assert.equal(n.ack.nextChunk,n.ack.totalChunks);return n;};
 await currentPng('control-full');
 if(e.phase!=='cancel'){
 const initial=latest();outputFacts(initial.output);const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds()),before=report.worker.length;
 await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width+128,size.height+96),bounds);
 await wait(()=>report.worker.slice(before).some(w=>w.kind==='generate'&&(w.output.width!==initial.output.width||w.output.height!==initial.output.height)),'Actual resize frame');await ready();await drain();const resized=latest();outputFacts(resized.output);boundFrame(resized.output);assert.equal(resized.output.rootsPresentation.instance,initial.output.rootsPresentation.instance);assert.equal(resized.output.rootsLive.sceneTime,initial.output.rootsLive.sceneTime);
 const restoreMark=report.worker.length;await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),bounds);await wait(()=>report.worker.slice(restoreMark).some(w=>w.kind==='generate'&&w.output.width===initial.output.width&&w.output.height===initial.output.height),'Restored primary dimensions');await ready();await drain();const restored=latest();boundFrame(restored.output);assert.equal(restored.output.rgbaSha256,initial.output.rgbaSha256);run.workflows.push({kind:'resize',initial,resized,restored,hidden:await hidden()});
 const switchMark=mark(),ownedBefore=[...owners.keys()],wireMark=report.wire.length;
 await page.locator('.preset-card').filter({has:page.locator('.art-spirograph')}).first().click();await ready();await wait(()=>rows.slice(switchMark).some(r=>r.kind==='other-generate'&&r.request.sceneKind==='spirograph'&&r.output),'Actual cross-family generated output');await drain();
 for(const resource of ownedBefore)assert(report.wire.slice(wireMark).some(w=>w.operation===5&&w.resource===resource&&w.validated),'Switch did not release prior Roots resource');assert.equal(owners.size,0);
 const switched=rows.slice(switchMark).filter(r=>r.kind==='other-generate');await importInput(input);await wait(()=>latest()?.output.rootsLive.autoRecording.complete,'Returned full Roots terminal');await ready();await drain();const back=latest();outputFacts(back.output);boundFrame(back.output);run.workflows.push({kind:'cross-family',from:'roots',to:'spirograph',observed:switched,returned:back,hidden:await hidden()});
 }
 const animated=rootsWorkflowSource(source),bytes=Buffer.from(JSON.stringify(animated,null,2)+'\n');await writeFile(path.join(dir,'animated-source.json'),bytes);await importInput(bytes);await pause();
 run.animatedSource={path:path.join(dir,'animated-source.json'),sha256:sha(bytes),difference:'Only timeline replaced; full original finite mathematical settings, sample/worker counts and seed unchanged',timeline:animated.timeline,simulationFps:4,requestedSize:[96,80],originalRuntimeComparison:'Not performed by this desktop verifier; actions reuse previously investigated source methods, while durations and this complete movie are constructed.'};
 async function record(cancel){
  await pause();const primary=latest();boundFrame(primary.output);const row={kind:cancel?'cancel-recording':'animated-recording',primary,requestedSize:[96,80],simulationFps:4};run.workflows.push(row);
  await page.getByRole('button',{name:'Record',exact:true}).click();await page.getByRole('dialog',{name:'Roots recording',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Roots video mode',exact:true}).inputValue(),'retained');
  for(const[name,value]of[['Export width','96'],['Export height','80'],['Export frame rate','4']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  await page.getByRole('combobox',{name:'Video quality',exact:true}).selectOption('high');
  const n=mark(),downloadIndex=await app.evaluate(()=>globalThis.__rootsDownloads.length);await page.evaluate(()=>{window.__rootsWorkflows.recording=true;});await page.getByRole('button',{name:'Start recording',exact:true}).click();
  await wait(()=>rows.slice(n).some(r=>r.kind==='source-recording-begin'),'Actual recording warmup',120000);
  if(cancel){await wait(()=>rows.slice(n).filter(r=>r.kind==='export-http'&&r.path.endsWith('/frames')&&r.status===200).length>=2,'Two acknowledged uploads before public Cancel',120000);await page.getByRole('button',{name:'Cancel export',exact:true}).click();}
  await wait(()=>rows.slice(n).some(r=>r.kind==='source-recording-finish'),'Actual retained recording finish',300000);
  // Numeric finish is awaited inside Queue before ExportDialog's catch/finally
  // cleans the unfinished encoder. Wait for that public terminal UI boundary
  // before reading the complete transport log; an ACK is not the cleanup.
  await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-label=\"Close export\"]')].some(b=>!b.disabled),undefined,{timeout:60000});await drain();await page.evaluate(()=>{window.__rootsWorkflows.recording=false;});
  const observed=rows.slice(n),begin=observed.find(r=>r.kind==='source-recording-begin'),frames=observed.filter(r=>r.kind==='source-recording-frame'&&r.output),stop=observed.find(r=>r.kind==='source-recording-finish'),http=observed.filter(r=>r.kind==='export-http'),creates=http.filter(r=>r.path==='/api/exports'&&r.method==='POST'),uploads=http.filter(r=>r.path.endsWith('/frames')&&r.status===200),finishes=http.filter(r=>r.path.endsWith('/finish'));
  assert(!begin.error&&!stop.error);assert(frames.length>0&&frames.length<=96);assert.equal(begin.result.warmup.rootsLive.recording.displayFrame,0);assert.equal(begin.result.scene.rootsMath.sampling.sampleCount,131072);assert.equal(begin.result.scene.rootsMath.sampling.workerCount,4);assert.equal(begin.result.scene.rootsMath.sampling.seed,'0');assert.equal(begin.result.warmup.rootsLive.frame.rawDt,.25);boundFrame(begin.result.warmup);
  const recordId=begin.recordingId;for(let i=0;i<frames.length;i++){const f=frames[i];assert.equal(f.recordingId,recordId);assert.equal(f.request.displayFrame,i+1);assert.equal(f.output.rootsLive.recording.displayFrame,i+1);assert.equal(f.output.rootsLive.frame.frame,begin.result.warmup.rootsLive.frame.frame+i+1);assert.equal(f.output.rootsLive.frame.rawDt,.25);assert.equal(f.output.rootsLive.paused,false);boundFrame(f.output);}
  const last=frames.at(-1).output;assert.equal(stop.recordingId,recordId);assert.equal(stop.result.preview.rootsLive.frame.frame,last.rootsLive.frame.frame,'Finish added a numerical update');assert.equal(stop.result.preview.rootsLive.sceneTime,last.rootsLive.sceneTime);assert.equal(stop.result.preview.rootsPresentation.instance,last.rootsPresentation.instance);assert.equal(stop.result.preview.rootsPresentation.target,'primary');assert.equal(stop.result.context.rootsLive.clock.paused,false);boundFrame(stop.result.preview);
  assert.equal(creates.length,1);assert.equal(creates[0].status,201);assert.equal(creates[0].request.frames,null);assert.equal(creates[0].request.width,96);assert.equal(creates[0].request.height,80);assert.equal(creates[0].request.fps,4);assert.equal(creates[0].request.inputWidth,begin.result.warmup.width);assert.equal(creates[0].request.inputHeight,begin.result.warmup.height);assert.deepEqual([begin.result.warmup.width,begin.result.warmup.height],[288,240]);
  const expected=[];for(let i=0;i<uploads.length;i++){const u=uploads[i];assert.equal(Number(new URLSearchParams(u.query).get('index')),i);const f=frames[i];assert(f);const png=decodePng(await readFile(u.pngFile));assert.equal(png.width,f.output.width);assert.equal(png.height,f.output.height);const comps=observed.filter(c=>c.kind==='formula-readback'&&c.sequence>f.sequence&&c.sequence<u.issued&&c.baseSha256===f.output.rgbaSha256&&c.width===png.width&&c.height===png.height);assert.equal(comps.length,1,'Need one actual formula readback per uploaded native frame');const comp=await readFile(comps[0].rgbaFile);assert(png.rgba.equals(comp),'Uploaded PNG differs from actual composed native frame, including alpha');expected.push(comp);}
  row.begin=begin;row.frames=frames;row.stop=stop;row.http=http;row.actualEncodedFrames=uploads.length;row.finalMath={attemptedSamples:last.roots.attemptedSamples,rootPoints:last.roots.rootPoints,completion:last.rootsLive.autoRecording,scope:'Animated queue completion does not require exhausted mathematics.'};
  if(cancel){assert.equal(finishes.length,0);assert.equal(await app.evaluate(()=>globalThis.__rootsDownloads.length),downloadIndex);assert(http.some(r=>r.method==='DELETE'&&r.status>=200&&r.status<300),'Cancel did not acknowledge export cleanup');assert(!last.rootsLive.recording.complete,'Cancel arrived after natural completion');row.cancellationScope='Public Cancel after at least two completed uploads; an already issued frame is allowed to settle. No saved partial video is claimed.';}
  else{
   assert.equal(frames.length,uploads.length);assert.equal(finishes.length,1);assert.equal(finishes[0].status,200);assert.equal(finishes[0].request.finalFrames,uploads.length);assert(last.rootsLive.recording.complete&&last.rootsLive.autoRecording.queueComplete);assert(frames.slice(0,-1).every(r=>!r.output.rootsLive.recording.complete));assert(finishes[0].sequence<stop.sequence,'Numerical owner resumed before encoding confirmation');
   let download;const end=performance.now()+30000;while(performance.now()<end){download=await app.evaluate((_e,i)=>globalThis.__rootsDownloads[i],downloadIndex);if(download?.state==='completed')break;await new Promise(r=>setTimeout(r,50));}assert.equal(download?.state,'completed');assert.equal(await app.evaluate(()=>globalThis.__rootsDownloads.length),downloadIndex+1);
   const file=path.join(dir,'animated.mp4');await writeFile(file,await readFile(download.path));row.video={file,sha256:sha(await readFile(file)),...verifyRecordingVideo(file,creates[0].request,expected,path.join(dir,'animated-independent-raw.mp4'))};assert(row.video.distinctFrames>1);assert(new Set(frames.map(f=>JSON.stringify(f.output.rootsLive.frame.camera))).size>1);assert(new Set(frames.map(f=>f.output.rootsLive.frame.gradient.offset)).size>1);
  }
  await page.getByRole('button',{name:'Close export',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();await wait(()=>report.worker.some(w=>w.phase===run.phase&&w.kind==='generate'&&w.output.rootsPresentation.instance===stop.result.preview.rootsPresentation.instance&&w.output.rootsLive.frame.frame>stop.result.preview.rootsLive.frame.frame),'Same instance resumes ordinary live update');await pause();row.resumed=latest();boundFrame(row.resumed.output);row.hidden=await hidden();assert.deepEqual(report.errors,[]);row.status='passed';
 }
 if(e.phase!=='cancel')await record(false);await record(true);
 // A canceled movie must leave the public current-frame path usable. Return
 // to the unchanged complete source so this recovery has an unambiguous full
 // mathematical control independent of animation queue priority.
 await importInput(input);await wait(()=>latest()?.output.rootsLive.autoRecording.complete,'Post-cancel full mathematics');await ready();await drain();outputFacts(latest().output);await currentPng('after-cancel');
 const files=await readdir(path.join(profile,'exports'),{recursive:true});assert(!files.some(f=>String(f).includes('.partial.')),'Export partial files remain');run.exportFiles=files;run.hiddenAfterWorkflows=await hidden();
}
