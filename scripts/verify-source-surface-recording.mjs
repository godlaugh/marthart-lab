/** Surface recording owner → actual CPU/GPU geometry renderer. No worker/UI/encoder. */
import {measureFamily} from './browser-process-cost.mjs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const workerMode=process.argv[3]==='--worker',clientMode=process.argv[3]==='--client';
const directory=process.argv[2]??`.cache/surface-recording-${Date.now()}`;await mkdir(directory,{recursive:true});
const sha=v=>createHash('sha256').update(v).digest('hex');
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())result.push(...await files(p));else if(e.isFile())result.push(p);}return result;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-surface-recording.mjs','tests/fixtures/source-surface-scene/recording-native.json'].sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',scope:clientMode?'Production Generator + Worker + retained Surface recording renderer.':workerMode?'Real Worker Surface recording → main-thread geometry rendering.':'Retained Surface numerical recording with real browser geometry rendering.',limits:[clientMode?'App controls, queue and video encoder are not exercised by this client verifier.':workerMode?'Production client/App/encoder are not connected; worker buffers are rendered directly by this verifier.':'Worker/client/App recording and video encoding are not connected in this owner verifier.','Original fixture executes CPU numerical scene methods, not original shaders or GUI pixels.','GPU local comparisons reuse CPU numerical oracle; no native GPU parity claim.','Fixture actual FPS is injected, not measured from a native window.','First pass includes module initialization; second pass reuses modules/browser with fresh owners, not a full App cold/warm comparison.','Process-family CPU/RSS are sampled estimates and may miss short-lived children; VRAM and complete token cost are unmeasured. No equivalent pre-change recording path exists.'],sourceBefore:await hashes()};
let server,browser,page;const started=performance.now(),errors=[];
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/surface-recording',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Surface recording verification</title>'}));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface-recording`);
 const measured=await measureFamily(process.pid,async()=>({cases:await page.evaluate(async({fixture,workerMode,clientMode})=>{
  const transportMode=workerMode||clientMode,{Generator}=await import('/src/engine/client.ts');
  const contexts=new Set(),getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const result=getContext.call(this,type,...args);if((type==='webgl'||type==='webgl2')&&result)contexts.add(result);return result;};
  const {SourceSurfaceLiveSession}=await import('/src/engine/sourceSurfaceLiveSession.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');const rows=[];window.__surfaceRecordingRows=rows;
  function clientOwner(){
   const generator=new Generator();let current,frame;
   return{
    async generate(scene,context){current=await generator.generate(scene,context);frame=current.surfaceLive.frame;return current;},
    async updateParameter(_s,_c,name,value){await generator.updateSurfaceParameter(current,name,value);},
    async navigatePaused(_s,_c,event){current=await generator.navigateSurfacePaused(current,event);frame=current.surfaceLive.frame;return current;},
    async beginRecording(_scene,_c,options){const r=await generator.beginSourceRecording(current,options);frame=r.warmup.surfaceLive.frame;return r;},
    async nextRecordingFrame(handle,index,rate){const r=await generator.nextSourceRecordingFrame(handle,index,rate);frame=r.surfaceLive.frame;return r;},
    async finishRecording(handle){const r=await generator.finishSourceRecording(handle);current=r.preview;frame=current.surfaceLive.frame;return r;},
    diagnostics:()=>({frame}),reset:()=>generator.dispose(),
   };
  }
  function workerOwner(){
   const worker=new Worker(new URL('/src/engine/generate.worker.ts',location.href),{type:'module'}),pending=new Map();let sequence=0,sourceId,frame;
   worker.onerror=e=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('worker runtime error: '+e.message));}pending.clear();};
   worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request||data.operation==='generate-status'||data.operation==='generate-progress')return;pending.delete(data.id);clearTimeout(request.timer);if('error' in data)request.reject(Error(request.operation+': '+data.error));else request.resolve(data);};
   const ask=(operation,rest)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('worker response timeout: '+operation));},15000);pending.set(id,{resolve,reject,timer,operation});worker.postMessage({operation,sessionId:1,id,...rest});});
   return{
    async generate(scene,context){const r=await ask('generate',{scene,context});sourceId=r.id;frame=r.output.surfaceLive.frame;return r.output;},
    async updateParameter(_s,_c,name,value){await ask('surface-parameter',{sourceId,name,value});},
    async navigatePaused(_s,_c,event){const r=await ask('surface-navigation',{sourceId,event});sourceId=r.id;frame=r.output.surfaceLive.frame;return r.output;},
    async beginRecording(_scene,_c,options){const r=await ask('source-recording-begin',{sourceId,options});frame=r.result.warmup.surfaceLive.frame;return{...r.result,handle:{recordingId:r.recordingId}};},
    async nextRecordingFrame(handle,displayFrame,actualFrameRate){const r=await ask('source-recording-frame',{recordingId:handle.recordingId,displayFrame,actualFrameRate});frame=r.output.surfaceLive.frame;return r.output;},
    async finishRecording(handle){const r=await ask('source-recording-finish',{recordingId:handle.recordingId});sourceId=r.id;frame=r.result.preview.surfaceLive.frame;return r.result;},
    diagnostics:()=>({frame}),reset:()=>{worker.terminate();for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('worker disposed'));}pending.clear();},
   };
  }
  for(let repeat=0;repeat<2;repeat++)for(const backend of ['CPU','GPU'])for(const density of [1,2])for(const trace of fixture.actual.cases.filter(c=>backend==='CPU'||['animated-points','animated-mesh'].includes(c.input.name))){
   const project=structuredClone(trace.input.project);Object.assign(project.settings,{render_mode:backend,scale_x:12,scale_y:12,scale_z:12});
   const scene=parseProjectFile(JSON.stringify(project)).scene,owner=clientMode?clientOwner():workerMode?workerOwner():new SourceSurfaceLiveSession(),renderer=new ArtRenderer(document.createElement('canvas'));
   const c={time:0,quality:'preview',width:64*density,height:48*density,sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:backend+density+trace.input.name,revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29}};
   const render=async(output,source)=>{
    if(output.type==='raster'){const pixels=output.pixels,visible=pixels.some((p,i)=>i%4!==3&&p!==pixels[i%4]),alpha=output.surfaceLive.frame.surfaceTransition?.overlayAlpha??0;check(alpha===255?!visible:visible,'client readback visibility');return{width:output.width,height:output.height,visible,overlayAlpha:alpha,pixels:await digest(pixels)};}
    const v=output.sourceCameraFrame.viewport;renderer.setSize(v.logicalWidth,v.logicalHeight,density);renderer.setOutput(output,{...source,evaluatedSourceCamera:output.sourceCameraFrame},false);renderer.render();
    const gl=renderer.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    check(!gl.isContextLost()&&gl.getError()===0,'GL failure');const visible=pixels.some((p,i)=>i%4!==3&&p!==pixels[i%4]),covered=output.sourceSurfaceOverlayAlpha===255;
    check(covered?!visible:visible,`unexpected visibility: ${backend}/${density}/${trace.input.name}/${output.surfaceLive.frame.frameIndex}, overlay=${output.sourceSurfaceOverlayAlpha}`);const stride=width*4,row=new Uint8Array(stride);for(let y=0;y<Math.floor(height/2);y++){const a=y*stride,b=(height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}return{width,height,visible,overlayAlpha:output.sourceSurfaceOverlayAlpha??0,pixels:await digest(pixels)};
   };
   try{
    await owner.generate(scene,c);await owner.updateParameter(scene,c,'a',.9);await owner.navigatePaused(scene,c,{kind:'wheel',count:-3});
    const draft=structuredClone(scene);draft.equations.x='(';draft.name='kept draft';
    const contextsBefore=new Set(contexts),beginAt=performance.now(),start=await owner.beginRecording(draft,c,{width:17,height:13,simulationFps:4,actualFrameRate:37}),beginMs=performance.now()-beginAt,frames=[];
    const recordingContexts=[...contexts].filter(c=>!contextsBefore.has(c));if(clientMode)check(recordingContexts.length===1,'client must own one recording GL context');
    check(start.clock.updates===trace.frames.length&&start.clock.encodedFrames===trace.frames.length-1,'planned completion');
    for(const [index,row]of trace.frames.entries()){
     const before=performance.now(),output=index===0?start.warmup:await owner.nextRecordingFrame(start.handle,index,trace.input.steps[index].actualFrameRate),f=output.surfaceLive.frame,e=row.state;
     check(f.sceneTime===e.sceneTime&&f.rawDt===e.rawDt&&f.queueIndex===e.queueIndex&&f.queueComplete===row.autoComplete,'original numerical clock mismatch');
     check(['phi','theta','gamma','zoom','focalDistance'].every(k=>f.camera[k]===e.camera[k]),'original camera mismatch');
     check((output.surfaceLive.frame.surfaceTransition?.overlayAlpha??0)===Math.round(e.overlayAlpha*255),'original transition overlay mismatch');
     check(output.surfaceLive.recording.actualFrameRate===trace.input.steps[index].actualFrameRate&&output.surfaceLive.recording.warmup===(index===0),'observed FPS/warmup changed');
     const pixels=await render(output,start.scene);check(pixels.width===Math.floor(51/density+.5)*density&&pixels.height===Math.floor(39/density+.5)*density,'3x/density dimensions');
     frames.push({index,sceneTime:f.sceneTime,actualFrameRate:output.surfaceLive.recording.actualFrameRate,complete:f.queueComplete,...pixels,elapsedMs:performance.now()-before});
    }
    const before=owner.diagnostics().frame,stop=await owner.finishRecording(start.handle,2000),primary=await render(stop.preview,start.scene);check(same(stop.preview.surfaceLive.frame,before)&&(transportMode?same(stop.scene,scene):stop.scene.equations.x==='('&&stop.scene.name==='kept draft'),'stop changed frame/draft');
    if(clientMode){check([...contexts].filter(c=>!contextsBefore.has(c)).length===1,'client recreated a renderer');check(recordingContexts.every(c=>c.isContextLost()),'recording context not released');}
    if(!transportMode){const retry=owner.finishRecording(start.handle,9000),again=await render(retry.preview,start.scene);check(same(primary,again),'stop retry changed pixels');}
    const resumed=await owner.generate(stop.scene,{...stop.context,surfaceLive:{...stop.context.surfaceLive,clock:{paused:false,timestampMs:transportMode?undefined:2250},actualFrameRate:43}});check((transportMode?Number.isFinite(resumed.surfaceLive.frame.rawDt):resumed.surfaceLive.frame.rawDt===.25)&&resumed.surfaceLive.frame.frameIndex===trace.frames.length,'stop reset clock twice or resumed incorrectly');await render(resumed,start.scene);
    owner.reset();rows.push({repeat,temperature:repeat===0?'first-pass-after-module-load':'warm-runtime-fresh-owner',backend,density,name:trace.input.name,clock:start.clock,beginMs,frames,fullApplyAnchor:true,authorDocumentPreserved:true,stopNoAdvance:true,stopRetryStable:transportMode?null:true,recordingRendererContexts:clientMode?recordingContexts.length:null,resumePassed:true});
   }finally{if(transportMode)owner.reset();renderer.dispose();renderer.renderer.forceContextLoss();}
  }
  return rows;
 },{fixture:JSON.parse(await readFile('tests/fixtures/source-surface-scene/recording-native.json','utf8')),workerMode,clientMode})}));report.cases=measured.cases;report.processFamily=measured.processFamily;
 if(clientMode)report.contextLossRecovery=await page.evaluate(async project=>{
  const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts');
  const contexts=[],original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const value=original.call(this,type,...args);if((type==='webgl'||type==='webgl2')&&value&&!contexts.includes(value))contexts.push(value);return value;};
  const scene=parseProjectFile(JSON.stringify(project)).scene,generator=new Generator(),context={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'lost-context',revision:0,clock:{paused:true},actualFrameRate:29}},options={width:17,height:13,simulationFps:4,actualFrameRate:37};
  const check=(v,m)=>{if(!v)throw Error(m);};
  try{
   const initial=await generator.generate(scene,context),start=await generator.beginSourceRecording(initial,options);check(contexts.length===1,'recovery fixture must own one GL context');const gl=contexts[0];
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('context loss event timeout')),5000);gl.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();clearTimeout(timer);resolve();},{once:true});gl.getExtension('WEBGL_lose_context').loseContext();});
   let failure;try{await generator.nextSourceRecordingFrame(start.handle,1,24);}catch(error){failure=error;}
   check(failure?.recordingRetained===true&&generator.hasSourceRecording(start.handle),'lost GL must retain numerical recording');
   const stop=await generator.finishSourceRecording(start.handle);check(stop.preview.type==='geometry'&&stop.preview.surfaceLive.frame.frameIndex===1,'loss stop advanced/dropped numerical frame');
   await generator.setSurfacePaused(stop.preview,true);const current=await generator.currentSurface(stop.preview),again=await generator.beginSourceRecording(current,options);check(contexts.length===2&&again.warmup.type==='raster','fresh recording did not recreate GL after orderly stop');await generator.finishSourceRecording(again.handle);check(contexts.every(c=>c.isContextLost()),'recovery leaked GL');
   return{status:'passed',retainedNumericalFrame:1,contextsCreated:contexts.length,restartedAfterStop:true,allContextsReleased:true};
  }finally{generator.dispose();HTMLCanvasElement.prototype.getContext=original;}
 },JSON.parse(await readFile('tests/fixtures/source-surface-scene/recording-native.json','utf8')).actual.cases.find(c=>c.input.name==='animated-mesh').input.project);
 if(errors.length)throw Error(errors.join('\n'));report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);report.partialCases=await page?.evaluate(()=>window.__surfaceRecordingRows??[]).catch(()=>[]);}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.errors=errors;report.elapsedMs=performance.now()-started;if(!report.sourceStable)report.status='failed';await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases?.length,elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;}
