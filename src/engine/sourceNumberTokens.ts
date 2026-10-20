import {SOURCE_PERLIN_NUMBER_FIELDS,SOURCE_PERLIN_PARAMETER_NAMES} from './sourcePerlinFields';
import {SOURCE_SURFACE_PARAMETER_FIELDS,SOURCE_SURFACE_PARAMETER_EDGE_FIELDS} from './sourceSurfaceParameterConfig';
import {SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS} from './sourceSurfaceGradientConfig';
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
const gradientField=(raw:unknown,fields:readonly string[]=ROOTS_GRADIENT_SOURCE_FIELDS)=>typeof raw==='string'&&fields.includes(raw);
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
// Mesh config consumes numeric fallbacks too (e.g. a numeric boolean/color).
// Retention preserves their lexemes without asserting those inputs were active.
export const SOURCE_SURFACE_MESH_NUMBER_FIELDS=['mesh_u_segments','mesh_v_segments','mesh_fill','mesh_wireframe','mesh_fill_opacity','mesh_line_weight','mesh_wireframe_color','mesh_wrap_u','mesh_wrap_v','mesh_wrap_threshold','wireframe_decoupled','wireframe_u_segments','wireframe_v_segments','background_color','show_trails','fade_trails','periodic_u','periodic_v','flowing_u','flowing_v'] as const;
/** Attractor ConfigUtils integer/float reads and source visual fields. GPU
 * authoring remains registered even while the production entry is CPU only. */
export const SOURCE_ATTRACTOR_SETTING_NUMBER_FIELDS=['particle_count','particle_count_cpu','particle_count_gpu','time_step','time_step_min','time_step_max','sub_steps','scale_x','scale_y','scale_z','offset_x','offset_y','offset_z','dot_size','line_weight','trail_lifetime','show_trails','fade_trails','background_color','gpu_exposure','gpu_contrast','gpu_gamma','gpu_saturation','gpu_density_scale','integration_method'] as const;
/** Exact native Bouncing getter slots. The import owner supplies the actual
 * numericPaths; this registry only validates persisted token provenance. String
 * getters can also consume numeric JSON inputs, so their slots remain covered. */
