import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity. One explicitly labelled pending-input
// case temporarily holds a real generate dispatch; it never fabricates output.
const paths=[
 'src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/planeNavigation.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-viewport-ui.mjs',
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const check=(value,message)=>{if(!value)throw Error(message);};
const attempt=Date.now();
await mkdir('.cache',{recursive:true});
const sourceBefore=await hashes(),report={at:new Date().toISOString(),scope:'Owned headless Chrome, actual local App controls, globally paired worker completions, one explicitly labelled bounded dispatch-delay case, downloaded PNG and cold Generator plus production ArtRenderer. No original application runtime, native parity or performance claim.',sourceSnapshotsBefore:sourceBefore};
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
     if(window.__audit.holdNext){
      window.__audit.holdNext=false;window.__audit.held=true;window.__audit.holdSummary={id:message.id,issuedSequence:sent.issuedSequence,time:message.context.time,release:null};
      const release=reason=>{if(!window.__audit.held)return;window.__audit.held=false;clearTimeout(timer);window.__audit.holdSummary.release=reason;super.postMessage(message,...args);};
      const timer=setTimeout(()=>release('watchdog'),10000);window.__audit.releaseHeld=()=>release('manual');return;
     }
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
  const scene=createScene(definition('domain'));scene.name='Domain viewport legacy fixture';
  Object.assign(scene.settings,{domainBackend:'cpu',centerX:.12,centerY:-.18,scale:1.25,rotation:.3});
  scene.equations.f='sin(z)+0.25*z';scene.equations.next='';scene.settings.iterationEnabled=false;
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });report.fixture=fixture;
 await page.goto(origin);
 checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.id,formula:fixture.equations.f,selectedBackend:'cpu',backend:'cpu',viewport:'local-v1',color:'local-v1',iteration:'local-v1'});
 const selector=()=>page.getByRole('combobox',{name:'Viewport coordinate rules',exact:true});
 const numericalSettings=scene=>Object.fromEntries(['centerX','centerY','scale','rotation'].map(key=>[key,scene.settings[key]]));
 const initialNumbers=numericalSettings(fixture);let before;
 for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu','local-v1']){
  before=await mark();await selector().selectOption(version);
  const row=await fresh(before,{id:fixture.id,viewport:version,settings:initialNumbers,selectedBackend:'cpu',color:'local-v1',iteration:'local-v1'});
  checks['localSwitch_'+version]=row;
  if(version==='local-v1')check(row.pixelHash===checks.initialLocal.pixelHash,'local viewport restoration changed legacy pixels');
 }
 const baseNative={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Viewport native',settings:{render_mode:'GPU'},domainColoring:{formula:'sin(z)+0.25*z'},timeline:[{type:'wait',duration:4}]};
 const input=page.locator('input[type=file][accept=".json"]');check(await input.count()===1,'native JSON input is ambiguous');
 const importNative=async(native,label,expected)=>{
  const text='// Native source viewport fixture\n'+JSON.stringify(native,null,2),path='.cache/domain-viewport-ui-'+label+'.json';
  await writeFile(path,text);const start=await mark();await input.setInputFiles({name:label+'.json',mimeType:'application/json',buffer:Buffer.from(text)});
  const row=await fresh(start,{name:native.name,time:0,...expected});
  check(JSON.stringify(row.request.scene.provenance?.original)===JSON.stringify(native),'import changed native source provenance');
  return{...row,input:{path,sha256:sha(text)}};
 };
 for(const mode of ['CPU','GPU']){
  const native={...baseNative,name:'Viewport default '+mode,settings:{render_mode:mode}};
  checks['nativeDefault'+mode]=await importNative(native,'default-'+mode,{viewport:'mathart-1.7.8-'+mode.toLowerCase(),color:'mathart-1.7.8-'+mode.toLowerCase(),iteration:'mathart-1.7.8',settings:{centerX:0,centerY:0,scale:2.5,rotation:0}});
 }
 const controlled=structuredClone(checks.nativeDefaultGPU.request.scene);controlled.id='viewport-controlled-scale';controlled.name='Viewport controlled scale';
 controlled.timeline={duration:4,fps:30,loop:false,tracks:[{id:'fixed-scale',type:'numeric',target:'settings.scale',from:2.5,to:2.5,start:0,duration:2,easing:'linear',pingPong:false,enabled:true}]};
 before=await mark();await input.setInputFiles({name:'controlled-scale.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(controlled))});
 checks.controlledScale=await fresh(before,{id:controlled.id,viewport:'mathart-1.7.8-gpu',settings:{scale:2.5},time:0});
 const controlledNote=page.getByText('The timeline controls this view. Disable the corresponding tracks before adjusting the viewport.',{exact:true});
 const blockMark=await mark(),blockedBox=await page.locator('[data-testid="art-canvas"]').boundingBox();check(blockedBox,'controlled canvas unavailable');
 await page.mouse.move(blockedBox.x+blockedBox.width*.55,blockedBox.y+blockedBox.height*.5);await page.mouse.down();await page.mouse.move(blockedBox.x+blockedBox.width*.55+20,blockedBox.y+blockedBox.height*.5+15);await page.mouse.up();await page.mouse.wheel(0,-70);
 await page.getByTitle('Fit to canvas',{exact:true}).click();await controlledNote.waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 checks.controlledGesture={before:blockMark,after:await mark(),note:await controlledNote.innerText(),settings:await page.evaluate(()=>window.__audit.completed.at(-1).request.scene.settings)};
 check(checks.controlledGesture.after.issued===blockMark.issued&&checks.controlledGesture.settings.scale===2.5,'controlled gesture silently changed baseline or issued hidden generation');
 await page.screenshot({path:'.cache/domain-viewport-ui-controlled.png'});
 const native={...baseNative,name:'Viewport raw source',domainColoring:{...baseNative.domainColoring,viewport:{centerX:.125,centerY:-.25,scale:-2,rotation:.8}},timeline:[{type:'animate',duration:1,easing:'linear',actions:[{method:'domainRotate',args:[.4]}]},{type:'animate',duration:1,easing:'linear',actions:[{method:'domainRotate',args:[]}]},{type:'wait',duration:2}]};
 checks.rawImport=await importNative(native,'raw-source',{viewport:'mathart-1.7.8-gpu',color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8',settings:{centerX:.125,centerY:-.25,scale:-2,rotation:0}});
 const id=checks.rawImport.request.scene.id;report.native=native;
 check(await page.locator('#control-scale').inputValue()==='-2','raw negative scale not visible in actual control');
 check(await page.locator('#control-rotation').inputValue()==='0','ignored native rotation incorrectly activated');
 check(checks.rawImport.request.scene.timeline.tracks[1]?.actions?.[0]?.args?.speed===0,'empty native domainRotate args did not become target zero');
 checks.rawPrepared=await page.evaluate(async scene=>{
  const {prepareDomainViewport}=await import('/src/engine/domainViewport.ts');return prepareDomainViewport(scene.settings);
 },checks.rawImport.request.scene);
 check(checks.rawPrepared.scale===-2&&checks.rawPrepared.effectiveScale===1e-9,'raw/effective scale facts disagree');
 for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu']){
  before=await mark();await selector().selectOption(version);checks['negativeSwitch_'+version]=await fresh(before,{id,viewport:version,settings:{scale:-2,rotation:0}});
 }
 before=await mark();await page.locator('#control-scale').fill('2.5');
 checks.repairedScale=await fresh(before,{id,viewport:'mathart-1.7.8-gpu',settings:{scale:2.5,rotation:0}});
 before=await mark();await page.locator('#control-domainBackend').selectOption('gpu');
 checks.explicitBackend=await fresh(before,{id,selectedBackend:'gpu',viewport:'mathart-1.7.8-gpu',backend:'webgl2'});
 const sourceNumbers=numericalSettings(checks.explicitBackend.request.scene);
 for(const version of ['local-v1','mathart-1.7.8-cpu','mathart-1.7.8-gpu']){
  before=await mark();await selector().selectOption(version);
  checks['sourceSwitch_'+version]=await fresh(before,{id,viewport:version,settings:sourceNumbers,selectedBackend:'gpu',color:'mathart-1.7.8-gpu',iteration:'mathart-1.7.8'});
 }
 // Source pixel rounding is checked elsewhere. Here independent affine math
 // checks gestures against the actual timeline-evaluated rotation, at time4.
 before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).press('End');
 checks.preGestureSeek=await fresh(before,{id,time:4,viewport:'mathart-1.7.8-gpu'});
 const latest=()=>page.evaluate(id=>window.__audit.completed.findLast(x=>window.__audit.matches(x,{id,time:4})),id);
 const point=async(row,x,y)=>page.evaluate(async({row,x,y})=>{
  const {sceneAtTime}=await import('/src/engine/timeline.ts');const settings=sceneAtTime(row.request.scene,row.request.context.time).settings;
  const angle=Math.fround(settings.rotation),co=Math.cos(angle),si=Math.sin(angle),S=Math.max(1e-9,settings.scale),w=row.output.width,h=row.output.height;
  const re=(2*x/w-1)*(w/h)/S,im=(2*y/h-1)/S;
  return[settings.centerX+re*co-im*si,settings.centerY+re*si+im*co];
 },{row,x,y});
 const canvas=page.locator('[data-testid="art-canvas"]');
 await canvas.evaluate(element=>{window.__gestureAudit=[];for(const type of ['pointerdown','pointerup','wheel'])element.addEventListener(type,event=>window.__gestureAudit.push({type,x:event.clientX,y:event.clientY,deltaY:event.deltaY}),{passive:true});});
 for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu']){
  before=await mark();await selector().selectOption(version);let row=await fresh(before,{id,viewport:version,time:4});
  const box=await canvas.boundingBox();check(box,'canvas has no visible bounds');
  const dims=await canvas.evaluate(e=>({width:e.clientWidth,height:e.clientHeight})),w=row.output.width,h=row.output.height,scale=Math.min(dims.width/w,dims.height/h),offsetX=(dims.width-w*scale)/2,offsetY=(dims.height-h*scale)/2;
  let start={x:w*.45,y:h*.45},end={x:start.x+23/scale,y:start.y+17/scale};
  const panMark=await mark(),eventMark=await page.evaluate(()=>window.__gestureAudit.length);
  await page.mouse.move(box.x+offsetX+start.x*scale,box.y+offsetY+start.y*scale);await page.mouse.down();
  await page.mouse.move(box.x+offsetX+end.x*scale,box.y+offsetY+end.y*scale);await page.mouse.up();
  await page.waitForFunction(({id,version,mark,old})=>window.__audit.completed.some(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&window.__audit.matches(x,{id,viewport:version,time:4})&&(x.request.scene.settings.centerX!==old.centerX||x.request.scene.settings.centerY!==old.centerY)),{id,version,mark:panMark,old:row.request.scene.settings});await ready();
  const events=await page.evaluate(mark=>window.__gestureAudit.slice(mark),eventMark),down=events.find(e=>e.type==='pointerdown'),up=events.findLast(e=>e.type==='pointerup');check(down&&up,'actual pointer events were not delivered');
  start={x:(down.x-box.x-offsetX)/scale,y:(down.y-box.y-offsetY)/scale};end={x:(up.x-box.x-offsetX)/scale,y:(up.y-box.y-offsetY)/scale};
  const moved=await latest(),beforePoint=await point(row,start.x,start.y),afterPoint=await point(moved,end.x,end.y);
  check(Math.hypot(...beforePoint.map((v,i)=>v-afterPoint[i]))<1e-10,'actual pan lost source affine anchor');
  check(moved.request.scene.settings.scale===row.request.scene.settings.scale,'pan rewrote raw scale');
  let at={x:w*.65,y:h*.37};const zoomMark=await mark();
  await page.mouse.move(box.x+offsetX+at.x*scale,box.y+offsetY+at.y*scale);await page.mouse.wheel(0,-90);
  await page.waitForFunction(({id,version,mark,old})=>window.__audit.completed.some(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&window.__audit.matches(x,{id,viewport:version,time:4})&&x.request.scene.settings.scale!==old),{id,version,mark:zoomMark,old:moved.request.scene.settings.scale});await ready();
  const wheel=await page.evaluate(()=>window.__gestureAudit.findLast(e=>e.type==='wheel'));check(wheel,'actual wheel event not delivered');at={x:(wheel.x-box.x-offsetX)/scale,y:(wheel.y-box.y-offsetY)/scale};
  const zoomed=await latest(),zoomBefore=await point(moved,at.x,at.y),zoomAfter=await point(zoomed,at.x,at.y);
  check(Math.hypot(...zoomBefore.map((v,i)=>v-zoomAfter[i]))<1e-10,'actual wheel lost source affine anchor');
  check(zoomed.request.scene.settings.scale>moved.request.scene.settings.scale,'wheel up did not increase source scale');
  checks['gestures_'+version]={pan:{before:row,after:moved,start,end,events,beforePoint,afterPoint},zoom:{before:moved,after:zoomed,at,wheel,deltaY:-90,beforePoint:zoomBefore,afterPoint:zoomAfter}};
 }
 const saved=await latest();checks.preReloadAudit=await page.evaluate(()=>({errors:window.__audit.errors,issued:window.__audit.issued,completed:window.__audit.completionCount}));
 check(!checks.preReloadAudit.errors.length,'unexpected generation error before Save');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
 checks.savedReload=await fresh({issued:0,completed:0},{id,viewport:'mathart-1.7.8-gpu',selectedBackend:'gpu',settings:numericalSettings(saved.request.scene),time:0});
 check(JSON.stringify(checks.savedReload.request.scene.provenance?.original)===JSON.stringify(native),'Save/reload changed native provenance');
 // Observe the production renderer after reload. No draw or request is replaced.
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose;
  const ids=new WeakMap();let next=0;window.__renderAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__renderAudit.outputs.push({id,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,viewport:scene.settings.domainViewportVersion,rotation:scene.settings.rotation,scale:scene.settings.scale,pixelHash:hash>>>0});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).press('End');
 checks.timelineSeek=await fresh(before,{id,viewport:'mathart-1.7.8-gpu',selectedBackend:'gpu',time:4});
 const expectedRotation=Math.fround(.4);
 await page.waitForFunction(({id,hash,angle})=>window.__renderAudit.outputs.some(x=>x.sceneId===id&&x.pixelHash===hash&&Math.abs(x.rotation-angle)<1e-12),{id,hash:checks.timelineSeek.pixelHash,angle:expectedRotation});
 check(checks.timelineSeek.pixelHash!==checks.savedReload.pixelHash,'source rotation time seek did not change actual image');
 // Deterministic transport-delay fixture: the real generated request is held
 // before delivery, then released unchanged. This checks pending UI eligibility,
 // not a performance claim or a simulated mathematical output.
 const pendingNumbers=numericalSettings(checks.timelineSeek.request.scene),pendingMark=await mark();
 await page.evaluate(()=>{window.__audit.holdNext=true;});await page.getByRole('slider',{name:'Time position',exact:true}).press('Home');
 await page.waitForFunction(()=>window.__audit.held===true&&!!document.querySelector('.rendering-badge'));
 const heldMark=await mark(),pendingBox=await canvas.boundingBox();check(pendingBox,'pending canvas unavailable');
 await page.mouse.move(pendingBox.x+pendingBox.width*.6,pendingBox.y+pendingBox.height*.5);await page.mouse.down();await page.mouse.move(pendingBox.x+pendingBox.width*.6+21,pendingBox.y+pendingBox.height*.5+11);await page.mouse.up();await page.mouse.wheel(0,-60);await page.getByTitle('Fit to canvas',{exact:true}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const pendingAfter=await mark(),pendingControls=Object.fromEntries(await Promise.all(['centerX','centerY','scale','rotation'].map(async key=>[key,Number(await page.locator('#control-'+key).inputValue())])));
 check(pendingAfter.issued===heldMark.issued,'pending pan/zoom/Fit issued a changed authored scene');
 for(const key of Object.keys(pendingNumbers))check(pendingControls[key]===pendingNumbers[key],'pending gesture changed '+key);
 await page.evaluate(()=>window.__audit.releaseHeld());
 const pendingCompleted=await fresh(pendingMark,{id,time:0,viewport:'mathart-1.7.8-gpu',settings:pendingNumbers});
 const holdSummary=await page.evaluate(()=>window.__audit.holdSummary);check(holdSummary.release==='manual','pending fixture watchdog released before assertions');
 checks.pendingGesture={scope:'Controlled bounded dispatch delay; real worker message/output, no fabricated output',before:pendingMark,heldMark,after:pendingAfter,controls:pendingControls,holdSummary,completed:pendingCompleted};
 before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).press('End');checks.timelineSeekAfterPending=await fresh(before,{id,time:4,viewport:'mathart-1.7.8-gpu',settings:pendingNumbers});
 await canvas.screenshot({path:'.cache/domain-viewport-ui-preview.png'});
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-viewport-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id});
 check(exported?.output.backend==='webgl2'&&exported.request.context.time===4,'PNG export did not complete selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.viewport==='mathart-1.7.8-gpu'&&Math.abs(exportRenderer.rotation-expectedRotation)<1e-12,'export renderer did not receive evaluated source viewport rotation');
 const png=await readFile('.cache/domain-viewport-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'PNG dimensions/content invalid');
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
 await writeFile('.cache/domain-viewport-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await selector().scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-viewport-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-viewport-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['One device, three native-format fixtures and one legacy document; no original application runtime or pixel equivalence.','Pan/zoom at scene time4 uses independent ideal-affine anchor math with the production timeline-evaluated angle; staged float pixel arithmetic and source-independent direction are separate evidence.','Independent cold replay uses the same production Generator/ArtRenderer and proves export consistency, not independent mathematical correctness.','Source rate uses deterministic local integration rather than original per-frame float accumulation; serial source timing and arbitrary overlaps are not runtime parity claims.','No performance or whole-process/VRAM lifetime claim. Hooks observe actual requests/outputs and renderer disposal, except the explicitly reported bounded pending-dispatch barrier; browser closure owns remaining App resources.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-viewport-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-viewport-ui-failure-${attempt}.json`:'.cache/domain-viewport-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
