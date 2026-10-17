import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.env.DOMAIN_SHARPNESS_REPORT??'.cache/domain-parameter-sharpness-browser.json';
const paths=['scripts/verify-domain-parameter-sharpness.mjs','src/engine/domainParameterTimeline.ts','src/engine/domainParameterBinding.ts','src/engine/domainLevelCurve.ts','src/engine/timeline.ts','src/engine/oscillation.ts','src/engine/document.ts','src/types.ts','src/engine/client.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParser.ts','src/engine/domainNativeConstants.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainSourceColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceGpuColor.ts'];
const hashes=()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={startedAt:new Date().toISOString(),sourceStart:await hashes(),scope:'Independent supplementary setter/consumer boundary for phaseSharpness and modSharpness; no original application/JVM execution.',limits:['Independent expected setter values are source-derived binary32 positive/default normalization. Whole-image comparison uses the production color/formula renderer with those independent fixed settings; it is not an independent shader-color oracle.','CPU/GPU backends are recorded and actual WebGL2 is required. SourceGPU and sourceCPU color recipes are tested separately, never asserted equal.','Complete small rasters, not a performance benchmark or original-runtime pixel-equivalence claim.']};
let browser;const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Sharpness source setter boundary</title>'}));await page.goto(origin);
 report.result=await page.evaluate(async()=>{
  const{Generator}=await import('/src/engine/client.ts'),{createScene,parseScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{sceneAtTime,domainParameterFrame}=await import('/src/engine/timeline.ts');
  const check=(value,message)=>{if(!value)throw Error(message);},hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const inputs=[{name:'positive-.001',raw:.001,expected:Math.fround(.001)},{name:'smallest-positive-float32',raw:2**-149,expected:2**-149},{name:'zero-default',raw:0,expected:1},{name:'negative-default',raw:-.001,expected:1},{name:'positive-double-underflows-at-range-f32',raw:Number.MIN_VALUE,expected:1}];
  const rows=[];let requestCount=0;
  for(const color of ['mathart-1.7.8-gpu','mathart-1.7.8-cpu'])for(const input of inputs)for(const backend of ['cpu','gpu']){
   const scene=createScene(definition('domain'));scene.name='Sharpness boundary '+input.name;scene.equations={f:'z',next:''};scene.parameters={};Object.assign(scene.settings,{domainBackend:backend,domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:color,domainViewportVersion:'mathart-1.7.8-gpu',iterationEnabled:false,supersampling:1,scale:2.5,centerX:.13,centerY:.19,rotation:.23,curveMode:'PHASE_MODULUS',phaseDensity:12,modDensity:8,phaseSharpness:2,modSharpness:3,curveBias:.15,curveMix:1});scene.domainSourcePalette={colors:['#ff0000','#ffff00','#00ffff','#0000ff','#ff00ff']};
   scene.timeline.duration=1;scene.timeline.tracks=[{id:'sharpness',type:'animate',target:'camera.actions',from:0,to:0,pingPong:false,repeat:1,enabled:true,start:0,duration:0,easing:'linear',actions:[{id:'set-both',method:'paramStart',domainParameters:['phaseSharpness','modSharpness'].map(name=>({model:'domain-registry-1.7.8',scope:{kind:'named',name},configuration:{min:input.raw,max:input.raw,step:0,edgeEasing:{window:.5,floor:1,easing:'linear'}}}))}]}];
   const restored=parseScene(JSON.stringify(scene));check(restored.timeline.tracks[0].actions[0].domainParameters[0].configuration.min===input.raw,'Authored tiny value not preserved');
   const generator=new Generator(),samples=[];
   try{
    for(const time of [0,.1,0,.1]){
     const frame=sceneAtTime(restored,time),expectedPhase=time===0?2:input.expected,expectedMod=time===0?3:input.expected;
     check(frame.settings.phaseSharpness===expectedPhase&&frame.settings.modSharpness===expectedMod,'Source setter differs from positive/default boundary '+input.name);
     const facts=domainParameterFrame(frame);check(facts.entries.every(e=>e.written===(time>0)),'Setter dt0 timing');
     const reference={...restored,settings:{...restored.settings,phaseSharpness:expectedPhase,modSharpness:expectedMod},timeline:{...restored.timeline,tracks:[]}},context={time,width:79,height:53,quality:'export'};
     const start=performance.now(),out=await generator.generate(restored,context),requestWallMs=performance.now()-start;requestCount++;
     const fixed=await generator.generate(reference,context);requestCount++;check(out.type==='raster'&&fixed.type==='raster','Missing raster');
     const actualHash=await hash(out.pixels),expectedHash=await hash(fixed.pixels);check(actualHash===expectedHash,'Actual image ignores independent sharpness '+input.name);
     check(out.width===79&&out.height===53&&out.stats.generated+out.stats.invalid===79*53,'Incomplete raster');check(out.backend===(backend==='cpu'?'cpu':'webgl2'),'Requested actual backend missing '+out.warnings?.join(';'));
     samples.push({time,expectedPhase,expectedMod,phase:frame.settings.phaseSharpness,modulus:frame.settings.modSharpness,frame:facts,actualHash,expectedHash,actualBackend:out.backend,stats:out.stats,warnings:out.warnings,requestWallMs});
    }
    check(samples[0].actualHash===samples[2].actualHash&&samples[1].actualHash===samples[3].actualHash,'Backseek not exact');
    if(input.name==='positive-.001')check(samples[0].actualHash!==samples[1].actualHash,'Sharpness .001 produced no visible change');
    rows.push({input,color,backend,samples});
   }finally{generator.dispose();}
  }
  return{rows,requestCount,scenarios:rows.length};
 });report.browser=browser.version();
}catch(error){report.error=String(error.stack??error);}
finally{const cleanup=await Promise.allSettled([browser?.close(),server.close()]);report.cleanup={browserClosed:!browser?.isConnected(),serverClosed:!server.httpServer?.listening,errors:cleanup.filter(x=>x.status==='rejected').map(x=>String(x.reason))};}
report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.finishedAt=new Date().toISOString();report.status=!report.error&&report.sourceStable&&!report.cleanup.errors.length?'passed':'failed';await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,error:report.error,requests:report.result?.requestCount}));if(report.status!=='passed')process.exitCode=1;