export const SOURCE_BOUNCING_SETTING_NUMBER_FIELDS=[
 'particle_count','sub_steps','time_step','particle_radius','container_shape',
 'circle_center_x','circle_center_y','circle_radius','ellipse_semi_major_axis','ellipse_semi_minor_axis','boundary_center_x','boundary_center_y',
 'initial_position_mode','initial_circle_center_x','initial_circle_center_y','initial_circle_radius','x0_min','x0_max','y0_min','y0_max',
 'initial_speed','initial_velocity_mode','velocity_center_x','velocity_center_y','velocity_noise','initial_angle','initial_angle_spread','seed',
 'shape_inner_ratio','shape_num_points','shape_num_turns','shape_tightness','shape_fill_mode','shape_line_width','shape_lissajous_a','shape_lissajous_b','shape_lissajous_delta','shape_rose_k','shape_superellipse_n','shape_k','shape_formula',
 'dot_size','line_weight','scale_x','scale_y','scale_z','offset_x','offset_y','offset_z','background_color','boundary_color','record_duration',
] as const;
const bouncingSettingFields=new Set<string>(SOURCE_BOUNCING_SETTING_NUMBER_FIELDS);
// One selected polygon, at most 64 examined vertices and two coordinates.
const bouncingStaticMaximum=bouncingSettingFields.size+3+64*2;
function bouncingPolygonPath(path:readonly unknown[]):readonly unknown[]|undefined {
 const parts=path[0]==='polygon'?path.slice(1):path[0]==='settings'&&path[1]==='polygon'?path.slice(2):undefined;
 return parts?.length===2&&index(parts[0],64)&&typeof parts[1]==='string'&&['0','1','x','y'].includes(parts[1])?parts:undefined;
}
function bouncingField(path:readonly unknown[]):boolean {
 return path.length===2&&(path[0]==='settings'&&typeof path[1]==='string'&&bouncingSettingFields.has(path[1])||path[0]==='camera'&&typeof path[1]==='string'&&['phi','theta','gamma'].includes(path[1]))||!!bouncingPolygonPath(path);
}
const attractorSettingFields=new Set<string>(SOURCE_ATTRACTOR_SETTING_NUMBER_FIELDS);
const attractorWarmupFields=new Set(['warmup_steps','warmup_stagger_min','warmup_stagger_max']);
const attractorBoundsFields=new Set(['min_x','max_x','min_y','max_y','min_z','max_z']);
const attractorStaticMaximum=3+ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters+attractorSettingFields.size+attractorWarmupFields.size+attractorBoundsFields.size;
const surfaceStaticFields=new Set<string>([...SOURCE_SURFACE_NUMBER_FIELDS,...SOURCE_SURFACE_MESH_NUMBER_FIELDS]);
const ordinaryStaticMaximum=Math.max(attractorStaticMaximum,3+ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters+SOURCE_SURFACE_NUMBER_FIELDS.length+SOURCE_SURFACE_MESH_NUMBER_FIELDS.length+SOURCE_SURFACE_PARAMETER_EDGE_FIELDS.length);
// Every retained token requires at least one source JSON value node. Clip and
// action bounds also constrain slots; taking the smaller bound does not grant
// extra source capacity merely because paths repeat in persisted provenance.
const ordinaryMaximum=Math.min(SOURCE_JSON_LIMITS.nodes,projectFields.size+ordinaryStaticMaximum+maxTimelineClips*(4+maxTimelineActions*(maxCameraArgs+SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS.length)));
const surfaceParameterField=(raw:unknown)=>typeof raw==='string'&&(SOURCE_SURFACE_PARAMETER_FIELDS as readonly string[]).includes(raw);
const surfaceEdgeField=(raw:unknown)=>typeof raw==='string'&&(SOURCE_SURFACE_PARAMETER_EDGE_FIELDS as readonly string[]).includes(raw);
const surfaceParameterName=(raw:unknown)=>typeof raw==='string'&&raw.length<=ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters;
function surfaceParameterPath(path:readonly unknown[]):boolean {
 if(path.length===3&&path[0]==='settings'&&path[1]==='param_edge_easing'&&surfaceEdgeField(path[2]))return true;
 if(path[0]!=='timeline'||!index(path[1],maxTimelineClips))return false;
 if(path[2]==='parameters')return surfaceParameterName(path[3])&&(path.length===4||path.length===5&&surfaceParameterField(path[4]));
 if(path[2]!=='actions'||!index(path[3],maxTimelineActions)||path[4]!=='args')return false;
 const tail=path.slice(path[5]==='0'?6:5);
 if(tail.length===2&&tail[0]==='edgeEasing'&&surfaceEdgeField(tail[1]))return true;
 return tail[0]==='parameters'&&surfaceParameterName(tail[1])&&(tail.length===2||tail.length===3&&surfaceParameterField(tail[2])||tail.length===4&&tail[2]==='edgeEasing'&&surfaceEdgeField(tail[3]));
}
const perlinFields=new Set<string>(SOURCE_PERLIN_NUMBER_FIELDS);
const perlinStaticMaximum=3+ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters+perlinFields.size;
function perlinParameterPath(path:readonly unknown[]):boolean {
 if(path[0]!=='timeline'||!index(path[1],maxTimelineClips)||path[2]!=='actions'||!index(path[3],maxTimelineActions)||path[4]!=='args')return false;
 const tail=path.slice(path[5]==='0'?6:5);
 return tail.length===3&&tail[0]==='parameters'&&typeof tail[1]==='string'&&(SOURCE_PERLIN_PARAMETER_NAMES as readonly string[]).includes(tail[1])&&['step','min','max'].includes(String(tail[2]));
}
function ordinaryField(path:readonly unknown[],family:SceneDocument['kind']):boolean {
 if(family==='perlin'&&(path.length===2&&path[0]==='settings'&&typeof path[1]==='string'&&perlinFields.has(path[1])||perlinParameterPath(path)))return true;
 if(family==='attractor'&&(path.length===2&&path[0]==='settings'&&typeof path[1]==='string'&&attractorSettingFields.has(path[1])||path.length===2&&path[0]==='initialization'&&typeof path[1]==='string'&&attractorWarmupFields.has(path[1])||path.length===3&&path[0]==='initialization'&&path[1]==='bounds'&&typeof path[2]==='string'&&attractorBoundsFields.has(path[2])))return true;
 if(family==='surface'&&surfaceParameterPath(path))return true;
 if(family==='surface'&&path.length===2&&path[0]==='settings'&&typeof path[1]==='string'&&surfaceStaticFields.has(path[1]))return true;
 if(path.length===2)return path[0]==='camera'&&typeof path[1]==='string'&&['phi','theta','gamma'].includes(path[1])||path[0]==='parameters'&&typeof path[1]==='string'&&path[1].length<=ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters;
 if((family==='surface'||family==='attractor'||family==='perlin')&&path[0]==='timeline'&&index(path[1],maxTimelineClips)&&path[2]==='actions'&&index(path[3],maxTimelineActions)&&path[4]==='args'&&(path.length===5||path.length===6&&gradientField(path[5],SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS)||path.length===7&&path[5]==='0'&&gradientField(path[6],SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS)))return true;
 return path[0]==='timeline'&&index(path[1],maxTimelineClips)&&(path.length===3&&typeof path[2]==='string'&&['duration','target_phi','target_theta','target_gamma'].includes(path[2])||path.length===6&&path[2]==='actions'&&index(path[3],maxTimelineActions)&&path[4]==='args'&&index(path[5],maxCameraArgs));
}
/** Global resolution, Roots presentation/timeline slots and ordinary camera,
 * parameter and timeline scalars. These family-specific registrations do not
 * assert lossless numeric lexemes for the whole source document. */
