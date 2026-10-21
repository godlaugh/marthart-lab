import type {Palette} from '../types';
import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {MAX_PALETTE_STOPS} from './palette';

/** Shared source color decoding. Each project/config owner supplies its defaults. */
export function importSourceConfigPalette(raw:unknown,defaults:readonly string[],family:string):{ok:true;value:{palette:Palette;useLut:boolean;warnings:string[]}}|{ok:false;error:{kind:'input'|'capacity';reason:string}} {
 const colors=raw===undefined?[...defaults]:raw;
 if(!Array.isArray(colors)||colors.some(c=>typeof c!=='string'))return{ok:false,error:{kind:'input',reason:`源 ${family} palette 必须为字符串数组`}};
 if(colors.length>MAX_PALETTE_STOPS||colors.reduce((n,c)=>n+c.length,0)>SOURCE_COLOR_TEXT_BUDGET)return{ok:false,error:{kind:'capacity',reason:`源 ${family} palette 超过本地 1024 色或 1 MiB 文本容量`}};
 const warnings:string[]=[],stops=colors.map((text,index)=>{
  let packed:number;try{packed=sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;packed=0xffffffff;warnings.push(`palette.${index} 按原版采用白色；原字符串已保留。`);}
  return '#'+(packed&0xffffff).toString(16).padStart(6,'0');
 });
 return{ok:true,value:{palette:{name:'原版导入',mode:'linear',offset:0,cycles:1,stops:stops.length===0?['#000000','#000000']:stops.length===1?[stops[0],stops[0]]:stops},useLut:stops.length>0,warnings}};
}
