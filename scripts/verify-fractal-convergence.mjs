import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),browser=await chromium.launch({channel:'chrome',headless:true});let timer;
try{
 const page=await browser.newPage();await page.route('http://127.0.0.1:5177/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:5177/');
 const cdp=await browser.newBrowserCDPSession(),initial=await cdp.send('SystemInfo.getProcessInfo'),wall=performance.now();let peak=0,busy=false;
 timer=setInterval(async()=>{if(busy)return;busy=true;try{const info=await cdp.send('SystemInfo.getProcessInfo'),{stdout}=await run('/bin/ps',['-o','rss=','-p',info.processInfo.map(p=>p.id).join(',')]);peak=Math.max(peak,stdout.trim().split(/\s+/).reduce((sum,n)=>sum+Number(n),0));}catch{}finally{busy=false;}},100);
 const result=await page.evaluate(async()=>{
  const {createScene,parseScene}=await import('/src/engine/document.ts'),{definitions,fractalConfig,fractalOrbit}=await import('/src/scenes/complex.ts'),{Generator}=await import('/src/engine/client.ts');
  const {convergenceTolerance}=await import('/src/engine/fractalConvergence.ts'),{parseFractalColors,shadeFractalOrbit}=await import('/src/engine/fractalColor.ts'),{complexPixel}=await import('/src/engine/complexViewport.ts');
  const assert=(ok,why)=>{if(!ok)throw Error(why);},digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const definition=definitions.find(d=>d.kind==='fractal'),generator=new Generator(),rows=[];const s=createScene(definition);
  Object.assign(s.settings,{convergenceMode:'step',fractalColorVersion:2,renderMethod:'one-pass',fractalBackend:'webgl2',power:3,startReal:1,iterations:80,centerX:0,centerY:0,zoom:1,tolerance:.001});
  try{
   for(const formula of ['newton','nova'])for(const variant of ['mandelbrot','julia'])for(const power of [[3,0],[2.5,.15]]){
    Object.assign(s.settings,{formula,variant,power:power[0],powerImag:power[1]});
    const context={time:0,width:96,height:64,quality:'export'},out=await generator.generate(parseScene(JSON.stringify(s)),context);
    assert(out.backend==='cpu','incorrect backend');assert(out.stats.samples===6144,'incomplete raster');assert(out.warnings.some(w=>w.includes('保留残差')),'missing fallback');
    const c=fractalConfig(s.settings),colors=parseFractalColors(s),view={centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0},oracleConfig={...c,convergenceTolerance:convergenceTolerance(c,1,96,64)};let mismatches=0,converged=0;
    for(let i=0;i<6144;i++){const orbit=fractalOrbit(complexPixel(i%96,Math.floor(i/96),96,64,view),oracleConfig),rgb=shadeFractalOrbit(orbit,c,colors);converged+=orbit.convergence?1:0;if(rgb)for(let k=0;k<3;k++)if(out.pixels[i*4+k]!==Math.round(Math.max(0,Math.min(1,rgb[k]))*255))mismatches++;}
    assert(mismatches===0,'worker/CPU color mismatch');rows.push({formula,variant,power,converged,invalid:out.stats.invalid,mismatches,sha256:await digest(out.pixels),elapsedMs:out.stats.elapsedMs});
   }
   Object.assign(s.settings,{formula:'nova',variant:'mandelbrot',power:3,powerImag:0,zoom:1000,renderMethod:'multi-pass'});const progress=[];
   const deep=await generator.generate(s,{time:0,width:64,height:48,quality:'preview'},o=>progress.push([o.width,o.height]));
   assert(progress.map(v=>v.join('x')).join(',')==='8x6,16x12,32x24','multipass order');assert(deep.backend==='cpu'&&deep.warnings.some(w=>w.includes('DoubleDouble')),'deep precision');
   Object.assign(s.settings,{formula:'newton',variant:'mandelbrot',power:3,powerImag:0,zoom:1,renderMethod:'one-pass'});
   const large=[];let final;for(let i=0;i<2;i++){final=await generator.generate(s,{time:0,width:3840,height:2160,quality:'export'});assert(final.width===3840&&final.height===2160&&final.stats.samples===8294400,'4K incomplete');large.push({elapsedMs:final.stats.elapsedMs,sha256:await digest(final.pixels),generated:final.stats.generated,invalid:final.stats.invalid});}
   assert(large[0].sha256===large[1].sha256,'4K repeat differs');
   const pending=generator.generate({...s,settings:{...s.settings,iterations:4096}},{time:0,width:3840,height:2160,quality:'export'});generator.cancel();let cancelled=false;try{await pending;}catch(e){cancelled=e.name==='AbortError';}assert(cancelled,'cancel failed');
   const recovered=await generator.generate(s,{time:0,width:32,height:24,quality:'export'});assert(recovered.stats.samples===768,'recovery failed');
   const canvas=document.createElement('canvas');canvas.width=final.width;canvas.height=final.height;canvas.getContext('2d').putImageData(new ImageData(final.pixels,final.width,final.height),0,0);
   return{status:'passed',browser:navigator.userAgent,rows,multipass:{dimensions:progress,final:[deep.width,deep.height],warnings:deep.warnings},large,cancelled,recovered:true,image:canvas.toDataURL('image/png')};
  }finally{generator.dispose();}
 });
 clearInterval(timer);const end=await cdp.send('SystemInfo.getProcessInfo');const {image,...report}=result;
 Object.assign(report,{generatedAt:new Date().toISOString(),wallMs:performance.now()-wall,processCpuSeconds:end.processInfo.reduce((n,p)=>n+Math.max(0,p.cpuTime-(initial.processInfo.find(q=>q.id===p.id)?.cpuTime??0)),0),sampledPeakProcessFamilyRSSKiB:peak,limitations:['Original application not executed; no original pixel/clock/precision parity claim.','Step convergence explicitly uses CPU Float64 or integer-power DoubleDouble; this does not establish a new GPU implementation.','First 4K run follows smaller cases in the same worker; it is size-cold, not process-cold. Second run re-evaluates all pixels.','CPU and sampled RSS include this isolated Chrome process family and tests; shared pages may be counted more than once. VRAM, driver allocations and agent tokens unmeasured.','Public Generator cancellation is tested; no native export file picker is exercised.']});
 await writeFile(new URL('../coverage/fractal-convergence-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');await writeFile(new URL('../coverage/fractal-convergence-4k.png',import.meta.url),Buffer.from(image.split(',')[1],'base64'));
 console.log(JSON.stringify({...report,rows:report.rows.map(({formula,variant,power,mismatches,converged})=>({formula,variant,power,mismatches,converged}))}));
}finally{clearInterval(timer);await browser.close();}
