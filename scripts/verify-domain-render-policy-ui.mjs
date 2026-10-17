import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual controls and downloaded pixels are the assertions. Worker hooks only
// observe request/completion identity; they never fabricate or delay output.
const paths=[
 'src/engine/rasterDimensions.ts','src/engine/domainRenderPolicy.ts','src/engine/domainRenderSession.ts','src/engine/domainGpuFailure.ts','src/engine/domainParameterTimeline.ts','src/engine/domainParameterBinding.ts','src/engine/domainLevelCurve.ts','src/engine/domainSourceScalar.ts','src/i18n.tsx',
 'src/engine/oscillation.ts','src/scenes/domainExamples.generated.ts','src/scenes/domainExamples.recipes.json','src/types.ts','src/App.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/components/EquationEditor.tsx','src/components/PaletteEditor.tsx','src/components/Fields.tsx','src/components/Timeline.tsx',
 'src/engine/document.ts','src/engine/client.ts','src/engine/generationProtocol.ts','src/engine/generationQueue.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/formulaCanvas.ts',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts','src/scenes/complex.ts',
 'src/engine/domainNativeParser.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParameters.ts','src/engine/domainNativeConstants.ts','src/engine/equationEditor.ts',
 'src/engine/complexMath.ts','src/engine/gradientOffsets.ts','src/engine/domainSourceColor.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/planeNavigation.ts','src/engine/domainAuthoring.ts','src/engine/legacyImport.ts','src/components/DomainColorControls.tsx',
 'src/locales/application.en.json','src/locales/components.en.json','src/locales/metadata.en.json','scripts/verify-domain-render-policy-ui.mjs',
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
   const scene=item.request.scene,s=scene.settings,f=item.output.domainRender;
   return (expected.route===undefined||f?.route===expected.route)&&(expected.policy===undefined||(s.domainRenderPolicy??'selected-rules-1723')===expected.policy)&&(expected.sticky===undefined||f?.sticky===expected.sticky)&&scene.kind==='domain'&&item.request.context.quality!=='export'&&(expected.id===undefined||scene.id===expected.id)&&(expected.name===undefined||scene.name===expected.name)&&(expected.formula===undefined||scene.equations.f===expected.formula)&&(expected.selectedBackend===undefined||s.domainBackend===expected.selectedBackend)&&(expected.backend===undefined||item.output.backend===expected.backend)&&(expected.color===undefined||(s.domainColorVersion??'local-v1')===expected.color)&&(expected.iteration===undefined||(s.domainIterationVersion??'local-v1')===expected.iteration)&&(expected.enabled===undefined||s.iterationEnabled===expected.enabled)&&(expected.steps===undefined||s.iterationSteps===expected.steps)&&(expected.maxSteps===undefined||s.iterationMaxSteps===expected.maxSteps)&&(expected.time===undefined||item.request.context.time===expected.time)&&(expected.viewport===undefined||(s.domainViewportVersion??'local-v1')===expected.viewport)&&(expected.settings===undefined||Object.entries(expected.settings).every(([key,value])=>s[key]===value));
  };
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;
   workerId=0;constructor(...args){super(...args);this.workerId=++window.__audit.workersCreated;this.addEventListener('message',({data})=>{
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
     const sent={workerId:this.workerId,request:structuredClone(message),issuedSequence:++window.__audit.issued};this.sent.set(message.id,sent);

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
  ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=setOutput.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);let hash=2166136261;for(const v of output.pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}const completed=window.__audit.completed.findLast(x=>x.request.scene.id===scene.id&&x.pixelHash===(hash>>>0));window.__renderAudit.outputs.push({id,issuedSequence:completed?.issuedSequence,completionSequence:completed?.completionSequence,width:this.renderer.domElement.width,height:this.renderer.domElement.height,outputWidth:output.width,outputHeight:output.height,backend:output.backend,sceneId:scene.id,parameters:structuredClone(scene.parameters),settings:structuredClone(scene.settings),viewport:scene.settings.domainViewportVersion,iteration:scene.settings.domainIterationVersion,pixelHash:hash>>>0,domainRender:structuredClone(output.domainRender)});return result;};
  ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this)??null);return result;};
 });
 const rendered=async row=>{
  await page.waitForFunction(row=>window.__renderAudit.outputs.some(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
  return page.evaluate(row=>window.__renderAudit.outputs.findLast(x=>x.sceneId===row.request.scene.id&&x.pixelHash===row.pixelHash&&x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence),row);
 };
 const seek=async(id,time)=>{const before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));return fresh(before,{id,time});};
 await page.goto(origin);checks.initialLocal=await fresh({issued:0,completed:0},{id:fixture.initial.id,selectedBackend:'cpu',iteration:'local-v1'});await installRendererAudit();


 const native={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Actual CPU-chain recovery',settings:{render_mode:'GPU'},parameters:{a:3,b:4},domainColoring:{formula:'w+z',iteration:{enabled:false,nextFormula:''}},viewport:{centerX:.1,centerY:.2,scale:2.5},timeline:[{type:'wait',duration:2}]};
 const text='// Native GPU source program failure\n'+JSON.stringify(native,null,2);await writeFile('.cache/domain-render-policy-ui-input.json',text);
 let before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:Buffer.from(text)});
 let row=await fresh(before,{name:native.name,time:0,policy:'source-cpu-on-gpu-failure-v1',route:'source-cpu-failure',backend:'cpu'});const id=row.request.scene.id;
 const facts=item=>item.output.domainRender;
 const wholeCpu=item=>{const f=facts(item);check(f.effective.backend==='cpu'&&['formula','color','viewport'].every(k=>f.effective[k]==='mathart-1.7.8-cpu'),'completed output is not full source CPU chain');return f;};
 wholeCpu(row);check(facts(row).trigger.stage==='source-program'&&!facts(row).sticky,'first source-program failure incorrectly tagged');
 check(JSON.stringify(row.request.scene.provenance.original)===JSON.stringify(native),'import source not preserved');
 checks.import={request:row,presentation:await rendered(row),inputSha256:sha(text)};
 await page.getByTestId('domain-render-summary').getByText('After a GPU failure, the whole image uses the source CPU rules. The three saved selections remain unchanged.',{exact:true}).waitFor();
 const choose=async(name,value,expected)=>{const m=await mark();await page.getByRole('combobox',{name,exact:true}).selectOption(value);const out=await fresh(m,{id,...expected});await rendered(out);return out;};
 row=await choose('Viewport coordinate rules','local-v1',{viewport:'local-v1',route:'source-cpu-failure',sticky:true});
 row=await choose('Color rules','local-v1',{color:'local-v1',route:'source-cpu-failure',sticky:true});
 const mainEditor=page.getByRole('textbox',{name:'f(z)',exact:true}),apply=page.getByRole('button',{name:'Apply equations',exact:true});
 before=await mark();await mainEditor.fill('sin(z)+0.25*z');await mainEditor.press('Escape');await apply.click();
 row=await fresh(before,{id,formula:'sin(z)+0.25*z',route:'source-cpu-failure',sticky:true,backend:'cpu'});wholeCpu(row);await rendered(row);
 check(row.workerId===checks.import.request.workerId,'ordinary same-id edits replaced worker and lost failure ownership');
 checks.stickyAfterEdit=row;
 // Actual input events on a fallback image whose authored viewport is local.
 // The independent affine reference uses delivered source CPU view facts.
 before=await mark();await page.locator('#control-rotation').fill('.4');row=await fresh(before,{id,settings:{rotation:.4},route:'source-cpu-failure'});await rendered(row);
 const point=(item,x,y)=>{const v=facts(item).view,w=item.output.width,h=item.output.height,co=Math.cos(v.angle),si=Math.sin(v.angle),re=(2*x/w-1)*(w/h)/v.effectiveScale,im=(2*y/h-1)/v.effectiveScale;return[v.centerX+re*co-im*si,v.centerY+re*si+im*co];};
 const navigationStart=row;const canvas=page.locator('[data-testid="art-canvas"]');await canvas.evaluate(e=>{window.__gestureAudit=[];for(const type of ['pointerdown','pointerup','wheel'])e.addEventListener(type,event=>window.__gestureAudit.push({type,x:event.clientX,y:event.clientY,deltaY:event.deltaY}),{passive:true});});
 const box=await canvas.boundingBox(),dims=await canvas.evaluate(e=>({width:e.clientWidth,height:e.clientHeight}));check(box,'canvas absent');
 const w=row.output.width,h=row.output.height,scale=Math.min(dims.width/w,dims.height/h),ox=(dims.width-w*scale)/2,oy=(dims.height-h*scale)/2;
 const changed=async(m,key,previous)=>{await page.waitForFunction(({m,id,key,previous})=>window.__audit.completed.some(x=>x.issuedSequence>m.issued&&x.completionSequence>m.completed&&window.__audit.matches(x,{id,route:'source-cpu-failure'})&&x.request.scene.settings[key]!==previous),{m,id,key,previous});await ready();return page.evaluate(({m,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>m.issued&&x.completionSequence>m.completed&&window.__audit.matches(x,{id,route:'source-cpu-failure'})),{m,id});};
 before=await mark();await page.mouse.move(box.x+ox+w*.45*scale,box.y+oy+h*.45*scale);await page.mouse.down();await page.mouse.move(box.x+ox+w*.45*scale+23,box.y+oy+h*.45*scale+17);await page.mouse.up();
 const moved=await changed(before,'centerX',row.request.scene.settings.centerX),events=await page.evaluate(()=>window.__gestureAudit),down=events.find(e=>e.type==='pointerdown'),up=events.findLast(e=>e.type==='pointerup');
 check(down&&up,'pan input events missing');const start={x:(down.x-box.x-ox)/scale,y:(down.y-box.y-oy)/scale},end={x:(up.x-box.x-ox)/scale,y:(up.y-box.y-oy)/scale},pa=point(row,start.x,start.y),pb=point(moved,end.x,end.y);
 check(Math.hypot(...pa.map((v,i)=>v-pb[i]))<1e-10,'fallback pan ignored effective source CPU view');
 before=await mark();await page.mouse.move(box.x+ox+w*.65*scale,box.y+oy+h*.37*scale);await page.mouse.wheel(0,-90);
 const zoomed=await changed(before,'scale',moved.request.scene.settings.scale),wheel=await page.evaluate(()=>window.__gestureAudit.findLast(e=>e.type==='wheel')),at={x:(wheel.x-box.x-ox)/scale,y:(wheel.y-box.y-oy)/scale},za=point(moved,at.x,at.y),zb=point(zoomed,at.x,at.y);
 check(Math.hypot(...za.map((v,i)=>v-zb[i]))<1e-10,'fallback zoom ignored effective source CPU anchor');
 before=await mark();await page.getByTitle('Fit to canvas',{exact:true}).click();row=await fresh(before,{id,settings:{scale:2.5,centerX:0,centerY:0},viewport:'local-v1',route:'source-cpu-failure'});wholeCpu(row);
 checks.navigation={pan:{before:navigationStart,source:events,start,end,beforePoint:pa,afterPoint:pb,completed:moved},zoom:{wheel,at,beforePoint:za,afterPoint:zb,completed:zoomed},fit:row};
 const held=row;before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'same-id-valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(row.request.scene))});
 row=await fresh(before,{id,route:'selected',backend:'webgl2',sticky:false,formula:'sin(z)+0.25*z'});await rendered(row);check(row.workerId!==held.workerId,'same-id explicit document load inherited old renderer failure');checks.sameIdDocumentReload={before:held,after:row};
 before=await mark();await mainEditor.fill('w+z');await mainEditor.press('Escape');await apply.click();row=await fresh(before,{id,formula:'w+z',route:'source-cpu-failure',backend:'cpu'});
 before=await mark();await mainEditor.fill('sin(z)+0.25*z');await mainEditor.press('Escape');await apply.click();row=await fresh(before,{id,formula:'sin(z)+0.25*z',route:'source-cpu-failure',sticky:true,backend:'cpu'});
 const failedWorker=row.workerId;before=await mark();await page.getByRole('button',{name:'Retry GPU',exact:true}).click();
 row=await fresh(before,{id,route:'selected',backend:'webgl2',sticky:false,viewport:'local-v1',color:'local-v1'});await rendered(row);
 check(row.workerId!==failedWorker,'retry did not establish a new worker/session');check(!facts(row).trigger,'retry kept stale failure trigger');checks.retry=row;
 row=await choose('Rendering recovery rules','source-cpu-always-v1',{policy:'source-cpu-always-v1',route:'source-cpu-forced',backend:'cpu'});wholeCpu(row);
 check(facts(row).requested.viewport==='local-v1'&&facts(row).requested.color==='local-v1'&&facts(row).requested.formula==='mathart-1.7.8-gpu','forced policy rewrote independent rule choices');
 const savedPalette=JSON.stringify(row.request.scene.palette),fallback=page.locator('details').filter({has:page.locator(':scope > summary',{hasText:'CPU recovery palette'})});await fallback.locator(':scope > summary').click();
 before=await mark();await fallback.getByRole('button',{name:'Restore six default colors',exact:true}).click();row=await fresh(before,{id,route:'source-cpu-forced'});
 check(row.request.scene.domainSourcePalette.colors.length===6&&JSON.stringify(row.request.scene.palette)===savedPalette&&row.request.scene.settings.domainColorVersion==='local-v1','recovery palette editor altered inactive local palette or chosen color version');
 checks.recoveryPalette=row;
 const beforeSave=row,saveMark=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();const saved=await fresh(saveMark,{id,policy:'source-cpu-always-v1',route:'source-cpu-forced'});
 check(content(saved.request.scene)===content(beforeSave.request.scene),'Save altered authored choices');const savedContent=content(saved.request.scene);
 await page.reload();const reloaded=await fresh({issued:0,completed:0},{id,time:0,policy:'source-cpu-always-v1',route:'source-cpu-forced',backend:'cpu'});wholeCpu(reloaded);check(content(reloaded.request.scene)===savedContent,'saved policy/choices did not survive reload');checks.saveReload={saved,reloaded};await installRendererAudit();
 const finalFrame=await seek(id,1);wholeCpu(finalFrame);await rendered(finalFrame);checks.finalFrame=finalFrame;
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const exportMark=await mark(),downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.cache/domain-render-policy-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(({mark,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===id&&x.request.context.quality==='export'&&x.request.context.width===257&&x.request.context.height===193),{mark:exportMark,id});
 check(exported?.output.backend==='cpu'&&exported.request.context.time===1,'PNG export did not complete selected GPU/time request');
 const exportRenderer=await page.evaluate(item=>window.__renderAudit.outputs.findLast(x=>x.width===257&&x.height===193&&x.pixelHash===item.pixelHash&&x.sceneId===item.request.scene.id),exported);
 check(exportRenderer?.domainRender?.route==='source-cpu-forced'&&exportRenderer.domainRender.effective.viewport==='mathart-1.7.8-cpu','export renderer did not receive effective source CPU facts');
 const exportSummary=await page.getByTestId('domain-export-rendering').innerText();check(exportSummary.includes('Completed image: CPU')&&exportSummary.includes('MathArt 1.7.8 CPU')&&exportSummary.includes('CPU pipeline is pinned'),'actual export summary disagrees with completed CPU facts');checks.exportSummary=exportSummary;
 const png=await readFile('.cache/domain-render-policy-ui-export.png');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193&&png.length>1024,'PNG dimensions/content invalid');
 const oracle=await page.evaluate(async({request,actualPng})=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const g=new Generator(),cpuOracle=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
  const hash=pixels=>{let h=2166136261;for(const v of pixels){h^=v;h=Math.imul(h,16777619);}return h>>>0;};
  const decode=async blob=>{const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const context=c.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,c.width,c.height).data;};
  let result;
  try{
   const out=await g.generate(request.scene,request.context);const explicitCpu=structuredClone(request.scene);Object.assign(explicitCpu.settings,{domainRenderPolicy:'selected-rules-1723',domainIterationVersion:'mathart-1.7.8-cpu',domainViewportVersion:'mathart-1.7.8-cpu',domainColorVersion:'mathart-1.7.8-cpu',domainBackend:'cpu'});const cpu=await cpuOracle.generate(explicitCpu,request.context);let cpuChanged=0;for(let i=0;i<out.pixels.length;i++)if(out.pixels[i]!==cpu.pixels[i])cpuChanged++;if(cpuChanged)throw Error('forced pipeline differs from explicit CPU triple');const frame=sceneAtTime(request.scene,request.context.time);
   renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(out,frame,false,outputCamera(frame,out));
   const blob=await renderer.blob('image/png'),expected=await decode(blob),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
   if(expected.length!==actual.length)throw Error('decoded PNG lengths differ');
   let maxDifference=0,changedChannels=0,opaque=0;const colors=new Set();
   for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);maxDifference=Math.max(maxDifference,d);if(d)changedChannels++;if(i%4===3&&actual[i])opaque++;if(i%4===0)colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);}
   const bytes=new Uint8Array(await blob.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
   result={backend:out.backend,domainRender:out.domainRender,explicitCpuChangedChannels:cpuChanged,width:out.width,height:out.height,workerPixelHash:hash(out.pixels),decodedActualHash:hash(actual),decodedExpectedHash:hash(expected),maxDifference,changedChannels,opaquePixels:opaque,distinctRgb:colors.size,viewport:frame.settings.domainViewportVersion,rotation:frame.settings.rotation,oraclePng:btoa(encoded)};
  }finally{g.dispose();cpuOracle.dispose();renderer.dispose();}
  return{...result,generatorDisposed:true,rendererDisposed:true};
 },{request:exported.request,actualPng:png.toString('base64')});
 check(oracle.backend==='cpu'&&oracle.workerPixelHash===exported.pixelHash,'cold Generator differs from actual export worker pixels');
 check(oracle.maxDifference===0&&oracle.changedChannels===0,'downloaded PNG differs from cold production renderer');
 check(oracle.opaquePixels===257*193&&oracle.distinctRgb>100,'downloaded PNG is empty or uniform');
 await writeFile('.cache/domain-render-policy-ui-oracle.png',Buffer.from(oracle.oraclePng,'base64'));delete oracle.oraclePng;
 checks.export={before:exportMark,completed:exported,renderer:exportRenderer};checks.coldProductionOracle=oracle;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await page.getByRole('combobox',{name:'Formula evaluation rules',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.cache/domain-render-policy-ui.png'});
 const audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,renderAudit:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
 check(!errors.length&&!audit.workerErrors.length&&!audit.rendering&&!audit.error,'unexpected page/worker error or unfinished final UI');
 check(audit.renderAudit.disposed.includes(exportRenderer.id),'actual ExportDialog renderer was not disposed');
 const after=await hashes();check(JSON.stringify(sourceBefore)===JSON.stringify(after),'source changed during actual UI verification');
 Object.assign(report,{status:'passed',checks,image:{path:'.cache/domain-render-policy-ui-export.png',width:257,height:193,bytes:png.length,sha256:sha(png)},audit,pageErrors:errors,sourceSnapshots:after,sourceStable:true,limitations:['Actual App failure is the native main-w source-program preflight; device/compile/draw fault injection is independently verified by the GPU owner, not this UI script. Original MathArt was not run.','Navigation uses independently calculated ideal affine anchors from the actual completed source CPU view while the authored viewport remains local. Staged pixel arithmetic is separate evidence.','Forced export is compared against an explicit CPU formula/viewport/color scene and cold production Generator/ArtRenderer. This proves whole-chain routing and export consistency, not original-runtime or cross-device mathematical parity.','No performance or whole-process/VRAM lifetime claim. Hooks only observe actual requests/outputs and renderer disposal; browser closure owns remaining App resources.']});
}catch(e){error=e;report.status='failed';report.error=String(e);report.errorStack=e instanceof Error?e.stack:undefined;report.completedChecksBeforeFailure=checks;if(page&&!page.isClosed()){const screenshot=`.cache/domain-render-policy-ui-failure-${attempt}.png`;await page.screenshot({path:screenshot}).catch(()=>{});report.failure={screenshot,body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>window.__audit).catch(()=>null),errors};}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(result=>result.status==='rejected'?[String(result.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('owned browser/server cleanup failed');report.status='failed';report.error??=String(error);}
 const path=error?`.cache/domain-render-policy-ui-failure-${attempt}.json`:'.cache/domain-render-policy-ui.json';await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({path,status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
