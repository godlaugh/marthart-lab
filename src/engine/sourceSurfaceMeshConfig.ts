import {parseDomainSourceDouble} from './domainSourceScalar';
import {prepareOrdinarySourceScalarScope,prepareSurfaceSourceStringField} from './ordinarySourceCameraImport';
import {prepareRootsSourceJsonInt,prepareRootsSourceJsonString} from './rootsSourceOrder';
import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';

export const SOURCE_SURFACE_MESH_MODEL='surface-mesh-1.7.8' as const;
/** These MeshSurface constructor values are not configurable through source JSON. */
export const SOURCE_SURFACE_MESH_MATERIAL_DEFAULTS=Object.freeze({wireframeDepthBias:Math.fround(.001),wireframeDistanceScale:1,wireframeDistanceMin:Math.fround(.35),wireframeDistanceMax:1,wireframeFresnelPower:3,wireframeFresnelStrength:Math.fround(.15),wireframeFeather:1,materialShininess:32,materialAmbientColor:0xff4d4d4d,materialSpecularColor:0xffffffff,proceduralTextureType:0,wireframeCurveSamples:128});
export interface SourceSurfaceMeshConfiguration {
 model:typeof SOURCE_SURFACE_MESH_MODEL;
 settingsPresence:'absent'|'object';
 mode:'points'|'mesh';
 /** Original native renderer identity; not the local execution backend. */
 nativeBackend:'cpu'|'gpu';
 backgroundColor:number;
 points:{uSegments:number;vSegments:number;dotRadius:number;lineWeight:number;trailLifetime:number;showTrails:boolean;fadeTrails:boolean;fadePoints:true};
 mesh:{uSegments:number;vSegments:number;fillEnabled:boolean;wireframeEnabled:boolean;fillOpacity:number;lineWeight:number;wireframeColor:number;wrapU:boolean;wrapV:boolean;wrapThreshold:number;wireframeDecoupled:boolean;wireframeUSegments:number;wireframeVSegments:number};
 domain:{uMin:number;uMax:number;vMin:number;vMax:number;periodicU:boolean;periodicV:boolean;flowingU:boolean;flowingV:boolean};
 transform:{scaleX:number;scaleY:number;scaleZ:number;offsetX:number;offsetY:number;offsetZ:number};
 tracking:{speedU:number;speedV:number};
}
export type SourceSurfaceMeshError={kind:'input'|'capacity'|'nonfinite';path:readonly string[];reason:string};
export type SourceSurfaceMeshResult<T>={ok:true;value:T}|{ok:false;error:SourceSurfaceMeshError};
export interface SourceSurfaceMeshImportFacts {configuration:SourceSurfaceMeshConfiguration;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
export interface SourceSurfaceMeshImportOptions {/** Paths are relative to settings. */numberToken?:(path:readonly string[])=>string|undefined;}
class Failure extends Error {constructor(readonly detail:SourceSurfaceMeshError){super(detail.reason);}}
function fail(kind:SourceSurfaceMeshError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceSurfaceMeshResult<T>{try{return{ok:true,value:run()};}catch(e){if(e instanceof Failure)return{ok:false,error:e.detail};throw e;}}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function finite(v:number,path:readonly string[]):number{if(!Number.isFinite(v))fail('nonfinite',path,'源非有限数值不能保存或回放');return v;}
function defaults(present:boolean):SourceSurfaceMeshConfiguration{
 return{model:SOURCE_SURFACE_MESH_MODEL,settingsPresence:present?'object':'absent',mode:'points',nativeBackend:'cpu',backgroundColor:0xff000000,
 points:{uSegments:present?40:99,vSegments:present?20:99,dotRadius:Math.fround(present?2:1.68),lineWeight:Math.fround(present?1.2:1),trailLifetime:4,showTrails:true,fadeTrails:true,fadePoints:true},
 mesh:{uSegments:present?40:60,vSegments:present?20:60,fillEnabled:true,wireframeEnabled:true,fillOpacity:Math.fround(.9),lineWeight:Math.fround(present?1.2:1),wireframeColor:0xffffffff,wrapU:false,wrapV:false,wrapThreshold:.25,wireframeDecoupled:false,wireframeUSegments:0,wireframeVSegments:0},
 domain:{uMin:0,uMax:Math.fround(Math.PI*2),vMin:0,vMax:Math.fround(Math.PI),periodicU:false,periodicV:false,flowingU:true,flowingV:true},
 transform:{scaleX:55,scaleY:55,scaleZ:55,offsetX:0,offsetY:0,offsetZ:0},tracking:{speedU:Math.fround(.3),speedV:Math.fround(.3)}};
}
/** Reads exactly the JsonSurfaceConfig settings branch. It never binds top-level
 * parameters: native settings expressions run before that map is populated.
 * Undefined means omitted settings, whereas null is malformed native input. */
export function importSourceSurfaceMeshConfig(rawSettings:unknown,options:SourceSurfaceMeshImportOptions={}):SourceSurfaceMeshResult<SourceSurfaceMeshImportFacts>{return attempt(()=>{
 const configuration=defaults(rawSettings!==undefined),consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 const facts={configuration,consumedPaths,numericPaths,diagnostics};if(rawSettings===undefined)return facts;
 if(!object(rawSettings))return fail('input',[],'源 settings 必须为对象');const raw=rawSettings;
 if(!Object.keys(raw).length)consumedPaths.push([]);
 const read=(key:string):unknown=>{if(Object.hasOwn(raw,key)){consumedPaths.push([key]);if(typeof raw[key]==='number')numericPaths.push([key]);}return raw[key];};
 const warn=(key:string)=>diagnostics.push(`${key}: 按源默认值解析；原值保留在 source。`);
 const int=(key:string,fallback:number):number=>{const result=prepareRootsSourceJsonInt(read(key),fallback,options.numberToken?.([key]));if(!result.ok)return fail(result.error.kind==='capacity'?'capacity':'input',[key],JSON.stringify(result.error));if(result.value.route==='fallback'&&result.value.fallbackReason!=='missing')warn(key);return result.value.value;};
 const float=(key:string,fallback:number):number=>{const value=read(key);let n=fallback;if(typeof value==='number')n=value;else if(typeof value==='string'){const parsed=parseDomainSourceDouble(value);if(parsed.ok)n=parsed.value;else if(parsed.error.kind==='capacity')return fail('capacity',[key],'数值文本超过本地解析容量');else warn(key);}else if(Object.hasOwn(raw,key))warn(key);return finite(Math.fround(n),[key]);};
 const boolean=(key:string,fallback:boolean,strict=false):boolean=>{const value=read(key);if(!Object.hasOwn(raw,key))return fallback;if(typeof value==='boolean')return value;if(typeof value==='string'&&/^(true|false)$/i.test(value))return value.toLowerCase()==='true';if(strict)return fail('input',[key],'源布尔值必须是不带空格的 true/false');warn(key);return fallback;};
 const text=(key:string,fallback:string):string=>{const value=read(key);if(value==null)return fallback;if(typeof value==='string'){if(value.length>SOURCE_COLOR_TEXT_BUDGET)return fail('capacity',[key],'文本超过本地 1 MiB 容量');return value;}if(typeof value==='number'||typeof value==='boolean')return String(value);return Array.isArray(value)?'[]':'{}';};
 const color=(key:string,fallback:string):number=>{let value=text(key,fallback);if(typeof raw[key]==='number'){const parsed=prepareRootsSourceJsonString(raw[key],fallback,options.numberToken?.([key]));if(!parsed.ok)return fail(parsed.error.kind==='capacity'?'capacity':'input',[key],JSON.stringify(parsed.error));if(parsed.value.status==='unknown'){if(parsed.value.reason!=='java-double-format')return fail('input',[key],parsed.value.reason);value='NaN';}else value=parsed.value.value;}try{return sourceConfigPackedColor(value);}catch(e){if(!(e instanceof SourceConfigColorError))throw e;diagnostics.push(`${key}: 源颜色解析失败，采用白色；原值保留在 source。`);return 0xffffffff;}};
 const scope=prepareOrdinarySourceScalarScope('surface');if(!scope.ok)return fail('input',[],JSON.stringify(scope.error));
 const expression=(key:string,fallback:number):number=>{const value=read(key),result=scope.value.field(value,key,fallback,Object.hasOwn(raw,key));if(!result.ok)return fail(result.error.kind,[key],JSON.stringify(result.error));diagnostics.push(...result.value.diagnostics);return result.value.value;};
 const p=configuration.points,m=configuration.mesh,d=configuration.domain;
 p.uSegments=int('u_segments',40);p.vSegments=int('v_segments',20);p.dotRadius=float('dot_size',2);p.lineWeight=float('line_weight',Math.fround(1.2));p.trailLifetime=float('trail_lifetime',4);
 p.showTrails=boolean('show_trails',true,true);p.fadeTrails=boolean('fade_trails',true,true);
 for(const axis of ['X','Y','Z'] as const){configuration.transform[`scale${axis}`]=float(`scale_${axis.toLowerCase()}`,55);configuration.transform[`offset${axis}`]=float(`offset_${axis.toLowerCase()}`,0);}
 for(const axis of ['U','V'] as const){d[`periodic${axis}`]=boolean(`periodic_${axis.toLowerCase()}`,false,true);d[`flowing${axis}`]=boolean(`flowing_${axis.toLowerCase()}`,true,true);configuration.tracking[`speed${axis}`]=float(`speed_${axis.toLowerCase()}`,Math.fround(.3));}
 configuration.backgroundColor=color('background_color','#000000');
 const mode=text('surface_mode','points');if(/[\u0080-\uffff]/.test(mode))diagnostics.push('surface_mode: 原版使用 JVM 默认区域大写规则，当前使用 Unicode 大写映射。');configuration.mode=mode.toUpperCase()==='MESH'?'mesh':'points';
 if(Object.hasOwn(raw,'render_mode')){const backend=read('render_mode');if(typeof backend!=='string')return fail('input',['render_mode'],'源 render_mode 必须为字符串');configuration.nativeBackend=backend.toUpperCase()==='GPU'?'gpu':'cpu';}
 m.uSegments=int('mesh_u_segments',p.uSegments);m.vSegments=int('mesh_v_segments',p.vSegments);m.fillEnabled=boolean('mesh_fill',true);m.wireframeEnabled=boolean('mesh_wireframe',true);
 m.fillOpacity=expression('mesh_fill_opacity',Math.fround(.9));m.lineWeight=expression('mesh_line_weight',p.lineWeight);m.wireframeColor=color('mesh_wireframe_color','#FFFFFF');
 m.wrapU=boolean('mesh_wrap_u',false);m.wrapV=boolean('mesh_wrap_v',false);m.wrapThreshold=expression('mesh_wrap_threshold',.25);m.wireframeDecoupled=boolean('wireframe_decoupled',false);m.wireframeUSegments=int('wireframe_u_segments',0);m.wireframeVSegments=int('wireframe_v_segments',0);
 for(const [key,native,fallback]of [['uMin','u_min','0'],['uMax','u_max','TWO_PI'],['vMin','v_min','0'],['vMax','v_max','PI']]as const){const result=prepareSurfaceSourceStringField(read(native),native,fallback);if(!result.ok)return fail(result.error.kind,[native],JSON.stringify(result.error));d[key]=result.value.value;diagnostics.push(...result.value.diagnostics);}
 return facts;
});}

/** Strict saved contract: no importing/defaulting/clamping, no backend mutation.
 * Renderer allocation admission is separate from the source parsed values. */
export function parseSourceSurfaceMeshConfiguration(raw:unknown):SourceSurfaceMeshResult<SourceSurfaceMeshConfiguration>{return attempt(()=>{
 const template=defaults(false);
 const walk=(value:unknown,shape:unknown,path:string[]):unknown=>{
  if(object(shape)){if(!object(value))return fail('input',path,'必须为对象');const keys=Object.keys(shape);if(Object.keys(value).some(k=>!keys.includes(k)))return fail('input',path,'未知字段');return Object.fromEntries(keys.map(k=>[k,walk(value[k],shape[k],[...path,k])]));}
  if(typeof shape==='number'){if(typeof value!=='number')return fail('input',path,'必须为数值');finite(value,path);const key=path.at(-1)!;
   if(key.endsWith('Segments')&&(!Number.isInteger(value)||value< -2147483648||value>2147483647))return fail('input',path,'源段数必须为 int32');
   if(key.endsWith('Color')&&(!Number.isInteger(value)||value<0||value>0xffffffff))return fail('input',path,'颜色必须为 uint32');return value;}
  if(typeof shape==='boolean'){if(typeof value!=='boolean'||path.at(-1)==='fadePoints'&&value!==true)return fail('input',path,'无效布尔值');return value;}
  const key=path.at(-1),allowed=key==='model'?[SOURCE_SURFACE_MESH_MODEL]:key==='mode'?['points','mesh']:key==='nativeBackend'?['cpu','gpu']:['absent','object'];if(typeof value!=='string'||!allowed.includes(value))return fail('input',path,'未知源配置枚举');return value;
 };
 return walk(raw,template,[]) as SourceSurfaceMeshConfiguration;
});}
