import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Actual App operations and passive Worker/ArtRenderer observations only.
// No replaced generators, fake completion, modified pixels or fault injection.
const scriptPath='scripts/verify-roots-scene-timeline-ui.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourcePaths=async directory=>{const paths=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=directory+'/'+entry.name;if(entry.isDirectory())paths.push(...await sourcePaths(path));else if(entry.isFile())paths.push(path);else throw Error('Unexpected source entry: '+path);}return paths;};
const hashes=async()=>Object.fromEntries(await Promise.all([...(await sourcePaths('src')),scriptPath].sort().map(async path=>[path,sha(await readFile(path))])));
const check=(condition,message)=>{if(!condition)throw Error(message);};
// Match ENGLISH_CATALOG precedence without importing React or a TS loader.
const catalog=Object.assign({},...await Promise.all(['metadata','components','application'].map(async name=>JSON.parse(await readFile(`src/locales/${name}.en.json`,'utf8')))));
const label=source=>catalog[source]??source;
const version='mathart-1.7.8-v1',directory=`.cache/roots-scene-timeline-ui-run-${Date.now()}`;
await mkdir(directory,{recursive:true});
const artifact=name=>`${directory}/${name}`,beforeHashes=await hashes(),checks={},pageErrors=[];
const report={at:new Date().toISOString(),scope:'Actual owned headless Chrome App: explicit Roots full source scene queue import/authoring, ordered camera and gradient actions, sequential density and cloud display history, independently transcribed LINEAR camera and double-advance gradient facts, warm/cold/backward-seek, actual Play/Pause with successive presented frames, save/reopen, and two 257x193 PNG cold replay checks. This does not execute or establish pixel equivalence with the original application or its live worker/millis clock.',sourceSnapshotsBefore:beforeHashes,artifacts:{directory}};
await writeFile(artifact('verifier.mjs'),await readFile(scriptPath),{flag:'wx'});
let server,browser,page,error;
const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
const mark=()=>page.evaluate(()=>({issued:window.__audit.issued,completed:window.__audit.completionCount,workers:window.__audit.workersCreated}));
const fresh=async(before,expected)=>{
 await page.waitForFunction(({before,expected})=>window.__audit.completed.some(row=>row.issuedSequence>before.issued&&row.completionSequence>before.completed&&window.__audit.matches(row,expected)),{before,expected});
 await ready();
 return page.evaluate(({before,expected})=>window.__audit.completed.findLast(row=>row.issuedSequence>before.issued&&row.completionSequence>before.completed&&window.__audit.matches(row,expected)),{before,expected});
};
const installRendererAudit=()=>page.evaluate(async()=>{
 const {ArtRenderer}=await import('/src/engine/renderer.ts');
 const set=ArtRenderer.prototype.setOutput,dispose=ArtRenderer.prototype.dispose,ids=new WeakMap();let next=0;
 window.__renderAudit={outputs:[],disposed:[]};
 ArtRenderer.prototype.setOutput=function(output,scene,...args){
  const result=set.call(this,output,scene,...args);let id=ids.get(this);if(!id)ids.set(this,id=++next);
  const done=window.__audit.outputOwners.get(output);
  window.__renderAudit.outputs.push({id,sceneId:scene.id,issuedSequence:done?.issuedSequence,completionSequence:done?.completionSequence,workerId:done?.workerId,pixelHash:done?.pixelHash,width:this.renderer.domElement.width,height:this.renderer.domElement.height,rootsPresentation:output.rootsPresentation});return result;
 };
 ArtRenderer.prototype.dispose=function(){const result=dispose.call(this);window.__renderAudit.disposed.push(ids.get(this));return result;};
});
const rendered=async row=>{
 await page.waitForFunction(row=>window.__renderAudit.outputs.some(x=>x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence&&x.workerId===row.workerId),row);
 return page.evaluate(row=>window.__renderAudit.outputs.findLast(x=>x.issuedSequence===row.issuedSequence&&x.completionSequence===row.completionSequence&&x.workerId===row.workerId),row);
};
const geometry=()=>page.getByRole('button',{name:'Geometry & parameters',exact:true}).click();
const seek=async(id,time)=>{const before=await mark();await page.getByRole('slider',{name:'Time position',exact:true}).fill(String(time));const row=await fresh(before,{id,time});await rendered(row);return row;};
// Fractional frame ticks can be valid native range positions but rejected by
// range.fill because its decimal string does not exactly match the HTML step.
// Let the real slider own quantization, then match its actual authored request.
const seekFrameByKeyboard=async(id,frame)=>{
 const before=await mark(),slider=page.getByRole('slider',{name:'Time position',exact:true});await slider.focus();await slider.press('Home');
 for(let i=0;i<frame;i++)await slider.press('ArrowRight');
 const time=Number(await slider.inputValue()),row=await fresh(before,{id,time});await rendered(row);
 check(row.output.rootsPresentation.cameraTimeline.frame===frame,'slider keyboard seek did not deliver the requested display frame');return{row,inputTime:time,keys:['Home',...Array(frame).fill('ArrowRight')],frame};
};
const checkViewport=row=>{
 const facts=row.output.rootsPresentation,request=row.request.context.rootsViewport;
 check(request&&facts&&JSON.stringify(facts.physicalSize)===JSON.stringify([row.request.context.width,row.request.context.height])&&JSON.stringify(facts.logicalSize)===JSON.stringify([request.logicalWidth,request.logicalHeight])&&facts.referenceLogicalHeight===request.referenceLogicalHeight&&facts.target===request.target,'delivered physical/logical/reference/target facts do not match actual request');
};
// Static-source-derived F32 reference for these LINEAR fixtures only. It does
// not import the production clock, parser, easing, or sceneAtTime.
function cameraReference(fps,target,initial,clips){
 const F=Math.fround,dt=F(1/fps),camera=Object.fromEntries(Object.entries(initial).map(([k,v])=>[k,F(v)]));
 let rates=[0,0,0],index=0,runtime=0,current=false,startZoom=0,startRates=[],sceneTime=0,activeDt=0;
 let running=false,progress=0,speedScale=0,targetSpeed=0,offset=0,base=0,stopScale=0,phases=[],managerFinishedAtFrameStart=false;
 const wrap=n=>{const r=n%1;return r<0?r+1:r;};
 const advance=(kind,delta)=>{const progressBefore=progress,offsetBefore=offset,applied=running;if(running){if(delta>0)progress=wrap(progress+((targetSpeed*speedScale)*delta)/360);const candidate=F(base+progress);if(Number.isFinite(candidate)&&candidate!==offset)offset=candidate;}phases.push({kind,dt:delta,applied,progressBefore,progressAfter:progress,offsetBefore,offsetAfter:offset});};
 for(let frame=0;frame<=target;frame++){
  phases=[];managerFinishedAtFrameStart=index>=clips.length;
  if(index<clips.length){
   let remaining=current?Math.max(0,F(F(clips[index].duration)-runtime)):0;
   for(let i=index+(current?1:0);i<clips.length;i++)remaining=F(remaining+Math.max(0,F(clips[i].duration)));
   activeDt=remaining>0?Math.min(dt,remaining):0;sceneTime=F(sceneTime+activeDt);
   const clip=clips[index];if(!current){current=true;runtime=0;startZoom=camera.zoom;startRates=[...rates];if(clip.gradient==='start'){base=offset;running=true;progress=0;speedScale=0;targetSpeed=360;}if(clip.gradient==='stop')stopScale=speedScale;}
   runtime=F(runtime+activeDt);const p=Math.max(0,Math.min(1,F(runtime/F(clip.duration))));
   if(clip.zoom!==undefined)camera.zoom=F(startZoom+F(F(F(clip.zoom)-startZoom)*p));
   if(clip.rates)rates=clip.rates.map((v,i)=>F(startRates[i]+F(F(F(v)-startRates[i])*p)));
   if(clip.gradient==='start')speedScale=p;else if(clip.gradient==='stop'&&running)speedScale=stopScale*(1-p);
   if(runtime>=F(clip.duration)){if(clip.gradient==='start')speedScale=1;else if(clip.gradient==='stop'&&running){speedScale=0;running=false;targetSpeed=0;}if(clip.rates)rates=clip.rates.map(F);index++;runtime=0;current=false;}
  }else{activeDt=dt;sceneTime=F(sceneTime+dt);}
  if(!managerFinishedAtFrameStart)advance('active',activeDt);
  ['phi','theta','gamma'].forEach((k,i)=>camera[k]=F(camera[k]+F(rates[i]*dt)));advance('raw',dt);
 }
 return{camera,rates,rawDt:dt,activeDt,sceneTime,queueIndex:index,queueComplete:index>=clips.length,managerFinishedAtFrameStart,gradient:{running,progress,speedScale,targetSpeed,offset,updates:phases.length,phases}};
}
const fact=row=>row.output.rootsPresentation.cameraTimeline;
const verifyFrame=(row,fixture)=>{
 checkViewport(row);const facts=row.output.rootsPresentation,c=fact(row),frame=Math.floor(row.request.context.time*fixture.fps+1e-9);
 check(facts?.mode===fixture.mode&&row.output.backend==='webgl2'&&c,'missing actual camera timeline GPU facts');
 check(c.fps===fixture.fps&&c.frame===frame&&c.completedFrames===frame+1&&c.sampleTime===frame/fixture.fps&&c.readbacks===1,'camera frame/fps/readback facts mismatch');
 const expected=cameraReference(fixture.fps,frame,fixture.initial,fixture.clips);
 check(c.model==='roots-scene-sequence-v1'&&c.gradient,'missing actual full source gradient facts');
 for(const key of ['running','progress','speedScale','targetSpeed','offset','updates','phases'])check(JSON.stringify(c.gradient[key])===JSON.stringify(expected.gradient[key]),`gradient ${key} differs from the independently transcribed two-advance reference`);
 check(c.managerFinishedAtFrameStart===expected.managerFinishedAtFrameStart,'gradient manager phase identity mismatch');
 check(row.request.scene.settings.rootSourcePaletteOffset===undefined||row.request.scene.settings.rootSourcePaletteOffset===0,'evaluated gradient offset overwrote authored initial offset');
 for(const key of ['rawDt','activeDt','sceneTime','queueIndex','queueComplete'])check(c[key]===expected[key],`camera ${key} mismatch: ${c[key]} != ${expected[key]}`);
 for(const key of ['phi','theta','gamma','zoom'])check(c.camera[key]===expected.camera[key],`camera ${key} differs from independent LINEAR F32 reference`);
 check(JSON.stringify(c.rates)===JSON.stringify(expected.rates),'camera rates differ from independent reference');
 const authored=row.request.scene.rootsPresentation.camera;check(['phi','theta','gamma','zoom','focalDistance'].every(key=>authored[key]===fixture.authoredCamera[key])&&JSON.stringify(authored.center)===JSON.stringify(fixture.authoredCamera.center),'runtime camera overwrote authored baseline');
 return expected;
};
const coldCompare=async row=>page.evaluate(async row=>{
 const {Generator}=await import('/src/engine/client.ts'),generator=new Generator();
 const actual=window.__audit.pixelBytes.get(row.issuedSequence);if(!actual)throw Error('bounded observed pixel buffer expired');
 try{const output=await generator.generate(row.request.scene,row.request.context);let changedChannels=0,maxDifference=0;
  if(output.pixels.length!==actual.length)throw Error('cold output dimensions mismatch');
  for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-output.pixels[i]);if(d)changedChannels++;maxDifference=Math.max(maxDifference,d);}
  return{changedChannels,maxDifference,channels:actual.length,rootsPresentation:output.rootsPresentation};
 }finally{generator.dispose();}
},row);
try{
 const golden=Array.from({length:7},(_,i)=>cameraReference(4,i,{phi:0,theta:0,gamma:0,zoom:1},[{duration:1,gradient:'start'},{duration:.5,gradient:'stop'}]).gradient.offset);
 check(JSON.stringify(golden)===JSON.stringify([.125,.375,.75,.25,.5,.5,.5]),'independent reference no longer matches retained-audit hand vector');
 report.reference={audit:'.cache/roots-camera-gradient-next.json',sha256:sha(await readFile('.cache/roots-camera-gradient-next.json')),golden,originalRuntimeExecuted:false};
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});page.on('pageerror',e=>pageErrors.push(e.message));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.__audit={issued:0,completionCount:0,completed:[],errors:[],workersCreated:0,workersTerminated:0,outputOwners:new WeakMap(),pixelBytes:new Map()};
  const read=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
  window.__audit.matches=(row,e)=>row.request.scene.kind==='roots'&&row.request.context.quality!=='export'&&(e.workerId===undefined||row.workerId===e.workerId)&&(e.id===undefined||row.request.scene.id===e.id)&&(e.name===undefined||row.request.scene.name===e.name)&&(e.time===undefined||row.request.context.time===e.time)&&(e.profile===undefined||row.request.scene.rootsPresentation?.model===e.profile)&&(e.mode===undefined||row.request.scene.rootsPresentation?.mode===e.mode)&&(!e.values||Object.entries(e.values).every(([path,value])=>read(row.request.scene,path)===value));
  window.Worker=class extends NativeWorker{
   sent=new Map();ended=false;workerId;
   constructor(...args){super(...args);this.workerId=++window.__audit.workersCreated;this.addEventListener('message',({data})=>{
    if(data.operation!=='generate'||data.progress)return;const sent=this.sent.get(data.id);if(!sent||data.sessionId!==sent.request.sessionId)return;
    if(data.error){window.__audit.errors.push({...sent,error:data.error});this.sent.delete(data.id);return;}
    if(!data.output)return;const{pixels,...output}=data.output;let pixelHash=2166136261;const colors=new Set();for(let i=0;i<(pixels?.length??0);i++){pixelHash^=pixels[i];pixelHash=Math.imul(pixelHash,16777619);if(i%4===0&&colors.size<16)colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);}
    const row={...sent,output,pixelHash:pixelHash>>>0,distinctRgbUpTo16:colors.size,completionSequence:++window.__audit.completionCount};
    window.__audit.outputOwners.set(data.output,row);if(pixels){window.__audit.pixelBytes.set(row.issuedSequence,pixels.slice());while(window.__audit.pixelBytes.size>12)window.__audit.pixelBytes.delete(window.__audit.pixelBytes.keys().next().value);}window.__audit.completed.push(row);this.sent.delete(data.id);if(window.__audit.completed.length>100)window.__audit.completed.shift();
   });}
   postMessage(message,...args){if(message.operation==='generate')this.sent.set(message.id,{request:structuredClone(message),issuedSequence:++window.__audit.issued,workerId:this.workerId});return super.postMessage(message,...args);}
   terminate(){if(!this.ended){this.ended=true;window.__audit.workersTerminated++;}return super.terminate();}
  };
 });
 const origin=server.resolvedUrls.local[0];
 await page.route('**/api/health',route=>route.fulfill({status:503,contentType:'text/plain',body:'Use actual production local PNG Blob export.'}));
 await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 const startup=await page.evaluate(async()=>{
  const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const scene=createScene(definition('roots'));scene.name='Native presentation import starting workspace';scene.equations.polynomial='z^2-1';
  Object.assign(scene.settings,{sampleCount:1,rootsMode:'single',showAxes:false,showGrid:false});
  saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});return scene;
 });
 await page.goto(origin);await fresh({issued:0,completed:0},{id:startup.id});await installRendererAudit();

 const fixtures=[['density',4,[0,0,.8]],['point-cloud',12,[.3,.4,.5]]].map(([mode,fps,rates])=>({
  mode,fps,rates,initial:{phi:mode==='density'?0:Math.fround(.2),theta:mode==='density'?0:Math.fround(.15),gamma:0,zoom:1},
  native:{config_version:'1.0.0',type:'COMPLEX_ROOTS',name:`Roots ${mode} source scene queue`,polynomial:{variable:'x',coefficients:{2:'1',0:'-0.04*t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},sampling:{sample_count:100,batch_size:10,seed:'91'},palette:['#FF1050F0','#FFFF6020','#FF20FF90'],camera:{phi:mode==='density'?0:.2,theta:mode==='density'?0:.15,gamma:0},settings:{render_mode:mode==='density'?'GPU_DENSITY':'GPU_3D',worker_count:1,solver_max_iterations:180,solver_tolerance:1e-9,scale_x:240,scale_y:160,scale_z:35,offset_x:2,offset_y:-3,offset_z:0,rotation:15,dot_size:.08,color_metric:'im(t2)',brightness:.9,contrast:1,gamma:1,dynamic_range:.9,saturation:1,background_color:'#000000'},timeline:[
   {type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'ambient',args:rates},{method:'gradientStart',args:{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:360}}]},
   {type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'zoom',args:[.75]}]},
   {type:'animate',duration:.5,easing:'LINEAR',actions:[{method:'stopAmbient'},{method:'gradientStop'}]},
   {type:'wait',duration:.5},
  ]},clips:[{duration:.5,rates,gradient:'start'},{duration:.5,zoom:.75},{duration:.5,rates:[0,0,0],gradient:'stop'},{duration:.5}],
 }));
 report.fixtures=fixtures;
 for(const fixture of fixtures){
  fixture.authoredCamera={...fixture.initial,center:[0,0,0],focalDistance:20};
  // JSON object key order is immaterial to camera equality below.
  const result=checks[fixture.mode]={},nativeText='// Actual Roots source scene import\n'+JSON.stringify(fixture.native,null,2);
  await writeFile(artifact(`${fixture.mode}-native.json`),nativeText,{flag:'wx'});
  let before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:`roots-${fixture.mode}-camera.json`,mimeType:'application/json',buffer:Buffer.from(nativeText)});
  let row=await fresh(before,{name:fixture.native.name});await rendered(row);let id=row.request.scene.id;
  check(row.request.scene.timeline.schedule==='roots-scene-sequence-v1'&&row.request.scene.timeline.tracks.length===4,'native file did not select the full source scene queue');
  check(JSON.stringify(row.request.scene.provenance?.original)===JSON.stringify(fixture.native),'source provenance changed');result.imported=row;
  if(fixture.mode==='density'){
   const legacy=structuredClone(row.request.scene);legacy.timeline.schedule='roots-camera-sequence-v1';delete legacy.timeline.tracks[0].actions[1].gradient;
   const legacyText=JSON.stringify(legacy,null,2);await writeFile(artifact('camera-only-retained-marker.mathart.json'),legacyText,{flag:'wx'});
   before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'camera-only-retained-marker.mathart.json',mimeType:'application/json',buffer:Buffer.from(legacyText)});
   const old=await fresh(before,{id});await rendered(old);check(fact(old).model==='roots-camera-sequence-v1'&&!fact(old).gradient,'saved camera-only marker silently activated a gradient');await geometry();
   before=await mark();await page.getByRole('button',{name:label('升级为完整源场景队列'),exact:true}).click();const upgraded=await fresh(before,{id,values:{'timeline.schedule':'roots-scene-sequence-v1'}});await rendered(upgraded);
   check(upgraded.request.scene.timeline.tracks[0].actions[1].gradient===undefined&&!fact(upgraded).gradient.running,'upgrade silently invented missing gradient configuration');
   await page.locator('.track-labels button').nth(0).click();check(await page.getByTestId('roots-gradient-unconfigured').isVisible(),'retained marker lacks an explicit configuration prompt');
   before=await mark();await page.getByRole('button',{name:label('设置源渐变配置'),exact:true}).click();const configured=await fresh(before,{id});await rendered(configured);
   const config=configured.request.scene.timeline.tracks[0].actions[1].gradient;
   check(config.mode==='hue_rotate'&&config.speed===60&&config.interpolation==='oklab'&&config.model==='offsets'&&config.affectInside===true&&config.affectOutside===true&&fact(configured).gradient.running,'explicit configure did not reach the actual source gradient producer');
   result.cameraOnlyUpgrade={old,upgraded,configured,scope:'A saved camera-only local document retains the old unconfigured marker; no new native import semantics are assigned to that saved fixture.'};
   before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'restored-native-density.json',mimeType:'application/json',buffer:Buffer.from(nativeText)});row=await fresh(before,{name:fixture.native.name});await rendered(row);id=row.request.scene.id;
  }
  // These two explicit edits configure the existing local sampling replay;
  // they are not invented native JSON sampling fields.
  await geometry();
  check(await page.getByText(label('完整源场景队列通过渐变动作更新源偏移，停止后保留最后偏移；数值与本地色板轨道保留但不执行。静态源色板与调色参数仍可编辑。'),{exact:true}).isVisible(),'source queue does not explain inactive numeric/gradient color tracks');
  check(await page.getByText(label('本地色板、曝光、白点、透明背景及其动画保留但不参与源密度着色。请编辑源调色参数；源偏移可使用对应数值轨道。'),{exact:true}).count()===0,'source queue still advertises an inactive numeric offset track');
  for(const [key,value] of [['rootSamplesPerFrame',1],['rootSamplingFps',fixture.fps]]){
   before=await mark();await page.locator(`#control-${key}`).fill(String(value));row=await fresh(before,{id,values:{[`settings.${key}`]:value}});await rendered(row);
  }
  const fpsInput=page.getByRole('spinbutton',{name:label('离线预览帧率'),exact:true});
  if(Number(await fpsInput.inputValue())!==fixture.fps){before=await mark();await fpsInput.fill(String(fixture.fps));row=await fresh(before,{id,values:{'timeline.fps':fixture.fps}});await rendered(row);}
  check(await page.getByRole('button',{name:label('返回仅相机队列'),exact:true}).isVisible(),'source queue not visible as enabled');
  if(fixture.mode==='point-cloud'){
   before=await mark();await page.getByRole('checkbox',{name:label('保留点云画面拖影'),exact:true}).check();row=await fresh(before,{id,values:{'rootsPresentation.accumulation.enabled':true}});await rendered(row);
  }
  // Force a fresh instance only after all explicit local fixture edits.
  before=await mark();await page.getByRole('button',{name:label('重新开始空间采样'),exact:true}).click();row=await fresh(before,{id,time:0});await rendered(row);verifyFrame(row,fixture);
  result.initial=row;
  check(row.output.rootsPresentation.attemptedSamples===1&&row.output.rootsPresentation.newRawPoints===2,'first local sample step did not submit one two-root polynomial');
  await page.locator('.track-labels button').nth(0).click();
  const methods=await page.getByRole('combobox',{name:label('动画动作'),exact:true}).first().locator('option').evaluateAll(options=>options.map(o=>o.value));
  check(JSON.stringify([...methods].sort())===JSON.stringify(['ambient','stopAmbient','zoom','gradientStart','gradientStop'].sort()),'full source authoring does not expose exactly the five supported actions');
  check(await page.getByText(label('启用动作'),{exact:true}).count()===0&&await page.getByRole('spinbutton',{name:label('片段起点'),exact:true}).count()===0,'source authoring exposes ignored action enable/start fields');
  for(const axis of ['phi','theta','gamma'])check(await page.getByRole('spinbutton',{name:label(`${axis} 角速度 · 弧度/秒`),exact:true}).isVisible(),'missing three-axis rad/s editor');
  const gradientEdits=[];
  check(await page.getByRole('checkbox',{name:label('影响内部'),exact:true}).count()===0&&await page.getByRole('checkbox',{name:label('影响外部'),exact:true}).count()===0,'Roots incorrectly exposes forced region flags');
  const modeSelect=page.getByRole('combobox',{name:label('渐变方式'),exact:true}),phaseSelect=page.getByRole('combobox',{name:label('偏移相位曲线'),exact:true});
  check(JSON.stringify((await modeSelect.locator('option').evaluateAll(rows=>rows.map(x=>x.value))).sort())===JSON.stringify(['hue_rotate','offset_cycle','palette_morph','cross_fade'].sort()),'missing source gradient mode choices');
  check(JSON.stringify((await phaseSelect.locator('option').evaluateAll(rows=>rows.map(x=>x.value))).sort())===JSON.stringify(['rgb','linear','oklab','oklch'].sort()),'missing source gradient phase choices');
  for(const mode of ['offset_cycle','palette_morph','cross_fade','hue_rotate']){before=await mark();await modeSelect.selectOption(mode);row=await fresh(before,{id});await rendered(row);check(row.request.scene.timeline.tracks[0].actions[1].gradient.mode===mode&&fact(row).gradient.config.mode===mode,'mode edit did not reach Worker and gradient state');gradientEdits.push(row);}
  for(const interpolation of ['rgb','oklab','oklch','linear']){before=await mark();await phaseSelect.selectOption(interpolation);row=await fresh(before,{id});await rendered(row);check(row.request.scene.timeline.tracks[0].actions[1].gradient.interpolation===interpolation&&fact(row).gradient.config.interpolation===interpolation,'phase edit did not reach Worker and gradient state');gradientEdits.push(row);}
  const speed=page.getByRole('spinbutton',{name:label('渐变速度 °/s'),exact:true}),beforeSpeed=row;
  before=await mark();await speed.fill('60');row=await fresh(before,{id});await rendered(row);check(row.pixelHash!==beforeSpeed.pixelHash&&fact(row).gradient.targetSpeed===60,'source gradient speed edit failed to change the actual displayed image');gradientEdits.push(row);
  before=await mark();await speed.fill('360');row=await fresh(before,{id});await rendered(row);verifyFrame(row,fixture);result.gradientEdits=gradientEdits;
  // All children start before any updates. Stop captures the newly started
  // zero speed scale, but running becomes false only when this clip finishes.
  // Reordering is compared at the same initial display frame, after backseek.
  before=await mark();await page.getByRole('button',{name:label('添加动作'),exact:true}).click();row=await fresh(before,{id});await rendered(row);
  before=await mark();await page.getByRole('combobox',{name:label('动画动作'),exact:true}).last().selectOption('gradientStop');const startStop=await fresh(before,{id});await rendered(startStop);
  check(startStop.request.context.time===0&&fact(startStop).gradient.running&&fact(startStop).gradient.speedScale===0&&fact(startStop).gradient.offset===0,'Start then Stop did not retain running state with the captured zero speed during the clip');
  const terminalControl=await seekFrameByKeyboard(id,Math.ceil(.5*fixture.fps)-1),finishedStartStop=terminalControl.row;
  check(!fact(finishedStartStop).gradient.running&&fact(finishedStartStop).gradient.speedScale===0&&fact(finishedStartStop).gradient.targetSpeed===0&&fact(finishedStartStop).gradient.offset===0,'Start then Stop did not stop at the clip completion frame');
  const replayedStartStop=await seek(id,0);check(replayedStartStop.pixelHash===startStop.pixelHash&&JSON.stringify(fact(replayedStartStop).gradient)===JSON.stringify(fact(startStop).gradient),'Start then Stop backseek did not restore the exact initial lifecycle and pixels');
  before=await mark();await page.getByTitle(label('上移动作'),{exact:true}).last().click();const stopStart=await fresh(before,{id});await rendered(stopStart);
  check(stopStart.request.context.time===startStop.request.context.time&&fact(stopStart).frame===fact(startStop).frame&&fact(stopStart).gradient.running&&fact(stopStart).gradient.offset!==0&&stopStart.pixelHash!==startStop.pixelHash,'Stop then Start failed to preserve ordered source lifecycle in the actual image');
  check(JSON.stringify(stopStart.request.scene.timeline.tracks[0].actions.map(x=>x.method))===JSON.stringify(['ambient','gradientStop','gradientStart']),'action reorder did not preserve exact authored order');
  before=await mark();await page.getByTitle(label('删除动作'),{exact:true}).nth(1).click();row=await fresh(before,{id});await rendered(row);verifyFrame(row,fixture);result.orderedActions={startStop,terminalControl,finishedStartStop,replayedStartStop,stopStart,restored:row};
  const clipIds=row.request.scene.timeline.tracks.map(t=>t.id);
  before=await mark();await page.getByRole('button',{name:label('下移片段'),exact:true}).click();row=await fresh(before,{id});await rendered(row);check(row.request.scene.timeline.tracks[1].id===clipIds[0],'queue reorder did not reach the Worker');
  before=await mark();await page.getByRole('button',{name:label('上移片段'),exact:true}).click();row=await fresh(before,{id});await rendered(row);check(JSON.stringify(row.request.scene.timeline.tracks.map(t=>t.id))===JSON.stringify(clipIds),'queue reorder did not restore authored order');verifyFrame(row,fixture);
  await page.locator('.track-labels button').nth(1).click();
  const zoom=page.getByRole('spinbutton',{name:label('目标相机缩放'),exact:true});check(await zoom.getAttribute('min')===null,'source zoom retains the legacy positive-only HTML constraint');
  for(const value of [-.75,0,.75]){before=await mark();await zoom.fill(String(value));row=await fresh(before,{id});await rendered(row);check(row.request.scene.timeline.tracks[1].actions[0].args.value===value,'zero/negative authored source zoom was blocked');}
  verifyFrame(row,fixture);result.authoring={methods,restored:row,negativeAndZeroTargetsAccepted:true};
  const stages=[];
  for(const time of [.25,.75,1.25,1.75]){const previous=row;row=await seek(id,time);const expected=verifyFrame(row,fixture);check(fact(row).framesAdvanced===fact(row).frame-fact(previous).frame,'warm seek did not advance each missing camera frame');const cold=await coldCompare(row);check(cold.changedChannels===0&&cold.maxDifference===0,'warm frame differs from independent cold replay through intermediate display frames');check(cold.rootsPresentation.cameraTimeline.framesAdvanced===fact(row).frame+1,'cold comparison skipped intermediate camera steps');stages.push({row,expected,cold});}
  if(fixture.mode==='density')check(fact(stages[1].row).inkClears>fact(stages[0].row).inkClears&&stages[1].row.output.rootsPresentation.density.submittedFinitePointCount<stages[1].row.output.rootsPresentation.totalRawPoints,'intermediate zoom did not actually clear accumulated density ink');
  else check(stages.every(s=>s.row.output.rootsPresentation.pointCloud.accumulationEnabled)&&fact(row).displayFrames===fact(row).completedFrames,'cloud trail history did not draw once for every camera replay step');
  result.stages=stages;
  const beforeBack=row;row=await seek(id,.75);verifyFrame(row,fixture);check(row.output.rootsPresentation.restartReason==='backward-seek'&&row.output.rootsPresentation.instance!==beforeBack.output.rootsPresentation.instance,'backward seek failed to rebuild display history');check(row.pixelHash===stages[1].row.pixelHash,'backward replay pixels differ from the earlier corresponding frame');result.backward=row;
  row=await seek(id,1.75);verifyFrame(row,fixture);check(row.pixelHash===stages[3].row.pixelHash,'return from backward seek did not restore exact final pixels');
  // Actual playback must deliver and present increasing times. Readiness is
  // established by paired completions, never a fixed sleep or fake frame.
  row=await seek(id,0);verifyFrame(row,fixture);const playStart=await mark(),playWorkerId=row.workerId;
  await page.getByRole('button',{name:label('播放'),exact:true}).click();
  await page.waitForFunction(({id,playStart})=>{
   const rows=window.__audit.completed.filter(x=>x.request.scene.id===id&&x.request.context.quality!=='export'&&x.issuedSequence>playStart.issued&&x.completionSequence>playStart.completed&&x.request.context.time>0&&window.__renderAudit.outputs.some(y=>y.issuedSequence===x.issuedSequence&&y.completionSequence===x.completionSequence&&y.workerId===x.workerId));
   return rows.some((a,i)=>rows.slice(i+1).some(b=>b.request.context.time>a.request.context.time));
  },{id,playStart});
  const pauseStart=await mark();await page.getByRole('button',{name:label('暂停'),exact:true}).click();
  row=await fresh(pauseStart,{id,workerId:playWorkerId});await rendered(row);verifyFrame(row,fixture);
  check(await page.getByRole('button',{name:label('播放'),exact:true}).isVisible(),'Play/Pause did not settle in paused state');
  const selectedTimeText=await page.getByRole('slider',{name:'Time position',exact:true}).inputValue(),selectedTime=Number(selectedTimeText);
  check(Math.abs(row.request.context.time-selectedTime)<1e-9,'paused completion does not belong to the selected timeline time');
  const playingRows=await page.evaluate(({id,playStart,pauseStart})=>window.__audit.completed.filter(x=>x.request.scene.id===id&&x.request.context.quality!=='export'&&x.issuedSequence>playStart.issued&&x.issuedSequence<=pauseStart.issued&&x.request.context.time>0&&window.__renderAudit.outputs.some(y=>y.issuedSequence===x.issuedSequence&&y.completionSequence===x.completionSequence&&y.workerId===x.workerId)),{id,playStart,pauseStart});
  check(playingRows.some((a,i)=>playingRows.slice(i+1).some(b=>b.request.context.time>a.request.context.time)),'playback evidence lost the two increasing presented times');
  for(const played of playingRows)verifyFrame(played,fixture);
  const paused=row;
  result.playback={playingRows,paused,selectedTimeText,selectedTime,requestTime:paused.request.context.time,scope:'Actual local fixed-FPS Play/Pause. Slider text is display formatting, not request identity. Density may perform an empty observation on a repeated request; cloud history must remain unchanged.'};
  const pausedCold=await coldCompare(row);result.playback.pausedCold=pausedCold;check(pausedCold.changedChannels===0&&pausedCold.maxDifference===0,'paused playback image differs from same-request cold replay');
  // Keep the exact completed-request time and live UI worker as identity. The
  // HTML range control may serialize the same frame to a different last digit.
  before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,{id,time:paused.request.context.time,workerId:paused.workerId});await rendered(row);verifyFrame(row,fixture);
  check(row.workerId===paused.workerId&&row.request.context.rootsSessionId===paused.request.context.rootsSessionId&&row.pixelHash===paused.pixelHash&&row.output.rootsPresentation.newSamples===0&&fact(row).framesAdvanced===0,'same-frame paused repeat changed pixels, samples, camera or worker instance');
  for(const key of ['frame','completedFrames','sampleTime','rawDt','activeDt','sceneTime','queueIndex','queueComplete','camera','rates','inkClears','gradient'])check(JSON.stringify(fact(row)[key])===JSON.stringify(fact(paused)[key]),'same-frame paused repeat changed '+key);
  if(fixture.mode==='point-cloud')check(fact(row).displayFrames===fact(paused).displayFrames,'paused cloud repeat added another fade/display frame');
  result.playback.repeated=row;
  row=await seek(id,1.75);verifyFrame(row,fixture);check(row.pixelHash===stages[3].row.pixelHash,'restored target after actual playback differs from prior replay');
  const beforeSave=row;before=await mark();await page.getByRole('button',{name:'Save',exact:true}).click();row=await fresh(before,{id,time:1.75});await rendered(row);verifyFrame(row,fixture);
  check(row.workerId===beforeSave.workerId&&row.request.context.rootsSessionId===beforeSave.request.context.rootsSessionId&&row.output.rootsPresentation.newSamples===0&&fact(row).framesAdvanced===0&&row.pixelHash===beforeSave.pixelHash,'same-time Save advanced camera/samples/history or replaced the runtime instance');
  if(fixture.mode==='point-cloud')check(fact(row).displayFrames===fact(beforeSave).displayFrames,'same-time cloud Save performed another trail blend');result.saved=row;
  const downloading=page.waitForEvent('download');await page.getByTitle(label('导出项目 JSON'),{exact:true}).click();const project=await downloading;await project.saveAs(artifact(`${fixture.mode}-saved.mathart.json`));const savedText=await readFile(artifact(`${fixture.mode}-saved.mathart.json`),'utf8');
  const savedJson=JSON.parse(savedText),parsed=await page.evaluate(async text=>(await import('/src/engine/document.ts')).parseScene(text),savedText);
  check(JSON.stringify(parsed.timeline)===JSON.stringify(row.request.scene.timeline)&&JSON.stringify(parsed.rootsPresentation)===JSON.stringify(row.request.scene.rootsPresentation),'save lost the authored camera/queue');
  check(!Object.hasOwn(savedJson,'evaluatedRootsCamera')&&!Object.hasOwn(savedJson,'evaluatedRootsGradient')&&!Object.hasOwn(savedJson,'rootsSessionId'),'raw saved JSON persisted evaluated runtime camera/session facts');
  check(JSON.stringify(savedJson.rootsPresentation.camera)===JSON.stringify(row.request.scene.rootsPresentation.camera),'raw saved JSON replaced the authored initial camera with runtime state');
  result.downloaded={sha256:sha(savedText),rawRuntimeFieldsAbsent:true,authoredCamera:savedJson.rootsPresentation.camera,timeline:savedJson.timeline};
  before=await mark();await page.locator('input[type=file][accept=".json"]').setInputFiles({name:`roots-${fixture.mode}-saved.mathart.json`,mimeType:'application/json',buffer:Buffer.from(savedText)});row=await fresh(before,{id});await rendered(row);verifyFrame(row,fixture);check(row.request.context.rootsSessionId!==beforeSave.request.context.rootsSessionId,'reopened file retained the old runtime instance');
  row=await seek(id,1.75);verifyFrame(row,fixture);check(row.pixelHash===beforeSave.pixelHash,'saved/reopened replay differs from the authored final frame');result.reopened=row;

  await page.getByRole('button',{name:'Export artwork',exact:true}).click();
 await page.getByRole('combobox',{name:'Roots image source',exact:true}).selectOption('replay');
  await page.getByText(label('空间复根导出会从初始采样重放到所选时间，使用当前相机和导出尺寸；预览中的历史墨迹与点云拖影不会复制。'),{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
  before=await mark();const downloadingPng=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const pngDownload=await downloadingPng;await pngDownload.saveAs(artifact(`${fixture.mode}-export.png`));await page.getByText('File ready · Download',{exact:false}).waitFor();
  const exported=await page.evaluate(({before,id})=>window.__audit.completed.findLast(x=>x.issuedSequence>before.issued&&x.completionSequence>before.completed&&x.request.scene.id===id&&x.request.context.quality==='export'),{before,id});
  check(exported?.output.backend==='webgl2'&&exported.output.width===257&&exported.output.height===193,'native export did not use an actual 257x193 GPU frame');checkViewport(exported);
  check(exported.request.context.rootsViewport.target==='offscreen'&&exported.request.context.rootsViewport.logicalWidth===257&&exported.request.context.rootsViewport.logicalHeight===193&&exported.request.context.rootsViewport.referenceLogicalHeight===row.output.rootsPresentation.referenceLogicalHeight,'export confused logical and reference dimensions');
  verifyFrame(exported,fixture);const exportRenderer=await rendered(exported);check(exportRenderer.width===257&&exportRenderer.height===193,'actual export renderer dimensions differ');
  const png=await readFile(artifact(`${fixture.mode}-export.png`));
  const oracle=await page.evaluate(async({request,actualPng})=>{
   const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
   const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));
   const decode=async blob=>{const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return context.getImageData(0,0,canvas.width,canvas.height).data;};
   try{
    const output=await generator.generate(request.scene,request.context),scene=sceneAtTime(request.scene,request.context.time);renderer.setSize(257,193,1);renderer.setOutput(output,scene,false,outputCamera(scene,output));
    const expected=await decode(await renderer.blob('image/png')),actual=await decode(new Blob([Uint8Array.from(atob(actualPng),c=>c.charCodeAt(0))],{type:'image/png'}));
    let changedChannels=0,maxDifference=0,nonOpaquePixels=0;const colors=new Set();for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d)changedChannels++;maxDifference=Math.max(maxDifference,d);if(i%4===0){colors.add(actual[i]*65536+actual[i+1]*256+actual[i+2]);if(actual[i+3]!==255)nonOpaquePixels++;}}
    return{changedChannels,maxDifference,nonOpaquePixels,distinctRgb:colors.size,decodedBytes:actual.length,rootsPresentation:output.rootsPresentation,backend:output.backend};
   }finally{generator.dispose();renderer.dispose();}
  },{request:exported.request,actualPng:png.toString('base64')});
  check(oracle.changedChannels===0&&oracle.maxDifference===0&&oracle.decodedBytes===257*193*4&&oracle.distinctRgb>1&&oracle.nonOpaquePixels===0,'PNG differs from exact-request cold renderer replay, is uniform or is not opaque');
  check(exported.output.rootsPresentation.presentationAlpha==='opaque-framebuffer-rgb'&&JSON.stringify(oracle.rootsPresentation)===JSON.stringify(exported.output.rootsPresentation),'export/replay presentation facts differ');
  result.png={exported,renderer:exportRenderer,oracle,sha256:sha(png),bytes:png.length,scope:'Same captured request in independent local cold Generator instances, not original paused capture.'};
  await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();await geometry();await page.getByRole('button',{name:label('返回仅相机队列'),exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:artifact(`${fixture.mode}-ui.png`)});
  result.audit=await page.evaluate(()=>({workerErrors:window.__audit.errors,workersCreated:window.__audit.workersCreated,workersTerminated:window.__audit.workersTerminated,render:window.__renderAudit,status:document.querySelector('.status-bar')?.textContent,rendering:!!document.querySelector('.rendering-badge'),error:!!document.querySelector('.error-card')}));
  check(!result.audit.workerErrors.length&&!result.audit.rendering&&!result.audit.error&&result.audit.render.disposed.includes(exportRenderer.id),'App error or undisposed actual export renderer');
 }
 check(!pageErrors.length,'unexpected page errors');const after=await hashes();check(JSON.stringify(beforeHashes)===JSON.stringify(after),'source changed during UI run');
 Object.assign(report,{status:'passed',checks,sourceSnapshots:after,sourceStable:true,limitations:['This workflow covers two explicit small LINEAR mixed queues at 4/12 FPS. UI exposes all four modes and phase curves; these scalar checks cover HUE_ROTATE/LINEAR only, not the full independent numerical matrix.','The independent scalar oracle is a static-source-derived F32 transcription, not an original JVM/runtime observation.','Sample progression remains explicitly configured local replay (one polynomial per sampling step); original concurrent arrival timing is outside scope. The tested mixed gradient order is the static-source contract, not observed original runtime.','PNG equality proves exact-request local cold replay, not native paused-instance export or Processing/GLSL pixel equivalence.','Observed pixel copies are bounded to the most recent 12 delivered outputs; no output pixels are modified or mocked.']});
}catch(cause){
 error=cause;Object.assign(report,{status:'failed',error:String(cause),errorStack:cause?.stack,completedChecksBeforeFailure:checks});
 if(page&&!page.isClosed()){await page.screenshot({path:artifact('failure.png')}).catch(()=>{});report.failure={screenshot:artifact('failure.png'),body:await page.locator('body').innerText().catch(()=>''),audit:await page.evaluate(()=>{const{outputOwners,pixelBytes,...audit}=window.__audit;return audit;}).catch(()=>null),pageErrors};}
}finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanup={browserClosed:browser?!browser.isConnected():true,serverClosed:server?!server.httpServer?.listening:true,errors:cleanup.flatMap(value=>value.status==='rejected'?[String(value.reason)]:[])};
 if(report.cleanup.errors.length){error??=Error('cleanup failed');report.status='failed';}
 await writeFile(artifact('report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path:artifact('report.json'),status:report.status,error:report.error,cleanup:report.cleanup}));
}
if(error)throw error;
