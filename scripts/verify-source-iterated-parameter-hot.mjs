/** Actual GPU owner, Worker capability and queue controls. No native-window claim. */
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
  const {parseLegacyScene,parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceIteratedSession}=await import('/src/engine/sourceIteratedSession.ts'),{editSourceMapScene}=await import('/src/engine/sourceMapScene.ts'),{editSourceSymmetryConfiguration}=await import('/src/engine/sourceSymmetryConfig.ts'),{Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),F=Math.fround;
  const make=family=>(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',name:'Hot parameter GPU',parameters:{gain:.001,symmetry_degree:3},settings:{dimension:2,batch_size:4,burn_in_steps:2,iterations_per_frame:1,dot_size:4,spot_size:1,scale_x:1,scale_y:1,scale_z:1,x0_min:0,x0_max:0,y0_min:0,y0_max:0},palette:['#ffffff','#ffffff'],...(family==='map'?{equations:{x_next:'x+gain',y_next:'y',z_next:'0'}}:{equation:{glsl:'uniform float gain;void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(gain,0.,0.);m=gain;}'}}),timeline:[]}),{sourceEntry:'runtime-config'}).scene;
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
  return rows;
 });report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)throw Error('Source changed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases?.length}));}
