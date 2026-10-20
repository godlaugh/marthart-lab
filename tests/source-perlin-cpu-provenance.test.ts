import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {importSourcePerlinCpuDocument} from '../src/engine/sourcePerlinCpuDocument';
import {SOURCE_PERLIN_CPU_NUMBER_FIELDS,SOURCE_PERLIN_NUMBER_FIELDS} from '../src/engine/sourcePerlinFields';
import {parseSourceNumberTokens} from '../src/engine/sourceNumberTokens';

// Unmodified data/Noise/noise.json from MathArt 1.7.8 JAR SHA256
// a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
const raw=readFileSync(new URL('./fixtures/source-perlin/native-noise.json',import.meta.url),'utf8');
const source=JSON.parse(raw);
const key=(path:readonly string[])=>path.join('.');

describe('Perlin CPU source numeric provenance persistence',()=>{
 it('roundtrips the unmodified pinned original CPU scene and every consumed numeric slot',()=>{
  expect(createHash('sha256').update(raw).digest('hex')).toBe('23ff0614d41df337db84b1a170987ef5eae8b07bd4d9224b5d9fc88a87e35879');
  const imported=parseProjectFile(raw).scene,config=importSourcePerlinCpuDocument(source.settings,source.palette);
  expect(config.ok).toBe(true);if(!config.ok)return;
  const paths=new Set(imported.provenance!.sourceNumberTokens!.map(row=>key(row.path)));
  for(const path of config.value.numericPaths)expect(paths.has(key(path)),key(path)).toBe(true);
  expect(paths.has('settings.particle_count')).toBe(true);expect(paths.has('settings.noise_scale')).toBe(true);
  expect(imported.perlinCpuSource).toMatchObject({seed:'1771842692935',particles:{count:6500,flowMode:'SWIRL_FIELD'},parameters:{noise_scale:10}});
  const text=serializeScene(imported),reopened=parseScene(text);
  expect(reopened.perlinCpuSource).toEqual(imported.perlinCpuSource);
  expect(reopened.provenance?.sourceNumberTokens).toEqual(imported.provenance?.sourceNumberTokens);
  expect(serializeScene(reopened)).toBe(text);
 });
 it('keeps source lexemes after authored canonical edits, for particles and explicit curve variants',()=>{
  for(const style of ['PARTICLES','FIELD_CURVES']){
   const input=structuredClone(source);input.settings.cpu_render_style=style;input.settings.curve_count=8;input.settings.curve_length=24;
   const scene=parseProjectFile(JSON.stringify(input)).scene,originalTokens=structuredClone(scene.provenance!.sourceNumberTokens);
   scene.perlinCpuSource!.particles.count=24;scene.perlinCpuSource!.seed='9007199254740993';
   const reopened=parseScene(serializeScene(scene));
   expect(reopened.perlinCpuSource).toEqual(scene.perlinCpuSource);expect(reopened.provenance!.sourceNumberTokens).toEqual(originalTokens);
  }
 });
 it('registers every CPU importer numeric slot including enum/bool fallback values',()=>{
  const settings=Object.fromEntries(SOURCE_PERLIN_CPU_NUMBER_FIELDS.map(field=>[field,1]));
  const imported=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'numeric CPU slots',type:'PERLIN',settings})).scene;
  const rows=imported.provenance!.sourceNumberTokens!,actual=new Set(rows.filter(row=>row.path[0]==='settings').map(row=>row.path[1]));
  expect([...actual].sort()).toEqual([...SOURCE_PERLIN_CPU_NUMBER_FIELDS].sort());
  expect(parseScene(serializeScene(imported)).provenance!.sourceNumberTokens).toEqual(rows);
 });
 it('keeps the registry scoped to source owner paths, while allowing the full static scope',()=>{
  const rows=SOURCE_PERLIN_NUMBER_FIELDS.map(field=>({path:['settings',field],token:'1'}));
  expect(parseSourceNumberTokens(rows,'perlin')).toEqual(rows);
  expect(()=>parseSourceNumberTokens([{path:['settings','particleCount'],token:'1'}],'perlin')).toThrow('字段路径');
  const scope=Array.from({length:8192},(_,i)=>({path:['parameters','p'+i],token:'1'}));
  expect(parseSourceNumberTokens([...scope,...rows,...['phi','theta','gamma'].map(field=>({path:['camera',field],token:'0'}))],'perlin')).toHaveLength(8195+rows.length);
 });
});
