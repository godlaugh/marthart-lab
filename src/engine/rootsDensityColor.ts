import type {RootsSourcePalette,SceneDocument,Settings} from '../types';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor} from './sourceConfigColor';
import {sourceNumberTokenValid} from './sourceNumberTokens';
export type {RootsSourcePalette} from '../types';

export const ROOTS_DENSITY_COLOR_VERSION='mathart-1.7.8-metric-v1' as const;
export type RootsDensityColorVersion='local-rgb-v1'|typeof ROOTS_DENSITY_COLOR_VERSION;
export type RootsMetricKind='radius'|'t2_real'|'t2_imag';
export interface RootsMetricColorPlan {
 readonly kind:'metric-sum';readonly version:typeof ROOTS_DENSITY_COLOR_VERSION;readonly metric:RootsMetricKind;
 /** Owned RGBA8 LUT; 256 texels, linear normalized sampling, clamped edges. */
 readonly lut:Uint8Array;
 readonly paletteOffset:number;readonly brightness:number;readonly contrast:number;readonly gamma:number;
 readonly dynamicRange:number;readonly saturation:number;readonly backgroundRGB:readonly[number,number,number];
 /** Original packed ARGB for the source Scene background/fade path. Its
  * Processing grayscale/alpha semantics differ from the shader RGB uniform. */
 readonly backgroundPacked:number;
 readonly diagnostics:readonly string[];
}
export type PreparedRootsDensityColor={readonly kind:'rgb-sum';readonly version:'local-rgb-v1'}|RootsMetricColorPlan;
export const DEFAULT_ROOTS_SOURCE_COLORS=Object.freeze(['#1A1A2E','#0F3460','#E94560','#F5A623']);
// A local preparation bound, not a source palette cardinality or GL uniform
// limit. The source array is retained; its output is always a 256-texel LUT.
export const MAX_ROOTS_SOURCE_COLORS=65_536;
export const MAX_ROOTS_SOURCE_COLOR_TEXT=SOURCE_COLOR_TEXT_BUDGET;
export interface RootsSourceToneField {readonly key:string;readonly field:'brightness'|'contrast'|'gamma'|'dynamicRange'|'saturation'|'paletteOffset';readonly sourceKey?:string;readonly label:string;readonly default:number;readonly min?:number;readonly max?:number;readonly step:number;}
export const ROOTS_SOURCE_TONE_FIELDS:readonly RootsSourceToneField[]=Object.freeze(([
 {key:'rootSourceBrightness',field:'brightness',sourceKey:'brightness',label:'原版复根亮度',default:1,min:-.5,max:1.5,step:.01},
 {key:'rootSourceContrast',field:'contrast',sourceKey:'contrast',label:'原版复根对比度',default:1,min:.1,max:2,step:.01},
 {key:'rootSourceGamma',field:'gamma',sourceKey:'gamma',label:'原版复根伽马',default:2.2,min:.1,max:10,step:.01},
 {key:'rootSourceDynamicRange',field:'dynamicRange',sourceKey:'dynamic_range',label:'原版复根动态范围',default:1,min:.1,max:1,step:.01},
 {key:'rootSourceSaturation',field:'saturation',sourceKey:'saturation',label:'原版复根饱和度',default:1,min:0,max:1,step:.01},
 // Native offset is a runtime uniform, not a field read by the JSON constructor.
 {key:'rootSourcePaletteOffset',field:'paletteOffset',label:'原版复根色板偏移',default:0,step:.01},
] as RootsSourceToneField[]).map(field=>Object.freeze(field)));
export const ROOTS_SOURCE_TONE_DEFAULTS=Object.freeze(Object.fromEntries(ROOTS_SOURCE_TONE_FIELDS.map(f=>[f.key,Math.fround(f.default)])) as Readonly<Record<string,number>>);
const F=Math.fround,clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const cancel=(fn?:()=>boolean)=>{if(fn?.())throw new DOMException('复根标量密度调色已取消','AbortError');};

