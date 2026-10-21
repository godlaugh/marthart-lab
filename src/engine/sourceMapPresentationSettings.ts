import {SOURCE_MAP_PRESENTATION_FIELDS} from './sourceMapPresentationFields';
import type {Settings} from '../types';
import {importSourceMapFloat} from './sourceMapScalar';
import {importSourceConfigBackground,SourceConfigBackgroundError} from './sourceConfigBackground';

/** MathArt 1.7.8 JsonMapAttractorConfig / ProjectState Map branch. Config
 * values are Float32; decay remains authored here and is clamped by Mobject.
 * RGB hex and alpha byte together retain the packed ARGB value. The render
 * owner interprets shader RGB separately from Processing clear RGBA. */
export interface SourceMapPresentationSettings {
 settings:Settings;
 backgroundColor:number;
 consumedPaths:string[][];
 numericPaths:string[][];
 warnings:string[];
}
export type SourceMapPresentationResult={ok:true;value:SourceMapPresentationSettings}|{ok:false;error:{kind:'input'|'capacity';path:string[];reason:string}};
export interface SourceMapPresentationImportOptions {
 entry:'project'|'runtime-config';
 numberToken?:(path:readonly string[])=>string|undefined;
}
export function importSourceMapPresentationSettings(raw:unknown,options:SourceMapPresentationImportOptions):SourceMapPresentationResult {
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))return{ok:false,error:{kind:'input',path:['settings'],reason:'源 Map settings 必须为对象'}};
 const source=raw as Record<string,unknown>|undefined,settings:Settings={},consumedPaths:string[][]=[],numericPaths:string[][]=[],warnings:string[]=[];
 for(const spec of SOURCE_MAP_PRESENTATION_FIELDS){
  const [field,key,fallback]=spec,path=['settings',field],present=!!source&&Object.hasOwn(source,field),value=source?.[field];
  if(present)consumedPaths.push(path);
  if(typeof value==='number')numericPaths.push(path);
  const token=options.numberToken?.(path);
  const parsed=importSourceMapFloat(value,fallback,options.entry,token);
  if(!parsed.ok)return{ok:false,error:{kind:'capacity',path,reason:parsed.reason}};
  let effective=parsed.value;
  if(spec.length===5)effective=Math.max(Math.fround(spec[3]),Math.min(Math.fround(spec[4]),effective));
  if(!Number.isFinite(effective))return{ok:false,error:{kind:'input',path,reason:options.entry==='project'?'原版项目输出拒绝非有限 Float32 数值':'源 Map 配置产生非有限 Float32 数值，本地文档不能保存'}};
  settings[key]=effective;
  if(present&&parsed.value!==effective)warnings.push(`${path.join('.')} 按原版 Float32 范围限制为 ${effective}；原值保留在 source。`);
  if(present&&typeof value!=='number')warnings.push(`${path.join('.')} 按原版 ${options.entry==='project'?'getFloat 字面量及默认值':'ConfigUtils 数值表达式及回退'}转换为 ${effective}；原值保留在 source。`);
 }
 const backgroundPath=['settings','background_color'],background=source?.background_color;
 if(source&&Object.hasOwn(source,'background_color'))consumedPaths.push(backgroundPath);
 if(typeof background==='number')numericPaths.push(backgroundPath);
 try{
  // JsonMap constructor PC286–299 is the same getString(default)→parseColor
  // boundary as JsonAttractorConfig. ProjectState preserves that string.
  const parsed=importSourceConfigBackground(background,options.numberToken?.(backgroundPath));
  settings.background=`#${(parsed.color&0xffffff).toString(16).padStart(6,'0')}`;
  settings.mapBackgroundAlpha=parsed.color>>>24;
  warnings.push(...parsed.diagnostics);
  return{ok:true,value:{settings,backgroundColor:parsed.color,consumedPaths,numericPaths,warnings}};
 }catch(error){
  if(error instanceof SourceConfigBackgroundError)return{ok:false,error:{kind:error.code,path:backgroundPath,reason:error.message}};
  throw error;
 }
}
