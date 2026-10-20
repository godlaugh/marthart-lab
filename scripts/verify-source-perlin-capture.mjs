/** Real browser/WebGL paused Perlin capture lifecycle. The expected images use
 * a separately orchestrated Model/Timeline/Flow/Target composition, never the
 * capture method under test. Shared local arithmetic/shaders are not a native
 * JVM/JOGL oracle. Worker transport, public UI and file encoding are out of scope. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createTcpServer} from 'node:net';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const script='scripts/verify-source-perlin-capture.mjs',path='.cache/v2-source-perlin-capture.json',started=performance.now();
const hash=x=>createHash('sha256').update(x).digest('hex');
const sources=async()=>{const entries=await readdir('src',{recursive:true,withFileTypes:true}),paths=entries.filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`);paths.push(script);paths.sort();return Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));};
const report={at:new Date().toISOString(),scope:'Real Chromium WebGL2 retained Perlin model and independent offscreen capture history, independently orchestrated local component reference.',nativeParity:false,limits:['Reference shares verified local model, timeline and shaders; this is not independent native image parity.','No original JVM/JOGL capture, Worker transport, App controls, PNG encoding or filesystem export is tested.']};
let server,browser;const errors=[];
try{
 const before=await sources(),port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/capture-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Perlin capture verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'capture-fixture');
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
  let assertions=0;const check=(v,m)=>{assertions++;if(!v)throw Error(m);};
  check(typeof SourcePerlinSession.prototype.capturePaused==='function','Paused capture API is not installed');
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const snapshot=owner=>JSON.stringify(owner.diagnosticSnapshot());
  const colors=pixels=>{const result=new Set();for(let i=0;i<pixels.length;i+=4)result.add(pixels[i]*16777216+pixels[i+1]*65536+pixels[i+2]*256+pixels[i+3]);return result.size;};
  const live=new Set(),contexts=[],restore=[];
  for(const kind of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const operation of ['create','delete']){
   const name=operation+kind,original=WebGL2RenderingContext.prototype[name];restore.push(()=>WebGL2RenderingContext.prototype[name]=original);
   WebGL2RenderingContext.prototype[name]=function(...args){if(!contexts.includes(this))contexts.push(this);const result=original.apply(this,args);if(operation==='create'&&result)live.add(result);if(operation==='delete')live.delete(args[0]);return result;};
  }
  const makeScene=(style='PARTICLES',accumulation=false)=>{
   const raw={config_version:'1.0.0',type:'PERLIN',name:'Paused capture '+style+'/'+accumulation,settings:{render_mode:'CPU',seed:'1771842692935',particle_count:96,step_size:.75,curve_count:24,curve_length:24,field_cell_size:40,line_weight:12,dot_size:12,cpu_render_style:style},palette:['#ffff6050','#ff60d0ff','#ffffdd80'],timeline:[{type:'wait',duration:3}]};
   const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.timeline.fps=10;scene.perlinSource.display.accumulation=accumulation;scene.perlinSource.display.accumulationFadeAlpha=24;return scene;
  };
  const primary=scene=>({time:.8,quality:'preview',width:640,height:480,sourcePerlinViewport:{width:320,height:240,pixelDensity:2},sourceViewport:{logicalWidth:320,logicalHeight:240,referenceLogicalHeight:240,target:'primary',projectionPass:scene.settings.sourceCameraProjection}});
  const exporting=(scene,time=1.1,width=192,height=144)=>({...primary(scene),time,quality:'export',width,height,sourceViewport:{...primary(scene).sourceViewport,logicalWidth:width,logicalHeight:height,target:'offscreen'}});
  /** An explicit assembly of production component contracts, with distinct
   * model, targets and flow ownership. It never calls Session.generate/capture. */
  function reference(scene,context){
   const config=sourcePerlinCpuConfiguration(scene),view=context.sourcePerlinViewport,flow=new SourcePerlinFlowResources({seed:config.seed});
   const model=new SourcePerlinCpuModel({config,sourceWidth:view.width,sourceHeight:view.height,curveCacheSamples:4,noise:flow.noise}),background=sourcePerlinBackgroundRgba(config.display.backgroundColor,false,0);
   const target=SourcePerlinCpuTarget.createSmoothed({width:view.width,height:view.height,density:view.pixelDensity,initialColor:background},8);
   let offscreen,backend='cpu',currentTime;
   const display=(out,kind,final=true)=>{
    if(backend==='gpu'){
     const facts=model.gpuDisplayFacts(),gpu=scene.perlinSource.gpu,channel=flow.channel(Math.max(0,Math.min(5,gpu.textureStyle)),sourcePerlinFlowTextureSize(out.physicalWidth,out.physicalHeight));
     if(final)out.drawGpu({...gpu.uniforms,...facts,width:out.physicalWidth,height:out.physicalHeight},channel,undefined,flow.diagnostics().retainedBytes);
    }else if(final||config.display.accumulation||config.cpuStyle==='field-curves')model.draw({target:out,kind,sourcePixelDensity:view.pixelDensity});
   };
   const timeline=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(scene),scene.timeline.tracks,scene.timeline.fps,{particleActions:'perlin',createParticles:()=>({bind:()=>{throw Error('Unexpected tracking');},update:f=>model.update(f.time,f.deltaTime),displayFrame:(_index,final)=>display(target,'primary',final),setShowTrails:v=>model.setShowTrails(v),beginPerlinParameterActions:a=>model.beginPerlinParameterActions(a),interpolatePerlinParameterActions:(e,f,dt)=>model.interpolatePerlinParameterActions(e,f,dt),beginGradientActions:a=>model.beginGradientActions(a),interpolateGradientActions:(e,f)=>model.interpolateGradientActions(e,f)})});
   return{
    generate(time,next){const switched=backend!==next;if(switched){backend=next;model.setBackend(next);}const before=target.diagnostics().draws;timeline.evaluate(time);if(switched&&target.diagnostics().draws===before)display(target,'primary');currentTime=time;return target.readPixels();},
    capture(width,height){check(currentTime!==undefined,'Reference was not warmed');const w=Math.round(width/view.pixelDensity),h=Math.round(height/view.pixelDensity);if(!offscreen||offscreen.width!==w||offscreen.height!==h){offscreen?.dispose();offscreen=target.createSibling({width:w,height:h,density:view.pixelDensity,samples:0,initialColor:background});}display(offscreen,'offscreen');const capture=offscreen.readPixels();display(target,'primary');return{capture,preview:target.readPixels()};},
    dispose(){model.dispose();offscreen?.dispose();target.dispose();flow.dispose();timeline.reset();},
   };
  }
  const rows=[],failures=[];
  try{
   for(const style of ['PARTICLES','FIELD_CURVES'])for(const accumulation of [false,true]){
    const scene=makeScene(style,accumulation),context=primary(scene),owner=new SourcePerlinSession(),expected=reference(scene,context);
    try{
     for(const [time,backend]of[[.8,'cpu'],[.8,'gpu'],[1.1,'gpu'],[1.1,'cpu']]){
      scene.perlinSource.backend=backend;const actual=owner.generate(scene,{...context,time}),want=expected.generate(time,backend);check(same(actual.pixels,want),'Reference warm sequence differs '+style+'/'+accumulation+'/'+backend+'/'+time);
     }
     const before=owner.diagnostics(),state=snapshot(owner),contextCount=contexts.length;
     check(owner.matchesCompletedPrimary(scene,{...context,time:1.1}),'Completed primary not recognized');
     const captures=[];
     for(const [width,height]of[[192,144],[192,144],[207,151]]){
      const result=owner.capturePaused(scene,exporting(scene,1.1,width,height),{additionalBytes:1024}),want=expected.capture(width,height),after=owner.diagnostics();
      check(result.capture.type==='raster'&&result.preview.type==='raster','Capture did not return raster pair');
      check(result.capture.width===Math.round(width/2)*2&&result.capture.height===Math.round(height/2)*2&&result.preview.width===context.width&&result.preview.height===context.height,'Capture or preview dimensions changed');
      check(same(result.capture.pixels,want.capture),'Offscreen capture differs from independent assembly '+style+'/'+accumulation+'/'+width);
      check(same(result.preview.pixels,want.preview),'Primary redraw differs from independent assembly '+style+'/'+accumulation+'/'+width);
      check(colors(result.capture.pixels)>1&&colors(result.preview.pixels)>1,'Uniform/empty capture or primary pixels');
      check(snapshot(owner)===state,'Capture advanced retained CPU/gradient/parameter state');
      check(after.constructions===before.constructions&&after.model.updates===before.model.updates&&after.model.cpuUpdates===before.model.cpuUpdates,'Capture reconstructed model or advanced update');
      check(after.target.draws===before.target.draws+captures.length+1,'Capture did not redraw primary exactly once');
      check(contexts.length===contextCount,'Capture allocated a separate graphics context');
      check(result.capture.sourcePerlinFrame.samples===0,'Offscreen capture unexpectedly uses MSAA');
      captures.push({requestedWidth:width,requestedHeight:height,width:result.capture.width,height:result.capture.height,sha:await digest(result.capture.pixels),previewSha:await digest(result.preview.pixels),distinctColors:colors(result.capture.pixels),updates:after.model.updates,primaryDraws:after.target.draws});
     }
     if(!accumulation)check(captures[0].sha===captures[1].sha,'Nonaccumulation capture must clear previous output');
     if(accumulation&&style==='FIELD_CURVES')check(captures[0].sha!==captures[1].sha,'Repeated translucent curves must accumulate on retained offscreen pixels');
     // Opaque stationary particle heads on a black offscreen background are a
     // fixed point: equal pixels do not disprove retained accumulation history.
     rows.push({style,accumulation,captures,retainedState:true,reference:'separately assembled model/timeline/flow/targets',resizeStartsAtBackground:true,repeatedPixelsChanged:captures[0].sha!==captures[1].sha,primarySamples:before.target.samples});
    }finally{owner.reset();expected.dispose();check(!owner.diagnostics().target&&owner.diagnostics().constructions===0,'Session reset retained primary');check(live.size===0,'Case leaked '+live.size+' WebGL objects');}
   }
   // GPU capture crosses a texture-size bucket. Redrawing the small primary
   // rebuilds the original bucket, without ticking the shared model clock.
   {
    const scene=makeScene(),context=primary(scene),owner=new SourcePerlinSession(),expected=reference(scene,context);
    try{
     owner.generate(scene,context);expected.generate(context.time,'cpu');scene.perlinSource.backend='gpu';owner.generate(scene,context);expected.generate(context.time,'gpu');
     const before=owner.diagnostics(),state=snapshot(owner),result=owner.capturePaused(scene,exporting(scene,context.time,1080,64)),want=expected.capture(1080,64),after=owner.diagnostics();
     check(same(result.capture.pixels,want.capture)&&same(result.preview.pixels,want.preview),'GPU bucket capture differs from independent assembly');
     check(after.flow.builds===before.flow.builds+2&&after.flow.size===512,'Capture and restored primary did not rebuild their actual flow buckets');
     check(after.model.updates===before.model.updates&&snapshot(owner)===state,'GPU capture advanced shared model state');
     check(colors(result.capture.pixels)>1,'GPU capture is uniform');rows.push({style:'GPU',bucketCapture:1024,restoredBucket:512,flowBuildsBefore:before.flow.builds,flowBuildsAfter:after.flow.builds,captureSha:await digest(result.capture.pixels),previewSha:await digest(result.preview.pixels),retainedState:true});
    }finally{owner.reset();expected.dispose();check(live.size===0,'GPU capture leaked WebGL resources');}
   }
   for(const kind of ['no-primary','offscreen-only','stale-time','stale-scene','stale-backend','stale-viewport','stale-projection','mutated-context','invalid-size','wrong-target','invalid-extra','capacity','cancelled','cancelled-during-draw']){
    const scene=makeScene(),context=primary(scene),owner=new SourcePerlinSession();let caught;
    try{
     if(kind!=='no-primary')owner.generate(scene,kind==='offscreen-only'?exporting(scene,context.time):context);
     const requested=structuredClone(scene),input=exporting(scene,context.time),options={},before=JSON.stringify(owner.diagnostics()),state=snapshot(owner),completedContext=structuredClone(context);
     let cancelCalls=0;
     if(kind==='stale-time')input.time=1.8;
     if(kind==='stale-scene')requested.perlinSource.seed='77';
     if(kind==='stale-backend')requested.perlinSource.backend='gpu';
     if(kind==='stale-viewport')input.sourcePerlinViewport.width++;
     if(kind==='stale-projection')requested.settings.sourceCameraProjection='different';
     if(kind==='mutated-context'){context.sourceViewport.referenceLogicalHeight++;input.sourceViewport={...context.sourceViewport,target:'offscreen'};check(!owner.matchesCompletedPrimary(scene,context),'Mutated original context still matched primary');}
     if(kind==='invalid-size')input.width=0;
     if(kind==='wrong-target')input.sourceViewport.target='primary';
     if(kind==='invalid-extra')options.additionalBytes=-1;
     if(kind==='capacity')options.additionalBytes=256*1024*1024;
     if(kind==='cancelled')input.isCancelled=()=>true;
     if(kind==='cancelled-during-draw')input.isCancelled=()=>++cancelCalls>=3;
     try{owner.capturePaused(requested,input,options);}catch(error){caught=error;}
     check(caught instanceof Error,'Expected rejection for '+kind);
     if(kind==='cancelled-during-draw'){check(!owner.diagnostics().target&&live.size===0,'Drawing cancellation did not reset all resources');}
     else {check(JSON.stringify(owner.diagnostics())===before&&snapshot(owner)===state,'Preflight rejection mutated retained owner '+kind);if(kind!=='no-primary'&&kind!=='offscreen-only')check(owner.matchesCompletedPrimary(scene,completedContext),'Preflight rejection lost completed primary '+kind);}
     failures.push({kind,error:String(caught.message),code:caught.code??caught.name});
    }finally{owner.reset();check(live.size===0,'Rejected '+kind+' leaked WebGL resources');}
   }
   // Inject at the public target disposal boundary, before GL deletion. A
   // replacement target already exists: both owners must survive a cleanup
   // failure until the session's reset/retry retires them.
   for(const failuresToInject of [1,2]){
    const scene=makeScene(),context=primary(scene),owner=new SourcePerlinSession(),originalDispose=SourcePerlinCpuTarget.prototype.dispose;
    let failedTarget,attempts=0,caught;
    try{
     owner.generate(scene,context);owner.capturePaused(scene,exporting(scene,context.time));
     SourcePerlinCpuTarget.prototype.dispose=function(){
      if(!failedTarget&&this.width===96&&this.height===72)failedTarget=this;
      if(this===failedTarget&&++attempts<=failuresToInject)throw Error('Injected old export target release failure');
      return originalDispose.call(this);
     };
     try{owner.capturePaused(scene,exporting(scene,context.time,208,152));}catch(error){caught=error;}
     check(caught instanceof Error,'Resize release failure was not reported');
     check(!owner.matchesCompletedPrimary(scene,context),'Failed resize retained completed primary');
     if(failuresToInject===2){
      check(caught.cleanupPending===true&&typeof caught.retryCleanup==='function','Failed reset did not retain cleanup ownership');
      check(live.size>0,'Failure injection did not leave live targets for retry');
      caught.retryCleanup();check(caught.cleanupPending===false,'Cleanup retry ticket was not retired');
     }
     check(attempts===failuresToInject+1,'Old export target was not retried exactly until released');
     check(!owner.diagnostics().target&&!owner.diagnostics().exportTarget&&owner.diagnostics().constructions===0,'Resize failure reset retained a target');
     check(live.size===0,'Resize failure orphaned old or replacement target');
     failures.push({kind:'resize-disposal-'+failuresToInject+'-failures',error:String(caught.message),attempts,retainedResources:live.size});
    }finally{SourcePerlinCpuTarget.prototype.dispose=originalDispose;owner.reset();check(live.size===0,'Resize disposal case leaked resources');}
   }
   return{rows,failures,assertions,contexts:contexts.length,retainedResources:live.size};
  }finally{restore.reverse().forEach(f=>f());}
 });
 const after=await sources();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during paused capture verification');if(errors.length)throw Error('Page errors: '+errors.join('; '));
 report.status='passed';report.sourceHashes=after;
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.pageErrors=errors;report.elapsedMs=performance.now()-started;const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup=cleanup.map((r,i)=>({owner:['browser','vite'][i],status:r.status,error:r.status==='rejected'?String(r.reason):undefined}));if(cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.result?.rows?.length,failures:report.result?.failures?.length,assertions:report.result?.assertions,error:report.error,report:path}));}
