/** Compare actual import/configuration/seed producers with independent retained
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
const fixtures=JSON.parse(bytes),paths=['src/engine/legacyImport.ts','src/engine/iteratedSeed.ts','src/scenes/iteratedDensity.ts','src/scenes/symmetryParameters.ts','scripts/audit-source-symmetry-initialization.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
const report={at:new Date().toISOString(),status:'running',nativeApplicationExecuted:false,jarSha256:manifest.jarSha256,fixturesSha256:manifest.fixturesSha256,sourceBefore:await snapshot(),limits:['Independent Python static-derived oracle, not observed JVM output.','JSON fixtures have bounded string/HashMap coverage; not a complete native parser conformance claim.','Only selected initialization points are compared, before GPU warmup or rendering.']};
let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];
 await page.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.cases=await page.evaluate(async fixtures=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts');
  return fixtures.map(expected=>{
   // Minimal omitted document envelope only. Keep all authored source settings
   // and parameters unchanged, including a missing parameters object.
   const raw={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:expected.id,...expected.rawSourceInput};
   const row={id:expected.id,raw,expected};
   try{
    const imported=parseProjectFile(JSON.stringify(raw)),job=prepareIteratedFrame(imported.scene,0,0);
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
 report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);check(report.sourceStable,'Production source changed');
 report.status=report.cases.every(row=>row.status==='selected-facts-equal')?'selected-facts-equal':'gaps-observed';
}catch(error){report.status='audit-error';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(result=>result.status);
 if(report.cleanup.some(status=>status!=='fulfilled')){report.status='audit-error';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,directory,cases:report.cases?.map(({id,status})=>({id,status})),error:report.error}));
}
