import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const STORAGE_KEYS=['mathart-lab-v1','mathart-lab-v1-backup','mathart-lab-v1-recovery'];
export async function atomicWrite(target,text){const temporary=target+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}}
export function validateStorage(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('工作区快照无效');
 const result={};let size=0;
 for(const [key,text] of Object.entries(value)){if(!STORAGE_KEYS.includes(key)||typeof text!=='string')throw new Error('工作区快照字段无效');size+=Buffer.byteLength(text);if(size>32*1024**2)throw new Error('工作区快照超过32 MiB');result[key]=text;}
 return result;
}
export async function createWorkspaceStore(userData){
 await mkdir(userData,{recursive:true});const file=path.join(userData,'workspace-storage.json');let current={},pending=null,running=null,error=null,corrupt;
 try{const bytes=await readFile(file,'utf8');try{current=validateStorage(JSON.parse(bytes));}catch{corrupt=bytes;try{current=validateStorage(JSON.parse(await readFile(file+'.backup','utf8')));}catch{}}}catch(e){if(e.code!=='ENOENT')throw e;}
 async function drain(){
  while(pending!==null){const next=pending;pending=null;
   if(corrupt!==undefined){await atomicWrite(file+'.recovery-'+Date.now(),corrupt);corrupt=undefined;}
   await atomicWrite(file+'.backup',JSON.stringify(current));await atomicWrite(file,next);current=JSON.parse(next);error=null;
  }
 }
 return {read:()=>structuredClone(current),
  save(value){const text=JSON.stringify(validateStorage(value));if(text===JSON.stringify(current)&&pending===null)return running??Promise.resolve();pending=text;
   if(!running)running=drain().catch(e=>{error=e;throw e;}).finally(()=>{running=null;});return running;},
  async flush(){if(running)await running;if(error)throw error;}
 };
}
