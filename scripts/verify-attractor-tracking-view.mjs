import {chromium} from '../node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:5177/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#10151c;color:white;font:16px system-ui}canvas{width:800px;height:450px}p{margin:12px}</style><p>Continuous Attractor — delivered frame camera</p><canvas></canvas>'}));
 await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{Generator}=await import('/src/engine/client.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts');
  const check=(ok,m)=>{if(!ok)throw Error(m);},s=createScene(definition('attractor'));
  s.equations={dx:'1',dy:'0',dz:'0'};s.parameters={};Object.assign(s.settings,{simulationMode:'continuous',attractorBackend:'gpu',particleCount:64,burnIn:0,staggerMin:0,staggerMax:0,simulationFps:8,subSteps:1,dt:.125,initialX:0,initialY:0,initialZ:0,initialSpread:1,variableTimeStep:false,showTrails:false,integrator:'euler',pointSize:6,scale:1});
  s.timeline.duration=10;s.timeline.tracks=[{id:'tracked',type:'animate',target:'camera.actions',start:0,duration:0,from:0,to:0,easing:'linear',enabled:true,pingPong:false,actions:[{id:'follow',method:'track',args:{index:63}}]}];
  const generator=new Generator(),renderer=new ArtRenderer(document.querySelector('canvas'));renderer.setSize(800,450,1);
  try{
   const rows=[];
   for(const time of [.25,1]){
    const output=await generator.generate(s,{time,width:800,height:450,quality:'export'}),frame=sceneAtTime(s,output.cameraFrame.time),view=outputCamera(frame,output);
    check(output.backend==='webgl2'&&output.stats.generated===64,'GPU output missing');renderer.setOutput(output,frame,false);renderer.setCamera(view.camera);renderer.setCameraEffects(view.roll,view.focalLength);
    const actual=renderer.cameraState();for(const key of ['position','target'])for(let i=0;i<3;i++)check(Math.abs(actual[key][i]-view.camera[key][i])<1e-12,`renderer ${key} differs from producer camera`);
    check(actual.zoom===view.camera.zoom,'zoom changed');const future=outputCamera(sceneAtTime(s,8),output);check(JSON.stringify(future)===JSON.stringify(output.cameraFrame),'future UI clock overrides delivered camera');
    const blob=await new Promise(resolve=>renderer.renderer.domElement.toBlob(resolve,'image/png'));check(blob&&blob.size>3000,'PNG output missing');rows.push({time,backend:output.backend,target:actual.target,position:actual.position,pngBytes:blob.size,futureUiClock:8,deliveredCameraPreserved:true});
   }
   return{status:'passed',at:new Date().toISOString(),rows,scope:'Actual ArtRenderer + production worker + shared outputCamera. React UI interaction is independently verified by root; this probe does not claim it.'};
  }finally{generator.dispose();renderer.dispose();}
 });
 if(errors.length)throw Error(errors.join('\n'));report.pageErrors=errors;
 await page.screenshot({path:new URL('../.cache/attractor-tracking-view.png',import.meta.url).pathname});
 await writeFile(new URL('../.cache/attractor-tracking-view-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
