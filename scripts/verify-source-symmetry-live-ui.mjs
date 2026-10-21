/** Real App controls, native browser Worker and WebGL; no original Mac window. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const dpr=Number(process.argv[3]??1);if(![1,1.5,2].includes(dpr))throw Error('DPR must be 1, 1.5 or 2');
const directory=process.argv[2];if(!directory)throw Error('Supply a new report directory');await mkdir(directory);
const sha=v=>createHash('sha256').update(v).digest('hex'),check=(value,message)=>{if(!value)throw Error(message);};
async function hashes(){const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);files.push('scripts/verify-source-symmetry-live-ui.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(p))])));}
const fixture={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Symmetry live controls',parameters:{gain:.0001},settings:{batch_size:64,burn_in_steps:4,iterations_per_frame:1,scale_x:1,scale_y:1,scale_z:1,spot_size:1},palette:['#ffffff','#ed6538'],equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(sin(p.x+gain),sin(p.y-gain),0.);m=abs(gain);}'},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'ambient',args:[.1,.2,.3]},{method:'paramStart',args:{parameters:{gain:{min:0,max:.001,step:1e-7,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:.12}]};
const report={status:'running',nativeWindowExecuted:false,dpr,fixture,sourceBefore:await hashes(),checks:[]},started=performance.now();let browser,server,page;const errors=[];
const record=value=>{report.checks.push(value);console.log(JSON.stringify({check:value.name}));};
function audit(){
 const Native=window.Worker,a=window.__live={requests:[],completed:[],controls:[],acks:[],errors:[],rendered:[],owners:new WeakMap(),created:0,terminated:[]};
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.auditId=++a.created;this.addEventListener('message',({data})=>{
   if(data.operation==='symmetry-playback'){a.acks.push({...data,worker:this.auditId});return;}
   if(data.operation!=='generate'||data.progress)return;
   const request=a.requests.findLast(r=>r.worker===this.auditId&&r.id===data.id);if(data.error){a.errors.push({request,error:data.error});return;}
   if(!data.output)return;const{pixels,...output}=data.output,key=this.auditId+':'+data.id;a.owners.set(data.output,key);
   let pixelHash=2166136261;for(const b of pixels??[]){pixelHash^=b;pixelHash=Math.imul(pixelHash,16777619);}
   a.completed.push({key,request,output,pixelHash:pixelHash>>>0});
  });
  this.addEventListener('message',event=>{
   const gate=a.gate,data=event.data;if(!gate||gate.held||data.operation!=='generate'||!data.output?.symmetryLive)return;
   event.stopImmediatePropagation();const deliver=this.onmessage;gate.held=true;gate.worker=this.auditId;
   gate.release=()=>{if(gate.released)return;gate.released=true;clearTimeout(gate.timer);deliver?.call(this,event);};
   gate.timer=setTimeout(()=>{gate.timedOut=true;gate.release();},15000);
  });}

  postMessage(message,...args){const entry={...structuredClone(message),worker:this.auditId};if(message.operation==='generate')a.requests.push(entry);if(message.operation==='symmetry-playback')a.controls.push(entry);return super.postMessage(message,...args);}
  terminate(){a.terminated.push(this.auditId);return super.terminate();}
 };
}
const last=()=>page.evaluate(()=>window.__live.completed.findLast(r=>r.output.symmetryLive));
async function ready(){await page.waitForFunction(()=>{
 const a=window.__live,r=a.requests.at(-1),c=a.completed.at(-1);
 return r&&c?.request?.id===r.id&&c.request.worker===r.worker&&!c.output.symmetryLive?.display.replayActive&&document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');
});return last();}
async function changed(before){await page.waitForFunction(key=>window.__live.completed.findLast(r=>r.output.symmetryLive)?.key!==key,before.key);return ready();}
async function idle(){const before=await page.evaluate(()=>window.__live.requests.length);await page.waitForTimeout(220);check(await page.evaluate(()=>window.__live.requests.length)===before,'Paused idle unexpectedly requested another display');}
async function pause(){const n=await page.evaluate(()=>window.__live.controls.length);await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(n=>{const a=window.__live,c=a.controls[n];return c&&a.acks.some(x=>x.worker===c.worker&&x.id===c.id&&x.sourceId===c.sourceId&&x.paused===true&&!x.error);},n);await ready();await idle();return last();}
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:dpr});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(audit);
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('map'));s.settings.count=8;s.settings.burnIn=0;saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);await ready();await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,...args){const value=native.call(this,output,...args);window.__live.rendered.push({key:window.__live.owners.get(output),camera:args[0]?.evaluatedSourceCamera});return value;};});
 await page.locator('input[type=file]').setInputFiles({name:'symmetry-live.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.getByLabel('Custom GLSL source',{exact:true}).waitFor();let initial=await ready();
 check(initial.output.symmetryLive.paused&&initial.request.context.symmetryLive.startAt===0,'Initial preview must explicitly reconstruct once while paused');check(initial.output.stats.samples>0&&initial.output.backend==='webgl2','Initial preview missing mathematical warmup');await idle();
 check(await page.getByRole('combobox',{name:'Playback mode',exact:true}).count()===0,'Realtime UI advertises local loop semantics');record({name:'initial measured preview',frame:initial});
 const requests=await page.evaluate(()=>window.__live.requests.length);await page.getByRole('textbox',{name:'Scene name',exact:true}).fill('Renamed live symmetry');await page.getByRole('textbox',{name:'Scene name',exact:true}).blur();await page.waitForFunction(()=>document.querySelector('.viewport-caption h1')?.textContent==='Renamed live symmetry');await idle();check(await page.evaluate(()=>window.__live.requests.length)===requests,'Rename drew a frame');record({name:'metadata preserves completed frame'});
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__live.completed.filter(r=>r.output.symmetryLive?.paused===false).length>=4);const paused=await pause();check(paused.output.symmetryLive.sceneTime>initial.output.symmetryLive.sceneTime,'Playback time did not advance');check(paused.output.symmetryLive.queueComplete&&paused.output.symmetryLive.objectUpdates===1,'Completed queue did not continue mathematical updates');
 const count=await page.evaluate(()=>window.__live.completed.length);await page.waitForTimeout(350);await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(n=>window.__live.completed.length>n,count);const resumed=await last();check(resumed.output.symmetryLive.rawDt<.25,'Resume included pause duration');await pause();record({name:'play pause resume after queue completion',paused,resumed});
 const beforeCamera=await last(),savedAngles=beforeCamera.output.sourceCameraFrame.camera;
 await page.getByRole('textbox',{name:'Phi · radians',exact:true}).fill('0.45');await page.getByRole('button',{name:'Apply initial camera',exact:true}).click();const editedCamera=await changed(beforeCamera);
 check(editedCamera.output.sourceCameraFrame.camera.phi===Math.fround(.45),'Paused camera edit not displayed');
 const cameraCount=await page.evaluate(()=>window.__live.completed.length);await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(n=>window.__live.completed.length>n,cameraCount);await pause();
 const firstCamera=await page.evaluate(n=>window.__live.completed[n],cameraCount),F=Math.fround,dt=firstCamera.output.symmetryLive.rawDt;
 for(const [axis,rate]of[['phi',.1],['theta',.2],['gamma',.3]])check(firstCamera.output.sourceCameraFrame.camera[axis]===F(savedAngles[axis]+F(F(rate)*dt)),'Resume did not restore saved '+axis);
 record({name:'paused camera edit and resume restoration',editedCamera,firstCamera});
 const beforeTransform=await last();await page.locator('#control-scaleX').fill('1.2');await page.locator('#control-scaleX').blur();const transformed=await changed(beforeTransform);check(transformed.output.symmetryLive.sessionId===beforeTransform.output.symmetryLive.sessionId,'Transform replaced live owner');check(transformed.output.symmetryLive.replayRevision===1&&transformed.output.symmetryLive.display.replayed&&!transformed.output.symmetryLive.display.replayActive,'Paused transform replay did not finish');check(transformed.output.symmetryLive.sceneTime===beforeTransform.output.symmetryLive.sceneTime&&transformed.output.symmetryLive.objectUpdates===0,'Paused replay advanced ordinary time/math');await idle();
 await page.locator('#control-scaleX').fill('1.200');await page.locator('#control-scaleX').blur();const equalValue=await changed(transformed);check(equalValue.output.symmetryLive.replayRevision===2,'Equal numeric edit did not request replay');check(equalValue.pixelHash===transformed.pixelHash,'Equal paused replay differs');record({name:'paused transform and equal value replay',beforeTransform,transformed,equalValue});
 await page.getByRole('button',{name:'Undo',exact:true}).click();await idle();const undone=await last();check(undone.key===equalValue.key,'Equal-value undo redrew the scene');
 // Undoing an equal-value write is a metadata-equivalent scene restoration;
 // the generic edit still requests a display, but need not invent a new replay.
 await page.getByRole('button',{name:'Undo',exact:true}).click();const restored=await changed(undone);check(restored.output.symmetryLive.replayRevision===3&&restored.request.scene.settings.scaleX===1,'Undo transform did not replay restored value');record({name:'undo restores transform through replay',restored});
 await page.getByRole('button',{name:'Appearance',exact:true}).click();const beforePalette=await last();await page.getByRole('button',{name:'Reverse',exact:true}).click();const palette=await changed(beforePalette);check(palette.output.symmetryLive.replayRevision===4&&palette.output.symmetryLive.display.replayed,'Palette editor omitted replay event');await idle();record({name:'palette replay',palette});
 await page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();const beforeParameter=await last();await page.locator('#param-gain').fill('0.0002');await page.locator('#param-gain').blur();const parameter=await changed(beforeParameter);check(parameter.output.symmetryLive.sessionId!==beforeParameter.output.symmetryLive.sessionId&&parameter.output.temporal.frames===1,'Parameter edit failed to reconstruct');record({name:'parameter edit reconstructs',parameter});
 await page.getByRole('spinbutton',{name:'Scene time',exact:true}).fill('0.2');await page.getByRole('spinbutton',{name:'Scene time',exact:true}).blur();const sought=await changed(parameter);check(sought.request.context.symmetryLive.startAt===.2&&sought.output.symmetryLive.sessionId!==parameter.output.symmetryLive.sessionId,'Seek did not create explicit reconstruction');await idle();record({name:'explicit local seek',sought});
 const prior=sought.output.symmetryLive.sceneTime;await page.setViewportSize({width:1480,height:1040});const resized=await changed(sought);check(resized.output.symmetryLive.sessionId===sought.output.symmetryLive.sessionId&&resized.output.symmetryLive.display.resized&&resized.output.symmetryLive.sceneTime===prior,'Viewport resize recreated or advanced live state');record({name:'paused viewport resize',resized});
 const renderedBefore=await page.evaluate(()=>window.__live.rendered.at(-1)?.key);await page.evaluate(()=>{window.__live.gate={held:false,released:false};});
 await page.locator('#control-scaleX').fill('1.4');await page.locator('#control-scaleX').blur();await page.waitForFunction(()=>window.__live.gate.held);await page.getByRole('button',{name:'Cancel calculation',exact:true}).click();
 check(await page.evaluate(()=>window.__live.rendered.at(-1)?.key)===renderedBefore,'Cancelled replay replaced presented image');
 await page.evaluate(()=>window.__live.gate.release());await page.waitForTimeout(80);check(await page.evaluate(()=>window.__live.rendered.at(-1)?.key)===renderedBefore,'Late cancelled response replaced presented image');
 await page.getByRole('button',{name:'Calculate again',exact:true}).click();const recovered=await ready();check(recovered.output.symmetryLive.sessionId!==resized.output.symmetryLive.sessionId,'Cancellation retry reused failed lifetime');await idle();record({name:'cancel retained response and reconstruct on retry',recovered});
 await page.getByRole('button',{name:'Restart accumulation from the current time',exact:true}).click();
 await page.waitForFunction(()=>{const r=window.__live.completed.at(-1);return r?.request.scene.kind==='symmetry'&&r.request.scene.settings.iteratedStartTime>0&&!r.request.context.symmetryLive&&!r.output.symmetryLive;});await ready();
 const localStart=await page.evaluate(()=>window.__live.completed.at(-1));check(localStart.output.temporal.frames===1,'Local accumulation start ignored');
 await page.locator('#control-iteratedStartTime').fill('0');await page.locator('#control-iteratedStartTime').blur();await page.waitForFunction(key=>{const r=window.__live.completed.at(-1);return r?.key!==key&&r.output.symmetryLive?.paused;},localStart.key);const returned=await ready();check(returned.output.temporal.frames===1,'Returning from fixed mode reused an old live clock');
 await page.locator('#control-recordTrails').uncheck();await page.waitForFunction(()=>{const r=window.__live.completed.at(-1);return r?.request.scene.settings.recordTrails===false&&!r.request.context.symmetryLive;});await ready();const stopped=await page.evaluate(()=>window.__live.completed.at(-1));check(stopped.output.density.occupiedPixels===0,'Disabled local recording was ignored');
 await page.locator('#control-recordTrails').check();await page.waitForFunction(key=>{const r=window.__live.completed.at(-1);return r?.key!==key&&r.output.symmetryLive?.paused;},stopped.key);await ready();record({name:'local delayed accumulation and disabled recording keep fixed semantics',localStart,returned,stopped});
 if(process.argv.includes('--preset')){
  const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',member='data/SymmetryChaos/Emperors_Cloak.json';
  check(sha(await readFile(jar))==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','Original JAR changed');
  const bytes=execFileSync('python3',['-c','import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,member]),raw=JSON.parse(bytes);raw.settings.batch_size=32768;
  await page.locator('input[type=file]').setInputFiles({name:'Emperors_Cloak.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await page.waitForFunction(()=>window.__live.completed.at(-1)?.request.scene.name==='Emperors_Cloak');await ready();
  const n=await page.evaluate(()=>window.__live.completed.length);await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(n=>window.__live.completed.length>=n+8,n);const preset=await pause();check(preset.output.density.occupiedPixels>1000,'Representative preset did not produce a visible image');
  record({name:'original preset with reduced particle count',member,memberSha256:sha(bytes),overrides:{batch_size:32768},preset});await page.screenshot({path:directory+'/symmetry-source-preset.png',fullPage:true});
 }
 await page.screenshot({path:directory+'/symmetry-live-ui.png',fullPage:true});report.trace=await page.evaluate(()=>({controls:window.__live.controls,acks:window.__live.acks,errors:window.__live.errors,rendered:window.__live.rendered,created:window.__live.created,terminated:window.__live.terminated}));check(errors.length===0&&report.trace.errors.length===0,'Browser/Worker errors');check(report.trace.rendered.some(r=>r.key===resized.key&&r.camera?.time===prior),'Viewport did not consume delivered camera/time');report.sourceAfter=await hashes();check(JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter),'Source changed during UI verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);report.browserErrors=errors;if(page){report.trace=await page.evaluate(()=>{const a=window.__live;return{last:a?.completed.slice(-3),controls:a?.controls,acks:a?.acks,errors:a?.errors,body:document.body.innerText.slice(-6000)};}).catch(()=>undefined);await page.screenshot({path:directory+'/failure.png',fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(x=>x.status);if(report.cleanup.some(v=>v!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,elapsedMs:report.elapsedMs,checks:report.checks.length}));}
