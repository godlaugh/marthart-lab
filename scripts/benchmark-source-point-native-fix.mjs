import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {measureFamily} from './browser-process-cost.mjs';

const directory=process.argv[2]??'.cache/surface-point-fix-20261023';
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const baselineCommit='8f957bdab76e554f9563c3b1974939a7180f2c3d';
const names=['sourceParticlePointRenderer.ts','sourceParticlePointShaders.ts'];
const baseline=Object.fromEntries(names.map(n=>[n,execFileSync('git',['show',baselineCommit+':src/engine/'+n],{encoding:'utf8'})]));
const paths=(await readdir('src',{recursive:true})).filter(p=>/\.tsx?$/.test(p)).map(p=>'src/'+p).concat('package-lock.json','scripts/benchmark-source-point-native-fix.mjs','scripts/browser-process-cost.mjs');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const fixtureBytes=await readFile(directory+'/native-comparison/report.json'),fixture=JSON.parse(fixtureBytes);
assert.equal(fixture.sourceStable,true);assert.equal(fixture.referencesStable,true);
const inputs=fixture.cases.filter(c=>c.name!=='mobius').map(c=>({name:c.name,geometry:c.geometry}));
assert.deepEqual(inputs.map(c=>c.name),['cornucopia','sphere']);
const report={at:new Date().toISOString(),baselineCommit,baselineHashes:Object.fromEntries(names.map(n=>[n,sha(baseline[n])])),fixtureHash:sha(fixtureBytes),sourceBefore:await hashes(),results:[],
 scope:'Equivalent complete renderer tasks: fresh Three renderer, 20 create/upload/draw/full-readback/dispose frames at 500x600. Fixed real Worker outputs (924/800 points) plus a synthetic 40000-point repetition workload. Generation, paused-capture rescaling, formula composition and UI are excluded; this is not a native image parity test.',
 measurement:'Separate fresh browser per variant. Cold is first task for each case after module/input loading; warm tasks use fresh renderers in that browser, without flushing OS/driver caches. Browser process-family CPU deltas and summed RSS sampled at 250ms plus boundaries. Shared pages may double count; short-lived processes and instantaneous peaks may be missed. Node/Vite/preload, VRAM and agent tokens unmeasured.'};
let server,browserServer,browser;
try{
 server=await createServer({plugins:[{name:'fixed-point-baseline',enforce:'pre',load(id){
  for(const n of names)if(id.endsWith('/src/engine/'+n+'?pointBaseline'))return baseline[n].replace("'./sourceParticlePointShaders'","'./sourceParticlePointShaders.ts?pointBaseline'");
 }}],server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 for(const variant of ['baseline','candidate']){
  browserServer=await chromium.launchServer({channel:'chrome',headless:true});browser=await chromium.connect(browserServer.wsEndpoint());
  const page=await browser.newPage();await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'fixture');
  await page.evaluate(async({variant,inputs})=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {createSourceParticlePoints}=await import(variant==='baseline'?'/src/engine/sourceParticlePointRenderer.ts?pointBaseline':'/src/engine/sourceParticlePointRenderer.ts');
   const {prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts');
   const cases=inputs.map(c=>({...c,geometry:{...c.geometry,positions:new Float32Array(c.geometry.positions),colors:new Float32Array(c.geometry.colors),pointAlphas:new Float32Array(c.geometry.pointAlphas)}}));
   const seed=cases[0].geometry,n=40000,positions=new Float32Array(n*3),colors=new Float32Array(n*3),pointAlphas=new Float32Array(n);
   for(let i=0;i<n;i++){const j=i%(seed.positions.length/3);positions.set(seed.positions.subarray(j*3,j*3+3),i*3);colors.set(seed.colors.subarray(j*3,j*3+3),i*3);pointAlphas[i]=seed.pointAlphas[j];}
   cases.push({name:'synthetic-40000',geometry:{...seed,positions,colors,pointAlphas}});
   const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
   window.task=async name=>{
    const out=cases.find(c=>c.name===name).geometry,plan=prepareOrdinarySourceFrame(out.sourceCameraFrame),before=await digest(out.positions),start=performance.now();
    const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true}),scene=new THREE.Scene(),camera=new THREE.Camera(),pixels=new Uint8Array(500*600*4),hashes=[];
    let geometryDisposed=0,materialDisposed=0,textureDisposed=0,anisotropy;
    try{
     renderer.setSize(500,600,false);renderer.setClearColor(0xffffff,1);renderer.setPixelRatio(1);
     for(let frame=0;frame<20;frame++){
      const mesh=createSourceParticlePoints(out,plan,1,Math.max(1,renderer.capabilities.getMaxAnisotropy()));
      mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);mesh.material.addEventListener('dispose',()=>materialDisposed++);mesh.material.uniforms.sprite.value.addEventListener('dispose',()=>textureDisposed++);anisotropy=mesh.material.uniforms.sprite.value.anisotropy;
      scene.add(mesh);try{renderer.render(scene,camera);const gl=renderer.getContext();gl.readPixels(0,0,500,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==0)throw Error('GL error');hashes.push(await digest(pixels));}finally{scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
     }
    }finally{renderer.dispose();renderer.forceContextLoss();}
    const elapsedMs=performance.now()-start;
    if(geometryDisposed!==20||materialDisposed!==20||textureDisposed!==20||before!==await digest(out.positions)||new Set(hashes).size!==1)throw Error('Disposal, input mutation or image stability failed');
    return{name,points:out.positions.length/3,frames:20,elapsedMs,anisotropy,inputHash:before,imageHash:hashes[0],geometryDisposed,materialDisposed,textureDisposed};
   };
  },{variant,inputs});
  for(const name of [...inputs.map(c=>c.name),'synthetic-40000'])for(const temperature of ['cold-first','warm-fresh-1','warm-fresh-2']){
   const row=await measureFamily(browserServer.process().pid,()=>page.evaluate(name=>window.task(name),name));report.results.push({variant,temperature,...row});console.log(JSON.stringify({variant,temperature,...row}));
  }
  await browser.close();browser=undefined;await browserServer.close();browserServer=undefined;
 }
 for(const name of [...inputs.map(c=>c.name),'synthetic-40000']){
  const rows=report.results.filter(r=>r.name===name);assert.equal(new Set(rows.map(r=>r.inputHash)).size,1);
  for(const variant of ['baseline','candidate'])assert.equal(new Set(rows.filter(r=>r.variant===variant).map(r=>r.imageHash)).size,1);
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 await browser?.close();await browserServer?.close();await server?.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 await writeFile(directory+'/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable}));
}
