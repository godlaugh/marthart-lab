// Real public export, bounded on-disk frame evidence and streaming H.264 validation.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {sourceVerificationBackend} from './lib/source-native-verification-server.mjs';
import {verifyHQVideo} from './lib/verify-hq-video-stream.mjs';
import {verifyAttractorReplay} from './lib/verify-attractor-replay.mjs';
const upper=process.argv.includes('--upper'),directory=process.argv.slice(2).find(x=>!x.startsWith('--'));
if(!directory)throw Error('Supply a report directory');
const backend=await sourceVerificationBackend();
const particles=upper?2000:1000,substeps=upper?10:5,lifetime=upper?10:5,width=1920,height=1080,fps=30,frames=300;
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
await mkdir(directory+'/inputs',{recursive:true});
const hashes=async()=>{const paths=(await Promise.all(['src','server'].map(async root=>(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`)))).flat();paths.push('scripts/verify-attractor-high-quality-video.mjs','scripts/lib/verify-hq-video-stream.mjs','scripts/lib/verify-attractor-replay.mjs','desktop/graphics.mjs');return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));};
const report={status:'running',at:new Date().toISOString(),pixelBackend:backend?'native':'webgl',nativeBackend:backend?{executableSha256:backend.executableSha256}:undefined,nativeRequests:0,nativeHttpErrors:[],configuration:{particles,substeps,lifetime,warmup:200,width,height,fps,frames,duration:10},sourceBefore:await hashes(),uploads:[],errors:[],limits:['Public App import and 1080p export with actual FFmpeg. No native original-window parity.','Passive fetch-body PNG capture writes one exact immutable Blob per export frame. Native payloads stay inside the browser; only aggregate fetch counters are retained, with no Playwright response listener or routing. Timings include PNG evidence overhead, not interactive FPS.','Fresh continuous replay checkpoints use the production generator/renderer: local determinism, not independent original mathematics.','Every decoded RGB frame must equal independent raw-RGBA-input FFmpeg encoding under the actual generic MP4 configuration; H.264 is lossy, so an arbitrary RGB-error threshold against PNG is not a correctness gate.','CPU/RSS require an external process-family sampler; GPU memory and whole agent token cost unmeasured.']};
let browser,page,vite,service;const start=performance.now();
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:directory+'/exports',allowedOrigins:[`http://127.0.0.1:${port}`],sourceRendererBackend:backend});const address=await service.listen(0);
 vite=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify(backend?'native':'webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});report.graphics=Object.fromEntries(switches);
 browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>`--${k}=${v}`)});report.browser=browser.version();
 page=await browser.newPage({viewport:{width:1360,height:920},deviceScaleFactor:1,acceptDownloads:true});page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{
  const a=window.__videoAudit={requests:[],completed:[],errors:[],firstExport:null,exportSettings:[],native:{requests:0,requestBytes:0,elapsedMs:0,operations:{},errors:[]}},Native=Worker;
  const originalFetch=window.fetch;
  window.fetch=async function(input,init){
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
   if(url.pathname==='/api/exports'&&init?.method==='POST'&&typeof init.body==='string')a.exportSettings.push(JSON.parse(init.body));
   if(url.pathname!=='/api/source-renderer/frames')return originalFetch.call(this,input,init);
   const started=performance.now(),response=await originalFetch.call(this,input,init),n=a.native;n.requests++;n.elapsedMs+=performance.now()-started;
   const body=init?.body;if(ArrayBuffer.isView(body)){n.requestBytes+=body.byteLength;const view=new DataView(body.buffer,body.byteOffset,body.byteLength);if(body.byteLength>=68&&view.getUint32(4,true)===13){const kind=view.getUint32(64,true);n.operations[kind]=(n.operations[kind]??0)+1;}}
   if(response.status!==200)n.errors.push({status:response.status,url:url.pathname});return response;
  };
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.error)a.errors.push(data.error);if(data.operation==='generate'&&data.output){const o=data.output;a.completed.push({id:data.id,type:o.type,backend:o.backend,particles:o.positions?.length/3,frame:o.sourceCameraFrame,records:o.temporal?.recordedPoints,segments:o.trails?.indices.length/2,stats:o.stats,warnings:o.warnings});}});}
   postMessage(m,...args){if(m.operation==='generate'){a.requests.push({id:m.id,context:structuredClone(m.context),configuration:structuredClone(m.scene.attractorSource),name:m.scene.name});if(m.context.quality==='export'&&!a.firstExport)a.firstExport=structuredClone(m);}return super.postMessage(m,...args);}
  };
 });
 const origin=vite.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');await page.unroute('**/fixture');
 await page.evaluate(async()=>{const {createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready'));
 const source={config_version:'1.0.0',type:'ATTRACTOR',name:`Lorenz HQ ${particles}`,equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},camera:{phi:Math.PI/2,theta:0,gamma:0},palette:['#FC6255','#FFCD62','#58C4DD','#9A72AC'],settings:{render_mode:'CPU',particle_count_cpu:particles,time_step:.005,sub_steps:substeps,scale_x:6,scale_y:6,scale_z:6,offset_z:-150,dot_size:2,line_weight:.3,show_trails:true,fade_trails:true,trail_lifetime:lifetime},initialization:{warmup_steps:200},timeline:[{type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'track',args:[7]},{method:'gradientStart',args:[{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:30}]}]},{type:'wait',duration:9.75}]};
 await writeFile(directory+'/source.json',JSON.stringify(source,null,2));
 await page.locator('input[type=file]').setInputFiles({name:'attractor-hq.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 await page.waitForFunction(name=>{const a=window.__videoAudit,r=a.requests.at(-1);return r?.name===name&&a.completed.some(o=>o.id===r.id)&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},source.name);
 // Observe the actual PNG body without enabling Playwright request routing:
 // routing an unrelated upload also sends every 1MiB native chunk through CDP.
 await page.exposeFunction('__hqCapturePng',async(index,base64)=>{
  check(Number.isSafeInteger(index)&&index===report.uploads.length&&index<frames,'PNG observation order');
  const png=Buffer.from(base64,'base64');check(png.length>0&&png.length<=64*1024*1024,'PNG observation size');
  const path=`${directory}/inputs/${String(index).padStart(4,'0')}.png`;await writeFile(path,png);
  report.uploads.push({index,path,pngSha:sha(png),bytes:png.length,accepted:false,elapsedMs:performance.now()-start});
 });
 await page.exposeFunction('__hqPngAccepted',(index,status)=>{check(report.uploads[index]?.index===index&&status===200,'PNG upload was not accepted');report.uploads[index].accepted=true;if(index%30===0)console.log(JSON.stringify({stage:'upload',index,frames}));});
 await page.evaluate(()=>{
  const originalFetch=window.fetch;
  window.fetch=async function(input,init){
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
   if(!/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))return originalFetch.call(this,input,init);
   if(!(init?.body instanceof Blob))throw Error('Expected actual immutable PNG Blob upload');
   const bytes=new Uint8Array(await init.body.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
   const index=Number(url.searchParams.get('index'));await window.__hqCapturePng(index,btoa(text));
   const response=await originalFetch.call(this,input,init);await window.__hqPngAccepted(index,response.status);return response;
  };
 });
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 for(const [name,value]of [['Export width',width],['Export height',height],['Export frame rate',fps],['Export duration',10]])await page.getByRole('spinbutton',{name,exact:true}).fill(String(value));
 let download,downloadError;page.waitForEvent('download',{timeout:30*60*1000}).then(value=>{download=value;},error=>{downloadError=error;});
 const exportStart=performance.now();await page.getByRole('button',{name:'Start export',exact:true}).click();
 while(!download){
  if(downloadError)throw downloadError;
  const failure=await page.evaluate(()=>window.__videoAudit.errors.at(-1)??document.querySelector('.export-dialog .error-card')?.textContent??document.querySelector('.export-error')?.textContent);
  if(failure)throw Error(String(failure));
  await page.waitForTimeout(1000);
 }
 const videoPath=directory+'/attractor.mp4';await download.saveAs(videoPath);report.exportElapsedMs=performance.now()-exportStart;report.videoPath=videoPath;
 const audit=await page.evaluate(()=>window.__videoAudit);report.exportSettings=audit.exportSettings;check(audit.exportSettings.length===1&&audit.exportSettings[0].format==='mp4'&&!audit.exportSettings[0].profile,'Expected the actual default generic MP4 configuration');report.requests=audit.requests.filter(r=>r.context.quality==='export');
 // A separate worker owns the export; select outputs using the first export id and source offscreen target.
 report.outputs=audit.completed.filter(o=>o.frame?.viewport?.target==='offscreen');
 check(report.requests.length===frames&&report.outputs.length===frames,'Missing export requests or completed frames');
 const cap=Math.trunc(Math.fround(lifetime*60))+120;
 for(let i=0;i<frames;i++){
  const r=report.requests[i],o=report.outputs[i],c=r.configuration.configuration;
  check(c.particleCountCPU===particles&&c.stepsPerFrame===substeps&&c.warmup.steps===200&&r.configuration.visual.trails.lifetime===lifetime,'Authored quality inputs changed');
  check(r.context.width===width&&r.context.height===height&&Math.abs(r.context.time-i/fps)<1e-8,'Export context changed');
  check(o.type==='geometry'&&o.backend==='cpu'&&o.particles===particles&&o.frame.frameIndex===i,'Backend, particles or source frame changed');
  check(o.records===particles*Math.min((i+1)*substeps,cap),'Source per-particle trail retention changed at '+i);
 }
 check(report.uploads.length===frames&&report.uploads.every((u,i)=>u.index===i&&u.accepted),'Upload frame order/count mismatch');
 report.videoValidation=await verifyHQVideo({file:videoPath,uploads:report.uploads,width,height,fps,referenceFile:directory+'/raw-reference.mp4'});
 report.metadata=report.videoValidation.metadata;
 report.checkpoints=await verifyAttractorReplay(page,audit.firstExport,frames);
 check(report.checkpoints.every(r=>r.pngSha===report.uploads[r.index].pngSha),'Fresh continuous replay checkpoint differs from exported PNG');
 const native=await page.evaluate(()=>window.__videoAudit.native);report.nativeRequests=native.requests;report.nativeHttpErrors=native.errors;report.nativeAudit=native;
 report.videoSha=sha(await readFile(videoPath));check(!report.errors.length&&!audit.errors.length,'Browser or Worker errors');check(!report.nativeHttpErrors.length&&(!backend||report.nativeRequests>=frames*4),'Native renderer transactions missing or failed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page){report.failureAudit=await page.evaluate(()=>window.__videoAudit).catch(()=>null);report.nativeAudit=report.failureAudit?.native;report.nativeRequests=report.nativeAudit?.requests??0;report.nativeHttpErrors=report.nativeAudit?.errors??[];await writeFile(directory+'/failure-dom.txt',await page.locator('body').innerText().catch(()=>''));}}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),vite?.close(),service?.close()])).map(r=>r.status);report.remainingServiceProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-start;
 if(!report.sourceStable||report.cleanup.includes('rejected')||report.remainingServiceProcesses!==0){report.status='failed';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,directory,elapsedMs:report.elapsedMs,uploaded:report.uploads.length,error:report.error}));
}
