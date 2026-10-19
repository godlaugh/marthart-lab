import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';
const hash=b=>createHash('sha256').update(b).digest('hex');
const core='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const paths=['src/engine/sourceProcessingLineRenderer.ts','src/engine/sourceProcessingGeometry.ts','src/engine/sourceCamera.ts','scripts/verify-source-particle-trail-lines.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Indexed CPU particle trail production boundary versus independent Python F32 tessellation and shipped Processing Line shaders; full RGBA8 frames, no MSAA. Shared prepared camera facts. No original JVM/JOGL/native app, public integration, history-owner or original complete-image claim.',unmeasured:['GPU time','Process-family memory','Agent tokens','Native runtime parity','Public playback/export']};
let server,browser;
try{
 const before=await hashes(),coreHash=hash(await readFile(core));
 if(coreHash!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact identity changed');
 const source=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps({k:z.read('processing/opengl/shaders/'+k+'.glsl').decode() for k in ['LineVert','LineFrag']}))`,core],{encoding:'utf8'}));
 report.reference={core,coreHash,shaders:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,hash(v)]))};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/trail-lines-oracle',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'trail-lines-oracle');
 const inputs=await page.evaluate(async()=>{
  const {prepareSourceCamera}=await import('/src/engine/sourceCamera.ts');
  const cases=[{name:'indexed-rgba'},{name:'reverse',reverse:true},{name:'duplicate-alpha',duplicate:true},{name:'opacity',opacity:.37},{name:'sharp-corner',sharp:true},{name:'zero-length',zero:true,blank:true},{name:'view-aligned',aligned:true,blank:true},{name:'near-plane',near:true},{name:'rotated',rotation:true},{name:'orthographic',ortho:true},{name:'offscreen-large',width:384,height:256,target:'offscreen'},{name:'offscreen-small',width:48,height:32,target:'offscreen'},{name:'logical-dpr2',dpr:2},{name:'depth-occluded-overlay',depthZero:true},{name:'wide',lineWidth:13.25},{name:'over-16bit',large:true},{name:'empty',empty:true,blank:true}];
  window.trailLineCases=cases.map(c=>{
   const width=c.width??192,height=c.height??128,dpr=c.dpr??1;
   const prepared=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:128,target:c.target??'primary',projectionPass:c.ortho?'scene-fade-orthographic':'perspective'});
   if(!prepared.ok||prepared.value.kind!=='known')throw Error('camera failed');const plan={...prepared.value.plan};
   // Use an exact synthetic eye-axis transform for degeneracy/near-plane
   // witnesses; source defaults rotate world Z away from the viewing axis.
   if(c.aligned||c.near)plan.modelView={...plan.modelView,rowMajor:[1,0,0,0,0,1,0,0,0,0,1,-100,0,0,0,1]};
   if(c.rotation){const m=plan.modelView.rowMajor.slice(),angle=.63,cs=Math.fround(Math.cos(angle)),sn=Math.fround(Math.sin(angle));m[0]=cs;m[1]=-sn;m[4]=sn;m[5]=cs;plan.modelView={...plan.modelView,rowMajor:m};}
   let p=c.sharp?[-50,-20,0,0,35,0,45,-30,0]:[-55,-20,-12,55,20,12,-45,30,15,45,-30,-15];
   let indices=c.sharp?[0,1,1,2]:[0,1,2,3];
   if(c.zero){p=[0,0,0,0,0,0];indices=[0,1];}if(c.aligned){p=[0,0,-20,0,0,20];indices=[0,1];}
   if(c.near){p=[-10,-8,0,10,8,160];indices=[0,1];}
   if(c.reverse)indices=indices.flatMap((v,i,a)=>i%2?[]:[a[i+1],v]);
   if(c.duplicate)indices=[...indices,...indices,...indices];
   if(c.large){p=[];indices=[];for(let i=0;i<16385;i++){const y=i%91-45;p.push(-55,y,0,55,y+.125,0);indices.push(i*2,i*2+1);}}
   if(c.empty){p=[];indices=[];}
   const colors=new Float32Array(p.length),alphas=new Float32Array(p.length/3);for(let i=0;i<alphas.length;i++){colors.set(i%2?[.1234567,.5,.9]:[1,.2,.05],i*3);alphas[i]=i%2?.3:.7;}
   const trails={positions:new Float32Array(p),colors,alphas,indices:new Uint32Array(indices),particleIds:new Uint32Array(alphas.length),records:2,oldestTime:0};
   return {...c,width,height,dpr,plan,trails,lineWidth:c.lineWidth??2.75,opacity:c.opacity??1};
  });
  const encode=a=>{let s='';for(const b of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))s+=String.fromCharCode(b);return btoa(s);};
  return window.trailLineCases.map(c=>({positions:encode(c.trails.positions),colors:encode(c.trails.colors),alphas:encode(c.trails.alphas),indices:encode(c.trails.indices),matrix:c.plan.modelView.rowMajor,width:c.lineWidth,opacity:c.opacity}));
 });
 const baked=JSON.parse(execFileSync('python3',['-c',`import json,sys,struct,base64,math
def F(x):
 try:return struct.unpack('<f',struct.pack('<f',x))[0]
 except OverflowError:return math.copysign(math.inf,x)
def unpack(s,t='f'):
 b=base64.b64decode(s);return struct.unpack('<'+t*(len(b)//4),b)
def encode(a,t='f'):return base64.b64encode(struct.pack('<'+t*len(a),*a)).decode()
rows=[]
for c in json.load(sys.stdin):
 m=c['matrix'];p=unpack(c['positions']);colors=unpack(c['colors']);alphas=unpack(c['alphas']);pairs=unpack(c['indices'],'I');verts=[];dirs=[];rgba=[];indices=[]
 def xyz(v,r):
  k=r*4;return F(F(F(m[k]*v[0])+F(m[k+1]*v[1]))+F(m[k+2]*v[2]))
 def eye(v):return [F(xyz(v,r)+m[r*4+3]) for r in range(4)]
 det=F(F(F(m[0]*F(F(m[5]*m[10])-F(m[6]*m[9])))+F(m[1]*F(F(m[6]*m[8])-F(m[4]*m[10]))))+F(m[2]*F(F(m[4]*m[9])-F(m[5]*m[8]))))
 half=F(F(F(c['width'])*F(math.pow(abs(det),0.3333333432674408)))/2)
 for i in range(0,len(pairs),2):
  a,b=pairs[i:i+2];base=len(verts)//4
  for start,end,h in [(a,b,half),(a,b,-half),(b,a,-half),(b,a,half)]:
   av=p[start*3:start*3+3];bv=p[end*3:end*3+3];verts.extend(eye(av));d=[F(bv[j]-av[j]) for j in range(3)];dirs.extend([xyz(d,r) for r in range(3)]+[h]);rgba.extend(list(colors[start*3:start*3+3])+[F(alphas[start]*c['opacity'])])
  indices.extend([base,base+1,base+2,base+2,base+1,base+3])
 rows.append({'position':encode(verts),'direction':encode(dirs),'color':encode(rgba),'indices':encode(indices,'I')})
print(json.dumps(rows))`],{input:JSON.stringify(inputs),encoding:'utf8',maxBuffer:64*1024*1024}));
 report.results=await page.evaluate(async({source,baked})=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{createSourceParticleTrailLines}=await import('/src/engine/sourceProcessingLineRenderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},decode=(s,T=Float32Array)=>new T(Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer);
  const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});check(gl,'WebGL2 unavailable');
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,premultipliedAlpha:false}),shaders=[],buffers=[],program=gl.createProgram(),vao=gl.createVertexArray();renderer.autoClear=false;
  try{
   for(const [type,name,fragment] of [[gl.VERTEX_SHADER,'LineVert',false],[gl.FRAGMENT_SHADER,'LineFrag',true]]){
    const shader=gl.createShader(type);shaders.push(shader);const adapted='#version 300 es\nprecision highp float;\nprecision highp int;\n'+(fragment?'out vec4 oracleFragment;\n':'')+source[name].replaceAll('attribute ','in ').replaceAll('varying ',fragment?'in ':'out ').replaceAll('gl_FragColor','oracleFragment');
    gl.shaderSource(shader,adapted);gl.compileShader(shader);check(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
   }
   gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
   const rows=[];
   for(let i=0;i<window.trailLineCases.length;i++){
    const c=window.trailLineCases[i],ref=baked[i],w=c.width*c.dpr,h=c.height*c.dpr,mesh=createSourceParticleTrailLines(c.trails,c.lineWidth,c.plan,c.opacity),rt=new THREE.WebGLRenderTarget(w,h),actual=new Uint8Array(w*h*4),expected=new Uint8Array(actual.length),bufferDifferences={};
    try{
     canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);gl.bindVertexArray(vao);gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);gl.clearDepth(c.depthZero?0:1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.depthMask(false);
     for(const name of ['position','direction','color']){
      const values=decode(ref[name]),produced=mesh.geometry.getAttribute(name).array;check(produced.length===values.length,'length '+c.name);bufferDifferences[name]=0;for(let j=0;j<values.length;j++)if(!Object.is(values[j],produced[j]))bufferDifferences[name]++;
      const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,0,0);
     }
     const indices=decode(ref.indices,Uint32Array),produced=mesh.geometry.index.array;bufferDifferences.indices=0;check(produced.length===indices.length,'index length');for(let j=0;j<indices.length;j++)if(produced[j]!==indices[j])bufferDifferences.indices++;
     if(c.near){const p=c.plan.projection.columnMajor,v=decode(ref.position),clip=o=>(p[2]+p[3])*v[o]+(p[6]+p[7])*v[o+1]+(p[10]+p[11])*v[o+2]+(p[14]+p[15])*v[o+3];check(clip(0)*clip(8)<0,'near plane witness');}
     const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
     gl.uniformMatrix4fv(gl.getUniformLocation(program,'modelviewMatrix'),false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));gl.uniformMatrix4fv(gl.getUniformLocation(program,'projectionMatrix'),false,c.plan.projection.columnMajor);gl.uniform4f(gl.getUniformLocation(program,'viewport'),0,0,c.width,c.height);gl.uniform1i(gl.getUniformLocation(program,'perspective'),0);const bias=Math.fround(.999);gl.uniform3f(gl.getUniformLocation(program,'scale'),c.ortho?1:bias,c.ortho?1:bias,bias);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_INT,0);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,expected);check(gl.getError()===0,'oracle GL error');
     renderer.setSize(c.width,c.height,false);renderer.setRenderTarget(rt);renderer.setClearColor(0,0);renderer.clear();if(c.depthZero){const actualGL=renderer.getContext();actualGL.clearDepth(0);actualGL.clear(actualGL.DEPTH_BUFFER_BIT);actualGL.clearDepth(1);}
     const scene=new THREE.Scene();scene.add(mesh);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(rt,0,0,w,h,actual);check(renderer.getContext().getError()===0,'production GL error');
     let different=0,maxDelta=0,lit=0;for(let j=0;j<actual.length;j++){const d=Math.abs(actual[j]-expected[j]);if(d){different++;maxDelta=Math.max(maxDelta,d);}if(j%4!==3&&actual[j])lit++;}check(c.blank?lit===0:lit>0,'blank '+c.name+' '+lit);
     rows.push({name:c.name,width:w,height:h,segments:c.trails.indices.length/2,expandedVertices:mesh.geometry.getAttribute('position').count,bufferDifferences,litChannels:lit,differentChannels:different,maxDelta,actualHash:await digest(actual),referenceHash:await digest(expected)});
    }finally{mesh.geometry.dispose();mesh.material.dispose();renderer.setRenderTarget(null);rt.dispose();for(const b of buffers.splice(0))gl.deleteBuffer(b);}
   }
   check(rows[0].actualHash!==rows.find(r=>r.name==='duplicate-alpha').actualHash,'duplicates must accumulate');check(rows[0].actualHash===rows.find(r=>r.name==='depth-occluded-overlay').actualHash,'overlay must ignore occluding depth');
   return{rows,identical:rows.every(r=>r.differentChannels===0&&Object.values(r.bufferDifferences).every(n=>n===0)),renderer:gl.getParameter(gl.RENDERER),nativeAppParity:false};
  }finally{renderer.dispose();renderer.forceContextLoss();for(const b of buffers)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{source,baked});
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);if(errors.length||!report.sourceStable||!report.results.identical)throw Error('Pixel, buffer, shader or source-stability check failed');report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Browser, Vite, renderers, targets, raw GL resources closed.';await writeFile('.cache/v2-source-particle-trail-lines.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,rows:report.results?.rows}));}