export function parseRootsDensityColorVersion(raw:unknown):RootsDensityColorVersion {
 if(raw===undefined||raw==='local-rgb-v1')return'local-rgb-v1';
 if(raw===ROOTS_DENSITY_COLOR_VERSION)return raw;throw new Error('复根密度颜色版本无效');
}
export function parseRootsMetricKind(raw:unknown):RootsMetricKind {
 if(raw===undefined)return't2_imag';if(raw==='radius'||raw==='t2_real'||raw==='t2_imag')return raw;throw new Error('复根源颜色度量无效');
}
export function usesRootsSourceDensity(settings:Settings):boolean {
 return parseRootsDensityColorVersion(settings.rootDensityColorVersion)===ROOTS_DENSITY_COLOR_VERSION&&settings.rootsMode==='progressive';
}
/** A source scalar can become infinite at d2f before the runtime range clamp.
 * NaN has no defined normal image; it is an input error, not a lost point. */
export function normalizeRootsSourceToneField(key:string,value:number):number {
 if(typeof value!=='number'||Number.isNaN(value))throw new Error(`复根源调色 ${key} 必须为有效数值`);
 if(key==='rootSourcePaletteOffset'){const v=F(value);if(!Number.isFinite(v))throw new Error('复根源色板偏移必须在 float32 有限范围内');return v;}
 const spec=ROOTS_SOURCE_TONE_FIELDS.find(f=>f.key===key);if(!spec)throw new Error('未知复根源调色字段：'+key);
 return clamp(F(value),F(spec.min!),F(spec.max!));
}
/** Serialized settings stay finite numbers, even when currently inactive. */
export function validateRootsSourceColorSettings(settings:Settings):void {
 parseRootsDensityColorVersion(settings.rootDensityColorVersion);
 for(const key of Object.keys(ROOTS_SOURCE_TONE_DEFAULTS))if(settings[key]!==undefined){
  const value=settings[key];if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`复根源调色 ${key} 必须为有限数值`);
  normalizeRootsSourceToneField(key,value);
 }
}
/** JSONObject.getString(key,"#000000") then ConfigUtils.parseColor.
 * JSON integer tokens become Integer/Long text; decimal/exponent tokens become
 * Double text (always containing a decimal point or exponent), which parseColor
 * rejects. Retaining the token preserves these color results without pretending
 * to reproduce Java's display formatting. JS numbers alone lose that distinction.
 * Non-scalar JSON objects always stringify to non-color text and recover to white. */
