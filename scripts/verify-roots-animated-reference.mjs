import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2]??'.cache/roots-animated-reference-20261023',native=root+'/native-animated';
const reportPath=process.argv[3]??root+'/comparison.json',backend=process.argv[4]??'default';
const saveLastFrame=process.argv[5]==='--save-last-frame';
assert.ok(process.argv[5]===undefined||saveLastFrame,'Unknown artifact option');
assert.ok(['default','gl'].includes(backend),'Only default and explicit OpenGL diagnostic backends are supported');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const run=await json(native+'/run.json'),sourceText=await readFile(run.source,'utf8');
assert.equal(run.sourceSha256,sha(sourceText));assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
assert.equal(sha(await readFile(jar)),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
const files=(await readdir(native)).filter(n=>/^(splat-\d+\.(bin|json)|(?:density|present|palette|clock|state|completion)-frame-\d+\.(f32|rgba|json)|run\.json|NativeSceneProbe\.java)$/.test(n));
const inputHashes=Object.fromEntries(await Promise.all(files.map(async n=>[n,sha(await readFile(native+'/'+n))])));
const captures=await Promise.all(files.filter(n=>/^splat-\d+\.json$/.test(n)).map(n=>json(native+'/'+n)));captures.sort((a,b)=>a.frame-b.frame);
const frames=await Promise.all(Array.from({length:20},async(_,frame)=>({frame,clock:await json(native+`/clock-frame-${frame}.json`),completion:await json(native+`/completion-frame-${frame}.json`),state:await json(native+`/state-frame-${frame}.json`),present:await json(native+`/present-frame-${frame}.json`),captures:captures.filter(c=>c.frame===frame)})));
assert.ok(captures.length>0&&captures.length<=96);assert.ok(captures.every(c=>Number.isSafeInteger(c.frame)&&c.frame>=0&&c.frame<20&&c.count>0&&c.count<=3_000_000&&c.method==='glDrawArraysInstanced'));
assert.ok(frames.every(f=>f.state.densityShaderFailed==='false'));
for(const f of frames)assert.equal(f.state.capturedDraws,captures.filter(c=>c.frame<=f.frame).length,'Missing captured draw');
const gpuSource=await readFile('src/engine/rootsNativeDensityGpu.ts','utf8'),shaderBodies={};
for(const [constant,file] of [['QUAD_VERTEX','quadSplatShader.vert'],['QUAD_FRAGMENT','quadSplatShader.frag']]){
 const local=gpuSource.split(`const ${constant} = HEADER + \``)[1]?.split('`;')[0];assert.ok(local,'Missing shader body');
 const original=await readFile(native+'/'+file,'utf8'),normalize=s=>s.replace(/^#version[^\n]*\n/,'').replace(/layout\(location=[01]\) /g,'').replace(/\s/g,'');
 const expected=constant==='QUAD_VERTEX'?original.replace('uniform mat4 modelview;\n','').replace('in vec3 positionWorld;','in vec3 positionView;').replace('modelview * vec4(positionWorld, 1.0)','vec4(positionView, 1.0)'):original;
 shaderBodies[constant]={nativeSha256:sha(original),declarationAdaptations:['GLSL version/precision header','explicit vertex attribute locations 0 and 1'],viewTransform:constant==='QUAD_VERTEX'?'CPU staging: native fused Float32 and flush-to-zero; pixel comparison below remains strict':'unchanged',sameBody:normalize(local)===normalize(original),matchesDeclaredLowering:normalize(local)===normalize(expected)};assert.equal(shaderBodies[constant].matchesDeclaredLowering,true,'Splat shader differs from its declared native lowering');
}
const sourceFiles=['src/engine/rootsSceneClock.ts','src/engine/rootsCameraTimeline.ts','src/engine/rootsProjection.ts','src/engine/rootsDensityColor.ts','src/engine/rootsNativeDensityGpu.ts','src/engine/rootsNativeViewTransform.ts','scripts/verify-roots-animated-reference.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),backend,jarSha256:sha(await readFile(jar)),sourceSha256:sha(sourceText),shaderBodies,scope:'Original fixed-step unpaused scene animation; production imported clock/projection/tone plus captured native world-tuple arrival stream through real WebGL2. Full density and pre-overlay RGBA, not solver scheduling or whole PNG/video parity.',inputHashes,sourceBefore:await hashes()};
let server,browser;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:backend==='gl'?['--use-angle=gl']:[]});const page=await browser.newPage();
 report.renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');const e=gl.getExtension('WEBGL_debug_renderer_info'),r={version:gl.getParameter(gl.VERSION),renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};gl.getExtension('WEBGL_lose_context')?.loseContext();return r;});
 await page.route('**/reference/*',async r=>{const n=new URL(r.request().url()).pathname.split('/').at(-1);assert.ok(files.includes(n));await r.fulfill({body:await readFile(native+'/'+n)});});
 await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');
 report.result=await page.evaluate(async({sourceText,frames,inputHashes,saveLastFrame})=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{prepareRootsCameraTimeline,createRootsCameraClock}=await import('/src/engine/rootsCameraTimeline.ts'),{prepareRootsProjection,updateRootsProjectionState}=await import('/src/engine/rootsProjection.ts'),{prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts'),{RootsNativeDensityGpu}=await import('/src/engine/rootsNativeDensityGpu.ts');
  const scene=parseLegacyScene(sourceText).scene,clock=createRootsCameraClock(scene,prepareRootsCameraTimeline(scene)),baseColor=prepareRootsDensityColor(scene),gpu=new RootsNativeDensityGpu(),rows=[];let projection,clearCount=0;
  const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const bytes=async n=>{const b=await(await fetch('/reference/'+n)).arrayBuffer();if(await digest(b)!==inputHashes[n])throw Error('Reference digest changed: '+n);return b;};
  const flip=(a,width=500,height=600)=>{const out=new a.constructor(a.length);if(a.length!==width*height*4)throw Error('Native buffer length');for(let y=0;y<height;y++)out.set(a.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);return out;};
  const diff=(a,b)=>{if(a.length!==b.length)throw Error('comparison lengths');let different=0,maxAbs=0;const examples=[];for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('Nonfinite comparison');if(a[i]!==b[i]){different++;if(examples.length<6)examples.push({index:i,product:a[i],native:b[i]});}maxAbs=Math.max(maxAbs,Math.abs(a[i]-b[i]));}return{different,maxAbs,examples};};
  const result={rows,cleanup:false};
  try{gpu.initialize(500,600);for(const native of frames){
   const frame=clock.step(Math.fround(1/30)),plan=prepareRootsProjection({...scene.rootsPresentation,camera:{...scene.rootsPresentation.camera,...frame.camera}},{width:500,height:600,viewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'}}),update=updateRootsProjectionState(projection,plan);projection=update.state;
   if(update.clearInk){gpu.clear();clearCount++;}
   const matrix=[];for(const c of native.captures){
    matrix.push({projection:diff(update.splatPlan.projection.columnMajor,c.projection.map(Math.fround)),modelView:diff(update.splatPlan.modelView.columnMajor,c.modelview.map(Math.fround)),diameterEqual:plan.densityDiameter===Math.fround(c.pointSize[0])});
    const points=new Float32Array(await bytes(c.path));if(points.length!==c.count*4)throw Error('VBO prefix length');for(let i=0;i<points.length;i+=4)gpu.add([points[i],points[i+1],points[i+2]],points[i+3]);gpu.flush(update.splatPlan,'auto');
   }
   const color={...baseColor,paletteOffset:frame.gradient.offset},ink=gpu.readback(),expectedInk=flip(new Float32Array(await bytes(`density-frame-${native.frame}.f32`))),pixels=gpu.presentPixels(color,update.displayRotation),expected=flip(new Uint8Array(await bytes(`present-frame-${native.frame}.rgba`))),lut=new Uint8Array(await bytes(`palette-frame-${native.frame}.rgba`));
   rows.push({frame:native.frame,clock:frame,sceneTimeEqual:frame.sceneTime===Math.fround(native.clock.sceneTime),completeEqual:frame.queueComplete===native.completion.sceneComplete,paletteOffsetEqual:Math.fround(color.paletteOffset)===Math.fround(native.present.paletteOffset[0]),rotationEqual:update.displayRotation===Math.fround(native.present.displayRotation[0]),lutEqual:color.lut.every((v,i)=>v===lut[i]),matrix,clearInk:update.clearInk,submittedEqual:gpu.diagnostics().submittedPoints===Number(native.state.densityPointsRendered),density:diff(ink,expectedInk),color:diff(pixels,expected),productSha256:await digest(pixels),nativeSha256:await digest(expected)});
   if(saveLastFrame&&native.frame===frames.at(-1).frame)result.lastFrame=Array.from(pixels);
  }result.clearCount=clearCount;return result;}finally{gpu.dispose();result.cleanup=gpu.diagnostics().handles===0;}
 },{sourceText,frames,inputHashes,saveLastFrame});
 if(saveLastFrame){const bytes=Buffer.from(report.result.lastFrame),path=reportPath.replace(/\.json$/,'')+'-last.rgba';assert.equal(bytes.length,500*600*4);assert.equal(sha(bytes),report.result.rows.at(-1).productSha256);await writeFile(path,bytes);delete report.result.lastFrame;report.lastFrame={path,sha256:sha(bytes),width:500,height:600,orientation:'top-down',format:'RGBA8'};}
 const rows=report.result.rows;report.matched=rows.every(r=>r.sceneTimeEqual&&r.completeEqual&&r.paletteOffsetEqual&&r.rotationEqual&&r.lutEqual&&r.submittedEqual&&r.matrix.every(m=>!m.projection.different&&!m.modelView.different&&m.diameterEqual)&&!r.density.different&&!r.color.different);
 assert.equal(report.result.cleanup,true);report.status=report.matched?'matched':'differences';if(!report.matched)process.exitCode=1;
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';report.error='Source changed during verification';process.exitCode=1;}report.seconds=(performance.now()-started)/1000;report.cleanup={browserClosed:true,viteClosed:true};await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,renderer:report.renderer,sourceStable:report.sourceStable,seconds:report.seconds,frames:report.result?.rows.map(({clock,matrix,...r})=>({...r,matrix}))}));}
