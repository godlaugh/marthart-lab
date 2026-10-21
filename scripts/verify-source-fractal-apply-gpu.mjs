/** Same-instance numerical apply + real WebGL2 renderer boundary. No GUI/Worker
 * adapter or original GL execution is claimed. Run from studio/. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/fractal-apply-gpu-${Date.now()}`;
await mkdir(directory,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(path){const out=[];for(const e of await readdir(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-fractal-apply-gpu.mjs','tests/fixtures/source-fractal-apply/source.json'].sort().map(async p=>[p,sha(await readFile(p))])));
const started=performance.now(),report={status:'running',scope:'Numerical mobject apply through public import and actual local WebGL2 renderer; not App controls, Worker transport, original GL or native window parity.',cases:[],errors:[],before:await hashes()};
let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 const fixture=JSON.parse(await readFile('tests/fixtures/source-fractal-apply/source.json','utf8'));
 const results=await page.evaluate(async fixture=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareSourceFractalScene,bindSourceFractalFrame}=await import('/src/engine/sourceFractalTimeline.ts'),{SourceFractalSceneRuntime}=await import('/src/engine/sourceFractalSceneRuntime.ts'),{definition}=await import('/src/scenes/index.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts');
  const check=(value,message)=>{if(!value)throw Error(message);};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const load=input=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'apply boundary',...input})).scene;
  const rows=[];
  for(const sample of fixture.cases){
   const i=fixture.initialInput,scene=load({type:'FRACTAL',fractal:{formula_id:i.formula,parameters:i.parameters},timeline:sample.input.timeline});
   const c=prepareSourceFractalScene(scene);Object.assign(c.initial,{centerX:i.center[0],centerXLow:i.center[1],centerY:i.center[2],centerYLow:i.center[3],zoom:i.zoom,rotation:i.rotation,rotationRate:i.rotationRate,iterations:i.iterations,ambientRates:[...i.ambientRates]});
   const runtime=new SourceFractalSceneRuntime({...c,gradient:{palette:i.gradient[0],inside:i.gradient[1],outside:i.gradient[2]},cameraAngles:[0,0,0],fps:i.frameRate},{reserve(){}});
   const render=async(authored,width=160,height=120)=>{
    const snapshot=runtime.snapshot(),out=structuredClone(authored);bindSourceFractalFrame(out,{...snapshot,displayFrame:snapshot.scene.frame,simulationFps:i.frameRate});
    const pixels=definition('fractal').generate(out,{time:0,width,height,quality:'export',fractalViewport:{logicalWidth:160,logicalHeight:120,target:'offscreen'}});
    check(pixels.type==='raster'&&pixels.backend==='webgl2'&&pixels.fractalRender,'expected real source GPU raster');check(JSON.stringify(runtime.snapshot())===JSON.stringify(snapshot),'render mutated numerical state');
    return{sha256:await digest(pixels.pixels),facts:pixels.fractalRender,png:Array.from(new Uint8Array(await (await encodeRgbaPng(pixels.pixels,width,height)).arrayBuffer()))};
   };
   for(const row of sample.frames.slice(0,sample.applyBeforeFrame))runtime.clock.step(row.rawStep.value,row.paused);
   const before=await render(scene),applied=load(sample.applyInput),beforeState=runtime.snapshot();runtime.applyConfiguration(prepareSourceFractalScene(applied));
   const after=await render(applied),afterState=runtime.snapshot();check(before.sha256!==after.sha256,'hot application did not change pixels');check(beforeState.scene.sceneTime===afterState.scene.sceneTime&&beforeState.scene.queueIndex===afterState.scene.queueIndex,'application reset queue');
   const paused=sample.frames[sample.applyBeforeFrame];runtime.clock.step(paused.rawStep.value,true);check((await render(applied)).sha256===after.sha256,'paused display changed pixels');
   const next=sample.frames[sample.applyBeforeFrame+1];runtime.clock.step(next.rawStep.value,false);const resumed=await render(applied);check(resumed.sha256!==after.sha256,'resumed original queue did not change pixels');
   const state=JSON.stringify(runtime.snapshot());await render(applied,192,144);const restored=await render(applied);check(restored.sha256===resumed.sha256&&JSON.stringify(runtime.snapshot())===state,'resize changed runtime or restored pixels');
   rows.push({id:sample.id,status:'passed',before:before.sha256,after:after.sha256,resumed:resumed.sha256,renderFacts:after.facts,png:after.png});
  }
  return rows;
 },fixture);
 for(const row of results){const {png,...facts}=row;const path=directory+`/case-${row.id}-after-apply.png`;await writeFile(path,Buffer.from(png));report.cases.push({...facts,png:path});}
 if(report.errors.length)throw Error('browser errors');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;}
finally{
 report.cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.after=await hashes();report.sourceStable=JSON.stringify(report.before)===JSON.stringify(report.after);report.elapsedMs=performance.now()-started;
 if(!report.sourceStable||report.cleanup.some(r=>r.status==='rejected'))report.status='failed';
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,sourceStable:report.sourceStable,error:report.error,report:directory+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
