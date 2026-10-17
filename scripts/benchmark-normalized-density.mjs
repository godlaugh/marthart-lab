import {chromium} from '../node_modules/playwright/index.mjs';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const stage='normalized-v2',exec=promisify(execFile),report={stage,startedAt:new Date().toISOString(),rows:[],measurements:{rss:'100ms sampled sum of ps RSS for CDP process family; shared pages may be duplicated, includes browser baseline',cpu:'CDP process CPU delta; exited processes may be omitted',scope:'Full5M particles/20burn,3840x2160 actual Generator, Map and Symmetry normalized-v2; stored1920x1080 reference, time0 then1/60 thenrepeat',vram:'unmeasured',agentTokens:'unmeasured'}};
report.sourceSha256={};for(const name of ['engine/iteratedDensityGpu.ts','engine/densityGpuTone.ts','engine/density.ts','scenes/iteratedDensity.ts','engine/densityNormalization.ts'])report.sourceSha256[name]=createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});let poll;
try{
 const cdp=await browser.newBrowserCDPSession(),page=await browser.newPage();
 async function measure(){const list=(await cdp.send('SystemInfo.getProcessInfo')).processInfo;let rss=0;try{const p=await exec('/bin/ps',['-o','rss=','-p',list.map(p=>p.id).join(',')]);rss=p.stdout.trim().split(/\s+/).reduce((n,s)=>n+Number(s),0);}catch{}return{cpu:list.reduce((n,p)=>n+p.cpuTime,0),rss};}
 await page.route('http://127.0.0.1:5177/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:5177/');
 await page.evaluate(async()=>{const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{Generator}=await import('/src/engine/client.ts'),{initializeNormalizedDensity}=await import('/src/engine/densityNormalization.ts');globalThis.bench={createScene,definition,Generator,initializeNormalizedDensity};});
 for(const kind of ['map','symmetry']){
  report.inputs??={};report.inputs[kind]=await page.evaluate(kind=>{const b=globalThis.bench;b.g?.dispose();b.g=new b.Generator();b.scene=b.createScene(b.definition(kind));Object.assign(b.scene.settings,{iteratedMode:'continuous',iteratedBackend:'gpu',batchSize:5000000,burnIn:20,iteratedFps:60,iterationsPerFrame:1,paletteMode:'source',transparentBackground:true});b.scene.settings=b.initializeNormalizedDensity(kind,b.scene.settings,1920,1080);return{equations:b.scene.equations,parameters:b.scene.parameters,settings:b.scene.settings,palette:b.scene.palette};},kind);
  for(const [mode,time]of [['cold',0],['warm',1/60],['repeat',1/60]]){
   const before=await measure();let peak=before.rss,samples=0,busy=false;
   poll=setInterval(async()=>{if(busy)return;busy=true;try{const m=await measure();peak=Math.max(peak,m.rss);samples++;}finally{busy=false;}},100);
   const row=await page.evaluate(async({mode,time})=>{const b=globalThis.bench,start=performance.now(),out=await b.g.generate(b.scene,{time,width:3840,height:2160,quality:'export'}),wallMs=performance.now()-start;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',out.pixels))).map(v=>v.toString(16).padStart(2,'0')).join('');if(out.backend!=='webgl2'||out.width!==3840||out.height!==2160)throw Error('Backend/dimensions lost');return{mode,time,wallMs,engineMs:out.stats.elapsedMs,backend:out.backend,density:out.density,stats:out.stats,warnings:out.warnings,sha256:hash,bytes:out.pixels.byteLength};},{mode,time});
   clearInterval(poll);const after=await measure();row.kind=kind;row.processCpuSeconds=after.cpu-before.cpu;row.sampledPeakProcessFamilyRSSKiB=Math.max(peak,after.rss);row.rssSamples=samples;report.rows.push(row);console.log(JSON.stringify(row));
  }
 }
 await page.evaluate(()=>globalThis.bench.g.dispose());report.finishedAt=new Date().toISOString();report.status='passed';await mkdir(new URL('../coverage/',import.meta.url),{recursive:true});await writeFile(new URL('../coverage/normalized-density-performance.json',import.meta.url),JSON.stringify(report,null,2));
}finally{clearInterval(poll);await browser.close();}