export function rootsSourceBackground(raw:unknown,options:{numberToken?:string}={}):{value:string;diagnostics:string[]} {
 if(raw===undefined||raw===null)return{value:'#000000',diagnostics:[]};
 if(typeof raw==='string'){
  if(raw.length>MAX_ROOTS_SOURCE_COLOR_TEXT)throw new Error('复根源背景超过本地 1 MiB 文本准备预算');
  return{value:raw,diagnostics:[]};
 }
 if(typeof raw==='number'){
  const token=options.numberToken;
  if(typeof token!=='string')throw new Error('复根源数字背景缺少 JSON 原始数字文本，无法区分整数与小数颜色；请导入原始 JSON 文本');
  if(token.length>MAX_ROOTS_SOURCE_COLOR_TEXT)throw new Error('复根源背景超过本地 1 MiB 文本准备预算');
  if(!sourceNumberTokenValid(token)||!Object.is(Number(token),raw))throw new Error('复根源背景数字文本与解析值不一致');
  return{value:token,diagnostics:[]};
 }
 if(typeof raw==='boolean'||typeof raw==='object')return{value:'#FFFFFF',diagnostics:['原版复根背景的非字符串值会转成无法解析的颜色文本，按原版采用白色；原值已保留。']};
 throw new Error('复根源背景必须是 JSON 值');
}
export function normalizeRootsSourceMetric(raw:unknown):{metric:RootsMetricKind;diagnostics:string[]} {
 const text=raw==null?'im(t2)':String(raw).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'').toLowerCase();
 if(text==='im(t2)')return{metric:'t2_imag',diagnostics:[]};if(text==='re(t2)')return{metric:'t2_real',diagnostics:[]};
 if(text==='root.radius'||text==='root.radio')return{metric:'radius',diagnostics:[]};
 return{metric:'t2_imag',diagnostics:['原版未识别此复根颜色度量，采用 im(t2)；原值已保留。']};
}
export function parseRootsSourcePalette(input:unknown):RootsSourcePalette {
 if(!input||typeof input!=='object'||Array.isArray(input)||!('colors'in input)||!Array.isArray(input.colors))throw new Error('复根源色板必须包含 colors 数组');
 if(input.colors.length>MAX_ROOTS_SOURCE_COLORS)throw new Error('复根源色板超过本地 65536 色准备预算');
 let length=0;const colors=Array.from(input.colors,value=>{
  if(typeof value!=='string')throw new Error('复根源色板颜色必须是字符串');length+=value.length;
  if(length>MAX_ROOTS_SOURCE_COLOR_TEXT)throw new Error('复根源色板超过本地 1 MiB 文本准备预算');return value;
 });return{colors};
}
function packedColor(raw:string,diagnostics?:string[],label='颜色'):number {
 if(typeof raw!=='string'||raw.length>MAX_ROOTS_SOURCE_COLOR_TEXT)throw new Error('复根源颜色字符串无效或超出文本预算');
 try{return sourceConfigPackedColor(raw);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics?.push(`复根源${label}无法解析，按原版采用白色；原字符串已保留。`);return 0xffffffff;}
}
export function rootsSourceColorRgbHex(color:string):string{return'#'+(packedColor(color)&0xffffff).toString(16).padStart(6,'0').toUpperCase();}
export function withRootsSourceColorRgb(color:string,rgbHex:string):string {
 if(!/^#[0-9a-fA-F]{6}$/.test(rgbHex))throw new Error('替换颜色必须是六位 RGB 十六进制值');
 return'#'+(((packedColor(color)&0xff000000)|parseInt(rgbHex.slice(1),16))>>>0).toString(16).padStart(8,'0').toUpperCase();
}
function sourceLut(colors:readonly number[]):Uint8Array {
 const out=new Uint8Array(1024);
 for(let i=0;i<256;i++){
  let left=0xffffffff,right=left,a=0;
  if(colors.length===1)left=right=colors[0];
  else if(colors.length>1){const q=F(F(F(i)+F(.5))/F(256)),p=F(q*F(colors.length-1)),j=Math.min(colors.length-2,Math.max(0,Math.floor(p)));a=F(p-F(j));left=colors[j];right=colors[j+1];}
  for(let k=0;k<3;k++){const shift=16-8*k,l=(left>>>shift)&255,r=(right>>>shift)&255;out[i*4+k]=Math.floor(F(F(l*F(1-a))+F(r*a))+.5);}
  out[i*4+3]=255;
 }return out;
}
export function prepareRootsDensityColor(scene:Pick<SceneDocument,'settings'|'rootsSourcePalette'>):PreparedRootsDensityColor {
 const s=scene.settings,version=parseRootsDensityColorVersion(s.rootDensityColorVersion);if(version==='local-rgb-v1')return{kind:'rgb-sum',version};
 const metric=parseRootsMetricKind(s.rootColor);
 const diagnostics:string[]=[],colors=scene.rootsSourcePalette===undefined?DEFAULT_ROOTS_SOURCE_COLORS:parseRootsSourcePalette(scene.rootsSourcePalette).colors;
 let recovered=0;
 const lut=sourceLut(colors.map((v,i)=>{const messages:string[]=[],color=packedColor(v,messages,`色板第 ${i+1} 项`);if(messages.length){recovered++;if(recovered<=8)diagnostics.push(...messages);}return color;}));
 if(recovered>8)diagnostics.push(`复根源色板共 ${recovered} 项无法解析，均按原版采用白色；完整原字符串已保留。`);
 const values=Object.fromEntries(ROOTS_SOURCE_TONE_FIELDS.map(f=>[f.field,normalizeRootsSourceToneField(f.key,(s[f.key]===undefined?f.default:s[f.key]) as number)])) as Pick<RootsMetricColorPlan,'brightness'|'contrast'|'gamma'|'dynamicRange'|'saturation'|'paletteOffset'>;
 const backgroundInput=rootsSourceBackground(s.background);diagnostics.push(...backgroundInput.diagnostics);
 const background=packedColor(backgroundInput.value,diagnostics,'背景');
 const backgroundRGB=Object.freeze([F(((background>>>16)&255)/255),F(((background>>>8)&255)/255),F((background&255)/255)] as const);
 return Object.freeze({kind:'metric-sum',version,metric,lut,...values,backgroundRGB,backgroundPacked:background>>>0,diagnostics:Object.freeze(diagnostics)});
}
type Point=readonly[number,number];
/** Derivation only. The point admission owner must validate XYZ before asking
 * prepareRootsMetricValue to diagnose a NaN metric for a submitted point. */
export function rootsMetricValue(kind:RootsMetricKind,root:Point|null|undefined,sample:Readonly<Record<string,Point|null|undefined>>):number {
 if(kind==='radius')return root==null?0:Math.hypot(root[0],root[1]);
 if(kind!=='t2_real'&&kind!=='t2_imag')throw new Error('复根源颜色度量无效');
 const t2=Object.hasOwn(sample,'t2')?sample.t2:undefined;return t2==null?0:t2[kind==='t2_real'?0:1];
}
export function prepareRootsMetricValue(raw:number):{raw:number;float32:number;clamped:number} {
 if(typeof raw!=='number')throw new Error('复根颜色度量必须是数值');const float32=F(raw);
 if(Number.isNaN(float32))throw new Error('复根源颜色度量为 NaN，无法生成有效密度颜色');
 // PApplet's two comparisons preserve -0 as well as clamping infinities.
 return{raw,float32,clamped:float32<0?0:float32>1?1:float32};
}
export function prepareRootsMetric(kind:RootsMetricKind,root:Point|null|undefined,sample:Readonly<Record<string,Point|null|undefined>>):{raw:number;float32:number;clamped:number} {
 return prepareRootsMetricValue(rootsMetricValue(kind,root,sample));
}
function dimensions(width:number,height:number){if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)||width*height>MAX_RASTER_PIXELS)throw new Error('复根源密度尺寸无效或超过图像预算');}
export function rootsDensityScale({submittedFinitePointCount:n,width,height}:{submittedFinitePointCount:number;width:number;height:number}):number {
 dimensions(width,height);if(!Number.isSafeInteger(n)||n<0)throw new Error('复根有限提交点数必须为非负安全整数');
 return n===0?1:F(Math.max(1,n/width/height*.25));
}
/** CPU reference of normalized GL_LINEAR + CLAMP_TO_EDGE. The native shader
 * uses fract before sampling, so the last and first texels never blend. */
