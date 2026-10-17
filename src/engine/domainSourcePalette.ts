import type {RGB,DomainSourcePalette} from '../types';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor} from './sourceConfigColor';
export type {DomainSourcePalette} from '../types';

export type DomainColorVersion='local-v1'|'mathart-1.7.8-gpu'|'mathart-1.7.8-cpu';
export type DomainSourceColorVersion=Exclude<DomainColorVersion,'local-v1'>;
export type DomainSourceInterpolation='rgb'|'linear'|'oklab'|'oklch';
export const DEFAULT_DOMAIN_SOURCE_COLORS=Object.freeze(['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC']);
// Local preparation budget, not a source-format or shader palette limit. The
// source CPU keeps the full array; only the source GPU upload takes a prefix.
export const MAX_DOMAIN_SOURCE_COLORS=65_536;
export const MAX_DOMAIN_SOURCE_COLOR_TEXT=SOURCE_COLOR_TEXT_BUDGET;
const F=Math.fround;
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const byte=(v:number)=>Number.isNaN(v)?0:clamp(Math.floor(v+.5),0,255);
const int=(v:number)=>Number.isNaN(v)?0:clamp(Math.trunc(v),-2147483648,2147483647);
const ch=(v:number,shift:number)=>(v>>>shift)&255;
const packed=(a:number,r:number,g:number,b:number)=>(a<<24|r<<16|g<<8|b)>>>0;
const lerpF=(a:number,b:number,t:number)=>F(a+F(F(b-a)*t));
const lerpD=(a:number,b:number,t:number)=>a+(b-a)*t;

export function parseDomainColorVersion(value:unknown):DomainColorVersion {
 if(value===undefined)return'local-v1';
 if(value==='local-v1'||value==='mathart-1.7.8-gpu'||value==='mathart-1.7.8-cpu')return value;
 throw new Error('域着色颜色版本无效');
}
/** ConfigUtils.parseColor + PApplet.unhex's successful parsing paths. Invalid
 * input is rejected here rather than silently replacing authored data by white. */
