import {inflateSync} from 'node:zlib';
const check=(value,message)=>assert.ok(value,message);
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=process.argv[2]??`.cache/roots-formulas-${Date.now()}`;
const native=process.argv[3]??'.cache/roots-native-exposure-20261023/native-roots';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function files(p){const result=[];for(const e of await readdir(p,{withFileTypes:true})){const n=p+'/'+e.name;if(e.isDirectory())result.push(...await files(n));else if(e.isFile())result.push(n);}return result;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')), 'scripts/verify-roots-formulas.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
await mkdir(directory,{recursive:true});
const run=JSON.parse(await readFile(native+'/run.json','utf8')),sourceText=await readFile(run.source,'utf8');
assert.equal(sha(sourceText),run.sourceSha256);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);
const backend=JSON.parse(await readFile('.cache/source-glyph-service-20261022/build-final/backend.json','utf8'));
const report={status:'running',at:new Date().toISOString(),sourceBefore:await hashes(),nativeFiles:{},scope:'Replay existing original density-color capture through production imported formula layout and real glyph HTTP/GPU composition. Actual local Generator/Worker paused capture and PNG. Does not run the original again or prove whole-scene parity.'};
for(const name of ['run.json','present-frame-65.rgba','raw-frame-65.png'])report.nativeFiles[name]=sha(await readFile(native+'/'+name));
let api,server,browser;const started=performance.now();
try{
 api=await createExportServer({root:directory+'/exports',glyphBackend:backend});const address=await api.listen(0);
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${address.port}`,changeOrigin:false}}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);
 report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/reference/*',async route=>{const n=new URL(route.request().url()).pathname.split('/').at(-1);assert.ok(['present-frame-65.rgba','raw-frame-65.png'].includes(n));await route.fulfill({body:await readFile(native+'/'+n),contentType:n.endsWith('.png')?'image/png':'application/octet-stream'});});
 await page.route('**/formula-verification',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Roots formulas</title>'}));await page.goto(server.resolvedUrls.local[0]+'formula-verification');
 report.result=await page.evaluate(async sourceText=>{
  const{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{parseScene}=await import('/src/engine/document.ts');
  const{formulaPresentation,formulaPlacement}=await import('/src/engine/formulas.ts');
  const{rootsFormulaViewport}=await import('/src/engine/rootsFormulaPresentation.ts');
  const{prepareSourceFormulas,SourceFormulaCompositor,compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts');
  const{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts');
  const{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
  const{Generator}=await import('/src/engine/client.ts');
  const{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const{upscaleSourcePausedImage}=await import('/src/engine/sourcePausedUpscale.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const scene=parseScene(JSON.stringify(parseLegacyScene(sourceText).scene)),width=500,height=600;
  check(scene.formulas.layout==='source-surface-centered-v1','imported layout');
  const viewport=rootsFormulaViewport({logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}),presentation=formulaPresentation(scene,viewport);
  check(presentation.labels.length===3,'three imported labels');
  const raw=new Uint8Array(await(await fetch('/reference/present-frame-65.rgba')).arrayBuffer()),base=new Uint8ClampedArray(raw.length);
  for(let y=0;y<height;y++)base.set(raw.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);
  const prepared=await prepareSourceFormulas(presentation),compositor=new SourceFormulaCompositor();let pixels;
  try{compositor.draw(prepared,width,height,base);pixels=compositor.readPixels();}finally{compositor.dispose();}
  const image=await createImageBitmap(await(await fetch('/reference/raw-frame-65.png')).blob());
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();const reference=ctx.getImageData(0,0,width,height).data;
  function compare(a,b,rect={x:0,y:0,width,height}){let differentPixels=0,maxDifference=0,sum=0;const examples=[];const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y)),x1=Math.min(width,Math.ceil(rect.x+rect.width)),y1=Math.min(height,Math.ceil(rect.y+rect.height));for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let changed=false;const i=(y*width+x)*4;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);changed||=d>0;maxDifference=Math.max(maxDifference,d);sum+=d;}if(changed){differentPixels++;if(examples.length<4)examples.push({x,y,actual:Array.from(a.subarray(i,i+4)),reference:Array.from(b.subarray(i,i+4))});}}return{bounds:[x0,y0,x1,y1],differentPixels,maxDifference,sumAbsoluteError:sum,examples};}
  const labels=prepared.glyphs.map((g,i)=>{const p=formulaPlacement(presentation,presentation.labels[i],width,height,{...g,centerAnchor:'integer-half-size'}),bounds={x:p.x,y:p.y,width:g.width*p.scale,height:g.height*p.scale};return{label:presentation.labels[i],glyph:{width:g.width,height:g.height,rendererIdentity:g.rendererIdentity},bounds,comparison:compare(pixels,reference,bounds)};});
  const artifacts=[];async function save(name,blob){artifacts.push({name,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});}
  await save('composited.png',await encodeRgbaPng(pixels,width,height));
  const generator=new Generator(),workerCases=[];
  try{
   // Bound solver work; retain the imported formula text/positions unchanged.
   Object.assign(scene.settings,{rootsMode:'progressive',rootSamplesPerFrame:3,rootSamplingFps:10,rootStartTime:0});
   const context={time:0,width:500,height:600,quality:'export',rootsSessionId:'formula-validation',rootsViewport:{logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary'}};
   let output=await generator.generate(scene,context);
   check(JSON.stringify(output.formulaPresentation)===JSON.stringify(presentation),'Worker frame formula identity');
   for(const scale of [1,3]){
    const pair=await generator.captureRootsPaused(output,{width,height},scale);
    check(pair.capture.sourceCurrentImage?.stage==='base-before-formulas','capture retains unenhanced base');
    check(pair.capture.width===width&&pair.capture.height===height,'capture remains base resolution');
    check(JSON.stringify(pair.capture.formulaPresentation)===JSON.stringify(presentation),'capture formula identity');
    check(pair.preview.roots.attemptedSamples===output.roots.attemptedSamples,'capture does not advance sampler');
    const composed=await compositeSourceFormulaPixels(pair.capture.pixels,width,height,presentation);
    const enhanced=enhanceSourcePausedImage(composed,width,height),expected=scale===1?enhanced:upscaleSourcePausedImage(enhanced,width,height,scale);
    const blob=await encodeFormulaRaster(pair.capture,'image/png');await save('paused-'+scale+'x.png',blob);
    // Return expected raw bytes for independent PNG decoding in the host.
    workerCases.push({scale,width:width*scale,height:height*scale,expectedSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',expected))).map(x=>x.toString(16).padStart(2,'0')).join(''),primaryLogicalHeight:pair.capture.formulaPresentation.primaryLogicalHeight,samples:pair.preview.roots.attemptedSamples});output=pair.preview;
   }
  }finally{generator.dispose();}
  window.__formulaFixture=scene;return{presentation,labels,wholeImage:compare(pixels,reference),workerCases,artifacts};
 },sourceText);
 // Decode PNG outside Canvas, preserving encoded RGBA exactly.
 for(const a of report.result.artifacts)await writeFile(directory+'/'+a.name,Buffer.from(a.bytes));
 delete report.result.artifacts;
 for(const row of report.result.workerCases){const decoded=decodePng(await readFile(directory+'/paused-'+row.scale+'x.png'));assert.equal(decoded.width,row.width);assert.equal(decoded.height,row.height);assert.equal(sha(decoded.rgba),row.expectedSha256);row.pngExact=true;row.rgbaSha256=sha(decoded.rgba);delete row.expected;}
 await page.evaluate(async()=>{const{saveWorkspace}=await import('/src/engine/document.ts');const scene=window.__formulaFixture;saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.addInitScript(()=>{const Original=window.Worker;window.__rootsCapture=undefined;window.Worker=class extends Original{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.operation==='roots-paused-capture'&&data.result)window.__rootsCapture=data.result;});}};});
 await page.route('**/api/health',r=>r.fulfill({status:503,body:'local PNG download'}));
 await page.goto(server.resolvedUrls.local[0]);
 await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('500');
 await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('600');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await downloading;await download.saveAs(directory+'/app-paused.png');
 report.app=await page.evaluate(async()=>{const pair=window.__rootsCapture;if(!pair)throw Error('App did not use retained Roots capture');const frame=pair.capture;const{compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts'),{enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');const composed=await compositeSourceFormulaPixels(frame.pixels,frame.width,frame.height,frame.formulaPresentation),expected=enhanceSourcePausedImage(composed,frame.width,frame.height);return{width:frame.width,height:frame.height,sourceCurrentImage:frame.sourceCurrentImage,formulaPresentation:frame.formulaPresentation,expectedSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',expected))).map(x=>x.toString(16).padStart(2,'0')).join('')};});
 const actual=decodePng(await readFile(directory+'/app-paused.png'));assert.equal(actual.width,report.app.width);assert.equal(actual.height,report.app.height);assert.equal(sha(actual.rgba),report.app.expectedSha256);report.app.pngExact=true;
 await page.getByRole('button',{name:'Close export',exact:true}).click();await page.screenshot({path:directory+'/app-preview.png'});
 assert.deepEqual(report.pageErrors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();await api?.close();report.cleanup={browserClosed:true,viteClosed:true,glyphOwnedProcesses:api?.ownedProcessCount??0};report.sourceAfter=await hashes();assert.deepEqual(report.sourceAfter,report.sourceBefore);report.seconds=(performance.now()-started)/1000;await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,error:report.error,labels:report.result?.labels.map(l=>({bounds:l.bounds,comparison:l.comparison})),workerCases:report.result?.workerCases,seconds:report.seconds}));}

function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');let width,height,channels,compressed=[];
 for(let at=8;at<bytes.length;){const n=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);check(at+12+n<=bytes.length,'truncated PNG chunk');if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data[8]===8&&[2,6].includes(data[9])&&data[12]===0,'unsupported PNG encoding');channels=data[9]===6?4:3;}if(name==='IDAT')compressed.push(data);at+=12+n;if(name==='IEND')break;}
 check(width&&height&&channels,'missing PNG header');const raw=inflateSync(Buffer.concat(compressed)),stride=width*channels;check(raw.length===(stride+1)*height,'PNG row length');const rows=Buffer.alloc(stride*height),rgba=Buffer.alloc(width*height*4);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?rows[y*stride+x-channels]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=channels?rows[(y-1)*stride+x-channels]:0;rows[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 for(let p=0;p<width*height;p++){rgba[p*4]=rows[p*channels];rgba[p*4+1]=rows[p*channels+1];rgba[p*4+2]=rows[p*channels+2];rgba[p*4+3]=channels===4?rows[p*channels+3]:255;}return{width,height,rgba};
}
