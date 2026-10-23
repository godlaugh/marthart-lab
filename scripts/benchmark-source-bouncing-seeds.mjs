import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,readdir,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';
const formulas=process.argv.includes('--formulas'),outputAt=process.argv.indexOf('--output');
const output=outputAt>=0?process.argv[outputAt+1]:formulas?'.cache/v2-source-bouncing-formula-seeds-cost.json':'.cache/v2-source-bouncing-seeds-cost.json';
if(!output)throw Error('--output requires a file');
const fixtures=formulas?['bouncing1_formula1','bouncing1_formula2']:['default200000','builtin-bouncing1-2000000'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(command,args,options={})=>{const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024,...options});if(result.status!==0)throw Error(String(result.error||result.stderr||result.stdout));return result.stdout;};
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).sort().map(async p=>['src/'+p,sha(await readFile('src/'+p))])));
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const sourcesBefore=await hashes(),jarHash=sha(await readFile(jar));if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Pinned JAR changed');
await mkdir('.cache',{recursive:true});const directory=await mkdtemp('.cache/bouncing-seeds-cost-');
const originals={};
for(const fixture of fixtures.filter(f=>f!=='default200000')){
 const member='data/Bouncing/'+(fixture==='builtin-bouncing1-2000000'?'bouncing1':fixture)+'.json';
 const raw=run('python3',['-c',"import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))",jar,member]);
 originals[fixture]=sourceBouncingOriginalPreset(Buffer.from(raw));await writeFile(resolve(directory,fixture+'.json'),raw);
}
await build({stdin:{contents:"export {importSourceBouncingConfig} from './src/engine/sourceBouncingConfig';export {generateSourceBouncingSeeds} from './src/engine/sourceBouncingSeeds';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(directory,'api.mjs')});
await writeFile(resolve(directory,'run.mjs'),`
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {importSourceBouncingConfig,generateSourceBouncingSeeds} from './api.mjs';
const [fixture,repeat]=process.argv.slice(2),raw=fixture==='default200000'?{}:JSON.parse(await readFile(new URL('./'+fixture+'.json',import.meta.url),'utf8'));
const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function execute(){
 const start=performance.now(),cpuStart=process.cpuUsage();
 const config=take(importSourceBouncingConfig(raw)).configuration,out=take(generateSourceBouncingSeeds(config));
 const hash=createHash('sha256').update(Buffer.from(out.state.buffer,out.state.byteOffset,out.state.byteLength)).update(JSON.stringify(out.update)).update(JSON.stringify(out.diagnostics)).digest('hex');
 const cpu=process.cpuUsage(cpuStart);return{count:config.particleCount,bytes:out.state.byteLength,sha256:hash,diagnostics:out.diagnostics,elapsedMs:performance.now()-start,cpuMs:(cpu.user+cpu.system)/1000,cumulativePeakRssKiB:process.resourceUsage().maxRSS};
}
console.log(JSON.stringify({fixture,repeat:Number(repeat),rows:[{temperature:'cold-first-task',...execute()},{temperature:'warm-fresh-task',...execute()}]}));
`);
const results=[];for(const fixture of fixtures)for(let repeat=0;repeat<3;repeat++)results.push(JSON.parse(run(process.execPath,[resolve(directory,'run.mjs'),fixture,String(repeat)])));
const failures=[],summaries=[];
for(const fixture of fixtures){
 const all=results.filter(r=>r.fixture===fixture).flatMap(r=>r.rows);if(all.some(r=>r.sha256!==all[0].sha256))failures.push(fixture+': full seeds/update/diagnostics hash changed');
 for(const temperature of ['cold-first-task','warm-fresh-task']){const rows=all.filter(r=>r.temperature===temperature),median=key=>rows.map(r=>r[key]).sort((a,b)=>a-b)[1];summaries.push({fixture,temperature,particles:rows[0].count,medianElapsedMs:median('elapsedMs'),medianCpuMs:median('cpuMs'),maxCumulativePeakRssKiB:Math.max(...rows.map(r=>r.cumulativePeakRssKiB)),diagnostics:rows[0].diagnostics});}
}
const sources=await hashes(),sourceStable=JSON.stringify(sourcesBefore)===JSON.stringify(sources);if(!sourceStable)failures.push('Source changed during measurement');
const report={at:new Date().toISOString(),status:failures.length?'failed':'passed',sourceStable,sources,scriptSha256:sha(await readFile('scripts/benchmark-source-bouncing-seeds.mjs')),reference:{jar,jarHash,originals},results,summaries,failures,scope:'Complete native configuration projection, all initial XYVX/VY slots, world boundary, diagnostics and complete output hashing. Exact selected original presets or the default200000 case. No particles omitted or sampled for digest.',measurement:'Three independent Node processes per fixture, each cold first task and warm new task. Module loading and fixture read excluded from elapsed/CPU; OS cumulative peak RSS includes those and preceding cold task. No children during task, so measured process equals process family. Cold does not mean flushed OS filesystem cache.',baseline:formulas?'Former64M work allowance rejects the full original formula request, so failed versus complete runs are not equivalent throughput baselines.':'Historical initializer runs use the same original input; uncontrolled cache/system conditions prevent a paired speedup claim.',unmeasured:['Original JVM initialization cost','GPU upload/motion/render','Public replay and video export','Browser/driver/VRAM overhead','Agent token usage'],nativeFullFrameParity:false};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,sourceStable,summaries,failures,report:output}));if(failures.length)process.exitCode=1;
