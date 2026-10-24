import {sourceManualMainToneRgb} from './sourceConfigColor';

export const SOURCE_MANUAL_PALETTE_STRATEGIES=['monochromatic','analogous','complementary','split-complementary'] as const;
export type SourceManualPaletteStrategy=typeof SOURCE_MANUAL_PALETTE_STRATEGIES[number];
export interface SourceManualPaletteRequest {count:number;strategy:SourceManualPaletteStrategy;mainToneCount:number;mainTones?:readonly string[];}
type Triple=readonly[number,number,number];
type Vec3=[number,number,number];
export type SourceManualPaletteResult={ok:true;value:string[]}|{ok:false;error:{kind:'input'|'random';reason:string}};
class Failure extends Error {constructor(readonly kind:'input'|'random',reason:string){super(reason);}}
const F=Math.fround,add=(a:number,b:number)=>F(F(a)+F(b)),sub=(a:number,b:number)=>F(F(a)-F(b)),mul=(a:number,b:number)=>F(F(a)*F(b)),div=(a:number,b:number)=>F(F(a)/F(b));
const clamp=(x:number,lo=0,hi=1)=>Math.max(F(lo),Math.min(F(hi),x));
const hex=(rgb:Triple)=>'#'+rgb.map(c=>c.toString(16).padStart(2,'0')).join('').toUpperCase();
const byte=(v:number)=>Math.trunc(add(mul(v,255),.5));
const wrap=(h:number)=>F(add(F(h%360),360)%360);

/** java.awt.Color's Float32 HSB operations and byte rounding. Hue is turns. */
export function sourceManualHsbToRgb([hue,saturation,brightness]:Triple):Vec3 {
 const h0=F(hue),s=F(saturation),v=F(brightness);
 if(s===0){const n=byte(v);return[n,n,n];}
 const h=mul(sub(h0,F(Math.floor(h0))),6),f=sub(h,F(Math.floor(h)));
 const p=mul(v,sub(1,s)),q=mul(v,sub(1,mul(s,f))),t=mul(v,sub(1,mul(s,sub(1,f))));
 const channels:Vec3[]=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]];
 // A tiny negative hue can round the sector to 6; AWT's switch leaves its
 // initially zero channels untouched rather than wrapping or throwing.
 return channels[Math.trunc(h)]?.map(byte) as Vec3??[0,0,0];
}
export function sourceManualRgbToHsb([r,g,b]:Triple):Vec3 {
 const max=Math.max(r,g,b),min=Math.min(r,g,b),v=div(max,255),s=max===0?0:div(max-min,max);
 if(s===0)return[0,s,v];
 const rc=div(max-r,max-min),gc=div(max-g,max-min),bc=div(max-b,max-min);
 let h=div(r===max?sub(bc,gc):g===max?sub(add(2,rc),bc):sub(add(4,gc),rc),6);
 if(h<0)h=add(h,1);return[h,s,v];
}
export function sourceManualSrgbToLinear(value:number):number {
 const x=F(value);return x<=F(.04045)?div(x,12.92):F(Math.pow(div(add(x,.055),1.055),F(2.4)));
}
export function sourceManualLinearToSrgb(value:number):number {
 const x=F(value);return x<=F(.0031308)?mul(x,12.92):sub(mul(1.055,F(Math.pow(x,F(.41666666)))),.055);
}
export function sourceManualSrgbToOklab(rgb:Triple):Vec3 {
 const [r,g,b]=rgb.map(sourceManualSrgbToLinear);
 const l=F(Math.cbrt(add(add(mul(.41222146,r),mul(.53633255,g)),mul(.051445995,b))));
 const m=F(Math.cbrt(add(add(mul(.2119035,r),mul(.6806995,g)),mul(.10739696,b))));
 const s=F(Math.cbrt(add(add(mul(.08830246,r),mul(.28171885,g)),mul(.6299787,b))));
 return[sub(add(mul(.21045426,l),mul(.7936178,m)),mul(.004072047,s)),add(sub(mul(1.9779985,l),mul(2.4285922,m)),mul(.4505937,s)),sub(add(mul(.025904037,l),mul(.78277177,m)),mul(.80867577,s))];
}
export function sourceManualOklabToRgb([L,a,b]:Triple):Vec3 {
 const l=add(add(L,mul(.39633778,a)),mul(.21580376,b)),m=sub(sub(L,mul(.105561346,a)),mul(.06385417,b)),s=sub(sub(L,mul(.08948418,a)),mul(1.2914855,b));
 const l3=mul(mul(l,l),l),m3=mul(mul(m,m),m),s3=mul(mul(s,s),s);
 const linear:Vec3=[add(sub(mul(4.0767417,l3),mul(3.3077116,m3)),mul(.23096994,s3)),sub(add(mul(-1.268438,l3),mul(2.6097574,m3)),mul(.34131938,s3)),add(sub(mul(-.0041960864,l3),mul(.7034186,m3)),mul(1.7076147,s3))];
 return linear.map(v=>Math.max(0,Math.min(255,Math.floor(mul(clamp(sourceManualLinearToSrgb(v)),255)+.5)))) as Vec3;
}
export function sourceManualHsbAnchorToOklab([h,s,v]:Triple):Vec3 {
 return sourceManualSrgbToOklab(sourceManualHsbToRgb([div(h,360),s,v]).map(c=>div(c,255)) as Vec3);
}
function integer(n:number):number {if(!Number.isInteger(n)||n< -2147483648||n>2147483647)throw new Failure('input','色板数量必须为 32 位整数');return n;}
function randomSource(random:()=>number):()=>number {return()=>{const x=random();if(!Number.isFinite(x)||x<0||x>=1)throw new Failure('random','随机源必须返回 0（含）到 1（不含）之间的有限数值');return x;};}
function attempt(generate:()=>string[]):SourceManualPaletteResult {try{return{ok:true,value:generate()};}catch(error){if(error instanceof Failure)return{ok:false,error:{kind:error.kind,reason:error.message}};throw error;}}
const triple=(h:number,s:number,v:number):Vec3=>[F(h),F(s),F(v)];

