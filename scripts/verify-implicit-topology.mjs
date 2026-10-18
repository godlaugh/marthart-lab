import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from 'playwright/test';

// Actual production Worker, GPU request/fallback, renderer and transfer paths.
// This is a bounded regular-surface test, not an arbitrary-formula manifold claim.
const paths=['src/engine/implicitSurface.ts','src/engine/implicitContinuity.ts','src/scenes/geometry.ts','src/types.ts','tests/implicitSurface.test.ts','scripts/verify-implicit-topology.mjs'];
const snapshot=async()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const before=await snapshot(),server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
await server.listen();let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:800,height:600}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
 await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style><canvas id="view" width="800" height="600"></canvas>'}));
 await page.goto(origin+'/');
 const results=await page.evaluate(async()=>{
  const{createScene}=await import('/src/engine/document.ts'),{definitions,generateImplicit}=await import('/src/scenes/geometry.ts'),{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{gpuFormulaSampler}=await import('/src/engine/gpuSampler.ts');
  const def=definitions.find(item=>item.kind==='implicit'),context={time:0,width:800,height:600,quality:'export'},worker=new Generator();
  const check=(value,message)=>{if(!value)throw Error(message);};
  const hash=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(array.buffer,array.byteOffset,array.byteLength)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const scene=n=>{const value=createScene(def);value.parameters={};value.equations={f:'(sqrt(x*x+y*y)-1)^2+z*z-.4^2'};Object.assign(value.settings,{resolution:n,computeBackend:'cpu',minX:-2,maxX:2,minY:-2,maxY:2,minZ:-2,maxZ:2});return value;};
  function topology(out){
   check(out.type==='geometry'&&out.topology==='mesh','expected mesh');
   const edges=new Map(),links=Array.from({length:out.stats.generated},()=>[]);let area=0,volume=0,maxDistance=0;
   for(let i=0;i<out.positions.length;i+=3){const[x,y,z]=out.positions.subarray(i,i+3);maxDistance=Math.max(maxDistance,Math.abs(Math.hypot(Math.hypot(x,y)-1,z)-.4));}
   for(let i=0;i<out.indices.length;i+=3){
    const ids=Array.from(out.indices.subarray(i,i+3)),[a,b,c]=ids.map(id=>Array.from(out.positions.subarray(id*3,id*3+3))),u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const size=Math.hypot(...cross);check(size>0&&Number.isFinite(size),'degenerate delivered face');area+=size/2;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let k=0;k<3;k++){const x=ids[k],y=ids[(k+1)%3],z=ids[(k+2)%3],key=x<y?`${x}:${y}`:`${y}:${x}`,edge=edges.get(key)??{count:0,balance:0};edge.count++;edge.balance+=x<y?1:-1;edges.set(key,edge);links[x].push([y,z]);}
   }
   let badLinks=0;
   for(const link of links){const graph=new Map();for(const[a,b]of link){graph.set(a,[...(graph.get(a)??[]),b]);graph.set(b,[...(graph.get(b)??[]),a]);}const seen=new Set(),pending=[graph.keys().next().value];while(pending.length){const v=pending.pop();if(seen.has(v))continue;seen.add(v);pending.push(...graph.get(v));}if(seen.size!==graph.size||[...graph.values()].some(x=>x.length!==2))badLinks++;}
   const badEdges=[...edges.values()].filter(x=>x.count!==2).length,orientationConflicts=[...edges.values()].filter(x=>x.balance!==0).length,euler=out.stats.generated-edges.size+out.indices.length/3;
   check(badEdges===0&&badLinks===0&&orientationConflicts===0&&euler===0,'torus topology mismatch');check(maxDistance<1e-6,'torus distance residual');
   check(out.implicit.rejectedEdges===0&&out.implicit.unresolvedCells===0&&out.implicit.representedZeroCorners>0,'root facts mismatch');
   return{vertices:out.stats.generated,triangles:out.indices.length/3,edges:edges.size,badEdges,badLinks,orientationConflicts,euler,area,volume,maxAnalyticDistance:maxDistance};
  }
  const results=[];let renderer;
  try{
   for(const n of[40,80]){
    const input=scene(n),saved=JSON.stringify(input),start=performance.now(),out=await worker.generate(input,context),elapsedMs=performance.now()-start;
    check(JSON.stringify(input)===saved,'worker mutated authored scene');
    results.push({name:`worker-torus-${n}`,elapsedMs,topology:topology(out),facts:out.implicit,backend:out.backend,positionHash:await hash(out.positions),indexHash:await hash(out.indices)});
    if(n===40){
     renderer=new ArtRenderer(document.getElementById('view'));renderer.setSize(800,600,1);renderer.setOutput(out,input,true);
     const gl=renderer.renderer.getContext(),pixels=new Uint8Array(800*600*4);gl.readPixels(0,0,800,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let changed=0;for(let i=4;i<pixels.length;i+=4)if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2])changed++;check(changed>1000,'empty torus canvas');
     results.push({name:'actual-renderer',changedPixels:changed,pixelHash:await hash(pixels)});
     const gpu=generateImplicit({...input,settings:{...input.settings,computeBackend:'webgl2'}},context);topology(gpu);check(await hash(gpu.positions)===await hash(out.positions)&&await hash(gpu.indices)===await hash(out.indices),'GPU/fallback differs from CPU worker');results.push({name:'requested-webgl2',actualBackend:gpu.backend,facts:gpu.implicit,warnings:gpu.warnings??[]});
    }
   }
   const recovered=await worker.generate(scene(40),context);check(await hash(recovered.positions)===results[0].positionHash&&await hash(recovered.indices)===results[0].indexHash,'worker cross-grid cache contamination');results.push({name:'same-worker-return-to-40',topology:topology(recovered)});
   // Keep the displayed frame until its screenshot; dispose via an explicit hook.
   window.disposeImplicitTopology=()=>{renderer?.dispose();worker.dispose();gpuFormulaSampler.dispose();};
   return results;
  }catch(error){renderer?.dispose();worker.dispose();gpuFormulaSampler.dispose();throw error;}
 });
 await page.screenshot({path:'.cache/v2-implicit-torus.png'});
 await page.evaluate(()=>window.disposeImplicitTopology());
 assert.deepEqual(errors,[]);assert.deepEqual(await snapshot(),before,'verification source changed during run');
 const report={at:new Date().toISOString(),status:'passed',browser:browser.version(),results,pageErrors:errors,sourceSnapshots:before,limits:['No original application execution or original Marching Cubes pixel comparison.','Only these regular torus meshes are proved closed and oriented by all edge incidences, all vertex links and Euler characteristic.','Discontinuous, unresolved, unsampled thin components and arbitrary-formula topology remain outside this certificate.','Timing is browser task elapsed only; CPU time, process-family memory, VRAM and token costs are not measured by this script.']};
 await writeFile('.cache/v2-implicit-topology-browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,results}));
}finally{await browser?.close();await server.close();}
