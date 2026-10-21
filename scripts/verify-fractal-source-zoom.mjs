import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(await readFile('tests/fixtures/source-fractal-zoom/source.json','utf8'));
const directory=`.cache/fractal-source-zoom-public-${Date.now()}`;await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',scope:'Headless public App import, timeline target editing, actual Worker/WebGL2 rendering, save/reopen and PNG export. Expected numerical samples from original JVM; original whole-window comparison and native frame queue not covered.',checks:[],pageErrors:[]};
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
let server,browser,page;
function installObservation(){
 const NativeWorker=window.Worker,a=window.__fractalAudit={issued:0,created:0,terminated:0,requests:[],completed:[],errors:[],owners:new WeakMap(),rendered:[],disposed:[],gesture:[]};
 a.matches=(row,e)=>{const r=row.request,s=r.scene.settings;return r.scene.kind==='fractal'&&(e.id===undefined||r.scene.id===e.id)&&(e.name===undefined||r.scene.name===e.name)&&(e.time===undefined||r.context.time===e.time)&&(e.quality===undefined||r.context.quality===e.quality)&&(e.profile===undefined||(s.fractalNumericProfile??'local-v1')===e.profile)&&(e.settings===undefined||Object.entries(e.settings).every(([k,v])=>s[k]===v));};
 const measure=()=>{const e=document.querySelector('[data-testid="art-canvas"]');return e?{clientWidth:e.clientWidth,clientHeight:e.clientHeight,rect:e.getBoundingClientRect().toJSON()}:null;};
 window.Worker=class extends NativeWorker{
  workerId;ended=false;sent=new Map();
  constructor(...args){super(...args);this.workerId=++a.created;this.addEventListener('message',({data})=>{
   if(data.operation!=='generate'||data.progress)return;const sent=this.sent.get(data.id);if(!sent||sent.request.sessionId!==data.sessionId)return;
   this.sent.delete(data.id);if(data.error){a.errors.push({...sent,error:data.error});return;}if(!data.output)return;
   const{pixels,...output}=data.output;let hash=2166136261,nonOpaque=0;const colors=new Set();
   for(let i=0;i<(pixels?.length??0);i++){hash=Math.imul(hash^pixels[i],16777619);if(i%4===0&&colors.size<257)colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);if(i%4===3&&pixels[i]!==255)nonOpaque++;}
   const row={...sent,completedAt:performance.now(),output,pixels:{length:pixels?.length??0,fnv1a:hash>>>0,distinctRgbAtMost257:colors.size,nonOpaque}};a.completed.push(row);a.owners.set(data.output,row);
  });}
  postMessage(message,...args){if(message.operation==='generate'){
   const sent={sequence:++a.issued,workerId:this.workerId,sentAt:performance.now(),request:structuredClone(message),canvas:measure()};this.sent.set(message.id,sent);a.requests.push(sent);
   if(a.holdNext){a.holdNext=false;a.held=true;a.hold={sequence:sent.sequence,release:null};let released=false;const release=why=>{if(released)return;released=true;a.held=false;a.hold.release=why;clearTimeout(timer);if(!this.ended)super.postMessage(message,...args);};const timer=setTimeout(()=>release('watchdog'),15000);a.releaseHeld=()=>release('manual');return;}
  }return super.postMessage(message,...args);}
  terminate(){if(!this.ended){this.ended=true;a.terminated++;}return super.terminate();}
 };
}

