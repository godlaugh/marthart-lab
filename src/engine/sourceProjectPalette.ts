/** ProjectState owns these defaults before any scene's runtime config reads
 * palette. Runtime-only entry points retain their own defaults. */
export const SOURCE_PROJECT_PALETTE_COLORS=['#FC6255','#FF862F','#FFFF00','#59743E','#83C167','#1D4A81','#9A72AC'] as const;
export interface SourceProjectPalette {origin:'default'|'authored';colors:string[];}
export type SourceProjectPaletteResult={ok:true;value:SourceProjectPalette}|{ok:false;error:{kind:'input'|'capacity';path:readonly string[];reason:string}};
const MAX_COLORS=65536,MAX_TEXT_BYTES=1024*1024;
/** Original fromJson replaces the prior palette, even for an empty array.
 * getString is strict and does not interpret colors. Local preparation budgets
 * are separate from the original format, which has no palette size bound. */
export function prepareSourceProjectPalette(raw:unknown):SourceProjectPaletteResult {
 if(raw===undefined)return{ok:true,value:{origin:'default',colors:[...SOURCE_PROJECT_PALETTE_COLORS]}};
 if(!Array.isArray(raw))return{ok:false,error:{kind:'input',path:['palette'],reason:'项目 palette 必须为字符串数组；null 不表示缺省'}};
 if(raw.length>MAX_COLORS)return{ok:false,error:{kind:'capacity',path:['palette'],reason:'项目色板超过本地 65536 色准备预算'}};
 let bytes=0;
 for(let i=0;i<raw.length;i++){
  if(typeof raw[i]!=='string')return{ok:false,error:{kind:'input',path:['palette',String(i)],reason:'项目色板成员必须为字符串'}};
  bytes+=raw[i].length*2;
  if(bytes>MAX_TEXT_BYTES)return{ok:false,error:{kind:'capacity',path:['palette'],reason:'项目色板超过本地 1 MiB UTF-16 文本准备预算'}};
 }
 return{ok:true,value:{origin:'authored',colors:[...raw]}};
}
