import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-attractor-display.mjs').sort().map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),scope:'Canonical source CPU Attractor display boundary -> actual ArtRenderer -> PNG, including same-frame heads/trails/gradient/camera, reverse seeks and queue completion. No public importer/editor/Worker integration, video or original JVM/JOGL comparison.',nativeParity:false};
let server,browser;
try{
 const before=await hashes();server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/attractor-display-test',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(server.resolvedUrls.local[0]+'attractor-display-test');
 const result=await page.evaluate(async()=>{
  const {importSourceAttractorConfig}=await import('/src/engine/sourceAttractorConfig.ts'),{importSourceAttractorVisualConfig}=await import('/src/engine/sourceAttractorVisualConfig.ts'),{prepareSourceAttractorEquation}=await import('/src/engine/sourceAttractorEquation.ts');
  const {generateSourceAttractorCpu}=await import('/src/engine/sourceAttractorScene.ts'),{resolveSourceCamera,SOURCE_CAMERA_MODEL}=await import('/src/engine/sourceCamera.ts');
  const {ArtRenderer}=await import('/src/engine/renderer.ts'),{createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const take=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},check=(v,m)=>{if(!v)throw Error(m);};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const config=take(importSourceAttractorConfig({particle_count_cpu:128,time_step:.01,sub_steps:5,scale_x:6,scale_y:6,scale_z:6,offset_z:-150},{warmup_steps:200})).configuration;
  const visual=take(importSourceAttractorVisualConfig({dot_size:2,line_weight:.3,show_trails:true,fade_trails:true,trail_lifetime:3},['#FC6255','#FFCD62','#58C4DD','#9A72AC'])).configuration;
  const equation=take(prepareSourceAttractorEquation({equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},parameters:{}})),initial=take(resolveSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}}));check(initial.kind==='known','camera');
  const camera={...initial.state.authored,phi:Math.fround(Math.PI/2),theta:0,gamma:0,zoom:1,center:[0,0,0]};
  const wait={id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false};
  const tracks=[{...wait,id:'animate',type:'animate',target:'camera.actions',duration:1,actions:[{id:'g',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'rgb',speed:30,affectInside:true,affectOutside:true}}]},{...wait,duration:2}];
  const scene=createScene(definition('attractor'));scene.sourceCamera={model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}};scene.settings.sourceCameraProjection='perspective';scene.settings.showGrid=false;scene.settings.showAxes=false;scene.settings.opacity=1;
  const build=(time,show=true,width=640,height=480)=>generateSourceAttractorCpu({configuration:config,equation,visualConfiguration:{...visual,trails:{...visual.trails,show}},camera,tracks,fps:30,time,viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:480,target:'primary',projectionPass:'perspective'},referencePixelDensity:1,backgroundColor:0xff101319});
  async function render(time,show=true,width=640,height=480){
   const canvas=document.createElement('canvas'),art=new ArtRenderer(canvas);
   try{art.setSize(width,height,1);const output=build(time,show,width,height);art.setOutput(output,scene);const blob=await art.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
    const gl=art.renderer.getContext(),pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);check(gl.getError()===0,'GL error');let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==16||pixels[i+1]!==19||pixels[i+2]!==25)visible++;check(visible>100,'empty output');
    let encoded='';for(const b of bytes)encoded+=String.fromCharCode(b);
    return{time,show,width,height,sha256:await digest(bytes),pixelHash:await digest(pixels),visiblePixels:visible,records:output.temporal.recordedPoints,particles:output.stats.generated,invalid:output.stats.invalid,png:btoa(encoded)};
   }finally{art.dispose();}
  }
  const rows=[];for(const [time,show,width,height] of [[1.5,true,640,480],[0,true,640,480],[1.5,true,640,480],[1.5,false,640,480],[3,true,320,240],[4,true,320,240]])rows.push(await render(time,show,width,height));
  check(rows[0].sha256===rows[2].sha256,'reverse seek/cold renderer changed frame');check(rows[0].pixelHash!==rows[3].pixelHash,'trail display missing');check(rows[4].sha256===rows[5].sha256,'completed queue changed');
  const a=build(1.5);check(a.trails.appearance.model==='processing-lines-1.7.8','native line contract');check(a.sourcePointAppearance.model==='mathart-1.7.8-cpu-billboard-v1','point contract');
  return{rows,preview:rows[0].png};
 });
 const preview='.cache/v2-attractor-source-preview.png';await writeFile(preview,Buffer.from(result.preview,'base64'));report.preview=preview;report.rows=result.rows.map(({png,...r})=>r);report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable)throw Error('runtime errors or source changed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile('.cache/v2-source-attractor-display.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,rows:report.rows,preview:report.preview}));}
