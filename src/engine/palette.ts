import type { CosinePalette, Palette, PaletteCurvePoint, PaletteCurves, RGB } from "../types";
export const PALETTES: Palette[] = [
  {
    name: "极光 · Aurora",
    stops: ["#43d9bd", "#88ebcf", "#f9d48f", "#f08c85"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
  {
    name: "暮色 · Dusk",
    stops: ["#292c6d", "#8264c4", "#de7f9a", "#f6d7a6"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
  {
    name: "冰川 · Glacier",
    stops: ["#162c56", "#347fa7", "#7ce0d7", "#e4fff0"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
  {
    name: "火焰 · Ember",
    stops: ["#200c24", "#8c2949", "#e97547", "#ffe8a1"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
  {
    name: "光谱 · Spectrum",
    stops: ["#f46683", "#f6cf66", "#83e083", "#64cfec", "#a58aed", "#f46683"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
  {
    name: "月光 · Monochrome",
    stops: ["#2c3444", "#a5b7cc", "#ffffff"],
    mode: "linear",
    offset: 0,
    cycles: 1,
  },
];
export function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((x) => x + x)
          .join("")
      : h,
    16,
  );
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export function hsvRGB(
  h: number,
  s: number,
  v: number,
): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
export const MAX_PALETTE_STOPS = 1024;
/** Validate once at document/animation boundaries, outside pixel sampling loops. */
export function validatePalettePositions(stops: string[], positions?: number[]): void {
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_PALETTE_STOPS)
    throw new Error(`渐变需要2–${MAX_PALETTE_STOPS}个色标`);
  if (positions === undefined) return;
  if (!Array.isArray(positions) || positions.length !== stops.length)
    throw new Error('色标位置必须与颜色数量一致');
  if (positions[0] !== 0 || positions[positions.length - 1] !== 1)
    throw new Error('色标位置首尾必须为0和1');
  for (let i = 0; i < positions.length; i++)
    if (!Number.isFinite(positions[i]) || (i > 0 && positions[i] <= positions[i - 1]))
      throw new Error('色标位置必须是有限、严格递增的数值');
}
/** Sample the closed stop domain before palette cycling or coordinate warps. */
export function paletteStopsColor(stops: string[], t: number, positions?: number[]): [number, number, number] {
  if (stops.length < 2 || stops.length > MAX_PALETTE_STOPS)
    throw new Error(`渐变需要2–${MAX_PALETTE_STOPS}个色标`);
  if (!Number.isFinite(t)) throw new Error('颜色采样位置必须是有限数值');
  if (positions && (positions.length !== stops.length || positions[0] !== 0 || positions[positions.length - 1] !== 1))
    throw new Error('色标位置数量或首尾无效');
  if (t <= 0) return hexRGB(stops[0]);
  if (t >= 1) return hexRGB(stops[stops.length - 1]);
  let index: number, fraction: number;
  if (positions) {
    let lo = 0, hi = positions.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (positions[mid] <= t) lo = mid; else hi = mid;
    }
    const width = positions[hi] - positions[lo];
    if (!(width > 0) || !Number.isFinite(width)) throw new Error('色标位置必须严格递增');
    index = lo; fraction = (t - positions[lo]) / width;
  } else {
    const scaled = t * (stops.length - 1);
    index = Math.floor(scaled); fraction = scaled - index;
  }
  const a = hexRGB(stops[index]), b = hexRGB(stops[index + 1]);
  return a.map((v, i) => v + (b[i] - v) * fraction) as [number, number, number];
}
export function vertexColors(
  positions: Float32Array,
  palette: Palette,
  metric = "height",
): Float32Array {
  const n = positions.length / 3,
    colors = new Float32Array(positions.length);
  let lo = Infinity,
    hi = -Infinity;
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    const v =
      metric === "radius"
        ? Math.hypot(x, y, z)
        : metric === "angle"
          ? Math.atan2(y, x)
          : metric === "index"
            ? i
            : y;
    values[i] = v;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < n; i++)
    colors.set(paletteColor(palette, (values[i] - lo) / (hi - lo || 1)), i * 3);
  return colors;
}

export const MAX_EDITABLE_PALETTE_STOPS = 25;
export const MAX_CURVE_POINTS = 256;
export const MAX_PALETTE_IMPORT_BYTES = 256 * 1024;
/** Defaults retain the old cosine renderer, whose phases were expressed in radians. */
export const DEFAULT_COSINE: CosinePalette = { a: [.5,.5,.5], b: [.5,.5,.5], c: [1,1,1], d: [0,1/Math.PI,2/Math.PI] };
export const DEFAULT_CURVES: PaletteCurves = {
  red: [{x:0,y:0},{x:1,y:1}], green: [{x:0,y:0},{x:1,y:1}], blue: [{x:0,y:0},{x:1,y:1}],
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const record = (v: unknown): v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
export function rgbHex(rgb: readonly number[]): string { if(rgb.length!==3||rgb.some(v=>!Number.isFinite(v)))throw new Error('RGB 需要三个有限数值');return '#' + rgb.map(v => Math.round(clamp(v)*255).toString(16).padStart(2,'0')).join(''); }
export function rgbHSV([r,g,b]: RGB): RGB {
  const hi=Math.max(r,g,b), lo=Math.min(r,g,b), d=hi-lo;
  const h=d===0?0:hi===r?((g-b)/d+6)%6:hi===g?(b-r)/d+2:(r-g)/d+4;
  return [h/6,hi===0?0:d/hi,hi];
}
export function palettePositions(p: Pick<Palette,'stops'|'positions'>): number[] {
  return p.positions ? [...p.positions] : p.stops.map((_,i)=>i/(p.stops.length-1));
}
export function validateCurvePoints(input: unknown): PaletteCurvePoint[] {
  if(!Array.isArray(input)||input.length<2||input.length>MAX_CURVE_POINTS) throw new Error(`每条曲线需要 2–${MAX_CURVE_POINTS} 个节点`);
  let previous=-1;
  return [...input].map(point=>{
    if(!record(point)||typeof point.x!=='number'||typeof point.y!=='number'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1||point.x<=previous||(previous>=0&&point.x-previous<Number.EPSILON)) throw new Error('曲线节点必须在 0–1 内，X 严格递增');
    previous=point.x; return {x:point.x,y:point.y};
  });
}
/** The document/import boundary owns validation and returns a detached representation. */
export function validatePalette(input: unknown): Palette {
  if(!record(input))throw new Error('调色板格式无效');
  if(typeof input.name!=='string'||input.name.length>256)throw new Error('调色板名称应为不超过 256 字的文本');
  if(!Array.isArray(input.stops)||![...input.stops].every(isHex))throw new Error('色标必须使用 #RRGGBB');
  const stops=[...input.stops] as string[];
  if(input.positions!==undefined&&(!Array.isArray(input.positions)||input.positions.some(v=>typeof v!=='number')))throw new Error('色标位置必须是数值数组');
  const positions=input.positions===undefined?undefined:[...(input.positions as number[])];
  validatePalettePositions(stops,positions);
  if(typeof input.mode!=='string'||!['linear','sine','cosine','curve','hsv'].includes(input.mode))throw new Error('未知调色板模式');
  if(typeof input.offset!=='number'||typeof input.cycles!=='number'||!Number.isFinite(input.offset)||!Number.isFinite(input.cycles))throw new Error('调色板偏移与周期必须为有限数值');
  if(input.interpolation!==undefined&&input.interpolation!=='rgb'&&input.interpolation!=='hsv')throw new Error('未知色标插值空间');
  const result:Palette={name:input.name,stops,mode:input.mode as Palette['mode'],offset:input.offset,cycles:input.cycles};
  if(positions)result.positions=positions;
  if(input.interpolation!==undefined)result.interpolation=input.interpolation;
  if(input.cosine!==undefined){
    if(!record(input.cosine))throw new Error('余弦参数格式无效');
    const cosine={} as CosinePalette;
    for(const key of ['a','b','c','d'] as const){const v=input.cosine[key];if(!Array.isArray(v)||v.length!==3||[...v].some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('余弦 A/B/C/D 各需要三个有限 RGB 数值');cosine[key]=[...v] as RGB;}
    result.cosine=cosine;
  }
  if(input.curves!==undefined){
    if(!record(input.curves))throw new Error('RGB 曲线格式无效');
    result.curves={red:validateCurvePoints(input.curves.red),green:validateCurvePoints(input.curves.green),blue:validateCurvePoints(input.curves.blue)};
  }
  return result;
}

function hsvStopsColor(stops:string[],t:number,positions?:number[]):RGB {
  if(t<=0)return hexRGB(stops[0]); if(t>=1)return hexRGB(stops[stops.length-1]);
  let lo=0, hi=stops.length-1;
  if(positions){while(hi-lo>1){const mid=(lo+hi)>>>1;if(positions[mid]<=t)lo=mid;else hi=mid;}}
  else{lo=Math.floor(t*(stops.length-1));hi=lo+1;}
  const f=positions?(t-positions[lo])/(positions[hi]-positions[lo]):t*(stops.length-1)-lo;
  return interpolatePaletteColor(hexRGB(stops[lo]),hexRGB(stops[hi]),f,'hsv');
}
/** Shared stop and closing-segment interpolation; tuples avoid HEX quantization. */
export function interpolatePaletteColor(left:RGB,right:RGB,t:number,space:'rgb'|'hsv'='rgb'):RGB {
  if(!Number.isFinite(t))throw new Error('颜色采样位置必须是有限数值');
  const f=clamp(t);if(f===0)return [...left];if(f===1)return [...right];
  if(space==='rgb')return left.map((v,i)=>v+(right[i]-v)*f) as RGB;
  const {left:a,right:b,hueDelta:dh}=preparePaletteHsv(left,right);
  return hsvRGB(a[0]+dh*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f);
}
export interface PreparedPaletteHsv {left:RGB;right:RGB;hueDelta:number}
/** Same endpoint hue inheritance and tie convention used by the authored sampler. */
export function preparePaletteHsv(left:RGB,right:RGB):PreparedPaletteHsv {
  const a=rgbHSV(left),b=rgbHSV(right);
  if(a[1]<1e-12)a[0]=b[0]; if(b[1]<1e-12)b[0]=a[0];
  let dh=b[0]-a[0]; if(dh>.5)dh-=1; if(dh<-.5)dh+=1;
  return{left:a,right:b,hueDelta:dh};
}

/** Shape-preserving piecewise cubic Hermite (equivalently cubic Bézier) interpolation.
 * Source palettes expose points but not original control-handle construction; this is independent. */
export function curveValue(points:PaletteCurvePoint[],t:number):number {
  if(t<=points[0].x)return points[0].y;
  if(t>=points[points.length-1].x)return points[points.length-1].y;
  let lo=0,hi=points.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(points[mid].x<=t)lo=mid;else hi=mid;}
  const tangent=(i:number)=>paletteCurveTangent(points,i);
  const width=points[hi].x-points[lo].x,u=(t-points[lo].x)/width,u2=u*u,u3=u2*u;
  return clamp((2*u3-3*u2+1)*points[lo].y+(u3-2*u2+u)*width*tangent(lo)+(-2*u3+3*u2)*points[hi].y+(u3-u2)*width*tangent(hi));
}
/** Shared PCHIP tangent producer. Keeping the original arithmetic order
 * preserves existing CPU samples; GPU plans consume its prepared values. */
export function paletteCurveTangent(points:PaletteCurvePoint[],i:number):number {
  const secant=(i:number)=>(points[i+1].y-points[i].y)/(points[i+1].x-points[i].x);

    if(points.length===2)return secant(0);
    if(i===0||i===points.length-1){
      const end=i===0, a=end?0:points.length-2,b=end?1:points.length-3;
      const h0=points[a+1].x-points[a].x,h1=points[b+1].x-points[b].x,d0=secant(a),d1=secant(b);
      const m=((2*h0+h1)*d0-h0*d1)/(h0+h1);
      return Math.sign(m)!==Math.sign(d0)?0:Math.sign(d0)!==Math.sign(d1)&&Math.abs(m)>Math.abs(3*d0)?3*d0:m;
    }
    const left=secant(i-1),right=secant(i);
    if(left*right<=0)return 0;
    const h0=points[i].x-points[i-1].x,h1=points[i+1].x-points[i].x,w1=2*h1+h0,w2=h1+2*h0;
    return (w1+w2)/(w1/left+w2/right);

}
export interface PreparedPaletteCurveSegment {x0:number;x1:number;y0:number;y1:number;m0:number;m1:number}
export function preparePaletteCurve(points:PaletteCurvePoint[]):PreparedPaletteCurveSegment[] {
 return points.slice(0,-1).map((p,i)=>({x0:p.x,x1:points[i+1].x,y0:p.y,y1:points[i+1].y,m0:paletteCurveTangent(points,i),m1:paletteCurveTangent(points,i+1)}));
}
/** Shared ordinary-palette sampling facts. Consumers must not reinterpret
 * dormant palette fields or independently select active mode/interpolation. */
export type PreparedPaletteShape =
 | {kind:'stops';warp:'identity'|'sine';colors:RGB[];positions:number[];interpolation:'rgb'|'hsv';hsv?:PreparedPaletteHsv[]}
 | {kind:'hsv-wheel'}
 | {kind:'cosine';cosine:CosinePalette}
 | {kind:'curve';channels:[PreparedPaletteCurveSegment[],PreparedPaletteCurveSegment[],PreparedPaletteCurveSegment[]]};
export function preparePaletteShape(palette:Palette):PreparedPaletteShape {
 if(palette.mode==='hsv')return{kind:'hsv-wheel'};
 if(palette.mode==='cosine'){const c=palette.cosine??DEFAULT_COSINE;return{kind:'cosine',cosine:{a:[...c.a],b:[...c.b],c:[...c.c],d:[...c.d]}};}
 if(palette.mode==='curve'){const c=palette.curves??DEFAULT_CURVES;return{kind:'curve',channels:[preparePaletteCurve(c.red),preparePaletteCurve(c.green),preparePaletteCurve(c.blue)]};}
 const colors=palette.stops.map(hexRGB),interpolation=palette.interpolation??'rgb';
 return{kind:'stops',warp:palette.mode==='sine'?'sine':'identity',colors,positions:palettePositions(palette),interpolation,...(interpolation==='hsv'?{hsv:colors.slice(0,-1).map((color,i)=>preparePaletteHsv(color,colors[i+1]))}:{})};
}
/** Closed domain for editor previews and baking; offset/cycles are applied by paletteColor. */
export function paletteBaseColor(p:Palette,t:number):RGB {
  if(!Number.isFinite(t))throw new Error('颜色采样位置必须是有限数值');
  t=clamp(t);
  if(p.mode==='sine')t=.5-.5*Math.cos(t*Math.PI*2);
  if(p.mode==='cosine'){
    const c=p.cosine??DEFAULT_COSINE;
    return c.a.map((a,i)=>clamp(a+c.b[i]*Math.cos(2*Math.PI*((c.c[i]*t)%1+c.d[i]%1)))) as RGB;
  }
  if(p.mode==='curve'){const c=p.curves??DEFAULT_CURVES;return [curveValue(c.red,t),curveValue(c.green,t),curveValue(c.blue,t)];}
  if(p.mode==='hsv')return hsvRGB(t,.72,1);
  return p.interpolation==='hsv'?hsvStopsColor(p.stops,t,p.positions):paletteStopsColor(p.stops,t,p.positions);
}
export function paletteColor(p:Palette,t:number):RGB {
  const coordinate=t*p.cycles+p.offset;
  if(!Number.isFinite(coordinate))throw new Error('调色板采样坐标必须是有限数值');
  return paletteBaseColor(p,((coordinate%1)+1)%1);
}

export function insertPaletteStop(p:Palette,position?:number,color?:string):Palette {
  const result=validatePalette(p), positions=palettePositions(result);
  if(result.stops.length>=MAX_EDITABLE_PALETTE_STOPS)throw new Error(`手动编辑最多 ${MAX_EDITABLE_PALETTE_STOPS} 个色标`);
  if(position===undefined){let i=0;for(let j=1;j<positions.length-1;j++)if(positions[j+1]-positions[j]>positions[i+1]-positions[i])i=j;position=(positions[i]+positions[i+1])/2;}
  if(!Number.isFinite(position)||position<=0||position>=1||positions.some(x=>Math.abs(x-position!)<1e-6))throw new Error('新色标须位于 0–1 内且不与已有色标重叠');
  if(color!==undefined&&!isHex(color))throw new Error('色标必须使用 #RRGGBB');
  const i=positions.findIndex(x=>x>position!);
  result.stops.splice(i,0,color??rgbHex(result.interpolation==='hsv'?hsvStopsColor(result.stops,position,result.positions):paletteStopsColor(result.stops,position,result.positions)));
  positions.splice(i,0,position);result.positions=positions;return result;
}
export function movePaletteStop(p:Palette,index:number,position:number):Palette {
  const result=validatePalette(p),positions=palettePositions(result);
  if(!Number.isInteger(index)||index<0||index>=positions.length)throw new Error('色标索引无效');
  if(!Number.isFinite(position))throw new Error('色标位置必须为有限数值');
  if(index===0||index===positions.length-1){result.positions=positions;return result;}
  positions[index]=Math.max(positions[index-1]+1e-6,Math.min(positions[index+1]-1e-6,position));
  validatePalettePositions(result.stops,positions);result.positions=positions;return result;
}
export function removePaletteStop(p:Palette,index:number):Palette {
  const result=validatePalette(p),positions=palettePositions(result);
  if(result.stops.length<=2)throw new Error('至少保留两个色标');
  if(!Number.isInteger(index)||index<0||index>=positions.length)throw new Error('色标索引无效');
  result.stops.splice(index,1);positions.splice(index,1);positions[0]=0;positions[positions.length-1]=1;result.positions=positions;return result;
}
export function reversePalette(p:Palette):Palette {
  const result=validatePalette(p);
  if(p.mode==='cosine'){
    const c=p.cosine??DEFAULT_COSINE;
    result.cosine={a:[...c.a],b:[...c.b],c:c.c.map(v=>-v) as RGB,d:c.d.map((v,i)=>v+c.c[i]) as RGB};
  }else if(p.mode==='curve'){
    const c=p.curves??DEFAULT_CURVES,rev=(points:PaletteCurvePoint[])=>points.map(({x,y})=>({x:1-x,y})).reverse();
    result.curves={red:rev(c.red),green:rev(c.green),blue:rev(c.blue)};
  }else if(p.mode==='hsv'){
    result.cycles=-p.cycles;result.offset=-p.offset;
  }else{result.stops.reverse();if(result.positions)result.positions=result.positions.map(v=>1-v).reverse();}
  return result;
}
export function bakePalette(p:Palette,count=25):Palette {
  if(!Number.isInteger(count)||count<2||count>MAX_EDITABLE_PALETTE_STOPS)throw new Error('烘焙色标数量应为 2–25');
  return {name:p.name,mode:'linear',offset:p.offset,cycles:p.cycles,stops:Array.from({length:count},(_,i)=>rgbHex(paletteBaseColor(p,i/(count-1))))};
}
export type PaletteStrategy='monochromatic'|'analogous'|'complementary'|'split-complementary';
// Local deterministic generator; palette generation does not load the equation compiler.
function paletteRandom(seed:number){let s=seed>>>0;return ()=>{s+=0x6D2B79F5;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
export function randomPrimaryColors(seed:number,count=3):string[]{
  if(!Number.isInteger(count)||count<3||count>6)throw new Error('主色数量应为 3–6');
  if(!Number.isSafeInteger(seed))throw new Error('随机种子须为安全整数');
  const next=paletteRandom(seed),h=next(),hues=[h,h+5/12,h+7/12];
  return Array.from({length:count},(_,i)=>rgbHex(hsvRGB(hues[i%3],.5+next()*.4,.65+next()*.35)));
}
export interface RandomPaletteOptions {strategy:PaletteStrategy;count:number;seed:number;primaryColors?:string[]}
export function randomPalette(options:RandomPaletteOptions):Palette {
  const {strategy,count,seed}=options;
  if(!['monochromatic','analogous','complementary','split-complementary'].includes(strategy))throw new Error('未知随机配色策略');
  if(!Number.isInteger(count)||count<2||count>16)throw new Error('随机颜色数量应为 2–16');
  if(!Number.isSafeInteger(seed))throw new Error('随机种子须为安全整数');
  if(options.primaryColors&&(options.primaryColors.length<3||options.primaryColors.length>6||!options.primaryColors.every(isHex)))throw new Error('主色应为 3–6 个 #RRGGBB 颜色');
  const next=paletteRandom(seed),h=next();
  const primaries=(options.primaryColors??randomPrimaryColors(seed)).map(c=>rgbHSV(hexRGB(c)));
  const stops=Array.from({length:count},(_,i)=>{
    let hue=h,s=.4+.5*next(),v=.35+.65*next();
    if(strategy==='analogous')hue+=((i/(count-1))-.5)/6;
    if(strategy==='complementary')hue+=(i%2)*.5;
    if(strategy==='split-complementary'){const base=primaries[i%primaries.length];hue=base[0];s=clamp(base[1]*(.8+.2*next()));v=clamp(base[2]*(.8+.2*next()));}
    return rgbHex(hsvRGB(hue,s,v));
  });
  return {name:'随机调色板',mode:'linear',interpolation:'rgb',stops,offset:0,cycles:1};
}
export function randomCosinePalette(seed:number):CosinePalette {
  if(!Number.isSafeInteger(seed))throw new Error('随机种子须为安全整数');
  const next=paletteRandom(seed),triple=(fn:()=>number)=>[fn(),fn(),fn()] as RGB;
  return {a:triple(()=>.3+next()*.4),b:triple(()=>.2+next()*.3),c:triple(()=>.5+next()*1.5),d:triple(next)};
}
/** Seeded hue strategies become editable RGB knots. The shared shape-preserving
 * cubic sampler owns interpolation; dormant palette data and mapping survive. */
export function randomizePalette(palette:Palette,options:RandomPaletteOptions):Palette {
 const current=validatePalette(palette),generated=randomPalette(options);
 if(current.mode==='cosine')return{...current,cosine:randomCosinePalette(options.seed)};
 if(current.mode==='curve'){
  const colors=generated.stops.map(hexRGB),positions=palettePositions(generated);
  const channel=(k:0|1|2)=>colors.map((rgb,i)=>({x:positions[i],y:rgb[k]}));
  return{...current,curves:{red:channel(0),green:channel(1),blue:channel(2)}};
 }
 // The fixed HSV wheel has no editable stops; its UI explicitly offers creation
 // of a manual palette. All editable modes retain their active representation.
 return{...current,mode:current.mode==='hsv'?'linear':current.mode,stops:generated.stops,positions:undefined,interpolation:'rgb'};
}
export function parsePalette(text:string):Palette {
  if(new TextEncoder().encode(text).byteLength>MAX_PALETTE_IMPORT_BYTES)throw new Error('调色板文件不得超过 256 KiB');
  let value:unknown;try{value=JSON.parse(text);}catch{throw new Error('调色板 JSON 格式无效');}
  if(Array.isArray(value))value={name:'导入调色板',stops:value,mode:'linear',offset:0,cycles:1};
  if(record(value)&&value.type==='mathart-palette'){
    if(value.version!==1)throw new Error('不支持此调色板文件版本');value=value.palette;
  }
  return validatePalette(value);
}
export function serializePalette(p:Palette):string {return JSON.stringify({type:'mathart-palette',version:1,palette:validatePalette(p)},null,2);}