export function parseSourceNumberTokens(raw:unknown,sceneKind:SceneDocument['kind']='roots'):SourceNumberToken[]{
 const roots=sceneKind==='roots',ordinary=ordinaryFamilies.has(sceneKind),bouncing=sceneKind==='bouncing',staticMaximum=bouncing?bouncingStaticMaximum:sceneKind==='perlin'?perlinStaticMaximum:ordinary?ordinaryStaticMaximum:maxConsumedFields,maximum=sceneKind==='perlin'?Math.min(SOURCE_JSON_LIMITS.nodes,projectFields.size+perlinStaticMaximum+maxTimelineClips*(4+maxTimelineActions*(maxCameraArgs+SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS.length+SOURCE_PERLIN_PARAMETER_NAMES.length*3))):ordinary?ordinaryMaximum:projectFields.size+(bouncing?bouncingStaticMaximum:roots?maxConsumedFields+maxTimelineFields:0);
 if(!Array.isArray(raw)||raw.length>maximum)throw new Error(`源数字词法记录必须是最多 ${maximum} 项的数组`);
 const seen=new Set<string>(),gradientPayloads=new Map<string,string>();let totalCharacters=0,parameterNameCharacters=0,parameterCount=0;let bouncingPolygonSource:string|undefined;const bouncingVertexForms=new Map<string,string>();
 // Preserve the existing independent static-field bound; timeline records do
 // not increase capacity for duplicate or unrelated spatial fields.
 if(raw.filter(value=>value&&typeof value==='object'&&Array.isArray(value.path)&&value.path[0]!=='timeline'&&!projectFields.has(JSON.stringify(value.path))).length>staticMaximum)
  throw new Error(`源静态数字词法记录必须是最多 ${staticMaximum} 项的数组`);
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('源数字词法记录无效');
  const {path,token}=value as {path?:unknown;token?:unknown};
  const kind=Array.isArray(path)?projectFields.get(JSON.stringify(path))??(roots?(path.length===2?consumedFields.get(JSON.stringify(path)):timelineField(path)?JSON.stringify(path):undefined):(bouncing?bouncingField(path):ordinary&&ordinaryField(path,sceneKind))?JSON.stringify(path):undefined):undefined;
  if(!kind||!Array.isArray(path))throw new Error('源数字词法记录的字段路径无效：'+JSON.stringify(path));
  if(bouncing){
   const polygon=bouncingPolygonPath(path);
   if(polygon){
    const source=path[0]==='polygon'?'root':'settings',vertex=String(polygon[0]),form=polygon[1]==='x'||polygon[1]==='y'?'object':'array';
    if(bouncingPolygonSource!==undefined&&bouncingPolygonSource!==source)throw new Error('源弹跳数字词法只能保留一个已选 polygon');
    if(bouncingVertexForms.has(vertex)&&bouncingVertexForms.get(vertex)!==form)throw new Error('源弹跳顶点数字词法不能混用数组和对象坐标');
    bouncingPolygonSource=source;bouncingVertexForms.set(vertex,form);
   }
  }
  if((roots||sceneKind==='surface'||sceneKind==='attractor'||sceneKind==='perlin')&&path[0]==='timeline'&&path[2]==='actions'&&path[4]==='args'&&!perlinParameterPath(path)&&gradientField(path[path.length-1],roots?ROOTS_GRADIENT_SOURCE_FIELDS:SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS)){
   const action=JSON.stringify(path.slice(0,5)),payload=JSON.stringify((sceneKind==='surface'||sceneKind==='attractor'||sceneKind==='perlin')?path.slice(0,path[5]==='0'?6:5):path.slice(0,-1)),previous=gradientPayloads.get(action);
   if(previous!==undefined&&previous!==payload)throw new Error('一个源动画动作只能保留首个对象的数字词法');
   gradientPayloads.set(action,payload);
  }
  if(ordinary&&path[0]==='parameters'){if(++parameterCount>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.parameters)throw new Error('源参数数字词法超过参数成员容量');parameterNameCharacters+=(path[1] as string).length;if(parameterNameCharacters>ORDINARY_SOURCE_CAMERA_IMPORT_LIMITS.scopeCharacters)throw new Error('源参数名总文本超过相机作用域输入容量');}
  if(seen.has(kind))throw new Error('源数字词法记录不得重复同一消费字段');seen.add(kind);
  if(typeof token!=='string'||token.length>MAX_SOURCE_NUMBER_TOKEN_TEXT||!sourceNumberTokenValid(token))throw new Error('源数字词法记录必须保留有效 JSON 数字且不超过 8 MiB');
  totalCharacters+=token.length;if(totalCharacters>MAX_SOURCE_NUMBER_TOKEN_TEXT)throw new Error('源数字词法记录总文本超过 8 MiB 输入容量');
  return{path:[...path],token};
 });
}
