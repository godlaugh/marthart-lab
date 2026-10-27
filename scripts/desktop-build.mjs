import {packager} from '@electron/packager';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {prepareDesktopGlyph} from './lib/prepare-desktop-glyph.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const {values}=parseArgs({options:{'preview-v2':{type:'boolean'},'glyph-backend':{type:'string'}}});
const preview=values['preview-v2']??false,glyphConfiguration=values['glyph-backend']??process.env.MATHART_GLYPH_BACKEND;
if(!preview&&values['glyph-backend'])throw Error('--glyph-backend packaging requires --preview-v2');
if(preview&&(process.platform!=='darwin'||process.arch!=='arm64'))throw Error('2.0 native preview packaging currently requires this Apple Silicon Mac');
if(preview&&(!glyphConfiguration||!path.isAbsolute(glyphConfiguration)))throw Error('2.0 packaging requires an absolute --glyph-backend configuration (or MATHART_GLYPH_BACKEND) selecting an independent JDK and official JLaTeXMath JAR');
if(preview)await readFile(glyphConfiguration);
const productName=preview?'MathArt Lab 2 Preview':'MathArt Lab',version=preview?'2.0.0-preview.18':manifest.version;
const appBundleId=preview?'local.mathart.lab.preview2':'local.mathart.lab';
async function run(command,args,options={}){await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,stdio:'inherit',...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} failed (${code})`)));});}
await run('npm',['run',preview?'build:v2':'build'],preview?{env:{...process.env,VITE_SOURCE_RENDERER:'native'}}:{});
await mkdir(path.join(root,'.cache'),{recursive:true});
const out=path.join(root,preview?'dist-desktop-v2':'dist-desktop');
let staging,resources,failure;
try{
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'.gitignore'),'*\n');
 staging=await mkdtemp(path.join(root,'.cache','desktop-stage-'));
 resources=preview?await mkdtemp(path.join(root,'.cache','desktop-native-')):undefined;
 await mkdir(path.join(staging,'desktop'));await mkdir(path.join(staging,'server'));
 for(const file of ['main.mjs','host.mjs','preload.cjs','storage.mjs','preferences.mjs','graphics.mjs','smoke.mjs','native-backend.mjs','glyph-backend.mjs'])await cp(path.join(root,'desktop',file),path.join(staging,'desktop',file));
 for(const file of ['index.mjs','source-renderer.mjs','source-drawing-protocol.mjs','source-attractor-protocol.mjs','source-roots-point-protocol.mjs','formula-glyph.mjs'])await cp(path.join(root,'server',file),path.join(staging,'server',file));
 await cp(path.join(root,preview?'dist-v2':'dist'),path.join(staging,'dist'),{recursive:true});
 let extraResource;
 if(preview){
  const directory=path.join(resources,'source-renderer'),executable=path.join(directory,'source-cgl-renderer');await mkdir(directory);
  await run('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executable]);
  await run('/usr/bin/codesign',['--force','--sign','-',executable]);
  const sha256=createHash('sha256').update(await readFile(executable)).digest('hex');
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,platform:process.platform,arch:process.arch,executable:'source-cgl-renderer',sha256},null,2)+'\n');extraResource=[directory];
  await writeFile(path.join(resources,'preview-entitlements.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>\n');
  extraResource.push(await prepareDesktopGlyph({configuration:glyphConfiguration,resources,root,run}));
 }
 await writeFile(path.join(staging,'package.json'),JSON.stringify({name:manifest.name,productName,version,...(preview?{mathartRuntime:{sourceRenderer:'bundled-native',formulaGlyph:'bundled-java',preview:true}}:{}),private:true,type:'module',main:'desktop/main.mjs'},null,2));
 // The helper is already signed and its digest is pinned in the resource manifest.
 // Preserve that seal while signing Electron's nested code and the outer bundle.
 const osxSign=preview?{identity:'-',identityValidation:false,preEmbedProvisioningProfile:false,preAutoEntitlements:false,optionsForFile:()=>({entitlements:path.join(resources,'preview-entitlements.plist'),hardenedRuntime:false,timestamp:'none'}),ignore:file=>file.endsWith('/Contents/Resources/source-renderer/source-cgl-renderer')}:undefined;
 const apps=await packager({dir:staging,out,name:productName,platform:process.platform,arch:process.arch,electronVersion:manifest.devDependencies.electron,asar:true,prune:false,overwrite:true,extraResource,osxSign,appBundleId,appCategoryType:'public.app-category.graphics-design'});
 if(preview)for(const directory of apps){
  const native=path.join(directory,productName+'.app','Contents','Resources','source-renderer'),sealed=JSON.parse(await readFile(path.join(native,'manifest.json'),'utf8'));
  if(createHash('sha256').update(await readFile(path.join(native,'source-cgl-renderer'))).digest('hex')!==sealed.sha256)throw new Error('Packaged native helper changed after manifest sealing');
 }
 await writeFile(path.join(out,'build.json'),JSON.stringify({createdAt:new Date().toISOString(),version,productName,appBundleId,sourceRenderer:preview?'bundled-native':'webgl',formulaGlyph:preview?'bundled-java':'unconfigured',electronVersion:manifest.devDependencies.electron,platform:process.platform,arch:process.arch,apps},null,2)+'\n');
 for(const app of apps)console.log(`Desktop package: ${app}`);
}catch(error){failure=error;}
const cleanup=await Promise.allSettled([staging,resources].filter(Boolean).map(async directory=>{try{await rm(directory,{recursive:true,force:true});}catch(error){throw new Error(`Build temporary directory retained: ${directory}`,{cause:error});}}));
const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason);
if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'Desktop build cleanup failed');
if(failure)throw failure;
