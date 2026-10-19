import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar',core='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-surface-gpu-mesh.mjs').sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Public import -> actual generation Worker -> ArtRenderer GPU mesh compared against raw WebGL2 using fixed JAR mesh_vert_gpu.glsl/mesh_frag.glsl. Complete RGBA8 frames without MSAA. Topology, authored uniforms, formula body and source camera matrices shared; attribute transport, packed-color interpretation, material defaults, line scale, blend state and draw passes independently supplied. Not native JVM/JOGL app framebuffer parity.',adapter:'GLSL150 -> GLSL300es with highp float/int. Only original placeholder replacement; source vertex/normal attributes independently expanded. Raw oracle uses retained shaders, not production template.',unmeasured:['Native framebuffer, MSAA and driver','Native whole-scene geometry parity','GPU time and process-family memory','Agent tokens']};
let server,browser;
try{
 const before=await hashes(),jarHash=hash(await readFile(jar)),coreHash=hash(await readFile(core));
 if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'||coreHash!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Fixed artifact identity changed');
 const retained=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,hashlib,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 result={k:z.read('data/shader/'+v).decode() for k,v in [('vertex','mesh_vert_gpu.glsl'),('fragment','mesh_frag.glsl')]}
 result['meshClassHash']=hashlib.sha256(z.read('mathart/surface/MeshSurface.class')).hexdigest()
