/** Original captured JVM state/artwork against production seeds, GPU update and display. */
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {measureFamily} from './browser-process-cost.mjs';
import {chromium} from '@playwright/test';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const native=path.resolve(process.argv[2]??'.cache/bouncing-native-animation-20261024/residual-states/native-bouncing'),out=process.argv[3]??`.cache/bouncing-native-animation-verification-${Date.now()}`;
const backend=process.env.MATHART_SOURCE_RENDERER_BACKEND?JSON.parse(await readFile(process.env.MATHART_SOURCE_RENDERER_BACKEND,'utf8')):undefined;
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',sha=b=>createHash('sha256').update(b).digest('hex'),check=(v,m)=>{if(!v)throw Error(m);};
await mkdir(out,{recursive:true});
async function hashes(){const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-native-animation.mjs','server/source-renderer.mjs','server/render/SourceCglRenderer.m','scripts/browser-process-cost.mjs');return Object.fromEntries(await Promise.all(files.sort().map(async p=>[p,sha(await readFile(p))])));}
const report={pixelBackend:backend?'native':'webgl',at:new Date().toISOString(),status:'running',scope:'Unmodified original Bouncing/bouncing1.json, 2,000,000 particles, 60 native fixed updates; compare 62 stable paused artwork frames and 11 full padded state textures.',limits:['Offscreen original active draws have a zero viewport; paused redraws of the same simulation state are the accepted artwork reference. Not an active-window or native-video acceptance.','Artwork RGB is captured before normal branding; completed native PNG alpha is checked separately. No claim that the intermediate pre-branding RGBA equals completed pixels.','One original preset and 60 updates; no all-parameter, long-run or cross-device claim.','No product App/Worker transport, video encoding or package validation in this verifier.'],sourceBefore:await hashes()};
let server,browser,service;const start=performance.now();
try{
 const run=JSON.parse(await readFile(native+'/run.json','utf8'));check(run.exit===0&&run.reaped&&!run.processGroupExists&&!run.timedOut&&!run.stderr,'Native run not clean');
 for(const key of ['settings/settings.conf','license.dat'])check(JSON.stringify(run.userFilesBefore[key])===JSON.stringify(run.userFilesAfter[key]),'Original user file changed: '+key);
 check(run.stdout.includes('allowed=VIEW:true')&&run.stdout.includes('allowed=RUN:true')&&run.stdout.includes('allowed=EXPORT:true'),'Original policy authorization missing');check(!/windows=[^\n]*objects=[1-9]|gl=[^\n]*:[1-9]/.test(run.stdout),'Native window/GL failure');
 const bytes=await readFile(run.source),raw=JSON.parse(bytes);check(sha(bytes)===run.sourceSha256&&raw.settings.particle_count===2000000,'Original input changed');check(sha(await readFile(jar))==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','Original JAR changed');
 check(sha(await readFile(native+'/NativeSceneProbe.java'))===run.probeSha256,'Native probe identity changed');
 const allowed=new Map(),records=[];
 async function allow(key){const bytes=await readFile(native+'/'+key);allowed.set(key,sha(bytes));return bytes;}
 for(let frame=1;frame<=62;frame++){
  const prefix=`frame-${frame}/`+(frame>=3?'paused/':''),draw=JSON.parse(await allow(prefix+'point-draw.json')),updates=Math.max(0,frame-2);
  check(draw.simulationUpdates===updates&&draw.count===2000000&&JSON.stringify(draw.viewport)==='[0,0,500,600]','Native frame identity/viewport');
  const stack=(await allow(prefix+'artwork-boundary.txt')).toString();check(stack.includes('mathart.scene.Scene.drawWatermark'),'Pre-branding capture boundary missing');
  await allow(prefix+'before-branding.rgba');await allow(`raw-frame-${frame}.png`);
  const hasState=[1,3,4,7,8,12,23,32,38,53,62].includes(frame);
  if(hasState){await allow(prefix+'state.f32');if(frame>=3){const active=await allow(`frame-${frame}/state.f32`);check(sha(active)===allowed.get(prefix+'state.f32'),'Paused redraw advanced native simulation');}}
  records.push({frame,prefix,updates,draw,hasState});
 }
 report.reference={runSha256:sha(await readFile(native+'/run.json')),probeSha256:run.probeSha256,sourceSha256:run.sourceSha256,nativeSeconds:run.seconds,files:Object.fromEntries(allowed)};
 let proxy;if(backend){service=await createExportServer({sourceRendererBackend:backend,root:out+'/service',allowedOrigins:['http://127.0.0.1:5173']});const address=await service.listen(0);proxy={'/api':`http://127.0.0.1:${address.port}`};report.backend=backend;}
 server=await createServer({plugins:[{name:'retained-bouncing-reference',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/bouncing-reference/'))return next();const key=new URL(req.url,'http://localhost').pathname.slice('/bouncing-reference/'.length);if(!allowed.has(key)){res.statusCode=404;res.end();return;}try{const bytes=await readFile(native+'/'+key);check(sha(bytes)===allowed.get(key),'Reference changed during comparison');res.setHeader('content-type','application/octet-stream');res.end(bytes);}catch(error){res.statusCode=500;res.end(String(error));}});}}],server:{host:'127.0.0.1',port:5173,hmr:false,proxy},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});report.browser=browser.version();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('bouncing-frame '))console.log(m.text());});
 await page.goto(server.resolvedUrls.local[0]);
 const measured=await measureFamily(process.pid,async()=>({results:await page.evaluate(async({raw,records,nativePixels})=>{
  const{importSourceBouncingDocument,sourceBouncingCameraInput}=await import('/src/engine/sourceBouncingDocument.ts'),{prepareSourceCamera}=await import('/src/engine/sourceCamera.ts'),{generateSourceBouncingSeeds}=await import('/src/engine/sourceBouncingSeeds.ts'),{SourceBouncingGpu}=await import('/src/engine/sourceBouncingGpu.ts');
  const{renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts');
  const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},check=(v,m)=>{if(!v)throw Error(m);},payload=unwrap(importSourceBouncingDocument(raw)).payload,seeds=unwrap(generateSourceBouncingSeeds(payload.configuration));
  const known=unwrap(prepareSourceCamera(sourceBouncingCameraInput(payload),{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'}));check(known.kind==='known','Camera unresolved');const plan=known.plan,gpu=SourceBouncingGpu.takeState(seeds.state),rows=[];let updates=0;
  const digest=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',array))).map(v=>v.toString(16).padStart(2,'0')).join(''),load=async key=>{const r=await fetch('/bouncing-reference/'+key);check(r.ok,'Reference fetch');return r.arrayBuffer();};
  try{for(const row of records){
   while(updates<row.updates){gpu.advance(seeds.update);updates++;}
   const options={width:500,height:600,cameraPlan:plan,visualConfiguration:payload.visual,initialSpeed:payload.configuration.initialSpeed,boundary:seeds.update.boundary};
   const drawing=nativePixels?gpu.drawingFrame(options,{generation:1,sequence:row.frame}):undefined;
   let state;
   if(row.hasState){const actual=drawing?new Float32Array(drawing.drawing.commands[0].attributes[0].values.buffer):gpu.readState(),expected=new Float32Array(await load(row.prefix+'state.f32'));check(actual.length===expected.length,'State length');let different=0,maxAbs=0;for(let i=0;i<actual.length;i++)if(!Object.is(actual[i],expected[i])){different++;maxAbs=Math.max(maxAbs,Math.abs(actual[i]-expected[i]));}state={components:actual.length,different,maxAbs,actualSha256:await digest(actual),expectedSha256:await digest(expected)};}
   const output=drawing?await renderSourceNativeFrame(drawing,{retainedBytes:gpu.diagnostics().retainedBytes}):gpu.render(options),art=new Uint8Array(await load(row.prefix+'before-branding.rgba'));
   const bitmap=await createImageBitmap(new Blob([await load(`raw-frame-${row.frame}.png`)],{type:'image/png'}));check(bitmap.width===500&&bitmap.height===600,'Native final PNG size');const canvas=document.createElement('canvas');canvas.width=500;canvas.height=600;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const final=ctx.getImageData(0,0,500,600).data;canvas.width=canvas.height=0;
   check(art.length===500*600*4,'Artwork size');let rgbPixels=0,sum=0,alphaPixels=0,intermediateAlphaPixels=0;const differenceExamples=[],rgb=new Uint8Array(500*600*3);
   for(let y=0;y<600;y++)for(let x=0;x<500;x++){const a=(y*500+x)*4,b=((599-y)*500+x)*4;let diff=false;for(let c=0;c<3;c++){const delta=Math.abs(output.pixels[a+c]-art[b+c]);sum+=delta;if(delta)diff=true;rgb[(y*500+x)*3+c]=art[b+c];}if(diff){rgbPixels++;if(differenceExamples.length<8)differenceExamples.push({x,y,actual:Array.from(output.pixels.slice(a,a+4)),expectedRgb:Array.from(art.slice(b,b+3))});}if(final[a+3]!==255||output.pixels[a+3]!==final[a+3])alphaPixels++;if(output.pixels[a+3]!==art[b+3])intermediateAlphaPixels++;}
   const camera={projectionMax:Math.max(...plan.projection.columnMajor.map((v,i)=>Math.abs(v-row.draw.projection[i]))),modelviewMax:Math.max(...plan.modelView.columnMajor.map((v,i)=>Math.abs(v-row.draw.modelview[i])))};
   rows.push({frame:row.frame,updates,state,differenceExamples,rgbPixels,rgbMae:sum/(500*600*3),alphaPixels,intermediateAlphaPixels,referenceRgbSha256:await digest(rgb),camera});if(row.frame%10===0)console.log('bouncing-frame '+row.frame);
  }}finally{gpu.dispose();}
  return{rows,diagnostics:gpu.diagnostics()};
 },{raw,records,nativePixels:!!backend})}));report.results=measured.results;report.processFamily=measured.processFamily;report.pageErrors=errors;check(!errors.length,'Browser errors');
 check(report.results.rows.every(r=>!r.rgbPixels&&!r.alphaPixels&&!r.camera.projectionMax&&!r.camera.modelviewMax&&(!r.state||!r.state.different)),'Native numerical or artwork difference');check(new Set(report.results.rows.map(r=>r.referenceRgbSha256)).size>1,'No changing reference artwork');check(report.results.diagnostics.handles===0,'GPU resources retained');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{const cleanup=await Promise.allSettled([browser?.close(),server?.close(),service?.close()]);report.cleanup=cleanup.map(r=>r.status);report.remainingNativeProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-start;if(report.remainingNativeProcesses!==0||!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,frames:report.results?.rows.length,elapsedMs:report.elapsedMs,error:report.error,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;}
