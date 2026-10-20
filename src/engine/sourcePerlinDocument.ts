import type {SceneDocument} from '../types';
import type {SourcePerlinCpuDocumentPayload} from './sourcePerlinCpuDocument';
import type {SourcePerlinGpuDocumentPayload,SourcePerlinGpuSettings} from './sourcePerlinGpuDocument';
import {parseSourcePerlinCpuDocument,readSourcePerlinCpuSettings} from './sourcePerlinCpuDocument';
import {parseSourcePerlinGpuSettings,readSourcePerlinGpuSettings} from './sourcePerlinGpuDocument';
import {attempt,fail,exactKeys,createPerlinConfigReader,readSourcePerlinCommonConfiguration} from './sourcePerlinDocumentConfig';
import type {SourcePerlinDocumentResult,SourcePerlinDocumentImportOptions} from './sourcePerlinDocumentConfig';

/** Both backends retain settings; seed, palette, parameters and CPU style have
 * one authored owner. The native constructor initializes CPU geometry even
 * when the selected display backend is GPU. */
export interface SourcePerlinDocumentPayload extends SourcePerlinCpuDocumentPayload {
 backend:'cpu'|'gpu';
 gpu:SourcePerlinGpuSettings;
}
export interface SourcePerlinDocumentImportFacts {
 configuration:SourcePerlinDocumentPayload;
 consumedPaths:string[][];
 numericPaths:string[][];
 diagnostics:string[];
}
export function parseSourcePerlinDocument(raw:unknown):SourcePerlinDocumentResult<SourcePerlinDocumentPayload>{return attempt(()=>{
 const input=exactKeys(raw,['seed','palette','parameters','cpuStyle','particles','curves','display','backend','gpu'],[]);
 if(input.backend!=='cpu'&&input.backend!=='gpu')return fail('input',['backend'],'未知 Perlin 显示后端');
 const {backend,gpu,...cpu}=input;
 const parsed=parseSourcePerlinCpuDocument(cpu);
 if(!parsed.ok)return fail(parsed.error.kind,parsed.error.path,parsed.error.reason);
 return {...parsed.value,backend:backend as 'cpu'|'gpu',gpu:parseSourcePerlinGpuSettings(gpu)};
});}
/** Exactly one reader owns all original fields and their numeric provenance. */
export function importSourcePerlinDocument(rawSettings:unknown,rawPalette:unknown,options:SourcePerlinDocumentImportOptions={}):SourcePerlinDocumentResult<SourcePerlinDocumentImportFacts>{return attempt(()=>{
 const reader=createPerlinConfigReader(rawSettings,options),backend=reader.backend();
 const configuration={...readSourcePerlinCommonConfiguration(reader,rawPalette),...readSourcePerlinCpuSettings(reader),backend,gpu:readSourcePerlinGpuSettings(reader)};
 if(configuration.cpuStyle==='particles'&&configuration.particles.count<0)return fail('unsupported',['settings','particle_count'],'原版负粒子数在初始化分配时失败，包括 GPU 显示后端');
 return {configuration,consumedPaths:reader.consumedPaths,numericPaths:reader.numericPaths,diagnostics:reader.diagnostics};
});}

export type SourcePerlinLegacyMigration =
 | {status:'complete';configuration:SourcePerlinDocumentPayload}
 | {status:'legacy-only';backend:'cpu'|'gpu';reason:string};
type LegacyScene={perlinCpuSource?:SourcePerlinCpuDocumentPayload;perlinGpuSource?:SourcePerlinGpuDocumentPayload;provenance?:SceneDocument['provenance']};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Upgrade only the missing backend settings from retained original evidence.
 * Current authored fields always win. No clock/default seed or invented source
 * JSON is used. Unsupported/incomplete evidence leaves the old single backend
 * readable, with backend switching unavailable until explicit completion. */
export function migrateSourcePerlinDocument(scene:LegacyScene):SourcePerlinLegacyMigration {
 const cpu=scene.perlinCpuSource,gpu=scene.perlinGpuSource,backend=cpu?'cpu':'gpu';
 const legacy=(reason:string):SourcePerlinLegacyMigration=>({status:'legacy-only',backend,reason});
 if(!!cpu===!!gpu)return legacy('迁移需要且只接受一个旧 Perlin 后端配置');
 const provenance=scene.provenance,source=provenance?.original;
 if(provenance?.kind!=='MathArt Studio'||!record(source)||typeof source.type!=='string'||source.type.toUpperCase()!=='PERLIN')return legacy('缺少可核验的原版 Perlin 来源，保留现有单后端配置');
 // This is the established original-file adapter's accepted format contract.
 if(source.config_version!=='1.0'&&source.config_version!=='1.0.0')return legacy('原版来源配置版本无法核验，保留现有单后端配置');
 const tokens=new Map(provenance.sourceNumberTokens?.map(item=>[JSON.stringify(item.path),item.token]));
 const recovered=attempt(()=>{
  const reader=createPerlinConfigReader(source.settings,{numberToken:path=>tokens.get(JSON.stringify(path))});
  let configuration:SourcePerlinDocumentPayload;
  if(cpu)configuration={...cpu,backend:'cpu',gpu:readSourcePerlinGpuSettings(reader)};
  else {
   const {textureStyle,uniforms,...common}=gpu!;
   configuration={...readSourcePerlinCpuSettings(reader),...common,backend:'gpu',gpu:{textureStyle,uniforms}};
  }
  // Persisted tokens are validated by the outer document owner. Bind every
  // consumed token to this raw source too, including float/fallback slots.
  for(const path of reader.consumedPaths){
   const token=tokens.get(JSON.stringify(path));if(token===undefined)continue;
   let value:unknown=source;for(const key of path)value=record(value)?value[key]:undefined;
   if(typeof value!=='number'||!Object.is(Number(token),value))return fail('input',path,'保留数字 token 与来源值不一致');
  }
  return configuration;
 });
 if(!recovered.ok)return legacy(`缺失后端配置无法从来源恢复：${recovered.error.path.join('.')}: ${recovered.error.reason}`);
 const parsed=parseSourcePerlinDocument(recovered.value);
 return parsed.ok?{status:'complete',configuration:parsed.value}:legacy(`完整配置未通过验证：${parsed.error.path.join('.')}: ${parsed.error.reason}`);
}
