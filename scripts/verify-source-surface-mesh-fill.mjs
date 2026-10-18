import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

// CPU mesh fill boundary only. Geometry and camera inputs are shared with the
// retained-shader oracle; CPU modelview baking is independently done in Python.
// No original JVM/JOGL framebuffer or native application parity is implied.
const core='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/engine/sourceProcessingGeometry.ts','src/engine/sourceSurfaceLineRenderer.ts','src/engine/sourceSurfaceMeshRenderer.ts','src/engine/sourceSurfaceFunction.ts','src/engine/sourceSurfaceMeshGeometry.ts','src/engine/sourceSurfaceMeshRuntime.ts','src/engine/sourceSurfaceMeshConfig.ts','src/engine/sourceSurfaceMeshWireframe.ts','src/engine/outputBuffers.ts','src/engine/sourceSurfaceColor.ts','src/engine/sourceSurfaceGradient.ts','src/engine/sourceCamera.ts','src/engine/ordinarySourceCamera.ts','src/engine/renderer.ts','src/types.ts','scripts/verify-source-surface-mesh-fill.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const before=await hashes(),coreHash=hash(await readFile(core));
if(coreHash!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact identity changed');
const source=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps({k:z.read('processing/opengl/shaders/Color'+n+'.glsl').decode() for k,n in [('vertex','Vert'),('fragment','Frag')]}))`,core],{encoding:'utf8'}));
const report={at:new Date().toISOString(),scope:'Source CPU mesh single-object runtime fill through ArtRenderer versus retained Processing Color shaders with independent Python F32 modelview baking. Shared generated geometry/colors/camera facts, RGBA8 complete frames without MSAA. No public mesh import or native app parity.',reference:{core,coreHash,vertexHash:hash(source.vertex),fragmentHash:hash(source.fragment)},adapter:'GLSL attributes/varyings adapted to 300 es, highp float/int; alpha BLEND uses ONE,ONE; no other arithmetic changes.'};
let server,browser;
try{
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/mesh-fill-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'mesh-fill-oracle');
 const inputs=await page.evaluate(async()=>{
  const {prepareSourceSurfaceFunction}=await import('/src/engine/sourceSurfaceFunction.ts'),{createSourceSurfaceMeshRuntime}=await import('/src/engine/sourceSurfaceMeshRuntime.ts');
  const {importSourceSurfaceMeshConfig}=await import('/src/engine/sourceSurfaceMeshConfig.ts'),{sourceSurfaceMeshAppearance}=await import('/src/engine/sourceSurfaceMeshRenderer.ts');
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceCameraInitial,prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts');
  const cases=[{name:'opaque',opacity:1},{name:'translucent',opacity:.9},{name:'additive-alpha',opacity:.2,clearAlpha:0},{name:'zero-fill',opacity:0},{name:'zero-fill-blue',opacity:0,palette:['#0000FF']},{name:'zero-fill-mixed',opacity:0,palette:['#000000','#000080','#FF0000']},{name:'disabled',opacity:1,enabled:false},{name:'rotated',opacity:.4,angles:[.7,-.6,.3]},{name:'orthographic',opacity:.9,projection:'scene-fade-orthographic'},{name:'offscreen-large',opacity:.9,target:'offscreen',width:384,height:256},{name:'reversed-domain',opacity:.9,reverse:true},{name:'invalid-unused-vertices',opacity:.9,invalid:true},{name:'parameter-change',opacity:.9,parameter:.35}];
  window.meshFrames=cases.map(c=>{
   const width=c.width??192,height=c.height??128,phi=c.angles?.[0]??.6,theta=c.angles?.[1]??.3,gamma=c.angles?.[2]??0;
   const doc=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Mesh fill boundary',equations:{x:'u',y:'v',z:'0'},camera:{phi,theta,gamma},settings:{u_segments:2,v_segments:2,show_trails:false},timeline:[{type:'wait',duration:1}]})).scene;
   doc.settings.sourceCameraProjection=c.projection??'perspective';
   const frame={model:'mathart-1.7.8-v1',time:0,frameIndex:0,camera:ordinarySourceCameraInitial(doc),viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:128,target:c.target??'primary',projectionPass:doc.settings.sourceCameraProjection}},plan=prepareOrdinarySourceFrame(frame);
   const config=importSourceSurfaceMeshConfig({surface_mode:'mesh',mesh_u_segments:12,mesh_v_segments:9,mesh_wireframe:false,mesh_fill:c.enabled!==false,mesh_fill_opacity:c.opacity,u_min:c.reverse?Math.PI*2:0,u_max:c.reverse?0:Math.PI*2,v_min:0,v_max:Math.PI*2,scale_x:24,scale_y:24,scale_z:24});
   if(!config.ok)throw Error(JSON.stringify(config.error));
   const prepared=prepareSourceSurfaceFunction({equations:{x:'(2+a+cos(v))*cos(u)',y:'(2+a+cos(v))*sin(u)',z:c.invalid?'sin(v)/u':'sin(v)'},parameters:{a:0},scales:[24,24,24],offsets:[0,0,0]}),fn=prepared.create();
   const runtime=createSourceSurfaceMeshRuntime({configuration:config.value.configuration,surfaceFunction:fn,operationsPerPosition:prepared.operations,frameRate:60,palette:{colors:c.palette??['#0011CC33','#404020E0','#80FFAA00']}});
   runtime.update({frameIndex:0,time:0,deltaTime:0});runtime.display(0);
   if(c.parameter!==undefined)fn.write('a',c.parameter);
   runtime.update({frameIndex:1,time:1/60,deltaTime:1/60});runtime.display(1);
   const snapshot=runtime.snapshot(),geometry=snapshot.geometry??{positions:new Float32Array(),triangles:new Uint32Array()},sourceMeshColors=snapshot.packedColors;
   // This fill-boundary fixture deliberately mixes fill(int) interpretation
   // routes per vertex; it does not claim to validate palette interpolation.
   if(c.name==='zero-fill-mixed')for(let i=0;i<sourceMeshColors.length;i++)sourceMeshColors[i]=[0,0x80,0xff0000][i%3];
   const output={type:'geometry',topology:'mesh',positions:geometry.positions,indices:geometry.triangles,sourceMeshColors,sourceMeshAppearance:sourceSurfaceMeshAppearance(c.enabled!==false,c.opacity),sourceCameraFrame:frame,stats:{samples:108,generated:geometry.positions.length/3,invalid:0}};
   return{...c,width,height,doc,output,plan};
  });
  return window.meshFrames.map(c=>({positions:Array.from(c.output.positions),matrix:c.plan.modelView.rowMajor,colors:Array.from(c.output.sourceMeshColors),opacity:c.opacity}));
 });
 const baked=JSON.parse(execFileSync('python3',['-c',`import json,sys,struct
