import {sourceConfigPackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {sourceColorLerp} from './domainSourcePalette';

/** ManimColors.DEFAULT_PALETTE, MathArt 1.7.8. Keep authored color text until
 * preparation: ConfigUtils recovers invalid strings as white, not on import. */
export const DEFAULT_SOURCE_SURFACE_COLORS=Object.freeze(['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC']);
export const MAX_SOURCE_SURFACE_COLORS=65_536;
export interface SourceSurfacePalette {colors:string[];}
export interface PreparedSourceSurfaceColors {packed:Uint32Array;colors:Float32Array;diagnostics:string[];}
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

/** Final static CPU colors, after GenericSurfaceScene calls applyPalette.
 * That refresh replaces initDots' reversed initial gradient. Particle id is
 * U-major; colors remain attached to that id as the particle moves.
 * ParametricSurface.refreshParticleColorsByOffset PCs130–302 and
 * sampleShiftedPalette PCs0–192: float32 phases, including endpoint wrapping
 * on nonperiodic U, and packed-byte RGB interpolation. No dynamic gradient. */
export function prepareSourceSurfaceColors(input:SourceSurfacePalette|undefined,numU:number,numV:number,cyclic:boolean):PreparedSourceSurfaceColors {
 for(const size of [numU,numV])if(!Number.isInteger(size)||size<1||size>512)throw new Error('原版曲面颜色网格每轴必须为 1 至 512 的整数');
 if(typeof cyclic!=='boolean')throw new Error('原版曲面颜色周期标记必须是布尔值');
 const palette=parseSourceSurfacePalette(input===undefined?{colors:[...DEFAULT_SOURCE_SURFACE_COLORS]}:input),diagnostics:string[]=[];
 const references=palette.colors.map((text,index)=>{
  try{return sourceConfigPackedColor(text);}catch(error){
   if(!(error instanceof SourceConfigColorError))throw error;
   diagnostics.push(`原版曲面色板第 ${index+1} 色无法解析，按原版采用白色；原字符串已保留。`);
   return 0xffffffff;
  }
 });
 const n=references.length,rows=new Uint32Array(numU);
 for(let i=0;i<numU;i++){
  if(n===1){rows[i]=references[0];continue;}
  const coordinate=numU===1?0:F(i/Math.max(1,numU-1));
  const wrapped=F(coordinate-F(Math.floor(coordinate))),position=F(wrapped*(cyclic?n:n-1));
  const index=Math.min(cyclic?n-1:n-2,Math.trunc(position)),fraction=F(position-F(index));
  rows[i]=sourceColorLerp(references[index],references[cyclic?(index+1)%n:index+1],fraction,'rgb');
 }
 // Source CPU getCyclicPaletteSmoothingPasses() returns zero; the explicit
 // endpoint replacement still runs, even though wrapped sampling matches it.
 if(cyclic&&numU>1)rows[numU-1]=rows[0];
 const packed=new Uint32Array(numU*numV),colors=new Float32Array(packed.length*3);
 for(let id=0;id<packed.length;id++){
  const color=rows[Math.floor(id/numV)];packed[id]=color;
  colors[id*3]=((color>>>16)&255)/255;colors[id*3+1]=((color>>>8)&255)/255;colors[id*3+2]=(color&255)/255;
 }
 return{packed,colors,diagnostics};
}
