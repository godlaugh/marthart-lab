import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const output=process.argv[2];
if(!output)throw Error('Pass a fresh report path; existing reports are never overwritten.');
const hash=v=>createHash('sha256').update(v).digest('hex');
const retainedPath='../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/complex_roots_present.frag';
const retained=await readFile(retainedPath,'utf8');
if(hash(retained)!=='c43c012708640173f0d7178d8c3e226f084db850f6aad85270334dd18d4b9b20')throw Error('Retained shader changed');
const source=retained.replace('#version 410','#version 300 es\nprecision highp float;precision highp int;');
const marker='    float count = max(accum.r, 0.0);';
if(!source.includes(marker))throw Error('Retained instrumentation boundary absent');
const instrumented=source.slice(0,source.indexOf(marker))+'    fragColor = accum;\n}\n';
const paths=['src/engine/rootsNativeInk.ts','src/engine/rootsDensityColor.ts','scripts/verify-roots-native-ink-view.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',sourceStart:await hashes(),retained:{path:retainedPath,sha256:hash(retained),translatedSha256:hash(source),instrumentedSha256:hash(instrumented)},pageErrors:[]};
let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/native-ink-view',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Roots raw ink view verification</title>'}));
 await page.goto(server.resolvedUrls.local[0]+'native-ink-view');
 report.results=await page.evaluate(async({source,instrumented})=>{
  const {prepareRootsInkView,viewRootsNativeMetricInk,presentRootsNativeMetricInk}=await import('/src/engine/rootsNativeInk.ts');
  const {prepareRootsDensityColor}=await import('/src/engine/rootsDensityColor.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:false,antialias:false,depth:false});check(gl,'WebGL2');check(gl.getExtension('EXT_color_buffer_float'),'Float render target');
  const textures=[],programs=[],shaders=[],fbo=gl.createFramebuffer();const results={browser:navigator.userAgent,cases:[],cleanup:null};
  const vertex='#version 300 es\nprecision highp float;out vec2 texCoord;void main(){vec2 q=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=q;gl_Position=vec4(q*2.-1.,0.,1.);}';
  const make=fragment=>{const p=gl.createProgram();programs.push(p);for(const[type,text]of[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,text);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
  const texture=filter=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);for(const name of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,filter);for(const name of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);return t;};
  const flip=(a,w,h)=>{const out=new a.constructor(a.length);for(let y=0;y<h;y++)out.set(a.subarray(y*w*4,(y+1)*w*4),(h-y-1)*w*4);return out;};
  try{
   const tone=make(source),lookup=make(instrumented),input=texture(gl.NEAREST),palette=texture(gl.LINEAR),target=texture(gl.NEAREST);
   const white=new Uint8Array(1024);white.fill(255);gl.bindTexture(gl.TEXTURE_2D,palette);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,white);
   const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceGamma:1,rootSourceBrightness:1,background:'#000000'},rootsSourcePalette:{colors:['#FFFFFF']}});
   check(color.kind==='metric-sum','source color');
   const cases=[[3,3,0],[3,3,Math.PI/2],[3,3,-Math.PI/2],[4,2,Math.PI/2],[31,17,.31],[31,17,-.31],[57,29,Math.PI],[1,7,.13],[9,13,.83]];
   for(const[w,h,rotation]of cases){
    const raw=new Float32Array(w*h*4);for(let i=0;i<w*h;i++){raw[4*i]=i%7===0?0:i+1;raw[4*i+1]=raw[4*i]*(i%5)/4;}
    const view=prepareRootsInkView(w,h,rotation),expected=viewRootsNativeMetricInk(raw,view),shown=presentRootsNativeMetricInk(raw,view,color,w*h);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,flip(raw,w,h));
    const draw=(p,floating)=>{
     gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,floating?gl.RGBA32F:gl.RGBA8,w,h,0,gl.RGBA,floating?gl.FLOAT:gl.UNSIGNED_BYTE,null);
     gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Framebuffer');gl.viewport(0,0,w,h);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);gl.useProgram(p);
     gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,palette);
     gl.uniform1i(gl.getUniformLocation(p,'accumTex'),0);gl.uniform1i(gl.getUniformLocation(p,'paletteTex'),1);
     for(const name of['paletteOffset','brightness','contrast','gamma','dynamicRange','saturation'])gl.uniform1f(gl.getUniformLocation(p,name),color[name]);
     gl.uniform3f(gl.getUniformLocation(p,'backgroundRgb'),0,0,0);gl.uniform1f(gl.getUniformLocation(p,'scale'),1);gl.uniform1f(gl.getUniformLocation(p,'displayRotation'),Math.fround(rotation));gl.uniform1f(gl.getUniformLocation(p,'viewportAspect'),Math.fround(w/h));gl.drawArrays(gl.TRIANGLES,0,3);
     const pixels=floating?new Float32Array(w*h*4):new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,floating?gl.FLOAT:gl.UNSIGNED_BYTE,pixels);check(gl.getError()===0,'GL draw/read');return flip(pixels,w,h);
    };
    const lookupPixels=draw(lookup,true),tonePixels=draw(tone,false);let lookupDifferences=0,maxToneDifference=0,changedToneChannels=0;
    for(let i=0;i<expected.length;i++){if(i%4<2&&expected[i]!==lookupPixels[i])lookupDifferences++;const delta=Math.abs(shown.pixels[i]-tonePixels[i]);maxToneDifference=Math.max(maxToneDifference,delta);changedToneChannels+=delta!==0;}
    results.cases.push({w,h,rotation,lookupDifferences,maxToneDifference,changedToneChannels,accumulated:shown.accumulated,displayed:shown.displayed});
    check(lookupDifferences===0,`Raw source selection mismatch at ${w}x${h}/${rotation}`);check(maxToneDifference<=1,`Source tone reference mismatch at ${w}x${h}/${rotation}`);
   }
   return results;
  }finally{
   gl.useProgram(null);for(const p of programs)gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);for(const t of textures)gl.deleteTexture(t);gl.deleteFramebuffer(fbo);
   const alive={programs:programs.filter(p=>gl.isProgram(p)).length,shaders:shaders.filter(s=>gl.isShader(s)).length,textures:textures.filter(t=>gl.isTexture(t)).length,framebuffers:Number(gl.isFramebuffer(fbo))};
   check(Object.values(alive).every(n=>n===0),'Owned GL objects retained');gl.getExtension('WEBGL_lose_context')?.loseContext();results.cleanup={alive,contextLost:gl.isContextLost()};globalThis.__nativeInkViewResult=results;
  }
 },{source,instrumented});
 report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable||report.pageErrors.length)throw Error('Source drift or page error');report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 await browser?.close();await server?.close();report.closed={browser:true,vite:true};
 report.limitations=['Only the local Chrome WebGL2 driver was executed; original application, JVM and native OpenGL4.1 were not executed.','Raw lookup uses the retained fragment prefix through texture(accumTex,rotated), with a diagnostic output after lookup; full tone uses the retained fragment body unchanged except ES300 declarations.','Nine finite fixtures test selection, orientation, aspect and tone within one 8-bit channel; this is not a universal driver precision bound.','This verifies the new display foundation, not its integration into the application, worker, source import, PNG or video paths.'];
 await mkdir('.cache',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,error:report.error?.message,cases:report.results?.cases.length}));
}
