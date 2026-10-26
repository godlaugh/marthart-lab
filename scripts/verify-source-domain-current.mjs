/** Current Domain capture + real PNG worker, checked against independent Python postprocessing. */
import {chromium} from '@playwright/test';
import {sourceNativeVerificationServer} from './lib/source-native-verification-server.mjs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
const directory=process.argv[2]??`.cache/domain-current-${Date.now()}`;await mkdir(directory,{recursive:true});
const check=(v,m)=>{if(!v)throw Error(m);},sha=v=>createHash('sha256').update(v).digest('hex');
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-domain-current.mjs','scripts/source-fractal-paused-image-oracle.py','scripts/source-paused-image-oracle.py','scripts/source-paused-upscale-oracle.py'].sort().map(async p=>[p,sha(await readFile(p))])));}
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
const report={at:new Date().toISOString(),status:'running',scope:'Actual public Generator current numerical capture, formula composition, PNG worker and decoded RGBA. An explicit backend JSON selects native CGL; otherwise WebGL. Independent Python enhancement/OpenJDK bicubic transcript.',limits:['No original GUI/JOGL or JLaTeXMath glyph parity. MathJax glyph generation is shared; placement is independently calculated.','This API verifier does not exercise App live controls or recording; their verification is recorded separately.','PNG cancellation is tested through the actual API; no public download-dialog claim.']};
report.sourceBefore=await hashes();let server,browser,host;const started=performance.now();report.cases=[];
try{
 host=await sourceNativeVerificationServer(directory,process.argv[3]);server=host.server;report.nativeBackend=host.backend;browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const page=await browser.newPage();await page.route('**/domain-current-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain current PNG</title>'}));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/domain-current-verifier`);
 for(const backend of ['cpu','gpu'])for(const [labels,scale]of[[false,1],[true,1],[true,3],[true,5]]){
  const name=`${backend}-${labels?'labels':'hidden'}-${scale}`;
  const result=await page.evaluate(async({backend,labels,scale,name})=>{
   const{sourceDrawingPolicy}=await import('/src/engine/sourceDrawingPixels.ts'),gpuBackend=sourceDrawingPolicy()==='native'?'native':'webgl2';
   const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{defaultFormulas}=await import('/src/engine/formulas.ts'),{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts'),{renderFormulaSvg}=await import('/src/engine/formulaSvg.ts');
   const check=(v,m)=>{if(!v)throw Error(m);},digest=async p=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',p)),b=>b.toString(16).padStart(2,'0')).join('');
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name,domainColoring:{formula:'z'},timeline:[{type:'animate',duration:1,actions:[{method:'domainRotate',args:[1]}]}]})).scene;
   s.parameters={a:.2,b:.3};s.equations.next='w+c';Object.assign(s.settings,{iterationEnabled:true,iterationSteps:1,constantReal:.2,constantImag:.3,domainBackend:backend,domainRenderPolicy:backend==='cpu'?'source-cpu-always-v1':'source-cpu-on-gpu-failure-v1'});s.formulas=defaultFormulas();s.formulas.referenceWidth=162;s.formulas.referenceHeight=122;s.formulas.main={visible:labels,x:9,y:15,scale:1,color:'#ffffff',latex:'z+c'};
   const c={time:999,width:80,height:60,quality:'export',domainTarget:{logicalWidth:40,logicalHeight:30,pixelDensity:2},domainLive:{sessionId:name,revision:0,clock:{paused:false,timestampMs:1000},actualFrameRate:24,viewport:{logicalWidth:40,logicalHeight:30,pixelDensity:2}}};
   const g=new Generator();try{
    await g.generate(s,c);const moving=await g.generate(s,{...c,domainLive:{...c.domainLive,clock:{paused:false,timestampMs:1250}}});check(moving.domainLive.updateOrdinal===1&&moving.domainLive.sceneTime===.25,'fixture did not advance');await g.setDomainPaused(moving,true,1500);
    const draft=structuredClone(s);draft.parameters.a=.7;draft.equations.f='(';draft.formulas.main.latex='staged';await g.updateDomainParameters(moving,draft,[['a',.7]]);
    // Capacity rejection is preflight and must preserve this completed image.
    let rejected;try{await g.captureDomainPaused(moving,{width:16384,height:16384},5);}catch(e){rejected=e;}check(rejected?.previewRetained===true,'preflight did not retain source');
    const result=await g.captureDomainPaused(moving,{width:161,height:121},scale),cap=result.capture,preview=result.preview;
    check(cap.width===162&&cap.height===122&&cap.domainRender.target.logicalWidth===81&&cap.domainRender.target.logicalHeight===61,'wrong density-rounded base');check(cap.domainLive.updateOrdinal===1&&cap.domainLive.sceneTime===.25&&cap.domainLive.renderKind==='snapshot'&&preview.domainLive.updateOrdinal===1,'capture advanced numerical time');check(cap.domainLive.presentation.parameters.a===.7&&cap.domainLive.presentation.equations.f==='z','hot write lost or draft applied');check(cap.formulaPresentation.labels.length===(labels?1:0)&&(!labels||cap.formulaPresentation.labels[0].latex==='z+c'),'captured formula changed');check(cap.backend===(backend==='gpu'?gpuBackend:'cpu'),'requested backend missing');
    check(await digest(preview.pixels)!==await digest(moving.pixels),'undrawn hot edit did not affect capture/preview pixels');const base=cap.pixels.slice(),canvas=document.createElement('canvas');canvas.width=162;canvas.height=122;const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(base,162,122),0,0);
    for(const label of cap.formulaPresentation.labels){const svg=renderFormulaSvg(label.latex,label.color),image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.source);await image.decode();const p=cap.formulaPresentation,k=label.scale*Math.min(162/p.referenceWidth,122/p.referenceHeight),x=label.x*162/p.referenceWidth-(label.anchor==='center'?svg.width*k/2:0),y=label.y*122/p.referenceHeight-(label.anchor==='center'?svg.height*k/2:0);ctx.drawImage(image,x,y,svg.width*k,svg.height*k);}
    const composed=ctx.getImageData(0,0,162,122).data;canvas.width=canvas.height=0;
    if(labels)check(await digest(base)!==await digest(composed),'formula did not affect base');
    const controller=new AbortController(),pending=encodeFormulaRaster(cap,'image/png',{signal:controller.signal});controller.abort();let cancelled;try{await pending;}catch(e){cancelled=e;}check(cancelled?.name==='AbortError','PNG cancellation failed');
    const blob=await encodeFormulaRaster(cap);check(await digest(cap.pixels)===await digest(base),'encoding mutated capture');const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    let stale;try{await g.captureDomainPaused(moving,{width:161,height:121},1);}catch(e){stale=e;}check(stale,'stale source accepted');
    const again=await g.captureDomainPaused(preview,{width:161,height:121},1);check(again.preview.domainLive.updateOrdinal===1&&await digest(again.capture.pixels)===await digest(base),'retry after PNG cancellation changed current state');
    return{width:162,height:122,scale,pixels:Array.from(composed),png:btoa(binary),baseHash:await digest(base),previewHash:await digest(preview.pixels),facts:cap.sourceCurrentImage,clock:{ordinal:cap.domainLive.updateOrdinal,time:cap.domainLive.sceneTime},preflightRetained:true,cancelRetry:true,staleRejected:true};
   }finally{g.dispose();}
  },{backend,labels,scale,name});
  const png=Buffer.from(result.png,'base64');delete result.png;const baseFile=`${directory}/${name}-base.json`,pngFile=`${directory}/${name}.png`,expectedFile=`${directory}/${name}-expected.rgba`,factsFile=`${directory}/${name}-oracle.json`;
  await writeFile(baseFile,JSON.stringify({width:result.width,height:result.height,scale,pixels:result.pixels}));delete result.pixels;await writeFile(pngFile,png);
  execFileSync('python3',['scripts/source-fractal-paused-image-oracle.py','--input-json',baseFile,'--output-rgba',expectedFile,'--output-json',factsFile],{timeout:60000});const decoded=decodePng(png),expected=await readFile(expectedFile);check(decoded.width===162*scale&&decoded.height===122*scale&&decoded.rgba.equals(expected),'full decoded PNG differs from independent composition/enhancement/upscale: '+name);
  report.cases.push({name,...result,pngFile,decodedSize:[decoded.width,decoded.height],rgbaSha256:sha(decoded.rgba),oracle:JSON.parse(await readFile(factsFile,'utf8'))});
 }
 report.queue=await page.evaluate(async()=>{
  const {Generator}=await import('/src/engine/client.ts'),{GenerationQueue}=await import('/src/engine/generationQueue.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'queue capture',domainColoring:{formula:'z'},timeline:[{type:'wait',duration:1}]})).scene;s.settings.domainRenderPolicy='source-cpu-always-v1';
  const c={time:0,width:80,height:60,quality:'export',domainTarget:{logicalWidth:40,logicalHeight:30,pixelDensity:2},domainLive:{sessionId:'queue-current',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:24,viewport:{logicalWidth:40,logicalHeight:30,pixelDensity:2}}};
  const g=new Generator(),outputs=[],errors=[],waiters=[];let busy=false;
  const wake=()=>{for(const resolve of waiters.splice(0))resolve();},q=new GenerationQueue(g,{output:o=>{outputs.push(o);wake();},busy:value=>{busy=value;wake();},error:e=>{errors.push(e.message);wake();}});
  const check=(v,m)=>{if(!v)throw Error(m);};async function until(test){const end=performance.now()+15000;while(!test()){if(errors.length)throw Error(errors.join(';'));if(performance.now()>end)throw Error('queue capture timed out');await new Promise(resolve=>{waiters.push(resolve);setTimeout(resolve,100);});}}
  try{q.request(s,c);await until(()=>outputs.length===1&&!busy);const ordinal=outputs[0].domainLive.updateOrdinal,capture=await q.captureDomainPaused(outputs[0],{width:161,height:121},3);check(capture.sourceCurrentImage.scale===3&&outputs.length===2&&!busy,'queue did not publish restored primary');check(outputs[1].domainLive.updateOrdinal===ordinal,'queue capture advanced time');check(q.navigateDomainPaused(s,'queue-current',{kind:'pan',dx:1,dy:0}),'capture lost navigation capability');await until(()=>outputs.length===3&&!busy);return{capturePublished:true,primaryRestored:true,navigationAfterCapture:true,ordinal};}finally{q.dispose();}
 });
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e.stack??e);}finally{const browserClose=await Promise.allSettled([browser?.close()]),hostClose=await Promise.allSettled([host?.close()]);report.cleanup=[...browserClose,...hostClose];report.remainingProcesses=host?.service?.ownedProcessCount??0;}
report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)report.status='failed';report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error,sourceStable:report.sourceStable}));if(report.status!=='passed')process.exitCode=1;
