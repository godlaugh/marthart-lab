import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

// Full RGBA8 renderer-boundary comparison, not original Java/JOGL app parity.
// Runtime geometry and camera facts are shared. Python independently derives
// Processing CPU tessellation, F32 matrix scale, and fill/stroke(int) colors.
const core='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=['src/engine/sourceSurfaceOverlay.ts','src/engine/sourceProcessingGeometry.ts','src/engine/sourceSurfaceLineRenderer.ts','src/engine/sourceSurfaceMeshRenderer.ts','src/engine/sourceSurfaceFunction.ts','src/engine/sourceSurfaceMeshGeometry.ts','src/engine/sourceSurfaceMeshRuntime.ts','src/engine/sourceSurfaceMeshConfig.ts','src/engine/sourceSurfaceMeshWireframe.ts','src/engine/sourceSurfaceColor.ts','src/engine/sourceSurfaceGradient.ts','src/engine/sourceCamera.ts','src/engine/ordinarySourceCamera.ts','src/engine/renderer.ts','src/types.ts','scripts/verify-source-surface-mesh-lines.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'CPU mesh runtime and explicit boundary fixtures through ArtRenderer versus shipped Processing Line/Color shaders. Shared geometry and camera inputs; independent Python CPU tessellation and packed color interpretation; complete RGBA8 frames, no MSAA. No public import, native app, JOGL/driver or GPU mesh parity.',unmeasured:['Original native framebuffer','Native MSAA and compositor','GPU time','Agent tokens','Full process-family memory','Public import/playback/export'],adapter:'GLSL 300 es syntax; retained fragment precision; original shader arithmetic unchanged. Default surface hint state: perspective=0, depth bias scale=.9990000128746033; logical viewport dimensions.'};
let server,browser;
try{
 const before=await hashes(),coreHash=hash(await readFile(core));
 if(coreHash!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact identity changed');
 const source=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps({k:z.read('processing/opengl/shaders/'+k+'.glsl').decode() for k in ['LineVert','LineFrag','ColorVert','ColorFrag']}))`,core],{encoding:'utf8'}));
 report.reference={core,coreHash,shaders:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,hash(v)]))};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/mesh-lines-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'mesh-lines-oracle');
 const inputs=await page.evaluate(async()=>{
  const {prepareSourceSurfaceFunction}=await import('/src/engine/sourceSurfaceFunction.ts'),{createSourceSurfaceMeshRuntime}=await import('/src/engine/sourceSurfaceMeshRuntime.ts');
  const {importSourceSurfaceMeshConfig}=await import('/src/engine/sourceSurfaceMeshConfig.ts'),{sourceSurfaceMeshAppearance}=await import('/src/engine/sourceSurfaceMeshRenderer.ts');
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceCameraInitial,prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts');
  const fixtures={cross:[-55,-20,-12,55,20,12,-45,30,15,45,-30,-15],zero:[0,0,0,0,0,0],aligned:[0,0,-20,0,0,20],signedzero:[-0,0,-0,0,-0,0,-40,0,-0,40,-0,0],near:[-10,-8,0,10,8,160],invalid:[-40,-20,0,40,20,0,NaN,0,0,10,10,0,0,0,Infinity,20,20,0,-20,30,0,20,30,0]};
  const cases=[
   {name:'runtime-coupled-fill',runtime:true,fill:true},{name:'runtime-coupled-lines',runtime:true},{name:'runtime-decoupled-fill',runtime:true,fill:true,decoupled:true},
   {name:'runtime-decoupled-lines',runtime:true,decoupled:true},{name:'runtime-fill-display-opacity',runtime:true,fill:true,displayOpacity:.37},{name:'rotated',angles:[.7,-.6,.3]},{name:'orthographic',projection:'scene-fade-orthographic'},
   {name:'offscreen-large',target:'offscreen',width:384,height:256},{name:'logical-viewport-dpr2',dpr:2},{name:'camera-zoom-small',zoom:.125},{name:'camera-zoom-large',zoom:7},{name:'offscreen-small',target:'offscreen',width:48,height:32},{name:'rotated-offscreen-fractional',target:'offscreen',width:263,height:175,angles:[.7,-.6,.3]},
   {name:'reverse-pairs',reverse:true},{name:'zero-length',fixture:'zero',blank:true},{name:'view-aligned',fixture:'aligned',blank:true},{name:'near-plane',fixture:'near'},
   {name:'signed-zero',fixture:'signedzero'},{name:'gray-zero-alpha',packed:0x80},{name:'non-gray-zero-alpha',packed:0x00ff0000,blank:true},
   {name:'partial-alpha',packed:0x4055ddff,clearAlpha:0},{name:'duplicate-alpha',packed:0x4055ddff,clearAlpha:0,duplicate:true},
   {name:'mixed-nonfinite',fixture:'invalid'},{name:'display-opacity',displayOpacity:.37},{name:'wide-lines',lineWidth:13.25},
   {name:'over-16bit',large:true},
   {name:'transition-mid-fill',runtime:true,fill:true,background:0x804080c0,overlay:128},{name:'transition-opaque',runtime:true,fill:true,background:0x804080c0,overlay:255,blank:true},{name:'transition-reset',runtime:true,fill:true,background:0x804080c0,overlay:0},{name:'transition-transparent',background:0x004080c0,overlay:64},
   {name:'source-background',background:0x804080c0},{name:'source-background-gray',background:0x80},{name:'source-background-transparent',background:0x804080c0,transparentBackground:true},
  ];
  window.meshLineFrames=cases.map(c=>{
   const width=c.width??192,height=c.height??128,dpr=c.dpr??1;
   const angles=c.angles??(c.runtime?[.6,.3,0]:[0,0,0]);
   const doc=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Mesh line boundary',equations:{x:'u',y:'v',z:'0'},camera:{phi:angles[0],theta:angles[1],gamma:angles[2]},settings:{u_segments:2,v_segments:2,show_trails:false},timeline:[{type:'wait',duration:1}]})).scene;
   doc.settings.sourceCameraProjection=c.projection??'perspective';doc.settings.opacity=c.displayOpacity??1;doc.settings.transparentBackground=!!c.transparentBackground;
   const camera={...ordinarySourceCameraInitial(doc),zoom:c.zoom??1};
   const frame={model:'mathart-1.7.8-v1',time:0,frameIndex:0,camera,viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:128,target:c.target??'primary',projectionPass:doc.settings.sourceCameraProjection}},plan=prepareOrdinarySourceFrame(frame);
   let geometry={positions:new Float32Array(),triangles:new Uint32Array()},colors=new Uint32Array(),wire;
   if(c.runtime){
    const config=importSourceSurfaceMeshConfig({surface_mode:'mesh',mesh_u_segments:12,mesh_v_segments:9,mesh_wireframe:true,mesh_fill:!!c.fill,mesh_fill_opacity:.65,wireframe_decoupled:!!c.decoupled,wireframe_u_segments:c.decoupled?4:0,wireframe_v_segments:c.decoupled?3:0,u_min:0,u_max:Math.PI*2,v_min:0,v_max:Math.PI*2,scale_x:24,scale_y:24,scale_z:24});
    if(!config.ok)throw Error(JSON.stringify(config.error));
    const prepared=prepareSourceSurfaceFunction({equations:{x:'(2+cos(v))*cos(u)',y:'(2+cos(v))*sin(u)',z:'sin(v)'},parameters:{},scales:[24,24,24],offsets:[0,0,0]});
    const runtime=createSourceSurfaceMeshRuntime({configuration:config.value.configuration,surfaceFunction:prepared.create(),operationsPerPosition:prepared.operations,frameRate:60,palette:{colors:['#2299CC','#DD7722']}});
    runtime.update({frameIndex:0,time:0,deltaTime:0});runtime.display(0);const snapshot=runtime.snapshot();geometry=snapshot.geometry??geometry;colors=snapshot.packedColors;wire=snapshot.wireframe;
    if(!wire||wire.mode!==(c.decoupled?'decoupled':'coupled'))throw Error('Runtime wire mode mismatch '+c.name);
   }else{
    let positions=fixtures[c.fixture??'cross'].slice();
    if(c.reverse)for(let i=0;i<positions.length;i+=6)positions.splice(i,6,...positions.slice(i+3,i+6),...positions.slice(i,i+3));
    if(c.duplicate)positions=[...positions,...positions,...positions];
    if(c.large){positions=[];for(let i=0;i<16385;i++){const y=(i%91)-45;positions.push(-55,y,0,55,y+.125,0);}}
    wire={positions:new Float32Array(positions),packedColor:c.packed??0xff33ccff,lineWidth:c.lineWidth??2.75,mode:'coupled'};
   }
   const output={type:'geometry',topology:'mesh',positions:geometry.positions,indices:geometry.triangles,sourceMeshColors:colors,sourceMeshAppearance:sourceSurfaceMeshAppearance(!!c.fill,.65),sourceMeshWireframe:wire,...(c.background===undefined?{}:{sourceSurfaceBackgroundColor:c.background}),...(c.overlay===undefined?{}:{sourceSurfaceOverlayAlpha:c.overlay}),sourceCameraFrame:frame,stats:{samples:geometry.positions.length/3,generated:geometry.positions.length/3,invalid:0}};
   return{...c,width,height,dpr,doc,output,plan};
  });
  const encode=a=>{let s='';for(const b of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))s+=String.fromCharCode(b);return btoa(s);};
  return window.meshLineFrames.map(c=>({name:c.name,positions:encode(c.output.sourceMeshWireframe.positions),matrix:c.plan.modelView.rowMajor,lineWidth:c.output.sourceMeshWireframe.lineWidth,packed:c.output.sourceMeshWireframe.packedColor,displayOpacity:c.displayOpacity??1,fillPositions:encode(c.output.positions),fillColors:Array.from(c.output.sourceMeshColors),fillAlpha:c.output.sourceMeshAppearance.fillAlphaByte}));
 });
 const baked=JSON.parse(execFileSync('python3',['-c',`import json,sys,struct,base64,math,time,resource
started=time.perf_counter();cpu=time.process_time()
def F(x):
 try:return struct.unpack('<f',struct.pack('<f',x))[0]
 except OverflowError:return math.copysign(math.inf,x)
def unpack(s):
 b=base64.b64decode(s);return struct.unpack('<'+'f'*(len(b)//4),b)
def encode(a,fmt='f'):return base64.b64encode(struct.pack('<'+fmt*len(a),*a)).decode()
def color(p,opacity):
 a=p>>24;rgb=p&0xffffff
 if a==0 and rgb<=255:return [F(rgb/255)]*3+[F(opacity)]
 return [F(((p>>s)&255)/255) for s in [16,8,0]]+[F(F(a/255)*opacity)]
rows=[]
for c in json.load(sys.stdin):
 m=c['matrix'];p=unpack(c['positions']);verts=[];dirs=[];indices=[]
 def xyz(v,r):
  k=r*4;return F(F(F(m[k]*v[0])+F(m[k+1]*v[1]))+F(m[k+2]*v[2]))
 def eye(v):return [F(xyz(v,r)+m[r*4+3]) for r in range(4)]
 det=F(F(F(m[0]*F(F(m[5]*m[10])-F(m[6]*m[9])))+F(m[1]*F(F(m[6]*m[8])-F(m[4]*m[10]))))+F(m[2]*F(F(m[4]*m[9])-F(m[5]*m[8]))))
 scale=F(math.pow(abs(det),0.3333333432674408));half=F(F(F(c['lineWidth'])*scale)/2)
 for i in range(0,len(p),6):
  a=p[i:i+3];b=p[i+3:i+6];base=len(verts)//4
  for start,end,h in [(a,b,half),(a,b,-half),(b,a,-half),(b,a,half)]:
   verts.extend(eye(start));d=[F(end[j]-start[j]) for j in range(3)];dirs.extend([xyz(d,r) for r in range(3)]+[h])
  indices.extend([base,base+1,base+2,base+2,base+1,base+3])
 fp=unpack(c['fillPositions']);fv=[];fc=[]
 for i in range(0,len(fp),3):fv.extend(eye(fp[i:i+3]))
 for packed in c['fillColors']:fc.extend(color((packed&0xffffff)|(c['fillAlpha']<<24),c['displayOpacity']))
 rows.append({'vertices':encode(verts),'directions':encode(dirs),'indices':encode(indices,'I'),'rgba':color(c['packed'],c['displayOpacity']),'transformScale':scale,'fillVertices':encode(fv),'fillColors':encode(fc)})
print(json.dumps({'rows':rows,'oracleCost':{'elapsedMs':(time.perf_counter()-started)*1000,'cpuMs':(time.process_time()-cpu)*1000,'maxRSS':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'maxRSSUnit':'bytes on macOS; KiB on Linux','scope':'Independent Python tessellation plus binary serialization only; includes all fixtures; process peak RSS, no descendants; not production renderer or GPU performance'}}))`],{input:JSON.stringify(inputs),encoding:'utf8',maxBuffer:64*1024*1024}));
 report.oracleCost=baked.oracleCost;
 report.results=await page.evaluate(async({source,baked})=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sourceSurfaceLineBuffers}=await import('/src/engine/sourceSurfaceLineRenderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},decode=(s,T=Float32Array)=>{const a=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new T(a.buffer);};
  const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const shaders=[],buffers=[],programs=[],vaos=[],art=new ArtRenderer(document.createElement('canvas'));
  try{
   const adapt=(text,fragment)=>'#version 300 es\nprecision highp float;\nprecision highp int;\n'+(fragment?'out vec4 oracleFragment;\n':'')+text.replaceAll('attribute ','in ').replaceAll('varying ',fragment?'in ':'out ').replaceAll('gl_FragColor','oracleFragment');
   const program=kind=>{const p=gl.createProgram();programs.push(p);for(const [type,suffix,frag] of [[gl.VERTEX_SHADER,'Vert',false],[gl.FRAGMENT_SHADER,'Frag',true]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,adapt(source[kind+suffix],frag));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
   // Independent full-canvas rectangle, using raw GL and two triangles rather
   // than the production Three.js overlay geometry/material.
   source.OverlayVert='attribute vec2 vertex; void main(){gl_Position=vec4(vertex,0.0,1.0);}';
   source.OverlayFrag='uniform float amount; void main(){gl_FragColor=vec4(0.0,0.0,0.0,amount);}';
   const lineProgram=program('Line'),fillProgram=program('Color'),overlayProgram=program('Overlay');
   const overlayVAO=gl.createVertexArray();vaos.push(overlayVAO);
   const lineVAO=gl.createVertexArray(),fillVAO=gl.createVertexArray();vaos.push(lineVAO,fillVAO);
   const attribute=(p,name,size,values)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);const at=gl.getAttribLocation(p,name);check(at>=0,'missing '+name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,0,0);};
   const indexed=(indices)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_INT,0);};
   const rows=[];
   for(let i=0;i<window.meshLineFrames.length;i++){
    const c=window.meshLineFrames[i],ref=baked.rows[i],out=c.output,wire=out.sourceMeshWireframe,w=c.width*c.dpr,h=c.height*c.dpr;
    const expectedVertices=decode(ref.vertices),expectedDirections=decode(ref.directions),expectedIndices=decode(ref.indices,Uint32Array);
    const begin=performance.now(),production=sourceSurfaceLineBuffers(wire,c.plan),bufferMs=performance.now()-begin;
    const differences=(a,b)=>{check(a.length===b.length,'buffer length mismatch '+c.name);let n=0;for(let j=0;j<a.length;j++)if(!Object.is(a[j],b[j])&&!(Number.isNaN(a[j])&&Number.isNaN(b[j])))n++;return n;};
    if(c.name==='near-plane'){const p=c.plan.projection.columnMajor;const clip=offset=>{const v=expectedVertices.subarray(offset,offset+4);const z=p[2]*v[0]+p[6]*v[1]+p[10]*v[2]+p[14]*v[3],w=p[3]*v[0]+p[7]*v[1]+p[11]*v[2]+p[15]*v[3];return z+w;};check(clip(0)*clip(8)<0,'near-plane fixture must cross the clipping plane');}
    const bufferDifferences={positions:differences(production.positions,expectedVertices),directions:differences(production.directions,expectedDirections),indices:differences(production.indices,expectedIndices)};
    canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);const bg=c.background,gray=bg!==undefined&&(bg>>>24)===0&&(bg&0xffffff)<=255;gl.clearColor(bg===undefined?0:(gray?bg&255:(bg>>>16)&255)/255,bg===undefined?0:(gray?bg&255:(bg>>>8)&255)/255,bg===undefined?0:(bg&255)/255,c.transparentBackground?0:bg===undefined?c.clearAlpha??1:gray?1:(bg>>>24)/255);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(c.fill){gl.bindVertexArray(fillVAO);gl.useProgram(fillProgram);attribute(fillProgram,'position',4,decode(ref.fillVertices));attribute(fillProgram,'color',4,decode(ref.fillColors));gl.uniformMatrix4fv(gl.getUniformLocation(fillProgram,'transformMatrix'),false,c.plan.projection.columnMajor);indexed(out.indices);}
    gl.bindVertexArray(lineVAO);gl.useProgram(lineProgram);attribute(lineProgram,'position',4,expectedVertices);attribute(lineProgram,'direction',4,expectedDirections);
    const colorAt=gl.getAttribLocation(lineProgram,'color');gl.disableVertexAttribArray(colorAt);gl.vertexAttrib4fv(colorAt,ref.rgba);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram,'modelviewMatrix'),false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram,'projectionMatrix'),false,c.plan.projection.columnMajor);
    gl.uniform4f(gl.getUniformLocation(lineProgram,'viewport'),0,0,c.width,c.height);gl.uniform1i(gl.getUniformLocation(lineProgram,'perspective'),0);const bias=Math.fround(.999);gl.uniform3f(gl.getUniformLocation(lineProgram,'scale'),c.projection==='scene-fade-orthographic'?1:bias,c.projection==='scene-fade-orthographic'?1:bias,bias);indexed(expectedIndices);
    if(c.overlay){gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.bindVertexArray(overlayVAO);gl.useProgram(overlayProgram);attribute(overlayProgram,'vertex',2,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));gl.uniform1f(gl.getUniformLocation(overlayProgram,'amount'),c.overlay/255);gl.drawArrays(gl.TRIANGLES,0,6);}
    const expected=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'oracle GL error '+c.name);
    const rt=new THREE.WebGLRenderTarget(w,h),actual=new Uint8Array(expected.length);
    try{
     art.setSize(c.width,c.height,c.dpr);art.setOutput(out,c.doc,false);if(c.background===undefined)art.renderer.setClearColor(0,c.clearAlpha??1);art.renderer.setRenderTarget(rt);art.render();art.renderer.readRenderTargetPixels(rt,0,0,w,h,actual);check(art.renderer.getContext().getError()===0,'production GL error '+c.name);
     if(c.background!==undefined){art.renderer.setRenderTarget(null);art.render();const screen=new Uint8Array(actual.length);art.renderer.getContext().readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,screen);for(let j=0;j<4;j++)check(screen[j]===expected[j],'raw source screen clear color mismatch '+c.name+' channel'+j);}
     if(c.name==='runtime-decoupled-fill'){art.renderer.setRenderTarget(null);art.render();window.meshLinePreview=art.renderer.domElement.toDataURL('image/png');}
    }finally{art.renderer.setRenderTarget(null);rt.dispose();}
    let different=0,maxDelta=0,lit=0;for(let j=0;j<actual.length;j++){const d=Math.abs(actual[j]-expected[j]);if(d){different++;maxDelta=Math.max(maxDelta,d);}if(j%4!==3&&actual[j])lit++;}
    check(c.blank?lit===0:lit>0,'blank expectation '+c.name+' lit='+lit);
    rows.push({name:c.name,width:w,height:h,logicalWidth:c.width,logicalHeight:c.height,dpr:c.dpr,mode:wire.mode,overlayAlpha:c.overlay??0,segments:wire.positions.length/6,expandedVertices:expectedVertices.length/4,transformScale:ref.transformScale,bufferDifferences,bufferGenerationMs:bufferMs,litChannels:lit,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
    for(const b of buffers.splice(0))gl.deleteBuffer(b);
   }
   check(rows.find(r=>r.name==='partial-alpha').actualHash!==rows.find(r=>r.name==='duplicate-alpha').actualHash,'duplicate transparent lines must visibly accumulate');
   return{rows,identical:rows.every(r=>r.differentChannels===0&&Object.values(r.bufferDifferences).every(n=>n===0)),renderer:gl.getParameter(gl.RENDERER),nativeAppParity:false,timingScope:'Single browser CPU buffer-generation calls; elapsed only, mixed cold/warm fixtures; no performance or GPU comparison claim.'};
  }finally{art.dispose();art.renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);for(const p of programs)gl.deleteProgram(p);for(const v of vaos)gl.deleteVertexArray(v);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{source,baked});
 const preview=await page.evaluate(()=>window.meshLinePreview);if(preview)await writeFile('.cache/v2-source-surface-mesh-lines.png',Buffer.from(preview.split(',')[1],'base64'));
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable||!report.results.identical)throw Error('Pixel, tessellation, shader or source-stability check failed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Browser, Vite, renderers, targets and raw WebGL objects closed.';await writeFile('.cache/v2-source-surface-mesh-lines.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,rows:report.results?.rows}));}
