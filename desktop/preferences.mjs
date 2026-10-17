import path from 'node:path';
import {readFile,mkdir,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {atomicWrite} from './storage.mjs';
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('桌面设置无效');
 for(const key of Object.keys(value))if(!['outputDirectory','ffmpegPath'].includes(key))throw new Error('未知桌面设置');
 for(const [key,item] of Object.entries(value))if(typeof item!=='string'||!path.isAbsolute(item)||item.includes('\0'))throw new Error(`${key} 需要绝对路径`);
 return {...value};
}
/** Paths come from a trusted native picker, never from a renderer-supplied path. */
export async function createDesktopPreferences(userData){
 await mkdir(userData,{recursive:true});const file=path.join(userData,'desktop-preferences.json');let current={},corrupt;
 try{const raw=await readFile(file,'utf8');try{current=validate(JSON.parse(raw));}catch{corrupt=raw;try{current=validate(JSON.parse(await readFile(file+'.backup','utf8')));}catch{}}}catch(error){if(error.code!=='ENOENT')throw error;}
 let queue=Promise.resolve();
 return {
  read(){return {outputDirectory:path.join(userData,'downloads'),...current};},
  save(patch){const nextPatch=validate(patch);const operation=queue.catch(()=>{}).then(async()=>{
   if(nextPatch.outputDirectory){if(!(await stat(nextPatch.outputDirectory)).isDirectory())throw new Error('输出路径必须是文件夹');await access(nextPatch.outputDirectory,constants.W_OK);}
   if(nextPatch.ffmpegPath){if(!(await stat(nextPatch.ffmpegPath)).isFile())throw new Error('FFmpeg 路径必须是可执行文件');await access(nextPatch.ffmpegPath,constants.X_OK);}
   const next={...current,...nextPatch};if(JSON.stringify(next)===JSON.stringify(current))return;
   if(corrupt!==undefined){await atomicWrite(file+'.recovery-'+Date.now(),corrupt);corrupt=undefined;}
   await atomicWrite(file+'.backup',JSON.stringify(current));await atomicWrite(file,JSON.stringify(next));current=next;
  });queue=operation.catch(()=>{});return operation;},
  async flush(){await queue;}
 };
}
