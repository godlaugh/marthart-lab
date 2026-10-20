import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourcePaths=['src/engine/sourcePerlinCpuTarget.ts','src/engine/sourceProcessingStroke.ts','src/engine/sourceProcessingPoints.ts','scripts/verify-source-perlin-target-resources.mjs'];
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
