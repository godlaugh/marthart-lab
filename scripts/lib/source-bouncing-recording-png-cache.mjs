import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),execute=promisify(execFile);
/** Reuse only a completed, source-stable PNG validation phase. The subsequent
 * product comparison may have failed independently. Rehash every retained
 * input before reuse; metadata files alone never establish freshness. */
export async function reuseSourceBouncingRecordingPngs(reference,frames,previousReport,read){
 const started=performance.now(),previous=JSON.parse(await read(previousReport)),helper='scripts/lib/source-bouncing-recording-pngs.py';
 assert.ok(['passed','failed'].includes(previous.status),'Previous run must be terminal');assert.equal(previous.sourceStable,true);assert.equal(previous.referencesStable,true);
 assert.equal(previous.sourceBefore[helper],sha(await readFile(helper)),'PNG validation code changed');assert.equal(previous.sourceAfter[helper],previous.sourceBefore[helper]);
 const manifest=await read(reference+'/frames.json');assert.equal(previous.references[reference+'/frames.json'],sha(manifest),'Original frame manifest changed or reference path differs');assert.deepEqual(frames,JSON.parse(manifest));
 assert.equal(previous.references[reference+'/run.json'],sha(await read(reference+'/run.json')),'Original run changed or reference path differs');
 const directory=previous.pngValidationSource?.directory??dirname(previousReport)+'/png-validation',validationBytes=await read(directory+'/report.json'),pixelBytes=await read(directory+'/frames.jsonl');
 assert.equal(sha(validationBytes),previous.references[directory+'/report.json']);assert.equal(sha(pixelBytes),previous.references[directory+'/frames.jsonl']);
 const validation=JSON.parse(validationBytes),pixels=String(pixelBytes).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(validation.status,'passed');assert.deepEqual(validation,previous.pngValidation);assert.equal(validation.frames,frames.length);assert.ok(frames.length>0&&frames.length<10000);assert.equal(pixels.length,frames.length);
 const versions=JSON.parse((await execute('python3',['-c','import json,platform,PIL;print(json.dumps({"python":platform.python_version(),"pillow":PIL.__version__}))'],{timeout:10000})).stdout);
 assert.equal(validation.python,versions.python);assert.equal(validation.pillow,versions.pillow);
 let checkedBytes=0,checkedFiles=0;
 for(let i=0;i<frames.length;i++){
  const fact=pixels[i],frame=frames[i],base=reference+'/frame-'+i;assert.equal(fact.frame,i);assert.equal(frame.frame,i);assert.equal(frame.width,1500);assert.equal(frame.height,1800);
  const paths=['pixels.json','point-draw.json','artwork-boundary.txt','artwork.png','final.png'].map(name=>base+'/'+name);
  assert.deepEqual(Object.keys(fact.files).sort(),paths.toSorted(),'Cached reference file set differs');
  for(const path of paths){
   const bytes=await read(path);assert.equal(sha(bytes),fact.files[path],`Cached reference changed: ${path}`);assert.equal(fact.files[path],previous.references[path]);checkedBytes+=bytes.length;checkedFiles++;
   if(path===base+'/pixels.json')assert.deepEqual(JSON.parse(bytes),fact.pixels);
  }
  if(i)assert.equal(fact.pixels.encoderInputSha256,fact.pixels.finalRgbaSha256);
 }
 return {validation,pixels,source:{directory,reusedFrom:previousReport},reuse:{previousReport,checkedFiles,checkedBytes,elapsedMs:performance.now()-started,versions,scope:'Unchanged input bytes, original manifest/run, completed validation metadata, helper code and Python/Pillow versions. Product generation and encoding are always rerun.'}};
}
