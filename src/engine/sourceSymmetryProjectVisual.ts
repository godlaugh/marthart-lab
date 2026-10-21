import type {Settings} from '../types';
import {parseDomainSourceDouble} from './domainSourceScalar';

/** MathArt 1.7.8 ProjectState reset/fromJson/toJson. These are editor values;
 * consumer constraints (decay clamp, splat capacity, tone model) are separate.
 * Verified against original ProjectState execution, not an expression parser. */
const fields = [
 ['brightness','normalizedBrightness',.3,-.5,1.5,'brightness',-1,1],
 ['contrast','normalizedContrast',1,.1,2,'contrast',0,8],
 ['gamma','normalizedGamma',2.2,.1,10,'gamma',.1,8],
 ['dynamic_range','normalizedDynamicRange',.2,.1,1,'dynamicRange',.001,1e9],
 ['saturation','normalizedSaturation',.8,0,1,'saturation',0,4],
 ['accumulation_decay','accumulationDecay',1],
 ['scale_x','scaleX',35],['scale_y','scaleY',35],['scale_z','scaleZ',35],
 ['offset_x','offsetX',0],['offset_y','offsetY',0],['offset_z','offsetZ',0],
 ['dot_size','pointSize',1.5],
] as const;
const ignoredColorFields=['step_metric_min','step_metric_max','step_metric_normalize_mode','color_speed','color_phase'] as const;
export const SOURCE_SYMMETRY_PROJECT_VISUAL_NUMBER_FIELDS:readonly string[]=[...fields.map(spec=>spec[0]),...ignoredColorFields];
interface Facts {settings:Settings;consumedPaths:string[][];numericPaths:string[][];warnings:string[];}
type Result={ok:true;value:Facts}|{ok:false;error:{kind:'input'|'capacity';path:string[];reason:string}};
export function importSourceSymmetryProjectVisual(raw:unknown,numberToken:(path:readonly string[])=>string|undefined):Result {
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))return{ok:false,error:{kind:'input',path:['settings'],reason:'源 Symmetry settings 必须为对象'}};
 const source=raw as Record<string,unknown>|undefined,settings:Settings={},consumedPaths:string[][]=[],numericPaths:string[][]=[],warnings:string[]=[];
 for(const spec of fields){
  const [field,key,fallback]=spec,path=['settings',field],present=!!source&&Object.hasOwn(source,field),rawValue=source?.[field];
  let value:number=fallback,defaulted=present;
  if(present)consumedPaths.push(path);
  if(typeof rawValue==='number'){value=Object.is(rawValue,-0)&&numberToken(path)==='-0'?0:rawValue;numericPaths.push(path);defaulted=false;}
  else if(typeof rawValue==='string'){
   const parsed=parseDomainSourceDouble(rawValue);
   if(parsed.ok){value=parsed.value;defaulted=false;}
   else if(parsed.error.kind==='capacity')return{ok:false,error:{kind:'capacity',path,reason:'源浮点字面量超过本地文本容量'}};
  }
  value=Math.fround(value);
  // UI clamps after d2f: Infinity reaches the bound, but NaN remains invalid.
  if(spec.length===8)value=Math.min(Math.fround(spec[4]),Math.max(Math.fround(spec[3]),value));
  if(!Number.isFinite(value))return{ok:false,error:{kind:'input',path,reason:'原版项目输出拒绝非有限 Float32 数值'}};
  settings[key]=value;
  if(defaulted)warnings.push(`${path.join('.')} 按原版 getFloat 使用默认值 ${value}；原值保留在 source。`);
  // Retain the explicitly authored compatibility tone without re-reading raw
  // source. Switching to source normalization still requires a reference size.
  if(spec.length===8&&present){const legacy=Math.min(spec[7],Math.max(spec[6],value));settings[spec[5]]=legacy;
   if(legacy!==value)warnings.push(`${path.join('.')}：归一模型使用 ${value}，兼容白点模型使用 ${legacy}；原值保留在 source。`);
  }
 }
 for(const field of ignoredColorFields)if(source&&Object.hasOwn(source,field)){
  consumedPaths.push(['settings',field]);if(typeof source[field]==='number')numericPaths.push(['settings',field]);
  warnings.push(`settings.${field}：原版 Symmetry 项目不读取该字段；原值保留在 source。`);
 }
 return{ok:true,value:{settings,consumedPaths,numericPaths,warnings}};
}
