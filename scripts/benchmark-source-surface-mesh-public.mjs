import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Pin the last source runtime before public replay/publication integration.
// No dependency installation, desktop build, source mutation or native claim.
const baselineRef='6a04d61',directory=await mkdtemp('.cache/surface-mesh-public-cost-');
const run=(cmd,args,options={})=>{const result=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:128*1024*1024,...options});if(result.status!==0)throw Error(result.error?.message||String(result.stderr)||String(result.stdout));return result.stdout;};
const baselineCommit=run('git',['rev-parse',baselineRef+'^{commit}']).trim();
const archive=run('git',['archive','--format=tar',baselineCommit,'src'],{encoding:null});
run('tar',['-xf','-','-C',directory],{input:archive});
const runtimeExports=`export {createSourceSurfaceMeshRuntime} from './src/engine/sourceSurfaceMeshRuntime';export {prepareSourceSurfaceFunction} from './src/engine/sourceSurfaceFunction';export {importSourceSurfaceMeshConfig} from './src/engine/sourceSurfaceMeshConfig';`;
const publicExports=`export {parseProjectFile} from './src/engine/legacyImport';export {parseScene,serializeScene} from './src/engine/document';export {sceneAtTime} from './src/engine/timeline';export {generateScene} from './src/engine/temporal';export {ordinarySourceViewport} from './src/engine/ordinarySourceCamera';export {replaySourceSurfaceHost} from './src/engine/sourceSurfaceScene';`;
const scriptPath=resolve('scripts/benchmark-source-surface-mesh-public.mjs');
const sourceHashes={[scriptPath]:createHash('sha256').update(await readFile(scriptPath)).digest('hex')};
for(const variant of ['before','after','public']){
 const root=variant==='before'?resolve(directory):process.cwd();
 const result=await build({stdin:{contents:variant==='public'?publicExports:runtimeExports,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,outfile:resolve(directory,variant+'.mjs')});
 for(const name of Object.keys(result.metafile.inputs)){if(name==='<stdin>')continue;const path=resolve(name);sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');}
}
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
const variant=process.argv[2],n=Number(process.argv[3]),scenario=process.argv[4],api=await import('./'+variant+'.mjs'),F=Math.fround;
function digest(value){const hash=createHash('sha256');function put(v){if(ArrayBuffer.isView(v)){hash.update(v.constructor.name+':'+v.byteLength+':');hash.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}else if(Array.isArray(v)){hash.update('[');for(const x of v)put(x);hash.update(']');}else if(v&&typeof v==='object'){hash.update('{');for(const key of Object.keys(v).sort()){if(key==='workUnits'||key==='elapsedMs')continue;hash.update(JSON.stringify(key));put(v[key]);}hash.update('}');}else hash.update(JSON.stringify(typeof v==='number'?(Object.is(v,-0)?'-0':String(v)):v)??'undefined');}put(value);return hash.digest('hex');}
function configuration(){return{surface_mode:'MESH',render_mode:'CPU',mesh_u_segments:n,mesh_v_segments:n,mesh_fill:true,mesh_wireframe:true,mesh_wrap_u:true,mesh_wrap_v:true,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI',periodic_u:true,periodic_v:true,scale_x:25,scale_y:25,scale_z:25};}
const equations={x:'(R+cos(v))*cos(u)',y:'(R+cos(v))*sin(u)',z:'sin(v)'},parameters={R:2};
function runtimeTask(){
 const parsed=api.importSourceSurfaceMeshConfig(configuration());if(!parsed.ok)throw Error(JSON.stringify(parsed.error));const config=parsed.value.configuration,t=config.transform;
 const prepared=api.prepareSourceSurfaceFunction({equations,parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 const surfaceFunction=prepared.create(),runtime=api.createSourceSurfaceMeshRuntime({configuration:config,surfaceFunction,operationsPerPosition:prepared.operations,frameRate:60,palette:{colors:['#FF3377','#33AAFF']}});
 const bound=runtime.bind({action:{id:'track',method:'track',args:{index:n*n-1}},trackId:'t',actionIndex:0});
 let time=0,completedFrames=0;
 for(let frameIndex=0;frameIndex<=60;frameIndex++){
  const dt=frameIndex===0?0:F(1/60);time=F(time+dt);
  if(scenario==='changing-slots'&&frameIndex%10===0)surfaceFunction.write('R',2+frameIndex/100);
  if(scenario==='gradient-callbacks'){
   if(frameIndex===0)runtime.beginGradientActions([{kind:'start',config:{mode:'cross_fade',interpolation:'oklab',speed:90}}]);
   runtime.interpolateGradientActions(F(frameIndex/60),frameIndex===60);
  }
  runtime.update({frameIndex,time,deltaTime:dt});
  runtime.display(frameIndex,frameIndex%2===0?1:2,variant==='before'||frameIndex===60);completedFrames++;
 }
 const snapshot=runtime.snapshot();if(bound.kind!=='bound'||digest(bound.readPosition())!==digest(snapshot.tracked.position))throw Error('Tracking binding differs from published position');
 return{completedFrames,requestedFrames:61,workUnits:snapshot.workUnits,actualAnimationTime:snapshot.animationTime,finalHash:digest(snapshot),trackedPositionHash:digest(bound.readPosition())};
}
function source(){
 const actions=[{method:'track',args:[n*n-1]},{method:'rotatePhi',args:[.5]}];
 if(scenario==='dynamic-camera')actions.push({method:'paramStart',args:{parameters:{R:{min:1,max:3,step:.025}}}},{method:'gradientStart',args:{mode:'CROSS_FADE',speed:90}});
 return{config_version:'1.0.0',type:'SURFACE',name:'Public source mesh measurement',equations,parameters,settings:configuration(),camera:{phi:.2,theta:.1,gamma:0},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions}]};
}
function publicTask(){
 const imported=api.parseProjectFile(JSON.stringify(source())).scene,serialized=api.serializeScene(imported),scene=api.parseScene(serialized);scene.timeline.fps=60;
 const evaluated=api.sceneAtTime(scene,1),output=api.generateScene(scene,{time:1,width:320,height:180,quality:'preview',sourceViewport:api.ordinarySourceViewport(scene,320,180,'offscreen',180)});
 if(output.type!=='geometry')throw Error('Expected public mesh geometry');
 const frame=output.sourceCameraFrame,cameraFacts=f=>({time:f.time,frameIndex:f.frameIndex,camera:f.camera,sceneTime:f.sceneTime,queueIndex:f.queueIndex,queueComplete:f.queueComplete,diagnostics:f.diagnostics});
 if(digest(cameraFacts(evaluated.evaluatedSourceCamera))!==digest(cameraFacts(frame)))throw Error('Tracked-only sceneAtTime and all-geometry camera facts differ');
 return{completedFrames:frame.frameIndex+1,requestedFrames:61,serializedBytes:Buffer.byteLength(serialized),cameraFactsEqual:true,cameraHash:digest(cameraFacts(frame)),finalHash:digest(output)};
}
const rows=[];
for(let repeat=0;repeat<3;repeat++){
 const cpu=process.cpuUsage(),start=performance.now();let facts,error;
 try{facts=variant==='public'?publicTask():runtimeTask();}catch(e){error={name:e.name,code:e.code??null,message:e.message};}
 const used=process.cpuUsage(cpu);rows.push({repeat,temperature:repeat===0?'cold-first-task':'warm-runtime-fresh-task',completed:!error,elapsedMs:performance.now()-start,userCpuMs:used.user/1000,systemCpuMs:used.system/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,...facts,...(error?{error}:{})});
}
console.log(JSON.stringify({variant,grid:[n,n],scenario,node:process.version,rows}));
`);
const results=[];
for(const [n,scenario]of [[12,'static'],[60,'static'],[8,'changing-slots'],[8,'gradient-callbacks']])for(const variant of ['before','after'])results.push(JSON.parse(run(process.execPath,[runner,variant,String(n),scenario])));
for(const [n,scenario]of [[12,'import-save-seek-generate'],[60,'import-save-seek-generate'],[8,'dynamic-camera']])results.push(JSON.parse(run(process.execPath,[runner,'public',String(n),scenario])));
const comparisons=[];
for(let i=0;i<8;i+=2){const before=results[i],after=results[i+1];comparisons.push({grid:before.grid,scenario:before.scenario,complete:before.rows.every(r=>r.completed)&&after.rows.every(r=>r.completed),finalOutputAndFactsEqual:before.rows.every((r,j)=>r.finalHash!==undefined&&r.finalHash===after.rows[j].finalHash)});}
const repeatStable=results.every(result=>result.rows.every(row=>row.finalHash!==undefined&&row.finalHash===result.rows[0].finalHash));
const currentHashes=Object.fromEntries(await Promise.all(Object.keys(sourceHashes).map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const sourceStable=JSON.stringify(currentHashes)===JSON.stringify(sourceHashes);
const completed=results.every(result=>result.rows.every(row=>row.completed))&&comparisons.every(row=>row.finalOutputAndFactsEqual)&&repeatStable&&sourceStable;
const report={status:completed?'passed':'failed',at:new Date().toISOString(),baselineCommit,directory,sourceHashes,sourceStable,repeatStable,comparisons,results,
 scope:'Pinned pre-public runtime publishes all 61 frames; current runtime performs all source display work but publishes only requested final frame. Exact final typed arrays, source facts, gradients and tracking compared, excluding workUnits. Public task imports original mesh, serializes and reopens, queries sceneAtTime(1) and generateScene(1), compares complete shared camera facts. Public task has no pre-feature baseline.',
 measurement:'Single independent child per variant/grid/scenario; build and module import excluded. Each child performs one cold task then two fresh warm tasks; final hashing included equally. No child processes during measured work; maxRSS is cumulative child process high-water and includes module load. Grid60 workload is coupled fill+wire static geometry with tracking, not continuously deforming geometry. Public serialization IDs are excluded from hashes.',
 unmeasured:['agent token usage','native JVM or JOGL','browser/renderer process-family memory','GPU/VRAM','image rasterization and PNG encoding','other surface modes','long continuously deforming grids'],nativeParity:false};
await writeFile('.cache/v2-source-surface-mesh-public-cost.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,sourceStable,comparisons,results},null,2));
if(!completed)process.exitCode=1;
