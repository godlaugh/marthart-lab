import type {SceneDocument} from '../types';
import {ROOTS_BATCH_SIZE_SOURCE_PATHS,ROOTS_PRESENTATION_INTEGER_PATHS,ROOTS_PRESENTATION_SCALAR_PATHS} from './rootsSourceFields';
import {ROOTS_GRADIENT_SOURCE_FIELDS,rootsGradientSourcePayload} from './rootsGradientConfig';
import {SOURCE_JSON_LIMITS} from './sourceJson';
import {ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS} from './ordinarySourceCameraImport';
export type SourceNumberToken=NonNullable<NonNullable<SceneDocument['provenance']>['sourceNumberTokens']>[number];
export const MAX_SOURCE_NUMBER_TOKEN_TEXT=8*1024*1024;
/** JSON primitive grammar only; no rounding or number-class guessing. */
export function sourceNumberTokenValid(text:string):boolean{return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(text);}
const consumedFields = new Map<string,string>([
 [JSON.stringify(['settings','background_color']),'background'],
 [JSON.stringify(['settings','backgroundColor']),'background'],
 [JSON.stringify(['sampling','seed']),'seed'],
 ...ROOTS_BATCH_SIZE_SOURCE_PATHS.map(path=>[JSON.stringify(path),'batch-size'] as [string,string]),
 ...[...ROOTS_PRESENTATION_SCALAR_PATHS,...ROOTS_PRESENTATION_INTEGER_PATHS].map(path=>[JSON.stringify(path),JSON.stringify(path)] as [string,string]),
]);
/** These two exact paths apply to every source project family. All existing
 * Roots and ordinary camera registrations below remain family-specific. */
export const PROJECT_RESOLUTION_SOURCE_NUMBER_PATHS=[['resolution','width'],['resolution','height']] as const;
const projectFields=new Map(PROJECT_RESOLUTION_SOURCE_NUMBER_PATHS.map(path=>[JSON.stringify(path),JSON.stringify(path)]));
const maxConsumedFields = new Set(consumedFields.values()).size;
const maxTimelineClips=1000,maxTimelineActions=64,maxCameraArgs=3;
// A source action can retain its first three numeric camera slots and the six
// fields of its one selected gradient object. A direct numeric args value is
// a mutually exclusive smaller representation. The document serializer owns
// expanded persisted size; this bound only limits registered record counts.
const maxTimelineFields=maxTimelineClips*(1+maxTimelineActions*(maxCameraArgs+ROOTS_GRADIENT_SOURCE_FIELDS.length));
const index=(raw:unknown,limit:number)=>typeof raw==='string'&&/^(?:0|[1-9][0-9]*)$/.test(raw)&&Number(raw)<limit;
const gradientField=(raw:unknown)=>typeof raw==='string'&&(ROOTS_GRADIENT_SOURCE_FIELDS as readonly string[]).includes(raw);
function timelineField(path:readonly unknown[]):boolean {
 return path[0]==='timeline'&&index(path[1],maxTimelineClips)&&(
  path.length===3&&path[2]==='duration'||
  path[2]==='actions'&&index(path[3],maxTimelineActions)&&path[4]==='args'&&(
   path.length===5||path.length===6&&(index(path[5],maxCameraArgs)||gradientField(path[5]))||
   path.length===7&&index(path[5],SOURCE_JSON_LIMITS.nodes)&&gradientField(path[6])));
}
/** Registered camera scalar slots and the selected gradient object, including
 * currently disabled/unknown clips. Retention is not execution: this preserves
 * e.g. -1e999 without granting arbitrary paths or interpreting its value. */
