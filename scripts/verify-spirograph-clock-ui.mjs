import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createExportServer} from '../server/index.mjs';
// Only owned local Chromium and our App run. Worker/renderer hooks observe
// real requests and outputs; they never supply simulated pixels or completion.
const paths=['src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/SpirographEditor.tsx','src/components/Timeline.tsx','src/components/Fields.tsx','src/engine/document.ts','src/engine/legacyImport.ts','src/engine/spirographAuthoring.ts','src/engine/spirographModel.ts','src/scenes/spirograph.ts','src/scenes/particles.ts','src/scenes/spirographExamples.recipes.json','src/scenes/spirographExamples.generated.ts','src/engine/timeline.ts','src/engine/client.ts','src/engine/generate.worker.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/temporal.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts','src/engine/rasterDimensions.ts','src/i18n.tsx','src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','server/index.mjs','src/engine/spirographReplay.ts','src/engine/spirographFramePlan.ts','src/engine/spirographFrameConfig.ts','src/engine/sourceEasing.ts','src/engine/scenePlayback.ts','src/engine/simulationClock.ts','scripts/verify-spirograph-clock-ui.mjs'];
const sha=x=>createHash('sha256').update(x).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))]))),check=(v,m)=>{if(!v)throw Error(m);};
await mkdir('.cache',{recursive:true});const attempt=Date.now(),beforeHashes=await hashes(),checks={},errors=[];
const report={at:new Date().toISOString(),scope:'Actual App source-clock import, offline simulation FPS, selected-frame events, Save/reload, paired PNG, fresh/current recording forks, actual MP4 encoding and zero-output diagnostic. Passive worker/renderer hooks observe real requests, facts and outputs; no simulated completion/pixels, no fault injection, no original app/JVM execution or native live-clock/pixel-equivalence claim.',sourceSnapshotsBefore:beforeHashes};
let server,browser,page,exportServer,error;
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const mark=()=>page.evaluate(()=>({issued:window.__audit.issued,completed:window.__audit.completionCount}));
const fresh=async(before,expected)=>{
 await page.waitForFunction(({before,expected})=>window.__audit.completed.some(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&window.__audit.matches(x,expected)),{before,expected});await ready();
 return page.evaluate(({before,expected})=>window.__audit.completed.findLast(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&window.__audit.matches(x,expected)),{before,expected});
};
const content=s=>JSON.stringify({settings:s.settings,timeline:s.timeline,equations:s.equations,parameters:s.parameters,palette:s.palette,provenance:s.provenance,events:s.spirographFrameEvents});
try{
 exportServer=await createExportServer({root:'.cache/spirograph-clock-ui-output',ffmpegPath:'/opt/homebrew/bin/ffmpeg',allowedOrigins:['http://127.0.0.1:5173']});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__audit={issued:0,completionCount:0,completed:[],errors:[],workersCreated:0,workersTerminated:0,plans:[]};
  window.__audit.matches=(x,e)=>x.request.scene.kind==='spirograph'&&x.request.context.quality!=='export'&&(e.id===undefined||x.request.scene.id===e.id)&&(e.name===undefined||x.request.scene.name===e.name)&&(e.time===undefined||x.request.context.time===e.time)&&(e.settings===undefined||Object.entries(e.settings).every(([k,v])=>x.request.scene.settings[k]===v));
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;workerId=0;
   constructor(...args){super(...args);this.workerId=++window.__audit.workersCreated;this.addEventListener('message',({data})=>{
    if(data.operation==='spirograph-recording-plan'){const sent=this.sent.get(data.id);window.__audit.plans.push({...sent,result:data.result,error:data.error});this.sent.delete(data.id);return;}if(data.operation!=='generate')return;if(data.error)window.__audit.errors.push(data.error);if(!data.output||data.progress)return;
    const sent=this.sent.get(data.id);if(!sent)return;const{pixels,positions,colors,...output}=data.output;let hash=2166136261;for(const v of pixels??new Uint8Array(positions?.buffer??new ArrayBuffer(0))){hash^=v;hash=Math.imul(hash,16777619);}
    window.__audit.completed.push({...sent,output,pixelHash:hash>>>0,completionSequence:++window.__audit.completionCount});this.sent.delete(data.id);if(window.__audit.completed.length>128)window.__audit.completed.shift();
   });}
   postMessage(message,...args){if(message.operation==='generate'||message.operation==='spirograph-recording-plan')this.sent.set(message.id,{workerId:this.workerId,request:structuredClone(message),issuedSequence:++window.__audit.issued});return super.postMessage(message,...args);}
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{translate}=await import('/src/i18n.tsx');const def=definition('spirograph'),initial=createScene(def,def.presets.find(p=>p.id==='hypotrochoid'));
  saveWorkspace(localStorage,{scenes:[initial],active:initial.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return{initial,examples:def.presets.filter(p=>p.id.startsWith('guide-spirograph-')).map(p=>({label:translate('en',p.name),scene:createScene(def,p)})),oldIds:def.presets.filter(p=>!p.id.startsWith('guide-spirograph-')).map(p=>p.id)};
 });report.fixture=fixture;
 const installRendererAudit=()=>page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}const done=window.__audit.completed.findLast(x=>x.request.scene.id===scene.id&&x.pixelHash===(hash>>>0));window.__renderAudit.outputs.push({id,issuedSequence:done?.issuedSequence,completionSequence:done?.completionSequence,pixelHash:hash>>>0,sceneId:scene.id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,settings:structuredClone(scene.settings),runtimeRadians:scene.evaluatedSpirographRotationRadians,frame:structuredClone(output.spirographFrame)});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this));return result;};
 });
 const rendered=async row=>{await page.waitForFunction(r=>window.__renderAudit.outputs.some(x=>x.issuedSequence===r.issuedSequence&&x.completionSequence===r.completionSequence),row);return page.evaluate(r=>window.__renderAudit.outputs.findLast(x=>x.issuedSequence===r.issuedSequence&&x.completionSequence===r.completionSequence),row);};
 const seek=async(id,time)=>{const m=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));const row=await fresh(m,{id,time});await rendered(row);return row;};
 await page.goto(origin);checks.initial=await fresh({issued:0,completed:0},{id:fixture.initial.id});await installRendererAudit();

 // The initial saved local preset is intentionally not upgraded. Imported
 // source data is the only implicit new-clock entry used by this verifier.
 check(checks.initial.request.scene.settings.spirographClock===undefined,'saved local artwork was upgraded');
 await page.locator('.category-grid').getByRole('button',{name:'Spirograph',exact:true}).click();
 const guide=fixture.examples[0];let m=await mark();
 await page.locator('.preset-card').filter({has:page.locator('strong',{hasText:guide.label})}).click();
 let row=await fresh(m,{id:guide.scene.id,time:0});await rendered(row);
 check(row.request.scene.settings.spirographClock==='source-frame-v1'&&row.request.scene.settings.spirographSimulationFps===60,'new guide did not select explicit offline clock');checks.guide=row;
 const native={config_version:'1.0.0',type:'SPIROGRAPH',name:'Actual offline Spirograph clock',settings:{sceneTransform:{offsetX:4,offsetY:6,rotationDegrees:90,scale:1},startEaseEnabled:false,endEaseEnabled:false,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,layers:[{statorRadius:30,penDistance:12,speed:1,rotors:[{radius:10,mode:'INSIDE'}],strokeColor:'#2E8B57',showGuides:false}]},timeline:[{type:'wait',label:'Initial hold',duration:1},{type:'animate',label:'Ramp rotation',duration:1,easing:'LINEAR',actions:[{method:'spirographRotate',args:[1]}]},{type:'wait',label:'Final hold',duration:1}]};
 await writeFile('.cache/spirograph-clock-ui-input.json',JSON.stringify(native,null,2));m=await mark();
 await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'offline-clock.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(native))});
 row=await fresh(m,{name:native.name,time:0});const id=row.request.scene.id;await rendered(row);
 check(row.request.scene.settings.spirographClock==='source-frame-v1'&&row.request.scene.settings.spirographSimulationFps===60,'fresh import clock not explicit');
 check(JSON.stringify(row.request.scene.provenance.original)===JSON.stringify(native),'source input changed');
 check(row.output.spirographFrame.frame===0&&row.output.spirographFrame.phases[0]===0,'frame zero advanced');
 checks.import=row;
 for(const selector of ['#control-scaleZ','#control-offsetZ','#control-easeDuration'])check(await page.locator(selector).count()===0,'ignored source control visible: '+selector);
 check(await page.getByRole('combobox',{name:'Playback mode',exact:true}).count()===0,'frame-clock loop control visible');
 check(await page.getByRole('button',{name:'Convert to absolute timeline',exact:true}).count()===0,'frame-clock absolute conversion visible');
 check(await page.getByLabel('Draw layers over time',{exact:true}).count()===0,'legacy full-preview toggle visible');
 const clock=page.getByRole('combobox',{name:'Spirograph clock',exact:true});
 m=await mark();await clock.selectOption('compatible');row=await fresh(m,{id});await rendered(row);
 check(row.request.scene.settings.spirographClock===undefined,'clock disable not saved');const compatible=structuredClone(row.request.scene);
 check(await page.getByRole('combobox',{name:'Playback mode',exact:true}).count()===1,'compatible playback control missing');checks.compatible=row;
 m=await mark();await clock.selectOption('source-frame-v1');row=await fresh(m,{id,settings:{spirographClock:'source-frame-v1'}});await rendered(row);
 check(JSON.stringify(row.request.scene.timeline)===JSON.stringify(compatible.timeline)&&row.request.scene.settings.rotation===90&&row.request.scene.settings.offsetY===6,'clock activation rewrote authored timeline/units');
 checks.twoFps=[];
 for(const fps of [2,4]){
  m=await mark();await page.getByRole('spinbutton',{name:'Spirograph simulation FPS',exact:true}).fill(String(fps));row=await fresh(m,{id,settings:{spirographSimulationFps:fps}});await rendered(row);
  // Change the selected time even when it was already .5 in the previous case.
  if(row.request.context.time===.5)await seek(id,0);
  row=await seek(id,.5);const frame=row.output.spirographFrame;
  check(frame.absoluteFrame===fps/2&&frame.rawDt===Math.fround(1/fps),'selected time was not mapped to the declared offline FPS');
  check(frame.phases[0]===30&&frame.rotationRadians===0,'simple no-easing half-second source state differs');
  checks.twoFps.push({row,presentation:await rendered(row)});
 }
 checks.events=[];
 for(const [button,type]of [['Clear trace','clear'],['Finish trace','finish'],['Restart','restart']]){
  m=await mark();await page.getByRole('button',{name:button,exact:true}).click();row=await fresh(m,{id,time:.5});await rendered(row);
  const list=row.request.scene.spirographFrameEvents;check(list.length===checks.events.length+1&&list.at(-1).beforeFrame===2&&list.at(-1).type===type,'button did not target the completed frame');
  check(row.request.scene.settings.traceFinishTime===undefined&&row.request.scene.settings.traceClearTime===undefined,'frame button wrote legacy timestamps');
  checks.events.push(row);
 }
 check(row.output.spirographFrame.closed[0]===false&&row.output.spirographFrame.phases[0]===15,'same-frame last restart command did not win before update');
 const eventFrames=JSON.stringify(row.request.scene.spirographFrameEvents);
 m=await mark();await page.getByRole('spinbutton',{name:'Spirograph simulation FPS',exact:true}).fill('2');row=await fresh(m,{id,settings:{spirographSimulationFps:2}});await rendered(row);
 check(JSON.stringify(row.request.scene.spirographFrameEvents)===eventFrames,'FPS edit changed event identity');checks.eventsAtTwoFps=row;
 m=await mark();await page.getByRole('spinbutton',{name:'Spirograph simulation FPS',exact:true}).fill('4');row=await fresh(m,{id,settings:{spirographSimulationFps:4}});await rendered(row);
 const beforeBackseek=row;await seek(id,.25);row=await seek(id,.5);check(row.pixelHash===beforeBackseek.pixelHash&&JSON.stringify(row.output.spirographFrame)===JSON.stringify(beforeBackseek.output.spirographFrame),'reverse seek changed selected frame');checks.reverseSeek=row;
 const savedContent=content(row.request.scene);m=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();const saved=await fresh(m,{id});check(content(saved.request.scene)===savedContent,'Save changed authoring');
 await page.reload();row=await fresh({issued:0,completed:0},{id,time:0});check(content(row.request.scene)===savedContent,'reload changed saved clock/events');checks.saveReload={saved,reloaded:row};await installRendererAudit();row=await seek(id,.5);checks.selectedFrame=row;
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 m=await mark();let downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();let download=await downloadPromise;await download.saveAs('.cache/spirograph-clock-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({m,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>m.issued&&x.completionSequence>m.completed&&x.request.scene.id===id&&x.request.context.quality==='export'),{m,id});
 check(exported.request.context.spirographFrame.frame===2&&exported.output.spirographFrame.absoluteFrame===2,'PNG did not use the completed selected frame');
 check(exported.output.spirographFrame.encodedFrames===0&&exported.output.spirographFrame.phases[0]===row.output.spirographFrame.phases[0],'PNG advanced the selected simulation');
 const exportRenderer=await rendered(exported),png=await readFile('.cache/spirograph-clock-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193,'PNG dimensions');
 const oracle=await page.evaluate(async({request,actualPng})=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{withSpirographReplayFrame}=await import('/src/engine/spirographFramePlan.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');const g=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
  const decode=async blob=>{const b=await createImageBitmap(blob),c=document.createElement('canvas');c.width=b.width;c.height=b.height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();return ctx.getImageData(0,0,c.width,c.height).data;};
  try{const out=await g.generate(request.scene,request.context),frame=withSpirographReplayFrame(request.scene,out.spirographFrame);renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(out,frame,false,outputCamera(frame,out));const blob=await renderer.blob('image/png'),expected=await decode(blob),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));let changed=0,max=0;const colors=new Set();for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d)changed++;max=Math.max(max,d);if(i%4===0)colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);}return{changedChannels:changed,maxDifference:max,distinctRgb:colors.size,decodedBytes:actual.length,frame:out.spirographFrame};}finally{g.dispose();renderer.dispose();}
 },{request:exported.request,actualPng:png.toString('base64')});
 check(oracle.changedChannels===0&&oracle.maxDifference===0&&oracle.distinctRgb>2,'PNG differs from cold production or is blank');checks.png={exported,renderer:exportRenderer,oracle,sha256:sha(png),bytes:png.length};await page.getByRole('button',{name:'Close export',exact:true}).click();
 // Queue [wait 1, rotate 1, wait 1] at 2 simulation FPS: fresh takes
 // six updates; current frame 2 at preview FPS 4 starts with .5 s already
 // spent in the first wait, so five remain. Each excludes one warmup update.
 checks.videos=[];const videoRenders=[];
 for(const [start,expectedFrames,startFrame]of [['fresh',5,0],['current',4,2]]){
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('64');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('48');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('3');await page.getByRole('spinbutton',{name:'Recording simulation FPS',exact:true}).fill('2');await page.getByRole('combobox',{name:'Recording start',exact:true}).selectOption(start);
  check(await page.getByRole('spinbutton',{name:'Export duration',exact:true}).count()===0,'source video exposes ignored duration');await page.waitForFunction(()=>!document.querySelector('.export-modal .primary-button')?.disabled);
  m=await mark();downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();download=await downloadPromise;const path=`.cache/spirograph-clock-ui-${start}.mp4`;await download.saveAs(path);await page.getByText('File ready · Download',{exact:false}).waitFor();
  const audit=await page.evaluate(({m,id})=>({frames:window.__audit.completed.filter(x=>x.issuedSequence>m.issued&&x.completionSequence>m.completed&&x.request.scene.id===id&&x.request.context.quality==='export'),plan:window.__audit.plans.findLast(x=>x.issuedSequence>m.issued&&x.request.scene.id===id)}),{m,id});
  check(audit.plan.result.encodedFrames===expectedFrames&&audit.plan.request.startFrame===startFrame&&audit.plan.request.fps===2,'recording plan did not capture expected current/fresh state');
  check(audit.frames.length===expectedFrames,'encoded request count does not match independent bounded queue');
  for(const [index,frame]of audit.frames.entries()){
   const request=frame.request.context.spirographFrame,facts=frame.output.spirographFrame;
   check(request.frame===index+2&&request.recording.startFrame===startFrame&&request.recording.fps===2,'warmup was encoded or recording identity changed');
   check(facts.frame===index+2&&facts.absoluteFrame===startFrame+index+2&&facts.encodedFrameIndex===index,'delivered recording facts differ from request');
   check(facts.recordingFinished===(index===expectedFrames-1),'recording terminal flag differs');videoRenders.push(await rendered(frame));
  }
  const metadata=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',path],{encoding:'utf8'})),video=metadata.streams.find(x=>x.codec_type==='video');
  check(video.width===64&&video.height===48&&Number(video.nb_read_frames)===expectedFrames&&video.r_frame_rate==='3/1','video encoding dimensions/rate/count differ');
  const decoded=execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgba','pipe:1'],{maxBuffer:1024*1024});check(decoded.length===expectedFrames*64*48*4,'video not fully decodable');
  checks.videos.push({start,expectedFrames,simulationFps:2,encodedFps:3,...audit,metadata,decodedBytes:decoded.length,decodedSha256:sha(decoded),fileSha256:sha(await readFile(path))});await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 // Queue already complete: a current-state fork may warm up but cannot invent
 // an encoded frame. Verify no export server session or image request starts.
 row=await seek(id,3);check(row.output.spirographFrame.queueFinished,'zero-output fixture queue not complete');
 let exportSessions=0;const countExport=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/exports')exportSessions++;};page.on('request',countExport);
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Recording start',exact:true}).selectOption('current');await page.getByRole('spinbutton',{name:'Recording simulation FPS',exact:true}).fill('2');await page.waitForFunction(()=>!document.querySelector('.export-modal .primary-button')?.disabled);
 m=await mark();await page.getByRole('button',{name:'Start export',exact:true}).click();const errorText='The Spirograph queue ended during recording warmup, leaving no frames to encode. Extend the queue or record from the initial state.';await page.getByRole('alert').filter({hasText:errorText}).waitFor();
 const zero=await page.evaluate(({m,id})=>({frames:window.__audit.completed.filter(x=>x.issuedSequence>m.issued&&x.request.scene.id===id&&x.request.context.quality==='export'),plan:window.__audit.plans.findLast(x=>x.issuedSequence>m.issued&&x.request.scene.id===id)}),{m,id});
 check(zero.plan.result.encodedFrames===0&&zero.frames.length===0&&exportSessions===0,'zero-output recording fabricated output or created an encoding session');checks.zeroOutput={...zero,exportSessions,errorText};page.off('request',countExport);await page.screenshot({path:'.cache/spirograph-clock-ui-zero-output.png'});await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
 await page.getByRole('combobox',{name:'Spirograph clock',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/spirograph-clock-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,plans:window.__audit.plans,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(audit.renderAudit.disposed.includes(exportRenderer.id)&&videoRenders.every(x=>audit.renderAudit.disposed.includes(x.id)),'actual export renderer not disposed');check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'UI not settled cleanly');const after=await hashes();check(JSON.stringify(after)===JSON.stringify(beforeHashes),'source changed during UI verification');
 Object.assign(report,{status:'passed',checks,audit,sourceSnapshots:after,sourceStable:true,limitations:['Frame/queue counts for the bounded 1+1+1 second case are independently calculated; this is not original live-clock execution.','Cold Generator/ArtRenderer PNG comparison establishes production export consistency, not independent native renderer parity.','MP4 decoding verifies dimensions, frame count and encoded FPS; lossy encoded pixels are not asserted equal to uncompressed frames.','One device with small examples; no performance, whole-process or VRAM claim.']});
}catch(e){error=e;Object.assign(report,{status:'failed',error:String(e),errorStack:e?.stack,completedChecksBeforeFailure:checks});if(page&&!page.isClosed()){const screenshot=`.cache/spirograph-clock-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{const results=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,exportServerClosed:exportServer?!exportServer.server.listening:true,exportOwnedProcesses:exportServer?.ownedProcessCount??0,errors:results.flatMap(r=>r.status==='rejected'?[String(r.reason)]:[])};if(report.cleanup.errors.length){error??=Error('cleanup failed');report.status='failed';}const path=error?`.cache/spirograph-clock-ui-failure-${attempt}.json`:'.cache/spirograph-clock-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));}
if(error)throw error;
