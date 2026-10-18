import {build} from 'esbuild';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';

// CPU object construction only. No renderer/WebGL context is created. Freeze
// both source variants and compare identical inputs, not independently replayed
// runtimes whose differences could obscure a renderer regression.
const baselineRef='40d05e8',root=process.cwd(),directory=await mkdtemp('.cache/surface-line-renderer-cost-');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const baselineCommit=git('rev-parse',baselineRef+'^{commit}').toString().trim();
const baselineDirectory=resolve(directory,'before'),currentDirectory=resolve(directory,'after');
const baselineFiles=git('ls-tree','-r','--name-only',baselineCommit,'--','src').toString().trim().split('\n');
const beforeManifest={commit:baselineCommit,files:{}};
for(const path of baselineFiles){
 const bytes=git('show',baselineCommit+':'+path),destination=resolve(baselineDirectory,path);
 await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);beforeManifest.files[path]=sha(bytes);
}
await writeFile(resolve(baselineDirectory,'manifest.json'),JSON.stringify(beforeManifest,null,2)+'\n');
const exports={before:"export {createSourceSurfaceMeshFill} from './src/engine/sourceSurfaceMeshRenderer';",after:"export {createSourceSurfaceMeshFill} from './src/engine/sourceSurfaceMeshRenderer';export {createSourceSurfaceMeshLines} from './src/engine/sourceSurfaceLineRenderer';",fixtures:"export {createSourceSurfaceMeshRuntime} from './src/engine/sourceSurfaceMeshRuntime';export {prepareSourceSurfaceFunction} from './src/engine/sourceSurfaceFunction';export {importSourceSurfaceMeshConfig} from './src/engine/sourceSurfaceMeshConfig';export {prepareSourceCamera} from './src/engine/sourceCamera';"};
// Discover complete local dependency inputs; external installed packages are
// shared by both variants and separately identified in the report.
const discovered=new Set();
for(const name of ['after','fixtures']){
 const result=await build({stdin:{contents:exports[name],resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,metafile:true,logLevel:'silent'});
 for(const path of Object.keys(result.metafile.inputs))if(path!=='<stdin>')discovered.add(path);
}
const afterManifest={files:{}};
for(const path of [...discovered].sort()){
 const bytes=await readFile(path),destination=resolve(currentDirectory,path);
 await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);afterManifest.files[path]=sha(bytes);
}
await writeFile(resolve(currentDirectory,'manifest.json'),JSON.stringify(afterManifest,null,2)+'\n');
for(const name of ['before','after','fixtures'])await build({stdin:{contents:exports[name],resolveDir:name==='before'?baselineDirectory:currentDirectory,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:resolve(directory,name+'.mjs'),logLevel:'silent'});
const runner=resolve(directory,'run.mjs');
await writeFile(runner,`
import {createHash} from 'node:crypto';
const [variant,kind,grid]=process.argv.slice(2),n=Number(grid),api=await import('./'+variant+'.mjs');
const {createSourceSurfaceMeshRuntime,prepareSourceSurfaceFunction,importSourceSurfaceMeshConfig,prepareSourceCamera}=await import('./fixtures.mjs');
const parsed=importSourceSurfaceMeshConfig({surface_mode:'mesh',mesh_u_segments:n,mesh_v_segments:n,mesh_fill:true,mesh_wireframe:true,mesh_fill_opacity:.9,periodic_u:true,periodic_v:true,u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI'});
if(!parsed.ok)throw Error(JSON.stringify(parsed.error));
const prepared=prepareSourceSurfaceFunction({equations:{x:'(2+cos(v))*cos(u)',y:'(2+cos(v))*sin(u)',z:'sin(v)'},parameters:{},scales:[24,24,24],offsets:[0,0,0]});
const runtime=createSourceSurfaceMeshRuntime({configuration:parsed.value.configuration,surfaceFunction:prepared.create(),operationsPerPosition:prepared.operations,frameRate:60,palette:{colors:['#00FF0000','#4000FF00','#FF0000FF']}});
runtime.update({frameIndex:0,time:0,deltaTime:0});runtime.display(0);
const snapshot=runtime.snapshot(),g=snapshot.geometry;
if(!g||!snapshot.wireframe)throw Error('Missing mesh fixture');
const output={type:'geometry',topology:'mesh',positions:g.positions,indices:g.triangles,sourceMeshColors:snapshot.packedColors,sourceMeshAppearance:{model:'surface-cpu-mesh-1.7.8',fillEnabled:true,fillAlphaByte:Math.trunc(Math.fround(Math.fround(.9)*255))},stats:{samples:n*n,generated:g.positions.length/3,invalid:0}};
const plans=Array.from({length:61},(_,frame)=>{
 const parsed=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'angles',family:'surface',phi:.4+frame*.011,theta:-.5+frame*.019,gamma:frame*.003},frame:{zoom:1+frame*.002,center:[frame*.01,-frame*.013,frame*.007]}},{logicalWidth:384,logicalHeight:256,referenceLogicalHeight:128,target:'offscreen',projectionPass:frame%3===0?'scene-fade-orthographic':'perspective'});
 if(!parsed.ok||parsed.value.kind!=='known')throw Error('Camera preparation failed');return parsed.value.plan;
});
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const hashInputs=()=>{const h=createHash('sha256');for(const a of [g.positions,g.triangles,snapshot.packedColors,snapshot.wireframe.positions])h.update(bytes(a));h.update(JSON.stringify({lineWidth:snapshot.wireframe.lineWidth,packedColor:snapshot.wireframe.packedColor,plans}));return h.digest('hex');};
const inputHash=hashInputs(),rows=[];
for(let repeat=0;repeat<3;repeat++){
 const frameHashes=[];let geometryDisposed=0,materialDisposed=0,bufferBytes=0;
 const start=performance.now(),cpu=process.cpuUsage();
 for(const plan of plans){
  const mesh=kind==='fill'?api.createSourceSurfaceMeshFill(output,plan):api.createSourceSurfaceMeshLines(snapshot.wireframe,plan);
  mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);mesh.material.addEventListener('dispose',()=>materialDisposed++);
  try{
   const h=createHash('sha256');
   for(const name of Object.keys(mesh.geometry.attributes).sort()){
    const a=mesh.geometry.attributes[name];h.update(JSON.stringify({name,itemSize:a.itemSize,normalized:a.normalized,type:a.array.constructor.name}));h.update(bytes(a.array));bufferBytes+=a.array.byteLength;
   }
   const index=mesh.geometry.index;if(index){h.update(bytes(index.array));bufferBytes+=index.array.byteLength;}
   const m=mesh.material;
   h.update(JSON.stringify({visible:mesh.visible,frustumCulled:mesh.frustumCulled,renderOrder:mesh.renderOrder,side:m.side,forceSinglePass:m.forceSinglePass,transparent:m.transparent,depthTest:m.depthTest,depthWrite:m.depthWrite,depthFunc:m.depthFunc,toneMapped:m.toneMapped,blending:m.blending,blendEquation:m.blendEquation,blendSrc:m.blendSrc,blendDst:m.blendDst,blendEquationAlpha:m.blendEquationAlpha,blendSrcAlpha:m.blendSrcAlpha,blendDstAlpha:m.blendDstAlpha,uniforms:m.uniforms,vertexShader:m.vertexShader,fragmentShader:m.fragmentShader}));
   frameHashes.push(h.digest('hex'));
  }finally{mesh.geometry.dispose();mesh.material.dispose();}
 }
 const used=process.cpuUsage(cpu),elapsedMs=performance.now()-start;
 if(geometryDisposed!==61||materialDisposed!==61||hashInputs()!==inputHash)throw Error('Disposal or borrowed fixture integrity failed');
 rows.push({repeat,temperature:repeat===0?'cold-first-renderer-task':'warm-runtime-fresh-objects',frames:61,elapsedMs,userCpuMs:used.user/1000,systemCpuMs:used.system/1000,peakProcessRssKiB:process.resourceUsage().maxRSS,hashedBufferBytes:bufferBytes,geometryDisposed,materialDisposed,frameHashes});
}
console.log(JSON.stringify({variant,kind,grid:[n,n],inputHash,fixture:{vertices:g.positions.length/3,triangles:g.triangles.length/3,linePairs:snapshot.wireframe.positions.length/6,runtimeWorkUnits:snapshot.workUnits},rows,node:process.version}));
`);
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({status:'prepared-only',directory,baselineCommit,currentSourceCount:discovered.size}));process.exit(0);}
const results=[];
for(const n of [12,60])for(const [variant,kind] of [['before','fill'],['after','fill'],['after','line']]){
 const child=spawnSync(process.execPath,[runner,variant,kind,String(n)],{encoding:'utf8',maxBuffer:8*1024*1024});
 if(child.status!==0)throw Error(child.error?.message||child.stderr||child.stdout);
 const row=JSON.parse(child.stdout);if(row.rows.some(r=>JSON.stringify(r.frameHashes)!==JSON.stringify(row.rows[0].frameHashes)))throw Error('Repeated renderer output differs');results.push(row);
}
const comparisons=[];
for(let i=0;i<results.length;i+=3){
 const before=results[i],after=results[i+1],line=results[i+2];
 if(before.inputHash!==after.inputHash||after.inputHash!==line.inputHash)throw Error('Fixture input mismatch');
 if(JSON.stringify(before.rows[0].frameHashes)!==JSON.stringify(after.rows[0].frameHashes))throw Error('Fill renderer equivalence failed');
 comparisons.push({grid:before.grid,frames:61,fullBufferAndMaterialHashesEqual:true,repeatedRunsEqual:true,inputHash:before.inputHash});
}
for(const [path,digest] of Object.entries(afterManifest.files))if(sha(await readFile(path))!==digest)throw Error('Current source changed during measurement: '+path);
for(const [base,manifest] of [[baselineDirectory,beforeManifest],[currentDirectory,afterManifest]])for(const [path,digest] of Object.entries(manifest.files))if(sha(await readFile(resolve(base,path)))!==digest)throw Error('Frozen source changed: '+path);
const report={status:'passed',at:new Date().toISOString(),directory,baselineCommit,baselineManifest:relative(root,resolve(baselineDirectory,'manifest.json')),currentManifest:relative(root,resolve(currentDirectory,'manifest.json')),sourceStable:true,sources:afterManifest.files,scriptHash:sha(await readFile('scripts/benchmark-source-surface-line-renderer.mjs')),packageLockHash:sha(await readFile('package-lock.json')),threePackageHash:sha(await readFile('node_modules/three/package.json')),results,comparisons,
 scope:'61 camera changes over fixed source CPU torus meshes at 12×12 and 60×60. Shared current-runtime input fixture. Baseline/current fill object construction equivalence; new line construction measured independently without a pre-existing equivalent line path.',
 measurement:'Elapsed/CPU include full THREE geometry/material/mesh construction, complete attribute/index/material-state hashing and disposal. Bundle build/module loading, runtime fixture and camera preparation excluded. Three runs per fresh child: cold renderer then two warm renderer tasks; separate child per grid/path/variant. No children are spawned during measured tasks. maxRSS is cumulative process high water including modules/fixture preparation, not per-run incremental allocation or GPU memory. Buffer byte count is hashed data, including borrowed indices, not allocated bytes. Dispose events prove API disposal calls only; no GPU objects exist.',
 unmeasured:['agent tokens','native JVM/JOGL parity','GPU uploads/shader execution/VRAM','browser/render process-family memory','public importer/UI/timeline scheduling','runtime mesh generation cost'],nativeParity:false};
await writeFile('.cache/v2-source-surface-line-renderer-cost.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,sources:undefined,results:results.map(r=>({...r,rows:r.rows.map(({frameHashes,...row})=>({...row,fullFrameHashCount:frameHashes.length}))}))}));
