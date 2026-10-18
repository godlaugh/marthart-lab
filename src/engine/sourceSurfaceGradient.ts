import {sourceColorLerp,type DomainSourceInterpolation} from './domainSourcePalette';

export type SourceSurfaceGradientMode='hue_rotate'|'offset_cycle'|'cross_fade'|'palette_morph';
export interface SourceSurfacePaletteState {readonly primary:number;readonly secondary:number;readonly blend:number;}
export interface SourceSurfaceGradientFrame {readonly palette:number;readonly inside:number;readonly outside:number;}
export const INITIAL_SOURCE_SURFACE_PALETTE_STATE:SourceSurfacePaletteState=Object.freeze({primary:0,secondary:0,blend:0});
const F=Math.fround,TAU=F(Math.PI*2);
const add=(a:number,b:number)=>F(a+b),sub=(a:number,b:number)=>F(a-b),mul=(a:number,b:number)=>F(a*b);
const constrain=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;
const integer=(v:number)=>Number.isNaN(v)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(v)));
// Processing floor returns int, including JVM saturation for huge float input.
const floor=(v:number)=>F(integer(Math.floor(v)));
const phase=(v:number)=>sub(v,floor(v));
const wrap=(v:number)=>{const u=phase(v);return u<0?add(u,1):u;};
const distance=(a:number,b:number)=>{const d=F(Math.abs(sub(wrap(a),wrap(b))));return Math.min(d,sub(1,d));};
const normalizedDistance=(a:number,b:number)=>{const d=F(Math.abs(sub(phase(a),phase(b))));return Math.min(d,sub(1,d));};
const lerp=(a:number,b:number,t:number)=>add(a,mul(sub(b,a),t));
const circularLerp=(a:number,b:number,t:number)=>{
 const start=wrap(a);let delta=sub(wrap(b),start);
 if(delta>F(.5))delta=sub(delta,1);else if(delta<F(-.5))delta=add(delta,1);
 return wrap(add(start,mul(delta,constrain(t,0,1))));
};
const softBlend=(gap:number,maximum:number)=>{
 const u=F(constrain(gap,0,F(.5))/F(.5));
 return constrain(mul(mul(mul(u,u),sub(3,mul(2,u))),maximum),0,maximum);
};
const sin=(v:number)=>F(Math.sin(v));
const wave=(v:number)=>add(F(.5),mul(F(.5),sin(mul(TAU,v))));

/** ParametricSurface.mapGradientFrameToPaletteState. The shared gradient
 * runtime emits doubles; this target converts each component to Float32,
 * computes two sampling offsets and a blend, then smooths only particle heads.
 * Historical trail sampling consumes this mapping directly, without smoothing. */
export function sourceSurfacePaletteTarget(frame:SourceSurfaceGradientFrame,mode:SourceSurfaceGradientMode):SourceSurfacePaletteState {
 const p=F(frame.palette),i=F(frame.inside),o=F(frame.outside),gap=normalizedDistance(i,o),phase=wave(wrap(mul(F(.5),add(i,o))));
 switch(mode){
  case'hue_rotate':return{primary:p,secondary:wrap(add(add(p,F(.06)),mul(F(.06),phase))),blend:constrain(add(F(.06),mul(F(.08),phase)),0,F(.22))};
  case'offset_cycle':return{primary:i,secondary:o,blend:constrain(add(F(.08),softBlend(gap,F(.28))),0,F(.4))};
  case'cross_fade':return{primary:i,secondary:o,blend:constrain(add(add(F(.16),softBlend(gap,F(.45))),mul(F(.08),phase)),0,F(.72))};
  case'palette_morph':return{primary:p,secondary:o,blend:constrain(add(add(F(.12),softBlend(gap,F(.34))),mul(F(.05),phase)),0,F(.56))};
 }
}

/** applyGradientState preserves the whole old state unless at least one
 * smoothed delta is STRICTLY above 1e-4. Nonfinite target components retain
 * that component's previous value. Calls (including repeated calls within one
 * frame) matter; replacing this with a time-only interpolation is incorrect. */
