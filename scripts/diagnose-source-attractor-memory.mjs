import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{maxBuffer:32*1024*1024,...options});if(r.status!==0)throw Error(String(r.error||r.stderr||r.stdout));return r.stdout;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const indexedExperiment=process.argv.includes('--indexed-evaluator');
const mode=process.argv.includes('--allocation-profile')?'allocation-profile':process.argv.includes('--sample-natural')?'sample-natural':process.argv.includes('--gc-trace')?'gc-trace':process.argv.includes('--equivalent')?'equivalent':process.argv.includes('--unmodified')?'unmodified':'diagnosis';
const commits={before:'cd851c4b21114001b4110a6be3a5a11d98df6311',after:'52f3c1ee96064c135909d1efe11e09fce342f7fd'};
const dir=resolve(await mkdtemp('.cache/attractor-memory-'));
const benchmark=await readFile('scripts/benchmark-source-attractor-public.mjs','utf8');
const shared=benchmark.match(/const shared=`([\s\S]*?)`;/)[1];
const bundles={};
for(const [variant,commit] of Object.entries(commits)){
 const root=resolve(dir,variant);await mkdir(root);const archive=run('git',['archive',commit,'src']);run('tar',['-x','-C',root],{input:archive});
 // Count construction, without retaining the owners or changing their lifetime.
 const file=resolve(root,'src/engine/sourceAttractorCpuParticles.ts');let source=await readFile(file,'utf8');
 if(mode==='diagnosis'){source=source.replace('this.options={...options};','globalThis.__memoryOwnerCount=(globalThis.__memoryOwnerCount??0)+1;this.options={...options};');await writeFile(file,source);}
 if(indexedExperiment&&variant==='after'){const scalar=resolve(root,'src/engine/domainSourceScalar.ts');let text=await readFile(scalar,'utf8');const from='for(const {node,count} of instructions){';if(!text.includes(from))throw Error('Evaluator loop changed');text=text.replace(from,'for(let instruction=0;instruction<instructions.length;instruction++){const {node,count}=instructions[instruction];');await writeFile(scalar,text);}
 const outfile=resolve(dir,variant+'.mjs');
 await build({stdin:{contents:shared+(variant==='after'?`export {generateScene,TemporalGenerationSession} from './src/engine/temporal';export {sceneAtTime} from './src/engine/timeline';`:''),resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile});
 bundles[variant]={commit,...(indexedExperiment&&variant==='after'?{experimentalPatch:'Indexed instructions loop replaces for-of in prepareSourceRealExpression.evaluate; archive only'}:{}),sourceArchiveSha256:sha(archive),bytes:(await readFile(outfile)).length,sha256:sha(await readFile(outfile))};
}
let runner=benchmark.match(/await writeFile\(runner,`([\s\S]*?)`\);/)[1];
runner=runner.replace("const [variant,countText,roundText]=process.argv.slice(2),count=Number(countText),api=await import('./'+variant+'.mjs');",`const [variant,countText,roundText,workflow,gcMode]=process.argv.slice(2),count=Number(countText);const preImport=process.memoryUsage();const api=await import('./'+variant+'.mjs');const postImport=process.memoryUsage();const mark=(phase,frame)=>({phase,frame,...process.memoryUsage(),owners:globalThis.__memoryOwnerCount??null});`);
runner=runner.replace("const start=performance.now(),cpuStart=process.cpuUsage(),hash=createHash('sha256');", "const memory=[mark('start',-1)],start=performance.now(),cpuStart=process.cpuUsage(),hash=createHash('sha256');");
runner=runner.replace("const session=variant==='after'?", "const session=workflow==='public'?");
runner=runner.replace("if(variant==='before'){", "if(workflow==='canonical'){");
runner=runner.replace("bytes+=hashValue(hash,{output", "memory.push(mark('query',i));bytes+=hashValue(hash,{output");
runner=runner.replace("});frames++;", "});frames++;memory.push(mark('hashed',i));output=undefined;camera=undefined;if(gcMode==='per-frame'){global.gc();memory.push(mark('frame-gc',i));}");
runner=runner.replace("const cpu=process.cpuUsage(cpuStart);return{status", "const cpu=process.cpuUsage(cpuStart),elapsedMs=performance.now()-start;memory.push(mark('end',31));global.gc();memory.push(mark('after-gc-outside-timing',31));return{memory,status");
runner=runner.replace('elapsedMs:performance.now()-start','elapsedMs');
runner=runner.replace("console.log(JSON.stringify({variant,particles:count,round:Number(roundText),rows:", "console.log(JSON.stringify({variant,workflow,gcMode,preImport,postImport,particles:count,round:Number(roundText),rows:");
if(mode==='unmodified'||mode==='sample-natural'){runner=runner.replace('output=undefined;camera=undefined;', '').replace("global.gc();memory.push(mark('after-gc-outside-timing',31));","");runner=runner.replace('console.log(JSON.stringify(',"globalThis.__result=").replace(/\)\);\s*$/,";global.gc();globalThis.__result.afterTasksGC=mark('after-both-tasks-gc',31);console.log(JSON.stringify(globalThis.__result));");}
if(mode==='equivalent'||mode==='gc-trace'||mode==='allocation-profile')runner=benchmark.match(/await writeFile\(runner,`([\s\S]*?)`\);/)[1];
if(mode==='sample-natural')runner=runner.replace('global.gc();globalThis.__result.afterTasksGC=', 'globalThis.__result.afterTasks=');
if(mode==='allocation-profile'){
 runner="import {Session} from 'node:inspector';import {writeFileSync} from 'node:fs';\n"+runner;
 runner=runner.replace('console.log(JSON.stringify(',"const inspector=new Session();inspector.connect();const post=(method,params={})=>new Promise((resolve,reject)=>inspector.post(method,params,(error,value)=>error?reject(error):resolve(value)));await post('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});const result=").replace(/\)\);\s*$/,";const profile=await post('HeapProfiler.stopSampling');writeFileSync(process.argv[7],JSON.stringify(profile));inspector.disconnect();console.log(JSON.stringify(result));");
}
const runnerPath=resolve(dir,'run.mjs');await writeFile(runnerPath,runner);
const results=[];
const workflows=mode==='allocation-profile'||mode==='gc-trace'||mode==='sample-natural'?[['after','public']]:mode==='equivalent'?[['before','canonical'],['after','public']]:[['before','canonical'],['after','canonical'],['after','public']];
for(const [variant,workflow] of workflows)for(let round=0;round<(mode==='allocation-profile'?1:mode==='diagnosis'?2:3);round++){
 const gcMode=mode==='diagnosis'?['natural','per-frame'][round]:mode;
 const stdout=run(process.execPath,[...(mode==='gc-trace'?['--trace-gc']:mode==='equivalent'||mode==='sample-natural'||mode==='allocation-profile'?[]:['--expose-gc']),runnerPath,variant,'1000',String(round),workflow,gcMode,resolve(dir,'allocation-profile.json')],{encoding:'utf8'});const result=JSON.parse(stdout.trim().split('\n').at(-1));if(mode==='gc-trace'){result.tracePath=resolve(dir,variant+'-'+round+'-gc.log');await writeFile(result.tracePath,stdout);}if(mode==='allocation-profile')result.profilePath=resolve(dir,'allocation-profile.json');results.push(result);
 console.log(JSON.stringify({variant,workflow,gcMode,round,rows:result.rows.map(({memory,...r})=>({...r,...(memory?{maxArrayBuffers:Math.max(...memory.map(m=>m.arrayBuffers)),end:memory.findLast(m=>m.phase==='end'),afterGC:memory.findLast(m=>m.phase==='after-gc-outside-timing')}: {})}))}));
}
const rows=results.flatMap(r=>r.rows),failures=[];
if(rows.some(r=>r.status!=='completed'||r.frames!==31))failures.push('Incomplete task');
if(rows.some(r=>r.sha256!==rows[0].sha256))failures.push('Complete output/camera hash differs');
const summaries=workflows.flatMap(([variant,workflow])=>['cold-first-task','warm-fresh-task'].map(temperature=>{
 const rows=results.filter(r=>r.variant===variant&&(r.workflow??workflow)===workflow).flatMap(r=>r.rows).filter(r=>r.temperature===temperature),median=k=>rows.map(r=>r[k]).sort((a,b)=>a-b)[Math.floor(rows.length/2)];
 return{variant,workflow,temperature,medianElapsedMs:median('elapsedMs'),medianCpuMs:median('cpuMs'),maxCumulativeProcessFamilyRssKiB:Math.max(...rows.map(r=>r.peakProcessFamilyRssKiB))};
}));
const report={status:failures.length?'failed':'passed',failures,mode,indexedExperiment,at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,commits,bundles,results,summaries,scriptSha256:sha(await readFile(import.meta.filename)),benchmarkSha256:sha(benchmark),lockfileSha256:sha(await readFile('package-lock.json')),
 scope:'Pinned canonical/public workflows. Each task: 1000 particles, initial 200-step warmup, 5 substeps, 31 independent queries plus separate camera replay, complete output hashing. No retained replay cache or workload reduction.',
 measurement:mode==='allocation-profile'?'Inspector allocation sampling at 32768-byte interval, including objects collected by both major and minor GC; allocation estimates are cumulative, not live memory. Profiling perturbs runtime/GC.':mode==='gc-trace'?'Three uninstrumented public-task processes with --trace-gc. Diagnostic logging can alter timing; trace retained per run. No explicit GC.':mode==='sample-natural'?'Three public-task processes, memoryUsage after every query/hash. No --expose-gc, explicit GC or manual variable clearing. Samples after both tasks without GC.':mode==='equivalent'?'Three fresh single-process runs, each cold then warm task. Original uninstrumented benchmark runner, no explicit GC. RSS cumulative including module import; elapsed/CPU exclude import. No subprocesses inside task, so family equals process. Cold does not flush filesystem cache.':mode==='unmodified'?'Three fresh processes per workflow, two tasks each. Unmodified production source; memoryUsage sampling perturbs task timing. No explicit GC or manual variable clearing during either task; GC only after both tasks. The --expose-gc flag is enabled.':'Constructor count and memoryUsage instrumentation. natural has GC after task; per-frame has GC inside task and manually clears output/camera before GC. These are lifetime diagnosis interventions, not production performance.',
 unmeasured:['browser/GPU upload/draw','native JVM parity/cost','agent tokens','build and import elapsed/CPU','video encoding']};
await writeFile('.cache/v2-source-attractor-memory-'+mode+(indexedExperiment?'-indexed-experiment':'')+'.json',JSON.stringify(report,null,2)+'\n');
if(failures.length)process.exitCode=1;
