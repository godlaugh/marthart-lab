/** Matched source-camera cases through public import, real Worker, native
 * mathematical drawing and independent glyph backend. No reference buffer,
 * matrix or uniform is supplied to the product producer. */
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
for(const value of [reference,out,backendFile,glyphFile])assert(value&&path.isAbsolute(value),'absolute reference/output/native/glyph paths required');
await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),started=performance.now(),referenceHashes={};
const read=async file=>{const bytes=await readFile(file);referenceHashes[file]=sha(bytes);return bytes;},json=async file=>JSON.parse(await read(file));
const sourceHashes=async()=>{const files=['scripts/verify-source-implicit-cameras.mjs','scripts/browser-process-cost.mjs','desktop/graphics.mjs','package-lock.json'];for(const root of ['src','server'])for(const file of await readdir(root,{recursive:true}))if(/\.(tsx?|mjs|m|h|java|json)$/.test(file))files.push(root+'/'+file);return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,sha(await readFile(file))])));};
const topDown=(b,w,h)=>{assert.equal(b.length,w*h*4);const out=Buffer.alloc(b.length),stride=w*4;for(let y=0;y<h;y++)b.copy(out,y*stride,(h-y-1)*stride,(h-y)*stride);return out;};
const diff=(a,b)=>{assert.equal(a.length,b.length);let pixels=0,channels=0,maxDelta=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);if(d){changed=true;channels++;maxDelta=Math.max(maxDelta,d);}}if(changed)pixels++;}return{bytes:a.length,pixels,channels,maxDelta};};
const report={status:'running',scope:'Three listed source cameras, each initial dirty and repeated steady display: exact original matrices, mesh buffers, complete mathematical RGBA and artwork including formulas.',limits:['The original reference is initially paused at sceneTime=0; public fixed replay already performs its first 1/30-second update. The same input begins with a one-second wait and has no parameter or camera writes during that step. This verifies matched camera/geometry/visual effects, not initial paused-clock equivalence.','Finite original 60³ GPU-mode input using actual CPU mesh fallback on this Mac, 500×600 offscreen target and primary 405×486 at density two; no arbitrary-camera, other-topology, other-device or successful Compute claim.','Cost includes the verifier, browser, services, encoding, comparison and observation; it is not an ordinary-use throughput benchmark. VRAM and task tokens are not measured.'],referenceHashes,cases:[],pageErrors:[],sourceBefore:await sourceHashes(),runtime:{node:process.version,platform:process.platform,arch:process.arch}};
await writeFile(out+'/executed-verifier.mjs',await readFile(new URL(import.meta.url)));
let browser,vite,service;
try{
 const index=await json(reference+'/capture-index.json'),plan=await json(reference+'/plan.json');assert.equal(index.ok,true);assert.equal(plan.authorInputsOnly,true);assert.deepEqual(index.cases.map(c=>c.name),['front','top','isometric']);assert.deepEqual(index.primary,plan.primary);assert.deepEqual(index.target,plan.target);
 const backend=await json(backendFile),glyph=await json(glyphFile);assert.equal(sha(await read(backend.executablePath)),backend.executableSha256);report.backend=backend;
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});}),origin=`http://127.0.0.1:${port}`;
 service=await createExportServer({root:out+'/service',allowedOrigins:[origin],sourceRendererBackend:backend,glyphBackend:glyph});const address=await service.listen(0);
 vite=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':'"native"'},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>'--'+k+'='+v)});
 const page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));await page.route('**/__implicit_cameras',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,">'}));await page.goto(origin+'/__implicit_cameras');
 const measured=await measureFamily(process.pid,async()=>{
  for(const entry of index.cases){
   const authored=plan.cases.find(c=>c.id===entry.name);assert(authored);assert.deepEqual(entry.camera,authored.authoredCamera);const input=await read(entry.input.path);assert.equal(sha(input),entry.input.sha256);assert.equal(sha(input),authored.sha256);
   const source=JSON.parse(input);assert.deepEqual(source.camera,entry.camera);assert.equal(source.settings.mesh_mode,'GPU');for(const axis of ['x','y','z'])assert.equal(source.settings[axis+'_segments'],60);assert.equal(source.timeline[0].type,'wait');assert.equal(source.timeline[0].duration,1);
   const rows=await page.evaluate(async({source,primary,target})=>{
    const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts'),{prepareSourceFormulas,SourceFormulaCompositor}=await import('/src/engine/sourceFormulaCompositor.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
    const scene=parseProjectFile(source).scene,[pw,ph,density]=primary,[lw,lh,width,height,targetDensity]=target;if(density!==targetDensity)throw Error('Unexpected density contract');
    const context={time:0,width,height,quality:'export',sourceViewport:ordinarySourceViewport(scene,lw,lh,'offscreen',ph),sourcePointPixelDensity:density,sourceImplicitPrimarySize:[pw*density,ph*density]};
    const g=new Generator(),resources=new SourceDrawingResources(),compositor=new SourceFormulaCompositor(),rows=[];
    const encode=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);},hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
    try{for(let i=0;i<2;i++){
     const output=await g.generate(scene,context);if(output.type!=='geometry'||!output.sourceImplicitDisplay)throw Error('Missing source geometry/display');
     const renderer=resources.renderer;renderer.setSize(lw,lh,density);renderer.setOutput(output,{...scene,evaluatedSourceCamera:output.sourceCameraFrame},false);const drawing=renderer.sourceDrawingFrame(1,i+1);if(!drawing.ok)throw Error(drawing.error.reason);
     const uniforms=drawing.value.drawing.commands[0].uniforms.map(u=>u.kind==='sampler2d'?u:{...u,values:Array.from(u.values)}),all=drawing.value.drawing.commands.flatMap(c=>c.uniforms);
     // The local retained-line shader names the actual submitted projection
     // uniform `projection`; original Processing names it `projectionMatrix`.
     const matrices=Object.fromEntries([['projection','projection'],['modelview','modelview'],['transform','transform']].map(([key,name])=>{const u=all.find(u=>u.name===name&&u.kind==='mat4');if(!u)throw Error('Missing matrix '+name);return[key,Array.from(u.values)];}));
     const native=await renderSourceNativeFrame(drawing.value),prepared=await prepareSourceFormulas(output.formulaPresentation);compositor.draw(prepared,width,height,native.pixels);const art=compositor.readPixels();
     rows.push({phase:i===0?'dirty':'steady',camera:output.sourceCameraFrame,display:output.sourceImplicitDisplay,backend:output.backend,meshComputation:output.sourceImplicitPresentation.meshComputation,vertices:output.positions.length/3,positionsSha256:await hash(output.positions),normalsSha256:await hash(output.sourceImplicitMesh.normals),matrices,uniforms,formulas:output.formulaPresentation,rendererIdentity:native.rendererIdentity,math:encode(native.pixels),art:encode(art),png:encode(new Uint8Array(await(await encodeRgbaPng(art,width,height)).arrayBuffer()))});
    }return rows;}finally{g.dispose();await g.settledNativeCleanup();resources.dispose();compositor.dispose();}
   },{source:input.toString(),primary:plan.primary,target:plan.target});
   const result={name:entry.name,input:entry.input,camera:entry.camera,reusedOriginal:entry.reused,frames:[]};report.cases.push(result);assert.equal(rows.length,entry.frames.length);
   for(let i=0;i<rows.length;i++){
    const row=rows[i],ref=entry.frames[i];assert.equal(row.phase,ref.phase);const facts=await json(ref.sourceFacts.path);assert.equal(referenceHashes[ref.sourceFacts.path],ref.sourceFacts.sha256);assert.equal(facts.input.sha256,entry.input.sha256);
    const math=Buffer.from(row.math,'base64'),art=Buffer.from(row.art,'base64'),png=Buffer.from(row.png,'base64');delete row.math;delete row.art;delete row.png;
    for(const [suffix,b]of [['math.rgba',math],['art.rgba',art],['png',png]])await writeFile(out+`/${entry.name}-${row.phase}.${suffix}`,b);
    const expectedMath=await read(facts.completeMathBeforeFormula.path),expectedArt=await read(facts.completeArtBeforeBranding.path);assert.equal(sha(expectedMath),facts.completeMathBeforeFormula.sha256);assert.equal(sha(expectedArt),facts.completeArtBeforeBranding.sha256);
    row.comparison={math:diff(math,topDown(expectedMath,500,600)),art:diff(art,topDown(expectedArt,500,600))};row.artSha256=sha(art);row.reference=ref.sourceFacts;result.frames.push(row);
    assert.equal(row.backend,'cpu');assert.equal(row.meshComputation,'source-cpu-fallback');assert.equal(row.positionsSha256,facts.cpuMeshPositions.sha256);assert.equal(row.normalsSha256,facts.cpuMeshNormals.sha256);assert.equal(row.display.rebuilt,i===0);
    assert(facts.actualViewports.length>0);for(const draw of facts.actualViewports)assert.deepEqual(row.display.viewport,draw.glViewport);
    for(const key of ['projection','modelview','transform'])assert.deepEqual(row.matrices[key],facts.actualMatrices[key].value.map(Math.fround),`${entry.name}/${row.phase}/${key}`);
    const numeric=facts.materialDraws[0].uniforms.filter(u=>u.type!==35678);for(const expected of numeric){const actual=row.uniforms.find(u=>u.name===expected.name);assert(actual);assert.deepEqual(actual.values,(Array.isArray(expected.value)?expected.value:[expected.value]).map(Math.fround),`${entry.name}/${row.phase}/${expected.name}`);}
    assert.equal(row.comparison.math.pixels,0,`${entry.name}/${row.phase}/math`);assert.equal(row.comparison.art.pixels,0,`${entry.name}/${row.phase}/art`);
   }
   console.log(JSON.stringify({name:entry.name,frames:result.frames.length,mathDifferentPixels:result.frames.map(f=>f.comparison.math.pixels),artDifferentPixels:result.frames.map(f=>f.comparison.art.pixels)}));
  }return{};
 });report.processFamily=measured.processFamily;assert.equal(report.pageErrors.length,0);report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),vite?.close(),service?.close()]);report.cleanupErrors=cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason));report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referenceStable=true;for(const [file,digest]of Object.entries(referenceHashes))if(sha(await readFile(file))!==digest)report.referenceStable=false;
 report.elapsedMs=performance.now()-started;if(!report.sourceStable||!report.referenceStable||report.cleanupErrors.length||report.remainingProcesses!==0)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases.length,sourceStable:report.sourceStable,cleanupErrors:report.cleanupErrors,remainingProcesses:report.remainingProcesses,elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;
}
