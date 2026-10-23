/** Derive a diagnostic host from the acceptance probe without editing its source. */
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
if(!process.argv[2])throw Error('Usage: node prepare-native.mjs NEW_OUTPUT_DIRECTORY');
const out=path.resolve(process.argv[2]);await mkdir(out);
let source=await readFile(new URL('../source-bouncing-native-animation/NativeSceneProbe.java',import.meta.url),'utf8');
function replaceOnce(before,after){if(source.split(before).length!==2)throw Error('Probe boundary changed: '+before);source=source.replace(before,after);}
replaceOnce('warm<63','warm<54');
replaceOnce('Files.writeString(frameOutput.resolve("point-draw.json"),draw.toString());ordinal[0]++;','Files.writeString(frameOutput.resolve("point-draw.json"),draw.toString());if((frame==8||frame==23||frame==38||frame==53)&&draw.getJSONArray("viewport").getInt(2)==500)NativeBlendDiagnostic.capture(underlying,output,frame);ordinal[0]++;');
await writeFile(out+'/NativeSceneProbe.java',source,{flag:'wx'});
await copyFile(new URL('./NativeBlendDiagnostic.java',import.meta.url),out+'/NativeBlendDiagnostic.java');
console.log(out);
