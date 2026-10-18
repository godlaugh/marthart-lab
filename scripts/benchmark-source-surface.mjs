import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
// Local CPU workloads only. Scalar comparison uses the same source grammar and
// double outputs. Geometry has no equivalent native baseline; it is a profile,
// not an assertion of speedup, original runtime equivalence or video throughput.
const includeTrails=process.argv.includes('--trails');
const directory=await mkdtemp('.cache/source-surface-cost-'),entry=resolve(directory,'entry.mjs');
await build({stdin:{contents:`export {prepareSourceRealExpression,prepareDomainSourceScalar} from './src/engine/domainSourceScalar';export {parseProjectFile} from './src/engine/legacyImport';export {parseScene,serializeScene} from './src/engine/document';export {generateScene} from './src/engine/temporal';export {ordinarySourceViewport} from './src/engine/ordinarySourceCamera';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:entry});
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
import * as api from './entry.mjs';
const mode=process.argv[2],rows=[];
for(let repeat=0;repeat<3;repeat++){
 const start=performance.now(),cpu=process.cpuUsage(),hash=createHash('sha256');let outputs=0;
 if(mode==='scalar'||mode==='compiled'){
  const formulas=['(2+cos(v))*cos(u)','(2+cos(v))*sin(u)','sin(v)'],names=['u','v'];
  const compiled=mode==='compiled'?formulas.map(f=>{const r=api.prepareSourceRealExpression(f,names);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}):null;
  const variables=new Float64Array(2),bindings=new Map(),values=new Float64Array(30000*3);
  for(let i=0;i<30000;i++){
   variables[0]=(i%100)/16;variables[1]=Math.floor(i/100)/64;bindings.set('u',variables[0]);bindings.set('v',variables[1]);
   for(let j=0;j<3;j++){
    if(compiled)values[i*3+j]=compiled[j].evaluate(variables);
    else{const r=api.prepareDomainSourceScalar(formulas[j],{precision:'float64',fallback:NaN,bindings});if(!r.ok||r.facts.route!=='expression')throw Error('scalar failed');values[i*3+j]=r.facts.value;}
   }
  }
  hash.update(Buffer.from(values.buffer));outputs=values.length;
 }else{
  const raw={config_version:'1.0.0',type:'SURFACE',name:'CPU cost',equations:{x:'(2+cos(v))*cos(u)',y:'(2+cos(v))*sin(u)',z:'sin(v)'},settings:{show_trails:mode==='geometry-trails',u_segments:40,v_segments:20,periodic_u:true,periodic_v:true,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI'},timeline:[{type:'animate',duration:2,actions:[{method:'track',args:[410]}]}]};
  const scene=api.parseScene(api.serializeScene(api.parseProjectFile(JSON.stringify(raw)).scene));
  for(let i=0;i<20;i++){
   const out=api.generateScene(scene,{time:i/10,width:320,height:240,quality:'preview',sourceViewport:api.ordinarySourceViewport(scene,320,240,'primary',240)});
   hash.update(Buffer.from(out.positions.buffer));hash.update(JSON.stringify(out.sourceCameraFrame));if(out.trails){for(const array of [out.trails.positions,out.trails.indices,out.trails.alphas,out.trails.colors])hash.update(Buffer.from(array.buffer));}outputs+=out.positions.length/3;
  }
 }
 const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);
 rows.push({repeat,temperature:repeat===0?'cold-module-first-task':'warm-runtime-fresh-replay',elapsedMs,cpuMs:(used.user+used.system)/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,outputs,sha256:hash.digest('hex')});
}
console.log(JSON.stringify({mode,node:process.version,rows}));
`);
const results=[];
for(const mode of ['scalar','compiled','geometry',...(includeTrails?['geometry-trails']:[])]){
 const child=spawnSync(process.execPath,[runner,mode],{encoding:'utf8'});if(child.status!==0)throw Error(child.stderr||child.stdout);results.push(JSON.parse(child.stdout));
}
const scalar=results[0].rows,compiled=results[1].rows;
if(results.some(result=>result.rows.some(row=>row.sha256!==result.rows[0].sha256))||scalar.some((row,i)=>row.sha256!==compiled[i].sha256))throw Error('Equivalent output hashes differ');
let baseline;
if(includeTrails){const previous=await readFile('.cache/v2-source-surface-cost.json','utf8'),parsed=JSON.parse(previous);baseline={report:'.cache/v2-source-surface-cost.json',sha256:createHash('sha256').update(previous).digest('hex'),results:parsed.results};for(const old of parsed.results){const current=results.find(r=>r.mode===old.mode);if(old.rows[0].sha256!==current?.rows[0].sha256)throw Error('Previous heads/scalar output changed');}}
const sourcePaths=['src/engine/domainSourceScalar.ts','src/engine/sourceSurfaceParticles.ts','src/scenes/sourceSurface.ts','src/engine/legacyImport.ts','src/engine/ordinarySourceCameraTimeline.ts','scripts/benchmark-source-surface.mjs'];
const sources=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={at:new Date().toISOString(),status:'passed',directory,sources,results,baseline,scope:'Scalar: 30000 three-formula evaluations, equal Float64 SHA256. Geometry: public import/save/reopen plus 20 fresh seeks, 40×20 CPU points, camera and colors. Optional geometry-trails also hashes full line geometry, topology, alpha and colors. No renderer, Worker or video encoding.',measurement:'Compilation/module loading excluded. Each mode is a new child; no descendants during measured work. maxRSS is cumulative process high water, not allocation delta. Warm rows retain JIT/runtime only, not particle replay state.',unmeasured:['agent tokens','GPU/VRAM','original app cost','video export throughput','browser process-family memory'],originalRuntimeParity:false};
await writeFile(includeTrails?'.cache/v2-source-surface-trails-cost.json':'.cache/v2-source-surface-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.results,null,2));