export function smoothSourceSurfacePalette(previous:SourceSurfacePaletteState,target:SourceSurfacePaletteState):{state:SourceSurfacePaletteState;changed:boolean} {
 const p=F(target.primary),s=F(target.secondary),b=F(target.blend);
 const next={primary:circularLerp(previous.primary,Number.isFinite(p)?wrap(p):previous.primary,F(.2)),secondary:circularLerp(previous.secondary,Number.isFinite(s)?wrap(s):previous.secondary,F(.2)),blend:lerp(previous.blend,Number.isFinite(b)?constrain(b,0,1):previous.blend,F(.18))};
 const changed=distance(next.primary,previous.primary)>F(.0001)||distance(next.secondary,previous.secondary)>F(.0001)||Math.abs(sub(next.blend,previous.blend))>F(.0001);
 return{state:changed?next:{...previous},changed};
}

/** A bounded palette has already been parsed by prepareSourceSurfacePalette.
 * Noncyclic source sampling always uses RGB byte interpolation, regardless of
 * the requested runtime interpolation. Active gradients request cyclic=true. */
export function sampleSourceSurfaceGradient(palette:readonly number[],coordinate:number,state:SourceSurfacePaletteState,mode:SourceSurfaceGradientMode,interpolation:DomainSourceInterpolation,cyclic:boolean):number {
 if(palette.length===0)throw new Error('原版曲面采样色板不能为空');
 const shifted=(u:number,offset:number)=>{
  if(palette.length===1)return palette[0];
  // Source sampleShiftedPalette does not add wrapUnit's negative correction.
  const shift=sub(offset,floor(offset)),phase=add(u,shift),wrapped=sub(phase,floor(phase));
  const position=mul(wrapped,F(cyclic?palette.length:palette.length-1)),index=Math.min(integer(position),cyclic?palette.length-1:palette.length-2),fraction=sub(position,F(index));
  if(index<0||index>=palette.length||!Number.isFinite(fraction))throw new Error('原版曲面颜色采样超出可解析范围');
  return sourceColorLerp(palette[index],palette[cyclic?(index+1)%palette.length:index+1],fraction,cyclic?interpolation:'rgb');
 };
 const u=F(coordinate),p=F(state.primary),s=F(state.secondary),b=constrain(F(state.blend),0,1);
 switch(mode){
  case'hue_rotate':{
   const first=shifted(u,p);return b<=0?first:sourceColorLerp(first,shifted(u,s),b,interpolation);
  }
  case'offset_cycle':{
   const w=wave(add(mul(u,2),p)),warp=mul(sub(w,F(.5)),F(.14));
   const mix=constrain(add(add(F(.12),mul(b,F(.45))),mul(F(.25),w)),0,F(.72));
   return sourceColorLerp(shifted(add(u,warp),add(p,mul(warp,F(.5)))),shifted(sub(u,warp),sub(s,mul(warp,F(.5)))),mix,interpolation);
  }
  case'cross_fade':{
   const w=wave(sub(mul(u,F(1.25)),p)),warp=mul(sub(w,F(.5)),F(.1));
   const mix=constrain(add(F(.1),mul(mul(F(.75),b),w)),0,F(.85));
   return sourceColorLerp(shifted(add(u,warp),p),shifted(sub(u,warp),s),mix,interpolation);
  }
  case'palette_morph':{
   const w=sin(mul(TAU,add(mul(u,F(2.5)),s))),warped=add(u,mul(F(.12),w)),second=add(mul(F(.35),warped),mul(F(.65),u));
   const mix=constrain(add(F(.15),mul(F(.6),b)),0,F(.7));
   return sourceColorLerp(shifted(warped,p),shifted(second,add(s,mul(F(.06),sin(mul(TAU,add(u,p)))))),mix,interpolation);
  }
 }
}

/** quantizeTrailAgeKey: 120 samples/second, nearest integer with ties toward
 * positive infinity. The invalid-record sentinel is distinct from age zero. */
export function sourceSurfaceTrailAgeKey(time:number,recordTime:number):number {
 const record=F(recordTime);if(!Number.isFinite(record))return-2147483648;
 const age=sub(F(time),record);if(!Number.isFinite(age)||age<=0)return 0;
 return Math.max(0,integer(Math.floor(mul(age,F(120))+.5)));
}
