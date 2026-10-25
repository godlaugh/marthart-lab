import path from 'node:path';
import {readFile} from 'node:fs/promises';

const keys=['schemaVersion','platform','arch','runtime','jar','helper','helperJarSha256'];
/** Resource names are fixed by this packaging format. The service owns actual
 * file identity, the upstream library pin, helper digest and child lifetime. */
export async function loadBundledFormulaGlyphBackend({resourcesPath,platform=process.platform,arch=process.arch}){
 if(typeof resourcesPath!=='string'||!path.isAbsolute(resourcesPath)||resourcesPath.includes('\0'))throw Error('包内公式资源目录必须是绝对路径');
 if(platform!=='darwin'||arch!=='arm64')throw Error('包内公式服务仅支持 macOS Apple Silicon');
 const directory=path.join(resourcesPath,'formula-glyph');let manifest;
 try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path.join(directory,'manifest.json'))));}
 catch(error){throw new Error('无法读取包内公式 manifest',{cause:error});}
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.keys(manifest).length!==keys.length||keys.some(key=>!Object.hasOwn(manifest,key))||manifest.schemaVersion!==1||manifest.platform!==platform||manifest.arch!==arch||manifest.runtime!=='runtime'||manifest.jar!=='jlatexmath-1.0.7.jar'||manifest.helper!=='mathart-lab-glyph.jar'||typeof manifest.helperJarSha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.helperJarSha256))throw Error('包内公式 manifest 格式或平台不匹配');
 return{javaHome:path.join(directory,manifest.runtime),jarPath:path.join(directory,manifest.jar),helperJarPath:path.join(directory,manifest.helper),helperJarSha256:manifest.helperJarSha256};
}
