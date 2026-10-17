import {chromium} from '../node_modules/playwright/index.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:5177/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Attractor tracking verification</title>'}));await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const {createScene,parseScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{Generator}=await import('/src/engine/client.ts'),{generateScene,TemporalGenerationSession}=await import('/src/engine/temporal.ts');
  const check=(ok,m)=>{if(!ok)throw Error(m);},close=(a,b)=>check(Math.abs(a-b)<2e-6,`${a} != ${b}`),hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const action=(method,args={},start=0,duration=0,easing='linear')=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',start,duration,from:0,to:0,easing,enabled:true,pingPong:false,actions:[{id:crypto.randomUUID(),method,args}]});
  const make=count=>{const s=createScene(definition('attractor'));s.equations={dx:'1',dy:'0',dz:'0'};s.parameters={};Object.assign(s.settings,{simulationMode:'continuous',attractorBackend:'gpu',particleCount:count,burnIn:0,staggerMin:0,staggerMax:0,simulationFps:8,subSteps:1,dt:.125,initialX:0,initialY:0,initialZ:0,initialSpread:0,variableTimeStep:false,showTrails:false,integrator:'euler',scale:1});s.timeline.duration=10;s.timeline.tracks=[action('track',{index:count-1})];return s;};
  const ctx={width:32,height:24,quality:'export'},rows=[],worker=new Generator();
  try{
   const scene=make(100000);scene.timeline.tracks.push(action('stopTracking',{},.31),action('track',{index:99998},.8,.4,'there-and-back'));
   for(const time of [0,.2,.5,1,1.31,2,.1,1.31]){
    const start=performance.now(),out=await worker.generate(scene,{...ctx,time}),warmMs=performance.now()-start,coldWorker=new Generator();
    try{const cold=await coldWorker.generate(parseScene(JSON.stringify(scene)),{...ctx,time});check(out.backend==='webgl2'&&cold.backend==='webgl2','real GPU required');check(out.stats.generated===100000,'particle count changed');check(JSON.stringify(out.cameraFrame)===JSON.stringify(cold.cameraFrame),'cold/warm camera differs');check(await hash(out.positions)===await hash(cold.positions),'cold/warm particle trajectory differs');
     if(time>=1.2)close(out.cameraFrame.camera.target[0],time);if(time>=.31&&time<.8)close(out.cameraFrame.camera.target[0],.31);
     rows.push({time,warmMs,count:out.stats.generated,backend:out.backend,target:out.cameraFrame.camera.target,coldWarmExact:true,positionHash:await hash(out.positions),samples:out.stats.samples});
    }finally{coldWorker.dispose();}
   }
   const baseline=make(100000),owner=new TemporalGenerationSession();let contexts=0,drawCalls=0,drawnVertices=0,smallSlotReads=0;
   // Instrument native GL calls rather than Vite module instances, whose HMR
   // query identities may differ between dependency and explicit imports.
   const getContext=OffscreenCanvas.prototype.getContext,draw=WebGL2RenderingContext.prototype.drawArrays,read=WebGL2RenderingContext.prototype.getBufferSubData;
   OffscreenCanvas.prototype.getContext=function(type,...args){if(type==='webgl2')contexts++;return getContext.call(this,type,...args);};WebGL2RenderingContext.prototype.drawArrays=function(mode,first,count){drawCalls++;drawnVertices+=count;return draw.call(this,mode,first,count);};WebGL2RenderingContext.prototype.getBufferSubData=function(target,offset,output,start,length){if(length===4)smallSlotReads++;return read.call(this,target,offset,output,start,length);};
   let onePass;
   try{baseline.timeline.tracks.push(action('stopTracking',{},.31));const out=generateScene(baseline,{...ctx,time:2},owner);check(out.backend==='webgl2'&&contexts===1&&drawCalls===34&&drawnVertices===1700000,`tracking GPU work differs from one 16-frame trajectory plus one scratch fraction: ${JSON.stringify({contexts,drawCalls,drawnVertices,backend:out.backend})}`);check(smallSlotReads===2,`tracking read unrequested particle slots: ${smallSlotReads}`);close(out.cameraFrame.camera.target[0],.31);onePass={contexts,drawCalls,drawnVertices,fullFrameSteps:16,historicalScratchSteps:1,smallSlotReads,stats:out.stats,diagnostics:owner.diagnostics().attractor};}
   finally{OffscreenCanvas.prototype.getContext=getContext;WebGL2RenderingContext.prototype.drawArrays=draw;WebGL2RenderingContext.prototype.getBufferSubData=read;owner.reset();}
   check(owner.diagnostics().retainedBytes===0,'GPU tracking reset retained resources');
   const large=make(2000000),started=performance.now(),big=await worker.generate(large,{...ctx,time:.125});check(big.backend==='webgl2'&&big.stats.generated===2000000,'2M tracking truncated');check(big.particleIds[1999999]===1999999,'large stable id missing');check(big.cameraFrame.camera.target[0]===big.positions[1999999*3],'large target differs from actual head');const largeResult={count:big.stats.generated,trackedId:1999999,target:big.cameraFrame.camera.target,elapsedMs:performance.now()-started};
   const invalid=make(8);invalid.timeline.tracks.push(action('track',{index:999},.2));const invalidOut=await worker.generate(invalid,{...ctx,time:1});close(invalidOut.cameraFrame.camera.target[0],1);check(invalidOut.warnings.some(x=>x.includes('越界')),'missing out-of-range warning');
   const dead=make(8);dead.equations.dx='sqrt(-1)';const deadOut=await worker.generate(dead,{...ctx,time:1});check(deadOut.stats.generated===0&&deadOut.warnings.some(x=>x.includes('死亡或位置无效')),'dead target not diagnosed');check(JSON.stringify(deadOut.cameraFrame.camera.target)===JSON.stringify(dead.camera.target),'dead target invented fallback coordinates');
   const cpu=make(8);cpu.settings.attractorBackend='cpu';cpu.timeline.tracks.push(action('stopTracking',{},.31));const cpuOut=await worker.generate(cpu,{...ctx,time:1}),gpu={...cpu,settings:{...cpu.settings,attractorBackend:'gpu'}},gpuOut=await worker.generate(gpu,{...ctx,time:1});close(cpuOut.cameraFrame.camera.target[0],gpuOut.cameraFrame.camera.target[0]);
   const cancelScene=make(100000);cancelScene.settings.subSteps=8;const pending=worker.generate(cancelScene,{...ctx,time:100}).then(()=>({resolved:true}),e=>({name:e.name}));await new Promise(r=>setTimeout(r,30));worker.cancel();check((await pending).name==='AbortError','tracking worker cancellation failed');const recovered=await worker.generate(make(8),{...ctx,time:.25});check(recovered.backend==='webgl2','tracking recovery backend');close(recovered.cameraFrame.camera.target[0],.25);
   return{status:'passed',at:new Date().toISOString(),rows,onePass,large:largeResult,unavailableTargets:'out-of-range and dead targets are explicit no-ops; no neighbor or live prior-frame substitution',linearCpuGpuTargetDifference:Math.abs(cpuOut.cameraFrame.camera.target[0]-gpuOut.cameraFrame.camera.target[0]),cancelRecovery:true,limits:['Original application was not executed; source array-index semantics are static evidence.','CPU double and GPU float32 are different numeric backends; only linear oracles use a cross-backend tolerance here.','Timings are wall-clock diagnostics, not an isolated performance improvement claim; CPU/process-family RSS/VRAM and agent tokens were not measured.']};
  }finally{worker.dispose();}
 });
 if(errors.length)throw Error(errors.join('\n'));report.pageErrors=errors;report.sourceSnapshots=[];
 for(const file of ['src/engine/timeline.ts','src/engine/particleCamera.ts','src/engine/temporal.ts','src/engine/sceneCamera.ts','src/engine/attractorGpu.ts','src/scenes/attractorParticles.ts','src/components/Viewport.tsx','src/components/ExportDialog.tsx','scripts/verify-attractor-tracking.mjs'])report.sourceSnapshots.push({path:'studio/'+file,sha256:createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')});
 await writeFile(new URL('../.cache/attractor-tracking-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,seeks:report.rows.length,onePass:report.onePass,large:report.large,cancelRecovery:report.cancelRecovery,pageErrors:errors}));
}finally{await browser.close();}
