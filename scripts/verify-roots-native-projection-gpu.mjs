import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2]??'.cache/roots-native-projection-gpu-attempt1.json';
const files=['src/engine/rootsNativeDensityGpu.ts','src/engine/rootsProjection.ts','src/engine/rootsPresentationConfig.ts','src/engine/rootsGpuFailure.ts','tests/roots-native-projection-gpu.test.ts','scripts/verify-roots-native-projection-gpu.mjs'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(p))])));
const shaderRoot='../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/';
const pinned={
 'complex_roots_splat.vert':'06f54b1224c3873eb15b1a303f1ab74bcbd8ae42c5bf93e085ad0713bb7ddc24',
 'complex_roots_splat.frag':'69607b52c2381ac24044c86eeb73728f199eca275a18889aa74b550c822e65d6',
 'complex_roots_splat_quad.vert':'2c07a1caa5a742d748b0a4dd58eb96f25e08462ed3ef8dc4092ef1b4738eea50',
 'complex_roots_splat_quad.frag':'c5eeb137e7bd32eb9a5c307702bdf3df1ea620a29f06d71027d1638a035765bc',
};
const retained={};for(const [name,sha]of Object.entries(pinned)){const text=await readFile(shaderRoot+name,'utf8');if(hash(text)!==sha)throw Error('Retained shader drift: '+name);retained[name]=text.replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;');}
const report={status:'running',at:new Date().toISOString(),sourceStart:await hashes(),retained:{root:shaderRoot,sha256:pinned,adaptation:'Only #version410 → ES300 and precision declarations. Original attribute names/locations resolved by reflection; shader math bodies are verbatim.'},pageErrors:[]};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false},logLevel:'error'});let browser,page;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/native-roots-gpu-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Native Roots projection GPU</title>'}));
 await page.goto(server.resolvedUrls.local[0]+'native-roots-gpu-probe');
 report.results=await page.evaluate(async({retained})=>{
  const {RootsNativeDensityGpu,ROOTS_NATIVE_DENSITY_CHUNK}=await import('/src/engine/rootsNativeDensityGpu.ts');
  const {prepareRootsProjection}=await import('/src/engine/rootsProjection.ts');
  const {defaultRootsPresentationConfiguration}=await import('/src/engine/rootsPresentationConfig.ts');
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const result=globalThis.__rootsNativeGpuResult={browser:navigator.userAgent,cases:[],boundaries:[],contexts:[]};
  const glP=WebGL2RenderingContext.prototype,original={},states=new Map();let label='';
  const kinds={Texture:'isTexture',Buffer:'isBuffer',Framebuffer:'isFramebuffer',VertexArray:'isVertexArray',Program:'isProgram',Shader:'isShader'};
  const state=gl=>{if(!states.has(gl))states.set(gl,{label,objects:[],deletes:[],beforeLoss:null});return states.get(gl);};
  for(const[kind,is]of Object.entries(kinds))for(const prefix of ['create','delete']){
   const name=prefix+kind,fn=glP[name];original[name]=fn;glP[name]=function(...args){const out=fn.apply(this,args),s=state(this);if(prefix==='create'&&out)s.objects.push({value:out,is});if(prefix==='delete')s.deletes.push(args[0]);return out;};
  }
  original.getExtension=glP.getExtension;glP.getExtension=function(name){const ext=original.getExtension.call(this,name);if(name!=='WEBGL_lose_context'||!ext)return ext;const gl=this;return{loseContext(){state(gl).beforeLoss=state(gl).objects.filter(o=>gl[o.is](o.value)).length;return ext.loseContext();},restoreContext(){return ext.restoreContext();}};};
  function oracle(width,height){
   const gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:false,antialias:false,depth:false});check(gl,'Oracle WebGL2 absent');check(gl.getExtension('EXT_color_buffer_float')&&gl.getExtension('EXT_float_blend'),'Oracle float support absent');
   const tex=gl.createTexture(),fb=gl.createFramebuffer(),buffer=gl.createBuffer(),vao=gl.createVertexArray(),programs=new Map(),shaders=[];
   gl.bindTexture(gl.TEXTURE_2D,tex);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.NEAREST);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle FBO');
   for(const kind of ['points','quad']){const p=gl.createProgram();programs.set(kind,p);for(const type of ['vert','frag']){const s=gl.createShader(type==='vert'?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);shaders.push([p,s]);gl.shaderSource(s,retained['complex_roots_splat'+(kind==='quad'?'_quad':'')+'.'+type]);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));}
   return{run(kind,plan,points){
    const p=programs.get(kind);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(0,0,width,height);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.disable(gl.RASTERIZER_DISCARD);gl.colorMask(true,true,true,true);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.bindVertexArray(vao);gl.useProgram(p);
    gl.uniformMatrix4fv(gl.getUniformLocation(p,'projection'),false,plan.projection.columnMajor);gl.uniformMatrix4fv(gl.getUniformLocation(p,'modelview'),false,plan.modelView.columnMajor);gl.uniform1f(gl.getUniformLocation(p,'pointSize'),plan.densityDiameter);gl.uniform2f(gl.getUniformLocation(p,'viewportSize'),width,height);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,Float32Array.from(points.flat()),gl.STREAM_DRAW);const a=gl.getAttribLocation(p,'positionWorld'),m=gl.getAttribLocation(p,'splatMetric');gl.enableVertexAttribArray(a);gl.enableVertexAttribArray(m);gl.vertexAttribPointer(a,3,gl.FLOAT,false,16,0);gl.vertexAttribPointer(m,1,gl.FLOAT,false,16,12);gl.vertexAttribDivisor(a,kind==='quad'?1:0);gl.vertexAttribDivisor(m,kind==='quad'?1:0);
    if(kind==='quad')gl.drawArraysInstanced(gl.TRIANGLES,0,6,points.length);else gl.drawArrays(gl.POINTS,0,points.length);
    const bottom=new Float32Array(width*height*4),top=new Float32Array(bottom.length);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,bottom);check(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'Oracle draw/read');for(let y=0;y<height;y++)top.set(bottom.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);return top;
   },dispose(){gl.bindVertexArray(null);gl.useProgram(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);for(const[p,s]of shaders){gl.detachShader(p,s);gl.deleteShader(s);}for(const p of programs.values())gl.deleteProgram(p);gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteFramebuffer(fb);gl.deleteTexture(tex);gl.getExtension('WEBGL_lose_context').loseContext();}};
  }
  const mat=rows=>({rowMajor:rows.map(Math.fround),columnMajor:Float32Array.from(Array.from({length:16},(_,i)=>rows[(i%4)*4+Math.floor(i/4)]))});
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function plan(w,h,diameter,options={}){const c=defaultRootsPresentationConfiguration();c.camera.phi=0;Object.assign(c.camera,options.camera);c.accumulation.enabled=!!options.ortho;const p=prepareRootsProjection(c,{width:w,height:h,viewport:{logicalWidth:options.logicalWidth??w,logicalHeight:options.logicalHeight??h,referenceLogicalHeight:options.referenceHeight??h,target:options.target??'primary'}});if(options.sourcePlan)return p;return{...p,densityDiameter:Math.fround(diameter),pointsDiameter:Math.max(Math.fround(diameter),1),quadDiameter:Math.max(Math.fround(Math.fround(diameter)*Math.fround(.6)),Math.fround(.8)),pointCloudUniformSize:Math.fround(Math.fround(diameter)*Math.fround(.01)),projection:mat(options.projection??I),modelView:mat(options.modelView??I)};}
  const fixtures=[
   {id:'odd-center-min-diameter',w:17,h:13,d:.5,points:[[0,0,0,0],[.5,.5,0,1],[-.6,-.4,0,.3]]},
   {id:'asymmetric-topdown',w:42,h:19,d:6,points:[[-.71,.62,0,.17],[.34,-.21,0,.91],[.1,.1,0,.5]]},
   {id:'overlap-additive-metric',w:23,h:21,d:9,points:[[0,0,0,0],[0,0,0,1],[0,0,0,.25]]},
   {id:'xy-z-clip-and-behind',w:31,h:23,d:8,points:[[1.08,0,0,.2],[-1.08,0,0,.7],[0,0,1.1,.4],[0,0,-1.1,.5],[0,0,0,.1]]},
   {id:'noncommuting-view',w:37,h:29,d:3.7,options:{modelView:[0,-1,0,.17,1,0,0,-.23,0,0,1,0,0,0,0,1]},points:[[.1,.3,0,.2],[-.7,.4,0,.8],[.8,-.8,0,1]]},
   {id:'perspective-w',w:43,h:27,d:5,options:{projection:[1,0,0,0,0,1,0,0,0,0,-1,-.2,0,0,-1,0]},points:[[.2,.3,-1,.2],[-.2,-.3,-.5,.8],[0,0,.5,.4],[0,0,-.05,.6],[0,0,-3,1]]},
   {id:'large-footprint',w:19,h:17,d:80,points:[[0,0,0,.37],[.9,.9,0,.9]]},
   {id:'source-perspective-plan',w:67,h:41,d:1,options:{sourcePlan:true,camera:{phi:.35,theta:-.47,gamma:.23,zoom:1.3,center:[3,-2,1]}},points:[[0,0,0,.2],[10,8,0,.8],[-13,4,0,.5]]},
   {id:'source-wrapper-ortho-plan',w:67,h:41,d:1,options:{sourcePlan:true,ortho:true,camera:{phi:.35,theta:.67,gamma:-.23}},points:[[0,0,0,.7],[10,8,0,.3],[-13,4,0,1]]},
   {id:'source-offscreen-physical2x',w:86,h:62,d:1,options:{sourcePlan:true,target:'offscreen',logicalWidth:43,logicalHeight:31,referenceHeight:15},points:[[0,0,0,.5],[5,3,0,.8],[-7,-4,0,.2]]},
  ];
  let primaryFailure;
  try{
   for(const fixture of fixtures)for(const kernel of ['points','quad','auto']){
    const id=fixture.id+'-'+kernel,p=plan(fixture.w,fixture.h,fixture.d,fixture.options),g=new RootsNativeDensityGpu();let independent;
    try{label='production:'+id;g.initialize(fixture.w,fixture.h);check(g.diagnostics().submittedPoints===0,'Probe counted as submission');for(const v of fixture.points)g.add(v.slice(0,3),v[3]);g.flush(p,kernel);const a=g.readback(),facts=g.diagnostics();check(facts.submittedPoints===fixture.points.length&&facts.pendingPoints===0,'Submission fact mismatch '+id);const selected=facts.lastKernel;label='retained:'+id;independent=oracle(fixture.w,fixture.h);const b=independent.run(selected,p,fixture.points);let different=0,maxDifference=0;for(let i=0;i<a.length;i++){if(!Object.is(a[i],b[i]))different++;maxDifference=Math.max(maxDifference,Math.abs(a[i]-b[i]));}check(different===0,id+' retained shader pixel mismatch '+different+'/'+maxDifference);result.cases.push({id,width:fixture.w,height:fixture.h,kernelRequested:kernel,kernelActual:selected,probe:facts.probe,submittedPoints:facts.submittedPoints,occupied:Array.from(a).filter((v,i)=>i%4===0&&v>0).length,sha256:await digest(a),floatValuesCompared:a.length,different,maxDifference});
     g.clear();const empty=g.readback();check(empty.every(x=>x===0)&&g.diagnostics().submittedPoints===0,'Clear/probe contamination '+id);
    }finally{independent?.dispose();g.dispose();}
   }
   // Completed production operations for failure/recovery and cancellation;
   // expected image values remain only the retained-shader comparison above.
   label='boundaries';const g=new RootsNativeDensityGpu(),p=plan(17,13,3);try{
    g.initialize(17,13);for(let i=0;i<ROOTS_NATIVE_DENSITY_CHUNK;i++)g.add([0,0,0],.25);g.flush(p,'quad');check(g.diagnostics().submittedPoints===ROOTS_NATIVE_DENSITY_CHUNK,'Full bounded chunk not submitted');g.readback();result.boundaries.push({id:'full-chunk-complete',facts:g.diagnostics()});g.clear();
    for(let i=0;i<10;i++)g.add([0,0,0],.5);let checks=0,error;try{g.flush(p,'quad',()=>++checks>=3);}catch(e){error=e;}check(error?.name==='AbortError'&&g.diagnostics().handles===0,'Cancel did not invalidate partial owner');result.boundaries.push({id:'cancel-and-release',checks,error:error.name});
    g.initialize(17,13);g.add([0,0,0],.5);g.flush(p,'points');g.readback();result.boundaries.push({id:'cancel-recovery',facts:g.diagnostics()});
    const loss=g.gl;loss.getExtension('WEBGL_lose_context').loseContext();let lost;try{g.readback();}catch(e){lost=e;}check(lost?.failureKind==='device'&&g.diagnostics().handles===0,'Context loss not classified/cleaned');g.initialize(17,13);g.add([0,0,0],.5);g.flush(p,'auto');g.readback();result.boundaries.push({id:'context-loss-and-recovery',failureKind:lost.failureKind,recreated:g.gl!==loss});
   }finally{g.dispose();}
   // A wrapper shortens one real readPixels call by one row. GL succeeds,
   // but the untouched NaN-prefilled row must invalidate the entire owner.
   const read=glP.readPixels;label='controlled-partial-probe';const partial=new RootsNativeDensityGpu();
   try{
    glP.readPixels=function(x,y,w,h,format,type,data,...rest){return read.call(this,x,y,w,h-1,format,type,data,...rest);};
    let error;try{partial.initialize(17,13);}catch(e){error=e;}
    check(error?.failureKind==='device'&&error.message.includes('probe readback')&&partial.diagnostics().handles===0&&partial.diagnostics().probe===undefined,'Partial no-error probe was accepted/cached');
    result.boundaries.push({id:'controlled-partial-probe-rejected',failureKind:error.failureKind,message:error.message,facts:partial.diagnostics()});
   }finally{glP.readPixels=read;partial.dispose();}
   try{partial.initialize(17,13);partial.add([0,0,0],.6);partial.flush(p);const recovered=partial.readback();check(recovered.some((v,i)=>i%4===0&&v>0),'Recovery after incomplete probe failed');result.boundaries.push({id:'controlled-partial-probe-recovery',facts:partial.diagnostics()});}finally{partial.dispose();}
   // Explicitly force the real probe draw to emit no points; auto must choose
   // quad, with no silent switch in an explicitly forced points invocation.
   const draw=glP.drawArrays;try{glP.drawArrays=function(mode,first,count){if(count===16&&mode===this.POINTS)return draw.call(this,mode,first,0);return draw.call(this,mode,first,count);};const fallback=new RootsNativeDensityGpu();try{fallback.initialize(17,13);check(fallback.diagnostics().probe.selected==='quad','Zero probe did not choose quad');fallback.add([0,0,0],.7);fallback.flush(p);check(fallback.diagnostics().lastKernel==='quad','Auto selection ignored');fallback.readback();const probe=fallback.diagnostics().probe;fallback.clear();fallback.add([0,0,0],.7);fallback.flush(p,'points');check(fallback.diagnostics().lastKernel==='points','Forced points silently changed geometry');fallback.readback();result.boundaries.push({id:'real-zero-probe-auto-quad-forced-points',probe});}finally{fallback.dispose();}}finally{glP.drawArrays=draw;}
   return result;
  }catch(error){primaryFailure=error;throw error;}finally{
   result.contexts=Array.from(states.values()).map((s,i)=>({index:i,label:s.label,created:s.objects.length,deleteCalls:s.deletes.length,liveImmediatelyBeforeContextLoss:s.beforeLoss}));
   for(const[name,fn]of Object.entries(original))glP[name]=fn;
   // The deliberately externally lost context cannot prove explicit deletion;
   // keep it separate rather than counting context loss as object deletion.
   result.cleanup={ownedContexts:result.contexts.length,nonzeroBeforeLoss:result.contexts.filter(s=>s.liveImmediatelyBeforeContextLoss>0),note:'One externally lost production context is intentional; every normally disposed context must have zero actual GL objects before loss.'};
   result.cleanup.valid=result.contexts.every(s=>s.liveImmediatelyBeforeContextLoss!==null)&&result.cleanup.nonzeroBeforeLoss.length<=1&&result.cleanup.nonzeroBeforeLoss.every(s=>s.label==='boundaries');
   if(!primaryFailure)check(result.cleanup.valid,'Unexpected live resources or unreleased context');
  }
 },{retained});
 report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable)throw Error('Source changed during verification');if(report.pageErrors.length)throw Error(report.pageErrors.join(';'));report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};report.partial=await page?.evaluate(()=>globalThis.__rootsNativeGpuResult).catch(()=>undefined);report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);process.exitCode=1;}
finally{await browser?.close();await server.close();report.closed={browser:true,vite:true};report.scope=['No original application/JVM/classes executed. Shipped GLSL bodies are run independently on the current WebGL2 driver; GLSL410/platform equivalence is not proved.','Hand-authored identity/noncommuting/perspective matrices isolate GPU adapter math. Production prepared-plan cases test upload/plumbing and are not an independent proof of the camera owner.','Mock unit tests cover errors and ownership, not shader numerics. This verifier compares completed Float32 ink, before palette/tone and session integration. Point-cloud and accumulation-wrapper history are out of this density-only adapter scope.','Cancellation is between bounded draws/readback scans; synchronous driver calls cannot be interrupted. Device memory overhead, token costs, process CPU/RSS and sustained performance are not measured here.'];await mkdir('.cache',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,cases:report.results?.cases.length,boundaries:report.results?.boundaries.length,error:report.error?.message}));}
