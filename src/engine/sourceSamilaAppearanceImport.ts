import {prepareRootsSourceJsonString} from './rootsSourceOrder';
import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {DEFAULT_SOURCE_SURFACE_COLORS} from './sourceSurfaceColor';
import {MAX_PALETTE_STOPS} from './palette';
import type {Palette,Settings} from '../types';
import {parseDomainSourceDouble} from './domainSourceScalar';
import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';

import {SOURCE_SAMILA_APPEARANCE_FIELDS} from './sourceSamilaFields';
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
 let background='#000000';
 if(backgroundField){
  const path=['settings',backgroundField],raw=source![backgroundField];consumedPaths.push(path);if(typeof raw==='number')numericPaths.push(path);
  const text=prepareRootsSourceJsonString(raw,'#000000',numberToken(path));
  if(!text.ok)return{ok:false,error:{kind:'input',path,reason:'源 Samila 背景数值词法无效'}};
  // Java Double.toString always has a decimal point/exponent; containers are
  // JSON object/array text. None can parse as ConfigUtils's integer color.
  if(text.value.status==='unknown'){background='#ffffff';warnings.push(`${path.join('.')} 按原版采用白色；原值保留。`);}
  else {if(text.value.value.length>SOURCE_COLOR_TEXT_BUDGET)return{ok:false,error:{kind:'capacity',path,reason:'源 Samila 背景颜色超过 1 MiB 文本容量'}};
   try{background='#'+(sourceConfigPackedColor(text.value.value)&0xffffff).toString(16).padStart(6,'0');}
   catch(error){if(!(error instanceof SourceConfigColorError))throw error;background='#ffffff';warnings.push(`${path.join('.')} 按原版采用白色；原值保留。`);}
  }
 }
 settings.background=background;
 const trails=source?.show_trails;settings.showTrails=typeof trails==='boolean'?trails:typeof trails==='string'&&javaEqualsIgnoreCaseAscii(trails,'false')?false:true;
 if(source&&Object.hasOwn(source,'show_trails'))consumedPaths.push(['settings','show_trails']);
 settings.densityToneModel='samila-normalized-v2';settings.samilaToneBranch='palette-average';
 return{ok:true,value:{settings,consumedPaths,numericPaths,warnings}};
}

/** AbstractVisualConfig.parsePalette consumes only root.palette. Generic color
 * JSON flags are not runtime PaletteConfig mutations. Preserve them in source. */
export function importSourceSamilaPalette(raw:unknown):{ok:true;value:{palette:Palette;useLut:boolean;warnings:string[]}}|{ok:false;error:{kind:'input'|'capacity';reason:string}} {
 const colors=raw===undefined?[...DEFAULT_SOURCE_SURFACE_COLORS]:raw;
 if(!Array.isArray(colors)||colors.some(c=>typeof c!=='string'))return{ok:false,error:{kind:'input',reason:'源 Samila palette 必须为字符串数组'}};
 if(colors.length>MAX_PALETTE_STOPS||colors.reduce((n,c)=>n+c.length,0)>SOURCE_COLOR_TEXT_BUDGET)return{ok:false,error:{kind:'capacity',reason:'源 Samila palette 超过本地 1024 色或 1 MiB 文本容量'}};
 const warnings:string[]=[],stops=colors.map((text,index)=>{
  let packed:number;try{packed=sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;packed=0xffffffff;warnings.push(`palette.${index} 按原版采用白色；原字符串已保留。`);}
  return '#'+(packed&0xffffff).toString(16).padStart(6,'0');
 });
 return{ok:true,value:{palette:{name:'原版导入',mode:'linear',offset:0,cycles:1,stops:stops.length===0?['#000000','#000000']:stops.length===1?[stops[0],stops[0]]:stops},useLut:stops.length>0,warnings}};
}
