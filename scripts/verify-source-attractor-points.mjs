import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// The oracle loads the retained artifact, never the production shader strings.
// Python independently transcribes the sprite's float instructions. Neither
// path executes the original JVM/JOGL renderer or establishes its framebuffer.
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-attractor-points.mjs').sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const before=await hashes(),jarHash=hash(await readFile(jar));
if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Reference JAR identity changed');
const source=JSON.parse(execFileSync('python3',['-c',`
import zipfile,json,struct,math,sys
F=lambda x:struct.unpack('f',struct.pack('f',x))[0]
p=bytearray(64*64*4)
for y in range(64):
 for x in range(64):
  dx,dy=F(32-x),F(32-y)
  d=F(math.sqrt(F(F(dx*dx)+F(dy*dy))))
  if d>=31: continue
  a=255 if d<29 else F(255+F(-255*F(F(d-29)/2)))
  i=(y*64+x)*4;p[i:i+4]=bytes([255,255,255,int(F(255*F(a/255)))])
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps(dict(vertex=z.read('data/shader/point_vert.glsl').decode(),fragment=z.read('data/shader/point_frag.glsl').decode(),sprite=list(p))))
`,jar],{encoding:'utf8'}));
const report={at:new Date().toISOString(),scope:'Retained desktop shaders adapted to WebGL2 versus production instanced material, complete RGBA8 frames without MSAA. Attractor CPU motion/color runtime snapshots; this is a producer-to-renderer boundary, NOT the public importer or Worker route. Shared delivered camera/uniforms; camera and scalar derivation are separately tested. Not original JVM/native app parity.',reference:{jar,jarHash,vertexHash:hash(source.vertex),fragmentHash:hash(source.fragment),spriteHash:hash(Buffer.from(source.sprite))},adapter:'GLSL 150 -> 300 es; highp float/int to preserve desktop precision intent; identity texMatrix; no arithmetic changes; zero optional lighting uniforms. Processing BLEND uses SRC_ALPHA/ONE_MINUS_SRC_ALPHA for RGB and ONE/ONE for alpha. Native mipmap availability, driver and MSAA remain unverified.'};
// Independent blend-state provenance: bundled Processing BLEND branch,
// PGraphicsOpenGL.blendModeImpl byte offsets 95,98,101,104 -> call at 107.
const core='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const coreHash=hash(await readFile(core));
if(coreHash!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact identity changed');
const blendEvidence=JSON.parse(await readFile('.cache/v2-camera-source/PGraphicsOpenGL.json','utf8'));
const blendClassHash=hash(execFileSync('python3',['-c',"import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('processing/opengl/PGraphicsOpenGL.class'))",core]));
if(blendClassHash!==blendEvidence.classSha256||blendClassHash!=='a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c')throw Error('Processing blend evidence identity mismatch');
const branch=blendEvidence.methods.find(m=>m.name==='blendModeImpl').constant_references.filter(r=>[95,98,101,104,107].includes(r.offset));
if(branch.map(r=>r.reference.split(' ')[1]).join(',')!=='SRC_ALPHA,ONE_MINUS_SRC_ALPHA,ONE,ONE,blendFuncSeparate')throw Error('Retained native blend branch differs');
report.blendReference={core,coreHash,entry:blendEvidence.entry,classHash:blendClassHash,method:'blendModeImpl',branch};
let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/point-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'point-oracle');
 report.results=await page.evaluate(async source=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {SourceAttractorCpuParticles}=await import('/src/engine/sourceAttractorCpuParticles.ts');
  const {importSourceAttractorConfig}=await import('/src/engine/sourceAttractorConfig.ts');
  const {importSourceAttractorVisualConfig}=await import('/src/engine/sourceAttractorVisualConfig.ts');
  const {prepareSourceAttractorEquation}=await import('/src/engine/sourceAttractorEquation.ts');
  const {prepareSourceCamera}=await import('/src/engine/sourceCamera.ts');
  const {sourceParticlePointAppearance}=await import('/src/engine/sourceParticlePointAppearance.ts');
  const {createSourceParticlePoints}=await import('/src/engine/sourceParticlePointRenderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const adapt=s=>s.replace('#version 150','#version 300 es\nprecision highp float;\nprecision highp int;').replaceAll('precision mediump','precision highp');
  const shaders=[],buffers=[];let program,texture;
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,preserveDrawingBuffer:true});
  renderer.setClearColor(0,1);renderer.setPixelRatio(1);renderer.debug.onShaderError=(_gl,_p,v,f)=>{throw Error('Production shader failed: '+_gl.getShaderInfoLog(v)+_gl.getShaderInfoLog(f));};
  try{
   program=gl.createProgram();
   for(const [type,text] of [[gl.VERTEX_SHADER,source.vertex],[gl.FRAGMENT_SHADER,source.fragment]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,adapt(text));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(program,s);}
   gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));gl.useProgram(program);
   texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(source.sprite));
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);
   const attribute=(name,size,data)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,name);check(location>=0,'missing attribute '+name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);};
   const frames=[],cases=[
    {name:'primary',radius:12},{name:'primary-dpr2',radius:12,dpr:2,density:2},
    {name:'export-same-size',radius:12,target:'offscreen'},
    {name:'export-large-density2',radius:12,target:'offscreen',height:256,density:2},
    {name:'export-small',radius:12,target:'offscreen',height:64},
    {name:'negative-radius',radius:-12},{name:'zero-radius',radius:0},
    {name:'translucent-background',radius:12,clearAlpha:.25},
    {name:'translucent-overlap',radius:12,clearAlpha:.25,overlap:true},
    {name:'partially-nonfinite',radius:12,field:{dx:'sqrt(x)',dy:'0',dz:'0'}},
    {name:'all-nonfinite',radius:12,field:{dx:'1/0',dy:'0',dz:'0'},blank:true},
    {name:'opaque-int-gray',radius:12,palette:['128']},
    {name:'transparent-color',radius:12,palette:['#00112233'],blank:true},
    {name:'initial-palette-final-color-single-slot',radius:12,count:1},
    {name:'small-mipmapped',radius:1.68},{name:'large-overlap',radius:32},
    {name:'orthographic',radius:12,projection:'scene-fade-orthographic'},
    {name:'orthographic-negative',radius:-12,projection:'scene-fade-orthographic'},
    {name:'orthographic-export',radius:12,projection:'scene-fade-orthographic',target:'offscreen',height:256,density:2},
    {name:'motion-three-frames',radius:12,frames:3},
    {name:'display-transform',radius:12,settings:{scale_x:1.2,scale_y:.7,scale_z:-1,offset_x:7,offset_y:-4,offset_z:5}},
    {name:'empty',radius:12,count:0,blank:true},
   ];
   const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
   for(const c of cases){
    const height=c.height??128,width=height*1.5,dpr=c.dpr??1,target=c.target??'primary';
    const configuration=take(importSourceAttractorConfig({particle_count_cpu:c.count??9,sub_steps:1,time_step:.1,...c.settings},{warmup_steps:0,bounds:{min_x:c.overlap?0:-35,max_x:c.overlap?0:35,min_y:c.overlap?0:-25,max_y:c.overlap?0:25,min_z:0,max_z:0}})).configuration;
    const visualConfiguration=take(importSourceAttractorVisualConfig({dot_size:c.radius,show_trails:false},c.palette??['#6011CC33','#C04020E0'])).configuration;
    const equation=take(prepareSourceAttractorEquation({equations:c.field??{dx:'1',dy:'2',dz:'-1'},parameters:{}}));
    const owner=new SourceAttractorCpuParticles({configuration,equation,visualConfiguration});
    for(let i=0;i<(c.frames??1);i++)owner.update({frameIndex:i,time:i/30,deltaTime:1/30});
    const snapshot=owner.snapshot();
    const camera=take(prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:128,target,projectionPass:c.projection??'perspective'}));
    check(camera.kind==='known','camera unavailable');const plan=camera.plan,a=sourceParticlePointAppearance(visualConfiguration.points.dotRadius,plan,c.density??1);
    const output={type:'geometry',topology:'points',backend:'cpu',positions:snapshot.positions,colors:snapshot.colors,pointAlphas:snapshot.pointAlphas,sourcePointAppearance:a};
    check(output.colors instanceof Float32Array&&output.pointAlphas instanceof Float32Array,'visual snapshot unavailable');
    let nonfiniteSlots=0;for(let i=0;i<output.positions.length;i+=3)if(![output.positions[i],output.positions[i+1],output.positions[i+2]].every(Number.isFinite))nonfiniteSlots++;
    if(c.name==='partially-nonfinite')check(nonfiniteSlots>0&&nonfiniteSlots<output.positions.length/3,'partial nonfinite fixture coverage');
    if(c.name==='all-nonfinite')check(nonfiniteSlots===output.positions.length/3,'all nonfinite fixture coverage');
    if(c.name==='opaque-int-gray')check(output.colors[0]===Math.fround(128/255)&&output.pointAlphas[0]===1,'Processing tint(int) gray semantics');
    if(c.name==='transparent-color')check(output.pointAlphas.every(a=>a===0),'transparent tint fixture coverage');
    canvas.width=width*dpr;canvas.height=height*dpr;gl.viewport(0,0,canvas.width,canvas.height);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
    gl.clearColor(0,0,0,c.clearAlpha??1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const vertices=[],colors=[],uvs=[],quad=[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];
    for(let i=0;i<output.positions.length/3;i++)for(const uv of quad){vertices.push(...output.positions.slice(i*3,i*3+3),1);colors.push(...output.colors.slice(i*3,i*3+3),output.pointAlphas[i]);uvs.push(...uv);}
    attribute('vertex',4,vertices);attribute('color',4,colors);attribute('texCoord',2,uvs);
    for(const [name,value] of [['projection',plan.projection.columnMajor],['modelview',plan.modelView.columnMajor],['texMatrix',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]]])gl.uniformMatrix4fv(gl.getUniformLocation(program,name),false,value);
    gl.uniform1f(gl.getUniformLocation(program,'radius'),a.radius);gl.uniform1f(gl.getUniformLocation(program,'focalLength'),a.focalLength);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/4);const expected=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'reference GL error');
    const mesh=createSourceParticlePoints(output,plan,1),world=new THREE.Scene(),rt=new THREE.WebGLRenderTarget(canvas.width,canvas.height);world.add(mesh);
    const actual=new Uint8Array(expected.length);
    try{renderer.setClearColor(0,c.clearAlpha??1);renderer.setSize(canvas.width,canvas.height,false);renderer.setRenderTarget(rt);renderer.render(world,new THREE.Camera());renderer.readRenderTargetPixels(rt,0,0,canvas.width,canvas.height,actual);check(renderer.getContext().getError()===0,'production GL error');}
    finally{renderer.setRenderTarget(null);rt.dispose();mesh.geometry.dispose();mesh.material.dispose();}
    let different=0,maxDelta=0,lit=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta){different++;maxDelta=Math.max(delta,maxDelta);}if(i%4!==3&&actual[i])lit++;}
    frames.push({name:c.name,width:canvas.width,height:canvas.height,particles:output.positions.length/3,nonfiniteSlots,appearance:a,litChannels:lit,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
    check(c.radius===0||c.blank?lit===0:lit>0,'unexpected blank/nonblank frame '+c.name);
    if(c.name==='translucent-overlap'){const center=(Math.floor(canvas.height/2)*canvas.width+Math.floor(canvas.width/2))*4;check(expected[center+3]===255,'native additive alpha must saturate for overlapping points');}
   }
   return{frames,publicImportVerified:false,identical:frames.every(f=>f.differentChannels===0),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),nativeAppParity:false};
  }finally{renderer.dispose();renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);if(program)gl.deleteProgram(program);if(texture)gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },source);
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable||!report.results.identical)throw Error('Pixel, shader or source-stability verification failed');
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Renderers, WebGL resources, browser and Vite disposed.';await writeFile('.cache/v2-source-attractor-point-shader.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,frames:report.results?.frames.map(f=>({name:f.name,different:f.differentChannels,maxDelta:f.maxDelta}))}));}
