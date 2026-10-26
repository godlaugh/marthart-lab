import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createServer as socketServer} from 'node:net';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {measureFamily} from './browser-process-cost.mjs';

// A retained authorized original capture is required. This verifier never
// launches or alters the original application, its policy, or its watermark.
const [captureRoot,productionReportPath,glyphBackendPath,out]=process.argv.slice(2);
for(const value of [captureRoot,productionReportPath,glyphBackendPath,out])assert.ok(value&&path.isAbsolute(value),'Four absolute paths required: original draw captures, passed native report, glyph backend, new output directory');
await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const production=await json(productionReportPath);assert.equal(production.status,'passed');assert.equal(production.sourcesStable,true);
const executablePath=path.join(path.dirname(productionReportPath),'renderer'),executableSha256=sha(await readFile(executablePath));assert.equal(executableSha256,production.executableSha256);
for(const p of ['server/render/SourceCglRenderer.m'])assert.equal(sha(await readFile(p)),production.sourcesBefore[p],'Changed native executable source');
const width=500,height=600;
function flip(raw){assert.equal(raw.length,width*height*4);const top=Buffer.alloc(raw.length);for(let y=0;y<height;y++)raw.copy(top,y*width*4,(height-1-y)*width*4,(height-y)*width*4);return top;}
function png(bytes){const decoded=decodePng(bytes);assert.equal(decoded.width,width);assert.equal(decoded.height,height);return decoded.rgba;}
function diff(a,b){assert.equal(a.length,b.length);let pixels=0,channels=0,maxAbs=0;const examples=[];for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d){changed=true;channels++;maxAbs=Math.max(maxAbs,d);}}if(changed){pixels++;if(examples.length<5)examples.push({x:i/4%width,y:Math.floor(i/4/width),actual:[...a.subarray(i,i+4)],reference:[...b.subarray(i,i+4)]});}}return{pixels,channels,maxAbs,examples};}
const sourcePaths=(await readdir('src',{recursive:true})).filter(p=>/\.(tsx?|json|css)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-fractal-complete-image.mjs','scripts/lib/verify-png.mjs','server/index.mjs','server/render/SourceCglRenderer.m');
const snapshot=async()=>Object.fromEntries(await Promise.all(sourcePaths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Two original paused stable Mandelbrot Scene frames, including initial generated formula. Original full raw/enhanced images and watermark remain unmodified. Production public fresh-recording Generator, native sampling, glyph service, formula composition and PNG workers. Does not prove full GUI save callback, animated formula changes, other formulas or other devices.',cases:[],sourceBefore:await snapshot(),references:{},pageErrors:[],executableSha256,productionReport:{path:productionReportPath,sha256:sha(await readFile(productionReportPath))}};
let service,server,browser;const started=performance.now();
try{
 const measured=await measureFamily(process.pid,async()=>{
 const socket=socketServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise((r,j)=>socket.close(e=>e?j(e):r()));
 service=await createExportServer({allowedOrigins:[`http://127.0.0.1:${port}`],root:out+'/exports',sourceRendererBackend:{executablePath,executableSha256,timeoutMs:20000},glyphBackend:await json(glyphBackendPath)});const api=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${api.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/complete-image',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Fractal composition verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'complete-image');
 for(const name of ['default','clear']){
  const directory=path.join(captureRoot,'native-display-'+name),run=await json(directory+'/run.json'),source=await readFile(run.source,'utf8');
  assert.equal(sha(source),run.sourceSha256);assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);
  for(const flag of ['allowed=VIEW:true','allowed=RUN:true','allowed=EXPORT:true','watermark=true','rendered=true','drawableDestroyed=true'])assert.ok(run.stdout.includes(flag),flag);
  assert.ok(!/windows=.*(?:objects=[1-9]|visible=[1-9])/.test(run.stdout));assert.ok(!/gl=\w+:[1-9]/.test(run.stdout));
  assert.equal(sha(await readFile(directory+'/NativeSceneProbe.java')),run.probeSha256);
  assert.equal(sha(await readFile(run.command[0])),run.hostSha256);
  const jars=run.command[2].split(':').filter(p=>/^MathArt-.*\.jar$/.test(path.basename(p)));assert.equal(jars.length,1);
  const jarSha256=sha(await readFile(jars[0]));assert.equal(jarSha256,'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');report.originalJarSha256=jarSha256;report.references[jars[0]]=jarSha256;
  for(const p of [run.source,run.command[0],run.command[1]])report.references[p]=sha(await readFile(p));
  for(const key of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[key],run.userFilesAfter[key],'Original user setting changed: '+key);
  const native={},paths=['raw-frame-3.png','enhanced-frame-3.png','draw-2.rgba','draw-3.rgba','draw-6.rgba','draw-2.json','draw-3.json','draw-4.json','draw-6.json','run.json','NativeSceneProbe.java'];
  for(const p of paths){const bytes=await readFile(directory+'/'+p);report.references[directory+'/'+p]=sha(bytes);native[p]=bytes;}
  const math=flip(native['draw-2.rgba']),art=flip(native['draw-3.rgba']),full=png(native['raw-frame-3.png']),enhanced=png(native['enhanced-frame-3.png']);
  assert.deepEqual(flip(native['draw-6.rgba']),full,'Readback changed original final pixels');
  const formulaDraw=JSON.parse(native['draw-3.json']),nextDraw=JSON.parse(native['draw-4.json']);
  assert.ok(formulaDraw.stack.includes('TexMobject.display'));assert.ok(nextDraw.stack.includes('drawWatermark'));assert.equal(formulaDraw.frame,3);
  await page.route('**/native-raw',r=>r.fulfill({body:full}));
  const result=await page.evaluate(async({source,width,height})=>{
   const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{Generator}=await import('/src/engine/client.ts');
   const {prepareSourceFormulas,SourceFormulaCompositor}=await import('/src/engine/sourceFormulaCompositor.ts');
   const {encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts'),{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
   const scene=parseProjectFile(source).scene;scene.timeline.fps=60;const generator=new Generator();let output;
   try{output=await generator.generate(scene,{time:0,quality:'export',width,height,fractalPixelDensity:2,fractalViewport:{logicalWidth:250,logicalHeight:300,target:'offscreen',referenceLogicalHeight:486},fractalRecording:{displayFrame:3,simulationFps:60}});}
   finally{generator.dispose();await generator.settledNativeCleanup();}
   if(output.type!=='raster'||output.backend!=='native'||output.formulaPresentation?.layout!=='source-surface-centered-v1'||output.formulaPresentation.labels.length!==1)throw Error('Expected native frame with one source formula');
   const presentation=output.formulaPresentation,prepared=await prepareSourceFormulas(presentation),renderer=new SourceFormulaCompositor();let composed;
   try{renderer.draw(prepared,width,height,output.pixels);composed=renderer.readPixels();}finally{renderer.dispose();}
   const raw=await encodeFormulaRaster(output),paused=await encodeFormulaRaster(output,'image/png',{sourceImageProcessing:'paused-png'});
   const native=new Uint8ClampedArray(await(await fetch('/native-raw')).arrayBuffer());
   return{presentation,display:output.fractalRender.display,execution:output.fractalRender.execution,glyphs:prepared.glyphs.map(({width,height,rendererIdentity})=>({width,height,rendererIdentity})),base:[...output.pixels],composed:[...composed],nativeEnhanced:[...enhanceSourcePausedImage(native,width,height)],productEnhanced:[...enhanceSourcePausedImage(composed,width,height)],raw:[...new Uint8Array(await raw.arrayBuffer())],paused:[...new Uint8Array(await paused.arrayBuffer())]};
  },{source,width,height});
  await page.unroute('**/native-raw');
  const base=Buffer.from(result.base),composed=Buffer.from(result.composed),raw=png(Buffer.from(result.raw)),paused=png(Buffer.from(result.paused));
  await writeFile(out+'/'+name+'-raw.png',Buffer.from(result.raw));await writeFile(out+'/'+name+'-enhanced.png',Buffer.from(result.paused));
  const comparisons={mathematicalRaster:diff(base,math),artworkIncludingFormula:diff(composed,art),rawPng:diff(raw,composed),pausedPng:diff(paused,Buffer.from(result.productEnhanced)),originalCompleteEnhancement:diff(Buffer.from(result.nativeEnhanced),enhanced),completeRaw:diff(raw,full),completeEnhanced:diff(paused,enhanced),originalWatermark:diff(art,full)};
  for(const key of ['base','composed','nativeEnhanced','productEnhanced','raw','paused'])delete result[key];
  report.cases.push({name,sourceSha256:run.sourceSha256,...result,comparisons,rgbaSha256:sha(raw),enhancedRgbaSha256:sha(paused),originalPolicyCacheRefreshed:run.userFilesBefore['scene_access_policies_cache.json']?.sha256!==run.userFilesAfter['scene_access_policies_cache.json']?.sha256});
  for(const key of ['mathematicalRaster','artworkIncludingFormula','rawPng','pausedPng','originalCompleteEnhancement'])assert.equal(comparisons[key].pixels,0,name+' '+key);
  assert.deepEqual(comparisons.completeRaw,comparisons.originalWatermark,'Unexplained full original image differences');
  assert.deepEqual(result.glyphs.map(g=>[g.width,g.height]),[[formulaDraw.textureWidth,formulaDraw.textureHeight]]);
  console.log(JSON.stringify({name,comparisons}));
 }
 assert.deepEqual(report.pageErrors,[]);return{};
 });report.processFamily=measured.processFamily;report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),service?.close()]);report.cleanup={errors:cleanup.filter(r=>r.status==='rejected').map(r=>String(r.reason)),ownedProcesses:service?.ownedProcessCount,browserClosed:!browser?.isConnected(),serverClosed:!server?.httpServer?.listening};
 report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceAfter)===JSON.stringify(report.sourceBefore);report.referencesStable=(await Promise.all(Object.entries(report.references).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);
 if(!report.sourceStable||!report.referencesStable||report.cleanup.errors.length||report.cleanup.ownedProcesses!==0){report.status='failed';report.error??='Changed sources/references or incomplete cleanup';process.exitCode=1;}
 report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:out+'/report.json',cleanup:report.cleanup}));
}