export function sampleRootsMetricPalette(lut:Uint8Array,phase:number):[number,number,number] {
 if(!(lut instanceof Uint8Array)||lut.length!==1024||!Number.isFinite(phase)||phase<0||phase>1)throw new Error('复根源 LUT 采样输入无效');
 const x=phase*256-.5,j=Math.floor(x),a=x-j,left=Math.max(0,Math.min(255,j))*4,right=Math.max(0,Math.min(255,j+1))*4;
 return[0,1,2].map(k=>(lut[left+k]*(1-a)+lut[right+k]*a)/255) as [number,number,number];
}
/** Shared presentation boundary. This validates already prepared facts; it
 * never reinterprets source settings or silently repairs a forged plan. */
export function validateRootsMetricColorPlan(plan:RootsMetricColorPlan):void {
 if(!plan||plan.kind!=='metric-sum'||plan.version!==ROOTS_DENSITY_COLOR_VERSION||!(plan.lut instanceof Uint8Array)||plan.lut.length!==1024)throw new Error('复根标量调色合同无效');
 if(parseRootsMetricKind(plan.metric)!==plan.metric)throw new Error('复根标量调色事实缺少颜色度量');
 if(!Number.isInteger(plan.backgroundPacked)||plan.backgroundPacked<0||plan.backgroundPacked>0xffffffff)throw new Error('复根源背景 packed ARGB 事实无效');
 if(!Array.isArray(plan.backgroundRGB)||plan.backgroundRGB.length!==3||![plan.brightness,plan.contrast,plan.gamma,plan.dynamicRange,plan.saturation,plan.paletteOffset,...plan.backgroundRGB].every(Number.isFinite)||plan.gamma<=0||plan.dynamicRange<=0)throw new Error('复根标量调色事实无效');
}
/** Float64 CPU accumulation/presentation reference of the source formula.
 * GPU consumes the same tagged layout but retains its actual float32 ink;
 * neither JS transcendental arithmetic nor texture filtering is native-bit proof. */
