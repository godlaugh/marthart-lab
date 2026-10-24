import {SOURCE_BOUNCING_DEFAULT_PALETTE,sourceBouncingPaletteColor,type SourceBouncingPalette} from './sourceBouncingVisualConfig';
import {sourceManualPalettePackedColor} from './sourceConfigColor';
/** Editing an absent palette explicitly materializes its actual Base colors.
 * An explicit empty palette remains empty; it renders white, not Base colors. */
export function sourceBouncingEditableColors(palette:SourceBouncingPalette):readonly string[]{
 return palette.kind==='colors'?palette.colors:SOURCE_BOUNCING_DEFAULT_PALETTE.map(value=>'#'+value.toString(16).padStart(8,'0'));
}
export function sourceBouncingPaletteRgb(text:string):string{return '#'+(sourceBouncingPaletteColor(text).packed&0xffffff).toString(16).padStart(6,'0');}
export function sourceBouncingReplaceRgb(text:string,rgb:string):string{
 if(!/^#[0-9a-f]{6}$/i.test(rgb))throw Error('色标必须使用 #RRGGBB');
 if(rgb.toLowerCase()===sourceBouncingPaletteRgb(text))return text;
 return '#'+(sourceBouncingPaletteColor(text).packed>>>24).toString(16).padStart(2,'0')+rgb.slice(1);
}
/** Order is authored data, not a normalized list of gradient positions. */
export function moveSourceBouncingColor(colors:readonly string[],from:number,to:number):string[]{
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=colors.length||to<0||to>=colors.length)throw Error('色标索引无效');
 const next=[...colors];next.splice(to,0,next.splice(from,1)[0]);return next;
}
/** Insert the original helper's Float32 RGB midpoint after the selected entry.
 * Compose packs the interpolated sRGB channel to eight bits before formatting.
 * Only the new color is formatted; existing strings are never normalized.
 * The empty-list helper returns an out-of-range index 1; our selection is 0. */
export function insertSourceBouncingColor(colors:readonly string[],selected:number):{colors:string[];selected:number}{
 if(colors.length<=1)return{colors:[...colors,'#FFFFFF'],selected:colors.length};
 if(!Number.isInteger(selected)||selected<0||selected>=colors.length)throw Error('色标索引无效');
 const F=Math.fround,a=sourceManualPalettePackedColor(colors[selected]),b=sourceManualPalettePackedColor(colors[Math.min(selected+1,colors.length-1)]);
 const rgb=[16,8,0].map(shift=>{
  const x=F(((a>>>shift)&255)/255),y=F(((b>>>shift)&255)/255),mid=F(x+F(F(y-x)*F(.5)));
  const packed=Math.trunc(F(F(Math.max(0,Math.min(1,mid))*255)+F(.5)));
  return Math.max(0,Math.min(255,Math.floor(F(F(packed/255)*255)+.5))).toString(16).padStart(2,'0');
 }).join('').toUpperCase();
 const next=[...colors],at=selected+1;next.splice(at,0,'#'+rgb);return{colors:next,selected:at};
}
