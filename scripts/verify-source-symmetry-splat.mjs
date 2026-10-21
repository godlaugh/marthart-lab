/** Compare real local WebGL accumulation with the fixed original shader files.
 * Original desktop GL410 shaders receive only ES300 version/precision adaptation.
 * White LUT isolates coverage; JVM-observed palettes exercise actual source colors. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=process.argv[2];if(!directory)throw Error('Supply a new output directory');await mkdir(directory);
const sha=x=>createHash('sha256').update(x).digest('hex'),check=(v,m)=>{if(!v)throw Error(m);};
const jar=process.argv[3]??'../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const manifest={jar,jarSha256:'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',shaderSources:[]},shaders={};
check(sha(await readFile(jar))===manifest.jarSha256,'Reference JAR changed');
for(const suffix of ['', '_quad'])for(const ext of ['vert','frag']){const name='density_map_accumulate'+suffix+'.'+ext,entry='data/shader/'+name,data=execFileSync('unzip',['-p',jar,entry],{maxBuffer:65536});await writeFile(directory+'/'+name,data);manifest.shaderSources.push({entry,sha256:sha(data)});shaders[name]=data.toString();}
const paletteFixtureBytes=await readFile('tests/fixtures/symmetry/palette-runtime.json'),paletteFixture=JSON.parse(paletteFixtureBytes);
const report={status:'running',reference:{jarSha256:manifest.jarSha256,shaders:manifest.shaderSources,paletteFixtureSha256:sha(paletteFixtureBytes),jvmSha256:paletteFixture.jvmSha256,harnessSha256:paletteFixture.harnessSha256},limits:['Original shaders executed through WebGL ES adaptation, not native MathArt/JOGL window execution.','Source palette LUTs come from the bundled original headless JVM. No complete native presentation parity claim.','Quad branch uses a suppressed point-probe draw to exercise actual production fallback.']},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];
 await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.cases=await page.evaluate(async ({shaders,paletteFixture})=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const {prepareSourceSymmetrySplat}=await import('/src/engine/sourceSymmetrySplat.ts');
  const width=64,height=48,count=4,canvas=new OffscreenCanvas(width,height),gl=canvas.getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('EXT_float_blend')||!gl.getExtension('OES_texture_float_linear'))throw Error('Oracle WebGL float target unavailable');
  const textures=[],programs=[],shaderObjects=[],fbo=gl.createFramebuffer(),vao=gl.createVertexArray();
  const originalDraw=WebGL2RenderingContext.prototype.drawArrays,originalImage=WebGL2RenderingContext.prototype.texImage2D,originalSubImage=WebGL2RenderingContext.prototype.texSubImage2D;let suppressProbe=false,paletteUploads=0;
  WebGL2RenderingContext.prototype.texImage2D=function(...args){if(this!==gl&&[1024,4097].includes(args[3])&&args[4]===1&&args[8])paletteUploads++;return originalImage.apply(this,args);};
  WebGL2RenderingContext.prototype.texSubImage2D=function(...args){if(this!==gl&&[1024,4097].includes(args[4])&&args[5]===1)paletteUploads++;return originalSubImage.apply(this,args);};
  WebGL2RenderingContext.prototype.drawArrays=function(mode,first,n){if(suppressProbe&&mode===this.POINTS&&n===16)return;return originalDraw.call(this,mode,first,n);};
  const texture=(w,h,data)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,data);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);return t;};
  const program=quad=>{const p=gl.createProgram();programs.push(p);for(const [type,ext]of [[gl.VERTEX_SHADER,'vert'],[gl.FRAGMENT_SHADER,'frag']]){const s=gl.createShader(type);shaderObjects.push(s);gl.shaderSource(s,shaders['density_map_accumulate'+(quad?'_quad':'')+'.'+ext].replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;'));gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const results=[];
  try{
   const point=program(false),quad=program(true),ink=texture(width,height,null),state=texture(2,2,new Float32Array(16)),palette=texture(1,1,new Float32Array([1,1,1,1]));
   const oracle=(row,radius)=>{
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,palette);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,1024,1,0,gl.RGB,gl.FLOAT,row.paletteCase?new Float32Array(row.paletteCase.lut):new Float32Array(3072).fill(1));for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
    const p=row.path==='points'?point:quad;gl.useProgram(p);gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ink,0);gl.viewport(0,0,width,height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));
    const loc=k=>gl.getUniformLocation(p,k),identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);for(const k of ['projection','modelview'])gl.uniformMatrix4fv(loc(k),false,identity);gl.uniform3f(loc('scale'),1,1,1);gl.uniform3f(loc('offset'),0,0,0);gl.uniform2f(loc('viewportSize'),width,height);gl.uniform1i(loc('texSize'),2);gl.uniform1f(loc('radius'),radius);gl.uniform1f(loc('colorSpeed'),1);gl.uniform1f(loc('stepMetricMin'),0);gl.uniform1f(loc('stepMetricMax'),2);gl.uniform1i(loc('stepMetricNormalizeMode'),1);gl.uniform1i(loc('useLUT'),1);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,2,2,gl.RGBA,gl.FLOAT,new Float32Array(Array.from({length:count},()=>[...row.position,0,row.metric??2]).flat()));gl.uniform1i(loc('stateTex'),0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,palette);gl.uniform1i(loc('paletteLUT'),1);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);
    if(row.path==='points')gl.drawArrays(gl.POINTS,0,count);else gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);gl.disable(gl.BLEND);const raw=new Float32Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,raw);if(gl.getError()!==gl.NO_ERROR)throw Error('Oracle GL error');
    // Source writes mass/R/G/B; local owner stores R/G/B/mass and top-down rows.
    const normalized=new Float32Array(raw.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=(y*width+x)*4,b=((height-1-y)*width+x)*4;normalized.set([raw[a+1],raw[a+2],raw[a+3],raw[a]],b);}return normalized;
   };
   const specs=[...[-2,0,1.5,4,20,40].flatMap(dotSize=>[{dotSize,displayScale:1,position:[0,0]},{dotSize,displayScale:1,position:[.011,.017]}]),{dotSize:4,displayScale:3,position:[0,0]},{dotSize:20,displayScale:.5,position:[.011,.017]},{dotSize:20,displayScale:1,position:[1.01,0]},{dotSize:4,displayScale:1,position:[0,-1.01]}];
   const colored=paletteFixture.cases.flatMap(paletteCase=>[-1,0,.000001,2,6,10000000].map(metric=>({paletteCase,metric,dotSize:4,displayScale:1,position:[.011,.017]})));
   for(const path of ['points','quad']){const gpu=new IteratedDensityGpu();try{for(const spec of [...specs,...colored,{dotSize:4,displayScale:1,position:[0,0],local:true},colored[0],{...colored[0],warm:true}]){
    const {paletteCase,...summary}=spec,row={path,...summary,...(paletteCase?{paletteId:paletteCase.id}:{})},input={...(paletteCase?.document??{}),config_version:'1.0.0',name:'Splat reference',type:'SYMMETRY_CHAOS',equation:{glsl:`void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(${spec.position[0].toFixed(8)},${spec.position[1].toFixed(8)},0.);m=${(spec.metric??2).toFixed(8)};}`},settings:{batch_size:count,burn_in_steps:0,dot_size:spec.dotSize,scale_x:1,scale_y:1,scale_z:1},...(paletteCase?{}:{palette:['#ffffff','#ffffff']})};
    let scene=parseProjectFile(JSON.stringify(input)).scene;if(paletteCase?.offset!==undefined)scene.palette.offset=paletteCase.offset;if(paletteCase?.cosine)scene.palette={...scene.palette,mode:'cosine',cosine:paletteCase.cosine};if(spec.local)scene.palette.cycles=2;scene=parseScene(serializeScene(scene));const job=prepareIteratedFrame(scene,0,0);job.symmetrySplat=prepareSourceSymmetrySplat(spec.dotSize,spec.displayScale);
    try{
     const uploadsBefore=paletteUploads,started=performance.now();suppressProbe=path==='quad';row.stats=gpu.step(job,{width,height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},resetParticles:true,clearInk:true});suppressProbe=false;row.stepMs=performance.now()-started;row.paletteUploads=paletteUploads-uploadsBefore;row.paletteModel=job.symmetryPalette.model;if(spec.warm&&row.paletteUploads!==0)throw Error('Warm unchanged palette reuploaded');if(spec.local&&row.paletteModel!=='local-rgba4097')throw Error('Local extension lost its sampling model');
     row.actualPath=job.symmetrySplat.path;if(row.actualPath!==path)throw Error('Requested branch unavailable: '+JSON.stringify(row));const actual=gpu.readback(),expected=oracle({...row,paletteCase},Math.max(1,Math.fround(Math.fround(spec.dotSize)*Math.fround(spec.displayScale))));let maxError=0,coverageDifferences=0,occupied=0;
     for(let i=0;i<actual.length;i++){if(!Number.isFinite(actual[i])||!Number.isFinite(expected[i]))throw Error('Nonfinite color/coverage sample');maxError=Math.max(maxError,Math.abs(actual[i]-expected[i]));if(i%4===3){if(actual[i]>0)occupied++;if((actual[i]>0)!==(expected[i]>0))coverageDifferences++;}}
     Object.assign(row,{maxError,coverageDifferences,occupied});if(path==='points'&&spec.position.some(v=>Math.abs(v)>1)&&row.stats.clipped!==count)throw Error('Point clipping statistics disagree with source clip volume');if(maxError>2e-5||coverageDifferences!==0)throw Error('Splat differs: '+JSON.stringify(row));
    }finally{suppressProbe=false;}
    results.push(row);
   }}finally{gpu.dispose();}if(gpu.diagnostics().retainedBytes!==0)throw Error('GPU retained resources');}
   return results;
  }finally{WebGL2RenderingContext.prototype.drawArrays=originalDraw;WebGL2RenderingContext.prototype.texImage2D=originalImage;WebGL2RenderingContext.prototype.texSubImage2D=originalSubImage;for(const t of textures)gl.deleteTexture(t);for(const p of programs)gl.deleteProgram(p);for(const s of shaderObjects)gl.deleteShader(s);gl.deleteFramebuffer(fbo);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{shaders,paletteFixture});
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases?.length,error:report.error,elapsedMs:report.elapsedMs}));}
