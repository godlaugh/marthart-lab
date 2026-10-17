import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registryReference,registryOracleScope} from './domain-parameter-registry-oracle.mjs';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity; they never fabricate or delay output.
const paths=[
 'scripts/domain-parameter-registry-oracle.mjs','src/engine/domainParameterTimeline.ts','src/engine/domainParameterBinding.ts','src/engine/domainLevelCurve.ts','src/engine/domainSourceScalar.ts','src/i18n.tsx',
 'src/engine/oscillation.ts','src/scenes/domainExamples.generated.ts','src/scenes/domainExamples.recipes.json','src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/domainNativeParser.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParameters.ts','src/engine/domainNativeConstants.ts','src/engine/equationEditor.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/planeNavigation.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-parameter-registry-ui.mjs',
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
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{translate}=await import('/src/i18n.tsx');
  const def=definition('domain'),scene=createScene(def,def.presets.find(p=>p.id==='cubic'));scene.name='Registry initial local fixture';scene.settings.domainBackend='cpu';
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return {initial:scene,examples:def.presets.filter(p=>p.id.startsWith('guide-domain-')).map(p=>({label:translate('en',p.name),scene:createScene(def,p),assumptions:(p.document?.provenance?.reference?.assumptions??[]).map(x=>translate('en',x))})),oldIds:def.presets.filter(p=>!p.id.startsWith('guide-domain-')).map(p=>p.id)};
 });report.fixture=fixture;
 const content=scene=>JSON.stringify({kind:scene.kind,equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,domainSourcePalette:scene.domainSourcePalette,timeline:scene.timeline,formulas:scene.formulas,provenance:scene.provenance});
 const installRendererAudit=()=>page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}const completed=window.__audit.completed.findLast(x=>x.request.scene.id===scene.id&&x.pixelHash===(hash>>>0));window.__renderAudit.outputs.push({id,issuedSequence:completed?.issuedSequence,completionSequence:completed?.completionSequence,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,parameters:structuredClone(scene.parameters),settings:structuredClone(scene.settings),viewport:scene.settings.domainViewportVersion,iteration:scene.settings.domainIterationVersion,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 const rendered=async row=>{
  await page.waitForFunction(row=>window.__renderAudit.outputs.some(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
  return page.evaluate(row=>window.__renderAudit.outputs.findLast(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
 };
 const seek=async(id,time)=>{const before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));return fresh(before,{id,time});};
 await page.goto(origin);checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.initial.id,selectedBackend:'cpu',iteration:'local-v1'});await installRendererAudit();

 const neutral={window:.5,floor:1,easing:'LINEAR'};
 const native={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Registry actual App fixture',settings:{render_mode:'GPU',param_edge_easing:neutral},parameters:{a:.25,b:.1,'a.b':3},domainColoring:{formula:'z+a+i*b'},viewport:{centerX:.1,centerY:.2,scale:2.5},timeline:[
  {type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:[{parameters:{a:{min:1,max:-1,step:.02}}}]}]},
  {type:'wait',duration:.5},
  {type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStop',args:[{parameters:{a:{}}}]}]},
  {type:'wait',duration:.5},
  {type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:[{}]}]},
  {type:'wait',duration:1},
 ]};
 const referenceFixture={id:'actual-ui',groups:[{at:0,duration:0,operations:[{method:'paramStart',name:'a',min:1,max:-1,step:.02}]},{at:.5,duration:0,operations:[{method:'paramStop',name:'a'}]},{at:1,duration:0,operations:[{method:'paramStart'}]}]};
 report.independentOracle={...registryOracleScope,fixture:structuredClone(referenceFixture)};
 const input=page.locator('input[type=file][accept=".json"]');check(await input.count()===1,'JSON input ambiguous');
 const text='// Native Domain registry fixture\n'+JSON.stringify(native,null,2);await writeFile('.cache/domain-parameter-registry-ui-input.json',text);
 let before=await mark();await input.setInputFiles({name:'registry.json',mimeType:'application/json',buffer:Buffer.from(text)});
 const imported=await fresh(before,{name:native.name,time:0,iteration:'mathart-1.7.8-gpu',backend:'webgl2'}),id=imported.request.scene.id;
 check(JSON.stringify(imported.request.scene.provenance.original)===JSON.stringify(native),'native source was not retained');
 check(imported.request.scene.timeline.tracks[0].actions[0].domainParameters[0].configuration.min===1&&imported.request.scene.timeline.tracks[0].actions[0].domainParameters[0].configuration.max===-1,'raw reversed endpoints were reordered in document');
 const first=await rendered(imported);check(first.parameters.a===.25&&first.parameters['a.b']===3,'dt-zero presentation changed authored baseline');
 checks.import={request:imported,presentation:first,inputSha256:sha(text)};
 const notes=page.locator('details.inspector-section').filter({has:page.locator('summary',{hasText:'Import compatibility'})});
 if(await notes.getAttribute('open')===null)await notes.locator('summary').click();
 checks.compatibilityText=await notes.innerText();check(checks.compatibilityText.includes('registry')&&checks.compatibilityText.includes('60 Hz'),'registry clock/source limitation not visible');
 const assertPresented=async(row,fixture=referenceFixture)=>{
  const presented=await rendered(row),expected=registryReference(fixture,row.request.context.time,row.request.scene);
  for(const name of Object.keys(expected.parameters))check(Object.hasOwn(presented.parameters,name)&&Math.abs(presented.parameters[name]-expected.parameters[name])<2e-11,`actual presented parameter ${JSON.stringify(name)} at ${row.request.context.time}: ${presented.parameters[name]} != ${expected.parameters[name]}`);
  return{request:row,presentation:presented,expectedParameters:expected.parameters,expectedRunning:expected.running};
 };
 checks.seeks=[];
 for(const time of [.2,.5,.8,1,1.5,.2,0])checks.seeks.push(await assertPresented(await seek(id,time)));
 check(checks.seeks[1].presentation.parameters.a===checks.seeks[2].presentation.parameters.a,'Named Stop did not hold');
 check(checks.seeks[4].presentation.parameters.a!==checks.seeks[3].presentation.parameters.a,'Start All did not resume registered phase');
 const timeline=page.getByRole('region',{name:'Animation timeline',exact:true});
 const selectTrack=async index=>page.locator('.track-labels button').nth(index).click();
 const scope=()=>page.getByRole('combobox',{name:'Parameter scope 1',exact:true});
 const name=()=>page.getByRole('textbox',{name:'Exact parameter name 1',exact:true});
 const edit=async(action,predicate)=>{
  const start=await mark();await action();await page.waitForFunction(({start,predicate})=>window.__audit.completed.some(x=>x.issuedSequence>start.issued&&x.completionSequence>start.completed&&x.request.context.quality!=='export'&&Function('scene',`return (${predicate})`)(x.request.scene)),{start,predicate});await ready();
  const row=await page.evaluate(({start,predicate})=>window.__audit.completed.findLast(x=>x.issuedSequence>start.issued&&x.completionSequence>start.completed&&x.request.context.quality!=='export'&&Function('scene',`return (${predicate})`)(x.request.scene)),{start,predicate});await rendered(row);return row;
 };
 await selectTrack(0);check(await page.getByRole('combobox',{name:'Parameter animation rules',exact:true}).inputValue()==='registry','registry selector not selected');
 check(await scope().inputValue()==='named'&&await name().inputValue()==='a','named scope/name not displayed');
 check(await page.getByRole('spinbutton',{name:'Minimum 1',exact:true}).inputValue()==='1'&&await page.getByRole('spinbutton',{name:'Maximum 1',exact:true}).inputValue()==='-1','reversed controls not retained');
 const firstConfig='scene.timeline.tracks[0].actions[0].domainParameters[0]';
 checks.edits=[];
 checks.edits.push(await edit(()=>page.getByRole('spinbutton',{name:'Minimum 1',exact:true}).fill('2'),firstConfig+'.configuration.min===2'));
 checks.edits.push(await edit(()=>page.getByRole('spinbutton',{name:'Maximum 1',exact:true}).fill('-2'),firstConfig+'.configuration.max===-2'));
 checks.edits.push(await edit(()=>page.getByRole('spinbutton',{name:'Step per frame (60 fps reference) 1',exact:true}).fill('0.03'),firstConfig+'.configuration.step===.03'));
 Object.assign(referenceFixture.groups[0].operations[0],{min:2,max:-2,step:.03});
 checks.edits.push(await edit(()=>name().fill('a.b'),firstConfig+'.scope.name==="a.b"'));referenceFixture.groups[0].operations[0].name='a.b';
 checks.exactDottedName=await assertPresented(await seek(id,.2));check(checks.exactDottedName.presentation.parameters.a===.25,'exact dotted name modified a instead');
 await seek(id,0);checks.edits.push(await edit(()=>name().fill('a'),firstConfig+'.scope.name==="a"'));referenceFixture.groups[0].operations[0].name='a';
 // UI changes genuinely create/remove configurations for Named/All without
 // manufacturing an All expansion into the current formula parameter map.
 await selectTrack(4);check(await scope().inputValue()==='all','imported All not displayed');
 const allConfig='scene.timeline.tracks[4].actions[0].domainParameters[0]';
 checks.edits.push(await edit(()=>scope().selectOption('named'),allConfig+'.scope.kind==="named"&&'+allConfig+'.configuration.min===-1'));
 checks.edits.push(await edit(()=>name().fill('b'),allConfig+'.scope.name==="b"'));
 checks.edits.push(await edit(()=>scope().selectOption('all'),allConfig+'.scope.kind==="all"&&!'+allConfig+'.configuration'));
 check(await page.getByRole('spinbutton',{name:'Minimum 1',exact:true}).count()===0,'All exposes stale named configuration');
 await selectTrack(2);const stopConfig='scene.timeline.tracks[2].actions[0].domainParameters[0]';
 checks.edits.push(await edit(()=>scope().selectOption('all'),stopConfig+'.scope.kind==="all"'));
 const stopAllFixture=structuredClone(referenceFixture);delete stopAllFixture.groups[1].operations[0].name;
 checks.stopAll=await assertPresented(await seek(id,1.5),stopAllFixture);
 check(checks.stopAll.expectedRunning,'StartAll after StopAll failed to restart');
 await seek(id,0);checks.edits.push(await edit(()=>scope().selectOption('named'),stopConfig+'.scope.kind==="named"&&'+stopConfig+'.scope.name==="a"'));
 check(await page.getByRole('spinbutton',{name:'Minimum 1',exact:true}).count()===0,'Named Stop acquired a range');
 checks.finalSeeks=[];for(const time of [.8,1.5,.2,0])checks.finalSeeks.push(await assertPresented(await seek(id,time)));
 const beforeSave=checks.finalSeeks.at(-1).request,saveMark=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();
 const saved=await fresh(saveMark,{id,time:0});check(content(saved.request.scene)===content(beforeSave.request.scene),'Save changed authored registry document');
 const savedContent=content(saved.request.scene);await page.reload();const reloaded=await fresh({issued:0,completed:0},{id,time:0});check(content(reloaded.request.scene)===savedContent,'Reload changed authored registry document');
 checks.saveReload={saved,reloaded};await installRendererAudit();
 const finalFrame=await seek(id,1.5);checks.finalSeek=await assertPresented(finalFrame);checks.finalIndependentFixture=referenceFixture;
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-parameter-registry-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id});
 check(exported?.output.backend==='webgl2'&&exported.request.context.time===1.5,'PNG export did not complete selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.viewport==='mathart-1.7.8-gpu','export renderer did not receive selected source viewport');
 const png=await readFile('.cache/domain-parameter-registry-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'PNG dimensions/content invalid');
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
 await writeFile('.cache/domain-parameter-registry-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await page.getByRole('combobox',{name:'Formula evaluation rules',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-parameter-registry-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-parameter-registry-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['New native registry import, actual Named/All controls and persisted exact keys are checked on one device. Original MathArt was not run; no original-runtime or cross-device parity claim.','The independent scalar reference uses neutral edge easing and linear ramps at the explicit local 60 Hz plus event-boundary clock. This is not a measurement of the original live frame cadence, HashMap order or all easing float stages.','Timeline parameters are observed at the actual production ArtRenderer setOutput boundary and compared with an independently transcribed scalar 60Hz reference. Authored parameter inputs intentionally keep their baseline values.','Independent cold replay uses the same production Generator/ArtRenderer and proves PNG export consistency, not independent mathematical correctness.','No performance or whole-process/VRAM lifetime claim. Hooks only observe actual requests/outputs and renderer disposal; browser closure owns remaining App resources.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-parameter-registry-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-parameter-registry-ui-failure-${attempt}.json`:'.cache/domain-parameter-registry-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
