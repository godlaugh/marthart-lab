import type {SceneDocument} from '../types';
import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration,type SourceAttractorResult} from './sourceAttractorConfig';
import {parseSourceAttractorVisualConfiguration,type SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';
import {prepareSourceAttractorEquation} from './sourceAttractorEquation';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {ORDINARY_CAMERA_SEQUENCE} from './ordinarySourceCameraTimeline';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {prepareRootsSourceJsonString} from './rootsSourceOrder';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor} from './sourceConfigColor';

export interface SourceAttractorDocumentPayload {
 configuration:SourceAttractorConfiguration;
 visual:SourceAttractorVisualConfiguration;
 backgroundColor:number;
}
export const SOURCE_ATTRACTOR_CLIP_TYPES:readonly string[]=['wait','animate','align'];
export const SOURCE_ATTRACTOR_ACTION_METHODS:readonly string[]=['rotatePhi','rotateTheta','zoom','focal','ambient','stopAmbient','track','stopTracking','gradientStart','gradientStop'];
const object=(raw:unknown):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
export const usesSourceAttractor=(scene:Pick<SceneDocument,'kind'|'attractorSource'>):boolean=>scene.kind==='attractor'&&scene.attractorSource!==undefined;
export class SourceAttractorDocumentError extends Error {
 constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='SourceAttractorDocumentError';}
}
const fail=(reason:string):never=>{throw new SourceAttractorDocumentError('input',reason);};
export function parseSourceAttractorDocument(raw:unknown):SourceAttractorResult<SourceAttractorDocumentPayload>{
 if(!object(raw)||Object.keys(raw).length!==3||!['configuration','visual','backgroundColor'].every(key=>Object.hasOwn(raw,key)))return{ok:false,error:{kind:'input',path:[],reason:'源吸引子配置必须包含 configuration、visual 和 backgroundColor'}};
 const configuration=parseSourceAttractorConfiguration(raw.configuration);if(!configuration.ok)return{ok:false,error:{...configuration.error,path:['configuration',...configuration.error.path]}};
 const visual=parseSourceAttractorVisualConfiguration(raw.visual);if(!visual.ok)return{ok:false,error:{...visual.error,path:['visual',...visual.error.path]}};
 if(typeof raw.backgroundColor!=='number'||!Number.isInteger(raw.backgroundColor)||raw.backgroundColor<0||raw.backgroundColor>0xffffffff)return{ok:false,error:{kind:'input',path:['backgroundColor'],reason:'源背景必须是 uint32 ARGB'}};
 return{ok:true,value:{configuration:configuration.value,visual:visual.value,backgroundColor:raw.backgroundColor}};
}
/** JsonAttractorConfig.parseConfig PC885–955 uses getDouble, not ConfigUtils
 * expressions. Preserve exact dictionary keys, including x/y/z shadowing. */
export function importSourceAttractorParameters(raw:unknown):Record<string,number>{
 if(raw===undefined)return{};
 if(!object(raw))return fail('原版吸引子 parameters 必须为对象');
 const entries=Object.entries(raw);if(entries.length>8191)throw new SourceAttractorDocumentError('capacity','原版吸引子参数超过本地变量槽容量');
 let characters=0;
 return Object.fromEntries(entries.map(([key,value])=>{
  characters+=key.length+(typeof value==='string'?value.length:0);
  if(characters>65536)throw new SourceAttractorDocumentError('capacity','原版吸引子参数文本超过本地 65536 字符容量');
  let number: number;
  if(typeof value==='number')number=value;
  else if(typeof value==='string'){
   const parsed=parseDomainSourceDouble(value);
   if(!parsed.ok)throw new SourceAttractorDocumentError(parsed.error.kind==='capacity'?'capacity':'input',`parameters.${key} 需要 Java double 字面量，不能用参数表达式`);
   number=parsed.value;
  }else return fail(`parameters.${key} 需要 Java double 数值或字符串`);
  if(!Number.isFinite(number))return fail(`parameters.${key} 非有限 double 不能保存`);
  return[key,number];
 }));
}
/** getString(default) -> ConfigUtils.parseColor, with number-token identity.
 * Malformed color text recovers white in the source; capacity never does. */
