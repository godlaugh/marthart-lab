import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual App operations and passive Worker/ArtRenderer observations only.
// No replaced generators, fake completion, modified pixels or fault injection.
const paths=[
 'scripts/verify-roots-presentation-ui.mjs','src/types.ts','src/App.tsx','src/components/RootsDensityColorControls.tsx','src/components/RootsParameterEditor.tsx','src/components/Fields.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/PaletteEditor.tsx','src/components/Timeline.tsx',
 'src/components/RootsMathControls.tsx','src/components/EquationEditor.tsx','src/components/ExplorePanel.tsx','src/engine/rootsMathConfig.ts','src/engine/rootsVariableLabel.ts','src/engine/rootsMathJob.ts','src/engine/rootsNativeExpression.ts','src/engine/rootsNativePolynomial.ts','src/engine/rootsNativeSolver.ts','src/engine/rootsNativeSampling.ts','src/engine/rootsSourceOrder.ts','src/engine/rootsSourceCharacters.ts','src/engine/rootsSourceRandom.ts','src/engine/rootsParameterSampling.ts','src/engine/sourceJson.ts','src/engine/sourceJavaText.ts','src/engine/equationEditor.ts','src/engine/sceneParameters.ts','src/engine/complexExplore.ts','src/engine/document.ts','src/engine/legacyImport.ts','src/engine/rootsControls.ts','src/engine/rootsDensityColor.ts','src/engine/sourceConfigColor.ts','src/engine/sourceNumberTokens.ts','src/engine/rootsSampling.ts','src/engine/rootsInk.ts','src/engine/rootsDensityGpu.ts','src/engine/rootsDensityToneGpu.ts','src/engine/rootsGpuFailure.ts','src/engine/rootParameters.ts','src/scenes/rootsDensity.ts','src/scenes/complex.ts',
 'src/engine/client.ts','src/engine/generate.worker.ts','src/engine/generationQueue.ts','src/engine/generationProtocol.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/gradientOffsets.ts','src/engine/generationCleanup.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts','src/engine/rasterDimensions.ts','src/engine/preferences.ts','src/engine/density.ts','src/engine/densityGpuTone.ts','src/engine/palette.ts','src/engine/polynomial.ts','src/engine/domainSourceScalar.ts','src/i18n.tsx','src/styles.css','src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json',
 'src/components/RootsPresentationControls.tsx','src/engine/rootsPresentationConfig.ts','src/engine/rootsPresentationAuthoring.ts','src/engine/rootsPresentationFacts.ts','src/engine/rootsPresentationRequest.ts','src/engine/rootsProjection.ts','src/engine/rootsNativeInk.ts','src/engine/rootsNativeDensityGpu.ts','src/engine/rootsNativeDisplay.ts','src/engine/rootsNativePointCloudGpu.ts','src/engine/rootsPointCloudRing.ts','src/engine/rootsNativePresentationSession.ts',
];
const sha=value=>createHash('sha256').update(value).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const check=(condition,message)=>{if(!condition)throw Error(message);};
// Match ENGLISH_CATALOG precedence without importing React or a TS loader.
const catalog=Object.assign({},...await Promise.all(['metadata','components','application'].map(async name=>JSON.parse(await readFile(`src/locales/${name}.en.json`,'utf8')))));
const label=source=>catalog[source]??source;
const version='mathart-1.7.8-v1',directory=`.cache/roots-presentation-ui-run-${Date.now()}`;
await mkdir(directory,{recursive:true});
const artifact=name=>`${directory}/${name}`,beforeHashes=await hashes(),checks={},pageErrors=[];
const report={at:new Date().toISOString(),scope:'Actual owned headless Chrome App with a small validated saved document: explicit native presentation activation, density/point-cloud Apply boundaries, same-instance tone/angle edits, transform clear followed by new arrivals, dormant profile retention, Save/reload/JSON download, explicit fresh sampling restart, and 257x193 cold PNG export. Worker requests/completions and exact output-object renderer consumption are passively observed. PNG uses opaque framebuffer RGB and local cold replay, not the original paused same-instance export or native pixels.',sourceSnapshotsBefore:beforeHashes,artifacts:{directory,screenshot:artifact('ui.png'),exportPng:artifact('export.png')}};
let server,browser,page,error;
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const mark=()=>page.evaluate(()=>({issued:window.__audit.issued,completed:window.__audit.completionCount,workers:window.__audit.workersCreated}));
const fresh=async(before,expected)=>{
 await page.waitForFunction(({before,expected})=>window.__audit.completed.some(row=>row.issuedSequence>before.issued&&row.completionSequence>before.completed&&window.__audit.matches(row,expected)),{before,expected});
 await ready();
 return page.evaluate(({before,expected})=>window.__audit.completed.findLast(row=>row.issuedSequence>before.issued&&row.completionSequence>before.completed&&window.__audit.matches(row,expected)),{before,expected});
};
const installRendererAudit=()=>page.evaluate(async()=>{
 const {ArtRenderer}=await import('/src/engine/renderer.ts');
 const set=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose,ids=new WeakMap();let next=0;
 window.__renderAudit={outputs:[],disposed:[]};
 ArtRenderer.prototype.setOutput=function(output,scene,...args){
  const result=set.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);
  const done=window.__audit.outputOwners.get(output);
  window.__renderAudit.outputs.push({id,sceneId:scene.id,issuedSequence:done?.issuedSequence,completionSequence:done?.completionSequence,workerId:done?.workerId,pixelHash:done?.pixelHash,width:this.renderer.domElement.width,height:this.renderer.domElement.height,rootsPresentation:output.rootsPresentation});return result;
 };
 ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this));return result;};
});
const rendered=async row=>{
 await page.waitForFunction(row=>window.__renderAudit.outputs.some(x=>x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence&&x.workerId===row.workerId),row);
 return page.evaluate(row=>window.__renderAudit.outputs.findLast(x=>x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence&&x.workerId===row.workerId),row);
};
const geometry=()=>page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
const seek=async(id,time)=>{const before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));const row=await fresh(before,{id,time});await rendered(row);return row;};
const unchangedInstance=(before,after,message)=>{
 const a=before.output.rootsPresentation,b=after.output.rootsPresentation;
 check(after.workerId===before.workerId&&a.instance===b.instance&&b.restartReason===null&&b.newSamples===0&&b.newRawPoints===0&&b.totalRawPoints===a.totalRawPoints,message);
};
const checkViewport=row=>{
 const facts=row.output.rootsPresentation,request=row.request.context.rootsViewport;
 check(request&&facts&&JSON.stringify(facts.physicalSize)===JSON.stringify([row.request.context.width,row.request.context.height])&&JSON.stringify(facts.logicalSize)===JSON.stringify([request.logicalWidth,request.logicalHeight])&&facts.referenceLogicalHeight===request.referenceLogicalHeight&&facts.target===request.target,'delivered physical/logical/reference/target facts do not match actual request');
};
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.__audit={issued:0,completionCount:0,completed:[],errors:[],workersCreated:0,workersTerminated:0,outputOwners:new WeakMap()};
  const read=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
  window.__audit.matches=(row,e)=>row.request.scene.kind==='roots'&&row.request.context.quality!=='export'&&(e.id===undefined||row.request.scene.id===e.id)&&(e.time===undefined||row.request.context.time===e.time)&&(e.profile===undefined||row.request.scene.rootsPresentation?.model===e.profile)&&(e.mode===undefined||row.request.scene.rootsPresentation?.mode===e.mode)&&(!e.values||Object.entries(e.values).every(([path,value])=>read(row.request.scene,path)===value));
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;workerId;
   constructor(...args){super(...args);this.workerId=++window.__audit.workersCreated;this.addEventListener('message',({data})=>{
    if(data.operation!=='generate'||data.progress)return;const sent=this.sent.get(data.id);if(!sent||data.sessionId!==sent.request.sessionId)return;
    if(data.error){window.__audit.errors.push({...sent,error:data.error});this.sent.delete(data.id);return;}
    if(!data.output)return;const{pixels,...output}=data.output;let pixelHash=2166136261;const colors=new Set();for(let i=0;i<(pixels?.length??0);i++){pixelHash^=pixels[i];pixelHash=Math.imul(pixelHash,16777619);if(i%4===0&&colors.size<16)colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);}
    const row={...sent,output,pixelHash:pixelHash>>>0,distinctRgbUpTo16:colors.size,completionSequence:++window.__audit.completionCount};
    window.__audit.outputOwners.set(data.output,row);window.__audit.completed.push(row);this.sent.delete(data.id);if(window.__audit.completed.length>100)window.__audit.completed.shift();
   });}
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{request:structuredClone(message),issuedSequence:++window.__audit.issued,workerId:this.workerId});return super.postMessage(message,...args);}
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 await page.route('**/api/health',route=>route.fulfill({status:503,contentType:'text/plain',body:'Use actual production local PNG Blob export.'}));
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const {createScene,parseScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{createRootsNativeMath}=await import('/src/engine/rootsMathConfig.ts');
  const scene=createScene(definition('roots'));scene.name='Roots presentation saved document fixture';scene.rootsMath=createRootsNativeMath(1);
  scene.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'2',expression:'1'},{exponent:'0',expression:'-0.04*t2'}]};
  scene.rootsMath.sampling={...scene.rootsMath.sampling,sampleCount:100,batchSize:10,seed:'91'};
  scene.rootsSourcePalette={colors:['#FF1050F0','#FFFF6020','#FF20FF90']};
  Object.assign(scene.settings,{rootsMode:'progressive',rootSamplesPerFrame:10,rootSamplingFps:2,rootStartTime:0,rootDensityBackend:'cpu',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceBrightness:.5,rootSourceGamma:1,background:'#000000',showGrid:false,showAxes:false});
  scene.timeline={duration:5,fps:30,loop:false,playbackMode:'once',tracks:[]};
  const validated=parseScene(JSON.stringify(scene));saveWorkspace(localStorage,{scenes:[validated],active:validated.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return validated;
 });
 report.fixture=fixture;await writeFile(artifact('fixture.mathart.json'),JSON.stringify(fixture,null,2)+'\n');
 await page.goto(origin);let row=await fresh({issued:0,completed:0},{id:fixture.id});checks.initialOmitted=row;
 check(row.request.scene.rootsPresentation===undefined&&row.output.rootsPresentation===undefined,'saved omission silently enabled source presentation');
 await installRendererAudit();await geometry();
 let before=await mark();await page.getByRole('button',{name:label('启用 MathArt 空间显示'),exact:true}).click();
 row=await fresh(before,{id:fixture.id,profile:version,mode:'density'});await rendered(row);checkViewport(row);checks.activated=row;
 check(row.output.backend==='webgl2'&&row.output.rootsPresentation.restartReason==='initial'&&row.output.rootsPresentation.newSamples===10&&row.output.rootsPresentation.totalRawPoints===20,'native density activation did not produce actual first ten samples');
 check(row.request.scene.rootsPresentation.camera.phi===Math.fround(Math.PI/2),'source camera default missing Scene PI/2 override');
 check(row.request.scene.rootsMath.sampling.sampleCount===100&&JSON.stringify(row.request.scene.palette)===JSON.stringify(fixture.palette),'explicit presentation activation lost existing math or dormant local palette');
 // The source default is an edge-on view of density's z=0 plane. Give this
 // small sparse witness an explicitly authored front view and visible splats;
 // recapture at time zero, since angle/dot edits do not replay historical ink.
 const viewPreparation=[];let setupBefore=row;
 before=await mark();await page.getByRole('spinbutton',{name:label('相机 phi（弧度）'),exact:true}).fill('0');
 row=await fresh(before,{id:fixture.id,values:{'rootsPresentation.camera.phi':0}});await rendered(row);unchangedInstance(setupBefore,row,'front-view edit replayed samples');viewPreparation.push(row);setupBefore=row;
 before=await mark();await page.getByRole('spinbutton',{name:label('空间点尺寸'),exact:true}).fill('0.08');
 row=await fresh(before,{id:fixture.id,values:{'rootsPresentation.dotSize':.08}});await rendered(row);unchangedInstance(setupBefore,row,'point-size edit replayed samples');viewPreparation.push(row);setupBefore=row;
 before=await mark();await page.getByRole('button',{name:label('重新开始空间采样'),exact:true}).click();
 row=await fresh(before,{id:fixture.id,time:0,profile:version,mode:'density'});await rendered(row);
 check(row.workerId!==setupBefore.workerId&&row.request.context.rootsSessionId!==setupBefore.request.context.rootsSessionId&&row.output.rootsPresentation.restartReason==='initial'&&row.output.rootsPresentation.newSamples===10&&row.distinctRgbUpTo16>1&&JSON.stringify(row.request.scene)===JSON.stringify(setupBefore.request.scene),'same-time restart did not create visible first-sample ink with unchanged authored view');
 checks.visibleFixture={viewPreparation,restarted:row,scope:'Explicitly authored phi0/dot.08 witness; source default phiPI/2 was separately checked and retained above.'};
 row=await seek(fixture.id,.5);checks.advancedDensity=row;check(row.output.rootsPresentation.attemptedSamples===20&&row.output.rootsPresentation.newSamples===10,'forward request did not advance exactly ten new samples');

 let previous=row;before=await mark();await page.locator('#control-rootSourceBrightness').fill('0.9');
 row=await fresh(before,{id:fixture.id,values:{'settings.rootSourceBrightness':.9}});await rendered(row);unchangedInstance(previous,row,'tone edit restarted workers or replayed raw samples');
 check((await mark()).workers===before.workers&&row.pixelHash!==previous.pixelHash,'tone edit either started a worker or failed to change visible pixels');checks.toneEdit=row;
 previous=row;before=await mark();await page.getByRole('spinbutton',{name:label('相机 theta（弧度）'),exact:true}).fill('0.35');
 row=await fresh(before,{id:fixture.id,values:{'rootsPresentation.camera.theta':.35}});await rendered(row);unchangedInstance(previous,row,'angle edit restarted instance or raw samples');
 check((await mark()).workers===before.workers&&!row.output.rootsPresentation.density.clearInk&&row.output.rootsPresentation.density.displayRotation!==0,'density angle edit did not retain anchored ink');checks.angleEdit=row;
 previous=row;before=await mark();await page.getByRole('spinbutton',{name:label('空间偏移 X'),exact:true}).fill('7');
 row=await fresh(before,{id:fixture.id,values:{'rootsPresentation.transform.offset.0':7}});await rendered(row);unchangedInstance(previous,row,'transform edit replayed history instead of clearing display');
 check(row.output.rootsPresentation.density.clearInk&&row.output.rootsPresentation.density.clearReasons.includes('transform')&&row.output.rootsPresentation.density.submittedFinitePointCount===0,'transform edit did not clear historical ink');checks.transformClear=row;
 row=await seek(fixture.id,1);check(row.output.rootsPresentation.instance===previous.output.rootsPresentation.instance&&row.output.rootsPresentation.newSamples===10&&row.output.rootsPresentation.newRawPoints===20&&row.output.rootsPresentation.density.submittedFinitePointCount===20,'new arrivals after clear include history or omit new points');checks.newArrivalsAfterClear=row;

 previous=row;before=await mark();await page.getByRole('combobox',{name:label('空间显示方式'),exact:true}).selectOption('point-cloud');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 check((await mark()).issued===before.issued,'mode selector applied before explicit Apply');
 await page.getByRole('button',{name:label('应用显示方式并重新采样'),exact:true}).click();
 row=await fresh(before,{id:fixture.id,mode:'point-cloud'});await rendered(row);checkViewport(row);
 check(row.workerId===previous.workerId&&row.output.rootsPresentation.instance>previous.output.rootsPresentation.instance&&row.output.rootsPresentation.restartReason==='mode'&&row.output.rootsPresentation.newSamples===30&&row.output.rootsPresentation.pointCloud.retainedPoints===60,'point-cloud Apply did not create the declared new sampling instance');checks.pointCloudApply=row;
 const cloud=structuredClone(row.request.scene.rootsPresentation);
 before=await mark();await page.getByRole('button',{name:label('返回本地平面显示'),exact:true}).click();
 row=await fresh(before,{id:fixture.id,profile:'local-v1'});await rendered(row);
 check(row.output.rootsPresentation===undefined&&JSON.stringify({...row.request.scene.rootsPresentation,model:version})===JSON.stringify(cloud),'local switch lost dormant presentation or kept executing it');checks.dormantLocal=row;
 before=await mark();await page.getByRole('button',{name:label('启用 MathArt 空间显示'),exact:true}).click();row=await fresh(before,{id:fixture.id,profile:version,mode:'point-cloud'});await rendered(row);
 check(JSON.stringify(row.request.scene.rootsPresentation)===JSON.stringify(cloud)&&row.output.rootsPresentation.pointCloud.retainedPoints===60,'re-enabled source profile did not preserve authored payload');checks.reenabled=row;
 previous=row;before=await mark();await page.getByRole('combobox',{name:label('空间显示方式'),exact:true}).selectOption('density');await page.getByRole('button',{name:label('应用显示方式并重新采样'),exact:true}).click();
 row=await fresh(before,{id:fixture.id,profile:version,mode:'density'});await rendered(row);
 check(row.workerId===previous.workerId&&row.output.rootsPresentation.instance>previous.output.rootsPresentation.instance&&row.output.rootsPresentation.restartReason==='mode','return to density did not reset the presentation instance');checks.densityApply=row;
 const savedPresentation=structuredClone(row.request.scene.rootsPresentation);
 const projectDownload=page.waitForEvent('download');await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();const project=await projectDownload;await project.saveAs(artifact('saved.mathart.json'));
 const text=await readFile(artifact('saved.mathart.json'),'utf8'),parsed=await page.evaluate(async text=>{const{parseScene}=await import('/src/engine/document.ts');return parseScene(text);},text);
 const persisted=JSON.parse(text);
 check(JSON.stringify(parsed.rootsPresentation)===JSON.stringify(savedPresentation)&&!Object.hasOwn(persisted,'rootsSessionId')&&!Object.hasOwn(persisted,'rootsViewport')&&!Object.hasOwn(persisted.rootsPresentation,'instance'),'downloaded project lost authored presentation or serialized runtime execution identity');checks.downloadedProject={sha256:sha(text),scene:parsed};
 previous=row;before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,{id:fixture.id,profile:version,mode:'density'});await rendered(row);
 unchangedInstance(previous,row,'Save replaced the active worker or replayed raw samples');check(row.request.context.rootsSessionId===previous.request.context.rootsSessionId,'Save changed the runtime presentation identity');checks.savedWithoutRestart=row;
 await page.reload();row=await fresh({issued:0,completed:0},{id:fixture.id,profile:version,mode:'density'});
 check(JSON.stringify(row.request.scene.rootsPresentation)===JSON.stringify(savedPresentation)&&row.output.rootsPresentation.restartReason==='initial','Save/reload failed to rebuild a new source instance with saved settings');checks.reloaded=row;
 const reloadStartup=await page.evaluate(async id=>{
  const rect=document.querySelector('.viewport').getBoundingClientRect(),logicalSize=[Math.round(rect.width),Math.round(rect.height)];
  const{previewDimensions}=await import('/src/engine/preferences.ts');
  return{logicalSize,expectedRaster:previewDimensions('low',...logicalSize),completions:window.__audit.completed.filter(x=>x.request.scene.id===id&&x.request.context.quality!=='export')};
 },fixture.id),firstReload=reloadStartup.completions[0];
 check(firstReload&&firstReload.output.rootsPresentation.restartReason==='initial'&&firstReload.output.rootsPresentation.newSamples===10&&firstReload.output.rootsPresentation.totalRawPoints===20&&firstReload.distinctRgbUpTo16>1,'first reload frame did not show its initial sample batch');
 check(firstReload.request.context.rootsSessionId!==checks.savedWithoutRestart.request.context.rootsSessionId,'reload reused the previous runtime presentation identity');
 for(const shown of reloadStartup.completions){const c=shown.request.context,f=shown.output.rootsPresentation;
  check(JSON.stringify(shown.request.scene.rootsPresentation)===JSON.stringify(savedPresentation)&&JSON.stringify(f.logicalSize)===JSON.stringify(reloadStartup.logicalSize)&&c.rootsViewport.logicalWidth===reloadStartup.logicalSize[0]&&c.rootsViewport.logicalHeight===reloadStartup.logicalSize[1]&&c.rootsViewport.referenceLogicalHeight===reloadStartup.logicalSize[1]&&c.width===reloadStartup.expectedRaster.width&&c.height===reloadStartup.expectedRaster.height,'reload generated against provisional dimensions or changed the saved presentation');
  check(shown.workerId===firstReload.workerId&&f.instance===firstReload.output.rootsPresentation.instance&&c.rootsSessionId===firstReload.request.context.rootsSessionId&&!f.density.clearInk&&shown.distinctRgbUpTo16>1,'startup discarded ink or replaced the first measured presentation instance');checkViewport(shown);
 }
 checks.reloadMeasuredStartup=reloadStartup;
 await installRendererAudit();row=await seek(fixture.id,1);await rendered(row);checkViewport(row);checks.reloadedSeek=row;
 await geometry();previous=row;before=await mark();await page.getByRole('button',{name:label('重新开始空间采样'),exact:true}).click();row=await fresh(before,{id:fixture.id,time:0,profile:version,mode:'density'});await rendered(row);
 check(row.workerId!==previous.workerId&&row.request.context.rootsSessionId!==previous.request.context.rootsSessionId&&row.output.rootsPresentation.restartReason==='initial'&&row.output.rootsPresentation.attemptedSamples===10&&row.output.rootsPresentation.totalRawPoints===20&&JSON.stringify(row.request.scene)===JSON.stringify(previous.request.scene),'Restart spatial sampling did not create a fresh worker at the sampling start with unchanged authored document');checks.restartedSampling=row;
 row=await seek(fixture.id,1);checkViewport(row);checks.restartedSeek=row;

 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Roots image source',exact:true}).selectOption('replay');
 await page.getByText(label('空间复根导出会从初始采样重放到所选时间，使用当前相机和导出尺寸；预览中的历史墨迹与点云拖影不会复制。'),{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 before=await mark();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const pngDownload=await downloading;await pngDownload.saveAs(artifact('export.png'));await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(before=>window.__audit.completed.findLast(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&x.request.context.quality==='export'),before);
 check(exported?.output.backend==='webgl2'&&exported.output.width===257&&exported.output.height===193,'actual spatial export dimensions/backend absent');checkViewport(exported);
 check(exported.request.context.rootsViewport.target==='offscreen'&&exported.request.context.rootsViewport.logicalWidth===257&&exported.request.context.rootsViewport.logicalHeight===193&&exported.request.context.rootsViewport.referenceLogicalHeight===row.output.rootsPresentation.referenceLogicalHeight,'PNG request confused export logical size and primary reference height');
 const exportRenderer=await rendered(exported);check(exportRenderer.width===257&&exportRenderer.height===193,'actual export renderer dimensions differ');
 const png=await readFile(artifact('export.png'));
 const oracle=await page.evaluate(async({request,actualPng})=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
  const decode=async blob=>{const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,canvas.width,canvas.height).data;};
  try{
   const output=await generator.generate(request.scene,request.context),scene=sceneAtTime(request.scene,request.context.time);renderer.setSize(257,193,1);renderer.setOutput(output,scene,false,outputCamera(scene,output));
   const expected=await decode(await renderer.blob('image/png')),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
   let changedChannels=0,maxDifference=0,nonOpaquePixels=0;const colors=new Set();for(let i=0;i<actual.length;i++){const difference=Math.abs(actual[i]-expected[i]);if(difference)changedChannels++;maxDifference=Math.max(maxDifference,difference);if(i%4===0){colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);if(actual[i+3]!==255)nonOpaquePixels++;}}
   return{changedChannels,maxDifference,nonOpaquePixels,distinctRgb:colors.size,decodedBytes:actual.length,rootsPresentation:output.rootsPresentation,backend:output.backend};
  }finally{generator.dispose();renderer.dispose();}
 },{request:exported.request,actualPng:png.toString('base64')});
 check(oracle.changedChannels===0&&oracle.maxDifference===0&&oracle.decodedBytes===257*193*4&&oracle.distinctRgb>1&&oracle.nonOpaquePixels===0,'actual PNG differs from exact-request cold production replay, is uniform, or has unexpected transparency');
 check(exported.output.rootsPresentation.presentationAlpha==='opaque-framebuffer-rgb','export facts do not declare the delivered opaque framebuffer RGB policy');
 check(JSON.stringify(oracle.rootsPresentation)===JSON.stringify(exported.output.rootsPresentation),'cold export/replay delivered presentation facts differ');
 checks.png={exported,renderer:exportRenderer,oracle,sha256:sha(png),bytes:png.length,scope:'Two independent local cold instances with the same captured request; not a native paused snapshot or proof that hot ink was copied.'};
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await geometry();await page.getByRole('combobox',{name:label('空间显示方式'),exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:artifact('ui.png')});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,render:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!pageErrors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected App/worker error');check(audit.render.disposed.includes(exportRenderer.id),'actual export renderer not disposed');
 const after=await hashes();check(JSON.stringify(beforeHashes)===JSON.stringify(after),'source changed during UI run');
 Object.assign(report,{status:'passed',checks,audit,sourceSnapshots:after,sourceStable:true,limitations:['A small 100-sample source-math document on one owned Chrome instance; no capacity or speedup claim.','Arrival order and time use the explicit local global-ordinal fixed-sample contract, not original concurrent Java scheduling.','Spatial rules are enabled through UI on a valid saved document; native file import mapping is intentionally outside this run.','Cold PNG equality proves exact-request local export consistency, not original Processing/GLSL/driver pixels or original same-instance paused capture.','Point-cloud Apply and delivered ring counts are checked; full native-shape fallback and arbitrary DPI/monitor migration are not established.']});
}catch(cause){
 error=cause;Object.assign(report,{status:'failed',error:String(cause),errorStack:cause?.stack,completedChecksBeforeFailure:checks});
 if(page&&!page.isClosed()){await page.screenshot({path:artifact('failure.png')}).catch(()=>{});report.failure={screenshot:artifact('failure.png'),body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>{const{outputOwners,...audit}=window.__audit;return audit;}).catch(()=>null),pageErrors};}
}finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(value=>value.status==='rejected'?[String(value.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('cleanup failed');report.status='failed';}
 await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path:artifact('report.json'),status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
