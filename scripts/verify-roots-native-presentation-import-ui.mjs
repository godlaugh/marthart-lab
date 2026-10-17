import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual App operations and passive Worker/ArtRenderer observations only.
// No replaced generators, fake completion, modified pixels or fault injection.
const scriptPath='scripts/verify-roots-native-presentation-import-ui.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourcePaths=async directory=>{const paths=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())paths.push(...await sourcePaths(path));else if(entry.isFile())paths.push(path);else throw Error('Unexpected source entry: '+path);}return paths;};
const hashes=async()=>Object.fromEntries(await Promise.all([...(await sourcePaths('src')),scriptPath].sort().map(async path=>[path,sha(await readFile(path))])));
const check=(condition,message)=>{if(!condition)throw Error(message);};
// Match ENGLISH_CATALOG precedence without importing React or a TS loader.
const catalog=Object.assign({},...await Promise.all(['metadata','components','application'].map(async name=>JSON.parse(await readFile(`src/locales/${name}.en.json`,'utf8')))));
const label=source=>catalog[source]??source;
const version='mathart-1.7.8-v1',directory=`.cache/roots-native-presentation-import-ui-run-${Date.now()}`;
await mkdir(directory,{recursive:true});
const artifact=name=>`${directory}/${name}`,beforeHashes=await hashes(),checks={},pageErrors=[];
const report={at:new Date().toISOString(),scope:'Actual owned headless Chrome App: source JSON input-file imports automatically select native density and point-cloud presentation; source provenance, independently specified canonical spatial fields, measured first viewport, actual palette edit/restore without re-sampling, save/download/same-id reopen/reload and two 257x193 PNG exports are checked. Worker/session requests and exact output-object renderer consumption are observed passively. Export is the explicit local cold-replay policy, not original paused-instance capture or native pixel parity.',sourceSnapshotsBefore:beforeHashes,priorVerifierFailure:{path:'.cache/roots-native-presentation-import-ui-run-1792112601348/report.json',sha256:'4a161b883f2fc765dba3a90b757d45a6af31019b12391ee9d5b66825f3dc0cfb',reason:'The first verifier incorrectly required density-only output.rootsColor on point-cloud output. The actual cloud frame had 200 retained/drawn points and visible nonuniform pixels; the producer intentionally emits density color facts only for density. This verifier now checks each mode contract and actual palette edit/restore effects without re-sampling.'},artifacts:{directory,screenshots:[artifact('density-ui.png'),artifact('point-cloud-ui.png')],exportPngs:[artifact('density-export.png'),artifact('point-cloud-export.png')]}};
await writeFile(artifact('verifier.mjs'),await readFile(scriptPath),{flag:'wx'});
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
  window.__audit.matches=(row,e)=>row.request.scene.kind==='roots'&&row.request.context.quality!=='export'&&(e.id===undefined||row.request.scene.id===e.id)&&(e.name===undefined||row.request.scene.name===e.name)&&(e.time===undefined||row.request.context.time===e.time)&&(e.profile===undefined||row.request.scene.rootsPresentation?.model===e.profile)&&(e.mode===undefined||row.request.scene.rootsPresentation?.mode===e.mode)&&(!e.values||Object.entries(e.values).every(([path,value])=>read(row.request.scene,path)===value));
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
 const startup=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('roots'));scene.name='Native presentation import starting workspace';scene.equations.polynomial='z^2-1';
  Object.assign(scene.settings,{sampleCount:1,rootsMode:'single',showAxes:false,showGrid:false});
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });
 await page.goto(origin);await fresh({issued:0,completed:0},{id:startup.id});await installRendererAudit();

 // Expected config is transcribed from the retained source key/default contract.
 // Do not obtain it by calling the importer or the configuration default owner.
 const cases=[['density','GPU_DENSITY',0,0],['point-cloud','GPU_3D',.2,.15]].map(([mode,sourceMode,phi,theta])=>({
  mode,
  native:{config_version:'1.0.0',type:'COMPLEX_ROOTS',name:`Native ${mode} actual file import`,
   polynomial:{variable:'x',coefficients:{2:'1',0:'-0.04*t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},
   sampling:{sample_count:100,batch_size:10,seed:'91'},palette:['#FF1050F0','#FFFF6020','#FF20FF90'],
   camera:{phi,theta,gamma:0,zoom:9},
   settings:{render_mode:sourceMode,worker_count:1,solver_max_iterations:180,solver_tolerance:1e-9,
    scale_x:'120*2',scale_y:160,scale_z:35,offset_x:2,offset_y:-3,offset_z:0,rotation:'30/2',dot_size:.08,
    color_metric:'im(t2)',brightness:.9,contrast:1,gamma:1,dynamic_range:.9,saturation:1,background_color:'#000000',
    use_accumulation_buffer:true,accumulation_fade_alpha:91}},
  expected:{model:version,mode,transform:{scale:[240,160,35],offset:[2,-3,0],rotationDegrees:15},
   camera:{phi:Math.fround(phi),theta:Math.fround(theta),gamma:0,center:[0,0,0],zoom:1,focalDistance:20},
   dotSize:Math.fround(.08),accumulation:{enabled:false,fadeAlpha:6}},
 }));
 report.fixtures=cases;
 const assertFrame=(row,fixture,expectedColors=fixture.native.palette)=>{
  checkViewport(row);
  const scene=row.request.scene,facts=row.output.rootsPresentation;
  check(JSON.stringify(scene.rootsPresentation)===JSON.stringify(fixture.expected),'source import differs from independent canonical presentation expectation');
  check(JSON.stringify(scene.provenance?.original)===JSON.stringify(fixture.native),'native original provenance was changed or dropped');
  check(scene.rootsMath?.model===version&&scene.rootsMath.sampling.sampleCount===100&&scene.rootsMath.sampling.batchSize===10&&scene.rootsMath.sampling.seed==='91','source math sampling fields lost during spatial import');
  check(scene.settings.rootDensityColorVersion==='mathart-1.7.8-metric-v1'&&scene.settings.rootsMode==='progressive'&&scene.settings.rootColor==='t2_imag'&&JSON.stringify(scene.rootsSourcePalette?.colors)===JSON.stringify(expectedColors),'native presentation did not retain source palette/metric/progressive inputs');
  if(fixture.mode==='density'){
   const color=row.output.rootsColor;check(color?.version==='mathart-1.7.8-metric-v1'&&color.inkKind==='metric-sum'&&color.metric==='t2_imag'&&color.submittedFinitePointCount===facts.density?.submittedFinitePointCount,'density-only delivered metric/color facts are missing or inconsistent');
  }else{
   const cloud=facts.pointCloud;check(!facts.density&&row.output.rootsColor===undefined&&cloud?.retainedPoints>0&&cloud.drawnPoints>0&&cloud.accumulationEnabled===false&&cloud.fadeAlpha===6,'cloud output does not match its ring/draw/accumulation contract');
  }
  check(row.output.backend==='webgl2'&&facts?.model===version&&facts.mode===fixture.mode&&facts.attemptedSamples>0&&facts.attemptedSamples<=100&&facts.totalRawPoints>0,'source import did not deliver the requested native presentation');
  check(row.distinctRgbUpTo16>1,'visible native import witness is uniform');
  check(scene.provenance.warnings.some(w=>w.includes('zoom'))&&scene.provenance.warnings.some(w=>w.includes('use_accumulation_buffer')),'unsupported camera/wrapper fields were silently consumed');
  check(fixture.mode==='density'?facts.density?.submittedFinitePointCount>0:facts.pointCloud?.retainedPoints>0,'mode-specific production counters are absent');
 };
 const assertMeasuredStartup=async(id,fixture,previousToken,from={issued:0,completed:0})=>{
  const actual=await page.evaluate(async({id,from})=>{
   const rect=document.querySelector('.viewport').getBoundingClientRect(),logicalSize=[Math.round(rect.width),Math.round(rect.height)],{previewDimensions}=await import('/src/engine/preferences.ts');
   return{logicalSize,expectedRaster:previewDimensions('low',...logicalSize),completions:window.__audit.completed.filter(x=>x.request.scene.id===id&&x.request.context.quality!=='export'&&x.issuedSequence>from.issued&&x.completionSequence>from.completed)};
  },{id,from});
  const first=actual.completions[0];check(first&&first.output.rootsPresentation?.restartReason==='initial','document opening did not create a fresh presentation instance');
  if(previousToken!==undefined)check(first.request.context.rootsSessionId!==previousToken,'document reopen reused the previous runtime token');
  for(const row of actual.completions){
   assertFrame(row,fixture);const context=row.request.context,facts=row.output.rootsPresentation;
   check(JSON.stringify(facts.logicalSize)===JSON.stringify(actual.logicalSize)&&context.rootsViewport.referenceLogicalHeight===actual.logicalSize[1]&&context.width===actual.expectedRaster.width&&context.height===actual.expectedRaster.height,'startup consumed samples using provisional viewport dimensions');
   check(row.workerId===first.workerId&&facts.instance===first.output.rootsPresentation.instance&&context.rootsSessionId===first.request.context.rootsSessionId&&(!facts.density||!facts.density.clearInk),'startup replaced the first measured instance or cleared its ink');
  }
  return actual;
 };
 for(const fixture of cases){
  const result=checks[fixture.mode]={};
  const text='// Actual source presentation import: clock defaults remain local replay policy.\n'+JSON.stringify(fixture.native,null,2)+'\n';
  await writeFile(artifact(`${fixture.mode}-native.json`),text,{flag:'wx'});
  let before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:`roots-${fixture.mode}-native.json`,mimeType:'application/json',buffer:Buffer.from(text)});
  let row=await fresh(before,{name:fixture.native.name,profile:version,mode:fixture.mode});await rendered(row);assertFrame(row,fixture);result.imported=row;
  const id=row.request.scene.id;result.measuredImport=await assertMeasuredStartup(id,fixture,undefined,before);
  await geometry();check(await page.getByRole('combobox',{name:label('空间显示方式'),exact:true}).inputValue()===fixture.mode,'imported spatial mode is not selected in the real UI');
  check(await page.getByRole('combobox',{name:'Roots math version',exact:true}).isDisabled(),'active native presentation permits a conflicting math selector');
  if(fixture.mode==='point-cloud'){
   await page.getByText(label('点云逐点读取源色板并按到达顺序透明混合；亮度不使用密度点数归一化。'),{exact:true}).waitFor();
   check(await page.getByText(label('等待与当前作品匹配的已呈现复根密度画面。'),{exact:true}).count()===0&&await page.getByText(label('版本只影响渐进密度；切换会保留两组色板和调色参数，不自动转换颜色。'),{exact:true}).count()===0,'cloud UI still advertises density-only status or scope');
   result.cloudColorExplanation={perPointPaletteVisible:true,densityWaitingAbsent:true,densityOnlyScopeAbsent:true};
  }
  check(Number(await page.getByRole('spinbutton',{name:label('复平面旋转（度）'),exact:true}).inputValue())===15&&Number(await page.getByRole('spinbutton',{name:label('相机 phi（弧度）'),exact:true}).inputValue())===fixture.expected.camera.phi,'UI confused source rotation degree and camera radian values');
  // Both modes must visibly consume the source palette. Cloud has no density
  // exposure facts: prove its actual color path by editing and restoring a raw
  // palette entry through UI while the same raw ring/instance remains fixed.
  const paletteBefore=row,originalColor=fixture.native.palette[0],editedColor='#FFFF00FF',editedColors=[...fixture.native.palette];editedColors[0]=editedColor;
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByRole('spinbutton',{name:label('复根源颜色序号'),exact:true}).fill('1');
  const colorInput=page.getByRole('textbox',{name:label('复根源颜色原文'),exact:true});check(await colorInput.inputValue()===originalColor,'palette editor did not show the imported first raw source color');
  before=await mark();await colorInput.fill(editedColor);
  row=await fresh(before,{id,profile:version,mode:fixture.mode,values:{'rootsSourcePalette.colors.0':editedColor}});const editedRenderer=await rendered(row);assertFrame(row,fixture,editedColors);
  const unchangedRaw=(a,b)=>{
   const x=a.output.rootsPresentation,y=b.output.rootsPresentation;
   check(a.workerId===b.workerId&&a.request.context.rootsSessionId===b.request.context.rootsSessionId&&x.instance===y.instance&&y.restartReason===null&&y.newSamples===0&&y.newRawPoints===0&&x.attemptedSamples===y.attemptedSamples&&x.totalRawPoints===y.totalRawPoints,'palette edit restarted the worker/instance or re-sampled raw points');
   check(JSON.stringify(a.request.scene.rootsMath)===JSON.stringify(b.request.scene.rootsMath)&&JSON.stringify(a.request.scene.rootsPresentation)===JSON.stringify(b.request.scene.rootsPresentation),'palette edit changed math or spatial inputs');
   if(fixture.mode==='point-cloud')check(JSON.stringify(x.pointCloud)===JSON.stringify(y.pointCloud),'palette edit changed retained/drawn ring facts');
   else check(x.density.submittedFinitePointCount===y.density.submittedFinitePointCount&&!y.density.clearInk,'palette edit cleared or changed density ink');
  };
  unchangedRaw(paletteBefore,row);check((await mark()).workers===before.workers&&row.pixelHash!==paletteBefore.pixelHash,'source palette edit did not change actual pixels without creating a worker');const paletteEdited=row;
  before=await mark();await colorInput.fill(originalColor);
  row=await fresh(before,{id,profile:version,mode:fixture.mode,values:{'rootsSourcePalette.colors.0':originalColor}});const restoredRenderer=await rendered(row);assertFrame(row,fixture);unchangedRaw(paletteEdited,row);
  check((await mark()).workers===before.workers&&row.pixelHash===paletteBefore.pixelHash,'restoring the source color did not restore exact pixels on the same raw state');
  result.paletteConsumption={before:paletteBefore,edited:paletteEdited,restored:row,editedRenderer,restoredRenderer,scope:'Actual App source palette edit/restore; same worker, presentation instance and raw counts; changed pixels then exact restoration.'};
  await geometry();
  const prior=row;before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,{id,profile:version,mode:fixture.mode});await rendered(row);assertFrame(row,fixture);
  check(row.workerId===prior.workerId&&row.request.context.rootsSessionId===prior.request.context.rootsSessionId&&row.output.rootsPresentation.instance===prior.output.rootsPresentation.instance&&row.output.rootsPresentation.newSamples===0,'Save reset or replayed the live source instance');result.saved=row;
  const downloadingProject=page.waitForEvent('download');await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();const project=await downloadingProject;await project.saveAs(artifact(`${fixture.mode}-saved.mathart.json`));
  const savedText=await readFile(artifact(`${fixture.mode}-saved.mathart.json`),'utf8'),persisted=JSON.parse(savedText),parsed=await page.evaluate(async text=>{const{parseScene}=await import('/src/engine/document.ts');return parseScene(text);},savedText);
  check(JSON.stringify(parsed.rootsPresentation)===JSON.stringify(fixture.expected)&&JSON.stringify(parsed.provenance)===JSON.stringify(row.request.scene.provenance),'downloaded project failed source profile/provenance roundtrip');
  check(!Object.hasOwn(persisted,'rootsSessionId')&&!Object.hasOwn(persisted,'rootsViewport')&&!Object.hasOwn(persisted.rootsPresentation,'instance'),'download serialized runtime presentation identity');result.downloaded={scene:parsed,sha256:sha(savedText)};
  const savedWorker=row.workerId,savedToken=row.request.context.rootsSessionId;
  before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:`roots-${fixture.mode}-saved.mathart.json`,mimeType:'application/json',buffer:Buffer.from(savedText)});
  row=await fresh(before,{id,profile:version,mode:fixture.mode});await rendered(row);assertFrame(row,fixture);
  check(row.workerId!==savedWorker&&row.request.context.rootsSessionId!==savedToken,'same-id saved document open retained the old worker/token');result.reopened=row;result.measuredReopen=await assertMeasuredStartup(id,fixture,savedToken,before);
  // Saving the reopened document also selects it in the workspace for reload.
  before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,{id,profile:version,mode:fixture.mode});await rendered(row);const tokenBeforeReload=row.request.context.rootsSessionId;
  await page.reload();row=await fresh({issued:0,completed:0},{id,profile:version,mode:fixture.mode});assertFrame(row,fixture);
  result.reloaded=row;result.measuredReload=await assertMeasuredStartup(id,fixture,tokenBeforeReload);await installRendererAudit();
  row=await seek(id,1);assertFrame(row,fixture);result.completedForExport=row;
  check(row.output.rootsPresentation.attemptedSamples===100,'small source fixture did not complete within its explicit local replay interval');
  await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Roots image source',exact:true}).selectOption('replay');
  await page.getByText(label('空间复根导出会从初始采样重放到所选时间，使用当前相机和导出尺寸；预览中的历史墨迹与点云拖影不会复制。'),{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
  before=await mark();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const pngDownload=await downloading;await pngDownload.saveAs(artifact(`${fixture.mode}-export.png`));await page.getByText('File ready · Download',{exact:false}).waitFor();
  const exported=await page.evaluate(({before,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&x.request.scene.id===id&&x.request.context.quality==='export'),{before,id});
  check(exported?.output.backend==='webgl2'&&exported.output.width===257&&exported.output.height===193,'native export did not use an actual 257x193 GPU frame');checkViewport(exported);
  check(exported.request.context.rootsViewport.target==='offscreen'&&exported.request.context.rootsViewport.logicalWidth===257&&exported.request.context.rootsViewport.logicalHeight===193&&exported.request.context.rootsViewport.referenceLogicalHeight===row.output.rootsPresentation.referenceLogicalHeight,'export confused logical and reference dimensions');
  const exportRenderer=await rendered(exported);check(exportRenderer.width===257&&exportRenderer.height===193,'actual export renderer dimensions differ');
  const png=await readFile(artifact(`${fixture.mode}-export.png`));
  const oracle=await page.evaluate(async({request,actualPng})=>{
   const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
   const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
   const decode=async blob=>{const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,canvas.width,canvas.height).data;};
   try{
    const output=await generator.generate(request.scene,request.context),scene=sceneAtTime(request.scene,request.context.time);renderer.setSize(257,193,1);renderer.setOutput(output,scene,false,outputCamera(scene,output));
    const expected=await decode(await renderer.blob('image/png')),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
    let changedChannels=0,maxDifference=0,nonOpaquePixels=0;const colors=new Set();for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d)changedChannels++;maxDifference=Math.max(maxDifference,d);if(i%4===0){colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);if(actual[i+3]!==255)nonOpaquePixels++;}}
    return{changedChannels,maxDifference,nonOpaquePixels,distinctRgb:colors.size,decodedBytes:actual.length,rootsPresentation:output.rootsPresentation,backend:output.backend};
   }finally{generator.dispose();renderer.dispose();}
  },{request:exported.request,actualPng:png.toString('base64')});
  check(oracle.changedChannels===0&&oracle.maxDifference===0&&oracle.decodedBytes===257*193*4&&oracle.distinctRgb>1&&oracle.nonOpaquePixels===0,'PNG differs from exact-request cold renderer replay, is uniform or is not opaque');
  check(exported.output.rootsPresentation.presentationAlpha==='opaque-framebuffer-rgb'&&JSON.stringify(oracle.rootsPresentation)===JSON.stringify(exported.output.rootsPresentation),'export/replay presentation facts differ');
  result.png={exported,renderer:exportRenderer,oracle,sha256:sha(png),bytes:png.length,scope:'Same captured request in independent local cold Generator instances, not original paused capture.'};
  await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await geometry();await page.getByRole('combobox',{name:label('空间显示方式'),exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:artifact(`${fixture.mode}-ui.png`)});
  result.audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,render:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
  check(!result.audit.workerErrors.length&&!result.audit.rendering&&!result.audit.error&&result.audit.render.disposed.includes(exportRenderer.id),'App error or undisposed actual export renderer');
 }
 check(!pageErrors.length,'unexpected page errors');const after=await hashes();check(JSON.stringify(beforeHashes)===JSON.stringify(after),'source changed during UI run');
 Object.assign(report,{status:'passed',checks,sourceSnapshots:after,sourceStable:true,limitations:['Two explicit small native JSON fixtures and one Chrome device; no large-capacity or speedup claim.','The camera phi0/phi.2 and dot.08 are explicit source inputs for visible witnesses; default-camera, malformed scalar and alias matrices are separate focused/Worker evidence.','Original camera.zoom and wrapper keys stay provenance-only; the accepted constructor baseline remains center0/zoom1/focal20 and wrapper false/6.','Sample progression follows the existing local clock; source batch size is not interpreted as attempted samples per display frame.','PNG equality proves this implementation\'s exact-request cold export policy, not original live scheduling, paused same-instance capture, Processing/GLSL driver pixels or native-shape fallback.']});
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
