import type {ControlSpec,Settings} from '../types';
/** Width is measured in logical render-canvas pixels. The editor recommends
 * 0.1–32 pixels without imposing an import clamp. Zero hides segments only. */
export function parseTrailAppearance(settings:Settings):{width:number}{
 const width=settings.trailWidth??1;
 if(typeof width!=='number'||!Number.isFinite(width)||width<0||!Number.isFinite(Math.fround(width)))throw new Error('拖尾线宽必须是可表示的非负像素数');
 return {width};
}
export const trailWidthControl:ControlSpec={key:'trailWidth',label:'拖尾线宽 · 像素',group:'历史拖尾',type:'number',min:0,step:.1,help:'常用线宽为 0.1–32 像素，不随空间缩放改变。设为 0 隐藏线段，粒子头部仍可显示。'};
