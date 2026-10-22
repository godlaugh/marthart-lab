/** Source Mandelbrot/Julia import -> paused runtime -> production WebGL2.
 * Local runtime evidence, not original application framebuffer acceptance. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {writeFile,mkdir} from 'node:fs/promises';
const directory=process.argv[2]??`.cache/source-fractal-power-${Date.now()}`;
await mkdir(directory,{recursive:true});
let server,browser;
const report={scope:'Actual local WebGL2 source power rendering; original pixel equivalence remains unverified.',cases:[]};
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 const rows=await page.evaluate(async()=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareSourceFractalScene,bindSourceFractalFrame}=await import('/src/engine/sourceFractalTimeline.ts'),{SourceFractalSceneRuntime}=await import('/src/engine/sourceFractalSceneRuntime.ts'),{definition}=await import('/src/scenes/index.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts'),{fractalGpu}=await import('/src/engine/fractalGpu.ts');
  const cases=[{id:'mandelbrot-ordinary',formula:'mandelbrot',power:2,zoom:1,center:[-.5,0],precision:'ULTRA'},{id:'julia-ordinary',formula:'julia',power:2,zoom:1,center:[0,0]},{id:'mandelbrot-deep',formula:'mandelbrot',power:2,zoom:1e8,center:[-.743643887037151,.13182590420533]},{id:'julia-deep',formula:'julia',power:3,zoom:1000,center:[.1,.2]},{id:'noninteger-ordinary',formula:'mandelbrot',power:2.5,zoom:100,center:[0,0]}];
  const result=[];
  for(const item of cases){
   const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:item.id,fractal:{formula_id:item.formula,perturbation_precision:item.precision??'MEDIUM',center:item.center,zoom:item.zoom,iterations:128,parameters:{power:item.power,bailout:4,julia_seed:[-.8,.156]}},color:{inside:{algorithm_id:'none',solid_color:'#000000'},outside:{algorithm_id:'basic',algorithm_params:{metric:'ITERATION'},color_density:3}}})).scene;
   const runtime=new SourceFractalSceneRuntime(prepareSourceFractalScene(scene),{reserve(){}});
   const frame={...runtime.snapshot(),displayFrame:0,simulationFps:scene.timeline.fps};bindSourceFractalFrame(scene,frame);
   const before=JSON.stringify(runtime.snapshot()),output=definition('fractal').generate(scene,{time:0,width:96,height:72,quality:'export',fractalViewport:{logicalWidth:96,logicalHeight:72,target:'offscreen'}});
   if(output.type!=='raster'||output.fractalRender?.profile!=='mathart-1.7.8-power-v1')throw Error('Source power routing failed');
   if(JSON.stringify(runtime.snapshot())!==before)throw Error('Paused rendering mutated the clock');
   const pixels=output.pixels;if(!pixels.some((v,i)=>i%4!==3&&v>0))throw Error('Blank source output');
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');
   result.push({id:item.id,sha256,facts:output.fractalRender,png:Array.from(new Uint8Array(await (await encodeRgbaPng(pixels,output.width,output.height)).arrayBuffer()))});
  }
  fractalGpu.dispose();return result;
 });
 for(const {png,...row}of rows){await writeFile(`${directory}/${row.id}.png`,Buffer.from(png));report.cases.push(row);}
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}finally{await browser?.close();await server?.close();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,status:report.status,error:report.error,cases:report.cases.map(c=>c.id)}));}
