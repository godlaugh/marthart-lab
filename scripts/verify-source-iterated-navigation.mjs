/** Actual GPU and worker navigation; does not execute the original window. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2];if(!out)throw Error('Supply new output directory');await mkdir(out);
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const p=e.parentPath+'/'+e.name;return[p,createHash('sha256').update(await readFile(p)).digest('hex')];})));
const report={status:'running',sourceBefore:await hashes(),nativeWindowExecuted:false};let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 report.cases=await page.evaluate(async()=>{
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{Generator}=await import('/src/engine/client.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const rows=[];
  for(const [family,dimension,density] of [['map',2,1],['map',3,2],['symmetry',2,2]]){
   const scene=(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Navigation GPU',parameters:{gain:.001,symmetry_degree:3},settings:{dimension,batch_size:4,burn_in_steps:2,iterations_per_frame:1,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0,z0_min:0,z0_max:0},palette:['#ffffff','#ffffff'],...(family==='map'?{equations:{x_next:'x+gain',y_next:'y',z_next:'0'}}:{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}),timeline:[]}),{sourceEntry:'runtime-config'}).scene;
   const key=family==='map'?'mapLive':'symmetryLive',c={time:0,width:48*density,height:32*density,quality:'preview',sourceViewport:ordinarySourceViewport(scene,48,32,'primary',32),sourcePointPixelDensity:density,[family==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:48*density,height:32*density},[key]:{sessionId:'navigation-live',renderFps:60,replayRevision:0,startAt:0,clock:{paused:true,timestampMs:1000}}};
   const owner=new SourceIteratedSession(family),generator=new Generator(),author=JSON.stringify(scene);
   try{
    const initial=owner.generate(scene,c),before=owner.diagnostics(),particles=Array.from(owner.readParticles());let output=await generator.generate(scene,c),last;
    const events=[{kind:'drag',dx:2,dy:1},{kind:'wheel',count:-2},{kind:'drag',dx:-3,dy:2},{kind:'wheel',count:1}];
    for(const event of events){
     const old=output;last=owner.navigatePaused(scene,c,event);output=await generator.navigateIteratedPaused(output,event);
     check(same(output.sourceCameraFrame.camera,last.sourceCameraFrame.camera),'Worker camera differs from runtime owner');
     if(event===events[0]){const display=last[key].display;check(display.cleared===(family==='map')&&display.accumulationPasses===(family==='map'?1:initial[key].display.accumulationPasses+1),'Paused camera ink clear differs from family rule');check(display.passes===1&&display.gpu.steps===0,'Paused display must deposit retained particles after any clear');}
     check(same(particles,Array.from(owner.readParticles())),'Navigation reseeded/advanced particles');
     check(last[key].objectUpdates===0&&last[key].sceneTime===initial[key].sceneTime,'Paused navigation advanced mathematical time');
     check(same(before.clock,owner.diagnostics().clock),'Paused navigation changed host clock');
     check(output[key].sessionId===initial[key].sessionId&&output[key].display.gpu.steps===0,'Worker navigation replaced/advanced particle owner');
     let stale=false;try{await generator.navigateIteratedPaused(old,event);}catch{stale=true;}check(stale,'Worker reused stale output capability');
    }
    const paused=last.sourceCameraFrame.camera;check(same(scene,JSON.parse(author)),'Navigation changed author scene');
    const capture=owner.capturePaused(scene,{...c,width:24,height:16,quality:'export'});check(same(capture.preview.sourceCameraFrame.camera,paused),'PNG capture discarded live navigation');
    owner.setPaused(false,1000);await generator[family==='map'?'setMapPaused':'setSymmetryPaused'](output,false,1000);
    const running={...c,[key]:{...c[key],clock:{paused:false,timestampMs:1100}}};const resumed=owner.generate(scene,running),workerResume=await generator.generate(scene,running);
    for(const o of [resumed,workerResume]){const camera=o.sourceCameraFrame.camera;check(camera.zoom===paused.zoom&&same(camera.center,paused.center),'Resume lost zoom/center');for(const axis of ['phi','theta','gamma'])check(camera[axis]===initial.sourceCameraFrame.camera[axis],'Resume did not restore saved angles');}
    let rejected=false;try{owner.navigatePaused(scene,running,events[0]);}catch{rejected=true;}check(rejected,'Running navigation was allowed');
    owner.setPaused(true,1100);const stopped={...running,[key]:{...running[key],clock:{paused:true,timestampMs:1100}}};owner.generate(scene,stopped);
    const valid=owner.diagnostics();let invalid=false;try{owner.navigatePaused(scene,stopped,{kind:'drag',dx:Infinity,dy:0});}catch{invalid=true;}check(invalid&&same(valid,owner.diagnostics()),'Invalid event mutated retained owner');
    const record=owner.beginRecording(scene,stopped,{width:16,height:16,simulationFps:4});check(same(record.warmup.sourceCameraFrame.camera,initial.sourceCameraFrame.camera),'Recording did not reconstruct applied camera');owner.finishRecording(record.handle);
    rows.push({family,dimension,density,events:events.length,retainedParticles:true,familyInkClear:true,noMathematicalAdvance:true,workerCapability:true,captureRetainsView:true,resumeAnglesOnly:true,invalidEventAtomic:true,recordingRestoresAppliedCamera:true});
   }finally{owner.reset();generator.dispose();}
  }
  return rows;
 });report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)throw Error('Source changed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases?.length}));}
