import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity; they do not replace or alter generation.
const paths=[
 'src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-source-ui.mjs',
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
  window.__audit.matches=(item,expected)=>{
   const scene=item.request.scene,s=scene.settings;
   return scene.kind==='domain'&&item.request.context.quality!=='export'&&(expected.id===undefined||scene.id===expected.id)&&(expected.name===undefined||scene.name===expected.name)&&(expected.formula===undefined||scene.equations.f===expected.formula)&&(expected.selectedBackend===undefined||s.domainBackend===expected.selectedBackend)&&(expected.backend===undefined||item.output.backend===expected.backend)&&(expected.color===undefined||(s.domainColorVersion??'local-v1')===expected.color)&&(expected.iteration===undefined||(s.domainIterationVersion??'local-v1')===expected.iteration)&&(expected.enabled===undefined||s.iterationEnabled===expected.enabled)&&(expected.steps===undefined||s.iterationSteps===expected.steps)&&(expected.maxSteps===undefined||s.iterationMaxSteps===expected.maxSteps)&&(expected.time===undefined||item.request.context.time===expected.time)&&(expected.colors===undefined||JSON.stringify(scene.domainSourcePalette?.colors)===JSON.stringify(expected.colors));
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
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{request:structuredClone(message),issuedSequence:++window.__audit.issued});return super.postMessage(message,...args);}
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 await page.route('**/api/health',route=>route.fulfill({status:503,contentType:'text/plain',body:'No export service in this browser test; use production PNG Blob fallback.'}));
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('domain'));scene.name='Domain source UI legacy fixture';scene.settings.domainBackend='cpu';scene.settings.iterationEnabled=false;scene.equations.next='w*0+99';
  scene.palette={name:'Preserved local',mode:'linear',stops:['#f04666','#1adbc5','#3b4df5'],offset:.07,cycles:1.3};
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });report.fixture=fixture;
 await page.goto(origin);
 checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.id,formula:'z^3-1',selectedBackend:'cpu',backend:'cpu',color:'local-v1',iteration:'local-v1'});
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__renderAudit.outputs.push({id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,formula:scene.equations.f,colorVersion:scene.settings.domainColorVersion,iterationVersion:scene.settings.domainIterationVersion,sourceColors:scene.domainSourcePalette?.colors,paletteOffset:scene.settings.paletteOffset,evaluatedGradient:scene.evaluatedDomainGradient,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 let before=await mark();await page.getByRole('combobox',{name:'Color rules',exact:true}).selectOption('mathart-1.7.8-gpu');
 checks.colorOnlyMigration=await fresh(before,{id:fixture.id,color:'mathart-1.7.8-gpu',iteration:'local-v1',backend:'cpu'});
 check(checks.colorOnlyMigration.request.scene.equations.next==='w*0+99'&&checks.colorOnlyMigration.request.scene.settings.iterationEnabled===false,'color migration changed dormant formula execution inputs');
 const dormant=await page.evaluate(async request=>{
  const{Generator}=await import('/src/engine/client.ts');const g=new Generator();
  try{const scene=structuredClone(request.scene);scene.equations.next='';const out=await g.generate(scene,request.context);let hash=2166136261;for(const v of out.pixels){hash^=v;hash=Math.imul(hash,16777619);}return{hash:hash>>>0,backend:out.backend};}finally{g.dispose();}
 },checks.colorOnlyMigration.request);check(dormant.hash===checks.colorOnlyMigration.pixelHash,'source color-only switch activated a dormant next formula');checks.dormantNextOracle=dormant;
 before=await mark();await page.getByRole('combobox',{name:'Color rules',exact:true}).selectOption('local-v1');
 checks.restoreLocal=await fresh(before,{id:fixture.id,color:'local-v1',iteration:'local-v1',backend:'cpu'});check(checks.restoreLocal.pixelHash===checks.initialLocal.pixelHash,'switching color rules back changed the legacy completed pixels');
 const native={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Native Domain source UI',settings:{render_mode:'GPU'},palette:['#80112233','#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC','#291C4E','#E2B714','#127E80','#A1234B','#CEE199','#152977','#F3AA86','#833DA0','#49B810','#FFFF00'],domainColoring:{formula:'sin(z)+0.25*z',iteration:{enabled:false,steps:1,maxSteps:64,seedMode:'PIXEL_Z',nextFormula:''},levelCurve:{mode:'PHASE_MODULUS',phaseDensity:7.5,modDensity:8,phaseSharpness:1,modSharpness:1,bias:.15,mix:1}},timeline:[{type:'animate',duration:0,actions:[{method:'gradientStart',args:[{mode:'HUE_ROTATE',speed:90,interpolation:'OKLAB',affectInside:true,affectOutside:true}]}]},{type:'wait',duration:2}]};
 const file=page.locator('input[type=file][accept=".json"]');check(await file.count()===1,'native project file input is ambiguous');
 for(const [label,colors] of [['empty',[]],['single',['#80112233']]]){
  const special={...native,name:'Native Domain '+label,palette:colors,timeline:[{type:'wait',duration:2}]};before=await mark();await file.setInputFiles({name:'native-domain-'+label+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(special))});
  checks[label+'PaletteImport']=await fresh(before,{name:special.name,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',backend:'webgl2',colors,time:0});check(checks[label+'PaletteImport'].output.width>0&&checks[label+'PaletteImport'].output.height>0,'cardinality import produced no raster');
 }
 const nativeText='// Original-format Domain fixture with comments\n'+JSON.stringify(native,null,2).replace('\"type\":','/* renderer source type */\n  \"type\":');await writeFile('.cache/domain-source-ui-native-with-comments.json',nativeText);report.nativeInput={path:'.cache/domain-source-ui-native-with-comments.json',sha256:sha(nativeText)};
 before=await mark();await file.setInputFiles({name:'native-domain-source.json',mimeType:'application/json',buffer:Buffer.from(nativeText)});
 checks.nativeImport=await fresh(before,{name:native.name,formula:native.domainColoring.formula,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',backend:'webgl2',colors:native.palette,time:0});
 const id=checks.nativeImport.request.scene.id;report.native=native;
 check(JSON.stringify(checks.nativeImport.request.scene.provenance.original)===JSON.stringify(native),'native import lost source provenance');
 check(checks.nativeImport.request.scene.equations.next==='','native empty next formula was not retained');
 check(checks.nativeImport.request.scene.timeline.tracks.some(t=>t.actions?.some(a=>a.method==='gradientStart'&&a.gradient.interpolation==='oklab')),'native gradient action did not reach the actual request');
 before=await mark();await page.locator('#control-iterationEnabled').check();
 checks.iterationUiDefaults=await fresh(before,{id,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',enabled:true,steps:1,maxSteps:64});
 check(await page.locator('#control-iterationMaxSteps').inputValue()==='64'&&await page.locator('#control-iterationSteps').inputValue()==='1','source iteration controls did not display effective defaults');
 before=await mark();await page.locator('#control-iterationMaxSteps').fill('1');await fresh(before,{id,enabled:true,steps:1,maxSteps:1});
 before=await mark();await page.locator('#control-iterationSteps').fill('999');
 checks.authoredStepsPreserved=await fresh(before,{id,enabled:true,steps:999,maxSteps:1});
 check(await page.locator('#control-iterationSteps').inputValue()==='999','authored steps were silently clamped in the UI');
 // The parsed model contains closures, so observe just its numeric owner facts.
 checks.iterationFacts=await page.evaluate(async scene=>{const m=(await import('/src/engine/domainModel.ts')).parseDomainModel(scene,0);return{steps:m.steps,bailout:m.bailout,iterationVersion:m.iterationVersion};},checks.authoredStepsPreserved.request.scene);
 check(checks.iterationFacts.steps===1,'source producer did not apply the explicit maxSteps bound');
 before=await mark();await page.locator('#control-iterationSteps').fill('1');await fresh(before,{id,enabled:true,steps:1,maxSteps:1});
 before=await mark();await page.locator('#control-iterationMaxSteps').fill('64');await fresh(before,{id,enabled:true,steps:1,maxSteps:64});
 before=await mark();await page.locator('#control-iterationEnabled').uncheck();await fresh(before,{id,enabled:false,steps:1,maxSteps:64});
 before=await mark();await page.locator('#control-domainBackend').selectOption('gpu');
 checks.forceHardwareGpu=await fresh(before,{id,color:'mathart-1.7.8-gpu',selectedBackend:'gpu',backend:'webgl2',colors:native.palette});
 await page.getByRole('button',{name:'Appearance',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Source color index',exact:true}).fill('17');
 before=await mark();await page.getByLabel('Source color',{exact:true}).fill('#00ff11');
 const edited=[...native.palette];edited[16]='#FF00FF11';
 checks.editUnusedSeventeenth=await fresh(before,{id,color:'mathart-1.7.8-gpu',selectedBackend:'gpu',backend:'webgl2',colors:edited});
 check(checks.editUnusedSeventeenth.pixelHash===checks.forceHardwareGpu.pixelHash,'17th source color affected the source GPU upload prefix');
 await page.getByRole('spinbutton',{name:'Source color index',exact:true}).fill('1');
 before=await mark();await page.getByLabel('Source color',{exact:true}).fill('#e2b714');edited[0]='#80E2B714';
 checks.editFirstAlpha=await fresh(before,{id,color:'mathart-1.7.8-gpu',selectedBackend:'gpu',backend:'webgl2',colors:edited});
 check(checks.editFirstAlpha.pixelHash!==checks.editUnusedSeventeenth.pixelHash,'first source color edit did not change actual worker image');await page.screenshot({path:'.cache/domain-source-ui-palette.png'});
 await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
 before=await mark();await page.getByRole('combobox',{name:'Color rules',exact:true}).selectOption('mathart-1.7.8-cpu');
 checks.sourceCpuRules=await fresh(before,{id,color:'mathart-1.7.8-cpu',iteration:'mathart-1.7.8',selectedBackend:'gpu',colors:edited});
 check(checks.sourceCpuRules.pixelHash!==checks.editFirstAlpha.pixelHash,'source CPU rules did not produce a distinct full-palette image');
 before=await mark();await page.getByRole('combobox',{name:'Color rules',exact:true}).selectOption('mathart-1.7.8-gpu');
 checks.sourceGpuRulesAgain=await fresh(before,{id,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',selectedBackend:'gpu',backend:'webgl2',colors:edited});
 check(checks.sourceGpuRulesAgain.pixelHash===checks.editFirstAlpha.pixelHash,'source GPU rules did not restore completed pixels');
 checks.preReloadAudit=await page.evaluate(()=>({workerErrors:window.__audit.errors,completed:window.__audit.completionCount,issued:window.__audit.issued}));check(!checks.preReloadAudit.workerErrors.length,'unexpected worker errors before Save/reload');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
 checks.savedReload=await fresh({issued:0,completed:0},{id,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',selectedBackend:'gpu',backend:'webgl2',colors:edited,time:0});
 check(JSON.stringify(checks.savedReload.request.scene.provenance.original)===JSON.stringify(native),'Save/reload changed native source provenance');
 // Reinstall passive renderer observation after page reload.
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__renderAudit.outputs.push({id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,formula:scene.equations.f,colorVersion:scene.settings.domainColorVersion,iterationVersion:scene.settings.domainIterationVersion,sourceColors:scene.domainSourcePalette?.colors,paletteOffset:scene.settings.paletteOffset,evaluatedGradient:scene.evaluatedDomainGradient,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).press('End');
 checks.timelineSeek=await fresh(before,{id,color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',selectedBackend:'gpu',backend:'webgl2',colors:edited,time:2});
 check(checks.timelineSeek.pixelHash!==checks.savedReload.pixelHash,'timeline seek did not change the source gradient');
 await page.waitForFunction(expected=>window.__renderAudit.outputs.some(x=>x.sceneId===expected.id&&x.pixelHash===expected.hash&&x.evaluatedGradient?.running===true&&x.paletteOffset===.5),{id,hash:checks.timelineSeek.pixelHash});
 await page.locator('[data-testid="art-canvas"]').screenshot({path:'.cache/domain-source-ui-preview.png'});
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-source-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id});
 check(exported?.output.backend==='webgl2'&&exported.request.context.time===2,'PNG export did not complete the actual selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.evaluatedGradient?.running===true&&exportRenderer.paletteOffset===.5,'actual export renderer did not consume evaluated gradient/time');
 const png=await readFile('.cache/domain-source-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'downloaded PNG dimensions/content invalid');
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
 await writeFile('.cache/domain-source-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
 await page.locator('#control-domainBackend').scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-source-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-source-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['One legacy fixture plus a 17-color native-format Domain import on one GPU device; independent numeric/source shader matrices are separate evidence.','Actual native JSON import supplies an OKLab gradient; this script verifies source palette controls, distinct color/evaluation versions, Save/reload and evaluated export, not gradient authoring UI.','No original MathArt app execution or pixel equivalence. No timing/speedup measurement.','Independent cold replay uses the local production Generator and ArtRenderer, not an independent mathematical implementation.','Worker and renderer hooks are passive observations. Page/browser closure owns remaining App workers; no claim of whole-process or VRAM leak accounting.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-source-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-source-ui-failure-${attempt}.json`:'.cache/domain-source-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
