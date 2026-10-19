import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';

const prefix='.cache/v2-source-attractor-public';
const check=(value,message)=>{if(!value)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
// Independently parse the delivered PNG in Node. Canvas decode/re-encode would
// premultiply alpha and could hide the exact loss this check must detect.
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
 let width=0,height=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  check(at+12<=bytes.length,'truncated PNG chunk');const length=bytes.readUInt32BE(at),end=at+length+12;
  check(end<=bytes.length,'truncated PNG payload');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  check(((crc^-1)>>>0)===bytes.readUInt32BE(end-4),'PNG CRC mismatch');
  if(type==='IHDR'){check(length===13&&!width,'invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data.subarray(8).equals(Buffer.from([8,6,0,0,0])),'expected non-interlaced RGBA8 PNG');}
  else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){check(length===0&&end===bytes.length,'invalid PNG end');ended=true;}
  at=end;
 }
 check(width>0&&height>0&&ended&&compressed.length,'incomplete PNG');const stride=width*4,raw=inflateSync(Buffer.concat(compressed));check(raw.length===(stride+1)*height,'invalid PNG row length');const rgba=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG row filter');for(let x=0;x<stride;x++){const a=x>=4?rgba[y*stride+x-4]:0,b=y?rgba[(y-1)*stride+x]:0,c=y&&x>=4?rgba[(y-1)*stride+x-4]:0;rgba[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,rgba};
}

