/** Real production worker and same-ink presentation oracle. Requires local Chrome. */
import {chromium} from '../node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.route('http://127.0.0.1:5177/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{Generator}=await import('/src/engine/client.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts'),{prepareDensityTone,toneDensityRgbaPrepared}=await import('/src/engine/density.ts');
  const assert=(value,message)=>{if(!value)throw Error(message);},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const context={width:320,height:240,quality:'export'},replay=[];
  for(const kind of ['map','symmetry','samila']){
   const scene=createScene(definition(kind));Object.assign(scene.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:100000,burnIn:20,paletteMode:'source',transparentBackground:true});const g=new Generator(),fresh=new Generator();
   try{
    const run=time=>g.generate(scene,{...context,time});await run(0);await run(.1);const warm=await run(.2),repeat=await run(.2);assert(warm.backend==='webgl2'&&warm.density.toneBackend==='webgl2',kind+' wrong backend');assert(equal(warm.pixels,repeat.pixels),kind+' repeat differs');
    await run(.1);const seek=await run(.2),cold=await fresh.generate(scene,{...context,time:.2});assert(equal(warm.pixels,seek.pixels)&&equal(warm.pixels,cold.pixels),kind+' warm/cold/seek differs');
    scene.settings.exposure=1;const edited=await run(.2),editedCold=await fresh.generate(scene,{...context,time:.2});assert(edited.temporal.cacheHits===1&&edited.stats.samples===warm.stats.samples&&equal(edited.pixels,editedCold.pixels),kind+' tone-only edit replayed math or changed color');
    replay.push({kind,particles:100000,frames:warm.temporal.frames,backend:warm.backend,toneBackend:warm.density.toneBackend,repeatColdSeekExact:true,toneOnlyMathReuse:true});
   }finally{g.dispose();fresh.dispose();}
  }
  const s=createScene(definition('map'));Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:20000,burnIn:20,paletteMode:'density'});s.palette.mode='curve';const fallbackGenerator=new Generator();let fallback;
  try{const out=await fallbackGenerator.generate(s,{...context,time:0});assert(out.backend==='webgl2'&&out.density.toneBackend==='cpu'&&out.warnings.some(w=>w.includes('最终调色回退 CPU')),'curve fallback lost state provenance');fallback={backend:out.backend,toneBackend:out.density.toneBackend,warnings:out.warnings};}finally{fallbackGenerator.dispose();}
  const g=new Generator();let cancellation;
  try{const s=createScene(definition('map'));Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:100000,burnIn:20});await g.generate(s,{...context,time:0});const pending=g.generate(s,{width:3840,height:2160,quality:'export',time:.5}).then(()=>({resolved:true}),e=>({name:e.name}));await new Promise(r=>setTimeout(r,25));const start=performance.now();g.cancel();const error=await pending;assert(error.name==='AbortError','worker did not cancel');const elapsedMs=performance.now()-start,recovered=await g.generate(s,{...context,time:0});assert(recovered.backend==='webgl2'&&recovered.density.toneBackend==='webgl2','worker did not recover');cancellation={elapsedMs,name:error.name,recoveredBackend:recovered.backend};}finally{g.dispose();}
  // One full5M ink lattice; both GPU and CPU presentation consume those exact
  // float32 sums. This isolates tone error from chaotic recurrence differences.
  const scene=createScene(definition('map'));Object.assign(scene.settings,{batchSize:5000000,burnIn:20,iterationsPerFrame:1});const gpu=new IteratedDensityGpu(),oracle=[];let png;
  try{
   let bounds;for(let frame=0;frame<2;frame++){const facts=gpu.step(prepareIteratedFrame(scene,frame/60,frame),{width:3840,height:2160,projection:'xy',padding:.05,bounds,resetParticles:frame===0,clearInk:frame===0});bounds=facts.bounds;}
   const rgba=gpu.readback();let occupied=0,maxCount=0;for(let i=3;i<rgba.length;i+=4){if(rgba[i]>0)occupied++;maxCount=Math.max(maxCount,rgba[i]);}
   for(const paletteMode of ['source','density']){
    const job=prepareDensityTone(scene.palette,{...scene.settings,paletteMode,transparentBackground:true}),shown=gpu.present(job),expected=toneDensityRgbaPrepared(3840,2160,rgba,job);let maxError=0,different=0;
    for(let i=0;i<expected.length;i++){const difference=Math.abs(shown.pixels[i]-expected[i]);maxError=Math.max(maxError,difference);if(difference)different++;}
    assert(shown.toneBackend==='webgl2',paletteMode+' full4K unexpectedly CPU');assert(maxError<=1,paletteMode+' full4K tone error '+maxError);assert(shown.occupiedPixels===occupied&&shown.maxCount===maxCount,'full4K statistics changed');oracle.push({paletteMode,width:3840,height:2160,maxError,different,occupied,maxCount,toneBackend:shown.toneBackend});
    if(paletteMode==='source'){const canvas=document.createElement('canvas');canvas.width=3840;canvas.height=2160;canvas.getContext('2d').putImageData(new ImageData(shown.pixels,3840,2160),0,0);png=canvas.toDataURL('image/png').split(',')[1];}
   }
  }finally{gpu.dispose();assert(gpu.diagnostics().retainedBytes===0,'GPU retained resources');}
  return{status:'passed',at:new Date().toISOString(),environment:navigator.userAgent,replay,fallback,cancellation,oracle,png,scope:'Same GPU float32 ink CPU tone oracle; no CPU-double trajectory or native pixel equivalence claim.'};
 });
 const png=report.png;delete report.png;await writeFile(new URL('../coverage/iterated-tone-4k.png',import.meta.url),Buffer.from(png,'base64'));await writeFile(new URL('../coverage/iterated-tone-production.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
