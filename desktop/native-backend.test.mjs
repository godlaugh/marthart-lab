import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadBundledSourceRendererBackend} from './native-backend.mjs';

const valid=()=>({schemaVersion:1,platform:'darwin',arch:'arm64',executable:'source-cgl-renderer',sha256:'12'.repeat(32)});
async function fixture(run,bytes=JSON.stringify(valid())){
 const resourcesPath=await mkdtemp(path.join(tmpdir(),'mathart-bundled-native-'));
 const directory=path.join(resourcesPath,'source-renderer'),manifestPath=path.join(directory,'manifest.json');
 try{await mkdir(directory);if(bytes!==undefined)await writeFile(manifestPath,bytes);await run({resourcesPath,directory,manifestPath,load:(extra={})=>loadBundledSourceRendererBackend({resourcesPath,platform:'darwin',arch:'arm64',...extra})});}
 finally{await rm(resourcesPath,{recursive:true,force:true});}
}

test('resolves the fixed bundled program without launching, modifying or validating its executable',async()=>{
 await fixture(async({directory,manifestPath,load})=>{
  const executable=path.join(directory,'source-cgl-renderer');
  // An unreadied sentinel is not an executable. Its eventual file/hash checks
  // belong to createSourceRendererService, not a second loader implementation.
  const sentinel='This is not a native program.\n';await writeFile(executable,sentinel,{mode:0o600});
  const before=await stat(executable),manifest=await readFile(manifestPath);
  assert.deepEqual(await load(),{executablePath:executable,executableSha256:valid().sha256});
  assert.equal(await readFile(executable,'utf8'),sentinel);assert.deepEqual(await readFile(manifestPath),manifest);
  const after=await stat(executable);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.mode,before.mode);
  assert.deepEqual((await readdir(directory)).sort(),['manifest.json','source-cgl-renderer']);
 });
});
test('does not search or fall back when the fixed manifest is missing',async()=>{
 await fixture(async({manifestPath,directory,load})=>{await rm(manifestPath);await writeFile(path.join(directory,'backend.json'),JSON.stringify(valid()));await assert.rejects(load(),/无法读取/);assert.deepEqual(await readdir(directory),['backend.json']);});
});
test('does not cache a previously accepted manifest across loads',async()=>{
 await fixture(async({manifestPath,load})=>{await load();await writeFile(manifestPath,JSON.stringify({...valid(),sha256:'changed'}));await assert.rejects(load(),/manifest 格式/);});
});
for(const [name,bytes] of [['JSON syntax','{'],['invalid UTF8',Buffer.from([0xff])],['directory',null]])test(`rejects unreadable ${name} manifest`,async()=>{
 await fixture(async({manifestPath,load})=>{if(bytes===null){await rm(manifestPath);await mkdir(manifestPath);}else await writeFile(manifestPath,bytes);await assert.rejects(load(),/无法读取/);});
});
for(const [name,value] of [
 ['null',null],['array',[]],['primitive','native'],['unknown field',{...valid(),download:'https://example.invalid'}],
 ['missing field',Object.fromEntries(Object.entries(valid()).filter(([key])=>key!=='sha256'))],
 ['schema type',{...valid(),schemaVersion:'1'}],['schema version',{...valid(),schemaVersion:2}],
 ['foreign platform',{...valid(),platform:'linux'}],['foreign architecture',{...valid(),arch:'x64'}],
 ['relative traversal',{...valid(),executable:'../source-cgl-renderer'}],['absolute executable',{...valid(),executable:'/tmp/source-cgl-renderer'}],
 ['alternate executable',{...valid(),executable:'source-cgl-renderer-old'}],['uppercase digest',{...valid(),sha256:'AB'.repeat(32)}],
 ['short digest',{...valid(),sha256:'12'}],['nonstring digest',{...valid(),sha256:123}],
 ])test(`rejects ${name} without repairing the packaged metadata`,async()=>{
 await fixture(async({manifestPath,load})=>{const before=await readFile(manifestPath);await assert.rejects(load(),/manifest 格式/);assert.deepEqual(await readFile(manifestPath),before);},JSON.stringify(value));
});
test('rejects relative/file-URL resource roots and unsupported hosts before loading metadata',async()=>{
 for(const resourcesPath of ['relative','file:///Applications/MathArt.app/Contents/Resources','/tmp/has\0nul'])await assert.rejects(loadBundledSourceRendererBackend({resourcesPath,platform:'darwin',arch:'arm64'}),/绝对路径/);
 for(const [platform,arch] of [['linux','arm64'],['darwin','x64'],['win32','arm64']])await assert.rejects(loadBundledSourceRendererBackend({resourcesPath:'/missing/resources',platform,arch}),/macOS Apple Silicon/);
});
