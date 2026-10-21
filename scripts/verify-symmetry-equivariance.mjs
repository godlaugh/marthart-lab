/** Algebraic rotation/reflection claims against retained original and production
 * GPU kernels. These are one-step function tests, not native image parity. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const check=(v,m)=>{if(!v)throw Error(m);},sha=x=>createHash('sha256').update(x).digest('hex');
const out=process.argv[2];check(out,'Supply a new report directory');await mkdir(out);
const root='.cache/source-symmetry-kernel-audit',manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
check(sha(await readFile(manifest.jar))===manifest.jarSha256,'Original JAR changed');
const cls=execFileSync('python3',['-c','import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',manifest.jar,manifest.classEntry]);check(sha(cls)===manifest.classSha256,'Original class changed');
const bodies={};for(const x of manifest.outputs){const body=await readFile(root+'/'+x.file,'utf8');check(sha(body)===x.sha256,'Extracted function changed');bodies[x.file.split('.')[0]]=body;}
const files=['src/engine/sourceSymmetryMath.ts','src/components/ParameterEditor.tsx','src/locales/application.en.json','scripts/verify-symmetry-equivariance.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',jarSha256:manifest.jarSha256,classSha256:manifest.classSha256,extractedFunctions:manifest.outputs.map(({file,sha256})=>({file,sha256})),sourceBefore:await hashes(),nativeApplicationExecuted:false},started=performance.now();let browser,server;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 report.result=await page.evaluate(async bodies=>{
  const {sourceSymmetryGpuField}=await import('/src/engine/sourceSymmetryMath.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},F=Math.fround,rows=[],points=[[.21,.32],[-.61,.24],[.73,-.51],[-.81,-.17],[.04,-.07],[.95,.1],[-.03,.94],[.67,.66]].map(p=>p.map(F)),width=points.length*3;
  const gl=new OffscreenCanvas(width,1).getContext('webgl2',{antialias:false});assert(gl&&gl.getExtension('EXT_color_buffer_float'),'Float WebGL unavailable');
  const shaders=[],programs=[],textures=[],fb=gl.createFramebuffer(),vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const header='#version 300 es\nprecision highp float;precision highp int;\n';
  const shader=(type,source)=>{const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);assert(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));return s;};
  const vertex=shader(gl.VERTEX_SHADER,header+'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}');
  const program=body=>{const p=gl.createProgram();programs.push(p);gl.attachShader(p,vertex);gl.attachShader(p,shader(gl.FRAGMENT_SHADER,header+body+'\nuniform sampler2D points;layout(location=0)out vec4 result;void main(){vec3 n;float m;calculate_next(texelFetch(points,ivec2(gl_FragCoord.xy),0).xyz,n,m);result=vec4(n,m);}'));gl.linkProgram(p);assert(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
  const texture=()=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,1,0,gl.RGBA,gl.FLOAT,null);return t;};
  const input=texture(),output=texture();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Float target incomplete');gl.viewport(0,0,width,1);
  const base={lambda:.31,alpha:-.27,beta:.19,gamma:.17,omega:0,n:2,delta:.23,deltaPower:1};
  const pairs=Object.fromEntries(['standard','modified'].map(template=>[template,{original:program(bodies[template]),production:program(sourceSymmetryGpuField({...base,template}).source)}]));
  const draw=(p,q,state)=>{gl.useProgram(p);const uniforms=sourceSymmetryGpuField(q).uniforms;for(const [k,v]of Object.entries(uniforms))gl.uniform1f(gl.getUniformLocation(p,k),v);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,1,gl.RGBA,gl.FLOAT,state);gl.uniform1i(gl.getUniformLocation(p,'points'),0);gl.drawArrays(gl.TRIANGLES,0,3);const values=new Float32Array(width*4);gl.readPixels(0,0,width,1,gl.RGBA,gl.FLOAT,values);assert(gl.getError()===gl.NO_ERROR,'GPU error');return values;};
  // Independent polar form, evaluated in double on the actual Float32 inputs.
  const oracle=(q,x,y)=>{const r=Math.hypot(x,y),theta=Math.atan2(y,x),p=q.lambda+q.alpha*r*r+q.beta*r**q.n*Math.cos(q.n*theta)+(q.template==='modified'?q.delta*r*Math.cos(q.n*q.deltaPower*theta):0),re=r**(q.n-1)*Math.cos((q.n-1)*theta),im=r**(q.n-1)*Math.sin((q.n-1)*theta);return[p*x+q.gamma*re-q.omega*y,p*y-q.gamma*im+q.omega*x];};
  const relative=(actual,expected)=>Math.abs(actual-expected)/Math.max(1,Math.abs(expected));
  // Fixed forward-error acceptance: up to 300 sequential Float32 complex
  // multiplications, plus input rotation rounding. Not a pixel tolerance.
  const tolerance=8e-5,examples=[];let comparisons=0,exactOriginalMatches=0;
  try{
   for(let n=2;n<=50;n++)for(const template of ['standard','modified'])for(const power of template==='standard'?[1]:[1,2,3,4,5,6])for(const omega of [-.12,0,.12]){
    const q=Object.fromEntries(Object.entries({...base,n,template,deltaPower:power,omega}).map(([k,v])=>[k,typeof v==='number'?F(v):v])),angle=2*Math.PI/n,cos=Math.cos(angle),sin=Math.sin(angle),state=new Float32Array(width*4);
    points.forEach(([x,y],i)=>{state.set([x,y,0,0,F(cos*x-sin*y),F(sin*x+cos*y),0,0,x,-y,0,0],i*12);});
    const actual=draw(pairs[template].production,q,state),original=draw(pairs[template].original,q,state);
    assert(actual.every((v,i)=>Number.isFinite(v)&&v===original[i]),'Original/production kernel disagreement');exactOriginalMatches+=actual.length;
    const changed={...q,gamma:F(.31)},withGamma=draw(pairs[template].production,changed,state),row={n,template,power,omega:q.omega,maxOracleError:0,maxRotationError:0,maxReflectionLawError:0,maxGammaLawError:0,minReflectionDefect:Infinity};
    for(let i=0;i<points.length;i++){
     const [x,y]=points[i],at=i*12,z=[actual[at],actual[at+1]],turned=[actual[at+4],actual[at+5]],mirror=[actual[at+8],actual[at+9]],rotation=[cos*z[0]-sin*z[1],sin*z[0]+cos*z[1]],defect=[mirror[0]-z[0],mirror[1]+z[1]],expectedDefect=[2*q.omega*y,2*q.omega*x];
     row.minReflectionDefect=Math.min(row.minReflectionDefect,Math.hypot(...defect));
     for(let k=0;k<2;k++){
      row.maxRotationError=Math.max(row.maxRotationError,relative(turned[k],rotation[k]));row.maxReflectionLawError=Math.max(row.maxReflectionLawError,relative(defect[k],expectedDefect[k]));
      const r=Math.hypot(x,y),theta=Math.atan2(y,x),power=r**(n-1),gammaDelta=(changed.gamma-q.gamma)*power*(k===0?Math.cos((n-1)*theta):-Math.sin((n-1)*theta));
      row.maxGammaLawError=Math.max(row.maxGammaLawError,relative(withGamma[at+k]-actual[at+k],gammaDelta));comparisons+=3;
     }
     for(const offset of [0,4,8]){const expected=oracle(q,state[at+offset],state[at+offset+1]);for(let k=0;k<2;k++){row.maxOracleError=Math.max(row.maxOracleError,relative(actual[at+offset+k],expected[k]));comparisons++;}}
    }
    assert(Math.max(row.maxOracleError,row.maxRotationError,row.maxReflectionLawError,row.maxGammaLawError)<=tolerance,'Invariant residual exceeds predetermined Float32 bound: '+JSON.stringify(row));
    assert(omega===0?row.minReflectionDefect===0:row.minReflectionDefect>.01,'Reflection counterexample missing');if(n===3&&template==='standard'&&omega>=0)examples.push({n,omega:q.omega,input:points[0],output:Array.from(actual.slice(0,2)),reflectionOutput:Array.from(actual.slice(8,10)),gamma:q.gamma,changedGamma:changed.gamma,changedOutput:Array.from(withGamma.slice(0,2))});rows.push(row);
   }
  }finally{gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);textures.forEach(t=>gl.deleteTexture(t));programs.forEach(p=>gl.deleteProgram(p));shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext();}
  return{environment:navigator.userAgent,tolerance,points,rows,examples,comparisons,exactOriginalMatches,scope:'Finite nonzero one-step states; source-generated kernels on local WebGL2. Algebraic proof concerns real arithmetic. No assertion of whole-image symmetry, native JOGL pixels, native window execution, or arbitrary custom GLSL.'};
 },bodies);
 const raw={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Symmetry parameter relations',equation:{template:'standard'},parameters:{lambda:-1.5,alpha:1.8,beta:.8,gamma:.3,omega:.1,symmetry_degree:5},settings:{batch_size:128,burn_in_steps:4},timeline:[]};
 await page.evaluate(async raw=>{const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{saveWorkspace}=await import('/src/engine/document.ts');const scene=parseProjectFile(JSON.stringify(raw)).scene;saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'standard',frameRate:30}});},raw);
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.error-card'));
 const help=page.getByText('How symmetry parameters shape the image',{exact:true});await help.waitFor({state:'attached'});
 // Open the existing inspector's parameter disclosure, then the contextual help.
 const summary=page.locator('details').filter({has:page.locator('.parameter-editor')}).locator(':scope > summary').first();if(!await help.isVisible())await summary.click();await help.click();
 check(await page.getByText('Order n makes the formula respect rotations by 360°/n. Finite sampling does not guarantee a fully symmetric image.',{exact:true}).isVisible(),'Built-in help not visible');await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));await page.screenshot({path:out+'/parameter-help.png',fullPage:true});
 await page.locator('input[type=file]').setInputFiles({name:'custom.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...raw,name:'Custom formula',equation:{glsl:'void calculate_next(in vec3 p,out vec3 n,out float m){n=p+vec3(.01,0.,0.);m=.01;}'}}))});
 await page.waitForFunction(()=>document.querySelector('#param-lambda')!==null&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card')&&document.body.innerText.includes('Custom formula'));
 check(await help.count()===0,'Built-in symmetry claims incorrectly applied to arbitrary custom GLSL');report.ui={builtInHelpVisible:true,customHelpAbsent:true};
 report.sourceAfter=await hashes();check(JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter),'Sources changed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(x=>x.status);if(report.cleanup.some(x=>x!=='fulfilled')){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,rows:report.result?.rows.length,elapsedMs:report.elapsedMs}));}
