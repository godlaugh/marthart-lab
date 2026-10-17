import {chromium} from '../node_modules/playwright/index.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:5177/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixed-clock tracking regression</title>'}));await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{Generator}=await import('/src/engine/client.ts');
  const check=(ok,m)=>{if(!ok)throw Error(m);},hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const make=(backend,count,showTrails,index=count-1)=>{const s=createScene(definition('attractor'));s.parameters={};s.equations={dx:'1',dy:'0',dz:'0'};Object.assign(s.settings,{simulationMode:'continuous',attractorBackend:backend,particleCount:count,burnIn:0,staggerMin:0,staggerMax:0,simulationFps:30,subSteps:1,dt:1/30,initialX:0,initialY:0,initialZ:0,initialSpread:0,variableTimeStep:false,showTrails,integrator:'euler',scale:1});s.timeline.duration=10;s.timeline.tracks=[{id:'track',type:'animate',target:'camera.actions',start:0,duration:0,from:0,to:0,easing:'linear',enabled:true,pingPong:false,actions:[{id:'a',method:'track',args:{index}}]}];return s;};
  const worker=new Generator(),cold=new Generator(),rows=[],ctx={width:32,height:24,quality:'export'};
  try{
   const decimal=.0333333333333333,tick=1/30;
   for(const backend of ['cpu','gpu'])for(const showTrails of backend==='cpu'?[false,true]:[false])for(const index of [2,999999]){
    const scene=make(backend,3,showTrails,index);
    for(const time of [decimal,tick-1e-5,tick+1e-5,tick,.0666666666666667,decimal]){
     const out=await worker.generate(scene,{...ctx,time});cold.cancel();const reset=await cold.generate(scene,{...ctx,time});
     check(out.backend===(backend==='gpu'?'webgl2':'cpu'),'requested backend missing');check(out.temporal.time===time&&out.cameraFrame.time===time,'requested time lost');check(await hash(out.positions)===await hash(reset.positions),'cold/warm geometry differs');check(JSON.stringify(out.cameraFrame)===JSON.stringify(reset.cameraFrame),'cold/warm camera differs');
     if(index===2)check(out.cameraFrame.camera.target[0]===out.positions[6],'tracked actual head differs');else check(out.warnings.some(w=>w.includes('越界')),'out-of-range warning missing');
     const expected=time===tick+1e-5||time===.0666666666666667?6:3;check(out.stats.samples===expected,`wrong full/fraction steps ${time} ${out.stats.samples}`);
     rows.push({backend:out.backend,showTrails,index,time,samples:out.stats.samples,coldWarmExact:true});
    }
   }
   const capacities=[];
   for(const count of [100000,2000000]){const scene=make('gpu',count,false),t0=performance.now(),out=await worker.generate(scene,{...ctx,time:decimal});check(out.backend==='webgl2'&&out.stats.generated===count&&out.stats.samples===count,'capacity truncated');check(out.particleIds[count-1]===count-1&&out.cameraFrame.camera.target[0]===out.positions[(count-1)*3],'capacity stable-id target mismatch');capacities.push({count,backend:out.backend,trackedId:count-1,time:decimal,target:out.cameraFrame.camera.target,elapsedMs:performance.now()-t0});}
   return{status:'passed',at:new Date().toISOString(),rows,capacities,limitations:['Independent app only; original native runtime was not run.','Wall-clock observations are diagnostics; CPU/RSS/VRAM and token cost unmeasured.'],supplements:'attractor-tracking-report.json: earlier exact-tick/stop/restart/cancel report retains its original source snapshot; this report verifies the later shared fixed-clock change.'};
  }finally{worker.dispose();cold.dispose();}
 });
 if(errors.length)throw Error(errors.join('\n'));report.pageErrors=errors;report.sourceSnapshots=[];
 for(const f of ['src/engine/simulationClock.ts','src/engine/temporal.ts','src/scenes/attractorParticles.ts','scripts/verify-attractor-tracking-clock.mjs'])report.sourceSnapshots.push({path:'studio/'+f,sha256:createHash('sha256').update(await readFile(new URL('../'+f,import.meta.url))).digest('hex')});
 await writeFile(new URL('../.cache/attractor-tracking-clock-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.rows.length,capacities:report.capacities,pageErrors:errors}));
}finally{await browser.close();}