with zipfile.ZipFile(sys.argv[2]) as z:result['blendClassHash']=hashlib.sha256(z.read('processing/opengl/PGraphicsOpenGL.class')).hexdigest()
print(json.dumps(result))`,jar,core],{encoding:'utf8'}));
 if(retained.meshClassHash!=='95a1c0c80e593ba4de21fcbdfb8bfb24dbd034fbebce95d4aed7d2829a412906'||retained.blendClassHash!=='a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c')throw Error('Static draw-state class identity changed');
 report.reference={jar,jarHash,core,coreHash,vertexHash:hash(retained.vertex),fragmentHash:hash(retained.fragment),meshClassHash:retained.meshClassHash,blendClassHash:retained.blendClassHash,topologyTransportEvidence:'MeshSurface.appendFillQuad emits each corner; PGraphicsOpenGL$Tessellator.tessellateTriangles() PC54–68 sequential rawIndices, no shared grid vertices',materialEvidence:'MeshSurface.<init> PC70–137; drawMeshGPU PC277–716,747–843',blendEvidence:'PGraphicsOpenGL.blendModeImpl PC95–107: SRC_ALPHA,ONE_MINUS_SRC_ALPHA,ONE,ONE'};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/gpu-mesh-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'gpu-mesh-oracle');
 report.results=await page.evaluate(async source=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{ordinarySourceViewport,prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},F=Math.fround,digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const art=new ArtRenderer(document.createElement('canvas')),generator=new Generator(),shaders=[],programs=[],buffers=[],vaos=[];
  const adapt=text=>text.replace('#version 150','#version 300 es\nprecision highp float;\nprecision highp int;');
  const program=body=>{const p=gl.createProgram();programs.push(p);for(const [type,text]of [[gl.VERTEX_SHADER,source.vertex.replace('// %SURFACE_FUNCTION_BODY%',body)],[gl.FRAGMENT_SHADER,source.fragment]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,adapt(text));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),'oracle compile '+gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
  const attribute=(p,name,size,data)=>{const location=gl.getAttribLocation(p,name);if(location<0)return;const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);};
  // PShape.fill(int), unlike direct wireframe-color uniform packing.
  const packed=argb=>{const a=argb>>>24,rgb=argb&0xffffff,gray=a===0&&rgb<=255;return[F((gray?rgb:(rgb>>>16)&255)/255),F((gray?rgb:(rgb>>>8)&255)/255),F((rgb&255)/255),F((gray?255:a)/255)];};
  const uniformColor=argb=>[F(((argb>>>16)&255)/255),F(((argb>>>8)&255)/255),F((argb&255)/255),F((argb>>>24)/255)];
  const cases=[
   {name:'fill',settings:{mesh_wireframe:false}},{name:'fill-wire'},{name:'wire-only',settings:{mesh_fill:false}},
   {name:'thin-wire',settings:{mesh_fill:false,mesh_line_weight:.25}},{name:'negative-wire',settings:{mesh_fill:false,mesh_line_weight:-2}},
   {name:'negative-wire-offscreen',target:'offscreen',width:384,height:256,density:2,settings:{mesh_fill:false,mesh_line_weight:-2}},
   {name:'opacity-negative',blank:true,settings:{mesh_wireframe:false,mesh_fill_opacity:-1}},
   {name:'opacity-over-one',settings:{mesh_wireframe:false,mesh_fill_opacity:2}},
   {name:'transparent-fill',settings:{mesh_wireframe:false,mesh_fill_opacity:.23,background_color:'#40203040'}},
   {name:'transparent-wire',settings:{mesh_fill:false,mesh_line_weight:3,mesh_wireframe_color:'#4055DDFF',background_color:'#40203040'}},
   {name:'alpha-zero-wire',blank:true,settings:{mesh_fill:false,mesh_wireframe_color:'#00000080'}},
   {name:'palette-alpha-zero',palette:['#004080C0'],settings:{mesh_wireframe:false}},{name:'palette-alpha-full',palette:['#FF4080C0'],settings:{mesh_wireframe:false}},
   {name:'palette-gray-int',palette:['#00000080'],settings:{mesh_wireframe:false}},
   {name:'decoupled-fill',settings:{wireframe_decoupled:true,wireframe_u_segments:3,wireframe_v_segments:4}},
   {name:'decoupled-wire-empty',blank:true,settings:{mesh_fill:false,wireframe_decoupled:true,wireframe_u_segments:3,wireframe_v_segments:4}},
   {name:'disabled',blank:true,settings:{mesh_fill:false,mesh_wireframe:false}},
   {name:'parameter-baseline',time:.5},{name:'parameter-animated',time:.5,timeline:[{type:'param',duration:1,parameters:{a:{min:1,max:2,step:.2}}},{type:'wait',duration:1}]},
   {name:'rotated',camera:{phi:.7,theta:-.4,gamma:.35}},
   {name:'transformed',settings:{scale_x:22,scale_y:-30,scale_z:14,offset_x:7,offset_y:-8,offset_z:11}},
   {name:'offscreen-large',target:'offscreen',width:384,height:256,density:2},{name:'offscreen-small',target:'offscreen',width:96,height:64},
   {name:'dpr-two',dpr:2,density:2},{name:'orthographic',projection:'scene-fade-orthographic'},
   {name:'nonfinite-formula',equations:{x:'u',y:'v',z:'sqrt(u)'}},
   {name:'torus-seams',equations:{x:'(2+cos(v))*cos(u)',y:'(2+cos(v))*sin(u)',z:'sin(v)'},settings:{u_min:0,u_max:'TWO_PI',v_min:0,v_max:'TWO_PI',scale_x:15,scale_y:15,scale_z:15,mesh_wrap_u:true,mesh_wrap_v:true}},
   {name:'twisted-u',equations:{x:'(2+v*cos(u/2))*cos(u)',y:'(2+v*cos(u/2))*sin(u)',z:'v*sin(u/2)'},settings:{u_min:0,u_max:'TWO_PI',v_min:-.5,v_max:.5,scale_x:20,scale_y:20,scale_z:20,mesh_wrap_u:true}},
  ];
  const frames=[],framebuffer=gl.createFramebuffer(),colorTarget=gl.createTexture(),depthTarget=gl.createRenderbuffer();
  try{
   for(const c of cases){
    const width=c.width??192,height=c.height??128,dpr=c.dpr??1,w=width*dpr,h=height*dpr,target=c.target??'primary';
    const doc=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'GPU mesh oracle',parameters:{a:1},equations:c.equations??{x:'u',y:'v',z:'a*u*v'},camera:c.camera??{phi:.4,theta:.3,gamma:0},palette:c.palette??['#FF2299CC','#FFDD7722'],settings:{surface_mode:'MESH',render_mode:'GPU',mesh_u_segments:9,mesh_v_segments:7,u_min:-1,u_max:1,v_min:-1,v_max:1,scale_x:30,scale_y:30,scale_z:20,speed_u:.8,speed_v:-.4,mesh_fill:true,mesh_wireframe:true,mesh_fill_opacity:.7,mesh_line_weight:1.2,mesh_wireframe_color:'#FFEEEEFF',background_color:'#FF000000',...c.settings},timeline:c.timeline??[{type:'wait',duration:2}]})).scene;
    doc.timeline.fps=8;doc.settings.sourceCameraProjection=c.projection??'perspective';
    const output=await generator.generate(doc,{time:c.time??0,width,height,quality:'preview',sourcePointPixelDensity:c.density??1,sourceViewport:ordinarySourceViewport(doc,width,height,target,128)});
    check(output.type==='geometry'&&output.backend==='webgl2'&&output.positions.length===0&&output.sourceGpuMesh,'missing GPU mesh output '+c.name);
    const frame=output.sourceGpuMesh,plan=prepareOrdinarySourceFrame(output.sourceCameraFrame),p=program(frame.functionBody),vao=gl.createVertexArray();vaos.push(vao);gl.bindVertexArray(vao);gl.useProgram(p);
    canvas.width=w;canvas.height=h;gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindTexture(gl.TEXTURE_2D,colorTarget);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,colorTarget,0);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindRenderbuffer(gl.RENDERBUFFER,depthTarget);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthTarget);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'oracle framebuffer incomplete');gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
    const bg=output.sourceSurfaceBackgroundColor,gray=(bg>>>24)===0&&(bg&0xffffff)<=255,clearColor=gray?[(bg&255)/255,(bg&255)/255,(bg&255)/255,1]:uniformColor(bg);gl.clearColor(...clearColor);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const clear=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,clear);
    for(const [name,value]of [['transform',plan.transform.columnMajor],['modelview',plan.modelView.columnMajor]])gl.uniformMatrix4fv(gl.getUniformLocation(p,name),false,value);
    const f1=(name,value)=>gl.uniform1f(gl.getUniformLocation(p,name),value),i1=(name,value)=>gl.uniform1i(gl.getUniformLocation(p,name),value);
    f1('time',frame.time);gl.uniform3fv(gl.getUniformLocation(p,'surfaceScale'),frame.scale);gl.uniform3fv(gl.getUniformLocation(p,'surfaceOffset'),frame.offset);gl.uniform2fv(gl.getUniformLocation(p,'uLimits'),frame.uLimits);gl.uniform2fv(gl.getUniformLocation(p,'vLimits'),frame.vLimits);gl.uniform2iv(gl.getUniformLocation(p,'isPeriodic'),frame.periodic);gl.uniform2iv(gl.getUniformLocation(p,'isFlowing'),frame.flowing);i1('isTwistedU',Number(frame.twistedU));i1('isTwistedV',Number(frame.twistedV));gl.uniform1fv(gl.getUniformLocation(p,'params[0]'),frame.parameters);
    const authoredLine=c.settings?.mesh_line_weight??1.2;check(frame.lineWeight===Math.max(F(.1),F(authoredLine)),'native lineWeight setter clamp missing');check(frame.fillOpacity===Math.max(0,Math.min(1,F(c.settings?.mesh_fill_opacity??.7))),'native fill-opacity setter clamp missing');
    const lineScale=target==='primary'?1:F(F(Math.sqrt(F(F(height/128)/F(Math.pow(Math.max(1,c.density??1),F(.15))))))*F(1.4));
    f1('meshFillOpacity',frame.fillOpacity);gl.uniform4f(gl.getUniformLocation(p,'meshFillColor'),1,1,1,1);gl.uniform4fv(gl.getUniformLocation(p,'meshWireframeColor'),uniformColor(frame.wireframeColor));f1('wireframeThickness',Math.max(F(.1),F(F(frame.lineWeight)*lineScale)));
    for(const [name,value]of [['wireframeDepthBias',.001],['wireframeFeather',1],['wireframeDistanceScale',1],['wireframeDistanceMin',.35],['wireframeDistanceMax',1],['wireframeFresnelPower',3],['wireframeFresnelStrength',.15],['materialShininess',32]])f1(name,F(value));
    gl.uniform3f(gl.getUniformLocation(p,'materialAmbient'),F(77/255),F(77/255),F(77/255));gl.uniform3f(gl.getUniformLocation(p,'materialSpecular'),1,1,1);gl.uniform3f(gl.getUniformLocation(p,'lightDir'),.5,.5,1);i1('proceduralTextureType',0);i1('useTexture',0);
    const draw=wire=>{
     const vertices=[],normals=[],colors=[];
     for(let i=0;i<frame.triangles.length;i++){const index=frame.triangles[i],at=index*4;vertices.push(frame.seeds[at],frame.seeds[at+1],frame.seeds[at+2],1);normals.push(frame.seeds[at+3],0,0);colors.push(...(wire?[Number(i%3===0),Number(i%3===1),Number(i%3===2),1]:packed(frame.packedColors[index])));}
     attribute(p,'vertex',4,vertices);attribute(p,'normal',3,normals);attribute(p,'color',4,colors);i1('useWireframe',wire?1:0);i1('enableLighting',wire?0:1);const indexBuffer=gl.createBuffer();buffers.push(indexBuffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,Uint32Array.from({length:frame.triangles.length},(_,i)=>i),gl.STATIC_DRAW);gl.drawElements(gl.TRIANGLES,frame.triangles.length,gl.UNSIGNED_INT,0);
    };
    if(frame.fillEnabled)draw(false);if(frame.wireframeEnabled&&!frame.wireframeDecoupled)draw(true);
    const expected=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'oracle GL error '+c.name);
    const rt=new THREE.WebGLRenderTarget(w,h),actual=new Uint8Array(expected.length);
    try{art.setSize(width,height,dpr);art.setOutput(output,doc,false);art.renderer.setRenderTarget(rt);art.render();art.renderer.readRenderTargetPixels(rt,0,0,w,h,actual);check(art.renderer.getContext().getError()===0,'production GL error '+c.name);}finally{art.renderer.setRenderTarget(null);rt.dispose();}
    if(c.name==='torus-seams'){art.render();window.gpuMeshPreview=art.renderer.domElement.toDataURL('image/png');}
    let different=0,maxDelta=0,foreground=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta){different++;maxDelta=Math.max(maxDelta,delta);}if(actual[i]!==clear[i%4])foreground++;}
    const rendererBufferBytes=art.group.children.filter(mesh=>mesh.userData.sourceSurfaceGpuMesh).reduce((sum,mesh)=>sum+Object.values(mesh.geometry.attributes).reduce((n,attribute)=>n+attribute.array.byteLength,0)+(mesh.geometry.index?.array.byteLength??0),0);
    frames.push({name:c.name,width:w,height:h,rendererBufferBytes,seeds:frame.seeds.length/4,triangles:frame.triangles.length/3,periodic:Array.from(frame.periodic),twistedU:frame.twistedU,twistedV:frame.twistedV,lineScale,wireframeDecoupled:frame.wireframeDecoupled,foregroundChannels:foreground,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
    check(c.blank?foreground===0:foreground>0,'blank expectation '+c.name);
    for(const b of buffers.splice(0))gl.deleteBuffer(b);
   }
   const row=name=>frames.find(f=>f.name===name);
   check(row('palette-alpha-zero').actualHash===row('palette-alpha-full').actualHash,'fill must ignore palette alpha');
   check(row('parameter-baseline').actualHash!==row('parameter-animated').actualHash,'parameter uniform animation must visibly change geometry');
   check(row('twisted-u').twistedU,'twisted U fixture must reach native twist shader');
   check(row('torus-seams').periodic.every(Boolean),'torus fixture must reach both seam flags');
   return{frames,identical:frames.every(f=>f.differentChannels===0),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),nativeAppParity:false};
  }finally{gl.deleteFramebuffer(framebuffer);gl.deleteTexture(colorTarget);gl.deleteRenderbuffer(depthTarget);generator.dispose();art.dispose();art.renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);for(const p of programs)gl.deleteProgram(p);for(const v of vaos)gl.deleteVertexArray(v);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },retained);
 const preview=await page.evaluate(()=>window.gpuMeshPreview);if(preview)await writeFile('.cache/v2-source-surface-gpu-mesh-preview.png',Buffer.from(preview.split(',')[1],'base64'));
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable||!report.results.identical)throw Error('Pixel, shader or source stability verification failed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Worker, raw GL resources, production renderer, browser and Vite closed.';await writeFile('.cache/v2-source-surface-gpu-mesh.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,frames:report.results?.frames.map(f=>({name:f.name,different:f.differentChannels,maxDelta:f.maxDelta}))}));}
