// Actual browser client -> HTTP lease -> supervised CGL, with the shared
// production Generator, semantic Session and prepared advance/render plans.
// Native rendering is explicitly selected for this validation page.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
const [specArg,referenceArg,outArg]=process.argv.slice(2);assert(specArg&&referenceArg&&outArg,'Supply spec.json original-reference-directory new-output-directory');
const out=resolve(outArg),reference=resolve(referenceArg),sha=b=>createHash('sha256').update(b).digest('hex');await mkdir(out,{recursive:false});
const snapshot=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true,withFileTypes:true})).filter(p=>p.isFile()).map(p=>p.parentPath+'/'+p.name).concat((await readdir('server/render')).map(p=>'server/render/'+p),'server/index.mjs','server/source-renderer.mjs','scripts/verify-source-iterated-native-http.mjs').sort().map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',scope:'Real headless browser/public HTTP client/lease/service/CGL through production Generator/native backend; opt-in declared Map/Symmetry case only; no other scene/cross-device claim',sourceBefore:await snapshot(),frames:[]},start=performance.now();let api,vite,browser;
try{
 const specBytes=await readFile(resolve(specArg)),spec=JSON.parse(specBytes),source=await readFile(resolve(spec.source.path));assert.equal(sha(source),spec.source.sha256);assert.equal(sha(await readFile(resolve(spec.source.jar))),spec.source.jarSha256);report.source=spec.source;report.specSha256=sha(specBytes);if(spec.coldReplay)report.coldReplay={...spec.coldReplay,note:'Cold fps explicitly matches the original reference display-rate input; other scene fields preserved. Static authored presets only; original wall-clock timestamps are not substituted into the fixed-frame owner.'};report.originalCompleteSha256=sha(await readFile(reference+'/complete.json'));
 const executablePath=out+'/renderer',build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});await writeFile(out+'/compile.log',build.stderr??'');assert.equal(build.error,undefined);assert.equal(build.status,0,build.stderr);assert.equal(build.stderr,'');report.executableSha256=sha(await readFile(executablePath));
 api=await createExportServer({root:out+'/service',sourceRendererBackend:{executablePath,executableSha256:report.executableSha256,timeoutMs:15000}});const address=await api.listen(0);
 const receiveFrame=(req,res,next)=>{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/__verify/frame')return next();void(async()=>{
  const index=Number(url.searchParams.get('index'));assert(Number.isInteger(index)&&spec.frames.some(f=>f.index===index));assert(!report.frames.some(f=>f.index===index));const chunks=[];let length=0;for await(const b of req){length+=b.length;assert(length<=spec.context.width*spec.context.height*4);chunks.push(b);}const actual=Buffer.concat(chunks),expected=await readFile(reference+`/frame-${index}/core.rgba`);assert.equal(actual.length,expected.length);let differences=0;const stride=spec.context.width*4;for(let y=0;y<spec.context.height;y++)for(let x=0;x<stride;x++)if(actual[y*stride+x]!==expected[(spec.context.height-1-y)*stride+x])differences++;
  await writeFile(out+`/frame-${index}.rgba`,actual,{flag:'wx'});report.frames.push({index,bytes:actual.length,rgbaDifferences:differences,actualSha256:sha(actual),originalSha256:sha(expected)});assert.equal(differences,0);res.writeHead(200,{'content-type':'application/json'});res.end('{}');
 })().catch(error=>{report.comparisonError=String(error.stack??error);res.writeHead(500);res.end(String(error));});};
 // Match production's absent HMR hook. Vite dev otherwise injects a client
 // WebSocket even with server.hmr=false; pagehide lease cleanup remains live.
 vite=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},plugins:[{name:'verification-production-lease',enforce:'pre',transform(code,id){if(id.endsWith('/src/engine/sourceNativeLease.ts'))return code.replaceAll('import.meta.hot','undefined');}},{name:'native-http-verification',configureServer(server){server.middlewares.use(receiveFrame);}}],server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${address.port}`,changeOrigin:false}}},logLevel:'error'});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();report.browserErrors=[];report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.browserErrors.push(m.text());});page.setDefaultTimeout(120000);const url=vite.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Native HTTP verification</title>'}));await page.goto(url);
 report.workflow=await page.evaluate(async({source,spec})=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{Generator}=await import('/src/engine/client.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},family=spec.family??'symmetry',liveKey=family==='map'?'mapLive':'symmetryLive',scene=parseProjectFile(source).scene,frames=[],generator=new Generator(),nativeFetch=window.fetch.bind(window);let requests=0,requestBytes=0,last;
  window.fetch=async(input,init)=>{if(String(input)==='/api/source-renderer/frames'){requests++;requestBytes+=init.body.byteLength;}return nativeFetch(input,init);};
  const describe=e=>({name:e?.name,message:e?.message,stack:e?.stack,errors:Array.from(e?.errors??[],describe)});let failure,interactions;
  const cold=spec.coldReplay;
  if(cold){assert(Number.isInteger(cold.fps)&&cold.fps>=1&&cold.fps<=120,'Explicit cold replay fps required');scene.timeline.fps=cold.fps;}
  const dig=async output=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output.pixels))).map(b=>b.toString(16).padStart(2,'0')).join(''),hashes=[];
  try{
   for(const frame of spec.frames){const start=performance.now(),output=await generator.generate(scene,{...spec.context,...(cold?{time:frame.index/cold.fps}:{[liveKey]:{sessionId:'public-native-http',renderFps:60,replayRevision:0,clock:{paused:false,timestampMs:frame.timestampMs}}})});assert(output.backend==='native'&&output.sourcePixelRenderer?.backend==='native','Native attribution missing');const r=await fetch('/__verify/frame?index='+frame.index,{method:'POST',body:output.pixels});assert(r.ok,'Comparison HTTP '+r.status+': '+await r.text());frames.push({index:frame.index,seconds:(performance.now()-start)/1000,display:output[liveKey]?.display,temporal:output.temporal,renderer:output.sourcePixelRenderer,requests,requestBytes});last=output;hashes.push(await dig(output));}
   const baseline={requests,requestBytes};
   if(cold){
    const first=await generator.generate(scene,{...spec.context,time:0});assert(await dig(first)===hashes[0],'Backwards replay changed fixed pixels');
    const end=await generator.generate(scene,{...spec.context,time:spec.frames.at(-1).index/cold.fps});assert(await dig(end)===hashes.at(-1),'Warm continuation changed fixed pixels');
    const fresh=new Generator();try{
     const rebuilt=await fresh.generate(scene,{...spec.context,time:spec.frames.at(-1).index/cold.fps});assert(await dig(rebuilt)===hashes.at(-1),'Fresh full reconstruction changed fixed pixels');
     const resized={...spec.context,time:2/cold.fps,width:160,height:120};
     const a=await generator.generate(scene,resized),b=await fresh.generate(scene,resized);assert(await dig(a)===await dig(b),'Resize reconstruction changed fixed pixels');
     interactions={cold:{fps:cold.fps,clock:'fixed-frame',backwards:true,warmContinuation:true,freshReconstruction:true,resize:{width:160,height:120,sha256:await dig(a)},baseline}};
    }finally{fresh.dispose();await fresh.settledNativeCleanup();}
   }else{
   await generator[family==='map'?'setMapPaused':'setSymmetryPaused'](last,true,spec.frames.at(-1).timestampMs+16);
   const shot=await generator[family==='map'?'captureMapPaused':'captureSymmetryPaused'](last,{width:160,height:120},1);assert(shot.capture.backend==='native'&&shot.preview.backend==='native','Capture did not use retained native backend');assert(shot.preview.width===spec.context.width&&shot.preview.height===spec.context.height,'Capture did not restore primary dimensions');
   const navigation=await generator.navigateIteratedPaused(shot.preview,{kind:'wheel',count:1});assert(navigation.backend==='native'&&navigation[liveKey].paused,'Paused navigation lost native owner');
   const begin=await generator.beginSourceRecording(navigation,{width:80,height:60,simulationFps:10});assert(begin.warmup.backend==='native','Recording warmup lost native owner');
   const recording=[];for(let index=1;index<=2;index++){const frame=await generator.nextSourceRecordingFrame(begin.handle,index);assert(frame.backend==='native'&&frame[liveKey].clock==='fixed-source-queue','Recording frame lost native owner or clock');recording.push({width:frame.width,height:frame.height,time:frame.time,recording:frame.iteratedRecording,renderer:frame.sourcePixelRenderer});}
   const stop=await generator.finishSourceRecording(begin.handle,spec.frames.at(-1).timestampMs+1000);assert(stop.preview.backend==='native'&&stop.preview[liveKey].paused===false,'Recording finish did not restore running primary');
   interactions={baseline,capture:{width:shot.capture.width,height:shot.capture.height,enhancement:shot.capture.sourcePausedImage,renderer:shot.capture.sourcePixelRenderer},navigation:{paused:navigation[liveKey].paused,renderer:navigation.sourcePixelRenderer},recording,stop:{width:stop.preview.width,height:stop.preview.height,paused:stop.preview[liveKey].paused,renderer:stop.preview.sourcePixelRenderer}};
   }
  }catch(error){failure=describe(error);}
  try{generator.dispose();await generator.settledNativeCleanup();}catch(error){throw Error(JSON.stringify({failure,cleanup:describe(error)}));}finally{window.fetch=nativeFetch;}if(failure)throw Error(JSON.stringify({failure}));return{frames,interactions,requests,requestBytes};
 },{source:source.toString(),spec});
 assert.equal(report.frames.length,spec.frames.length);assert.deepEqual(report.browserErrors,[]);assert.deepEqual(report.pageErrors,[]);await browser.close();browser=undefined;await api.close();report.ownedProcessesAfter=api.ownedProcessCount;assert.equal(report.ownedProcessesAfter,0);api=undefined;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await browser?.close();}catch(e){report.browserCleanupError=String(e);process.exitCode=1;}try{await api?.close();if(api)report.ownedProcessesAfter=api.ownedProcessCount;}catch(e){report.serviceCleanupError=String(e);process.exitCode=1;}await vite?.close();report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}report.seconds=(performance.now()-start)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,seconds:report.seconds,frames:report.frames.map(f=>({index:f.index,rgbaDifferences:f.rgbaDifferences})),sourceStable:report.sourceStable,ownedProcessesAfter:report.ownedProcessesAfter,error:report.error}));}
