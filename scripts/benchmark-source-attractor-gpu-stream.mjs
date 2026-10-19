import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {build} from 'esbuild';
import {readFile,writeFile,readdir,mkdtemp,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {measureFamily} from './browser-process-cost.mjs';
import {createHash} from 'node:crypto';
const long=process.argv.includes('--long'),large=process.argv.includes('--large'),count=large?2000000:200000,frameCount=long?301:31,substeps=Number(process.argv.find(a=>a.startsWith('--substeps='))?.split('=')[1]??5);
const sha=data=>createHash('sha256').update(data).digest('hex');
const baselineCommit='4690a5f69a259bbe628bc2c5acd91b0ec2046d70';
const reportPath='.cache/v2-source-attractor-gpu-stream-'+(long?'long':large?'large':'cost')+'.json';
const hashes=async()=>Object.fromEntries(await Promise.all([...(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p),'scripts/benchmark-source-attractor-gpu-stream.mjs','scripts/browser-process-cost.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),baselineCommit,count,frameCount,substeps,nativeParity:false,results:[],measurement:'Each variant owns a separate headless Chrome family. One cold-first task then warm-fresh task, after module import. Each task imports/serializes/reopens the input, generates every full RGBA8 frame and hashes pixels/camera, then disposes its TemporalGenerationSession. Before uses pinned public generator plus separate sceneAtTime camera; after consumes the paired camera. Module/build/Chrome launch excluded. Cold does not flush OS/driver caches. ps every250ms plus boundaries; CPU summed by PID/start time, aggregate RSS sampled (may miss short-lived processes/peaks). Node/Vite/VRAM excluded. One pair per variant, no cross-device claim.',unmeasured:['agent tokens','native JVM/JOGL frames and cost','GPU device time and VRAM','video encoding','browser startup/build/import cost']};
let server,browserServer,browser;
try{
 const before=await hashes(),dir=await mkdtemp('.cache/attractor-gpu-stream-'),baseline=resolve(dir,'baseline');await mkdir(baseline);
 const archive=spawnSync('git',['archive',baselineCommit,'src'],{maxBuffer:32*1024*1024});if(archive.status!==0)throw Error(String(archive.stderr));const unpack=spawnSync('tar',['-x','-C',baseline],{input:archive.stdout});if(unpack.status!==0)throw Error(String(unpack.stderr));
 const variants=long||large?['after']:['before','after'];
 for(const variant of variants){await build({stdin:{contents:`export {parseProjectFile} from './src/engine/legacyImport';export {parseScene,serializeScene} from './src/engine/document';export {generateScene,TemporalGenerationSession} from './src/engine/temporal';export {sceneAtTime} from './src/engine/timeline';`,resolveDir:variant==='before'?baseline:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:resolve(dir,variant+'.mjs')});}
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 for(const variant of variants){
  browserServer=await chromium.launchServer({channel:'chrome',headless:true});const rootPid=browserServer.process().pid;if(!rootPid)throw Error('Missing owned Chrome PID');browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/gpu-cost',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.route('**/gpu-api.mjs',r=>r.fulfill({contentType:'text/javascript',path:resolve(dir,variant+'.mjs')}));await page.goto(server.resolvedUrls.local[0]+'gpu-cost');
  report.browserVersion=browser.version();report.nodeVersion=process.version;
  await page.evaluate(async({variant,count,frameCount,substeps})=>{
   const api=await import('/gpu-api.mjs');
   const source={config_version:'1.0.0',type:'ATTRACTOR',name:'GPU stream complete-query cost',equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},settings:{render_mode:'GPU',particle_count_gpu:count,sub_steps:substeps,scale_x:6,scale_y:6,scale_z:6,offset_z:-150},camera:{phi:Math.PI/2,theta:0,gamma:0},timeline:[{type:'animate',duration:Math.max(2,frameCount/30),easing:'LINEAR',actions:[{method:'rotatePhi',args:[.5]},{method:'track',args:[7]}]}]};
   window.__gpuCostTask=async()=>{
    const started=performance.now(),frames=[],owner=new api.TemporalGenerationSession();let outputBytes=0,result;
    const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    try{
     const scene=api.parseScene(api.serializeScene(api.parseProjectFile(JSON.stringify(source)).scene));scene.timeline.fps=30;
     for(let i=0;i<frameCount;i++){
      const time=i/30,context={time,width:640,height:360,quality:'export',sourceViewport:{logicalWidth:640,logicalHeight:360,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'}},begin=performance.now(),output=api.generateScene(scene,context,owner),generated=performance.now();
      const camera=variant==='before'?api.sceneAtTime(scene,time).evaluatedSourceCamera:output.sourceCameraFrame,queried=performance.now();
      if(output.type!=='raster'||output.backend!=='webgl2'||output.stats.generated!==count||output.pixels.length!==640*360*4)throw Error('Incomplete output');
      if(!camera||camera.frameIndex!==output.sourceCameraFrame.frameIndex||JSON.stringify(camera.camera)!==JSON.stringify(output.sourceCameraFrame.camera))throw Error('Camera mismatch');
      outputBytes+=output.pixels.byteLength;const pixelsSha256=await digest(output.pixels),cameraSha256=await digest(new TextEncoder().encode(JSON.stringify(camera.camera)));
      let freshCheckpoint;if(variant==='after'&&(frameCount>31||count>200000)&&[0,1,5,frameCount-1].includes(i)){const fresh=api.generateScene(scene,context);freshCheckpoint=(await digest(fresh.pixels))===pixelsSha256&&JSON.stringify(fresh.sourceCameraFrame)===JSON.stringify(output.sourceCameraFrame);if(!freshCheckpoint)throw Error('Fresh checkpoint mismatch '+i);}
      frames.push({index:i,time,frameIndex:camera.frameIndex,generated:output.stats.generated,generationMs:generated-begin,cameraQueryMs:queried-generated,pixelsSha256,cameraSha256,freshCheckpoint});
     }
     result={status:'completed',outputBytes,frames,diagnostics:owner.diagnostics().sourceAttractor};
    }catch(error){result={status:'failed',outputBytes,frames,error:{name:error.name,code:error.code??null,message:error.message}};}finally{owner.reset();}
    return{...result,elapsedMs:performance.now()-started};
   };
  },{variant,count,frameCount,substeps});
  for(const temperature of ['cold-first-task','warm-fresh-task']){const row=await measureFamily(rootPid,()=>page.evaluate(()=>window.__gpuCostTask()));report.results.push({variant,temperature,...row});if(row.status!=='completed')throw Error(variant+': '+row.error.message);if(variant==='after'&&row.diagnostics.gpu.constructions!==1)throw Error('Retained owner rebuilt');}
  if(errors.length)throw Error(errors.join('; '));await browser.close();browser=undefined;await browserServer.close();browserServer=undefined;
 }
 const first=report.results[0];report.equalFullOutputs=report.results.every(row=>row.frames.length===frameCount&&row.frames.every((f,i)=>f.pixelsSha256===first.frames[i].pixelsSha256&&f.cameraSha256===first.frames[i].cameraSha256));if(!report.equalFullOutputs)throw Error('Whole frame/camera mismatch');
 report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);if(!report.sourceStable)throw Error('Source changed during measurement');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{
 report.cleanup=[];for(const [name,resource]of [['browser',browser],['browser-process',browserServer],['vite',server]])if(resource)try{await resource.close();report.cleanup.push({name,status:'fulfilled'});}catch(error){report.cleanup.push({name,status:'rejected',error:String(error)});report.status='failed';process.exitCode=1;}
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,equalFullOutputs:report.equalFullOutputs,sourceStable:report.sourceStable,results:report.results.map(({variant,temperature,status,elapsedMs,outputBytes,frames,diagnostics,processFamily,error})=>({variant,temperature,status,elapsedMs,outputBytes,frames:frames.length,diagnostics,processFamily,error}))},null,2));
}
