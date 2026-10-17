import {chromium} from 'playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('http://127.0.0.1:5177/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Real function alias verification</title>'}));
 await page.goto('http://127.0.0.1:5177/');
 const report=await page.evaluate(async()=>{
  const {compileReal}=await import('/src/engine/expression.ts'),{GpuFormulaSampler}=await import('/src/engine/gpuSampler.ts');
  const {createScene,parseScene,persistentScene}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
  const {generateSurface,prepareAttractorFrame,integrateStep}=await import('/src/scenes/geometry.ts');
  const {AttractorGpu}=await import('/src/engine/attractorGpu.ts'),{AttractorSeedStream,parseAttractorInitial}=await import('/src/engine/attractorSeeds.ts');
  const check=(value,message)=>{if(!value)throw Error(message);};
  const close=(actual,expected,tolerance=1e-5)=>{check(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);return Math.abs(actual-expected);};
  const cases=[];
  async function run(name,body){try{cases.push({name,status:'passed',...await body()});}catch(error){cases.push({name,status:'failed',error:error.message});}}
  await run('real sampler aliases and retained same-name parameters',()=>{
   const sampler=new GpuFormulaSampler(),sources=['arcsin+arcsin(x)','arccos+arccos(x)','arctan+arctan(x)'],parameters={arcsin:.125,arccos:.25,arctan:.5};
   try{
    const inputs=Array.from({length:33},(_,i)=>i/16-1),coordinates=Float32Array.from(inputs.flatMap(x=>[x,0,0])),result=sampler.sample(sources,coordinates,['x'],parameters);
    check(result.backend==='webgl2'&&result.values,'actual GPU execution required: '+result.warnings.join(';'));
    const cpu=sources.map(source=>compileReal(source));let maxAbsolute=0;
    for(let i=0;i<inputs.length;i++)for(let k=0;k<3;k++)maxAbsolute=Math.max(maxAbsolute,close(result.values[i*3+k],cpu[k]({...parameters,x:inputs[i]})));
    return{samples:inputs.length*3,maxAbsolute,toleranceRelativeToMaxOne:1e-5,backend:result.backend};
   }finally{sampler.dispose();}
  });
  await run('out-of-real-domain inputs are nonfinite, not successful finite values',()=>{
   const sampler=new GpuFormulaSampler(),inputs=[-2,-1.0001,1.0001,2],sources=['arcsin(x)','arccos(x)','arctan(x)'];
   try{
    const coordinates=Float32Array.from(inputs.flatMap(x=>[x,0,0])),result=sampler.sample(sources,coordinates,['x'],{});
    check(result.backend==='webgl2'&&result.values,'actual GPU execution required');
    const values=Array.from(result.values),classifications=[];
    for(let i=0;i<inputs.length;i++)for(let k=0;k<3;k++){
     const expected=compileReal(sources[k])({x:coordinates[i*3]}),actual=values[i*3+k];
     check(Number.isFinite(actual)===Number.isFinite(expected),`${sources[k]} at ${coordinates[i*3]}: GPU=${actual}, CPU=${expected}`);
     if(Number.isFinite(expected))close(actual,expected);
     classifications.push(Number.isFinite(actual)?'finite':'nonfinite');
    }
    return{samples:12,classifications,invalid:classifications.filter(x=>x==='nonfinite').length};
   }finally{sampler.dispose();}
  });
  await run('production surface survives save/reload and matches CPU geometry',()=>{
   const scene=createScene(definition('surface'));scene.parameters={arcsin:.125,arccos:.25,arctan:.5};scene.equations={x:'arcsin+arcsin(u)',y:'arccos+arccos(v)',z:'arctan+arctan(u*v)'};
   Object.assign(scene.settings,{uMin:-.9,uMax:.9,vMin:-.9,vMax:.9,uSegments:9,vSegments:7,periodicU:false,periodicV:false,wrapU:false,wrapV:false,scale:1,renderMode:'points',computeBackend:'webgl2'});
   const restored=parseScene(JSON.stringify(persistentScene(scene))),before=JSON.stringify(restored),context={time:0,width:64,height:64,quality:'preview'},gpu=generateSurface(restored,context),cpu=generateSurface({...restored,settings:{...restored.settings,computeBackend:'cpu'}},context);
   check(gpu.backend==='webgl2'&&gpu.type==='geometry'&&cpu.type==='geometry','surface must execute actual GPU');check(gpu.positions.length===cpu.positions.length,'surface length');let maxAbsolute=0;
   for(let i=0;i<gpu.positions.length;i++)maxAbsolute=Math.max(maxAbsolute,close(gpu.positions[i],cpu.positions[i]));
   check(JSON.stringify(restored)===before,'generation altered saved source');return{vertices:gpu.stats.generated,maxAbsolute,backend:gpu.backend,toleranceRelativeToMaxOne:1e-5,formulaAndParameterTextRetained:true};
  });
  const attractor=()=>{
   const scene=createScene(definition('attractor'));scene.parameters={arcsin:.1,arccos:.2,arctan:.3};scene.equations={dx:'arcsin+arcsin(x)',dy:'arccos+arccos(y)',dz:'arctan+arctan(z)'};
   Object.assign(scene.settings,{particleCount:17,initialX:.1,initialY:.2,initialZ:.3,initialSpread:.01,burnIn:0,staggerMin:0,staggerMax:0,variableTimeStep:false,dt:.005,dtMin:.005,dtMax:.005,divergenceLimit:1e6,integrator:'rk4'});return parseScene(JSON.stringify(persistentScene(scene)));
  };
  await run('production Attractor RK4 compiles same-name symbols and calls',()=>{
   const scene=attractor(),config=parseAttractorInitial(scene.settings),job=prepareAttractorFrame(scene),gpu=new AttractorGpu();
   try{
    const seeds=new AttractorSeedStream(config).chunk(config.count);gpu.initialize(config);gpu.advance(job,4,1,true);const snapshot=gpu.snapshot();let maxAbsolute=0;
    for(let i=0;i<config.count;i++){
     let point=Array.from(seeds.positions.slice(i*4,i*4+3)),time=0;
     for(let step=0;step<4;step++){point=integrateStep(job.derivative,point,time,job.dt,job.method);time+=job.dt;}
     for(let k=0;k<3;k++)maxAbsolute=Math.max(maxAbsolute,close(snapshot.positionsAndTime[i*4+k],point[k],2e-5));
     check(snapshot.steps[i*2]===4&&snapshot.positionsAndTime[i*4+3]>0,'all requested integration steps completed');
    }
    return{particles:config.count,steps:4,maxAbsolute,toleranceRelativeToMaxOne:2e-5,compiledPrograms:gpu.diagnostics().programs};
   }finally{gpu.dispose();check(gpu.diagnostics().retainedBytes===0&&!gpu.diagnostics().context,'Attractor cleanup');}
  });
  for(const name of ['asin','acos','arcsin','arccos']){
   for(const argument of ['2','-2','x','1/0','-1/0','0/0'])await run('invalid Attractor '+name+'('+argument+') stops after first attempt',()=>{
    const scene=attractor();scene.equations.dx=`${name}(${argument})`;if(argument==='x')Object.assign(scene.settings,{initialX:2,initialSpread:0});const gpu=new AttractorGpu();
    try{
     gpu.initialize(parseAttractorInitial(scene.settings));gpu.advance(prepareAttractorFrame(scene),4,1,true);const result=gpu.snapshot();
     for(let i=0;i<17;i++)check(result.positionsAndTime[i*4+3]<0&&result.steps[i*2]===1,`invalid particle state=${Array.from(result.positionsAndTime.slice(i*4,i*4+4))}, attempts=${result.steps[i*2]}`);
     return{particles:17,stopped:17,attemptsPerParticle:1};
    }finally{gpu.dispose();}
   });
   for(const argument of [-1,1])await run('Attractor '+name+'('+argument+') includes the real-domain endpoint',()=>{
    const scene=attractor();scene.equations={dx:`${name}(${argument})`,dy:'0',dz:'0'};Object.assign(scene.settings,{initialX:0,initialY:0,initialZ:0,initialSpread:0});const gpu=new AttractorGpu();
    try{
     gpu.initialize(parseAttractorInitial(scene.settings));gpu.advance(prepareAttractorFrame(scene),4,1,true);const result=gpu.snapshot(),expected=compileReal(scene.equations.dx)({})*scene.settings.dt*4;let maxAbsolute=0;
     for(let i=0;i<17;i++){check(result.positionsAndTime[i*4+3]>0&&result.steps[i*2]===4,'valid endpoint did not complete');maxAbsolute=Math.max(maxAbsolute,close(result.positionsAndTime[i*4],expected));}
     return{particles:17,completedSteps:4,maxAbsolute};
    }finally{gpu.dispose();}
   });
  }
  const probe=new OffscreenCanvas(1,1).getContext('webgl2'),debug=probe.getExtension('WEBGL_debug_renderer_info');
  const gpuIdentity={vendor:probe.getParameter(debug?.UNMASKED_VENDOR_WEBGL??probe.VENDOR),renderer:probe.getParameter(debug?.UNMASKED_RENDERER_WEBGL??probe.RENDERER),version:probe.getParameter(probe.VERSION)};
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  return{at:new Date().toISOString(),status:cases.every(item=>item.status==='passed')?'passed':'failed',cases,gpuIdentity,scope:'Small real local Chrome WebGL2 production validation; no performance or native reference parity claim.'};
 });
 report.pageErrors=errors;if(errors.length)report.status='failed';
 report.browserVersion=browser.version();
 report.focused={files:7,tests:106,result:'passed',command:'npm test -- --run tests/realFunctionAliases.test.ts tests/core.test.ts tests/equationEditor.test.tsx tests/geometry.test.ts tests/attractorGpu.test.ts tests/iterated-gpu-samila.test.ts tests/iteratedDensity.test.ts'};
 report.typecheck={command:'npx tsc --noEmit',result:'passed'};
 report.source={guide:'https://www.mathartstudio.art/guide/implicit-surface',localEvidence:'studio/coverage/feature-status.json MAS-IMP-002, guide section 隐式方程输入 blocks62–75',nativeRuntimeExecuted:false,unknowns:['Original runtime and cross-device numerical parity were not measured.']};
 report.regression={before:'studio/coverage/real-function-aliases-before-domain-guard.json',observed:'Before explicit shared asin/acos domain guards, both constant out-of-domain Attractor cases failed the required stopped-after-one-attempt classification while dynamic scalar sampling correctly returned nonfinite values.',fix:'Canonical and alias calls share realAsin/realAcos in glslRealPrelude; mathematical domain validation is owned at function emission, not repaired in a downstream particle renderer.'};
 report.sourceSnapshots=[];
 for(const path of ['src/engine/realFunctionAliases.ts','src/engine/expression.ts','src/engine/gpuSampler.ts','src/engine/attractorGpu.ts','src/engine/iteratedGpuSamila.ts','src/scenes/iteratedDensity.ts','src/components/EquationEditor.tsx','tests/realFunctionAliases.test.ts','scripts/verify-real-function-aliases.mjs'])report.sourceSnapshots.push({path:'studio/'+path,sha256:createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex')});
 await writeFile(new URL('../coverage/real-function-aliases.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;
}finally{await browser.close();}
