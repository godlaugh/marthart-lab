/** Real browser regression, deliberately separate from Node lifecycle fixtures.
 * Run: node scripts/verify-iterated-gpu.mjs (requires local Chrome).
 * Starts an isolated local Vite server and an empty browser profile, then closes
 * both. No native reference application or external website is executed. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const paths=['src/engine/iteratedDensityGpu.ts','src/scenes/iteratedDensity.ts','src/engine/symmetryCustom.ts','src/engine/symmetryCustomShader.ts','src/engine/iteratedIdentity.ts','src/scenes/iterated.ts','src/engine/generationProtocol.ts','src/engine/client.ts','scripts/verify-symmetry-custom-gpu.mjs','scripts/symmetry-custom-cases.mjs'];
const snapshots=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(resolve(root,p))).digest('hex')])));
const sourceSnapshots=await snapshots();
const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false,open:false}});
let browser;
try{
 await server.listen();
 const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({storageState:{cookies:[],origins:[]}}),page=await context.newPage();
 await page.route(url+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Iterated GPU verification</title>'}));
 await page.goto(url+'/');
 const report=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts');
  const {definition}=await import('/src/scenes/index.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts');
  const {IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const {prepareDensityTone}=await import('/src/engine/density.ts');
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const options={width:80,height:60,projection:'xy',padding:.05};
  const replay=[];const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  // First compilation and cached shader compilation must agree. A linear map
  // alone did not detect the ANGLE Metal compile-mode regression.
  for(const kind of ['map','symmetry','samila']){
   const scene=createScene(definition(kind));
   Object.assign(scene.settings,{iteratedMode:'continuous',batchSize:2048,burnIn:20,iterationsPerFrame:2,iteratedColor:kind==='samila'?'noise':'step'});
   let reference;
   for(let attempt=0;attempt<3;attempt++){
    const gpu=new IteratedDensityGpu();
    try{
     let bounds;const frames=[];
     for(let frame=0;frame<3;frame++){
      const facts=gpu.step(prepareIteratedFrame(scene,frame/60,frame),{...options,bounds,resetParticles:frame===0,clearInk:frame===0});
      bounds=facts.bounds;frames.push(facts);
      assert(facts.accepted+facts.clipped+facts.sampleInvalid===2048,kind+' sample conservation');
      if(attempt===0)gpu.present(prepareDensityTone(scene.palette,{...scene.settings,paletteMode:'source'}));
      if(attempt===2)gpu.present(prepareDensityTone(scene.palette,{...scene.settings,paletteMode:'density'}));
     }
     const state=gpu.readParticles(),ink=gpu.readback();
     if(reference){assert(equal(reference.ink,ink),kind+' cold/warm density differs');assert(equal(reference.state.positionsAndMetric,state.positionsAndMetric),kind+' cold/warm particle state differs');assert(JSON.stringify(reference.frames)===JSON.stringify(frames),kind+' cold/warm facts differ');}
     else reference={state,ink,frames};
    }finally{gpu.dispose();assert(gpu.diagnostics().retainedBytes===0,'GPU resources retained');}
   }
   replay.push({kind,contexts:3,frames:3,particles:2048,rawInkAndStateExact:true,inkHash:await hash(reference.ink),stateHash:await hash(reference.state.positionsAndMetric),counterHash:await hash(reference.state.invalidCounts),facts:reference.frames,presentationInterleaving:'GPU source/density per frame versus final-only raw readback'});
  }
  const invalid=[];
  for(const formula of ['1/0','0*(1/0)','sqrt(-1)','pow(-1,.5)','1/0-1/0','log(-1)','(1e30*1e30)*0'])for(let attempt=0;attempt<2;attempt++){
   const scene=createScene(definition('map'));scene.equations={x:formula,y:'0'};
   Object.assign(scene.settings,{batchSize:16,burnIn:3,iterationsPerFrame:2});
   const gpu=new IteratedDensityGpu();
   try{const facts=gpu.step(prepareIteratedFrame(scene,0,0),{...options,resetParticles:true,clearInk:true});assert(facts.invalid===80&&facts.sampleInvalid===16&&facts.accepted===0,formula+' produced a fake finite point');assert(gpu.readback().every(v=>v===0),formula+' deposited invalid samples');invalid.push({formula,attempt,invalid:facts.invalid});}finally{gpu.dispose();}
  }
  const {GpuFormulaSampler}=await import('/src/engine/gpuSampler.ts');
  const sampler=new GpuFormulaSampler(),arguments_=[-1000,-80,-1,-.001,0,.001,1,80,1000];
  try{const sample=sampler.sample(['sinh(x)','cosh(x)','tanh(x)'],Float32Array.from(arguments_.flatMap(x=>[x,0,0])),['x'],{});assert(Boolean(sample.values),sample.warnings.join(';'));for(let i=0;i<arguments_.length;i++)for(let k=0;k<3;k++){const expected=Math.fround(Math[['sinh','cosh','tanh'][k]](Math.fround(arguments_[i]))),actual=sample.values[i*3+k];assert(Number.isFinite(expected)?Number.isFinite(actual)&&Math.abs(actual-expected)/(1+Math.abs(expected))<1e-5:actual===expected,'hyperbolic mathematical boundary');}}finally{sampler.dispose();}
  const custom=await (await import('/scripts/symmetry-custom-cases.mjs')).symmetryCustomCases();return{custom,replay,invalid,hyperbolicSamples:27,scope:'Real local WebGL2. Same-backend replay only; CPU double trajectories, other GPU devices and native reference pixels are not asserted.'};
 });
 report.sourceSnapshots=sourceSnapshots;report.sourceAfter=await snapshots();report.sourceStable=JSON.stringify(report.sourceSnapshots)===JSON.stringify(report.sourceAfter);report.at=new Date().toISOString();await writeFile(resolve(root,'.cache/symmetry-custom-gpu-after.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await server.close();}
