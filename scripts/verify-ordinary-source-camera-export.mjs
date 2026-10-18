import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';
const surfaceColor=process.argv.includes('--surface-color'),surfaceRecording=surfaceColor||process.argv.includes('--surface-recording'),surfaceTrails=surfaceRecording||process.argv.includes('--surface-trails'),surfaceParticles=surfaceTrails||process.argv.includes('--surface-particles'),artifactPrefix=surfaceColor?'v2-source-surface-color-export':surfaceRecording?'v2-source-dynamic-trails-export':surfaceTrails?'v2-source-surface-trails-export':surfaceParticles?'v2-source-surface-export':'v2-ordinary-camera-export';
const check=(v,m)=>{if(!v)throw Error(m);};
const paths=['src/engine/sourceSurfaceColor.ts','src/engine/outputBuffers.ts','src/components/SourceSurfacePaletteEditor.tsx','src/App.tsx','src/components/OrdinarySourceCameraControls.tsx','src/components/ExportDialog.tsx','src/components/Viewport.tsx','src/engine/client.ts','src/engine/legacyImport.ts','src/engine/ordinarySourceCameraImport.ts','src/engine/ordinarySourceCameraTimeline.ts','src/engine/rootsSceneClock.ts','src/engine/document.ts','src/engine/renderer.ts','src/engine/timeline.ts','src/engine/sourceSurfaceParticles.ts','src/scenes/sourceSurface.ts','src/components/Timeline.tsx','server/index.mjs','scripts/verify-ordinary-source-camera-export.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const before=await hashes(),directory=await mkdtemp('.cache/ordinary-camera-export-service-');
// Vite treats port=0 as its default. Reserve an ephemeral port, then bind it
// strictly: a race must fail, never redirect this run to an unrelated service.
const port=await new Promise((resolve,reject)=>{const listener=createTcpServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const port=listener.address().port;listener.close(error=>error?reject(error):resolve(port));});});
const report={at:new Date().toISOString(),surfaceParticles,surfaceTrails,surfaceRecording,surfaceColor,scope:'Actual App imports original Surface JSON, edits source camera, reloads, exports PNG through ExportDialog and an isolated production image service, and compares against cold Worker/Renderer. Not original app parity.',directory};let page,server,browser,exportServer;
try{
 exportServer=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.transport={uiPort:port,servicePort:address.port};
 page=await browser.newPage({viewport:{width:1360,height:920},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const Native=window.Worker;window.__cameraAudit={requests:[],completed:[],errors:[]};
  window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.operation==='generate'&&data.output)window.__cameraAudit.completed.push({id:data.id,frame:data.output.sourceCameraFrame,pointAlphas:data.output.pointAlphas?Array.from(data.output.pointAlphas):undefined,colors:data.output.colors?Array.from(data.output.colors):undefined,target:data.output.positions?Array.from(data.output.positions.slice(21,24)):undefined,trails:data.output.trails?{vertices:data.output.trails.positions.length/3,segments:(data.output.trails.indices?.length??0)/2,appearance:data.output.trails.appearance}:undefined});if(data.error)window.__cameraAudit.errors.push(data.error);});}postMessage(message,...args){if(message.operation==='generate')window.__cameraAudit.requests.push(structuredClone(message));return super.postMessage(message,...args);}};
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
 if(surfaceTrails)Object.assign(source.settings,{show_trails:true,fade_trails:true,trail_lifetime:.75,line_weight:6,periodic_u:true,flowing_u:true,speed_u:13});
 if(surfaceRecording)source.timeline=[source.timeline[0],{type:'trails',enable:false,duration:'ignored'},{type:'wait',duration:.5},{type:'trails',enable:true},{type:'wait',duration:1}];
 if(surfaceColor){source.palette=['#40FF0000','#800000FF'];source.settings.dot_size=12;}
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
 if(surfaceRecording){
  await page.getByRole('button',{name:'Clip trails',exact:true}).first().click();
  const recording=page.getByRole('checkbox',{name:'Record trails',exact:true});check(!await recording.isChecked(),'imported recording off state lost');
  check(await page.getByRole('spinbutton',{name:'Clip duration',exact:true}).count()===0,'instant action exposes duration control');
  await recording.check();await ready();await recording.uncheck();await ready();
  await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.drafts?.[w.active]?.timeline.tracks[1]?.trailsEnabled===false;});
  await page.reload();await ready();await page.getByRole('button',{name:'Clip trails',exact:true}).first().click();check(!await recording.isChecked(),'recording edit lost on reload');
 }
 if(surfaceTrails){
  await page.getByRole('slider',{name:'Time position',exact:true}).press('End');
  await page.waitForFunction(()=>{const request=window.__cameraAudit.requests.at(-1);return request?.context.time>=2&&window.__cameraAudit.completed.some(c=>c.id===request.id&&c.trails?.segments>0);});await ready();
  check(await page.getByRole('checkbox',{name:'Fade by record order',exact:true}).isChecked(),'source ordinal fade control/default missing');
  const visible=page.getByRole('checkbox',{name:'Show history trails',exact:true});await visible.uncheck();
  await page.waitForFunction(()=>{const request=window.__cameraAudit.requests.at(-1);return request?.scene.settings.showTrails===false&&window.__cameraAudit.completed.some(c=>c.id===request.id&&!c.trails);});await ready();
  await visible.check();
  await page.waitForFunction(()=>{const request=window.__cameraAudit.requests.at(-1);return request?.scene.settings.showTrails===true&&window.__cameraAudit.completed.some(c=>c.id===request.id&&c.trails?.segments>0);});await ready();
  await page.screenshot({path:`.cache/${artifactPrefix}-preview.png`});
 }
 if(surfaceColor){
  await page.getByRole('slider',{name:'Time position',exact:true}).press('Home');await ready();
  await page.waitForFunction(()=>window.__cameraAudit.requests.at(-1)?.context.time===0);
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  const palette=page.getByTestId('source-surface-palette');await palette.waitFor();
  const color=palette.getByRole('textbox',{name:'Source surface color text',exact:true});check(await color.inputValue()==='#40FF0000','ARGB text not imported');
  await color.fill('#6011CC33');await ready();
  const fade=palette.getByRole('checkbox',{name:'Fade points at periodic boundaries',exact:true});check(await fade.isChecked(),'fade default missing');
  await fade.uncheck();await ready();
  await page.waitForFunction(()=>{const r=window.__cameraAudit.requests.at(-1);return r?.scene.settings.fadePoints===false&&window.__cameraAudit.completed.some(c=>c.id===r.id&&c.pointAlphas);});
  const noFade=await page.evaluate(()=>window.__cameraAudit.completed.findLast(c=>c.id===window.__cameraAudit.requests.at(-1).id).pointAlphas);
  await fade.check();await ready();
  await page.waitForFunction(()=>{const r=window.__cameraAudit.requests.at(-1);return r?.scene.settings.fadePoints===true&&window.__cameraAudit.completed.some(c=>c.id===r.id&&c.pointAlphas);});
  const faded=await page.evaluate(()=>window.__cameraAudit.completed.findLast(c=>c.id===window.__cameraAudit.requests.at(-1).id).pointAlphas);
  check(noFade.some((a,i)=>a>faded[i]),'boundary fade has no effect on delivered points');
  await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.drafts?.[w.active]?.surfaceSourcePalette?.colors[0]==='#6011CC33';});
  await page.reload();await ready();await page.getByRole('button',{name:'Appearance',exact:true}).click();
  check(await color.inputValue()==='#6011CC33','edited ARGB lost on reload');check(await fade.isChecked(),'fade toggle lost on reload');
  report.colorEditing={noFade,faded,savedColor:await color.inputValue()};
  await page.getByRole('slider',{name:'Time position',exact:true}).press('End');await ready();
  await page.waitForFunction(()=>{const r=window.__cameraAudit.requests.at(-1);return r?.context.time>=2&&window.__cameraAudit.completed.some(c=>c.id===r.id&&c.trails?.segments>0);});
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
     frames.push({time,center:output.sourceCameraFrame.camera.center,target:Array.from(output.positions.slice(21,24)),count:output.particleIds.length,...(output.trails?{trailRecords:output.temporal.recordedPoints,trailVertices:output.trails.positions.length/3,trailSegments:output.trails.indices.length/2,finite:output.trails.positions.every(Number.isFinite),appearance:output.trails.appearance}: {})});
    }
    return frames;
   }finally{g.dispose();}
  },actual.request);
  check(report.particleFrames.every(f=>f.count===15),'wrong source grid count');
  if(!surfaceTrails)check(JSON.stringify(report.particleFrames[0].target)===JSON.stringify([50,75,18.75]),'source first-frame coordinates differ from dyadic golden');
  if(!surfaceTrails)check(JSON.stringify(report.particleFrames[1].target)===JSON.stringify([60,70,21]),'source second-frame coordinates differ from dyadic golden');
  if(surfaceTrails){check(report.particleFrames[0].trailRecords===30,'first source seam record count');check(report.particleFrames.every(f=>f.finite&&f.trailSegments>0),'finite trail topology missing');check(actual.completed.trails?.segments>0,'exported active trails missing');}
  for(const f of report.particleFrames.slice(1))check(JSON.stringify(f.center)===JSON.stringify(f.target),'tracking center differs from delivered target');
  check(JSON.stringify(report.particleFrames.at(-1).target)===JSON.stringify(report.particleFrames[1].target),'reverse seek changed particle state');
 }
 if(surfaceRecording){
  report.recordingFrames=await page.evaluate(async request=>{
   const {Generator}=await import('/src/engine/client.ts'),g=new Generator();
   try{const scene=structuredClone(request.scene);scene.timeline.fps=4;Object.assign(scene.settings,{uSegments:1,vSegments:1,uMin:0,uMax:100,vMin:0,vMax:1,periodicU:false,speedU:1,speedV:0,scaleX:1,scaleY:1,scaleZ:1,trailLifetime:.5});scene.equations={x:'u',y:'v',z:'0'};
    const frames=[];for(const time of [.25,.5,.75,1,1.25,1.5,.25]){const out=await g.generate(scene,{...request.context,time});frames.push({time,head:out.positions[0],records:out.temporal.recordedPoints,x:Array.from(out.trails.positions).filter((_,i)=>i%3===0),segments:out.trails.indices.length/2});}return frames;
   }finally{g.dispose();}
  },actual.request);
  check(JSON.stringify(report.recordingFrames.map(f=>f.x))===JSON.stringify([[.25,.5],[.25,.5],[.5],[],[1.5],[1.5,1.75],[.25,.5]]),'recording pause/expiry/resume/reverse Worker history differs from instruction-derived golden');
 }
 const oracle=await page.evaluate(async request=>{const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');const g=new Generator(),r=new ArtRenderer(document.createElement('canvas'));try{const out=await g.generate(request.scene,request.context);r.setSize(request.context.width,request.context.height,1);r.setOutput(out,sceneAtTime(request.scene,out.sourceCameraFrame.time),false);const styles=[],points=[];r.scene.traverse(o=>{if(o.isPoints)points.push({colorItemSize:o.geometry.getAttribute('color').itemSize,alphas:Array.from(o.geometry.getAttribute('color').array).filter((_,i)=>i%4===3)});if(o.isLineSegments2)styles.push({width:o.material.linewidth,depthTest:o.material.depthTest,renderOrder:o.renderOrder});});const blob=await r.blob('image/png');let alphaVisibility;
if(request.scene.surfaceSourcePalette){
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await value.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const pointOnly={...out,trails:undefined},solid=new Float32Array(out.pointAlphas.length).fill(1),transparent=new Float32Array(out.pointAlphas.length);
 r.setOutput({...pointOnly,pointAlphas:transparent},sceneAtTime(request.scene,out.sourceCameraFrame.time),false);const hidden=await digest(await r.blob('image/png'));
 r.setOutput({...pointOnly,pointAlphas:solid},sceneAtTime(request.scene,out.sourceCameraFrame.time),false);const visible=await digest(await r.blob('image/png'));
 alphaVisibility={hidden,visible};
}
return{styles,points,alphaVisibility,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('')};}finally{g.dispose();r.dispose();r.renderer.forceContextLoss();}},actual.request);
 const png=await readFile(`.cache/${artifactPrefix}.png`),sha=createHash('sha256').update(png).digest('hex');check(png.readUInt32BE(16)===257&&png.readUInt32BE(20)===193,'PNG dimensions');check(sha===oracle.sha,'actual download differs from cold renderer');
 if(surfaceTrails){check(oracle.styles.length===1&&oracle.styles[0].width===Math.fround(6*Math.fround(.95))&&oracle.styles[0].depthTest===false&&oracle.styles[0].renderOrder===2,'renderer did not consume source trail appearance');report.trailStyle=oracle.styles[0];}check(!errors.length&&!actual.errors.length,'app/worker error');
 if(surfaceColor){check(oracle.points.length===1&&oracle.points[0].colorItemSize===4,'renderer did not use RGBA vertex colors');check(JSON.stringify(oracle.points[0].alphas)===JSON.stringify(actual.completed.pointAlphas),'renderer changed producer alpha');check(oracle.alphaVisibility.hidden!==oracle.alphaVisibility.visible,'point alpha did not change rendered pixels');report.pointStyle=oracle.points[0];report.alphaVisibility=oracle.alphaVisibility;}
 const stored=await readdir(directory);check(stored.length===1&&stored[0].endsWith('.png'),'expected exactly one production service image');check(createHash('sha256').update(await readFile(directory+'/'+stored[0])).digest('hex')===sha,'service image differs from actual download');report.serviceImage=stored[0];
 await page.screenshot({path:`.cache/${artifactPrefix}-ui.png`});const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'source changed during test');Object.assign(report,{status:'passed',sourceStable:true,sources:after,preview,actual,png:{sha,width:257,height:193,bytes:png.length},coldRendererMatches:true,pageErrors:errors});
}catch(error){Object.assign(report,{status:'failed',error:String(error),stack:error.stack});if(page){report.body=await page.locator('body').innerText();await page.screenshot({path:`.cache/${artifactPrefix}-failed.png`});}process.exitCode=1;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);
 report.cleanup=closed.map((result,i)=>({resource:['browser','vite','export-server'][i],status:result.status,...(result.status==='rejected'?{error:String(result.reason)}:{})}));
 if(closed.some(result=>result.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(`.cache/${artifactPrefix}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error}));
}
