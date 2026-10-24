/** Original active recording frames and real VideoRecorder versus production
 * export planning, native Generator and FFmpeg transport. Branding is retained
 * in original movies; artwork is compared at the observed pre-branding stage. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createServer as tcpServer} from 'node:net';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {createExportServer} from '../server/index.mjs';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {measureFamily} from './browser-process-cost.mjs';
const [reference,out]=process.argv.slice(2);assert.ok(reference&&out,'Reference and new output directories required');await mkdir(out);
const sha=b=>createHash('sha256').update(b).digest('hex'),references={};
const read=async path=>{const bytes=await readFile(path);references[path]=sha(bytes);return bytes;};
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-recording-parity.mjs','scripts/capture-source-bouncing-original.py','scripts/lib/source-bouncing-original.mjs','scripts/lib/verify-png.mjs','scripts/browser-process-cost.mjs','tests/fixtures/source-bouncing-native-animation/presets.json','tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java','server/index.mjs','server/source-renderer.mjs','server/render/SourceCglRenderer.m','server/render/SourceCglBouncingState.h');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',scope:'Full original particle count; record_duration only changed to0.3s. Four consecutive active frames at12fps, one warmup and three encoded frames. Original default3x sizing, original full artwork RGB/cameras/final alpha versus native product export plan. Original branded VideoRecorder MP4 versus service encoding identical original PNG input, same installed FFmpeg; no product branding or GUI movie claim.',sourceBefore:await hashes(),references,frames:[]};
let service,server,browser;const started=performance.now();
try{
 const run=JSON.parse(await read(reference+'/run.json')),descriptor=JSON.parse(await read(run.source)),frames=JSON.parse(await read(reference+'/frames.json')),encoder=JSON.parse(await read(reference+'/encoder.json'));
 assert.equal(run.mode,'recording');assert.equal(run.captureStatus,'passed');assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);assert.doesNotMatch(run.stdout,/ ERROR /);assert.equal(run.stderr,'');
 assert.equal(sha(await read(run.source)),run.sourceSha256);assert.equal(sha(await read(reference+'/NativeSceneProbe.java')),run.probeSha256);
 // Historical 12fps probe remains a valid reference after adding explicit
 // recording-clock inputs. Its observed bytes must still match its pinned hash.
 assert.ok(['9c4c311c493ca322c9c1ea73466af27ecba4d60d9537ec9076b5ad060cb88eac',sha(await readFile('tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java'))].includes(run.probeSha256));
 assert.equal(descriptor.fps??12,12);
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';assert.equal(sha(await read(jar)),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 const original=execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,run.sourceMember]),preset=sourceBouncingOriginalPreset(original),expected=JSON.parse(original);assert.equal(preset.sourceSha256,run.originalSourceSha256);expected.settings.record_duration=.3;assert.deepEqual(descriptor.project,expected);
 assert.equal(frames.length,4);assert.equal(frames.at(-1).complete,true);assert.equal(encoder.exportScaleFactor,3);assert.equal(encoder.aliveAfterFinish,false);assert.equal(encoder.exit,0);assert.equal(sha(await read(encoder.command)),run.ffmpeg.sha256);
 for(const key of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[key],run.userFilesAfter[key]);
 report.original={preset,...run,encoder};delete report.original.stdout;delete report.original.stderr;
 const backend=JSON.parse(await read(process.env.MATHART_SOURCE_RENDERER_BACKEND));report.backend=backend;
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
 service=await createExportServer({root:out+'/service',ffmpegPath:encoder.command,sourceRendererBackend:backend,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();report.browser=browser.version();report.pageErrors=[];page.on('pageerror',error=>report.pageErrors.push(error.message));await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(`http://127.0.0.1:${port}/fixture`);
 const measured=await measureFamily(process.pid,async()=>{
  const result=await page.evaluate(async project=>{
   const [{Generator},{parseLegacyScene},{prepareSourceBouncingExport,sourceBouncingExportContext,assertSourceBouncingExportFrame},{sourceBouncingSeedCheckpoint},{sourceBouncingNativeSession},{prepareSourceCamera},{sourceBouncingViewInput}]=await Promise.all([import('/src/engine/client.ts'),import('/src/engine/legacyImport.ts'),import('/src/engine/sourceBouncingExport.ts'),import('/src/engine/sourceBouncingReplay.ts'),import('/src/engine/sourceBouncingNativeSession.ts'),import('/src/engine/sourceCamera.ts'),import('/src/engine/sourceBouncingNavigation.ts')]);
   const scene=parseLegacyScene(JSON.stringify(project)).scene,g=new Generator(),rows=[];const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
   const encode=bytes=>{const parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));};
   try{
    const initial=await g.generate(scene,{time:0,quality:'preview',width:810,height:972,sourcePointPixelDensity:2,sourceViewport:{logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary',projectionPass:'perspective'},sourceBouncingFrame:sourceBouncingSeedCheckpoint()});
    const plan=take(prepareSourceBouncingExport(scene,{ready:true,frame:initial.sourceBouncingFrame},{kind:'video',start:'seed',width:128,height:96,fps:12}));
    const camera=take(prepareSourceCamera(sourceBouncingViewInput(plan.view),plan.viewport));if(camera.kind!=='known')throw Error('unknown camera');
    for(const checkpoint of [plan.warmup,...plan.frames]){const frame=await g.generate(scene,sourceBouncingExportContext(plan,checkpoint));assertSourceBouncingExportFrame(frame,plan,checkpoint);rows.push({width:frame.width,height:frame.height,checkpoint:frame.sourceBouncingFrame.checkpoint,backend:frame.backend,pixels:encode(frame.pixels)});}
    return{plan,camera:camera.plan,rows};
   }finally{g.dispose();await g.settledNativeCleanup();const retired=sourceBouncingNativeSession.diagnostics();if(retired.owned||retired.active||retired.cleanupPending)throw Error('Native recording state was not retired');}
  },descriptor.project);
  assert.equal(result.rows.length,frames.length);assert.equal(result.plan.width,384);assert.equal(result.plan.height,288);assert.deepEqual(result.plan.requestedSize,{width:128,height:96});
  for(let i=0;i<frames.length;i++){
   const expected=frames[i],actual=result.rows[i],point=JSON.parse(await read(reference+'/frame-'+i+'/point-draw.json')),art=await read(reference+'/frame-'+i+'/before-branding.rgba'),final=await read(reference+'/frame-'+i+'/final.rgba'),png=decodePng(await read(reference+'/frame-'+i+'/final.png'));
   assert.deepEqual(point.viewport,[0,0,384,288]);assert.equal(point.count,preset.particleCount);assert.equal(point.simulationUpdates,i+1);assert.equal(actual.checkpoint.simulationUpdates,point.simulationUpdates);assert.equal(actual.checkpoint.sceneTime,expected.sceneTime);assert.equal(expected.rawDt,Math.fround(1/12));assert.equal(expected.encoded,i>0);assert.equal(actual.backend,'native');assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
   assert.deepEqual(point.projection,Array.from(result.camera.projection.columnMajor));assert.deepEqual(point.modelview,Array.from(result.camera.modelView.columnMajor));assert.ok(Buffer.from(png.rgba).equals(final));if(i>0)assert.ok((await read(reference+'/frame-'+i+'/encoder-input.rgba')).equals(final));
   assert.match(String(await read(reference+'/frame-'+i+'/artwork-boundary.txt')),/mathart\.scene\.Scene\.drawWatermark\(/);
   const pixels=Buffer.from(actual.pixels,'base64');assert.equal(pixels.length,art.length);assert.equal(pixels.length,384*288*4);let rgbPixels=0,alphaPixels=0,maxDelta=0;const examples=[];
   for(let y=0;y<288;y++)for(let x=0;x<384;x++){const a=(y*384+x)*4,b=((287-y)*384+x)*4;let different=false;for(let c=0;c<3;c++){const delta=Math.abs(pixels[a+c]-art[b+c]);different||=delta!==0;maxDelta=Math.max(maxDelta,delta);}if(different){rgbPixels++;if(examples.length<4)examples.push({x,y,actual:[...pixels.subarray(a,a+4)],reference:[...art.subarray(b,b+4)]});}if(pixels[a+3]!==final[a+3])alphaPixels++;}
   await writeFile(out+'/frame-'+i+'.rgba',pixels);report.frames.push({frame:i,warmup:i===0,checkpoint:actual.checkpoint,width:actual.width,height:actual.height,rgbPixels,alphaPixels,maxDelta,examples,cameraMatricesExact:true,actualSha256:sha(pixels),referenceSha256:sha(art)});
  }
  report.plan=result.plan;
  // Encode every original branded frame through the production service. The
  // original VideoRecorder chose/ran its own unmodified argv, including scaling.
  const base='http://127.0.0.1:'+address.port,request=async(path,body,headers={'content-type':'application/json'})=>{const r=await fetch(base+path,{method:'POST',headers,body:headers['content-type']==='application/json'?JSON.stringify(body):body});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
  const {id}=await request('/api/exports',{width:128,height:96,inputWidth:384,inputHeight:288,fps:12,frames:3,format:'mp4',profile:'mathart',quality:'high'});
  for(let i=1;i<frames.length;i++)await request('/api/exports/'+id+'/frames?index='+(i-1),await read(reference+'/frame-'+i+'/final.png'),{'content-type':'image/png'});
  await request('/api/exports/'+id+'/finish',{});
  const originalVideo=reference+'/original.mp4',productVideo=out+'/service/'+id+'.mp4';await read(originalVideo);
  const decode=path=>execFileSync(encoder.command,['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:1024*1024}),a=decode(originalVideo),b=decode(productVideo);assert.equal(a.length,3*128*96*3);assert.equal(a.length,b.length);
  let different=0,max=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(delta)different++;max=Math.max(max,delta);}
  report.video={original:originalVideo,product:productVideo,originalSha256:references[originalVideo],productSha256:sha(await readFile(productVideo)),decodedBytes:a.length,differentComponents:different,maxDelta:max,exactDecodedRgb:a.equals(b)};
  return{};
 });report.processFamily=measured.processFamily;assert.deepEqual(report.pageErrors,[]);report.status=report.frames.every(f=>f.rgbPixels===0&&f.alphaPixels===0)&&report.video.exactDecodedRgb?'passed':'differences';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map(r=>r.status);report.remainingProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=(await Promise.all(Object.entries(references).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||!report.referencesStable||report.remainingProcesses||report.cleanup.includes('rejected'))report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,frames:report.frames.map(f=>({frame:f.frame,rgbPixels:f.rgbPixels,alphaPixels:f.alphaPixels})),video:report.video,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
