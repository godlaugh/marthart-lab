import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Local source-artifact probe, not a repository test fixture or full-count
// benchmark. All original values remain in the import result's source object.
const sourcePath=new URL('../../.cache/mathart-investigation/original-presets.json',import.meta.url);
const raw=await readFile(sourcePath,'utf8'),presets=JSON.parse(raw),server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try{
 const {parseLegacyScene}=await server.ssrLoadModule('/src/engine/legacyImport.ts');
 const {parseScene}=await server.ssrLoadModule('/src/engine/document.ts');
 const {initializeSamilaTone}=await server.ssrLoadModule('/src/engine/samilaTone.ts');
 const {generateScene}=await server.ssrLoadModule('/src/engine/temporal.ts');
 const context={time:0,width:32,height:24,quality:'export'},rows=[];
 for(const [path,source]of Object.entries(presets).filter(([p])=>p.toLowerCase().includes('/samila/'))){
  const imported=parseLegacyScene(JSON.stringify(source));assert.deepEqual(imported.source,source);
  const scene=imported.scene,normalized={};
  for(const [old,key]of [['brightness','normalizedBrightness'],['contrast','normalizedContrast'],['gamma','normalizedGamma'],['dynamic_range','normalizedDynamicRange'],['saturation','normalizedSaturation']]){assert.equal(scene.settings[key],source.settings[old]);normalized[key]=scene.settings[key];}
  assert.notEqual(scene.settings.densityToneModel,'samila-normalized-v2');assert.equal(scene.settings.samilaHistoryModel,'legacy-v1');
  const sourceBatch=scene.settings.batchSize;Object.assign(scene.settings,{batchSize:64,iteratedBackend:'cpu'});
  const initial=generateScene(scene,context);assert.equal(initial.type,'raster');assert.equal(initial.stats.samples,64);
  const restored=parseScene(JSON.stringify(scene));assert.deepEqual(generateScene(restored,context).pixels,initial.pixels);
  restored.settings=initializeSamilaTone(restored.settings);const enabled=generateScene(restored,context);assert.equal(enabled.type,'raster');assert.equal(enabled.stats.samples,64);assert.deepEqual(generateScene(parseScene(JSON.stringify(restored)),context).pixels,enabled.pixels);
  restored.settings.densityToneModel='white-point-v1';restored.settings.samilaHistoryModel='legacy-v1';assert.deepEqual(generateScene(restored,context).pixels,initial.pixels);
  rows.push({path,status:'passed',sourceBatch,probeBatch:64,normalized,legacyGenerated:initial.stats.generated,v2Generated:enabled.stats.generated,backend:enabled.backend,warningCount:imported.warnings.length,sourceRetained:true,saveLoadPixelExact:true,revertPixelExact:true});
 }
 assert.equal(rows.length,5);
 const snapshots=[];for(const file of ['src/engine/samilaTone.ts','src/engine/samilaToneImport.ts','src/engine/legacyImport.ts','src/engine/density.ts'])snapshots.push({path:'studio/'+file,sha256:createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')});
 const report={status:'passed',at:new Date().toISOString(),sourcePath:sourcePath.pathname,sourceSha256:createHash('sha256').update(raw).digest('hex'),context,rows,sourceSnapshots:snapshots,limits:['Actual production import/generate/save-load/revert, with explicit local probe batch 64 instead of original million-particle counts. This is not a capacity benchmark.','All source tone values are preserved; constructor absence/default cases are covered separately by production-boundary unit tests.','Native application not executed. No native color, point-size, palette or pixel equivalence claim.']};
 await writeFile(new URL('../.cache/samila-tone-import-presets-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await server.close();}
