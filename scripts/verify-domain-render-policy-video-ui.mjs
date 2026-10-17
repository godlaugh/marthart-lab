import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createExportServer} from '../server/index.mjs';

// Actual App controls, production worker outputs and encoded video are checked.
// One disclosed test-only worker drawArrays failure exercises recovery; the
// hooks never fabricate completion, route facts, pixels or encoded output.
const paths=[
 'server/index.mjs','src/engine/rasterDimensions.ts','src/engine/domainRenderPolicy.ts','src/engine/domainRenderSession.ts','src/engine/domainGpuFailure.ts','src/engine/domainParameterTimeline.ts','src/engine/domainParameterBinding.ts','src/engine/domainLevelCurve.ts','src/engine/domainSourceScalar.ts','src/i18n.tsx',
 'src/engine/oscillation.ts','src/scenes/domainExamples.generated.ts','src/scenes/domainExamples.recipes.json','src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/domainNativeParser.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParameters.ts','src/engine/domainNativeConstants.ts','src/engine/equationEditor.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/planeNavigation.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-render-policy-video-ui.mjs',
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const check=(value,message)=>{if(!value)throw Error(message);};
const attempt=Date.now();
await mkdir('.cache',{recursive:true});
const sourceBefore=await hashes(),report={at:new Date().toISOString(),scope:'Owned headless Chrome, actual App/ExportDialog, globally paired real worker completions, one test-only second-frame drawArrays exception, production ArtRenderer and local export-server FFmpeg encoding. Three-frame MP4 metadata and actual decoded frame count are checked. No original application execution, independent mathematical oracle, native parity or performance claim.',sourceSnapshotsBefore:sourceBefore};
let server,browser,page,error,exportServer;
const errors=[],checks={};
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const mark=()=>page.evaluate(()=>({issued:window.__audit.issued,completed:window.__audit.completionCount}));
const fresh=async(before,expected)=>{
 await page.waitForFunction(({before,expected})=>window.__audit.completed.some(item=>item.issuedSequence>before.issued&&item.completionSequence>before.completed&&window.__audit.matches(item,expected)),{before,expected});
 await ready();
 const row=await page.evaluate(({before,expected})=>{
  const item=window.__audit.completed.findLast(item=>item.issuedSequence>before.issued&&item.completionSequence>before.completed&&window.__audit.matches(item,expected));
  return{...item,before,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')};
 },{before,expected});
 check(row&&!row.rendering&&!row.error,'new request completed without a settled Ready App');
 return row;
};
try{
 exportServer=await createExportServer({root:'.cache/domain-render-policy-video-output',ffmpegPath:'/opt/homebrew/bin/ffmpeg',allowedOrigins:['http://127.0.0.1:5173']});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__audit={issued:0,completionCount:0,completed:[],errors:[],workersCreated:0,workersTerminated:0};
  window.__audit.faults=[];window.__audit.matches=(item,expected)=>{
   const scene=item.request.scene,s=scene.settings,f=item.output.domainRender;
   return (expected.route===undefined||f?.route===expected.route)&&(expected.policy===undefined||(s.domainRenderPolicy??'selected-rules-1723')===expected.policy)&&(expected.sticky===undefined||f?.sticky===expected.sticky)&&scene.kind==='domain'&&item.request.context.quality!=='export'&&(expected.id===undefined||scene.id===expected.id)&&(expected.name===undefined||scene.name===expected.name)&&(expected.formula===undefined||scene.equations.f===expected.formula)&&(expected.selectedBackend===undefined||s.domainBackend===expected.selectedBackend)&&(expected.backend===undefined||item.output.backend===expected.backend)&&(expected.color===undefined||(s.domainColorVersion??'local-v1')===expected.color)&&(expected.iteration===undefined||(s.domainIterationVersion??'local-v1')===expected.iteration)&&(expected.enabled===undefined||s.iterationEnabled===expected.enabled)&&(expected.steps===undefined||s.iterationSteps===expected.steps)&&(expected.maxSteps===undefined||s.iterationMaxSteps===expected.maxSteps)&&(expected.time===undefined||item.request.context.time===expected.time)&&(expected.viewport===undefined||(s.domainViewportVersion??'local-v1')===expected.viewport)&&(expected.settings===undefined||Object.entries(expected.settings).every(([key,value])=>s[key]===value));
  };
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;
   workerId=0;constructor(...args){super(...args);this.workerId=++window.__audit.workersCreated;this.addEventListener('message',({data})=>{
    if(data.operation==='policy-fault-audit'){window.__audit.faults.push(data);return;}if(data.operation!=='generate')return;
    if(data.error)window.__audit.errors.push(data.error);
    if(!data.output||data.progress)return;
    const sent=this.sent.get(data.id);if(!sent)return;
    const {pixels,...output}=data.output;let hash=2166136261;for(const v of pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}
    window.__audit.completed.push({...sent,completionSequence:++window.__audit.completionCount,output,pixelHash:hash>>>0});this.sent.delete(data.id);
    if(window.__audit.completed.length>48)window.__audit.completed.shift();
   });}
   postMessage(message,...args){
    if(message.operation==='generate'){
     const sent={workerId:this.workerId,request:structuredClone(message),issuedSequence:++window.__audit.issued};this.sent.set(message.id,sent);

    }
    return super.postMessage(message,...args);
   }
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 // Test-only worker bootstrap. Real production requests, GPU work, fallback,
 // Renderer and server encoding remain intact; only one draw operation throws.
 const faultHook=`\n{
  let currentRequest, injected=false;const originalMessage=self.onmessage;
  self.onmessage=function(event){currentRequest=event.data;return originalMessage.call(this,event);};
  const getContext=OffscreenCanvas.prototype.getContext;const wrapped=new WeakSet();
  OffscreenCanvas.prototype.getContext=function(...args){const gl=getContext.apply(this,args);if(args[0]==='webgl2'&&gl&&!wrapped.has(gl)){wrapped.add(gl);const draw=gl.drawArrays;gl.drawArrays=function(...values){if(!injected&&currentRequest?.operation==='generate'&&currentRequest.context.quality==='export'&&currentRequest.context.time>=1){injected=true;self.postMessage({operation:'policy-fault-audit',requestId:currentRequest.id,time:currentRequest.context.time,stage:'render',method:'drawArrays'});throw Error('Controlled second-frame draw failure');}return draw.apply(this,values);};}return gl;};
 }`;
 report.faultInjection={scope:'Test-only appended worker bootstrap overrides drawArrays once on the second export time. No output or completion is fabricated.',sha256:sha(faultHook),text:faultHook};
 await page.route('**/src/engine/generate.worker.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+faultHook});});
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{translate}=await import('/src/i18n.tsx');
  const def=definition('domain'),scene=createScene(def,def.presets.find(p=>p.id==='cubic'));scene.name='Registry initial local fixture';scene.settings.domainBackend='cpu';
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return {initial:scene,examples:def.presets.filter(p=>p.id.startsWith('guide-domain-')).map(p=>({label:translate('en',p.name),scene:createScene(def,p),assumptions:(p.document?.provenance?.reference?.assumptions??[]).map(x=>translate('en',x))})),oldIds:def.presets.filter(p=>!p.id.startsWith('guide-domain-')).map(p=>p.id)};
 });report.fixture=fixture;
 const content=scene=>JSON.stringify({kind:scene.kind,equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,domainSourcePalette:scene.domainSourcePalette,timeline:scene.timeline,formulas:scene.formulas,provenance:scene.provenance});
 const installRendererAudit=()=>page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}const completed=window.__audit.completed.findLast(x=>x.request.scene.id===scene.id&&x.pixelHash===(hash>>>0));window.__renderAudit.outputs.push({id,issuedSequence:completed?.issuedSequence,completionSequence:completed?.completionSequence,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,parameters:structuredClone(scene.parameters),settings:structuredClone(scene.settings),viewport:scene.settings.domainViewportVersion,iteration:scene.settings.domainIterationVersion,pixelHash:hash>>>0,domainRender:structuredClone(output.domainRender)});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 const rendered=async row=>{
  await page.waitForFunction(row=>window.__renderAudit.outputs.some(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
  return page.evaluate(row=>window.__renderAudit.outputs.findLast(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
 };
 const seek=async(id,time)=>{const before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));return fresh(before,{id,time});};
 await page.goto(origin);checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.initial.id,selectedBackend:'cpu',iteration:'local-v1'});await installRendererAudit();



 const native={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Three-frame GPU failure export',settings:{render_mode:'GPU'},domainColoring:{formula:'sin(z)+0.25*z'},viewport:{scale:2.5},timeline:[{type:'wait',duration:3}]};
 let before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'three-frame.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(native))});
 const imported=await fresh(before,{name:native.name,route:'selected',backend:'webgl2',policy:'source-cpu-on-gpu-failure-v1'}),id=imported.request.scene.id;await rendered(imported);checks.import=imported;
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('64');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('48');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'Export duration',exact:true}).fill('3');
 await page.getByRole('button',{name:'Start export',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.export-modal .primary-button')?.disabled);
 before=await mark();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await downloadPromise;await download.saveAs('.cache/domain-render-policy-video-ui.mp4');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const frames=await page.evaluate(({before,id})=>window.__audit.completed.filter(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&x.request.scene.id===id&&x.request.context.quality==='export'),{before,id});
 check(frames.length===3,'actual export did not complete exactly three requests');check(frames.every((x,i)=>x.request.context.time===i),'export time sequence differs');check(new Set(frames.map(x=>x.workerId)).size===1,'video did not keep one export worker');
 const f=frames.map(x=>x.output.domainRender);check(f[0].route==='selected'&&f[0].effective.backend==='webgl2','first exported frame is not GPU');check(f[1].route==='source-cpu-failure'&&f[1].trigger.stage==='render'&&!f[1].sticky,'second frame did not perform actual CPU-chain recovery');check(f[2].route==='source-cpu-failure'&&f[2].sticky,'third frame did not reuse CPU-chain failure');
 check(f.slice(1).every(x=>['formula','color','viewport'].every(k=>x.effective[k]==='mathart-1.7.8-cpu')),'video failure did not switch all three rules');
 const summary=await page.getByTestId('domain-export-rendering').innerText();check(summary.includes('Completed frames 1–1')&&summary.includes('Completed frames 2–3')&&summary.includes('first and last')&&summary.includes('Completed image: GPU')&&summary.includes('Completed image: CPU'),'actual multi-route summary does not identify first/last completed frames');
 const faults=await page.evaluate(()=>window.__audit.faults);check(faults.length===1&&faults[0].time===1,'controlled draw did not fail exactly once');
 const renders=await page.evaluate(frames=>window.__renderAudit.outputs.filter(x=>x.width===64&&x.height===48&&frames.some(frame=>frame.issuedSequence===x.issuedSequence&&frame.completionSequence===x.completionSequence&&frame.pixelHash===x.pixelHash)),frames);check(renders.length===3&&new Set(renders.map(x=>x.id)).size===1,'actual video renderer did not consume all three frame outputs');
 const metadata=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json','.cache/domain-render-policy-video-ui.mp4'],{encoding:'utf8'}));
 const video=metadata.streams.find(x=>x.codec_type==='video');check(video&&video.width===64&&video.height===48&&Number(video.nb_read_frames)===3&&Number(metadata.format.duration)>=3,'encoded output did not decode three requested frames');
 const decoded=execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i','.cache/domain-render-policy-video-ui.mp4','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{maxBuffer:1024*1024});check(decoded.length===3*64*48*4,'video cannot decode all three frames');
 checks.sequence={before,frames,summary,faults,renders};checks.encoded={metadata,decodedBytes:decoded.length,decodedSha256:sha(decoded),scope:'Lossy MP4 is decoded and counted; no pixel equality claim against uncompressed PNGs.'};
 await page.screenshot({path:'.cache/domain-render-policy-video-ui.png'});await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));check(audit.renderAudit.disposed.includes(renders[0].id),'actual video renderer not disposed');check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'video UI did not settle cleanly');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during video UI');const bytes=await readFile('.cache/domain-render-policy-video-ui.mp4');
 Object.assign(report,{status:'passed',checks,audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,video:{path:'.cache/domain-render-policy-video-ui.mp4',sha256:sha(bytes),bytes:bytes.length},limitations:['One injected drawArrays exception in the real export worker. This is not a measured hardware failure rate or original application execution.','Only three frames and two routes are covered. The 16-distinct-route display cap and recurrence of a nonadjacent route are not exercised.','MP4 decoding/count/dimensions are checked; lossy encoded pixels are not claimed equal to PNG source pixels.','No performance measurement or original/runtime/cross-device parity claim.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-render-policy-video-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);
 report.cleanup={exportServerClosed:exportServer?!exportServer.server.listening:true,exportOwnedProcesses:exportServer?.ownedProcessCount??0,browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-render-policy-video-ui-failure-${attempt}.json`:'.cache/domain-render-policy-video-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
