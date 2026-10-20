/** Independent original MathArt splat shader harness. No product imports.
 * From studio/: node scripts/build-samila-splat-oracle.mjs [output-directory]
 *   [--noise-lut path-to-256x256-little-endian-f32] [--palette-fixture path]
 * Default output .cache/samila-splat-oracle. Fixed JAR + Chrome required.
 * Uses fixed formula constants at the original body marker, leaving original
 * transform, noise, palette sampling and coverage statements intact. The only
 * shader portability edit is #version 410 -> ES300 plus precision declarations.
 * Explicit fixture LUTs isolate shader sampling; they do not prove the Java
 * PaletteRuntime generator. Native host GL point-probe selection is not inferred.
 */
import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
const args=process.argv.slice(2);if(args.includes('--help')){console.log('Usage: node scripts/build-samila-splat-oracle.mjs [output-directory] [--noise-lut path] [--palette-fixture path]\nRun from studio/. Original full shader in headless Chrome; explicit LUT input is little-endian 256x256 Float32. No native image parity.');process.exit(0);}
const check=(v,m)=>{if(!v)throw Error(m);},sha=b=>createHash('sha256').update(b).digest('hex');let directory='.cache/samila-splat-oracle',lutPath,palettePath;
for(let i=0;i<args.length;i++){if(args[i]==='--noise-lut'){lutPath=args[++i];check(lutPath,'missing noise LUT path');}else if(args[i]==='--palette-fixture'){palettePath=args[++i];check(palettePath,'missing palette fixture path');}else{check(!args[i].startsWith('--')&&directory==='.cache/samila-splat-oracle','unknown or duplicate argument');directory=args[i];}}
await mkdir(directory,{recursive:true});
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',jarSha256=sha(await readFile(jar));check(jarSha256==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','fixed JAR changed');
const extract=member=>execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,member]);
const originals={vertex:extract('data/shader/samila_splat.vert'),fragment:extract('data/shader/samila_splat.frag')};
const portable=s=>{check(s.startsWith('#version 410\n'),'unexpected original version');return s.replace('#version 410\n','#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\n');};
const marker='// %SAMILA_FUNCTION_BODY%',body='uniform vec2 oraclePoint;uniform float a,b,c,d;\nfloat samila_f1(float x,float y){return oraclePoint.x;}\nfloat samila_f2(float x,float y){return oraclePoint.y;}';
check(originals.vertex.toString().split(marker).length===2,'source body marker mismatch');
const vertex=portable(originals.vertex.toString()).replace(marker,body),fragment=portable(originals.fragment.toString());
await writeFile(directory+'/original.vert',originals.vertex);await writeFile(directory+'/original.frag',originals.fragment);await writeFile(directory+'/oracle.vert',vertex);await writeFile(directory+'/oracle.frag',fragment);
let noise,noiseProvenance;if(lutPath){const bytes=await readFile(lutPath);check(bytes.length===256*256*4,'noise LUT byte length');noiseProvenance=JSON.parse(await readFile(dirname(lutPath)+'/report.json','utf8'));check(noiseProvenance.jarSha256===jarSha256&&noiseProvenance.sha256===sha(bytes)&&noiseProvenance.evidenceKind==='independent Python interpretation of original numeric bytecode; no product import/JVM execution','noise LUT provenance/hash mismatch');noise=Array.from({length:65536},(_,i)=>bytes.readFloatLE(i*4));check(noise.every(Number.isFinite),'noise LUT nonfinite');}
const white=Array(1024*3).fill(1),ramp=Array.from({length:1024},(_,i)=>[i/1023,1-i/1023,.25]).flat();
let paletteFixture;if(palettePath){check(noise,'source palette cases require independent noise LUT');paletteFixture=JSON.parse(await readFile(palettePath,'utf8'));check(paletteFixture.evidenceKind==='independent-bytecode-palette-and-samila-seam-transcript'&&paletteFixture.jarSha256===jarSha256,'palette provenance mismatch');for(const row of paletteFixture.rows){const bytes=Buffer.alloc(row.lut.values.length*4);row.lut.values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));check(bytes.length===1024*3*4&&sha(bytes)===row.lut.sha256,'palette bytes mismatch');}}
const rows=[];
for(const quad of [false,true]){
 const base={width:48,height:32,point:[0,0],scale:[1,1],offset:[0,0],rotation:0,radius:3,alpha:.4,count:1,passes:1,quad,noiseFrequency:.1,noiseAmplitude:.5,noiseLutScale:1,palette:'white',phase:.7,colorSpeed:.31};
 const add=(name,overrides={})=>rows.push({...base,...overrides,name:(quad?'quad-':'points-')+name});
 for(const radius of [.1,.5,.8,1,1.25,2,3,7.5,32]){add('diameter-'+radius,{radius});add('pixel-center-diameter-'+radius,{radius,offset:[1/48,1/32]});}
 for(const offset of [[1/48,1/32],[.25/48,.75/32],[-.5/48,-.25/32]])add('subpixel-'+offset.join('_'),{offset});
 for(const offset of [[1,0],[1.02,0],[-1.02,0],[0,1.02],[0,-1.02],[1.15,0]])add('clip-'+offset.join('_'),{offset,radius:7.5});
 add('phase-ignored-white',{phase:2.3});add('speed-ignored-ramp',{palette:'ramp',colorSpeed:9});add('baseline-ramp',{palette:'ramp'});add('phase-ignored-ramp',{palette:'ramp',phase:2.3});add('transparent',{alpha:0});add('overlap4',{count:4});add('passes3',{passes:3});
 add('wide',{width:80,height:24,point:[.2,.15],scale:[.8,.6],offset:[.1,-.2],rotation:.4});
 add('tall',{width:24,height:80,point:[.2,.15],scale:[.8,.6],offset:[.1,-.2],rotation:.4});
 for(const point of [[0,0],[.5,-.75],[-.37,.43],[2,-2]]){
  add('direct-color-'+point.join('_'),{point,scale:[.1,.1],offset:[.3,-.2],palette:'ramp'});
  add('fallback-color-'+point.join('_'),{point,scale:[.1,.1],offset:[.3,-.2],palette:'fallback'});
  if(noise)add('lut-color-'+point.join('_'),{point,scale:[.1,.1],offset:[.3,-.2],palette:'ramp',noiseLut:true});
 }
 if(noise)for(const phase of [0,.7,2.3])for(const point of [[0,0],[.5,-.75]])add('source-fallback-'+phase+'-'+point.join('_'),{point,scale:[.5,.5],offset:[.03,-.02],palette:'fallback',noiseLut:true,phase});
 if(paletteFixture)for(const paletteCase of paletteFixture.rows)for(const point of [[0,0],[.5,-.75],[-.37,.43]])add('source-palette-'+paletteCase.name+'-'+point.join('_'),{point,scale:[.5,.5],offset:[.03,-.02],palette:paletteCase.name,paletteCase,noiseLut:true});
 if(noise){for(const offset of [[.13,.17],[.131,.171],[.9,.9]])add('lut-uv-'+offset.join('_'),{offset,palette:'ramp',noiseLut:true});}
}
const report={status:'running',nativeExecution:false,source:{jar,jarSha256,vertexSha256:sha(originals.vertex),fragmentSha256:sha(originals.fragment),oracleVertexSha256:sha(vertex),oracleFragmentSha256:sha(fragment),scriptSha256:sha(await readFile('scripts/build-samila-splat-oracle.mjs')),paletteFixture:palettePath?{path:palettePath,sha256:sha(await readFile(palettePath))}:null,noiseLut:lutPath?{path:lutPath,sha256:sha(await readFile(lutPath)),provenance:noiseProvenance}:null},limits:['Original full shader transplanted from desktop GLSL410 to ES300, with only version/precision and fixed formula-body insertion. This is Chrome/ANGLE, not original JOGL runtime.','Fixed constant formula points bypass random sample differences; no random stream parity claim.','Explicit white/ramp palettes are input fixtures, not a Java PaletteRuntime generator oracle. Noise LUT input, if provided, must have independent provenance.','Both source POINTS and source QUAD are measured separately; this does not infer the original host capability probe choice.','Raw output channels are source [mass, red*mass, green*mass, blue*mass]. Saved normalized ink reorders to [red*mass, green*mass, blue*mass, mass] and flips bottom-up readback to top-down.','Float32 offscreen framebuffer, additive ONE/ONE blend, no MSAA. Point precision/edge rasterization can vary by backend.','Only elapsed wall time is measured; CPU/process-family peak RAM/driver memory unmeasured.']};
const started=performance.now();let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});report.browserVersion=browser.version();const page=await browser.newPage();await page.goto('about:blank');
 const result=await page.evaluate(({vertex,fragment,rows,white,ramp,noise})=>{
  const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false});if(!gl)throw Error('WebGL2 unavailable');if(!gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('EXT_float_blend'))throw Error('float target/blend unavailable');if(!gl.getExtension('OES_texture_float_linear'))throw Error('float LINEAR filtering unavailable');
  const shaders=[],textures=[],buffers=[],programs=[];let framebuffer,vao;
  function check(v,m){if(!v)throw Error(m);}
  const shader=(type,s)=>{const q=gl.createShader(type);shaders.push(q);gl.shaderSource(q,s);gl.compileShader(q);check(gl.getShaderParameter(q,gl.COMPILE_STATUS),gl.getShaderInfoLog(q));return q;};
  const tex=(width,height,internal,layout,data,filter=gl.NEAREST,wrap=gl.CLAMP_TO_EDGE)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,layout,gl.FLOAT,data);return t;};
  try{
   const p=gl.createProgram();programs.push(p);gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));gl.useProgram(p);vao=gl.createVertexArray();gl.bindVertexArray(vao);framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
   const uniform=(name,kind,...values)=>gl[kind](gl.getUniformLocation(p,name),...values);
   const noiseTexture=tex(256,256,gl.R32F,gl.RED,Float32Array.from(noise??Array(65536).fill(0)),gl.LINEAR);
   const paletteTexture=tex(1024,1,gl.RGB32F,gl.RGB,Float32Array.from(white),gl.LINEAR,gl.REPEAT);
   uniform('a','uniform1f',0);uniform('b','uniform1f',0);uniform('c','uniform1f',0);uniform('d','uniform1f',0);uniform('u_generateMode','uniform1i',1);uniform('u_projection','uniform1i',0);uniform('u_frameSeed','uniform1i',123);uniform('u_rangeStart','uniform1f',-1);uniform('u_rangeStop','uniform1f',1);uniform('noiseLUT','uniform1i',0);uniform('paletteLUT','uniform1i',1);
   gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);const results=[];
   for(const spec of rows){
    gl.activeTexture(gl.TEXTURE0);const target=tex(spec.width,spec.height,gl.RGBA32F,gl.RGBA,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'incomplete target');gl.viewport(0,0,spec.width,spec.height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));
    gl.bindTexture(gl.TEXTURE_2D,noiseTexture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,paletteTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1024,1,gl.RGB,gl.FLOAT,Float32Array.from(spec.paletteCase?.lut.values??(spec.palette==='ramp'?ramp:white)));
    uniform('oraclePoint','uniform2f',...spec.point);uniform('scale','uniform2f',...spec.scale);uniform('offset','uniform2f',...spec.offset);uniform('u_rotation','uniform1f',spec.rotation);uniform('radius','uniform1f',spec.radius);uniform('u_quadSplat','uniform1i',spec.quad?1:0);uniform('u_viewportSize','uniform2f',spec.width,spec.height);uniform('u_aspectRatio','uniform1f',spec.width/spec.height);uniform('u_particleCount','uniform1i',spec.count);uniform('alpha','uniform1f',spec.alpha);uniform('noiseFrequency','uniform1f',spec.noiseFrequency);uniform('noiseAmplitude','uniform1f',spec.noiseAmplitude);uniform('noiseLutScale','uniform1f',spec.noiseLutScale);uniform('useNoiseLUT','uniform1i',spec.noiseLut?1:0);uniform('useLUT','uniform1i',spec.palette==='fallback'?0:1);uniform('colorPhase','uniform1f',spec.phase);uniform('colorSpeed','uniform1f',spec.colorSpeed);
    for(let pass=0;pass<spec.passes;pass++)gl.drawArrays(spec.quad?gl.TRIANGLES:gl.POINTS,0,spec.count*(spec.quad?6:1));
    const original=new Float32Array(spec.width*spec.height*4),ink=new Float32Array(original.length);gl.readPixels(0,0,spec.width,spec.height,gl.RGBA,gl.FLOAT,original);check(gl.getError()===gl.NO_ERROR,'GL error '+spec.name);let mass=0,occupied=0,max=0;
    for(let y=0;y<spec.height;y++)for(let x=0;x<spec.width;x++){const src=(y*spec.width+x)*4,dst=((spec.height-1-y)*spec.width+x)*4;ink[dst]=original[src+1];ink[dst+1]=original[src+2];ink[dst+2]=original[src+3];ink[dst+3]=original[src];mass+=original[src];max=Math.max(max,original[src]);if(original[src]>0)occupied++;}check(Array.from(ink).every(Number.isFinite),'nonfinite original ink '+spec.name);results.push({spec,mass,max,occupied,ink:Array.from(ink)});gl.deleteTexture(target);textures.pop();
   }
   const ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),aliasedPointSizeRange:Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)),rows:results};
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);textures.forEach(t=>gl.deleteTexture(t));buffers.forEach(b=>gl.deleteBuffer(b));programs.forEach(p=>gl.deleteProgram(p));shaders.forEach(s=>gl.deleteShader(s));if(framebuffer)gl.deleteFramebuffer(framebuffer);if(vao)gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{vertex,fragment,rows,white,ramp,noise});
 report.selfChecks=[];for(const prefix of ['points','quad']){
  const get=name=>result.rows.find(r=>r.spec.name===prefix+'-'+name),base=get('diameter-3');check(base.mass>0,prefix+' reference coverage blank');
  for(const [name,factor] of [['overlap4',4],['passes3',3]]){const actual=get(name);let maxError=0;for(let i=0;i<base.ink.length;i++)maxError=Math.max(maxError,Math.abs(actual.ink[i]-base.ink[i]*factor));check(maxError<.00002,prefix+' additive self-check '+name);report.selfChecks.push({name:prefix+'-'+name,factor,maxError});}
  for(const [a,b] of [['diameter-3','phase-ignored-white'],['baseline-ramp','speed-ignored-ramp'],['baseline-ramp','phase-ignored-ramp']]){const left=get(a),right=get(b);check(left.ink.every((v,i)=>v===right.ink[i]),prefix+' unused uniform changed LUT color');report.selfChecks.push({name:prefix+'-'+a+'-'+b,exact:true});}
  check(get('transparent').mass===0,prefix+' alpha zero wrote mass');
 }
 report.renderer=result.renderer;report.aliasedPointSizeRange=result.aliasedPointSizeRange;report.rows=[];
 for(const row of result.rows){const bytes=Buffer.alloc(row.ink.length*4);row.ink.forEach((n,i)=>bytes.writeFloatLE(n,i*4));const path=directory+'/'+row.spec.name+'.f32';await writeFile(path,bytes);const{ink,...facts}=row;report.rows.push({...facts,ink:{path,sha256:sha(bytes),bytes:bytes.length,format:'topdown little-endian Float32 RGBA premultiplied-ink'}});}
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close()])).map(r=>({status:r.status,...r.status==='rejected'?{error:String(r.reason)}:{}}));if(report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}report.scriptStable=sha(await readFile('scripts/build-samila-splat-oracle.mjs'))===report.source.scriptSha256;if(!report.scriptStable){report.status='source-changed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/fixture.json',JSON.stringify(report,null,2));await writeFile(directory+'/report.md',`# Original Samila splat shader oracle\n\n${report.status}; ${report.rows?.length??0} cases; ${(report.elapsedMs/1000).toFixed(2)} seconds.\n\n${report.error??''}\n\n${report.limits.map(x=>'- '+x).join('\n')}\n`);console.log(JSON.stringify({status:report.status,directory,cases:report.rows?.length,elapsedMs:report.elapsedMs,error:report.error}));}
