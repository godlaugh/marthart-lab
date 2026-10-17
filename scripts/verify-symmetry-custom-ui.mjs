import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const paths=['src/App.tsx','src/components/SymmetryFormula.tsx','src/components/ParameterEditor.tsx','src/components/ExplorePanel.tsx','src/engine/symmetryEditing.ts','src/engine/symmetryCustom.ts','src/engine/symmetryCustomShader.ts','src/engine/legacyImport.ts','src/engine/document.ts','src/engine/parameterEditing.ts','src/engine/sceneParameters.ts','src/engine/formulas.ts','src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','src/scenes/symmetryParameters.ts','src/engine/timeline.ts','src/engine/client.ts','src/locales/components.en.json','scripts/verify-symmetry-custom-ui.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const check=(v,m)=>{if(!v)throw Error(m);};
const source='\n// Imported custom formula.\nuniform float gain;\nuniform float paintMetric;\nuniform float _bias;\nvoid calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric){\n nextPos=vec3(sin(gain*pos.y)+_bias,cos(gain*pos.x),9.);\n stepMetric=paintMetric;\n}\n';
const fixture={config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Custom GLSL workflow',equation:{template:'standard',formula:'Imported sin/cos formula',glsl:source},parameters:{gain:2.25123456789,paintMetric:.2,lambda:9.123456789,delta:.123456789,symmetry_degree:5},settings:{render_mode:'GPU',batch_size:512,burn_in_steps:0,iterations_per_frame:2,x0_min:-1,x0_max:1,y0_min:-1,y0_max:1,step_metric_min:0,step_metric_max:2}};
const before=await hashes(),server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
const origin=server.resolvedUrls.local[0],browser=await chromium.launch({channel:'chrome',headless:true});let page;
const errors=[],report={at:new Date().toISOString(),scope:'Actual local App original-JSON import, custom parameter edits, template undo, timeline playback, project persistence and PNG download. Original application not executed.'};
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const saved=()=>page.evaluate(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);});
const last=()=>page.evaluate(()=>window.__audit.completed.at(-1));
const auditMark=()=>page.evaluate(()=>({issued:window.__audit.issued,completed:window.__audit.completionCount}));
const freshRecovery=async(mark,expected)=>{
 await page.waitForFunction(({mark,expected})=>window.__audit.completed.some(x=>x.issuedSequence>mark.issued&&x.completionSequence>mark.completed&&x.request.scene.id===expected.id&&x.request.scene.equations.glsl===expected.source&&x.request.scene.settings.iteratedBackend==='gpu'&&x.output.backend==='webgl2'&&x.request.context.quality!=='export'),{mark,expected});
 await ready();
 return page.evaluate(({mark,expected})=>{
  const output=window.__audit.completed.findLast(x=>x.issuedSequence>mark.issued&&x.request.scene.id===expected.id&&x.request.scene.equations.glsl===expected.source&&x.request.scene.settings.iteratedBackend==='gpu'&&x.output.backend==='webgl2'&&x.request.context.quality!=='export');
  return{before:mark,issuedSequence:output.issuedSequence,completionSequence:output.completionSequence,sceneId:output.request.scene.id,backend:output.output.backend,pixelHash:output.pixelHash,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')};
 },{mark,expected});
};
const waitValue=(name,value)=>page.waitForFunction(({name,value})=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);return s.parameters[name]===value;},{name,value});
try{
 page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__audit={completed:[],errors:[],issued:0,completionCount:0};
  window.Worker=class extends NativeWorker{
   sent=new Map();
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.operation!=='generate')return;if(data.error)window.__audit.errors.push(data.error);if(!data.output||data.progress)return;const sent=this.sent.get(data.id);if(!sent)return;const {request,issuedSequence}=sent;const {pixels,...output}=data.output;let hash=2166136261;for(const v of pixels??[]){hash^=v;hash=Math.imul(hash,16777619);}window.__audit.completed.push({request,issuedSequence,completionSequence:++window.__audit.completionCount,output,pixelHash:hash>>>0});if(window.__audit.completed.length>64)window.__audit.completed.shift();});}
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{request:structuredClone(message),issuedSequence:++window.__audit.issued});return super.postMessage(message,...args);}
  };
 });
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const s=createScene(definition('map'));s.settings.count=16;s.settings.burnIn=0;saveWorkspace(localStorage,{scenes:[s],active:s.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);await ready();
 await page.locator('input[type=file]').setInputFiles({name:'custom-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await page.getByLabel('Custom GLSL source',{exact:true}).waitFor();await ready();
 await page.waitForFunction(source=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);return s.equations.glsl===source;},source);
 check((await last()).output.backend==='webgl2','import did not render with actual GPU');check((await saved()).equations.glsl===source,'import source changed');
 check(await page.getByRole('button',{name:'Generate combination',exact:true}).isDisabled(),'custom builtin search still enabled');
 check(await page.getByRole('spinbutton',{name:'Parameter lambda',exact:true}).inputValue()==='9.123456789','custom lambda display rounded');
 check(await page.getByRole('spinbutton',{name:'Parameter delta',exact:true}).inputValue()==='.123456789'||await page.getByRole('spinbutton',{name:'Parameter delta',exact:true}).inputValue()==='0.123456789','custom delta hidden or rounded');
 const initial=await last();
 await page.getByRole('spinbutton',{name:'Parameter gain',exact:true}).fill('3.9123456789');await waitValue('gain',3.9123456789);await ready();
 const geometry=await last();check(geometry.output.backend==='webgl2'&&geometry.pixelHash!==initial.pixelHash,'gain edit did not change actual GPU image');
 await page.getByRole('spinbutton',{name:'Parameter paintMetric',exact:true}).fill('1.7');await waitValue('paintMetric',1.7);await ready();
 const colored=await last();check(colored.pixelHash!==geometry.pixelHash,'authored metric did not change rendered colors');
 await page.getByRole('button',{name:'Add parameter',exact:true}).click();const prompt=page.getByRole('dialog');await prompt.getByRole('textbox').fill('_bias');await prompt.getByRole('button',{name:'Confirm',exact:true}).click();await waitValue('_bias',1);await ready();
 await page.getByRole('spinbutton',{name:'Parameter _bias',exact:true}).fill('.125');await waitValue('_bias',.125);await ready();
 await page.getByRole('button',{name:'Delete parameter lambda',exact:true}).click();await waitValue('lambda',undefined);await ready();
 const beforeTemplate=await saved();
 await page.getByRole('button',{name:'Use template formula',exact:true}).click();await page.getByLabel('Custom GLSL source',{exact:true}).waitFor({state:'detached'});await ready();await waitValue('lambda',-2.34);
 check((await saved()).parameters.lambda===-2.34,'template did not restore missing default');check((await saved()).parameters.gain===beforeTemplate.parameters.gain,'template changed retained custom parameter');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByLabel('Custom GLSL source',{exact:true}).waitFor();await ready();await waitValue('lambda',undefined);check((await saved()).equations.glsl===source&&(await saved()).parameters.lambda===undefined,'template undo lost authored state');
 await page.getByRole('combobox',{name:'New clip type',exact:true}).selectOption('param');await page.getByRole('button',{name:'Add animation',exact:true}).click();
 await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);return s.timeline.tracks.some(t=>t.type==='param');});
 await page.getByRole('spinbutton',{name:'Clip start',exact:true}).fill('0');await page.getByRole('spinbutton',{name:'Clip duration',exact:true}).fill('3');
 await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active);return s.timeline.tracks.some(t=>t.type==='param'&&t.start===0&&t.duration===3);});
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__audit.completed.at(-1)?.request.scene.equations.glsl&&window.__audit.completed.at(-1)?.request.context.time>.1);await page.getByRole('button',{name:'Pause',exact:true}).click();await ready();
 const animated=await last(),uniforms=await page.evaluate(async request=>{const{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');const frame=Math.floor(request.context.time*60),at=frame/60;const f=prepareIteratedFrame(sceneAtTime(request.scene,at),at,frame,request.scene);return f.field.kind==='symmetry-custom'?f.field.uniforms:null;},animated.request);
 check(uniforms&&uniforms.gain!==Math.fround(animated.request.scene.parameters.gain),'timeline did not animate named custom uniform');check(animated.output.backend==='webgl2','animated custom rendered on wrong backend');
 const animatedOracle=await page.evaluate(async request=>{const{Generator}=await import('/src/engine/client.ts'),g=new Generator();const hash=out=>{let h=2166136261;for(const v of out.pixels){h^=v;h=Math.imul(h,16777619);}return h>>>0;};try{const exact=await g.generate(request.scene,request.context),fixed=structuredClone(request.scene);fixed.timeline.tracks=fixed.timeline.tracks.map(track=>track.type==='param'?{...track,enabled:false}:track);const withoutAnimation=await g.generate(fixed,request.context);return{exact:hash(exact),withoutAnimation:hash(withoutAnimation),backend:exact.backend};}finally{g.dispose();}},animated.request);
 check(animatedOracle.exact===animated.pixelHash&&animatedOracle.backend==='webgl2','animated App output differs from cold worker replay');check(animatedOracle.withoutAnimation!==animated.pixelHash,'actual custom output did not consume the parameter animation');
 await page.getByRole('button',{name:'Return to start',exact:true}).click();await ready();
 await page.getByRole('button',{name:'Save',exact:true}).click();await ready();await page.waitForTimeout(350);
 const projectDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export project JSON',exact:true}).click();const project=await projectDownload;await project.saveAs('.cache/symmetry-custom-ui-export.mathart.json');
 const projectJson=JSON.parse(await readFile('.cache/symmetry-custom-ui-export.mathart.json','utf8'));check(projectJson.equations.glsl===source&&projectJson.parameters._bias===.125,'downloaded project lost source or parameter');check(projectJson.provenance.original.equation.glsl===source,'downloaded project lost provenance');
 await page.reload();await page.getByLabel('Custom GLSL source',{exact:true}).waitFor();await ready();check((await saved()).equations.glsl===source&&(await saved()).parameters._bias===.125,'reload lost custom document');
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
 const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const png=await pngDownload;await png.saveAs('.cache/symmetry-custom-ui-export.png');await page.getByText('File ready · Download',{exact:false}).waitFor();
 const exported=await page.evaluate(()=>window.__audit.completed.findLast(x=>x.request.context.quality==='export'));check(exported?.output.backend==='webgl2'&&exported.request.scene.equations.glsl===source,'PNG export did not use custom GPU source');
 const oracle=await page.evaluate(async request=>{const{Generator}=await import('/src/engine/client.ts');const g=new Generator();try{const out=await g.generate(request.scene,request.context);let hash=2166136261;for(const v of out.pixels){hash^=v;hash=Math.imul(hash,16777619);}return{hash:hash>>>0,backend:out.backend};}finally{g.dispose();}},exported.request);
 check(oracle.backend==='webgl2'&&oracle.hash===exported.pixelHash,'export differs from an independent cold custom GPU session');
 const bytes=await readFile('.cache/symmetry-custom-ui-export.png');check(bytes.readUInt32BE(16)===257&&bytes.readUInt32BE(20)===193,'downloaded PNG dimensions wrong');
 await page.getByRole('button',{name:'Close export',exact:true}).click();
 await page.locator('#control-iteratedBackend').selectOption('cpu');await page.locator('.error-card').waitFor();
 check(/Custom Symmetry GLSL|自定义 Symmetry GLSL/.test(await page.locator('.error-card').innerText()),'CPU rejection missing from actual UI');
 check(!(await page.evaluate(()=>window.__audit.completed.some(x=>x.request.scene.equations.glsl&&x.request.scene.settings.iteratedBackend==='cpu'))),'CPU choice produced a fake custom image');
 const cpuRecoveryMark=await auditMark();await page.locator('#control-iteratedBackend').selectOption('gpu');
 const cpuRecovery=await freshRecovery(cpuRecoveryMark,{id:projectJson.id,source});
 const invalid={...fixture,name:'Invalid GLSL workflow',equation:{...fixture.equation,glsl:'void calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric){nextPos=pos stepMetric=1.;}'}};
 await page.locator('input[type=file]').setInputFiles({name:'invalid-custom.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await page.locator('.error-card').waitFor();
 check(/编译|compil/i.test(await page.locator('.error-card').innerText()),'compile failure not shown in actual UI');
 check(!(await page.evaluate(source=>window.__audit.completed.some(x=>x.request.scene.equations.glsl===source),invalid.equation.glsl)),'invalid source generated a replacement image');
 const compileRecoveryMark=await auditMark();
 await page.locator('input[type=file]').setInputFiles({name:'restored.mathart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(projectJson))});
 const compileRecovery=await freshRecovery(compileRecoveryMark,{id:projectJson.id,source});
 check(!cpuRecovery.rendering&&!cpuRecovery.error&&!compileRecovery.rendering&&!compileRecovery.error,'recovery UI was not settled');
 await page.screenshot({path:'.cache/symmetry-custom-ui.png'});
 const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'production source changed during App verification');check(!errors.length,'page errors');
 Object.assign(report,{status:'passed',checks:{originalJsonImport:true,gpuBackend:'webgl2',exactSourceAndPrecision:true,geometryParameterChangesPixels:true,authoredMetricChangesColors:true,underscoreParameterCreation:true,deleteBuiltinNamedParameter:true,templateUndoRetainsAllValues:true,customTimelineUniform:{time:animated.request.context.time,authoredGainFloat32:Math.fround(animated.request.scene.parameters.gain),values:uniforms},animatedWorkerOracle: animatedOracle,projectDownload:true,provenance:true,reload:true,coldGpuExportOracle:true,explicitCpuErrorWithoutReplacement:true,compileErrorWithoutReplacement:true,gpuRecoveryAfterError:{cpuRecovery,compileRecovery}},image:{width:257,height:193,bytes:bytes.length,pixelHash:exported.pixelHash,sha256:createHash('sha256').update(bytes).digest('hex')},pageErrors:errors,sourceSnapshots:after});
 await writeFile('.cache/symmetry-custom-ui.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){if(page){await page.screenshot({path:'.cache/symmetry-custom-ui-failure.png'});await writeFile('.cache/symmetry-custom-ui-failure.json',JSON.stringify({error:String(error),body:await page.locator('body').innerText(),audit:await page.evaluate(()=>window.__audit),errors},null,2));}throw error;}finally{await browser.close();await server.close();}