export function importSourceAttractorBackground(raw:unknown,numberToken?:string):{color:number;diagnostics:string[]}{
 let text='#000000';const diagnostics:string[]=[];
 if(typeof raw==='number'){
  const result=prepareRootsSourceJsonString(raw,text,numberToken);
  if(!result.ok)throw new SourceAttractorDocumentError(result.error.kind==='capacity'?'capacity':'input',JSON.stringify(result.error));
  if(result.value.status==='unknown'){
   if(result.value.reason!=='java-double-format')return fail(`源背景数字文本不明确：${result.value.reason}`);
   text='NaN'; // Any Java double spelling is not an Integer.parseInt color.
  }else text=result.value.value;
 }else if(raw!=null)text=typeof raw==='string'?raw:typeof raw==='boolean'?String(raw):Array.isArray(raw)?'[]':'{}';
 if(text.length>SOURCE_COLOR_TEXT_BUDGET)throw new SourceAttractorDocumentError('capacity','源背景文本超过本地 1 MiB 容量');
 try{return{color:sourceConfigPackedColor(text),diagnostics};}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push('settings.background_color: 源颜色解析失败，采用白色；原值保留在 source。');return{color:0xffffffff,diagnostics};}
}
/** Validate authored source facts without creating particles or replaying time.
 * Formula/parameter values stay in the document's single ordinary authoring
 * fields; source provenance is never consulted to overwrite later edits. */
export function prepareSourceAttractorScene(scene:SceneDocument){
 if(!usesSourceAttractor(scene))return fail('缺少原版吸引子配置');
 const parsed=parseSourceAttractorDocument(scene.attractorSource);
 if(!parsed.ok)throw new SourceAttractorDocumentError(parsed.error.kind==='capacity'?'capacity':'input',`原版吸引子 ${parsed.error.path.join('.')}：${parsed.error.reason}`);
 const {configuration,visual,backgroundColor}=parsed.value;
 if(configuration.nativeBackend!=='cpu')return fail('原版吸引子 GPU 生产路径尚未接入；不能改用 CPU 或本地 GPU 模型');
 if(configuration.particleCountCPU<0||configuration.particleCountCPU>10000)return fail('原版吸引子 CPU 粒子数量必须在 0–10000，不截断作者配置');
 if(scene.settings.presentation==='density'||scene.settings.scale!==1||['rotateX','rotateY','rotateZ'].some(key=>Number(scene.settings[key]??0)!==0))return fail('原版吸引子使用源点与拖尾及分轴变换，不执行本地密度或整体变换');
 const camera=ordinarySourceCameraInitial(scene);if(!camera)return fail('原版吸引子需要源相机');
 if(scene.timeline.schedule!==ORDINARY_CAMERA_SEQUENCE)return fail('原版吸引子需要原版顺序时间线');
 if(!Number.isFinite(scene.timeline.fps)||scene.timeline.fps<1||scene.timeline.fps>120)return fail('原版吸引子帧率必须在 1–120');
 for(const track of scene.timeline.tracks){
  if(!track.enabled)continue;
  if(!SOURCE_ATTRACTOR_CLIP_TYPES.includes(track.type??'')||track.actions?.some(action=>!SOURCE_ATTRACTOR_ACTION_METHODS.includes(action.method))||track.parameterAnimations?.length||track.surfaceParameterClip||track.actions?.some(action=>action.parameters?.length||action.domainParameters?.length||action.surfaceParameters))return fail('源吸引子时间线包含不支持的动作或片段；原版 ATTRACTOR 没有参数动画，不能使用本地动画替代');
 }
 const equation=prepareSourceAttractorEquation({equations:scene.equations,parameters:scene.parameters});
 if(!equation.ok)throw new SourceAttractorDocumentError(equation.error.kind,`原版吸引子 ${equation.error.path.join('.')}：${equation.error.reason}`);
 return{configuration,visualConfiguration:visual,equation:equation.value,backgroundColor,camera};
}
