import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const hash=x=>createHash('sha256').update(x).digest('hex');
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const report={at:new Date().toISOString(),scope:'Actual WebGL2 source Perlin renderer versus freshly extracted original shader on the same browser GPU; original flow producer is separately checked by static Python fixtures.',nativeParity:'This script runs no JVM/JOGL. Separate matched native Perlin capture: docs/source-perlin-native-reference-validation.zh-CN.md; family acceptance remains 0/11',shared:['Source flow texture bytes and runtime palette bytes; independent GPU upload, uniforms, vertex path, framebuffer and readback'],unmeasured:['Original JVM/JOGL whole frames','Public UI importer/editor/export integration','Driver memory and cross-device behavior']};
let browser,server;
try{
 const bytes=await readFile(jar);if(hash(bytes)!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Pinned JAR changed');
 const reference=JSON.parse(execFileSync('python3',['-c',"import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:z.read('data/shader/perlin_noise_'+n+'.glsl').decode() for n in ['vert','frag']}))",jar],{encoding:'utf8'}));
 report.reference={jarSha256:hash(bytes),shaders:Object.fromEntries(Object.entries(reference).map(([k,v])=>[k,hash(v)]))};
 const nativeRaster=JSON.parse(await readFile('tests/fixtures/source-perlin/native-gpu-raster.json','utf8'));
 const paths=['tests/fixtures/source-perlin/native-gpu-raster.json','src/engine/sourceProcessingTextureSampling.ts','src/engine/sourcePerlinCpuTarget.ts','src/engine/sourceProcessingStroke.ts','src/engine/sourceProcessingPoints.ts','src/engine/sourcePerlinGpu.ts','src/engine/sourcePerlinGpuShader.ts','src/engine/sourcePerlinFlowTexture.ts','src/engine/sourcePerlinSeed.ts','src/engine/sourceProcessingNoise.ts','src/engine/sourcePerlinColorRuntime.ts','src/engine/sourcePerlinParameterRuntime.ts','src/engine/ordinarySourceCameraTimeline.ts','scripts/verify-source-perlin-gpu.mjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));const before=await hashes();
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/perlin-source-oracle',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'perlin-source-oracle');
 const result=await page.evaluate(async ({reference,nativeRaster})=>{
  const {SourcePerlinGpu}=await import('/src/engine/sourcePerlinGpu.ts');
  const {SourcePerlinCpuTarget}=await import('/src/engine/sourcePerlinCpuTarget.ts');
  const {SourcePerlinFlowTexture}=await import('/src/engine/sourcePerlinFlowTexture.ts');
  const {SourcePerlinColorRuntime}=await import('/src/engine/sourcePerlinColorRuntime.ts');
  const {SourcePerlinParameterRuntime}=await import('/src/engine/sourcePerlinParameterRuntime.ts');
  const {OrdinarySourceCameraTimelineSession}=await import('/src/engine/ordinarySourceCameraTimeline.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},F=Math.fround;
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const live=new Map(),originals=[];
  for(const kind of ['Program','Shader','Buffer','Texture','VertexArray','Framebuffer'])for(const operation of ['create','delete']){
   const name=operation+kind,original=WebGL2RenderingContext.prototype[name];originals.push([name,original]);
   WebGL2RenderingContext.prototype[name]=function(...args){let objects=live.get(this);if(!objects){objects=new Set();live.set(this,objects);}const v=original.apply(this,args);if(operation==='create'&&v)objects.add(v);if(operation==='delete')objects.delete(args[0]);return v;};
  }
  const outstanding=()=>[...live.values()].reduce((sum,v)=>sum+v.size,0);
  const canvas=new OffscreenCanvas(1,1),gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,premultipliedAlpha:false});check(gl,'Reference WebGL unavailable');
  const adapt=s=>s.replace('#version 150','#version 300 es\nprecision highp float;precision highp int;');
  const program=gl.createProgram(),shaders=[];
  for(const [kind,source]of[[gl.VERTEX_SHADER,reference.vert],[gl.FRAGMENT_SHADER,reference.frag]]){const s=gl.createShader(kind);shaders.push(s);gl.shaderSource(s,adapt(source));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(program,s);}
  gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));shaders.forEach(s=>gl.deleteShader(s));
  const vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),gl.STATIC_DRAW);
  const vertex=gl.getAttribLocation(program,'vertex');gl.enableVertexAttribArray(vertex);gl.vertexAttribPointer(vertex,4,gl.FLOAT,false,0,0);
  const paletteTexture=gl.createTexture(),channelTexture=gl.createTexture(),output=gl.createTexture(),fbo=gl.createFramebuffer();
  function texture(t,width,height,packed,mipmap){
   gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmap?gl.LINEAR_MIPMAP_LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,mipmap?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   let bytes=null;if(packed){bytes=new Uint8Array(packed.length*4);packed.forEach((argb,i)=>bytes.set([(argb>>>16)&255,(argb>>>8)&255,argb&255,argb>>>24],i*4));}
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);if(mipmap){
    gl.generateMipmap(gl.TEXTURE_2D);
    // Independent Processing Texture.allocate rule, confirmed by native draw
    // capture. Do not import the production capability parser into this oracle.
    const extension=gl.getExtension('EXT_texture_filter_anisotropic');
    if(extension)gl.texParameterf(gl.TEXTURE_2D,extension.TEXTURE_MAX_ANISOTROPY_EXT,gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
   }
  }
  function draw(input,channel){
   const w=input.width,h=input.height;gl.useProgram(program);gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);
   texture(output,w,h,null,false);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Reference framebuffer');
   texture(channelTexture,channel.size,channel.size,channel.pixels,true);gl.uniform1i(gl.getUniformLocation(program,'u_channel0'),0);
   gl.activeTexture(gl.TEXTURE1);texture(paletteTexture,256,1,input.palette,true);gl.uniform1i(gl.getUniformLocation(program,'u_palette'),1);
   const loc=n=>gl.getUniformLocation(program,'u_'+n);
   const source={time:F(input.time),noiseFrequency:Math.max(F(.01),F(input.noiseFrequency)),warpAmplitude:Math.max(0,F(input.warpAmplitude)),warpFrequency:Math.max(0,F(input.warpFrequency)),directionOffset:F(input.directionOffset),timeSpeed:F(input.timeSpeed),stepSize:Math.max(F(.0001),F(input.stepSize)),brightness:Math.max(0,F(input.brightness)),vignettePower:Math.max(F(.001),F(input.vignettePower)),fiberStrength:Math.max(0,Math.min(1,F(input.fiberStrength)))};
   for(const [key,v]of Object.entries(source))gl.uniform1f(loc(key),v);
   gl.uniform1i(loc('marchSteps'),Math.max(1,input.marchSteps));gl.uniform1i(loc('renderStyle'),Math.max(0,input.renderStyle));gl.uniform1i(loc('useChannel0'),1);gl.uniform1f(loc('paletteSize'),256);gl.uniform2f(loc('resolution'),w,h);
   gl.uniformMatrix4fv(gl.getUniformLocation(program,'transform'),false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
   gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.enable(gl.DITHER);gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,6);
   const bottom=new Uint8Array(w*h*4),top=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bottom);check(gl.getError()===gl.NO_ERROR,'Reference GL error');
   for(let y=0;y<h;y++)top.set(bottom.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);return top;
  }
  const results=[],palette=new Uint32Array(256);for(let i=0;i<256;i++)palette[i]=((i%2?0x33000000:0xdd000000)|((70+i*.7)<<16)|((50+i*.6)<<8)|(110+i*.5))>>>0;
  const base={width:256,height:160,palette,time:1.25,noiseFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,timeSpeed:1,marchSteps:32,stepSize:.008,brightness:1.7,vignettePower:.1,fiberStrength:.78,renderStyle:0};
  let preview;
  async function compare(gpu,input,channel,label){
   const a=gpu.render(input),b=draw(input,channel);let differing=0,maxDelta=0,sharedDiffering=0;
   for(let i=0;i<a.length;i++){if(a[i]!==b[i])differing++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}
   check(differing===0,`${label} differs ${differing} channels delta${maxDelta}`);check(a.every((v,i)=>i%4!==3||v===255),'Output alpha must be opaque');
   const shared=new SourcePerlinCpuTarget({width:input.width,height:input.height,density:1,samples:0,initialColor:[1,0,0,.5]});
   try{shared.drawGpu(input,channel);const pixels=shared.readPixels();for(let i=0;i<pixels.length;i++)if(pixels[i]!==b[i])sharedDiffering++;check(sharedDiffering===0,`${label} shared target differs ${sharedDiffering} channels`);}finally{shared.dispose();}
   results.push({label,pixels:input.width*input.height,differing,maxDelta,sharedDiffering,sha256:await digest(a)});return a;
  }
  for(let style=0;style<6;style++){
   const channel={size:512,pixels:new SourcePerlinFlowTexture({seed:'1771842692935',style,size:512}).generate()},gpu=new SourcePerlinGpu(channel);
   try{
    for(const renderStyle of [0,1]){const input={...base,renderStyle};const image=await compare(gpu,input,channel,`texture${style}-render${renderStyle}`);if(style===1&&renderStyle===1)preview={width:input.width,height:input.height,bytes:Array.from(image)};}
    if(style===0){
     await compare(gpu,{...base,width:99,height:73,time:-.5,marchSteps:1,fiberStrength:-1},channel,'odd-size-first-weight-zero');
     await compare(gpu,{...base,width:65,height:47,marchSteps:1000,renderStyle:2,warpAmplitude:-2,vignettePower:-2,stepSize:-1,noiseFrequency:-1},channel,'host-and-shader-clamps');
     const other=new Uint32Array(palette).map(c=>c^0xff000000);const a=gpu.render(base),b=gpu.render({...base,palette:other});check(a.every((v,i)=>v===b[i]),'Palette alpha leaked into RGB');results.push({label:'palette-alpha-ignored',different:0});
     const colors=new SourcePerlinColorRuntime({palette:[0xffff5555,0xff55ff55,0xff5555ff]}),params=new SourcePerlinParameterRuntime({initial:{noise_offset:0,noise_scale:12,curve_noise_scale:1,curve_angle_scale:4},backend:'gpu',style:'particles'});
     let time=0,last;
     const tracks=[{id:'a',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:.5,easing:'linear',enabled:true,pingPong:false,actions:[{id:'g',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'linear',speed:90,affectInside:true,affectOutside:true}}]}];
     const sequence=new OrdinarySourceCameraTimelineSession({phi:0,theta:0,gamma:0,zoom:1,center:[0,0,0],focalDistance:20},tracks,4,{particleActions:'perlin',createParticles:()=>({bind:()=>{throw Error('Unexpected tracking');},beginGradientActions:a=>colors.beginGradientActions(a),interpolateGradientActions:(e,f)=>colors.interpolateGradientActions(e,f),update:f=>{time=f.time;colors.update(f.deltaTime);params.update(f.deltaTime);},displayFrame:()=>{last=gpu.render({...base,width:64,height:48,time,palette:colors.paletteTexture()});}})});
     sequence.evaluate(.25);const frozen=new Uint8Array(last);sequence.evaluate(1.25);check(time===.5&&frozen.every((v,i)=>v===last[i]),'Completed queue GPU frame advanced');results.push({label:'real-queue-color-gpu-freeze',time,sha256:await digest(last)});
    }
   }finally{gpu.dispose();gpu.dispose();}
  }
  for(const [width,size]of[[1080,1024],[2160,2048]]){
   // Synthetic channels isolate exact bucket transitions and mipmap allocation;
   // actual source-sized scalar textures have separate independent fixtures.
   const channel={size,pixels:new Uint32Array(size*size).fill(0xff808080)},gpu=new SourcePerlinGpu(channel);
   try{await compare(gpu,{...base,width,height:2,marchSteps:8},channel,`synthetic-channel-threshold${width}`);}finally{gpu.dispose();}
  }
  const nativeChannel={size:512,pixels:new SourcePerlinFlowTexture({seed:nativeRaster.seed,style:nativeRaster.textureStyle,size:512}).generate()},nativeGpu=new SourcePerlinGpu(nativeChannel);
  const nativePalette=new SourcePerlinColorRuntime({palette:nativeRaster.palette}).paletteTexture();
  const {enhanceSourcePausedImage}=await import('/src/engine/sourcePausedImage.ts');
  const [x0,y0,x1,y1]=nativeRaster.roi;
  const roi=pixels=>{const out=new Uint8Array((x1-x0)*(y1-y0)*4);for(let y=y0;y<y1;y++)out.set(pixels.subarray((y*nativeRaster.width+x0)*4,(y*nativeRaster.width+x1)*4),(y-y0)*(x1-x0)*4);return out;};
  try{for(const expected of nativeRaster.cases){
   const pixels=nativeGpu.render({width:nativeRaster.width,height:nativeRaster.height,...nativeRaster.uniforms,time:expected.time,palette:nativePalette});
   const rawSha=await digest(roi(pixels)),enhancedSha=await digest(roi(enhanceSourcePausedImage(pixels,nativeRaster.width,nativeRaster.height)));
   check(rawSha===expected.rawRoiRgbaSha256&&enhancedSha===expected.enhancedRoiRgbaSha256,`Native GPU filament ROI mismatch at ${expected.time}; retain device evidence, do not relax tolerance`);
   results.push({label:`native-filament-roi-time-${expected.time}`,rawSha,enhancedSha,roi:nativeRaster.roi});
  }}finally{nativeGpu.dispose();}
  // Exercise the real renderer on a context without this optional extension.
  // The independent oracle reuses textures; restore their default before
  // simulating absence so earlier max-anisotropy runs cannot contaminate it.
  const resetExtension=gl.getExtension('EXT_texture_filter_anisotropic');
  if(resetExtension)for(const t of[channelTexture,paletteTexture]){gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameterf(gl.TEXTURE_2D,resetExtension.TEXTURE_MAX_ANISOTROPY_EXT,1);}
  const getExtension=WebGL2RenderingContext.prototype.getExtension;
  WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_texture_filter_anisotropic'?null:getExtension.call(this,name);};
  const fallbackChannel={size:512,pixels:new SourcePerlinFlowTexture({seed:'1771842692935',style:0,size:512}).generate()},fallbackGpu=new SourcePerlinGpu(fallbackChannel);
  try{await compare(fallbackGpu,base,fallbackChannel,'anisotropy-extension-unavailable');}
  finally{fallbackGpu.dispose();WebGL2RenderingContext.prototype.getExtension=getExtension;}
  const failureChecks=[];
  function failureCase(label,install,cancelled){
   const baseline=outstanding(),gpu=new SourcePerlinGpu({size:512,pixels:new Uint32Array(512*512)});
   const restore=install?.()??(()=>{});let first,second;
   try{try{gpu.render(base,cancelled);}catch(e){first=e.code;}}finally{restore();}
   try{gpu.render(base);}catch(e){second=e.code;}
   gpu.dispose();gpu.dispose();check(first&&second==='failed'&&outstanding()===baseline,`${label}: ${first}/${second}, resources ${outstanding()-baseline}`);
   failureChecks.push({label,firstError:first,retryError:second,retainedResources:outstanding()-baseline});
  }
  for(const [name,nth]of[['createProgram',1],['createShader',2],['createVertexArray',1],['createTexture',1],['createTexture',3],['createFramebuffer',1]]){
   failureCase(`${name}-${nth}-allocation-failure`,()=>{const original=WebGL2RenderingContext.prototype[name];let calls=0;WebGL2RenderingContext.prototype[name]=function(...args){return ++calls===nth?null:original.apply(this,args);};return()=>WebGL2RenderingContext.prototype[name]=original;});
  }
  const anisotropyExtension=gl.getExtension('EXT_texture_filter_anisotropic');
  if(anisotropyExtension)failureCase('invalid-anisotropy-capability',()=>{
   const original=WebGL2RenderingContext.prototype.getParameter;
   WebGL2RenderingContext.prototype.getParameter=function(name){return name===anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT?NaN:original.call(this,name);};
   return()=>WebGL2RenderingContext.prototype.getParameter=original;
  });
  failureCase('cancel-before-context',undefined,()=>true);
  let cancellationChecks=0;failureCase('cancel-after-allocation',undefined,()=>++cancellationChecks===2);
  failureCase('context-lost-after-draw',()=>{const name='drawArrays',original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){original.apply(this,args);const extension=this.getExtension('WEBGL_lose_context');check(extension,'Context loss extension unavailable');extension.loseContext();};return()=>WebGL2RenderingContext.prototype[name]=original;});
  [paletteTexture,channelTexture,output].forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(fbo);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);check(outstanding()===0,`Retained GL resources ${outstanding()}`);gl.getExtension('WEBGL_lose_context')?.loseContext();
  originals.forEach(([name,fn])=>WebGL2RenderingContext.prototype[name]=fn);
  const previewCanvas=document.createElement('canvas');previewCanvas.width=preview.width;previewCanvas.height=preview.height;previewCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(preview.bytes),preview.width,preview.height),0,0);
  return{results,failureChecks,outstanding:outstanding(),preview:previewCanvas.toDataURL('image/png')};
 },{reference,nativeRaster});
 if(errors.length)throw Error(errors.join('\n'));const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during verification');
 report.sourceHashes=after;report.results=result.results;report.failureChecks=result.failureChecks;report.outstandingGlResources=result.outstanding;
 await writeFile('.cache/source-perlin-gpu-preview.png',Buffer.from(result.preview.split(',')[1],'base64'));report.preview='.cache/source-perlin-gpu-preview.png';report.status='passed';
 await writeFile('.cache/v2-perlin-gpu-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:result.results.length,failureChecks:result.failureChecks.length,report:'.cache/v2-perlin-gpu-verification.json',preview:report.preview}));
}catch(error){report.status='failed';report.error=error.stack;await writeFile('.cache/v2-perlin-gpu-verification.json',JSON.stringify(report,null,2)+'\n');throw error;}
finally{await browser?.close();await server?.close();}