/** Source ManualPaletteGenerationKt. The optional random input supports replay
 * of observed draws; production uses fresh Math.random. No reseeding/global RNG
 * mutation, source palette normalization or implicit document writes. */
export function generateSourceManualPalette(request:SourceManualPaletteRequest,random:()=>number=Math.random):SourceManualPaletteResult {return attempt(()=>{
 const count=Math.max(2,Math.min(25,integer(request.count))),mainCount=Math.max(3,Math.min(6,integer(request.mainToneCount)));
 if(!SOURCE_MANUAL_PALETTE_STRATEGIES.includes(request.strategy))throw new Failure('input','未知随机配色策略');
 const next=randomSource(random),h=F(next()*360);let anchors:Vec3[];
 if(request.strategy==='monochromatic')anchors=[triple(h,.2,.9),triple(h,.8,.3)];
 else if(request.strategy==='analogous'){anchors=[triple(h,.5,.8),triple(F(add(h,30)%360),.6,.6)];if(count>5)anchors.push(triple(F(add(sub(h,20),360)%360),.4,.9));}
 else if(request.strategy==='complementary')anchors=[triple(h,.6,.4),triple(h,.3,.9),triple(F(add(h,180)%360),.7,.8)];
 else{
  const parsed=request.mainTones?.slice(0,mainCount).map(sourceManualMainToneRgb).filter((color):color is number=>color!==null);
  if(parsed?.length===mainCount)anchors=parsed.map(color=>{const [h,s,v]=sourceManualRgbToHsb([(color>>>16)&255,(color>>>8)&255,color&255]);return[mul(h,360),s,v];});
  else{
   anchors=[triple(h,.52,.84)];
   if(mainCount>=5)anchors.push(triple(wrap(add(h,30)),.46,.92));
   if(mainCount>=6)anchors.push(triple(wrap(add(h,60)),.42,.94));
   anchors.push(triple(wrap(add(h,150)),.62,.64));
   if(mainCount>=4)anchors.push(triple(wrap(add(h,180)),.58,.76));
   anchors.push(triple(wrap(add(h,210)),.62,.64));
  }
 }
 const labs=anchors.map(([h,s,v])=>{
  const jh=mul(sub(F(next()),.5),10),js=mul(sub(F(next()),.5),.12),jv=mul(sub(F(next()),.5),.12);
  return sourceManualHsbAnchorToOklab([F(add(add(h,jh),360)%360),clamp(add(s,js),.1,.9),clamp(add(v,jv),.2,.98)]);
 });
 // This gate uses supplied-list nonemptiness, not whether its colors parsed.
 const fixed=request.strategy==='split-complementary'&&!!request.mainTones?.length;
 const sa=fixed?0:F(.02+next()*.04),va=fixed?0:F(.015+next()*.035),sp=fixed?0:F(next()*2*Math.PI),vp=fixed?0:F(next()*2*Math.PI);
 return Array.from({length:count},(_,i)=>{
  const t=div(i,count-1),at=mul(t,Math.max(1,labs.length-1)),lo=Math.min(Math.trunc(at),labs.length-1),hi=Math.min(lo+1,labs.length-1),u=sub(at,lo);
  const lab=labs[lo].map((a,k)=>add(a,mul(sub(labs[hi][k],a),u))) as Vec3;
  const [h,s,v]=sourceManualRgbToHsb(sourceManualOklabToRgb(lab));
  return hex(sourceManualHsbToRgb([h,clamp(add(s,mul(F(Math.cos(2*Math.PI*t+sp)),sa)),.08,.92),clamp(add(v,mul(F(Math.cos(2*Math.PI*t+vp)),va)),.2,.99)]));
 });
});}

export function generateSourceManualMainTones(count:number,random:()=>number=Math.random):SourceManualPaletteResult {return attempt(()=>{
 const n=Math.max(3,Math.min(6,integer(count))),next=randomSource(random),h=F(next()*360),hues=[h];
 if(n>=5)hues.push(F(add(h,30)%360));if(n>=6)hues.push(F(add(h,60)%360));hues.push(F(add(h,150)%360));if(n>=4)hues.push(F(add(h,180)%360));hues.push(F(add(h,210)%360));
 return hues.map(h=>hex(sourceManualHsbToRgb([div(h,360),clamp(add(.45,mul(F(next()),.25))),clamp(add(.65,mul(F(next()),.25)))])));
});}
