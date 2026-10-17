import {chromium} from '../node_modules/playwright/index.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({channel:'chrome',headless:true});
const root=new URL('../',import.meta.url),path=name=>new URL('.cache/'+name,root);
await mkdir(path(''),{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1600,height:1100},storageState:{cookies:[],origins:[]}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:5177/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain gradient acceptance</title>'}));
 await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const{createScene,parseScene,persistentScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{generateDomain}=await import('/src/engine/domain.ts'),{Generator}=await import('/src/engine/client.ts');
  const check=(v,message)=>{if(!v)throw Error(message);},hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const gradient=(mode='hue_rotate',affectInside=true,affectOutside=true,interpolation='linear')=>({model:'offsets',mode,speed:90,affectInside,affectOutside,interpolation});
  const action=(start,g,label,duration=0)=>({id:crypto.randomUUID(),type:'animate',label,target:'settings.paletteOffset',from:0,to:0,start,duration,easing:'linear',enabled:true,pingPong:false,actions:[{id:crypto.randomUUID(),method:g?'gradientStart':'gradientStop',gradient:g}]});
  const make=()=>{const s=createScene(definition('domain'));s.name='Domain gradient verification';s.equations.f='z';Object.assign(s.settings,{domainBackend:'gpu',curveMode:'NONE',curveMix:0,curveBias:0,paletteOffset:.2,scale:.8,complexGrid:false});s.palette={name:'Discrete',mode:'linear',stops:['#ff0000','#00ff00','#0000ff'],offset:.1,cycles:2};s.timeline.duration=10;s.timeline.tracks=[];return s;};
  const generator=new Generator(),rows=[],spaces=[],seek=[],endpoints=[];let maxByteDifference=0;
  try{
   for(const mode of ['hue_rotate','offset_cycle','palette_morph','cross_fade'])for(const inside of [true,false])for(const outside of [true,false]){
    const s=make();s.timeline.tracks=[action(0,gradient(mode,inside,outside),'Domain start'),action(2,undefined,'Domain stop')];const hashes=[];
    for(const time of [0,1,2]){const ctx={time,width:96,height:64,quality:'export'},output=await generator.generate(s,ctx),evaluated=sceneAtTime(s,time),cpu=generateDomain({...evaluated,settings:{...evaluated.settings,domainBackend:'cpu'}},ctx);check(output.backend==='webgl2','GPU arithmetic did not execute');check(output.width===96&&output.height===64,'output dimensions');let max=0,changed=0;for(let i=0;i<cpu.pixels.length;i++){const d=Math.abs(cpu.pixels[i]-output.pixels[i]);max=Math.max(max,d);if(d)changed++;}check(max<=1,'CPU/GPU pixels differ beyond one output quantization step');maxByteDifference=Math.max(maxByteDifference,max);
     const delta=mode!=='offset_cycle'&&inside&&outside?Math.min(time,2)*.25:0;check(Math.abs(evaluated.settings.paletteOffset-(.2+delta))<1e-12,'single target truth table');check(evaluated.palette.offset===.1&&evaluated.palette.cycles===2,'authored palette mutated');check(evaluated.evaluatedDomainGradient.running===(time<2),'stop running state');hashes.push({time,hash:await hash(output.pixels),cpuGpuMaxByte:max,differentBytes:changed,backend:output.backend,samples:output.stats.samples});
    }
    if(mode==='offset_cycle'||!inside||!outside)check(hashes[0].hash===hashes[1].hash,'no-motion source projection moved');else check(hashes[0].hash!==hashes[1].hash,'active offset did not change pixels');check(hashes[1].hash!==hashes[2].hash,'stop did not restore ordinary sampler');rows.push({mode,inside,outside,frames:hashes});
   }
   for(const interpolation of ['rgb','linear','oklab','oklch']){const s=make();s.timeline.tracks=[action(0,gradient('hue_rotate',true,true,interpolation),'Color space')];const out=await generator.generate(s,{time:1,width:96,height:64,quality:'export'});spaces.push({interpolation,hash:await hash(out.pixels)});}check(new Set(spaces.map(x=>x.hash)).size===4,'color spaces did not affect actual pixels');
   const s=make();s.timeline.tracks=[action(0,gradient(),'Start',2),action(4,undefined,'Stop',2),action(8,{...gradient(),speed:36},'Restart')];const restored=parseScene(JSON.stringify(s));
   for(const time of [9,1,7,2,8,6,4,5]){const warm=await generator.generate(s,{time,width:96,height:64,quality:'export'}),fresh=new Generator();try{const cold=await fresh.generate(restored,{time,width:96,height:64,quality:'export'});check(await hash(warm.pixels)===await hash(cold.pixels),'cold/warm/reloaded seek differs');seek.push({time,hash:await hash(warm.pixels),running:sceneAtTime(s,time).evaluatedDomainGradient.running});}finally{fresh.dispose();}}
   for(const family of ['domain','fractal'])for(const easing of ['there-and-back','not-quite-there'])for(const scenario of ['start-completion','stop-completion','stop-at-start-completion','restart-during-stop']){
    const source=family==='domain'?make():createScene(definition('fractal'));source.timeline.duration=10;if(family==='fractal')source.settings.fractalBackend='webgl2';
    const start=action(0,gradient(),'Start',scenario==='start-completion'||scenario==='stop-at-start-completion'?1:0),stop=action(1,undefined,'Stop',scenario==='restart-during-stop'?2:1);start.easing=easing;stop.easing=scenario==='stop-at-start-completion'?'linear':easing;
    source.timeline.tracks=[start,...(scenario==='start-completion'?[]:[stop]),...(scenario==='restart-during-stop'?[action(2,{...gradient(),speed:36},'Restart')]:[])];
    const end=scenario==='start-completion'?1:2,offset=time=>{const at=sceneAtTime(source,time);return family==='domain'?at.settings.paletteOffset:at.palette.offset;},frozen=scenario==='stop-completion'||scenario==='stop-at-start-completion';
    if(frozen)check(offset(end+1)===offset(end),`${family} ${easing} stop endpoint drift`);
    else check(Math.abs(offset(end+1)-offset(end)-(scenario==='start-completion'?.25:.1))<1e-12,`${family} ${easing} source start endpoint speed`);
    if(scenario==='stop-at-start-completion')check(Math.abs(offset(2)-offset(1)-.125)<1e-12,`${family} ${easing} stop captured stale easing endpoint`);
    const frames=[];let endpointPixels;for(const time of [end+1,end,.5,end+1]){const output=await generator.generate(source,{time,width:32,height:24,quality:'export'}),at=sceneAtTime(source,time);check(output.backend==='webgl2','endpoint production GPU did not execute');if(family==='domain')check(at.evaluatedDomainGradient.running===!(frozen&&time>=end),'endpoint runtime disagrees with clock');frames.push({time,offset:offset(time),hash:await hash(output.pixels),backend:output.backend});endpointPixels=output.pixels;}
    check((frames[0].hash===frames[1].hash)===frozen,'source endpoint rendered motion mismatch');check(frames[0].hash===frames[3].hash,'unordered repeated endpoint seek differs');
    const fresh=new Generator();let coldReloadMaxByte=0,coldReloadChangedBytes=0,cpuReloadExact;
    try{
     const parsed=parseScene(JSON.stringify(source)),ctx={time:end+1,width:32,height:24,quality:'export'},cold=await fresh.generate(parsed,ctx);
     const sourceFrame=sceneAtTime(source,end+1),restoredFrame=sceneAtTime(parsed,end+1),differences=[];
     const compare=(a,b,path='scene')=>{if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],path+'.'+key);}else if(a!==b)differences.push({path,a,b});};compare(sourceFrame,restoredFrame);
     check(differences.length===0,`${family} ${easing} ${scenario} endpoint authored reload changed timeline facts: ${JSON.stringify(differences)}`);
     for(let i=0;i<cold.pixels.length;i++){const d=Math.abs(cold.pixels[i]-endpointPixels[i]);coldReloadMaxByte=Math.max(coldReloadMaxByte,d);if(d)coldReloadChangedBytes++;}
     // A separate Fractal GL context can differ by one 8-bit quantization step.
     // Record exactness honestly; its CPU oracle and all timeline facts stay exact.
     check(coldReloadMaxByte<=(family==='fractal'?1:0),`${family} ${easing} ${scenario} endpoint cold/reloaded worker differs: max=${coldReloadMaxByte}, changed=${coldReloadChangedBytes}`);
     if(family==='fractal'){
      const cpuSource=structuredClone(source),cpuRestored=structuredClone(parsed);cpuSource.settings.fractalBackend='cpu';cpuRestored.settings.fractalBackend='cpu';
      const warmCpu=await generator.generate(cpuSource,ctx),coldCpu=await fresh.generate(cpuRestored,ctx);check(warmCpu.backend==='cpu'&&coldCpu.backend==='cpu','endpoint CPU oracle backend');cpuReloadExact=await hash(warmCpu.pixels)===await hash(coldCpu.pixels);check(cpuReloadExact,'Fractal endpoint CPU/reloaded pixels differ');
     }
    }finally{fresh.dispose();}
    endpoints.push({family,easing,scenario,frames,coldReloadExact:coldReloadChangedBytes===0,coldReloadMaxByte,coldReloadChangedBytes,...(cpuReloadExact===undefined?{}:{cpuReloadExact})});
   }
   const evaluated=sceneAtTime(s,1);check(!('evaluatedDomainGradient'in persistentScene(evaluated)),'saved runtime');check(!('evaluatedDomainGradient'in parseScene(JSON.stringify({...s,evaluatedDomainGradient:{running:'injected',interpolation:'bad'}}))),'untrusted runtime retained');
   let cancelled=false;const pending=generator.generate(s,{time:1,width:3840,height:2160,quality:'export'});generator.cancel();try{await pending;}catch(e){cancelled=e.name==='AbortError';}check(cancelled,'cancel not propagated');const recovered=await generator.generate(s,{time:1,width:32,height:24,quality:'export'});check(recovered.backend==='webgl2','cancel recovery');
   const ui=make();ui.timeline.tracks=[action(0,gradient(),'Domain start'),action(2,undefined,'Domain stop')];check(localStorage.length===0,'isolated profile must be empty');saveWorkspace(localStorage,{scenes:[ui],active:ui.id,language:'zh',theme:'dark',renderPreferences:{frameRate:30,quality:'low'}});
   return{status:'passed',at:new Date().toISOString(),matrix:rows,colorSpaces:spaces,seek,endpoints,maxByteDifference,cancelRecovery:true,runtimePersistenceBoundary:true,scope:'Actual production Generator workers and CPU owner in isolated Chrome, 96x64 images and Domain/Fractal 32x24 source-completion endpoint checks. The 4K job is cancelled immediately, not a completed capacity measurement.',limits:['Original application was not run; original GPU palette preprocessing, float32 phase accumulation and frame boundaries are not pixel-equivalence claims.','Cosine/Curve/HSV/positioned palettes preserve their own sampling as an explicit offset-only extension.','CPU/GPU <=1-byte tolerance covers independently measured arithmetic/8-bit rounding here, not all functions or views.','Fractal endpoint cross-context GPU checks allow <=1/255 per output channel and report changed bytes; source/reloaded timeline facts, CPU pixels and same-context stopped/repeated GPU pixels must remain exact.']};
  }finally{generator.dispose();}
 });
 await page.unroute('http://127.0.0.1:5177/');await page.reload();
 await page.getByRole('button',{name:'片段 Domain start',exact:true}).click();
 if(await page.getByLabel('渐变类型',{exact:true}).inputValue()!=='offsets')throw Error('Domain editor model unreachable');
 await page.getByLabel('渐变方式',{exact:true}).selectOption('offset_cycle');await page.getByLabel('影响内部',{exact:true}).uncheck();await page.getByLabel('相位曲线与循环颜色插值',{exact:true}).selectOption('oklch');
 await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.drafts?.[w.active]??w.scenes.find(s=>s.id===w.active),g=s.timeline.tracks[0].actions[0].gradient;return g.mode==='offset_cycle'&&g.affectInside===false&&g.interpolation==='oklch';});
 await page.getByLabel('时间位置',{exact:true}).fill('1');await page.waitForTimeout(700);await page.getByTestId('art-canvas').screenshot({path:path('domain-gradient-active.png').pathname});
 await page.getByLabel('时间位置',{exact:true}).fill('2');await page.waitForTimeout(700);await page.getByTestId('art-canvas').screenshot({path:path('domain-gradient-stopped.png').pathname});
 const uiHashes=[];for(const name of ['domain-gradient-active.png','domain-gradient-stopped.png'])uiHashes.push(createHash('sha256').update(await readFile(path(name))).digest('hex'));if(uiHashes[0]===uiHashes[1])throw Error('Displayed canvas did not change at stop');
 await page.reload();await page.getByRole('button',{name:'片段 Domain start',exact:true}).click();if(await page.getByLabel('相位曲线与循环颜色插值',{exact:true}).inputValue()!=='oklch'||await page.getByLabel('影响内部',{exact:true}).isChecked())throw Error('UI reload lost gradient edits');
 await page.waitForFunction(()=>{const text=document.querySelector('.status-bar')?.textContent??'';return text.includes('就绪')&&!text.includes('—');});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:path('domain-gradient-ui.png').pathname});
 report.ui={checks:['Domain model controls reachable','mode / region flags / color interpolation edited','draft persisted and reloaded','actual canvas active/stop screenshots differ'],canvasHashes:uiHashes,screenshot:'studio/.cache/domain-gradient-ui.png'};report.pageErrors=errors;report.sourceSnapshots=[];
 for(const name of ['src/engine/domainGradient.ts','src/engine/domainModel.ts','src/engine/domain.ts','src/engine/colorInterpolation.ts','src/engine/gradientOffsets.ts','src/engine/timeline.ts','src/types.ts','src/components/Timeline.tsx','src/engine/legacyImport.ts','src/engine/document.ts','scripts/verify-domain-gradient.mjs'])report.sourceSnapshots.push({path:'studio/'+name,sha256:createHash('sha256').update(await readFile(new URL(name,root))).digest('hex')});
 if(errors.length)throw Error(errors.join('\n'));await writeFile(path('domain-gradient-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,matrix:report.matrix.length,colorSpaces:report.colorSpaces.length,seek:report.seek.length,endpoints:report.endpoints.length,maxByteDifference:report.maxByteDifference,ui:report.ui,pageErrors:errors}));
}finally{await browser.close();}
