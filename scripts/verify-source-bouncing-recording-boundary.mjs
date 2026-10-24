/** Retained original runtime completion versus the production clock owner.
 * Public App rejection/retry is checked separately by native-export acceptance. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {sourceBouncingOriginalPreset} from './lib/source-bouncing-original.mjs';
const [out,...references]=process.argv.slice(2);assert.ok(out&&references.length,'New output and original recording directories required');await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),retained={};
const read=async path=>{const bytes=await readFile(path);retained[path]=sha(bytes);return bytes;};
const sources=['scripts/verify-source-bouncing-recording-boundary.mjs','scripts/capture-source-bouncing-original.py','scripts/lib/source-bouncing-original.mjs','tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java','tests/fixtures/source-bouncing-native-animation/presets.json','src/engine/sourceBouncingReplay.ts','src/engine/sourceBouncingConfig.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',at:new Date().toISOString(),scope:'Full original presets with explicit duration/FPS changes. Original Scene/VideoRecorder timing and output frame count versus production clock; no artwork, product UI or performance claim.',sourceBefore:await hashes(),references:retained,cases:[]};
try{
 const bundle=resolve(out,'clock.mjs');await build({entryPoints:['src/engine/sourceBouncingReplay.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm'});const clock=await import(pathToFileURL(bundle));
 const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';assert.equal(sha(await read(jar)),'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');
 const take=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 for(const reference of references){
  const run=JSON.parse(await read(reference+'/run.json')),descriptor=JSON.parse(await read(run.source)),frames=JSON.parse(await read(reference+'/frames.json')),encoder=JSON.parse(await read(reference+'/encoder.json'));
  assert.equal(run.mode,'recording');assert.equal(run.captureStatus,'passed');assert.equal(run.exit,0);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.timedOut,false);assert.doesNotMatch(run.stdout,/ ERROR /);assert.equal(run.stderr,'');
  assert.equal(run.probeSha256,sha(await readFile('tests/fixtures/source-bouncing-native-recording/NativeSceneProbe.java')));assert.equal(sha(await read(reference+'/NativeSceneProbe.java')),run.probeSha256);assert.equal(sha(await read(run.source)),run.sourceSha256);
  assert.equal(run.hostSha256,'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e');
  const original=execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',jar,run.sourceMember]),preset=sourceBouncingOriginalPreset(original),expected=JSON.parse(original);
  assert.equal(preset.sourceSha256,run.originalSourceSha256);expected.settings.record_duration=run.recording.duration;assert.deepEqual(descriptor.project,expected);assert.equal(descriptor.fps,run.recording.fps);
  for(const key of ['license.dat','settings/settings.conf'])assert.deepEqual(run.userFilesBefore[key],run.userFilesAfter[key]);
  assert.equal(encoder.aliveAfterFinish,false);assert.equal(encoder.exit,0);assert.equal(encoder.exportScaleFactor,3);assert.equal(sha(await read(encoder.command)),run.ffmpeg.sha256);
  assert.ok(frames.length>=1&&frames.length<=run.recording.maxActiveFrames);assert.equal(frames.at(-1).complete,true);
  const plans=[];
  for(const offset of [0,17]){
   const from=take(clock.planSourceBouncingFixedReplay({updates:offset,fps:60})).checkpoint;
   const plan=take(clock.planSourceBouncingRecording({from,fps:descriptor.fps,recordDuration:Math.fround(run.recording.duration)})),displays=[plan.warmup,...plan.frames];
   assert.equal(displays.length,frames.length);assert.deepEqual(plan.end,displays.at(-1));
   for(let i=0;i<frames.length;i++){
    const originalFrame=frames[i],point=JSON.parse(await read(reference+'/frame-'+i+'/point-draw.json'));
    assert.equal(originalFrame.frame,i);assert.equal(originalFrame.encoded,i>0);assert.equal(originalFrame.complete,i===frames.length-1);assert.equal(point.simulationUpdates,i+1);assert.equal(point.count,preset.particleCount);
    assert.equal(displays[i].simulationUpdates,point.simulationUpdates+offset);assert.equal(displays[i].sceneTime,Math.fround(originalFrame.sceneTime));assert.equal(plan.step,Math.fround(originalFrame.rawDt));
   }
   plans.push({offset,...plan});
  }
  const video=reference+'/original.mp4';await read(video);const ffprobe=join(dirname(encoder.command),'ffprobe');await read(ffprobe);
  const metadata=JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',video],{encoding:'utf8'})),encoded=frames.length-1;
  if(encoded===0)assert.deepEqual(metadata.streams,[]);
  else{assert.equal(metadata.streams.length,1);assert.equal(metadata.streams[0].codec_type,'video');assert.equal(Number(metadata.streams[0].nb_read_frames),encoded);}
  report.cases.push({reference,preset:run.case,particleCount:preset.particleCount,fps:descriptor.fps,duration:run.recording.duration,originalFrames:frames,encodedFrames:encoded,originalVideo:metadata,plans,clockExact:true,encoderExited:true});
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=(await Promise.all(Object.entries(retained).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean);if(!report.sourceStable||!report.referencesStable)report.status='failed';
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({fps:c.fps,duration:c.duration,encodedFrames:c.encodedFrames})),error:report.error,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
