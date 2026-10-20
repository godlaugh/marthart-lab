/** Real WebGL retained recording lifecycle with a separately assembled
 * Model/Timeline/Flow/Target reference. Shared local components are NOT a
 * native JVM/JOGL image oracle. No App/Worker/service/encoder integration. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const script='scripts/verify-source-perlin-retained-recording.mjs';
const directory=process.argv[2]??`.cache/perlin-retained-recording-${Date.now()}`,artifact=n=>directory+'/'+n;
await mkdir(directory,{recursive:true});const started=performance.now(),sha=x=>createHash('sha256').update(x).digest('hex');
const sources=async()=>{const entries=await readdir('src',{recursive:true,withFileTypes:true}),paths=entries.filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`);paths.push(script);paths.sort();return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));};
const report={at:new Date().toISOString(),status:'running',directory,nativeParity:false,scope:'Real headless WebGL runtime retained recording with independently orchestrated local model/timeline/flow/targets.',limits:['Shared local geometry, timeline, noise and shaders are not an independent native oracle.','No original JVM/JOGL image comparison, public UI, Worker transport or encoder tested.','Small surfaces/cases; wall time measured, CPU time and peak process-family/GPU memory unmeasured.']};
let server,browser,page;const errors=[];report.sourceBefore=await sources();await writeFile(artifact('verifier.mjs'),await readFile(script));
try{
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/recording-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Retained Perlin recording verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'recording-fixture');
 report.result=await page.evaluate(async()=>{
  const {SourcePerlinSession}=await import('/src/scenes/sourcePerlin.ts');
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const {SourcePerlinCpuModel}=await import('/src/engine/sourcePerlinCpuModel.ts');
  const {SourcePerlinCpuTarget}=await import('/src/engine/sourcePerlinCpuTarget.ts');
  const {SourcePerlinFlowResources}=await import('/src/engine/sourcePerlinFlowResources.ts');
  const {sourcePerlinFlowTextureSize}=await import('/src/engine/sourcePerlinGpu.ts');
  const {sourcePerlinCpuConfiguration}=await import('/src/engine/sourcePerlinIdentity.ts');
  const {sourcePerlinBackgroundRgba}=await import('/src/engine/sourcePerlinBackground.ts');
  const {ordinarySourceCameraInitial}=await import('/src/engine/ordinarySourceCamera.ts');
  const {OrdinarySourceCameraTimelineSession}=await import('/src/engine/ordinarySourceCameraTimeline.ts');
  let assertions=0;const check=(v,m)=>{assertions++;if(!v)throw Error(m);},same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const snapshot=o=>JSON.stringify(o.diagnosticSnapshot()),diag=o=>JSON.stringify(o.diagnostics());
  const colors=p=>{const set=new Set();for(let i=0;i<p.length;i+=4)set.add(p[i]*16777216+p[i+1]*65536+p[i+2]*256+p[i+3]);return set.size;};
  for(const name of ['generate','capturePaused','applyConfiguration','beginRecording','nextRecordingFrame','finishRecording'])check(typeof SourcePerlinSession.prototype[name]==='function','Missing runtime API '+name);
  const live=new Set(),contexts=new Set(),restore=[],siblingEvents=[];let actor='idle';
  for(const kind of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const op of ['create','delete']){const name=op+kind,original=WebGL2RenderingContext.prototype[name];restore.push(()=>WebGL2RenderingContext.prototype[name]=original);WebGL2RenderingContext.prototype[name]=function(...args){contexts.add(this);const result=original.apply(this,args);if(op==='create'&&result)live.add(result);if(op==='delete')live.delete(args[0]);return result;};}
  const sibling=SourcePerlinCpuTarget.prototype.createSibling;restore.push(()=>SourcePerlinCpuTarget.prototype.createSibling=sibling);SourcePerlinCpuTarget.prototype.createSibling=function(options){const target=sibling.call(this,options);siblingEvents.push({actor,target,width:target.width,height:target.height,samples:options.samples});return target;};
  const own=fn=>{const was=actor;actor='session';try{return fn();}finally{actor=was;}},ref=fn=>{const was=actor;actor='reference';try{return fn();}finally{actor=was;}};
  const makeScene=(style='PARTICLES',accumulation=false,backend='cpu')=>{const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Retained '+style+'/'+accumulation+'/'+backend,settings:{render_mode:backend.toUpperCase(),seed:'1771842692935',particle_count:96,step_size:1,curve_count:24,curve_length:24,field_cell_size:32,line_weight:8,dot_size:10,cpu_render_style:style},palette:['#ffff6050','#ff60d0ff','#ffffdd80'],timeline:[{type:'wait',duration:1}]})).scene;scene.timeline.fps=8;scene.perlinSource.display.accumulation=accumulation;scene.perlinSource.display.accumulationFadeAlpha=24;return scene;};
  const primary=scene=>({time:.5,quality:'preview',width:256,height:192,sourcePerlinViewport:{width:256,height:192,pixelDensity:1},sourceViewport:{logicalWidth:256,logicalHeight:192,referenceLogicalHeight:192,target:'primary',projectionPass:scene.settings.sourceCameraProjection}});
  const exporting=(context,width=192,height=128)=>({...context,quality:'export',width,height,sourceViewport:{...context.sourceViewport,logicalWidth:width,logicalHeight:height,target:'offscreen'}});
  // Components are composed here without calling any Session method. Recording
  // retires model/flow/curve state while primary and export attachments survive.
  function reference(initial,context){
   const view=context.sourcePerlinViewport,bg=scene=>sourcePerlinBackgroundRgba(sourcePerlinCpuConfiguration(scene).display.backgroundColor,false,0);
   const target=SourcePerlinCpuTarget.createSmoothed({width:view.width,height:view.height,density:view.pixelDensity,initialColor:bg(initial)},8);
   let scene,config,flow,model,timeline,backend,offscreen,destination=target,kind='primary',lastFrame;
   const display=(out,targetKind,final=true)=>{if(backend==='gpu'){const facts=model.gpuDisplayFacts(),gpu=scene.perlinSource.gpu,channel=flow.channel(Math.max(0,Math.min(5,gpu.textureStyle)),sourcePerlinFlowTextureSize(out.physicalWidth,out.physicalHeight));if(final)out.drawGpu({...gpu.uniforms,...facts,width:out.physicalWidth,height:out.physicalHeight},channel,undefined,flow.diagnostics().retainedBytes);}else if(final||config.display.accumulation||config.cpuStyle==='field-curves')model.draw({target:out,kind:targetKind,sourcePixelDensity:view.pixelDensity});};
   function rebuild(input,fps=input.timeline.fps){target.releaseSceneGpuBindings();offscreen?.releaseSceneGpuBindings();timeline?.reset();model?.dispose();flow?.dispose();scene=structuredClone(input);scene.timeline.fps=fps;config=sourcePerlinCpuConfiguration(scene);backend=scene.perlinSource.backend;flow=new SourcePerlinFlowResources({seed:config.seed});model=new SourcePerlinCpuModel({config,sourceWidth:view.width,sourceHeight:view.height,curveCacheSamples:4,backend,noise:flow.noise});timeline=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(scene),scene.timeline.tracks,fps,{particleActions:'perlin',createParticles:()=>({bind:()=>{throw Error('Unexpected tracking');},update:f=>model.update(f.time,f.deltaTime),displayFrame:(_i,final)=>display(destination,kind,final),setShowTrails:v=>model.setShowTrails(v),beginPerlinParameterActions:a=>model.beginPerlinParameterActions(a),interpolatePerlinParameterActions:(e,f,dt)=>model.interpolatePerlinParameterActions(e,f,dt),beginGradientActions:a=>model.beginGradientActions(a),interpolateGradientActions:(e,f)=>model.interpolateGradientActions(e,f)})});}
   function ensureExport(width,height){const w=Math.round(width/view.pixelDensity),h=Math.round(height/view.pixelDensity);if(!offscreen||offscreen.width!==w||offscreen.height!==h){offscreen?.dispose();offscreen=target.createSibling({width:w,height:h,density:view.pixelDensity,samples:0,initialColor:bg(scene)});}}
   rebuild(initial);
   return{
    generate(time,nextBackend=backend){const switched=backend!==nextBackend;if(switched){backend=nextBackend;model.setBackend(backend);}destination=target;kind='primary';const before=target.diagnostics().draws;lastFrame=timeline.evaluate(time);if(switched&&before===target.diagnostics().draws)display(target,'primary');return target.readPixels();},
    capture(w,h){ensureExport(w,h);display(offscreen,'offscreen');const capture=offscreen.readPixels();display(target,'primary');return{capture,preview:target.readPixels()};},
    begin(applied,w,h,fps){rebuild(applied,fps);ensureExport(w,h);destination=offscreen;kind='offscreen';lastFrame=timeline.evaluate(0);return offscreen.readPixels();},
    next(index){lastFrame=timeline.evaluate(index/scene.timeline.fps);return offscreen.readPixels();},
    finish(){destination=target;kind='primary';},
    primary(){display(target,'primary');return target.readPixels();},
    diagnosticSnapshot(){return model.diagnosticSnapshot();},
    diagnostics(){return{model:model.diagnostics(),target:target.diagnostics(),exportTarget:offscreen?.diagnostics(),flow:flow.diagnostics(),frame:lastFrame};},
    dispose(){timeline?.reset();model?.dispose();offscreen?.dispose();target.dispose();flow?.dispose();},
   };
  }
  const rows=[],failures=[];window.__retainedProgress={rows,failures};
  const rejectUnchanged=(owner,run,label)=>{const before=diag(owner),state=snapshot(owner);let error;try{own(run);}catch(e){error=e;}check(error instanceof Error,'Accepted '+label);check(diag(owner)===before&&snapshot(owner)===state,'Rejected '+label+' mutated recording');return String(error.message);};
  async function pixels(actual,wanted,label){check(actual.type==='raster'&&same(actual.pixels,wanted),'Reference pixels differ: '+label);return{sha256:await digest(actual.pixels),distinctColors:colors(actual.pixels),frame:actual.sourcePerlinFrame};}
  async function capture(owner,expected,scene,context,w,h,label){const actual=own(()=>owner.capturePaused(scene,exporting(context,w,h))),wanted=ref(()=>expected.capture(w,h));return{capture:await pixels(actual.capture,wanted.capture,label+' capture'),preview:await pixels(actual.preview,wanted.preview,label+' preview')};}
  try{
   const matrix=[['PARTICLES',false,'cpu'],['PARTICLES',true,'cpu'],['FIELD_CURVES',false,'cpu'],['FIELD_CURVES',true,'cpu'],['PARTICLES',false,'gpu']];
   for(const [style,accumulation,appliedBackend]of matrix){
    const applied=makeScene(style,accumulation,appliedBackend),context=primary(applied),owner=new SourcePerlinSession(),expected=ref(()=>reference(applied,context));
    const row={style,accumulation,appliedBackend,cycles:[]};rows.push(row);
    try{
     let scene=structuredClone(applied),currentContext=structuredClone(context);
     await pixels(own(()=>owner.generate(scene,currentContext)),ref(()=>expected.generate(currentContext.time,appliedBackend)),'initial');
     // Hot flag changes are deliberately excluded from the applied snapshot.
     const hot=appliedBackend==='cpu'?'gpu':'cpu';scene.perlinSource.backend=hot;
     await pixels(own(()=>owner.generate(scene,currentContext)),ref(()=>expected.generate(currentContext.time,hot)),'hot switch');
     row.before=await capture(owner,expected,scene,currentContext,192,128,'before recording');
     let oldHandle;
     for(const [cycle,width,height,cancel]of[[0,192,128,false],[1,192,128,true],[2,208,144,false]]){
      const before=owner.diagnostics(),stateBefore=snapshot(owner),siblingsBefore=siblingEvents.length,contextsBefore=contexts.size,oldExport=siblingEvents.findLast(e=>e.actor==='session'&&e.samples===0)?.target;
      const started=own(()=>owner.beginRecording(scene,currentContext,{width,height,simulationFps:4})),want=ref(()=>expected.begin(applied,width,height,4));
      check(started.handle&&typeof started.handle==='object','recording handle missing');check(started.scene.perlinSource.backend===appliedBackend,'recording did not restore applied backend');check(started.scene.timeline.fps===4,'recording did not select simulation FPS');
      check(owner.diagnostics().constructions===before.constructions+1,'recording did not rebuild exactly one model');check(owner.diagnostics().target.draws===before.target.draws,'begin drew primary');check(contexts.size===contextsBefore,'recording allocated another GL context');
      const created=siblingEvents.slice(siblingsBefore).filter(e=>e.actor==='session'&&e.width===width&&e.height===height&&e.samples===0);
      check(created.length===(cycle===2?1:0),'wrong export attachment count '+style+'/'+accumulation+'/'+cycle+': '+created.length);
      if(cycle===2){let released=false;try{oldExport.diagnostics();}catch{released=true;}check(released,'resize retained old export attachment');}
      if(cycle<2)check(siblingEvents.findLast(e=>e.actor==='session'&&e.samples===0)?.target===oldExport,'same-size recording changed export owner');
      const warmup=await pixels(started.warmup,want,'warmup '+cycle);check(started.warmup.sourcePerlinFrame.frameIndex===0&&started.warmup.sourcePerlinFrame.updates===1,'warmup was missing or repeated');
      if(style==='FIELD_CURVES')check(owner.diagnostics().model.geometryBuilds===1,'recording did not rebuild curve geometry');
      const rejections={};
      for(const [label,fn]of[['generate',()=>owner.generate(scene,currentContext)],['capture',()=>owner.capturePaused(scene,exporting(currentContext,width,height))],['second begin',()=>owner.beginRecording(scene,currentContext,{width,height,simulationFps:4})],['apply',()=>owner.applyConfiguration(scene)],['foreign next',()=>owner.nextRecordingFrame({},1)],['skipped frame',()=>owner.nextRecordingFrame(started.handle,2)],['foreign finish',()=>owner.finishRecording({})]])rejections[label]=rejectUnchanged(owner,fn,label);
      if(oldHandle){rejections.staleHandle=rejectUnchanged(owner,()=>owner.nextRecordingFrame(oldHandle,1),'stale handle');rejections.staleFinish=rejectUnchanged(owner,()=>owner.finishRecording(oldHandle),'stale finish');}
      started.scene.perlinSource.backend=appliedBackend==='cpu'?'gpu':'cpu';started.context.time=999; // Returned data cannot mutate the live lease.
      const frames=[];for(let index=1;index<=(cancel?1:3);index++){const actual=own(()=>owner.nextRecordingFrame(started.handle,index));frames.push(await pixels(actual,ref(()=>expected.next(index)),'encoded '+index));check(actual.sourcePerlinFrame.frameIndex===index&&actual.sourcePerlinFrame.queueComplete===(index===3),'wrong actual frame completion');check(owner.diagnostics().target.draws===before.target.draws,'encoded frame drew primary');rejections['duplicate '+index]=rejectUnchanged(owner,()=>owner.nextRecordingFrame(started.handle,index),'duplicate frame');}
      if(!cancel)rejections.afterComplete=rejectUnchanged(owner,()=>owner.nextRecordingFrame(started.handle,4),'frame beyond queue end');
      const beforeFinish=diag(owner),finishState=snapshot(owner),done=own(()=>owner.finishRecording(started.handle));ref(()=>expected.finish());
      check(snapshot(owner)===finishState,'finish advanced/replaced model');check(owner.diagnostics().target.draws===before.target.draws,'finish drew primary');check(owner.diagnostics().constructions===before.constructions+1,'finish restored old model');
      scene=done.scene;currentContext=done.context;check(scene.perlinSource.backend===appliedBackend&&scene.timeline.fps===4,'finish returned wrong effective scene');check(currentContext.time===(cancel?.25:.75),'finish context not at actual recording frame');
      const current=own(()=>owner.generate(scene,currentContext));await pixels(current,ref(()=>expected.primary()),'resumed primary');check(snapshot(owner)===finishState,'resuming primary advanced/recreated model');check(owner.diagnostics().target.draws===before.target.draws+1,'resume did not draw primary exactly once');
      check(snapshot(owner)===JSON.stringify(expected.diagnosticSnapshot()),'new model differs from independent reset state');
      const after=await capture(owner,expected,scene,currentContext,width,height,'after recording '+cycle);
      row.cycles.push({cycle,width,height,cancel,warmup,frames,after,rejections,context:currentContext,clock:started.clock,modelBeforeRecording:JSON.parse(stateBefore),modelAfterRecording:JSON.parse(finishState),beforeFinish:JSON.parse(beforeFinish),afterDiagnostics:owner.diagnostics()});oldHandle=started.handle;
     }
    if(accumulation)check(row.cycles[0].warmup.sha256!==row.cycles[1].warmup.sha256,'accumulating repeated recording lost export history');
    }finally{owner.reset();ref(()=>expected.dispose());check(live.size===0,'matrix leaked '+live.size+' GL resources');}
   }
   // Applied configuration has a distinct lifetime from runtime bindings.
   for(const mode of ['resize-and-rewind','nonbackend-autoapply','explicit-backend-apply-clone']){
    const original=makeScene(),owner=new SourcePerlinSession();let scene=structuredClone(original),context=primary(scene),expectedBackend='cpu',expectedSeed=original.perlinSource.seed;
    try{
     own(()=>owner.generate(scene,context));scene.perlinSource.backend='gpu';own(()=>owner.generate(scene,context));
     if(mode==='resize-and-rewind'){
      context={...context,width:288,height:208,sourcePerlinViewport:{width:288,height:208,pixelDensity:1},sourceViewport:{...context.sourceViewport,logicalWidth:288,logicalHeight:208,referenceLogicalHeight:208}};
      own(()=>owner.generate(scene,context));context={...context,time:.25};own(()=>owner.generate(scene,context));
     }else if(mode==='nonbackend-autoapply'){
      scene.perlinSource.seed='88';expectedSeed='88';expectedBackend='gpu';own(()=>owner.generate(scene,context));scene.perlinSource.backend='cpu';own(()=>owner.generate(scene,context));
     }else{
      expectedBackend='gpu';owner.applyConfiguration(scene);check(!owner.matchesCompletedPrimary(scene,context),'apply kept stale primary eligibility');
      scene.perlinSource.backend='cpu'; // Mutating the caller after apply is only a hot flag, not another apply.
      own(()=>owner.generate(scene,context));
     }
     check(owner.diagnostics().appliedBackend===expectedBackend,'wrong applied owner after '+mode);scene.name='Live metadata '+mode;
     const started=own(()=>owner.beginRecording(scene,context,{width:192,height:128,simulationFps:4}));
     check(started.scene.perlinSource.backend===expectedBackend&&started.scene.perlinSource.seed===expectedSeed,'recording restored wrong snapshot after '+mode);check(started.scene.name===scene.name,'recording reverted unrelated metadata');owner.finishRecording(started.handle);
     failures.push({kind:mode,appliedBackend:expectedBackend,seed:expectedSeed,passed:true});
    }finally{owner.reset();check(live.size===0,mode+' leaked');}
   }
   for(const mode of ['no-primary','stale-time','primary-width-mismatch','primary-width-nan','invalid-size','invalid-fps','cancelled-before-begin']){
    const scene=makeScene(),context=primary(scene),owner=new SourcePerlinSession();try{
     if(mode!=='no-primary')own(()=>owner.generate(scene,context));
     const input={...context},options={width:192,height:128,simulationFps:4};
     if(mode==='stale-time')input.time=.25;if(mode==='primary-width-mismatch')input.width++;if(mode==='primary-width-nan')input.width=NaN;if(mode==='invalid-size')options.width=0;if(mode==='invalid-fps')options.simulationFps=0;if(mode==='cancelled-before-begin')input.isCancelled=()=>true;
     const error=rejectUnchanged(owner,()=>owner.beginRecording(scene,input,options),mode);
     failures.push({kind:mode,error,preservedPrimary:mode==='no-primary'?undefined:owner.matchesCompletedPrimary(scene,context)});
     if(mode!=='no-primary')check(owner.matchesCompletedPrimary(scene,context),'preflight lost primary '+mode);
    }finally{owner.reset();check(live.size===0,mode+' leaked');}
   }
   {
    const scene=makeScene(),owner=new SourcePerlinSession();let cancelled=false;const context={...primary(scene),isCancelled:()=>cancelled};
    try{
     own(()=>owner.generate(scene,context));const started=own(()=>owner.beginRecording(scene,context,{width:192,height:128,simulationFps:4}));cancelled=true;
     const error=rejectUnchanged(owner,()=>owner.nextRecordingFrame(started.handle,1),'cancel before next frame');
     check(owner.diagnostics().recording.nextFrame===1,'cancel advanced lease cursor');const before=owner.diagnostics(),state=snapshot(owner),done=owner.finishRecording(started.handle);
     check(done.context.time===0&&snapshot(owner)===state&&owner.diagnostics().target.draws===before.target.draws,'cancel finish moved/drew/restored state');
     cancelled=false;own(()=>owner.generate(done.scene,done.context));check(snapshot(owner)===state&&owner.diagnostics().target.draws===before.target.draws+1,'cancelled lease did not resume new model');
     failures.push({kind:'cancel-before-next-frame',error,framePreserved:true,finishAllowed:true,resumedNewModel:true});
    }finally{owner.reset();check(live.size===0,'cancel-before-next leaked');}
   }
   // Cleanup fault at an owned export attachment boundary; both old/new
   // attachments must remain reachable until the cleanup ticket succeeds.
   for(const faults of [1,2]){
    const scene=makeScene(),context=primary(scene),owner=new SourcePerlinSession(),dispose=SourcePerlinCpuTarget.prototype.dispose;let failed,attempts=0,caught;
    try{
     own(()=>owner.generate(scene,context));own(()=>owner.capturePaused(scene,exporting(context,192,128)));
     SourcePerlinCpuTarget.prototype.dispose=function(){if(!failed&&this.width===192&&this.height===128)failed=this;if(this===failed&&++attempts<=faults)throw Error('Injected retained export disposal failure');return dispose.call(this);};
     try{own(()=>owner.beginRecording(scene,context,{width:208,height:144,simulationFps:4}));}catch(error){caught=error;}
     check(caught instanceof Error,'recording resize disposal failure not reported');
     if(faults===2){check(caught.cleanupPending===true&&typeof caught.retryCleanup==='function','cleanup owner not retained');check(live.size>0,'fault did not retain resources');caught.retryCleanup();check(caught.cleanupPending===false,'cleanup ticket did not retire');}
     check(attempts===faults+1,'failed attachment cleanup retry count');check(live.size===0,'recording begin cleanup orphaned resources');
     // A retired error must not erase a later generation.
     own(()=>owner.generate(scene,context));const stable=diag(owner);caught.retryCleanup?.();check(diag(owner)===stable,'retired cleanup error reset fresh generation');
     failures.push({kind:'resize-cleanup-'+faults,error:String(caught.message),attempts,resourcesAfterRetry:0});
    }finally{SourcePerlinCpuTarget.prototype.dispose=dispose;owner.reset();check(live.size===0,'cleanup fault case leaked');}
   }
   return{rows,failures,assertions,contexts:contexts.size,retainedResources:live.size};
  }finally{restore.reverse().forEach(f=>f());}
 });
 if(errors.length)throw Error('Page errors: '+errors.join('; '));report.status='passed';
}catch(error){report.partial=await page?.evaluate(()=>window.__retainedProgress).catch(()=>undefined);report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 report.sourceAfter=await sources();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 report.pageErrors=errors;report.elapsedMs=performance.now()-started;const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup=cleanup.map((r,i)=>({owner:['browser','vite'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));if(cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(artifact('report.md'),['# Perlin retained recording runtime verification','',`Status: **${report.status}**; source stable: **${report.sourceStable}**; elapsed ${(report.elapsedMs/1000).toFixed(1)} s.`,'',report.scope,'',`Cases: ${report.result?.rows?.length??0}; additional lifecycle cases: ${report.result?.failures?.length??0}; assertions: ${report.result?.assertions??0}.`,...(report.error?['',report.error]:[]),'',...report.limits.map(s=>'- '+s),'',`Full evidence: ${artifact('report.json')}`,''].join('\n'));console.log(JSON.stringify({status:report.status,cases:report.result?.rows?.length,assertions:report.result?.assertions,sourceStable:report.sourceStable,error:report.error,report:artifact('report.md')}));
}
