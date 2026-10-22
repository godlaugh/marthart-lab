import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
// Uses a retained public input fixture; original-reference PNGs are kept outside Git.
const root=process.argv[2]??`.cache/source-fractal-display-${Date.now()}`;await mkdir(root,{recursive:true});
const input=JSON.parse(await readFile(new URL('../tests/fixtures/source-fractal-display/mandelbrot.json',import.meta.url),'utf8'));
let server,browser;const report={scope:'Production single-display sequence versus observed original paused sequence; full family parity unproven.',frames:[]};
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'probe');
 const rows=await page.evaluate(async input=>{
  const {parseProjectFile}=await import('/src/engine/legacyImport.ts'),{prepareSourceFractalScene,bindSourceFractalFrame}=await import('/src/engine/sourceFractalTimeline.ts'),{SourceFractalSceneRuntime}=await import('/src/engine/sourceFractalSceneRuntime.ts'),{generateFractal,prepareFractalRender}=await import('/src/scenes/complex.ts'),{SourceFractalDisplay,sourceFractalDisplayInput}=await import('/src/engine/sourceFractalDisplay.ts'),{encodeRgbaPng}=await import('/src/engine/rgbaPng.ts'),{fractalGpu}=await import('/src/engine/fractalGpu.ts');
  const scene=parseProjectFile(JSON.stringify(input)).scene,host=new SourceFractalSceneRuntime(prepareSourceFractalScene(scene),{reserve(){}}),owner=new SourceFractalDisplay();
  bindSourceFractalFrame(scene,{...host.snapshot(),displayFrame:0,simulationFps:scene.timeline.fps});const rows=[];
  const targets=[...Array.from({length:7},(_,i)=>({name:'frame-'+i,width:500,height:600,logicalWidth:250,logicalHeight:300})),{name:'alternate-size',width:810,height:972,logicalWidth:405,logicalHeight:486},{name:'after-size-reset',width:500,height:600,logicalWidth:250,logicalHeight:300}];
  for(const item of targets){
   const context={time:0,quality:'export',width:item.width,height:item.height,fractalViewport:{logicalWidth:item.logicalWidth,logicalHeight:item.logicalHeight,target:'offscreen'}};
   const prepared=prepareFractalRender(scene,context),output=owner.display(sourceFractalDisplayInput(prepared,scene),display=>generateFractal(scene,{...context,fractalDisplay:display},prepared));
   rows.push({name:item.name,facts:output.fractalRender,png:Array.from(new Uint8Array(await(await encodeRgbaPng(output.pixels,output.width,output.height)).arrayBuffer()))});
  }
  fractalGpu.dispose();return rows;
 },input);
 for(const{png,...row}of rows){await writeFile(root+'/'+row.name+'.png',Buffer.from(png));report.frames.push(row);}
 const expected=[[.25,0],[.5,0],[1,0],[1,1024],[1,1024],[1,1024],[1,1024],[.25,1024],[.25,0]];
 if(report.frames.length!==expected.length)throw Error('Incomplete display sequence');
 for(let i=0;i<report.frames.length;i++){const f=report.frames[i].facts.display,hash=i===7?1524166749:1354526813;if(f.previewScale!==expected[i][0]||f.gradientSize!==expected[i][1]||f.stateHash!==hash)throw Error('Unexpected real display sequence at '+i);}
 for(let i=4;i<7;i++)if(!Buffer.from(rows[i].png).equals(Buffer.from(rows[3].png)))throw Error('Stable paused frame changed');
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}finally{await browser?.close();await server?.close();await writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,frames:report.frames.length}));}
