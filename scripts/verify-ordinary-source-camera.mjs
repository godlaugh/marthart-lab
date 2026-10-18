import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sources=['src/engine/ordinarySourceCamera.ts','src/engine/sourceCamera.ts','src/engine/ordinarySourceCameraTimeline.ts','src/engine/renderer.ts','src/engine/temporal.ts','src/engine/timeline.ts','src/engine/client.ts','scripts/verify-ordinary-source-camera.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const before=await hashes(),server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true}),report={at:new Date().toISOString(),scope:'Real generation Worker and ArtRenderer on four eligible geometry paths; actual source matrices, pixel landmarks, DPR, resize, source/local switch and PNG decode. Original JVM/app not executed.'};
try{
 const page=await browser.newPage();await page.route('**/camera-fixture',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto(server.resolvedUrls.local[0]+'camera-fixture');
 report.results=await page.evaluate(async()=>{
  const {Generator}=await import('/src/engine/client.ts'),{createScene,parseScene,serializeScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {ArtRenderer}=await import('/src/engine/renderer.ts'),{ordinarySourceViewport,prepareOrdinarySourceFrame}=await import('/src/engine/ordinarySourceCamera.ts');
  const {sceneAtTime}=await import('/src/engine/timeline.ts');
  const check=(value,message)=>{if(!value)throw Error(message);};
  const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas')),results=[];
  function sceneFor(kind){
   const s=createScene(definition(kind));s.name='Camera '+kind;
   Object.assign(s.settings,{sourceCameraProjection:'perspective',background:'#000000',showAxes:false,showGrid:false,showTrails:false,scale:1,scaleX:1,scaleY:1,scaleZ:1,pointSize:3,computeBackend:'cpu'});
   s.sourceCamera={model:'mathart-1.7.8-v1',configuration:{kind:'angles',family:kind,phi:0,theta:0,gamma:0}};
   s.timeline={duration:2,fps:4,loop:false,schedule:'ordinary-camera-sequence-v1',tracks:[]};
   if(kind==='surface'){s.equations={x:'u',y:'v',z:'0'};s.parameters={};Object.assign(s.settings,{uMin:0,uMax:10,vMin:0,vMax:5,uSegments:3,vSegments:3,renderMode:'points',periodicU:false,periodicV:false});}
   if(kind==='implicit')Object.assign(s.settings,{resolution:12,scale:15});
   if(kind==='attractor')Object.assign(s.settings,{steps:64,burnIn:0,simulationMode:'trajectory',renderMode:'points',attractorBackend:'cpu'});
   if(kind==='perlin'){Object.assign(s.settings,{style:'continuous',particleDisplay:'heads',particleCount:32,particleBackend:'cpu',particleDomainWidth:40,particleDomainHeight:40,scale:1});}
   return parseScene(serializeScene(s));
  }
  async function draw(s,{width=96,height=64,dpr=1,target='primary',reference=height,time=0}={}){
   const context={time,width:Math.round(width/2),height:Math.round(height/2),quality:'preview',sourceViewport:ordinarySourceViewport(s,width,height,target,reference)};
   const output=await generator.generate(s,context);check(output.type==='geometry','eligible path returned raster: '+s.kind);check(output.sourceCameraFrame,'missing delivered camera');
   const evaluated=sceneAtTime(s,output.sourceCameraFrame.time),plan=prepareOrdinarySourceFrame(output.sourceCameraFrame);
   renderer.setSize(width,height,dpr);renderer.setOutput(output,evaluated,true);renderer.setInteractive(true);renderer.fit();renderer.render();
   check(!renderer.controls.enabled,'orbit controls replaced source camera');
   check(JSON.stringify(renderer.camera.matrixWorldInverse.elements)===JSON.stringify(Array.from(plan.modelView.columnMajor)),'modelview overwritten');
   check(JSON.stringify(renderer.camera.projectionMatrix.elements)===JSON.stringify(Array.from(plan.projection.columnMajor)),'projection overwritten');
   const gl=renderer.renderer.getContext(),w=renderer.renderer.domElement.width,h=renderer.renderer.domElement.height,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   check(gl.getError()===0,'WebGL error');const lit=Array.from({length:w*h},(_,i)=>pixels[i*4]+pixels[i*4+1]+pixels[i*4+2]>0).filter(Boolean).length;check(lit>0,'empty frame: '+s.kind);
   const landmark=renderer.camera.position.clone().set(10,5,0).project(renderer.camera),screen=[(landmark.x+1)*width/2,(1-landmark.y)*height/2];
   const blob=await renderer.blob('image/png'),bitmap=await createImageBitmap(blob);check(bitmap.width===w&&bitmap.height===h,'PNG size mismatch');bitmap.close();
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const result={kind:s.kind,width,height,dpr,target,reference,time,frame:output.sourceCameraFrame,points:output.positions.length/3,lit,screen,pngBytes:blob.size,sha};results.push(result);return result;
  }
  try{
   const s=sceneFor('surface');
   const first=await draw(s),double=await draw(s,{dpr:2}),exported=await draw(s,{width:192,height:128,target:'offscreen',reference:64});
   check(Math.abs(first.screen[0]-58)<1e-4&&Math.abs(first.screen[1]-37)<1e-4,'zero-angle world/pixel mapping differs');
   check(JSON.stringify(first.screen)===JSON.stringify(double.screen),'DPR changed logical camera');
   check(exported.screen.every((v,i)=>Math.abs(v-2*first.screen[i])<1e-4),'offscreen reference scale differs');
   await draw(s,{width:64,height:96});
   s.timeline.tracks=[0,1].map(i=>({id:String(i),type:'animate',target:'camera.actions',start:i,duration:1,easing:'linear',from:0,to:0,enabled:true,pingPong:false,actions:[{id:'a'+i,method:'rotateTheta',args:{angle:1},enabled:true}]}));
   const a=await draw(s,{time:.25}),b=await draw(s,{time:1.75});check(a.frame.camera.theta===.5&&b.frame.camera.theta===1,'eager relative targets differ');check(first.sha!==a.sha&&a.sha!==b.sha,'rotation had no pixel effect');
   for(const kind of ['implicit','attractor','perlin'])await draw(sceneFor(kind));
   const mixed=sceneFor('surface');mixed.equations.z='u*v/4';mixed.sourceCamera.frame={phi:.4,theta:.3,gamma:.2,center:[2,-3,1],zoom:1.3,focalDistance:25};await draw(mixed);
   const progressScene=sceneFor('perlin');progressScene.settings.particleCount=5000;progressScene.timeline.duration=12;
   progressScene.timeline.tracks=[{id:'spin',type:'animate',target:'camera.actions',start:0,duration:1,easing:'linear',from:0,to:0,enabled:true,pingPong:false,actions:[{id:'spin-action',method:'ambient',args:{phiSpeed:0,thetaSpeed:.1,gammaSpeed:0}}]}];
   const progress=[];await generator.generate(progressScene,{time:10,width:48,height:32,quality:'preview',sourceViewport:ordinarySourceViewport(progressScene,96,64,'primary',64)},out=>{
    const expected=sceneAtTime(progressScene,out.temporal.time).evaluatedSourceCamera;
    progress.push({geometryTime:out.temporal.time,cameraTime:out.sourceCameraFrame.time,frameIndex:out.sourceCameraFrame.frameIndex,matches:JSON.stringify(out.sourceCameraFrame.camera)===JSON.stringify(expected.camera)});
   });
   check(progress.length>0&&progress.every(p=>p.matches&&p.cameraTime<=p.geometryTime&&p.geometryTime<10),'progress camera not paired with intermediate geometry');
   const local=sceneFor('surface');delete local.sourceCamera;delete local.timeline.schedule;const out=await generator.generate(local,{time:0,width:96,height:64,quality:'preview'});renderer.setOutput(out,local,true);check(renderer.controls.enabled&&renderer.camera.matrixAutoUpdate&&renderer.camera.matrixWorldAutoUpdate,'legacy navigation not restored');
   const restored=await draw(sceneFor('surface'));check(restored.sha===first.sha,'source/local/source changed image');
   return{frames:results,progress,legacySwitch:true,landmarkExpected:[58,37],originalAppParity:false};
  }finally{generator.dispose();renderer.dispose();renderer.renderer.forceContextLoss();}
 });
 const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('source changed during verification');Object.assign(report,{status:'passed',sourceStable:true,sources:after});
}catch(error){Object.assign(report,{status:'failed',error:String(error),stack:error.stack});process.exitCode=1;}
finally{await browser.close();await server.close();report.cleanup='Generator and renderer disposed; browser and Vite closed.';await writeFile('.cache/v2-ordinary-camera-renderer.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,frames:report.results?.frames.length}));}
