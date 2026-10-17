import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Exercise the real App activation owner through file input and library UI.
// Three-dimensional eight-point CPU fixtures avoid planar camera auto-fitting.
const paths=['src/App.tsx','src/engine/document.ts','src/components/ArtworkLibrary.tsx','src/components/ParameterEditor.tsx','src/components/Viewport.tsx','src/components/ExportDialog.tsx','src/engine/presentedFrame.ts','src/engine/renderer.ts','src/engine/client.ts','scripts/verify-project-loading.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const check=(value,message)=>{if(!value)throw Error(message);};
const facts=scene=>({id:scene.id,name:scene.name,equations:scene.equations,parameters:scene.parameters,camera:scene.camera});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const before=await hashes();
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
await server.listen();
const origin=server.resolvedUrls.local[0],browser=await chromium.launch({channel:'chrome',headless:true});
const report={at:new Date().toISOString(),status:'running',scope:'Actual independent App file input, library navigation, immediate copy and reload. Eight-point 3D CPU Map fixtures; fresh paired worker completions. Original application not executed.',cases:[]},errors=[];
let page;
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const mark=()=>page.evaluate(()=>({issued:window.__loadAudit.issued,completed:window.__loadAudit.completionCount}));
const workspace=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('mathart-lab-v1')));
const settled=async(expected,previous)=>{
 await page.waitForFunction(({expected,previous})=>{
  const facts=scene=>({id:scene.id,name:scene.name,equations:scene.equations,parameters:scene.parameters,camera:scene.camera});
  const matches=scene=>JSON.stringify(facts(scene))===JSON.stringify(expected);
  const audit=window.__loadAudit;
  return audit.completed.some(item=>item.issuedSequence>previous.issued&&item.completionSequence>previous.completed&&matches(item.scene));
 },{expected:facts(expected),previous});
 await ready();
 await page.waitForFunction(expected=>{
  const value=JSON.parse(localStorage.getItem('mathart-lab-v1')),scene=value.drafts?.[value.active]??value.scenes.find(item=>item.id===value.active);
  return value.active===expected.id&&JSON.stringify({id:scene.id,name:scene.name,equations:scene.equations,parameters:scene.parameters,camera:scene.camera})===JSON.stringify(expected);
 },facts(expected));
 const completed=await page.evaluate(({expected,previous})=>window.__loadAudit.completed.findLast(item=>item.issuedSequence>previous.issued&&item.completionSequence>previous.completed&&JSON.stringify(item.scene)===JSON.stringify(expected)),{expected:facts(expected),previous});
 const editor={name:await page.getByRole('textbox',{name:'Scene name',exact:true}).inputValue(),x:await page.getByRole('textbox',{name:'xₙ₊₁',exact:true}).inputValue(),gain:Number(await page.locator('#param-gain').inputValue())};
 check(editor.name===expected.name&&editor.x===expected.equations.x&&editor.gain===expected.parameters.gain,'Editor differs from selected document');
 return{previous,completed,editor,stored:facts((await workspace()).drafts[expected.id])};
};
try{
 page=await browser.newPage({viewport:{width:1360,height:920}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker,nativeParse=JSON.parse;
  const facts=scene=>({id:scene.id,name:scene.name,equations:scene.equations,parameters:scene.parameters,camera:scene.camera});
  window.__loadAudit={issued:0,completionCount:0,issuedRequests:[],completed:[],errors:[],captureInputs:false,inputs:[],copies:[],lastParameterEdit:null};
  // Retain actual JSON.parse objects used by file import; only inspect their
  // caller-owned document facts, not parseScene's palette normalization.
  JSON.parse=function(...args){
   const value=nativeParse(...args),audit=window.__loadAudit;
   if(audit.captureInputs&&value?.version===1&&value.id?.startsWith('load-after-'))audit.inputs.push({value,before:JSON.stringify(facts(value))});
   return value;
  };
  window.Worker=class extends NativeWorker{
   sent=new Map();
   constructor(...args){
    super(...args);
    this.addEventListener('message',({data})=>{
     if(data.operation!=='generate'||data.progress)return;
     if(data.error)window.__loadAudit.errors.push(data.error);
     const sent=this.sent.get(data.id);
     if(!data.output||!sent)return;
     const positions=data.output.positions??[];let hash=2166136261;
     for(const value of new Uint8Array(positions.buffer??new ArrayBuffer(0))){hash^=value;hash=Math.imul(hash,16777619);}
     window.__loadAudit.completed.push({...sent,completionSequence:++window.__loadAudit.completionCount,output:{type:data.output.type,backend:data.output.backend,positionHash:hash>>>0,positionValues:positions.length}});
    });
   }
   postMessage(message,...args){
    if(message.operation==='generate'){
     const item={id:message.id,issuedSequence:++window.__loadAudit.issued,scene:structuredClone(facts(message.scene))};
     this.sent.set(message.id,item);window.__loadAudit.issuedRequests.push(item);
    }
    return super.postMessage(message,...args);
   }
  };
  document.addEventListener('input',event=>{if(event.target.id==='param-gain')window.__loadAudit.lastParameterEdit={at:performance.now(),value:event.target.value};},true);
  document.addEventListener('click',event=>{
   const button=event.target.closest?.('.library-actions button');
   if(button?.textContent.trim()!=='Create a copy')return;
   const value=nativeParse(localStorage.getItem('mathart-lab-v1')),scene=value.drafts?.[value.active]??value.scenes.find(item=>item.id===value.active),edit=window.__loadAudit.lastParameterEdit;
   window.__loadAudit.copies.push({id:value.active,persistedGain:scene.parameters.gain,editorGain:Number(document.querySelector('#param-gain').value),elapsedSinceEditMs:edit?performance.now()-edit.at:null});
  },true);
 });
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
 await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const make=(id,name,gain,x,position)=>{
   const scene=createScene(definition('map'));scene.id=id;scene.name=name;scene.equations={x,y:'y',z:'z'};scene.parameters={gain};
   Object.assign(scene.settings,{dimension:3,iteratedMode:'single',presentation:'points',count:8,burnIn:0,initialMode:'box',initialXMin:.1,initialXMax:.1,initialYMin:.2,initialYMax:.2,initialZMin:.3,initialZMax:.3});
   scene.camera={...scene.camera,position,zoom:1,autoFit:false};return scene;
  };
  const a=make('load-after-A','Saved A',.001,'x+gain',[7,5,8]),b=make('load-after-B','Saved B',.002,'x+gain',[6,4,9]),draftB=make(b.id,'Draft B',.003,'x+gain/2',[4,7,11]);
  const incomingA=make(a.id,'File A updated',.125,'x+gain*2',[11,12,13]);incomingA.camera.zoom=2;
  const incomingB=make(b.id,'File B updated',.75,'x-gain*3',[21,22,23]);incomingB.camera.zoom=3;
  saveWorkspace(localStorage,{scenes:[a,b],drafts:{[b.id]:draftB},active:a.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return{a,b,draftB,incomingA,incomingB};
 });
 await page.goto(origin);await ready();
 const importFile=async(name,incoming)=>{
  const previous=await mark();
  await page.evaluate(()=>{window.__loadAudit.captureInputs=true;});
  await page.locator('input[type=file]').setInputFiles({name:name+'.mathart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await page.waitForFunction(()=>document.querySelector('input[type=file]').value==='');
  await page.getByText('Project loaded',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__loadAudit.captureInputs=false;});
  const actual=await settled(incoming,previous);
  report.cases.push({name,status:'passed',expected:facts(incoming),...actual});
 };
 await importFile('same-active-id',fixture.incomingA);
 await importFile('other-existing-draft-id',fixture.incomingB);
 await page.locator('.library-tabs button').filter({hasText:'My artworks'}).click();
 let previous=await mark();
 await page.locator('.artwork-open').filter({hasText:'Saved A'}).click();
 report.cases.push({name:'library-resumes-imported-working-draft',status:'passed',...await settled(fixture.incomingA,previous)});
 const oldWorkspace=await workspace();
 check(equal(facts(oldWorkspace.scenes.find(item=>item.id===fixture.a.id)),facts(fixture.a))&&equal(facts(oldWorkspace.scenes.find(item=>item.id===fixture.b.id)),facts(fixture.b)),'Import or library navigation changed saved reference documents');

 // Open the menu first, then edit and copy without an autosave wait. Capture
 // phase records the stale persisted value at the actual copy click.
 await page.getByRole('button',{name:'Artwork actions: Saved A',exact:true}).click();
 previous=await mark();
 await page.locator('#param-gain').fill('0.875');
 await page.locator('.library-actions').getByRole('button',{name:'Create a copy',exact:true}).click();
 await page.waitForFunction(id=>{const value=JSON.parse(localStorage.getItem('mathart-lab-v1'));return value.active!==id&&value.drafts?.[value.active]?.parameters.gain===.875;},fixture.a.id);
 const copyWorkspace=await workspace(),copy=copyWorkspace.drafts[copyWorkspace.active];
 check(copy.id!==fixture.a.id&&copy.name===fixture.incomingA.name+' copy','Copy identity/name did not derive from current working document');
 const expectedCopy={...fixture.incomingA,id:copy.id,name:copy.name,parameters:{gain:.875}};
 const copied=await settled(expectedCopy,previous),copyClick=await page.evaluate(()=>window.__loadAudit.copies.at(-1));
 check(copyClick?.persistedGain===fixture.incomingA.parameters.gain&&copyClick.editorGain===.875,'Rapid-copy regression did not exercise a stale persisted draft');
 check(copyClick.elapsedSinceEditMs<600,'Rapid copy did not precede the autosave debounce');
 check(equal(facts(copyWorkspace.scenes.find(item=>item.id===fixture.a.id)),facts(fixture.a)),'Copy mutated original saved artwork');
 check(equal(facts(copyWorkspace.scenes.find(item=>item.id===copy.id)),facts(expectedCopy)),'Saved copy differs from current document');
 report.cases.push({name:'immediate-library-copy-uses-live-edit',status:'passed',copyClick,...copied});

 previous=await mark();
 await page.locator('.artwork-open').filter({hasText:'Saved A'}).click();
 const editedA={...fixture.incomingA,parameters:{gain:.875}};
 report.cases.push({name:'library-resumes-latest-outgoing-edit',status:'passed',...await settled(editedA,previous)});
 const retainedInputs=await page.evaluate(()=>{
  const facts=scene=>({id:scene.id,name:scene.name,equations:scene.equations,parameters:scene.parameters,camera:scene.camera});
  return window.__loadAudit.inputs.map(item=>({id:item.value.id,name:item.value.name,unchanged:item.before===JSON.stringify(facts(item.value))}));
 });
 check(retainedInputs.length>=4&&retainedInputs.every(item=>item.unchanged),'File parsing objects were mutated by load or subsequent edits');
 report.inputOwnership={status:'passed',scope:'Actual file header and parseScene object references: id/name/equations/parameters/camera remain unchanged after load, library navigation and copy; saved artwork facts remain unchanged.',retainedInputs};
 check(!(await page.evaluate(()=>window.__loadAudit.errors.length)),'Worker reported an error');
 await page.reload();
 report.cases.push({name:'reload-restores-latest-working-draft',status:'passed',...await settled(editedA,{issued:0,completed:0})});
 const restored=await workspace();
 check(equal(facts(restored.drafts[fixture.b.id]),facts(fixture.incomingB)),'Reload lost other imported draft');
 check(equal(facts(restored.scenes.find(item=>item.id===copy.id)),facts(expectedCopy)),'Reload lost independent saved copy');
 const rendererCamera=await page.evaluate(async document=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts'),{Generator}=await import('/src/engine/client.ts');
  const canvas=window.document.createElement('canvas');window.document.body.append(canvas);
  const renderer=new ArtRenderer(canvas),generator=new Generator(),events=[];
  const matches=(a,b)=>a.orthographic===b.orthographic&&Math.abs(a.zoom-b.zoom)<1e-10&&a.position.every((n,i)=>Math.abs(n-b.position[i])<1e-10)&&a.target.every((n,i)=>Math.abs(n-b.target[i])<1e-10);
  renderer.setSize(160,120,1);renderer.onCamera(camera=>events.push(structuredClone(camera)));
  try{
   const output=await generator.generate(document,{time:0,width:160,height:120,quality:'low'});
   renderer.setOutput(output,document,true,{roll:0,focalLength:35,camera:document.camera});
   const initial={camera:renderer.cameraState(),eventCount:events.length};
   const next={...document,id:'load-after-renderer',camera:{...document.camera,position:[17,18,19],zoom:4,orthographic:true}};
   renderer.setOutput(output,next,true,{roll:0,focalLength:35,camera:next.camera});
   const replacement={camera:renderer.cameraState(),eventCount:events.length};
   renderer.fit();
   const fitted={camera:renderer.cameraState(),eventCount:events.length,event:events.at(-1)};
   return{initial,replacement,fitted,initialMatches:matches(initial.camera,document.camera),replacementMatches:matches(replacement.camera,next.camera),manualFitPublishesFinal:!!fitted.event&&matches(fitted.event,fitted.camera),glError:renderer.renderer.getContext().getError()};
  }finally{generator.dispose();renderer.dispose();renderer.renderer.forceContextLoss();canvas.remove();}
 },fixture.incomingA);
 check(rendererCamera.initialMatches&&rendererCamera.replacementMatches,'Renderer did not consume final authored camera');
 check(rendererCamera.initial.eventCount===0&&rendererCamera.replacement.eventCount===0,'Renderer published an intermediate fitted camera');
 check(rendererCamera.fitted.eventCount>0&&rendererCamera.manualFitPublishesFinal,'Manual fit did not publish its final camera');
 check(rendererCamera.glError===0,'Renderer camera probe reported a WebGL error');
 report.rendererCamera={status:'passed',...rendererCamera,cleanup:'Generator disposed, renderer disposed, owned test context lost and canvas removed.'};
 check(!errors.length,'Unexpected browser errors');
 const after=await hashes();check(equal(before,after),'Relevant production sources changed during verification');
 Object.assign(report,{status:'passed',sourceSnapshots:after,sourceStable:true,pageErrors:errors});
 await page.screenshot({path:'.cache/project-loading-after.png'});
}catch(error){
 Object.assign(report,{status:'failed',error:String(error),stack:error.stack,pageErrors:errors,sourceSnapshots:before});
 if(page){report.body=await page.locator('body').innerText();report.audit=await page.evaluate(()=>window.__loadAudit);await page.screenshot({path:'.cache/project-loading-after-failure.png'});}
 process.exitCode=1;
}finally{
 await browser.close();await server.close();report.cleanup={browserClosed:true,viteClosed:true};
 await writeFile('.cache/project-loading-after.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
