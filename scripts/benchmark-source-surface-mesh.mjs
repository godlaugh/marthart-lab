import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

// One actual shared-formula CPU runtime task, including every update/display,
// filled triangles and coupled wireframe. A budget failure is a measured result,
// not a successful 1-second replay. No production limit is raised here.
const directory=await mkdtemp('.cache/surface-mesh-cost-');
const baselineIndex=process.argv.indexOf('--baseline');
if(baselineIndex>=0&&!process.argv[baselineIndex+1])throw Error('--baseline requires the frozen source directory');
const baseline=baselineIndex<0?undefined:resolve(process.argv[baselineIndex+1]),variants=baseline?['before','after']:['after'];
if(baseline){
 const manifest=JSON.parse(await readFile(resolve(baseline,'manifest.json'),'utf8'));
 for(const [path,hash]of Object.entries(manifest.files))if(createHash('sha256').update(await readFile(resolve(baseline,path))).digest('hex')!==hash)throw Error('Frozen baseline changed: '+path);
}
for(const variant of variants)await build({stdin:{contents:`export {createSourceSurfaceMeshRuntime} from './src/engine/sourceSurfaceMeshRuntime';export {prepareSourceSurfaceFunction} from './src/engine/sourceSurfaceFunction';export {importSourceSurfaceMeshConfig} from './src/engine/sourceSurfaceMeshConfig';`,resolveDir:variant==='before'?baseline:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(directory,variant+'.mjs')});
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
const variant=process.argv[3],scenario=process.argv[4]??'static',{createSourceSurfaceMeshRuntime,prepareSourceSurfaceFunction,importSourceSurfaceMeshConfig}=await import('./'+variant+'.mjs');
const n=Number(process.argv[2]),rows=[],F=Math.fround,fps=60,target=60;
function frameHash(s){
 const hash=createHash('sha256'),g=s.geometry,w=s.wireframe;
 for(const a of [g?.positions,g?.normals,g?.triangles,g?.sourceColorIndices,g?.wireframeIndexedTriangles,g?.wireframeUSeamQuads,s.packedColors,w?.positions])if(a)hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
 const facts={frameIndex:s.frameIndex,animationTime:s.animationTime,seams:g?.seams,fillEnabled:s.fillEnabled,fillOpacity:s.fillOpacity,wireframe:w?{packedColor:w.packedColor,lineWidth:w.lineWidth,mode:w.mode}:null,gradient:s.gradient,paletteState:s.paletteState,tracked:s.tracked,diagnostics:s.diagnostics};
 hash.update(JSON.stringify(facts,(_k,v)=>typeof v==='number'?{number:Object.is(v,-0)?'-0':String(v)}:v));return hash.digest('hex');
}
for(let repeat=0;repeat<(scenario==='static'?3:1);repeat++){
 const cpu=process.cpuUsage(),start=performance.now(),frameHashes=[];let completedFrames=0,externalWorkUnits=0,lastSnapshot,error;
 try{
  const settings={surface_mode:'mesh',mesh_u_segments:n,mesh_v_segments:n,mesh_fill:true,mesh_wireframe:true,periodic_u:true,periodic_v:true,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI'};
  let equations={x:'(R+cos(v))*cos(u)',y:'(R+cos(v))*sin(u)',z:'sin(v)'},parameters={R:2};
  if(['mixed-invalid','wrap-cache','signed-zero'].includes(scenario)){
   Object.assign(settings,{u_max:1,v_max:1,periodic_u:false,periodic_v:false,mesh_wrap_u:scenario==='wrap-cache'});
   equations=scenario==='mixed-invalid'?{x:'u',y:'v',z:'sqrt(u-a)'}:scenario==='signed-zero'?{x:'u',y:'v',z:'1/a'}:{x:'u',y:'v+a*u',z:'u*v*.17'};parameters={a:scenario==='mixed-invalid'?.2:scenario==='signed-zero'?1:.17};
  }
  if(scenario==='decoupled')Object.assign(settings,{mesh_fill:false,wireframe_decoupled:true,wireframe_u_segments:2,wireframe_v_segments:3});
  const parsed=importSourceSurfaceMeshConfig(settings);
  if(!parsed.ok)throw Error(JSON.stringify(parsed.error));const configuration=parsed.value.configuration,t=configuration.transform;
  const prepared=prepareSourceSurfaceFunction({equations,parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
  const oldFunction=prepared.create(),surfaceFunction=scenario==='old-function-identity'?oldFunction.recreate():oldFunction;
  const runtime=createSourceSurfaceMeshRuntime({configuration,surfaceFunction,operationsPerPosition:prepared.operations,frameRate:fps,palette:{colors:['#00FF0000','#4000FF00','#FF0000FF']},reserve:n=>{externalWorkUnits+=n;}});
  const binding=runtime.bind({action:{id:'first',method:'track',args:{index:0}},trackId:'first',actionIndex:0});
  runtime.bind({action:{id:'last',method:'track',args:{index:n*n-1}},trackId:'last',actionIndex:0});
  let sceneTime=0;
  for(let frameIndex=0;frameIndex<=target;frameIndex++){
   const dt=frameIndex===0?0:F(1/fps);sceneTime=F(sceneTime+dt);
   if(scenario==='dynamic-parameters'){
    if(frameIndex===0||frameIndex===35)runtime.beginParameterClip([{name:'R',min:1,max:3,step:.05,edgeEasing:{window:.4,floor:1,easing:'linear'}}]);
    if(frameIndex===20)runtime.finishParameterClip();
   }
   if(scenario==='gradient-callbacks'){
    if(frameIndex===0||frameIndex===45)runtime.beginGradientActions([{kind:'start',config:{mode:frameIndex===0?'cross_fade':'palette_morph',interpolation:'rgb',speed:90}}]);
    if(frameIndex<20)runtime.interpolateGradientActions(F((frameIndex+1)/20),frameIndex===19);
    if(frameIndex===20)runtime.beginGradientActions([]);
    if(frameIndex===30)runtime.beginGradientActions([{kind:'stop'}]);
    if(frameIndex>=30&&frameIndex<40)runtime.interpolateGradientActions(F((frameIndex-29)/10),frameIndex===39);
    if(frameIndex>=45)runtime.interpolateGradientActions(F((frameIndex-44)/16),frameIndex===60);
   }
   if(scenario==='mixed-invalid'&&frameIndex%12===0)surfaceFunction.write('a',frameIndex/60);
   if(scenario==='wrap-cache'&&(frameIndex===20||frameIndex===40))surfaceFunction.write('a',frameIndex===20?.63:-.35);
   if(scenario==='decoupled'&&frameIndex%12===0)surfaceFunction.write('R',2+frameIndex/120);
   if(scenario==='signed-zero'&&frameIndex%15===0)surfaceFunction.write('a',[1,0,-0,1,2][frameIndex/15]);
   if(scenario==='old-function-identity'&&frameIndex%10===0)oldFunction.write('R',99+frameIndex);
   runtime.update({frameIndex,time:sceneTime,deltaTime:dt});runtime.display(frameIndex,frameIndex%4===0?0:frameIndex%4===1?1:frameIndex%4===2?-1:NaN);lastSnapshot=runtime.snapshot();completedFrames++;
   if(binding.kind==='bound'&&JSON.stringify(binding.readPosition())!==JSON.stringify(lastSnapshot.tracked.position))throw Error('Captured tracking binding diverged');
   frameHashes.push(frameHash(lastSnapshot));
  }
 }catch(e){error={name:e.name,code:e.code??null,message:e.message};}
 const used=process.cpuUsage(cpu);
 rows.push({repeat,temperature:repeat===0?'cold-first-task':'warm-runtime-fresh-replay',completed:completedFrames===target+1,completedFrames,requestedFrames:target+1,lastDisplayFrameIndex:lastSnapshot?.frameIndex??null,actualAnimationTime:lastSnapshot?.animationTime??null,elapsedMs:performance.now()-start,userCpuMs:used.user/1000,systemCpuMs:used.system/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,lastCompletedWorkUnits:lastSnapshot?.workUnits??0,externalWorkUnits,frameHashes,...(error?{error}:{})});
}
console.log(JSON.stringify({variant,scenario,grid:[n,n],fps,targetTimeSeconds:1,node:process.version,rows}));
`);
const results=[],scenarios=baseline?['dynamic-parameters','gradient-callbacks','mixed-invalid','wrap-cache','decoupled','signed-zero','old-function-identity']:[];
for(const [n,scenario]of [[12,'static'],[60,'static'],...scenarios.map(name=>[8,name])])for(const variant of variants){
 const child=spawnSync(process.execPath,[runner,String(n),variant,scenario],{encoding:'utf8',maxBuffer:1024*1024});
 if(child.status!==0)throw Error(child.error?.message||child.stderr||child.stdout);
 const result=JSON.parse(child.stdout);
 if(result.rows.some(row=>JSON.stringify(row.frameHashes)!==JSON.stringify(result.rows[0].frameHashes)))throw Error('Repeated source replay diverged');
 results.push(result);
}
const comparisons=[];
if(baseline)for(let i=0;i<results.length;i+=2){
 const before=results[i],after=results[i+1],a=before.rows[0],b=after.rows[0],count=Math.min(a.completedFrames,b.completedFrames);
 for(let frame=0;frame<count;frame++)if(a.frameHashes[frame]!==b.frameHashes[frame])throw Error('Full-frame hash differs: '+before.scenario+' '+before.grid+' frame '+frame);
 if(before.scenario!=='static'&&(!a.completed||!b.completed))throw Error('Equivalence scenario did not complete: '+before.scenario);
 comparisons.push({grid:before.grid,scenario:before.scenario,comparedFrames:count,commonPrefixEqual:true,completeFrameSequenceEqual:a.completed&&b.completed});
}
const paths=['src/engine/sourceSurfaceMeshRuntime.ts','src/engine/sourceSurfaceMeshGeometry.ts','src/engine/sourceSurfaceMeshWireframe.ts','src/engine/sourceSurfaceMeshConfig.ts','src/engine/sourceSurfaceFunction.ts','src/engine/sourceSurfaceColor.ts','src/engine/sourceSurfaceGradient.ts','scripts/benchmark-source-surface-mesh.mjs'];
const sources=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={status:results.filter(x=>x.variant==='after').every(x=>x.rows.every(r=>r.completed))?'completed':'capacity-limited',at:new Date().toISOString(),directory,sources,baseline:baseline??null,results,comparisons,workBudget:20_000_000,
 scope:'Canonical settings import → shared formula → one CPU MeshSurface lifetime; frame0 dt0,time0 then60 Float32 dt=1/60 update/display frames. actualAnimationTime records cumulative source arithmetic. 12×12 complete control and requested60×60 include fill+coupled wire; optional frozen baseline compares every completed frame plus seven full61-frame dynamic cases.',
 measurement:'Bundle/module loading excluded from elapsed/CPU; full-frame hashing included. Separate process per grid/scenario/variant, no descendants during measured work; maxRSS is cumulative process high water. Warm runs reuse JIT but create fresh replays. Frozen pre-cache baseline uses unchanged20M budget; default60 baseline incomplete prefix is explicitly distinguished from full-sequence comparisons.',
 unmeasured:['agent tokens','native JVM application','browser/renderer process-family memory','GPU/VRAM','public importer/mode-switch host','camera timeline scheduling'],nativeParity:false};
await writeFile('.cache/v2-source-surface-mesh-cost.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,comparisons,results:results.map(result=>({...result,rows:result.rows.map(({frameHashes,...row})=>({...row,fullFrameHashCount:frameHashes.length}))}))}));
