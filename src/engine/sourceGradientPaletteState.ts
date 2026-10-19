import type {SourceGradientFrame} from './sourceGradientRuntime';
import type {SourceSurfaceGradientMode} from './sourceSurfaceGradient';

/** Shared binary32 target mapping observed in StrangeAttractor and
 * PerlinNoiseField.applyGradientFrame. Sampling and refresh ownership differ. */
const F=Math.fround;
export type SourceGradientPaletteState={primary:number;secondary:number;blend:number};
const constrain=(v:number,lo:number,hi:number)=>v<lo?lo:v>hi?hi:v;
const integer=(v:number)=>Number.isNaN(v)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(v)));
const phase=(v:number)=>F(v-F(integer(Math.floor(v))));
function softGap(a:number,b:number,maximum:number){
 const delta=F(Math.abs(F(phase(a)-phase(b)))),gap=Math.min(delta,F(1-delta));
 const u=F(constrain(gap,0,F(.5))/F(.5));
 return constrain(F(F(F(u*u)*F(3-F(2*u)))*maximum),0,maximum);
}
export function sourceGradientPaletteState(frame:SourceGradientFrame,mode:SourceSurfaceGradientMode):SourceGradientPaletteState {
 const p=F(frame.palette),i=F(frame.inside),o=F(frame.outside),average=F(F(.5)*F(i+o));
 if(mode==='hue_rotate')return{primary:p,secondary:p,blend:0};
 if(mode==='offset_cycle')return{primary:average,secondary:average,blend:0};
 return{primary:mode==='cross_fade'?average:p,secondary:o,blend:softGap(i,o,F(mode==='cross_fade'?.38:.30))};
}
