import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registryOracleScope} from './domain-parameter-registry-oracle.mjs';

const output=process.env.DOMAIN_REGISTRY_REPORT??'.cache/domain-parameter-registry-browser-attempt1.json';
export const paths=['scripts/verify-domain-parameter-registry.mjs','scripts/domain-parameter-registry-oracle.mjs',
 'src/types.ts','src/engine/document.ts','src/engine/legacyImport.ts','src/engine/domainSourceScalar.ts','src/engine/domainParameterTimeline.ts','src/engine/domainParameterBinding.ts','src/engine/domainLevelCurve.ts','src/engine/oscillation.ts','src/engine/timeline.ts',
 'src/engine/client.ts','src/engine/generate.worker.ts','src/engine/generationProtocol.ts','src/engine/temporal.ts','src/scenes/complex.ts','src/scenes/domainExamples.generated.ts','src/scenes/domainExamples.recipes.json',
 'src/engine/domain.ts','src/engine/domainModel.ts','src/engine/domainExpressions.ts','src/engine/domainNativeArithmetic.ts','src/engine/domainNativeParser.ts','src/engine/domainNativeConstants.ts','src/engine/domainNativeParameters.ts','src/engine/domainSourceIteration.ts','src/engine/domainViewport.ts',
 'src/engine/domainGpu.ts','src/engine/domainGpuRaster.ts','src/engine/domainGpuColor.ts','src/engine/domainSourceColor.ts','src/engine/domainSourcePalette.ts','src/engine/domainSourceGpuColor.ts','src/engine/domainGradient.ts','src/engine/gradientOffsets.ts'];
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={startedAt:new Date().toISOString(),sourceStart:await snapshot(),oracle:registryOracleScope,limits:[
 'Actual production Generator workers produce complete 47x31 rasters. Independent source-derived scalar registry values are compared to evaluated scene facts and to whole worker images with independently fixed inputs.',
 'Neutral/default-edge and linear-ramp fixture scope. Independent scalar lifecycle is separate from the same-backend production renderer used for the image-consumption check; no independent complex/palette oracle is claimed in this batch.',
 'CPU and WebGL2 are actual output backend labels; requested GPU must complete WebGL2. No comparison between differing GPU and CPU arithmetic is required.',
 'Save/reload/backseek are tested on this device. No original JVM/application execution, cross-driver claim, or performance speedup claim.',
]};
let browser;const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Domain registry worker verification</title>'}));await page.goto(origin);
 report.result=await page.evaluate(async()=>{
  const{Generator}=await import('/src/engine/client.ts'),{createScene,parseScene,persistentScene,saveWorkspace,loadWorkspace}=await import('/src/engine/document.ts');
  const{definition}=await import('/src/scenes/index.ts'),{sceneAtTime,domainParameterFrame,readDomainParameterScalar}=await import('/src/engine/timeline.ts');
  const{parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const{registryFixtures,registryTracks,registryReference}=await import('/scripts/domain-parameter-registry-oracle.mjs');
  const check=(ok,message)=>{if(!ok)throw Error(message);},close=(a,b)=>a===b||typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=2e-12*Math.max(1,Math.abs(a),Math.abs(b));
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const base=()=>{const s=createScene(definition('domain'));s.name='Registry actual worker';s.equations={f:'z+a+i*b',next:''};s.parameters={a:.125,b:.25};Object.assign(s.settings,{domainBackend:'cpu',domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',iterationEnabled:false,iterationSteps:1,iterationMaxSteps:64,constantReal:1,constantImag:0,scale:2.5,centerX:.1,centerY:.2,rotation:.23,phaseDensity:12,modDensity:8,phaseSharpness:1,modSharpness:1,curveMode:'PHASE_MODULUS',curveBias:.15,curveMix:1,supersampling:1});s.domainSourcePalette={colors:['#ff0000','#ffff00','#00ffff','#0000ff','#ff00ff','#ff0000']};s.timeline.duration=3;s.timeline.tracks=[];return s;};
  const compareFrame=(actual,expected,label)=>{
   if(!actual&&expected.entries.length===0&&!expected.running)return;
   check(actual&&actual.running===expected.running,label+' running flag');check(actual.entries.length===expected.entries.length,label+' registry count');
   for(let i=0;i<expected.entries.length;i++){
    const a=actual.entries[i],e=expected.entries[i];check(a.name===e.name,label+' exact name/order');
    for(const key of ['phase','gain','value','minimum','maximum','step'])check(close(a[key],e[key]),`${label} ${JSON.stringify(e.name)} ${key}: ${a[key]} != ${e[key]}`);
    check(a.written===e.written,label+' setter timing');
   }
  };
  const rows=[],imports=[],diagnostics=[];let requestCount=0,workerGenerations=0;
  const scenarios=registryFixtures.map(fixture=>{const s=base();s.parameters={...s.parameters,...fixture.parameters};Object.assign(s.settings,fixture.settings);s.timeline.tracks=registryTracks(fixture);return{fixture,scene:s};});
  const examples=definition('domain').presets.filter(p=>p.id.startsWith('guide-domain-'));check(examples.length===8,'Official example count');
  for(const preset of examples){
   const scene=createScene(definition('domain'),preset),number=Number(preset.id.slice('guide-domain-'.length));
   const ops=number===3?[{method:'paramStart',name:'t',min:2,max:-2,step:.02,edge:'source-default'}]:number===4?[{method:'paramStart',name:'a',min:1,max:3,step:.02,edge:'source-default'}]:[];
   const fixture={id:'current-'+preset.id,groups:ops.length?[{at:0,duration:0,operations:ops}]:[],times:[0,2]};
   if(ops.length)check(scene.timeline.tracks[0].actions[0].domainParameters[0].model==='domain-registry-1.7.8','Guide not regenerated to registry');
   scenarios.push({fixture,scene});
  }
  // Public source entry, distinct All/zero-op/default/disabled/name semantics.
  const neutral={window:.5,floor:1,easing:'LINEAR'},nativeBase={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Imported registry',settings:{render_mode:'GPU',param_edge_easing:neutral},parameters:{a:.125,b:.25},domainColoring:{formula:'z+a+i*b'},viewport:{centerX:.1,centerY:.2,scale:2.5}};
  const startNative={method:'paramStart',args:[{parameters:{a:{min:-1,max:1,step:.1}}}]};
  const cases=[
   {id:'default-range',raw:{method:'paramStart',args:[{parameters:{a:{}}}]},operations:[{method:'paramStart',name:'a',min:-1,max:1,step:Math.fround(.1)}]},
   ...[undefined,null,[],{},[{parameters:{}}]].map((args,i)=>({id:'all-'+i,raw:{method:'paramStart',...(args===undefined?{}:{args})},operations:[{method:'paramStart'}]})),
   {id:'zero-op-not-all',raw:{method:'paramStop',args:[{parameters:{a:{enable:false},b:{enable:'FALSE'},ignored:5}}]},operations:[]},
   {id:'action-enabled-ignored',raw:{method:'paramStart',enabled:false,args:[{parameters:{a:{min:-2,max:2,step:.02}}}]},operations:[{method:'paramStart',name:'a',min:-2,max:2,step:.02}]},
   {id:'stop-ignores-range-and-edge',raw:{method:'paramStop',args:[{parameters:{a:{min:'Infinity',max:[],step:{},edgeEasing:null}}}]},operations:[{method:'paramStop',name:'a'}]},
  ];
  for(const c of cases){
   const raw={...nativeBase,timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[startNative]},{type:'wait',duration:.5},{type:'animate',duration:0,easing:'LINEAR',actions:[c.raw]},{type:'wait',duration:1}]};
   const parsed=parseProjectFile(JSON.stringify(raw)),scene=parsed.scene,fixture={id:'import-'+c.id,groups:[{at:0,duration:0,operations:[{method:'paramStart',name:'a',min:-1,max:1,step:.1}]},{at:.5,duration:0,operations:c.operations}],times:[0,.5,.75,1]};
   const operations=scene.timeline.tracks[2].actions[0].domainParameters;
   check(operations.length===c.operations.length,'Import All vs empty distinction '+c.id);
   if(c.id==='default-range')check(operations[0].configuration.min===-1&&operations[0].configuration.max===1&&operations[0].configuration.step===Math.fround(.1),'Source range defaults');
   check(JSON.stringify(scene.provenance.original)===JSON.stringify(raw),'Raw source input lost '+c.id);
   imports.push({id:c.id,raw,operations,warnings:parsed.warnings});scenarios.push({fixture,scene});
  }
  for(const invalid of [null,[],1,true,'bad']){
   let message;try{parseProjectFile(JSON.stringify({...nativeBase,timeline:[{type:'animate',actions:[{method:'paramStart',args:[{parameters:invalid}]}]}]}));}catch(e){message=String(e);}
   check(message,'Malformed present parameter container silently became All');diagnostics.push({parameters:invalid,error:message});
  }
  for(const {fixture,scene:authored}of scenarios){
   const original=JSON.stringify(authored),saved=parseScene(JSON.stringify(persistentScene(authored)));
   check(JSON.stringify(saved.parameters)===JSON.stringify(authored.parameters),'Save changed exact parameter keys');
   check(!JSON.stringify(saved.timeline).includes('"running"'),'Runtime registry serialized');
   for(const backend of ['cpu','gpu']){
    const scene={...saved,settings:{...saved.settings,domainBackend:backend}},generator=new Generator(),observed=new Map(),samples=[];workerGenerations++;
    const run=async(time,label,g=generator,input=scene)=>{
     const expected=registryReference(fixture,time,input),evaluated=sceneAtTime(input,time),actual=domainParameterFrame(evaluated),context={width:47,height:31,time,quality:'export'};
     compareFrame(actual,expected,fixture.id+' t='+time);
     check(JSON.stringify(Object.keys(evaluated.parameters))===JSON.stringify(Object.keys(expected.parameters)),'Exact own names changed '+fixture.id);
     for(const [key,value]of Object.entries(expected.parameters))check(close(evaluated.parameters[key],value),'Formula parameter differs '+JSON.stringify(key));
     for(const [key,value]of Object.entries(expected.settings))check(typeof value!=='number'||close(evaluated.settings[key],value),'Setting differs '+key);
     for(const e of expected.entries)check(close(readDomainParameterScalar(evaluated,e.name),e.value),'Binding fact differs '+JSON.stringify(e.name));
     const reference={...input,parameters:expected.parameters,settings:expected.settings,timeline:{...input.timeline,tracks:[]}};
     const start=performance.now(),out=await g.generate(input,context),requestWallMs=performance.now()-start;requestCount++;
     const oracleStart=performance.now(),fixed=await g.generate(reference,context),referenceRequestWallMs=performance.now()-oracleStart;requestCount++;
     check(out.type==='raster'&&fixed.type==='raster'&&out.width===47&&out.height===31,'Incomplete raster');
     check(out.backend===(backend==='gpu'?'webgl2':'cpu'),'Selected actual backend missing: '+fixture.id+' '+out.warnings?.join(';'));
     const digest=await hash(out.pixels),fixedDigest=await hash(fixed.pixels);check(digest===fixedDigest&&out.backend===fixed.backend,'Worker did not consume independent registry values '+fixture.id+' t='+time);
     check(out.stats.generated+out.stats.invalid===47*31,'Incomplete pixel facts');
     if(observed.has(time))check(observed.get(time)===digest,'Backseek/reload changed image '+fixture.id);else observed.set(time,digest);
     samples.push({label,time,expected:{running:expected.running,entries:expected.entries},actual,sha256:digest,fixedSha256:fixedDigest,actualBackend:out.backend,stats:out.stats,warnings:out.warnings,requestWallMs,referenceRequestWallMs});
    };
    try{
     for(const t of fixture.times)await run(t,'forward');for(const t of [fixture.times[1],0])await run(t,'backseek');
     generator.dispose();const cold=new Generator();workerGenerations++;try{await run(fixture.times.at(-1),'cold-save-reload',cold,parseScene(JSON.stringify(scene)));}finally{cold.dispose();}
     rows.push({id:fixture.id,backend,samples});
    }finally{generator.dispose();}
   }
   check(JSON.stringify(authored)===original,'Authored fixture mutated '+fixture.id);
  }
  const workspace=scenarios.slice(0,4).map(x=>x.scene);saveWorkspace(localStorage,{scenes:workspace,active:workspace[0].id,theme:'dark',language:'en'});const reloaded=loadWorkspace(localStorage);check(reloaded?.scenes.length===4,'Workspace incomplete');
  for(let i=0;i<4;i++)check(JSON.stringify(reloaded.scenes[i].timeline)===JSON.stringify(workspace[i].timeline),'Workspace changed registry operations');
  return{scenarios:scenarios.length,rows,imports,diagnostics,requestCount,workerGenerations,workspaceScenes:reloaded.scenes.length};
 });report.browser=browser.version();
}catch(error){report.error=String(error.stack??error);}
finally{const cleanup=await Promise.allSettled([browser?.close(),server.close()]);report.cleanup={browserClosed:!browser?.isConnected(),serverClosed:!server.httpServer?.listening,errors:cleanup.filter(x=>x.status==='rejected').map(x=>String(x.reason))};}
report.sourceEnd=await snapshot();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);report.finishedAt=new Date().toISOString();report.status=!report.error&&report.sourceStable&&!report.cleanup.errors.length?'passed':'failed';
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,error:report.error,requests:report.result?.requestCount,scenarios:report.result?.scenarios}));if(report.status!=='passed')process.exitCode=1;