export function* rootsTimelineNumberTokenPaths(raw:readonly unknown[]):Iterable<readonly string[]> {
 for(let i=0;i<Math.min(raw.length,maxTimelineClips);i++){
  const clip=raw[i];if(!clip||typeof clip!=='object'||Array.isArray(clip))continue;
  const record=clip as Record<string,unknown>,path=['timeline',String(i)];
  if(typeof record.duration==='number')yield [...path,'duration'];
  if(!Array.isArray(record.actions))continue;
  for(let j=0;j<Math.min(record.actions.length,maxTimelineActions);j++){
   const action=record.actions[j];if(!action||typeof action!=='object'||Array.isArray(action))continue;
   const item=action as Record<string,unknown>,args=item.args,argPath=[...path,'actions',String(j),'args'];
   if(Array.isArray(args))for(let k=0;k<Math.min(args.length,maxCameraArgs);k++)if(typeof args[k]==='number')yield [...argPath,String(k)];
   if(item.method==='gradientStart'){
    if(typeof args==='number')yield argPath;
    const payload=rootsGradientSourcePayload(args);
    if(payload)for(const field of ROOTS_GRADIENT_SOURCE_FIELDS)if(Object.hasOwn(payload.value,field)&&typeof payload.value[field]==='number')yield [...argPath,...payload.path,field];
   }
  }
 }
}
const ordinaryFamilies=new Set<SceneDocument['kind']>(['surface','implicit','attractor','perlin']);
export const SOURCE_SURFACE_NUMBER_FIELDS=['u_segments','v_segments','u_min','u_max','v_min','v_max','speed_u','speed_v','scale_x','scale_y','scale_z','offset_x','offset_y','offset_z','trail_lifetime','line_weight','dot_size'] as const;
const ordinaryStaticMaximum=3+ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters+SOURCE_SURFACE_NUMBER_FIELDS.length;
// Every retained token requires at least one source JSON value node. Clip and
// action bounds also constrain slots; taking the smaller bound does not grant
// extra source capacity merely because paths repeat in persisted provenance.
const ordinaryMaximum=Math.min(SOURCE_JSON_LIMITS.nodes,projectFields.size+ordinaryStaticMaximum+maxTimelineClips*(4+maxTimelineActions*maxCameraArgs));
function ordinaryField(path:readonly unknown[],family:SceneDocument['kind']):boolean {
 if(family==='surface'&&path.length===2&&path[0]==='settings'&&SOURCE_SURFACE_NUMBER_FIELDS.some(key=>key===path[1]))return true;
 if(path.length===2)return path[0]==='camera'&&typeof path[1]==='string'&&['phi','theta','gamma'].includes(path[1])||path[0]==='parameters'&&typeof path[1]==='string'&&path[1].length<=ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters;
 return path[0]==='timeline'&&index(path[1],maxTimelineClips)&&(path.length===3&&typeof path[2]==='string'&&['duration','target_phi','target_theta','target_gamma'].includes(path[2])||path.length===6&&path[2]==='actions'&&index(path[3],maxTimelineActions)&&path[4]==='args'&&index(path[5],maxCameraArgs));
}
/** Global resolution, Roots presentation/timeline slots and ordinary camera,
 * parameter and timeline scalars. These family-specific registrations do not
 * assert lossless numeric lexemes for the whole source document. */
export function parseSourceNumberTokens(raw:unknown,sceneKind:SceneDocument['kind']='roots'):SourceNumberToken[]{
 const roots=sceneKind==='roots',ordinary=ordinaryFamilies.has(sceneKind),maximum=ordinary?ordinaryMaximum:projectFields.size+(roots?maxConsumedFields+maxTimelineFields:0);
 if(!Array.isArray(raw)||raw.length>maximum)throw new Error(`源数字词法记录必须是最多 ${maximum} 项的数组`);
 const seen=new Set<string>(),gradientPayloads=new Map<string,string>();let totalCharacters=0,parameterNameCharacters=0,parameterCount=0;
 // Preserve the existing independent static-field bound; timeline records do
 // not increase capacity for duplicate or unrelated spatial fields.
 if(raw.filter(value=>value&&typeof value==='object'&&Array.isArray(value.path)&&value.path[0]!=='timeline'&&!projectFields.has(JSON.stringify(value.path))).length>(ordinary?ordinaryStaticMaximum:maxConsumedFields))
  throw new Error(`源静态数字词法记录必须是最多 ${ordinary?ordinaryStaticMaximum:maxConsumedFields} 项的数组`);
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('源数字词法记录无效');
  const {path,token}=value as {path?:unknown;token?:unknown};
  const kind=Array.isArray(path)?projectFields.get(JSON.stringify(path))??(roots?(path.length===2?consumedFields.get(JSON.stringify(path)):timelineField(path)?JSON.stringify(path):undefined):ordinary&&ordinaryField(path,sceneKind)?JSON.stringify(path):undefined):undefined;
  if(!kind||!Array.isArray(path))throw new Error('源数字词法记录的字段路径无效');
  if(roots&&path[0]==='timeline'&&path[2]==='actions'&&path[4]==='args'&&gradientField(path[path.length-1])){
   const action=JSON.stringify(path.slice(0,5)),payload=JSON.stringify(path.slice(0,-1)),previous=gradientPayloads.get(action);
   if(previous!==undefined&&previous!==payload)throw new Error('一个源渐变动作只能保留首个对象的数字词法');
   gradientPayloads.set(action,payload);
  }
  if(ordinary&&path[0]==='parameters'){if(++parameterCount>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters)throw new Error('源参数数字词法超过参数成员容量');parameterNameCharacters+=(path[1] as string).length;if(parameterNameCharacters>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)throw new Error('源参数名总文本超过相机作用域输入容量');}
  if(seen.has(kind))throw new Error('源数字词法记录不得重复同一消费字段');seen.add(kind);
  if(typeof token!=='string'||token.length>MAX_SOURCE_NUMBER_TOKEN_TEXT||!sourceNumberTokenValid(token))throw new Error('源数字词法记录必须保留有效 JSON 数字且不超过 8 MiB');
  totalCharacters+=token.length;if(totalCharacters>MAX_SOURCE_NUMBER_TOKEN_TEXT)throw new Error('源数字词法记录总文本超过 8 MiB 输入容量');
  return{path:[...path],token};
 });
}
