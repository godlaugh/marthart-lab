import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {createExportServer} from '../server/index.mjs';
const {values}=parseArgs({options:{backend:{type:'string'},out:{type:'string'}}});
for(const key of ['backend','out'])assert.ok(values[key]&&path.isAbsolute(values[key]),`--${key} requires an absolute path`);
await mkdir(values.out,{recursive:false});
const backend=JSON.parse(await readFile(values.backend,'utf8')),fixture=JSON.parse(await readFile(new URL('../tests/fixtures/source-formula-glyph-native.json',import.meta.url),'utf8')).cases[0];
const start=performance.now();let service,vite,browser;const report={checks:[],fixture,limits:['Headless Chrome WebGL; native-driver whole-scene equivalence is not established.','CPU, process-family peak memory and VRAM not measured.']};
try{
 service=await createExportServer({glyphBackend:backend});const address=await service.listen(0);
 vite=await createServer({configFile:false,root:path.resolve('.'),cacheDir:path.join(values.out,'vite-cache'),server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:`http://127.0.0.1:${address.port}`,changeOrigin:false}}},plugins:[{name:'formula-verification-page',configureServer(server){server.middlewares.use('/__formula_verification',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});await vite.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__formula_verification`);
 const result=await page.evaluate(async fixture=>{
  const {prepareSourceFormulas,SourceFormulaCompositor,compositeSourceFormulaPixels}=await import('/src/engine/sourceFormulaCompositor.ts');
  const {encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts');
  const {RealtimeRecorder}=await import('/src/engine/realtimeRecorder.ts');
  const {enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const check=(name,value)=>{if(!value)throw Error(name);checks.push(name);},checks=[];
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const label={id:'main-equation',latex:fixture.latex,color:fixture.color,x:0,y:200,scale:.25,visible:true,anchor:'center'};
  const presentation={layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[label]};
  let t=performance.now();const prepared=await prepareSourceFormulas(presentation);const coldMs=performance.now()-t;
  check('independent HTTP glyph matches native dimensions and RGBA hash',prepared.glyphs[0].width===fixture.width&&prepared.glyphs[0].height===fixture.height&&await hash(prepared.glyphs[0].pixels)===fixture.rgbaSha256);
  t=performance.now();const warm=await prepareSourceFormulas(presentation);const warmMs=performance.now()-t;check('fresh health cache hit reuses immutable glyph storage',warm.glyphs[0]===prepared.glyphs[0]);
  const width=500,height=600,base=new Uint8ClampedArray(width*height*4);for(let i=3;i<base.length;i+=4)base[i]=255;
  const renderer=new SourceFormulaCompositor();let pixels,rawPng,pausedPng,video;
  try{
   renderer.draw(prepared,width,height,base);pixels=renderer.readPixels();const baseHash=await hash(base);t=performance.now();for(let i=0;i<30;i++)renderer.draw(prepared,width,height,base);const warmDraw30Ms=performance.now()-t;t=performance.now();for(let i=0;i<30;i++){renderer.draw(prepared,width,height,base);renderer.readPixels();}const warmDrawReadback30Ms=performance.now()-t;
   check('repeated draws preserve source and glyph buffers',await hash(base)===baseHash&&await hash(prepared.glyphs[0].pixels)===fixture.rgbaSha256);
   const duplicate=await compositeSourceFormulaPixels(base,width,height,presentation);check('persistent preview and one-shot export compositor agree byte-for-byte',await hash(pixels)===await hash(duplicate));
   rawPng=await encodeFormulaRaster({pixels:base,width,height,formulaPresentation:presentation});
   pausedPng=await encodeFormulaRaster({pixels:base,width,height,formulaPresentation:presentation,sourceCurrentImage:{model:'local-current-numerical-snapshot',stage:'base-before-formulas',baseSize:[width,height],scale:1}});
   const decoded=await createImageBitmap(rawPng);const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.drawImage(decoded,0,0);decoded.close();check('actual PNG export retains compositor pixels',await hash(ctx.getImageData(0,0,width,height).data)===await hash(pixels));
   const decodedPaused=await createImageBitmap(pausedPng);ctx.clearRect(0,0,width,height);ctx.drawImage(decodedPaused,0,0);decodedPaused.close();check('paused PNG enhances only after formula composition',await hash(ctx.getImageData(0,0,width,height).data)===await hash(enhanceSourcePausedImage(pixels,width,height)));
   const glyph=prepared.glyphs[0],alphaBase=new Uint8ClampedArray(glyph.width*glyph.height*4);for(let i=0;i<alphaBase.length;i+=4)alphaBase.set([20,40,60,70],i);
   // Native CENTER rounds image half-extents down; offset an odd-sized texture
   // so this blend-only check still samples its texels at exactly 1:1.
   const exact={...prepared,presentation:{...presentation,primaryLogicalHeight:glyph.height,labels:[{...label,x:Math.floor(glyph.width/2)-glyph.width/2,y:Math.floor(glyph.height/2)-glyph.height/2,scale:1}]}};
   renderer.draw(exact,glyph.width,glyph.height,alphaBase);const alpha=renderer.readPixels();let maxRgb=0,maxAlpha=0;
   for(let i=0;i<alpha.length;i+=4){const a=glyph.pixels[i+3];for(let k=0;k<3;k++)maxRgb=Math.max(maxRgb,Math.abs(alpha[i+k]-Math.round(glyph.pixels[i+k]*a/255+alphaBase[i+k]*(1-a/255))));maxAlpha=Math.max(maxAlpha,Math.abs(alpha[i+3]-Math.min(255,70+a)));}
   check('translucent base uses source RGB blend and additive alpha',maxRgb<=1&&maxAlpha===0);
   const empty={presentation:{...presentation,labels:[]},glyphs:[]};renderer.draw(empty,glyph.width,glyph.height,alphaBase);check('base upload/readback preserves low-alpha raw RGBA',await hash(renderer.readPixels())===await hash(alphaBase));
   const stopped=new AbortController();stopped.abort();let cancelled=false;try{await compositeSourceFormulaPixels(base,width,height,presentation,stopped.signal);}catch(error){cancelled=error.name==='AbortError';}check('cancelled composition rejects without publishing a frame',cancelled);
   const sourceRenderer=new SourceFormulaCompositor();try{
    sourceRenderer.draw(empty,width,height,base);const scene={};const frame={canvas:sourceRenderer.canvas,source:scene,scene,sceneTime:0,revision:1,formulaPresentation:presentation};
    const recording=await new RealtimeRecorder().record(()=>frame,10,1,()=>{});check('real MediaRecorder produces complete source-formula frames',recording.frames>0&&recording.blob.size>0&&recording.frameVersions===1);video={bytes:[...new Uint8Array(await recording.blob.arrayBuffer())],extension:recording.extension,frames:recording.frames,duration:recording.duration};
   }finally{sourceRenderer.dispose();}
   return{checks,coldMs,warmMs,warmDraw30Ms,warmDrawReadback30Ms,maxRgb,maxAlpha,pixels:[...pixels],rawPng:[...new Uint8Array(await rawPng.arrayBuffer())],pausedPng:[...new Uint8Array(await pausedPng.arrayBuffer())],video,renderer:navigator.userAgent};
  }finally{renderer.dispose();}
 },fixture);
 for(const key of ['rawPng','pausedPng']){await writeFile(path.join(values.out,key+'.png'),Buffer.from(result[key]));delete result[key];}
 await writeFile(path.join(values.out,'composed.rgba'),Buffer.from(result.pixels));delete result.pixels;
 await writeFile(path.join(values.out,'recording.'+result.video.extension),Buffer.from(result.video.bytes));delete result.video.bytes;
 Object.assign(report,result);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await vite?.close();await service?.close();report.elapsedMs=performance.now()-start;await writeFile(path.join(values.out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
