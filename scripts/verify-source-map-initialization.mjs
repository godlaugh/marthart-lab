/** Original JVM seed/sampling fixtures -> production configuration and real GPU
 * upload. Identity recurrence isolates initialization; this is not native GL. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const out=process.argv[2];if(!out)throw Error('Supply a new output directory');await mkdir(out);
const bytes=await readFile('tests/fixtures/map/initialization-source.json'),fixture=JSON.parse(bytes);
const files=['src/engine/sourceMapConfig.ts','src/engine/sourceMapScene.ts','src/engine/sourceMapInitialSeed.ts','src/engine/sourceJavaHash.ts','src/engine/javaSourceRandom.ts','src/engine/iteratedSeed.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-map-initialization.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={sourceBefore:await hashes(),scope:'Bundled JVM pure-method fixture versus production Java RNG upload, identity recurrence in local WebGL2. Native JOGL/window not executed.',fixtureSha256:createHash('sha256').update(bytes).digest('hex'),status:'running'},started=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 // Transfer original JSON text: Playwright/Vite serialization must not erase -0.
 report.gpu=await page.evaluate(async text=>{
  const fixture=JSON.parse(text),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{SOURCE_MAP_CONFIG}=await import('/src/engine/sourceMapConfig.ts'),{withSourceMapConfiguration}=await import('/src/engine/sourceMapScene.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},rows=[];
  for(const row of fixture.cases){
   if(!row.preparedRange)continue;
   const c={dimension:row.dimension,batchSize:row.batchSize,equations:{x:row.equations[0],y:row.equations[1],z:row.equations[2]},parameters:row.parameters,initial:{xMin:Math.fround(row.bounds[0][0]),xMax:Math.fround(row.bounds[0][1]),yMin:Math.fround(row.bounds[1][0]),yMax:Math.fround(row.bounds[1][1])},burnIn:0,iterations:1};
   const scene=withSourceMapConfiguration(createScene(definition('map')),{model:SOURCE_MAP_CONFIG,entry:'runtime-config',settingsPresence:'object',construction:c},Object.fromEntries(row.parameters));
   for(let attempt=0;attempt<2;attempt++){
    const job=prepareIteratedFrame(scene,0,0),gpu=new IteratedDensityGpu();check(job.config.sourceInitialSeed===row.initialStateSeed,'Seed mismatch '+row.id);
    // Keep the production seed/config and isolate state upload with identity.
    job.field={kind:'map',mathModel:'mathart-1.7.8-gpu-v1',dimension:c.dimension,equations:{x:'x',y:'y',z:'z'},parameters:{},time:0};
    try{
     gpu.step(job,{width:16,height:12,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},resetParticles:true,clearInk:true});
     const states=gpu.readParticles().positionsAndMetric,bits=new Uint32Array(states.buffer,states.byteOffset,states.length);
     for(let i=0;i<row.samplesFloatBits.length;i++)for(let axis=0;axis<4;axis++)check(bits[i*4+axis]===row.samplesFloatBits[i][axis],`GPU initialization mismatch ${row.id}/${i}/${axis}: ${bits[i*4+axis]} versus ${row.samplesFloatBits[i][axis]}`);
     rows.push({id:row.id,attempt,seed:job.config.sourceInitialSeed,examinedPoints:row.samplesFloatBits.length,channels:row.samplesFloatBits.length*4});
    }finally{gpu.dispose();check(gpu.diagnostics().retainedBytes===0,'GPU cleanup retained storage');}
   }
  }
  return rows;
 },bytes.toString('utf8'));report.sourceAfter=await hashes();if(JSON.stringify(report.sourceAfter)!==JSON.stringify(report.sourceBefore))throw Error('Source changed during probe');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,cases:report.gpu?.length,elapsedMs:report.elapsedMs}));}
