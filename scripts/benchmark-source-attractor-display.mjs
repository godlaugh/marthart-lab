import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,mkdir,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// --prepare-only builds both pinned variants and syntax-checks the runner. It
// deliberately does not execute tasks or produce a completed cost report.
const prepareOnly=process.argv.includes('--prepare-only');
const run=(command,args,options={})=>{const r=spawnSync(command,args,{maxBuffer:64*1024*1024,...options});if(r.status!==0)throw Error(String(r.error||r.stderr||r.stdout));return r.stdout;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceHashes=async(root='.')=>{const paths=(await readdir(resolve(root,'src'),{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).sort();return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(resolve(root,p)))])));};
const sourcesBefore={...await sourceHashes(),'scripts/benchmark-source-attractor-display.mjs':sha(await readFile('scripts/benchmark-source-attractor-display.mjs'))};
const baselineCommit=String(run('git',['rev-parse','c06c130228cb20e1655c9af6dccbc88b72cb0028^{commit}'])).trim();
const directory=await mkdtemp('.cache/attractor-display-cost-'),baseline=resolve(directory,'baseline');await mkdir(baseline);
run('tar',['-x','-C',baseline],{input:run('git',['archive',baselineCommit,'src'])});
const common=`export {SourceAttractorCpuParticles} from './src/engine/sourceAttractorCpuParticles';export {importSourceAttractorConfig} from './src/engine/sourceAttractorConfig';export {importSourceAttractorVisualConfig} from './src/engine/sourceAttractorVisualConfig';export {prepareSourceAttractorEquation} from './src/engine/sourceAttractorEquation';export {parseProjectFile} from './src/engine/legacyImport';export {prepareSourceSurfaceParticles} from './src/engine/sourceSurfaceParticles';`;
for(const [variant,root] of [['before',baseline],['after',process.cwd()]])await build({stdin:{contents:common,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(directory,variant+'.mjs')});
const runner=resolve(directory,'run.mjs');await writeFile(runner,`
import {createHash} from 'node:crypto';
const [variant,task,roundText]=process.argv.slice(2),api=await import('./'+variant+'.mjs'),round=Number(roundText);
const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
// Hash every snapshot property with explicit framing and typed-array identity.
// NaN/Infinity must not silently become JSON null; object key order is irrelevant.
function digestValue(h,v){
 if(ArrayBuffer.isView(v)){h.update(v.constructor.name+':'+v.byteLength+':');h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));return v.byteLength;}
 if(Array.isArray(v)){h.update('array:'+v.length+':');let n=0;for(const x of v)n+=digestValue(h,x);return n;}
 if(v&&typeof v==='object'){const keys=Object.keys(v).sort();h.update('object:'+keys.length+':');let n=0;for(const k of keys){h.update(JSON.stringify(k));n+=digestValue(h,v[k]);}return n;}
 h.update(typeof v+':'+String(v)+';');return 0;
}
function execute(){
 const start=performance.now(),cpuStart=process.cpuUsage(),full=createHash('sha256'),motion=createHash('sha256'),palette=createHash('sha256');
 let completeFrames=0,outputBytes=0,lastWorkUnits=0,lastTrailRecords=0,firstPalette,lastPalette,owner;
 const request=task==='surface-trails'?{family:'Surface',u:8,v:6,frames:31,fullSnapshotEveryFrame:true}:{family:'Attractor',particles:task==='gradient32'?32:task==='visual100'?100:1000,warmup:200,substeps:5,frames:task==='visual1000-prefix18'?18:31,fullSnapshotEveryFrame:true,visual:task!=='numerical1000',trails:task!=='numerical1000',gradient:task==='gradient32'?'hue_rotate/oklab/90':null};
 let status='completed',failure;
 try{
  if(task==='surface-trails'){
   const scene=api.parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Shared trail snapshot cost',equations:{x:'u',y:'v',z:'sin(u)+cos(v)'},palette:['#6011CC33','#C04020E0'],settings:{u_segments:8,v_segments:6,u_min:0,u_max:1,v_min:0,v_max:1,periodic_u:true,flowing_u:true,speed_u:3,speed_v:0,show_trails:true,fade_trails:true,trail_lifetime:3,render_mode:'CPU',surface_mode:'POINTS'},timeline:[{type:'animate',duration:1,actions:[{method:'track',args:[0]}]},{type:'wait',duration:1}]})).scene;
   owner=api.prepareSourceSurfaceParticles(scene).create('all');
  }else{
   const configuration=take(api.importSourceAttractorConfig({particle_count_cpu:request.particles,sub_steps:5,time_step:.005},{warmup_steps:200,bounds:{min_x:-1,max_x:1,min_y:-1,max_y:1,min_z:-1,max_z:1}})).configuration;
   const equation=take(api.prepareSourceAttractorEquation({equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},parameters:{}}));
   const visualConfiguration=request.visual?take(api.importSourceAttractorVisualConfig({show_trails:true,fade_trails:true,trail_lifetime:3,dot_size:2},['#FFCC2233','#FF44CC22','#FF2255EE'])).configuration:undefined;
   owner=new api.SourceAttractorCpuParticles({configuration,equation,...(visualConfiguration?{visualConfiguration}:{})});
   if(request.gradient){owner.beginGradientActions([{kind:'start',config:{mode:'hue_rotate',interpolation:'oklab',speed:90}}]);owner.interpolateGradientActions(1,true);}
  }
  for(let frameIndex=0;frameIndex<request.frames;frameIndex++){
   owner.update({frameIndex,time:frameIndex/30,deltaTime:1/30});
   const snapshot=owner.snapshot();outputBytes+=digestValue(full,snapshot);
   if(task!=='surface-trails')digestValue(motion,{model:snapshot.model,frameIndex:snapshot.frameIndex,rawPositions:snapshot.rawPositions,positions:snapshot.positions,timeSteps:snapshot.timeSteps,integrationSteps:snapshot.integrationSteps});
   if(snapshot.packedColors){const ph=createHash('sha256');digestValue(ph,snapshot.packedColors);lastPalette=ph.digest('hex');firstPalette??=lastPalette;palette.update(lastPalette);}
   lastWorkUnits=snapshot.workUnits;lastTrailRecords=snapshot.trails?.records??0;completeFrames++;
  }
 }catch(error){status=error.code==='capacity'?'capacity-rejected':'failed';failure={name:error.name,code:error.code??null,message:String(error.message??error),stage:owner?'frame-update-or-snapshot':'construction'};}
 const cpu=process.cpuUsage(cpuStart);
 return{request,status,failure,completeFrames,lastCompletedSnapshotWorkUnits:lastWorkUnits,lastTrailRecords,outputBytes,elapsedMs:performance.now()-start,cpuMs:(cpu.user+cpu.system)/1000,peakProcessFamilyRssKiB:process.resourceUsage().maxRSS,fullSnapshotsSha256:full.digest('hex'),motionSha256:motion.digest('hex'),paletteTrajectorySha256:palette.digest('hex'),gradientChanged:request.gradient?firstPalette!==lastPalette:null};
}
// Each task/variant gets three fresh OS processes. Each executes a cold first
// task and one warm repeat with a fresh owner; no state cache or descendants.
const rows=[{temperature:'cold-first-task-after-module-import',...execute()},{temperature:'warm-runtime-fresh-owner',...execute()}];
console.log(JSON.stringify({variant,task,round,node:process.version,pid:process.pid,rows}));
`);
run(process.execPath,['--check',runner]);
const plan={baselineCommit,directory,variants:['before','after'],rounds:3,temperatures:['cold-first-task-after-module-import','warm-runtime-fresh-owner'],tasks:['numerical1000','visual1000','visual1000-prefix18','visual100','gradient32','surface-trails']};
if(prepareOnly){console.log(JSON.stringify({status:'prepared-only',...plan,measurementExecuted:false}));process.exit(0);}
const results=[];
for(const task of plan.tasks)for(const variant of plan.variants)for(let round=0;round<3;round++)results.push(JSON.parse(run(process.execPath,[runner,variant,task,String(round)],{encoding:'utf8'})));
const failures=[];
for(const task of plan.tasks)for(const variant of plan.variants){const rows=results.filter(r=>r.task===task&&r.variant===variant).flatMap(r=>r.rows);if(!rows.length)continue;
 if(rows.some(r=>r.status==='failed'))failures.push(task+'/'+variant+': unexpected task failure');
 for(const key of ['status','completeFrames','fullSnapshotsSha256','motionSha256','paletteTrajectorySha256'])if(rows.some(r=>r[key]!==rows[0][key]))failures.push(task+'/'+variant+': repeat instability '+key);
 if(task==='gradient32'&&rows.some(r=>r.status!=='completed'||r.gradientChanged!==true))failures.push('gradient32: complete changing gradient required');
 if(task==='visual100'&&rows.some(r=>r.status!=='completed'))failures.push('visual100: smaller task did not complete');
}
for(const task of ['numerical1000','surface-trails','visual1000-prefix18','visual100','gradient32']){
 const before=results.find(r=>r.task===task&&r.variant==='before').rows[0],after=results.find(r=>r.task===task&&r.variant==='after').rows[0];
 if(before.status!=='completed'||after.status!=='completed'||before.fullSnapshotsSha256!==after.fullSnapshotsSha256)failures.push(task+': full before/after snapshots changed or incomplete');
}
for(const variant of plan.variants){const rows=results.filter(r=>r.task==='visual1000'&&r.variant===variant).flatMap(r=>r.rows);if(rows.some(r=>variant==='before'?(r.status!=='capacity-rejected'||r.completeFrames!==18):(r.status!=='completed'||r.completeFrames!==31||r.lastCompletedSnapshotWorkUnits!==42087034||r.lastTrailRecords!==155000)))failures.push('visual1000/'+variant+': unexpected completion/budget result');}
const sourcesAfter={...await sourceHashes(),'scripts/benchmark-source-attractor-display.mjs':sha(await readFile('scripts/benchmark-source-attractor-display.mjs'))};
const sourceStable=JSON.stringify(sourcesBefore)===JSON.stringify(sourcesAfter);if(!sourceStable)failures.push('Source changed during benchmark');
const summaries=[];for(const task of plan.tasks)for(const variant of plan.variants)for(const temperature of plan.temperatures){const rows=results.filter(r=>r.task===task&&r.variant===variant).flatMap(r=>r.rows).filter(r=>r.temperature===temperature);if(!rows.length)continue;const median=k=>rows.map(r=>r[k]).sort((a,b)=>a-b)[1];summaries.push({task,variant,temperature,status:rows[0].status,completedFrames:rows[0].completeFrames,medianElapsedMs:median('elapsedMs'),medianCpuMs:median('cpuMs'),maxCumulativeProcessFamilyRssKiB:Math.max(...rows.map(r=>r.peakProcessFamilyRssKiB)),outputBytes:rows[0].outputBytes});}
const report={status:failures.length?'failed':'passed',at:new Date().toISOString(),...plan,results,summaries,failures,sourceStable,sources:sourcesAfter,baselineSources:await sourceHashes(baseline),bundles:Object.fromEntries(await Promise.all(['before','after'].map(async v=>[v,sha(await readFile(resolve(directory,v+'.mjs')))]))),scope:'Current pinned before/after producer snapshots. Complete equal18-frame visual1000 prefix compared exactly; full31 before capacity failure and after completion reported separately without a speedup ratio. All other complete tasks compare full snapshots. No renderer or native JVM parity.',measurement:'Each round is a separate Node process, with one cold first task then one warm fresh-owner repeat. Module import/build excluded. Task contains no subprocess creation, so process family equals measured process. CPU is task delta; maxRSS is OS cumulative process high-water including module import and previous cold task, not incremental task memory or allocation size. Cold does not mean flushed filesystem cache. Rejected tasks report their actual partial work and are not substituted for successful equivalent tasks.',unmeasured:['agent tokens (no token meter)','original JVM/native application cost and framebuffer','browser process-family memory and GPU/VRAM','renderer upload/draw cost','build/module-loading elapsed and CPU','cold filesystem-cache effects'],nativeParity:false};
await writeFile('.cache/v2-source-attractor-stream-display-cost.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,failures,sourceStable,summaries}));if(failures.length)process.exitCode=1;
