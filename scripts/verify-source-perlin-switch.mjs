/** Public CPU browser integration evidence. Uses the real App, Worker, export service,
 * downloaded files and independent PNG decoding. Fresh generation shares the
 * local engine, so matching hashes do not claim native JVM/JOGL parity. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';

const check=(v,m)=>{if(!v)throw Error(m);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const runStarted=performance.now();
const prefix='.cache/v2-source-perlin-switch';
const hashes=async()=>{const paths=(await Promise.all(['src','server'].map(async root=>(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`)))).flat();paths.push('scripts/verify-source-perlin-switch.mjs');paths.sort();return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));};
const before=await hashes(),directory=await mkdtemp('.cache/perlin-cpu-public-service-');
const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const report={at:new Date().toISOString(),scope:'Unified Perlin actual browser model/target lifecycle and public UI backend switching with retained Worker; both-setting persistence. Local pipeline verification, not native JVM/JOGL parity.',nativeParity:false,directory,exports:[]};
let browser,page,server,exportServer;const errors=[],consoleErrors=[];
try{
 exportServer=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1360,height:920},deviceScaleFactor:1,acceptDownloads:true});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 const installAudit=async page=>page.addInitScript(()=>{
  const Native=window.Worker;window.__perlinAudit={nextWorker:0,requests:[],completed:[],errors:[]};
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.auditId=++window.__perlinAudit.nextWorker;this.addEventListener('message',async({data})=>{if(data.operation==='generate'&&data.output){const o=data.output;window.__perlinAudit.completed.push({worker:this.auditId,id:data.id,frame:o.sourceCameraFrame,perlinFrame:o.sourcePerlinFrame,type:o.type,backend:o.backend,pixelLength:o.pixels?.length,pixelSha:o.pixels?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',o.pixels))).map(v=>v.toString(16).padStart(2,'0')).join(''):undefined,warnings:o.warnings,stats:o.stats});}if(data.error)window.__perlinAudit.errors.push(data.error);});}
   postMessage(message,...args){if(message.operation==='generate')window.__perlinAudit.requests.push({...structuredClone(message),worker:this.auditId});return super.postMessage(message,...args);}
  };
 });
 await installAudit(page);
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});await page.goto(origin);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 const settled=()=>page.waitForFunction(()=>{const r=window.__perlinAudit.requests.at(-1);return r&&window.__perlinAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);});
 const snapshot=()=>page.evaluate(()=>{const r=window.__perlinAudit.requests.at(-1);return{request:r,output:window.__perlinAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id)};});
 const seek=async time=>{const value=await page.getByRole('slider',{name:'Time position',exact:true}).evaluate((e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return Number(e.value);},time);await page.waitForFunction(value=>{const r=window.__perlinAudit.requests.at(-1);return Math.abs(r?.context.time-value)<1e-6&&window.__perlinAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);},value);await ready();return snapshot();};
 await ready();
 // Read the shipped CPU example without retyping its values. The second case
 // is an explicitly recorded FIELD_CURVES derivative, not a shipped preset.
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
 const jarBytes=await readFile(jar);check(sha(jarBytes)==='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','MathArt artifact changed');
 const originalBytes=execFileSync('python3',['-c',"import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('data/Noise/noise.json'))",jar]);const original=JSON.parse(originalBytes);
 report.source={jarSha256:sha(jarBytes),member:'data/Noise/noise.json',memberSha256:sha(originalBytes)};
 report.runtime=await page.evaluate(async original=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{generateScene,TemporalGenerationSession}=await import('/src/engine/temporal.ts');
  const {parseScene,serializeScene}=await import('/src/engine/document.ts');
  const assert=(v,m)=>{if(!v)throw Error(m);},hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const rows=[];
  for(const style of ['PARTICLES','FIELD_CURVES'])for(const accumulation of [false,true]){
   const raw=structuredClone(original);Object.assign(raw.settings,{particle_count:128,curve_count:32,curve_length:24,line_weight:12,dot_size:12,cpu_render_style:style,use_accumulation_buffer:accumulation});raw.timeline=[{type:'wait',duration:3}];
   const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.timeline.fps=10;scene.perlinSource.display.accumulation=accumulation;
   const context={time:.2,width:320,height:240,quality:'preview',sourcePerlinViewport:{width:320,height:240,pixelDensity:1},sourceViewport:{logicalWidth:320,logicalHeight:240,referenceLogicalHeight:240,target:'primary',projectionPass:scene.settings.sourceCameraProjection}};
   const owner=new TemporalGenerationSession();
   try{
    const render=(time,backend)=>{scene.perlinSource.backend=backend;return generateScene(scene,{...context,time},owner);};
    const cpu=render(.8,'cpu'),before=owner.sourcePerlin.diagnostics(),snapshot=owner.sourcePerlin.diagnosticSnapshot();
    const background=cpu.pixels.slice(0,4);
    const distinctPixels=Array.from({length:cpu.pixels.length/4},(_,i)=>i*4).filter(i=>cpu.pixels.slice(i,i+4).some((v,c)=>v!==background[c])).length;
    assert(distinctPixels>0,'CPU switching fixture rendered a uniform image: '+style+'/'+accumulation);
    assert(before.flow.builds===0,'CPU constructed GPU flow eagerly');
    const gpu=render(.8,'gpu'),paused=owner.sourcePerlin.diagnostics(),frozen=owner.sourcePerlin.diagnosticSnapshot();
    assert(paused.constructions===before.constructions&&paused.model.updates===before.model.updates&&paused.model.cpuUpdates===before.model.cpuUpdates,'Paused switch rebuilt or updated the model');
    assert(paused.target.draws===before.target.draws+1&&paused.flow.builds===1,'Paused GPU switch did not draw exactly once');
    assert(JSON.stringify(snapshot.motion)===JSON.stringify(frozen.motion)&&JSON.stringify(snapshot.geometry)===JSON.stringify(frozen.geometry),'Switch changed CPU geometry');
    const gpuLater=render(1.5,'gpu'),held=owner.sourcePerlin.diagnostics(),heldSnapshot=owner.sourcePerlin.diagnosticSnapshot();
    assert(held.model.updates===16&&held.model.cpuUpdates===before.model.cpuUpdates&&held.flow.builds===1,'GPU frames advanced CPU state or rebuilt flow');
    assert(JSON.stringify(snapshot.motion)===JSON.stringify(heldSnapshot.motion)&&JSON.stringify(snapshot.geometry)===JSON.stringify(heldSnapshot.geometry),'GPU frames changed frozen geometry');
    const returned=render(1.5,'cpu'),after=owner.sourcePerlin.diagnostics();
    assert(after.constructions===1&&after.model.updates===held.model.updates&&after.target.draws===held.target.draws+1,'CPU return reconstructed or clock advanced');
    const returnedHash=await hash(returned.pixels),repeated=render(1.5,'cpu');
    assert(await hash(repeated.pixels)===returnedHash&&owner.sourcePerlin.diagnostics().target.draws===after.target.draws,'Same-frame read redrew history');
    if(!accumulation)assert(returnedHash===await hash(cpu.pixels),'Nonaccumulating CPU return did not retain frozen geometry');
    else assert(returnedHash!==await hash(cpu.pixels),'CPU accumulation lost the GPU framebuffer');
    render(1.6,'cpu');assert(owner.sourcePerlin.diagnostics().model.cpuUpdates===before.model.cpuUpdates+1,'CPU resume failed');
    const rewound=render(.1,'cpu'),fresh=generateScene(scene,{...context,time:.1});
    assert(await hash(rewound.pixels)===await hash(fresh.pixels),'Explicit rewind retained old backend history');
    const saved=parseScene(serializeScene(scene));assert(JSON.stringify(saved.perlinSource)===JSON.stringify(scene.perlinSource),'Both backend configuration did not roundtrip');
    rows.push({style,accumulation,distinctPixels,cpuSha:await hash(cpu.pixels),gpuSha:await hash(gpu.pixels),gpuLaterSha:await hash(gpuLater.pixels),returnedSha:returnedHash,retainedModel:true,pausedNoUpdate:true,gpuCpuFrozen:true,flowBuilds:held.flow.builds,rewindFreshMatch:true,postSwitch:after});
   }finally{owner.reset();assert(owner.sourcePerlin.diagnostics().constructions===0&&!owner.sourcePerlin.diagnostics().target,'Switch session leaked after reset');}
  }
  return rows;
 },original);
 const derivative=structuredClone(original);derivative.name='Perlin backend switch public';Object.assign(derivative.settings,{particle_count:24,step_size:.75,curve_count:3,curve_length:8});derivative.timeline=[{type:'wait',duration:3}];
 await page.locator('input[type=file]').setInputFiles({name:'perlin-switch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(derivative))});
 await page.waitForFunction(()=>window.__perlinAudit.requests.at(-1)?.scene.name==='Perlin backend switch public');await settled();await ready();
 const states=[await seek(.25)],worker=states[0].request.worker;
 const switchTo=async backend=>{
  await page.getByTestId('source-perlin-backend').selectOption(backend);
  await page.waitForFunction(backend=>window.__perlinAudit.requests.at(-1)?.scene.perlinSource?.backend===backend,backend);await settled();await ready();
  const state=await snapshot();check(state.request.worker===worker,'Public backend switch restarted Worker');return state;
 };
 states.push(await switchTo('gpu'));check(states[1].output.perlinFrame.updates===states[0].output.perlinFrame.updates,'Paused UI switch advanced clock');
 states.push(await switchTo('cpu'));states.push(await switchTo('gpu'));states.push(await seek(.75));states.push(await switchTo('cpu'));states.push(await seek(1));
 report.ui=await page.evaluate(async states=>{
  const {generateScene,TemporalGenerationSession}=await import('/src/engine/temporal.ts');const owner=new TemporalGenerationSession(),rows=[];
  try{for(const state of states){const out=generateScene(state.request.scene,state.request.context,owner),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==state.output.pixelSha)throw Error('Worker switch history differs from retained host at '+state.request.context.time);rows.push({backend:out.backend,time:state.request.context.time,worker:state.request.worker,sha256:hash,updates:out.sourcePerlinFrame.updates,constructions:owner.sourcePerlin.diagnostics().constructions});}return rows;}finally{owner.reset();}
 },states);
 const savedGpu=await switchTo('gpu');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.scenes.find(s=>s.id===w.active)?.perlinSource?.backend==='gpu';});
 await page.reload();await settled();await ready();const reopened=await snapshot();check(JSON.stringify(reopened.request.scene.perlinSource)===JSON.stringify(savedGpu.request.scene.perlinSource),'GPU selected save/reopen lost either settings branch');
 report.persistence={bothSettings:true,activeBackend:'gpu',workspaceReopened:true};await page.screenshot({path:prefix+'-ui.png'});
 const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'Source changed during switch verification');report.sources=before;report.sourceStable=true;
 report.workerErrors=await page.evaluate(()=>window.__perlinAudit.errors);check(!report.workerErrors.length&&!errors.length&&!consoleErrors.length,'Browser/Worker reported errors');report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{
 report.pageErrors=errors;report.consoleErrors=consoleErrors;report.elapsedMs=performance.now()-runStarted;
 const cleanup=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=cleanup.map((r,i)=>({resource:['browser','vite','exportServer'][i],status:r.status,error:r.status==='rejected'?String(r.reason):undefined}));
 if(cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(prefix+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,runtimeCases:report.runtime?.length,uiFrames:report.ui?.length}));
}
