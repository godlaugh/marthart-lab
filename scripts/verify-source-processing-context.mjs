// Original normal VIEW/RUN captures → independent lifecycle/timeline model.
// No original executable is launched. Optional CGL replay uses production wire.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';
import {createSourceRendererService} from '../server/source-renderer.mjs';

const [referenceArg,outArg]=process.argv.slice(2);assert(referenceArg&&outArg,'reference directory and new output directory required');
const reference=resolve(referenceArg),out=resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex');await mkdir(out,{recursive:false});
const report={status:'running',scope:'Derived graphics context and real native Processing setter phases; ordinary primary update with authored camera timeline. Source seed/pass scheduling are observed inputs. Linked reflection is owned by the native program; original reflection is used only for comparison. Application routing and full image parity are not claimed.',inputs:{},sources:{},frames:[],mismatches:[]};
let vite,service;const began=performance.now();
async function pinned(path,group){const b=await readFile(path);group[path]=sha(b);return b;}
const ref=async name=>JSON.parse(await pinned(reference+'/'+name,report.inputs));
const unwrap=value=>{if(!value.ok)throw value.error;return value.value;};
const bits=values=>Buffer.from(new Float32Array(values).buffer);
const transpose=a=>Array.from({length:16},(_,i)=>a[(i%4)*4+Math.floor(i/4)]);
function compare(label,actual,expected){const a=bits(actual),b=bits(expected);if(!a.equals(b))report.mismatches.push({label,actual,expected,actualBits:[...new Uint32Array(a.buffer,a.byteOffset,a.length/4)],expectedBits:[...new Uint32Array(b.buffer,b.byteOffset,b.length/4)]});}
try{
 for(const file of ['scripts/verify-source-processing-context.mjs','src/engine/sourceProcessingContext.ts','src/engine/sourceProcessingHost.ts','src/engine/sourceProcessingSceneContext.ts','src/engine/sourceProcessingAutomaticBindings.ts','src/engine/sourceProcessingMatrix.ts','src/engine/sourceCamera.ts','src/engine/ordinarySourceCameraTimeline.ts','src/engine/sourceSymmetryCustom.ts','src/engine/symmetryCustom.ts','src/engine/sourceIteratedNativeProtocol.ts','src/engine/sourceSymmetryNativeBindings.ts','server/source-renderer.mjs',...(await readdir('server/render')).map(p=>'server/render/'+p)])await pinned(file,report.sources);
 const run=await ref('run.json'),authorization=await ref('authorization.json'),complete=await ref('complete.json'),descriptor=await ref('descriptor.json'),source=await ref('source.json'),initial=await ref('runtime-before.json');
 assert.equal(run.status,'observed');assert.equal(run.exit,0);assert.deepEqual(run.processGroupAfter,[]);assert.deepEqual(run.sourceBefore,run.sourceAfter);assert(authorization.VIEW&&authorization.RUN&&complete.observed);report.authorization=authorization;
 report.originalStderr=String(await pinned(reference+'/stderr.log',report.inputs));
 vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
 const {SourceProcessingHost}=await vite.ssrLoadModule('/src/engine/sourceProcessingHost.ts'),{sourceProcessingAutomaticBindings,sourceProcessingAutomaticSetters}=await vite.ssrLoadModule('/src/engine/sourceProcessingAutomaticBindings.ts'),{parseProjectFile}=await vite.ssrLoadModule('/src/engine/legacyImport.ts'),{resolveSourceCamera,prepareSourceCamera}=await vite.ssrLoadModule('/src/engine/sourceCamera.ts'),{OrdinarySourceCameraTimelineSession}=await vite.ssrLoadModule('/src/engine/ordinarySourceCameraTimeline.ts'),{prepareSourceSymmetryCustomProgram}=await vite.ssrLoadModule('/src/engine/sourceSymmetryCustom.ts'),{bindSymmetryCustomParameters}=await vite.ssrLoadModule('/src/engine/symmetryCustom.ts'),codec=await vite.ssrLoadModule('/src/engine/sourceIteratedNativeProtocol.ts');
 const scene=parseProjectFile(JSON.stringify(source)).scene,camera=unwrap(resolveSourceCamera(scene.sourceCamera));assert.equal(camera.kind,'known');
 const width=descriptor.sourceViewport.logicalWidth,height=descriptor.sourceViewport.logicalHeight,host=unwrap(SourceProcessingHost.create(width,height));
 const apply=event=>unwrap(host.apply(event)),snapshot=()=>unwrap(host.snapshot('primary'));const timeline=new OrdinarySourceCameraTimelineSession(camera.state.value,scene.timeline.tracks,30,{});
 apply({kind:'begin-primary',width,height});apply({kind:'initialize-scene'});apply({kind:'end-primary'});
 const program=prepareSourceSymmetryCustomProgram(source.equation.glsl,Number(initial.mobject.runtimeSymmetryDegree)),count=Number(initial.mobject.batchSize),native=!descriptor.frames.some(f=>f.reinitializeScene);report.nativeCoverage=native?'active-particle state':'not replayed: source scene reinitialization creates a separate seed/resource';
 const resource='c1'.repeat(16),profile='source-fragment';let sequence=0,index=0;
 async function send(operation){const request={generation:1,sequence:++sequence,operation},packet=unwrap(codec.encodeSourceIteratedNativeRequest(request)),result=await service.render(packet);assert(result.ok,JSON.stringify(result.error));const response=codec.decodeSourceIteratedNativeResponse(result.value.pixels,request);assert.equal(response.diagnosticUnit,'completed-pass');return response;}
 if(native){
  const executable=out+'/renderer',build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executable],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});await writeFile(out+'/compile.log',build.stderr??'');assert.equal(build.error,undefined);assert.equal(build.status,0,build.stderr);assert.equal(build.stderr,'');report.executableSha256=sha(await readFile(executable));
  service=await createSourceRendererService({executablePath:executable,executableSha256:report.executableSha256,timeoutMs:15000});await send({kind:'create-fragment',resource,count,...program});
  const seed=await pinned(reference+'/frame-0/state-initial-level-0.bin',report.inputs);for(let at=0;at<count;at+=65536){const n=Math.min(65536,count-at);await send({kind:'upload',resource,profile,expectedCount:count,expectedIndex:0,offset:at,positionsAndMetric:new Float32Array(Uint8Array.from(seed.subarray(at*16,(at+n)*16)).buffer)});}
 }
 for(const frame of descriptor.frames){
  const frameStart=performance.now();apply({kind:'begin-primary',width,height});
  if(frame.reinitializeScene){apply({kind:'initialize-scene'});apply({kind:'reset-mobject'});timeline.reset();}
  const draws=await ref(`frame-${frame.index}/draws.json`),passes=draws.filter(d=>d.ownerMethod==='runUpdatePass'),before=snapshot(),calculated=timeline.step(frame.rawDt),runtime=await ref(`frame-${frame.index}/runtime.json`);
  compare(`frame ${frame.index} timeline camera`,['phi','theta','gamma','focalDistance','zoom'].map(k=>calculated.camera[k]),['phi','theta','gamma','focalDistance','zoom'].map(k=>Number(runtime.camera[k])));
  const delivered=[];
  for(const pass of passes){
   const context=unwrap(host.bindCompute()),automatic=unwrap(sourceProcessingAutomaticSetters(context)),parameters=Object.entries(bindSymmetryCustomParameters(program,source.parameters)).map(([name,value])=>({name,value}));
   let nativeBindings;
   if(native){const r=await send({kind:'advance-processing-fragment',resource,expectedCount:count,expectedIndex:index,steps:pass.uniforms.iterations.values[0],reset:false,resetCounter:false,automatic,parameters});index=r.index;nativeBindings=r.processingBindings;assert(nativeBindings);}
   // The original linked facts are comparison evidence only, never request
   // inputs. Actual native alias/type decisions arrive from the native reply.
   const observed=new Map(Object.entries(pass.uniforms).map(([name,value])=>[name.replace(/\[0\]$/,''),value]));
   const reflection=[...observed].map(([name,value])=>({name,type:value.type,size:value.size})),typed=unwrap(sourceProcessingAutomaticBindings(reflection,context));
   for(const binding of typed.bindings)if(!program.bindingNames.includes(binding.name))compare(`frame ${frame.index} draw ${pass.ordinal} ${binding.name}`,binding.values,observed.get(binding.name).values.slice(0,binding.values.length));
   if(nativeBindings){
    const expected={automatic:automatic.map(setter=>{const selectedName=setter.names.find(name=>observed.has(name));return selectedName?{outcome:typed.rejectedSetters.some(r=>r.name===selectedName)?'rejected':'applied',selectedName}:{outcome:'inactive'};}),parameters:parameters.map(p=>({name:p.name,outcome:!observed.has(p.name)?'inactive':[5126,35670].includes(observed.get(p.name).type)?'applied':'rejected'}))};
    if(JSON.stringify(nativeBindings)!==JSON.stringify(expected))report.mismatches.push({label:`frame ${frame.index} draw ${pass.ordinal} actual native setter results`,actual:nativeBindings,expected});
   }
   delivered.push({ordinal:pass.ordinal,automatic,parameters,nativeBindings});
  }
  if(native){const actual=Buffer.alloc(count*16);for(let at=0;at<count;at+=65536){const n=Math.min(65536,count-at),r=await send({kind:'read',resource,profile,expectedIndex:index,expectedCount:count,offset:at,count:n});Buffer.from(r.positionsAndMetric.buffer).copy(actual,at*16);}const expected=(await pinned(reference+`/frame-${frame.index}/state-current-level-0.bin`,report.inputs)).subarray(0,count*16);await writeFile(out+`/frame-${frame.index}.bin`,actual);let differences=0;for(let at=0;at<actual.length;at+=4)if(actual.readUInt32LE(at)!==expected.readUInt32LE(at))differences++;report.frames.push({index:frame.index,bytes:actual.length,stateWordDifferences:differences,actualSha256:sha(actual),expectedSha256:sha(expected)});}
  else report.frames.push({index:frame.index});
  // Actual Scene.render base camera, optional fade, world transform, then
  // watermark/badge overlay. The last overlay projection survives popMatrix.
  const cameraPlan=unwrap(prepareSourceCamera({...scene.sourceCamera,frame:calculated.camera},descriptor.sourceViewport));assert.equal(cameraPlan.kind,'known');const p=cameraPlan.plan;
  apply({kind:'begin-render',plan:p});unwrap(host.bindCompute());
  const world=unwrap(host.snapshot('current'));compare(`frame ${frame.index} source camera world transform`,world.transform,p.transform.columnMajor);
  for(const draw of draws.filter(d=>d.worldGraphicsContext)){const expected=draw.worldGraphicsContext;for(const [local,remote]of [['projection','projection'],['modelview','modelview'],['transform','projmodelview']])compare(`frame ${frame.index} actual world ${local}`,world[local],transpose(expected[remote]));compare(`frame ${frame.index} actual world normal`,world.normalMatrix,[0,1,2,4,5,6,8,9,10].map(i=>expected.modelviewInv[i]));}
  assert.equal(typeof authorization.watermark,'boolean','Overlay presence must be explicit');apply({kind:'end-render',screenOverlay:authorization.watermark});
  const after=snapshot();apply({kind:'end-primary'});
  for(const [name,observed] of [['context-before-run.json',before],['context-after-run.json',after],['context-after-end.json',snapshot()]]){
   try{const expected=await ref(`frame-${frame.index}/${name}`);for(const [local,remote]of [['projection','projection'],['modelview','modelview'],['transform','projmodelview']])compare(`frame ${frame.index} ${name} ${local}`,observed[local],transpose(expected[remote]));compare(`frame ${frame.index} ${name} normal`,observed.normalMatrix,[0,1,2,4,5,6,8,9,10].map(i=>expected.modelviewInv[i]));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await writeFile(out+`/context-${frame.index}.json`,JSON.stringify({before,world,after,delivered,camera:calculated.camera},null,2)+'\n');report.frames.at(-1).secondsIncludingNative= (performance.now()-frameStart)/1000;
 }
 if(native){assert.equal((await send({kind:'release',resource,profile,expectedIndex:index,expectedCount:count})).disposition,'released');assert.equal(service.retainedResourceCount,0);}
 host.dispose();report.hostCleanup=host.diagnostics();report.status=report.mismatches.length||report.frames.some(f=>f.stateWordDifferences)?'differences':'passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 if(service){const closed=await service.close();report.cleanup={...closed,processCount:service.processCount,retainedResourceCount:service.retainedResourceCount};if(!closed.ok||service.processCount)report.status='failed';}await vite?.close();
 report.stable=true;for(const group of [report.inputs,report.sources])for(const [file,hash]of Object.entries(group))if(sha(await readFile(file))!==hash)report.stable=false;
 if(!report.stable)report.status='failed';report.seconds=(performance.now()-began)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='passed'?0:1;
 console.log(JSON.stringify({status:report.status,frames:report.frames.length,mismatches:report.mismatches.length,report:out+'/report.json'}));
}
