/** Original JVM compiler fixtures -> local production parser, GPU state owner,
 * and actual imported App/Worker. This never establishes native window parity. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const assert=(v,m)=>{if(!v)throw Error(m);},sha=b=>createHash('sha256').update(b).digest('hex');
const out=process.argv[2];assert(out,'Supply a new output directory');await mkdir(out);
const root='.cache/source-map-expression',manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const inputBytes=await readFile(root+'/input.json'),resultBytes=await readFile(root+'/results.json');
assert(sha(inputBytes)===manifest.inputSha256&&sha(resultBytes)===manifest.resultsSha256,'Oracle fixtures changed');
const jar=manifest.sources[0];assert(sha(await readFile(jar.path))===jar.sha256,'Original JAR changed');
const shader=await readFile(manifest.shader.path,'utf8');assert(sha(shader)===manifest.shader.sha256,'Original update shader changed');
const inputs=JSON.parse(inputBytes).cases,outputs=JSON.parse(resultBytes),cases=inputs.map((c,i)=>{assert(c.id===outputs[i].id,'Oracle ordering differs');return{...c,...outputs[i]};});
const files=['src/engine/sourceMapMath.ts','src/engine/sourceRealGpuExpression.ts','src/engine/domainSourceScalar.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','src/engine/legacyImport.ts','src/engine/equationEditor.ts','scripts/verify-source-map-math.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',jarSha256:jar.sha256,compiler:manifest.members.find(x=>x.entry.endsWith('/MapAttractorExpressionCompiler.class')),inputSha256:manifest.inputSha256,resultsSha256:manifest.resultsSha256,sourceBefore:await hashes(),nativeWindowExecuted:false},started=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const url=server.resolvedUrls.local[0];
 await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url+'probe');
 report.compiler=await page.evaluate(async cases=>{
  const {prepareSourceMapExpressions}=await import('/src/engine/sourceMapMath.ts');const check=(v,m)=>{if(!v)throw Error(m);};
  // Source generation accepted these, but local admission deliberately rejects
  // unsupported dimensions, colliding names, arity, or undeclared constants.
  const stricter=new Set(['dimension-0','dimension-1','dimension-4','dimension--1','reserved-uniforms','invalid-uniform','collision-next','constant','constant-lower','unicode-ascii-digits','scientific-lower','wrong-arity-sin','wrong-arity-pow','wrong-arity-atan2','zero-arity']);
  const rows=[];
  for(const c of cases){let plan,error;try{plan=prepareSourceMapExpressions({x:c.x,y:c.y,z:c.z},c.parameters,c.dimension);}catch(e){error=String(e);}
   if(c.error){check(error,'Original rejected but production accepted '+c.id);rows.push({id:c.id,result:'both-reject',error});continue;}
   if(stricter.has(c.id)){check(error,'Expected explicit local admission failure '+c.id);rows.push({id:c.id,result:'explicit-local-admission',error});continue;}
   check(plan,'Unexpected production rejection '+c.id+': '+error);
   const keys=[...c.parameters].sort(),bindings=new Map(keys.map((k,i)=>[k,'sourceMapParameter'+i]));
   const originalBody=c.glsl.slice(c.glsl.indexOf('void calculate_next')).replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,name=>bindings.get(name)??name);
   const expected=keys.map((_,i)=>`uniform float sourceMapParameter${i};`).join('\n')+(keys.length?'\n\n':'')+originalBody;
   check(plan.source===expected,'Generated source differs beyond uniform declaration order/renaming: '+c.id);rows.push({id:c.id,result:'exact-after-uniform-normalization'});
  }
  return{rows,compared:rows.filter(r=>r.result==='exact-after-uniform-normalization').length,sourceErrors:rows.filter(r=>r.result==='both-reject').length,explicitLocalAdmission:rows.filter(r=>r.result==='explicit-local-admission').length};
 },cases);
 report.gpu=await page.evaluate(async({cases,shader})=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts'),{SOURCE_MAP_MATH}=await import('/src/engine/sourceMapMath.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},width=7,header='#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\n',gl=new OffscreenCanvas(width,1).getContext('webgl2');check(gl&&gl.getExtension('EXT_color_buffer_float'),'Oracle float framebuffer unavailable');
  const compile=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s;};
  const vertex=compile(gl.VERTEX_SHADER,header+'out vec2 texCoord;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=p;gl_Position=vec4(p*2.-1.,0.,1.);}'),vao=gl.createVertexArray(),fb=gl.createFramebuffer();gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(0,0,width,1);
  const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,1,0,gl.RGBA,gl.FLOAT,null);return t;};
  const input=texture(),output=texture();gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle target incomplete');
  const selected=['ordered-aliases','old-simultaneous','uniform-order','adjacent','power-small','mod','nonfinite','preset-Clifford_deJong_2D_3','preset-Cathala Attraktor','preset-Business Cycle Map'];
  const rows=[];let components=0;const tolerance=2e-5;
  try{for(const id of selected){const c=cases.find(c=>c.id===id);check(c?.glsl,'Missing oracle '+id);
   const fragment=compile(gl.FRAGMENT_SHADER,shader.replace('#version 410',header).replace('// %MAP_ATTRACTOR_FUNCTION_BODY%',c.glsl)),p=gl.createProgram();gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));
   const draw=(states,parameters,dimension,iterations)=>{gl.useProgram(p);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,1,gl.RGBA,gl.FLOAT,states);gl.uniform1i(gl.getUniformLocation(p,'stateTex'),0);gl.uniform1i(gl.getUniformLocation(p,'dimension'),dimension);gl.uniform1i(gl.getUniformLocation(p,'iterations'),iterations);for(const [k,v]of Object.entries(parameters))gl.uniform1f(gl.getUniformLocation(p,k),v);gl.drawArrays(gl.TRIANGLES,0,3);const result=new Float32Array(width*4);gl.readPixels(0,0,width,1,gl.RGBA,gl.FLOAT,result);check(gl.getError()===gl.NO_ERROR,'Oracle GL error');return result;};
   try{for(const iterations of [1,4,16])for(const attempt of [0,1]){
    const scene=createScene(definition('map'));scene.equations={x:c.x??'',y:c.y??'',z:c.z??''};scene.parameters=Object.fromEntries(c.parameters.map((k,i)=>[k,[.2,-.3,.4,.5][i%4]]));Object.assign(scene.settings,{iteratedMode:'continuous',mapMathModel:SOURCE_MAP_MATH,dimension:c.dimension,batchSize:width,burnIn:0,iterationsPerFrame:iterations,initialMode:'box',initialXMin:.2,initialXMax:.6,initialYMin:-.6,initialYMax:-.2,initialZMin:.1,initialZMax:.5,escapeRadius:.001});
    const gpu=new IteratedDensityGpu();let oracle=iteratedInitialChunk(prepareIteratedFrame(scene,0,0).config,0,width),maximumError=0,nonfinite=0,exact=0,programs;
    try{for(let frame=0;frame<3;frame++){
     if(frame===2)for(const k of Object.keys(scene.parameters))scene.parameters[k]*=.5;
     if(frame===2&&id==='ordered-aliases')scene.parameters.newParameter=.123;
     const job=prepareIteratedFrame(scene,frame/60,frame);oracle=draw(oracle,scene.parameters,c.dimension,iterations);
     gpu.step(job,{width:32,height:24,projection:'xy',padding:0,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},resetParticles:frame===0,clearInk:frame===0});const observed=gpu.readParticles(),currentPrograms=gpu.diagnostics().programs;
     if(frame===2&&id==='ordered-aliases')check(currentPrograms===programs+1,'Adding parameter did not compile exactly one new program');else if(frame>0)check(currentPrograms===programs,'Value update unexpectedly recompiled program');programs=currentPrograms;
     for(let i=0;i<oracle.length;i++){const a=observed.positionsAndMetric[i],b=oracle[i];if(!Number.isFinite(b)){nonfinite++;check(Number.isNaN(b)?Number.isNaN(a):a===b,`Nonfinite state replaced ${id}, iter ${iterations}, frame ${frame}, at ${i}: ${a}/${b}`);}else{const error=Math.abs(a-b)/Math.max(1,Math.abs(b));maximumError=Math.max(maximumError,error);check(Number.isFinite(a)&&error<=tolerance,`State mismatch ${id}, iter ${iterations}, frame ${frame}, at ${i}: ${a}/${b}`);if(Object.is(a,b))exact++;}components++;}
     if(id==='nonfinite')check(observed.validity.every(v=>v===0)&&observed.invalidCounts.every(v=>v>0),'Invalid state hidden/reseeded');
     if(id==='ordered-aliases')check(observed.positionsAndMetric[0]>.6,'Escape policy reset finite state');
    }}finally{gpu.dispose();check(gpu.diagnostics().retainedBytes===0,'Owner cleanup retained storage');}
    rows.push({id,iterations,attempt,frames:3,particles:width,maximumError,nonfinite,exact,...(id==='ordered-aliases'?{newParameterRecompiled:true}:{})});
   }}finally{gl.deleteProgram(p);gl.deleteShader(fragment);}
  }}finally{gl.deleteShader(vertex);gl.deleteTexture(input);gl.deleteTexture(output);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();}
  return{rows,components,tolerance,scope:'Original GLSL update fragment adapted to ES 3.00 versus production transform-feedback state, same explicit initial particles. 3 frames; independent cold/warm owners, live uniform edits. Local WebGL2 only; native RNG, JOGL, lifecycle and whole-image parity excluded.'};
 },{cases,shader});
 const raw={config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Source Map integration',equations:{x_next:'sin(a*y)+c*cos(a*x)',y_next:'sin(b*x)+d*cos(b*y)'},parameters:{a:-1.4,b:1.6,c:1,d:.7},settings:{batch_size:1024,burn_in_steps:10,dimension:2},timeline:[]};
 await page.evaluate(async raw=>{const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');const scene=parseProjectFile(JSON.stringify(raw)).scene;saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});},raw);
 await page.addInitScript(()=>{
  const Native=Worker;window.__sourceMapAudit={completed:[],errors:[]};
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.requests=new Map();this.addEventListener('message',({data})=>{
    if(data.error)window.__sourceMapAudit.errors.push(data.error);
    const request=this.requests.get(data.id);if(request?.scene.settings.mapMathModel&&data.output?.pixels)window.__sourceMapAudit.completed.push({model:request.scene.settings.mapMathModel,backend:data.output.backend,width:data.output.width,height:data.output.height,occupied:data.output.density?.occupiedPixels});
   });}
   postMessage(message,...args){if(message.operation==='generate')this.requests.set(message.id,structuredClone(message));return super.postMessage(message,...args);}
  };
 });
 await page.goto(url);await page.waitForFunction(()=>window.__sourceMapAudit.completed.length>0);await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));await page.screenshot({path:out+'/imported-map.png',fullPage:true});
 report.ui=await page.evaluate(()=>window.__sourceMapAudit);assert(report.ui.errors.length===0&&report.ui.completed.every(c=>c.model==='mathart-1.7.8-gpu-v1'&&c.backend==='webgl2'&&c.occupied>0),'Imported Worker preview missing/empty/failed');report.sourceAfter=await hashes();assert(JSON.stringify(report.sourceAfter)===JSON.stringify(report.sourceBefore),'Source changed during probe');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(x=>x.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,compiler:report.compiler?.compared,gpu:report.gpu?.components,elapsedMs:report.elapsedMs}));}
