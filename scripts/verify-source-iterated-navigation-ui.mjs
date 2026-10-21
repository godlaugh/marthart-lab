import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply new output directory');await mkdir(out);
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const p=e.parentPath+'/'+e.name;return[p,createHash('sha256').update(await readFile(p)).digest('hex')];})));
const report={status:'running',sourceBefore:await hashes(),nativeWindowExecuted:false,cases:[]};let browser,server;
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [family,dimension,dpr] of [['map',2,1],['map',3,2],['symmetry',2,2]]){
  const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:dpr});page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{
   const Native=window.Worker,a=window.__nav={requests:[],frames:[],errors:[],rendered:[],owners:new WeakMap(),created:0,terminated:[]};
   window.Worker=class extends Native{
    constructor(...args){super(...args);this.auditId=++a.created;this.addEventListener('message',({data})=>{
     if(data.error)a.errors.push(data.error);if(!data.output)return;
     const {pixels,...output}=data.output,key=this.auditId+':'+data.id;a.owners.set(data.output,key);
     a.frames.push({key,id:data.id,worker:this.auditId,operation:data.operation,output});
    });}
    postMessage(message,...args){a.requests.push({...structuredClone(message),worker:this.auditId});return super.postMessage(message,...args);}
    terminate(){a.terminated.push(this.auditId);return super.terminate();}
   };
  });
  const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('map'));s.settings.count=8;s.settings.burnIn=0;saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
  await page.goto(origin);
  const ready=async()=>{await page.waitForFunction(()=>window.__nav.frames.length&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card')&&document.querySelector('.status-bar')?.textContent.includes('Ready'));};await ready();
  await page.evaluate(async()=>{const{ArtRenderer}=await import('/src/engine/renderer.ts'),native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,...args){const result=native.call(this,output,...args);window.__nav.rendered.push(window.__nav.owners.get(output));return result;};});
  const fixture={config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Viewport navigation',parameters:{gain:.01},settings:{dimension,batch_size:32,burn_in_steps:1,iterations_per_frame:1,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1},palette:['#ffffff','#ee6538'],...(family==='map'?{equations:{x_next:'sin(x+gain)',y_next:'sin(y-gain)',z_next:'0'}}:{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(sin(p.x+gain),sin(p.y-gain),0.);m=gain;}'}}),timeline:[]};
  await page.locator('input[type=file]').setInputFiles({name:'navigation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.locator('#control-batchSize').waitFor();await ready();
  const last=()=>page.evaluate(()=>window.__nav.frames.at(-1)),initial=await last(),key=family==='map'?'mapLive':'symmetryLive';check(initial.output[key]?.paused,'Fixture not paused');
  const canvas=page.getByTestId('art-canvas'),box=await canvas.boundingBox();const x=Math.floor(box.x+box.width*.5),y=Math.floor(box.y+box.height*.5);
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+30,y+20,{steps:3});await page.mouse.up({button:'right'});
  await page.waitForFunction(()=>window.__nav.frames.some(f=>f.operation==='iterated-navigation'));await ready();
  const dragged=await last();check(dragged.output[key].sessionId===initial.output[key].sessionId&&dragged.output[key].objectUpdates===0,'Drag reconstructed or advanced');
  const count=await page.evaluate(()=>window.__nav.frames.filter(f=>f.operation==='iterated-navigation').length);
  await canvas.dispatchEvent('wheel',{deltaY:-32,deltaMode:0,bubbles:true,cancelable:true});await canvas.dispatchEvent('wheel',{deltaY:1,deltaMode:1,bubbles:true,cancelable:true});
  await page.waitForFunction(n=>window.__nav.frames.filter(f=>f.operation==='iterated-navigation').length===n+2,count);await ready();const navigated=await last();
  const audited=await page.evaluate(()=>({requests:window.__nav.requests,frames:window.__nav.frames,rendered:window.__nav.rendered}));
  const nativeRequests=audited.requests.filter(r=>r.operation==='iterated-navigation');check(nativeRequests.length===5,'Drag/wheel events lost or coalesced');
  check(nativeRequests.at(-2).event.count===-2&&nativeRequests.at(-1).event.count===1,'Wheel DOM mapping incorrect');
  const expected=await page.evaluate(async({initial,events,mode})=>{const{navigateSourceIteratedCamera}=await import('/src/engine/sourceIteratedNavigation.ts');let camera=initial.camera;for(const e of events){const r=navigateSourceIteratedCamera(camera,mode,e,initial.viewport.logicalWidth,initial.viewport.logicalHeight);if(!r.ok)throw r.error;camera=r.value;}return camera;},{initial:initial.output.sourceCameraFrame,events:nativeRequests.map(r=>r.event),mode:family==='map'&&dimension===2?'map-2d':'rotate'});
  check(same(expected,navigated.output.sourceCameraFrame.camera),'UI coordinates/DPR differed from logical navigation');check(audited.rendered.includes(navigated.key),'Navigated frame not presented');
  for(const f of audited.frames.filter(f=>f.operation==='iterated-navigation'))check(f.output[key].objectUpdates===0&&f.output[key].sceneTime===initial.output[key].sceneTime,'Paused input advanced math');
  // Resume with an empty animation queue: only saved angles are restored.
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(key=>window.__nav.frames.some(f=>f.output[key]?.paused===false),key);const first=await page.evaluate(key=>window.__nav.frames.find(f=>f.output[key]?.paused===false),key);
  for(const axis of ['phi','theta','gamma'])check(first.output.sourceCameraFrame.camera[axis]===initial.output.sourceCameraFrame.camera[axis],'Resume failed to restore '+axis);
  check(same(first.output.sourceCameraFrame.camera.center,expected.center)&&first.output.sourceCameraFrame.camera.zoom===expected.zoom,'Resume lost center/zoom');
  const controls=await page.evaluate(()=>window.__nav.requests.filter(r=>r.operation==='iterated-navigation').length);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y+10);await page.mouse.up();await canvas.dispatchEvent('wheel',{deltaY:16,deltaMode:0});check(await page.evaluate(()=>window.__nav.requests.filter(r=>r.operation==='iterated-navigation').length)===controls,'Running pointer navigation accepted');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await ready();
  await page.screenshot({path:out+'/'+family+'-'+dimension+'-dpr'+dpr+'.png'});
  const errors=await page.evaluate(()=>window.__nav.errors);check(!errors.length,errors.join('\n'));
  report.cases.push({family,dimension,dpr,nativeRequests,initial:initial.output.sourceCameraFrame,navigated:navigated.output.sourceCameraFrame,resumed:first.output.sourceCameraFrame,presented:true,eventsOrdered:true,runningGuard:true});await page.close();
 }
 report.sourceAfter=await hashes();report.sourceStable=same(report.sourceBefore,report.sourceAfter);if(!report.sourceStable)throw Error('Source changed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases.length}));}
