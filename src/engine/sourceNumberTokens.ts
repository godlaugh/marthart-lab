import type {SceneDocument} from '../types';
import {ROOTS_BATCH_SIZE_SOURCE_PATHS,ROOTS_PRESENTATION_INTEGER_PATHS,ROOTS_PRESENTATION_SCALAR_PATHS} from './rootsSourceFields';
import {ROOTS_GRADIENT_SOURCE_FIELDS,rootsGradientSourcePayload} from './rootsGradientConfig';
import {SOURCE_JSON_LIMITS} from './sourceJson';
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
 * field and timeline registrations below remain Roots-only. */
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
/** Global resolution and consumed Roots background, seed, batch and spatial
 * lexemes, plus bounded Roots timeline slots (which may be dormant). This does not
 * assert lossless numeric lexemes for the whole source document. */
export function parseSourceNumberTokens(raw:unknown,sceneKind:SceneDocument['kind']='roots'):SourceNumberToken[]{
 const roots=sceneKind==='roots',maximum=projectFields.size+(roots?maxConsumedFields+maxTimelineFields:0);
 if(!Array.isArray(raw)||raw.length>maximum)throw new Error(`源数字词法记录必须是最多 ${maximum} 项的数组`);
 const seen=new Set<string>(),gradientPayloads=new Map<string,string>();let totalCharacters=0;
 // Preserve the existing independent static-field bound; timeline records do
 // not increase capacity for duplicate or unrelated spatial fields.
 if(raw.filter(value=>value&&typeof value==='object'&&Array.isArray(value.path)&&value.path[0]!=='timeline'&&!projectFields.has(JSON.stringify(value.path))).length>maxConsumedFields)
  throw new Error(`源静态数字词法记录必须是最多 ${maxConsumedFields} 项的数组`);
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('源数字词法记录无效');
  const {path,token}=value as {path?:unknown;token?:unknown};
  const kind=Array.isArray(path)?projectFields.get(JSON.stringify(path))??(roots?(path.length===2?consumedFields.get(JSON.stringify(path)):timelineField(path)?JSON.stringify(path):undefined):undefined):undefined;
  if(!kind||!Array.isArray(path))throw new Error('源数字词法记录的字段路径无效');
  if(path[0]==='timeline'&&path[2]==='actions'&&path[4]==='args'&&gradientField(path[path.length-1])){
   const action=JSON.stringify(path.slice(0,5)),payload=JSON.stringify(path.slice(0,-1)),previous=gradientPayloads.get(action);
   if(previous!==undefined&&previous!==payload)throw new Error('一个源渐变动作只能保留首个对象的数字词法');
   gradientPayloads.set(action,payload);
  }
  if(seen.has(kind))throw new Error('源数字词法记录不得重复同一消费字段');seen.add(kind);
  if(typeof token!=='string'||token.length>MAX_SOURCE_NUMBER_TOKEN_TEXT||!sourceNumberTokenValid(token))throw new Error('源数字词法记录必须保留有效 JSON 数字且不超过 8 MiB');
  totalCharacters+=token.length;if(totalCharacters>MAX_SOURCE_NUMBER_TOKEN_TEXT)throw new Error('源数字词法记录总文本超过 8 MiB 输入容量');
  return{path:[...path],token};
 });
}
