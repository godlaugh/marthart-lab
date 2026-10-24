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

const script='scripts/verify-domain-gradient-palette.mjs',out=process.argv[2]??`.cache/domain-gradient-app-${Date.now()}`;
assert.match(relative(resolve('.cache'),resolve(out)),/^domain-gradient-app-[^/]+$/,'Use a new .cache/domain-gradient-app-* directory');
await mkdir('.cache',{recursive:true});await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashes(){
 const paths=[];for(const root of ['src','server'])for(const p of await readdir(root,{recursive:true}))if(/\.(ts|tsx|json|css|mjs)$/.test(p))paths.push(root+'/'+p);
 paths.push(script,'scripts/lib/verify-png.mjs','scripts/browser-process-cost.mjs','package.json','package-lock.json');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
}
const colors=['#80123456','#FFdd5522','#00AAFF','#204060A0',...Array.from({length:28},(_,i)=>'#'+(0x203040+i*290321).toString(16).padStart(6,'0'))];
colors[31]='#80336699';
const specs=[{backend:'cpu',name:'domain-cpu-full-palette'},{backend:'gpu',name:'domain-gpu-prefix-palette'}];
function fixture(spec){const ramp=[{x:0,y:0},{x:1,y:1}];return{config_version:'1.0.0',type:'DOMAIN_COLORING',name:spec.name,settings:{render_mode:spec.backend.toUpperCase()},
 domainColoring:{formula:'z',viewport:{centerX:0,centerY:0,scale:2.5},levelCurve:{mode:'NONE',mix:0,bias:0}},
 color:{use_cosine_palette:true,use_curve_palette:true,cosine_a:[.35,.45,.55],cosine_b:[.4,.3,.2],cosine_c:[1,1,1],cosine_d:[0,.1,.2],curve_red:ramp,curve_green:ramp,curve_blue:ramp},
 palette:colors,timeline:[{type:'wait',duration:30}]};}
const report={status:'running',at:new Date().toISOString(),directory:out,nodeVersion:process.version,nodeExecutable:process.execPath,
 scope:'Two real public App native Domain imports: CPU whole-chain and GPU source color. Palette generation, transient editor ownership, full-Apply behavior, actual renderer delivery, persistence and one current PNG each. Only owned headless Chrome; no original JVM/GUI or original pixel-parity claim.',
 limits:['Small z/phase fixtures without gradient animation; no recording, long-running workloads or arbitrary formulas.','Only valid source color strings, including ARGB and a 32-color tail; malformed/empty/single-color boundaries are not claimed.','PNG uses existing enhancement at 1x; capture SHA links to actual enhancement input and encoded PNG SHA links to download, without comparing raw capture to enhanced pixels.','Passive hashing adds observer overhead. Process CPU/RSS are sampled estimates, not a before/after performance or token comparison.'],checks:[],cases:[],pageErrors:[]};
