import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourcePaths=['src/engine/sourcePerlinCpuTarget.ts','src/engine/sourcePerlinGpu.ts','src/engine/sourcePerlinGpuShader.ts','src/engine/sourceProcessingStroke.ts','src/engine/sourceProcessingPoints.ts','scripts/verify-source-perlin-target-resources.mjs'];
const sourceHashes=()=>Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])).then(Object.fromEntries);
const before=await sourceHashes();
const report={at:new Date().toISOString(),scope:'Real Chromium WebGL2 shared target ownership, resource accounting, input rejection and failure recovery.',nativeParity:'Not established; this verifier covers device semantics, not JVM/JOGL frame parity.'};
let server,browser;
try{
server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();await page.route('**/shared-target',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'shared-target');
const result=await page.evaluate(async()=>{
 const {SourcePerlinCpuTarget:Target}=await import('/src/engine/sourcePerlinCpuTarget.ts');
 const {SourcePerlinGpu}=await import('/src/engine/sourcePerlinGpu.ts');
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 const opts={width:7,height:5,density:1,samples:0,initialColor:[0,0,0,0]},base={projection:identity,background:[0,0,0,0],accumulation:false,primitives:[]};
 const live=new Set(),restores=[],contexts=[],tests=[];
 let assertions=0;const assert=(x,m)=>{assertions++;if(!x)throw Error(m);};
 const fail=(fn,code)=>{let got;try{fn();}catch(e){got=e.code;}assert(got===code,`Expected ${code}, got ${got}`);};
 for(const k of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const action of ['create','delete']){
  const name=action+k,old=WebGL2RenderingContext.prototype[name];restores.push(()=>WebGL2RenderingContext.prototype[name]=old);
  WebGL2RenderingContext.prototype[name]=function(...args){if(!contexts.includes(this))contexts.push(this);const r=old.apply(this,args);if(action==='create'&&r)live.add(r);if(action==='delete')live.delete(args[0]);return r;};
 }
 const run=(name,fn)=>{fn();assert(live.size===0,`${name} leaked ${live.size}`);tests.push(name);};
 const runAsync=async(name,fn)=>{await fn();assert(live.size===0,`${name} leaked ${live.size}`);tests.push(name);};
 const emptyPrimitive=(backing=new ArrayBuffer(0))=>({kind:'lines',buffers:{positions:new Float32Array(backing,0,0),directions:new Float32Array(),colors:new Float32Array(),indices:new Uint16Array(),caches:[]}});
 const gpuChannel=()=>({size:512,pixels:new Uint32Array(512*512).fill(0xff808080)});
 const gpuFrame=()=>({width:opts.width,height:opts.height,palette:new Uint32Array(256).fill(0xff4080c0),time:.5,noiseFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,timeSpeed:1,marchSteps:1,stepSize:.008,brightness:1.7,vignettePower:.1,fiberStrength:.7,renderStyle:0});
 try{
 run('siblings share one context and survive parent disposal',()=>{
  const a=new Target(opts),b=a.createSibling(opts);b.draw({...base,background:[1,.5,.25,.5]});const n=contexts.length;
  a.draw({...base,images:[b]});assert(contexts.length===n,'Sibling allocated second context');
  const pixels=a.readPixels();for(let i=0;i<pixels.length;i+=4){assert(pixels[i]===128&&pixels[i+1]===64&&pixels[i+2]===32&&pixels[i+3]===128,'Source-alpha image blend mismatch '+Array.from(pixels.slice(i,i+4)));}
  const before=b.readPixels();a.dispose();assert(b.diagnostics().deviceTargets===1,'Parent disposal dropped sibling');b.draw({...base,background:[1,.5,.25,.5]});assert(b.readPixels().every((v,i)=>v===before[i]),'Surviving target differs');b.dispose();
 });
 run('sibling disposal preserves parent and release happens last',()=>{const a=new Target(opts),b=a.createSibling(opts);a.draw(base);b.draw(base);b.dispose();assert(live.size>0,'Released device early');a.draw(base);a.dispose();a.dispose();});
 run('invalid source rejects self, foreign, unfinished, closed and failed',()=>{
  for(const kind of ['self','foreign','unfinished','initial-readback-only','closed','failed','fake','null']){
   const a=new Target(opts),b=kind==='foreign'?new Target(opts):a.createSibling(opts);let source=b;
   if(kind==='self')source=a;
   if(kind==='initial-readback-only')b.readPixels();
   if(kind==='null')source=null;
   if(kind==='foreign'||kind==='closed'||kind==='failed')b.draw(base);
   if(kind==='closed')b.dispose();if(kind==='failed')fail(()=>b.draw(null),'input');
   if(kind==='fake')source={};fail(()=>a.draw({...base,images:[source]}),'input');a.dispose();b.dispose();
  }
 });
 run('invalid and cancelled draw only poisons that target',()=>{
  for(const cancel of [false,true]){const a=new Target(opts),b=a.createSibling(opts);a.draw(base);b.draw(base);fail(()=>b.draw(cancel?base:null,cancel?()=>true:undefined),cancel?'cancelled':'input');a.draw(base);assert(a.diagnostics().deviceTargets===1,'Failed sibling still reserved');a.dispose();b.dispose();}
 });
 run('context loss invalidates every sibling and releases objects',()=>{
  for(const readback of [false,true]){
   const a=new Target(opts),b=a.createSibling(opts),uninitialized=a.createSibling(opts);a.draw(base);b.draw(base);
   contexts.at(-1).getExtension('WEBGL_lose_context').loseContext();
   fail(()=>readback?a.readPixels():a.draw(base),'render');fail(()=>b.draw(base),'failed');fail(()=>uninitialized.readPixels(),'failed');fail(()=>b.createSibling(opts),'failed');
   assert(live.size===0,'Context loss retained shared resources');a.dispose();b.dispose();uninitialized.dispose();
  }
 });
 run('attachment allocation failures preserve initialized siblings',()=>{
  for(const name of ['createTexture','createFramebuffer']){
   const a=new Target(opts),b=a.createSibling(opts);a.draw(base);const old=WebGL2RenderingContext.prototype[name];
   WebGL2RenderingContext.prototype[name]=()=>null;
   try{fail(()=>b.draw(base),'render');}finally{WebGL2RenderingContext.prototype[name]=old;}
   fail(()=>b.draw(base),'failed');assert(a.diagnostics().deviceTargets===1,'Attachment failure retained reservation');a.draw(base);a.dispose();b.dispose();
  }
 });
 run('MSAA capability failures remain local to their target',()=>{
  const a=new Target(opts);a.draw(base);const g=contexts.at(-1),supported=[...g.getInternalformatParameter(g.RENDERBUFFER,g.RGBA8,g.SAMPLES)];
  for(const samples of [2,4,8]){
   const b=a.createSibling({...opts,samples});
   if(supported.includes(samples)){b.draw({...base,background:[1,.5,.25,.5]});a.draw({...base,images:[b]});assert(a.readPixels()[0]===128,'MSAA source did not resolve before composition');}
   else{fail(()=>b.draw(base),'capability');fail(()=>a.createSibling({...opts,samples}).draw(base),'capability');a.draw(base);}
   b.dispose();
  }
  assert(a.diagnostics().deviceTargets===1,'Capability failure retained reservation');a.dispose();
 });
 run('shared reservation prevents lazy sibling budget escape',()=>{
  const large={...opts,width:3000,height:3000},a=new Target(large),b=a.createSibling(large),c=a.createSibling(large);fail(()=>a.createSibling(large),'capacity');assert(a.diagnostics().deviceTargets===3,'Failed sibling modified device');b.dispose();const d=a.createSibling(large);a.dispose();c.dispose();d.dispose();
 });
 run('stream input budget rejects before GL allocation',()=>{
  const a=new Target(opts),before=contexts.length;
  fail(()=>a.draw({...base,streamRetainedBytes:256*1024*1024,streamPrimitives:()=>{throw Error('Must reject before producer');}}),'capacity');
  assert(contexts.length===before,'Oversized stream allocated a context');a.dispose();
 });
 run('stream failure and cancellation poison only the consumer target',()=>{
  const empty={kind:'lines',buffers:{positions:new Float32Array(),directions:new Float32Array(),colors:new Float32Array(),indices:new Uint16Array(),caches:[]}};
  for(const cancel of [false,true]){
   const a=new Target(opts),b=a.createSibling(opts);a.draw(base);let cancelled=false,got;
   try{b.draw({...base,streamPrimitives:consume=>{consume(empty);if(cancel){cancelled=true;consume(empty);}else throw Error('producer failed');}},()=>cancelled);}catch(e){got=e;}
   assert(cancel?got?.code==='cancelled':got?.message==='producer failed','Stream failure identity lost');
   fail(()=>b.draw(base),'failed');a.draw(base);assert(a.diagnostics().deviceTargets===1,'Stream failure retained consumer');a.dispose();b.dispose();
  }
 });
 run('mixed retained and streamed backing stores share one frame budget',()=>{
  // The declared source reservation leaves 8 MiB. Each 5 MiB backing is
  // individually admissible; both remain alive even with zero-length views.
  // This tests accounting without allocating the declared 248 MiB snapshot.
  for(const shared of [false,true]){
   const a=new Target(opts),b=a.createSibling(opts),backing=new ArrayBuffer(5*1024*1024),retained=emptyPrimitive(backing),streamed=emptyPrimitive(shared?backing:new ArrayBuffer(5*1024*1024));
   const frame={...base,primitives:[retained],streamRetainedBytes:248*1024*1024,streamPrimitives:consume=>consume(streamed)};
   if(shared){b.draw(frame);assert(b.diagnostics().draws===1,'Shared backing was counted twice');}
   else{fail(()=>b.draw(frame),'capacity');fail(()=>b.readPixels(),'failed');}
   a.draw(base);a.dispose();b.dispose();
  }
 });
 run('swallowed consumption failures cannot publish partial frames',()=>{
  for(const cancel of [false,true]){
   const a=new Target(opts),b=a.createSibling(opts);a.draw(base);let cancelled=false,first,second;
   const frame={...base,streamPrimitives:consume=>{
    consume(emptyPrimitive());
    try{cancelled=cancel;consume(cancel?emptyPrimitive():null);}catch(error){first=error;}
    cancelled=false;
    try{consume(emptyPrimitive());}catch(error){second=error;}
   }};
   let escaped;try{b.draw(frame,()=>cancelled);}catch(error){escaped=error;}
   assert(first?.code===(cancel?'cancelled':'input'),'Wrong first consumption failure');
   assert(second===first&&escaped===first,'Consumer swallowed or replaced the first failure');
   fail(()=>b.readPixels(),'failed');a.draw(base);assert(a.diagnostics().deviceTargets===1,'Swallowed failure retained target');a.dispose();b.dispose();
  }
 });
 await runAsync('asynchronous producers fail before publication and contain rejection',async()=>{
  const unhandled=[],onUnhandled=event=>{unhandled.push(event.reason);event.preventDefault();};window.addEventListener('unhandledrejection',onUnhandled);
  try{
   for(const streamPrimitives of [async consume=>{await Promise.resolve();consume(emptyPrimitive());},async()=>{throw Error('Async producer rejected');},()=>({then(_resolve,reject){reject(Error('Thenable producer rejected'));}})]){
    const a=new Target(opts),b=a.createSibling(opts);a.draw(base);
    fail(()=>b.draw({...base,streamPrimitives}),'input');fail(()=>b.readPixels(),'failed');
    await new Promise(resolve=>setTimeout(resolve,0));a.draw(base);assert(a.diagnostics().deviceTargets===1,'Async producer retained target');a.dispose();b.dispose();
   }
   await new Promise(resolve=>setTimeout(resolve,0));assert(unhandled.length===0,'Async stream leaked an unhandled rejection');
  }finally{window.removeEventListener('unhandledrejection',onUnhandled);}
 });
 run('late consumption poisons the previously completed target',()=>{
  const a=new Target(opts),b=a.createSibling(opts);a.draw(base);let late;
  b.draw({...base,streamPrimitives:consume=>{late=consume;}});assert(b.diagnostics().draws===1,'Empty synchronous stream did not complete');
  fail(()=>late(emptyPrimitive()),'input');fail(()=>b.readPixels(),'failed');a.draw(base);assert(a.diagnostics().deviceTargets===1,'Late consumer retained target');a.dispose();b.dispose();
 });
 run('GPU drawing preserves shared target history, MSAA and sibling ownership',()=>{
  for(const smooth of [false,true]){
   const a=smooth?Target.createSmoothed(opts,4):new Target(opts),b=a.createSibling(opts),channel=gpuChannel(),frame=gpuFrame(),standalone=new SourcePerlinGpu(channel);
   const reference=standalone.render(frame);standalone.dispose();
   a.draw({...base,background:[1,0,0,1]});b.draw({...base,background:[0,1,0,.5]});const sibling=b.readPixels(),count=contexts.length;
   a.drawGpu(frame,channel,undefined,channel.pixels.byteLength*6);assert(contexts.length===count,'GPU draw created another context');
   const pixels=a.readPixels();assert(pixels.every((v,i)=>v===reference[i]),'Shared GPU differs from standalone shader');assert(b.readPixels().every((v,i)=>v===sibling[i]),'GPU overwrote sibling cache');
   const resources=live.size,bytes=a.diagnostics().gpuRepresentationBytes;a.drawGpu(frame,channel,undefined,channel.pixels.byteLength*6);
   assert(live.size===resources&&a.diagnostics().gpuRepresentationBytes===bytes,'Stable channel rebuilt GPU resources');
   a.draw({...base,accumulation:true,background:[0,0,0,.25]});const faded=a.readPixels();
   assert(faded.every((v,i)=>i%4===3?v===255:Math.abs(v-Math.round(pixels[i]*.75))<=1),'CPU fade did not retain GPU framebuffer pixels');
   assert(a.diagnostics().gpuRepresentationBytes===bytes,'CPU switch released GPU resources');
   a.drawGpu(frame,{...channel},undefined,channel.pixels.byteLength*6);assert(live.size===resources,'Changed channel leaked GPU resources');
   a.dispose();b.draw(base);assert(b.diagnostics().deviceTargets===1,'GPU owner disposal invalidated sibling');b.dispose();
  }
 });
 run('Scene GPU release preserves CPU and GPU canvas history on the same device',()=>{
  for(const samples of [0,4]){
   const a=new Target({...opts,samples}),b=a.createSibling(opts),channel=gpuChannel(),frame={...gpuFrame(),renderStyle:1};
   a.draw({...base,background:[.2,.4,.6,1]});b.draw({...base,background:[.7,.3,.1,1]});
   const cpu=a.readPixels(),sibling=b.readPixels(),cpuFacts=a.diagnostics(),contextCount=contexts.length;
   a.releaseSceneGpuBindings();assert(a.readPixels().every((v,i)=>v===cpu[i]),'Unbound CPU canvas changed');
   assert(JSON.stringify(a.diagnostics())===JSON.stringify(cpuFacts),'Empty GPU release changed CPU diagnostics');
   a.drawGpu(frame,channel,undefined,channel.pixels.byteLength*6);
   const gpu=a.readPixels(),before=a.diagnostics(),resourceCount=live.size;
   assert(gpu.some((v,i)=>i%4!==3&&v>0),'GPU history fixture is black');
   a.releaseSceneGpuBindings();const after=a.diagnostics();
   assert(after.gpuRepresentationBytes===0&&before.gpuRepresentationBytes>0,'Scene GPU reservation survived release');
   assert(before.deviceRepresentationBytes-after.deviceRepresentationBytes===before.gpuRepresentationBytes,'GPU reservation was not removed exactly');
   assert(after.targetRepresentationBytes===before.targetRepresentationBytes&&after.deviceTargets===before.deviceTargets&&after.initialized&&after.draws===before.draws,'Scene release changed attachments or draw count');
   assert(live.size===resourceCount-4,'Scene release did not release only two textures, VAO and program');
   assert(a.readPixels().every((v,i)=>v===gpu[i]),'Scene release changed existing GPU canvas pixels');
   assert(b.readPixels().every((v,i)=>v===sibling[i]),'Scene release modified sibling curve pixels');
   a.releaseSceneGpuBindings();assert(contexts.length===contextCount,'Scene release created another graphics context');
   const nextChannel={size:512,pixels:new Uint32Array(512*512).fill(0xffc0a020)},nextFrame={...frame,palette:new Uint32Array(256).fill(0xff30b070)};
   const oracle=new SourcePerlinGpu(nextChannel),expected=oracle.render(nextFrame);oracle.dispose();
   a.drawGpu(nextFrame,nextChannel);const replaced=a.readPixels();
   assert(replaced.every((v,i)=>v===expected[i]),'New Scene GPU content differs from standalone shader');
   assert(replaced.some((v,i)=>v!==gpu[i]),'New Scene fixture did not change GPU content');
   a.releaseSceneGpuBindings();a.draw({...base,background:[0,0,0,.25],accumulation:true});
   assert(a.readPixels().every((v,i)=>i%4===3?v===255:Math.abs(v-Math.round(replaced[i]*.75))<=1),'CPU accumulation lost the released GPU image');
   a.dispose();a.releaseSceneGpuBindings();b.dispose();
  }
 });
 run('failed partial Scene GPU cleanup retains accounting and retries without losing canvas',()=>{
  for(const resume of ['release','same-channel-draw','target-dispose']){
   const a=new Target(opts),b=a.createSibling(opts),channel=gpuChannel(),frame={...gpuFrame(),renderStyle:1};b.draw(base);a.drawGpu(frame,channel);
   const pixels=a.readPixels(),before=a.diagnostics(),old=WebGL2RenderingContext.prototype.deleteTexture;let injected=false,caught;
   // Throw after the first real texture delete. The remaining GPU handles,
   // including its program, must remain owned and conservatively reserved.
   WebGL2RenderingContext.prototype.deleteTexture=function(texture){const result=old.call(this,texture);if(texture&&!injected){injected=true;throw Error('Injected partial GPU release failure');}return result;};
   try{try{resume==='target-dispose'?a.dispose():a.releaseSceneGpuBindings();}catch(error){caught=error;}}finally{WebGL2RenderingContext.prototype.deleteTexture=old;}
   assert(caught?.message==='Injected partial GPU release failure','GPU disposal failure was swallowed');
   assert(JSON.stringify(a.diagnostics())===JSON.stringify(before),'Failed GPU release lost owner reservation');
   assert(a.readPixels().every((v,i)=>v===pixels[i]),'Failed GPU release changed target pixels');
   if(resume==='target-dispose'){a.dispose();assert(b.diagnostics().deviceTargets===1,'Dispose retry retained target');}
   else{
    if(resume==='release'){a.releaseSceneGpuBindings();assert(a.diagnostics().gpuRepresentationBytes===0,'Release retry retained GPU reservation');}
    else{a.drawGpu(frame,channel);assert(a.readPixels().every((v,i)=>v===pixels[i]),'Same-channel draw reused partially released GPU resources');}
    a.dispose();
   }
   b.draw(base);b.dispose();
  }
 });
 run('GPU source reservations and malformed frames fail before context allocation',()=>{
  for(const kind of ['total-capacity','source-underflow','source-null','wrong-dimensions','cancelled']){
   const a=new Target(opts),channel=gpuChannel(),frame=gpuFrame(),before=contexts.length;
   fail(()=>a.drawGpu(kind==='wrong-dimensions'?{...frame,width:frame.width+1}:frame,channel,kind==='cancelled'?()=>true:undefined,kind==='source-underflow'?0:kind==='source-null'?null:kind==='total-capacity'?256*1024*1024:undefined),kind==='total-capacity'?'capacity':kind==='cancelled'?'cancelled':'input');
   assert(contexts.length===before,'Invalid GPU request created context');fail(()=>a.readPixels(),'failed');a.dispose();
  }
 });
 run('GPU allocation failure and changed channel backing preserve siblings',()=>{
  for(const changed of [false,true]){
   const a=new Target(opts),b=a.createSibling(opts),channel=gpuChannel();b.draw(base);a.draw(base);
   if(changed){a.drawGpu(gpuFrame(),channel);channel.pixels=channel.pixels.slice();fail(()=>a.drawGpu(gpuFrame(),channel),'input');}
   else{const old=WebGL2RenderingContext.prototype.createTexture;WebGL2RenderingContext.prototype.createTexture=()=>null;try{fail(()=>a.drawGpu(gpuFrame(),channel),'render');}finally{WebGL2RenderingContext.prototype.createTexture=old;}}
   b.draw(base);assert(b.diagnostics().deviceTargets===1,'GPU failure retained consumer');a.dispose();b.dispose();
  }
 });
 run('context loss releases CPU and GPU resources across the whole device',()=>{
  const a=new Target(opts),b=a.createSibling(opts);a.drawGpu(gpuFrame(),gpuChannel());b.draw(base);contexts.at(-1).getExtension('WEBGL_lose_context').loseContext();
  fail(()=>a.drawGpu(gpuFrame(),gpuChannel()),'render');fail(()=>b.readPixels(),'failed');assert(live.size===0,'GPU context loss leaked resources');a.dispose();b.dispose();
 });
 run('source smoothing selection reuses the returned target device',()=>{
  const before=contexts.length,a=Target.createSmoothed(opts,8),g=contexts.at(-1),expected=Math.min(8,g.getParameter(g.MAX_SAMPLES));
  assert(contexts.length===before+1,'Smoothing factory created a probe context');assert(a.diagnostics().samples===(expected>1?expected:0),'Source min(request,maxSamples) policy changed');
  const selected=a.selectedSamples(8);assert(selected===a.diagnostics().samples,'Same device query differs');const b=a.createSibling({...opts,samples:selected});a.draw(base);b.draw(base);assert(contexts.length===before+1,'Sibling introduced another context');a.dispose();b.dispose();
 });
 run('unsupported source-selected samples do not silently choose another count',()=>{
  const a=new Target(opts);a.draw(base);const old=WebGL2RenderingContext.prototype.getParameter,oldFormat=WebGL2RenderingContext.prototype.getInternalformatParameter;
  WebGL2RenderingContext.prototype.getParameter=function(p){return p===this.MAX_SAMPLES?2:old.call(this,p);};
  WebGL2RenderingContext.prototype.getInternalformatParameter=function(...args){return args[2]===this.SAMPLES?new Int32Array([4]):oldFormat.apply(this,args);};
  try{fail(()=>a.selectedSamples(4),'capability');}finally{WebGL2RenderingContext.prototype.getParameter=old;WebGL2RenderingContext.prototype.getInternalformatParameter=oldFormat;}
  a.dispose();
 });
 run('unknown public values are classified input failures',()=>{
  for(const initialColor of [{length:4},new Array(4),null,'abcd',[0,0,0,NaN]])fail(()=>new Target({...opts,initialColor}),'input');
  for(const frame of [null,{}, {...base,background:new Array(4)}, {...base,images:{}}, {...base,primitives:[null]}, {...base,primitives:[{kind:'lines',buffers:{}}]}]){const t=new Target(opts);fail(()=>t.draw(frame),'input');t.dispose();}
  const t=new Target(opts);fail(()=>t.readPixels(true),'input');t.dispose();
 });
 return {tests,passed:tests.length,assertions,retainedResources:live.size};
 }finally{restores.reverse().forEach(f=>f());}
});
const after=await sourceHashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during resource verification');
Object.assign(report,{status:'passed',sourceHashes:after,...result});
await writeFile('.cache/v2-perlin-target-resources-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,passed:result.passed,assertions:result.assertions,retainedResources:result.retainedResources,report:'.cache/v2-perlin-target-resources-verification.json'}));
}catch(error){Object.assign(report,{status:'failed',error:String(error.stack??error)});await writeFile('.cache/v2-perlin-target-resources-verification.json',JSON.stringify(report,null,2)+'\n');throw error;}finally{await browser?.close();await server?.close();}
