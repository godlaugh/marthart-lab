/** Public App palette authoring and retained sessions. Only owned headless
 * Chrome is used; observations never replace renderer inputs or completions. */
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {resolve,relative} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {decodePng} from './lib/verify-png.mjs';
import {measureFamily} from './browser-process-cost.mjs';

const script='scripts/verify-roots-perlin-gradient-palette.mjs';
const out=process.argv[2]??`.cache/roots-perlin-gradient-app-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^roots-perlin-gradient-app-[^/]+$/,'Use a new .cache/roots-perlin-gradient-app-* directory');
await mkdir('.cache',{recursive:true});await mkdir(out); // Never overwrite an earlier run.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashes(){
 const paths=[];for(const root of ['src','server'])for(const p of await readdir(root,{recursive:true}))if(/\.(ts|tsx|json|css|mjs)$/.test(p))paths.push(root+'/'+p);
 paths.push(script,'scripts/lib/verify-png.mjs','scripts/browser-process-cost.mjs','package.json','package-lock.json');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const colors=['#80123456','#FFDD5522','#00AAFF',...Array.from({length:29},(_,i)=>'#'+(0x203040+i*290321).toString(16).padStart(6,'0'))];
const perlinColors=colors.map((c,i)=>i===2?'#204060A0':c.length===7?'#FF'+c.slice(1):c);
const specs=[{name:'roots-GPU_DENSITY',kind:'roots',mode:'GPU_DENSITY'},{name:'roots-GPU_3D',kind:'roots',mode:'GPU_3D'},{name:'perlin-cpu-particles',kind:'perlin',mode:'CPU',style:'PARTICLES'},{name:'perlin-cpu-field-curves',kind:'perlin',mode:'CPU',style:'FIELD_CURVES'},{name:'perlin-gpu',kind:'perlin',mode:'GPU',style:'PARTICLES'}];
function fixture(spec){return spec.kind==='roots'?{
 config_version:'1.0.0',type:'COMPLEX_ROOTS',name:spec.name,
 polynomial:{variable:'z',coefficients:{2:'1',0:'t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},sampling:{sample_count:256,batch_size:64,seed:91},
 palette:colors,camera:{phi:'0',theta:'0',gamma:'0'},settings:{render_mode:spec.mode,worker_count:1,max_splat_points_per_frame:2048,color_metric:'im(t2)',scale_x:60,scale_y:60,scale_z:35,dot_size:.02,brightness:1,contrast:1,gamma:2.2,dynamic_range:.9,saturation:1,background_color:'#000000'},timeline:[]
 }:{config_version:'1.0.0',type:'PERLIN',name:spec.name,palette:perlinColors,settings:{render_mode:spec.mode,cpu_render_style:spec.style,curve_color_mode:'INDEX',seed:'1771842692935',particle_count:128,step_size:.75,curve_count:32,curve_length:40,curve_step_size:2,field_cell_size:32,line_weight:12,dot_size:12,use_accumulation_buffer:false,background_color:'#000000'},timeline:[{type:'wait',duration:3}]};}
const paletteOf=scene=>scene.kind==='roots'?scene.rootsSourcePalette:scene.perlinSource?.palette;
const rgbOf=scene=>scene.kind==='roots'?scene.rootsSourcePalette.colors:scene.perlinSource.palette.map(c=>'#'+(c&0xffffff).toString(16).padStart(6,'0').toUpperCase());
const report={status:'running',at:new Date().toISOString(),directory:out,scope:'Five actual App source imports, Cosine/Curve controls, renderer delivery, paused session retention, exact Manual restoration, bake, Save/reload, project export and real paused PNG. Synthetic small fixtures; no original JVM/GUI or original pixel-parity claim.',limits:['Empty/single-color padding remains outside this normal >=2-color matrix.','One GPU actual UI retained-recording/reapply path is checked; CPU recording command state is covered separately by tests, not this App matrix.','Roots PNG uses the current physical viewport size: paused density capture at a different size clears the retained density target after sampling is drained; resized capture is not claimed.','Process-family CPU and peak RSS are sampled estimates; no before/after performance comparison or token measurement.'],checks:[],cases:[],pageErrors:[]};
const check=(v,m)=>{assert.ok(v,m);report.checks.push(m);};
await writeFile(out+'/verifier.mjs',await readFile(script));report.sourceBefore=await hashes();report.priorVerifierFindings=[{report:'.cache/roots-perlin-gradient-app-1792818876368/report.json',reason:'Synthetic planar roots fixture omitted camera; default phi=pi/2 viewed the z=0 unit circle from the side. Explicit phi=0 establishes the intended face-on fixture.'},{report:'.cache/roots-perlin-gradient-app-1792818980798/report.json',reason:'After all 512 roots were drained, resizing the paused density target to 256x192 cleared its retained ink (clearReasons physical-size, submittedFinitePointCount 0), and the exact captured RGBA/PNG were uniform. This script now verifies same-physical-size Roots capture, preserving the retained buffer. Resized capture is an explicit limit, not a passed case.'}];
let browser,server,service,page,phase='setup';const started=performance.now();
const instrumentation=`
const audit=window.__gradientAudit;
const nativeGenerate=Generator.prototype.generate;
Generator.prototype.generate=async function(scene,input,...args){
 const entry={sequence:++audit.sequence,scene:structuredClone(scene),input:structuredClone(input)};audit.calls.push(entry);
 try{const o=await nativeGenerate.call(this,scene,input,...args);entry.output=audit.meta(o);audit.owners.set(o,{sequence:entry.sequence,role:'preview'});return o;}
 catch(e){entry.error=String(e);throw e;}
};
for(const name of ['beginSourceRecording','finishSourceRecording']){
 const native=Generator.prototype[name];Generator.prototype[name]=async function(...args){
  const row={sequence:++audit.sequence,method:name};audit.recordings.push(row);
  try{const result=await native.apply(this,args);row.scene=structuredClone(result.scene);row.context=structuredClone(result.context);row.clock=result.clock;row.completed=true;
   if(result.warmup)row.warmup=audit.meta(result.warmup);
   if(result.preview){row.output=audit.meta(result.preview);audit.owners.set(result.preview,{sequence:row.sequence,role:'preview'});}
   return result;
  }catch(e){row.error=String(e);throw e;}
 };
}
for(const name of ['setRootsPaused','setPerlinPaused']){const native=Generator.prototype[name];Generator.prototype[name]=async function(output,paused,...args){const row={sequence:++audit.sequence,method:name,paused,owner:audit.owners.get(output)};audit.controls.push(row);try{const result=await native.call(this,output,paused,...args);row.completed=true;return result;}catch(e){row.error=String(e);throw e;}};}
for(const name of ['captureRootsPaused','capturePerlinPaused']){
 const native=Generator.prototype[name];Generator.prototype[name]=async function(output,...args){
  const owner=audit.owners.get(output),source=audit.calls.find(c=>c.sequence===owner?.sequence)??audit.captures.find(c=>c.sequence===owner?.sequence);
  if(!source)throw Error('Capture has no observed Generator owner');
  const row={sequence:++audit.sequence,method:name,scene:source.scene,input:args};audit.captures.push(row);
  try{const pair=await native.call(this,output,...args);row.capture=audit.meta(pair.capture);row.capture.rgbaSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pair.capture.pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');row.output=audit.meta(pair.preview);audit.owners.set(pair.capture,{sequence:row.sequence,role:'capture'});audit.owners.set(pair.preview,{sequence:row.sequence,role:'preview'});return pair;}
  catch(e){row.error=String(e);throw e;}
 };
}
`;
function installAudit(){
 const fnv=p=>{let n=2166136261;for(const b of p??[]){n^=b;n=Math.imul(n,16777619);}return n>>>0;};
 window.__gradientAudit={sequence:0,calls:[],captures:[],controls:[],recordings:[],renders:[],owners:new WeakMap(),meta:o=>({type:o.type,backend:o.backend,width:o.width,height:o.height,pixelHash:fnv(o.pixels),roots:o.roots,rootsPresentation:o.rootsPresentation,rootsLive:o.rootsLive,perlinLive:o.perlinLive,sourcePerlinFrame:o.sourcePerlinFrame,sourcePausedImage:o.sourcePausedImage})};
}
const rendererInstrumentation=`
if(typeof window!=='undefined'){
 const native=ArtRenderer.prototype.setOutput;
 ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=native.call(this,output,scene,...args),audit=window.__gradientAudit,owner=audit?.owners.get(output);if(owner)audit.renders.push({...owner,sceneId:scene.id,width:this.renderer.domElement.width,height:this.renderer.domElement.height});return result;};
}
`;
const button=name=>page.getByRole('button',{name,exact:true});
const mode=()=>page.getByRole('combobox',{name:'Source palette generation mode',exact:true});
const field=key=>page.getByTestId('source-bouncing-generator-'+key);
const latest=()=>page.evaluate(()=>window.__gradientAudit.calls.findLast(c=>c.input.quality!=='export'));
async function ready(name,expected,after=0){
 await page.waitForFunction(({name,expected,after})=>{
  const a=window.__gradientAudit,c=a.calls.findLast(c=>c.input.quality!=='export'),p=c?.scene.kind==='roots'?c.scene.rootsSourcePalette:c?.scene.perlinSource?.palette;
  return c?.sequence>after&&c.scene.name===name&&c.output&&(expected===undefined||JSON.stringify(p)===JSON.stringify(expected))&&a.renders.some(r=>r.sequence===c.sequence&&r.role==='preview')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');
 },{name,expected,after});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return latest();
}
function retained(spec,before,after,label){
 check(after.input[spec.kind==='roots'?'rootsLive':'perlinLive']?.sessionId===before.input[spec.kind==='roots'?'rootsLive':'perlinLive']?.sessionId,`${label}: request session retained`);
 if(spec.kind==='roots'){
  const a=before.output,b=after.output;check(b.rootsLive?.paused&&b.rootsLive.sessionId===a.rootsLive.sessionId&&b.rootsPresentation.instance===a.rootsPresentation.instance,`${label}: Roots sampling instance retained`);
  check(b.roots.attemptedSamples===a.roots.attemptedSamples&&b.roots.rootPoints===a.roots.rootPoints&&b.rootsPresentation.restartReason===null&&b.rootsLive.sceneTime===a.rootsLive.sceneTime,`${label}: completed Roots sampling and paused time preserved`);
 }else{
  const a=before.output,b=after.output;check(b.perlinLive?.paused&&b.perlinLive.sessionId===a.perlinLive.sessionId&&b.perlinLive.constructions===a.perlinLive.constructions,`${label}: Perlin owner not rebuilt`);
  check(b.perlinLive.sceneTime===a.perlinLive.sceneTime&&b.sourcePerlinFrame.updates===a.sourcePerlinFrame.updates,`${label}: paused Perlin time/updates unchanged`);
 }
}
async function canvasPixels(){return page.locator('canvas[data-testid="art-canvas"]:not([data-native-hidden="true"]):visible').evaluate(el=>{
 const gl=el.getContext('webgl2');if(!gl||gl.isContextLost())throw Error('Presented canvas unavailable');const p=new Uint8Array(el.width*el.height*4);gl.readPixels(0,0,el.width,el.height,gl.RGBA,gl.UNSIGNED_BYTE,p);let hash=2166136261;const first=p[0]*65536+p[1]*256+p[2];let changed=0;for(let i=0;i<p.length;i++){hash^=p[i];hash=Math.imul(hash,16777619);if(i%4===0&&p[i]*65536+p[i+1]*256+p[i+2]!==first)changed++;}return{hash:hash>>>0,width:el.width,height:el.height,nonuniformPixels:changed};
 });}
async function edit(spec,baseline,action,expected,label){const after=await page.evaluate(()=>window.__gradientAudit.sequence);await action();const state=await ready(spec.name,expected,after);retained(spec,baseline,state,spec.name+': '+label);return state;}
async function commit(key,value){await field(key).fill(String(value));await field(key).press('Enter');}
async function recordAndReapply(spec,before){
 const control=page.getByTestId('source-perlin-gpu-palette'),colors=[0xff112233,0xff112233];
 const hot=await edit(spec,before,async()=>{await control.fill('#FF112233\n#FF112233');await control.press('Control+Enter');},colors,'pre-recording hot palette');
 await button('Export artwork').click();await button('Animation video').click();
 await page.getByRole('combobox',{name:'Perlin video mode',exact:true}).selectOption('retained');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('192');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('128');
 await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('6');await page.getByRole('spinbutton',{name:'Recording simulation FPS',exact:true}).fill('4');
 const sequence=await page.evaluate(()=>window.__gradientAudit.sequence),download=page.waitForEvent('download',{timeout:60000});
 await button('Start export').click();const videoPath=out+'/perlin-gpu-command.mp4';await(await download).saveAs(videoPath);
 await page.waitForFunction(n=>window.__gradientAudit.recordings.some(r=>r.sequence>n&&r.method==='finishSourceRecording'&&r.completed),sequence);
 const records=await page.evaluate(n=>window.__gradientAudit.recordings.filter(r=>r.sequence>n),sequence);
 for(const row of records){assert.deepEqual(row.scene.perlinSource.palette,colors);check(row.context.perlinLive.paletteRevision===hot.input.perlinLive.paletteRevision,spec.name+': '+row.method+' retains authored palette command');}
 await button('Close export').click();await button('Pause').click();await button('Play').waitFor();
 await page.waitForFunction(()=>window.__gradientAudit.controls.at(-1)?.completed&&window.__gradientAudit.controls.at(-1).paused===true);
 const stopped=await ready(spec.name,colors),revision=stopped.input.perlinLive.paletteRevision;
 const reapplied=await edit(spec,stopped,async()=>{await control.focus();await control.press('Control+Enter');},colors,'same palette reapplied after actual recording');
 check(reapplied.input.perlinLive.paletteRevision===revision+1&&reapplied.output.perlinLive.paletteRevision===revision+1,spec.name+': actual recording handoff preserves next command identity');
 check(reapplied.output.pixelHash!==stopped.output.pixelHash,spec.name+': same colors after actual recording change delivered GPU pixels');
 return{videoPath,hot,records,stopped,reapplied,scope:'Actual App + Generator + Worker + export service; MP4 downloaded, no new ffprobe or original-pixel claim.'};
}
async function exportPng(spec,before){
 const [width,height]=spec.kind==='roots'?[before.output.width,before.output.height]:[256,192];
 await button('Export artwork').click();await button('Still image').click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill(String(width));await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill(String(height));
 const upscale=page.getByRole('combobox',{name:'PNG upscale',exact:true});if(await upscale.count())await upscale.selectOption('1');
 const sequence=await page.evaluate(()=>window.__gradientAudit.sequence),download=page.waitForEvent('download',{timeout:60000});await button('Start export').click();const path=out+'/'+spec.name+'.png';await(await download).saveAs(path);
 await page.waitForFunction(n=>window.__gradientAudit.captures.some(c=>c.sequence>n&&c.capture&&c.output),sequence);
 const capture=await page.evaluate(n=>window.__gradientAudit.captures.findLast(c=>c.sequence>n&&c.capture),sequence),decoded=decodePng(await readFile(path));
 assert.deepEqual(paletteOf(capture.scene),paletteOf(before.scene));check(decoded.width===width&&decoded.height===height,spec.name+': actual PNG size');check(sha(decoded.rgba)===capture.capture.rgbaSha256,spec.name+': PNG RGBA SHA-256 matches delivered capture');
 const distinct=new Set();for(let i=0;i<decoded.rgba.length;i+=4)distinct.add(decoded.rgba.readUInt32LE(i));check(distinct.size>1,spec.name+': PNG has rendered artwork');
 const a=before.output,b=capture.output;
 if(spec.kind==='perlin')check(b.perlinLive.constructions===a.perlinLive.constructions&&b.perlinLive.sceneTime===a.perlinLive.sceneTime&&b.sourcePerlinFrame.updates===a.sourcePerlinFrame.updates,spec.name+': capture retains paused Perlin state');
 else check(b.rootsLive.sessionId===a.rootsLive.sessionId&&b.rootsPresentation.instance===a.rootsPresentation.instance&&b.roots.attemptedSamples===a.roots.attemptedSamples,spec.name+': capture retains Roots sampling session');
 await page.waitForFunction(n=>window.__gradientAudit.renders.some(r=>r.sequence===n&&r.role==='preview'),capture.sequence);await button('Close export').click();
 return{path,width,height,policy:spec.kind==='roots'?'same-physical-size-paused-capture':'custom-size-paused-capture',pngSha:sha(await readFile(path)),rgbaSha:sha(decoded.rgba),distinctColors:distinct.size,capture};
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));await page.addInitScript(installAudit);
 for(const[file,extra]of [['client.ts',instrumentation],['renderer.ts',rendererInstrumentation]])await context.route('**/src/engine/'+file,async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+extra});});
 const origin=server.resolvedUrls.local[0];await page.route('**/gradient-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'gradient-fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('spirograph'));saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});await page.goto(origin);
 report.measurements=await measureFamily(process.pid,async()=>{
  const begin=performance.now();
  for(const spec of specs){
   phase=spec.name+':import';console.log(JSON.stringify({phase}));const source=fixture(spec);await writeFile(out+'/'+spec.name+'-input.json',JSON.stringify(source,null,2)+'\n');
   await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:spec.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await ready(spec.name);
   if(spec.kind==='roots')await page.waitForFunction(()=>window.__gradientAudit.calls.findLast(c=>c.output)?.output.rootsLive?.stream.canFinishAfterDisplay);
   else{
    await button('Play').click();await page.waitForFunction(()=>{const c=window.__gradientAudit.calls.findLast(c=>c.output);return c?.output.perlinLive?.sceneTime>=.4&&c.output.sourcePerlinFrame.updates>=12;});await button('Pause').click();await button('Play').waitFor();await page.waitForFunction(()=>window.__gradientAudit.controls.at(-1)?.completed&&window.__gradientAudit.controls.at(-1).paused===true);
   }
   const baseline=await ready(spec.name),original=paletteOf(baseline.scene),initialCanvas=await canvasPixels();check(initialCanvas.nonuniformPixels>0,spec.name+': initial artwork actually presented');
   if(spec.kind==='roots'){assert.deepEqual(original,{colors});check(baseline.output.rootsPresentation.mode===(spec.mode==='GPU_3D'?'point-cloud':'density'),spec.name+': expected Roots renderer');}
   else{assert.deepEqual(original,perlinColors.map(c=>parseInt(c.slice(1),16)>>>0));check(baseline.scene.perlinSource.backend===spec.mode.toLowerCase()&&baseline.scene.perlinSource.cpuStyle===(spec.style==='PARTICLES'?'particles':'field-curves'),spec.name+': expected Perlin backend/style');check(baseline.scene.perlinSource.curves.colorMode==='index',spec.name+': curve palette response uses explicit INDEX mode');check(original.some(c=>c>>>24!==255),spec.name+': fixture contains nonopaque ARGB');}
   await button('Appearance').click();await mode().waitFor();check(await mode().inputValue()==='manual',spec.name+': imported mode Manual');
   const expected=rgb=>spec.kind==='roots'?{colors:rgb}:rgb.map(c=>(0xff000000|parseInt(c.slice(1),16))>>>0);
   phase=spec.name+':cosine';let state=await edit(spec,baseline,()=>mode().selectOption('cosine'),undefined,'Cosine mode');check(await field('count').inputValue()==='25'&&rgbOf(state.scene).length===25,spec.name+': imported 32-color palette gives count 25');
   state=await edit(spec,baseline,()=>commit('count',9),undefined,'Cosine count');check(rgbOf(state.scene).length===9,spec.name+': count immediately reaches renderer');
   state=await edit(spec,baseline,()=>commit('a-0',.25),undefined,'Cosine parameter');check(rgbOf(state.scene)[0].startsWith('#BF'),spec.name+': A R affects generated colors');check(Number(await field('b-0').inputValue())===.5,spec.name+': A edit leaves B unchanged');
   const cosineCanvas=await canvasPixels();check(cosineCanvas.hash!==initialCanvas.hash,spec.name+': Cosine changes presented canvas');
   phase=spec.name+':curve';const grayscale=['#000000','#202020','#404040','#606060','#808080','#9F9F9F','#BFBFBF','#DFDFDF','#FFFFFF'];
   state=await edit(spec,baseline,()=>mode().selectOption('curve'),expected(grayscale),'Curve mode');check(await field('count').inputValue()==='9',spec.name+': count shared by modes');
   await button('Add node').click();check(await page.getByTestId('source-gradient-curve').locator('circle').count()===3,spec.name+': curve node added');state=await edit(spec,baseline,()=>commit('point-y',.9),undefined,'Curve point');check(rgbOf(state.scene)[4]==='#E68080',spec.name+': Curve point immediately affects only red');
   const curveCanvas=await canvasPixels();check(curveCanvas.hash!==cosineCanvas.hash,spec.name+': Curve changes presented canvas');
   phase=spec.name+':restore';state=await edit(spec,baseline,()=>mode().selectOption('manual'),original,'Manual restore');assert.deepEqual(paletteOf(state.scene),original);check(true,spec.name+': Manual restores every canonical color and alpha');
   if(spec.kind==='perlin'){
    const revision=state.input.perlinLive.paletteRevision;
    const control=page.getByTestId(`source-perlin-${spec.mode==='CPU'?'cpu':'gpu'}-palette`);
    state=await edit(spec,baseline,async()=>{await control.focus();await control.press('Control+Enter');},original,'same Manual colors submitted again');
    check(state.input.perlinLive.paletteRevision===revision+1&&state.output.perlinLive.paletteRevision===revision+1,spec.name+': unchanged Manual submit has a new acknowledged command');
   }
   state=await edit(spec,baseline,()=>mode().selectOption('curve'),undefined,'Curve revisit');const baked=paletteOf(state.scene);await button('Apply as manual palette').click();await mode().waitFor();check(await mode().inputValue()==='manual',spec.name+': Apply switches to Manual');await ready(spec.name,baked);
   await edit(spec,baseline,()=>mode().selectOption('cosine'),undefined,'Cosine after bake');state=await edit(spec,baseline,()=>mode().selectOption('manual'),baked,'Baked Manual restore');assert.deepEqual(paletteOf(state.scene),baked);check(true,spec.name+': Apply replaces Manual restoration snapshot');
   const pausedControls=await page.evaluate(()=>window.__gradientAudit.controls),beforeSave=state;phase=spec.name+':save';await button('Save').click();await page.reload();state=await ready(spec.name,baked);if(spec.kind==='roots'){await page.waitForFunction(()=>window.__gradientAudit.calls.findLast(c=>c.output)?.output.rootsLive?.stream.canFinishAfterDisplay);state=await ready(spec.name,baked);}
   await button('Appearance').click();check(await mode().inputValue()==='manual',spec.name+': Save/reload retains palette and resets mode');
   const download=page.waitForEvent('download');await page.getByTitle('Export project JSON',{exact:true}).click();const projectPath=out+'/'+spec.name+'-project.json';await(await download).saveAs(projectPath);const project=JSON.parse(await readFile(projectPath,'utf8'));assert.deepEqual(paletteOf(project),baked);assert.deepEqual(project.provenance.original,source);check(true,spec.name+': exported project retains baked palette and raw input');
   phase=spec.name+':png';if(spec.kind==='perlin'){await button('Play').click();await page.waitForFunction(()=>{const c=window.__gradientAudit.calls.findLast(c=>c.output);return c?.output.perlinLive?.sceneTime>=.4&&c.output.sourcePerlinFrame.updates>=12;});await button('Pause').click();await button('Play').waitFor();await page.waitForFunction(()=>window.__gradientAudit.controls.at(-1)?.completed&&window.__gradientAudit.controls.at(-1).paused===true);state=await ready(spec.name,baked);}const png=await exportPng(spec,state);const recording=spec.name==='perlin-gpu'?await recordAndReapply(spec,state):undefined;await page.screenshot({path:out+'/'+spec.name+'-app.png'});
   report.cases.push({spec,baseline,initialCanvas,cosineCanvas,curveCanvas,original,baked,pausedControls,beforeSave,reopened:state,projectPath,png,recording});
  }
  return{elapsedMs:performance.now()-begin,costScope:'Five-case public App workflow after Vite/export service/browser setup'};
 });
 check(report.pageErrors.length===0,'No unhandled App errors');report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.lastAudit=await page.evaluate(()=>{const a=window.__gradientAudit;return{calls:a.calls.slice(-4),captures:a.captures.slice(-2),renders:a.renders.slice(-5)};}).catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 report.elapsedMs=performance.now()-started;report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map((r,i)=>({resource:['browser','vite','exportServer'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));report.remainingServiceProcesses=service?.ownedProcessCount??0;
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.remainingServiceProcesses||report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(out+'/README.md',`# Roots / Perlin 色板 App 验收\n\n状态：${report.status}\n\n仅使用无窗口 Chrome；没有原版运行或像素一致性声明。\n\n完成 ${report.cases.length}/5 组、${report.checks.length} 项检查。总耗时 ${(report.elapsedMs/1000).toFixed(1)} 秒；源文件${report.sourceStable?'稳定':'发生变化'}；服务剩余子进程 ${report.remainingServiceProcesses}。\n\n${report.error?`失败阶段：${report.phase}\n\n\`\`\`\n${report.error}\n\`\`\`\n`:''}## 验证范围与限制\n\n${report.limits.map(l=>'- '+l).join('\n')}\n\n${report.cases.map(c=>`- ${c.spec.name}：[实际 PNG](${c.spec.name}.png) · [App 画面](${c.spec.name}-app.png) · [保存项目](${c.spec.name}-project.json)`).join('\n')}\n\n完整调用证据、来源 SHA 和采样进程成本见 report.json。\n`);
 console.log(JSON.stringify({status:report.status,cases:report.cases.length,checks:report.checks.length,phase:report.phase,error:report.error,elapsedMs:report.elapsedMs,directory:out}));
}
