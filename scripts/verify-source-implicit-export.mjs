// Real public workflow against a preview/dev server. Optional fourth argument
// selects retained original evidence; without it this is a local workflow check.
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import assert from 'node:assert/strict';
const directory=process.argv[2]??'.cache/source-implicit-public-export';await mkdir(directory,{recursive:true});
const input=JSON.parse(await readFile(new URL('../tests/fixtures/source-implicit-presentation/native.json',import.meta.url),'utf8')).cases[0].input;
let holdPreview=false,previewHeld=false,releasePreview,previewArrived;const previewGate=new Promise(r=>releasePreview=r),previewArrival=new Promise(r=>previewArrived=r);
const report={at:new Date().toISOString(),input,status:'running',errors:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
let original;
if(process.argv[4]){
 const root=process.argv[4],run=JSON.parse(await readFile(root+'/run.json')),source=await readFile(run.source),probe=await readFile(root+'/NativeSceneProbe.java'),artwork=await readFile(root+'/before-branding.rgba'),boundary=await readFile(root+'/artwork-boundary.txt');
 assert.equal(run.exit,0);assert.equal(run.timedOut,false);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);
 assert.equal(hash(source),run.sourceSha256);assert.equal(hash(probe),run.probeSha256);assert.deepEqual(JSON.parse(source),input);assert.equal(artwork.length,500*600*4);assert.match(boundary.toString(),/mathart\.scene\.Scene\.drawWatermark\(/);
 const jar=await readFile('../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar');assert.equal(hash(jar),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 original=Buffer.alloc(artwork.length);for(let y=0;y<600;y++)artwork.copy(original,y*2000,(599-y)*2000,(600-y)*2000);
 report.original={root,sourceSha256:hash(source),probeSha256:hash(probe),artworkSha256:hash(artwork),boundarySha256:hash(boundary),jarSha256:hash(jar),scope:'Entire pre-branding artwork including formulas, before PNG enhancement; no mask or tolerance, not the branded final PNG.'};
}
const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});
const browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
try{
 const nativeResponses=[];
 await page.route('**/api/source-renderer/frames',async route=>{const response=await route.fetch(),body=await response.body();const samples=route.request().postDataBuffer().readUInt32LE(52);nativeResponses.push({status:response.status(),headers:response.headers(),samples});if(response.ok()&&samples===0)await writeFile(directory+'/native-base-bottom-up.rgba',body);if(holdPreview&&samples>0){holdPreview=false;previewHeld=true;previewArrived();await previewGate;}await route.fulfill({response,body}).catch(()=>{});});
 await page.addInitScript(()=>{const Native=Worker;window.__audit={requests:[],responses:[]};window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=window.__audit.requests.findLast(r=>r.worker===this.key&&r.id===data.id);if(!request||data.operation==='generate-status')return;const o=data.output;window.__audit.responses.push({request,response:{operation:data.operation,error:data.error,camera:o?.sourceCameraFrame,type:o?.type,stats:o?.stats,formula:o?.formulaPresentation,implicitDensity:o?.sourceImplicitPresentation?.referencePixelDensity,imageResult:data.result?{width:data.result.width,height:data.result.height,type:data.result.blob?.type,size:data.result.blob?.size}:undefined}});});}key=crypto.randomUUID();postMessage(data,...args){if(data.operation==='encode-source-paused-png')window.__artwork=Array.from(data.pixels);window.__audit.requests.push({worker:this.key,id:data.id,operation:data.operation,width:data.width,height:data.height,scale:data.scale,kind:data.scene?.kind,sceneId:data.scene?.id,name:data.scene?.name,sourceCamera:data.scene?.sourceCamera,context:data.context});return super.postMessage(data,...args);}};});
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('就绪')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 await page.goto(process.argv[3]??'http://127.0.0.1:5179');await ready();await page.addStyleTag({content:'.viewport{width:406px!important;height:486px!important;min-height:0!important;flex:none!important}'});
 holdPreview=process.env.HOLD_NATIVE_PREVIEW==='1';
 await page.locator('input[type=file]').setInputFiles({name:'implicit_sphere.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
 await page.waitForFunction(()=>window.__audit.responses.some(r=>r.request.kind==='implicit'&&r.request.name==='implicit_sphere'&&r.response.operation==='generate'&&r.response.type==='geometry'));
 await ready();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 report.beforeExport=await page.evaluate(()=>window.__audit);report.canvas=await page.getByTestId('art-canvas').evaluate(e=>({width:e.width,height:e.height,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}));await page.screenshot({path:directory+'/preview.png'});
 await page.getByRole('button',{name:'导出作品',exact:true}).click();await page.getByRole('combobox',{name:'导出分辨率',exact:true}).selectOption('custom');for(const [name,value]of [['导出宽度','500'],['导出高度','600']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
 if(process.env.HOLD_NATIVE_PREVIEW==='1'){let timer;try{await Promise.race([previewArrival,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native preview was not observed')),20000))]);}finally{clearTimeout(timer);}assert.equal(previewHeld,true,'Expected held implicit preview');assert.equal(await page.getByRole('button',{name:'开始导出',exact:true}).isDisabled(),true,'Export must wait for native preview slot');report.exportWaitsForPreview=true;releasePreview();await page.getByRole('button',{name:'开始导出',exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='开始导出'&&!b.disabled));}
 const downloaded=page.waitForEvent('download',{timeout:15000});await page.getByRole('button',{name:'开始导出',exact:true}).click();const download=await downloaded;await download.saveAs(directory+'/export.png');
 const failure=await download.failure();if(failure)throw Error('PNG download failed: '+failure);
 const audit=await page.evaluate(()=>window.__audit),preview=audit.responses.findLast(r=>r.request.kind==='implicit'&&r.request.context?.sourceViewport?.target==='primary'&&r.response.operation==='generate'&&r.response.type==='geometry'),capture=audit.responses.findLast(r=>r.request.kind==='implicit'&&r.request.context?.sourceViewport?.target==='offscreen'&&r.response.operation==='generate'&&r.response.type==='geometry');
 if(!preview||!capture)throw Error('Missing completed matching implicit preview/export Worker responses');
 const density=preview.response.implicitDensity;if(density!==2||preview.request.context.sourcePointPixelDensity!==density||capture.request.context.sourcePointPixelDensity!==density||capture.response.implicitDensity!==density)throw Error('Export did not preserve the delivered preview pixel density');
 for(const delivered of [preview,capture]){
  const formula=delivered.response.formula;
  if(formula?.layout!=='source-surface-centered-v1'||formula.primaryLogicalHeight!==486||formula.labels.length!==1||formula.labels[0].x!==0||formula.labels[0].y!==200||formula.labels[0].scale!==.25||formula.labels[0].latex!=='{x}^{2} + {y}^{2} - {z}^{2} - 1 = 0')throw Error('Source implicit formula frame lost native text, offsets or delivered primary height');
 }
 const enhancement=audit.responses.findLast(r=>r.request.operation==='encode-source-paused-png'&&r.request.width===500&&r.request.height===600&&r.request.scale===1&&r.response.operation==='encode-source-paused-png');
 if(enhancement?.response.imageResult?.width!==500||enhancement.response.imageResult.height!==600||enhancement.response.imageResult.type!=='image/png'||!enhancement.response.imageResult.size)throw Error('Missing completed native static PNG enhancement Worker response');
 const artwork=Buffer.from(await page.evaluate(()=>window.__artwork));await writeFile(directory+'/artwork.rgba',artwork);
 if(original){assert.equal(artwork.length,original.length);let differentPixels=0,maxChannelDelta=0;for(let i=0;i<artwork.length;i+=4){let different=false;for(let k=0;k<4;k++){const delta=Math.abs(artwork[i+k]-original[i+k]);different||=delta!==0;maxChannelDelta=Math.max(maxChannelDelta,delta);}if(different)differentPixels++;}report.artworkComparison={differentPixels,maxChannelDelta};assert.equal(differentPixels,0,'Public export artwork differs from original');}
 report.nativeResponses=nativeResponses;
 if(process.env.VITE_SOURCE_RENDERER==='native'){const exports=nativeResponses.filter(r=>r.samples===0);assert.equal(exports.length,1);assert.equal(exports[0].status,200);assert.equal(exports[0].headers['x-source-format'],'rgba8');assert.ok(nativeResponses.some(r=>r.samples>0),'Expected native implicit preview');}
 const png=await readFile(directory+'/export.png');if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==500||png.readUInt32BE(20)!==600)throw Error('PNG is not the requested 500 × 600 output');
 if(report.errors.length)throw Error('Page errors: '+report.errors.join('; '));
 report.verification={previewDensity:density,exportDensity:capture.response.implicitDensity,enhancement:'completed-source-paused-png-scale1',formula:'delivered-source-centered-primary486',width:500,height:600,sha256:createHash('sha256').update(png).digest('hex'),scope:'Real import, matched Worker completion and PNG download; no original-app pixel-equivalence claim'};report.status='captured';
}catch(error){report.status='failed';process.exitCode=1;report.error=String(error.stack??error);report.body=await page.locator('body').innerText();}
finally{releasePreview();report.audit=await page.evaluate(()=>window.__audit).catch(()=>undefined);await browser.close();await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({directory,status:report.status,error:report.error,errors:report.errors}));}
