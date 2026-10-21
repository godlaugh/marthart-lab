/** Compare direct runtime-config import/seed producers with independent retained
 * source-derived fixtures. Gaps are reported, never reclassified as parity.
 * Requires .cache/source-symmetry-initialization-audit/{manifest,fixtures}.json.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(value,message)=>{if(!value)throw Error(message);};
const directory=process.argv[2];check(directory,'Supply a new output directory');await mkdir(directory);
const audit='.cache/source-symmetry-initialization-audit',manifest=JSON.parse(await readFile(audit+'/manifest.json','utf8'));
check(sha(await readFile(manifest.jar))===manifest.jarSha256,'Reference JAR changed');
for(const source of manifest.sources)check(sha(await readFile(source.path))===source.sha256,'Retained evidence changed: '+source.path);
const bytes=await readFile(audit+'/fixtures.json');check(sha(bytes)===manifest.fixturesSha256,'Oracle fixture changed');
check(sha(await readFile(audit+'/oracle.py'))===manifest.oracleSha256,'Oracle implementation changed');
const fixtures=JSON.parse(bytes),paths=['src/engine/legacyImport.ts','src/engine/iteratedSeed.ts','src/engine/sourceSymmetryConfig.ts','src/engine/symmetryCustom.ts','src/engine/sourceJavaHash.ts','src/engine/javaSourceRandom.ts','src/engine/rootsSourceOrder.ts','src/scenes/iteratedDensity.ts','src/scenes/symmetryParameters.ts','scripts/audit-source-symmetry-initialization.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const report={at:new Date().toISOString(),status:'running',nativeApplicationExecuted:false,jarSha256:manifest.jarSha256,fixturesSha256:manifest.fixturesSha256,sourceBefore:await snapshot(),limits:['Direct runtime-config entry; user file loading has separate ProjectState semantics.','Independent Python static-derived oracle, not observed JVM output.','JSON fixtures have bounded string/HashMap coverage; not a complete native parser conformance claim.','Only selected initialization points are compared, before GPU warmup or rendering.']};
let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];
 await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.cases=await page.evaluate(async fixtures=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts');
  return fixtures.map(expected=>{
   // Minimal omitted document envelope only. Keep all authored source settings
   // and parameters unchanged, including a missing parameters object.
   const raw={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:expected.id,...expected.rawSourceInput};
   const row={id:expected.id,raw,expected};
   try{
    const imported=parseLegacyScene(JSON.stringify(raw),{symmetryEntry:'runtime-config'}),job=prepareIteratedFrame(imported.scene,0,0);
    const cfg=job.config;row.actual={count:cfg.count,seed:cfg.seed,bounds:cfg.bounds,field:job.field,parameters:imported.scene.parameters,degree:imported.scene.settings.degree,deltaPower:imported.scene.settings.deltaPower};
    row.points=expected.selected.map(point=>{
     if(point.particle>=cfg.count)return{particle:point.particle,status:'outside-actual-count'};
     const actual=iteratedInitialChunk(cfg,point.particle,1),bits=Array.from(new Uint32Array(actual.buffer,actual.byteOffset,4),n=>n.toString(16).padStart(8,'0'));
     return{particle:point.particle,expected:point.xyzmFloat32Bits,actual:bits,equal:bits.every((value,index)=>value===point.xyzmFloat32Bits[index])};
    });
    row.countEqual=cfg.count===expected.batchSize;row.degreeEqual=row.actual.degree===expected.runtimeSymmetryDegree;
    row.status=row.countEqual&&row.degreeEqual&&row.points.every(p=>p.equal===true)?'selected-facts-equal':'mismatch';
   }catch(error){row.status='local-rejected';row.error=String(error.stack??error);}
   return row;
  });
 },fixtures.boundedJsonFixtures);
 if(process.argv.includes('--gpu'))report.gpuCases=await page.evaluate(async rows=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {createSourceSymmetryConfiguration}=await import('/src/engine/sourceSymmetryConfig.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const f32=hex=>new Float32Array(new Uint32Array([parseInt(hex,16)]).buffer)[0],results=[];
  for(const row of rows){
   const scene=createScene(definition('symmetry')),prepared=createSourceSymmetryConfiguration(row.batchSize,row.orderedParameters);if(!prepared.ok)throw Error(prepared.error.reason);
   scene.symmetrySource=prepared.value;scene.parameters=Object.fromEntries(row.orderedParameters);scene.equations={glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p;m=0.;}'};
   Object.assign(scene.settings,{symmetryMathModel:'mathart-1.7.8-gpu-v1',iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:row.batchSize,burnIn:0,iterationsPerFrame:1,initialMode:'box',initialXMin:f32(row.xBoundsFloat32Bits[0]),initialXMax:f32(row.xBoundsFloat32Bits[1]),initialYMin:f32(row.yBoundsFloat32Bits[0]),initialYMax:f32(row.yBoundsFloat32Bits[1])});
   const gpu=new IteratedDensityGpu(),result={id:row.id,count:row.batchSize,points:[]};
   try{
    gpu.step(prepareIteratedFrame(scene,0,0),{width:16,height:16,projection:'xy',padding:0,bounds:{minX:-4,maxX:4,minY:-4,maxY:4},resetParticles:true,clearInk:true});
    const actual=gpu.readParticles(),allBits=new Uint32Array(actual.positionsAndMetric.buffer,actual.positionsAndMetric.byteOffset,actual.positionsAndMetric.length);
    result.points=row.selected.map(point=>{const bits=Array.from(allBits.slice(point.particle*4,point.particle*4+4),n=>n.toString(16).padStart(8,'0'));return{particle:point.particle,expected:point.xyzmFloat32Bits,actual:bits,equal:bits.every((v,i)=>v===point.xyzmFloat32Bits[i])};});
    result.equal=result.points.every(p=>p.equal);
   }finally{gpu.dispose();result.retainedBytes=gpu.diagnostics().retainedBytes;}
   results.push(result);
  }
  return results;
 },fixtures.directOrderedRuntimeParameters);
 report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);check(report.sourceStable,'Production source changed');
 report.status=report.cases.every(row=>row.status==='selected-facts-equal')&&(!report.gpuCases||report.gpuCases.every(row=>row.equal&&row.retainedBytes===0))?'selected-facts-equal':'gaps-observed';
}catch(error){report.status='audit-error';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(result=>result.status);
 if(report.cleanup.some(status=>status!=='fulfilled')){report.status='audit-error';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,directory,cases:report.cases?.map(({id,status})=>({id,status})),gpuCases:report.gpuCases?.map(({id,equal})=>({id,equal})),error:report.error}));
}
