import type {EvaluatedDomainGradient,Palette,RGB} from '../types';
import {hexRGB,paletteColor,preparePaletteShape,type PreparedPaletteShape} from './palette';
import {compilePreparedColorInterpolation,prepareColorInterpolation,type PreparedColorInterpolation} from './colorInterpolation';

export const DOMAIN_GRADIENT_EXTENSION_NOTICE='当前函数、HSV 或带位置色板保留自身采样，仅应用域偏移；运行时循环颜色插值用于无位置的线性色标。';
export const DOMAIN_GRADIENT_SOURCE_NOTICE='域渐变按原版静态目标映射：偏移循环或非双侧作用不移动域偏移；运行时使用循环色标，停止后恢复普通采样。原版 GPU 色板预处理与像素未对照。';
export function hasDiscreteDomainPalette(palette:Palette):boolean {
 return palette.mode==='linear'&&palette.positions===undefined&&(palette.interpolation??'rgb')==='rgb';
}
export type DomainPaletteShape = PreparedPaletteShape | {kind:'cyclic';segments:PreparedColorInterpolation[];quantized:true};
export interface DomainPaletteFacts {cycles:number;offset:number;shape:DomainPaletteShape}
/** Produce semantic facts beside the existing CPU closure. Neither GPU consumers
 * nor DomainModel decide whether runtime interpolation applies to a palette. */
function domainPaletteFacts(palette:Palette,runtime?:EvaluatedDomainGradient):DomainPaletteFacts {
 let shape:DomainPaletteShape;
 if(runtime?.running&&hasDiscreteDomainPalette(palette)){
  const colors=palette.stops.map(hexRGB);shape={kind:'cyclic',segments:colors.map((color,i)=>prepareColorInterpolation(color,colors[(i+1)%colors.length],runtime.interpolation)),quantized:true};
 }else shape=preparePaletteShape(palette);
 return{cycles:palette.cycles,offset:palette.offset,shape};
}
/** A scoped sampling view, never a rewrite of the authored palette. The source
 * CPU path interpolates N cyclic entries while running and N-1 intervals after
 * stop. Rich local palette models preserve their own sampler explicitly. */
export function compileDomainPalette(palette:Palette,runtime?:EvaluatedDomainGradient):{sample:(coordinate:number)=>RGB;warnings:string[];paletteFacts:DomainPaletteFacts} {
 if(runtime&&(!['rgb','linear','oklab','oklch'].includes(runtime.interpolation)||typeof runtime.running!=='boolean'))throw new Error('域渐变运行状态无效');
 const warnings=runtime?[DOMAIN_GRADIENT_SOURCE_NOTICE]:[],paletteFacts=domainPaletteFacts(palette,runtime);
 if(!runtime?.running)return{sample:coordinate=>paletteColor(palette,coordinate),warnings,paletteFacts};
 if(!hasDiscreteDomainPalette(palette))return{sample:coordinate=>paletteColor(palette,coordinate),warnings:[...warnings,DOMAIN_GRADIENT_EXTENSION_NOTICE],paletteFacts};
 if(paletteFacts.shape.kind!=='cyclic')throw new Error('域渐变采样事实无效');
 const segments=paletteFacts.shape.segments.map(compilePreparedColorInterpolation);
 return{warnings,paletteFacts,sample:coordinate=>{
  const scaled=coordinate*palette.cycles+palette.offset;
  if(!Number.isFinite(scaled))throw new Error('调色板采样坐标必须是有限数值');
  const cyclic=((scaled%1)+1)%1*segments.length,index=Math.min(segments.length-1,Math.floor(cyclic));
  // The source CPU lerp returns packed 8-bit channels. The color-space math is
  // the same independent standard implementation used by Timeline palettes.
  return segments[index](cyclic-index).map(value=>Math.round(Math.max(0,Math.min(1,value))*255)/255) as RGB;
 }};
}
