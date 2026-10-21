// Real public export, bounded on-disk frame evidence and streaming H.264 validation.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {createServer as tcp} from 'node:net';
import {createExportServer} from '../server/index.mjs';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
const upper=process.argv.includes('--upper'),directory=process.argv.slice(2).find(x=>!x.startsWith('--'));
if(!directory)throw Error('Supply a report directory');
const particles=upper?2000:1000,substeps=upper?10:5,lifetime=upper?10:5,width=1920,height=1080,fps=30,frames=300;
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
await mkdir(directory+'/inputs',{recursive:true});
const hashes=async()=>{const paths=(await Promise.all(['src','server'].map(async root=>(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`)))).flat();paths.push('scripts/verify-attractor-high-quality-video.mjs','desktop/graphics.mjs');return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));};
const report={status:'running',at:new Date().toISOString(),configuration:{particles,substeps,lifetime,warmup:200,width,height,fps,frames,duration:10},sourceBefore:await hashes(),uploads:[],errors:[],limits:['Public App import and 1080p export with actual FFmpeg. No native original-window parity.','Upload interception writes PNG evidence to disk and adds overhead. Timings are instrumented task costs, not interactive FPS.','Fresh continuous replay checkpoints use the production generator/renderer: local determinism, not independent original mathematics.','Decoded H.264 uses mean RGB error <6 and per-frame nonempty/changing content checks; lossy output is not byte-exact PNG.','CPU/RSS require an external process-family sampler; GPU memory and whole agent token cost unmeasured.']};
let browser,page,vite,service;const start=performance.now();
try{
 const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:directory+'/exports',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 vite=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await vite.listen();
 const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});report.graphics=Object.fromEntries(switches);
 browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>`--${k}=${v}`)});report.browser=browser.version();
 page=await browser.newPage({viewport:{width:1360,height:920},deviceScaleFactor:1,acceptDownloads:true});page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{
  const a=window.__videoAudit={requests:[],completed:[],errors:[],firstExport:null},Native=Worker;
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.error)a.errors.push(data.error);if(data.operation==='generate'&&data.output){const o=data.output;a.completed.push({id:data.id,type:o.type,backend:o.backend,particles:o.positions?.length/3,frame:o.sourceCameraFrame,records:o.temporal?.recordedPoints,segments:o.trails?.indices.length/2,stats:o.stats,warnings:o.warnings});}});}
   postMessage(m,...args){if(m.operation==='generate'){a.requests.push({id:m.id,context:structuredClone(m.context),configuration:structuredClone(m.scene.attractorSource),name:m.scene.name});if(m.context.quality==='export'&&!a.firstExport)a.firstExport=structuredClone(m);}return super.postMessage(m,...args);}
  };
 });
 const origin=vite.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const {createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready'));
 const source={config_version:'1.0.0',type:'ATTRACTOR',name:`Lorenz HQ ${particles}`,equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},camera:{phi:Math.PI/2,theta:0,gamma:0},palette:['#FC6255','#FFCD62','#58C4DD','#9A72AC'],settings:{render_mode:'CPU',particle_count_cpu:particles,time_step:.005,sub_steps:substeps,scale_x:6,scale_y:6,scale_z:6,offset_z:-150,dot_size:2,line_weight:.3,show_trails:true,fade_trails:true,trail_lifetime:lifetime},initialization:{warmup_steps:200},timeline:[{type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'track',args:[7]},{method:'gradientStart',args:[{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:30}]}]},{type:'wait',duration:9.75}]};
 await writeFile(directory+'/source.json',JSON.stringify(source,null,2));
 await page.locator('input[type=file]').setInputFiles({name:'attractor-hq.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 await page.waitForFunction(name=>{const a=window.__videoAudit,r=a.requests.at(-1);return r?.name===name&&a.completed.some(o=>o.id===r.id)&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},source.name);
 await page.route('**/api/exports/*/frames?index=*',async route=>{
  const request=route.request(),index=Number(new URL(request.url()).searchParams.get('index')),png=request.postDataBuffer();
  const path=`${directory}/inputs/${String(index).padStart(4,'0')}.png`;await writeFile(path,png);
  report.uploads.push({index,path,pngSha:sha(png),bytes:png.length});if(index%30===0)console.log(JSON.stringify({stage:'upload',index,frames}));await route.continue();
 });
 await page.getByRole('button',{name:'Export artwork',exact:true}).click();await page.getByRole('button',{name:'Animation video',exact:true}).click();
 await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
 for(const [name,value]of [['Export width',width],['Export height',height],['Export frame rate',fps],['Export duration',10]])await page.getByRole('spinbutton',{name,exact:true}).fill(String(value));
 let download,downloadError;page.waitForEvent('download',{timeout:20*60*1000}).then(value=>{download=value;},error=>{downloadError=error;});
 const exportStart=performance.now();await page.getByRole('button',{name:'Start export',exact:true}).click();
 while(!download){
  if(downloadError)throw downloadError;
  const failure=await page.evaluate(()=>window.__videoAudit.errors.at(-1)??document.querySelector('.export-dialog .error-card')?.textContent??document.querySelector('.export-error')?.textContent);
  if(failure)throw Error(String(failure));
  await page.waitForTimeout(1000);
 }
 const videoPath=directory+'/attractor.mp4';await download.saveAs(videoPath);report.exportElapsedMs=performance.now()-exportStart;report.videoPath=videoPath;
 const audit=await page.evaluate(()=>window.__videoAudit);report.requests=audit.requests.filter(r=>r.context.quality==='export');
 // A separate worker owns the export; select outputs using the first export id and source offscreen target.
 report.outputs=audit.completed.filter(o=>o.frame?.viewport?.target==='offscreen');
 check(report.requests.length===frames&&report.outputs.length===frames,'Missing export requests or completed frames');
 const cap=Math.trunc(Math.fround(lifetime*60))+120;
 for(let i=0;i<frames;i++){
  const r=report.requests[i],o=report.outputs[i],c=r.configuration.configuration;
  check(c.particleCountCPU===particles&&c.stepsPerFrame===substeps&&c.warmup.steps===200&&r.configuration.visual.trails.lifetime===lifetime,'Authored quality inputs changed');
  check(r.context.width===width&&r.context.height===height&&Math.abs(r.context.time-i/fps)<1e-8,'Export context changed');
  check(o.type==='geometry'&&o.backend==='cpu'&&o.particles===particles&&o.frame.frameIndex===i,'Backend, particles or source frame changed');
  check(o.records===particles*Math.min((i+1)*substeps,cap),'Source per-particle trail retention changed at '+i);
 }
 check(report.uploads.length===frames&&report.uploads.every((u,i)=>u.index===i),'Upload frame order/count mismatch');
 report.metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration','-of','json',videoPath],{encoding:'utf8'})).streams[0];
 check(report.metadata.width===width&&report.metadata.height===height&&Number(report.metadata.nb_read_frames)===frames&&report.metadata.r_frame_rate==='30/1'&&Math.abs(Number(report.metadata.duration)-10)<.001,'Encoded video metadata mismatch');
 const decoder=spawn('ffmpeg',['-v','error','-i',videoPath,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{stdio:['ignore','pipe','pipe']});let stderr='';decoder.stderr.on('data',b=>{stderr+=b.toString();});
 const closed=new Promise((resolve,reject)=>{decoder.once('error',reject);decoder.once('close',code=>code===0?resolve():reject(Error(stderr)));});
 report.decoded=[];const stride=width*height*3,frame=Buffer.alloc(stride);let at=0,index=0;
 try{for await(const chunk of decoder.stdout){let offset=0;while(offset<chunk.length){const n=Math.min(stride-at,chunk.length-offset);chunk.copy(frame,at,offset,offset+n);at+=n;offset+=n;if(at===stride){
   check(index<frames,'Extra decoded video frame');const input=decodePng(await readFile(report.uploads[index].path));check(input.width===width&&input.height===height,'Input PNG dimensions');
   let total=0,max=0,changed=0;const first=input.rgba.readUInt32BE(0);for(let p=0;p<width*height;p++){if(input.rgba.readUInt32BE(p*4)!==first)changed++;for(let c=0;c<3;c++){const d=Math.abs(frame[p*3+c]-input.rgba[p*4+c]);total+=d;max=Math.max(max,d);}}
   const mean=total/stride;check(changed>100&&mean<6,'Empty frame or excessive H.264 error at '+index+': '+mean);
   report.decoded.push({index,changedPixels:changed,meanAbsoluteRgbError:mean,maxAbsoluteRgbError:max,inputRgbaSha:sha(input.rgba),decodedRgbSha:sha(frame)});index++;at=0;
  }}}await closed;check(index===frames&&at===0,'Truncated decoded video');}catch(error){decoder.kill('SIGTERM');await closed.catch(()=>{});throw error;}
 check(new Set(report.decoded.map(r=>r.inputRgbaSha)).size>=frames*.95,'Video does not evolve');
 report.checkpoints=await page.evaluate(async({request,frames})=>{
  const {Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sourceQueuePresentedScene}=await import('/src/engine/sourceQueuePresentation.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts');
  const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas')),rows=[];renderer.setSize(request.context.width,request.context.height,1);
  try{for(let i=0;i<frames;i++){
   const output=await generator.generate(request.scene,{...request.context,time:i/30});
   if([0,49,149,299].includes(i)){
    const scene=sourceQueuePresentedScene(request.scene,output);renderer.setOutput(output,scene,false,outputCamera(scene,output));
    const blob=await renderer.blob('image/png'),png=new Uint8Array(await blob.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',png);
    rows.push({index:i,pngSha:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),records:output.temporal.recordedPoints,frame:output.sourceCameraFrame.frameIndex});
   }
  }return rows;}finally{generator.dispose();renderer.dispose();}
 },{request:audit.firstExport,frames});
 check(report.checkpoints.every(r=>r.pngSha===report.uploads[r.index].pngSha),'Fresh continuous replay checkpoint differs from exported PNG');
 report.videoSha=sha(await readFile(videoPath));check(!report.errors.length&&!audit.errors.length,'Browser or Worker errors');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;if(page){report.failureAudit=await page.evaluate(()=>window.__videoAudit).catch(()=>null);await writeFile(directory+'/failure-dom.txt',await page.locator('body').innerText().catch(()=>''));}}
finally{
 report.cleanup=(await Promise.allSettled([browser?.close(),vite?.close(),service?.close()])).map(r=>r.status);report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-start;
 if(!report.sourceStable||report.cleanup.includes('rejected')){report.status='failed';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,directory,elapsedMs:report.elapsedMs,uploaded:report.uploads.length,error:report.error}));
}

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
