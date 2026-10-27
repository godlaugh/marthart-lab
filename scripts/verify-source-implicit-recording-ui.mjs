/** Actual App recording controls, retained Worker lifecycle, native artwork and
 * video delivery. Original numerical/pixel parity is verified separately by
 * verify-source-implicit-continuation; this suite does not drive the original GUI. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {verifyRecordingVideo} from './lib/verify-recording-video.mjs';
const gpuMaterial=process.argv.includes('--gpu-material');
const directory=process.argv[2];assert.ok(directory);await mkdir(directory);const origin='http://127.0.0.1:5179';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.(tsx?|json)$/.test(p)).map(p=>'src/'+p),'scripts/verify-source-implicit-recording-ui.mjs','scripts/lib/verify-recording-video.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={requestedMeshMode:gpuMaterial?'GPU':'fixture',scope:'Actual App record/export controls, original-queue local Worker, native rendering, FFmpeg, stop/continue/pause/resize/resume/edit/seek and cancel/retry. No original GUI or original MP4 claim.',cases:[],sourceBefore:await hashes()};
await writeFile(directory+'/executed-verifier.mjs',await readFile(new URL(import.meta.url)));
let browser,vite,service,page;const releases=[],started=performance.now();
function audit(){const Native=Worker;window.__implicit={rows:[],sequence:0};window.Worker=class extends Native{
 requests=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=this.requests.get(data.id);if(!request||data.operation!==request.operation)return;this.requests.delete(data.id);const facts=o=>o&&({type:o.type,frame:o.sourceCameraFrame,live:o.implicitLive,recording:o.implicitRecording,parameters:o.sourceImplicitParameters,formulas:o.formulaPresentation,display:o.sourceImplicitDisplay,implicitModel:o.sourceImplicitPresentation?.model,meshMode:o.sourceImplicitPresentation?.meshMode,meshComputation:o.sourceImplicitPresentation?.meshComputation,implicitControls:o.implicitControls});const a=window.__implicit;if(a.rows.length>=1000)throw Error('Implicit audit bound');a.rows.push({request,operation:data.operation,error:data.error,output:facts(data.output),result:data.result&&{context:data.result.context,sceneFps:data.result.scene?.timeline.fps,clock:data.result.clock,warmup:facts(data.result.warmup),preview:facts(data.result.preview)}});});}
 postMessage(m,...args){this.requests.set(m.id,{operation:m.operation,sequence:++window.__implicit.sequence,context:m.context,sceneFps:m.scene?.timeline.fps,options:m.options,displayFrame:m.displayFrame,paused:m.paused});return super.postMessage(m,...args);}
};}
async function enabled(label){await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),label);}
async function run(name){
 const row={name,errors:[]},uploads=[],creates=[],native=[],downloads=[],deletes=[],finishes=[];report.cases.push(row);
 page=await browser.newPage({viewport:{width:1360,height:900},deviceScaleFactor:2,acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>row.errors.push(e.message));await page.addInitScript(audit);
 let release,arrive,hold=['manual','cancel'].includes(name);const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);releases.push(release);
 await page.route('**/api/source-renderer/frames',async route=>{const samples=route.request().postDataBuffer().readUInt32LE(52);if(samples!==0){await route.continue();return;}const response=await route.fetch(),bytes=await response.body();if(response.status()===200)native.push(bytes);else row.errors.push('Native export HTTP '+response.status()+': '+bytes.toString());await route.fulfill({response,body:bytes}).catch(()=>{});});
 let failUpload=name==='recovery',failFinish=name==='recovery',failStatus=name==='recovery',finishId;
 await page.route('**/api/exports**',async route=>{const req=route.request(),u=new URL(req.url());
  if(req.method()==='POST'&&u.pathname.endsWith('/frames')){
   if(hold){hold=false;arrive();await gate;}
   if(failUpload){failUpload=false;assert.ok((await route.fetch()).ok());return route.abort('failed');}
  }
  if(req.method()==='POST'&&u.pathname.endsWith('/finish')&&failFinish){failFinish=false;const result=await route.fetch();assert.ok(result.ok());finishId=(await result.json()).id;return route.abort('failed');}
  if(req.method()==='GET'&&finishId&&u.pathname==='/api/exports/'+finishId&&failStatus){failStatus=false;return route.abort('failed');}
  await route.continue().catch(()=>{});
 });
 page.on('download',d=>downloads.push(d));page.on('request',r=>{const u=new URL(r.url());if(r.method()==='POST'&&u.pathname==='/api/exports')creates.push(JSON.parse(r.postData()));if(r.method()==='POST'&&u.pathname.startsWith('/api/exports/')&&u.pathname.endsWith('/frames'))uploads.push({index:Number(u.searchParams.get('index')),bytes:r.postDataBuffer()});if(r.method()==='DELETE'&&u.pathname.startsWith('/api/exports/'))deletes.push(u.pathname);if(r.method()==='POST'&&u.pathname.endsWith('/finish'))finishes.push(JSON.parse(r.postData()));});
 const fixture=JSON.parse(await readFile(name==='formulas'?'tests/fixtures/source-implicit-presentation/formula-recording.json':name==='parameters'?'tests/fixtures/source-implicit-presentation/parameters.json':'tests/fixtures/source-implicit-presentation/recording-clock.json')),raw=structuredClone(fixture.cases.find(c=>c.name===(name==='formulas'?'formula-parameters':name==='parameters'?'complete-parameters':'fps4-varying')).input.project);raw.name='Implicit recording '+name;raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=12;
 if(gpuMaterial)raw.settings.mesh_mode='GPU';
 if(name==='warmup')raw.timeline=[];if(['manual','cancel'].includes(name))raw.timeline.push({type:'wait',duration:4});
 await writeFile(directory+'/'+name+'-input.json',JSON.stringify(raw,null,2));row.inputSha256=sha(await readFile(directory+'/'+name+'-input.json'));
 await page.route('**/src/main.tsx',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:`import {Generator as CaptureAudit} from '/src/engine/client.ts';const captureOriginal=CaptureAudit.prototype.captureImplicitPaused;window.__implicitCaptures=[];CaptureAudit.prototype.captureImplicitPaused=async function(...args){try{const result=await captureOriginal.apply(this,args);window.__implicitCapture=result;window.__implicitCaptures.push({frame:result.preview.sourceCameraFrame,producer:result.capture.sourcePixelRenderer,image:result.capture.sourceCurrentImage,formulas:result.capture.formulaPresentation,previewDisplay:result.preview.sourceImplicitDisplay});return result;}catch(error){window.__implicitCaptureError=String(error);throw error;}};\n`+body});});
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'/fixture');
 await page.evaluate(async ({raw,name})=>{const{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');const scene=parseProjectFile(JSON.stringify(raw)).scene;if(name==='parameters')scene.timeline.tracks[0].actions[0]={id:scene.timeline.tracks[0].actions[0].id,method:'paramStart',sourceEffect:'unmapped'};saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'high',frameRate:20}});},{raw,name});
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('[data-testid=native-art-canvas]')?.style.display==='block'&&!document.querySelector('.error-card'));
 if(name==='parameters'){
  await page.locator('.track-labels button').first().click();
  const method=page.getByRole('combobox',{name:'Animation action',exact:true}).first();
  await page.getByRole('button',{name:'Configure source parameters',exact:true}).click();
  await page.getByRole('combobox',{name:'Parameter scope 1',exact:true}).selectOption('named');
  await method.selectOption('paramStop');await page.getByTestId('implicit-parameter-actions').waitFor();
  await method.selectOption('paramStart');const editor=page.getByTestId('implicit-parameter-actions');
  await editor.getByRole('spinbutton',{name:'Step per frame',exact:true}).first().fill('0.02');
  // Editing this source action stages a draft. Record consumes the running
  // scene, so apply the completed editor change and await its actual receipt.
  const beforeApply=await page.evaluate(()=>window.__implicit.sequence);
  await page.getByRole('button',{name:'Apply scene',exact:true}).click();
  await page.waitForFunction(sequence=>!document.querySelector('.error-card')&&window.__implicit.rows.some(r=>r.operation==='generate'&&r.request.sequence>sequence&&r.output?.parameters&&r.output?.implicitControls?.applyRevision>1&&!r.output.frame.diagnostics.some(d=>d.code==='noncamera-clock')),beforeApply);
  row.parameterEditor=true;await page.screenshot({path:directory+'/parameter-editor.png'});
 }
 const open=async()=>{
  await page.getByRole('button',{name:name==='export'?'Export artwork':'Record',exact:true}).click();
  if(name==='export'){await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Implicit surface video mode',exact:true}).selectOption('retained');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');}
  else await page.getByRole('dialog',{name:'Implicit surface recording',exact:true}).waitFor();
  for(const [label,value]of[['Export width','128'],['Export height','96'],['Export frame rate','4']])await page.getByRole('spinbutton',{name:label,exact:true}).fill(value);
  await enabled(name==='export'?'Start export':'Start recording');
 };
 await open();if(name==='natural')await page.screenshot({path:directory+'/recording-dialog.png'});const boundary=await page.evaluate(()=>window.__implicit.sequence);await page.getByRole('button',{name:name==='export'?'Start export':'Start recording',exact:true}).click();
 if(['manual','cancel'].includes(name)){let timer;try{await Promise.race([arrived,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('No in-flight frame')),30000))]);}finally{clearTimeout(timer);}await page.getByRole('button',{name:name==='manual'?'Stop and save':'Cancel export',exact:true}).click();release();}
 if(name==='recovery'){await page.getByRole('button',{name:'Retry save',exact:true}).waitFor();assert.equal(await page.evaluate(b=>window.__implicit.rows.some(r=>r.request.sequence>b&&r.operation==='source-recording-finish'),boundary),false);await page.getByRole('button',{name:'Retry save',exact:true}).click();}
 await page.waitForFunction(b=>window.__implicit.rows.some(r=>r.request.sequence>b&&r.operation==='source-recording-finish'),boundary,{timeout:60000});
 const auditRows=await page.evaluate(b=>window.__implicit.rows.filter(r=>r.request.sequence>b),boundary),begin=auditRows.find(r=>r.operation==='source-recording-begin'),stop=auditRows.find(r=>r.operation==='source-recording-finish'),frames=auditRows.filter(r=>r.operation==='source-recording-frame');
 assert.ok(!begin.error&&!stop.error);if(gpuMaterial)for(const o of [begin.result.warmup,stop.result.preview,...frames.map(f=>f.output)]){assert.equal(o.implicitModel,'mathart-1.7.8-gpu-material-v1');assert.equal(o.meshMode,'GPU');assert.equal(o.meshComputation,'source-cpu-fallback');} if(gpuMaterial)for(const o of [begin.result.warmup,...frames.map(f=>f.output)])assert.deepEqual([o.frame.viewport.logicalWidth,o.frame.viewport.logicalHeight,o.frame.viewport.target],[192,144,'offscreen']);assert.equal(begin.result.sceneFps,30);assert.equal(stop.result.sceneFps,30);assert.equal(stop.result.context.time,stop.result.preview.frame.sceneTime);const last=frames.at(-1)?.output??begin.result.warmup;assert.deepEqual(stop.result.preview.parameters,last.parameters);if(name==='parameters')assert.notDeepEqual(last.parameters,begin.result.warmup.parameters);
 if(gpuMaterial){const warmup=begin.result.warmup.display;assert.equal(warmup.rebuilt,true);for(const [i,frame]of frames.entries()){assert.equal(frame.output.display.instance,warmup.instance);assert.equal(frame.output.display.displayIndex,warmup.displayIndex+i+1);assert.deepEqual(frame.output.formulas.drawingViewport,frame.output.display.viewport);}assert.equal(stop.result.preview.display.instance,warmup.instance);assert.equal(stop.result.preview.display.displayIndex,last.display.displayIndex+1);}
 assert.equal(stop.result.preview.frame.frameIndex,last.frame.frameIndex);assert.deepEqual(stop.result.preview.frame.camera,last.frame.camera);assert.equal(stop.result.preview.live.paused,false);
 assert.ok(!auditRows.some(r=>r.operation==='generate'&&r.request.sequence>begin.request.sequence&&r.request.sequence<stop.request.sequence),'App replayed preview during recording');
 row.begin=begin;row.stop=stop;row.recordingUpdates=frames.length+1;row.creates=creates;row.finishes=finishes;
 if(name==='warmup'){assert.equal(creates.length,0);assert.equal(uploads.length,0);assert.equal(downloads.length,0);await page.locator('.export-error').filter({hasText:'No frames to save'}).waitFor();}
 else if(name==='cancel'){assert.equal(downloads.length,0);assert.equal(finishes.length,0);assert.equal(deletes.length,1);assert.equal((await page.request.get(origin+deletes[0])).status(),404);row.cancelRemovedEncoder=true;}
 else{
  await page.waitForFunction(()=>!!document.querySelector('.export-result'));assert.equal(downloads.length,1);assert.equal(creates.length,1);const settings=creates[0];assert.equal(settings.width,128);assert.equal(settings.height,96);assert.equal(settings.inputWidth,384);assert.equal(settings.inputHeight,288);assert.equal(settings.fps,4);
  assert.equal(uploads.length,frames.length);assert.equal(uploads.length,name==='manual'?1:['parameters','formulas'].includes(name)?10:4);const expected=[];
  for(let i=0;i<uploads.length;i++){assert.equal(uploads[i].index,i);const png=decodePng(uploads[i].bytes),bottom=native[i+1];assert.equal(png.width,384);assert.equal(png.height,288);assert.equal(bottom.length,384*288*4);const top=Buffer.alloc(bottom.length);for(let y=0;y<288;y++)bottom.copy(top,y*1536,(287-y)*1536,(288-y)*1536);const formula=frames[i].output.formulas;let composed=top;
   if(formula?.labels.length){assert.deepEqual(formula.labels,begin.result.warmup.formulas.labels);assert.equal(formula.layout,begin.result.warmup.formulas.layout);assert.equal(formula.primaryLogicalHeight,begin.result.warmup.formulas.primaryLogicalHeight);if(gpuMaterial)assert.deepEqual(formula.drawingViewport,frames[i].output.display.viewport);composed=Buffer.from(await page.evaluate(async({base,formula})=>{const{compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts');return Array.from(await compositeSourceFormulaPixels(Uint8ClampedArray.from(base),384,288,formula));},{base:Array.from(top),formula}));if(composed.equals(top)){
    assert.ok(gpuMaterial,'CPU fixture expects visible formula pixels');
    const bounds=await page.evaluate(async formula=>{const{prepareSourceFormulas}=await import('/src/engine/sourceFormulaCompositor.ts'),{sourceFormulaQuad}=await import('/src/engine/formulas.ts');const prepared=await prepareSourceFormulas(formula),[vx,vy,vw,vh]=formula.drawingViewport;return prepared.glyphs.map((glyph,i)=>{const q=sourceFormulaQuad(formula,formula.labels[i],384,288,glyph),xs=[],ys=[];for(let j=0;j<q.length;j+=2){xs.push(q[j]*2/384);ys.push(-q[j+1]*2/288);}const left=Math.max(-1,Math.min(...xs)),right=Math.min(1,Math.max(...xs)),bottom=Math.max(-1,Math.min(...ys)),upper=Math.min(1,Math.max(...ys));const rectangle=[vx+(left+1)*vw/2,vy+(bottom+1)*vh/2,vx+(right+1)*vw/2,vy+(upper+1)*vh/2];return{rectangle,clipped:left>=right||bottom>=upper||rectangle[2]<=0||rectangle[0]>=384||rectangle[3]<=0||rectangle[1]>=288};});},formula);
    assert.ok(bounds.length&&bounds.every(b=>b.clipped),'Formula did not contribute despite intersecting the framebuffer');(row.clippedFormulaFrames??=[]).push({index:i,viewport:formula.drawingViewport,bounds});
   }}
   for(let j=3;j<composed.length;j+=4)composed[j]=255;assert.deepEqual(png.rgba,composed);expected.push(composed);}
  const file=directory+'/'+name+'.mp4';await downloads[0].saveAs(file);row.video=verifyRecordingVideo(file,settings,expected,directory+'/'+name+'-raw-reference.mp4');
 }
 // Stop automatically resumes. Verify actual generated contexts, not just the icon.
 await page.waitForFunction(b=>window.__implicit.rows.filter(r=>r.request.sequence>b&&r.operation==='generate'&&r.output?.live?.renderKind==='update').length>=2,stop.request.sequence);
 if(name==='natural')await page.screenshot({path:directory+'/recording-saved.png'});
 const continuation=await page.evaluate(b=>window.__implicit.rows.filter(r=>r.request.sequence>b&&r.operation==='generate'),stop.request.sequence);
 assert.ok(continuation.every(r=>r.request.context.implicitLive?.sessionId===stop.result.context.implicitLive.sessionId));assert.equal(continuation[0].output.frame.frameIndex,stop.result.preview.frame.frameIndex+1);assert.ok(continuation[0].output.frame.rawDt<5);row.continuation=continuation.slice(0,2);
 await page.getByRole('button',{name:'Close export',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.waitForFunction(()=>window.__implicit.rows.some(r=>r.operation==='implicit-playback'&&r.request.paused===true));
 const paused=await page.evaluate(()=>window.__implicit.rows.filter(r=>r.operation==='generate').at(-1));
 await page.setViewportSize({width:1420,height:940});await page.waitForFunction(s=>window.__implicit.rows.some(r=>r.request.sequence>s&&r.output?.live?.renderKind==='snapshot'),paused.request.sequence);
 const snapshot=await page.evaluate(()=>window.__implicit.rows.filter(r=>r.output?.live?.renderKind==='snapshot').at(-1));assert.equal(snapshot.output.frame.sceneTime,paused.output.frame.sceneTime);assert.deepEqual(snapshot.output.frame.camera,paused.output.frame.camera);assert.deepEqual(snapshot.output.parameters,paused.output.parameters);
 if(['natural','parameters','formulas'].includes(name)){
  row.pngs=[];
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Implicit surface image source',exact:true}).inputValue(),'current');
  await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
  const save=async(width,height,scale,label)=>{
   await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(width));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(height));await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption(String(scale));await enabled('Start export');
   const count=downloads.length,delivered=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();await delivered;await enabled('Start export');assert.equal(downloads.length,count+1);
   const file=directory+'/'+name+'-'+label+'.png';await downloads.at(-1).saveAs(file);const bytes=await readFile(file),png=decodePng(bytes),facts=await page.evaluate(()=>window.__implicitCaptures.at(-1));
   if(gpuMaterial){assert.deepEqual(facts.formulas.drawingViewport,[0,0,Math.round(width/2)*2,Math.round(height/2)*2]);assert.equal(facts.previewDisplay.instance,snapshot.output.display.instance);assert.equal(facts.previewDisplay.rebuilt,false);}
   assert.equal(png.width,Math.round(width/2)*2*scale);assert.equal(png.height,Math.round(height/2)*2*scale);assert.deepEqual(facts.frame,snapshot.output.frame);assert.equal(facts.producer.backend,'native');
   // Checks delivery/composition of the actual held-state raster. This uses
   // the shared encoder; it is not an independent original-app PNG oracle.
   const expected=await page.evaluate(async()=>{const{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts');return Array.from(new Uint8Array(await(await encodeFormulaRaster(window.__implicitCapture.capture,'image/png')).arrayBuffer()));});assert.deepEqual(png.rgba,decodePng(Buffer.from(expected)).rgba);
   const fact={file,width:png.width,height:png.height,sha256:sha(bytes),...facts};row.pngs.push(fact);return fact;
  };
  const first=await save(65,49,1,'paused-odd'),again=await save(65,49,1,'paused-repeat');assert.equal(first.sha256,again.sha256);
  await save(128,96,3,'paused-upscale');
  let arrive,pendingRoute;const arrived=new Promise(resolve=>arrive=resolve);const beforeCancel=downloads.length;
  const held=async route=>{if(route.request().postDataBuffer().readUInt32LE(52)!==0){await route.fallback();return;}pendingRoute=route;arrive();};
  await page.route('**/api/source-renderer/frames',held);await page.getByRole('button',{name:'Start export',exact:true}).click();
  let timer;try{await Promise.race([arrived,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('No PNG capture to cancel')),30000))]);}finally{clearTimeout(timer);}
  await page.getByRole('button',{name:'Cancel export',exact:true}).click();await page.waitForFunction(()=>!!window.__implicitCaptureError);await pendingRoute.abort().catch(()=>{});await page.unroute('**/api/source-renderer/frames',held);assert.equal(downloads.length,beforeCancel);
  const recovered=await save(65,49,1,'paused-after-cancel');assert.equal(recovered.sha256,first.sha256);row.pngCancelRetained=true;
  await page.screenshot({path:directory+'/'+name+'-paused-png-dialog.png'});
  if(gpuMaterial){
   await page.getByRole('combobox',{name:'Implicit surface image source',exact:true}).selectOption('replay');await page.getByRole('combobox',{name:'Export format',exact:true}).selectOption('jpg');
   for(const [label,value]of [['Export width','64'],['Export height','48']])await page.getByRole('spinbutton',{name:label,exact:true}).fill(value);
   await enabled('Start export');const before=native.length,delivered=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await delivered;await enabled('Start export');
   const file=directory+'/'+name+'-replay.jpg';await download.saveAs(file);const bytes=await readFile(file);assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');assert.equal(native.length,before+1,'JPEG must consume an actual native mathematical frame');
   const dimensions=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}));const size={width:image.width,height:image.height};image.close();return size;},Array.from(bytes));assert.deepEqual(dimensions,{width:64,height:48});
   row.jpeg={file,...dimensions,sha256:sha(bytes),nativeFrameSha256:sha(native.at(-1)),scope:'Actual native route, JPEG decoding and dimensions; no lossy-JPEG original pixel parity claim.'};
  }
  await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(s=>window.__implicit.rows.some(r=>r.request.sequence>s&&r.output?.live?.renderKind==='update'),snapshot.request.sequence);row.pauseResizeResume=true;
 if(name==='cancel'){
  const count=downloads.length;await open();await page.getByRole('button',{name:'Start recording',exact:true}).click();await page.waitForFunction(()=>!!document.querySelector('.export-result'),undefined,{timeout:90000});assert.equal(downloads.length,count+1);await downloads.at(-1).saveAs(directory+'/cancel-retry.mp4');const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration','-of','json',directory+'/cancel-retry.mp4'],{encoding:'utf8'})).streams[0];assert.equal(Number(metadata.nb_read_frames),creates.at(-1).frames);assert.equal(metadata.width,128);assert.equal(metadata.height,96);assert.equal(metadata.r_frame_rate,'4/1');assert.equal(Number(metadata.duration),creates.at(-1).frames/4);row.retryVideo=metadata;row.retryCompleted=true;await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 if(name==='natural'){
  const pauseAfter=await page.evaluate(()=>window.__implicit.sequence);await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.waitForFunction(s=>window.__implicit.rows.some(r=>r.request.sequence>s&&r.operation==='implicit-playback'&&r.request.paused===true&&!r.error),pauseAfter);
  const beforeEdit=await page.evaluate(()=>window.__implicit.rows.filter(r=>r.operation==='generate'&&r.output?.frame?.viewport.target==='primary').at(-1));
  await page.getByRole('spinbutton',{name:'Export range · seconds',exact:true}).fill('7');
  await page.getByText('Unapplied changes; the animation continues using the running configuration.',{exact:true}).waitFor();
  const staged=await page.evaluate(()=>window.__implicit.rows.filter(r=>r.operation==='generate'&&r.output?.frame?.viewport.target==='primary').at(-1));
  assert.equal(staged.request.context.implicitLive.sessionId,beforeEdit.request.context.implicitLive.sessionId);assert.deepEqual(staged.output.implicitControls,beforeEdit.output.implicitControls);assert.equal(await page.getByRole('spinbutton',{name:'Export range · seconds',exact:true}).inputValue(),'7');
  row.editRequiresApply=true;const applyAfter=await page.evaluate(()=>window.__implicit.sequence);await page.getByRole('button',{name:'Apply scene',exact:true}).click();
  await page.waitForFunction(s=>window.__implicit.rows.some(r=>r.request.sequence>s&&r.operation==='generate'&&!r.request.context.implicitLive&&r.request.context.time===0),applyAfter);
  const applied=await page.evaluate(s=>window.__implicit.rows.find(r=>r.request.sequence>s&&r.operation==='generate'&&!r.request.context.implicitLive&&r.request.context.time===0),applyAfter);
  assert.ok(applied.output.implicitControls.applyRevision>beforeEdit.output.implicitControls.applyRevision);assert.ok(applied.output.implicitControls.resetRevision>beforeEdit.output.implicitControls.resetRevision);row.applyRetiresContinuation=true;
 }else{
  const seq=await page.evaluate(()=>window.__implicit.sequence);await page.getByTitle('Return to start',{exact:true}).click();await page.waitForFunction(s=>window.__implicit.rows.some(r=>r.request.sequence>s&&r.operation==='generate'&&!r.request.context.implicitLive&&r.request.context.time===0),seq);row.seekRetiresContinuation=true;
 }
 assert.deepEqual(row.errors,[]);assert.equal(await page.locator('.error-card').count(),0);await page.screenshot({path:directory+'/'+name+'.png'});row.status='passed';await page.close();console.log(JSON.stringify({name,status:row.status}));
}
try{
 service=await createExportServer({root:directory+'/service',allowedOrigins:[origin],sourceRendererBackend:JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND)),glyphBackend:JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json'))});const a=await service.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':'"native"'},server:{host:'127.0.0.1',port:5179,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${a.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 const available=['natural','manual','cancel','warmup','export','recovery','parameters','formulas'],selected=process.argv.slice(3).filter(a=>a!=='--gpu-material');const cases=selected.length?selected:available;assert.ok(new Set(cases).size===cases.length&&cases.every(name=>available.includes(name)));const measured=await measureFamily(process.pid,async()=>{for(const name of cases)await run(name);return{};});report.processFamily=measured.processFamily;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.failureAudit=await page.evaluate(()=>window.__implicit).catch(()=>null);report.body=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:directory+'/failure.png'}).catch(()=>{});}}
finally{for(const release of releases)release();const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.artifactErrors=[];for(const c of report.cases)for(const f of [...(c.pngs??[]),...(c.jpeg?[c.jpeg]:[])])try{if(sha(await readFile(f.file))!==f.sha256)report.artifactErrors.push(f.file+' changed after validation');}catch(e){report.artifactErrors.push(String(e));}if(report.artifactErrors.length)report.status='failed';report.elapsedMs=performance.now()-started;if(!report.sourceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error}));if(report.status!=='passed')process.exitCode=1;}
