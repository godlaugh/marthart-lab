import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer as createSocketServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';
assert.equal(process.platform,'darwin');
const started=performance.now();await mkdir('.cache',{recursive:true});const root=await mkdtemp(path.resolve('.cache/fractal-native-http-'));
const fixture=JSON.parse(await readFile('tests/fixtures/source-fractal-cgl/reference.json','utf8')),input=await readFile('tests/fixtures/source-fractal-cgl/mandelbrot.json','utf8');
assert.deepEqual(fixture.cases.map(c=>c.name),['shallow','deep-1e5','deep-1e9']);
const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(input),fixture.inputSha256);
const report={at:new Date().toISOString(),directory:root,scope:'Production prepared bindings through actual browser client / HTTP / retained CGL service; fixed mathematical raster parity and ordered samples. Normal application preview/export integration remains pending.',commands:[],cases:[],originalExecuted:false};
const sourcePaths=(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p).concat((await readdir('server',{recursive:true})).filter(p=>/\.(mjs|m|h)$/.test(p)).map(p=>'server/'+p),'scripts/verify-source-fractal-native.mjs','tests/fixtures/source-fractal-cgl/reference.json','tests/fixtures/source-fractal-cgl/mandelbrot.json','package-lock.json');
const snapshot=async()=>Object.fromEntries(await Promise.all(sourcePaths.sort().map(async p=>[p,sha(await readFile(p))])));report.sourcesBefore=await snapshot();
let server,browser,service;
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
 const measured=await measureFamily(process.pid,async()=>{
 const binary=root+'/renderer';await command('/usr/bin/clang',['-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',binary],'compile');
 report.executableSha256=sha(await readFile(binary));
 const reservation=createSocketServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 service=await createExportServer({sourceRendererBackend:{executablePath:binary,executableSha256:report.executableSha256,timeoutMs:20000},root:root+'/exports',allowedOrigins:[`http://127.0.0.1:${port}`]});const api=await service.listen(0);
 server=await createServer({optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${api.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-automation','--enable-angle-features=disableProgramCaching']});const cdp=await browser.newBrowserCDPSession();report.browserProcesses=await cdp.send('SystemInfo.getProcessInfo');
 const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 for(const item of fixture.cases){
  const value=JSON.parse(input);Object.assign(value.fractal,item.fractalChanges);const time=performance.now();
  const result=await page.evaluate(async({input,width,height})=>{
   const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareSourceFractalScene,bindSourceFractalFrame}=await import('/src/engine/sourceFractalTimeline.ts'),{SourceFractalSceneRuntime}=await import('/src/engine/sourceFractalSceneRuntime.ts'),{prepareFractalRender}=await import('/src/scenes/complex.ts'),{FractalSourceReferenceCache}=await import('/src/engine/fractalSourcePrecision.ts'),{SourceFractalDisplay,sourceFractalDisplayInput}=await import('/src/engine/sourceFractalDisplay.ts'),{createFractalSourceRasterBindings}=await import('/src/engine/fractalSourceRasterBindings.ts'),{FRACTAL_SOURCE_NATIVE_SHADERS}=await import('/src/engine/fractalSourceNativeProgram.ts'),{exchangeSourceFractalNative}=await import('/src/engine/sourceNativeClient.ts'),{sourceFractalNativeProgramBytes}=await import('/src/engine/sourceFractalNativeProtocol.ts'),{decodeFractalSourceTerminal}=await import('/src/engine/fractalNativeNewtonRaster.ts');
   const scene=parseProjectFile(JSON.stringify(input)).scene,host=new SourceFractalSceneRuntime(prepareSourceFractalScene(scene),{reserve(){}});bindSourceFractalFrame(scene,{...host.snapshot(),displayFrame:0,simulationFps:scene.timeline.fps});const p=prepareFractalRender(scene,{time:0,width,height,quality:'export',fractalViewport:{logicalWidth:250,logicalHeight:300,target:'offscreen'}}),cache=new FractalSourceReferenceCache(),r=cache.prepare(p.sourcePlan).reference,reference=r.kind==='ready'?r:undefined,display=new SourceFractalDisplay(),resource=crypto.randomUUID().replaceAll('-','');let sequence=0,index=0,target,retained=0,context,session,owned=false;const execution={draws:0,targetAllocations:0,referenceUploads:0,paletteUploads:0},operations=[];
   const send=async(operation,w=1,h=1)=>{const start=performance.now();const result=await exchangeSourceFractalNative({generation:1,sequence:++sequence,width:w,height:h,operation},{retainedBytes:retained,...(target?{retainedTarget:target}:{})});if(context!==undefined&&(result.contextSerial!==context||result.sessionSerial!==session))throw Error('Native owner identity changed');context=result.contextSerial;session=result.sessionSerial;const facts={};for(const key of Object.keys(execution)){execution[key]+=result[key];facts[key]=result[key];}operations.push({kind:operation.kind,seconds:(performance.now()-start)/1000,temperature:operation.kind==='sample'?(result.committedRequests===1?'first-sample-on-fresh-resource':'retained-resource'):'control',index:result.committedRequests,count:result.count,width:w,height:h,...facts});return result;};
   const programBytes=sourceFractalNativeProgramBytes(FRACTAL_SOURCE_NATIVE_SHADERS),ref=reference?.values??new Float32Array(4);const warmups=[],stats={samples:0,perturbSamples:0,ordinarySteps:0,perturbSteps:0,glitches:0};let lastBindings,lastPalette;
   const sample=async(points,bindings,palette,w=width,h=height)=>{const result=await send({kind:'sample',resource,expectedIndex:index,points,reference:ref,palette,uniforms:bindings},w,h);index=result.committedRequests;target={resource,width:w,height:h};retained=programBytes+96+ref.byteLength+palette.byteLength+w*h*52;return result.records;};
   try{
    const created=await send({kind:'create',resource,shaders:FRACTAL_SOURCE_NATIVE_SHADERS});if(created.disposition!=='owned')throw Error('Create not acknowledged');owned=true;retained=programBytes+96;
    for(let i=0;i<3;i++)await display.displayAsync(sourceFractalDisplayInput(p,scene),async f=>{const bindings=createFractalSourceRasterBindings(p.sourcePlan,p.orbitConfig,reference,p.colorPlan,f),palette=f.useGradientTexture?p.colorPlan.lut:new Float32Array(3),records=await sample(new Uint32Array([width-1,height-1,0,0,width-1,height-1]),bindings,palette);if(!records.subarray(0,52).every((x,j)=>x===records[j+104]))throw Error('Duplicate sample changed');warmups.push({ordinal:f.ordinal,scale:f.previewScale,gradientSize:f.gradientSize,index});});
    const rgba=new Uint8Array(width*height*4);let firstRecords;
    await display.displayAsync(sourceFractalDisplayInput(p,scene),async f=>{
     lastBindings=createFractalSourceRasterBindings(p.sourcePlan,p.orbitConfig,reference,p.colorPlan,f);lastPalette=p.colorPlan.lut;
     for(let start=0;start<width*height;start+=65536){const count=Math.min(65536,width*height-start),points=new Uint32Array(count*2);for(let i=0;i<count;i++){points[i*2]=(start+i)%width;points[i*2+1]=Math.floor((start+i)/width);}const records=await sample(points,lastBindings,lastPalette),data=new DataView(records.buffer,records.byteOffset,records.byteLength);if(start===0)firstRecords=records.slice(0,52);
      for(let i=0;i<count;i++){rgba.set(records.subarray(i*52+32,i*52+36),(start+i)*4);const facts=decodeFractalSourceTerminal(data.getFloat32(i*52+16,true),data.getFloat32(i*52+20,true),p.sourcePlan.iterations);stats.samples++;stats.perturbSamples+=facts.startedPerturb?1:0;stats.glitches+=facts.glitches;stats.ordinarySteps+=facts.ordinarySteps;stats.perturbSteps+=facts.perturbSteps;}
     }
    });
    await sample(new Uint32Array([0,0,16,12,0,0]),lastBindings,lastPalette,17,13);
    const restored=await sample(new Uint32Array([0,0]),lastBindings,lastPalette);if(!restored.every((x,i)=>x===firstRecords[i]))throw Error('Resize/restore changed numerical record');
    const released=await send({kind:'release',resource});if(released.disposition!=='released')throw Error('Release missing');owned=false;retained=0;target=undefined;const absent=await send({kind:'release',resource});if(absent.disposition!=='absent')throw Error('Repeated release not absent');
    return{pixels:Array.from(rgba),warmups,stats,execution,operations,committedRequests:index,referenceLength:reference?.length??0,contextSerial:context,sessionSerial:session,releaseConfirmed:true,resizeRestored:true,reference:Array.from(ref),gradient:Array.from(p.colorPlan.lut)};
   }finally{if(owned)await send({kind:'release',resource});cache.dispose();}
  },{input:value,width:fixture.width,height:fixture.height});
  const top=Buffer.from(result.pixels),bottom=Buffer.alloc(top.length);for(let y=0;y<fixture.height;y++)top.copy(bottom,(fixture.height-1-y)*fixture.width*4,y*fixture.width*4,(y+1)*fixture.width*4);assert.equal(bottom.length,fixture.width*fixture.height*4);assert.equal(sha(bottom),item.rgbaSha256,item.name+' mathematical RGBA');assert.equal(sha(Buffer.from(new Float32Array(result.gradient).buffer)),item.gradientSha256);if(item.referenceSha256)assert.equal(sha(Buffer.from(new Float32Array(result.reference).buffer)),item.referenceSha256);
  await writeFile(root+'/'+item.name+'.rgba',bottom);const {pixels,reference,gradient,...facts}=result;report.cases.push({name:item.name,seconds:(performance.now()-time)/1000,rgbaSha256:sha(bottom),...facts});console.log(JSON.stringify({name:item.name,status:'passed',stats:result.stats}));
 }
 assert.equal(report.cases.length,3);return {};});report.processFamily=measured.processFamily;report.measurement='250ms sampled Node/Chrome/native process family across compile, setup and all cases, excluding final cleanup. CPU may omit short-lived descendants; RSS sums shared pages and is a sampled lower bound on instantaneous peak. Each case creates a fresh native resource, then reuses it; OS/driver caches are not flushed. No equivalent prior native HTTP workflow exists for a before/after speed claim. GPU/VRAM and per-operation CPU/RSS are unmeasured.';report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.ownedProcesses=service?.ownedProcessCount;report.browserClosed=!browser?.isConnected();report.serverClosed=!server?.httpServer?.listening;
 report.browserProcessAfter=(report.browserProcesses?.processInfo??[]).filter(p=>p.type==='browser').map(p=>{let exists;try{process.kill(p.id,0);exists=true;}catch(e){exists=e.code==='ESRCH'?false:'unknown';}return{pid:p.id,exists};});
 report.sourcesAfter=await snapshot();report.sourcesStable=JSON.stringify(report.sourcesBefore)===JSON.stringify(report.sourcesAfter);if(!report.sourcesStable||report.cleanupErrors.length||report.ownedProcesses!==0||!report.browserClosed||!report.serverClosed||report.browserProcessAfter.some(p=>p.exists!==false)){report.status='failed';report.error??='Source changed or cleanup incomplete';process.exitCode=1;}report.seconds=(performance.now()-started)/1000;await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:root+'/report.json'}));
}
