import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const pointAppearance=process.argv.includes('--point-appearance'),gradientFoundation=process.argv.includes('--gradient-foundation');
if(pointAppearance&&gradientFoundation)throw Error('Select one comparison baseline');
const directory=await mkdtemp('.cache/surface-color-cost-'),baseline=resolve(directory,'baseline');await mkdir(baseline);
const run=(command,args,options={})=>{const result=spawnSync(command,args,{maxBuffer:64*1024*1024,...options});if(result.status!==0)throw Error(String(result.error||result.stderr||result.stdout));return result.stdout;};
// Pin the pre-color implementation so rerunning after commit compares the same task.
const commit=String(run('git',['rev-parse',(gradientFoundation?'acac5bfec6947161a16c097dd0b0e49e8c3d8122':pointAppearance?'3bccbb3f58758dd350f06e69c4879cfe31a298dc':'7457b36a8c809aac1fc36b4fc620192cec5db388')+'^{commit}'])).trim(),archive=run('git',['archive',commit,'src']);
run('tar',['-x','-C',baseline],{input:archive});
const contents=`export {parseProjectFile} from './src/engine/legacyImport';export {parseScene,serializeScene} from './src/engine/document';export {generateScene} from './src/engine/temporal';export {ordinarySourceViewport} from './src/engine/ordinarySourceCamera';`;
for(const [name,root] of [['before',baseline],['after',process.cwd()]])await build({stdin:{contents,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(directory,name+'.mjs')});
const runner=resolve(directory,'run.mjs');await writeFile(runner,`
import {createHash} from 'node:crypto';
const variant=process.argv[2],trails=process.argv[3]==='trails',api=await import('./'+variant+'.mjs'),rows=[];
for(let repeat=0;repeat<3;repeat++){
 const start=performance.now(),cpu=process.cpuUsage(),geometry=createHash('sha256'),appearance=createHash('sha256');let bytes=0;
 const raw={config_version:'1.0.0',type:'SURFACE',name:'Color cost',palette:['#FF0000','#0000FF'],equations:{x:'(2+cos(v))*cos(u)',y:'(2+cos(v))*sin(u)',z:'sin(v)'},settings:{show_trails:trails,u_segments:40,v_segments:20,periodic_u:true,periodic_v:true,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI'},timeline:[{type:'animate',duration:2,actions:[{method:'track',args:[410]}]}]};
 const scene=api.parseScene(api.serializeScene(api.parseProjectFile(JSON.stringify(raw)).scene));
 for(let i=0;i<20;i++){
  const out=api.generateScene(scene,{time:i/10,width:320,height:240,quality:'preview',sourceViewport:api.ordinarySourceViewport(scene,320,240,'primary',240)});
  geometry.update(Buffer.from(out.positions.buffer));geometry.update(JSON.stringify(out.sourceCameraFrame));
  if(out.trails){geometry.update(Buffer.from(out.trails.positions.buffer));geometry.update(Buffer.from(out.trails.indices.buffer));}
  for(const value of [out.colors,out.pointAlphas,out.trails?.colors,out.trails?.alphas])if(value){appearance.update(Buffer.from(value.buffer));bytes+=value.byteLength;}
 }
 const used=process.cpuUsage(cpu);rows.push({repeat,temperature:repeat===0?'cold-first-task':'warm-runtime-fresh-replays',elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,appearanceOutputBytes:bytes,geometrySha256:geometry.digest('hex'),appearanceSha256:appearance.digest('hex')});
}
console.log(JSON.stringify({variant,trails,node:process.version,rows}));
`);
const results=[];for(const mode of ['heads','trails'])for(const variant of ['before','after'])results.push(JSON.parse(run(process.execPath,[runner,variant,mode],{encoding:'utf8'})));
for(const result of results)if(result.rows.some(row=>row.geometrySha256!==result.rows[0].geometrySha256||row.appearanceSha256!==result.rows[0].appearanceSha256))throw Error('Same variant replay changed');
for(let i=0;i<results.length;i+=2){if(results[i].rows[0].geometrySha256!==results[i+1].rows[0].geometrySha256)throw Error('Particle, camera or trail geometry changed');if(pointAppearance||gradientFoundation?results[i].rows[0].appearanceSha256!==results[i+1].rows[0].appearanceSha256:results[i].rows[0].appearanceSha256===results[i+1].rows[0].appearanceSha256)throw Error('Unexpected color/alpha hash relationship');}
const paths=['src/engine/sourceSurfaceGradient.ts','src/engine/sourceSurfacePointAppearance.ts','src/engine/sourceSurfaceColor.ts','src/engine/sourceSurfaceParticles.ts','src/scenes/sourceSurface.ts','src/engine/legacyImport.ts','src/engine/timeline.ts','scripts/benchmark-source-surface-color.mjs'];
const sources=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const report={status:'passed',at:new Date().toISOString(),baselineCommit:commit,directory,sources,results,scope:'Public import/save/reopen and twenty 40×20 CPU Surface seeks, 3 runs per variant with/without trails. Geometry/camera checked separately from appearance.',pointAppearance,gradientFoundation,measurement:'Build and module loading excluded. Each variant/mode has an isolated child, no child descendants during measured task. Warm means JIT/runtime only; replays remain fresh. maxRSS is process cumulative high water, not allocation delta.',unmeasured:['agent tokens','browser/renderer process-family memory','GPU/VRAM','original application cost','video throughput','point material upload/draw cost (Node geometry benchmark only)'],nativeParity:false};
await writeFile(gradientFoundation?'.cache/v2-source-surface-gradient-cost.json':pointAppearance?'.cache/v2-source-point-cost.json':'.cache/v2-source-surface-color-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,results}));
