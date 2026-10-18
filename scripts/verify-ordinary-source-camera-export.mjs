import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const surfaceParticles=process.argv.includes('--surface-particles'),artifactPrefix=surfaceParticles?'v2-source-surface-export':'v2-ordinary-camera-export';
const check=(v,m)=>{if(!v)throw Error(m);};
const paths=['src/App.tsx','src/components/OrdinarySourceCameraControls.tsx','src/components/ExportDialog.tsx','src/components/Viewport.tsx','src/engine/client.ts','src/engine/legacyImport.ts','src/engine/ordinarySourceCameraImport.ts','src/engine/ordinarySourceCameraTimeline.ts','src/engine/renderer.ts','src/engine/timeline.ts','src/engine/sourceSurfaceParticles.ts','src/scenes/sourceSurface.ts','src/components/Timeline.tsx','server/index.mjs','scripts/verify-ordinary-source-camera-export.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const before=await hashes(),directory=await mkdtemp('.cache/ordinary-camera-export-service-');
// Vite treats port=0 as its default. Reserve an ephemeral port, then bind it
// strictly: a race must fail, never redirect this run to an unrelated service.
const port=await new Promise((resolve,reject)=>{const listener=createTcpServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const port=listener.address().port;listener.close(error=>error?reject(error):resolve(port));});});
const report={at:new Date().toISOString(),surfaceParticles,scope:'Actual App imports original Surface JSON, edits source camera, reloads, exports PNG through ExportDialog and an isolated production image service, and compares against cold Worker/Renderer. Not original app parity.',directory};let page,server,browser,exportServer;
try{
 exportServer=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.transport={uiPort:port,servicePort:address.port};
 page=await browser.newPage({viewport:{width:1360,height:920},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Native=window.Worker;window.__cameraAudit={requests:[],completed:[],errors:[]};
  window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.operation==='generate'&&data.output)window.__cameraAudit.completed.push({id:data.id,frame:data.output.sourceCameraFrame,target:data.output.positions?Array.from(data.output.positions.slice(21,24)):undefined});if(data.error)window.__cameraAudit.errors.push(data.error);});}postMessage(message,...args){if(message.operation==='generate')window.__cameraAudit.requests.push(structuredClone(message));return super.postMessage(message,...args);}};
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 await ready();
 const source={config_version:'1.0.0',type:'SURFACE',name:'Source Camera Export',parameters:{},equations:{x:'u',y:'v',z:'u*v/10'},camera:{phi:0,theta:0,gamma:0},settings:{u_segments:6,v_segments:4,u_min:0,u_max:100,v_min:0,v_max:50,surface_mode:'POINTS',show_trails:false},timeline:[{type:'wait',duration:2}]};
 if(surfaceParticles){
  source.settings={...source.settings,u_segments:3,v_segments:5,u_max:6,v_max:10,speed_u:2,speed_v:-1,scale_x:20,scale_y:20,scale_z:20,render_mode:'CPU'};
  source.timeline=[{type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'track',args:[7]}]},{type:'wait',duration:1.5}];
 }
 await page.locator('input[type=file]').setInputFiles({name:'source-camera.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await page.getByTestId('ordinary-source-camera').waitFor();await ready();
 const panel=page.getByTestId('ordinary-source-camera');await panel.getByLabel('Theta · radians',{exact:true}).fill('0.3');await panel.getByRole('button',{name:'Apply initial camera',exact:true}).click();await ready();
 await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.drafts?.[w.active]?.sourceCamera?.frame?.theta===.3;});
 await page.reload();await ready();await panel.getByLabel('Theta · radians',{exact:true}).waitFor();check(await panel.getByLabel('Theta · radians',{exact:true}).inputValue()==='0.3','baseline lost on reload');
 if(surfaceParticles){
  await page.getByRole('button',{name:'Clip animate',exact:true}).click();
  const index=page.getByRole('spinbutton',{name:'Particle index',exact:true});await index.fill('6');await index.blur();await ready();
  await index.fill('7');await index.blur();await ready();
  check(await page.getByRole('combobox',{name:'Tracking target',exact:true}).count()===0,'source tracking exposes local fixed coordinate mode');
 }
 await page.waitForFunction(()=>window.__cameraAudit.completed.some(x=>x.frame));
 const preview=await page.evaluate(()=>window.__cameraAudit.completed.findLast(x=>x.frame)?.frame);check(preview,'missing preview camera');
 const healthResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 const response=await healthResponse;check(response.ok(),'owned service health failed');const health=await response.json();
 // Observe the health-driven React state through the video controls before
 // requesting the still image. Otherwise a very fast click can legitimately
 // use the browser-only Blob path while the owned service is still probing.
 await page.getByRole('button',{name:'Animation video',exact:true}).click();
 if(health.ffmpeg)await page.waitForFunction(()=>document.querySelector('.export-modal .primary-button')?.disabled===false);
 else await page.getByText('The video encoding service is unavailable. Run npm run server in the studio directory and make sure FFmpeg is available locally.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Still image',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending;await download.saveAs(`.cache/${artifactPrefix}.png`);
 const actual=await page.evaluate(()=>{const request=window.__cameraAudit.requests.findLast(r=>r.context.quality==='export');return{request,completed:window.__cameraAudit.completed.findLast(r=>r.id===request?.id),errors:window.__cameraAudit.errors};});
 check(actual.request?.context.sourceViewport.referenceLogicalHeight===preview.viewport.logicalHeight,'preview reference height lost');check(actual.completed?.frame?.viewport.target==='offscreen','export frame lacks offscreen viewport');check(actual.completed.frame.camera.theta===Math.fround(.3),'export camera baseline changed');
 if(surfaceParticles){
  check(actual.request.scene.settings.surfaceGeometryVersion==='mathart-1.7.8-points-v1','source particle geometry not imported/persisted');
  report.particleFrames=await page.evaluate(async request=>{
   const {Generator}=await import('/src/engine/client.ts'),g=new Generator();
   try{
    const scene=structuredClone(request.scene);scene.timeline.fps=4;
    const frames=[];
    for(const time of [0,.25,.75,2,.25]){
     const output=await g.generate(scene,{...request.context,time});
     frames.push({time,center:output.sourceCameraFrame.camera.center,target:Array.from(output.positions.slice(21,24)),count:output.particleIds.length});
    }
    return frames;
   }finally{g.dispose();}
  },actual.request);
  check(report.particleFrames.every(f=>f.count===15),'wrong source grid count');
  check(JSON.stringify(report.particleFrames[0].target)===JSON.stringify([50,75,18.75]),'source first-frame coordinates differ from dyadic golden');
  check(JSON.stringify(report.particleFrames[1].target)===JSON.stringify([60,70,21]),'source second-frame coordinates differ from dyadic golden');
  for(const f of report.particleFrames.slice(1))check(JSON.stringify(f.center)===JSON.stringify(f.target),'tracking center differs from delivered target');
  check(JSON.stringify(report.particleFrames.at(-1).target)===JSON.stringify(report.particleFrames[1].target),'reverse seek changed particle state');
 }
 const oracle=await page.evaluate(async request=>{const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');const g=new Generator(),r=new ArtRenderer(document.createElement('canvas'));try{const out=await g.generate(request.scene,request.context);r.setSize(request.context.width,request.context.height,1);r.setOutput(out,sceneAtTime(request.scene,out.sourceCameraFrame.time),false);const blob=await r.blob('image/png');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');}finally{g.dispose();r.dispose();r.renderer.forceContextLoss();}},actual.request);
 const png=await readFile(`.cache/${artifactPrefix}.png`),sha=createHash('sha256').update(png).digest('hex');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193,'PNG dimensions');check(sha===oracle,'actual download differs from cold renderer');check(!errors.length&&!actual.errors.length,'app/worker error');
 const stored=await readdir(directory);check(stored.length===1&&stored[0].endsWith('.png'),'expected exactly one production service image');check(createHash('sha256').update(await readFile(directory+'/'+stored[0])).digest('hex')===sha,'service image differs from actual download');report.serviceImage=stored[0];
 await page.screenshot({path:`.cache/${artifactPrefix}-ui.png`});const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'source changed during test');Object.assign(report,{status:'passed',sourceStable:true,sources:after,preview,actual,png:{sha,width:257,height:193,bytes:png.length},coldRendererMatches:true,pageErrors:errors});
}catch(error){Object.assign(report,{status:'failed',error:String(error),stack:error.stack});if(page){report.body=await page.locator('body').innerText();await page.screenshot({path:`.cache/${artifactPrefix}-failed.png`});}process.exitCode=1;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);
 report.cleanup=closed.map((result,i)=>({resource:['browser','vite','export-server'][i],status:result.status,...(result.status==='rejected'?{error:String(result.reason)}:{})}));
 if(closed.some(result=>result.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(`.cache/${artifactPrefix}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error}));
}
