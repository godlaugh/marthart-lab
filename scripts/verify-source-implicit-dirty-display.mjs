/** Public importer + Generator/real Worker + both native transports + formula
 * composition. Reference bytes are read only after independent generation. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createServer as tcp} from 'node:net';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
import {measureFamily} from './browser-process-cost.mjs';

const [reference,out,backendFile,glyphFile]=process.argv.slice(2);
for(const value of [reference,out,backendFile,glyphFile])assert.ok(value&&path.isAbsolute(value),'absolute reference/output/native/glyph paths required');
await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),started=performance.now(),referenceHashes={};
const read=async file=>{const bytes=await readFile(file);referenceHashes[file]=sha(bytes);return bytes;};
const json=async file=>JSON.parse(await read(file));
const sourceHashes=async()=>{const files=['scripts/verify-source-implicit-dirty-display.mjs','scripts/browser-process-cost.mjs','desktop/graphics.mjs','package-lock.json'];for(const root of ['src','server'])for(const f of await readdir(root,{recursive:true}))if(/\.(tsx?|mjs|m|h|java|json)$/.test(f))files.push(root+'/'+f);return Object.fromEntries(await Promise.all(files.sort().map(async f=>[f,sha(await readFile(f))])));};
const topDown=(b,w,h)=>{assert.equal(b.length,w*h*4);const out=Buffer.alloc(b.length),stride=w*4;for(let y=0;y<h;y++)b.copy(out,y*stride,(h-y-1)*stride,(h-y)*stride);return out;};
const compare=(a,b)=>{assert.equal(a.length,b.length);let pixels=0,channels=0,maxDelta=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);if(d){changed=true;channels++;maxDelta=Math.max(maxDelta,d);}}if(changed)pixels++;}return{bytes:a.length,pixels,channels,maxDelta};};
const report={status:'running',scope:'Seventeen independent whole mathematical and prebranding-art comparisons. Public fixed-frame replay is used; original paused controls and recording lifecycle are not simulated by this verifier.',limits:['First two images compare constructor dirty/steady visual effects only: fixed replay has already performed its first update (.25 seconds), whereas the original reference is initially paused at time zero. Parameters, geometry and formula content are unchanged; no initial paused-clock equivalence claim.','Remaining fifteen frames require exact scene time, queue completion, parameter bits, mesh buffers and viewport. Repeated fixed-time requests represent repeated displays; retained pause/record/capture UI is verified separately.','Finite diagnostic 12³ input, 500×600 target, density two and this Mac. Other hardware, all parameter ranges, VRAM and task tokens are not measured.'],referenceHashes,frames:[],pageErrors:[],sourceBefore:await sourceHashes(),runtime:{node:process.version,platform:process.platform,arch:process.arch}};
await writeFile(out+'/executed-verifier.mjs',await readFile(new URL(import.meta.url)));
let browser,vite,service;
try{
 const index=await json(reference+'/capture-index.json'),plan=await json(reference+'/plan.json'),input=await read(index.input.path);
 assert.equal(index.ok,true);assert.equal(sha(input),index.input.sha256);assert.equal(sha(await read(reference+'/plan.json')),index.authorEventPlan.sha256);
 const backend=await json(backendFile),glyph=await json(glyphFile);assert.equal(sha(await read(backend.executablePath)),backend.executableSha256);report.backend=backend;
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});}),origin=`http://127.0.0.1:${port}`;
 service=await createExportServer({root:out+'/service',allowedOrigins:[origin],sourceRendererBackend:backend,glyphBackend:glyph});const address=await service.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':'"native"'},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 const page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));await page.route('**/__implicit_dirty',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,">'}));await page.goto(origin+'/__implicit_dirty');
 const result=await measureFamily(process.pid,async()=>({rows:await page.evaluate(async({source,plan})=>{
  const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeFrame,renderSourceNativeChunks}=await import('/src/engine/sourceNativeClient.ts'),{outputBuffers}=await import('/src/engine/outputBuffers.ts'),{prepareSourceFormulas,SourceFormulaCompositor}=await import('/src/engine/sourceFormulaCompositor.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
  const scene=parseProjectFile(source).scene,fps=plan.clock.simulationFps;scene.timeline.fps=fps;
  const [width,height]=plan.renderProfile.targetPhysical,[logicalWidth,logicalHeight]=plan.renderProfile.targetLogical,[primaryWidth,primaryHeight]=plan.renderProfile.primaryLogical,density=plan.renderProfile.density;
  const context={time:0,width,height,quality:'export',sourceViewport:ordinarySourceViewport(scene,logicalWidth,logicalHeight,'offscreen',primaryHeight),sourcePointPixelDensity:density,sourceImplicitPrimarySize:[primaryWidth*density,primaryHeight*density]};
  const g=new Generator(),resources=new SourceDrawingResources(),compositor=new SourceFormulaCompositor(),rows=[];
  const encode=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);};
  const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
  const draw=async(time,meaning)=>{
   const output=await g.generate(scene,{...context,time});if(output.type!=='geometry'||!output.sourceImplicitDisplay)throw Error('Missing source mesh/display');
   const renderer=resources.renderer;renderer.setSize(logicalWidth,logicalHeight,density);renderer.setOutput(output,{...scene,evaluatedSourceCamera:output.sourceCameraFrame},false);
   const frame=renderer.sourceDrawingFrame(1,rows.length*2+1);if(!frame.ok)throw Error(frame.error.reason);const native=await renderSourceNativeFrame(frame.value);
   const bounded=renderer.sourceDrawingPlan(1,rows.length*2+2,{retainedBuffers:outputBuffers(output),additionalBytes:width*height*12,maxChunkBytes:96*1024});if(!bounded.ok)throw Error(bounded.error.reason);let other;
   try{other=await renderSourceNativeChunks(bounded.value,bounded.value.plan,{signal:new AbortController().signal});}finally{const released=bounded.value.plan.dispose();if(!released.ok)throw Error(released.error.reason);}
   if(await hash(native.pixels)!==await hash(other.pixels))throw Error('Complete/bounded viewport pixels differ');
   const prepared=await prepareSourceFormulas(output.formulaPresentation);compositor.draw(prepared,width,height,native.pixels);const artwork=compositor.readPixels(),buffer=new ArrayBuffer(8);new DataView(buffer).setFloat64(0,output.sourceImplicitParameters.values.a,false);
   rows.push({meaning,requestedTime:time,frame:output.sourceCameraFrame,display:output.sourceImplicitDisplay,parameters:output.sourceImplicitParameters.values,aBits:Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join(''),positionsSha256:await hash(output.positions),normalsSha256:await hash(output.sourceImplicitMesh.normals),formulas:output.formulaPresentation,completeAndBoundedExact:true,rendererIdentity:native.rendererIdentity,math:encode(native.pixels),artwork:encode(artwork),png:encode(new Uint8Array(await(await encodeRgbaPng(artwork,width,height)).arrayBuffer()))});
   return output;
  };
  try{
   await draw(0,'initial dirty visual only');await draw(0,'initial steady visual only');
   let output,step=0;const event=plan.events.find(e=>e.insertAfterActualUpdateOrdinal);
   do{if(step>=plan.clock.maximumActiveUpdatesFailureGuard)throw Error('Queue did not complete');output=await draw(step/fps,'fixed update '+(step+1));if(step+1===event.insertAfterActualUpdateOrdinal)for(let i=0;i<event.inserted.count;i++)await draw(step/fps,'repeated display after update '+(step+1));step++;}while(!output.sourceCameraFrame.queueComplete);
   for(let i=0;i<plan.events.at(-1).count;i++)await draw((step-1)/fps,'repeated completed display');
   return rows;
  }finally{g.dispose();await g.settledNativeCleanup();resources.dispose();compositor.dispose();}
 },{source:input.toString(),plan})}));
 report.processFamily=result.processFamily;assert.equal(result.rows.length,index.frames.length);
 for(let i=0;i<result.rows.length;i++){
  const row=result.rows[i],entry=index.frames[i],facts=await json(entry.sourceFacts.path);assert.equal(referenceHashes[entry.sourceFacts.path],entry.sourceFacts.sha256);
  const math=Buffer.from(row.math,'base64'),art=Buffer.from(row.artwork,'base64'),png=Buffer.from(row.png,'base64');delete row.math;delete row.artwork;delete row.png;
  await writeFile(out+`/frame-${i}-math.rgba`,math);await writeFile(out+`/frame-${i}-art.rgba`,art);await writeFile(out+`/frame-${i}.png`,png);
  const expectedMath=await read(facts.completeMathBeforeFormula.path),expectedArt=await read(facts.completeArtBeforeBranding.path);assert.equal(sha(expectedMath),facts.completeMathBeforeFormula.sha256);assert.equal(sha(expectedArt),facts.completeArtBeforeBranding.sha256);
  row.comparison={math:compare(math,topDown(expectedMath,500,600)),artwork:compare(art,topDown(expectedArt,500,600))};row.artSha256=sha(art);row.reference={path:entry.sourceFacts.path,sha256:entry.sourceFacts.sha256};report.frames.push(row);
  assert.equal(row.positionsSha256,facts.cpuMeshPositions.sha256,`frame ${i} positions`);assert.equal(row.normalsSha256,facts.cpuMeshNormals.sha256,`frame ${i} normals`);assert.equal(row.aBits,entry.parameterBitsAfter);assert.equal(row.display.rebuilt,entry.dirtyAtRenderEntry);assert.deepEqual(row.display.viewport,entry.actualViewport);
  if(i>=2){assert.equal(row.frame.sceneTime,entry.sceneTime);assert.equal(row.frame.queueComplete,entry.queueComplete);}
  assert.equal(row.comparison.math.pixels,0,`frame ${i} mathematics`);assert.equal(row.comparison.artwork.pixels,0,`frame ${i} complete artwork`);
 }
 assert.equal(report.pageErrors.length,0);report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=service?.ownedProcessCount;
 report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referenceStable=true;for(const [file,digest]of Object.entries(referenceHashes))if(sha(await readFile(file))!==digest)report.referenceStable=false;
 report.elapsedMs=performance.now()-started;if(!report.sourceStable||!report.referenceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,frames:report.frames.length,sourceStable:report.sourceStable,cleanupErrors:report.cleanupErrors,remainingProcesses:report.remainingProcesses,elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;
}
