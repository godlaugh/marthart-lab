import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createServer as tcp} from 'node:net';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';

// The reference directories are passive captures of the unchanged original
// Scene.runFrame. Compare whole layers; retain the later branded frame too.
const {values}=parseArgs({options:{reference:{type:'string'},'native-backend':{type:'string'},'glyph-backend':{type:'string'},out:{type:'string'}}});
for(const key of ['reference','native-backend','glyph-backend','out'])assert(values[key]&&path.isAbsolute(values[key]),`--${key} requires an absolute path`);
const sha=b=>createHash('sha256').update(b).digest('hex'),out=values.out,reference=values.reference;
await mkdir(out,{recursive:false});
const hashes=async()=>{const files=['scripts/verify-attractor-formula-reference.mjs'];for(const root of ['src','server'])for(const file of await readdir(root,{recursive:true}))if(/\.(ts|tsx|mjs|m|h|java)$/.test(file))files.push(root+'/'+file);return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,sha(await readFile(file))])));};
const report={status:'running',at:new Date().toISOString(),scope:'Actual production importer, Worker, native CPU drawing, independent glyph service and formula compositor against original whole 500x600 mathematical and formula layers. Paused initial frames use the captured original math base for overlay-only comparison; step 1/16 also use independently generated product math.',limits:['Finite Aizawa and diagnostic extras/main inputs on this Mac only. Other dimensions, GPU mathematical parity and another device are not established.','Original full branded frames are retained and measured separately. Product artwork does not reproduce original branding.','JSON reload entry uses JSON name; original file-constructor basename semantics are not claimed.','Runtime includes observation overhead. CPU, process-family peak memory, VRAM and task tokens are not measured.'],cases:[],errors:[],cleanup:[]};
const start=performance.now();report.sourceBefore=await hashes();let browser,vite,service;
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const referenceHashes=async()=>{const files=[];for(const name of ['aizawa','constructed']){const dir=path.join(reference,name+'-r1');files.push(dir+'/source.json',dir+'/labels.json',dir+'/run.json');for(const label of await json(dir+'/labels.json'))files.push(dir+'/'+label.glyphRgba);for(const key of ['paused-initial','step-1','step-16','paused-after-16'])for(const file of ['state.json','capture.json','math-candidate.rgba','math-plus-formulas.rgba','full-with-branding.rgba'])files.push(dir+'/'+key+'/'+file);}return Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,sha(await readFile(file))])));};
const topDown=(bytes,width,height)=>{assert.equal(bytes.length,width*height*4);const result=Buffer.alloc(bytes.length),stride=width*4;for(let y=0;y<height;y++)bytes.copy(result,y*stride,(height-1-y)*stride,(height-y)*stride);return result;};
function compare(a,b,width){assert.equal(a.length,b.length);let pixels=0,channels=0,maxAbs=0;const examples=[];for(let i=0;i<a.length;i+=4){let changed=false;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);if(d){changed=true;channels++;maxAbs=Math.max(maxAbs,d);}}if(changed){pixels++;if(examples.length<6)examples.push({x:i/4%width,y:Math.floor(i/4/width),actual:[...a.subarray(i,i+4)],reference:[...b.subarray(i,i+4)]});}}return{totalPixels:a.length/4,pixels,channels,maxAbs,examples};}
const f32=bits=>{assert.match(bits,/^[0-9a-f]{8}$/);const b=Buffer.alloc(4);b.writeUInt32LE(parseInt(bits,16));return b.readFloatLE();};
try{
 report.referenceBefore=await referenceHashes();
 const backend=await json(values['native-backend']),glyphBackend=await json(values['glyph-backend']);assert.equal(sha(await readFile(backend.executablePath)),backend.executableSha256);
 report.backends={native:{path:values['native-backend'],sha256:sha(await readFile(values['native-backend'])),executableSha256:backend.executableSha256},glyph:{path:values['glyph-backend'],sha256:sha(await readFile(values['glyph-backend']))}};
 const port=await new Promise((resolve,reject)=>{const server=tcp();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});
 const origin=`http://127.0.0.1:${port}`;service=await createExportServer({root:out+'/service',allowedOrigins:[origin],sourceRendererBackend:backend,glyphBackend});const address=await service.listen(0);
 vite=await createServer({define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('native')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));await page.route('**/__attractor_formula_reference',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,">'}));await page.goto(origin+'/__attractor_formula_reference');
 for(const name of ['aizawa','constructed']){
  const dir=path.join(reference,name+'-r1'),source=await readFile(dir+'/source.json'),labels=await json(dir+'/labels.json'),row={name,reference:dir,sourceSha256:sha(source),labels,frames:[]};report.cases.push(row);await mkdir(out+'/'+name);
  const originalRun=await json(dir+'/run.json');assert.equal(originalRun.exit,0);for(const key of ['reaped','sourceUnchanged','originalSourceUnchanged','jarUnchanged','normalSettingsUnchanged'])assert.equal(originalRun[key],true,key);for(const key of ['timedOut','processGroupExists'])assert.equal(originalRun[key],false,key);assert.equal(originalRun.plan.sourceSha256,row.sourceSha256);assert.equal(originalRun.plan.observer,true);assert.equal(originalRun.plan.viewport.samples,0);
  const frames=[];for(const [key,updates]of [['paused-initial',0],['step-1',1],['step-16',16],['paused-after-16',16]]){const state=await json(dir+'/'+key+'/state.json'),capture=await json(dir+'/'+key+'/capture.json');assert.equal(state.updatesSinceInit,updates);assert.deepEqual(state.primary,[405,486,2]);assert.deepEqual(state.target,[250,300,500,600,2]);assert.equal(capture.rowOrder,'bottom-up');assert.equal(capture.formulaDraws,labels.length);assert(capture.brandingDraws>0);const base=topDown(await readFile(dir+'/'+key+'/math-candidate.rgba'),500,600);frames.push({key,state,capture,base:base.toString('base64')});}
  const result=await page.evaluate(async({source,frames})=>{
   const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{Generator}=await import('/src/engine/client.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{SourceDrawingResources}=await import('/src/engine/sourceDrawingResources.ts'),{renderSourceNativeChunks}=await import('/src/engine/sourceNativeClient.ts'),{outputBuffers}=await import('/src/engine/outputBuffers.ts'),{prepareSourceFormulas,SourceFormulaCompositor}=await import('/src/engine/sourceFormulaCompositor.ts'),{formulaPresentation}=await import('/src/engine/formulas.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
   const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);},decode=s=>Uint8ClampedArray.from(atob(s),c=>c.charCodeAt(0));
   const scene=parseProjectFile(source).scene,generator=new Generator(),results=[];let resources,compositor;
   try{
    resources=new SourceDrawingResources();compositor=new SourceFormulaCompositor();const viewport=ordinarySourceViewport(scene,250,300,'offscreen',486),presentation=formulaPresentation(scene,viewport),prepared=await prepareSourceFormulas(presentation);
    for(const [ordinal,frame]of frames.entries()){
     const base=decode(frame.base);compositor.draw(prepared,500,600,base);const overlay=compositor.readPixels(),item={key:frame.key,overlay:encode(overlay),overlayPng:encode(new Uint8Array(await(await encodeRgbaPng(overlay,500,600)).arrayBuffer()))};
     if(frame.key==='step-1'||frame.key==='step-16'){
      const time=(frame.state.updatesSinceInit-1)/30,output=await generator.generate(scene,{time,width:500,height:600,quality:'export',sourceViewport:viewport,sourcePointPixelDensity:2});
      const r=resources.renderer;r.setSize(250,300,2);r.setOutput(output,{...scene,evaluatedSourceCamera:output.sourceCameraFrame},false);const plan=r.sourceDrawingPlan(1,ordinal+1,{retainedBuffers:outputBuffers(output),additionalBytes:500*600*8});if(!plan.ok)throw Error(plan.error.reason);let receipt;
      try{receipt=await renderSourceNativeChunks(plan.value,plan.value.plan,{signal:new AbortController().signal});}finally{const released=plan.value.plan.dispose();if(!released.ok)throw Error(released.error.reason);}
      const actual=await prepareSourceFormulas(output.formulaPresentation);compositor.draw(actual,500,600,receipt.pixels);const artwork=compositor.readPixels();Object.assign(item,{time,presentation:output.formulaPresentation,math:encode(receipt.pixels),artwork:encode(artwork),artworkPng:encode(new Uint8Array(await(await encodeRgbaPng(artwork,500,600)).arrayBuffer())),nativeRenderer:receipt.rendererIdentity,temporal:output.temporal});
     }results.push(item);
    }
    return{presentation,glyphs:prepared.glyphs.map(g=>({width:g.width,height:g.height,rendererIdentity:g.rendererIdentity,pixels:encode(g.pixels)})),frames:results};
   }finally{try{generator.dispose();}finally{try{resources?.dispose();}finally{compositor?.dispose();}}}
  },{source:source.toString(),frames});
  assert.equal(result.presentation.layout,'source-surface-centered-v1');assert.equal(result.presentation.primaryLogicalHeight,486);assert.equal(result.presentation.labels.length,labels.length);row.presentation=result.presentation;row.glyphs=[];
  for(const [i,label]of labels.entries()){
   assert.equal(label.glyphRowOrder,'top-down');assert.equal(label.fontSize,50);assert.equal(label.overlay,true);
   const actual=result.presentation.labels[i];assert.equal(actual.latex,label.latex);assert.equal(actual.x,f32(label.xBits));assert.equal(actual.y,f32(label.yBits));assert.equal(actual.scale,f32(label.scaleBits));assert.equal(actual.color,'#'+(label.colorArgb&0xffffff).toString(16).padStart(6,'0'));assert.equal(label.colorArgb>>>24,255);
   const g=result.glyphs[i],pixels=Buffer.from(g.pixels,'base64'),original=await readFile(dir+'/'+label.glyphRgba);assert.deepEqual([g.width,g.height],label.glyphSize);const comparison=compare(pixels,original,g.width);row.glyphs.push({width:g.width,height:g.height,rendererIdentity:g.rendererIdentity,rgbaSha256:sha(pixels),originalSha256:sha(original),comparison});await writeFile(out+'/'+name+'/glyph-'+i+'.rgba',pixels);
  }
  for(const item of result.frames){
   const frame=frames.find(f=>f.key===item.key),original=topDown(await readFile(dir+'/'+item.key+'/math-plus-formulas.rgba'),500,600),base=Buffer.from(frame.base,'base64'),branded=await readFile(dir+'/'+item.key+'/full-with-branding.rgba'),overlay=Buffer.from(item.overlay,'base64'),comparisons={overlayOnOriginalBase:compare(overlay,original,500),originalFormulaEffect:compare(original,base,500),originalBrandingEffect:compare(branded,original,500)};
   await writeFile(out+'/'+name+'/'+item.key+'-overlay.png',Buffer.from(item.overlayPng,'base64'));await writeFile(out+'/'+name+'/'+item.key+'-overlay.rgba',overlay);
   if(item.math){const math=Buffer.from(item.math,'base64'),artwork=Buffer.from(item.artwork,'base64');Object.assign(comparisons,{mathematicalRaster:compare(math,base,500),artworkIncludingFormulas:compare(artwork,original,500),completeBrandedFrame:compare(artwork,branded,500)});await writeFile(out+'/'+name+'/'+item.key+'-product.png',Buffer.from(item.artworkPng,'base64'));await writeFile(out+'/'+name+'/'+item.key+'-product.rgba',artwork);assert.deepEqual(item.presentation,result.presentation);}
   row.frames.push({key:item.key,time:item.time,presentation:item.presentation,temporal:item.temporal,nativeRenderer:item.nativeRenderer,originalCapture:frame.capture,originalState:frame.state,overlaySha256:sha(overlay),originalSha256:sha(original),originalMathSha256:sha(base),originalBrandedSha256:sha(branded),comparisons});
  }
  assert.equal(row.frames.length,4);assert.equal(row.frames.filter(f=>f.comparisons.mathematicalRaster).length,2);
  row.status=row.glyphs.every(g=>g.comparison.pixels===0)&&row.frames.every(f=>f.comparisons.originalFormulaEffect.pixels>0&&f.comparisons.originalBrandingEffect.pixels>0&&f.comparisons.overlayOnOriginalBase.pixels===0&&(!f.comparisons.artworkIncludingFormulas||f.comparisons.artworkIncludingFormulas.pixels===0&&f.comparisons.mathematicalRaster.pixels===0))?'matched':'differences';console.log(JSON.stringify({name,status:row.status,frames:row.frames.map(f=>({key:f.key,overlay:f.comparisons.overlayOnOriginalBase.pixels,math:f.comparisons.mathematicalRaster?.pixels,artwork:f.comparisons.artworkIncludingFormulas?.pixels}))}));await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 }
 assert.equal(report.errors.length,0);report.status=report.cases.every(c=>c.status==='matched')?'matched':'differences';if(report.status!=='matched')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 for(const [name,resource]of [['browser',browser],['vite',vite],['service',service]])try{await resource?.close();report.cleanup.push({name,status:'closed'});}catch(error){report.cleanup.push({name,status:'failed',error:String(error)});report.status='failed';process.exitCode=1;}
 report.remainingServiceProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-start;
 report.referenceAfter=await referenceHashes();report.referenceStable=JSON.stringify(report.referenceBefore)===JSON.stringify(report.referenceAfter);
 if(!report.sourceStable||!report.referenceStable||report.remainingServiceProcesses){report.status='failed';process.exitCode=1;}await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,referenceStable:report.referenceStable,remainingServiceProcesses:report.remainingServiceProcesses,elapsedMs:report.elapsedMs}));
}
