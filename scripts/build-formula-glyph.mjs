import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Dependencies must be explicitly supplied from independent sources. This
// build never downloads software, searches MathArt.app, or changes system Java.
const {values}=parseArgs({options:{'java-home':{type:'string'},jar:{type:'string'},out:{type:'string'}}});
for(const key of ['java-home','jar','out'])if(!values[key]||!path.isAbsolute(values[key]))throw new Error(`--${key} requires an absolute path`);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),source=path.join(root,'server/glyph/FormulaGlyph.java');
if((await stat(values.jar)).size!==669575)throw new Error('Unexpected JLaTeXMath artifact size');
const jar=await readFile(values.jar),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(sha(jar)!=='6d04c3843fc98d2eea9ba4cff0be7b80540ca75c5a4e0b3463fd1219c48cc65d')throw new Error('Expected the unmodified official JLaTeXMath 1.0.7 artifact');
try{await stat(values.out);throw new Error('Output directory already exists; select a new build directory');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(path.dirname(values.out),{recursive:true});await mkdir(values.out);
const env={...process.env};delete env.JAVA_TOOL_OPTIONS;delete env.JDK_JAVA_OPTIONS;delete env._JAVA_OPTIONS;delete env.CLASSPATH;
async function run(tool,args){await new Promise((resolve,reject)=>{
 const child=spawn(path.join(values['java-home'],'bin',tool),args,{stdio:'inherit',env});
 let timedOut=false,killTimer;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);},30000);
 child.once('error',reject);child.once('close',code=>{clearTimeout(timer);clearTimeout(killTimer);if(code===0&&!timedOut)resolve();else reject(new Error(`Glyph ${tool} failed (${timedOut?'timeout':code})`));});
});}
await run('javac',['--release','21','-encoding','UTF-8','-cp',values.jar,'-d',values.out,source]);
const helperJarPath=path.join(values.out,'mathart-lab-glyph.jar');
await run('jar',['--create','--file',helperJarPath,'-C',values.out,'mathartlab']);
const manifest={schemaVersion:1,javaHome:values['java-home'],jarPath:values.jar,helperJarPath,jarSha256:sha(jar),helperJarSha256:sha(await readFile(helperJarPath)),sourceSha256:sha(await readFile(source)),entryClass:'mathartlab.glyph.FormulaGlyph',protocol:'MAG1',fontSize:50};
await writeFile(path.join(values.out,'backend.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest));
