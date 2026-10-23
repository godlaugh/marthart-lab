/** Original fixed-step, full-artwork recordings versus actual native client
 * frames. References must retain original authorization and branding draws. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {measureFamily} from './browser-process-cost.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcp} from 'node:net';
import assert from 'node:assert/strict';
const reference=process.argv[2],directory=process.argv[3];assert.ok(reference&&directory,'Reference and new output directories required');await mkdir(directory);
assert.equal(process.env.VITE_SOURCE_RENDERER,'native');assert.ok(process.env.MATHART_SOURCE_RENDERER_BACKEND);
const sha=b=>createHash('sha256').update(b).digest('hex'),references={};
const read=async p=>{const b=await readFile(p);references[p]=sha(b);return b;};
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p),...(await readdir('server',{recursive:true})).filter(p=>/\.(mjs|m|java)$/.test(p)).map(p=>'server/'+p),'scripts/verify-source-surface-recording-parity.mjs','desktop/graphics.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Original setRenderMode, Scene.runFrame(false), independent observed FPS and queue completion versus real imported Generator/Worker/native recording. Compare every artwork pixel before branding when transition alpha is zero, or the original final framebuffer when an opaque transition covers all branding. Partial transition alpha is unsupported and fails; no masking, image enhancement or tolerance. No original GUI interaction or native video encoder comparison.',cases:[],referenceHashes:references,sourceBefore:await hashes()};let server,service,browser;const started=performance.now();
try{
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';assert.equal(sha(await read(jar)),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
 service=await createExportServer({root:directory+'/service',allowedOrigins:[`http://127.0.0.1:${port}`],sourceRendererBackend:JSON.parse(await read(process.env.MATHART_SOURCE_RENDERER_BACKEND))});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});report.browserVersion=browser.version();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(`http://127.0.0.1:${port}/fixture`);
 const names=JSON.parse(await read(reference+'/cases.json'));
 assert.ok(Array.isArray(names)&&names.length>0&&names.length<=40&&new Set(names).size===names.length&&names.every(name=>typeof name==='string'&&/^[a-z0-9-]+$/.test(name)),'Expected distinct bounded reference case names');
 const measured=await measureFamily(process.pid,async()=>{
  for(const name of names){
   const native=reference+'/native-'+name,run=JSON.parse(await read(native+'/run.json')),text=await read(run.source),input=JSON.parse(text),frames=JSON.parse(await read(native+'/frames.json'));
   assert.equal(run.exit,0);assert.equal(run.timedOut,false);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(sha(text),run.sourceSha256);assert.equal(sha(await read(native+'/NativeSceneProbe.java')),run.probeSha256);assert.doesNotMatch(run.stderr,/GL_INVALID|OpenGL error/);assert.ok(frames.length>1&&frames.at(-1).complete);
   const output=await page.evaluate(async input=>{
    const{Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
    const scene=parseLegacyScene(JSON.stringify(input.project)).scene,g=new Generator(),rows=[];const encode=b=>{const chunks=[];for(let i=0;i<b.length;i+=32768)chunks.push(String.fromCharCode(...b.subarray(i,i+32768)));return btoa(chunks.join(''));};
    try{
     const initial=await g.generate(scene,{time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486),surfaceLive:{sessionId:'recording-parity',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}});
     const start=await g.beginSourceRecording(initial,{width:128,height:96,simulationFps:input.simulationFps,actualFrameRate:input.steps[0].actualFrameRate});
     for(let index=0;index<=start.clock.lastDisplayFrame;index++){
      const frame=index===0?start.warmup:await g.nextSourceRecordingFrame(start.handle,index,input.steps[index].actualFrameRate);
      if(frame.sourcePixelRenderer?.backend!=='native'||frame.formulaPresentation?.labels.length)throw Error('Expected native raw artwork with no authored formula');
      rows.push({index,width:frame.width,height:frame.height,facts:frame.surfaceLive,producer:frame.sourcePixelRenderer,pixels:encode(frame.pixels),png:encode(new Uint8Array(await(await encodeRgbaPng(frame.pixels,frame.width,frame.height)).arrayBuffer()))});
     }
     const stop=await g.finishSourceRecording(start.handle);return{rows,clock:start.clock,stop:stop.preview.surfaceLive};
    }finally{g.dispose();}
   },input);
   assert.equal(output.rows.length,frames.length);const rows=[];await mkdir(directory+'/'+name,{recursive:true});
   for(let i=0;i<frames.length;i++){
    const actual=output.rows[i],expected=frames[i];assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);assert.equal(actual.facts.frame.sceneTime,expected.sceneTime);assert.equal(actual.facts.frame.rawDt,expected.rawDt);assert.equal(actual.facts.frame.queueComplete,expected.complete);assert.equal(actual.facts.recording.actualFrameRate,expected.actualFrameRate);
    const opaque=expected.transitionOverlayAlpha===1;
    assert.ok(opaque||expected.transitionOverlayAlpha===0,'Partial transition reference stage is not supported');
    assert.equal(expected.artworkStage,opaque?'final-opaque-transition':'before-branding-no-transition');
    assert.equal(expected.artworkReference,opaque?'final.rgba':'before-branding.rgba');
    assert.equal(expected.rowOrder,opaque?'top-down':'bottom-up');
    const boundary=String(await read(native+'/frame-'+i+'/artwork-boundary.txt'));
    assert.match(boundary,/mathart\.scene\.Scene\.drawWatermark\(/);
    const a=Buffer.from(actual.pixels,'base64'),b=await read(native+'/frame-'+i+'/'+expected.artworkReference),stride=actual.width*4;assert.equal(a.length,b.length);assert.equal(a.length,actual.width*actual.height*4);let pixels=0,max=0;const examples=[];
    if(opaque)for(let p=0;p<b.length;p+=4)assert.deepEqual([...b.subarray(p,p+4)],[0,0,0,255],'Original opaque transition must cover the entire final framebuffer');
    for(let y=0;y<actual.height;y++)for(let x=0;x<actual.width;x++){const ap=y*stride+x*4,bp=(opaque?y:actual.height-1-y)*stride+x*4;let different=false;for(let k=0;k<4;k++){const delta=Math.abs(a[ap+k]-b[bp+k]);different||=delta!==0;max=Math.max(max,delta);}if(different){pixels++;if(examples.length<5)examples.push({x,y,actual:[...a.subarray(ap,ap+4)],expected:[...b.subarray(bp,bp+4)]});}}
    await writeFile(`${directory}/${name}/frame-${i}.png`,Buffer.from(actual.png,'base64'));await writeFile(`${directory}/${name}/frame-${i}.rgba`,a);
    rows.push({index:i,sceneTime:expected.sceneTime,actualFrameRate:expected.actualFrameRate,warmup:i===0,complete:expected.complete,artworkStage:expected.artworkStage,transitionOverlayAlpha:expected.transitionOverlayAlpha,differentPixels:pixels,maxChannelDelta:max,examples,actualSha256:sha(a),referenceSha256:sha(b),producer:actual.producer});
   }
   assert.deepEqual(output.stop.frame,output.rows.at(-1).facts.frame);const result={name,sourceSha256:run.sourceSha256,clock:output.clock,rows,stoppedWithoutAdvance:true};report.cases.push(result);console.log(JSON.stringify({name,frames:rows.length,differentPixels:rows.map(r=>r.differentPixels)}));
  }return{};
 });report.processFamily=measured.processFamily;report.errors=errors;assert.deepEqual(errors,[]);report.status=report.cases.every(c=>c.rows.every(r=>r.differentPixels===0))?'matched':'differences';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=(await Promise.all(Object.entries(references).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||!report.referencesStable||report.remainingProcesses!==0||report.cleanupErrors.length){report.status='failed';report.error??='Source/reference changed or cleanup incomplete';}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:directory+'/report.json'}));if(report.status!=='matched')process.exitCode=1;
}
