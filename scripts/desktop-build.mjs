import {packager} from '@electron/packager';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await new Promise((resolve,reject)=>{const child=spawn('npm',['run','build'],{cwd:root,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Web build failed (${code})`)));});
await mkdir(path.join(root,'.cache'),{recursive:true});
const staging=await mkdtemp(path.join(root,'.cache','desktop-stage-')),out=path.join(root,'dist-desktop');
await mkdir(out,{recursive:true});await writeFile(path.join(out,'.gitignore'),'*\n');
try{
 await mkdir(path.join(staging,'desktop'));await mkdir(path.join(staging,'server'));
 for(const file of ['main.mjs','host.mjs','preload.cjs','storage.mjs','preferences.mjs','graphics.mjs','smoke.mjs'])await cp(path.join(root,'desktop',file),path.join(staging,'desktop',file));
 await cp(path.join(root,'server/index.mjs'),path.join(staging,'server/index.mjs'));
 await cp(path.join(root,'dist'),path.join(staging,'dist'),{recursive:true});
 await writeFile(path.join(staging,'package.json'),JSON.stringify({name:manifest.name,productName:'MathArt Lab',version:manifest.version,private:true,type:'module',main:'desktop/main.mjs'},null,2));
 const apps=await packager({dir:staging,out,name:'MathArt Lab',platform:process.platform,arch:process.arch,electronVersion:manifest.devDependencies.electron,asar:true,prune:false,overwrite:true,appBundleId:'local.mathart.lab',appCategoryType:'public.app-category.graphics-design'});
 await writeFile(path.join(out,'build.json'),JSON.stringify({createdAt:new Date().toISOString(),version:manifest.version,electronVersion:manifest.devDependencies.electron,platform:process.platform,arch:process.arch,apps},null,2)+'\n');
 for(const app of apps)console.log(`Desktop package: ${app}`);
}finally{await rm(staging,{recursive:true,force:true});}
