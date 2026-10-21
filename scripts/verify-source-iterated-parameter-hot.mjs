/** Actual GPU owner, Worker capability and queue controls. No native-window claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply new output directory');await mkdir(out);
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const p=e.parentPath+'/'+e.name;return[p,createHash('sha256').update(await readFile(p)).digest('hex')];})));
const report={status:'running',sourceBefore:await hashes(),nativeWindowExecuted:false};let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:18743,strictPort:false,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 report.cases=await page.evaluate(async()=>{
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{editSourceMapScene}=await import('/src/engine/sourceMapScene.ts'),{editSourceSymmetryConfiguration}=await import('/src/engine/sourceSymmetryConfig.ts'),{Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),F=Math.fround;
  const make=(family,newNames=false)=>(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Hot parameter GPU',parameters:{gain:.001,symmetry_degree:3},settings:{dimension:2,batch_size:4,burn_in_steps:2,iterations_per_frame:1,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0},palette:['#ffffff','#ffffff'],...(family==='map'?{equations:{x_next:'x+gain',y_next:'y',z_next:'0'}}:{equation:{glsl:newNames?'uniform float gain,delta;void calculate_next(in vec3 p,out vec3 n,out float m){float step=gain+delta+float({N})*0.03125;n=vec3(p.x+step,p.y+float({N_MINUS_2})*0.0078125,p.z);m=step;}':'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}),timeline:[]}),{sourceEntry:'runtime-config'}).scene;
  const context=s=>({time:0,width:48,height:32,quality:'preview',sourceViewport:ordinarySourceViewport(s,48,32,'primary',32),sourcePointPixelDensity:1,[s.kind==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:48,height:32},[s.kind==='map'?'mapLive':'symmetryLive']:{sessionId:'parameter-live',renderFps:60,replayRevision:0,startAt:0,clock:{paused:true,timestampMs:1000}}});
  const change=(s,values)=>(s.kind==='map'?editSourceMapScene:editSourceSymmetryConfiguration)(s,{...s,parameters:{...s.parameters,...values}},'parameters');
  const rows=[];
  for(const family of ['map','symmetry']){
   const scene=make(family),c=context(scene),key=family==='map'?'mapLive':'symmetryLive',owner=new SourceIteratedSession(family),next=change(scene,{gain:.2});
   try{
    const initial=owner.generate(scene,c),before=owner.diagnostics(),particles=Array.from(owner.readParticles()),ink=Array.from(owner.snapshotInk());
    owner.updateParameters(scene,next,c);const after=owner.diagnostics();
    check(after.steps===before.steps&&after.displays===before.displays&&same(after.clock,before.clock),'Hot edit advanced frame/clock');check(same(particles,Array.from(owner.readParticles()))&&same(ink,Array.from(owner.snapshotInk())),'Hot edit changed particles/ink');
    check(owner.matchesCompletedPrimary(next,c)&&!owner.matchesCompletedPrimary(scene,c),'Completed capability not rebound');
    const paused=owner.generate(next,c);check(paused[key].objectUpdates===0&&same(particles,Array.from(owner.readParticles())),'Paused next display reseeded/advanced');
    owner.setPaused(false,1000);const running={...c,[key]:{...c[key],clock:{paused:false,timestampMs:1100}}};const advanced=owner.generate(next,running),current=Array.from(owner.readParticles());
    check(advanced[key].objectUpdates===1&&advanced[key].sessionId===initial[key].sessionId,'Resume replaced session');
    // Independent single add, including exact Float32 rounding; all four x channels.
    for(let at=0;at<particles.length;at+=4)check(current[at]===F(F(particles[at])+F(.2)),'Uniform update did not continue retained particles');
    owner.setPaused(true,1100);const stopped={...running,[key]:{...running[key],clock:{paused:true,timestampMs:1100}}};owner.generate(next,stopped);
    const recording=owner.beginRecording(next,stopped,{width:16,height:16,simulationFps:4});check(recording.scene.parameters.gain===scene.parameters.gain,'Hot edit promoted last-applied recording config');owner.finishRecording(recording.handle);
    rows.push({family,layer:'gpu-owner',noDraw:true,noReseed:true,exactFloat32Continuation:true,recordingRestoresApplied:true});
   }finally{owner.reset();}
   const generator=new Generator(),requests=[];const nativeGenerate=generator.generate.bind(generator),nativeUpdate=generator.updateIteratedParameters.bind(generator);generator.generate=(...args)=>{requests.push('generate');return nativeGenerate(...args);};generator.updateIteratedParameters=(...args)=>{requests.push('parameters');return nativeUpdate(...args);};let output,busy=false;const errors=[];const queue=new GenerationQueue(generator,{output:o=>output=o,error:e=>errors.push(String(e)),busy:v=>busy=v});
   const settled=async()=>{for(let i=0;i<500&&busy;i++)await new Promise(r=>setTimeout(r,10));check(!busy&&!errors.length,errors.join('\n')||'Queue timeout');};
   try{
    queue.request(scene,c);await settled();const initial=output;
    queue.request(next,c,0,'metadata');await settled();check(output===initial&&same(requests,['generate','parameters']),'Paused edit generated image');
    const second=change(next,{gain:.3});queue.request(second,c,0,'metadata');await settled();check(output===initial&&requests.filter(x=>x==='parameters').length===2,'Repeated edit lost completed capability');
    await queue[family==='map'?'setMapPaused':'setSymmetryPaused'](false);const running={...c,[key]:{...c[key],clock:{paused:false}}};queue.request(second,running);await settled();check(output[key].sessionId===initial[key].sessionId&&output.stats.samples>initial.stats.samples,'Queue resume did not retain owner');
    await queue[family==='map'?'setMapPaused':'setSymmetryPaused'](true);
    rows.push({family,layer:'worker-queue',requests,retainedOutput:true,repeatEdits:true,resume:true});
   }finally{queue.dispose();}
  }

  // New names need explicit value-editor writes. These probes keep the running
  // source template unchanged, as when a different template remains staged.
  for(const family of ['map','symmetry']){
   const scene=make(family,true),c=context(scene),key=family==='map'?'mapLive':'symmetryLive';
   const firstValues={delta:.125,...(family==='map'?{gain:.2}:{symmetry_degree:9})};
   const first=change(scene,firstValues),firstWrites=Object.entries(firstValues),second=change(first,{freshControl:.75,gain:.3}),secondWrites=[['freshControl',.75],['gain',.3]];
   const owner=new SourceIteratedSession(family),frames={},observations={};
   const snapshot=()=>({diagnostics:owner.diagnostics(),particles:Array.from(owner.readParticles()),ink:Array.from(owner.snapshotInk())});
   const assertNoDraw=(before,after,label)=>{
    check(same(before.particles,after.particles)&&same(before.ink,after.ink),label+' changed particles or ink');
    check(before.diagnostics.steps===after.diagnostics.steps&&before.diagnostics.displays===after.diagnostics.displays&&same(before.diagnostics.clock,after.diagnostics.clock),label+' advanced math/display/clock');
    check(!after.diagnostics.replay.replayPending&&!after.diagnostics.replay.replayActive,label+' requested replay');
   };
   const assertContinued=(prior,current,gain,delta)=>{
    const step=family==='map'?F(gain):F(F(F(gain)+F(delta))+F(3*.03125));
    for(let at=0;at<prior.length;at+=4){
     check(current[at]===F(F(prior[at])+step),family+' new-name x continuation/macro mismatch');
     check(current[at+1]===F(F(prior[at+1])+(family==='map'?0:F((3-2)*.0078125))),family+' retained {N_MINUS_2} macro mismatch');
     check(current[at+2]===prior[at+2],family+' new name changed z');
    }
   };
   try{
    frames.initial=owner.generate(scene,c);const initial=snapshot();
    owner.updateParameters(scene,first,c,firstWrites);const written=snapshot();assertNoDraw(initial,written,'Paused new-name setter');
    check(written.diagnostics.frame.parameters.values.delta===.125,'New name missing from running registry');
    check(owner.matchesCompletedPrimary(first,c)&&!owner.matchesCompletedPrimary(scene,c),'New name failed completed capability rebinding');
    frames.paused=owner.generate(first,c);const acknowledged=snapshot();
    check(frames.paused[key].objectUpdates===0&&!frames.paused[key].display.cleared&&!frames.paused[key].display.replayed,'Paused acknowledgement cleared ink or advanced');
    check(same(initial.particles,acknowledged.particles)&&acknowledged.diagnostics.frame.parameters.changed,'Paused new-name display did not acknowledge without reseed');
    owner.setPaused(false,1000);const running={...c,[key]:{...c[key],clock:{paused:false,timestampMs:1100}}};
    frames.resumed=owner.generate(first,running);const resumed=snapshot();assertContinued(initial.particles,resumed.particles,first.parameters.gain,.125);
    check(!frames.resumed[key].display.cleared&&!resumed.diagnostics.frame.parameters.changed,'Paused ack was incorrectly repeated on resume');
    check(frames.resumed[key].display.phases.every(p=>!p.resetParticles),'New-name shader change reset particles');
    if(family==='map')check(resumed.diagnostics.replay.gpu.programs>initial.diagnostics.replay.gpu.programs,'Map new-name field did not compile its changed uniform layout');
    owner.updateParameters(first,second,running,secondWrites);const runningWritten=snapshot();assertNoDraw(resumed,runningWritten,'Running new-name setter');
    const later={...running,[key]:{...running[key],clock:{paused:false,timestampMs:1200}}};
    frames.changed=owner.generate(second,later);const changed=snapshot();assertContinued(resumed.particles,changed.particles,.3,.125);
    check(frames.changed[key].display.cleared&&changed.diagnostics.frame.parameters.changed,'Running new-name edit did not clear and acknowledge');
    check(!frames.changed[key].display.replayed&&frames.changed[key].display.phases.every(p=>!p.resetParticles),'Running new-name edit rebuilt trajectory');
    const steady={...later,[key]:{...later[key],clock:{paused:false,timestampMs:1300}}};
    frames.steady=owner.generate(second,steady);const stable=snapshot();assertContinued(changed.particles,stable.particles,.3,.125);
    check(!frames.steady[key].display.cleared&&!stable.diagnostics.frame.parameters.changed,'New-name acknowledgement was not consumed exactly once');
    owner.setPaused(true,1300);const stopped={...steady,[key]:{...steady[key],clock:{paused:true,timestampMs:1300}}};owner.generate(second,stopped);
    const recording=owner.beginRecording(second,stopped,{width:16,height:16,simulationFps:4});
    check(same(recording.scene.mapSource??recording.scene.symmetrySource,scene.mapSource??scene.symmetrySource)&&same(recording.scene.parameters,scene.parameters),'New names promoted original constructor/recording anchor');owner.finishRecording(recording.handle);
    observations.programs={initial:initial.diagnostics.replay.gpu.programs,afterPaused:acknowledged.diagnostics.replay.gpu.programs,afterResume:resumed.diagnostics.replay.gpu.programs,afterRunningNewName:changed.diagnostics.replay.gpu.programs};
    observations.particles={initial:initial.particles,afterResume:resumed.particles,afterRunningNewName:changed.particles,steady:stable.particles};
    observations.ack={paused:acknowledged.diagnostics.frame.parameters.changed,resume:resumed.diagnostics.frame.parameters.changed,runningWrite:changed.diagnostics.frame.parameters.changed,steady:stable.diagnostics.frame.parameters.changed};
    rows.push({family,layer:'gpu-owner-new-name',explicitWrites:firstWrites,secondWrites,noDraw:true,noReseed:true,originalRecordingConstruction:true,exactFloat32Continuation:true,...(family==='symmetry'?{originalCompileDegree:3,authoredHotDegree:9,retainedMacro:true}:{}),...observations});
   }finally{owner.reset();}
   // The real Worker uses the same completed capability after each no-draw
   // control. Compare returned frames against the GPU owner probe above.
   const generator=new Generator(),requests=[],nativeGenerate=generator.generate.bind(generator),nativeUpdate=generator.updateIteratedParameters.bind(generator);
   generator.generate=(...args)=>{requests.push('generate');return nativeGenerate(...args);};
   generator.updateIteratedParameters=(...args)=>{requests.push({operation:'parameters',writes:args[2]});return nativeUpdate(...args);};
   // Queue playback uses wall time publicly; inject the same clock at the real
   // Generator transport boundary solely for this deterministic Worker oracle.
   const pauseMethod=family==='map'?'setMapPaused':'setSymmetryPaused',nativePause=generator[pauseMethod].bind(generator);
   generator[pauseMethod]=(output,paused)=>nativePause(output,paused,1000);
   let output,busy=false;const errors=[],queue=new GenerationQueue(generator,{output:o=>output=o,error:e=>errors.push(String(e)),busy:v=>busy=v});
   const settled=async()=>{for(let i=0;i<500&&busy;i++)await new Promise(r=>setTimeout(r,10));check(!busy&&!errors.length,errors.join('\n')||'New-name Worker queue timeout');};
   const matches=(expected,label)=>{
    check(output.backend==='webgl2'&&output[key].sessionId===c[key].sessionId,label+' changed backend/session');
    check(same(Array.from(output.pixels),Array.from(expected.pixels)),label+' Worker pixels differ from GPU owner');
    check(same(output[key],expected[key]),label+' Worker live facts differ from GPU owner: '+JSON.stringify({actual:output[key],expected:expected[key]}));
   };
   try{
    queue.request(scene,c);await settled();matches(frames.initial,'Initial');const initial=output;
    queue.request(first,c,0,'metadata',firstWrites);await settled();check(output===initial&&requests.length===2&&requests[1].operation==='parameters','Worker new-name setter drew or replaced instead of rebinding');
    queue.request(first,c);await settled();matches(frames.paused,'Paused acknowledgement');
    await queue[family==='map'?'setMapPaused':'setSymmetryPaused'](false);
    const running={...c,[key]:{...c[key],clock:{paused:false,timestampMs:1100}}};queue.request(first,running);await settled();matches(frames.resumed,'Resumed');const resumed=output;
    queue.request(second,running,0,'metadata',secondWrites);await settled();check(output===resumed&&requests.at(-1).operation==='parameters','Running new-name setter drew before requested display');
    const later={...running,[key]:{...running[key],clock:{paused:false,timestampMs:1200}}};queue.request(second,later);await settled();matches(frames.changed,'Running new-name acknowledgement');
    const steady={...later,[key]:{...later[key],clock:{paused:false,timestampMs:1300}}};queue.request(second,steady);await settled();matches(frames.steady,'Steady after acknowledgement');
    rows.push({family,layer:'worker-queue-new-name',requests,retainedOutput:true,exactGpuOwnerPixelsAndFacts:true,injectedPlaybackTimestampMs:1000,newNamePausedAck:true,runningClearExactlyOnce:true});
   }finally{queue.dispose();}
  }
  return rows;
 });report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)throw Error('Source changed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases?.length}));}
