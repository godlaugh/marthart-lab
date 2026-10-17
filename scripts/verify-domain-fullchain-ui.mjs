import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity; they do not replace or alter generation.
const paths=[
 'src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-fullchain-ui.mjs',
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const check=(value,message)=>{if(!value)throw Error(message);};
const attempt=Date.now();
await mkdir('.cache',{recursive:true});
const sourceBefore=await hashes(),report={at:new Date().toISOString(),scope:'Owned headless Chrome, actual local App controls, globally paired worker completions, downloaded PNG and independent cold Generator plus production ArtRenderer. No original application runtime, native parity or performance claim.',sourceSnapshotsBefore:sourceBefore};
let server,browser,page,error;
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
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__audit={issued:0,completionCount:0,completed:[],errors:[],workersCreated:0,workersTerminated:0};
  window.__audit.matches=(item,expected)=>item.request.scene.id===expected.id&&item.request.scene.kind==='domain'&&item.request.scene.equations.f===expected.formula&&item.request.scene.settings.domainBackend===expected.selectedBackend&&item.output.backend===expected.backend&&item.request.context.quality!=='export'&&(expected.mode===undefined||item.request.scene.palette.mode===expected.mode)&&(expected.phaseDensity===undefined||item.request.scene.settings.phaseDensity===expected.phaseDensity)&&(expected.stop===undefined||item.request.scene.palette.stops[0]===expected.stop)&&(expected.time===undefined||item.request.context.time===expected.time);
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;
   constructor(...args){super(...args);window.__audit.workersCreated++;this.addEventListener('message',({data})=>{
    if(data.operation!=='generate')return;
    if(data.error)window.__audit.errors.push(data.error);
    if(!data.output||data.progress)return;
    const sent=this.sent.get(data.id);if(!sent)return;
    const {pixels,...output}=data.output;let hash=2166136261;for(const v of pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}
    window.__audit.completed.push({...sent,completionSequence:++window.__audit.completionCount,output,pixelHash:hash>>>0});this.sent.delete(data.id);
    if(window.__audit.completed.length>48)window.__audit.completed.shift();
   });}
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{request:structuredClone(message),issuedSequence:++window.__audit.issued});return super.postMessage(message,...args);}
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 await page.route('**/api/health',route=>route.fulfill({status:503,contentType:'text/plain',body:'No export service in this browser test; use production PNG Blob fallback.'}));
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('domain'));scene.name='Domain full GPU UI';scene.settings.domainBackend='cpu';
  scene.palette={name:'UI discrete',mode:'linear',stops:['#f04666','#1adbc5','#3b4df5'],offset:.07,cycles:1.3};
  scene.timeline.duration=2;scene.timeline.tracks=[{id:'ui-gradient',type:'animate',target:'settings.paletteOffset',from:0,to:0,start:0,duration:0,easing:'linear',pingPong:false,enabled:true,actions:[{id:'ui-gradient-start',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',speed:90,interpolation:'oklab',affectInside:true,affectOutside:true}}]}];
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });
 report.fixture=fixture;
 await page.goto(origin);
 const initial=await fresh({issued:0,completed:0},{id:fixture.id,formula:'z^3-1',selectedBackend:'cpu',backend:'cpu'});checks.initialCpu=initial;
 // Observe the production renderer after boot. Both viewport and ExportDialog
 // still execute their original setOutput/dispose methods without substitution.
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id){ids.set(this,id=++next);}let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__renderAudit.outputs.push({id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,formula:scene.equations.f,paletteOffset:scene.settings.paletteOffset,evaluatedGradient:scene.evaluatedDomainGradient,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 let before=await mark();await page.locator('#control-domainBackend').selectOption('gpu');
 const gpu=await fresh(before,{id:fixture.id,formula:'z^3-1',selectedBackend:'gpu',backend:'webgl2'});checks.selectGpu=gpu;
 before=await mark();await page.getByRole('textbox',{name:'f(z)',exact:true}).fill('sin(z)+0.25*z');await page.getByRole('button',{name:'Apply equations',exact:true}).click();
 const formula=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2'});check(formula.pixelHash!==gpu.pixelHash,'formula edit did not change the completed image');checks.formulaEdit=formula;
 await page.getByRole('button',{name:'Appearance',exact:true}).click();
 before=await mark();await page.getByRole('combobox',{name:'Palette mode',exact:true}).selectOption('hsv');
 const palette=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2',mode:'hsv'});check(palette.pixelHash!==formula.pixelHash,'HSV edit did not change completed image');checks.paletteModeEdit=palette;
 await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
 before=await mark();await page.locator('#control-phaseDensity').fill('7.5');
 const contour=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2',mode:'hsv',phaseDensity:7.5});check(contour.pixelHash!==palette.pixelHash,'contour edit did not change completed image');checks.contourEdit=contour;
 await page.getByRole('button',{name:'Appearance',exact:true}).click();
 before=await mark();await page.getByRole('combobox',{name:'Palette mode',exact:true}).selectOption('linear');
 checks.restoreDiscrete=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2',mode:'linear',phaseDensity:7.5});
 const stopColor=page.getByLabel('Stop color',{exact:true});check(await stopColor.count()===1,'test selector must identify exactly one selected stop color');
 before=await mark();await stopColor.fill('#e2b714');
 checks.stopEdit=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2',mode:'linear',phaseDensity:7.5,stop:'#e2b714'});
 before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).press('End');
 const atTime=await fresh(before,{id:fixture.id,formula:'sin(z)+0.25*z',selectedBackend:'gpu',backend:'webgl2',mode:'linear',phaseDensity:7.5,stop:'#e2b714',time:2});
 check(atTime.pixelHash!==checks.stopEdit.pixelHash,'actual timeline seek did not change the gradient output');checks.timelineSeek=atTime;
 await page.waitForFunction(()=>window.__renderAudit.outputs.some(x=>x.sceneId===window.__audit.completed.at(-1)?.request.scene.id&&x.pixelHash===window.__audit.completed.at(-1)?.pixelHash&&x.evaluatedGradient?.running===true&&x.paletteOffset===.5));
 await page.locator('[data-testid="art-canvas"]').screenshot({path:'.cache/domain-fullchain-ui-preview.png'});
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-fullchain-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id:fixture.id});
 check(exported?.output.backend==='webgl2'&&exported.request.context.time===2,'PNG export did not complete the actual selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.evaluatedGradient?.running===true&&exportRenderer.paletteOffset===.5,'actual export renderer did not consume evaluated gradient/time');
 const png=await readFile('.cache/domain-fullchain-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'downloaded PNG dimensions/content invalid');
 const oracle=await page.evaluate(async({request,actualPng})=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const g=new Generator(),canvas=document.createElement('canvas'),renderer=new ArtRenderer(canvas);
  const pixelHash=pixels=>{let h=2166136261;for(const v of pixels){h^=v;h=Math.imul(h,16777619);}return h>>>0;};
  const decode=async blob=>{const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const context=c.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,c.width,c.height).data;};
  let result;
  try{
   // The exact submitted authored scene AND time are replayed. Evaluated
   // gradient facts are re-created only by the same production timeline owner.
   const out=await g.generate(request.scene,request.context),frame=sceneAtTime(request.scene,request.context.time);
   renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(out,frame,false,outputCamera(frame,out));
   const blob=await renderer.blob('image/png'),expected=await decode(blob),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
   if(expected.length!==actual.length)throw Error('decoded PNG lengths differ');
   let maxDifference=0,changedChannels=0,opaque=0;const colors=new Set();
   for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);maxDifference=Math.max(maxDifference,d);if(d)changedChannels++;if(i%4===3&&actual[i])opaque++;if(i%4===0)colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);}
   const bytes=new Uint8Array(await blob.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
   result={backend:out.backend,width:out.width,height:out.height,workerPixelHash:pixelHash(out.pixels),decodedActualHash:pixelHash(actual),decodedExpectedHash:pixelHash(expected),maxDifference,changedChannels,opaquePixels:opaque,distinctRgb:colors.size,evaluatedGradient:frame.evaluatedDomainGradient,paletteOffset:frame.settings.paletteOffset,oraclePng:btoa(encoded)};
  }finally{g.dispose();renderer.dispose();}
  return{...result,generatorDisposed:true,rendererDisposed:true};
 },{request:exported.request,actualPng:png.toString('base64')});
 check(oracle.backend==='webgl2'&&oracle.workerPixelHash===exported.pixelHash,'cold production Generator differs from actual export worker pixels');
 check(oracle.maxDifference===0&&oracle.changedChannels===0,'actual downloaded PNG differs from independent production renderer output');
 check(oracle.opaquePixels===257*193&&oracle.distinctRgb>100,'downloaded PNG is empty or uniform');
 await writeFile('.cache/domain-fullchain-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
 await page.locator('#control-domainBackend').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-fullchain-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-fullchain-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['One local Domain fixture and GPU device; numerical/function/palette matrix is separately verified.','Fixture preconfigures a source-offset OKLab gradient; this script verifies actual seek and evaluated export, not gradient authoring UI.','No original MathArt app execution or pixel equivalence. No timing/speedup measurement.','Independent cold replay uses the local production Generator and ArtRenderer, not an independent mathematical implementation.','Worker and renderer hooks are passive observations. Page/browser closure owns remaining App workers; no claim of whole-process or VRAM leak accounting.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-fullchain-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-fullchain-ui-failure-${attempt}.json`:'.cache/domain-fullchain-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
