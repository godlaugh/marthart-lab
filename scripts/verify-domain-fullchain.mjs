import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainGradient.ts','src/engine/palette.ts','src/engine/colorInterpolation.ts','src/engine/complexGlsl.ts','src/engine/complexViewport.ts'];
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={startedAt:new Date().toISOString(),sourceStart:await snapshot(),cases:[],limits:['Current local color contract, not native pixel parity. CPU comparisons cover every pixel of each reported image.','GPU float32 coordinate, complex and color guards are numerical estimates, not formal global error bounds.','Small correctness matrix; elapsed values are observations, not a throughput benchmark.']};
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});let browser;
try{await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.route(origin,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain GPU full chain verification</title>'}));await page.goto(origin);
 report.cases=await page.evaluate(async()=>{
  const {createScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts'),{generateDomain}=await import('/src/engine/domain.ts'),{domainGpu,domainGpuSource}=await import('/src/engine/domainGpu.ts'),{generateDomain:before}=await import('/.cache/domain-fullchain-before/src/engine/domain.ts'),{domainGpu:beforeGpu,domainGpuSource:oldSource}=await import('/.cache/domain-fullchain-before/src/engine/domainGpu.ts'),{complexFunctionNames}=await import('/src/engine/complexMath.ts'),{parseDomainModel}=await import('/src/engine/domainModel.ts');
  const hash=async p=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',p)),b=>b.toString(16).padStart(2,'0')).join(''),assert=(v,m)=>{if(!v)throw Error(m);};
  const base=createScene(definition('domain'));base.equations={f:'sin(z-i)/sin(z+i)'};base.parameters={};base.timeline.tracks=[];Object.assign(base.settings,{domainBackend:'cpu',centerX:.13,centerY:-.17,rotation:.3,scale:.8,complexGrid:true});
  const currentTf=domainGpuSource(parseDomainModel(base,.7)).source,oldTf=oldSource(parseDomainModel(base,.7)).source;assert(currentTf.slice(currentTf.indexOf('vec2 evaluateF'))===oldTf.slice(oldTf.indexOf('vec2 evaluateF')),'legacy orbit structure changed');
  const rows=[],cases=[];for(const mode of['linear','sine','cosine','curve','hsv'])for(const ss of[1,2,3])cases.push({name:mode+'-SS'+ss,palette:{...base.palette,mode},settings:{supersampling:ss}});
  cases.push({name:'HSV-stops',palette:{...base.palette,mode:'linear',interpolation:'hsv',positions:[0,.13,.61,1],stops:['#e02991','#0afee1','#ffb010','#2433f0']}});
  for(const interpolation of['rgb','linear','oklab','oklch'])cases.push({name:'cyclic-'+interpolation,runtime:{running:true,interpolation},palette:{name:'cyclic',mode:'linear',stops:['#e02991','#0afee1','#ffb010'],cycles:2,offset:.13}});
  cases.push({name:'tile-edge-portrait',width:257,height:259,settings:{supersampling:1},formula:'z'}, {name:'tile-edge-wide',width:513,height:131,settings:{supersampling:2},formula:'sqrt(z)'}, {name:'invalid-pole',formula:'1/(z-z)'},{name:'pure-identity',formula:'z',settings:{curveMode:'NONE',complexGrid:false}},{name:'zero',formula:'0',settings:{curveMode:'NONE'}},{name:'large-phase-fallback',palette:{...base.palette,offset:1e10},expectCpu:true});
  for(const name of complexFunctionNames)cases.push({name:'function-'+name,formula:name==='pow'?'pow(z+.2+.3i,2+i)':name+'(z+.2+.3i)',allowAllRepair:true});
  for(const seedMode of['PIXEL_Z','ZERO','CONSTANT_C'])for(const next of[undefined,'w+c+z','w'])cases.push({name:'one-step-'+seedMode+'-'+(next??'implicit'),formula:'z^2+c',next,settings:{iterationEnabled:true,iterationSteps:1,seedMode,constantReal:.3,constantImag:-.2},allowAllRepair:true});
  cases.push({name:'multi-step-visible-fallback',formula:'sin(z)',settings:{iterationEnabled:true,iterationSteps:4},expectCpu:true},{name:'float64-constant-fallback',formula:'1e100*(z-.1)',expectCpu:true});
  for(const c of [
   {name:'component-square-real',formula:'100000000*re(z*z)',centerX:1,centerY:1+1e-8,paletteOffset:.123},
   {name:'component-square-plus-i',formula:'100000000*re(z*z)+i',centerX:1,centerY:1+1e-8},
   {name:'component-square-exact',formula:'100000000*re(z*z)+i',centerX:1,centerY:1},
   {name:'component-subtract-real',formula:'100000000*re(z-1)+i',centerX:1+1e-8,centerY:1},
   {name:'component-add-imag',formula:'100000000*im(z-i)+1',centerX:1,centerY:1+1e-8},
   {name:'component-divide-real',formula:'100000000*re(z/(1+i))+i',centerX:1,centerY:-1+1e-8},
   {name:'component-divide-imag',formula:'100000000*im(z/(1+i))+1',centerX:1,centerY:1+1e-8},
  ])cases.push({name:c.name,formula:c.formula,width:17,height:17,allowAllRepair:true,settings:{centerX:c.centerX,centerY:c.centerY,rotation:0,scale:1,curveMode:'NONE',curveMix:0,curveBias:0,complexGrid:false,paletteOffset:c.paletteOffset??0}});
  for(const [name,formula,parameters]of[
   ['log-unit-constant','1e8*re(log(exp(.7*i)))+i',{}],
   ['log-unit-uniform','1e8*re(log(exp(phase*i)))+i',{phase:.7}],
   ['nearzero-cos','1e8*cos(angle)+i',{angle:Math.PI/2+1e-8}],
   ['nearzero-exp','1e8*re(exp(i*angle))+i',{angle:Math.PI/2+1e-8}],
   ['nearzero-cosh','1e8*re(cosh(i*angle))+i',{angle:Math.PI/2+1e-8}],
   ['nearzero-sin','1e8*sin(angle)+i',{angle:Math.PI+1e-8}],
  ])cases.push({name,formula,parameters,width:17,height:17,allowAllRepair:true,settings:{curveMode:'NONE',curveMix:0,curveBias:0,complexGrid:false}});
  for(const c of cases){const scene=structuredClone(base);if(c.palette)scene.palette=c.palette;if(c.runtime)scene.evaluatedDomainGradient=c.runtime;if(c.formula)scene.equations.f=c.formula;if(c.parameters)scene.parameters=c.parameters;if(c.next)scene.equations.next=c.next;Object.assign(scene.settings,c.settings);const ctx={time:.7,width:c.width??83,height:c.height??61,quality:'export'},cpu=generateDomain(scene,ctx),old=before(scene,ctx);assert(await hash(cpu.pixels)===await hash(old.pixels),c.name+' CPU changed');scene.settings.domainBackend='gpu';const gpu=generateDomain(scene,ctx),diag=domainGpu.diagnostics();let max=0,different=0,total=0;const hist=new Array(256).fill(0);for(let i=0;i<cpu.pixels.length;i++){const d=Math.abs(cpu.pixels[i]-gpu.pixels[i]);hist[d]++;max=Math.max(max,d);if(d)different++;total+=d;}let at=0,p99=0;for(let i=0;i<256;i++){at+=hist[i];if(at>=cpu.pixels.length*.99){p99=i;break;}}
   const row={name:c.name,width:ctx.width,height:ctx.height,backend:gpu.backend,cpuHash:await hash(cpu.pixels),gpuHash:await hash(gpu.pixels),maxByte:max,p99,differentChannels:different,mean:total/cpu.pixels.length,cpuStats:cpu.stats,gpuStats:gpu.stats,warnings:gpu.warnings,diagnostics:diag};rows.push(row);console.log(JSON.stringify({case:c.name,backend:gpu.backend,max,p99,repaired:diag.lastRaster?.repaired}));assert(gpu.width===ctx.width&&gpu.height===ctx.height,'size');assert(cpu.stats.samples===gpu.stats.samples&&cpu.stats.invalid===gpu.stats.invalid,'stats');if(c.expectCpu)assert(gpu.backend==='cpu',c.name+' expected visible fallback');else if(!c.allowAllRepair&&c.name!=='zero'&&c.name!=='invalid-pole')assert(gpu.backend==='webgl2',c.name+' unexpected CPU '+gpu.warnings?.join());assert(max<=2,c.name+' image difference '+max);
  }
  domainGpu.dispose();beforeGpu.dispose();return rows;
 });report.browser=browser.version();
}catch(error){report.error=String(error.stack??error);}finally{await browser?.close();await server.close();}
report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.status=!report.error&&report.sourceStable?'passed':'failed';report.finishedAt=new Date().toISOString();const output=process.env.DOMAIN_REPORT??'.cache/domain-fullchain-browser.json';await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error}));if(report.status!=='passed')process.exitCode=1;
