import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadBundledFormulaGlyphBackend} from './glyph-backend.mjs';
const valid=()=>({schemaVersion:1,platform:'darwin',arch:'arm64',runtime:'runtime',jar:'jlatexmath-1.0.7.jar',helper:'mathart-lab-glyph.jar',helperJarSha256:'12'.repeat(32)});
async function fixture(value,run){
 const resourcesPath=await mkdtemp(path.join(tmpdir(),'mathart-bundled-glyph-')),directory=path.join(resourcesPath,'formula-glyph');
 try{await mkdir(directory);await writeFile(path.join(directory,'manifest.json'),value instanceof Uint8Array?value:JSON.stringify(value));await run({directory,load:()=>loadBundledFormulaGlyphBackend({resourcesPath,platform:'darwin',arch:'arm64'})});}finally{await rm(resourcesPath,{recursive:true,force:true});}
}
test('fixed relative resources relocate together and pass the helper pin to its owner',async()=>{
 await fixture(valid(),async({directory,load})=>assert.deepEqual(await load(),{javaHome:path.join(directory,'runtime'),jarPath:path.join(directory,'jlatexmath-1.0.7.jar'),helperJarPath:path.join(directory,'mathart-lab-glyph.jar'),helperJarSha256:'12'.repeat(32)}));
});
for(const [name,value] of [
 ['null',null],['array',[]],['schema',{...valid(),schemaVersion:2}],['platform',{...valid(),platform:'linux'}],['architecture',{...valid(),arch:'x64'}],
 ['runtime traversal',{...valid(),runtime:'../runtime'}],['absolute jar',{...valid(),jar:'/tmp/jlatexmath-1.0.7.jar'}],['alternate helper',{...valid(),helper:'other.jar'}],
 ['missing pin',Object.fromEntries(Object.entries(valid()).filter(([key])=>key!=='helperJarSha256'))],['invalid pin',{...valid(),helperJarSha256:'AB'.repeat(32)}],['extra field',{...valid(),download:true}],
 ])test('rejects ambiguous glyph package '+name,async()=>fixture(value,async({load})=>assert.rejects(load(),/manifest 格式/)));
test('rejects invalid UTF8 and missing manifest without fallback',async()=>{
 await fixture(Buffer.from([0xff]),async({directory,load})=>{await assert.rejects(load(),/无法读取/);await rm(path.join(directory,'manifest.json'));await assert.rejects(load(),/无法读取/);});
});
test('requires absolute resources and the supported host',async()=>{
 for(const resourcesPath of ['relative','file:///Applications/Preview.app','/tmp/has\0nul'])await assert.rejects(loadBundledFormulaGlyphBackend({resourcesPath,platform:'darwin',arch:'arm64'}),/绝对路径/);
 for(const [platform,arch] of [['darwin','x64'],['linux','arm64']])await assert.rejects(loadBundledFormulaGlyphBackend({resourcesPath:'/missing',platform,arch}),/Apple Silicon/);
});