const check=(v,m)=>{assert.ok(v,m);report.checks.push(m);};
await writeFile(out+'/verifier.mjs',await readFile(script));report.sourceBefore=await hashes();report.priorVerifierFindings=[{report:'.cache/domain-gradient-app-1792824003675/report.json',reason:'The verifier dispatched both input and change for one color picker value, producing two identical author transactions (revision 4 to 6). One Undo correctly returned the first identical edit. The verifier now dispatches one committed change event, preserving a single edit/Undo witness without changing the product.'}];
let browser,server,service,page,phase='setup';const started=performance.now();
function installAudit(){
 const Native=window.Worker;
 const a=window.__domainGradientAudit={sequence:0,workers:0,generationWorkers:0,wire:[],pngJobs:[],hashes:[],terminated:[],calls:[],controls:[],captures:[],renders:[],owners:new WeakMap(),
  sha:async p=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',p))).map(n=>n.toString(16).padStart(2,'0')).join(''),
  meta:o=>({type:o.type,backend:o.backend,width:o.width,height:o.height,domainLive:o.domainLive,domainRender:o.domainRender,sourcePausedImage:o.sourcePausedImage,sourceCurrentImage:o.sourceCurrentImage})};
 window.Worker=class extends Native{
  constructor(...args){super(...args);this.auditId=++a.workers;if(String(args[0]).includes('generate.worker.ts'))a.generationWorkers++;
   this.addEventListener('message',({data})=>{if(data?.operation==='encode-source-paused-png'){const job=a.pngJobs.find(j=>j.worker===this.auditId);if(job&&data.result?.blob){job.width=data.result.width;job.height=data.result.height;a.hashes.push(data.result.blob.arrayBuffer().then(bytes=>a.sha(bytes)).then(hash=>{job.pngSha256=hash;}));}else if(job)job.error=data.error;}});
  }
  postMessage(message,...args){if(message?.operation==='generate'&&message.scene?.kind==='domain')a.wire.push({id:message.id,name:message.scene.name,hasEditor:Object.hasOwn(message.scene,'domainPaletteEditor'),configurationHasEditor:!!message.context?.domainLive?.configuration&&Object.hasOwn(message.context.domainLive.configuration,'domainPaletteEditor')});if(message?.operation==='encode-source-paused-png'){const job={worker:this.auditId,baseWidth:message.width,baseHeight:message.height,scale:message.scale};a.pngJobs.push(job);a.hashes.push(a.sha(message.pixels.slice()).then(hash=>{job.inputRgbaSha256=hash;}));}return super.postMessage(message,...args);}
  terminate(){a.terminated.push(this.auditId);return super.terminate();}
 };
}
const instrumentation=`
const audit=window.__domainGradientAudit,nativeGenerate=Generator.prototype.generate;
Generator.prototype.generate=async function(scene,input,...args){
 const row={sequence:++audit.sequence,workers:audit.generationWorkers,scene:structuredClone(scene),input:structuredClone(input)};audit.calls.push(row);
 try{const o=await nativeGenerate.call(this,scene,input,...args);row.output=audit.meta(o);if(o.pixels)row.output.rgbaSha256=await audit.sha(o.pixels);row.workersAfter=audit.generationWorkers;audit.owners.set(o,{sequence:row.sequence,role:'preview'});return o;}
 catch(e){row.error=String(e);throw e;}
};
const nativePause=Generator.prototype.setDomainPaused;
Generator.prototype.setDomainPaused=async function(output,paused,...args){const row={sequence:++audit.sequence,paused,owner:audit.owners.get(output)};audit.controls.push(row);try{const r=await nativePause.call(this,output,paused,...args);row.completed=true;return r;}catch(e){row.error=String(e);throw e;}};
const nativeCapture=Generator.prototype.captureDomainPaused;
Generator.prototype.captureDomainPaused=async function(output,...args){
 const owner=audit.owners.get(output),source=audit.calls.find(c=>c.sequence===owner?.sequence)??audit.captures.find(c=>c.sequence===owner?.sequence);
 if(!source)throw Error('Domain capture lacks observed Generator owner');const row={sequence:++audit.sequence,scene:source.scene,input:args};audit.captures.push(row);
 try{const pair=await nativeCapture.call(this,output,...args);row.capture=audit.meta(pair.capture);row.capture.rgbaSha256=await audit.sha(pair.capture.pixels);row.output=audit.meta(pair.preview);row.output.rgbaSha256=await audit.sha(pair.preview.pixels);audit.owners.set(pair.capture,{sequence:row.sequence,role:'capture'});audit.owners.set(pair.preview,{sequence:row.sequence,role:'preview'});return pair;}
 catch(e){row.error=String(e);throw e;}
};
`;
const rendererInstrumentation=`
if(typeof window!=='undefined'){const native=ArtRenderer.prototype.setOutput;ArtRenderer.prototype.setOutput=function(output,scene,...args){const result=native.call(this,output,scene,...args),a=window.__domainGradientAudit,owner=a?.owners.get(output);if(owner)a.renders.push({...owner,sceneId:scene.id,width:this.renderer.domElement.width,height:this.renderer.domElement.height});return result;};}
`;
let activeEditor='main';
const button=name=>page.getByRole('button',{name,exact:true}),editor=()=>page.getByTestId('domain-source-palette-'+activeEditor);
const mode=()=>editor().getByRole('combobox',{name:'Source palette generation mode',exact:true}),field=key=>editor().getByTestId('source-bouncing-generator-'+key);
const latest=()=>page.evaluate(()=>window.__domainGradientAudit.calls.findLast(c=>c.input.domainLive));
const palette=row=>row.scene.domainSourcePalette,live=row=>row.output.domainLive;
async function ready(name,after=0){
 await page.waitForFunction(({name,after})=>{const a=window.__domainGradientAudit,c=a.calls.findLast(c=>c.input.domainLive);return c?.sequence>after&&c.scene.name===name&&c.output?.domainLive&&c.output.rgbaSha256&&a.renders.some(r=>r.sequence===c.sequence&&r.role==='preview')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},{name,after});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return latest();
}
async function canvasPixels(){return page.locator('canvas[data-testid="art-canvas"]:not([data-native-hidden="true"]):visible').evaluate(async el=>{
 const gl=el.getContext('webgl2');if(!gl||gl.isContextLost())throw Error('Presented WebGL2 canvas unavailable');const p=new Uint8Array(el.width*el.height*4);gl.readPixels(0,0,el.width,el.height,gl.RGBA,gl.UNSIGNED_BYTE,p);
 const first=p[0]*65536+p[1]*256+p[2];let nonuniformPixels=0;for(let i=0;i<p.length;i+=4)if(p[i]*65536+p[i+1]*256+p[i+2]!==first)nonuniformPixels++;
 return{rgbaSha256:await window.__domainGradientAudit.sha(p),width:el.width,height:el.height,nonuniformPixels};
 });}
