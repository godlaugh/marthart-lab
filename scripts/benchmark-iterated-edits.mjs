import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {build} from 'esbuild';
import {readFile,writeFile,readdir,mkdtemp,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {measureFamily} from './browser-process-cost.mjs';
const baselineCommit='f73e2357ac1f9439d376fae3f386ca2368940f24',script='scripts/benchmark-iterated-edits.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all([...(await readdir('src',{recursive:true})).filter(x=>/\.(ts|tsx|json)$/.test(x)).map(x=>'src/'+x),script,'scripts/browser-process-cost.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),baselineCommit,nativeParity:false,results:[],scope:'12 authored numeric edits per Map/builtin Symmetry scene; each replays from seed through four or seven frames at30FPS,50000 particles,10warmup,2iterations,256x192. Public generateScene/TemporalGenerationSession; complete RGBA8 and diagnostic float ink hashes. Compilation and context creation observed in actual GL.',measurement:'Each variant/kind owns one Chrome family after bundled module import. Cold-first then warm-fresh owner. Elapsed includes source construction, edits, replay, image/raw ink readback and hashing, disposal. No OS/driver cache flush; launch/build/import excluded. Process-family CPU and RSS sampled via ps every250ms plus boundaries; may miss short-lived children and instantaneous peaks. Node/Vite excluded. One pair per case; not a frame-rate or cross-device claim.',unmeasured:['agent tokens','VRAM and GPU device time','browser startup/build/import','PNG/video encoding','original JVM/JOGL cost and parity']};
let server,browserServer,browser;
try{
 const initialHashes=await hashes(),dir=await mkdtemp('.cache/iterated-edit-cost-'),baseline=resolve(dir,'baseline');await mkdir(baseline);
 const archived=spawnSync('git',['archive',baselineCommit,'src'],{maxBuffer:32*1024*1024});if(archived.status!==0)throw Error(String(archived.stderr));const unpack=spawnSync('tar',['-x','-C',baseline],{input:archived.stdout});if(unpack.status!==0)throw Error(String(unpack.stderr));
 for(const variant of ['before','after'])await build({stdin:{contents:`export {createScene} from './src/engine/document';export {definition} from './src/scenes';export {generateScene,TemporalGenerationSession} from './src/engine/temporal';`,resolveDir:variant==='before'?baseline:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:resolve(dir,variant+'.mjs')});
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 for(const kind of ['map','symmetry'])for(const variant of ['before','after']){
  browserServer=await chromium.launchServer({channel:'chrome',headless:true});const rootPid=browserServer.process().pid;if(!rootPid)throw Error('No owned Chrome PID');browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/edit-cost',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.route('**/edit-api.mjs',r=>r.fulfill({contentType:'text/javascript',path:resolve(dir,variant+'.mjs')}));await page.goto(server.resolvedUrls.local[0]+'edit-cost');report.browserVersion=browser.version();report.nodeVersion=process.version;
  await page.evaluate(async({kind,variant})=>{
   const api=await import('/edit-api.mjs'),counts={compile:0,link:0,contexts:0};
   for(const [method,key]of [['compileShader','compile'],['linkProgram','link']]){const original=WebGL2RenderingContext.prototype[method];WebGL2RenderingContext.prototype[method]=function(...args){counts[key]++;return original.apply(this,args);};}
   const get=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){if(args[0]==='webgl2')counts.contexts++;return get.apply(this,args);};
   const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',x))).map(v=>v.toString(16).padStart(2,'0')).join('');
   window.__editTask=async()=>{
    const start=performance.now(),owner=new api.TemporalGenerationSession(),initial={...counts},frames=[];let result;
    try{
     const scene=api.createScene(api.definition(kind));Object.assign(scene.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:50000,burnIn:10,iterationsPerFrame:2,iteratedFps:30,densityView:'manual',densitySpan:4,pointSize:1,showTrails:false,paletteMode:'source',gamma:1});
     const parameter=kind==='map'?'a':'lambda',original=scene.parameters[parameter];if(typeof original!=='number')throw Error('Missing fixture parameter');
     for(let i=0;i<12;i++){
      scene.parameters[parameter]=original+i*.003;
      const output=api.generateScene(scene,{time:i%3===0?.2:.1,width:256,height:192,quality:'export'},owner);
      if(output.type!=='raster'||output.backend!=='webgl2')throw Error('Not complete GPU raster');
      const ink=owner.iterated.snapshotInk(),diagnostics=owner.iterated.diagnostics(),compiled=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v-initial[k]]));
      frames.push({edit:i,value:scene.parameters[parameter],pixelsSha256:await digest(output.pixels),inkSha256:await digest(ink),factsSha256:await digest(new TextEncoder().encode(JSON.stringify({density:output.density,temporal:output.temporal,samples:output.stats.samples,generated:output.stats.generated,invalid:output.stats.invalid}))),bytes:output.pixels.byteLength+ink.byteLength,compiled,diagnostics});
      if(variant==='after'&&i>0&&JSON.stringify(compiled)!==JSON.stringify(frames[0].compiled))throw Error('Numeric edit recompiled shaders or created context');
     }
     if(new Set(frames.map(f=>f.inkSha256)).size<2)throw Error('Numeric edits did not change state');
     result={status:'completed',frames};
    }catch(e){result={status:'failed',error:String(e),frames};}finally{owner.reset();}
    return{...result,elapsedMs:performance.now()-start};
   };
  },{kind,variant});
  for(const temperature of ['cold-first-task','warm-fresh-task']){const row=await measureFamily(rootPid,()=>page.evaluate(()=>window.__editTask()));report.results.push({kind,variant,temperature,...row});if(row.status!=='completed')throw Error(row.error);}
  if(errors.length)throw Error(errors.join('; '));await browser.close();browser=undefined;await browserServer.close();browserServer=undefined;
 }
 for(const kind of ['map','symmetry']){const rows=report.results.filter(r=>r.kind===kind),reference=rows[0].frames;if(!rows.every(r=>r.frames.length===12&&r.frames.every((f,i)=>f.pixelsSha256===reference[i].pixelsSha256&&f.inkSha256===reference[i].inkSha256&&f.factsSha256===reference[i].factsSha256)))throw Error(kind+': full output/ink mismatch');}
 report.sources=await hashes();report.sourceStable=JSON.stringify(initialHashes)===JSON.stringify(report.sources);if(!report.sourceStable)throw Error('Sources changed during benchmark');report.equalFullOutputs=true;report.status='passed';
}catch(e){report.status='failed';report.error=String(e);report.stack=e.stack;process.exitCode=1;}
finally{
 report.cleanup=[];for(const [name,resource]of [['browser',browser],['browser-process',browserServer],['vite',server]])if(resource)try{await resource.close();report.cleanup.push({name,status:'fulfilled'});}catch(e){report.status='failed';report.cleanup.push({name,error:String(e)});process.exitCode=1;}
 await writeFile('.cache/v2-iterated-edit-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,equalFullOutputs:report.equalFullOutputs,results:report.results.map(({kind,variant,temperature,status,elapsedMs,processFamily,frames})=>({kind,variant,temperature,status,elapsedMs,processFamily,edits:frames.length,compiled:frames.at(-1)?.compiled}))},null,2));
}
