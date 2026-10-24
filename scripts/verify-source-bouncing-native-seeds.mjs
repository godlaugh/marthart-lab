/** Compare actual original numerical producers with the production importer and
 * seed generator. The GL upload is only a capture boundary, not GPU evidence. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const [reference,out]=process.argv.slice(2);assert.ok(reference&&out,'Reference and new output required');await mkdir(out);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),references={};
const read=async path=>{const bytes=await readFile(path);references[path]=sha(bytes);return bytes;};
const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-native-seeds.mjs','scripts/capture-source-bouncing-seeds.py','tests/fixtures/source-bouncing-native-seeds/NativeSceneProbe.java','tests/fixtures/source-bouncing-native-seeds/inputs.json').sort();
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',at:new Date().toISOString(),scope:'88 bounded numerical producer cases. Complete original padded Float32 uploads versus production seeds; selected config fields compared separately. Two observed unsupported Math-prefix formulas must specifically reject. No GPU/frame/window or exhaustive parser claim.',sourceBefore:await hashes(),references,cases:[]};
let server;const started=performance.now();
try{
 const input=JSON.parse(await read(reference+'/inputs.json')),original=JSON.parse(await read(reference+'/numerics.json')),run=JSON.parse(await read(reference+'/run.json'));
 assert.equal(run.status,'passed');assert.equal(run.exit,0);assert.equal(run.timedOut,false);assert.equal(run.reaped,true);assert.equal(run.processGroupExists,false);assert.equal(run.stderr,'');assert.equal(run.sourcesStable,true);assert.deepEqual(run.originalFilesBefore,run.originalFilesAfter);
 for(const name of ['license.dat','settings/settings.conf'])assert.deepEqual(run.originalFilesBefore[name],run.copiedFilesAfter[name]);
 assert.equal(run.jarSha256,'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018');assert.equal(run.hostSha256,'c8c08517e92499bb45762a1fe2ed9ffc5f08c357aff11bcd8f03ab860c6d057e');
 assert.equal(sha(await read(run.jarPath)),run.jarSha256);assert.equal(sha(await read(run.command[0])),run.hostSha256);assert.doesNotMatch(run.stdout,/ ERROR /);
 assert.equal(run.inputSha256,references[reference+'/inputs.json']);assert.equal(run.inputSha256,sha(await readFile('tests/fixtures/source-bouncing-native-seeds/inputs.json')));assert.equal(run.probeSha256,sha(await read(reference+'/NativeSceneProbe.java')));assert.equal(run.probeSha256,sha(await readFile('tests/fixtures/source-bouncing-native-seeds/NativeSceneProbe.java')));
 assert.equal(original.windowCount,0);assert.equal(input.length,88);assert.equal(input.length,original.cases.length);report.original={javaHome:original.javaHome,javaVersion:original.javaVersion,tier:original.tier,policySource:original.policySource,seconds:run.seconds,probeSha256:run.probeSha256,jarSha256:run.jarSha256,hostSha256:run.hostSha256};
 server=await createServer({server:{middlewareMode:true},logLevel:'error'});
 const {importSourceBouncingConfig}=await server.ssrLoadModule('/src/engine/sourceBouncingConfig.ts'),{generateSourceBouncingSeeds}=await server.ssrLoadModule('/src/engine/sourceBouncingSeeds.ts');
 for(let i=0;i<input.length;i++){
  const row=input[i],expected=original.cases[i];assert.equal(expected.name,row.name);const parsed=importSourceBouncingConfig(row.raw),actual=parsed.ok?generateSourceBouncingSeeds(parsed.value.configuration):parsed;
  const result={name:row.name,originalStatus:expected.status,originalError:expected.error,productStatus:actual.ok?'passed':'error',productError:actual.ok?undefined:actual.error};report.cases.push(result);
  // First observation is retained separately. The guide's Java-style prefix
  // fails in the real parser; preserve both failures rather than pretending it
  // generated matching particles or allowing arbitrary errors to pass.
  if(row.raw.settings.shape_formula==='Math.sin(x*5)+Math.cos(y*3)>0'){
   assert.equal(expected.status,'error');assert.equal(expected.errorType,'java.lang.RuntimeException');assert.equal(expected.error,'Unknown variable: Math');assert.ok(parsed.ok);assert.equal(actual.ok,false);assert.equal(actual.error.kind,'input');assert.deepEqual(actual.error.path,['shapeFormula']);
   result.outcome='rejected-unsupported-Math-prefix';continue;
  }
  assert.equal(expected.status,'passed',JSON.stringify(expected));assert.ok(actual.ok,JSON.stringify(actual));const config=parsed.value.configuration;
  assert.equal(expected.count,config.particleCount);assert.equal(expected.seed,config.seed);assert.equal(expected.subSteps,config.subSteps);assert.equal(expected.timeStep,config.timeStep);assert.equal(expected.initialPositionMode,config.initialPositionMode);assert.equal(expected.initialVelocityMode,config.initialVelocityMode);assert.equal(expected.uploadCalls,3);
  const words=new Uint32Array(actual.value.state.buffer,actual.value.state.byteOffset,actual.value.state.length),size=Math.ceil(Math.sqrt(config.particleCount));assert.equal(expected.words.length,size*size*4);const differences=[];
  for(let j=0;j<expected.words.length;j++){const actualWord=j<words.length?words[j]:0;if(expected.words[j]!==actualWord)differences.push({channel:j,expected:expected.words[j],actual:actualWord});}
  result.particles=config.particleCount;result.channels=expected.words.length;result.differenceCount=differences.length;result.firstDifferences=differences.slice(0,8);assert.equal(differences.length,0,JSON.stringify(result));result.outcome='exact-numerics';
 }
 report.totals={cases:report.cases.length,exactNumericalCases:report.cases.filter(c=>c.outcome==='exact-numerics').length,explicitPrefixRejections:report.cases.filter(c=>c.outcome==='rejected-unsupported-Math-prefix').length,particles:report.cases.reduce((sum,c)=>sum+(c.particles??0),0),paddedChannels:report.cases.reduce((sum,c)=>sum+(c.channels??0),0)};assert.equal(report.totals.exactNumericalCases,86);assert.equal(report.totals.explicitPrefixRejections,2);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 if(server)await server.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.referencesStable=true;for(const [path,digest] of Object.entries(references))if(sha(await readFile(path))!==digest)report.referencesStable=false;
 if(!report.sourceStable||!report.referencesStable)report.status='failed';report.elapsedMs=performance.now()-started;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,totals:report.totals,error:report.error,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;
}
