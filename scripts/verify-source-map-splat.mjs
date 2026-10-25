/** Compare source Map accumulation against the fixed original GL410 shaders.
 * Only the shader version/precision declaration is adapted for WebGL ES300.
 * This is an isolated headless GPU boundary check, not native JOGL execution. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=process.argv[2];if(!directory)throw Error('Supply a new output directory');await mkdir(directory);
const sha=x=>createHash('sha256').update(x).digest('hex'),check=(v,m)=>{if(!v)throw Error(m);};
const jar=process.argv[3]??'../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const reference={jarSha256:'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',shaders:[]},shaders={};
check(sha(await readFile(jar))===reference.jarSha256,'Reference JAR changed');
for(const suffix of ['','_quad'])for(const ext of ['vert','frag']){const name='map_attractor_accumulate'+suffix+'.'+ext,entry='data/shader/'+name,data=execFileSync('unzip',['-p',jar,entry],{maxBuffer:65536});await writeFile(directory+'/'+name,data);reference.shaders.push({entry,sha256:sha(data)});shaders[name]=data.toString();}
const sources=['src/engine/sourceDensitySplat.ts','src/engine/sourceMapSplat.ts','src/engine/sourceMapRuntimeColors.ts','src/engine/legacyImport.ts','src/engine/iteratedDensityGpu.ts','src/engine/iteratedDensityGpuPrograms.ts','src/engine/sourceIteratedRenderPlan.ts','src/engine/sourceIterationFramePlan.ts','src/scenes/iteratedDensity.ts','scripts/verify-source-map-splat.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async path=>[path,sha(await readFile(path))])));
const report={status:'running',reference,sourceBefore:await snapshot(),nativeWindowExecuted:false,limits:['Original shaders executed with GL410-to-ES300 version/precision adaptation in local headless Chrome, not native MathArt/JOGL. Point uniform is rounded independently to emulate the observed CGL footprint; ANGLE otherwise preserves fractional point sizes.','The independent shader receives explicit identity matrices and known particles. No native camera or presentation parity is claimed.','Quad fallback is exercised by suppressing the production point-probe draw; this does not establish the native driver probe result.','Finite cases exercise initial construction, not native hot dot-size setter behavior.']},started=performance.now();let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async({shaders})=>{
  const {parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareSourceDensitySplat}=await import('/src/engine/sourceDensitySplat.ts'),{prepareSourceIterationFramePlan}=await import('/src/engine/sourceIterationFramePlan.ts');
  const F=Math.fround,check=(v,m)=>{if(!v)throw Error(m);},width=64,height=48,count=4,canvas=new OffscreenCanvas(width,height),gl=canvas.getContext('webgl2');check(gl&&gl.getExtension('EXT_color_buffer_float')&&gl.getExtension('EXT_float_blend'),'Oracle float framebuffer unavailable');
  const textures=[],programs=[],shaderObjects=[],fbo=gl.createFramebuffer(),vao=gl.createVertexArray(),originalDraw=WebGL2RenderingContext.prototype.drawArrays;let suppressProbe=false;
  WebGL2RenderingContext.prototype.drawArrays=function(mode,first,n){if(suppressProbe&&this!==gl&&mode===this.POINTS&&n===16)return;return originalDraw.call(this,mode,first,n);};
  const texture=(w,h,data)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,data);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);return t;};
  const program=quad=>{const p=gl.createProgram();programs.push(p);for(const[type,ext]of[[gl.VERTEX_SHADER,'vert'],[gl.FRAGMENT_SHADER,'frag']]){const s=gl.createShader(type);shaderObjects.push(s);gl.shaderSource(s,shaders['map_attractor_accumulate'+(quad?'_quad':'')+'.'+ext].replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;'));gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
  const rows=[];
  try{
   const point=program(false),quad=program(true),ink=texture(width,height,null),state=texture(2,2,new Float32Array(16));
   const oracle=(spec,particle,uniforms)=>{
    const p=spec.path==='points'?point:quad;gl.useProgram(p);gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ink,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle framebuffer incomplete');gl.viewport(0,0,width,height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));
    const loc=k=>gl.getUniformLocation(p,k),identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);for(const k of ['projection','modelview'])gl.uniformMatrix4fv(loc(k),false,identity);gl.uniform3f(loc('scale'),1,1,1);gl.uniform3f(loc('offset'),0,0,0);gl.uniform2f(loc('viewportSize'),width,height);gl.uniform1i(loc('texSize'),2);for(const[k,v]of Object.entries(uniforms))if(k==='stepMetricNormalizeMode')gl.uniform1i(loc(k),v);else gl.uniform1f(loc(k),v);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,2,2,gl.RGBA,gl.FLOAT,new Float32Array(Array.from({length:count},()=>particle).flat()));gl.uniform1i(loc('stateTex'),0);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);if(spec.path==='points')gl.drawArrays(gl.POINTS,0,count);else gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);gl.disable(gl.BLEND);
    const raw=new Float32Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,raw);check(gl.getError()===gl.NO_ERROR,'Oracle GL error');const result=new Float32Array(raw.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=(y*width+x)*4,b=((height-1-y)*width+x)*4;result.set([raw[a+1],raw[a+2],raw[a+3],raw[a]],b);}return result;
   };
   const base={dotSize:4,displayScale:1,position:[.011,.017],metric:0,min:0,max:2,mode:'CLAMP',speed:.22,phase:180,entry:'runtime-config'};
   const specs=[...[-2,0,.5,1.5,4,20,40].flatMap(dotSize=>[{dotSize,position:[0,0]},{dotSize,position:[.011,.017]}]),{dotSize:.5,displayScale:4},{dotSize:20,displayScale:.5},{dotSize:4,displayScale:3},{dotSize:20,position:[1.01,0]},{position:[0,-1.01]},
    ...['CLAMP','ROBUST',' robust ','UNKNOWN','\u00a0ROBUST\u00a0'].flatMap(mode=>[-4,0,2,8].map(min=>({mode,min,max:min+2,metric:2}))),
    ...[0,17.3,180,359.999,360,-1,721].map(phase=>({phase,min:-.7,max:1.3,speed:1.7})),
    ...[0,.1,.22,1,2,12].map(speed=>({speed,min:-2,max:1,mode:'ROBUST'})),
    {min:1,max:1},{min:1,max:1.0001},{min:2,max:1},{omitDot:true,entry:'runtime-config'},{omitDot:true,entry:'project'},
    {paletteEdit:true,min:-1,max:2,phase:73.25,speed:1.75},
   ].map((s,i)=>({...base,...s,id:i}));
   for(const path of ['points','quad']){const gpu=new IteratedDensityGpu();try{for(const spec of specs){
    const initialX=F(F(spec.position[0])-F(spec.metric)),initialY=F(spec.position[1]);
    const settings={dimension:2,batch_size:count,burn_in_steps:0,iterations_per_frame:1,accumulation_decay:1,x0_min:initialX,x0_max:initialX,y0_min:initialY,y0_max:initialY,scale_x:1,scale_y:1,scale_z:1,step_metric_min:spec.min,step_metric_max:spec.max,step_metric_normalize_mode:spec.mode,color_speed:spec.speed,color_phase:spec.phase,...(spec.omitDot?{}:{dot_size:spec.dotSize})};
    const input={config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map splat reference',equations:{x_next:'targetX',y_next:'targetY',z_next:'0'},parameters:{targetX:spec.position[0],targetY:spec.position[1]},settings,timeline:[]};
    let scene=parseLegacyScene(JSON.stringify(input),{sourceEntry:spec.entry}).scene;if(spec.paletteEdit){scene.palette.colors=['#00ff00','#ff00ff'];scene.palette.offset=.63;scene.palette.cycles=9;scene.settings.alpha=.02;}scene=parseScene(serializeScene(scene));
    const job=prepareIteratedFrame(scene,0,0);check(job.densitySplat?.model==='map-splat-1.7.8','Public Map import did not enable source splat');
    const dot=spec.omitDot?(spec.entry==='project'?1.5:1):F(spec.dotSize),min=F(spec.min),max=Math.max(F(spec.max),F(min+F(.001))),speed=Math.max(F(.1),Math.min(2,F(spec.speed))),degrees=Math.max(0,Math.min(360,F(spec.phase))),phase=F(F(degrees*F(Math.PI))/180),mode=spec.mode.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'').toUpperCase()==='ROBUST'?1:0,radius=Math.max(1,F(dot*F(spec.displayScale)));
    check(job.config.pointSize===dot&&job.config.metricMin===min&&job.config.metricMax===max&&job.config.colorSpeed===speed&&job.config.colorPhase===phase&&job.config.metricMode===(mode?'robust':'clamp'),'Source uniform binding differed for case '+spec.id);
    job.densitySplat=prepareSourceDensitySplat('map',dot,spec.displayScale);job.iterationFrame=prepareSourceIterationFramePlan('map',{frameIndex:0,updateCount:1},false,0,1);job.iterationUpdates=[job.field];
    const submittedRadius=path==='points'?Math.floor(radius+.5):radius;const row={...spec,path,expectedRadius:radius,submittedRadius};suppressProbe=path==='quad';try{
     const began=performance.now();row.stats=gpu.step(job,{width,height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},resetParticles:true,clearInk:true});row.stepMs=performance.now()-began;suppressProbe=false;check(job.densitySplat.path===path,'Requested splat branch unavailable');
     const dx=F(F(spec.position[0])-initialX),particle=[F(spec.position[0]),F(spec.position[1]),0,F(Math.sqrt(F(dx*dx)))],particles=gpu.readParticles().positionsAndMetric;check(particles.every((v,i)=>Object.is(v,particle[i%4])),'Particle reference differs for '+spec.id);
     const expected=oracle({...spec,path},particle,{radius:submittedRadius,stepMetricMin:min,stepMetricMax:max,stepMetricNormalizeMode:mode,colorSpeed:speed,colorPhase:phase}),actual=gpu.readback();let maxError=0,coverageDifferences=0,occupied=0;
     for(let i=0;i<actual.length;i++){check(Number.isFinite(actual[i])&&Number.isFinite(expected[i]),'Nonfinite color or coverage');maxError=Math.max(maxError,Math.abs(actual[i]-expected[i]));if(i%4===3){if(actual[i]>0)occupied++;if((actual[i]>0)!==(expected[i]>0))coverageDifferences++;}}
     Object.assign(row,{maxError,coverageDifferences,occupied,particle,uniforms:{min,max,speed,phase,mode}});check(maxError<=2e-5&&coverageDifferences===0,'Source splat differs: '+JSON.stringify(row));if(path==='points'&&spec.position.some(v=>Math.abs(v)>1))check(row.stats.clipped===count,'Point clipping statistics disagree');rows.push(row);
    }finally{suppressProbe=false;}
   }}finally{gpu.dispose();check(gpu.diagnostics().retainedBytes===0,'GPU retained resources');}}
   return{rows,environment:navigator.userAgent};
  }finally{WebGL2RenderingContext.prototype.drawArrays=originalDraw;for(const t of textures)gl.deleteTexture(t);for(const p of programs)gl.deleteProgram(p);for(const s of shaderObjects)gl.deleteShader(s);gl.deleteFramebuffer(fbo);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 },{shaders});
 report.sourceAfter=await snapshot();check(JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter),'Source changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.result?.rows.length,error:report.error,elapsedMs:report.elapsedMs}));}