export function toneRootsMetricRgbaPrepared(width:number,height:number,ink:Float32Array|Float64Array,plan:RootsMetricColorPlan,facts:{submittedFinitePointCount:number},isCancelled?:()=>boolean,destination?:Uint8ClampedArray):Uint8ClampedArray {
 const scale=rootsDensityScale({...facts,width,height});dimensions(width,height);
 if(!(ink instanceof Float32Array||ink instanceof Float64Array)||ink.length!==width*height*4)throw new Error('复根标量密度缓冲长度或类型无效');
 validateRootsMetricColorPlan(plan);
 if(destination&&(!(destination instanceof Uint8ClampedArray)||destination.length!==width*height*4))throw new Error('复根标量调色目标缓冲无效');
 cancel(isCancelled);const pixels=destination??new Uint8ClampedArray(width*height*4),bg=plan.backgroundRGB,k=Math.max(plan.dynamicRange,.01);
 for(let i=0;i<ink.length;i+=4){
  if((i&65535)===0)cancel(isCancelled);const mass=ink[i],sum=ink[i+1];
  if(!Number.isFinite(mass)||mass<0||!Number.isFinite(sum)||sum<0||sum>mass||ink[i+2]!==0||ink[i+3]!==0)throw new Error('复根标量密度包含无效权重或缓冲布局');
  let rgb:readonly number[]=bg;
  if(mass>1e-12){
   const mean=sum/mass,offset=mean+plan.paletteOffset,phase=offset-Math.floor(offset);
   if(!Number.isFinite(phase))throw new Error('复根平均颜色度量无效');
   const color=sampleRootsMetricPalette(plan.lut,phase),density=mass/Math.max(scale,1e-8),v=density===0?-20:Math.log(density)/Math.log(1000),x=2*(plan.contrast*v+plan.brightness)-1,a=Math.pow(Math.abs(x),1/k),level=clamp(Math.sign(x)*Math.pow(a/(a+1),k)*.5+.5);
   const corrected=color.map((c,j)=>Math.pow(clamp(bg[j]*(1-level)+c*level),1/Math.max(plan.gamma,.001))),luma=.299*corrected[0]+.587*corrected[1]+.114*corrected[2];
   rgb=corrected.map(c=>luma+(c-luma)*plan.saturation);
   if(!rgb.every(Number.isFinite))throw new Error('复根源密度调色结果非有限');
  }
  for(let c=0;c<3;c++)pixels[i+c]=Math.round(clamp(rgb[c])*255);pixels[i+3]=255;
 }
 return pixels;
}
