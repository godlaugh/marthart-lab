import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

// This is a standalone arithmetic-path proof, not a product native backend.
// All render inputs come from the real production import/runtime/GPU owner.
const verificationStarted=performance.now();
assert.equal(process.platform,'darwin','This diagnostic requires macOS CGL');
await mkdir('.cache',{recursive:true});
const root=await mkdtemp(path.resolve('.cache/fractal-cgl-'));
const fixtureDirectory='tests/fixtures/source-fractal-cgl';
const fixture=JSON.parse(await readFile(fixtureDirectory+'/reference.json','utf8'));
assert.equal(fixture.schemaVersion,1);
assert.deepEqual([fixture.width,fixture.height,fixture.logicalWidth,fixture.logicalHeight],[500,600,250,300]);
assert.deepEqual(fixture.cases.map(c=>c.name),['shallow','deep-1e5','deep-1e9']);
for(const item of fixture.cases){assert.match(item.rgbaSha256,/^[0-9a-f]{64}$/);assert.match(item.gradientSha256,/^[0-9a-f]{64}$/);}
const inputBytes=await readFile(fixtureDirectory+'/mandelbrot.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(inputBytes),fixture.inputSha256);
const source='scripts/oracles/source-fractal-cgl.mm',binary=root+'/raster-proof';
const report={at:new Date().toISOString(),directory:root,scope:fixture.scope,originalExecuted:false,productionIntegrated:false,cases:[],commands:[]};
const sourcePaths=(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p).concat(source,'scripts/verify-source-fractal-cgl.mjs',fixtureDirectory+'/reference.json',fixtureDirectory+'/mandelbrot.json','package-lock.json');
const snapshot=async()=>Object.fromEntries(await Promise.all(sourcePaths.sort().map(async p=>[p,sha(await readFile(p))])));
report.sourcesBefore=await snapshot();
let browser,server,deadline;
async function command(executable,args,tag){
 const start=performance.now();
 const row=await new Promise(resolve=>{
  const child=spawn(executable,args,{detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
  let stdout='',stderr='',error,timedOut=false,force;
  child.stdout.on('data',d=>{stdout=(stdout+d).slice(-16384);});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-16384);});child.on('error',e=>{error=String(e);});
  const signal=s=>{try{if(child.pid)process.kill(-child.pid,s);}catch(e){if(e.code!=='ESRCH')error=String(e);}};
  const timer=setTimeout(()=>{timedOut=true;signal('SIGTERM');force=setTimeout(()=>signal('SIGKILL'),1000);},45000);
  child.on('close',(exit,signal)=>{clearTimeout(timer);clearTimeout(force);let processGroupExists=false;if(child.pid)try{process.kill(-child.pid,0);processGroupExists=true;}catch(e){if(e.code!=='ESRCH')error=String(e);}resolve({tag,executable,args,pid:child.pid,exit,signal,error,timedOut,processGroupExists,stdout,stderr,seconds:(performance.now()-start)/1000});});
 });report.commands.push(row);assert.equal(row.exit,0,JSON.stringify(row));assert.equal(row.error,undefined);assert.equal(row.timedOut,false);assert.equal(row.processGroupExists,false);return row;
}
try{
 await command('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-Wno-deprecated-declarations','-framework','Foundation','-framework','OpenGL',source,'-o',binary],'compile');
 server=await createServer({optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 const {FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT}=await server.ssrLoadModule('/src/engine/fractalNativeNewtonRaster.ts');
 const {FRACTAL_SOURCE_RASTER_VERTEX}=await server.ssrLoadModule('/src/engine/fractalNativeNewtonKernel.ts');
 const convert=s=>{assert.ok(s.startsWith('#version 300 es\n'));return s.replace('#version 300 es','#version 330 core').replace(/precision highp (?:float|int|sampler2D);/g,'');};
 await writeFile(root+'/fragment.glsl',convert(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT));await writeFile(root+'/vertex.glsl',convert(FRACTAL_SOURCE_RASTER_VERTEX));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-automation','--disable-features=WebAssemblyTrapHandler','--enable-angle-features=disableProgramCaching']});
 const cdp=await browser.newBrowserCDPSession();report.browserCommandLine=await cdp.send('Browser.getBrowserCommandLine');report.browserProcesses=await cdp.send('SystemInfo.getProcessInfo');
 const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 for(const item of fixture.cases){
  const input=JSON.parse(inputBytes.toString());Object.assign(input.fractal,item.fractalChanges);
  const folder=root+'/'+item.name;await mkdir(folder);await writeFile(folder+'/input.json',JSON.stringify(input,null,2)+'\n');
  const started=performance.now();
  const result=await Promise.race([page.evaluate(async input=>{
const{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareSourceFractalScene,bindSourceFractalFrame}=await import('/src/engine/sourceFractalTimeline.ts'),{SourceFractalSceneRuntime}=await import('/src/engine/sourceFractalSceneRuntime.ts'),{prepareFractalRender}=await import('/src/scenes/complex.ts'),{FractalSourceNewtonGpu}=await import('/src/engine/fractalNativeNewtonGpu.ts'),{SourceFractalDisplay,sourceFractalDisplayInput}=await import('/src/engine/sourceFractalDisplay.ts');
const scene=parseProjectFile(JSON.stringify(input)).scene,host=new SourceFractalSceneRuntime(prepareSourceFractalScene(scene),{reserve(){}});bindSourceFractalFrame(scene,{...host.snapshot(),displayFrame:0,simulationFps:scene.timeline.fps});const p=prepareFractalRender(scene,{time:0,width:500,height:600,quality:'export',fractalViewport:{logicalWidth:250,logicalHeight:300,target:'offscreen'}}),owner=new FractalSourceNewtonGpu(),display=new SourceFractalDisplay(),facts=[];
try{for(let i=0;i<4;i++)display.display(sourceFractalDisplayInput(p,scene),f=>{facts.push(f);owner.sample(new Float32Array([0,0]),500,600,p.view,p.orbitConfig,p.sourcePlan,p.traceColors,undefined,p.colorPlan,f);});const gl=owner.gl,program=owner.colorProgram,uniforms=[];for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(program,i),rows=[];for(let j=0;j<u.size;j++){const name=u.size>1?u.name.replace(/\[0\]$/,'['+j+']'):u.name,v=gl.getUniform(program,gl.getUniformLocation(program,name)),values=typeof v==='number'?[v]:Array.from(v);if(values.some(x=>!Number.isFinite(x)||Object.is(x,-0)))throw Error('Nonfinite or signed zero requires binary uniform transport');rows.push(values);}uniforms.push({name:u.name,glType:u.type,size:u.size,floatQueryValues:rows});}
const reference=owner.referenceCopy??new Float32Array(4),gradient=owner.colorLutCopy;if(!gradient)throw Error('No owned LUT');const ext=gl.getExtension('WEBGL_debug_renderer_info');return{uniforms,reference:Array.from(reference),gradient:Array.from(gradient),plan:p.sourcePlan,facts,diagnostics:owner.diagnostics(),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};
}finally{owner.dispose();}
},input),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Production input capture exceeded 45 seconds')),45000);})]);clearTimeout(deadline);
  const captureSeconds=(performance.now()-started)/1000;
  const reference=Buffer.from(new Float32Array(result.reference).buffer),gradient=Buffer.from(new Float32Array(result.gradient).buffer);
  assert.equal(sha(gradient),item.gradientSha256,'Production gradient bytes differ from original');
  if(item.referenceSha256){assert.equal(sha(reference),item.referenceSha256,'Production reference orbit bytes differ from original');assert.equal(reference.length,item.referenceLength*16);}
  else {assert.equal(result.plan.perturbation.enabled,false);assert.equal(reference.length,16);}
  await writeFile(folder+'/reference.f32',reference);await writeFile(folder+'/gradient.f32',gradient);
  const {reference:ignoredReference,gradient:ignoredGradient,...producer}=result;
  await writeFile(folder+'/producer.json',JSON.stringify(producer,null,2)+'\n');
  const manifest={width:fixture.width,height:fixture.height,uniforms:result.uniforms,textures:[{unit:2,width:reference.length/16,channels:4,path:folder+'/reference.f32'},{unit:1,width:gradient.length/12,channels:3,path:folder+'/gradient.f32'}],fragment:root+'/fragment.glsl',vertex:root+'/vertex.glsl',attachments:4,color:2,output:folder+'/frame.rgba',metadata:folder+'/device.json'};
  await writeFile(folder+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  const task=await command('/usr/bin/time',['-l',binary,folder+'/manifest.json'],item.name);
  const actual=await readFile(folder+'/frame.rgba'),actualSha256=sha(actual);assert.equal(actual.length,fixture.width*fixture.height*4);assert.equal(actualSha256,item.rgbaSha256,'Full mathematical RGBA mismatch: '+item.name);
  const device=JSON.parse(await readFile(folder+'/device.json','utf8'));assert.equal(device.windowCreated,false);
  const cpu=/([\d.]+) user\s+([\d.]+) sys/.exec(task.stderr),rss=/(\d+)\s+maximum resident set size/.exec(task.stderr);
  report.cases.push({name:item.name,bytes:actual.length,actualSha256,referenceSha256:item.rgbaSha256,exactMatch:true,gradientSha256:sha(gradient),referenceOrbitSha256:item.referenceSha256?sha(reference):null,referenceLength:item.referenceLength,displayCount:result.facts.length,activeUniforms:result.uniforms.length,captureSeconds,nativeSeconds:task.seconds,nativeCpuSeconds:cpu?Number(cpu[1])+Number(cpu[2]):null,nativePeakRssBytes:rss?Number(rss[1]):null,device});
  console.log(JSON.stringify({case:item.name,exactMatch:true,referenceLength:item.referenceLength}));
 }
 assert.equal(report.cases.length,fixture.cases.length);
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 clearTimeout(deadline);const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));
 report.browserClosed=!browser?.isConnected();report.serverClosed=!server?.httpServer?.listening;
 report.browserProcessAfter=(report.browserProcesses?.processInfo??[]).filter(p=>p.type==='browser').map(p=>{let exists;try{process.kill(p.id,0);exists=true;}catch(e){exists=e.code==='ESRCH'?false:'unknown';}return{pid:p.id,exists};});
 report.sourcesAfter=await snapshot();report.sourcesStable=JSON.stringify(report.sourcesBefore)===JSON.stringify(report.sourcesAfter);
 if(!report.sourcesStable||report.cleanupErrors.length||!report.browserClosed||!report.serverClosed||report.browserProcessAfter.some(p=>p.exists!==false)){report.status='failed';report.error??='Source changed or cleanup incomplete';process.exitCode=1;}
 report.totalSeconds=(performance.now()-verificationStarted)/1000;
 await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:root+'/report.json'}));
}
