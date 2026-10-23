import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcp} from 'node:net';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {decodePng} from './lib/verify-png.mjs';

const directory=process.argv[2]??'.cache/roots-complete-image-20261023';
const native=process.argv[3]??'.cache/roots-animated-reference-20261023/native-animated';
const basePath=process.argv[4]??directory+'/base-report.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const width=500,height=600;
await mkdir(directory,{recursive:true});
const baseReport=await json(basePath),run=await json(native+'/run.json');
assert.equal(baseReport.status,'matched');assert.equal(baseReport.sourceStable,true);
assert.equal(baseReport.result.cleanup,true);assert.equal(baseReport.result.rows.length,20);
assert.deepEqual(baseReport.sourceAfter,baseReport.sourceBefore);
for(const [p,h]of Object.entries(baseReport.sourceBefore))assert.equal(sha(await readFile(p)),h,'Stale base producer: '+p);
for(const [n,h]of Object.entries(baseReport.inputHashes))assert.equal(sha(await readFile(native+'/'+n)),h,'Changed native input: '+n);
const sourceText=await readFile(run.source,'utf8');
assert.equal(sha(sourceText),run.sourceSha256);assert.equal(run.sourceSha256,baseReport.sourceSha256);
assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.exit,0);
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
assert.equal(sha(await readFile(jar)),baseReport.jarSha256);
const artifact=baseReport.lastFrame,base=await readFile(artifact.path);
assert.equal(artifact.width,width);assert.equal(artifact.height,height);assert.equal(artifact.orientation,'top-down');assert.equal(artifact.format,'RGBA8');
assert.equal(base.length,width*height*4);assert.equal(sha(base),artifact.sha256);assert.equal(artifact.sha256,baseReport.result.rows.at(-1).productSha256);
const names=['raw.png','enhanced.png','texture-draw-3-after.rgba','texture-draw-5-after.rgba','texture-draw-3.json','texture-draw-4.json','texture-draw-5.json'];
const nativeFiles=Object.fromEntries(await Promise.all(names.map(async n=>[n,sha(await readFile(native+'/'+n))])));
for(const n of ['texture-draw-3.json','texture-draw-4.json','texture-draw-5.json'])assert.equal((await json(native+'/'+n)).frame,19);
function flip(raw){assert.equal(raw.length,width*height*4);const out=Buffer.alloc(raw.length);for(let y=0;y<height;y++)raw.copy(out,y*width*4,(height-y-1)*width*4,(height-y)*width*4);return out;}
const artwork=flip(await readFile(native+'/texture-draw-3-after.rgba')),lastDraw=flip(await readFile(native+'/texture-draw-5-after.rgba'));
function decoded(bytes){const p=decodePng(bytes);assert.equal(p.width,width);assert.equal(p.height,height);return p.rgba;}
const originalRaw=decoded(await readFile(native+'/raw.png')),originalEnhanced=decoded(await readFile(native+'/enhanced.png'));
assert.deepEqual(originalRaw,lastDraw,'Original PNG does not match final captured draw');
function diff(a,b){assert.equal(a.length,b.length);let pixels=0,channels=0,maxAbs=0,sumAbsoluteError=0;const examples=[];for(let i=0;i<a.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);if(d){changed=true;channels++;sumAbsoluteError+=d;maxAbs=Math.max(maxAbs,d);}}if(changed){pixels++;if(examples.length<5)examples.push({x:i/4%width,y:Math.floor(i/4/width),actual:[...a.subarray(i,i+4)],reference:[...b.subarray(i,i+4)]});}}return{pixels,channels,maxAbs,sumAbsoluteError,examples};}
async function files(p){const result=[];for(const e of await readdir(p,{withFileTypes:true})){const n=p+'/'+e.name;if(e.isDirectory())result.push(...await files(n));else if(e.isFile())result.push(n);}return result;}
const paths=[...await files('src'),'server/index.mjs','scripts/verify-roots-complete-image.mjs','scripts/lib/verify-png.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const backend=await json('.cache/source-glyph-service-20261022/build-final/backend.json');
const report={status:'running',at:new Date().toISOString(),width,height,frame:19,scope:'Production GPU base artifact from all-20-frame native-world-tuple replay, imported formula layout, real glyph service/GPU and production PNG worker. Native complete PNG is unchanged; vendor overlay differences are reported, not hidden. Does not establish independent solver scheduling or full-video parity.',baseReport:{path:basePath,sha256:sha(await readFile(basePath)),artifact},jarSha256:baseReport.jarSha256,sourceSha256:run.sourceSha256,nativeFiles,sourceBefore:await hashes(),pageErrors:[]};
let service,server,browser;const started=performance.now();
try{
 service=await createExportServer({root:directory+'/exports',glyphBackend:backend});const address=await service.listen(0);
 const socket=tcp();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise((r,j)=>socket.close(e=>e?j(e):r()));
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${address.port}`,changeOrigin:false}}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 const inputs={'base.rgba':base,'native-raw.rgba':originalRaw};
 await page.route('**/image-input/*',async route=>{const n=new URL(route.request().url()).pathname.split('/').at(-1);assert.ok(Object.hasOwn(inputs,n));await route.fulfill({body:inputs[n]});});
 await page.route('**/complete-image',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Complete Roots image verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'complete-image');
 report.result=await page.evaluate(async({sourceText,width,height})=>{
  const{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{parseScene}=await import('/src/engine/document.ts');
  const{formulaPresentation}=await import('/src/engine/formulas.ts'),{rootsFormulaViewport}=await import('/src/engine/rootsFormulaPresentation.ts');
  const{prepareSourceFormulas,SourceFormulaCompositor}=await import('/src/engine/sourceFormulaCompositor.ts');
  const{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts'),{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const scene=parseScene(JSON.stringify(parseLegacyScene(sourceText).scene)),presentation=formulaPresentation(scene,rootsFormulaViewport({logicalWidth:width/2,logicalHeight:height/2,referenceLogicalHeight:486,target:'offscreen'}));
  check(presentation.layout==='source-surface-centered-v1'&&presentation.labels.length===3,'Imported source formulas');
  const base=new Uint8ClampedArray(await(await fetch('/image-input/base.rgba')).arrayBuffer()),native=new Uint8ClampedArray(await(await fetch('/image-input/native-raw.rgba')).arrayBuffer());
  const prepared=await prepareSourceFormulas(presentation),compositor=new SourceFormulaCompositor();let composed;
  try{compositor.draw(prepared,width,height,base);composed=compositor.readPixels();}finally{compositor.dispose();}
  const output={type:'raster',width,height,pixels:base,formulaPresentation:presentation};
  const raw=await encodeFormulaRaster(output,'image/png'),enhanced=await encodeFormulaRaster(output,'image/png',{sourceImageProcessing:'paused-png'});
  check(raw.type==='image/png'&&enhanced.type==='image/png','PNG encoder result');
  return{presentation,glyphs:prepared.glyphs.map(({width,height,rendererIdentity})=>({width,height,rendererIdentity})),artifacts:{'product-raw.png':Array.from(new Uint8Array(await raw.arrayBuffer())),'product-enhanced.png':Array.from(new Uint8Array(await enhanced.arrayBuffer()))},composed:Array.from(composed),enhancedExpected:Array.from(enhanceSourcePausedImage(composed,width,height)),nativeEnhancedActual:Array.from(enhanceSourcePausedImage(native,width,height))};
 },{sourceText,width,height});
 const r=report.result;for(const [n,b]of Object.entries(r.artifacts))await writeFile(directory+'/'+n,Buffer.from(b));delete r.artifacts;
 const composed=Buffer.from(r.composed),enhancedExpected=Buffer.from(r.enhancedExpected),nativeEnhancedActual=Buffer.from(r.nativeEnhancedActual);delete r.composed;delete r.enhancedExpected;delete r.nativeEnhancedActual;
 const productRaw=decoded(await readFile(directory+'/product-raw.png')),productEnhanced=decoded(await readFile(directory+'/product-enhanced.png'));
 report.comparisons={artwork:diff(composed,artwork),rawPngRoundTrip:diff(productRaw,composed),enhancedPngRoundTrip:diff(productEnhanced,enhancedExpected),nativeCompleteEnhancement:diff(nativeEnhancedActual,originalEnhanced),completeRaw:diff(productRaw,originalRaw),completeEnhanced:diff(productEnhanced,originalEnhanced),nativeOverlay:diff(artwork,originalRaw)};
 for(const n of ['artwork','rawPngRoundTrip','enhancedPngRoundTrip','nativeCompleteEnhancement'])assert.equal(report.comparisons[n].pixels,0,n+' differs');
 assert.deepEqual(report.comparisons.completeRaw,report.comparisons.nativeOverlay,'Unexplained complete raw image difference');
 report.outputHashes={rawRgba:sha(productRaw),enhancedRgba:sha(productEnhanced),rawPng:sha(await readFile(directory+'/product-raw.png')),enhancedPng:sha(await readFile(directory+'/product-enhanced.png'))};
 assert.deepEqual(report.pageErrors,[]);report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{
 await browser?.close();await server?.close();await service?.close();report.cleanup={browserClosed:true,viteClosed:true,glyphOwnedProcesses:service?.ownedProcessCount??0};
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 report.nativeStable=(await Promise.all(names.map(async n=>sha(await readFile(native+'/'+n))===nativeFiles[n]))).every(Boolean);
 if(!report.sourceStable||!report.nativeStable||report.cleanup.glyphOwnedProcesses!==0){report.status='failed';report.error='Source/reference changed or glyph process remains';process.exitCode=1;}
 report.seconds=(performance.now()-started)/1000;await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,comparisons:report.comparisons,cleanup:report.cleanup,sourceStable:report.sourceStable,nativeStable:report.nativeStable,seconds:report.seconds}));
}
