/** Real WebGL uniform/ink check, not a native MathArt image comparison. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
const directory=process.argv[2];if(!directory)throw Error('Supply a new output directory');await mkdir(directory);
const report={status:'running',limits:['Local WebGL color-uniform wiring only; no native GPU execution or full-window parity.','Black/white linear palette checks avoid claiming native LUT interpolation or splat equivalence.']},start=performance.now();
let server,browser;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),url=server.resolvedUrls.local[0];
 await page.route(url,r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(url);
 report.cases=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{parseScene,serializeScene}=await import('/src/engine/document.ts');
  const {prepareIteratedFrame}=await import('/src/scenes/iteratedDensity.ts'),{IteratedDensityGpu}=await import('/src/engine/iteratedDensityGpu.ts');
  const rows=[];
  // With min=0/max=2, native ROBUST maps these metric values to 0, .5, .75.
  for(const [metric,expected]of [[0,0],[2,.5],[6,.75]]){
   const input={config_version:'1.0.0',name:'Color wiring',type:'SYMMETRY_CHAOS',equation:{glsl:`void calculate_next(in vec3 p,out vec3 n,out float m){n=vec3(0.);m=${metric}.;}`},settings:{batch_size:8,burn_in_steps:0,dot_size:4,step_metric_min:{ignored:true},step_metric_max:'NaN',color_speed:'bad',color_phase:360},palette:['#000000','#ffffff']};
   const scene=parseScene(serializeScene(parseProjectFile(JSON.stringify(input)).scene)),gpu=new IteratedDensityGpu(),row={metric,expected};
   try{
    const frame=prepareIteratedFrame(scene,0,0);row.config=frame.config;
    gpu.step(frame,{width:16,height:16,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},resetParticles:true,clearInk:true});
    const ink=gpu.readback();let mass=0;const sums=[0,0,0];for(let i=0;i<ink.length;i+=4){mass+=ink[i+3];for(let c=0;c<3;c++)sums[c]+=ink[i+c];}
    row.mass=mass;row.rgb=sums.map(v=>v/mass);row.maxError=Math.max(...row.rgb.map(v=>Math.abs(v-expected)));
    if(!(mass>0)||row.maxError>1e-6)throw Error('Actual WebGL ink disagrees with known robust metric colors: '+JSON.stringify(row));
   }finally{gpu.dispose();row.retainedBytes=gpu.diagnostics().retainedBytes;}
   if(row.retainedBytes!==0)throw Error('GPU cleanup retained resources');rows.push(row);
  }
  return rows;
 });
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),server?.close()])).map(r=>r.status);
 if(report.cleanup.some(s=>s!=='fulfilled')){report.status='failed';process.exitCode=1;}
 report.elapsedMs=performance.now()-start;await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
