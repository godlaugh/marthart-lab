import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-surface-gpu-points.mjs').sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Public source import and real generation Worker -> ArtRenderer GPU point path against raw WebGL2 using retained point_vert_gpu.glsl/point_frag.glsl; complete RGBA8 framebuffer comparison without MSAA. Delivered seed/uniform/camera facts and generated mathematical body are shared. Expression conversion has separate source-derived tests. This is not the original JVM/JOGL app framebuffer.',adapter:'GLSL 150 -> 300 es; highp float/int (desktop precision intent); source body placeholder injection; identity texMatrix. Original shader arithmetic retained; Processing BLEND uses SRC_ALPHA/ONE_MINUS_SRC_ALPHA for RGB and ONE/ONE for alpha. Raw oracle expands vertex/normal/color/UV input arrays while production uses instanced seeds.',unmeasured:['Original native framebuffer, driver, MSAA, compositor','GPU execution cost','Process-family memory and CPU time','Agent tokens']};
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
  if d>=31:continue
  a=255 if d<29 else F(255+F(-255*F(F(d-29)/2)))
  i=(y*64+x)*4;p[i:i+4]=bytes([255,255,255,int(F(255*F(a/255)))])
with zipfile.ZipFile(sys.argv[1]) as z:print(json.dumps(dict(vertex=z.read('data/shader/point_vert_gpu.glsl').decode(),fragment=z.read('data/shader/point_frag.glsl').decode(),sprite=list(p))))
`,jar],{encoding:'utf8'}));
 report.reference={jar,jarHash,vertexHash:hash(source.vertex),fragmentHash:hash(source.fragment),spriteHash:hash(Buffer.from(source.sprite))};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/gpu-point-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'gpu-point-oracle');
 report.results=await page.evaluate(async source=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {sourceTextureAnisotropy}=await import('/src/engine/sourceProcessingTextureSampling.ts');
  const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const {ordinarySourceViewport,prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const adapt=s=>s.replace('#version 150','#version 300 es\nprecision highp float;\nprecision highp int;').replaceAll('precision mediump','precision highp');
  const shaders=[],buffers=[],programs=[],vaos=[];let texture;
  const generator=new Generator(),art=new ArtRenderer(document.createElement('canvas'));
  const programFor=(body,expectFailure=false)=>{
   const p=gl.createProgram();programs.push(p);let failure='';
   for(const [type,text] of [[gl.VERTEX_SHADER,source.vertex.replace('// %SURFACE_FUNCTION_BODY%',body)],[gl.FRAGMENT_SHADER,source.fragment]]){
    const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,adapt(text));gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){failure=gl.getShaderInfoLog(s);if(!expectFailure)throw Error('Oracle shader failed: '+failure);break;}gl.attachShader(p,s);
   }
   if(failure)return{program:p,failure};gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return{program:p};
  };
  try{
   texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(source.sprite));
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);const filtering=sourceTextureAnisotropy(gl);if(filtering)gl.texParameterf(gl.TEXTURE_2D,filtering.parameter,filtering.maximum);
   const attribute=(program,name,size,data)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,name);check(location>=0,'missing attribute '+name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);};
   const frames=[],cases=[
    {name:'nonperiodic-start',time:0},{name:'nonperiodic-moving',time:1.125},
    {name:'wrap',time:1.125,settings:{periodic_u:true,periodic_v:true}},
    {name:'wrap-negative',time:1.125,settings:{periodic_u:true,periodic_v:true,speed_u:-2.7,speed_v:-1.95}},
    {name:'pingpong',time:1.125,settings:{periodic_u:true,periodic_v:true,flowing_u:false,flowing_v:false}},
    {name:'mixed-wrap-pingpong',time:1.125,settings:{periodic_u:true,periodic_v:true,flowing_v:false}},
    {name:'narrow-domain',time:1,blank:true,settings:{u_min:0,u_max:.000001,periodic_u:true,periodic_v:true}},
    {name:'parameter-changed',time:0,parameters:{a:1.7}},
    {name:'parameter-baseline',time:.5},
    {name:'parameter-animated',time:.5,timeline:[{type:'param',duration:1,parameters:{a:{min:1,max:1.7,step:.12}}},{type:'wait',duration:3}]},
    {name:'transparent-palette',time:0,palette:['#4000FF88','#808822FF'],settings:{background_color:'#00203040'}},
    {name:'translucent-background',time:0,palette:['#4011CC33','#404020E0'],settings:{background_color:'#40203040'}},
    {name:'translucent-overlap',time:0,palette:['#2011CC33','#304020E0'],equations:{x:'0',y:'0',z:'0'},settings:{background_color:'#40203040'}},
    {name:'partially-nonfinite-formula',time:0,equations:{x:'sqrt(u)',y:'v',z:'0'}},
    {name:'transforms',time:.375,settings:{scale_x:22.5,scale_y:-31.25,scale_z:9.1,offset_x:9.75,offset_y:-6.25,offset_z:12.5}},
    {name:'camera-rotated',time:.375,camera:{phi:.6,theta:-.4,gamma:.2}},
    {name:'offscreen-large',time:.375,target:'offscreen',height:256,density:2},
    {name:'offscreen-small',time:.375,target:'offscreen',height:64},
    {name:'density-two',time:.375,dpr:2,density:2},
    {name:'orthographic',time:.375,projection:'scene-fade-orthographic'},
    {name:'negative-radius',time:0,radius:-12},{name:'zero-radius',time:0,radius:0,blank:true},
    {name:'small-mipmapped',time:0,radius:1.68},{name:'overlap',time:0,radius:30},
   ];
   let failureFixture;
   for(const c of cases){
    const height=c.height??128,width=height*1.5,dpr=c.dpr??1,target=c.target??'primary';
    const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'GPU point oracle',parameters:c.parameters??{a:1},equations:c.equations??{x:'a*u',y:'v',z:'u*.3'},camera:c.camera??{phi:0,theta:0,gamma:0},palette:c.palette??['#6011CC33','#C04020E0'],settings:{u_segments:5,v_segments:4,u_min:-1,u_max:1,v_min:-.8,v_max:.8,scale_x:30,scale_y:30,scale_z:30,speed_u:.7,speed_v:-.45,dot_size:c.radius??12,surface_mode:'POINTS',render_mode:'GPU',show_trails:false,background_color:'#FF000000',...c.settings},timeline:c.timeline??[{type:'wait',duration:4}]})).scene;
    scene.timeline.fps=8;scene.settings.sourceCameraProjection=c.projection??'perspective';
    const output=await generator.generate(scene,{time:c.time,width,height,quality:'preview',sourcePointPixelDensity:c.density??1,sourceViewport:ordinarySourceViewport(scene,width,height,target,128)});
    check(output.type==='geometry'&&output.backend==='webgl2'&&output.sourceGpuPoints&&output.positions.length===0,'missing genuine GPU output '+c.name);
    const plan=prepareOrdinarySourceFrame(output.sourceCameraFrame),a=output.sourcePointAppearance,gpu=output.sourceGpuPoints;
    check(gpu.seeds.length===80&&gpu.tint.length===80&&gpu.parameters.length===32,'GPU ABI '+c.name);
    if(c.name==='parameter-animated')check(gpu.parameters[0]>1&&gpu.parameters[0]<1.7,'parameter animation did not reach uniform');
    const {program}=programFor(gpu.functionBody);gl.useProgram(program);const vao=gl.createVertexArray();vaos.push(vao);gl.bindVertexArray(vao);
    canvas.width=width*dpr;canvas.height=height*dpr;gl.viewport(0,0,canvas.width,canvas.height);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
    const bg=output.sourceBackgroundColor,gray=(bg>>>24)===0&&(bg&0xffffff)<=255;gl.clearColor((gray?bg&255:(bg>>>16)&255)/255,(gray?bg&255:(bg>>>8)&255)/255,(bg&255)/255,gray?1:(bg>>>24)/255);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const clear=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,clear);
    const vertices=[],normals=[],colors=[],uvs=[],quad=[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];
    for(let i=0;i<gpu.seeds.length;i+=4)for(const uv of quad){vertices.push(gpu.seeds[i],gpu.seeds[i+1],gpu.seeds[i+2],1);normals.push(gpu.seeds[i+3],0,0);colors.push(...gpu.tint.slice(i,i+4));uvs.push(...uv);}
    attribute(program,'vertex',4,vertices);attribute(program,'normal',3,normals);attribute(program,'color',4,colors);attribute(program,'texCoord',2,uvs);
    for(const [name,value] of [['projection',plan.projection.columnMajor],['modelview',plan.modelView.columnMajor],['texMatrix',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]]])gl.uniformMatrix4fv(gl.getUniformLocation(program,name),false,value);
    gl.uniform1f(gl.getUniformLocation(program,'radius'),a.radius);gl.uniform1f(gl.getUniformLocation(program,'focalLength'),a.focalLength);gl.uniform1f(gl.getUniformLocation(program,'time'),gpu.time);
    for(const [name,value] of [['surfaceScale',gpu.scale],['surfaceOffset',gpu.offset]])gl.uniform3fv(gl.getUniformLocation(program,name),value);
    gl.uniform1fv(gl.getUniformLocation(program,'params[0]'),gpu.parameters);
    for(const [name,value] of [['uLimits',gpu.uLimits],['vLimits',gpu.vLimits]])gl.uniform2fv(gl.getUniformLocation(program,name),value);
    gl.uniform2iv(gl.getUniformLocation(program,'isPeriodic'),gpu.periodic);gl.uniform2iv(gl.getUniformLocation(program,'isFlowing'),gpu.flowing);gl.uniform1i(gl.getUniformLocation(program,'fadePoints'),gpu.fadePoints?1:0);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/4);const expected=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'reference GL error '+c.name);
    const rt=new THREE.WebGLRenderTarget(canvas.width,canvas.height),actual=new Uint8Array(expected.length);
    try{art.setSize(width,height,dpr);art.setOutput(output,scene,false);art.renderer.setRenderTarget(rt);art.render();art.renderer.readRenderTargetPixels(rt,0,0,canvas.width,canvas.height,actual);check(art.renderer.getContext().getError()===0,'production GL error '+c.name);}
    finally{art.renderer.setRenderTarget(null);rt.dispose();}
    let different=0,maxDelta=0,foreground=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta){different++;maxDelta=Math.max(delta,maxDelta);}if(actual[i]!==clear[i%4])foreground++;}
    frames.push({name:c.name,width:canvas.width,height:canvas.height,logicalWidth:width,logicalHeight:height,dpr,time:gpu.time,particles:gpu.seeds.length/4,parameters:Array.from(gpu.parameters),periodic:Array.from(gpu.periodic),flowing:Array.from(gpu.flowing),appearance:a,foregroundChannels:foreground,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
    check(c.blank?foreground===0:foreground>0,'unexpected blank/nonblank frame '+c.name);
    if(c.name==='translucent-overlap'){const center=(Math.floor(canvas.height/2)*canvas.width+Math.floor(canvas.width/2))*4;check(expected[center+3]===255,'native additive alpha must saturate for overlapping points');}
    if(c.name==='nonperiodic-start')failureFixture={output,scene};
    for(const b of buffers.splice(0))gl.deleteBuffer(b);
   }
   const get=name=>frames.find(f=>f.name===name);
   for(const [left,right] of [['nonperiodic-start','nonperiodic-moving'],['nonperiodic-moving','wrap'],['wrap','pingpong'],['nonperiodic-start','parameter-changed'],['parameter-baseline','parameter-animated']])check(get(left).actualHash!==get(right).actualHash,'fixture did not exercise visible difference '+left+' / '+right);
   const invalidBody='return vec3(sourceGpuUndefinedSymbol);',rawFailure=programFor(invalidBody,true).failure;
   check(rawFailure?.includes('sourceGpuUndefinedSymbol'),'oracle did not expose compile diagnostic');
   const brokenArt=new ArtRenderer(document.createElement('canvas')),brokenGl=brokenArt.renderer.getContext(),live=new Map();let productionFailure='',recoveredHash='',recoveryError='';
   // Count resource ownership before context loss: forcing loss alone would
   // conceal abandoned compile-failure shaders. Include valid recovery usage.
   for(const kind of ['Program','Shader','Buffer','Texture','VertexArray','Framebuffer','Renderbuffer']){
    const resources=new Set(),create=brokenGl['create'+kind].bind(brokenGl),remove=brokenGl['delete'+kind].bind(brokenGl);live.set(kind,resources);
    brokenGl['create'+kind]=(...args)=>{const object=create(...args);if(object)resources.add(object);return object;};
    brokenGl['delete'+kind]=object=>{resources.delete(object);return remove(object);};
   }
   try{
    brokenArt.setSize(192,128,1);
    try{brokenArt.setOutput({...failureFixture.output,sourceGpuPoints:{...failureFixture.output.sourceGpuPoints,functionBody:invalidBody}},failureFixture.scene,false);}catch(error){productionFailure=String(error);}
    check(productionFailure.includes('sourceGpuUndefinedSymbol')&&productionFailure.includes('编译或链接失败'),'production shader error swallowed or lost diagnostic');
    const target=new THREE.WebGLRenderTarget(192,128),pixels=new Uint8Array(192*128*4);
    try{brokenArt.setOutput(failureFixture.output,failureFixture.scene,false);brokenArt.renderer.setRenderTarget(target);brokenArt.render();brokenArt.renderer.readRenderTargetPixels(target,0,0,192,128,pixels);recoveredHash=await digest(pixels);const glError=brokenGl.getError();check(glError===0,'GPU error after recovery: '+glError);}catch(error){recoveryError=String(error);}finally{brokenArt.renderer.setRenderTarget(null);target.dispose();}
   }finally{brokenArt.dispose();}
   const outstanding=Object.fromEntries([...live].map(([kind,objects])=>[kind,objects.size]));brokenArt.renderer.forceContextLoss();
   const recovery={recoveredHash,expectedHash:get('nonperiodic-start').actualHash,error:recoveryError,outstandingBeforeContextLoss:outstanding,passed:recoveredHash===get('nonperiodic-start').actualHash&&!recoveryError&&Object.values(outstanding).every(n=>n===0)};
   return{frames,identical:frames.every(f=>f.differentChannels===0),shaderFailure:{fixture:'Malformed transported shader body, not imported valid formula',oracle:rawFailure,production:productionFailure,recovery},renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),nativeAppParity:false};
  }finally{generator.dispose();art.dispose();art.renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);for(const p of programs)gl.deleteProgram(p);for(const v of vaos)gl.deleteVertexArray(v);if(texture)gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },source);
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable||!report.results.identical||!report.results.shaderFailure.recovery.passed)throw Error('Pixel, shader or source-stability verification failed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Generator Worker, production renderers, raw GL resources, browser and Vite disposed.';await writeFile('.cache/v2-source-surface-gpu-points.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,frames:report.results?.frames.map(f=>({name:f.name,different:f.differentChannels,maxDelta:f.maxDelta}))}));}
