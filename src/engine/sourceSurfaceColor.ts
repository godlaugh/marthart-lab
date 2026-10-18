import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {INITIAL_SOURCE_SURFACE_PALETTE_STATE,sampleSourceSurfaceGradient} from './sourceSurfaceGradient';

/** ManimColors.DEFAULT_PALETTE, MathArt 1.7.8. Keep authored color text until
 * preparation: ConfigUtils recovers invalid strings as white, not on import. */
export const DEFAULT_SOURCE_SURFACE_COLORS=Object.freeze(['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC']);
export const MAX_SOURCE_SURFACE_COLORS=65_536;
export interface SourceSurfacePalette {colors:string[];}
export interface PreparedSourceSurfaceColors {packed:Uint32Array;colors:Float32Array;diagnostics:string[];}
export interface PreparedSourceSurfacePalette {readonly packed:readonly number[];readonly diagnostics:readonly string[];}
const F=Math.fround;

export function parseSourceSurfacePalette(input:unknown):SourceSurfacePalette {
 if(!input||typeof input!=='object'||Array.isArray(input)||!('colors'in input)||!Array.isArray(input.colors))throw new Error('原版曲面色板必须包含 colors 数组');
 // ManimColors.gradient rejects the empty palette before initDots/applyPalette.
 if(input.colors.length===0)throw new Error('原版曲面色板至少需要一种颜色');
 if(input.colors.length>MAX_SOURCE_SURFACE_COLORS)throw new Error('原版曲面色板超过本地 65536 色准备预算');
 let textLength=0;
 const colors=Array.from(input.colors,value=>{
  if(typeof value!=='string')throw new Error('原版曲面色板颜色必须是字符串');
  textLength+=value.length;
  if(textLength>SOURCE_COLOR_TEXT_BUDGET)throw new Error('原版曲面色板超过本地 1 MiB 文本准备预算');
  return value;
 });
 return{colors};
}

/** Parse once; current and historical samplers consume the same packed facts. */
export function prepareSourceSurfacePalette(input:SourceSurfacePalette|undefined):PreparedSourceSurfacePalette {
 const palette=parseSourceSurfacePalette(input===undefined?{colors:[...DEFAULT_SOURCE_SURFACE_COLORS]}:input),diagnostics:string[]=[];
 const references=palette.colors.map((text,index)=>{
  try{return sourceConfigPackedColor(text);}catch(error){
   if(!(error instanceof SourceConfigColorError))throw error;
   diagnostics.push(`原版曲面色板第 ${index+1} 色无法解析，按原版采用白色；原字符串已保留。`);
   return 0xffffffff;
  }
 });
 return Object.freeze({packed:Object.freeze(references),diagnostics:Object.freeze(diagnostics)});
}

/** Final static CPU colors after applyPalette replaces the initial reversed
 * gradient. The shared sampler also owns dynamic colors; this entry point
 * deliberately requests the initial inactive state. */
export function prepareSourceSurfaceColors(input:SourceSurfacePalette|undefined,numU:number,numV:number,cyclic:boolean):PreparedSourceSurfaceColors {
 for(const size of [numU,numV])if(!Number.isInteger(size)||size<1||size>512)throw new Error('原版曲面颜色网格每轴必须为 1 至 512 的整数');
 if(typeof cyclic!=='boolean')throw new Error('原版曲面颜色周期标记必须是布尔值');
 const palette=prepareSourceSurfacePalette(input),rows=new Uint32Array(numU);
 for(let i=0;i<numU;i++){
  const coordinate=numU===1?0:F(i/Math.max(1,numU-1));
  rows[i]=sampleSourceSurfaceGradient(palette.packed,coordinate,INITIAL_SOURCE_SURFACE_PALETTE_STATE,'hue_rotate','rgb',cyclic);
 }
 // Source CPU getCyclicPaletteSmoothingPasses() returns zero; the explicit
 // endpoint replacement still runs, even though wrapped sampling matches it.
 if(cyclic&&numU>1)rows[numU-1]=rows[0];
 const packed=new Uint32Array(numU*numV),colors=new Float32Array(packed.length*3);
 for(let id=0;id<packed.length;id++){
  const color=rows[Math.floor(id/numV)];packed[id]=color;
  colors[id*3]=((color>>>16)&255)/255;colors[id*3+1]=((color>>>8)&255)/255;colors[id*3+2]=(color&255)/255;
 }
 return{packed,colors,diagnostics:[...palette.diagnostics]};
}
