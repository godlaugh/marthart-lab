import {importSourceConfigPalette} from './sourceConfigPalette';
import {prepareRootsSourceJsonString} from './rootsSourceOrder';
import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {DEFAULT_SOURCE_SURFACE_COLORS} from './sourceSurfaceColor';
import type {Settings} from '../types';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';

import {SOURCE_SAMILA_APPEARANCE_FIELDS} from './sourceSamilaFields';
import {validateSourceSamilaPalette,SourceSamilaPaletteError} from './sourceSamilaPaletteEditing';
interface Facts {settings:Settings;consumedPaths:string[][];numericPaths:string[][];warnings:string[];}
type Result={ok:true;value:Facts}|{ok:false;error:{kind:'input'|'capacity';path:string[];reason:string}};
export function importSourceSamilaAppearance(raw:unknown,numberToken:(path:readonly string[])=>string|undefined):Result {
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))return{ok:false,error:{kind:'input',path:['settings'],reason:'源 Samila settings 必须为对象'}};
 const source=raw as Record<string,unknown>|undefined,settings:Settings={},consumedPaths:string[][]=[],numericPaths:string[][]=[],warnings:string[]=[];
 for(const [field,spec]of Object.entries(SOURCE_SAMILA_APPEARANCE_FIELDS)){
  const path=['settings',field],value=source?.[field],present=source!==undefined&&Object.hasOwn(source,field);
  let parsed:number=source===undefined?spec.base:spec.json;let defaulted=present;
  if(present)consumedPaths.push(path);
  if(typeof value==='number'){parsed=Object.is(value,-0)&&numberToken(path)==='-0'?0:value;numericPaths.push(path);defaulted=false;}
  else if(typeof value==='string'){
   const result=parseDomainSourceDouble(value);
   if(result.ok){parsed=result.value;defaulted=false;}
   else if(result.error.kind==='capacity')return{ok:false,error:{kind:'capacity',path,reason:'源浮点字面量超过本地文本容量'}};
  }
  parsed=Math.fround(parsed);
  if(!Number.isFinite(parsed))return{ok:false,error:{kind:'input',path,reason:'源 Samila 绘制参数不是有限 Float32'}};
  settings[spec.key]=parsed;
  if(defaulted)warnings.push(`${path.join('.')} 按原版 getFloat 使用默认值 ${parsed}；原值保留。`);
 }
 const backgroundField=source&&Object.hasOwn(source,'background_color')?'background_color':source&&Object.hasOwn(source,'bgcolor')?'bgcolor':undefined;
 let packedBackground=0xff000000;
 if(backgroundField){
  const path=['settings',backgroundField],raw=source![backgroundField];consumedPaths.push(path);if(typeof raw==='number')numericPaths.push(path);
  const text=prepareRootsSourceJsonString(raw,'#000000',numberToken(path));
  if(!text.ok)return{ok:false,error:{kind:'input',path,reason:'源 Samila 背景数值词法无效'}};
  // Java Double.toString always has a decimal point/exponent; containers are
  // JSON object/array text. None can parse as ConfigUtils's integer color.
  if(text.value.status==='unknown'){packedBackground=0xffffffff;warnings.push(`${path.join('.')} 按原版采用白色；原值保留。`);}
  else {if(text.value.value.length>SOURCE_COLOR_TEXT_BUDGET)return{ok:false,error:{kind:'capacity',path,reason:'源 Samila 背景颜色超过 1 MiB 文本容量'}};
   try{packedBackground=sourceConfigPackedColor(text.value.value);}
   catch(error){if(!(error instanceof SourceConfigColorError))throw error;packedBackground=0xffffffff;warnings.push(`${path.join('.')} 按原版采用白色；原值保留。`);}
  }
 }
 settings.background='#'+(packedBackground&0xffffff).toString(16).padStart(6,'0');
 // SamilaMobject masks alpha, while Scene.background keeps Processing's int
 // color semantics, including zero-alpha 0..255 grayscale. Parse source once.
 settings.samilaSceneBackgroundColor=packedBackground;
 const trails=source?.show_trails;settings.showTrails=typeof trails==='boolean'?trails:typeof trails==='string'&&javaEqualsIgnoreCaseAscii(trails,'false')?false:true;
 if(source&&Object.hasOwn(source,'show_trails'))consumedPaths.push(['settings','show_trails']);
 settings.densityToneModel='samila-normalized-v2';settings.samilaToneBranch='palette-average';
 return{ok:true,value:{settings,consumedPaths,numericPaths,warnings}};
}

/** AbstractVisualConfig.parsePalette consumes only root.palette. Generic color
 * JSON flags are not runtime PaletteConfig mutations. Preserve them in source. */
export function importSourceSamilaPalette(raw:unknown){
 const colors=raw===undefined?[...DEFAULT_SOURCE_SURFACE_COLORS]:raw;
 try{validateSourceSamilaPalette({colors});}catch(error){return{ok:false as const,error:{kind:error instanceof SourceSamilaPaletteError?error.kind:'input' as const,reason:error instanceof Error?error.message:String(error)}};}
 const parsed=importSourceConfigPalette(colors,DEFAULT_SOURCE_SURFACE_COLORS,'Samila');
 return parsed.ok?{ok:true as const,value:{...parsed.value,sourcePalette:{colors:[...colors as string[]]}}}:parsed;
}
