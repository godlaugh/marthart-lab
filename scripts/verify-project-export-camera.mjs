import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const paths=['src/App.tsx','src/components/ExportDialog.tsx','src/components/Viewport.tsx','src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/timeline.ts','src/engine/client.ts','scripts/verify-project-export-camera.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const check=(value,message)=>{if(!value)throw Error(message);};
const before=await hashes(),server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
await server.listen();
const origin=server.resolvedUrls.local[0],browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
const report={at:new Date().toISOString(),status:'running',scope:'Actual App JSON import and ExportDialog PNG download, with production renderer camera observation and independent cold worker/renderer replay. Small 64-point CPU Map fixture; original application not executed.'};
let page;
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
try{
 page=await browser.newPage({viewport:{width:1360,height:920},acceptDownloads:true});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__exportAudit={issued:0,completed:0,outputs:[],errors:[]};
  window.Worker=class extends NativeWorker{
   sent=new Map();
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{
    if(data.operation!=='generate'||data.progress)return;
    if(data.error)window.__exportAudit.errors.push(data.error);
    const request=this.sent.get(data.id);if(!request||!data.output)return;
    window.__exportAudit.outputs.push({...request,completionSequence:++window.__exportAudit.completed,output:{type:data.output.type,dimension:data.output.dimension,positionValues:data.output.positions?.length}});
   });}
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{issuedSequence:++window.__exportAudit.issued,request:structuredClone(message)});return super.postMessage(message,...args);}
  };
 });
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
 await page.goto(origin+'fixture');
 const fixture=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('map'));scene.id='export-camera-authored';scene.name='Export authored camera';
  scene.equations={x:'.8*x+.3*cos(y*5)',y:'.8*y+.3*sin(x*4)',z:'.7*z+.2*sin(y*3)'};scene.parameters={};
  Object.assign(scene.settings,{dimension:3,iteratedMode:'single',presentation:'points',count:64,burnIn:0,initialMode:'box',initialXMin:.1,initialXMax:.1,initialYMin:.2,initialYMax:.2,initialZMin:.3,initialZMax:.3,pointSize:6,cameraGamma:.45,cameraFocalLength:55.75});
  scene.camera={position:[2.4,1.7,3.2],target:[.25,.1,.2],zoom:1.25,orthographic:false,autoFit:false};
  const initial=structuredClone(scene);initial.id='export-camera-start';initial.name='Initial scene';
  saveWorkspace(localStorage,{scenes:[initial],active:initial.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});
  return scene;
 });
 await page.goto(origin);await ready();
 await page.locator('input[type=file]').setInputFiles({name:'authored-camera.mathart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await page.getByText('Project loaded',{exact:true}).waitFor();await ready();
 await page.waitForFunction(expected=>{const workspace=JSON.parse(localStorage.getItem('mathart-lab-v1')),scene=workspace.drafts?.[workspace.active];return scene?.id===expected.id&&JSON.stringify(scene.camera)===JSON.stringify(expected.camera);},fixture);
 await page.evaluate(async()=>{
  const{ArtRenderer}=await import('/src/engine/renderer.ts');
  const setOutput=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose,ids=new WeakMap();let counter=0;
  window.__rendererAudit={outputs:[],disposed:[]};
  ArtRenderer.prototype.setOutput=function(...args){
   if(!ids.has(this))ids.set(this,++counter);
   const result=setOutput.apply(this,args),canvas=this.renderer.domElement;
   window.__rendererAudit.outputs.push({renderer:ids.get(this),width:canvas.width,height:canvas.height,documentId:args[1].id,view:structuredClone(args[3]),finalCamera:this.cameraState(),glError:this.renderer.getContext().getError()});
   return result;
  };
  ArtRenderer.prototype.dispose=function(...args){const result=dispose.apply(this,args);window.__rendererAudit.disposed.push(ids.get(this));return result;};
 });
 const mark=await page.evaluate(()=>({issued:window.__exportAudit.issued,completed:window.__exportAudit.completed}));
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');
 await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
 const download=await pending;await download.saveAs('.cache/project-export-camera.png');
 await page.getByText('File ready · Download',{exact:false}).waitFor();
 const actual=await page.evaluate(mark=>({worker:window.__exportAudit.outputs.findLast(item=>item.issuedSequence>mark.issued&&item.completionSequence>mark.completed&&item.request.context.quality==='export'),renderer:window.__rendererAudit.outputs.find(item=>item.width===257&&item.height===193),disposed:window.__rendererAudit.disposed,errors:window.__exportAudit.errors}),mark);
 check(actual.worker&&actual.renderer,'Export lacks fresh paired worker and actual renderer evidence');
 check(actual.worker.request.scene.id===fixture.id&&JSON.stringify(actual.worker.request.scene.camera)===JSON.stringify(fixture.camera),'Export worker received a different camera document');
 check(JSON.stringify(actual.renderer.view.camera)===JSON.stringify(fixture.camera),'Export renderer did not receive authored camera');
 check(actual.renderer.view.roll===fixture.settings.cameraGamma&&actual.renderer.view.focalLength===fixture.settings.cameraFocalLength,'Export renderer optics changed');
 check(actual.renderer.glError===0&&actual.disposed.includes(actual.renderer.renderer),'Export renderer error or missing dispose');
 const oracle=await page.evaluate(async request=>{
  const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const generator=new Generator(),renderers=[];
  const hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(value=>value.toString(16).padStart(2,'0')).join('');
  const cameraMatches=(a,b)=>a.orthographic===b.orthographic&&Math.abs(a.zoom-b.zoom)<1e-10&&a.position.every((value,i)=>Math.abs(value-b.position[i])<1e-10)&&a.target.every((value,i)=>Math.abs(value-b.target[i])<1e-10);
  try{
   const output=await generator.generate(request.scene,request.context),scene=sceneAtTime(request.scene,request.context.time),view=outputCamera(scene,output);
   const render=async optics=>{
    const renderer=new ArtRenderer(document.createElement('canvas'));renderers.push(renderer);renderer.setSize(257,193,1);renderer.setOutput(output,scene,false,optics);
    const blob=await renderer.blob('image/png');
    return{sha256:await hash(blob),bytes:blob.size,camera:renderer.cameraState(),cameraMatches:cameraMatches(renderer.cameraState(),optics.camera)};
   };
   const exact=await render(view),noRoll=await render({...view,roll:0}),defaultFocalLength=await render({...view,focalLength:35}),defaultCamera=await render({...view,camera:{position:[7,5,8],target:[0,0,0],zoom:1,orthographic:false,autoFit:false}});
   return{exact,noRoll,defaultFocalLength,defaultCamera};
  }finally{generator.dispose();for(const renderer of renderers){renderer.dispose();renderer.renderer.forceContextLoss();}}
 },actual.worker.request);
 const png=await readFile('.cache/project-export-camera.png'),sha256=createHash('sha256').update(png).digest('hex');
 check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193,'Downloaded PNG dimensions differ');
 check(sha256===oracle.exact.sha256&&oracle.exact.cameraMatches,'Downloaded PNG differs from independent cold renderer with authored camera');
 check(oracle.noRoll.sha256!==sha256&&oracle.defaultFocalLength.sha256!==sha256&&oracle.defaultCamera.sha256!==sha256,'Camera or optics controls did not affect the exported pixels');
 const close=(a,b)=>a.orthographic===b.orthographic&&Math.abs(a.zoom-b.zoom)<1e-10&&a.position.every((value,i)=>Math.abs(value-b.position[i])<1e-10)&&a.target.every((value,i)=>Math.abs(value-b.target[i])<1e-10);
 check(close(actual.renderer.finalCamera,fixture.camera),'Actual ExportDialog final camera differs from authored view');
 check(!errors.length&&!actual.errors.length,'Unexpected page/worker errors');
 await page.screenshot({path:'.cache/project-export-camera-ui.png'});
 const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'Relevant source changed during export verification');
 Object.assign(report,{status:'passed',fixture:{camera:fixture.camera,roll:fixture.settings.cameraGamma,focalLength:fixture.settings.cameraFocalLength},actual,oracle,png:{path:'.cache/project-export-camera.png',width:257,height:193,bytes:png.length,sha256},checks:{actualFileImport:true,freshWorkerCompletion:true,actualExportDialog:true,finalAuthoredCamera:true,rollAndFocalLength:true,exactColdRendererImage:true,rollFocalAndCameraDifferentialImages:true,productionRendererDisposeObserved:true},sourceSnapshots:after,sourceStable:true,pageErrors:errors});
}catch(error){
 Object.assign(report,{status:'failed',error:String(error),stack:error.stack,sourceSnapshots:before,pageErrors:errors});
 if(page){report.body=await page.locator('body').innerText();report.audit=await page.evaluate(()=>({worker:window.__exportAudit,renderer:window.__rendererAudit}));await page.screenshot({path:'.cache/project-export-camera-failure.png'});}
 process.exitCode=1;
}finally{await browser.close();await server.close();report.cleanup={browserClosed:true,viteClosed:true,oracle:'Own generators/renderers disposed; context loss requested. Driver resource enumeration not performed.'};await writeFile('.cache/project-export-camera.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
