import {sourceEase} from './sourceEasing';

export interface SourceFractalZoomState {centerX:number;centerY:number;centerXLow:number;centerYLow:number;zoom:number;}
export interface SourceFractalZoomTarget extends SourceFractalZoomState {model:'mathart-1.7.8-target';maxZoom:number;}
export type SourceFractalZoomResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'unsupported';reason:string}};
const fields=['centerX','centerY','centerXLow','centerYLow','zoom'] as const;
const fail=(reason:string,kind:'input'|'unsupported'='input')=>({ok:false as const,error:{kind,reason}});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const clamp01=(v:number)=>v<0?0:v>1?1:v;
type Pair=readonly [number,number];

// The animation's private DD has a different operation order from the renderer
// DD owner. Preserve its two-sum and DD-by-double multiplication, including the
// final ComplexFractalMobject.setCenterParts normalization.
function add(a:Pair,b:Pair):Pair {
 const s=a[0]+b[0],v=s-a[0],e=(b[0]-v)+(a[0]-(s-v))+a[1]+b[1];
 const hi=s+e;return[hi,e-(hi-s)];
}
function sub(a:Pair,b:Pair):Pair {
 const s=a[0]-b[0],v=s-a[0],e=(-b[0]-v)+(a[0]-(s-v))+a[1]-b[1];
 const hi=s+e;return[hi,e-(hi-s)];
}
/** Native setCenterParts / DD.ofParts normalization; caller owns finite input validation. */
export const normalizeSourceFractalCenter=(hi:number,lo:number):Pair=>add([hi,0],[lo,0]);
function multiply(a:Pair,b:number):Pair {
 const p=a[0]*b,ca=a[0]*134217729,cb=b*134217729;
 const ah=ca-(ca-a[0]),bh=cb-(cb-b),al=a[0]-ah,bl=b-bh;
 let error=ah*bh-p;error=error+(ah*bl+al*bh);error=error+al*bl;
 const q=a[1]*b,s=p+q,v=s-p,e=(q-v)+(p-(s-v))+error;
 const hi=s+e;return[hi,e-(hi-s)];
}
function lerp(a:Pair,b:Pair,t:number):Pair {const out=add(a,multiply(sub(b,a),t));return normalizeSourceFractalCenter(out[0],out[1]);}
function centerProgress(start:number,target:number,t:number):number {
 const ratio=Math.max(1e-9,target)/Math.max(1e-9,start);
 if(Math.abs(ratio-1)<1e-9)return t;
 const logarithm=Math.log(ratio);if(Math.abs(logarithm)<1e-9)return t;
 const numerator=1-Math.exp(-logarithm*t),denominator=1-Math.exp(-logarithm);
 if(Math.abs(denominator)<1e-12)return t;
 return Math.max(0,Math.min(1,numerator/denominator));
}
/** Canonical numeric document boundary. Original JSON scalar expressions and
 * fallback/precedence rules belong to the importer, not this numeric owner. */
export function parseSourceFractalZoomTarget(raw:unknown):SourceFractalZoomResult<SourceFractalZoomTarget>{
 if(!record(raw)||raw.model!=='mathart-1.7.8-target')return fail('分形缩放目标模型无效');
 if(Object.keys(raw).some(key=>!['model','maxZoom',...fields].includes(key)))return fail('分形缩放目标含未知字段');
 if(fields.some(key=>!finite(raw[key]))||!finite(raw.maxZoom))return fail('分形缩放目标需要有限数值');
 if((raw.zoom as number)<1e-9||(raw.maxZoom as number)<1)return fail('分形缩放目标下限为 1e-9，最大缩放下限为 1');
 return{ok:true,value:{model:'mathart-1.7.8-target',centerX:raw.centerX as number,centerY:raw.centerY as number,centerXLow:raw.centerXLow as number,centerYLow:raw.centerYLow as number,zoom:raw.zoom as number,maxZoom:raw.maxZoom as number}};
}
/** FractalZoomTargetAnimation.onUpdate(F), independent of queue time ownership.
 * start is the camera captured at animation start, not a synthesized first key.
 * Java Math and JS Math transcendental results may differ in their final bits. */
export function evaluateSourceFractalZoom(start:SourceFractalZoomState,target:SourceFractalZoomTarget,easing:string,rawProgress:number):SourceFractalZoomResult<SourceFractalZoomState>{
 const parsed=parseSourceFractalZoomTarget(target);if(!parsed.ok)return parsed;
 if(!record(start)||fields.some(key=>!finite(start[key]))||!finite(rawProgress))return fail('分形缩放起点和进度需要有限数值');
 if(start.zoom<1e-6||start.zoom>1e28)return fail('当前分形渲染器支持 1e-6 至 1e28 的起始缩放','unsupported');
 let progress:number;
 try{progress=clamp01(sourceEase(easing,clamp01(Math.fround(rawProgress))));}catch(error){return fail(error instanceof Error?error.message:String(error));}
 const z0=Math.max(1e-9,start.zoom),z1=Math.max(1e-9,target.zoom);
 const interpolated=Math.exp(Math.log(z0)+(Math.log(z1)-Math.log(z0))*progress);
 const zoom=Math.max(1e-6,Math.min(target.maxZoom,Math.max(1e-9,interpolated)));
 const t=centerProgress(z0,z1,progress);
 const x=lerp(normalizeSourceFractalCenter(start.centerX,start.centerXLow),normalizeSourceFractalCenter(target.centerX,target.centerXLow),t);
 const y=lerp(normalizeSourceFractalCenter(start.centerY,start.centerYLow),normalizeSourceFractalCenter(target.centerY,target.centerYLow),t);
 if(![zoom,...x,...y].every(Number.isFinite))return fail('分形缩放超出有限数值运算范围','unsupported');
 if(zoom>1e28)return fail('当前分形渲染器最大支持 1e28 缩放','unsupported');
 return{ok:true,value:{zoom,centerX:x[0],centerXLow:x[1],centerY:y[0],centerYLow:y[1]}};
}
