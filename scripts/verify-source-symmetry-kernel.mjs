/** Independent retained original fragment shader vs production state owner.
 * Requires the fixed-JAR evidence in .cache/source-symmetry-kernel-audit.
 * No original application or JVM is executed. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(x,m)=>{if(!x)throw Error(m);};
const out=process.argv[2];check(out,'Supply a new output directory');await mkdir(out);
const evidence='.cache/source-symmetry-kernel-audit';
const manifest=JSON.parse(await readFile(evidence+'/manifest.json','utf8'));
check(sha(await readFile(manifest.jar))===manifest.jarSha256,'Reference JAR changed');
const extract=entry=>execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',manifest.jar,entry]);
check(sha(extract(manifest.classEntry))===manifest.classSha256,'Reference class changed');
const bodies={};for(const row of manifest.outputs){bodies[row.file.split('.')[0]]=await readFile(evidence+'/'+row.file,'utf8');check(sha(bodies[row.file.split('.')[0]])===row.sha256,'Oracle body changed');}
const update=extract('data/shader/symmetry_chaos_update.frag').toString();
const report={at:new Date().toISOString(),status:'running',jarSha256:manifest.jarSha256,classSha256:manifest.classSha256,updateSha256:sha(update),oracleBodies:manifest.outputs.map(({file,sha256})=>({file,sha256})),nativeApplicationExecuted:false};
const sources=['src/engine/sourceSymmetryMath.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','src/engine/iteratedIdentity.ts','src/engine/legacyImport.ts','scripts/verify-source-symmetry-kernel.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,sha(await readFile(p))])));
report.sourceBefore=await snapshot();let server,browser;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 const url=server.resolvedUrls.local[0];await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.result=await page.evaluate(async({bodies,update})=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts');
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const {iteratedInitialChunk}=await import('/src/engine/iteratedSeed.ts');
  const {SOURCE_SYMMETRY_MATH}=await import('/src/engine/sourceSymmetryMath.ts');
  const assert=(x,m)=>{if(!x)throw Error(m);};
  const cases=[];
  for(const n of [2,3,5,12,50])cases.push({name:'standard-'+n,template:'standard',n,delta:0,power:1,lo:-.25,hi:.25});
  for(const n of [2,5,50])for(const power of [1,6])cases.push({name:`modified-${n}-${power}`,template:'modified',n,delta:.5,power,lo:-.25,hi:.25});
  cases.push({name:'modified-origin',template:'modified',n:5,delta:.5,power:3,lo:0,hi:0},{name:'modified-inactive-origin',template:'modified',n:5,delta:0,power:3,lo:0,hi:0},{name:'finite-beyond-local-escape',template:'standard',n:3,delta:0,power:1,lo:2,hi:2,linear:true},{name:'nonfinite-preserved',template:'standard',n:50,delta:0,power:1,lo:100,hi:100});
  for(const burn of [200,257])cases.push({name:'warmup-'+burn,template:'standard',n:5,delta:0,power:1,lo:-.25,hi:.25,burn});
  const rows=[],header='#version 300 es\nprecision highp float;precision highp int;\n';
  for(const spec of cases){
   const scene=createScene(definition('symmetry'));
   Object.assign(scene.settings,{symmetryMathModel:SOURCE_SYMMETRY_MATH,iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:64,burnIn:spec.burn??0,iterationsPerFrame:1,initialMode:'box',initialXMin:spec.lo,initialXMax:spec.hi,initialYMin:spec.lo,initialYMax:spec.hi,degree:spec.n,deltaPower:spec.power,template:spec.template,escapeRadius:.001});
   Object.assign(scene.parameters,{lambda:spec.linear?2:-2.34,alpha:spec.linear?0:2,beta:spec.linear?0:.2,gamma:spec.linear?0:.2,omega:0,delta:spec.delta});
   const first=prepareIteratedFrame(scene,0,0),initial=iteratedInitialChunk(first.config,0,64);
   const gl=new OffscreenCanvas(64,1).getContext('webgl2',{antialias:false});assert(gl,'oracle WebGL2 unavailable');assert(gl.getExtension('EXT_color_buffer_float'),'oracle float target unavailable');
   const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s;};
   const vertex=shader(gl.VERTEX_SHADER,header+'out vec2 texCoord;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);texCoord=p;}');
   const fragment=shader(gl.FRAGMENT_SHADER,update.replace('#version 410',header).replace('// %SYMMETRY_CHAOS_FUNCTION_BODY%',bodies[spec.template]));
   const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
   const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,64,1,0,gl.RGBA,gl.FLOAT,initial);return t;};
   const textures=[texture(),texture()],fb=gl.createFramebuffer(),gpu=new IteratedDensityGpu();let side=0;
   const row={...spec,frames:[],finiteMismatch:0,classMismatch:0,maxAbsoluteError:0};rows.push(row);
   try{
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'stateTex'),0);
    for(const [key,value]of Object.entries({...scene.parameters,symmetry_degree:spec.n,delta_power:spec.power}))gl.uniform1f(gl.getUniformLocation(program,key),value);
    const advanceOracle=iterations=>{
     gl.uniform1i(gl.getUniformLocation(program,'iterations'),iterations);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures[side]);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,textures[1-side],0);gl.viewport(0,0,64,1);gl.drawArrays(gl.TRIANGLES,0,3);side=1-side;
    };
    for(let remaining=spec.burn??0;remaining>0;remaining-=16)advanceOracle(Math.min(16,remaining));
    for(let frame=0;frame<8;frame++){
     const iterations=frame===0?1:frame===1?16:2;scene.settings.iterationsPerFrame=iterations;advanceOracle(iterations);
     const expected=new Float32Array(256);gl.readPixels(0,0,64,1,gl.RGBA,gl.FLOAT,expected);assert(gl.getError()===gl.NO_ERROR,'oracle GL failure');
     const job=prepareIteratedFrame(scene,frame/60,frame),begin=performance.now();
     gpu.step(job,{width:32,height:24,projection:'xy',padding:.05,bounds:{minX:-4,maxX:4,minY:-3,maxY:3},resetParticles:frame===0,clearInk:frame===0});
     const actual=gpu.readParticles(),elapsedMs=performance.now()-begin;let different=0;
     for(let i=0;i<expected.length;i++){
      const a=actual.positionsAndMetric[i],b=expected[i];
      if(Number.isNaN(a)&&Number.isNaN(b))continue;
      if(Object.is(a,b)||a===b)continue;
      different++;
      if(Number.isFinite(a)&&Number.isFinite(b)){row.finiteMismatch++;row.maxAbsoluteError=Math.max(row.maxAbsoluteError,Math.abs(a-b));}else row.classMismatch++;
     }
     row.frames.push({frame,iterations,different,elapsedMs,invalidEvents:Array.from(actual.invalidCounts).reduce((a,b)=>a+b,0),validParticles:Array.from(actual.validity).filter(x=>x===1).length});
    }
   }finally{gpu.dispose();assert(gpu.diagnostics().retainedBytes===0,'production state retained');gl.deleteFramebuffer(fb);textures.forEach(t=>gl.deleteTexture(t));gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();}
  }
  return {environment:navigator.userAgent,rows,exact:rows.every(r=>r.finiteMismatch===0&&r.classMismatch===0),scope:'Same initial float32 state and uniform inputs; source fragment shader vs production owner. NaN payload ignored; NaN/Infinity class preserved. No native application, RNG or final-image parity claim.'};
 },{bodies,update});
 report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);check(report.sourceStable,'Source changed');check(report.result.exact,'Numerical mismatch with retained original shader');report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);if(report.cleanup.some(x=>x!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,directory:out,elapsedMs:report.elapsedMs}));}
