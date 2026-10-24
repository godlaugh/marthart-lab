/** Actual public App palette controls and Worker-delivered pixels. All browser
 * processes are owned and headless; observers never replace outputs or clocks. */
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

const script='scripts/verify-fractal-gradient-palette.mjs',out=process.argv[2]??`.cache/fractal-gradient-app-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^fractal-gradient-app-[^/]+$/,'Use a new .cache/fractal-gradient-app-* directory');
await mkdir('.cache',{recursive:true});await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashes(){
 const paths=[];for(const root of ['src','server'])for(const p of await readdir(root,{recursive:true}))if(/\.(ts|tsx|json|css|mjs)$/.test(p))paths.push(root+'/'+p);
 paths.push(script,'scripts/lib/verify-png.mjs','scripts/browser-process-cost.mjs','package.json','package-lock.json');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const originalColors=['#80123456','#ef1020','#20df40','#3040ef','#FFCC33','#8040E0','#30D0C0'];
function fixture(both=false){
 const straight=[{x:0,y:0},{x:1,y:1}];
 return{config_version:'1.0.0',type:'FRACTAL',name:both?'fractal-both-flags':'fractal-manual-generators',
  fractal:{formula_id:'newton',iterations:24,render_method:'ONEPASS',parameters:{exponent:[3,0],bailout:.001,relaxation:1}},
  color:{use_cosine_palette:both,use_curve_palette:both,palette_offset:.17,palette_gamma:1.2,palette_space:'rgb',
   cosine_a:[.5,.5,.5],cosine_b:[.5,.5,.5],cosine_c:[1,1,1],cosine_d:[0,.1,.2],
   curve_red:straight,curve_green:straight,curve_blue:straight,
   inside:{algorithm_id:'basic',transfer_function:'linear',color_density:1},outside:{algorithm_id:'basic',transfer_function:'linear',color_density:1}},
  palette:originalColors,timeline:[{type:'wait',duration:30}]};
}
const report={status:'running',at:new Date().toISOString(),directory:out,nodeVersion:process.version,nodeExecutable:process.execPath,
 scope:'Real public App native JSON imports, Fractal source palette controls, unmodified Worker raster delivery, retained paused session, project persistence and actual paused PNG. Bounded Newton ONEPASS fixtures; no original JVM/GUI or original pixel parity claim.',
 limits:['No recording, long-running animation, or other Fractal formulas in this matrix.','Current PNG applies the existing source image enhancement even at 1x; downloaded PNG is compared to the actual postprocessing Worker Blob, not incorrectly to pre-enhancement capture RGBA.','Curve point lists are explicit fixtures; random-curve initialization and empty/single-color import boundaries are outside this matrix.','Renderer/capture SHA-256 observation adds hashing overhead; process-family CPU/RSS are sampled estimates, with no before/after performance or token comparison.'],checks:[],cases:[],pageErrors:[]};
const check=(v,m)=>{assert.ok(v,m);report.checks.push(m);};
await writeFile(out+'/verifier.mjs',await readFile(script));report.sourceBefore=await hashes();report.priorVerifierFindings=[{report:'.cache/fractal-gradient-app-1792821443270/report.json',reason:'Initial test conflated host draw updateOrdinal with numerical objectUpdates. SourceFractalHostSession.advance increments updateOrdinal on every paused draw; captured time/queue remain unchanged and objectUpdates is zero. The corrected check retains strict time/queue/zero-object-update assertions and requires draw ordinal to advance without host reset.'},{report:'.cache/fractal-gradient-app-1792821503612/report.json',reason:'The initial PNG assertion compared pre-enhancement capture RGBA to final PNG. Current sourceCurrentImage uses encodeFormulaRaster / encodeSourcePausedPng and enhanceSourcePausedImage even at 1x. Passive Worker request/response hashes now link the actual capture to the actual enhanced PNG Blob without altering that pipeline.'}];
let browser,server,service,page,phase='setup';const started=performance.now();
function installAudit(){
 const Native=window.Worker;
 const a=window.__fractalGradientAudit={sequence:0,workers:0,generationWorkers:0,pngJobs:[],hashes:[],terminated:[],calls:[],controls:[],captures:[],renders:[],owners:new WeakMap(),
  sha:async p=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',p))).map(n=>n.toString(16).padStart(2,'0')).join(''),
  meta:o=>({type:o.type,backend:o.backend,width:o.width,height:o.height,fractalLive:o.fractalLive,fractalRender:o.fractalRender,sourcePausedImage:o.sourcePausedImage,sourceCurrentImage:o.sourceCurrentImage})};
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.auditId=++a.workers;if(String(args[0]).includes('generate.worker.ts'))a.generationWorkers++;
   this.addEventListener('message',({data})=>{if(data?.operation==='encode-source-paused-png'){const job=a.pngJobs.find(j=>j.worker===this.auditId);if(job&&data.result?.blob){job.width=data.result.width;job.height=data.result.height;a.hashes.push(data.result.blob.arrayBuffer().then(bytes=>a.sha(bytes)).then(hash=>{job.pngSha256=hash;}));}else if(job)job.error=data.error;}});
  }
  postMessage(message,...args){if(message?.operation==='encode-source-paused-png'){const job={worker:this.auditId,baseWidth:message.width,baseHeight:message.height,scale:message.scale};a.pngJobs.push(job);a.hashes.push(a.sha(message.pixels.slice()).then(hash=>{job.inputRgbaSha256=hash;}));}return super.postMessage(message,...args);}
  terminate(){a.terminated.push(this.auditId);return super.terminate();}
 };
}
const instrumentation=`
const audit=window.__fractalGradientAudit,nativeGenerate=Generator.prototype.generate;
Generator.prototype.generate=async function(scene,input,...args){
 const row={sequence:++audit.sequence,workers:audit.generationWorkers,scene:structuredClone(scene),input:structuredClone(input)};audit.calls.push(row);
 try{const o=await nativeGenerate.call(this,scene,input,...args);row.output=audit.meta(o);if(o.pixels)row.output.rgbaSha256=await audit.sha(o.pixels);row.workersAfter=audit.generationWorkers;audit.owners.set(o,{sequence:row.sequence,role:'preview'});return o;}
 catch(e){row.error=String(e);throw e;}
};
const nativePause=Generator.prototype.setFractalPaused;
Generator.prototype.setFractalPaused=async function(output,paused,...args){const row={sequence:++audit.sequence,paused,owner:audit.owners.get(output)};audit.controls.push(row);try{const r=await nativePause.call(this,output,paused,...args);row.completed=true;return r;}catch(e){row.error=String(e);throw e;}};
const nativeCapture=Generator.prototype.captureFractalPaused;
Generator.prototype.captureFractalPaused=async function(output,...args){
 const owner=audit.owners.get(output),source=audit.calls.find(c=>c.sequence===owner?.sequence)??audit.captures.find(c=>c.sequence===owner?.sequence);
 if(!source)throw Error('Fractal capture lacks observed Generator owner');const row={sequence:++audit.sequence,scene:source.scene,input:args};audit.captures.push(row);
 try{const pair=await nativeCapture.call(this,output,...args);row.capture=audit.meta(pair.capture);row.capture.rgbaSha256=await audit.sha(pair.capture.pixels);row.output=audit.meta(pair.preview);row.output.rgbaSha256=await audit.sha(pair.preview.pixels);audit.owners.set(pair.capture,{sequence:row.sequence,role:'capture'});audit.owners.set(pair.preview,{sequence:row.sequence,role:'preview'});return pair;}
 catch(e){row.error=String(e);throw e;}
};
`;
const rendererInstrumentation=`
if(typeof window!=='undefined'){const native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=native.call(this,output,scene,...args),a=window.__fractalGradientAudit,owner=a?.owners.get(output);if(owner)a.renders.push({...owner,sceneId:scene.id,width:this.renderer.domElement.width,height:this.renderer.domElement.height});return result;};}
`;
const button=name=>page.getByRole('button',{name,exact:true}),mode=()=>page.getByRole('combobox',{name:'Source palette generation mode',exact:true}),field=key=>page.getByTestId('source-bouncing-generator-'+key);
const latest=()=>page.evaluate(()=>window.__fractalGradientAudit.calls.findLast(c=>c.input.quality!=='export'));
const palette=row=>row.scene.fractalSourceColor.palette,live=row=>row.output.fractalLive;
async function ready(name,after=0){
 await page.waitForFunction(({name,after})=>{const a=window.__fractalGradientAudit,c=a.calls.findLast(c=>c.input.quality!=='export');return c?.sequence>after&&c.scene.name===name&&c.output?.fractalLive&&c.output.rgbaSha256&&a.renders.some(r=>r.sequence===c.sequence&&r.role==='preview')&&!c.output.fractalRender?.display?.needsAnotherDisplay&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},{name,after});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return latest();
}
async function canvasPixels(){return page.locator('canvas[data-testid="art-canvas"]:not([data-native-hidden="true"]):visible').evaluate(async el=>{
 const gl=el.getContext('webgl2');if(!gl||gl.isContextLost())throw Error('Presented WebGL2 canvas unavailable');const p=new Uint8Array(el.width*el.height*4);gl.readPixels(0,0,el.width,el.height,gl.RGBA,gl.UNSIGNED_BYTE,p);
 const first=p[0]*65536+p[1]*256+p[2];let nonuniformPixels=0;for(let i=0;i<p.length;i+=4)if(p[i]*65536+p[i+1]*256+p[i+2]!==first)nonuniformPixels++;
 return{rgbaSha256:await window.__fractalGradientAudit.sha(p),width:el.width,height:el.height,nonuniformPixels};
 });}
function retained(before,after,label){
 const a=live(before),b=live(after);check(b.sessionId===a.sessionId&&after.workersAfter===before.workersAfter,label+': transport session and Worker retained');
 check(b.sceneTime===a.sceneTime&&b.queueIndex===a.queueIndex&&b.updateOrdinal>a.updateOrdinal,label+': paused time and queue retained; draw ordinal advances without reset');
 check(b.paused&&b.objectUpdates===0&&b.revision>a.revision,label+': edit acknowledged without advancing paused host');
 assert.deepEqual(b.presentation.fractalSourceColor.palette,palette(after));check(true,label+': actual retained render configuration matches canonical palette');
}
async function edit(before,action,label){const sequence=await page.evaluate(()=>window.__fractalGradientAudit.sequence);await action();const after=await ready(before.scene.name,sequence);retained(before,after,label);return after;}
async function commit(key,value){await field(key).fill(String(value));await field(key).press('Enter');}
async function openAppearance(before,label){
 const a=await page.evaluate(()=>({calls:window.__fractalGradientAudit.calls.length,sequence:window.__fractalGradientAudit.sequence}));
 const canvas=await canvasPixels();await button('Appearance').click();await mode().waitFor();await page.waitForTimeout(350);await ready(before.scene.name);
 check(await page.evaluate(n=>window.__fractalGradientAudit.calls.length===n,a.calls),label+': opening Appearance issues no generation command');
 assert.deepEqual(palette(await latest()),palette(before));check(true,label+': opening Appearance preserves canonical flags, colors and parameters');
 check((await canvasPixels()).rgbaSha256===canvas.rgbaSha256,label+': opening Appearance preserves actual canvas');
 return{before:a,canvas,mode:await mode().inputValue()};
}
async function playPause(name){
 await button('Play').click();await page.waitForFunction(name=>window.__fractalGradientAudit.calls.some(c=>c.scene.name===name&&c.output?.fractalLive?.sceneTime>.15),name);
 const sequence=await page.evaluate(()=>window.__fractalGradientAudit.sequence);await button('Pause').click();await button('Play').waitFor();
 await page.waitForFunction(n=>window.__fractalGradientAudit.controls.some(c=>c.sequence>n&&c.completed&&c.paused),sequence);
 const before=await ready(name);check(live(before).sceneTime>0,name+': real playback advances before independent pause');return before;
}
async function exportedProject(name,label,expected,source){
 const download=page.waitForEvent('download');await page.getByTitle('Export project JSON',{exact:true}).click();const path=out+'/'+name+'-'+label+'-project.json';await(await download).saveAs(path);
 const project=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(project.fractalSourceColor.palette,expected);assert.deepEqual(project.provenance.original,source);
 check(true,name+': '+label+' project exports full authored palette and exact input provenance');return path;
}
async function saveReopen(before,expectedMode,source,label){
 const expected=palette(before),name=before.scene.name;await button('Save').click();const projectPath=await exportedProject(name,label,expected,source);await page.reload();const reopened=await ready(name);
 assert.deepEqual(palette(reopened),expected);check(true,name+': '+label+' Save/reopen preserves flags, every color and parameter');
 const appearance=await openAppearance(reopened,name+': '+label+' reopen');check(appearance.mode===expectedMode,name+': '+label+' reopens in authored '+expectedMode+' mode');
 if(expectedMode!=='manual')check(Number(await field('count').inputValue())===expected.colors.length,name+': '+label+' count rehydrates from saved color array');
 return{reopened,projectPath,appearance};
}
async function exportPng(before,label){
 await button('Export artwork').click();await button('Still image').click();check(await page.getByRole('combobox',{name:'Fractal image source',exact:true}).inputValue()==='current',label+': PNG defaults to actual current numerical snapshot');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('256');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('192');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
 const sequence=await page.evaluate(()=>window.__fractalGradientAudit.sequence),download=page.waitForEvent('download',{timeout:60000});await button('Start export').click();const path=out+'/'+label+'.png';await(await download).saveAs(path);
 const capture=await page.evaluate(n=>window.__fractalGradientAudit.captures.findLast(c=>c.sequence>n&&c.capture),sequence);check(!!capture,label+': PNG uses actual owned paused capture');
 const decoded=decodePng(await readFile(path)),distinct=new Set();for(let i=0;i<decoded.rgba.length;i+=4)distinct.add(decoded.rgba.readUInt32LE(i));
 check(decoded.width===256&&decoded.height===192,label+': PNG custom dimensions');const job=await page.evaluate(async()=>{const a=window.__fractalGradientAudit;await Promise.all(a.hashes);return a.pngJobs.at(-1);});check(job?.inputRgbaSha256===capture.capture.rgbaSha256,label+': image enhancement Worker receives exact actual capture RGBA');check(job.pngSha256===sha(await readFile(path)),label+': downloaded PNG SHA-256 equals actual postprocessing Worker Blob');check(await page.evaluate(id=>window.__fractalGradientAudit.terminated.includes(id),job.worker),label+': one-job PNG Worker released');check(distinct.size>1,label+': PNG contains visible Fractal artwork');
 const prior=live(before),retained=capture.output.fractalLive;for(const key of ['sessionId','revision','sceneTime','queueIndex','updateOrdinal'])check(retained[key]===prior[key],label+': PNG retains '+key);
 check(retained.paused&&retained.objectUpdates===0&&capture.capture.fractalLive.target==='offscreen'&&retained.target==='primary',label+': PNG snapshots without advancing host');
 check(capture.output.rgbaSha256===before.output.rgbaSha256,label+': PNG restores identical primary pixels');
 await page.waitForFunction(n=>window.__fractalGradientAudit.renders.some(r=>r.sequence===n&&r.role==='preview'),capture.sequence);await button('Close export').click();
 return{path,width:256,height:192,pngSha256:sha(await readFile(path)),rgbaSha256:sha(decoded.rgba),distinctColors:distinct.size,postprocessing:job,capture};
}
async function importSource(source){
 await writeFile(out+'/'+source.name+'-input.json',JSON.stringify(source,null,2)+'\n');await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:source.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});return ready(source.name);
}
async function ordinaryCase(){
 const source=fixture(),row={name:source.name,steps:[]};report.cases.push(row);phase=row.name+':import';console.log(JSON.stringify({phase}));await importSource(source);
 const baseline=await playPause(source.name),original=palette(baseline),initialCanvas=await canvasPixels();assert.deepEqual(original.colors,originalColors);check(initialCanvas.nonuniformPixels>0,row.name+': initial artwork presented');
 check(baseline.output.backend==='webgl2'&&baseline.output.fractalRender.coloring==='source-fragment',row.name+': native source color renderer used');
 row.baseline=baseline;row.initialCanvas=initialCanvas;row.appearance=await openAppearance(baseline,row.name);check(row.appearance.mode==='manual',row.name+': ordinary source opens Manual');
 phase=row.name+':cosine';let state=await edit(baseline,()=>mode().selectOption('cosine'),'Manual to Cosine');check(palette(state).useCosine&&!palette(state).useCurve,'Cosine mode sets mutually exclusive flags');
 state=await edit(state,()=>commit('count',9),'Cosine count 9');check(palette(state).colors.length===9,'Cosine produces 9 canonical colors');const preParameter=state;
 state=await edit(state,()=>commit('a-0',.25),'Cosine A R');check(palette(state).cosine.a[0]===.25,'A R parameter reaches renderer');check(state.output.rgbaSha256!==preParameter.output.rgbaSha256,'Cosine A R changes actual Worker pixels');
 const cosineNine=state,cosineCanvas=await canvasPixels();check(cosineCanvas.rgbaSha256!==initialCanvas.rgbaSha256,'Cosine edit changes presented canvas');
 state=await edit(state,()=>commit('count',5),'Cosine count 5');check(palette(state).colors.length===5,'Cosine count changes canonical palette length');check(state.output.rgbaSha256===cosineNine.output.rgbaSha256,'Continuous Cosine pixels independent of generated palette count');check((await canvasPixels()).rgbaSha256===cosineCanvas.rgbaSha256,'Continuous Cosine count change preserves presented canvas');row.steps.push({name:'continuous-cosine',nine:cosineNine,five:state,canvas:cosineCanvas});
 phase=row.name+':curve';state=await edit(state,()=>mode().selectOption('curve'),'Cosine to Curve');check(!palette(state).useCosine&&palette(state).useCurve,'Curve mode bakes colors and clears continuous Cosine');assert.deepEqual(palette(state).colors,['#000000','#404040','#808080','#BFBFBF','#FFFFFF']);check(true,'Explicit straight curves bake expected five RGB colors');check(await field('count').inputValue()==='5','Curve shares the current generator count');
 const curveBefore=state;state=await edit(state,()=>button('Add node').click(),'Curve add node');check(palette(state).curves.red.length===3,'Curve node stored canonically');state=await edit(state,()=>commit('point-y',.9),'Curve edit node');check(palette(state).colors[2]==='#E68080','Curve midpoint baking changes only red');check(state.output.rgbaSha256!==curveBefore.output.rgbaSha256,'Curve point edit changes actual Worker pixels');
 const authored=structuredClone(palette(state)),curveCanvas=await canvasPixels();check(curveCanvas.rgbaSha256!==cosineCanvas.rgbaSha256,'Curve changes presented canvas');row.steps.push({name:'curve',state,canvas:curveCanvas});
 phase=row.name+':manual-restore';state=await edit(state,()=>mode().selectOption('manual'),'Manual color restoration');assert.deepEqual(palette(state),{...authored,colors:original.colors,useCosine:false,useCurve:false});check(true,'Manual restores exact original colors/alpha while retaining edited cosine, curves, offset, gamma and space');
 row.steps.push({name:'manual-restoration',state});
 state=await edit(state,()=>mode().selectOption('curve'),'Reenter edited Curve');const toBake=structuredClone(palette(state));state=await edit(state,()=>button('Apply as manual palette').click(),'Apply Curve as Manual');assert.deepEqual(palette(state),{...toBake,useCosine:false,useCurve:false});check(await mode().inputValue()==='manual','Apply manual preserves generated result and switches mode');
 const baked=structuredClone(palette(state));state=await edit(state,()=>mode().selectOption('cosine'),'Cosine after bake');state=await edit(state,()=>mode().selectOption('manual'),'Restore baked Manual');assert.deepEqual(palette(state).colors,baked.colors);check(true,'Apply manual rebases restoration colors');
 phase=row.name+':manual-save';let saved=await saveReopen(state,'manual',source,'manual');row.steps.push({name:'manual-save',...saved});state=saved.reopened;
 phase=row.name+':cosine-save';state=await edit(state,()=>mode().selectOption('cosine'),'Cosine before Save');saved=await saveReopen(state,'cosine',source,'cosine');row.steps.push({name:'cosine-save',...saved});state=saved.reopened;
 phase=row.name+':curve-save';state=await edit(state,()=>mode().selectOption('curve'),'Curve before Save');saved=await saveReopen(state,'curve',source,'curve');row.steps.push({name:'curve-save',...saved});state=saved.reopened;
 phase=row.name+':png';row.png=await exportPng(state,row.name);await page.screenshot({path:out+'/'+row.name+'-app.png'});
 phase=row.name+':reset-and-undo';const custom=state;check(palette(custom).curves.red.length===3,'Reset witness begins with custom Curve nodes');
 state=await edit(state,()=>button('Restore source palette defaults').click(),'Restore original palette defaults');check(!Object.hasOwn(palette(state),'curves')&&!Object.hasOwn(palette(state),'useCurve'),'Restore defaults omits authoring curve fields');check(await mode().inputValue()==='cosine','Restore defaults selects canonical Cosine');const omitted=state;
 state=await edit(state,()=>mode().selectOption('curve'),'Curve after omitted reset');for(const channel of ['red','green','blue'])assert.deepEqual(palette(state).curves[channel].map(({x,y})=>({x,y})),[{x:0,y:0},{x:1,y:1}]);check(true,'Same mounted editor uses fresh default ramps after omitted-curve reset');check(palette(state).colors.every(c=>c.slice(1,3)===c.slice(3,5)&&c.slice(3,5)===c.slice(5,7)),'Reset Curve bakes grayscale ramp without stale red node');const ramp=state;
 state=await edit(state,()=>button('Undo').click(),'Undo regenerated default Curve');assert.deepEqual(palette(state),palette(omitted));check(await mode().inputValue()==='cosine','Undo restores omitted curves and canonical mode');
 state=await edit(state,()=>button('Undo').click(),'Undo palette defaults reset');assert.deepEqual(palette(state),palette(custom));check(await mode().inputValue()==='curve'&&await page.getByTestId('source-gradient-curve').locator('circle').count()===3,'Undo restores authored custom Curve nodes');row.steps.push({name:'default-reset-and-undo',custom,omitted,ramp,restored:state});row.status='passed';
}
async function bothFlagsCase(){
 const source=fixture(true),row={name:source.name,steps:[]};report.cases.push(row);phase=row.name+':import';console.log(JSON.stringify({phase}));const baseline=await importSource(source),initialCanvas=await canvasPixels();row.baseline=baseline;
 check(palette(baseline).useCosine&&palette(baseline).useCurve,'Both source flags imported without normalization');assert.deepEqual(palette(baseline).colors,originalColors);check(initialCanvas.nonuniformPixels>0,row.name+': imported continuous artwork presented');
 row.appearance=await openAppearance(baseline,row.name);check(row.appearance.mode==='curve','Both flags show Curve in editor');
 phase=row.name+':curve-edit';let state=await edit(baseline,()=>button('Add node').click(),'Both flags Curve add');state=await edit(state,()=>commit('point-y',.9),'Both flags Curve edit');check(palette(state).useCosine&&palette(state).useCurve,'Curve parameter edit preserves both imported flags');
 assert.deepEqual(palette(state).cosine,palette(baseline).cosine);check(JSON.stringify(palette(state).colors)!==JSON.stringify(originalColors),'Both flags Curve edit updates authored discrete colors');check(state.output.rgbaSha256===baseline.output.rgbaSha256,'Both flags still render continuous Cosine after Curve edit');check((await canvasPixels()).rgbaSha256===initialCanvas.rgbaSha256,'Both flags Curve edit leaves actual continuous canvas unchanged');
 row.steps.push({name:'curve-edit-under-continuous-runtime',state,canvas:await canvasPixels()});
 phase=row.name+':save';const saved=await saveReopen(state,'curve',source,'both');row.steps.push({name:'both-save',...saved});state=saved.reopened;check(state.output.rgbaSha256===baseline.output.rgbaSha256,'Both flags Save/reopen preserves continuous Cosine pixels');
 phase=row.name+':bake';const before=state,expected=structuredClone(palette(state));state=await edit(state,()=>button('Apply as manual palette').click(),'Both flags Apply manual');assert.deepEqual(palette(state),{...expected,useCosine:false,useCurve:false});check(state.output.rgbaSha256!==before.output.rgbaSha256,'Apply manual switches actual rendering to baked Curve colors');check((await canvasPixels()).rgbaSha256!==initialCanvas.rgbaSha256,'Apply manual changes presented canvas');row.steps.push({name:'baked-manual',state});
 phase=row.name+':png';row.png=await exportPng(state,row.name);await page.screenshot({path:out+'/'+row.name+'-app.png'});row.status='passed';
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1360,height:900},deviceScaleFactor:1,acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));await page.addInitScript(installAudit);
 for(const[file,extra]of [['client.ts',instrumentation],['renderer.ts',rendererInstrumentation]])await context.route('**/src/engine/'+file,async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+extra});});
 const origin=server.resolvedUrls.local[0];await page.route('**/gradient-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'gradient-fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('surface'));Object.assign(s.settings,{uSegments:3,vSegments:3});saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});});await page.goto(origin);
 report.measurements=await measureFamily(process.pid,async()=>{const begin=performance.now();await ordinaryCase();await bothFlagsCase();return{elapsedMs:performance.now()-begin,costScope:'Two-case public App workflow after Vite/export service/browser setup'};});
 check(report.pageErrors.length===0,'No unhandled App errors');report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.lastAudit=await page.evaluate(()=>{const a=window.__fractalGradientAudit;return{calls:a.calls.slice(-4),captures:a.captures.slice(-2),controls:a.controls.slice(-4),renders:a.renders.slice(-5),workers:a.workers,terminated:a.terminated};}).catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 report.elapsedMs=performance.now()-started;report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map((r,i)=>({resource:['browser','vite','exportServer'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));report.remainingServiceProcesses=service?.ownedProcessCount??0;
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.remainingServiceProcesses||report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 await writeFile(out+'/README.md',`# Fractal 色板生成器 App 验收\n\n状态：${report.status}\n\n仅使用无窗口 Chrome 与真实 App/Worker；无原版执行或原版像素一致性声明。\n\n完成 ${report.cases.filter(c=>c.status==='passed').length}/2 组、${report.checks.length} 项检查。总耗时 ${(report.elapsedMs/1000).toFixed(1)} 秒；源文件${report.sourceStable?'稳定':'发生变化'}；服务剩余子进程 ${report.remainingServiceProcesses}。\n\n${report.error?`失败阶段：${report.phase}\n\n\`\`\`\n${report.error}\n\`\`\`\n`:''}## 实际验证\n\n- 普通 Manual → Cosine/Curve、参数修改、共享数量、仅恢复颜色、Apply manual 与三种模式保存重开。\n- 双 flag 导入显示 Curve；Curve 编辑更新离散色板但保留连续 Cosine 像素；Apply manual 后才渲染烘焙色板。\n- Appearance 挂载不提交、不改色；同场景恢复默认不复用旧曲线节点，Undo 恢复原作者状态；真实 Worker、主画布与 256×192 PNG。\n\n## 范围限制\n\n${report.limits.map(l=>'- '+l).join('\n')}\n\n${report.cases.filter(c=>c.png).map(c=>`- ${c.name}：[实际 PNG](${c.name}.png) · [App 画面](${c.name}-app.png)；capture RGBA SHA-256 与后处理输入相同，下载 PNG SHA-256 与实际编码输出相同，${c.png.distinctColors} 种像素颜色。`).join('\n')}\n\n完整调用证据、来源 SHA、Node 路径与采样进程成本见 report.json。\n`);
 console.log(JSON.stringify({status:report.status,cases:report.cases.filter(c=>c.status==='passed').length,checks:report.checks.length,phase:report.phase,error:report.error,elapsedMs:report.elapsedMs,directory:out}));
}
