/** Public App export acceptance. Native CGL/real FFmpeg, headless Chrome.
 * Boundary telemetry observes production Generator results; it is not an
 * independent original-art oracle. Only transport faults below are injected. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as tcpServer} from 'node:net';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createExportServer} from '../server/index.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';
const out=process.argv[2]??'.cache/bouncing-native-export-20261024';
const presetAt=process.argv.indexOf('--preset'),presetName=presetAt>=0?process.argv[presetAt+1]:process.argv.includes('--five-million')?'bouncing2':undefined;
if(presetAt>=0&&!presetName||presetName&&!/^[a-z0-9_]+$/.test(presetName))throw Error('--preset requires a packaged preset basename');
if(presetAt>=0&&process.argv.includes('--five-million'))throw Error('Select one preset option');
await mkdir(out,{recursive:true});
const backend=JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={status:'running',at:new Date().toISOString(),backend,checks:[],videos:[],images:[],pageErrors:[],scope:'Synthetic 512-particle public App PNG, seed/current MP4, preview recovery and export cleanup failures. Exact PNG/HTTP RGBA versus actual native Generator output; H.264 is lossy. No independent original application video oracle.'};
if(presetName)report.scope=`Unmodified original ${presetName}.json public import at full particle count, then recordDuration changed to 0.3s for public native App PNG, seed/current MP4, preview recovery and cleanup fault checks. No original application runtime/art comparison in this workflow. Exact PNG/HTTP RGBA versus delivered native Generator; H.264 is lossy.`;
const check=(value,message)=>{if(!value)throw Error(message);report.checks.push(message);};
async function hashes(){const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-native-export.mjs','scripts/lib/verify-png.mjs','scripts/lib/source-bouncing-original.mjs','tests/fixtures/source-bouncing-native-animation/presets.json','server/source-renderer.mjs','server/index.mjs','server/render/SourceCglRenderer.m');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(p))])));}
report.sourceBefore=await hashes();
let service,server,browser,page,phase='setup';
const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
try{
 service=await createExportServer({sourceRendererBackend:backend,root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1360,height:920},deviceScaleFactor:2,acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 await page.addInitScript(()=>{
  window.__nativeExportAudit={calls:[],failRelease:false,holdRelease:false,releaseWaiters:[],blockedReleases:0};
  const original=window.fetch;
  window.fetch=async(url,init)=>{
   const body=init?.body;
   if(body instanceof Uint8Array&&body.byteLength>=64){const view=new DataView(body.buffer,body.byteOffset,body.byteLength);
    if(view.getUint32(4,true)===4&&view.getUint32(60,true)===4){
     const audit=window.__nativeExportAudit;
     if(audit.holdRelease)await new Promise(resolve=>audit.releaseWaiters.push(resolve));
     if(audit.failRelease){audit.blockedReleases++;return new Response(JSON.stringify({kind:'unavailable',error:'Injected export release failure'}),{status:503});}
    }
   }
   return original(url,init);
  };
 });
 // Append observation after Vite transforms the real module, keeping its exact
 // module identity for the App. Do not replace generation/encoding algorithms.
 await context.route('**/src/engine/client.ts',async route=>{
  const response=await route.fetch(),body=await response.text();
  await route.fulfill({response,body:body+`\nconst auditGenerate=Generator.prototype.generate;
Generator.prototype.generate=async function(scene,input,...rest){
 const call={scene:structuredClone(scene),input:structuredClone(input)};window.__nativeExportAudit.calls.push(call);
 try{const output=await auditGenerate.call(this,scene,input,...rest);
  if(output.sourceBouncingFrame){const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('');
   call.output={width:output.width,height:output.height,backend:output.backend,frame:output.sourceBouncingFrame,renderer:output.sourcePixelRenderer,pixelSha:await hash(output.pixels)};
   if(input.quality==='export'){const{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');call.output.pausedPngSha=await hash(enhanceSourcePausedImage(output.pixels,output.width,output.height));}
  }return output;
 }catch(error){call.error={name:error.name,message:error.message};throw error;}
};`});
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{
  const[{createScene,saveWorkspace},{definition},{importSourceBouncingDocument}]=await Promise.all([import('/src/engine/document.ts'),import('/src/scenes/index.ts'),import('/src/engine/sourceBouncingDocument.ts')]);
  const scene=createScene(definition('bouncing')),parsed=importSourceBouncingDocument({settings:{particle_count:512,seed:1}});if(!parsed.ok)throw Error(JSON.stringify(parsed.error));
  scene.bouncingSource=parsed.value.payload;scene.bouncingSource.recordDuration=Math.fround(.3);scene.bouncingSource.visual.dotSize=4;scene.bouncingSource.configuration.initialSpeed=.3;
  scene.settings={};scene.equations={};scene.parameters={};scene.timeline={duration:10,fps:30,loop:false,tracks:[]};scene.projectResolution={width:384,height:256};
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'standard',frameRate:30}});
 });
 await page.goto(origin);
 const ready=()=>page.waitForFunction(()=>{
  const a=window.__nativeExportAudit,c=a.calls.findLast(c=>c.input.quality!=='export');
  return c?.output&&!document.querySelector('[data-testid="source-bouncing-play"]')?.disabled&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');
 });
 const snapshot=()=>page.evaluate(()=>window.__nativeExportAudit.calls.findLast(c=>c.input.quality!=='export'));
 const diagnostics=()=>page.evaluate(async()=> (await import('/src/engine/sourceBouncingNativeSession.ts')).sourceBouncingNativeSession.diagnostics());
 const exportsSince=begin=>page.evaluate(begin=>window.__nativeExportAudit.calls.slice(begin).filter(c=>c.input.quality==='export'),begin);
 const begin=()=>page.evaluate(()=>window.__nativeExportAudit.calls.length);
 const seek=async n=>{const previous=await begin();await page.getByTestId('source-bouncing-seek').fill(String(n));await page.getByTestId('source-bouncing-seek').press('Enter');await page.waitForFunction(({previous,n})=>window.__nativeExportAudit.calls.slice(previous).some(c=>c.input.quality!=='export'&&c.output?.frame.checkpoint.simulationUpdates===n),{previous,n});await ready();return snapshot();};
 const dialog=()=>page.getByRole('dialog',{name:'Export artwork',exact:true});
 const close=()=>page.getByRole('button',{name:'Close export',exact:true});
 const startButton=()=>page.getByRole('button',{name:'Start export',exact:true});
 const settledExport=()=>page.waitForFunction(()=>!document.querySelector('button[aria-label="Close export"]')?.disabled);
 const dimensions=async(w,h)=>{await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(w));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(h));};
 const openExport=async(kind)=>{const health=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');await page.getByRole('button',{name:'Export artwork',exact:true}).click();check((await (await health).json()).ffmpeg,'FFmpeg ready for '+kind);await page.getByRole('button',{name:kind,exact:true}).click();};
 const download=async name=>{const event=page.waitForEvent('download',{timeout:120000});await startButton().click();const received=await event,path=out+'/'+name;await received.saveAs(path);return path;};
 const recoverPreview=async(before,label)=>{
  await close().click();await ready();check(JSON.stringify((await snapshot()).output.frame.checkpoint)===JSON.stringify(before.output.frame.checkpoint),label+' preserves paused preview checkpoint');
  const after=await seek(before.output.frame.checkpoint.simulationUpdates);
  check(after.output.pixelSha===before.output.pixelSha,label+' reconstructs identical native preview pixels after export retirement');
  const prior=after.output.frame.checkpoint.simulationUpdates,playBegin=await begin();
  await page.getByTestId('source-bouncing-play').click();await page.waitForFunction(({prior,playBegin})=>window.__nativeExportAudit.calls.slice(playBegin).some(c=>c.input.quality!=='export'&&c.output?.frame.checkpoint.simulationUpdates>=prior+2),{prior,playBegin});await page.getByTestId('source-bouncing-play').click();await ready();
  check((await snapshot()).output.frame.checkpoint.simulationUpdates>prior,label+' resumes actual native playback');
  await seek(prior);
 };
 await ready();check((await snapshot()).output.backend==='native','App generates native Bouncing pixels');check(await page.getByTestId('native-art-canvas').isVisible(),'native canvas visible');
 if(presetName){
  phase='original-'+presetName+'-import';const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',member='data/Bouncing/'+presetName+'.json';
  const jarSha=sha(await readFile(jar));check(jarSha==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','original JAR hash matches');
  const raw=execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,member]),sourceSha=sha(raw),preset=sourceBouncingOriginalPreset(raw);check(preset.member===member&&preset.sourceSha256===sourceSha,'selected original source bytes match');
  await page.locator('input[type=file]').setInputFiles({name:presetName+'.json',mimeType:'application/json',buffer:raw});
  await page.waitForFunction(count=>{const c=window.__nativeExportAudit.calls.findLast(c=>c.input.quality!=='export');return c?.scene.bouncingSource?.configuration.particleCount===count&&c.output;},preset.particleCount);await ready();
  const imported=await snapshot();check(imported.output.frame.checkpoint.simulationUpdates===0&&JSON.stringify(imported.scene.provenance.original)===JSON.stringify(JSON.parse(raw)),'original public import preserves source and initially presents seeds');
  await page.locator('.inspector-tabs button').nth(1).click();const duration=page.getByTestId('source-bouncing-recordDuration');await duration.fill('.3');await duration.blur();
  await page.waitForFunction(()=>{const c=window.__nativeExportAudit.calls.findLast(c=>c.input.quality!=='export');return c?.scene.bouncingSource?.recordDuration===Math.fround(.3)&&c.output;});await ready();
  const edited=await snapshot();check(JSON.stringify({...edited.scene.bouncingSource,recordDuration:imported.scene.bouncingSource.recordDuration})===JSON.stringify(imported.scene.bouncingSource),'original import changes only recording duration');
  report.original={jar,jarSha,member,sourceSha,count:preset.particleCount,recordDuration:Math.fround(.3)};
 }
 await seek(3);
 if(!presetName){
  phase='paused-view';const before=await snapshot(),offset=await begin(),box=await page.getByTestId('native-art-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+14,box.y+box.height*.5+9);await page.mouse.up();
  await page.waitForFunction(offset=>window.__nativeExportAudit.calls.slice(offset).some(c=>c.input.quality!=='export'&&c.output),offset);await ready();
  check(JSON.stringify((await snapshot()).output.frame.camera)!==JSON.stringify(before.output.frame.camera),'paused native camera gesture changes delivered view');
 }
 phase='png-and-delayed-cleanup';const preview=await snapshot(),imageBegin=await begin();
 await openExport('Still image');await dimensions(257,193);await dialog().locator('h2').click();await page.keyboard.press('Space');
 check(JSON.stringify((await snapshot()).output.frame.checkpoint)===JSON.stringify(preview.output.frame.checkpoint),'export modal Space leaves preview paused');
 await page.evaluate(()=>window.__nativeExportAudit.holdRelease=true);
 const pngPath=await download('current.png');await page.waitForFunction(()=>window.__nativeExportAudit.releaseWaiters.length>0);
 check(await close().isDisabled()&&await startButton().count()===0,'dialog remains busy until asynchronous native retirement finishes');
 await page.evaluate(()=>{const a=window.__nativeExportAudit;a.holdRelease=false;for(const resolve of a.releaseWaiters.splice(0))resolve();});await settledExport();
 const image=(await exportsSince(imageBegin))[0],decoded=decodePng(await readFile(pngPath));
 check(decoded.width===258&&decoded.height===194,'odd PNG size follows delivered Retina density');
 check(sha(decoded.rgba)===image.output.pausedPngSha,'downloaded PNG exactly matches enhanced native Generator pixels');
 check(JSON.stringify(image.output.frame.checkpoint)===JSON.stringify(preview.output.frame.checkpoint),'PNG does not advance simulation');
 check(image.output.frame.viewport.referenceLogicalHeight===preview.output.frame.viewport.referenceLogicalHeight,'PNG retains preview projection reference height');
 check(['phi','theta','gamma','zoom'].every(key=>image.output.frame.camera[key]===preview.output.frame.camera[key]),'PNG retains delivered camera view');
 check(!(await diagnostics()).owned,'successful PNG releases native export resource');
 report.images.push({path:pngPath,width:decoded.width,height:decoded.height,rgbaSha:sha(decoded.rgba),checkpoint:image.output.frame.checkpoint,rawNativeSha:image.output.pixelSha});
 await recoverPreview(preview,'PNG');
 for(const start of ['current','seed']){
  phase='mp4-'+start;const presented=await snapshot(),requestBegin=await begin(),uploads=[],sessions=[];
  const capture=request=>{const url=new URL(request.url());if(request.method()==='POST'&&url.pathname==='/api/exports')sessions.push(request.postDataJSON());if(request.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))uploads.push({index:Number(url.searchParams.get('index')),png:request.postDataBuffer()});};page.on('request',capture);
  await openExport('Animation video');const quality=start==='seed'?'production':'high';check(await page.getByRole('combobox',{name:'Video quality',exact:true}).inputValue()==='high','Bouncing video defaults to original high quality');await page.getByRole('combobox',{name:'Video quality',exact:true}).selectOption(quality);await dimensions(256,192);await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('12');await page.locator('select').filter({has:page.locator('option[value="seed"]')}).selectOption(start);
  const path=await download(start+'.mp4');await settledExport();page.off('request',capture);
  check(sessions.length===1&&sessions[0].profile==='mathart'&&sessions[0].quality===quality,start+' video sends selected original encoding profile');
  const calls=await exportsSince(requestBegin),n=start==='current'?presented.output.frame.checkpoint.simulationUpdates:0,step=Math.fround(1/12),expected=[];let time=step,index=n+1;
  const expectedCamera=start==='current'?presented.output.frame.camera:{...presented.scene.bouncingSource.camera,zoom:1};
  check(calls.every(c=>['phi','theta','gamma','zoom'].every(key=>c.output.frame.camera[key]===expectedCamera[key])),start+' video uses correct current/authored camera');
  do{time=Math.fround(time+step);expected.push({simulationUpdates:++index,sceneTime:time});}while(time<presented.scene.bouncingSource.recordDuration);
  check(calls.length===expected.length+1&&calls[0].output.frame.checkpoint.simulationUpdates===n+1&&calls[0].output.frame.checkpoint.sceneTime===step,start+' recording has one non-encoded warmup');
  check(uploads.length===expected.length&&uploads.every((u,i)=>u.index===i),start+' video uploads each frame exactly once in order');
  const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',file],{encoding:'utf8'})).streams[0];
  const metadata=probe(path);
  check(['yuv444p','yuvj444p'].includes(metadata.pix_fmt)&&metadata.color_range==='pc'&&metadata.color_space==='bt709',start+' video preserves original 4:4:4/full-range BT.709 matrix metadata');
  check(metadata.width===256&&metadata.height===192&&Number(metadata.nb_read_frames)===expected.length&&metadata.r_frame_rate==='12/1',start+' MP4 dimensions, FPS and frame count match');
  // Independent argv from original VideoRecorder, fed the same real uploaded RGBA.
  const referencePath=out+'/'+start+'-profile-reference.mp4';
  execFileSync('ffmpeg',['-v','error','-y','-f','rawvideo','-vcodec','rawvideo','-s','256x192','-r','12','-pix_fmt','rgba','-i','pipe:0','-c:v','libx264','-pix_fmt','yuv444p','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','iec61966-2-1','-tune','animation','-crf',quality==='production'?'10':'18','-preset',quality==='production'?'veryslow':'slow','-movflags','+faststart+write_colr','-threads','2',referencePath],{input:Buffer.concat(uploads.map(u=>decodePng(u.png).rgba)),maxBuffer:1024*1024});
  // Compare all emitted metadata, preserving omitted fields as unknown. This
  // installed FFmpeg does not emit transfer/primaries even for the original argv.
  const referenceMetadata=probe(referencePath);check(JSON.stringify(metadata)===JSON.stringify(referenceMetadata),start+' MP4 metadata equals independent original-profile encode exactly');
  const referenceRgb=execFileSync('ffmpeg',['-v','error','-i',referencePath,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024*1024});
  const rgb=execFileSync('ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024*1024}),stride=256*192*3,frames=[];check(rgb.length===stride*expected.length,start+' MP4 fully decodes');check(rgb.equals(referenceRgb),start+' MP4 decoded frames equal independent original-profile encode exactly');
  for(let i=0;i<expected.length;i++){
   const call=calls[i+1],png=decodePng(uploads[i].png),cp=call.output.frame.checkpoint;
   check(cp.simulationUpdates===expected[i].simulationUpdates&&cp.sceneTime===expected[i].sceneTime,start+' frame '+i+' matches Float32 recording clock');
   check(call.output.backend==='native'&&sha(png.rgba)===call.output.pixelSha&&png.width===256&&png.height===192,start+' frame '+i+' uploads exact native RGBA');
   let total=0,max=0;for(let j=0;j<stride;j++){const delta=Math.abs(rgb[i*stride+j]-png.rgba[Math.floor(j/3)*4+j%3]);total+=delta;max=Math.max(max,delta);}const mean=total/stride;
   check(mean<6,start+' frame '+i+' decoded H.264 mean RGB error '+mean+' below 6/255');frames.push({index:i,checkpoint:cp,rgbaSha:sha(png.rgba),meanAbsoluteRgbError:mean,maxAbsoluteRgbError:max});
  }
  check(new Set(frames.map(f=>f.rgbaSha)).size===frames.length,start+' video frames visibly evolve');
  check(!(await diagnostics()).owned,start+' video retires native resource');report.videos.push({start,path,quality,referencePath,referenceMetadata,decodedOriginalProfileExact:true,metadata,warmup:calls[0].output.frame.checkpoint,frames});await recoverPreview(presented,start+' MP4');
 }
 phase='cleanup-failure';const failurePreview=await snapshot();await openExport('Still image');await dimensions(256,192);
 await page.evaluate(()=>window.__nativeExportAudit.failRelease=true);const savedDespiteFailure=await download('cleanup-failure.png');await settledExport();
 check((await dialog().innerText()).includes('Export resource cleanup is incomplete:')&&(await dialog().innerText()).includes('Injected export release failure'),'native cleanup failure is visible in export dialog');
 const failed=await diagnostics();check(failed.owned&&failed.cleanupPending&&!failed.active,'failed native cleanup retains resource identity for retry');
 check(report.pageErrors.length===0,'cleanup rejection does not escape as an unhandled page error');
 report.cleanupFailure={path:savedDespiteFailure,diagnostics:failed,blockedReleases:await page.evaluate(()=>window.__nativeExportAudit.blockedReleases)};
 await page.evaluate(()=>window.__nativeExportAudit.failRelease=false);const retryPath=await download('cleanup-retry.png');await settledExport();
 check(!(await dialog().innerText()).includes('Injected export release failure')&&!(await diagnostics()).owned,'subsequent real export retries retained cleanup and releases replacement');
 check(sha(await readFile(savedDespiteFailure))===sha(await readFile(retryPath)),'cleanup retry preserves downloaded PNG bytes');
 report.cleanupRetry={path:retryPath};await recoverPreview(failurePreview,'failed-cleanup retry');
 phase='retained-files';const files=await readdir(out+'/service');report.serviceFiles=await Promise.all(files.map(async name=>({name,sha:sha(await readFile(out+'/service/'+name))})));
 check(files.length===5,'service retains all five completed PNG/MP4 outputs');
 for(const path of [...report.images,...report.videos,report.cleanupFailure,report.cleanupRetry].map(item=>item.path)){const digest=sha(await readFile(path));check(report.serviceFiles.some(file=>file.sha===digest),'download equals retained service file: '+path.split('/').at(-1));}
 check(report.pageErrors.length===0,'public export workflow has no unhandled page errors');
 await page.screenshot({path:out+'/restored-preview.png'});await browser.close();browser=undefined;
 const until=Date.now()+5000;while(service.ownedProcessCount&&Date.now()<until)await new Promise(r=>setTimeout(r,25));check(service.ownedProcessCount===0,'browser exit reaps native helper while service stays live');
 report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.audit=await page.evaluate(()=>window.__nativeExportAudit?.calls.slice(-4)).catch(()=>undefined);await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}process.exitCode=1;}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map(r=>r.status);report.remainingProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable||report.remainingProcesses||report.cleanup.includes('rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,phase:report.phase,error:report.error,report:out+'/report.json'}));
}
