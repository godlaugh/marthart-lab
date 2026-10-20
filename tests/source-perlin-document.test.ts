import {describe,it,expect} from 'vitest';
import {importSourcePerlinDocument,parseSourcePerlinDocument,migrateSourcePerlinDocument} from '../src/engine/sourcePerlinDocument';
import {sourcePerlinCpuConfiguration,sourcePerlinGpuConfiguration,usesSourcePerlinCpu,usesSourcePerlinGpu} from '../src/engine/sourcePerlinIdentity';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import type {SceneDocument} from '../src/types';
const source=()=>({config_version:'1.0.0',type:'PERLIN',name:'Complete Perlin',settings:{render_mode:'GPU',seed:'123',particle_count:7,curve_count:5,gpu_brightness:2,gpu_texture_style:3,noise_scale:.01},palette:['#80112233'],timeline:[{type:'wait',duration:1}]});
const imported=()=>parseProjectFile(JSON.stringify(source())).scene;
function legacy(backend:'cpu'|'gpu',scene=imported()):SceneDocument{
 const configuration=scene.perlinSource!;
 if(backend==='cpu')scene.perlinCpuSource=sourcePerlinCpuConfiguration(scene);
 else scene.perlinGpuSource=sourcePerlinGpuConfiguration(scene);
 delete scene.perlinSource;
 expect(configuration).toBeDefined();return scene;
}
describe('single authored source Perlin configuration',()=>{
 it('imports both settings and each common source slot only once with numeric provenance',()=>{
  const result=importSourcePerlinDocument(source().settings,source().palette);
  expect(result.ok).toBe(true);if(!result.ok)return;
  const c=result.value.configuration;
  expect(c).toMatchObject({backend:'gpu',seed:'123',particles:{count:7},curves:{count:5},parameters:{noise_scale:10},gpu:{textureStyle:3,uniforms:{brightness:2}}});
  for(const path of [['settings','seed'],['settings','noise_scale'],['settings','render_mode'],['palette']])expect(result.value.consumedPaths.filter(value=>value.join('.')===path.join('.'))).toHaveLength(1);
  expect(result.value.numericPaths).toContainEqual(['settings','particle_count']);
  expect(result.value.numericPaths).toContainEqual(['settings','gpu_brightness']);
  expect(parseSourcePerlinDocument(c)).toEqual({ok:true,value:c});
 });
 it('uses one authored common owner across backend projections and save/reopen',()=>{
  const scene=imported();expect(scene.perlinCpuSource).toBeUndefined();expect(scene.perlinGpuSource).toBeUndefined();
  scene.perlinSource!.seed='-9223372036854775808';scene.perlinSource!.parameters={...scene.perlinSource!.parameters,noise_scale:.001};
  scene.perlinSource!.palette=[0xffabcdef];scene.perlinSource!.cpuStyle='field-curves';
  scene.perlinSource!.particles.count=11;scene.perlinSource!.gpu.uniforms={...scene.perlinSource!.gpu.uniforms,brightness:3};
  for(const backend of ['cpu','gpu','cpu'] as const){
   scene.perlinSource!.backend=backend;
   const reopened=parseScene(serializeScene(scene));expect(reopened.perlinSource).toEqual({...scene.perlinSource,parameters:{...scene.perlinSource!.parameters,noise_scale:Math.fround(.001)}});
   const cpu=sourcePerlinCpuConfiguration(reopened)!,gpu=sourcePerlinGpuConfiguration(reopened)!;
   for(const key of ['seed','palette','parameters','cpuStyle'] as const)expect(cpu[key]).toEqual(gpu[key]);
   expect(cpu.particles.count).toBe(11);expect(gpu.uniforms.brightness).toBe(3);
   expect(usesSourcePerlinCpu(reopened)).toBe(backend==='cpu');expect(usesSourcePerlinGpu(reopened)).toBe(backend==='gpu');
  }
 });
 it('rejects malformed complete payloads and negative constructor particle allocation even for GPU',()=>{
  const value=imported().perlinSource!;
  for(const invalid of [{...value,backend:'auto'},{...value,extra:1},{...value,gpu:{}},{...value,particles:{...value.particles,count:-1}}])expect(parseSourcePerlinDocument(invalid).ok).toBe(false);
  expect(importSourcePerlinDocument({...source().settings,particle_count:-1},source().palette)).toMatchObject({ok:false,error:{kind:'unsupported',path:['settings','particle_count']}});
 });
 it('retains independent CPU/GPU numeric lexemes through public save/reopen',()=>{
  const raw=JSON.stringify({...source(),settings:{...source().settings,particle_count:4294967297,gpu_texture_style:4294967297}}).replace('"gpu_texture_style":4294967297','"gpu_texture_style":4294967297.0');
  const scene=parseProjectFile(raw).scene;
  expect(scene.perlinSource!.particles.count).toBe(1);expect(scene.perlinSource!.gpu.textureStyle).toBe(2147483647);
  const reopened=parseScene(serializeScene(scene));expect(reopened.perlinSource).toEqual(scene.perlinSource);expect(reopened.provenance?.sourceNumberTokens).toEqual(scene.provenance?.sourceNumberTokens);
 });
 it('upgrades CPU legacy with current edits intact and recovers only GPU settings from original evidence',()=>{
  const old=legacy('cpu');old.perlinCpuSource!.seed='999';old.perlinCpuSource!.particles.count=23;
  old.perlinCpuSource!.parameters={...old.perlinCpuSource!.parameters,noise_scale:.001};old.perlinCpuSource!.palette=[0xff876543];
  // Missing original seed and changed common values cannot affect authored edits.
  const original=old.provenance!.original as ReturnType<typeof source>;delete (original.settings as Partial<typeof original.settings>).seed;original.palette=['#000000'];
  const reopened=parseScene(serializeScene(old));expect(reopened.perlinCpuSource).toBeUndefined();
  expect(reopened.perlinSource).toMatchObject({backend:'cpu',seed:'999',palette:[0xff876543],particles:{count:23},parameters:{noise_scale:Math.fround(.001)},gpu:{textureStyle:3,uniforms:{brightness:2}}});
  expect(parseScene(serializeScene(reopened)).perlinSource).toEqual(reopened.perlinSource);
 });
 it('upgrades GPU legacy while keeping every edited GPU/shared field and recovering CPU fields only',()=>{
  const old=legacy('gpu');old.perlinGpuSource!.seed='456';old.perlinGpuSource!.textureStyle=5;old.perlinGpuSource!.uniforms={...old.perlinGpuSource!.uniforms,brightness:8};old.perlinGpuSource!.cpuStyle='field-curves';
  const reopened=parseScene(serializeScene(old));expect(reopened.perlinGpuSource).toBeUndefined();
  expect(reopened.perlinSource).toMatchObject({backend:'gpu',seed:'456',cpuStyle:'field-curves',particles:{count:7},curves:{count:5},gpu:{textureStyle:5,uniforms:{brightness:8}}});
 });
 it('keeps legacy-only readable without provenance and never invents missing settings',()=>{
  for(const backend of ['cpu','gpu'] as const){
   const old=legacy(backend);delete old.provenance;
   const reopened=parseScene(serializeScene(old));expect(reopened.perlinSource).toBeUndefined();expect(migrateSourcePerlinDocument(reopened)).toMatchObject({status:'legacy-only',backend});
   expect(backend==='cpu'?sourcePerlinGpuConfiguration(reopened):sourcePerlinCpuConfiguration(reopened)).toBeUndefined();
   expect(backend==='cpu'?sourcePerlinCpuConfiguration(reopened):sourcePerlinGpuConfiguration(reopened)).toBeDefined();
  }
 });
 it('does not fabricate recovery from wrong provenance, ambiguous large integers or stale tokens',()=>{
  const wrong=legacy('cpu');(wrong.provenance!.original as {type:string}).type='SURFACE';
  expect(parseScene(serializeScene(wrong)).perlinSource).toBeUndefined();
  const unknown=legacy('cpu');(unknown.provenance!.original as ReturnType<typeof source>).settings.gpu_texture_style=4294967297;
  unknown.provenance!.sourceNumberTokens=unknown.provenance!.sourceNumberTokens!.filter(item=>item.path.join('.')!=='settings.gpu_texture_style');
  expect(parseScene(serializeScene(unknown)).perlinSource).toBeUndefined();
  const stale=legacy('gpu');stale.provenance!.sourceNumberTokens!.find(item=>item.path.join('.')==='settings.particle_count')!.token='99';
  expect(parseScene(serializeScene(stale)).perlinSource).toBeUndefined();
  const float=legacy('cpu');float.provenance!.sourceNumberTokens!.find(item=>item.path.join('.')==='settings.gpu_brightness')!.token='99';
  expect(parseScene(serializeScene(float)).perlinSource).toBeUndefined();
 });
 it('retains legacy GPU compatibility when recovered CPU initialization is unusable or color spelling is unknown',()=>{
  const negative=legacy('gpu');(negative.provenance!.original as ReturnType<typeof source>).settings.particle_count=-1;
  negative.provenance!.sourceNumberTokens=negative.provenance!.sourceNumberTokens!.filter(item=>item.path.join('.')!=='settings.particle_count');
  const reopened=parseScene(serializeScene(negative));expect(reopened.perlinSource).toBeUndefined();expect(reopened.perlinGpuSource).toEqual(negative.perlinGpuSource);
  expect(migrateSourcePerlinDocument(reopened)).toMatchObject({status:'legacy-only',reason:expect.stringContaining('负粒子')});
  const color=legacy('gpu');Object.assign((color.provenance!.original as ReturnType<typeof source>).settings,{background_color:1});
  expect(parseScene(serializeScene(color)).perlinSource).toBeUndefined();
 });
 it('rejects ambiguous mixed owners and misplaced complete data at the document boundary',()=>{
  const scene=imported();
  expect(()=>parseScene(serializeScene({...scene,perlinCpuSource:sourcePerlinCpuConfiguration(scene)}))).toThrow(/一个活动/);
  const old=legacy('cpu');old.perlinGpuSource=sourcePerlinGpuConfiguration(scene);
  expect(()=>parseScene(serializeScene(old))).toThrow(/一个活动/);
  expect(()=>parseScene(serializeScene({...scene,kind:'surface',provenance:undefined}))).toThrow(/Perlin/);
 });
});
