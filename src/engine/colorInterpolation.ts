import type {GradientAnimation,RGB} from '../types';
const TAU=Math.PI*2;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const mix=(a:number,b:number,t:number)=>a*(1-t)+b*t;
const mod=(n:number,m:number)=>((n%m)+m)%m;
const finite=(n:number,name:string)=>{if(!Number.isFinite(n))throw new Error(name+'必须为有限数值');return n;};

export function rgb(hex: string): RGB { if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`无效颜色 ${hex}`); return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB; }
const linearChannel = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const srgbChannel = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
function lab(color: RGB): RGB {
  const [r, g, b] = color.map(linearChannel);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s].map(srgbChannel) as RGB;
}
export const hex = (c: RGB) => '#' + c.map(v => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
export function interpolateColor(a: string, b: string, t: number, space: GradientAnimation['interpolation'] = 'rgb'): string {
  t = clamp(finite(t, '颜色进度')); if (t === 0) { rgb(a); return a; } if (t === 1) { rgb(b); return b; }
  return hex(compileColorInterpolation(rgb(a),rgb(b),space)(t));
}
export function hueRotate(color: string, turns: number) {
  const [l, a, b] = lab(rgb(color)), angle = turns * TAU;
  return hex(fromLab([l, a * Math.cos(angle) - b * Math.sin(angle), a * Math.sin(angle) + b * Math.cos(angle)]));
}

/** Parsed interpolation endpoints shared by CPU and GPU consumers. Color-space
 * conversion and achromatic shortest-hue choices are owned here. */
export type PreparedColorInterpolation =
 | {space:'rgb'|'linear'|'oklab';left:RGB;right:RGB}
 | {space:'oklch';left:RGB;right:RGB;hueDelta:number};
export function prepareColorInterpolation(left:RGB,right:RGB,space:GradientAnimation['interpolation']):PreparedColorInterpolation {
 if(space==='rgb')return{space,left:[...left],right:[...right]};
 if(space==='linear')return{space,left:left.map(linearChannel) as RGB,right:right.map(linearChannel) as RGB};
 const a=lab(left),b=lab(right);
 if(space==='oklab')return{space,left:a,right:b};
 if(space!=='oklch')throw new Error(`未知颜色插值 ${space}`);
 const ac=Math.hypot(a[1],a[2]),bc=Math.hypot(b[1],b[2]);let ah=Math.atan2(a[2],a[1]),bh=Math.atan2(b[2],b[1]);
 if(ac<1e-7)ah=bh;if(bc<1e-7)bh=ah;const delta=mod(bh-ah+Math.PI,TAU)-Math.PI;
 return{space,left:[a[0],ac,ah],right:[b[0],bc,bh],hueDelta:delta};
}
export function compilePreparedColorInterpolation(plan:PreparedColorInterpolation):(t:number)=>RGB {
 const a=plan.left,b=plan.right;
 if(plan.space==='rgb')return t=>a.map((v,i)=>mix(v,b[i],t)) as RGB;
 if(plan.space==='linear')return t=>a.map((v,i)=>srgbChannel(mix(v,b[i],t))) as RGB;
 if(plan.space==='oklab')return t=>fromLab(a.map((v,i)=>mix(v,b[i],t)) as RGB);
 if(plan.space==='oklch')return t=>{const h=a[2]+plan.hueDelta*t,c=mix(a[1],b[1],t);return fromLab([mix(a[0],b[0],t),c*Math.cos(h),c*Math.sin(h)]);};
 throw new Error('未知颜色插值');
}
export function compileColorInterpolation(left:RGB,right:RGB,space:GradientAnimation['interpolation']):(t:number)=>RGB {
 return compilePreparedColorInterpolation(prepareColorInterpolation(left,right,space));
}
