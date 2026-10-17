import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// This exercises the real module Worker and document persistence. The main
// image oracle intentionally shares the CPU mathematical/color owners; the
// separate rational center-point cases are independently derived assertions.
const files=['src/scenes/complex.ts','src/engine/fractalConvergence.ts','src/engine/fractalColor.ts','src/engine/complexMath.ts','src/engine/complexViewport.ts','src/engine/rasterDimensions.ts','src/engine/client.ts','src/engine/generate.worker.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/document.ts','src/engine/legacyImport.ts','src/engine/fractalGpu.ts','src/engine/fractalResidualGpu.ts','src/engine/fractalColorGpu.ts','scripts/verify-fractal-residual-gpu.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const before=await hashes(),baseline=JSON.parse(await readFile('.cache/fractal-residual-legacy-baseline.json','utf8'));
const server=await createServer({server:{host:'127.0.0.1',port:5292,hmr:false},logLevel:'error'});
let browser,timer;
const report={status:'running',at:new Date().toISOString(),sourceSnapshots:Object.entries(before).map(([path,sha256])=>({path:'studio/'+path,sha256})),pageErrors:[]};
await mkdir('.cache',{recursive:true});await mkdir('coverage',{recursive:true});
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();page.on('console',m=>console.log(m.text()));page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route('**/residual-gpu-oracle',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Fractal residual worker verification</title>'}));
 await page.goto(server.resolvedUrls.local[0]+'residual-gpu-oracle');
 const cdp=await browser.newBrowserCDPSession(),run=promisify(execFile),initial=await cdp.send('SystemInfo.getProcessInfo'),started=performance.now(),cpuStart=new Map(initial.processInfo.map(p=>[p.id,p.cpuTime])),cpuObserved=new Map();
 let peakRSSKiB=0,rssSamples=0,sampling=false;
 const sample=async()=>{if(sampling)return;sampling=true;try{const info=await cdp.send('SystemInfo.getProcessInfo');for(const p of info.processInfo)cpuObserved.set(p.id,Math.max(cpuObserved.get(p.id)??0,p.cpuTime-(cpuStart.get(p.id)??0)));const{stdout}=await run('/bin/ps',['-o','rss=','-p',info.processInfo.map(p=>p.id).join(',')]);peakRSSKiB=Math.max(peakRSSKiB,stdout.trim().split(/\s+/).reduce((a,n)=>a+Number(n),0));rssSamples++;}catch{}finally{sampling=false;}};
 await sample();timer=setInterval(sample,100);
 const matrix=await page.evaluate(async baseline=>{
  const {createScene,parseScene,saveWorkspace}=await import('/src/engine/document.ts'),{parseLegacyScene}=await import('/src/engine/legacyImport.ts'),{definitions,fractalConfig,fractalOrbit}=await import('/src/scenes/complex.ts'),{Generator}=await import('/src/engine/client.ts'),{parseFractalColors,shadeFractalOrbit}=await import('/src/engine/fractalColor.ts'),{parseFractalViewport,complexPixel}=await import('/src/engine/complexViewport.ts'),{hexRGB,paletteColor}=await import('/src/engine/palette.ts'),{RESIDUAL_GPU_NOTICE}=await import('/src/engine/fractalConvergence.ts'),{FractalGpu,unpackGpuOrbit}=await import('/src/engine/fractalGpu.ts');
  const check=(ok,why)=>{if(!ok)throw Error(why);},digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const def=definitions.find(d=>d.kind==='fractal'),generator=new Generator(),gpu=new FractalGpu(),rows=[],saved=[],legacy=[],analytic=[],renders=[];
  let workersCreated=0,workersTerminated=0;const NativeWorker=globalThis.Worker;globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);workersCreated++;const terminate=this.terminate.bind(this);let ended=false;this.terminate=()=>{if(!ended){ended=true;workersTerminated++;}terminate();};}};
  const palette={name:'Residual verification',mode:'linear',stops:['#171c4d','#227aaa','#76e6b9','#fbd777','#ed6167'],cycles:1,offset:0};
  function options(scene){Object.assign(scene.settings,{fractalBackend:'webgl2',renderMethod:'one-pass',fractalColorVersion:2,insideColoring:'none',insideSolidColor:'#070913',outsideColoring:'smooth_mandelbrot',outsideColorDensity:1,outsideTransfer:'linear',outsideGradientOffset:0,background:'#123456'});scene.palette=structuredClone(palette);return parseScene(JSON.stringify(scene));}
  function fullOracle(scene,out){
   const c=fractalConfig(scene.settings),colors=parseFractalColors(scene),view=parseFractalViewport(scene.settings),bg=hexRGB(String(scene.settings.background)),expected=new Uint8ClampedArray(out.pixels.length),kinds={converged:0,escaped:0,inside:0,invalid:0},unique=new Set();let mismatches=0,maxByteError=0,repair=0,classMismatch=0,maxZError=0,maxRelativeZError=0,maxDistanceError=0,maxResidualError=0;const points=Float32Array.from({length:out.width*out.height*2},(_,i)=>i%2?Math.floor((i>>1)/out.width):(i>>1)%out.width),raw=gpu.sample(points,out.width,out.height,view,c);
   for(let i=0;i<out.width*out.height;i++){
    const orbit=fractalOrbit(complexPixel(i%out.width,Math.floor(i/out.width),out.width,out.height,view),c),rgb=shadeFractalOrbit(orbit,c,colors);
    if(raw.values){if(raw.values[i*8+7])repair++;else{const o=unpackGpuOrbit(raw.values,i,raw.residual);if(['inside','invalid','converged','count','colorIteration'].some(k=>o[k]!==orbit[k])||o.convergence?.metric!==orbit.convergence?.metric)classMismatch++;maxZError=Math.max(maxZError,Math.hypot(o.z[0]-orbit.z[0],o.z[1]-orbit.z[1]));maxRelativeZError=Math.max(maxRelativeZError,Math.hypot(o.z[0]-orbit.z[0],o.z[1]-orbit.z[1])/Math.max(1,Math.hypot(...orbit.z)));maxDistanceError=Math.max(maxDistanceError,Math.abs((o.convergence?.distance??0)-(orbit.convergence?.distance??0)));maxResidualError=Math.max(maxResidualError,Math.abs((o.convergence?.colorResidual??0)-(orbit.convergence?.colorResidual??0)));}}kinds[orbit.invalid?'invalid':orbit.converged?'converged':orbit.inside?'inside':'escaped']++;
    for(let k=0;k<3;k++)expected[i*4+k]=rgb?Math.round(Math.max(0,Math.min(1,rgb[k]))*255):bg[k]*255;expected[i*4+3]=255;
    for(let k=0;k<4;k++){const error=Math.abs(expected[i*4+k]-out.pixels[i*4+k]);maxByteError=Math.max(maxByteError,error);if(error)mismatches++;}
    unique.add(out.pixels[i*4]+(out.pixels[i*4+1]<<8)+(out.pixels[i*4+2]<<16));
   }
   check(maxByteError<=1,'worker / all-pixel CPU color error '+maxByteError);check(classMismatch===0,'unrepaired orbit classification mismatch '+classMismatch);check(out.stats.invalid===kinds.invalid,'invalid count mismatch');check(out.stats.generated===out.width*out.height-kinds.invalid,'generated count mismatch');
   return {mismatchedBytes:mismatches,maxByteError,orbitClasses:kinds,uniqueRgbColors:unique.size,numericOracle:{available:!!raw.values,warning:raw.warning,repair,unrepaired:raw.values?out.width*out.height-repair:0,classMismatch,maxZError,maxRelativeZError,maxDistanceError,maxResidualError}};
  }
  async function output(scene,width,height){const out=await generator.generate(parseScene(JSON.stringify(scene)),{time:0,width,height,quality:'export'});check(out.type==='raster'&&out.width===width&&out.height===height&&out.pixels.length===width*height*4&&out.stats.samples===width*height,'incomplete requested raster');check(out.backend==='cpu'||out.backend==='webgl2','missing actual backend');if(out.backend==='webgl2')check(out.warnings.includes(RESIDUAL_GPU_NOTICE),'missing residual mixed precision notice');return out;}
  try{
   for(const formula of ['magnet1','magnet2','binocular'])for(const variant of ['mandelbrot','julia']){
    const source={config_version:'1.0.0',type:'FRACTAL',name:`Residual ${formula} ${variant}`,fractal:{formula_id:formula,type:variant.toUpperCase(),iterations:96,render_method:'ONEPASS',parameters:formula==='binocular'?{power:4,bailout:.001,julia_seed:[.15,.2],quad_coeff:[1,0],const_term:[1,0],z0_coeff:[-1,0],denom_offset:1}:{parameter:[.15,.2],perturbation:[0,0],bailout:30,convergent_bailout:formula==='magnet1'?.001:.00005}}};
    const imported=parseLegacyScene(JSON.stringify(source));check(JSON.stringify(imported.source)===JSON.stringify(source),'source import changed authored JSON');const scene=options(imported.scene);Object.assign(scene.settings,{centerX:0,centerY:0,zoom:1.25});check(scene.settings.convergenceMode==='residual'&&scene.settings.variant===variant,'source import residual variant mapping');
    const wall=performance.now(),out=await output(scene,257,193),workerRoundTripMs=performance.now()-wall,hash=await digest(out.pixels),oracle=fullOracle(scene,out);check(oracle.uniqueRgbColors>8,'full scene unexpectedly flat');check(oracle.orbitClasses.converged>0,'matrix failed to reach residual branch');
    const row={formula,variant,requestedBackend:'webgl2',actualBackend:out.backend,width:out.width,height:out.height,stats:out.stats,...oracle,sha256:hash,workerRoundTripMs,warnings:out.warnings,sourceFixture:source,importWarnings:imported.warnings};check(out.backend==='webgl2','default matrix did not use real GPU');console.log(JSON.stringify({completed:formula+'/'+variant,...oracle,backend:out.backend,workerRoundTripMs}));rows.push(row);saved.push(scene);renders.push({pixels:out.pixels,label:formula+' / '+variant});
   }
   // All center coordinates below are exactly on an odd-sized raster's middle
   // pixel. These assertions derive the first rational update independently.
   const cases=[
    {name:'magnet1 fixed point / zero color residual',formula:'magnet1',point:0,extra:{tolerance:1},z:.25,kind:'converged',metric:'fixed-point',distance:.75,residual:0},
    {name:'magnet1 strict equality tolerance',formula:'magnet1',point:0,extra:{tolerance:.75},z:.25,kind:'inside'},
    {name:'magnet1 zero disables convergence',formula:'magnet1',point:0,extra:{tolerance:0},z:.25,kind:'inside'},
    {name:'magnet1 singular division maps zero',formula:'magnet1',point:2,extra:{tolerance:0},z:0,kind:'inside'},
    {name:'magnet1 equal escape radius precedes convergence',formula:'magnet1',point:3,extra:{tolerance:10},z:4,kind:'escaped',index:.05},
    {name:'magnet2 Julia step below threshold',formula:'magnet2',point:0,extra:{variant:'julia',tolerance:.5},z:4/9,kind:'converged',metric:'step',distance:4/9,residual:4/9},
    {name:'magnet2 Mandel fixed distance above threshold',formula:'magnet2',point:0,extra:{tolerance:.5},z:4/9,kind:'inside'},
    {name:'magnet2 Mandel fixed distance preserved',formula:'magnet2',point:0,extra:{tolerance:1},z:4/9,kind:'converged',metric:'fixed-point',distance:5/9,residual:5/9},
    {name:'binocular Mandel step residual',formula:'binocular',point:1,extra:{tolerance:1},z:1.5,kind:'converged',metric:'step',distance:.5,residual:.5},
    {name:'binocular Julia constant participates',formula:'binocular',point:1,extra:{variant:'julia',tolerance:1,juliaReal:0},z:1,kind:'converged',metric:'step',distance:0,residual:0},
    {name:'binocular strict step threshold',formula:'binocular',point:1,extra:{tolerance:.5},z:1.5,kind:'inside'},
    {name:'binocular singular finite sentinel escapes',formula:'binocular',point:0,extra:{denomOffset:0},z:1e30,kind:'escaped'},
    {name:'binocular zero relaxation / tolerance floor',formula:'binocular',point:1,extra:{relaxation:0,tolerance:0},z:1,kind:'converged',metric:'step',distance:0,residual:0},
    {name:'nonfinite Magnet arithmetic stays invalid',formula:'magnet1',point:0,extra:{startReal:1e200},kind:'invalid'},
   ];
   for(const test of cases){
    const scene=options(createScene(def));Object.assign(scene.settings,{formula:test.formula,variant:'mandelbrot',convergenceMode:'residual',iterations:1,power:4,powerImag:0,bailout:4,tolerance:1,relaxation:1,startReal:0,startImag:0,juliaReal:0,juliaImag:0,centerX:test.point,centerY:0,zoom:1,...test.extra});
    const c=fractalConfig(scene.settings),orbit=fractalOrbit([test.point,0],c),kind=orbit.invalid?'invalid':orbit.converged?'converged':orbit.inside?'inside':'escaped';check(kind===test.kind,test.name+' classification');if(test.z!==undefined)check(Math.abs(orbit.z[0]-test.z)<=Math.max(1,Math.abs(test.z))*1e-14&&Math.abs(orbit.z[1])<1e-14,test.name+' rational update');
    let expectedRgb;
    if(kind==='inside')expectedRgb=[7,9,19];else if(kind==='invalid')expectedRgb=[18,52,86];else{
     let index=test.index;
     if(kind==='converged'){check(orbit.convergence.metric===test.metric&&Math.abs(orbit.convergence.distance-test.distance)<1e-14&&Math.abs(orbit.convergence.colorResidual-test.residual)<1e-14,test.name+' separate residual facts');index=.05*(1-Math.log(Math.max(-Math.log(Math.max(test.residual,1e-30)),1e-12))/.69314718056);}
     else if(index===undefined)index=.05*(1+(Math.log(Math.log(4))-Math.log(Math.log(test.z)))/Math.log(4));
     expectedRgb=paletteColor(palette,Math.max(0,index)).map(x=>Math.round(Math.max(0,Math.min(1,x))*255));
    }
    const out=await output(scene,33,25),center=((25>>1)*33+(33>>1))*4;check(expectedRgb.every((v,k)=>v===out.pixels[center+k])&&out.pixels[center+3]===255,test.name+' independently expected center pixel');
    analytic.push({name:test.name,classification:kind,expectedReal:test.z,observedReal:orbit.z[0],convergence:orbit.convergence??null,expectedRgb,actualRgba:Array.from(out.pixels.slice(center,center+4)),...fullOracle(scene,out),stats:out.stats,sha256:await digest(out.pixels)});
   }
   for(const row of baseline.rows)for(const mode of ['omitted','legacy']){
    const scene=createScene(def);Object.assign(scene.settings,{formula:row.formula,variant:row.variant,fractalColorVersion:2,fractalBackend:'cpu',renderMethod:'one-pass',iterations:40,power:4,tolerance:.001,centerX:1,centerY:0,zoom:1});if(mode==='legacy')scene.settings.convergenceMode='legacy';else delete scene.settings.convergenceMode;
    const out=await generator.generate(scene,{time:0,width:40,height:30,quality:'export'}),hash=await digest(out.pixels);check(hash===row.sha256,'pre-change legacy raster hash mismatch');legacy.push({formula:row.formula,variant:row.variant,mode,sha256:hash,matchesRetainedBaseline:true});
   }
   const progress=[],cancelScene=structuredClone(saved[0]);Object.assign(cancelScene.settings,{renderMethod:'multi-pass',iterations:96,tolerance:.001});let cancelled=false;const pending=generator.generate(cancelScene,{time:0,width:320,height:240,quality:'preview'},out=>{progress.push({width:out.width,height:out.height,samples:out.stats.samples,backend:out.backend});generator.cancel();});try{await pending;}catch(e){cancelled=e.name==='AbortError';}check(cancelled&&progress.length===1&&progress[0].backend==='webgl2','progress-driven cancellation did not terminate active worker');
   const recovered=await output(saved[0],257,193),recoveryHash=await digest(recovered.pixels);check(recoveryHash===rows[0].sha256,'post-cancel recovery hash mismatch');
   const contradictory=structuredClone(saved[0]);contradictory.settings.fractalColorVersion=1;let errorMessage;try{await generator.generate(contradictory,{time:0,width:33,height:25,quality:'export'});}catch(e){errorMessage=e.message;}check(errorMessage?.includes('独立内外着色'),'worker accepted contradictory legacy color mode');const afterError=await output(saved[1],257,193);check(await digest(afterError.pixels)===rows[1].sha256,'worker recovery after explicit validation failure');
   saveWorkspace(localStorage,{scenes:saved,active:saved[5].id,theme:'dark',language:'en'});localStorage.setItem('residual-verification-expected',JSON.stringify({scenes:saved,hashes:rows.map(r=>r.sha256)}));
   const canvas=document.createElement('canvas');canvas.width=3*257;canvas.height=2*(193+24);const context=canvas.getContext('2d');context.fillStyle='#111317';context.fillRect(0,0,canvas.width,canvas.height);context.font='14px sans-serif';for(let i=0;i<renders.length;i++){const x=Math.floor(i/2)*257,y=(i%2)*(193+24);context.fillStyle='#ffffff';context.fillText(renders[i].label,x+6,y+17);context.putImageData(new ImageData(renders[i].pixels,257,193),x,y+24);}
   gpu.dispose();generator.dispose();check(workersCreated===workersTerminated,'Generator worker owner retained after dispose');
   return {browser:navigator.userAgent,rows,analytic,legacy,cancellation:{cancelled,progress,recoverySha256:recoveryHash,validationError:errorMessage,recoveredAfterValidationError:true,workersCreated,workersTerminated},montage:canvas.toDataURL('image/png')};
  }finally{gpu.dispose();generator.dispose();globalThis.Worker=NativeWorker;}
 },baseline);
 const {montage,...facts}=matrix;Object.assign(report,facts);
 await page.reload();
 report.persistence=await page.evaluate(async()=>{
  const{loadWorkspace}=await import('/src/engine/document.ts'),{Generator}=await import('/src/engine/client.ts');const workspace=loadWorkspace(localStorage),expected=JSON.parse(localStorage.getItem('residual-verification-expected')),generator=new Generator(),rows=[];
  try{if(!workspace||workspace.scenes.length!==6||workspace.active!==expected.scenes[5].id)throw Error('reload lost workspace scenes/active identity');for(let i=0;i<6;i++){const scene=workspace.scenes[i];if(JSON.stringify(scene)!==JSON.stringify(expected.scenes[i]))throw Error('reload changed authored residual scene');const out=await generator.generate(scene,{time:0,width:257,height:193,quality:'export'}),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out.pixels))).map(n=>n.toString(16).padStart(2,'0')).join('');if(sha256!==expected.hashes[i]||out.backend!=='webgl2'||out.stats.samples!==257*193)throw Error('reload regeneration mismatch');rows.push({formula:scene.settings.formula,variant:scene.settings.variant,mode:scene.settings.convergenceMode,requestedBackend:scene.settings.fractalBackend,actualBackend:out.backend,sha256,settingsRetained:true,stats:out.stats});}return {actualPageReload:true,storage:'production saveWorkspace/loadWorkspace over isolated browser localStorage',activeRetained:true,rows};}finally{generator.dispose();}
 });
 clearInterval(timer);await sample();report.costs={wallMs:performance.now()-started,observedProcessFamilyCpuSeconds:[...cpuObserved.values()].reduce((a,n)=>a+n,0),sampledPeakProcessFamilyRSSKiB:peakRSSKiB,rssSamples,scope:'Whole matrix, independent CPU owner oracle, cancellation, compatibility and page-reload regeneration in an isolated Chrome family; excludes browser/Vite startup. CPU sums observed process counter deltas including last sampled counters of terminated processes; terminated-process tail can be unobserved. RSS samples at 100 ms; shared pages may be counted twice. No before/after performance claim; No deliberate concurrent heavy task during this run. VRAM, JS heap, Vite/Node CPU, agent tokens unmeasured.'};
 if(report.pageErrors.length)throw Error(report.pageErrors.join('\n'));const after=await hashes();report.sourcesUnchanged=JSON.stringify(before)===JSON.stringify(after);if(!report.sourcesUnchanged){report.sourceHashesAfter=after;throw Error('owned verification source changed during run');}
 report.limitations=['No original application was executed; shipped shaders provide static branch evidence only. Local Float64 cannot establish original DS/float32 arithmetic, driver or pixel parity.','Residual rational integer-power orbits use WebGL2 two-float arithmetic; uncertain comparisons and error-estimate cases use the existing CPU Float64 repair. This finite matrix is not a formal error bound for all complex inputs. Noninteger Binocular powers remain explicit CPU fallback.','The complete-image oracle shares production CPU orbit/color owners, verifying worker transport, dimensions, classifications, colors and invalid accounting. Independent rational center cases verify separate first-step facts and coloring; the finite matrix is not a proof for all complex inputs.','Source-shaped fixtures are authored from retained static fields and are not claimed to be original application exports. parseLegacyScene returned source JSON unchanged; production workspace persistence preserves imported local scenes.','Actual localStorage and page reload were exercised. App UI controls, native file pickers and downloaded export files were not exercised.','Images are 257×193, 96 iterations; no 4K, deep-zoom or sustained performance claim. Cancellation starts after an actual progress response and checks a clean worker recovery.'];
 report.status='passed';await writeFile('coverage/fractal-residual-gpu-browser.png',Buffer.from(montage.split(',')[1],'base64'));report.image='studio/coverage/fractal-residual-gpu-browser.png';
 await writeFile('.cache/fractal-residual-gpu-browser.json',JSON.stringify(report,null,2)+'\n');
 const summary={status:report.status,at:report.at,scope:'Real Generator module worker: Magnet I/II and Binocular, Julia/Mandelbrot residual mode',evidence:['studio/.cache/fractal-residual-gpu-browser.json','studio/.cache/fractal-residual-source-evidence.json','studio/.cache/fractal-residual-legacy-baseline.json'],images:report.rows.map(({formula,variant,width,height,sha256,orbitClasses,uniqueRgbColors,mismatchedBytes})=>({formula,variant,width,height,sha256,orbitClasses,uniqueRgbColors,mismatchedBytes})),analyticCases:report.analytic.length,legacyBaselineChecks:report.legacy.length,persistence:{actualPageReload:true,regeneratedScenes:report.persistence.rows.length},cancellation:report.cancellation,costs:report.costs,image:report.image,sourceSnapshots:report.sourceSnapshots,sourcesUnchanged:report.sourcesUnchanged,limitations:report.limitations};
 await writeFile('coverage/fractal-residual-gpu-browser.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(error){report.status='failed';report.error=String(error?.stack??error);await writeFile('.cache/fractal-residual-gpu-browser.json',JSON.stringify(report,null,2)+'\n');throw error;}
finally{clearInterval(timer);await browser?.close();await server.close();}