function fullApply(before,after,label,paused=true){
 const a=live(before),b=live(after);check(b.sessionId===a.sessionId&&after.workersAfter===before.workersAfter,label+': transport session and generation Worker retained');
 check(b.sceneTime===0&&b.queueIndex===0&&b.updateOrdinal===0,label+': full Apply rebuilds numerical host at time zero');
 check(b.paused===paused&&b.revision>a.revision,label+': full Apply acknowledges new revision with intended playback state');
 assert.deepEqual(b.presentation.domainSourcePalette,palette(after));check(true,label+': real renderer receives canonical discrete palette');
 check(!b.presentation.evaluatedDomainGradient,label+': fixture has no running gradient');check(!Object.hasOwn(b.presentation,'domainPaletteEditor'),label+': runtime presentation excludes authoring generator state');
}
async function edit(before,action,label){const sequence=await page.evaluate(()=>window.__domainGradientAudit.sequence);await action();const after=await ready(before.scene.name,sequence);fullApply(before,after,label);return after;}
async function commit(key,value){await field(key).fill(String(value));await field(key).press('Enter');}
async function tab(before,where,label){
 const a=await page.evaluate(()=>window.__domainGradientAudit.calls.length),image=await canvasPixels();
 if(where==='main'){await button('Appearance').click();activeEditor='main';}
 else{await button('Geometry & parameters').click();activeEditor='cpu-fallback';const summary=page.getByText('CPU recovery palette',{exact:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();}
 await mode().waitFor();await page.waitForTimeout(250);await ready(before.scene.name);
 check(await page.evaluate(n=>window.__domainGradientAudit.calls.length===n,a),label+': editor/tab mount issues no generation');
 assert.deepEqual(palette(await latest()),palette(before));check(true,label+': tab preserves canonical palette');check((await canvasPixels()).rgbaSha256===image.rgbaSha256,label+': tab preserves presented pixels');
 return{mode:await mode().inputValue(),canvas:image};
}
async function pause(name){
 const sequence=await page.evaluate(()=>window.__domainGradientAudit.sequence);await button('Pause').click();await button('Play').waitFor();
 await page.waitForFunction(n=>window.__domainGradientAudit.controls.some(c=>c.sequence>n&&c.completed&&c.paused),sequence);return ready(name);
}
async function playPause(name){const sequence=await page.evaluate(()=>window.__domainGradientAudit.sequence);await button('Play').click();await page.waitForFunction(({name,sequence})=>window.__domainGradientAudit.calls.some(c=>c.sequence>sequence&&c.scene.name===name&&c.output?.domainLive?.sceneTime>.15),{name,sequence});const state=await pause(name);check(live(state).sceneTime>0,name+': actual playback advances before independent pause');return state;}
async function saveReopen(before,source){
 const expected=palette(before),name=before.scene.name,selectedMode=await mode().inputValue(),count=await field('count').inputValue();
 await button('Save').click();check(await mode().inputValue()===selectedMode&&await field('count').inputValue()===count,name+': Save preserves active transient mode and count');
 const download=page.waitForEvent('download');await page.getByTitle('Export project JSON',{exact:true}).click();const path=out+'/'+name+'-project.json';await(await download).saveAs(path);const project=JSON.parse(await readFile(path,'utf8'));
 assert.deepEqual(project.domainSourcePalette,expected);assert.deepEqual(project.provenance.original,source);check(!Object.hasOwn(project,'domainPaletteEditor'),name+': exported project omits transient generator owner');check(project.provenance.original.color.use_cosine_palette&&project.provenance.original.color.use_curve_palette,name+': raw original flags remain preserved as provenance');
 await page.reload();const reopened=await ready(name);assert.deepEqual(palette(reopened),expected);check(!Object.hasOwn(reopened.scene,'domainPaletteEditor'),name+': reopened canonical has no transient generator fields');
 const appearance=await tab(reopened,'main',name+': reopen');check(appearance.mode==='manual',name+': provenance flags are not rehydrated on reopen');return{reopened,projectPath:path,appearance};
}
async function exportPng(before,label){
 await button('Export artwork').click();await button('Still image').click();check(await page.getByRole('combobox',{name:'Domain image source',exact:true}).inputValue()==='current',label+': PNG defaults to actual current numerical snapshot');
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('256');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('192');await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
 const sequence=await page.evaluate(()=>window.__domainGradientAudit.sequence),download=page.waitForEvent('download',{timeout:60000});await button('Start export').click();const path=out+'/'+label+'.png';await(await download).saveAs(path);
 const capture=await page.evaluate(n=>window.__domainGradientAudit.captures.findLast(c=>c.sequence>n&&c.capture),sequence);check(!!capture,label+': PNG uses actual owned paused capture');
 const decoded=decodePng(await readFile(path)),distinct=new Set();for(let i=0;i<decoded.rgba.length;i+=4)distinct.add(decoded.rgba.readUInt32LE(i));
 check(decoded.width===256&&decoded.height===192,label+': PNG custom dimensions');const job=await page.evaluate(async()=>{const a=window.__domainGradientAudit;await Promise.all(a.hashes);return a.pngJobs.at(-1);});check(job?.inputRgbaSha256===capture.capture.rgbaSha256,label+': image enhancement Worker receives exact actual capture RGBA');check(job.pngSha256===sha(await readFile(path)),label+': downloaded PNG SHA-256 equals actual postprocessing Worker Blob');check(await page.evaluate(id=>window.__domainGradientAudit.terminated.includes(id),job.worker),label+': one-job PNG Worker released');check(distinct.size>1,label+': PNG contains visible Domain artwork');
 assert.deepEqual(capture.capture.domainLive.presentation.domainSourcePalette,palette(before));check(true,label+': PNG uses the actual saved canonical palette');const prior=live(before),retained=capture.output.domainLive;for(const key of ['sessionId','revision','sceneTime','queueIndex','updateOrdinal'])check(retained[key]===prior[key],label+': PNG retains '+key);
 check(retained.paused&&capture.capture.domainLive.target==='offscreen'&&retained.target==='primary',label+': PNG snapshots without advancing host');
 check(capture.output.rgbaSha256===before.output.rgbaSha256,label+': PNG restores identical primary pixels');
 await page.waitForFunction(n=>window.__domainGradientAudit.renders.some(r=>r.sequence===n&&r.role==='preview'),capture.sequence);await button('Close export').click();
 return{path,width:256,height:192,pngSha256:sha(await readFile(path)),rgbaSha256:sha(decoded.rgba),distinctColors:distinct.size,postprocessing:job,capture};
}
async function run(spec,context,origin){
 const source=fixture(spec),row={spec,steps:[]};report.cases.push(row);phase=spec.name+':setup';console.log(JSON.stringify({phase}));
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.pageErrors.push(e.message));await page.addInitScript(installAudit);
 await page.route('**/gradient-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'gradient-fixture');
 await page.evaluate(async backend=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('surface'));Object.assign(s.settings,{uSegments:3,vSegments:3});saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:backend==='cpu'?'low':'high',frameRate:20}});},spec.backend);await page.goto(origin);
 phase=spec.name+':import';await writeFile(out+'/'+spec.name+'-input.json',JSON.stringify(source,null,2)+'\n');await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:spec.name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 let state=await ready(spec.name);assert.deepEqual(palette(state),{colors});check(true,spec.name+': import preserves all 32 source strings without generation');row.imported=state;check(state.scene.domainPaletteEditor?.useCosine&&state.scene.domainPaletteEditor?.useCurve,spec.name+': both imported flags retained in temporary owner');
 const appearance=await tab(state,'main',spec.name+': first Appearance');check(appearance.mode==='curve',spec.name+': imported double flags select Curve UI');check(await field('count').inputValue()==='25',spec.name+': initial generator count caps the imported 32 colors at 25 without changing canonical array');
 const originalImage=state.output.rgbaSha256;state=await edit(state,()=>mode().selectOption('manual'),spec.name+': imported Curve to Manual');assert.deepEqual(palette(state),{colors});check(state.output.rgbaSha256===originalImage,spec.name+': clearing UI generator flags preserves rendered discrete palette');
 await button('Geometry & parameters').click();if(spec.backend==='cpu')state=await edit(state,()=>page.getByRole('combobox',{name:'Rendering recovery rules',exact:true}).selectOption('source-cpu-always-v1'),spec.name+': explicit CPU whole-chain policy');
 state=await edit(state,()=>page.locator('#control-domainBackend').selectOption(spec.backend),spec.name+': explicit backend');
 check(state.output.domainRender.effective.backend===(spec.backend==='gpu'?'webgl2':'cpu')&&state.output.domainRender.effective.color==='mathart-1.7.8-'+spec.backend,spec.name+': actual requested CPU/GPU color path');
 if(spec.backend==='cpu')check(state.output.domainRender.route==='source-cpu-forced',spec.name+': actual CPU whole-chain route');
 await tab(state,'main',spec.name+': Manual remount');const initialCanvas=await canvasPixels();check(initialCanvas.nonuniformPixels>0,spec.name+': actual nonuniform artwork presented');row.initialCanvas=initialCanvas;
 phase=spec.name+':tail';const beforeTail=state;await editor().getByRole('spinbutton',{name:'Source color index',exact:true}).fill('32');
 state=await edit(state,()=>editor().locator('input[type="color"][aria-label="Source color"]').evaluate(el=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'#00ff00');el.dispatchEvent(new Event('change',{bubbles:true}));}),spec.name+': edit final color');
 assert.deepEqual(palette(state).colors.slice(0,31),colors.slice(0,31));check(palette(state).colors[31]==='#8000FF00',spec.name+': editing RGB preserves final color alpha and all untouched strings');
 const tailCanvas=await canvasPixels();check((state.output.rgbaSha256!==beforeTail.output.rgbaSha256)===(spec.backend==='cpu'),spec.name+': final color affects CPU full array and leaves GPU prefix unchanged');check((tailCanvas.rgbaSha256!==initialCanvas.rgbaSha256)===(spec.backend==='cpu'),spec.name+': actual canvas confirms tail sampling policy');row.steps.push({name:'32nd-color',before:beforeTail,after:state,canvas:tailCanvas});
 state=await edit(state,()=>button('Undo').click(),spec.name+': Undo tail edit');assert.deepEqual(palette(state),{colors});check(true,spec.name+': Undo restores exact tail string and alpha');
 phase=spec.name+':cosine';state=await playPause(spec.name);row.preGeneratePlayback=state;
 state=await edit(state,()=>mode().selectOption('cosine'),spec.name+': paused Cosine full Apply');check(Math.abs(Number(await field('a-0').inputValue())-.35)<1e-6,spec.name+': first Cosine uses imported temporary coefficients');
 state=await edit(state,()=>commit('count',9),spec.name+': Cosine count 9');check(palette(state).colors.length===9,spec.name+': generated count reaches canonical colors');
 const beforeA=state;state=await edit(state,()=>commit('a-0',.25),spec.name+': Cosine A R');check(state.output.rgbaSha256!==beforeA.output.rgbaSha256,spec.name+': Cosine parameter changes actual rendered colors');const nine=state;
 state=await edit(state,()=>commit('count',5),spec.name+': Cosine count 5');check(palette(state).colors.length===5&&state.output.rgbaSha256!==nine.output.rgbaSha256,spec.name+': Domain renders generated discrete colors, so count changes pixels');state=await edit(state,()=>commit('count',9),spec.name+': restore count 9');
 phase=spec.name+':shared-owner';await tab(state,'cpu-fallback',spec.name+': CPU fallback mount');check(await mode().inputValue()==='cosine'&&await field('count').inputValue()==='9'&&Number(await field('a-0').inputValue())===.25,spec.name+': fallback editor shares main mode, count and coefficients');
 state=await edit(state,()=>commit('a-0',.3),spec.name+': fallback Cosine edit');await tab(state,'main',spec.name+': return to Appearance');check(await mode().inputValue()==='cosine'&&Math.abs(Number(await field('a-0').inputValue())-.3)<1e-6,spec.name+': Appearance sees fallback parameter edit');row.steps.push({name:'shared-cosine-owner',state});
 phase=spec.name+':curve';state=await edit(state,()=>mode().selectOption('curve'),spec.name+': Curve bake');assert.deepEqual(palette(state).colors,['#000000','#202020','#404040','#606060','#808080','#9F9F9F','#BFBFBF','#DFDFDF','#FFFFFF']);check(true,spec.name+': imported ramps bake exact 9 RGB colors');
 state=await edit(state,()=>editor().getByRole('button',{name:'Add node',exact:true}).click(),spec.name+': Curve node');const beforePoint=state;state=await edit(state,()=>commit('point-y',.9),spec.name+': Curve point');check(palette(state).colors[4]==='#E68080'&&state.output.rgbaSha256!==beforePoint.output.rgbaSha256,spec.name+': Curve point bakes red and changes actual output');const customCurve=state;
 await tab(state,'cpu-fallback',spec.name+': fallback Curve mount');check(await mode().inputValue()==='curve'&&await editor().getByTestId('source-gradient-curve').locator('circle').count()===3&&await field('count').inputValue()==='9',spec.name+': Curve nodes and shared count survive tab remount');
 state=await edit(state,()=>mode().selectOption('manual'),spec.name+': fallback Manual restore');assert.deepEqual(palette(state),{colors});check(true,spec.name+': Manual restores 32 raw strings including ARGB and tail through shared owner');assert.deepEqual(state.scene.domainPaletteEditor.cosine,customCurve.scene.domainPaletteEditor.cosine);assert.deepEqual(state.scene.domainPaletteEditor.curves,customCurve.scene.domainPaletteEditor.curves);check(!state.scene.domainPaletteEditor.useCosine&&!state.scene.domainPaletteEditor.useCurve,spec.name+': Manual clears flags but retains shared generator parameters');await tab(state,'main',spec.name+': restored Appearance');check(await mode().inputValue()==='manual',spec.name+': both editors agree on Manual restoration');
 state=await edit(state,()=>mode().selectOption('curve'),spec.name+': revisit custom Curve');assert.deepEqual(palette(state),palette(customCurve));check(await editor().getByTestId('source-gradient-curve').locator('circle').count()===3,spec.name+': temporary Curve parameters survive Manual');
 const baked=structuredClone(palette(state));state=await edit(state,()=>editor().getByRole('button',{name:'Apply as manual palette',exact:true}).click(),spec.name+': Apply manual');assert.deepEqual(palette(state),baked);check(await mode().inputValue()==='manual',spec.name+': Apply manual preserves baked palette');
 state=await edit(state,()=>mode().selectOption('cosine'),spec.name+': Cosine after bake');state=await edit(state,()=>mode().selectOption('manual'),spec.name+': baked Manual restore');assert.deepEqual(palette(state),baked);check(true,spec.name+': Apply manual rebases restoration snapshot');row.steps.push({name:'curve-and-restoration',customCurve,baked,restored:state});
 phase=spec.name+':running-full-apply';state=await edit(state,()=>mode().selectOption('cosine'),spec.name+': running witness setup');const runningStart=await page.evaluate(()=>window.__domainGradientAudit.sequence);await button('Play').click();await page.waitForFunction(n=>window.__domainGradientAudit.calls.some(c=>c.sequence>n&&c.output?.domainLive?.sceneTime>.15),runningStart);
 const running=await page.evaluate(()=>window.__domainGradientAudit.calls.findLast(c=>c.output?.domainLive)),mark=await page.evaluate(()=>window.__domainGradientAudit.sequence);await commit('a-0',.4);
 await page.waitForFunction(({mark,revision})=>{const a=window.__domainGradientAudit;return a.calls.some(c=>c.sequence>mark&&c.output?.domainLive?.revision>revision&&a.renders.some(r=>r.sequence===c.sequence));},{mark,revision:live(running).revision});
 const reset=await page.evaluate(({mark,revision})=>window.__domainGradientAudit.calls.find(c=>c.sequence>mark&&c.output?.domainLive?.revision>revision),{mark,revision:live(running).revision});fullApply(running,reset,spec.name+': playing generator edit',false);state=await pause(spec.name);row.steps.push({name:'playing-full-apply',running,reset,paused:state});
 phase=spec.name+':save';state=await edit(state,()=>mode().selectOption('curve'),spec.name+': Curve before Save');const saved=await saveReopen(state,source);row.saved=saved;state=saved.reopened;
 phase=spec.name+':png';row.png=await exportPng(state,spec.name);await page.screenshot({path:out+'/'+spec.name+'-app.png'});
 phase=spec.name+':reopen-defaults';state=await edit(state,()=>mode().selectOption('cosine'),spec.name+': fresh Cosine after reopen');check(Number(await field('a-0').inputValue())===.5,spec.name+': reopen uses default coefficient, not provenance or old session edits');state=await edit(state,()=>mode().selectOption('curve'),spec.name+': fresh Curve after reopen');check(await editor().getByTestId('source-gradient-curve').locator('circle').count()===2,spec.name+': reopen does not revive old custom Curve nodes');row.freshOwner=state;
 row.wire=await page.evaluate(()=>window.__domainGradientAudit.wire);check(row.wire.length>0&&row.wire.every(w=>!w.hasEditor&&!w.configurationHasEditor),spec.name+': actual Worker requests exclude temporary editor owner and snapshots');row.status='passed';await page.close();page=undefined;
}
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1360,height:900},deviceScaleFactor:1,acceptDownloads:true});
 for(const[file,extra]of [['client.ts',instrumentation],['renderer.ts',rendererInstrumentation]])await context.route('**/src/engine/'+file,async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+extra});});
 const origin=server.resolvedUrls.local[0];report.measurements=await measureFamily(process.pid,async()=>{const begin=performance.now();for(const spec of specs)await run(spec,context,origin);return{elapsedMs:performance.now()-begin,costScope:'Two-case public App workflow after Vite/export service/browser setup'};});check(report.pageErrors.length===0,'No unhandled App errors');report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.lastAudit=await page.evaluate(()=>{const a=window.__domainGradientAudit;return{calls:a.calls.slice(-4),captures:a.captures.slice(-2),controls:a.controls.slice(-4),renders:a.renders.slice(-5),workers:a.workers,terminated:a.terminated};}).catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{
 report.elapsedMs=performance.now()-started;report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map((r,i)=>({resource:['browser','vite','exportServer'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));report.remainingServiceProcesses=service?.ownedProcessCount??0;
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.remainingServiceProcesses||report.cleanup.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');const m=report.measurements?.processFamily;
 await writeFile(out+'/README.md',`# Domain 色板生成器 App 验收\n\n状态：${report.status}\n\n完成 ${report.cases.filter(c=>c.status==='passed').length}/2 组、${report.checks.length} 项检查。仅使用无窗口 Chrome；无原版执行或像素一致性声明。\n\n总耗时 ${(report.elapsedMs/1000).toFixed(3)} 秒；${m?`采样 CPU ${(m.observedCpuMs/1000).toFixed(2)} 秒，峰 RSS ${m.sampledPeakRssKiB} KiB，采样错误 ${m.samplingErrors.length}；`:''}源码${report.sourceStable?'稳定':'发生变化'}；服务遗留进程 ${report.remainingServiceProcesses}。\n\n${report.error?`失败阶段 ${report.phase}\n\n\`\`\`\n${report.error}\n\`\`\`\n`:''}## 覆盖\n\n- CPU 完整 32 色与 GPU 前 16 色的真实像素/画布见证。\n- 导入、Appearance 和 tab 往返不提交；两个 editor 共用模式、数量、参数及 Manual 快照。\n- Cosine/Curve 离散生成，原始颜色及 alpha/尾项恢复，Apply manual。\n- 暂停和播放期间生成均完整应用，从时间 0 重建数值宿主。\n- Save 保留活动会话；导出不保存临时生成器，重开不从 provenance 重新灌入旧 flags。\n- 小尺寸当前 PNG 的 capture→增强 Worker→下载 SHA 链，主画面保留。\n\n## 限制\n\n${report.limits.map(l=>'- '+l).join('\n')}\n\n${report.cases.filter(c=>c.png).map(c=>`- ${c.spec.name}：[实际 PNG](${c.spec.name}.png) · [App 画面](${c.spec.name}-app.png) · [保存项目](${c.spec.name}-project.json)；${c.png.distinctColors} 种像素颜色。`).join('\n')}\n\nNode ${report.nodeVersion}：\`${report.nodeExecutable}\`。完整调用、来源 SHA 与成本证据见 report.json。\n`);
 console.log(JSON.stringify({status:report.status,cases:report.cases.filter(c=>c.status==='passed').length,checks:report.checks.length,phase:report.phase,error:report.error,elapsedMs:report.elapsedMs,directory:out}));
}