export function domainSourcePackedColor(value:unknown):number {
 if(typeof value!=='string'||value.length>MAX_DOMAIN_SOURCE_COLOR_TEXT)throw new Error('原版域色板颜色必须是有效字符串');
 try{return sourceConfigPackedColor(value);}catch(error){if(error instanceof SourceConfigColorError)throw new Error(error.kind==='format'?'原版域色板颜色格式无效':'原版域色板颜色数值越界');throw error;}
}
export function parseDomainSourcePalette(input:unknown):DomainSourcePalette {
 if(!input||typeof input!=='object'||Array.isArray(input)||!('colors'in input)||!Array.isArray(input.colors))throw new Error('原版域色板必须包含 colors 数组');
 if(input.colors.length>MAX_DOMAIN_SOURCE_COLORS)throw new Error('原版域色板超过本地 65536 色准备预算');
 let text=0;
 const colors=Array.from(input.colors,value=>{
  domainSourcePackedColor(value);text+=(value as string).length;
  if(text>MAX_DOMAIN_SOURCE_COLOR_TEXT)throw new Error('原版域色板超过本地颜色文本预算');
  return value as string;
 });
 return{colors};
}
export function domainSourceColorRgbHex(color:string):string{return'#'+(domainSourcePackedColor(color)&0xffffff).toString(16).padStart(6,'0').toUpperCase();}
export function withDomainSourceColorRgb(color:string,rgbHex:string):string {
 if(!/^#[0-9a-fA-F]{6}$/.test(rgbHex))throw new Error('替换颜色必须是六位 RGB 十六进制值');
 return'#'+(((domainSourcePackedColor(color)&0xff000000)|parseInt(rgbHex.slice(1),16))>>>0).toString(16).padStart(8,'0').toUpperCase();
}
function linearD(v:number){return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
function srgbD(v:number){v=v<=0?0:v;return v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055;}
function linearF(v:number){return v<=F(.04045)?F(v/F(12.92)):F(Math.pow(F(F(v+F(.055))/F(1.055)),2.4));}
function srgbF(v:number){v=v<=0?0:v;return v<=F(.0031308)?F(F(12.92)*v):F(F(F(1.055)*F(Math.pow(v,1/2.4)))-F(.055));}
export function domainSourceColorOklab(color:number):RGB {
 const r=linearD(ch(color,16)/255),g=linearD(ch(color,8)/255),b=linearD(ch(color,0)/255);
 const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
 const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
 const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
 return[.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function fromOklab([l,a,b]:RGB):RGB {
 const x=l+.3963377774*a+.2158037573*b,y=l-.1055613458*a-.0638541728*b,z=l-.0894841775*a-1.291485548*b;
 const xx=x*x*x,yy=y*y*y,zz=z*z*z;
 return[byte(srgbD(4.0767416621*xx-3.3077115913*yy+.2309699292*zz)*255),byte(srgbD(-1.2684380046*xx+2.6097574011*yy-.3413193965*zz)*255),byte(srgbD(-.0041960863*xx-.7034186147*yy+1.707614701*zz)*255)];
}
export interface PreparedDomainSourceSegment {
 readonly interpolation:DomainSourceInterpolation;
 readonly alpha:readonly[number,number];
 /** RGB bytes, float32 linear RGB, double OKLab, or [L,C,h] respectively. */
 readonly a:readonly[number,number,number];readonly b:readonly[number,number,number];
 /** Source asymmetric achromatic handling, only present for OKLCH. */
 readonly hueDelta?:number;
}
export function prepareDomainSourceSegment(a:number,b:number,interpolation:DomainSourceInterpolation):PreparedDomainSourceSegment {
 const alpha=Object.freeze([ch(a,24),ch(b,24)] as const);
 let left:RGB,right:RGB,hueDelta:number|undefined;
 if(interpolation==='rgb'){left=[ch(a,16),ch(a,8),ch(a,0)];right=[ch(b,16),ch(b,8),ch(b,0)];}
 else if(interpolation==='linear'){left=[16,8,0].map(s=>linearF(F(ch(a,s)/255))) as RGB;right=[16,8,0].map(s=>linearF(F(ch(b,s)/255))) as RGB;}
 else{
  left=domainSourceColorOklab(a);right=domainSourceColorOklab(b);
  if(interpolation==='oklch'){
   const ca=Math.hypot(left[1],left[2]),cb=Math.hypot(right[1],right[2]);
   const ha=ca<1e-12?0:Math.atan2(left[2],left[1]),hb=cb<1e-12?ha:Math.atan2(right[2],right[1]);
   hueDelta=(hb-ha)%(Math.PI*2);if(hueDelta>Math.PI)hueDelta-=Math.PI*2;else if(hueDelta< -Math.PI)hueDelta+=Math.PI*2;
   left=[left[0],ca,ha];right=[right[0],cb,hb];
  }
 }
 return Object.freeze({interpolation,alpha,a:Object.freeze(left),b:Object.freeze(right),...(hueDelta===undefined?{}:{hueDelta})});
}
export function sampleDomainSourceSegment(segment:PreparedDomainSourceSegment,coordinate:number):number {
 let t=F(coordinate);const{a,b,interpolation}=segment;
 if(interpolation==='rgb'){
  t=clamp(t,0,1);
  return packed(int(lerpF(segment.alpha[0],segment.alpha[1],t)),...a.map((v,i)=>int(lerpF(v,b[i],t))) as RGB);
 }
 const alpha=byte(lerpF(segment.alpha[0],segment.alpha[1],t));let rgb:RGB;
 if(interpolation==='linear')rgb=a.map((v,i)=>byte(F(srgbF(lerpF(v,b[i],t))*255))) as RGB;
 else if(interpolation==='oklab')rgb=fromOklab(a.map((v,i)=>lerpD(v,b[i],t)) as RGB);
 else{const l=lerpD(a[0],b[0],t),c=lerpD(a[1],b[1],t),h=a[2]+segment.hueDelta!*t;rgb=fromOklab([l,c*Math.cos(h),c*Math.sin(h)]);}
 return packed(alpha,...rgb);
}
export function sourceColorLerp(a:number,b:number,t:number,space:DomainSourceInterpolation):number{return sampleDomainSourceSegment(prepareDomainSourceSegment(a,b,space),t);}
export function domainSourceOklabDistance(a:number,b:number):number {
 const aa=domainSourceColorOklab(a),bb=domainSourceColorOklab(b),x=bb[0]-aa[0],y=bb[1]-aa[1],z=bb[2]-aa[2];
 return Math.sqrt(x*x+y*y+z*z);
}
export interface DomainSourcePaletteFacts {
 readonly sourcePacked:readonly number[];readonly packed:readonly number[];readonly entries:readonly Readonly<RGB>[];
 readonly running:boolean;readonly interpolation:DomainSourceInterpolation;
 readonly sampling:'gpu-n-minus-one'|'cpu-n-minus-one'|'cpu-n-cycle';
 readonly outputQuantization:'float-rgb'|'packed-byte';
 readonly segments:readonly PreparedDomainSourceSegment[];
}
export interface DomainSourcePaletteInput {version:DomainSourceColorVersion;colors?:readonly string[];runtime?:{running:boolean;interpolation:DomainSourceInterpolation}}
export function prepareDomainSourcePalette(input:DomainSourcePaletteInput):DomainSourcePaletteFacts {
 if(parseDomainColorVersion(input.version)==='local-v1')throw new Error('原版域色板需要显式原版颜色版本');
 const colors=parseDomainSourcePalette({colors:input.colors??DEFAULT_DOMAIN_SOURCE_COLORS}).colors;
 if(input.runtime&&(typeof input.runtime.running!=='boolean'||!['rgb','linear','oklab','oklch'].includes(input.runtime.interpolation)))throw new Error('原版域渐变运行状态无效');
 const sourcePacked=colors.map(domainSourcePackedColor),running=input.runtime?.running??false,interpolation=input.runtime?.interpolation??'rgb';
 let output=sourcePacked.slice();
 const gpu=input.version==='mathart-1.7.8-gpu';
 if(gpu&&running&&output.length>1){
  if(output[0]!==output[output.length-1]){if(output.length<16)output.push(output[0]);else output[output.length-1]=output[0];}
  while(output.length<16){
   let distance=.22,index=-1;
   for(let i=0;i<output.length-1;i++){const d=domainSourceOklabDistance(output[i],output[i+1]);if(d>distance){distance=d;index=i;}}
   if(index<0)break;output.splice(index+1,0,sourceColorLerp(output[index],output[index+1],.5,interpolation));
  }
 }
 if(gpu)output=output.slice(0,16);
 const segments=!gpu&&running&&output.length>1?output.map((color,i)=>prepareDomainSourceSegment(color,output[(i+1)%output.length],interpolation)):[];
 return Object.freeze({sourcePacked:Object.freeze(sourcePacked),packed:Object.freeze(output),entries:Object.freeze(output.map(v=>Object.freeze([F(ch(v,16)/255),F(ch(v,8)/255),F(ch(v,0)/255)] as RGB))),running,interpolation,sampling:gpu?'gpu-n-minus-one':running?'cpu-n-cycle':'cpu-n-minus-one',outputQuantization:!gpu&&running?'packed-byte':'float-rgb',segments:Object.freeze(segments)});
}
export function sampleDomainSourcePalette(palette:DomainSourcePaletteFacts,coordinate:number):RGB {
 const n=palette.entries.length;if(n===0)return[0,0,0];if(n===1)return[...palette.entries[0]];
 const t=F(coordinate),wrapped=F(t-Math.floor(t)),p=F(wrapped*(palette.sampling==='cpu-n-cycle'?n:n-1));
 // Java's floating-to-int conversion maps NaN to zero. Preserve this before
 // packed interpolation so the source CPU's non-finite path remains defined.
 const index=Math.min(n-1,int(Math.floor(p))),f=F(p-index),next=palette.sampling==='cpu-n-cycle'?(index+1)%n:Math.min(index+1,n-1);
 if(palette.sampling==='cpu-n-cycle'){
  const v=sampleDomainSourceSegment(palette.segments[index],f);return[F(ch(v,16)/255),F(ch(v,8)/255),F(ch(v,0)/255)];
 }
 const a=palette.entries[index],b=palette.entries[next];
 // CPU is a+(b-a)*f; GLSL mix is a*(1-f)+b*f. Keep the distinct source order.
 return a.map((v,i)=>palette.sampling==='gpu-n-minus-one'?F(F(v*F(1-f))+F(b[i]*f)):lerpF(v,b[i],f)) as RGB;
}
