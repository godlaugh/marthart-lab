import {sourceEase} from './sourceEasing';

export type SourceSurfaceMode='points'|'mesh';
const F=Math.fround;
/** SurfaceModeTransitionAnimation constructor and onUpdate use float ratios;
 * GenericSurfaceScene.drawTransitionOverlay rounds the resulting alpha to an
 * integer byte. Easing is applied independently to each half, not to the whole
 * transition before deciding when to replace the main object. */
export function sourceSurfaceFadeRatio(value:number):number {
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw new Error('源曲面淡出比例必须为有限 Float32');
 return Math.max(F(.05),Math.min(F(.95),F(value)));
}
export function sourceSurfaceTransitionFrame(progress:number,fadeRatio:number,easing:string){
 if(!Number.isFinite(progress)||!Number.isFinite(F(progress)))throw new Error('源曲面过渡进度必须有限');
 const ratio=sourceSurfaceFadeRatio(fadeRatio),t=Math.max(0,Math.min(1,F(progress))),switchMode=t>=ratio;
 const alpha=switchMode?F(1-sourceEase(easing,Math.max(0,Math.min(1,F(F(t-ratio)/F(1-ratio)))))):sourceEase(easing,F(t/ratio));
 // Java Math.round(float): the addition is conceptually exact before floor,
 // unlike fround(alpha*255 + .5), which can round a near-half value upward.
 const overlayAlpha=Math.floor(F(Math.max(0,Math.min(1,alpha))*255)+.5);
 return{switchMode,overlayAlpha};
}
