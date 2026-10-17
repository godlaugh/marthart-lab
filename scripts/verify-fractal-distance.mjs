import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const output=process.env.FRACTAL_DISTANCE_REPORT;
if(!output)throw Error('An explicit new FRACTAL_DISTANCE_REPORT is required');
try{await stat(output);throw Error('Refusing to overwrite '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
const baseline='.cache/spirograph-clock-baseline-2097',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(baseline+'/manifest.json'),manifest=JSON.parse(manifestBytes);
for(const [path,digest]of Object.entries(manifest.sourceManifest))if(hash(await readFile(baseline+'/'+path.replace(/^studio\//,'')))!==digest)throw Error('Changed frozen baseline '+path);
const files=['src/engine/fractalDistance.ts','src/scenes/complex.ts','src/engine/fractalColor.ts','src/engine/fractalGpu.ts','src/engine/fractalResidualGpu.ts','src/engine/fractalPrecision.ts','src/engine/fractalConvergence.ts','src/engine/complexMath.ts','src/engine/complexViewport.ts','src/engine/document.ts','src/engine/legacyImport.ts','src/engine/client.ts','src/engine/generate.worker.ts','scripts/verify-fractal-distance.mjs'];
const snapshot=()=>Promise.all(files.map(async path=>({path,sha256:hash(await readFile(path))})));
const report={startedAt:new Date().toISOString(),sourceStart:await snapshot(),baseline:{path:baseline,manifestSha256:hash(manifestBytes),verifiedFiles:Object.keys(manifest.sourceManifest).length},limits:[
 'No original application/JVM was executed. Ordinary CPU and DD orbit values bridge to F32 high components; original DS orbit parity is not established.',
 'Old/current full image equality checks omitted-version local 2097 compatibility. This is not original pixel parity.',
 'An initial GPU context difference is retained and classified only when a fresh unmodified 2097 run reproduces the difference, fresh old/current images match exactly, and the current image remains stable. Arbitrary cold-context determinism is not established.',
 'The CPU all-pixel oracle shares production orbit/color owners and tests Worker wiring; independent numerical and actual GLSL references are separate reports.',
 'Cold/warm identify new/same Worker. Browser/OS caches are not flushed. Costs cover completed generate requests including transport, not just arithmetic.',
 'Native convergence modes and local legacy convergence remain distinct. This distance rule does not migrate the orbit or palette mapping rules.',
 'Whole-task agent token costs, GPU VRAM and original runtime performance were not measured.']};
let server,browser,page;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();const origin=server.resolvedUrls.local[0];
 await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fractal distance Worker verification</title>'}));await page.goto(origin);
 report.result=await page.evaluate(async({baseline})=>{
  const {Generator}=await import('/src/engine/client.ts'),{createScene,parseScene,persistentScene}=await import('/src/engine/document.ts'),{definitions,fractalConfig,fractalOrbit}=await import('/src/scenes/complex.ts');
  const {complexPixel,parseFractalViewport}=await import('/src/engine/complexViewport.ts'),{shadeFractalOrbit,parseFractalColors}=await import('/src/engine/fractalColor.ts');
  const old=await import('/'+baseline+'/src/engine/client.ts'),oldDoc=await import('/'+baseline+'/src/engine/document.ts'),oldScenes=await import('/'+baseline+'/src/scenes/complex.ts');
  const check=(ok,why)=>{if(!ok)throw Error(why);},digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const result=globalThis.__fractalDistance={compatibility:[],worker:[],costs:[],boundaries:[]},def=definitions.find(d=>d.kind==='fractal'),oldDef=oldScenes.definitions.find(d=>d.kind==='fractal');
  const NativeWorker=globalThis.Worker;let active=0,created=0;
  globalThis.Worker=class extends NativeWorker {constructor(...args){super(...args);this.owned=true;active++;created++;}terminate(){if(this.owned){active--;this.owned=false;}return super.terminate();}};
  const load=scene=>parseScene(JSON.stringify(persistentScene(scene)));
  const families=['mandelbrot','julia','newton','nova','phoenix','magnet1','magnet2','lambda','c_sin','spiral_septagon','binocular'];
  const make=(formula,variant,backend='cpu',source=true)=>{
   const scene=createScene(def);Object.assign(scene.settings,{formula,variant,iterations:64,fractalBackend:backend,renderMethod:'one-pass',fractalColorVersion:2,insideColoring:'distance_estimator',outsideColoring:'distance_estimator',insideDistancePower:2,outsideDistancePower:4,outsideColorDensity:.02,insideColorDensity:.02,convergenceMode:['newton','nova'].includes(formula)?'step':['magnet1','magnet2','binocular'].includes(formula)?'residual':'legacy',startReal:.1,startImag:.05});
   if(!source)delete scene.settings.fractalDistanceVersion;return scene;
  };
  async function generate(g,scene,width=65,height=49){
   const start=performance.now(),out=await g.generate(scene,{time:0,width,height,quality:'export'}),elapsedMs=performance.now()-start;
   check(out.type==='raster'&&out.width===width&&out.height===height&&out.stats.samples===width*height,'complete requested raster');
   return {out,elapsedMs,sha256:await digest(out.pixels)};
  }
  function cpuOracle(scene,out){
   const c=fractalConfig(scene.settings),colors=parseFractalColors(scene),view=parseFractalViewport(scene.settings);let changed=0;
   for(let i=0;i<out.width*out.height;i++){
    const o=fractalOrbit(complexPixel(i%out.width,Math.floor(i/out.width),out.width,out.height,view),c),rgb=shadeFractalOrbit(o,c,colors);
    const background=String(scene.settings.background??'#0a0c14'),expected=rgb?rgb.map(x=>Math.round(Math.max(0,Math.min(1,x))*255)):[1,3,5].map(k=>Number.parseInt(background.slice(k,k+2),16));
    for(let k=0;k<3;k++)if(out.pixels[i*4+k]!==expected[k])changed++;
   }
   check(changed===0,'CPU Worker differs from synchronous complete image: '+changed);return {comparedPixels:out.width*out.height,changedChannels:changed};
  }
  try{
   // Frozen old documents, including previously legal DE and non-DE formulas.
   for(const backend of ['cpu','webgl2']){
    const a=new old.Generator(),b=new Generator();try{
     for(const formula of families)for(const variant of ['mandelbrot','julia']){
      const scene=oldDoc.createScene(oldDef);Object.assign(scene.settings,{formula,variant,iterations:48,fractalBackend:backend,renderMethod:'one-pass',outsideColoring:['mandelbrot','julia'].includes(formula)?'distance_estimator':'smooth_mandelbrot'});
      check(scene.settings.fractalDistanceVersion===undefined,'frozen document unexpectedly versioned');
      const oldOut=await generate(a,scene,41,31),now=await generate(b,load(scene),41,31);
      if(oldOut.sha256!==now.sha256){
       const changed=[];let changedChannels=0;
       for(let k=0;k<now.out.pixels.length;k++)if(oldOut.out.pixels[k]!==now.out.pixels[k]){changedChannels++;if(changed.length<16)changed.push({channel:k,old:oldOut.out.pixels[k],current:now.out.pixels[k]});}
       const row={failed:true,initialMismatch:true,formula,variant,backend,changedChannels,changed,old:{sha256:oldOut.sha256,backend:oldOut.out.backend,warnings:oldOut.out.warnings,stats:oldOut.out.stats},current:{sha256:now.sha256,backend:now.out.backend,warnings:now.out.warnings,stats:now.out.stats},scene,loaded:load(scene)};
       result.compatibility.push(row);
       const freshOld=new old.Generator(),freshCurrent=new Generator();
       try{
        const againOld=await generate(freshOld,scene,41,31),againCurrent=await generate(freshCurrent,load(scene),41,31);
        row.contextRecheck={oldSha256:againOld.sha256,currentSha256:againCurrent.sha256,oldBackend:againOld.out.backend,currentBackend:againCurrent.out.backend,oldOwnContextChanged:oldOut.sha256!==againOld.sha256,exactOldCurrent:againOld.sha256===againCurrent.sha256,currentStable:now.sha256===againCurrent.sha256};
        check(backend==='webgl2'&&[oldOut.out.backend,now.out.backend,againOld.out.backend,againCurrent.out.backend].every(x=>x==='webgl2')&&row.contextRecheck.oldOwnContextChanged&&row.contextRecheck.exactOldCurrent&&row.contextRecheck.currentStable,'Unexplained old image difference: '+formula+'/'+variant+'/'+backend);
        row.failed=false;row.classification='first-context-difference-also-reproduced-in-unmodified-2097';
       }finally{freshOld.dispose();freshCurrent.dispose();}
      }
      check(oldOut.out.backend===now.out.backend,'old backend changed');if(oldOut.sha256===now.sha256)result.compatibility.push({formula,variant,requestedBackend:backend,actualBackend:now.out.backend,oldSha256:oldOut.sha256,currentSha256:now.sha256});
     }
    }finally{a.dispose();b.dispose();}
   }
   const g=new Generator();try{
    for(const backend of ['cpu','webgl2'])for(const formula of families)for(const variant of ['mandelbrot','julia']){
     const scene=make(formula,variant,backend),saved=JSON.stringify(persistentScene(scene)),first=await generate(g,scene),again=await generate(g,load(scene));
     check(JSON.stringify(persistentScene(scene))===saved,'render mutated authored scene');check(first.sha256===again.sha256,'save/reload warm image changed');
     const oracle=backend==='cpu'?cpuOracle(scene,first.out):undefined;
     result.worker.push({formula,variant,requestedBackend:backend,actualBackend:first.out.backend,elapsedMs:first.elapsedMs,warmElapsedMs:again.elapsedMs,sha256:first.sha256,stats:first.out.stats,warnings:first.out.warnings,oracle});
    }
    for(const extra of [{power:2.5},{power:2,powerImag:1},{power:3,outsideDistancePower:120},{power:2,insideColoring:'distance_estimator',outsideColoring:'basic'}]){
     const scene=make('mandelbrot','mandelbrot');Object.assign(scene.settings,extra);const a=await generate(g,scene);
     result.worker.push({id:'authored-parameters',extra,actualBackend:a.out.backend,sha256:a.sha256,oracle:cpuOracle(scene,a.out)});
    }
    for(const backend of ['cpu','webgl2'])for(const source of [false,true]){
     const scene=make('mandelbrot','mandelbrot',backend,source);Object.assign(scene.settings,{centerX:2,centerY:0,centerXLow:1e-16,centerYLow:0,zoom:1e4,iterations:24});
     const a=await generate(g,scene,33,25),b=await generate(g,load(scene),33,25);check(a.sha256===b.sha256,'deep source reload');
     result.worker.push({id:'deep-dd-or-perturbation',source,requestedBackend:backend,actualBackend:a.out.backend,sha256:a.sha256,stats:a.out.stats,warnings:a.out.warnings});
    }
    const source=make('lambda','julia');source.settings.juliaReal=3;source.settings.startReal=.5;source.settings.outsideDistancePower=4;
    const before=await generate(g,source);Object.assign(source.settings,{outsideSmoothSource:'complex',outsideSmoothReal:13,outsideSmoothImag:7,outsideSmoothBailout:900});
    const after=await generate(g,source);check(before.sha256===after.sha256,'dormant Smooth changed DE fallback');result.boundaries.push({id:'dormant-smooth-not-consumed',sha256:after.sha256});
    const oldBad=make('lambda','mandelbrot','cpu',false);let message='';try{await generate(g,oldBad);}catch(e){message=e.message;}check(message.includes('仅支持'),'old unsupported validation changed');result.boundaries.push({id:'legacy-error-preserved',message});
    const invalid=make('mandelbrot','mandelbrot');invalid.settings.fractalColorVersion=1;message='';try{await generate(g,invalid);}catch(e){message=e.message;}check(message.includes('fractalColorVersion 2'),'source invalid input swallowed');result.boundaries.push({id:'input-error-preserved',message});
   }finally{g.dispose();}
   // Same dimensions/iterations and completed requests for source/omitted modes.
   for(const backend of ['cpu','webgl2'])for(const power of [2,3])for(const source of [false,true]){
    const scene=make('mandelbrot','mandelbrot',backend,source);Object.assign(scene.settings,{iterations:180,power,insideColoring:'none',outsideDistancePower:2});
    const g=new Generator();try{for(let run=0;run<3;run++){const done=await generate(g,scene,257,193);result.costs.push({backend,actualBackend:done.out.backend,power,source,condition:run===0?'cold-new-worker':'warm-same-worker',elapsedMs:done.elapsedMs,sha256:done.sha256,stats:done.out.stats,warnings:done.out.warnings});}}finally{g.dispose();}
   }
   const recovery=new Generator();try{
    const scene=make('mandelbrot','mandelbrot');scene.settings.iterations=4096;
    const work=recovery.generate(scene,{time:0,width:1200,height:900,quality:'export'});recovery.cancel();let error='';try{await work;}catch(e){error=e.name;}check(error==='AbortError','public cancellation');
    scene.settings.iterations=32;const recovered=await generate(recovery,scene);result.boundaries.push({id:'cancel-recover',error,sha256:recovered.sha256});
   }finally{recovery.dispose();}
  }finally{globalThis.Worker=NativeWorker;result.resources={createdWorkers:created,activeWorkers:active};}
  result.compatibilitySummary={initialExactPairs:result.compatibility.filter(x=>!x.initialMismatch).length,contextVariancePairs:result.compatibility.filter(x=>x.classification==='first-context-difference-also-reproduced-in-unmodified-2097').length};
  check(active===0,'owned Workers left alive');check(!result.compatibility.some(x=>x.failed),'Old image compatibility differences remain; all independent completed-task evidence is retained');return result;
 },{baseline});
 report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable)throw Error('Source changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page)report.partial=await page.evaluate(()=>globalThis.__fractalDistance).catch(()=>undefined);report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);throw error;}
finally{await browser?.close();await server?.close();report.completedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,output,compatibility:report.result?.compatibility.length,worker:report.result?.worker.length,costs:report.result?.costs.length}));}
