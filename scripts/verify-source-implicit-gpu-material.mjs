// No GUI. Independently generate from the original input, then compare the
// actual CGL result with a qualified original steady paused frame. Original
// attributes, uniforms and pixels are read only after production generation.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createSourceRendererService} from '../server/source-renderer.mjs';

const [directory,referenceFacts,materialCommand]=process.argv.slice(2);assert.ok(directory&&referenceFacts,'output directory and frozen source-facts.json required; optional authored material command');
await mkdir(directory,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),started=performance.now();
const factsBytes=await readFile(referenceFacts),reference=JSON.parse(factsBytes),input=await readFile(reference.input.path);
assert.equal(sha(input),reference.input.sha256);
const report={scope:'Independent production import, CPU fallback MC, GPU material and common contour renderer versus original complete mathematical RGBA at the second normal paused offscreen frame. Does not verify first/dirty viewport restoration, formulas, public UI, or recording.',referenceFacts:{path:referenceFacts,sha256:sha(factsBytes)},inputSha256:sha(input),status:'running',sources:{}};
const verifier=await readFile(new URL(import.meta.url));await writeFile(resolve(directory,'executed-verifier.mjs'),verifier);
report.verifierSha256=sha(verifier);report.runtime={node:process.version,platform:process.platform,arch:process.arch,lockSha256:sha(await readFile('package-lock.json'))};
let service,objects;
const diff=(a,b)=>{assert.equal(a.length,b.length);let differentPixels=0,differentChannels=0,maxChannelDelta=0;for(let i=0;i<a.length;i+=4){let different=false;for(let c=0;c<4;c++){const n=Math.abs(a[i+c]-b[i+c]);if(n){different=true;differentChannels++;maxChannelDelta=Math.max(maxChannelDelta,n);}}if(different)differentPixels++;}return{differentPixels,differentChannels,maxChannelDelta,bytes:a.length};};
try{
 const modulePath=resolve(directory,'production.mjs');
 const bundled=await build({stdin:{contents:"export {parseLegacyScene} from './src/engine/legacyImport'; export {generateImplicit} from './src/scenes/geometry'; export {prepareSourceCamera} from './src/engine/sourceCamera'; export {createSourceImplicitMesh} from './src/engine/sourceImplicitRenderer'; export {prepareSourceImplicitOffscreenTarget} from './src/engine/sourceImplicitViewport'; export {snapshotSourceDrawings} from './src/engine/sourceDrawingSnapshot'; export {encodeSourceDrawingFrame} from './src/engine/sourceDrawingFrame';",resolveDir:process.cwd(),loader:'ts'},outfile:modulePath,bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,logLevel:'silent'});
 for(const name of Object.keys(bundled.metafile.inputs).filter(n=>n!=='<stdin>'))report.sources[name]=sha(await readFile(name));
 const p=await import(pathToFileURL(modulePath));
 const scene=p.parseLegacyScene(input.toString()).scene;
 if(materialCommand){
  const bytes=await readFile(materialCommand),command=JSON.parse(bytes);assert.deepEqual(Object.keys(command).sort(),['ambient','proceduralTexture','shininess','specular']);
  assert.ok(Number.isFinite(command.shininess)&&command.shininess>=0&&command.shininess<=100);assert.ok(['none','checker','metal','ceramic','carbon'].includes(command.proceduralTexture));
  for(const c of [command.ambient,command.specular])assert.match(c,/^#[0-9a-fA-F]{6}$/);
  Object.assign(scene.settings,command);report.materialCommand={path:materialCommand,sha256:sha(bytes),command,meaning:'Same authored hot material event as original; applied local document inputs, not measured shader values.'};
 }
 const context={time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2};
 const output=p.generateImplicit(scene,context);
 const target=p.prepareSourceImplicitOffscreenTarget(output.sourceImplicitPresentation.model,{width:500,height:600},2,486);report.target=target;
 const camera=p.prepareSourceCamera(scene.sourceCamera,{...target.sourceViewport,projectionPass:scene.settings.sourceCameraProjection});
 assert.equal(camera.ok,true);assert.equal(camera.value.kind,'known');
 objects=p.createSourceImplicitMesh(output,camera.value.plan);
 const meshes=[objects.fill,...(objects.lines?[objects.lines]:[])],snapshot=p.snapshotSourceDrawings(meshes);
 assert.equal(snapshot.ok,true,JSON.stringify(snapshot.error));
 const drawing=snapshot.value;
 report.production={model:output.sourceImplicitPresentation.model,backend:output.backend,meshComputation:output.sourceImplicitPresentation.meshComputation,vertices:output.positions.length/3,positionsSha256:sha(Buffer.from(output.positions.buffer)),normalsSha256:sha(Buffer.from(output.sourceImplicitMesh.normals.buffer)),commands:drawing.commands.map(c=>({count:c.count,instances:c.instances,uniforms:c.uniforms.map(u=>u.kind==='sampler2d'?u:{...u,values:Array.from(u.values)})})),textures:drawing.textures.map(t=>({...t,pixels:undefined,pixelsSha256:sha(t.pixels)}))};
 assert.equal(report.production.positionsSha256,reference.cpuMeshPositions.sha256);
 assert.equal(report.production.normalsSha256,reference.cpuMeshNormals.sha256);
 // Source source-facts is diagnostic only; it never enters a producer input.
 const actual=reference.materialDraws[0].uniforms,uniformComparisons=[];
 for(const a of actual){const u=drawing.commands[0].uniforms.find(u=>u.name===a.name);assert.ok(u,'Missing actual active uniform '+a.name);if(u.kind==='sampler2d'){uniformComparisons.push({name:a.name,sourceTextureUnit:a.value,productTexture:u.texture});continue;}const expected=Array.isArray(a.value)?a.value:[a.value],values=Array.from(u.values);assert.deepEqual(values,expected.map(Math.fround),a.name);uniformComparisons.push({name:a.name,exactFloat32:true});}
 report.uniformComparisons=uniformComparisons;
 assert.equal(drawing.textures.length,1);assert.equal(drawing.textures[0].anisotropy,'maximum');
 const palette=await readFile(resolve(reference.reference,'material-01/paletteTex-level-0.rgba'));assert.deepEqual(Buffer.from(drawing.textures[0].pixels),palette);
 const executablePath=resolve(directory,'renderer'),compiled=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
 await writeFile(resolve(directory,'compile.log'),compiled.stderr??'');assert.equal(compiled.status,0,compiled.stderr);
 const backend={executablePath,executableSha256:sha(await readFile(executablePath))};report.backend=backend;
 report.nativeSourceSha256=sha(await readFile('server/render/SourceCglRenderer.m'));
 service=await createSourceRendererService(backend);
 report.renders=[];let sequence=0;
 for(const scope of ['fill-only','complete-math']){
  const selected=scope==='fill-only'?{...drawing,commands:drawing.commands.slice(0,1)}:drawing;
  const encoded=p.encodeSourceDrawingFrame({generation:1,sequence:++sequence,width:500,height:600,samples:0,clear:[0,0,0,1],drawing:selected});assert.equal(encoded.ok,true,JSON.stringify(encoded.error));
  const bytes=Buffer.from(encoded.value);await writeFile(resolve(directory,scope+'.packet'),bytes);
  const result=await service.render(bytes);assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.rowOrder,'bottom-up');assert.equal(result.value.format,'rgba8');
  const rgba=Buffer.from(result.value.pixels);await writeFile(resolve(directory,scope+'.rgba'),rgba);
  const ref=scope==='fill-only'?reference.fillOnly:reference.completeMathBeforeFormula,referencePixels=await readFile(ref.path);assert.equal(sha(referencePixels),ref.sha256);
  report.renders.push({scope,packetSha256:sha(bytes),sha256:sha(rgba),referenceSha256:ref.sha256,comparison:diff(rgba,referencePixels),contextSerial:result.value.contextSerial,rendererIdentity:result.value.rendererIdentity});
 }
 assert.ok(report.renders.every(r=>r.comparison.differentPixels===0),'Actual CGL pixels differ; preserve report and investigate');
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 for(const o of [objects?.fill,objects?.lines]){o?.geometry.dispose();o?.material.dispose();}
 if(service){const closed=await service.close();report.cleanup={closed,processCount:service.processCount,retainedResourceCount:service.retainedResourceCount};if(!closed.ok||service.processCount){report.status='failed';process.exitCode=1;}}
 report.sourceChanges=[];for(const [path,before]of Object.entries(report.sources)){if(sha(await readFile(path))!==before)report.sourceChanges.push(path);}
 if(report.sourceChanges.length){report.status='failed';process.exitCode=1;}
 report.elapsedSeconds=(performance.now()-started)/1000;await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({directory,status:report.status,error:report.error,renders:report.renders?.map(r=>({scope:r.scope,...r.comparison})),cleanup:report.cleanup,sourceChanges:report.sourceChanges}));
}
