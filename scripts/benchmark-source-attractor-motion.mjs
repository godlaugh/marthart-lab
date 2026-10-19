import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const hash=b=>createHash('sha256').update(b).digest('hex');
const run=(command,args,options={})=>{const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,...options});if(r.status!==0)throw Error(r.error?.message||String(r.stderr)||String(r.stdout));return r.stdout;};
const directory=await mkdtemp('.cache/attractor-motion-cost-'),baseline=run('git',['rev-parse','e37c203^{commit}']).trim();
run('tar',['-xf','-','-C',directory],{input:run('git',['archive',baseline,'src'],{encoding:null})});
const common="export {prepareRootsNativeSampling} from './src/engine/rootsNativeSampling';";
const motion="export {importSourceAttractorConfig} from './src/engine/sourceAttractorConfig';export {prepareSourceAttractorEquation} from './src/engine/sourceAttractorEquation';export {SourceAttractorCpuParticles} from './src/engine/sourceAttractorCpuParticles';";
const sources={};
for(const variant of ['before','after']){
 const result=await build({stdin:{contents:common+(variant==='after'?motion:''),resolveDir:variant==='before'?resolve(directory):process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,outfile:resolve(directory,variant+'.mjs')});
 for(const name of Object.keys(result.metafile.inputs)){if(name==='<stdin>')continue;const path=resolve(name);sources[path]=hash(await readFile(path));}
}
const self=resolve('scripts/benchmark-source-attractor-motion.mjs');sources[self]=hash(await readFile(self));
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
const api=await import('./'+process.argv[2]+'.mjs'),mode=process.argv[3];
const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function task(){
 const h=createHash('sha256');
 if(mode==='roots'){
  const parameters=['REAL_RANGE','COMPLEX_RECT','UNIT_CIRCLE'].map((domain,i)=>({name:'t'+i,domain,minRe:-5,maxRe:5,minIm:-1,maxIm:1,value:[2,3]}));
  const p=unwrap(api.prepareRootsNativeSampling(parameters,{sampleCount:20000,batchSize:256,workerCount:4,seed:'12345',filter:''}));
  for(let i=0;i<20000;i++){const value=unwrap(p.sampleAt(i));h.update(JSON.stringify({...value,values:[...value.values]}));}
  return{sha256:h.digest('hex'),completedSamples:20000};
 }
 const configuration=unwrap(api.importSourceAttractorConfig({particle_count_cpu:1000,sub_steps:5,time_step_min:.005,time_step_max:.01},{warmup_steps:200,warmup_stagger_max:20})).configuration;
 const equation=unwrap(api.prepareSourceAttractorEquation({equations:{dx:'sigma*(y-x)',dy:'x*(rho-z)-y',dz:'x*y-beta*z'},parameters:{sigma:10,rho:28,beta:8/3}}));
 const p=new api.SourceAttractorCpuParticles({configuration,equation});
 for(let frameIndex=0;frameIndex<31;frameIndex++){
  p.update({frameIndex,time:(frameIndex+1)/30,deltaTime:1/30});const s=p.snapshot();
  for(const array of [s.rawPositions,s.positions,s.timeSteps,s.integrationSteps])h.update(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
 }
 const s=p.snapshot();return{sha256:h.digest('hex'),completedFrames:31,particles:s.positions.length/3,integrations:Array.from(s.integrationSteps).reduce((a,b)=>a+b,0),workUnits:s.workUnits,finalSnapshotBytes:s.rawPositions.byteLength+s.positions.byteLength+s.timeSteps.byteLength+s.integrationSteps.byteLength};
}
const rows=[];for(let repeat=0;repeat<3;repeat++){const cpu=process.cpuUsage(),start=performance.now(),facts=task(),used=process.cpuUsage(cpu);rows.push({repeat,temperature:repeat===0?'cold-first-task':'warm-runtime-fresh-task',elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,...facts});}
console.log(JSON.stringify({variant:process.argv[2],mode,rows}));
`);
const results=[];
for(const [variant,mode]of [['before','roots'],['after','roots'],['after','attractor']])results.push(JSON.parse(run(process.execPath,[runner,variant,mode])));
const equal=results[0].rows.every((r,i)=>r.sha256===results[1].rows[i].sha256),repeatStable=results.every(r=>r.rows.every(x=>x.sha256===r.rows[0].sha256));
const sourceStable=(await Promise.all(Object.entries(sources).map(async([path,digest])=>hash(await readFile(path))===digest))).every(Boolean);
const report={at:new Date().toISOString(),status:equal&&repeatStable&&sourceStable?'passed':'failed',baseline,directory,sources,sourceStable,repeatStable,equal,results,
 scope:'Before/after complete Roots source sampler task with 20,000 samples, four worker partitions and real/rectangle/circle domains; exact full sample facts hashed. New source CPU Attractor motion task: 1000 particles, 200+0..20 warmup, 31 active frames with five substeps and all full-state snapshots. No old native-equivalent motion path.',
 measurement:'Serial independent process per task; first run cold then two warm fresh tasks. Time/CPU include task and hashing, exclude module loading; peak RSS includes module loading and is process cumulative high-water. No children during measured task.',
 unmeasured:['agent tokens','public UI/import/export','GPU and drawing','browser process-family memory','native JVM costs','native framebuffer parity']};
await writeFile('.cache/v2-attractor-source-motion-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,equal,results},null,2));if(report.status!=='passed')process.exitCode=1;
