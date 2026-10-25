import path from 'node:path';
import {readFile} from 'node:fs/promises';

const keys=['schemaVersion','platform','arch','executable','sha256'];
/** Load only the explicitly selected bundled profile. The renderer service
 * remains the owner of executable file identity, digest validation and launch;
 * this loader never executes, compiles, downloads or chooses a fallback. */
export async function loadBundledSourceRendererBackend({resourcesPath,platform=process.platform,arch=process.arch}){
 if(typeof resourcesPath!=='string'||!path.isAbsolute(resourcesPath)||resourcesPath.includes('\0'))throw Error('包内原生资源目录必须是绝对路径');
 if(platform!=='darwin'||arch!=='arm64')throw Error('包内原生渲染仅支持 macOS Apple Silicon');
 const directory=path.join(resourcesPath,'source-renderer'),manifestPath=path.join(directory,'manifest.json');
 let manifest;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(manifestPath)));}
 catch(error){throw new Error('无法读取包内原生渲染 manifest',{cause:error});}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.keys(manifest).length!==keys.length||keys.some(key=>!Object.hasOwn(manifest,key))||manifest.schemaVersion!==1||manifest.platform!==platform||manifest.arch!==arch||manifest.executable!=='source-cgl-renderer'||typeof manifest.sha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('包内原生渲染 manifest 格式或平台不匹配');
 return{executablePath:path.join(directory,manifest.executable),executableSha256:manifest.sha256};
}
