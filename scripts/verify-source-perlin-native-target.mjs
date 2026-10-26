/** Real CGL -> retained WebGL target handoff. Run explicitly, never from Vitest.
 * Usage: node scripts/verify-source-perlin-native-target.mjs OUTPUT BACKEND_JSON
 *        CAPTURE_DIRECTORY [FIXTURE_JSON]
 * CAPTURE_DIRECTORY contains native-{filament,swirl}/ from the passive original
 * capture. No original application, GUI, or source field mutation is executed. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {sourceNativeVerificationServer} from './lib/source-native-verification-server.mjs';
const [directory,backendFile,referenceDirectory,fixtureFile='tests/fixtures/source-perlin/native-mathematical-20261026.json']=process.argv.slice(2);
assert(directory&&backendFile&&referenceDirectory,'Supply OUTPUT BACKEND_JSON CAPTURE_DIRECTORY [FIXTURE_JSON]');
await mkdir(directory,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=['src/engine/sourcePerlinNativeDrawing.ts','src/engine/sourcePerlinCpuTarget.ts','src/engine/sourcePerlinGpu.ts','src/engine/sourcePerlinGpuShader.ts','src/engine/sourceDrawingFrame.ts','src/engine/sourceNativeClient.ts','scripts/verify-source-perlin-native-target.mjs'];
const hashes=()=>Promise.all(paths.map(async path=>[path,sha(await readFile(path))])).then(Object.fromEntries);
const fixture=JSON.parse(await readFile(fixtureFile,'utf8')),inputs=[];
// Verify reference identity before opening the browser or starting the service.
for(const spec of fixture.cases){
 const root=resolve(referenceDirectory,'native-'+spec.name),textures=JSON.parse(await readFile(root+'/draw-textures.json','utf8'));
 const uniforms=JSON.parse(await readFile(root+'/draw-uniforms.json','utf8'));
 for(const [name,key] of [['u_palette','palette'],['u_channel0','channel0']])assert.equal(sha(await readFile(root+'/'+textures[name].levels[0].path)),spec.textureLevel0Sha256[key]);
 for(const frame of spec.frames)assert.equal(sha(await readFile(root+'/math-step-'+frame.step+'.rgba')),frame.rgbaBottomUpSha256);
 inputs.push({name:spec.name,uniforms,textures,frames:spec.frames});
}
const report={at:new Date().toISOString(),status:'running',scope:'Actual CGL mathematical output -> SourcePerlinCpuTarget native ACK -> single-sample/4x MSAA history. Full original mathematical layer hashes for two presets/five fixed times; independent small-target CPU fade reference, pending/cancellation/capacity/context-loss boundaries. Not original GUI clock, formula/watermark or cross-device parity.',fixture:resolve(fixtureFile),reference:resolve(referenceDirectory),sourceBefore:await hashes(),errors:[]};
let host,browser,page;
try{
 host=await sourceNativeVerificationServer(directory,backendFile);report.backend=host.backend;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});report.browser=browser.version();page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
 await page.route('**/perlin-native-target',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/perlin-reference/**',async route=>{
  const match=new URL(route.request().url()).pathname.match(/^\/perlin-reference\/(filament|swirl)\/(u_palette-level0\.rgba|u_channel0-level0\.rgba)$/);
  if(!match)return route.abort();await route.fulfill({contentType:'application/octet-stream',body:await readFile(resolve(referenceDirectory,'native-'+match[1],match[2]))});
 });
 await page.goto(host.origin+'perlin-native-target');
 await page.evaluate(async ({inputs,width,height})=>{
  const {SourcePerlinCpuTarget:Target}=await import('/src/engine/sourcePerlinCpuTarget.ts');
  const {prepareSourcePerlinNativeDrawing}=await import('/src/engine/sourcePerlinNativeDrawing.ts');
  const {renderSourceNativeFrame}=await import('/src/engine/sourceNativeClient.ts');
  const {ensureSourceNativeLease}=await import('/src/engine/sourceNativeLease.ts');
  const result=window.__perlinNativeTargetReport={cases:[],boundaries:[],history:[],nativeRequests:0,contexts:0,remainingGlObjects:null};
  const check=(yes,reason)=>{if(!yes)throw Error(reason);},hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const live=new Set(),restores=[];
  for(const kind of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const action of ['create','delete']){
   const name=action+kind,old=WebGL2RenderingContext.prototype[name];restores.push(()=>{WebGL2RenderingContext.prototype[name]=old;});WebGL2RenderingContext.prototype[name]=function(...args){const value=old.apply(this,args);if(action==='create'&&value)live.add(value);if(action==='delete'&&args[0])live.delete(args[0]);return value;};
  }
  const oldContext=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){if(args[0]==='webgl2')result.contexts++;return oldContext.apply(this,args);};restores.push(()=>{OffscreenCanvas.prototype.getContext=oldContext;});
  const owned=new Set(),make=(w,h,samples)=>{const target=new Target({width:w,height:h,density:1,samples,initialColor:[0,0,0,0]});owned.add(target);return target;},dispose=target=>{target.dispose();owned.delete(target);};
  const failure=(run,code)=>{let error;try{run();}catch(e){error=e;}check(error?.code===code,'Expected '+code+', got '+String(error));};
  const packed=bytes=>{const out=new Uint32Array(bytes.length/4);for(let i=0;i<out.length;i++){const p=i*4;out[i]=((bytes[p+3]<<24)|(bytes[p]<<16)|(bytes[p+1]<<8)|bytes[p+2])>>>0;}return out;};
  const load=async input=>{
   const bytes=async name=>new Uint8Array(await(await fetch('/perlin-reference/'+input.name+'/'+name+'-level0.rgba')).arrayBuffer());
   const palette=packed(await bytes('u_palette')),channel={size:input.textures.u_channel0.levels[0].width,pixels:packed(await bytes('u_channel0'))};
   const uniforms={};for(const name of ['noiseFrequency','warpAmplitude','warpFrequency','directionOffset','timeSpeed','marchSteps','stepSize','brightness','vignettePower','fiberStrength','renderStyle'])uniforms[name]=input.uniforms.find(u=>u.name==='u_'+name).value[0];
   return{palette,channel,uniforms};
  };
  let sequence=0;
  await ensureSourceNativeLease(new AbortController().signal);
  const native=async(frame,channel,options)=>{const drawing=prepareSourcePerlinNativeDrawing(frame,channel,options);result.nativeRequests++;return renderSourceNativeFrame({generation:1,sequence:++sequence,width:frame.width,height:frame.height,samples:0,clear:[0,0,0,1],drawing},options);};
  const cpu={projection:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),background:[.125,.25,.375,.35],accumulation:true,primitives:[]};
  // Independent reference: seed every MSAA sample with glClear under a one-pixel
  // scissor, then execute one constant-color source blend. No native handoff or
  // target implementation is used to create/update this expected history.
  function historyReference(w,h,samples){
   const g=new OffscreenCanvas(w,h).getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false,depth:false,stencil:false});check(g,'Reference WebGL2 unavailable');
   const texture=g.createTexture(),resolved=g.createFramebuffer(),draw=samples?g.createFramebuffer():resolved,renderbuffer=samples?g.createRenderbuffer():null;
   g.bindTexture(g.TEXTURE_2D,texture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.bindFramebuffer(g.FRAMEBUFFER,resolved);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
   if(samples){g.bindRenderbuffer(g.RENDERBUFFER,renderbuffer);g.renderbufferStorageMultisample(g.RENDERBUFFER,samples,g.RGBA8,w,h);g.bindFramebuffer(g.FRAMEBUFFER,draw);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.RENDERBUFFER,renderbuffer);}
   check(g.checkFramebufferStatus(g.FRAMEBUFFER)===g.FRAMEBUFFER_COMPLETE,'Reference target incomplete');
   const p=g.createProgram(),shaders=[];
   for(const [kind,source] of [[g.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(1,1),vec2(-1,-1),vec2(1,1),vec2(-1,1));gl_Position=vec4(corners[gl_VertexID],0,1);}'],[g.FRAGMENT_SHADER,'#version 300 es\nprecision mediump float;uniform vec4 fillColor;out vec4 c;void main(){c=fillColor;}']]){const s=g.createShader(kind);shaders.push(s);g.shaderSource(s,source);g.compileShader(s);check(g.getShaderParameter(s,g.COMPILE_STATUS),g.getShaderInfoLog(s));g.attachShader(p,s);}
   g.linkProgram(p);check(g.getProgramParameter(p,g.LINK_STATUS),g.getProgramInfoLog(p));const vao=g.createVertexArray();g.bindVertexArray(vao);g.viewport(0,0,w,h);g.disable(g.DEPTH_TEST);g.disable(g.CULL_FACE);
   const complete=()=>{if(samples){g.bindFramebuffer(g.READ_FRAMEBUFFER,draw);g.bindFramebuffer(g.DRAW_FRAMEBUFFER,resolved);g.blitFramebuffer(0,0,w,h,0,0,w,h,g.COLOR_BUFFER_BIT,g.NEAREST);}check(g.getError()===g.NO_ERROR,'Reference GL failure');};
   return{
    seed(pixels){g.bindFramebuffer(g.FRAMEBUFFER,draw);g.enable(g.SCISSOR_TEST);g.disable(g.DITHER);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;g.scissor(x,h-1-y,1,1);g.clearColor(...Array.from(pixels.subarray(i,i+4),n=>n/255));g.clear(g.COLOR_BUFFER_BIT);}g.disable(g.SCISSOR_TEST);complete();},
    fade(){g.bindFramebuffer(g.FRAMEBUFFER,draw);g.useProgram(p);g.uniform4fv(g.getUniformLocation(p,'fillColor'),cpu.background);g.enable(g.DITHER);g.enable(g.BLEND);g.blendEquationSeparate(g.FUNC_ADD,g.FUNC_ADD);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE);g.drawArrays(g.TRIANGLES,0,6);complete();},
    pixels(){g.bindFramebuffer(g.FRAMEBUFFER,resolved);const bottom=new Uint8Array(w*h*4),top=new Uint8Array(bottom.length);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,bottom);for(let y=0;y<h;y++)top.set(bottom.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);check(g.getError()===g.NO_ERROR,'Reference read failure');return top;},
    dispose(){g.deleteVertexArray(vao);g.deleteProgram(p);for(const s of shaders)g.deleteShader(s);g.deleteFramebuffer(resolved);if(draw!==resolved)g.deleteFramebuffer(draw);g.deleteRenderbuffer(renderbuffer);g.deleteTexture(texture);g.getExtension('WEBGL_lose_context')?.loseContext();}
   };
  }
  try{
   for(const input of inputs){const source=await load(input);
    for(const samples of [0,4]){const target=make(width,height,samples);try{
     for(const expected of input.frames){const time=new Float32Array(new Uint32Array([expected.timeBits]).buffer)[0],frame={...source.uniforms,palette:source.palette,time,width,height};
      await target.drawGpuAsync(frame,source.channel,native);const pixels=target.readPixels(),actual=await hash(pixels),diagnostics=target.diagnostics();
      result.cases.push({name:input.name,step:expected.step,samples,pixels:pixels.length/4,rgbaSha256:actual,expected:expected.rgbaTopDownSha256,receipt:diagnostics.sourcePixelRenderer});
      check(actual===expected.rgbaTopDownSha256,input.name+' '+expected.step+' samples '+samples+' mathematical pixels differ');check(diagnostics.sourcePixelRenderer?.sequence===sequence&&diagnostics.sourcePixelRenderer?.samples===0,'Native receipt missing or stale');
     }
    }finally{dispose(target);}}
   }
   const source=await load(inputs[0]),small={...source.uniforms,palette:source.palette,time:.5,width:17,height:13};
   for(const samples of [0,4]){const target=make(17,13,samples),expected=historyReference(17,13,samples);try{
    for(const time of [.5,1.25]){let completed;await target.drawGpuAsync({...small,time},source.channel,async(...args)=>(completed=await native(...args)));
     expected.seed(completed.pixels);check(await hash(target.readPixels())===await hash(expected.pixels()),'Native replacement seed mismatch');
     target.draw(cpu);expected.fade();check(!target.diagnostics().sourcePixelRenderer,'CPU draw retained a native receipt');
     const actual=await hash(target.readPixels()),want=await hash(expected.pixels());result.history.push({samples,time,actual,expected:want});check(actual===want,'CPU fade after native handoff differs');
    }
   }finally{dispose(target);expected.dispose();}}
   {
    const target=make(17,13,4),sibling=target.createSibling({width:17,height:13,density:1,samples:0,initialColor:[0,0,0,0]});owned.add(sibling);
    let unlock,ready,completed,cancelled=false;const gate=new Promise(r=>{unlock=r;}),observed=new Promise(r=>{ready=r;});
    const pending=target.drawGpuAsync(small,source.channel,async(...args)=>{completed=await native(...args);ready();await gate;return completed;},()=>cancelled);
    await observed;const held=target.diagnostics().deviceRepresentationBytes;
    failure(()=>target.readPixels(),'input');failure(()=>target.dispose(),'input');failure(()=>target.draw(cpu),'input');failure(()=>target.releaseSceneGpuBindings(),'input');
    failure(()=>sibling.withWorkingBytes(256*1024*1024-held+1,()=>{}),'capacity');cancelled=true;unlock();let error;try{await pending;}catch(e){error=e;}
    check(error?.code==='cancelled','Pending soft cancellation lost identity');check(target.diagnostics().sourcePixelRenderer?.sequence===completed.sequence,'Cancelled ACK was not committed');check(await hash(target.readPixels())===await hash(completed.pixels),'Cancelled ACK history was lost');
    result.boundaries.push({name:'pending ACK cancellation and reservation',held,receipt:target.diagnostics().sourcePixelRenderer});dispose(target);dispose(sibling);
   }
   {
    const target=make(17,13,0),before=result.nativeRequests,contexts=result.contexts;let error;
    try{await target.drawGpuAsync(small,source.channel,native,undefined,256*1024*1024);}catch(e){error=e;}
    check(error?.code==='capacity'&&result.nativeRequests===before&&result.contexts===contexts,'Capacity rejection dispatched native or allocated GL');dispose(target);result.boundaries.push({name:'capacity before dispatch',nativeRequests:before});
   }
   {
    const target=make(17,13,0);await target.drawGpuAsync(small,source.channel,native);
    // The observer captures the already owned target context through its actual
    // native-pixel upload; no private target field is exposed or patched.
    const old=WebGL2RenderingContext.prototype.texSubImage2D;let context;WebGL2RenderingContext.prototype.texSubImage2D=function(...args){context=this;return old.apply(this,args);};
    try{await target.drawGpuAsync({...small,time:1},source.channel,native);}finally{WebGL2RenderingContext.prototype.texSubImage2D=old;}
    check(context,'No owned target upload was observed');context.getExtension('WEBGL_lose_context').loseContext();failure(()=>target.readPixels(),'render');failure(()=>target.diagnostics(),'failed');dispose(target);result.boundaries.push({name:'context loss rejects old native facts'});
   }
   result.remainingGlObjects=live.size;check(live.size===0,'Retained WebGL objects after verification: '+live.size);
  }finally{for(const target of owned)target.dispose();result.remainingGlObjects=live.size;for(const restore of restores.reverse())restore();}
 },{inputs,width:fixture.width,height:fixture.height});
 report.result=await page.evaluate(()=>window.__perlinNativeTargetReport);assert.equal(report.result.cases.length,20);assert.equal(report.result.remainingGlObjects,0);assert.equal(report.errors.length,0);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);report.result=await page?.evaluate(()=>window.__perlinNativeTargetReport).catch(()=>undefined);process.exitCode=1;}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),host?.close()]);report.cleanup=cleanup.map(r=>r.status==='fulfilled'?{status:r.status}:{status:r.status,error:String(r.reason)});
 report.remainingServiceProcesses=host?.service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable||cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.result?.cases.length,remainingServiceProcesses:report.remainingServiceProcesses,sourceStable:report.sourceStable,error:report.error}));
}
