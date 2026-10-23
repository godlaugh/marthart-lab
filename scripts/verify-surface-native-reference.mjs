import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodePng} from './lib/verify-png.mjs';
const root=process.argv[2]??'.cache/surface-native-reference-20261023',out=process.argv[3]??root+'/verified';await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),report={at:new Date().toISOString(),scope:'Original full paused Surface frame versus real imported Generator/Worker, paused capture and formula compositor. Complete artistic stage and unchanged vendor-overlay PNGs compared separately; no mask, no tolerance relaxation.',cases:[]};let server,browser,service;const started=performance.now();
async function files(p){const out=[];for(const e of await readdir(p,{withFileTypes:true})){const q=p+'/'+e.name;if(e.isDirectory())out.push(...await files(q));else if(e.isFile())out.push(q);}return out;}
const sourcePaths=[...await files('src'),...await files('server'),'scripts/verify-surface-native-reference.mjs','scripts/lib/verify-png.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.sort().map(async p=>[p,sha(await readFile(p))])));
report.sourceBefore=await hashes();report.referenceHashes={};
const reference=async p=>{const b=await readFile(p);report.referenceHashes[p]=sha(b);return b;};
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
report.jarSha256=sha(await reference(jar));assert.equal(report.jarSha256,'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
function flip(b){const a=Buffer.alloc(b.length);for(let y=0;y<600;y++)b.copy(a,y*2000,(599-y)*2000,(600-y)*2000);return a;}
function diff(a,b){assert.equal(a.length,b.length);let pixels=0,max=0,sum=0;const examples=[];for(let i=0;i<a.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);max=Math.max(max,d);sum+=d;changed||=d>0;}if(changed){pixels++;if(examples.length<10)examples.push({x:i/4%500,y:Math.floor(i/4/500),a:[...a.subarray(i,i+4)],b:[...b.subarray(i,i+4)]});}}return{pixels,max,sum,examples};}
try{
 service=await createExportServer({root:out+'/exports',allowedOrigins:['http://127.0.0.1:5178'],glyphBackend:JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json','utf8'))});const addr=await service.listen(0);
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:5178,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${addr.port}`}},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');
 for(const name of ['cornucopia','sphere','mobius']){
  const native=root+(name==='mobius'?'/mesh':'')+'/native-'+name,run=JSON.parse(await reference(native+'/run.json')),text=(await reference(run.source)).toString();assert.equal(sha(await reference(native+'/NativeSceneProbe.java')),run.probeSha256);assert.equal(run.timedOut,false);assert.equal(sha(text),run.sourceSha256);assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);
  const row=await page.evaluate(async text=>{
   const{Generator}=await import('/src/engine/client.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts'),{compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
   const scene=parseLegacyScene(text).scene,g=new Generator();try{
    const geometry=await g.generate(scene,{time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486),surfaceLive:{sessionId:'native-surface',revision:0,clock:{paused:true,timestampMs:0},actualFrameRate:60}});
    const pair=await g.captureSurfacePaused(geometry,{width:500,height:600},1),r=pair.capture;
    const composed=await compositeSourceFormulaPixels(r.pixels,r.width,r.height,r.formulaPresentation),png=await encodeFormulaRaster(r,'image/png');
    const {positions,colors,pointAlphas,...facts}=geometry;
    return{width:r.width,height:r.height,geometry:{...facts,positions:Array.from(positions),colors:colors&&Array.from(colors),pointAlphas:pointAlphas&&Array.from(pointAlphas)},captureCamera:r.sourceCameraFrame,formula:r.formulaPresentation,base:Array.from(r.pixels),composed:Array.from(composed),basePng:Array.from(new Uint8Array(await(await encodeRgbaPng(r.pixels,r.width,r.height)).arrayBuffer())),enhancedPng:Array.from(new Uint8Array(await png.arrayBuffer()))};
   }finally{g.dispose();}
  },text);
  assert.equal(row.width,500);assert.equal(row.height,600);const base=Buffer.from(row.base),composed=Buffer.from(row.composed);delete row.base;delete row.composed;
  await writeFile(out+'/'+name+'-base.rgba',base);await writeFile(out+'/'+name+'-composed.rgba',composed);
  await writeFile(out+'/'+name+'-base.png',Buffer.from(row.basePng));await writeFile(out+'/'+name+'-enhanced.png',Buffer.from(row.enhancedPng));delete row.basePng;delete row.enhancedPng;
  row.name=name;row.native={path:native,sourceSha256:run.sourceSha256,seconds:run.seconds};assert.equal(row.formula.labels.length,name==='cornucopia'?1:0);row.baseComparison=diff(base,flip(await reference(native+'/before-first-texture.rgba')));
  const artwork=name==='cornucopia'?flip(await reference(native+'/texture-draw-1-after.rgba')):flip(await reference(native+'/before-first-texture.rgba'));
  row.artworkComparison=diff(composed,artwork);row.completeComparison=diff(decodePng(await readFile(out+'/'+name+'-enhanced.png')).rgba,decodePng(await reference(native+'/enhanced.png')).rgba);report.cases.push(row);row.status=row.artworkComparison.pixels===0?'matched':'differences';console.log(JSON.stringify({name,base:row.baseComparison,artwork:row.artworkComparison}));
 }
 report.status=report.cases.every(c=>c.status==='matched')?'matched':'differences';if(report.status==='differences')process.exitCode=1;
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();await service?.close();report.remainingProcesses=service?.ownedProcessCount;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=(await Promise.all(Object.entries(report.referenceHashes).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);report.seconds=(performance.now()-started)/1000;if(!report.sourceStable||!report.referencesStable||report.remainingProcesses!==0){report.status='failed';report.error='Sources/references changed or glyph processes remain';process.exitCode=1;}await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error}));}
