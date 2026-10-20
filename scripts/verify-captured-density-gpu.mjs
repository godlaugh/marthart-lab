/** Actual WebGL particle/ink integration, not a native MathArt pixel oracle. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as tcpServer} from 'node:net';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/captured-density-gpu-${Date.now()}`;
await mkdir(directory,{recursive:true});
const files=['src/engine/iteratedDensityGpu.ts','src/engine/density.ts','src/engine/densityPresentation.ts','src/engine/sourceDensityCamera.ts','src/scenes/iteratedDensity.ts','scripts/verify-captured-density-gpu.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const report={status:'running',at:new Date().toISOString(),sourceBefore:await hashes(),limits:['Shared local camera/sampling functions are not a native JVM/JOGL pixel oracle.','The existing local soft circular quad footprint is tested; original device point/quad selection is not established.','Small GPU surfaces; wall time measured, process-family CPU/peak RAM and GPU-driver allocations unmeasured.']};
const started=performance.now();let server,browser;
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 server=await createServer({server:{port,host:'127.0.0.1',strictPort:true,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route('**/density-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Density GPU verification</title>'}));await page.goto(server.resolvedUrls.local[0]+'density-fixture');
 report.result=await page.evaluate(async()=>{
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {prepareSourceCamera,SOURCE_CAMERA_MODEL}=await import('/src/engine/sourceCamera.ts'),{packSourceProcessingMatrix:pack}=await import('/src/engine/sourceProcessingMatrix.ts');
  const {prepareCapturedDensityCamera,prepareCapturedDensityView,projectCapturedDensityPoint,sampleCapturedDensity}=await import('/src/engine/sourceDensityCamera.ts');
  const {prepareDensityTone,toneDensityRgbaPrepared}=await import('/src/engine/density.ts');
  let assertions=0;const check=(v,m)=>{assertions++;if(!v)throw Error(m);},same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const width=40,height=28,I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],options={resetParticles:true,clearInk:true,width,height,projection:'xz',padding:0,bounds:{minX:-9,maxX:9,minY:-8,maxY:8}};
  function plan(){const p=prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'map',phi:0},frame:{}},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:height,target:'primary',projectionPass:'perspective'});if(!p.ok||p.value.kind!=='known')throw Error('camera plan');return p.value.plan;}
  function job(){const s=createScene(definition('map'));s.equations={x:'.25',y:'-.125'};Object.assign(s.settings,{batchSize:7,burnIn:0,iterationsPerFrame:1,pointSize:2,iteratedColor:'height'});const j=prepareIteratedFrame(s,0,0);j.transform={...j.transform,sx:1,sy:1,sz:1,ox:0,oy:0,oz:0,co:1,si:0};return j;}
  const cases=[
   {name:'identity',m:I,p:I},
   {name:'noncommuting-model-then-projection',m:[1,0,0,.25,0,1,0,.125,0,0,1,0,0,0,0,1],p:[.5,0,0,0,0,2,0,0,0,0,1,0,0,0,0,1]},
   {name:'perspective-w',m:I,p:[1,0,0,0,0,1,0,0,0,0,1,0,.5,0,0,1]},
   {name:'behind',m:I,p:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,-1]},
   {name:'far',m:[1,0,0,0,0,1,0,0,0,0,1,2,0,0,0,1],p:I},
   {name:'near',m:[1,0,0,0,0,1,0,0,0,0,1,-2,0,0,0,1],p:I},
   {name:'side-outside',m:[1,0,0,2,0,1,0,0,0,0,1,0,0,0,0,1],p:I},
   {name:'side-splat-overlap',m:[1,0,0,.77,0,1,0,0,0,0,1,0,0,0,0,1],p:I},
   {name:'tilted-source-camera',actual:true},
  ];
  const rows=[];let baseColor;
  for(const c of cases){const gpu=new IteratedDensityGpu();try{
   const j=job();let p=c.actual?(()=>{const p=plan();return p;})():{...plan(),projection:pack(c.p),modelView:pack(c.m)};
   if(c.actual){const a=prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'map',phi:.3,theta:.7},frame:{phi:.3,theta:.7,center:[.1,0,0]}},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:height,target:'primary',projectionPass:'perspective'});check(a.ok&&a.value.kind==='known','tilted plan');p=a.value.plan;}
   j.sourceCamera=prepareCapturedDensityCamera('map',p);const facts=gpu.step(j,options),ink=gpu.readback(),state=gpu.readParticles(),point=Array.from(state.positionsAndMetric.slice(0,3)),projected=projectCapturedDensityPoint(j.sourceCamera.anchor,point,width,height),[x,y,z,w]=projected.clip;
   const valid=[x,y,z,w].every(Number.isFinite)&&w>0&&z>=-w&&z<=w,[cx,cy]=projected.pixel,r=j.config.pointSize/2;
   let error=0,mass=0;for(let py=0;py<height;py++)for(let px=0;px<width;px++){const expected=valid?Math.max(0,Math.min(1,r+.5-Math.hypot(px+.5-cx,py+.5-cy)))*j.config.count*j.config.alpha:0,actual=ink[(py*width+px)*4+3];error=Math.max(error,Math.abs(expected-actual));mass+=actual;}
   const intersects=valid&&Math.max(0,Math.ceil(cx-.5-r-.5))<=Math.min(width-1,Math.floor(cx-.5+r+.5))&&Math.max(0,Math.ceil(cy-.5-r-.5))<=Math.min(height-1,Math.floor(cy-.5+r+.5));
   check(error<.0001,c.name+' projected ink error '+error);check(facts.accepted===(intersects?7:0)&&facts.clipped===(intersects?0:7),c.name+' stats '+JSON.stringify(facts));check(facts.invalid===0,c.name+' invalid');check(JSON.stringify(facts.bounds)===JSON.stringify({minX:-1,maxX:1,minY:-1,maxY:1}),'captured NDC ignores viewport axes/bounds');
   const first=Array.from({length:width*height},(_,i)=>i).find(i=>ink[i*4+3]>.1);if(first!==undefined){const color=Array.from(ink.slice(first*4,first*4+3)).map(v=>v/ink[first*4+3]);if(!baseColor)baseColor=color;else check(color.every((v,i)=>Math.abs(v-baseColor[i])<.00001),'color uses mathematical point independent of camera');}
   const presentation=[];for(const family of ['map','symmetry']){const a=prepareCapturedDensityCamera(family,p).anchor,v=prepareCapturedDensityView(a,{...a.camera,phi:a.camera.phi+.29},width,height),tone=prepareDensityTone(j.palette,{paletteMode:'source',toneMap:'log',dynamicRange:10,gamma:1.7,transparentBackground:true}),sampled=new Float64Array(ink.length);
    for(let i=0;i<width*height;i++)for(const t of sampleCapturedDensity(v,i%width,Math.floor(i/width)))for(let k=0;k<4;k++)sampled[i*4+k]+=ink[t.index*4+k]*t.weight;
    const before=gpu.diagnostics(),out=gpu.present(tone,undefined,v),expected=toneDensityRgbaPrepared(width,height,sampled,tone);check(same(out.pixels,expected),c.name+' '+family+' pre-tone sampling');check(out.toneBackend==='cpu','captured explicit CPU tone');check(same(gpu.readback(),ink)&&gpu.diagnostics().frame===before.frame,'presentation retains ink/particles');presentation.push({family,filter:v.filter,rgbaSha256:await digest(out.pixels),toneBackend:out.toneBackend});
   }
   rows.push({name:c.name,point,clip:projected.clip,pixel:projected.pixel,accepted:facts.accepted,clipped:facts.clipped,maxMassError:error,mass,presentation,inkSha256:await digest(ink)});
  }finally{gpu.reset();check(gpu.diagnostics().retainedBytes===0,'reset resource0');}}
  const legacy=new IteratedDensityGpu();try{const j=job(),f=legacy.step(j,{...options,projection:'xy',bounds:{minX:-1,maxX:1,minY:-1,maxY:1}});check(f.accepted===7,'legacy XY admitted');const a=legacy.readback(),tone=prepareDensityTone(j.palette,{paletteMode:'source',toneMap:'log',dynamicRange:10,gamma:1.7,transparentBackground:true}),actual=legacy.present(tone),expected=toneDensityRgbaPrepared(width,height,a,tone);check(same(actual.pixels,expected),'legacy no-view presentation');}finally{legacy.reset();check(legacy.diagnostics().retainedBytes===0,'legacy reset');}
  const cancelled=new IteratedDensityGpu();try{const j=job();j.sourceCamera=prepareCapturedDensityCamera('map',plan());let thrown=false;try{cancelled.step(j,{...options,isCancelled:()=>true});}catch(e){thrown=e.name==='AbortError';}check(thrown&&cancelled.diagnostics().retainedBytes===0,'cancel and cleanup');}finally{cancelled.reset();}
  // Same 320x240 ink/tone, isolating the added presentation sampling cost.
  // This times browser JS, not process-family CPU or GPU driver allocations.
  const bw=320,bh=240,bi=Float32Array.from({length:bw*bh*4},(_,i)=>i%4===3?1+(Math.floor(i/4)%11):((i%4)+1)*.2),bt=prepareDensityTone(job().palette,{paletteMode:'source',toneMap:'log',dynamicRange:10,gamma:1.7,transparentBackground:true}),timings=[];
  for(const family of [null,'map','symmetry']){const a=family?prepareCapturedDensityCamera(family,plan()).anchor:undefined,v=a?prepareCapturedDensityView(a,{...a.camera,phi:a.camera.phi+.29},bw,bh):undefined,runs=[];let pixels;for(let n=0;n<4;n++){const t=performance.now();pixels=toneDensityRgbaPrepared(bw,bh,bi,bt,undefined,undefined,v);runs.push(performance.now()-t);}timings.push({family:family??'no-view',width:bw,height:bh,coldMs:runs[0],warmMs:runs.slice(1),rgbaSha256:await digest(pixels),persistentAdditionalSampleBytes:family?32:0});}
  return{assertions,rows,timings,userAgent:navigator.userAgent,cleanupRetainedBytes:0};
 });report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.wallMs=performance.now()-started;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='source-changed';process.exitCode=1;}await writeFile(directory+'/report.json',JSON.stringify(report,null,2));await writeFile(directory+'/report.md',`# Captured density GPU\n\nStatus: ${report.status}\n\n${report.result?.rows.length??0} projection cases, ${report.result?.assertions??0} assertions. Wall: ${(report.wallMs/1000).toFixed(2)}s. Source stable: ${report.sourceStable}.\n\n${report.error??''}\n\n${report.limits.map(x=>'- '+x).join('\n')}\n`);console.log(JSON.stringify({status:report.status,cases:report.result?.rows.length,assertions:report.result?.assertions,wallMs:report.wallMs,directory,error:report.error}));}
