/** Full original-duration, default-size recording. Complete per-frame RGB and
 * alpha hashes are independently checked against retained lossless PNGs. The
 * browser holds one generated frame; the service encodes original branded PNGs. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createServer as tcpServer} from 'node:net';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {createExportServer} from '../server/index.mjs';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';
import {measureFamily} from './browser-process-cost.mjs';
import {reuseSourceBouncingRecordingPngs} from './lib/source-bouncing-recording-png-cache.mjs';
const execute=promisify(execFile),[reference,out,cacheFlag,previousReport,...extra]=process.argv.slice(2);assert.ok(reference&&out,'Reference and new output required');assert.ok(cacheFlag===undefined||cacheFlag==='--reuse-png-validation'&&previousReport&&!extra.length,'Optional --reuse-png-validation requires one completed report');await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),references={};
const read=async path=>{const bytes=await readFile(path);references[path]=sha(bytes);return bytes;};
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-full-recording.mjs','scripts/lib/source-bouncing-recording-png-cache.mjs','scripts/lib/source-bouncing-recording-pngs.py','scripts/capture-source-bouncing-original.py','scripts/lib/source-bouncing-original.mjs','scripts/browser-process-cost.mjs','tests/fixtures/source-bouncing-native-animation/presets.json','tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java','server/index.mjs','server/source-renderer.mjs','server/render/SourceCglRenderer.m','server/render/SourceCglBouncingState.h');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',at:new Date().toISOString(),scope:'Unmodified original full preset/duration, configured simulation60fps, original default500x600 output/default3x1500x1800 render. Original effective encoderFPS is observed from its real argv; product explicitly selects that encoding rate separately from simulation. Every active artwork RGB/finalalpha/camera/clock versus real product Generator; identical original branded PNGs encoded with the same rates and compared over every decoded RGB byte by SHA256. No product branding or original GUI-window claim.',sourceBefore:await hashes(),references,frames:[],pageErrors:[]};
let service,server,browser,page,exportId;const started=performance.now();
try{
 const run=JSON.parse(await read(reference+'/run.json')),descriptor=JSON.parse(await read(run.source)),frames=JSON.parse(await read(reference+'/frames.json')),encoder=JSON.parse(await read(reference+'/encoder.json'));
 assert.equal(run.mode,'recording');assert.equal(run.captureStatus,'passed');assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);assert.equal(run.stderr,'');assert.doesNotMatch(run.stdout,/ ERROR /);
 assert.equal(run.recording.fullPreset,true);assert.equal(descriptor.fullRecording,true);assert.equal(descriptor.fps,60);assert.equal(descriptor.width,500);assert.equal(descriptor.height,600);
 assert.equal(sha(await read(run.source)),run.sourceSha256);assert.equal(sha(await read(reference+'/NativeSceneProbe.java')),run.probeSha256);assert.equal(run.probeSha256,sha(await readFile('tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java')));
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';assert.equal(sha(await read(jar)),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 const {stdout:original}=await execute('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,run.sourceMember],{encoding:'buffer'}),preset=sourceBouncingOriginalPreset(original);assert.equal(preset.sourceSha256,run.originalSourceSha256);assert.deepEqual(descriptor.project,JSON.parse(original));assert.equal(run.recording.duration,descriptor.project.settings.record_duration);
 assert.ok(frames.length>8&&frames.length<10000);assert.equal(frames.at(-1).complete,true);assert.equal(encoder.exportScaleFactor,3);assert.equal(encoder.aliveAfterFinish,false);assert.equal(encoder.exit,0);assert.equal(sha(await read(encoder.command)),run.ffmpeg.sha256);
 assert.equal(run.hostSha256,'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e');assert.equal(sha(await read(run.command[0])),run.hostSha256);
 const rates=encoder.arguments.flatMap((value,i)=>value==='-r'?[encoder.arguments[i+1]]:[]);assert.equal(rates.length,1);const encodingFps=Number(rates[0]);assert.ok(Number.isSafeInteger(encodingFps)&&encodingFps>=1&&encodingFps<=120);
 for(const name of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[name],run.userFilesAfter[name]);
 report.original={preset,duration:run.recording.duration,simulationFps:descriptor.fps,encodingFps,frames:frames.length,encodedFrames:frames.length-1,seconds:run.seconds,probeSha256:run.probeSha256,encoder};
 const measured=await measureFamily(process.pid,async()=>{
  let validation,pixels;
  if(previousReport){
   const cached=await reuseSourceBouncingRecordingPngs(reference,frames,previousReport,read);({validation,pixels}=cached);report.pngValidationSource=cached.source;report.pngValidationReuse=cached.reuse;
  }else{
   await execute('python3',['scripts/lib/source-bouncing-recording-pngs.py',reference,out+'/png-validation'],{timeout:900000,maxBuffer:1024*1024});
   validation=JSON.parse(await read(out+'/png-validation/report.json'));pixels=String(await read(out+'/png-validation/frames.jsonl')).trim().split('\n').map(line=>JSON.parse(line));report.pngValidationSource={directory:out+'/png-validation'};
  }
  assert.equal(validation.status,'passed');assert.equal(validation.frames,frames.length);report.pngValidation=validation;assert.equal(pixels.length,frames.length);for(const row of pixels)Object.assign(references,row.files);
  const backend=JSON.parse(await read(process.env.MATHART_SOURCE_RENDERER_BACKEND));report.backend=backend;
  const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
  service=await createExportServer({root:out+'/service',ffmpegPath:encoder.command,sourceRendererBackend:backend,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
  server=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();report.browser=browser.version();page.on('pageerror',error=>report.pageErrors.push(error.message));await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(`http://127.0.0.1:${port}/fixture`);
  const prepared=await page.evaluate(async descriptor=>{
   const [{Generator},{parseLegacyScene},exports,clock,{sourceBouncingNativeSession:owner},{prepareSourceCamera},{sourceBouncingViewInput}]=await Promise.all([import('/src/engine/client.ts'),import('/src/engine/legacyImport.ts'),import('/src/engine/sourceBouncingExport.ts'),import('/src/engine/sourceBouncingReplay.ts'),import('/src/engine/sourceBouncingNativeSession.ts'),import('/src/engine/sourceCamera.ts'),import('/src/engine/sourceBouncingNavigation.ts')]);
   const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},scene=parseLegacyScene(JSON.stringify(descriptor.project)).scene,g=new Generator();
   globalThis.fullRecording={g,scene,exports,owner};
   const initial=await g.generate(scene,{time:0,quality:'preview',width:810,height:972,sourcePointPixelDensity:2,sourceViewport:{logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary',projectionPass:'perspective'},sourceBouncingFrame:clock.sourceBouncingSeedCheckpoint()});
   const plan=take(exports.prepareSourceBouncingExport(scene,{ready:true,frame:initial.sourceBouncingFrame},{kind:'video',start:'seed',width:descriptor.width,height:descriptor.height,fps:descriptor.encodingFps,simulationFps:descriptor.fps})),camera=take(prepareSourceCamera(sourceBouncingViewInput(plan.view),plan.viewport));if(camera.kind!=='known')throw Error('Unknown camera');globalThis.fullRecording.plan=plan;
   return{plan,camera:{projection:Array.from(camera.plan.projection.columnMajor),modelview:Array.from(camera.plan.modelView.columnMajor)}};
  },{...descriptor,encodingFps});
  const plan=prepared.plan;assert.equal(plan.frames.length,frames.length-1);assert.equal(plan.width,1500);assert.equal(plan.height,1800);assert.deepEqual(plan.recording,{simulationFps:60,encodingFps});report.plan={width:plan.width,height:plan.height,viewport:plan.viewport,view:plan.view,recording:plan.recording,warmup:plan.warmup,last:plan.frames.at(-1),encodedFrames:plan.frames.length};
  const request=async(path,body,headers={'content-type':'application/json'})=>{const response=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers,body:headers['content-type']==='application/json'?JSON.stringify(body):body});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
  ({id:exportId}=await request('/api/exports',{width:500,height:600,inputWidth:1500,inputHeight:1800,fps:plan.recording.encodingFps,frames:plan.frames.length,format:'mp4',profile:'mathart',quality:'high'}));
  let uploadedBytes=0;
  for(let i=0;i<frames.length;i++){
   const expected=frames[i],point=JSON.parse(await read(reference+'/frame-'+i+'/point-draw.json')),fact=pixels[i];assert.equal(fact.frame,i);assert.deepEqual(point.viewport,[0,0,1500,1800]);assert.equal(point.count,preset.particleCount);assert.equal(point.simulationUpdates,i+1);assert.deepEqual(point.projection,prepared.camera.projection);assert.deepEqual(point.modelview,prepared.camera.modelview);assert.equal(expected.encoded,i>0);assert.equal(expected.complete,i===frames.length-1);assert.equal(expected.rawDt,Math.fround(1/60));
   const actual=await page.evaluate(async i=>{
    const {g,scene,plan,exports}=globalThis.fullRecording,checkpoint=i===0?plan.warmup:plan.frames[i-1],frame=await g.generate(scene,exports.sourceBouncingExportContext(plan,checkpoint));exports.assertSourceBouncingExportFrame(frame,plan,checkpoint);globalThis.fullRecording.last=frame;
    const rgb=new Uint8Array(frame.pixels.length/4*3),alpha=new Uint8Array(frame.pixels.length/4);for(let p=0,k=0;p<frame.pixels.length;p+=4){rgb[k++]=frame.pixels[p];rgb[k++]=frame.pixels[p+1];rgb[k++]=frame.pixels[p+2];alpha[p/4]=frame.pixels[p+3];}
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
    return{checkpoint:frame.sourceBouncingFrame.checkpoint,backend:frame.backend,width:frame.width,height:frame.height,rgbSha256:await hash(rgb),alphaSha256:await hash(alpha),renderer:frame.sourcePixelRenderer};
   },i);
   assert.equal(actual.backend,'native');assert.equal(actual.width,1500);assert.equal(actual.height,1800);assert.equal(actual.checkpoint.simulationUpdates,i+1);assert.equal(actual.checkpoint.sceneTime,expected.sceneTime);
   const exact=actual.rgbSha256===fact.pixels.artworkRgbSha256&&actual.alphaSha256===fact.pixels.finalAlphaSha256;report.frames.push({frame:i,...actual,artworkRgbExact:actual.rgbSha256===fact.pixels.artworkRgbSha256,finalAlphaExact:actual.alphaSha256===fact.pixels.finalAlphaSha256});
   if(!exact){const raw=await page.evaluate(()=>{const bytes=globalThis.fullRecording.last.pixels,parts=[];for(let n=0;n<bytes.length;n+=32768)parts.push(String.fromCharCode(...bytes.subarray(n,n+32768)));return btoa(parts.join(''));});await writeFile(out+'/different-frame-'+i+'.rgba',Buffer.from(raw,'base64'));throw Error('Full native frame differs at '+i);}
   if(i){const path=reference+'/frame-'+i+'/final.png',png=await readFile(path);assert.equal(sha(png),references[path]);uploadedBytes+=png.length;await request('/api/exports/'+exportId+'/frames?index='+(i-1),png,{'content-type':'image/png'});}
   if(i%60===0||i===frames.length-1){const progress={comparedFrames:i+1,totalFrames:frames.length,sceneTime:actual.checkpoint.sceneTime,uploadedBytes};await writeFile(out+'/progress.json',JSON.stringify(progress)+'\n');console.log(JSON.stringify(progress));}
  }
  await request('/api/exports/'+exportId+'/finish',{});const movie=out+'/service/'+exportId+'.mp4';exportId=undefined;
  const ffprobe=join(dirname(encoder.command),'ffprobe');await read(ffprobe);
  const metadata=async path=>JSON.parse((await execute(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',path],{timeout:180000})).stdout).streams[0];
  const videoHash=async path=>(await execute(encoder.command,['-v','error','-i',path,'-map','0:v:0','-c:v','rawvideo','-pix_fmt','rgb24','-f','hash','-hash','sha256','pipe:1'],{timeout:180000})).stdout.trim();
  const originalVideo=reference+'/original.mp4';await read(originalVideo);const originalMetadata=await metadata(originalVideo),productMetadata=await metadata(movie);assert.deepEqual(productMetadata,originalMetadata);assert.equal(Number(originalMetadata.nb_read_frames),frames.length-1);assert.equal(originalMetadata.width,500);assert.equal(originalMetadata.height,600);assert.equal(originalMetadata.r_frame_rate,encodingFps+'/1');
  const originalRgbSha=await videoHash(originalVideo),productRgbSha=await videoHash(movie);assert.match(originalRgbSha,/^SHA256=[a-f0-9]{64}$/);assert.equal(productRgbSha,originalRgbSha);report.video={original:originalVideo,product:movie,originalSha256:references[originalVideo],productSha256:sha(await readFile(movie)),originalMetadata,productMetadata,decodedRgbHash:originalRgbSha,exactDecodedRgb:true,uploadedBytes,decodedBytes:(frames.length-1)*500*600*3};
  await page.evaluate(async()=>{const {g,owner}=globalThis.fullRecording;g.dispose();await g.settledNativeCleanup();const state=owner.diagnostics();if(state.owned||state.active||state.cleanupPending)throw Error('Native recording resource remains owned');globalThis.fullRecording=undefined;});
  return{};
 });report.processFamily=measured.processFamily;assert.deepEqual(report.pageErrors,[]);assert.equal(report.frames.length,frames.length);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 if(page)await page.evaluate(async()=>{const current=globalThis.fullRecording;if(current){current.g.dispose();await current.g.settledNativeCleanup();}}).catch(error=>{report.cleanupError=String(error);});
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map(r=>r.status);report.remainingProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 report.referencesStable=true;for(const [path,digest] of Object.entries(references))if(sha(await readFile(path))!==digest)report.referencesStable=false;report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||!report.referencesStable||report.remainingProcesses||report.cleanup.includes('rejected')||report.cleanupError)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,comparedFrames:report.frames.length,error:report.error,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
