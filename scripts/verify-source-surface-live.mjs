/** Real Generator → Worker → retained Surface → ArtRenderer verification. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/surface-live-${Date.now()}`;await mkdir(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'running',scope:'Unmodified Generator, Worker and ArtRenderer in headless Chrome; injected timestamps and observed-FPS inputs.',limits:['Local CPU/GPU rendering only; no original JVM/JOGL window or pixel oracle.','Surface recording remains pending; this verifier uses the public engine queue, not App controls.','Local Apply revision replacement does not prove the native toolbar reload contract.']};
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())result.push(...await files(p));else if(e.isFile())result.push(p);}return result;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-surface-live.mjs'].sort().map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));}
report.sourceBefore=await hashes();let server,browser;const started=performance.now(),errors=[];
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/surface-live-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Surface live verification</title>'}));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface-live-verifier`);
 report.rows=await page.evaluate(async()=>{
  const {GenerationQueue}=await import('/src/engine/generationQueue.ts'),{Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts'),THREE=await import('/node_modules/three/build/three.module.js');
  const check=(v,m)=>{if(!v)throw Error(m);},digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const rows=[];
  for(const backend of ['CPU','GPU'])for(const mode of backend==='CPU'?['POINTS','MESH','SWITCH']:['POINTS','MESH']){
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Live Surface '+backend+mode,parameters:{a:.25},equations:{x:'a+u',y:'v',z:'0'},settings:{render_mode:backend,surface_mode:mode==='SWITCH'?'POINTS':mode,u_segments:12,v_segments:12,mesh_u_segments:12,mesh_v_segments:12,u_min:-1,u_max:1,v_min:-1,v_max:1,speed_u:0,speed_v:0,scale_x:60,scale_y:60,scale_z:60,show_trails:false,dot_radius:3,mesh_wireframe:false},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{step:.1,min:-1,max:1}}}}]},{type:'wait',duration:1}]})).scene;
   if(mode==='SWITCH'){const raw=structuredClone(s.provenance.original);raw.timeline=[raw.timeline[0],{type:'surface_mode_transition',duration:.5,to:'MESH',easing:'LINEAR'},{type:'wait',duration:.25},{type:'surface_mode_transition',duration:.5,to:'POINTS',easing:'LINEAR'},{type:'wait',duration:.5}];Object.assign(s,parseProjectFile(JSON.stringify(raw)).scene);}
   s.timeline.fps=4;const g=new Generator(),renderer=new ArtRenderer(document.createElement('canvas')),rt=new THREE.WebGLRenderTarget(128,96,{depthBuffer:true,stencilBuffer:false});renderer.setSize(128,96,1);
   const input=(timestampMs=1000,extra={})=>({time:999,quality:'preview',width:128,height:96,sourceViewport:ordinarySourceViewport(s,128,96,'primary',96),surfaceLive:{sessionId:backend+mode,revision:0,clock:{paused:false,timestampMs},actualFrameRate:37,...extra}});
   const value=o=>o.sourceGpuPoints?.parameters[0]??o.sourceGpuMesh?.parameters[0]??o.positions[0];
   const render=async(output,scene=s)=>{renderer.setOutput(output,scene,false);renderer.renderer.setRenderTarget(rt);try{renderer.render();const pixels=new Uint8Array(128*96*4);renderer.renderer.readRenderTargetPixels(rt,0,0,128,96,pixels);check(renderer.renderer.getContext().getError()===0,'GL failure');return digest(pixels);}finally{renderer.renderer.setRenderTarget(null);}};
   try{
    const cold=performance.now(),first=await g.generate(s,input()),coldMs=performance.now()-cold;check(first.surfaceLive.frame.sceneTime===0,'first dt');const firstHash=await render(first);
    const warm=performance.now(),moving=await g.generate(s,input(1250)),warmMs=performance.now()-warm;check(moving.surfaceLive.frame.sceneTime===.25&&moving.surfaceLive.constructions===1,'retained update');check(value(moving)!==value(first),'parameter did not move');const movedHash=await render(moving);check(firstHash!==movedHash,'visible pixels did not move');
    await g.setSurfacePaused(moving,true,1300);
    const paused=await g.generate(s,input(9000,{clock:{paused:true,timestampMs:9000}}));check(paused.surfaceLive.renderKind==='snapshot'&&paused.surfaceLive.frame.frameIndex===1,'pause advanced');check(await render(paused)===movedHash,'pause pixels changed');
    let current=await g.currentSurface(paused);check(await render(current)===movedHash,'current pixels changed');current=await g.currentSurface(current);check(await render(current)===movedHash,'repeated current pixels changed');
    let stale=false;try{await g.setSurfacePaused(paused,false);}catch{stale=true;}check(stale,'stale output controlled scene');
    await g.setSurfacePaused(current,false,10000);const resumed=await g.generate(s,input(10250));check(resumed.surfaceLive.frame.sceneTime===.5&&resumed.surfaceLive.frame.rawDt===.25,'pause interval leaked');const resumedHash=await render(resumed);check(resumedHash!==movedHash,'resume pixels did not change');
    const transitions=[];
    if(mode==='SWITCH'){
     for(const ms of [10750,11000,11250,11500,11750,12000,12500]){const o=await g.generate(s,input(ms));transitions.push({time:o.surfaceLive.frame.sceneTime,mode:o.topology,overlay:o.sourceSurfaceOverlayAlpha,pixels:await render(o)});check(o.surfaceLive.constructions===1,'switch replaced the root session');}
     check(transitions.map(t=>t.mode).join(',')==='points,mesh,mesh,mesh,points,points,points','retained mode switch order');
     check(transitions[1].overlay===255&&transitions[2].overlay===0&&transitions[4].overlay===255&&transitions[5].overlay===0,'retained transition overlay');
    }
    const configuration=structuredClone(s);configuration.parameters.a=.75;const draft=structuredClone(configuration);draft.equations.x='(';
    const applied=await g.generate(draft,input(0,{revision:1,configuration,clock:{paused:true}}));check(applied.surfaceLive.constructions===2&&applied.surfaceLive.frame.sceneTime===0,'revision not fresh');const appliedHash=await render(applied,configuration);
    configuration.parameters.a=999;const retained=await g.generate(draft,input(0,{revision:1,clock:{paused:true}}));check(await render(retained,s)===appliedHash,'staged edit leaked into geometry');
    await g.updateSurfaceParameter(retained,'a',-.5);
    const edited=await g.currentSurface(retained),editedHash=await render(edited,s);
    check(JSON.stringify(edited.surfaceLive.frame)===JSON.stringify(retained.surfaceLive.frame)&&edited.surfaceLive.constructions===2,'parameter edit reset or advanced queue');
    const deferredCpuPoints=backend==='CPU'&&mode!=='MESH';
    check(deferredCpuPoints?editedHash===appliedHash:editedHash!==appliedHash,'parameter edit presentation timing');
    await g.updateSurfaceParameter(edited,'undeclared',99);
    let invalidEdit=false;try{await g.updateSurfaceParameter(edited,'a',NaN);}catch{invalidEdit=true;}check(invalidEdit,'nonfinite edit accepted');
    const editCurrent=await g.currentSurface(edited);check(await render(editCurrent,s)===editedHash,'unknown parameter changed pixels');
    const captureBefore=structuredClone(editCurrent.surfaceLive.frame),capture=await g.captureSurfacePaused(editCurrent,{width:65,height:49},3);
    check(capture.capture.width===65&&capture.capture.height===49&&capture.capture.pixels.length===65*49*4&&capture.capture.sourceCurrentImage?.stage==='base-before-formulas'&&capture.capture.sourceCurrentImage.scale===3,'capture base dimensions');
    const capturePng=await encodeFormulaRaster(capture.capture),decoded=await createImageBitmap(capturePng);try{check(decoded.width===195&&decoded.height===147,'encoded 3x PNG dimensions');}finally{decoded.close();}
    const rgba=capture.capture.pixels;check(rgba.some((v,i)=>i%4!==3&&v!==rgba[i%4]),'capture contains only a flat background');
    check(JSON.stringify(capture.preview.surfaceLive.frame)===JSON.stringify(captureBefore),'capture advanced queue');
    check(await render(capture.preview,s)===editedHash,'capture changed primary pixels');
    const captureHash=await digest(capture.capture.pixels),captureAgain=await g.captureSurfacePaused(capture.preview,{width:65,height:49},3);
    check(await digest(captureAgain.capture.pixels)===captureHash,'repeated capture changed pixels');check(await digest(await (await encodeFormulaRaster(captureAgain.capture)).arrayBuffer())===await digest(await capturePng.arrayBuffer()),'repeated 3x PNG changed');
    let capacityRejected=false;try{await g.captureSurfacePaused(captureAgain.preview,{width:30000,height:30000},5);}catch{capacityRejected=true;}check(capacityRejected,'oversized capture accepted');
    const afterCapture=await g.currentSurface(captureAgain.preview);check(await render(afterCapture,s)===editedHash,'capture capacity failure lost preview');
    const navBefore=structuredClone(afterCapture.surfaceLive.frame),dragged=await g.navigateSurfacePaused(afterCapture,{kind:'drag',dx:37,dy:-33}),zoomed=await g.navigateSurfacePaused(dragged,{kind:'wheel',count:-3});
    check(zoomed.surfaceLive.frame.sceneTime===navBefore.sceneTime&&zoomed.surfaceLive.frame.queueIndex===navBefore.queueIndex&&zoomed.surfaceLive.frame.frameIndex===navBefore.frameIndex+2,'navigation advanced queue phase');
    check(zoomed.surfaceLive.frame.rawDt===0&&await render(zoomed,s)!==editedHash,'navigation failed to change visible camera');
    const navigatedCamera=structuredClone(zoomed.surfaceLive.frame.camera);await g.setSurfacePaused(zoomed,false,10000);const restored=await g.currentSurface(zoomed);
    check(['phi','theta','gamma'].every(axis=>restored.surfaceLive.frame.camera[axis]===navBefore.camera[axis])&&restored.surfaceLive.frame.camera.zoom===navigatedCamera.zoom,'resume failed to restore angles/preserve zoom');
    let failed=false;try{await g.generate(draft,input(0,{revision:1,clock:{paused:true},actualFrameRate:NaN}));}catch{failed=true;}check(failed,'invalid observation accepted');
    const recovered=await g.generate(s,input(20000,{sessionId:backend+mode+'-new'}));check(recovered.surfaceLive.frame.sceneTime===0&&recovered.surfaceLive.constructions===1,'worker did not recover');check(await render(recovered)===firstHash,'recovery pixels differ');
    let delivery,queueError,lastQueueOutput;const queueGenerator=new Generator();
    const queue=new GenerationQueue(queueGenerator,{
     output:(output,time,scene)=>{lastQueueOutput={output,time,scene};},
     error:error=>{queueError=error;},
     busy:busy=>{if(!busy&&delivery){const {resolve,reject}=delivery;delivery=undefined;queueError?reject(queueError):resolve(lastQueueOutput);}},
    });
    const request=(scene,context,intent,writes)=>new Promise((resolve,reject)=>{check(!delivery,'overlapping verifier request');delivery={resolve,reject};queueError=undefined;queue.request(scene,context,0,intent,writes);});
    let queueFacts;
    try{
     const qContext=()=>input(0,{sessionId:'queue-'+backend+mode,clock:{paused:true}});
     const qFirst=await request(s,qContext());check(qFirst.time===0,'queue published caller time');
     const editScene={...s,parameters:{...s.parameters,a:.75}},qEdit=await request(editScene,qContext(),undefined,[['a',.75]]);
     check(qEdit.output.surfaceLive.constructions===1&&qEdit.time===0,'queue edit rebuilt or advanced');
     const qEditHash=await render(qEdit.output,editScene);
     const renamed={...editScene,name:'Queue metadata'},qMeta=await request(renamed,qContext(),'metadata');
     check(qMeta.output===qEdit.output&&qMeta.scene===renamed,'metadata lost completed capability');
     const appliedScene={...s,parameters:{...s.parameters,a:-.5}},applyContext=qContext();applyContext.surfaceLive={...applyContext.surfaceLive,revision:1,configuration:appliedScene};
     const qApply=await request(appliedScene,applyContext);check(qApply.output.surfaceLive.constructions===2&&qApply.time===0&&qApply.output.surfaceLive.paused,'Apply did not reset paused owner');
     const qApplyHash=await render(qApply.output,appliedScene);check(qApplyHash!==qEditHash,'Apply pixels did not change');
     await queue.setSurfacePaused(false);
     const running=qContext();running.surfaceLive={...running.surfaceLive,revision:1,clock:{paused:false}};
     const qResume=await request(appliedScene,running);check(!qResume.output.surfaceLive.paused&&qResume.output.surfaceLive.constructions===2,'queue resume rebuilt');
     await queue.setSurfacePaused(true);
     queueFacts={passed:true,parameterEditPixels:qEditHash,applyPixels:qApplyHash,metadataReusedOutput:true,applyKeptPause:true,resumeKeptOwner:true};
    }finally{queue.dispose();}
    rows.push({backend,mode,passed:true,queue:queueFacts,transitions,completedRequestMs:{coldWorker:coldMs,warmRetainedWorker:warmMs},frames:[first,moving,paused,resumed].map(o=>o.surfaceLive),pixels:{initial:firstHash,moving:movedHash,resumed:resumedHash,applied:appliedHash},currentCapture:{pixels:captureHash,width:195,height:147,repeatedStable:true,primaryStable:true,capacityRetained:true},parameterEdit:{sameQueue:true,pixels:editedHash,deferredCpuPoints,unknownIgnored:true,invalidRejected:true},pauseAndRepeatedCurrentStable:true,staleRejected:true,invalidObservationRejected:true,recovered:true});
   }finally{g.dispose();rt.dispose();renderer.dispose();renderer.renderer.forceContextLoss();}
  }
  return rows;
 });
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||errors.length)throw Error('Source changed or page errors: '+errors.join('; '));report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack??error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.elapsedMs=performance.now()-started;report.pageErrors=errors;await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,error:report.error,rows:report.rows?.map(r=>({backend:r.backend,mode:r.mode,passed:r.passed})),elapsedMs:report.elapsedMs}));}