F=lambda x:struct.unpack('f',struct.pack('f',x))[0]
out=[]
for c in json.load(sys.stdin):
 p,m=c['positions'],c['matrix'];v=[];colors=[]
 for i in range(0,len(p),3):
  # Invalid unused source vertices have no emitted triangle. JSON carries
  # their nonfinite values as null; the placeholder is never drawn.
  if any(x is None for x in p[i:i+3]): v.extend([0,0,0,0]);continue
  for r in range(4):
   k=r*4;v.append(F(F(F(F(p[i]*m[k])+F(p[i+1]*m[k+1]))+F(p[i+2]*m[k+2]))+m[k+3]))
 a=int(F(max(0,min(1,F(c['opacity'])))*255))
 for packed in c['colors']:
  rgb=packed&0xffffff
  colors.extend([F(rgb/255)]*3+[1] if a==0 and rgb<=255 else [F(((rgb>>s)&255)/255) for s in [16,8,0]]+[F(a/255)])
 out.append({'vertices':v,'colors':colors})
print(json.dumps(out))`],{input:JSON.stringify(inputs),encoding:'utf8'}));
 report.results=await page.evaluate(async({source,baked})=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{ArtRenderer}=await import('/src/engine/renderer.ts');
  const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const shaders=[],buffers=[],program=gl.createProgram(),art=new ArtRenderer(document.createElement('canvas'));
  try{
   const adapt=(text,fragment)=>'#version 300 es\nprecision highp float;\nprecision highp int;\n'+(fragment?'out vec4 oracleFragment;\n':'')+text.replaceAll('attribute ','in ').replaceAll('varying ',fragment?'in ':'out ').replaceAll('precision mediump','precision highp').replaceAll('gl_FragColor','oracleFragment');
   for(const [type,text,isFragment] of [[gl.VERTEX_SHADER,source.vertex,false],[gl.FRAGMENT_SHADER,source.fragment,true]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,adapt(text,isFragment));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(program,s);}
   gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));gl.useProgram(program);
   const attribute=(name,size,values)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,name);check(at>=0,'missing '+name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,0,0);};
   const rows=[];
   for(let index=0;index<window.meshFrames.length;index++){
    const c=window.meshFrames[index],out=c.output,vertices=[],colors=[];
    for(const id of out.indices){vertices.push(...baked[index].vertices.slice(id*4,id*4+4));colors.push(...baked[index].colors.slice(id*4,id*4+4));}
    canvas.width=c.width;canvas.height=c.height;gl.viewport(0,0,c.width,c.height);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
    gl.clearColor(0,0,0,c.clearAlpha??1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    attribute('position',4,vertices);attribute('color',4,colors);gl.uniformMatrix4fv(gl.getUniformLocation(program,'transformMatrix'),false,c.plan.projection.columnMajor);
    if(c.enabled!==false)gl.drawArrays(gl.TRIANGLES,0,vertices.length/4);
    const expected=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'oracle GL error');
    const rt=new THREE.WebGLRenderTarget(c.width,c.height),actual=new Uint8Array(expected.length);
    try{
     art.setSize(c.width,c.height,1);art.setOutput(out,c.doc,false);art.renderer.setClearColor(0,c.clearAlpha??1);art.renderer.setRenderTarget(rt);art.render();art.renderer.readRenderTargetPixels(rt,0,0,c.width,c.height,actual);check(art.renderer.getContext().getError()===0,'production GL error');
     if(c.name==='rotated'){art.renderer.setRenderTarget(null);art.render();window.meshPreview=art.renderer.domElement.toDataURL('image/png');}
    }finally{art.renderer.setRenderTarget(null);rt.dispose();}
    let different=0,maxDelta=0,lit=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d){different++;maxDelta=Math.max(maxDelta,d);}if(i%4!==3&&actual[i])lit++;}
    check(c.name==='zero-fill'||c.enabled===false?lit===0:lit>0,'blank expectation '+c.name);
    rows.push({name:c.name,width:c.width,height:c.height,vertices:out.positions.length/3,triangles:out.indices.length/3,litChannels:lit,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
   }
   return{rows,identical:rows.every(r=>r.differentChannels===0),renderer:gl.getParameter(gl.RENDERER),nativeAppParity:false};
  }finally{art.dispose();art.renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{source,baked});
 const preview=await page.evaluate(()=>window.meshPreview);if(preview)await writeFile('.cache/v2-source-surface-mesh-fill.png',Buffer.from(preview.split(',')[1],'base64'));
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable||!report.results.identical)throw Error('Pixel, shader or source-stability check failed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Browser, Vite, renderers, targets and raw WebGL objects closed.';await writeFile('.cache/v2-source-surface-mesh-fill.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,rows:report.results?.rows}));}
