// Windowless production-protocol verification. Explicit saved references are
// read-only; no original app execution, export or middle-state upload occurs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
import {createSourceRendererService} from '../server/source-renderer.mjs';

const [specArg,referenceArg,outArg]=process.argv.slice(2);
assert(specArg&&referenceArg&&outArg,'Usage: node scripts/verify-source-iterated-native-compute.mjs spec.json reference-manifest.json new-output-directory');
assert.equal(process.platform,'darwin');
const out=resolve(outArg),specPath=resolve(specArg),referencePath=resolve(referenceArg),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(out,{recursive:false});
const report={scope:'Production retained CGL compute from canonical seeds through v6 service; bounded full diagnostic readback compared to saved original state. No native ink/presentation or end-user performance claim.',sourcePins:{},references:{},rounds:[],errors:[]};
const pin=async path=>{const bytes=await readFile(path);report.sourcePins[resolve(path)]=sha(bytes);return bytes;};
const spec=JSON.parse(await pin(specPath)),reference=JSON.parse(await pin(referencePath));
const source=await pin(resolve(spec.source.path));assert.equal(sha(source),spec.source.sha256);assert.equal(sha(await pin(resolve(spec.source.jar))),spec.source.jarSha256);
const referenceFiles=[reference.initial,...reference.steps.map(s=>s.reference)];
for(const path of referenceFiles){const raw=await readFile(path);assert.equal(sha(raw),reference.pins[path],`Reference changed: ${path}`);report.references[path]={sha256:sha(raw),bytes:raw.length};}
for(const path of ['scripts/verify-source-iterated-native-compute.mjs','server/source-renderer.mjs','server/render/SourceCglRenderer.m','server/render/SourceCglIteratedState.h','src/engine/sourceIteratedNativeProtocol.ts','src/engine/iteratedSeed.ts','src/engine/javaSourceRandom.ts','src/engine/iteratedDensityGpuPrograms.ts','src/engine/sourceSymmetryMath.ts','src/scenes/iteratedDensity.ts','src/engine/legacyImport.ts'])await pin(path);
const vite=await createServer({server:{middlewareMode:true},logLevel:'error'});let service;
try{
 const {parseProjectFile}=await vite.ssrLoadModule('/src/engine/legacyImport.ts');
 const {prepareIteratedFrame}=await vite.ssrLoadModule('/src/scenes/iteratedDensity.ts');
 const {iteratedInitialChunk}=await vite.ssrLoadModule('/src/engine/iteratedSeed.ts');
 const {iteratedDensityGpuPrograms,iteratedGpuFieldSource}=await vite.ssrLoadModule('/src/engine/iteratedDensityGpuPrograms.ts');
 const {encodeSourceIteratedNativeRequest,decodeSourceIteratedNativeResponse}=await vite.ssrLoadModule('/src/engine/sourceIteratedNativeProtocol.ts');
 const scene=parseProjectFile(source.toString('utf8')).scene,job=prepareIteratedFrame(scene,0,0),count=job.config.count;
 assert.equal(scene.kind,'symmetry');assert.equal(count,reference.count);assert.equal(job.config.dimension,2);
 const field=iteratedGpuFieldSource(job.field,'native-gl41'),shaders=iteratedDensityGpuPrograms('native-gl41').iteration(field),uniforms=Object.entries(field.uniforms).map(([name,value])=>({name,value}));
 for(const step of reference.steps)for(const {name,value}of uniforms)assert.equal(Math.fround(value),Math.fround(step.uniforms[name]),`Consumed parameter mismatch: ${name}`);
 report.input={count,config:job.config,field:job.field,steps:reference.steps.map(s=>s.iterations),shaders:{vertex:sha(shaders.vertex),fragment:sha(shaders.fragment)}};
 await writeFile(out+'/iteration.vert',shaders.vertex);await writeFile(out+'/iteration.frag',shaders.fragment);
 const executablePath=out+'/renderer',began=performance.now(),build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
 await writeFile(out+'/compile.stdout',build.stdout??'');await writeFile(out+'/compile.stderr',build.stderr??'');assert.equal(build.error,undefined);assert.equal(build.status,0,build.stderr);assert.equal(build.stderr,'');
 const executableSha256=sha(await readFile(executablePath));report.build={seconds:(performance.now()-began)/1000,executableSha256};
 service=await createSourceRendererService({executablePath,executableSha256,timeoutMs:15000});let sequence=0;
 for(let round=0;round<2;round++){
  const resource=(round===0?'a1':'b2').repeat(16),record={label:round===0?'new process/context':'same process/context after exact release',requests:0,requestBytes:0,responseBytes:0,phases:[],comparisons:[]};report.rounds.push(record);
  async function send(operation){const request={generation:1,sequence:++sequence,operation},encoded=encodeSourceIteratedNativeRequest(request);assert(encoded.ok,encoded.error?.reason);record.requests++;record.requestBytes+=encoded.value.length;const result=await service.render(encoded.value);assert(result.ok,JSON.stringify(result.error));assert.equal(result.value.format,'iterated-v1');assert.equal(result.value.rowOrder,'none');assert.equal(result.value.rendererIdentity,service.rendererIdentity);record.rendererIdentity=result.value.rendererIdentity;record.contextSerial=result.value.contextSerial;record.sessionSerial=result.value.sessionSerial;record.responseBytes+=result.value.pixels.length;return decodeSourceIteratedNativeResponse(result.value.pixels,request);}
  async function phase(name,work){const start=performance.now();const value=await work();record.phases.push({name,seconds:(performance.now()-start)/1000});return value;}
  const start=performance.now();await phase('create',()=>send({kind:'create',resource,count,...shaders}));
  await phase('canonical seed upload',async()=>{
   const original=await readFile(reference.initial);let differences=0;
   for(let offset=0;offset<count;offset+=65536){const n=Math.min(65536,count-offset),positionsAndMetric=iteratedInitialChunk(job.config,offset,n),raw=Buffer.from(positionsAndMetric.buffer,positionsAndMetric.byteOffset,positionsAndMetric.byteLength),expected=original.subarray(offset*16,(offset+n)*16);assert.equal(raw.length,expected.length);for(let i=0;i<raw.length;i+=4)if(raw.readUInt32LE(i)!==expected.readUInt32LE(i))differences++;await send({kind:'upload',resource,expectedIndex:0,expectedCount:count,offset,positionsAndMetric});}
   record.seedComparison={values:count*4,differences};assert.equal(differences,0,'Canonical seed mismatch');
  });
  let index=0;
  async function compare(label,path){
   const expected=await readFile(path),actualPath=out+`/round-${round}-${label}.f32`,file=await open(actualPath,'wx');let differences=0,invalid=0,notValid=0;
   try{for(let offset=0;offset<count;offset+=65536){const n=Math.min(65536,count-offset),r=await send({kind:'read',resource,expectedIndex:index,expectedCount:count,offset,count:n}),raw=Buffer.from(r.positionsAndMetric.buffer,r.positionsAndMetric.byteOffset,r.positionsAndMetric.byteLength);await file.write(raw,0,raw.length,offset*16);for(let i=0;i<raw.length;i+=4)if(raw.readUInt32LE(i)!==expected.readUInt32LE(offset*16+i))differences++;for(const v of r.invalidCounts)invalid+=v;for(const v of r.validity)if(v!==1)notValid++;}}finally{await file.close();}
   const comparison={label,index,values:count*4,differences,invalidCount:invalid,notValid,actual:actualPath,actualSha256:sha(await readFile(actualPath)),reference:path};record.comparisons.push(comparison);assert.equal(differences,0,`${label} state mismatch`);
  }
  await phase('read initial',()=>compare('initial',reference.initial));
  for(let i=0;i<reference.steps.length;i++){const step=reference.steps[i];await phase(`advance ${step.iterations}`,async()=>{const r=await send({kind:'advance',resource,expectedIndex:index,expectedCount:count,reset:false,dimension:2,steps:step.iterations,uniforms});index=r.index;});await phase(`read steps ${step.total}`,()=>compare(`steps-${step.total}`,step.reference));}
  await phase('release',async()=>{const r=await send({kind:'release',resource,expectedIndex:index,expectedCount:count});assert.equal(r.disposition,'released');assert.equal(service.retainedResourceCount,0);});record.seconds=(performance.now()-start)/1000;
 }
 assert.equal(service.processCount,1);assert.deepEqual(await service.close(),{ok:true});report.cleanup={processCount:service.processCount,retainedResourceCount:service.retainedResourceCount};assert.equal(report.cleanup.processCount,0);assert.equal(report.cleanup.retainedResourceCount,0);service=undefined;
 report.status='passed';
}catch(error){report.status='failed';report.errors.push(String(error?.stack??error));process.exitCode=1;}
finally{if(service)report.cleanupAfterFailure=await service.close();await vite.close();for(const [path,digest]of Object.entries(report.sourcePins))assert.equal(sha(await readFile(path)),digest,`Source changed while verifying: ${path}`);await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,report:out+'/report.json',rounds:report.rounds.map(r=>({label:r.label,seconds:r.seconds,comparisons:r.comparisons.map(c=>({label:c.label,differences:c.differences}))})),errors:report.errors}));
