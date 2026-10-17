import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity; they never fabricate or delay output.
const paths=[
 'src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/domainNativeParser.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParameters.ts','src/engine/domainNativeConstants.ts','src/engine/equationEditor.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/planeNavigation.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-native-ui.mjs',
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const check=(value,message)=>{if(!value)throw Error(message);};
const attempt=Date.now();
await mkdir('.cache',{recursive:true});
const sourceBefore=await hashes(),report={at:new Date().toISOString(),scope:'Owned headless Chrome, actual local App controls, globally paired worker completions, downloaded PNG and cold Generator plus production ArtRenderer. No original application runtime, native parity or performance claim.',sourceSnapshotsBefore:sourceBefore};
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
  window.__audit.matches=(item,expected)=>{
   const scene=item.request.scene,s=scene.settings;
   return scene.kind==='domain'&&item.request.context.quality!=='export'&&(expected.id===undefined||scene.id===expected.id)&&(expected.name===undefined||scene.name===expected.name)&&(expected.formula===undefined||scene.equations.f===expected.formula)&&(expected.selectedBackend===undefined||s.domainBackend===expected.selectedBackend)&&(expected.backend===undefined||item.output.backend===expected.backend)&&(expected.color===undefined||(s.domainColorVersion??'local-v1')===expected.color)&&(expected.iteration===undefined||(s.domainIterationVersion??'local-v1')===expected.iteration)&&(expected.enabled===undefined||s.iterationEnabled===expected.enabled)&&(expected.steps===undefined||s.iterationSteps===expected.steps)&&(expected.maxSteps===undefined||s.iterationMaxSteps===expected.maxSteps)&&(expected.time===undefined||item.request.context.time===expected.time)&&(expected.viewport===undefined||(s.domainViewportVersion??'local-v1')===expected.viewport)&&(expected.settings===undefined||Object.entries(expected.settings).every(([key,value])=>s[key]===value));
  };
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
   postMessage(message,...args){
    if(message.operation==='generate'){
     const sent={request:structuredClone(message),issuedSequence:++window.__audit.issued};this.sent.set(message.id,sent);

    }
    return super.postMessage(message,...args);
   }
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 await page.route('**/api/health',route=>route.fulfill({status:503,contentType:'text/plain',body:'No export service in this browser test; use production PNG Blob fallback.'}));
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('domain'));scene.name='Native execution legacy fixture';scene.equations={f:'sin(z)+0.25*z',next:''};
  Object.assign(scene.settings,{domainBackend:'cpu',iterationEnabled:false,seedMode:'PIXEL_Z',scale:1.25});
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });report.fixture=fixture;await page.goto(origin);
 checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.id,formula:fixture.equations.f,selectedBackend:'cpu',iteration:'local-v1'});
 const selector=()=>page.getByRole('combobox',{name:'Formula evaluation rules',exact:true});let before;
 for(const version of ['mathart-1.7.8','mathart-1.7.8-cpu','mathart-1.7.8-gpu','local-v1']){
  before=await mark();await selector().selectOption(version);const row=await fresh(before,{id:fixture.id,iteration:version,selectedBackend:'cpu'});checks['version_'+version]=row;
  check(JSON.stringify(row.request.scene.equations)===JSON.stringify(fixture.equations),'version selection rewrote raw formula');
  if(version==='local-v1')check(row.pixelHash===checks.initialLocal.pixelHash,'returning to old local rules changed legacy pixels');
 }
 const input=page.locator('input[type=file][accept=".json"]');check(await input.count()===1,'JSON input ambiguous');
 const importNative=async(native,label,expected)=>{
  const text='// Native execution fixture\n'+JSON.stringify(native,null,2),path='.cache/domain-native-ui-'+label+'.json';await writeFile(path,text);
  const start=await mark();await input.setInputFiles({name:label+'.json',mimeType:'application/json',buffer:Buffer.from(text)});
  const row=await fresh(start,{name:native.name,time:0,...expected});check(JSON.stringify(row.request.scene.provenance?.original)===JSON.stringify(native),'native source changed');return{...row,input:{path,sha256:sha(text)}};
 };
 const nativeBase={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Native execution',settings:{render_mode:'GPU'},domainColoring:{formula:'z+1',iteration:{enabled:false,seedMode:'ZERO',nextFormula:'w+100i'}},timeline:[{type:'wait',duration:2}]};
 for(const mode of ['CPU','GPU'])checks['nativeImport'+mode]=await importNative({...nativeBase,name:'Native execution '+mode,settings:{render_mode:mode}},'import-'+mode,{iteration:'mathart-1.7.8-'+mode.toLowerCase(),enabled:false});
 const imported=checks.nativeImportGPU,idDisabled=imported.request.scene.id;
 before=await mark();await selector().selectOption('mathart-1.7.8-cpu');checks.disabledNextCpu=await fresh(before,{id:idDisabled,iteration:'mathart-1.7.8-cpu',enabled:false});
 checks.disabledNextValues=await page.evaluate(async scenes=>{const{parseDomainModel,domainEvaluator}=await import('/src/engine/domainModel.ts');return scenes.map(scene=>{const model=parseDomainModel(scene,0);return{version:model.execution.version,arithmetic:model.execution.arithmetic,value:domainEvaluator(model)([.2,.3]),nextEnabled:model.nextEnabled};});},[imported.request.scene,checks.disabledNextCpu.request.scene]);
 check(checks.disabledNextValues[0].value[0]===1&&checks.disabledNextValues[1].value[1]===100,'disabled next contracts are not distinct');
 check(imported.pixelHash!==checks.disabledNextCpu.pixelHash,'actual disabled-next output did not change with execution rules');
 const malformed={...nativeBase,name:'Native malformed formula',domainColoring:{formula:'sin(',iteration:{enabled:true,nextFormula:'pow(z)',steps:1}}};
 checks.syntaxRecovery=await importNative(malformed,'malformed',{iteration:'mathart-1.7.8-gpu',formula:'sin('});
 check(checks.syntaxRecovery.request.scene.equations.next==='pow(z)','malformed next was not retained');
 check(checks.syntaxRecovery.output.warnings?.some(w=>w.includes('z^3 - 1'))&&checks.syntaxRecovery.output.warnings.some(w=>w.includes('迭代公式')),'syntax recovery warnings absent');
 await page.screenshot({path:'.cache/domain-native-ui-recovery.png'});
 checks.mainW=await importNative({...nativeBase,name:'Native main w',domainColoring:{formula:'w+1',iteration:{enabled:false,seedMode:'ZERO',nextFormula:'w+100i'}}},'main-w',{iteration:'mathart-1.7.8-gpu',formula:'w+1',backend:'cpu'});
 check(checks.mainW.output.warnings?.some(w=>w.includes('w 未声明')),'native main-w CPU fallback not disclosed');
 checks.constantOverride=await importNative({...nativeBase,name:'Native literal constant',parameters:{a:7,b:8},domainColoring:{formula:'z^3-2',iteration:{enabled:true,seedMode:'CONSTANT_C',steps:1,nextFormula:'w+0*c'}}},'constant',{iteration:'mathart-1.7.8-gpu',formula:'z^3-2'});
 const constantText=await page.getByTestId('domain-effective-constant').innerText();check(constantText.includes('2 + (0)i'),'effective constant was not visible');checks.constantText=constantText;
 checks.constantUploadGate=await importNative({...nativeBase,name:'Native GPU constant gate',parameters:{a:7,b:8},domainColoring:{formula:'z',iteration:{enabled:true,seedMode:'CONSTANT_C',steps:1,nextFormula:'w+1'}}},'constant-gate',{iteration:'mathart-1.7.8-gpu',formula:'z'});
 const zeroConstantText=await page.getByTestId('domain-effective-constant').innerText();check(zeroConstantText.includes('0 + (0)i'),'GPU upload gate was not reflected in displayed effective constant');checks.zeroConstantText=zeroConstantText;
 const native={...nativeBase,name:'Native execution PNG',domainColoring:{formula:'sin(z)+0.25*z',viewport:{scale:2.5},iteration:{enabled:false,nextFormula:''}}};
 checks.finalImport=await importNative(native,'final',{iteration:'mathart-1.7.8-gpu',formula:'sin(z)+0.25*z'});
 const id=checks.finalImport.request.scene.id;report.native=native;
 const mainEditor=page.getByRole('textbox',{name:'f(z)',exact:true}),apply=page.getByRole('button',{name:'Apply equations',exact:true});
 before=await mark();await mainEditor.fill('1e3+z');await mainEditor.press('Escape');check(await apply.isEnabled(),'native grammar formula blocked by the editor');await apply.click();
 checks.editedNativeGrammar=await fresh(before,{id,iteration:'mathart-1.7.8-gpu',formula:'1e3+z'});
 before=await mark();await mainEditor.fill('sin(');await mainEditor.press('Escape');check(await apply.isEnabled(),'recoverable native syntax was blocked by the editor');
 check((await page.locator('.equation-editors').innerText()).includes('z^3 - 1'),'native recovery preview absent');await apply.click();
 checks.editedRecovery=await fresh(before,{id,iteration:'mathart-1.7.8-gpu',formula:'sin('});
 check(checks.editedRecovery.output.warnings.some(w=>w.includes('z^3 - 1')),'applied syntax recovery diagnostic absent');
 before=await mark();await mainEditor.fill(native.domainColoring.formula);await mainEditor.press('Escape');await apply.click();
 checks.editedRestore=await fresh(before,{id,iteration:'mathart-1.7.8-gpu',formula:native.domainColoring.formula});

 before=await mark();await page.locator('#control-domainBackend').selectOption('gpu');checks.explicitGpu=await fresh(before,{id,iteration:'mathart-1.7.8-gpu',selectedBackend:'gpu',backend:'webgl2'});
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
 checks.savedReload=await fresh({issued:0,completed:0},{id,iteration:'mathart-1.7.8-gpu',selectedBackend:'gpu',backend:'webgl2',time:0});
 check(JSON.stringify(checks.savedReload.request.scene.provenance?.original)===JSON.stringify(native),'Save/reload changed provenance');
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__renderAudit.outputs.push({id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,viewport:scene.settings.domainViewportVersion,iteration:scene.settings.domainIterationVersion,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-native-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id});
 check(exported?.output.backend==='webgl2'&&exported.request.context.time===0,'PNG export did not complete selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.viewport==='mathart-1.7.8-gpu','export renderer did not receive selected source viewport');
 const png=await readFile('.cache/domain-native-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'PNG dimensions/content invalid');
 const oracle=await page.evaluate(async({request,actualPng})=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const g=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
  const hash=pixels=>{let h=2166136261;for(const v of pixels){h^=v;h=Math.imul(h,16777619);}return h>>>0;};
  const decode=async blob=>{const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const context=c.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,c.width,c.height).data;};
  let result;
  try{
   const out=await g.generate(request.scene,request.context),frame=sceneAtTime(request.scene,request.context.time);
   renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(out,frame,false,outputCamera(frame,out));
   const blob=await renderer.blob('image/png'),expected=await decode(blob),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
   if(expected.length!==actual.length)throw Error('decoded PNG lengths differ');
   let maxDifference=0,changedChannels=0,opaque=0;const colors=new Set();
   for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);maxDifference=Math.max(maxDifference,d);if(d)changedChannels++;if(i%4===3&&actual[i])opaque++;if(i%4===0)colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);}
   const bytes=new Uint8Array(await blob.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
   result={backend:out.backend,width:out.width,height:out.height,workerPixelHash:hash(out.pixels),decodedActualHash:hash(actual),decodedExpectedHash:hash(expected),maxDifference,changedChannels,opaquePixels:opaque,distinctRgb:colors.size,viewport:frame.settings.domainViewportVersion,rotation:frame.settings.rotation,oraclePng:btoa(encoded)};
  }finally{g.dispose();renderer.dispose();}
  return{...result,generatorDisposed:true,rendererDisposed:true};
 },{request:exported.request,actualPng:png.toString('base64')});
 check(oracle.backend==='webgl2'&&oracle.workerPixelHash===exported.pixelHash,'cold Generator differs from actual export worker pixels');
 check(oracle.maxDifference===0&&oracle.changedChannels===0,'downloaded PNG differs from cold production renderer');
 check(oracle.opaquePixels===257*193&&oracle.distinctRgb>100,'downloaded PNG is empty or uniform');
 await writeFile('.cache/domain-native-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await selector().scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-native-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-native-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['One device, native-format imports and one legacy document; no original application runtime or pixel equivalence.','New CPU and GPU execution versions are checked through actual controls; native arithmetic correctness is covered separately.','Independent cold replay uses the same production Generator/ArtRenderer and proves export consistency, not independent mathematical correctness.','Native syntax recovery preserves authored text; source GPU main-w fallback is expression-only and leaves independently chosen viewport/color versions unchanged.','No performance or whole-process/VRAM lifetime claim. Hooks only observe actual requests/outputs and renderer disposal; browser closure owns remaining App resources.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-native-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-native-ui-failure-${attempt}.json`:'.cache/domain-native-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
