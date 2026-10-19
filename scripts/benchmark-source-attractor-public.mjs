import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{maxBuffer:32*1024*1024,...options});if(r.status!==0)throw Error(String(r.error||r.stderr||r.stdout));return r.stdout;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).sort().map(async p=>['src/'+p,sha(await readFile('src/'+p))])));
const sourcesBefore=await hashes(),baselineCommit='cd851c4b21114001b4110a6be3a5a11d98df6311',dir=await mkdtemp('.cache/attractor-public-cost-'),baseline=resolve(dir,'baseline');await mkdir(baseline);
run('tar',['-x','-C',baseline],{input:run('git',['archive',baselineCommit,'src'])});
const shared=`export {createScene} from './src/engine/document';export {definition} from './src/scenes';export {importSourceAttractorConfig} from './src/engine/sourceAttractorConfig';export {importSourceAttractorVisualConfig} from './src/engine/sourceAttractorVisualConfig';export {prepareSourceAttractorEquation} from './src/engine/sourceAttractorEquation';export {generateSourceAttractorCpu,replaySourceAttractorCpu} from './src/engine/sourceAttractorScene';export {ordinarySourceCameraInitial} from './src/engine/ordinarySourceCamera';export {SOURCE_CAMERA_MODEL} from './src/engine/sourceCamera';`;
for(const [variant,root] of [['before',baseline],['after',process.cwd()]])await build({stdin:{contents:shared+(variant==='after'?`export {generateScene,TemporalGenerationSession} from './src/engine/temporal';export {sceneAtTime} from './src/engine/timeline';`:''),resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(dir,variant+'.mjs')});
const runner=resolve(dir,'run.mjs');await writeFile(runner,`
import {createHash} from 'node:crypto';
const [variant,countText,roundText]=process.argv.slice(2),count=Number(countText),api=await import('./'+variant+'.mjs');
const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function hashValue(h,v){if(ArrayBuffer.isView(v)){h.update(v.constructor.name+':'+v.byteLength+':');h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));return v.byteLength;}if(Array.isArray(v)){h.update('array:'+v.length+':');return v.reduce((n,x)=>n+hashValue(h,x),0);}if(v&&typeof v==='object'){let n=0;for(const key of Object.keys(v).filter(k=>k!=='elapsedMs').sort()){h.update(key+':');n+=hashValue(h,v[key]);}return n;}h.update(typeof v+':'+String(v)+';');return 0;}
function execute(){
 const start=performance.now(),cpuStart=process.cpuUsage(),hash=createHash('sha256');let frames=0,bytes=0,status='completed',failure;const session=variant==='after'?new api.TemporalGenerationSession():undefined;
 try{
  const scene=api.createScene(api.definition('attractor')),settings={particle_count_cpu:count,time_step:.005,sub_steps:5,scale_x:6,scale_y:6,scale_z:6,offset_z:-150,show_trails:true,fade_trails:true,trail_lifetime:3};
  scene.attractorSource={configuration:take(api.importSourceAttractorConfig(settings,{warmup_steps:200})).configuration,visual:take(api.importSourceAttractorVisualConfig(settings,['#ffcc2233','#ff44cc22','#ff2255ee'])).configuration,backgroundColor:0xff101319};
  Object.assign(scene.settings,{sourceCameraProjection:'perspective',computeBackend:'cpu',presentation:'points',scale:1,rotateX:0,rotateY:0,rotateZ:0});
  scene.equations={dx:'sigma*(y-x)',dy:'x*(rho-z)-y',dz:'x*y-beta*z'};scene.parameters={sigma:10,rho:28,beta:8/3};scene.sourceCamera={model:api.SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}};
  scene.timeline={duration:2,fps:30,loop:false,schedule:'ordinary-camera-sequence-v1',tracks:[{id:'g',type:'animate',target:'camera.actions',start:0,duration:2,from:0,to:0,easing:'linear',enabled:true,pingPong:false,actions:[{id:'g',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'oklab',speed:90,affectInside:true,affectOutside:true}},{id:'t',method:'track',args:{index:0}}]}]};
  for(let i=0;i<31;i++){
   const time=i/30,context={time,width:640,height:480,quality:'export',sourceViewport:{logicalWidth:640,logicalHeight:480,referenceLogicalHeight:480,target:'offscreen',projectionPass:'perspective'}};
   let output,camera;
   if(variant==='before'){
    // Prior canonical boundary had no public document integration. Rebuild the
    // equation for each request, as public preparation does; both tasks include
    // the independent display-time camera query used by the actual UI/export.
    const prepare=()=>({configuration:scene.attractorSource.configuration,visualConfiguration:scene.attractorSource.visual,equation:take(api.prepareSourceAttractorEquation(scene)),backgroundColor:scene.attractorSource.backgroundColor,camera:api.ordinarySourceCameraInitial(scene),tracks:scene.timeline.tracks,fps:scene.timeline.fps,time});
    output=api.generateSourceAttractorCpu({...prepare(),viewport:context.sourceViewport});camera=api.replaySourceAttractorCpu(prepare()).frame;
   }else{output=api.generateScene(scene,context,session);camera=api.sceneAtTime(scene,time).evaluatedSourceCamera;}
   bytes+=hashValue(hash,{output,camera:{time:camera.time,frameIndex:camera.frameIndex,camera:camera.camera}});frames++;
  }
 }catch(error){status='failed';failure={name:error.name,code:error.code??null,message:error.message};}finally{session?.reset();}
 const cpu=process.cpuUsage(cpuStart);return{status,failure,frames,bytes,sha256:hash.digest('hex'),elapsedMs:performance.now()-start,cpuMs:(cpu.user+cpu.system)/1000,peakProcessFamilyRssKiB:process.resourceUsage().maxRSS};
}
console.log(JSON.stringify({variant,particles:count,round:Number(roundText),rows:[{temperature:'cold-first-task',...execute()},{temperature:'warm-fresh-task',...execute()}]}));
`);
const results=[];for(const particles of [128,1000])for(const variant of ['before','after'])for(let round=0;round<3;round++)results.push(JSON.parse(run(process.execPath,[runner,variant,String(particles),String(round)],{encoding:'utf8'})));
const failures=[];for(const particles of [128,1000]){const rows=results.filter(r=>r.particles===particles).flatMap(r=>r.rows);if(rows.some(r=>r.status!=='completed'||r.frames!==31))failures.push(particles+': incomplete task');if(rows.some(r=>r.sha256!==rows[0].sha256))failures.push(particles+': before/after complete output or camera mismatch');}
const summaries=[];for(const particles of [128,1000])for(const variant of ['before','after'])for(const temperature of ['cold-first-task','warm-fresh-task']){const rows=results.filter(r=>r.particles===particles&&r.variant===variant).flatMap(r=>r.rows).filter(r=>r.temperature===temperature),median=k=>rows.map(r=>r[k]).sort((a,b)=>a-b)[1];summaries.push({particles,variant,temperature,frames:rows[0].frames,status:rows[0].status,medianElapsedMs:median('elapsedMs'),medianCpuMs:median('cpuMs'),maxCumulativeProcessFamilyRssKiB:Math.max(...rows.map(r=>r.peakProcessFamilyRssKiB))});}
const sources=await hashes(),sourceStable=JSON.stringify(sourcesBefore)===JSON.stringify(sources);if(!sourceStable)failures.push('Source changed during measurement');
const report={status:failures.length?'failed':'passed',at:new Date().toISOString(),baselineCommit,sourceStable,sources,scriptSha256:sha(await readFile('scripts/benchmark-source-attractor-public.mjs')),results,summaries,failures,
 scope:'31 complete independent frame queries at 30 FPS, each including initial 200-step warmup, source gradient/trail generation, a separate display camera replay and full output hashing. Prior canonical API compared with new public generateScene/sceneAtTime entry; not a previously functional public import workflow. One public generation session per complete task, matching the Worker lifetime, including creation/reset; no retained native motion cache.',
 measurement:'Three separate single-process Node runs per variant/count; each has first cold task and warm fresh task. Module loading excluded from elapsed/CPU; cumulative OS RSS includes module loading and preceding cold task. No subprocesses during measured work, so process family equals measured process. Cold is not a flushed filesystem cache.',
 unmeasured:['browser and GPU draw/upload','video encoding','original JVM cost and parity','agent tokens','build and module-load elapsed/CPU','long-duration 5–10 second high-particle export'],nativeParity:false};
await writeFile('.cache/v2-source-attractor-public-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,sourceStable,failures,summaries}));if(failures.length)process.exitCode=1;
