/** Actual editor -> retained Worker -> PNG download; headless only. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodePng} from './png-rgba.mjs';
import {createExportServer} from '../server/index.mjs';
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
const directory=process.argv[2];if(!directory)throw Error('Supply a new report directory');await mkdir(directory);
async function hashes(){const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);files.push('scripts/verify-source-symmetry-capture-ui.mjs','scripts/png-rgba.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(p))])));}
const fixture={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Symmetry live controls',parameters:{gain:.0001},settings:{batch_size:2048,burn_in_steps:16,iterations_per_frame:1,scale_x:200,scale_y:200,scale_z:1,spot_size:1},palette:['#ffffff','#ed6538'],equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(sin(p.x*17.+gain),sin(p.y*23.-gain),0.);m=abs(gain);}'},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'ambient',args:[.1,.2,.3]},{method:'paramStart',args:{parameters:{gain:{min:0,max:.001,step:1e-7,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:.12}]};
const report={status:'running',nativeParity:false,cases:[],sourceBefore:await hashes()},started=performance.now();let browser,page,server,exportServer;const errors=[];
function audit(){
 const Native=window.Worker,a=window.__hot={requests:[],completed:[],controls:[],controlResponses:[],errors:[],pixels:new Map(),owners:new WeakMap(),rendered:[],created:0,terminated:[]};
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.worker=++a.created;this.addEventListener('message',({data})=>{
   if(data.operation==='symmetry-playback'){a.controlResponses.push({...structuredClone(data),worker:this.worker,at:performance.now()});return;}
   if(!['generate','symmetry-paused-capture'].includes(data.operation))return;const request=a.requests.findLast(r=>r.worker===this.worker&&r.id===data.id&&r.sessionId===data.sessionId);if(!request)return;
   if(data.error){a.errors.push({request,error:data.error,retainedSourceId:data.retainedSourceId});return;}
   const value=data.operation==='generate'?data.output:data.result?.preview;if(!value)return;
   const key=this.worker+':'+data.id,remember=(out,role)=>{const k=key+':'+role;a.owners.set(out,k);if(out.pixels)a.pixels.set(k,out.pixels.slice());const{pixels,...meta}=out;return{key:k,...meta};};
   a.completed.push({request,key,at:performance.now(),output:remember(value,'preview'),...(data.result?{capture:remember(data.result.capture,'capture')}:{})});while(a.pixels.size>32)a.pixels.delete(a.pixels.keys().next().value);
  });}
  postMessage(m,...args){if(m.operation==='symmetry-playback')a.controls.push({...structuredClone(m),worker:this.worker,at:performance.now()});if(['generate','symmetry-paused-capture'].includes(m.operation))a.requests.push({...structuredClone(m),worker:this.worker});return super.postMessage(m,...args);}
  terminate(){a.terminated.push(this.worker);return super.terminate();}
 };
}
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const latest=()=>page.evaluate(()=>window.__hot.completed.at(-1));
async function settled(){await page.waitForFunction(()=>{const a=window.__hot,r=a.requests.at(-1);return r&&a.completed.some(c=>c.request.worker===r.worker&&c.request.id===r.id);});await ready();return latest();}
async function noDraw(){const n=await page.evaluate(()=>window.__hot.requests.length);await page.waitForTimeout(200);check(await page.evaluate(()=>window.__hot.requests.length)===n,'Unexpected draw while paused');}
async function pause(){const n=await page.evaluate(()=>window.__hot.controlResponses.length);await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(n=>window.__hot.controlResponses.length>n&&window.__hot.controlResponses.at(-1)?.paused===true,n);return settled();}
async function openExport(w,h){await page.getByRole('button',{name:'Export artwork',exact:true}).click();const mode=page.getByRole('combobox',{name:'Symmetry image source',exact:true});check(await mode.inputValue()==='current','Wrong default image mode');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(w));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(h));return mode;}
async function capture(name,before,w,h,scale=1){
 await openExport(w,h);await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption(String(scale));
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.getByRole('button',{name:'Start export',exact:true}).click()]);const path=directory+'/'+name+'.png';await download.saveAs(path);
 const row=await latest();check(row.request.operation==='symmetry-paused-capture','PNG used fixed regeneration');
 check(row.request.worker===before.request.worker&&row.output.symmetryLive.sessionId===before.output.symmetryLive.sessionId,'Capture replaced Worker/session');
 const cap=row.capture.symmetryLive,preview=row.output.symmetryLive,old=before.output.symmetryLive;
 check(cap.display.displayIndex===old.display.displayIndex+1&&preview.display.displayIndex===old.display.displayIndex+2,'Capture did not render exactly twice');
 check(cap.objectUpdates===0&&preview.objectUpdates===0&&preview.sceneTime===old.sceneTime,'Capture advanced simulation');
 const density=before.request.context?.sourcePointPixelDensity??before.output.width/before.output.sourceCameraFrame.viewport.logicalWidth,width=Math.round(w/density)*density,height=Math.round(h/density)*density,same=width===before.output.width&&height===before.output.height;
 check(cap.display.accumulationPasses===(same?old.display.accumulationPasses+1:1)&&preview.display.accumulationPasses===(same?old.display.accumulationPasses+2:1),'Capture ink lifecycle');
 check(row.capture.sourceCameraFrame.viewport.target==='offscreen'&&row.output.sourceCameraFrame.viewport.target==='primary','Wrong viewport roles');
 check(JSON.stringify(row.capture.sourceSymmetryPresentation.reference)===JSON.stringify({width:before.output.width,height:before.output.height}),'Primary tone reference changed');
 const png=decodePng(await readFile(path)),pixels=Buffer.from(await page.evaluate(key=>Array.from(window.__hot.pixels.get(key)),row.capture.key));check(png.width===width*scale&&png.height===height*scale&&png.rgba.equals(pixels),'Downloaded PNG differs from full Worker RGBA');
 const colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(pixels.readUInt32LE(i));check(colors.size>1,'Blank PNG');
 await page.waitForFunction(key=>window.__hot.rendered.includes(key),row.output.key);await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await noDraw();
 return{row,path,rgbaSha256:sha(pixels),width:png.width,height:png.height,fullRgbaEqual:true,previewPublished:true};
}
try{
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 exportServer=await createExportServer({root:directory+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const service=await exportServer.listen(0);server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${service.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const origin=server.resolvedUrls.local[0];
 for(const dpr of [1,2]){
  const row={dpr};report.cases.push(row);console.log(JSON.stringify({stage:'setup',dpr}));
  page=await browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:dpr,acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(audit);
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('surface'));Object.assign(s.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'standard',frameRate:30}});});await page.goto(origin);await settled();
  await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(out,...args){const r=native.call(this,out,...args);window.__hot.rendered.push(window.__hot.owners.get(out));return r;};});
  await page.locator('input[type=file]').setInputFiles({name:'capture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(()=>window.__hot.completed.at(-1)?.output.symmetryLive);let current=await settled();
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__hot.completed.filter(x=>x.output.symmetryLive?.paused===false).length>=4);current=await pause();await noDraw();
  row.initial=current;row.same=await capture('same-'+dpr,current,current.output.width,current.output.height);current=row.same.row;
  row.resized=await capture('resized-'+dpr,current,65,45,3);current=row.resized.row;
  row.scale5=await capture('scale5-'+dpr,current,33,25,5);current=row.scale5.row;
  // The alternative remains a separate fixed-time generator and cannot select
  // or consume the retained live Worker capability.
  const mode=await openExport(64,48);await mode.selectOption('replay');const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.getByRole('button',{name:'Start export',exact:true}).click()]);await download.saveAs(directory+'/fixed-'+dpr+'.png');const fixed=await latest();check(fixed.request.operation==='generate'&&!fixed.request.context.symmetryLive&&fixed.request.worker!==current.request.worker,'Fixed export consumed live owner');row.fixed=fixed;
  await page.getByRole('button',{name:'Close export',exact:true}).click();await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(worker=>window.__hot.completed.at(-1)?.request.worker===worker&&window.__hot.completed.at(-1)?.output.symmetryLive?.paused===false,current.request.worker);row.resumed=await pause();check(row.resumed.output.symmetryLive.sessionId===current.output.symmetryLive.sessionId,'Post-capture resume replaced owner');
  await page.screenshot({path:directory+'/preview-'+dpr+'.png',fullPage:true});row.trace=await page.evaluate(()=>({errors:window.__hot.errors,controls:window.__hot.controls,acks:window.__hot.controlResponses}));check(row.trace.errors.length===0,'Worker error');row.status='passed';await page.close();page=undefined;
 }
 check(errors.length===0,'Browser errors');report.sourceAfter=await hashes();check(JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter),'Sources changed during acceptance');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);report.browserErrors=errors;if(page){report.failure=await page.evaluate(()=>({body:document.body.innerText.slice(-7000),last:window.__hot?.completed.slice(-2),errors:window.__hot?.errors}));await page.screenshot({path:directory+'/failure.png',fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs}));}
