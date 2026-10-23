import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {prepareBouncingState} from './prepare-source-bouncing-native-state.mjs';
import {measureFamily} from './browser-process-cost.mjs';
import {decodePng} from './lib/verify-png.mjs';
const exec=promisify(execFile),out=path.resolve(process.argv[2]??'.cache/bouncing-retained-state-20261024/verified'),native=path.resolve(process.argv[3]??'.cache/bouncing-native-animation-20261024/residual-states/native-bouncing'),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(out,{recursive:true});await mkdir(out+'/comparison',{recursive:true});
const paths=[...(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p),'server/render/SourceCglRenderer.m','server/render/SourceCglBouncingState.h','tests/fixtures/source-bouncing-native-state/retained-state.m','scripts/prepare-source-bouncing-native-state.mjs','scripts/verify-source-bouncing-native-state.mjs','scripts/headless-renderer-page.mjs','scripts/browser-process-cost.mjs','scripts/lib/verify-png.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',scope:'Actual production initial seeds/display/shaders, retained native CGL simulation and texture drawing, 62 original complete artwork frames and 11 full states. Internal component; no stateful HTTP protocol or App integration.',sourceBefore:await hashes(),references:{},limits:['Original references are paused redraws of successive simulation states, not active GUI/video acceptance.','One original 2M preset and 60 updates. 5M case verifies resource capacity and upload bits only, not original artwork or motion parity.','Native timing includes references/output and a separate 5M capacity exercise; it is not product FPS and is not equivalent to browser/HTTP timings.','Process-family CPU/RSS use 250ms samples; strict cold/warm GPU and token costs unmeasured.']};
const reference=async p=>{const bytes=await readFile(p);report.references[p]=sha(bytes);return bytes;};
try{
 const run=JSON.parse(await reference(native+'/run.json'));assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);assert.equal(run.stderr,'');
 assert.ok(run.stdout.includes('allowed=VIEW:true')&&run.stdout.includes('allowed=RUN:true')&&run.stdout.includes('allowed=EXPORT:true'));
 for(const p of ['settings/settings.conf','license.dat'])assert.deepEqual(run.userFilesBefore[p],run.userFilesAfter[p]);
 assert.equal(sha(await reference(run.source)),run.sourceSha256);assert.equal(sha(await reference(native+'/NativeSceneProbe.java')),run.probeSha256);
 assert.equal(sha(await reference('../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar')),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 for(let frame=1;frame<=62;frame++){
  const prefix=native+`/frame-${frame}/`+(frame>=3?'paused/':''),point=JSON.parse(await reference(prefix+'point-draw.json'));assert.equal(point.simulationUpdates,Math.max(0,frame-2));assert.equal(point.count,2000000);assert.deepEqual(point.viewport,[0,0,500,600]);assert.ok((await reference(prefix+'artwork-boundary.txt')).toString().includes('mathart.scene.Scene.drawWatermark'));await reference(prefix+'before-branding.rgba');await reference(native+`/raw-frame-${frame}.png`);
  if([1,3,4,7,8,12,23,32,38,53,62].includes(frame))await reference(prefix+'state.f32');
 }
 const binary=out+'/state-check';await exec('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','tests/fixtures/source-bouncing-native-state/retained-state.m','-o',binary],{timeout:30000,maxBuffer:65536});report.executableSha256=sha(await readFile(binary));
 let began=performance.now();report.preparation=await prepareBouncingState(out);report.preparationMs=performance.now()-began;
 const prepared=JSON.parse(await readFile(out+'/prepared.json','utf8'));assert.equal(prepared.sourceSha256,run.sourceSha256);assert.equal(prepared.packetSha256,sha(await readFile(out+'/initial-frame.bin')));for(let frame=1;frame<=62;frame++){const prefix=native+`/frame-${frame}/`+(frame>=3?'paused/':''),point=JSON.parse(await readFile(prefix+'point-draw.json'));assert.deepEqual(prepared.camera.projection,point.projection);assert.deepEqual(prepared.camera.modelview,point.modelview);}report.cameraFramesMatched=62;report.preparedSha256=sha(await readFile(out+'/prepared.json'));report.packetSha256=prepared.packetSha256;
 began=performance.now();const measured=await measureFamily(process.pid,async()=>{
  const result=await exec(binary,[out,native,out+'/comparison'],{timeout:60000,killSignal:'SIGKILL',maxBuffer:65536});return{nativeProcess:{exit:0,reaped:true,stdout:result.stdout,stderr:result.stderr}};
 });report.nativeMs=performance.now()-began;Object.assign(report,measured);assert.equal(report.nativeProcess.stderr,'');
 const nativeReport=JSON.parse(await readFile(out+'/comparison/native-report.json','utf8'));report.nativeReport=nativeReport;assert.equal(nativeReport.status,'passed');assert.equal(nativeReport.rows.length,62);assert.equal(nativeReport.disposed,true);assert.equal(nativeReport.windowCreated,false);assert.equal(nativeReport.largeCapacity.differences,0);
 assert.equal(nativeReport.rows.reduce((n,r)=>n+(r.stateComponents??0),0),88097900);assert.equal(nativeReport.stateReadbackBytes,352391600);report.outputHashes={};
 for(const row of nativeReport.rows){
  assert.equal(row.rgbPixels,0);assert.equal(row.opaqueAlphaFailures,0);assert.equal(row.stateDifferent??0,0);
  const actual=await readFile(out+`/comparison/frame-${row.frame}.rgba`),original=decodePng(await readFile(native+`/raw-frame-${row.frame}.png`));assert.equal(original.width,500);assert.equal(original.height,600);assert.equal(actual.length,1200000);
  for(let y=0;y<600;y++)for(let x=0;x<500;x++)assert.equal(actual[((599-y)*500+x)*4+3],original.rgba[(y*500+x)*4+3]);report.outputHashes[row.frame]=sha(actual);
 }report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=(await Promise.all(Object.entries(report.references).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);if(!report.sourceStable||!report.referencesStable){report.status='failed';process.exitCode=1;}await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,preparationMs:report.preparationMs,nativeMs:report.nativeMs,error:report.error,report:out+'/report.json'}));}
