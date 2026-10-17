import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['src/engine/domain.ts','src/engine/domainModel.ts','src/engine/complexViewport.ts','src/engine/complexMath.ts','src/engine/domainSourceColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceIteration.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainGpuColor.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpu.ts','src/engine/domainExpressions.ts','src/engine/complexGlsl.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts'];
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={startedAt:new Date().toISOString(),sourceStart:await snapshot(),scope:'Actual local production generateDomain. Missing/explicit local versions compared with frozen1258; all new source-color images compared with the same selected CPU color contract. This is not a native-application execution or performance run.'};
let browser;const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route(origin,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Explicit Domain color versions</title>'}));await page.goto(origin);
 report.result=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{generateDomain}=await import('/src/engine/domain.ts'),{domainGpu}=await import('/src/engine/domainGpu.ts'),{parseDomainModel}=await import('/src/engine/domainModel.ts'),{generateDomain:before}=await import('/.cache/domain-source-color-baseline-1258/src/engine/domain.ts'),{domainGpu:beforeGpu}=await import('/.cache/domain-source-color-baseline-1258/src/engine/domainGpu.ts');
  const rows=[],assert=(v,m)=>{if(!v)throw Error(m);},hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),v=>v.toString(16).padStart(2,'0')).join('');
  const make=()=>{const s=createScene(definition('domain'));s.equations={f:'sin(z-i)/sin(z+i)'};s.parameters={};s.timeline.tracks=[];Object.assign(s.settings,{domainBackend:'cpu',curveMix:.83,curveBias:-.07,paletteOffset:.137});return s;};
  try{
   for(const mode of['linear','sine','hsv','cosine','curve','cyclic-rgb','cyclic-linear','cyclic-oklab','cyclic-oklch'])for(const supersampling of[1,3]){
    const s=make();s.settings.supersampling=supersampling;if(mode.startsWith('cyclic')){s.palette.mode='linear';s.evaluatedDomainGradient={running:true,interpolation:mode.slice(7)};}else s.palette.mode=mode;
    for(const backend of['cpu','gpu']){
     s.settings.domainBackend=backend;const ctx={time:.3,width:59,height:43,quality:'export'},old=before(s,ctx),implicit=generateDomain(s,ctx);s.settings.domainColorVersion='local-v1';s.settings.domainIterationVersion='local-v1';const explicit=generateDomain(s,ctx);
     const oldHash=await hash(old.pixels),implicitHash=await hash(implicit.pixels),explicitHash=await hash(explicit.pixels);
     assert(oldHash===implicitHash&&oldHash===explicitHash,'local1258 hash changed '+mode+'/'+supersampling+'/'+backend);
     rows.push({kind:'local1258',mode,supersampling,requestedBackend:backend,backend:implicit.backend,oldHash,implicitHash,explicitHash});delete s.settings.domainColorVersion;delete s.settings.domainIterationVersion;
    }
   }
   const cases=[];
   for(const version of['mathart-1.7.8-gpu','mathart-1.7.8-cpu'])for(const mode of['PHASE','MODULUS','PHASE_MODULUS','NONE'])for(const count of[0,1,2,17])cases.push({version,mode,count});
   for(const version of['mathart-1.7.8-gpu','mathart-1.7.8-cpu'])for(const interpolation of['rgb','linear','oklab','oklch'])cases.push({version,mode:'PHASE_MODULUS',count:4,interpolation,supersampling:3});
   for(const formula of['0','1/(z-z)','1e14+i','1e8*re(log(exp(.7*i)))+i'])for(const version of['mathart-1.7.8-gpu','mathart-1.7.8-cpu'])cases.push({version,mode:'NONE',count:3,formula});
   for(const c of cases){
    const s=make();Object.assign(s.settings,{domainColorVersion:c.version,curveMode:c.mode,supersampling:c.supersampling??1,curveBias:.13,curveMix:.91});s.domainSourcePalette={colors:Array.from({length:c.count},(_,i)=>'#'+((i*777777+0x1774f3)&0xffffff).toString(16).padStart(6,'0'))};if(c.formula)s.equations.f=c.formula;if(c.interpolation)s.evaluatedDomainGradient={running:true,interpolation:c.interpolation};
    const ctx={time:.3,width:67,height:49,quality:'export'},cpu=generateDomain(s,ctx);s.settings.domainBackend='gpu';const gpu=generateDomain(s,ctx);let max=0,sum=0,changed=0;const histogram=Array(256).fill(0);
    for(let i=0;i<cpu.pixels.length;i++){const d=Math.abs(cpu.pixels[i]-gpu.pixels[i]);histogram[d]++;max=Math.max(max,d);sum+=d;if(d)changed++;}
    let n=0,p99=0;for(let i=0;i<256;i++){n+=histogram[i];if(n>=cpu.pixels.length*.99){p99=i;break;}}
    const row={kind:'source',...c,backend:gpu.backend,cpuHash:await hash(cpu.pixels),gpuHash:await hash(gpu.pixels),maxByte:max,p99,mean:sum/cpu.pixels.length,changedChannels:changed,cpuStats:cpu.stats,gpuStats:gpu.stats,warnings:gpu.warnings};rows.push(row);
    console.log(JSON.stringify({case:c,backend:gpu.backend,maxByte:max}));assert(max<=2,'source image difference '+JSON.stringify(row));assert(cpu.stats.samples===gpu.stats.samples&&cpu.stats.invalid===gpu.stats.invalid,'source stats');
    if(!c.formula&&c.version==='mathart-1.7.8-gpu')assert(gpu.backend==='webgl2','source GPU mode silently CPU');
    if(c.version==='mathart-1.7.8-cpu'&&c.interpolation)assert(gpu.backend==='cpu'&&gpu.warnings.some(x=>x.includes('整数插值')),'source CPU running capability not explicit');
   }
   for(const [enabled,steps,maxSteps,effective]of[[false,999,999,1],[true,65,64,64],[true,65,100,65],[true,999,999,256]]){
    const s=make();s.equations={f:'z+1',next:'w+1'};Object.assign(s.settings,{domainColorVersion:'mathart-1.7.8-gpu',domainIterationVersion:'mathart-1.7.8',iterationEnabled:enabled,iterationSteps:steps,iterationMaxSteps:maxSteps,seedMode:'ZERO',domainBackend:'gpu'});const model=parseDomainModel(s,0),out=generateDomain(s,{time:0,width:7,height:5,quality:'export'});assert(model.steps===effective,'effective steps');assert(out.stats.samples===35,'iteration complete size');rows.push({kind:'source-iteration',enabled,steps,maxSteps,effective,backend:out.backend,warnings:out.warnings});
   }
   return{rows};
  }catch(error){return{rows,error:String(error.stack??error)};}finally{domainGpu.dispose();beforeGpu.dispose();}
 });
 report.browser=browser.version();if(report.result.error)report.error=report.result.error;
}catch(error){report.error=String(error.stack??error);}finally{await browser?.close();await server.close();}
report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.status=!report.error&&report.sourceStable?'passed':'failed';report.finishedAt=new Date().toISOString();
await writeFile(process.env.DOMAIN_SOURCE_REPORT??'.cache/domain-source-production.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,rows:report.result?.rows?.length,error:report.error}));if(report.status!=='passed')process.exitCode=1;
