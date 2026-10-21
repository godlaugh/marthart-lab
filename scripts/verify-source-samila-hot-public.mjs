/** Actual App Samila hot preview, edits, retained PNG and cold export; headless only.
 * node scripts/verify-source-samila-hot-public.mjs [report-dir]
 */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createExportServer} from '../server/index.mjs';
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
 let width=0,height=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  check(at+12<=bytes.length,'truncated PNG chunk');const length=bytes.readUInt32BE(at),end=at+length+12;
  check(end<=bytes.length,'truncated PNG payload');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  check(((crc^-1)>>>0)===bytes.readUInt32BE(end-4),'PNG CRC mismatch');
  if(type==='IHDR'){check(length===13&&!width,'invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data.subarray(8).equals(Buffer.from([8,6,0,0,0])),'expected non-interlaced RGBA8 PNG');}
  else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){check(length===0&&end===bytes.length,'invalid PNG end');ended=true;}
  at=end;
 }
 check(width>0&&height>0&&ended&&compressed.length,'incomplete PNG');const stride=width*4,raw=inflateSync(Buffer.concat(compressed));check(raw.length===(stride+1)*height,'invalid PNG row length');const rgba=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG row filter');for(let x=0;x<stride;x++){const a=x>=4?rgba[y*stride+x-4]:0,b=y?rgba[(y-1)*stride+x]:0,c=y&&x>=4?rgba[(y-1)*stride+x-4]:0;rgba[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,rgba};
}
const directory=process.argv[2]??'.cache/source-samila-hot-public';
if(directory==='--help'){console.log('node scripts/verify-source-samila-hot-public.mjs [report-dir]');process.exit(0);}
await mkdir(directory,{recursive:true});
const report={status:'running',nativeParity:false,cases:[],limits:['Real App/Worker/file transport; original fixed-JAR JSON has recorded small-workload overrides.','Runtime random words are local system entropy. Independent cold exports are not compared to retained-preview pixels.','No native application or desktop GUI used; no native image or RNG parity claimed.','Functional elapsed wall time only; CPU time and peak process-family memory unmeasured.']},started=performance.now();
async function hashes(){const entries=await readdir('src',{recursive:true,withFileTypes:true}),paths=entries.filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);paths.push('scripts/verify-source-samila-hot-public.mjs');return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));}
report.sourceBefore=await hashes();let browser,page,server,exportServer;const errors=[];
function audit(){
 const Native=window.Worker,a=window.__hot={requests:[],completed:[],errors:[],pixels:new Map(),owners:new WeakMap(),rendered:[],created:0,terminated:[]};
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.worker=++a.created;this.addEventListener('message',({data})=>{
   if(!['generate','samila-paused-capture'].includes(data.operation))return;const request=a.requests.findLast(r=>r.worker===this.worker&&r.id===data.id&&r.sessionId===data.sessionId);if(!request)return;
   if(data.error){a.errors.push({request,error:data.error,retainedSourceId:data.retainedSourceId});return;}
   const value=data.operation==='generate'?data.output:data.result?.preview;if(!value)return;
   const key=this.worker+':'+data.id,remember=(out,role)=>{const k=key+':'+role;a.owners.set(out,k);if(out.pixels)a.pixels.set(k,out.pixels.slice());const{pixels,...meta}=out;return{key:k,...meta};};
   a.completed.push({request,key,output:remember(value,'preview'),...(data.result?{capture:remember(data.result.capture,'capture')}:{})});while(a.pixels.size>32)a.pixels.delete(a.pixels.keys().next().value);
  });}
  postMessage(m,...args){if(['generate','samila-paused-capture'].includes(m.operation))a.requests.push({...structuredClone(m),worker:this.worker});return super.postMessage(m,...args);}
  terminate(){a.terminated.push(this.worker);return super.terminate();}
 };
}
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const latest=()=>page.evaluate(()=>window.__hot.completed.at(-1));
async function settled(){await page.waitForFunction(()=>{const a=window.__hot,r=a.requests.at(-1);return r&&a.completed.some(c=>c.request.worker===r.worker&&c.request.id===r.id);});await ready();return latest();}
async function waitNoSampling(ms=300){const before=await page.evaluate(()=>({requests:window.__hot.requests.length,key:window.__hot.completed.at(-1)?.key}));await page.waitForTimeout(ms);const after=await page.evaluate(()=>({requests:window.__hot.requests.length,key:window.__hot.completed.at(-1)?.key}));check(isDeepStrictEqual(before,after),'paused/metadata action unexpectedly sampled');return before;}
async function rendererAudit(){await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(out,...args){const r=native.call(this,out,...args);window.__hot.rendered.push(window.__hot.owners.get(out));return r;};});}
async function control(selector,value){const field=page.locator(selector);if(await field.getAttribute('type')==='range')await field.evaluate((e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);else{await field.fill(String(value));await field.blur();}}
async function changed(before){await page.waitForFunction(k=>window.__hot.completed.at(-1)?.key!==k,before.key);return settled();}
function sameOwner(before,after,label){check(before.request.worker===after.request.worker&&before.output.samilaLive.sessionId===after.output.samilaLive?.sessionId,label+' replaced hot owner');check(after.output.samilaLive.displayIndex>before.output.samilaLive.displayIndex,label+' did not draw');}
async function openExport(w,h){await page.getByRole('button',{name:'Export artwork',exact:true}).click();const mode=page.getByRole('combobox',{name:/^(Samila image source|Samila 图像来源)$/});check(await mode.inputValue()==='current','default export is not current paused scene');await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(w));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(h));return mode;}
async function capture(name,before,w,h){
 await openExport(w,h);const requestCount=await page.evaluate(()=>window.__hot.requests.length);
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.getByRole('button',{name:'Start export',exact:true}).click()]);const path=directory+'/'+name+'.png';await download.saveAs(path);
 await page.waitForFunction(n=>window.__hot.completed.some(c=>c.request.operation==='samila-paused-capture'&&window.__hot.requests.indexOf(c.request)>=n),requestCount);
 const row=await page.evaluate(n=>window.__hot.completed.findLast(c=>c.request.operation==='samila-paused-capture'&&window.__hot.requests.indexOf(c.request)>=n),requestCount);
 check(row.request.worker===before.request.worker&&row.output.samilaLive.sessionId===before.output.samilaLive.sessionId,'PNG replaced hot Worker/session');
 check(row.capture.samilaLive.displayIndex===before.output.samilaLive.displayIndex+1&&row.output.samilaLive.displayIndex===before.output.samilaLive.displayIndex+2,'PNG did not produce exactly export+primary displays');
 check(row.capture.samilaLive.target==='offscreen'&&row.output.samilaLive.target==='primary','PNG roles');check(row.output.temporal.time===before.output.temporal.time,'PNG advanced simulation');
 const density=before.request.context.samilaLive.pixelDensity,width=Math.round(w/density)*density,height=Math.round(h/density)*density;
 const same=width===before.output.width&&height===before.output.height;
 check(row.capture.samilaLive.accumulationPasses===(same?before.output.samilaLive.accumulationPasses+1:1)&&row.output.samilaLive.accumulationPasses===(same?before.output.samilaLive.accumulationPasses+2:1),'PNG single-ink target lifecycle');
 check(row.capture.samilaSplat.primaryPixelHeight===before.output.samilaSplat.primaryPixelHeight,'PNG changed radius reference');
 const png=decodePng(await readFile(path)),pixels=Buffer.from(await page.evaluate(key=>Array.from(window.__hot.pixels.get(key)),row.capture.key));check(png.width===width&&png.height===height&&png.rgba.equals(pixels),'PNG differs from full Worker RGBA');const colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(pixels.readUInt32LE(i));check(colors.size>1,'PNG blank');
 await page.waitForFunction(k=>window.__hot.rendered.includes(k),row.output.key);await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await waitNoSampling();
 return{path,row,rgbaSha256:sha(pixels),width,height,fullRgbaEqual:true,previewPublished:true};
}
try{
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 exportServer=await createExportServer({root:directory+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const service=await exportServer.listen(0);server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${service.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const origin=server.resolvedUrls.local[0];
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',member='data/samila/samila1.json',original=execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,member]);report.original={jarSha256:sha(await readFile(jar)),member,memberSha256:sha(original)};check(report.original.jarSha256==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','fixed JAR changed');const raw=JSON.parse(original);report.overrides={batch_size:128,render_mode:'GPU',spot_size:.12,alpha:.8,show_trails:false,background_color:'#134c7f'};Object.assign(raw.settings,report.overrides);raw.timeline=[{type:'wait',duration:2}];raw.name='Hot Samila source';report.timelineOverride=raw.timeline;
 for(const dpr of [1,2,1.5]){
  const row={dpr,status:'running'};report.cases.push(row);console.log(JSON.stringify({stage:'setup',dpr}));
  try{
   page=await browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:dpr,acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(audit);
   await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('surface'));Object.assign(s.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'standard',frameRate:30}});});await page.goto(origin);await settled();await rendererAudit();
   await page.locator('input[type=file]').setInputFiles({name:'samila1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await page.waitForFunction(()=>window.__hot.requests.at(-1)?.scene?.name==='Hot Samila source');let current=await settled();await page.waitForFunction(()=>{const a=window.__hot,o=a.completed.at(-1)?.output,c=document.querySelector('[data-testid=art-canvas]');return o?.samilaLive&&a.rendered.includes(o.key)&&o.width===c?.width&&o.height===c?.height;});current=await settled();row.initial=current;
   check(current.output.backend==='webgl2'&&current.output.samilaLive?.target==='primary'&&current.output.samilaSampling?.replay==='hot-display','App did not select hot Samila');check(current.request.context.samilaLive.pixelDensity===Math.round(dpr),'App live density');
   const canvas=await page.getByTestId('art-canvas').evaluate(e=>({width:e.width,height:e.height}));check(current.output.width===canvas.width&&current.output.height===canvas.height&&current.output.samilaSplat.primaryPixelHeight===canvas.height,'App backing dimensions/reference');row.canvas=canvas;await waitNoSampling();if(dpr===1.5){row.scope='initial preview only, integer density 2';row.status='passed';continue;}
   console.log(JSON.stringify({stage:'hot-edits',dpr}));const beforeParameter=current,a=Number(current.request.scene.parameters.a),editedA=a+.125;await control('#param-a',editedA);current=await changed(beforeParameter);sameOwner(beforeParameter,current,'parameter edit');check(current.output.samilaLive.parameterChanged&&current.output.samilaSampling.sampleCount===128*6,'parameter edit did not trigger one sixfold display');row.parameter=current;
   const beforeRotation=current;await control('#control-rotation',.37);current=await changed(beforeRotation);sameOwner(beforeRotation,current,'rotation edit');check(current.output.samilaLive.cleared&&current.output.samilaLive.accumulationPasses===1,'rotation did not clear one batch');row.rotation=current;
   const beforeTone=current;await control('#control-normalizedBrightness',.62);current=await changed(beforeTone);sameOwner(beforeTone,current,'tone edit');check(!current.output.samilaLive.cleared&&current.output.samilaLive.accumulationPasses===beforeTone.output.samilaLive.accumulationPasses+1,'tone edit cleared retained ink');row.tone=current;
   await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();const metadataBefore=await page.evaluate(()=>window.__hot.requests.length);await page.getByRole('textbox',{name:'Scene name',exact:true}).fill('Hot Samila renamed');await page.getByRole('textbox',{name:'Scene name',exact:true}).blur();
   const parameterBox=page.locator('.parameter-editor > div').filter({has:page.locator('#param-a')});await parameterBox.locator('details summary').click();await parameterBox.locator('details input').nth(0).fill('-9');await parameterBox.locator('details button').click();await waitNoSampling();check(await page.evaluate(()=>window.__hot.requests.length)===metadataBefore,'name/range metadata generated');row.metadataRetained=true;
   const [project]=await Promise.all([page.waitForEvent('download'),page.getByTitle('Export project JSON',{exact:true}).click()]);const projectPath=directory+'/dpr'+dpr+'.json';await project.saveAs(projectPath);const saved=JSON.parse(await readFile(projectPath,'utf8'));check(saved.name==='Hot Samila renamed'&&saved.parameters.a===editedA&&saved.settings.rotation===.37&&saved.settings.normalizedBrightness===.62,'saved edited values/name');check(JSON.parse(saved.settings.parameterRanges).ranges.a.min===-9,'saved parameter range missing');row.saved={path:projectPath,name:saved.name,parameterRanges:saved.settings.parameterRanges,parameters:saved.parameters};await waitNoSampling();
   console.log(JSON.stringify({stage:'current-png',dpr}));current=await latest();row.samePng=await capture('dpr'+dpr+'-same',current,current.output.width,current.output.height);current={...row.samePng.row,request:{...row.samePng.row.request,context:row.initial.request.context}};
   row.differentPng=await capture('dpr'+dpr+'-different',current,193,129);current={...row.differentPng.row,request:{...row.differentPng.row.request,context:row.initial.request.context}};
   await openExport(192,128);await page.getByRole('combobox',{name:/^(Samila image source|Samila 图像来源)$/}).selectOption('replay');row.coldText=await page.locator('.export-modal').innerText();check(/independent random|独立随机/.test(row.coldText),'cold replay independent RNG explanation missing');await page.getByRole('button',{name:'Close export',exact:true}).click();await waitNoSampling();
   console.log(JSON.stringify({stage:'seek-reopen',dpr}));const oldEpoch=current.output.samilaLive.sessionId;await page.getByRole('slider',{name:'Time position',exact:true}).evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'.5');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>window.__hot.requests.at(-1)?.context?.time===.5);const seek=await settled();check(seek.output.samilaLive.sessionId!==oldEpoch&&seek.output.samilaLive.accumulationPasses===1,'seek did not start fresh hot epoch');row.seek=seek;
   await page.locator('input[type=file]').setInputFiles(projectPath);await page.waitForFunction(epoch=>window.__hot.completed.at(-1)?.output.samilaLive?.sessionId!==epoch,seek.output.samilaLive.sessionId);const reopened=await settled();check(reopened.output.samilaLive.sessionId!==seek.output.samilaLive.sessionId,'reopen epoch');check(reopened.request.scene.name===saved.name&&reopened.request.scene.settings.parameterRanges===saved.settings.parameterRanges,'reopen lost metadata');check(reopened.request.scene.parameters.a===editedA,'reopen lost parameter');row.reopened=reopened;await waitNoSampling();
   if(dpr===1){
    console.log(JSON.stringify({stage:'cold-video',dpr}));const uploads=[],listener=request=>{const url=new URL(request.url());if(request.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))uploads.push({index:Number(url.searchParams.get('index')),png:request.postDataBuffer()});};page.on('request',listener);const before=await page.evaluate(()=>({requests:window.__hot.requests.length,hot:window.__hot.completed.filter(c=>c.output.samilaLive).length}));
    try{
     await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('192');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('128');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('3');await page.getByRole('spinbutton',{name:'Export duration',exact:true}).fill('1');
     const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.getByRole('button',{name:'Start export',exact:true}).click()]);const path=directory+'/cold-three-frames.mp4';await download.saveAs(path);const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate','-of','json',path],{encoding:'utf8',timeout:30000})).streams[0];check(metadata.width===192&&metadata.height===128&&Number(metadata.nb_read_frames)===3&&metadata.r_frame_rate==='3/1','video dimensions/frame count');
     const states=await page.evaluate(n=>{const a=window.__hot;return a.requests.slice(n).filter(r=>r.operation==='generate'&&r.context.quality==='export').map(r=>a.completed.find(c=>c.request===r));},before.requests);check(states.length===3&&uploads.length===3,'video frames/Worker count');const frames=[];
     for(let i=0;i<3;i++){const state=states[i];check(!state.output.samilaLive&&state.output.samilaSampling.replay==='live-session-tape','video unexpectedly mutated hot owner');check(state.request.worker!==reopened.request.worker,'video reused preview Worker');check(uploads[i].index===i,'video upload order');const rgba=Buffer.from(await page.evaluate(key=>Array.from(window.__hot.pixels.get(key)),state.output.key));for(let a=3;a<rgba.length;a+=4)rgba[a]=255;const png=decodePng(uploads[i].png);check(png.rgba.equals(rgba),'video upload differs from Worker RGB/opaque alpha policy');frames.push({index:i,worker:state.request.worker,sampling:state.output.samilaSampling,rgbaSha256:sha(rgba),fullRgbaEqual:true});}
     check(await page.evaluate(()=>window.__hot.completed.filter(c=>c.output.samilaLive).length)===before.hot,'cold video sampled retained preview');row.video={path,metadata,frames,hotOwnerUnchanged:true};await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await waitNoSampling();
    }finally{page.off('request',listener);}
   }
   await page.screenshot({path:directory+'/dpr'+dpr+'-ui.png'});row.workerErrors=await page.evaluate(()=>window.__hot.errors);check(!row.workerErrors.length,'Worker errors');row.status='passed';
  }catch(error){row.status='failed';row.error=String(error.stack??error);if(page&&!page.isClosed()){row.body=await page.locator('body').innerText().catch(()=>undefined);row.audit=await page.evaluate(()=>({requests:window.__hot.requests.slice(-4),completed:window.__hot.completed.slice(-4),errors:window.__hot.errors})).catch(()=>undefined);await page.screenshot({path:directory+'/dpr'+dpr+'-failure.png'}).catch(()=>{});}}
  finally{await page?.close();await writeFile(directory+'/progress.json',JSON.stringify(report,null,2));}
 }
 check(!errors.length,'page errors');report.status=report.cases.every(r=>r.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}finally{
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.errors=errors;report.elapsedMs=performance.now()-started;
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()])).map((r,i)=>({resource:['browser','vite','service'][i],status:r.status,...r.status==='rejected'?{error:String(r.reason)}:{}}));if(!report.sourceStable||report.cleanup.some(r=>r.status==='rejected'))report.status='failed';
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));await writeFile(directory+'/report.md',`# Samila hot public workflow\n\n${report.status}; ${(report.elapsedMs/1000).toFixed(2)} s, source stable ${report.sourceStable}.\n\n${report.error??''}\n\n| DPR | Result | Current same-size PNG | Different-size PNG | Failure |\n|---|---|---|---|---|\n${report.cases.map(r=>`| ${r.dpr} | ${r.status} | ${r.samePng?.fullRgbaEqual??false} | ${r.differentPng?.fullRgbaEqual??false} | ${r.error??''} |`).join('\n')}\n\n${report.limits.map(x=>'- '+x).join('\n')}\n`);
 console.log(JSON.stringify({status:report.status,directory,elapsedMs:report.elapsedMs,sourceStable:report.sourceStable,error:report.error,cases:report.cases.map(r=>({dpr:r.dpr,status:r.status,error:r.error}))}));if(report.status!=='passed')process.exitCode=1;
}