const mark=()=>page.evaluate(()=>window.__fractalAudit.issued);
async function fresh(before,time){await page.waitForFunction(({before,time})=>window.__fractalAudit.completed.some(r=>r.sequence>before&&(time===undefined||r.request.context.time===time)),{before,time});await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));return page.evaluate(({before,time})=>window.__fractalAudit.completed.findLast(r=>r.sequence>before&&(time===undefined||r.request.context.time===time)),{before,time});}
async function observeRenderer(){await page.evaluate(async()=>{const {ArtRenderer}=await import('/src/engine/renderer.ts'),original=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=original.call(this,output,scene,...args);window.__fractalAudit.rendered.push({output:{backend:output.backend,fractalRender:output.fractalRender},request:{context:{time:scene.evaluatedTimeline?.time}},pixels:window.__fractalAudit.owners.get(output)?.pixels});return result;};});}
async function scrub(time){if(Number(await page.getByRole('slider',{name:'Time position',exact:true}).inputValue())===time)return page.evaluate(()=>window.__fractalAudit.rendered.at(-1));const n=await page.evaluate(()=>window.__fractalAudit.rendered.length);await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));await page.waitForFunction(n=>window.__fractalAudit.rendered.length>n&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'),n);return page.evaluate(()=>window.__fractalAudit.rendered.at(-1));}
function compare(row,sample){const v=row.output.fractalRender?.view.viewport;check(row.output.backend==='webgl2'&&v,'No completed WebGL2 viewport facts');for(const k of ['zoom','centerX','centerXLow','centerY','centerYLow'])check(Math.abs(v[k]-sample.output[k])<=Math.max(Number.MIN_VALUE,Math.abs(sample.output[k])*Number.EPSILON*8),'Original JVM mismatch '+k+': '+v[k]+' vs '+sample.output[k]);report.checks.push({case:sample.id,viewport:v,request:row.request.context,backend:row.output.backend,pixels:row.pixels});}
try{
 server=await createServer({server:{host:'127.0.0.1',port:5473,strictPort:true,hmr:false},logLevel:'error'});await server.listen();const origin=server.resolvedUrls.local[0];
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});context.setDefaultTimeout(25000);await context.addInitScript(installObservation);page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Zoom verification</title>'}));await page.route('**/api/health',r=>r.fulfill({status:503,body:'Local PNG fallback verification'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('fractal'));Object.assign(s.settings,{iterations:16,formula:'newton'});saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});await page.goto(origin);await fresh(0);await observeRenderer();
 for(const id of ['zoom-in/0.5','zoom-out/0.5','equal/0.5']){
  const sample=fixture.samples.find(s=>s.id===id);check(sample,'Missing original sample '+id);const a=sample.start,b=sample.target;
  const native={config_version:'1.0.0',type:'FRACTAL',name:id,fractal:{formula_id:'newton',iterations:24,center_hi_lo:[a.centerX,a.centerXLow,a.centerY,a.centerYLow],zoom:a.zoom},timeline:[{type:'fractal_zoom',duration:2,easing:sample.easing,center_hi_lo:[b.centerX,b.centerXLow,b.centerY,b.centerYLow],zoom:b.zoom,max_zoom:b.maxZoom}]};
  const n=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'zoom.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(native))});await fresh(n);compare(await scrub(1),sample);
 }
 await page.getByRole('button',{name:'Clip fractal_zoom',exact:true}).click();
 check(await page.getByRole('combobox',{name:'Center motion',exact:true}).inputValue()==='target','Imported target editor missing');
 await page.getByRole('combobox',{name:'Center motion',exact:true}).selectOption('keyframes');check(await page.getByRole('combobox',{name:'Fractal zoom interpolation',exact:true}).isVisible(),'Local keyframe editor absent');
 await page.getByRole('combobox',{name:'Center motion',exact:true}).selectOption('target');check(await page.getByRole('spinbutton',{name:'Target zoom',exact:true}).isVisible(),'Target editor did not restore');report.checks.push({case:'explicit-mode-switch'});
 await page.getByRole('spinbutton',{name:'Target zoom',exact:true}).fill('16');
 await scrub(0);let row=await scrub(1);check(Math.abs(row.output.fractalRender.view.viewport.zoom-8)<1e-12,'Edited target not used');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();await fresh(0);await observeRenderer();await scrub(1.5);row=await scrub(1);check(Math.abs(row.output.fractalRender.view.viewport.zoom-8)<1e-12,'Reopen lost target');report.checks.push({case:'target-edit-save-reopen',viewport:row.output.fractalRender.view.viewport});
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await downloading;const path=directory+'/zoom.png';await download.saveAs(path);const png=await readFile(path);check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193,'Wrong PNG dimensions');report.checks.push({case:'png',path,sha256:createHash('sha256').update(png).digest('hex'),bytes:png.length});
 await page.getByRole('button',{name:'Close export',exact:true}).click();await page.screenshot({path:directory+'/zoom.png-ui.png'});check(!report.pageErrors.length,'Page errors');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;if(page)await page.screenshot({path:directory+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await server?.close();console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:directory+'/report.json',error:report.error}));}
