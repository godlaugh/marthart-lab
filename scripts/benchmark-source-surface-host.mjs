import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const run=(command,args,options={})=>{const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:64*1024*1024,...options});if(r.status!==0)throw Error(r.error?.message||String(r.stderr)||String(r.stdout));return r.stdout;};
const directory=await mkdtemp('.cache/surface-host-cost-'),baseline=run('git',['rev-parse','72ad17c^{commit}']).trim();
run('tar',['-xf','-','-C',directory],{input:run('git',['archive',baseline,'src'],{encoding:null})});
const common=`export {parseProjectFile} from './src/engine/legacyImport';export {parseScene,serializeScene} from './src/engine/document';export {generateScene} from './src/engine/temporal';export {ordinarySourceViewport} from './src/engine/ordinarySourceCamera';`;
const host=`export {SourceSurfaceHost} from './src/engine/sourceSurfaceHost';export {importSourceSurfaceMeshConfig} from './src/engine/sourceSurfaceMeshConfig';export {evaluateOrdinarySourceCameraTimeline} from './src/engine/ordinarySourceCameraTimeline';`;
const sources={};
for(const variant of ['before','after']){
 const result=await build({stdin:{contents:common+(variant==='after'?host:''),resolveDir:variant==='before'?resolve(directory):process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,outfile:resolve(directory,variant+'.mjs')});
 for(const name of Object.keys(result.metafile.inputs)){if(name==='<stdin>')continue;const path=resolve(name);sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');}
}
const self=resolve('scripts/benchmark-source-surface-host.mjs');sources[self]=createHash('sha256').update(await readFile(self)).digest('hex');
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
const variant=process.argv[2],mode=process.argv[3],api=await import('./'+variant+'.mjs');
function digest(value){const h=createHash('sha256');function put(v){if(ArrayBuffer.isView(v)){h.update(v.constructor.name);h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}else if(Array.isArray(v)){h.update('[');for(const x of v)put(x);h.update(']');}else if(v&&typeof v==='object'){h.update('{');for(const k of Object.keys(v).sort()){if(['elapsedMs','workUnits'].includes(k))continue;h.update(k);put(v[k]);}h.update('}');}else h.update(JSON.stringify(Object.is(v,-0)?'-0':v)??'undefined');}put(value);return h.digest('hex');}
const equations={x:'(a+cos(v))*cos(u)',y:'(a+cos(v))*sin(u)',z:'sin(v)'},parameters={a:2};
const settings={u_segments:40,v_segments:20,mesh_u_segments:40,mesh_v_segments:20,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI',speed_u:.3,speed_v:.2,periodic_u:true,periodic_v:true,show_trails:true,mesh_wireframe:true};
function task(){
 if(mode!=='switch'){
  const raw={config_version:'1.0.0',type:'SURFACE',name:'Host regression',equations,parameters,palette:['#FF0000','#0000FF'],settings:{...settings,surface_mode:mode==='mesh'?'MESH':'POINTS'},timeline:[{type:'animate',duration:2,actions:[{method:'track',args:[410]}]}]};
  const scene=api.parseScene(api.serializeScene(api.parseProjectFile(JSON.stringify(raw)).scene)),h=createHash('sha256');
  for(let i=0;i<20;i++)h.update(digest(api.generateScene(scene,{time:i/10,width:320,height:240,quality:'preview',sourceViewport:api.ordinarySourceViewport(scene,320,240,'primary',240)})));
  return{sha256:h.digest('hex'),requestedQueries:20,completedQueries:20};
 }
 const parsed=api.importSourceSurfaceMeshConfig({...settings,u_segments:12,v_segments:12,mesh_u_segments:12,mesh_v_segments:12});if(!parsed.ok)throw Error(JSON.stringify(parsed.error));
 const surface=new api.SourceSurfaceHost({configuration:parsed.value.configuration,equations,parameters,frameRate:60,coverage:'all'}),tracks=[];
 for(let i=0;i<6;i++)tracks.push({id:String(i),type:'surface_mode_transition',surfaceMode:i%2?'points':'mesh',target:'surface',from:0,to:0,start:0,duration:.25,easing:'linear',enabled:true,pingPong:false});
 const frame=api.evaluateOrdinarySourceCameraTimeline({phi:0,theta:0,gamma:0,zoom:1,focalDistance:250,center:[0,0,0]},tracks,60,1.75,{particleActions:'surface',surfaceMode:'points',createParticles:()=>surface});
 if(!frame.queueComplete||surface.generation!==6||frame.frameIndex!==105)throw Error('Switch sequence did not complete all six replacements and 106 frames');
 return{sha256:digest({frame,snapshot:surface.snapshot()}),requestedFrames:106,completedFrames:frame.frameIndex+1,generations:surface.generation,workUnits:surface.workUnits};
}
const rows=[];
for(let repeat=0;repeat<3;repeat++){const cpu=process.cpuUsage(),start=performance.now();const facts=task(),used=process.cpuUsage(cpu);rows.push({repeat,temperature:repeat===0?'cold-first-task':'warm-runtime-fresh-task',elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,...facts});}
console.log(JSON.stringify({variant,mode,rows}));
`);
const results=[];
for(const mode of ['points','mesh'])for(const variant of ['before','after'])results.push(JSON.parse(run(process.execPath,[runner,variant,mode])));
results.push(JSON.parse(run(process.execPath,[runner,'after','switch'])));
const comparisons=[0,2].map(i=>({mode:results[i].mode,equal:results[i].rows.every((r,j)=>r.sha256===results[i+1].rows[j].sha256)}));
const repeatStable=results.every(r=>r.rows.every(x=>x.sha256===r.rows[0].sha256));
const sourceStable=(await Promise.all(Object.entries(sources).map(async([path,hash])=>createHash('sha256').update(await readFile(path)).digest('hex')===hash))).every(Boolean);
const report={status:comparisons.every(r=>r.equal)&&repeatStable&&sourceStable?'passed':'failed',at:new Date().toISOString(),baseline,directory,sources,sourceStable,repeatStable,comparisons,results,
 scope:'Existing public CPU point/mesh import-save-reopen and 20 full generated frames compared with pinned baseline. New host runs 106 frames with six mode replacements; no pre-feature equivalent. Exact typed arrays and camera facts hashed; timing/work counts excluded.',
 measurement:'Serial independent process per variant/task, one cold then two fresh warm runs. Time/CPU include task and hashing, exclude build/module load; maxRSS includes module load and is process cumulative high-water. No children during measured task.',
 unmeasured:['agent tokens','GPU/rasterization/PNG','browser process-family memory','native JVM/JOGL costs','original full-frame parity'],nativeParity:false};
await writeFile('.cache/v2-source-surface-host-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,comparisons,results},null,2));if(report.status!=='passed')process.exitCode=1;