const hashes=async()=>{
 const paths=(await Promise.all(['src','server'].map(async root=>(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`)))).flat();
 paths.push('scripts/verify-source-attractor-public.mjs');paths.sort();return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
};
const before=await hashes(),directory=await mkdtemp('.cache/attractor-public-service-');
const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const report={at:new Date().toISOString(),scope:'Actual public App source CPU Attractor import/edit/save/reopen/forward and reverse seek; production export service PNG compared to fresh canonical source generation and raw RGBA renderer; every decoded MP4 frame versus its actual uploaded PNG. Local integration consistency only, not original JVM/JOGL runtime parity.',directory,nativeParity:false,exports:[]};
let page,browser,server,exportServer;const errors=[],consoleErrors=[];
try{
 exportServer=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1360,height:920},deviceScaleFactor:1,acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 await page.addInitScript(()=>{
  const Native=window.Worker;window.__attractorAudit={nextWorker:0,requests:[],completed:[],errors:[]};
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.auditId=++window.__attractorAudit.nextWorker;this.addEventListener('message',({data})=>{
    if(data.operation==='generate'&&data.output){const o=data.output;window.__attractorAudit.completed.push({worker:this.auditId,id:data.id,frame:o.sourceCameraFrame,topology:o.topology,backend:o.backend,positions:Array.from(o.positions??[]),colors:Array.from(o.colors??[]),alphas:Array.from(o.pointAlphas??[]),pointAppearance:o.sourcePointAppearance,trails:o.trails?{positions:Array.from(o.trails.positions),colors:Array.from(o.trails.colors),alphas:Array.from(o.trails.alphas),indices:Array.from(o.trails.indices),appearance:o.trails.appearance}:undefined,temporal:o.temporal,backgroundColor:o.sourceBackgroundColor,stats:o.stats});}
    if(data.error)window.__attractorAudit.errors.push(data.error);
   });}
   postMessage(message,...args){if(message.operation==='generate')window.__attractorAudit.requests.push({...structuredClone(message),worker:this.auditId});return super.postMessage(message,...args);}
  };
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 const settled=()=>page.waitForFunction(()=>{const r=window.__attractorAudit.requests.at(-1);return r&&window.__attractorAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);});
 const snapshot=()=>page.evaluate(()=>{const r=window.__attractorAudit.requests.at(-1),output=window.__attractorAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id);return{request:r,output};});
 const canonical=async(path,value)=>{await page.waitForFunction(({path,value})=>{const r=window.__attractorAudit.requests.at(-1);let actual=r?.scene.attractorSource;for(const key of path)actual=actual?.[key];return actual===value&&window.__attractorAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);},{path,value});await ready();};
 const seek=async time=>{const value=await page.getByRole('slider',{name:'Time position',exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return Number(element.value);},time);await page.waitForFunction(value=>{const r=window.__attractorAudit.requests.at(-1);return Math.abs(r?.context.time-value)<1e-6&&window.__attractorAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);},value);await ready();return snapshot();};
 await ready();
 const source={config_version:'1.0.0',type:'ATTRACTOR',name:'Lorenz Source CPU Public',equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},camera:{phi:Math.PI/2,theta:0,gamma:0},palette:['#FC6255','#FFCD62','#58C4DD','#9A72AC'],settings:{render_mode:'CPU',particle_count_cpu:128,time_step:.01,sub_steps:5,scale_x:6,scale_y:6,scale_z:6,offset_z:-150,dot_size:2,line_weight:.3,show_trails:true,fade_trails:true,trail_lifetime:3},initialization:{warmup_steps:200},timeline:[{type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'track',args:[7]},{method:'gradientStart',args:[{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:30}]}]},{type:'wait',duration:1.75}]};
 await page.locator('input[type=file]').setInputFiles({name:'source-attractor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 const controls=page.getByTestId('source-attractor-controls');await controls.waitFor();await ready();await settled();
 const imported=await snapshot();check(imported.request.scene.attractorSource?.configuration.model==='attractor-1.7.8','canonical source identity missing');check(imported.output.positions.length===128*3&&imported.output.backend==='cpu','source CPU particles missing');check(imported.output.pointAppearance?.model==='mathart-1.7.8-cpu-billboard-v1'&&imported.output.trails?.appearance.model==='processing-lines-1.7.8','source point/line contracts missing');
 check(imported.request.scene.timeline.tracks.some(t=>t.actions?.some(a=>a.method==='track')),'source track was dropped on import');check(imported.request.scene.timeline.tracks.some(t=>t.actions?.some(a=>a.method==='gradientStart')),'source gradient was dropped on import');
 report.import={model:imported.request.scene.attractorSource.configuration.model,particles:imported.output.stats.generated,sourceCpu:true,sourcePointAndLineShaders:true};
 // UI selectors below are stable public controls, never private React state.
 const radius=page.getByTestId('source-attractor-points-dotRadius');await radius.fill('3');await radius.blur();await canonical(['visual','points','dotRadius'],3);
 await page.locator('.inspector-tabs button').nth(1).click();
 const palette=page.getByTestId('source-attractor-palette-text');await palette.fill('#80FC6255');await palette.blur();await canonical(['visual','palette','colors','0'],'#80FC6255');
 const background=page.getByTestId('source-attractor-backgroundColor');await background.fill('#FF101319');await background.blur();await canonical(['backgroundColor'],0xff101319);
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.scenes.find(s=>s.id===w.active)?.attractorSource;return s?.visual.points.dotRadius===3&&s.backgroundColor===0xff101319;});
 await page.reload();await ready();await settled();await page.locator('.inspector-tabs button').nth(0).click();await controls.waitFor();check(await radius.inputValue()==='3','radius lost on reopen');check((await snapshot()).request.scene.attractorSource.backgroundColor===0xff101319,'background lost on reopen');check((await snapshot()).request.scene.attractorSource.visual.palette.colors[0]==='#80FC6255','palette ARGB lost on reopen');report.editing={dotRadius:3,background:'#FF101319',firstPaletteColor:'#80FC6255',saved:true,reopened:true};
 const frames=[];for(const time of [.25,.75,1.5,.25]){const state=await seek(time);frames.push({time:state.request.context.time,output:state.output});}
 const stable=o=>JSON.stringify({positions:o.positions,colors:o.colors,alphas:o.alphas,trails:o.trails,camera:o.frame.camera});
 check(stable(frames[0].output)===stable(frames[3].output),'reverse seek changed source motion/colors/trails/camera');check(JSON.stringify(frames[0].output.positions)!==JSON.stringify(frames[1].output.positions),'source particles did not advance');check(JSON.stringify(frames[0].output.colors)!==JSON.stringify(frames[1].output.colors),'gradient did not advance');check(JSON.stringify(frames[0].output.frame.camera.center)!==JSON.stringify(frames[1].output.frame.camera.center),'tracking did not advance');check(frames.every(f=>f.output.positions.every(Number.isFinite)&&f.output.trails.indices.length>0),'missing or nonfinite motion/trail frame');
 report.seeks=frames.map(f=>({time:f.time,frameIndex:f.output.frame.frameIndex,particles:f.output.stats.generated,trailSegments:f.output.trails.indices.length/2,camera:f.output.frame.camera,hash:sha(stable(f.output))}));
 for(const time of [.25,1.25]){
  const preview=await seek(time),healthPromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');await page.getByRole('button',{name:'Export artwork',exact:true}).click();check((await healthPromise).ok(),'export service health');
  await page.getByRole('button',{name:'Still image',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending,path=`${prefix}-${time}.png`;await download.saveAs(path);
  const actual=await page.evaluate(()=>{const r=window.__attractorAudit.requests.findLast(r=>r.context.quality==='export'),output=window.__attractorAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id);return{request:r,output};});
  check(actual.output.frame.viewport.target==='offscreen','source offscreen camera missing');check(actual.request.context.sourceViewport.referenceLogicalHeight===preview.output.frame.viewport.logicalHeight,'preview reference scale lost');
  const oracle=await page.evaluate(async request=>{
   const {prepareSourceAttractorScene}=await import('/src/engine/sourceAttractorDocument.ts'),{generateSourceAttractorCpu}=await import('/src/engine/sourceAttractorScene.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');
   const renderer=new ArtRenderer(document.createElement('canvas')),cleanup={renderer:false,context:false};let result;
   try{
    const prepared=prepareSourceAttractorScene(request.scene),output=generateSourceAttractorCpu({...prepared,tracks:request.scene.timeline.tracks,fps:request.scene.timeline.fps,time:request.context.time,viewport:request.context.sourceViewport,referencePixelDensity:request.context.sourcePointPixelDensity});
    renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(output,sceneAtTime(request.scene,output.sourceCameraFrame.time),false);const styles=[];renderer.scene.traverse(o=>{if(o.userData.sourceParticlePoints||o.userData.sourceParticleTrailLines)styles.push({points:!!o.userData.sourceParticlePoints,trails:!!o.userData.sourceParticleTrailLines,visible:o.visible,depthTest:o.material.depthTest,depthWrite:o.material.depthWrite,blendSrcAlpha:o.material.blendSrcAlpha,blendDstAlpha:o.material.blendDstAlpha});});
    const gl=renderer.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,raw=new Uint8Array(w*h*4),topDown=new Uint8Array(raw.length);renderer.render();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,raw);if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('cold raw readback failed');for(let y=0;y<h;y++)topDown.set(raw.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);
    const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join(''),blob=await renderer.blob('image/png');
    result={sha:await digest(await blob.arrayBuffer()),rawSha:await digest(topDown),styles,cleanup,positions:Array.from(output.positions),colors:Array.from(output.colors),camera:output.sourceCameraFrame.camera,trailIndices:Array.from(output.trails.indices)};
   }finally{renderer.dispose();cleanup.renderer=true;renderer.renderer.forceContextLoss();cleanup.context=true;}return result;
  },actual.request);
  const bytes=await readFile(path),decoded=decodePng(bytes),rgbaSha=sha(decoded.rgba);check(decoded.width===257&&decoded.height===193,'export dimensions');check(sha(bytes)===oracle.sha&&rgbaSha===oracle.rawSha,'PNG or complete RGBA differs from direct canonical source generation');
  check(JSON.stringify(actual.output.positions)===JSON.stringify(oracle.positions)&&JSON.stringify(actual.output.colors)===JSON.stringify(oracle.colors)&&JSON.stringify(actual.output.frame.camera)===JSON.stringify(oracle.camera)&&JSON.stringify(actual.output.trails.indices)===JSON.stringify(oracle.trailIndices),'Worker dispatch differs from direct motion/color/camera/trail owner');
  check(oracle.styles.some(s=>s.points&&s.visible)&&oracle.styles.some(s=>s.trails&&s.visible&&!s.depthTest&&!s.depthWrite),'dedicated source point or overlay LINES renderer missing');
  let changed=0;for(let i=0;i<decoded.rgba.length;i+=4)if(decoded.rgba[i]!==16||decoded.rgba[i+1]!==19||decoded.rgba[i+2]!==25)changed++;check(changed>100,'PNG lacks visible particles/trails');
  report.exports.push({time,path,sha:sha(bytes),rgbaSha,bytes:bytes.length,width:decoded.width,height:decoded.height,changedPixels:changed,rawFramebufferMatches:true,directCanonicalGenerationMatches:true,styles:oracle.styles,cleanup:oracle.cleanup,viewport:actual.output.frame.viewport});await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 check(report.exports[0].sha!==report.exports[1].sha,'distinct seek exports identical');
 const uploads=[],capture=request=>{const url=new URL(request.url());if(request.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))uploads.push({index:Number(url.searchParams.get('index')),png:request.postDataBuffer()});};page.on('request',capture);
 const healthPromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');await page.getByRole('button',{name:'Export artwork',exact:true}).click();check((await(await healthPromise).json()).ffmpeg,'FFmpeg unavailable for public video verification');
 await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('256');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('192');await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('6');await page.getByRole('spinbutton',{name:'Export duration',exact:true}).fill('2');
 const pending=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending,path=`${prefix}.mp4`;await download.saveAs(path);page.off('request',capture);
 const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate','-of','json',path],{encoding:'utf8'})).streams[0];check(metadata.width===256&&metadata.height===192&&Number(metadata.nb_read_frames)===12&&metadata.r_frame_rate==='6/1','video frame count/dimensions/fps');check(uploads.length===12&&uploads.every((u,i)=>u.index===i),'video input order/count');
 const rgb=execFileSync('ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024*1024}),stride=256*192*3;check(rgb.length===12*stride,'decoded frame count');const comparisons=[];
 for(let i=0;i<uploads.length;i++){
  const decoded=decodePng(uploads[i].png);check(decoded.width===256&&decoded.height===192,'uploaded dimensions');let total=0,max=0;for(let j=0;j<stride;j++){const d=Math.abs(rgb[i*stride+j]-decoded.rgba[Math.floor(j/3)*4+j%3]);total+=d;max=Math.max(max,d);}const mean=total/stride;check(mean<6,'decoded video error beyond lossy tolerance '+i+': '+mean);comparisons.push({index:i,inputSha:sha(uploads[i].png),encodedRgbSha:sha(rgb.subarray(i*stride,(i+1)*stride)),meanAbsoluteRgbError:mean,maxAbsoluteRgbError:max});
 }
 check(new Set(comparisons.map(f=>f.inputSha)).size>=10,'video did not evolve');report.video={path,sha:sha(await readFile(path)),metadata,frames:comparisons,comparison:'Every decoded MP4 RGB frame versus its uploaded PNG; mean absolute RGB error <6 is a lossy H.264 allowance, not native parity.'};await page.getByRole('button',{name:'Close export',exact:true}).click();
 report.cancellation=await page.evaluate(async()=>{const {Generator}=await import('/src/engine/client.ts'),request=window.__attractorAudit.requests.findLast(r=>r.context.quality==='export'),cancelled=new Generator(),promise=cancelled.generate(request.scene,request.context).then(()=>({rejected:false}),error=>({rejected:true,message:String(error)}));cancelled.dispose();const outcome=await promise,recovery=new Generator();try{const output=await recovery.generate(request.scene,request.context);return{...outcome,recovery:output.backend==='cpu'&&output.positions.length===128*3&&output.trails?.indices.length>0,disposed:true};}finally{recovery.dispose();}});check(report.cancellation.rejected&&report.cancellation.recovery,'pending Worker cancellation/recovery');
 const stored=await readdir(directory);check(stored.length===3&&stored.filter(p=>p.endsWith('.png')).length===2&&stored.some(p=>p.endsWith('.mp4')),'unexpected export service files');const serviceHashes=await Promise.all(stored.map(async name=>({name,sha:sha(await readFile(`${directory}/${name}`))})));for(const item of [...report.exports,report.video])check(serviceHashes.some(s=>s.sha===item.sha),'download differs from stored export');report.serviceFiles=serviceHashes;
 const workerErrors=await page.evaluate(()=>window.__attractorAudit.errors);check(!errors.length&&!workerErrors.length&&!consoleErrors.length,'App/Worker/console error');await page.screenshot({path:`${prefix}-ui.png`});const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'production source changed during verification');Object.assign(report,{status:'passed',sourceStable:true,sources:after,pageErrors:errors,workerErrors,consoleErrors});
}catch(error){Object.assign(report,{status:'failed',error:String(error),stack:error.stack,pageErrors:errors,consoleErrors});if(page){report.failureState=await page.evaluate(async()=>{const r=window.__attractorAudit?.requests.at(-1),w=JSON.parse(localStorage.getItem('mathart-lab-v1')??'null');let validation;try{const {parseScene}=await import('/src/engine/document.ts');parseScene(JSON.stringify(r?.scene));validation='valid';}catch(e){validation=String(e);}return{active:w?.active,saved:w?.scenes.map(s=>({id:s.id,attractorSource:s.attractorSource})),latest:r?.scene.attractorSource,validation,workerErrors:window.__attractorAudit?.errors};}).catch(()=>undefined);report.body=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:`${prefix}-failed.png`}).catch(()=>{});}process.exitCode=1;}
finally{const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=closed.map((r,i)=>({resource:['browser','vite','export-server'][i],status:r.status,...(r.status==='rejected'?{error:String(r.reason)}:{})}));if(closed.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}await writeFile(`${prefix}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,imports:report.import,seeks:report.seeks,exports:report.exports,video:report.video?.metadata}));}
