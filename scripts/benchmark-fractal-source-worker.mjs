import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Complete current-production Worker tasks, without a different-math baseline.
// The injected observer forwards real requests/results and real GL calls. It
// adds transport metadata only; it never substitutes samples, colors or pixels.
const script='scripts/benchmark-fractal-source-worker.mjs';
const directory=process.argv[2]??`.cache/fractal-source-worker-cost-${Date.now()}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);else throw Error('Unsupported source entry '+p);}return out;}
async function snapshot(){return Object.fromEntries(await Promise.all([...await files('src'),script,'package-lock.json'].sort().map(async p=>[p,sha(await readFile(p))])));}
function workerObserver(){
 const originalPost=self.postMessage.bind(self),originalContext=OffscreenCanvas.prototype.getContext;
 const devices=[],contexts=new WeakMap();let active;
 OffscreenCanvas.prototype.getContext=function(...args){const gl=originalContext.apply(this,args);if(gl&&args[0]==='webgl2'&&!contexts.has(gl)){
  const ext=gl.getExtension('WEBGL_debug_renderer_info'),device={context:devices.length+1,vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};devices.push(device);contexts.set(gl,device.context);
 }return gl;};
 for(const name of ['drawArrays','drawElements','readPixels','getBufferSubData','createProgram','compileShader','linkProgram']){
  const old=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){if(active)active.glCalls[name]=(active.glCalls[name]??0)+1;return old.apply(this,args);};
 }
 self.addEventListener('message',({data})=>{if(data.operation==='generate')active={id:data.id,sessionId:data.sessionId,started:performance.now(),glCalls:{}};});
 self.postMessage=function(data,...args){if(active&&data.operation==='generate'&&data.id===active.id&&data.sessionId===active.sessionId&&!data.progress){
  const observation={elapsedToPostMs:performance.now()-active.started,glCalls:active.glCalls,devices:devices.map(x=>({...x}))};data={...data,__fractalCostObserver:observation};active=undefined;
 }return originalPost(data,...args);};
}
await mkdir(directory,{recursive:false});
const report={at:new Date().toISOString(),status:'running',scope:'Current source-profile Newton/Nova complete Generator Worker tasks at exact requested sizes. Two new Worker instances, one same-request warm render and one color-only rerender per instance/case. Costs only: no old CPU speedup or original-runtime comparison.',directory,sourceBefore:await snapshot(),pageErrors:[],cases:[]};
await writeFile(directory+'/benchmark.mjs',await readFile(script),{flag:'wx'});
let server,browser,page;const start=performance.now();
try{
 const observer='('+workerObserver.toString()+')();\n';
 server=await createServer({plugins:[{name:'passive-fractal-worker-cost-observer',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/src/engine/generate.worker.ts'))return{code:observer+code,map:null};}}],server:{host:'127.0.0.1',port:5470,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));report.browserVersion=browser.version();report.endpoint=server.resolvedUrls.local[0];
 await page.route('**/fractal-source-worker-cost',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Source fractal Worker costs</title>'}));await page.goto(report.endpoint+'fractal-source-worker-cost');
 await page.evaluate(()=>{
  const Native=window.Worker;window.__fractalCosts={requests:[],responses:[],workers:[],cases:[],boundaries:[]};const s=window.__fractalCosts;
  window.Worker=class extends Native{constructor(...args){super(...args);this.costId=s.workers.length+1;this.record={id:this.costId,terminated:false};s.workers.push(this.record);this.addEventListener('message',({data})=>{if(data.operation==='generate'&&!data.progress){const{output,...rest}=data;s.responses.push({worker:this.costId,...rest,output:output?{type:output.type,backend:output.backend,width:output.width,height:output.height,fractalRender:output.fractalRender}:undefined});}});}postMessage(data,...args){if(data.operation==='generate')s.requests.push({worker:this.costId,id:data.id,sessionId:data.sessionId,context:structuredClone(data.context)});return super.postMessage(data,...args);}terminate(){this.record.terminated=true;return super.terminate();}};
 });
 // Each case uses bounded iterations. Browser/device caches remain uncontrolled
 // across new Workers, so 'cold' means a new application instance, not cold VRAM.
 for(const formula of ['newton','nova'])for(const [width,height]of [[320,240],[1280,720]]){
  const item=await page.evaluate(async({formula,width,height})=>{
   const check=(ok,m)=>{if(!ok)throw Error(m);},hash=async pixels=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');
   const{createScene}=await import('/src/engine/document.ts'),{definitions}=await import('/src/scenes/complex.ts'),{Generator}=await import('/src/engine/client.ts');
   const state=window.__fractalCosts,scene=createScene(definitions.find(x=>x.kind==='fractal'));
   scene.id=`source-cost-${formula}-${width}x${height}`;scene.name=scene.id;scene.timeline={...scene.timeline,tracks:[],loop:false,duration:1};
   Object.assign(scene.settings,{fractalNumericProfile:'mathart-1.7.8-newton-nova-v1',formula,variant:'mandelbrot',power:3,powerImag:0,relaxation:1,tolerance:1e-6,iterations:64,startReal:1,startImag:0,juliaReal:0,juliaImag:0,centerX:formula==='newton'?.8:.02,centerY:formula==='newton'?.17:.01,centerXLow:2**-58,centerYLow:-(2**-60),zoom:formula==='newton'?20:10000,rotation:.23,fractalBackend:'webgl2',perturbationPrecision:'medium',renderMethod:'one-pass',fractalColorVersion:2,outsideColoring:'basic',insideColoring:'basic',outsideGradientOffset:0,insideGradientOffset:0});
   const context={time:0,width,height,quality:'export',fractalViewport:{logicalWidth:width,logicalHeight:height,target:'offscreen'}};
   const item={formula,width,height,iterations:64,settings:scene.settings,rows:[],comparisons:[]};state.cases.push(item);
   for(let repeat=0;repeat<2;repeat++){
    const generator=new Generator();let coldHash;
    try{
     for(const route of ['new-worker-first','same-worker-repeat','same-worker-color-only']){
      const requestScene=structuredClone(scene);if(route==='same-worker-color-only'){requestScene.settings.outsideGradientOffset=.173;requestScene.settings.insideGradientOffset=.173;}
      const before=state.responses.length,started=performance.now(),output=await generator.generate(requestScene,context),completed=performance.now();
      const response=state.responses.slice(before).find(x=>x.output),facts=output.fractalRender,observation=response?.__fractalCostObserver;
      const row={repeat,route,wallMs:completed-started,producerStats:output.stats,backend:output.backend,width:output.width,height:output.height,facts,warnings:output.warnings,observer:observation,worker:response?.worker};item.rows.push(row);
      check(output.type==='raster'&&output.backend==='webgl2'&&output.width===width&&output.height===height&&output.pixels.length===width*height*4,'Exact full output dimensions/backend required');
      check(facts?.profile==='mathart-1.7.8-newton-nova-v1'&&facts.execution.samples===width*height&&facts.execution.cpuOrbitSamples===0&&facts.execution.probeSamples===0,'Expected every pixel through actual source GPU without probes or CPU');
      check(facts.rasterSize[0]===width&&facts.rasterSize[1]===height&&facts.logicalSize[0]===width&&facts.logicalSize[1]===height&&facts.logicalSizeProvenance==='requested-output-local','Requested/logical/raster sizes drifted');
      check(observation?.devices.length>0&&(observation.glCalls.drawArrays??0)>0&&(observation.glCalls.readPixels??0)>0,'Actual Worker GL draws/readback/device evidence missing');
      check(facts.execution.rasterDraws>0,'Source fragment raster not executed');
      if(route!=='new-worker-first')check(facts.reference.builds===0&&facts.reference.uploads===0&&facts.execution.rasterAllocations===0,'Warm or color request unexpectedly rebuilt reference or raster allocation');
      row.sha256=await hash(output.pixels);let varied=false;for(let i=4;i<output.pixels.length;i+=4)if(output.pixels[i]!==output.pixels[0]||output.pixels[i+1]!==output.pixels[1]||output.pixels[i+2]!==output.pixels[2]){varied=true;break;}row.nonuniform=varied;
      if(route==='new-worker-first')coldHash=row.sha256;else{const equal=row.sha256===coldHash;item.comparisons.push({repeat,route,coldHash,actualHash:row.sha256,equal});check(route==='same-worker-repeat'?equal:!equal,route==='same-worker-repeat'?'Identical warm task changed RGBA':'Color-only edit did not alter actual pixels');}
     }
    }finally{generator.dispose();}
   }
   check(item.rows.every(row=>state.workers.find(w=>w.id===row.worker)?.terminated),'Case Worker cleanup incomplete');return item;
  },{formula,width,height});
  report.cases.push(item);await writeFile(`${directory}/${formula}-${width}x${height}.json`,json(item),{flag:'wx'});
 }
 report.boundaries=await page.evaluate(async()=>{
  const{createScene}=await import('/src/engine/document.ts'),{definitions}=await import('/src/scenes/complex.ts'),{Generator}=await import('/src/engine/client.ts');
  const check=(ok,m)=>{if(!ok)throw Error(m);},state=window.__fractalCosts,s=createScene(definitions.find(x=>x.kind==='fractal'));s.timeline.tracks=[];Object.assign(s.settings,{formula:'newton',power:3,iterations:64,fractalNumericProfile:'mathart-1.7.8-newton-nova-v1',perturbationPrecision:'medium',renderMethod:'one-pass',fractalBackend:'cpu'});
  const ctx={time:0,width:32,height:24,quality:'export',fractalViewport:{logicalWidth:32,logicalHeight:24,target:'offscreen'}},g=new Generator();
  try{
   let error;try{await g.generate(s,ctx);}catch(e){error={name:e.name,message:e.message};}check(error&&/WebGL2/.test(error.message),'Explicit CPU request did not fail');state.boundaries.push({kind:'explicit-cpu-failure',error});
   s.settings.fractalBackend='webgl2';const recovered=await g.generate(s,ctx);check(recovered.backend==='webgl2','Failure recovery did not return actual GPU');state.boundaries.push({kind:'same-worker-error-recovery',facts:recovered.fractalRender});
   const pending=g.generate(s,{...ctx,width:1280,height:720}),settled=pending.then(()=>({resolved:true}),e=>({resolved:false,name:e.name,message:e.message}));g.cancel();const result=await settled;check(!result.resolved,'Cancellation unexpectedly returned a completed output');state.boundaries.push({kind:'immediate-public-cancel',timing:'After actual request dispatch; no claim that a GPU draw began before termination.',result});
   const after=await g.generate(s,ctx);check(after.backend==='webgl2','Cancelled Generator did not recreate its Worker');state.boundaries.push({kind:'new-worker-cancel-recovery',facts:after.fractalRender});
  }finally{g.dispose();}return state.boundaries;
 });
 report.observed=await page.evaluate(()=>({requests:window.__fractalCosts.requests,workers:window.__fractalCosts.workers,responseCount:window.__fractalCosts.responses.length}));
 if(report.pageErrors.length||report.observed.workers.some(x=>!x.terminated))throw Error('Page errors or live Workers remain');report.status='passed';
}catch(error){report.status='failed';report.error={message:String(error),stack:error.stack};if(page)try{report.partial=await page.evaluate(()=>window.__fractalCosts);}catch{};process.exitCode=1;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup={browserClosed:browser?!browser.isConnected():true,viteClosed:server?!server.httpServer?.listening:true,errors:closed.flatMap(x=>x.status==='rejected'?[String(x.reason)]:[])};
 report.elapsedMs=performance.now()-start;report.sourceAfter=await snapshot();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable||!report.cleanup.browserClosed||!report.cleanup.viteClosed||report.cleanup.errors.length){report.status='failed';process.exitCode=1;}
 report.limitations=['No original application/JVM execution, original framebuffer parity, or comparison against old CPU mathematics.','New-worker first tasks include Worker startup, module loading, GPU context/program setup and real output transport. Driver/device caches cannot be reset or proven cold. Same-worker tasks reuse the owner cache.','Per-task wall time ends at completed Generator delivery; hashing/assertions and cleanup are outside that interval. Whole script elapsed includes observation, hashing, setup, failures and cleanup.','Passive GL observation adds timing overhead and records actual device strings; software rendering remains visible rather than being relabelled hardware.','Public cancel is immediate after dispatch, not a claim of cancellation during a GPU draw; source device-failure injection is covered elsewhere.','Worker termination and browser/server closure are checked here; live GPU-handle destruction and driver VRAM release after Worker termination are not directly observable.','Whole process-family CPU/peak RSS and cleanup belong to the external observer. Agent token cost and VRAM were not measured.'];
 await writeFile(directory+'/report.json',json(report),{flag:'wx'});console.log(json({report:directory+'/report.json',status:report.status,sourceStable:report.sourceStable,cases:report.cases.length,tasks:report.cases.reduce((n,c)=>n+c.rows.length,0),elapsedMs:report.elapsedMs,error:report.error?.message,cleanup:report.cleanup}));
}
