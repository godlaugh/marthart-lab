import type {ControlSpec,Palette,RGB,SceneDocument,Settings} from '../types';
import {interpolatePaletteColor,paletteBaseColor} from './palette';

const fract=(v:number)=>((v%1)+1)%1;
const select=(s:Settings,key:string,fallback:string,values:string[])=>{const v=s[key]??fallback;if(typeof v!=='string'||!values.includes(v))throw new Error(`${key}: invalid option`);return v;};
export function geometryColorModel(scene:Pick<SceneDocument,'kind'|'settings'>){
 const s=scene.settings;
 return {surface:scene.kind==='surface'?select(s,'surfaceColorMode','legacy',['legacy','parameter-u']):'legacy',implicit:scene.kind==='implicit'?select(s,'implicitColorMode','legacy',['legacy','z-domain']):'legacy',closure:scene.kind==='surface'?select(s,'surfaceGradientClosure','auto',['auto','open','closed']):'auto'};
}
export function hasGeometryColorOverride(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{
 const mode=geometryColorModel(scene);return scene.kind==='surface'?mode.surface==='parameter-u':scene.kind==='implicit'&&mode.implicit==='z-domain';
}
/** A closed interval retains its final stop at positive whole-cycle endpoints.
 * Cycling and offset retain their values; paletteColor's existing half-open
 * contract remains unchanged for other scenes. */
export function paletteDomainColor(p:Palette,t:number):RGB{
 const coordinate=t*p.cycles+fract(p.offset);if(!Number.isFinite(coordinate))throw new Error('Palette domain coordinate must be finite');
 return paletteBaseColor(p,coordinate>0&&Number.isInteger(coordinate)?1:fract(coordinate));
}
/** Close the last-to-first color segment without mutating stops or controls.
 * Nonintegral cycle counts are blended across a whole U turn to match seam
 * values. Seam derivatives match where the cyclic base is differentiable at
 * the offset; linear-stop knots may retain corners. Integer cycles are exact. */
export function surfacePaletteSampler(p:Palette,closed:boolean):(u:number)=>RGB{
 if(!closed)return u=>paletteDomainColor(p,u);
 const first=paletteBaseColor(p,0),last=paletteBaseColor(p,1);
 const same=first.every((v,i)=>Math.abs(v-last[i])<1e-12);
 const end=same?1:(p.stops.length-1)/p.stops.length;
 const cyclic=(phase:number):RGB=>{const u=fract(phase);if(u<=end)return paletteBaseColor(p,u/end);const a=(u-end)/(1-end);return interpolatePaletteColor(last,first,a,p.interpolation??'rgb');};
 return u=>{if(!Number.isFinite(u))throw new Error('Surface color coordinate must be finite');const t=fract(u),a=cyclic(t*p.cycles+p.offset);if(Number.isInteger(p.cycles))return a;const b=cyclic((t-1)*p.cycles+p.offset),blend=t*t*(3-2*t);return a.map((v,i)=>v+(b[i]-v)*blend) as RGB;};
}

export interface SurfaceClosure {closed:boolean;probes:number;reason:'declared'|'matched'|'open'|'invalid'|'degenerate';distance?:number;tolerance?:number;}
/** Bounded, independent geometric probe. Direct, reversed and periodic V shifts
 * are checked; finite sampled agreement is evidence, not a topology proof. */
export function detectSurfaceColorClosure(sample:(u:number,v:number)=>[number,number,number],relativeTolerance:number,uSegments=16):SurfaceClosure{
 if(!Number.isFinite(relativeTolerance)||relativeTolerance<0||relativeTolerance>1)throw new Error('Surface closure tolerance must be in [0,1]');
 if(!Number.isInteger(uSegments)||uSegments<2||uSegments>512)throw new Error('Surface closure segments must be an integer in [2,512]');
 const count=16,a:RGB[]=[],b:RGB[]=[],low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];let probes=0;
 for(let j=0;j<=count;j++)for(const u of [0,1]){const point=sample(u,j/count);probes++;if(point.some(v=>!Number.isFinite(v)))return {closed:false,probes,reason:'invalid'};(u===0?a:b).push(point);for(let k=0;k<3;k++){low[k]=Math.min(low[k],point[k]);high[k]=Math.max(high[k],point[k]);}}
 // Include interior U positions so an exactly coincident seam still has a scale.
 for(const u of [.25,.5,.75])for(const v of [0,.5,1]){const point=sample(u,v);probes++;if(point.some(x=>!Number.isFinite(x)))return {closed:false,probes,reason:'invalid'};for(let k=0;k<3;k++){low[k]=Math.min(low[k],point[k]);high[k]=Math.max(high[k],point[k]);}}
 const diagonal=Math.hypot(...high.map((v,i)=>v-low[i]));if(!Number.isFinite(diagonal)||diagonal===0)return {closed:false,probes,reason:'degenerate'};
 const distance=(p:RGB,q:RGB)=>Math.hypot(...p.map((v,i)=>v-q[i]));
 // Scale seam tolerance by adjacent U movement, not the full surface diagonal:
 // a long thin open sheet must not become cyclic just because V is large.
 let step=0;for(let j=0;j<6;j++){const p=sample(0,j/5),q=sample(1/uSegments,j/5);probes+=2;if([...p,...q].some(v=>!Number.isFinite(v)))return {closed:false,probes,reason:'invalid'};step+=distance(p,q)/6;}
 if(!(step>0)||!Number.isFinite(step))return {closed:false,probes,reason:'degenerate'};
 const tolerance=step*Math.max(.35,relativeTolerance);
 let best=Math.min(Math.max(...a.map((p,j)=>distance(p,b[j]))),Math.max(...a.map((p,j)=>distance(p,b[count-j]))));
 if(distance(a[0],a[count])<=tolerance&&distance(b[0],b[count])<=tolerance)for(let shift=0;shift<count;shift++)for(const sign of [-1,1]){let worst=0;for(let j=0;j<count;j++)worst=Math.max(worst,distance(a[j],b[(shift+sign*j+count)%count]));best=Math.min(best,worst);}
 return {closed:best<=tolerance,probes,reason:best<=tolerance?'matched':'open',distance:best,tolerance};
}
export function geometryColorControls(scene:Pick<SceneDocument,'kind'|'settings'>):ControlSpec[]{
 const group='几何渐变',mode=geometryColorModel(scene);
 if(scene.kind==='surface')return [{key:'surfaceColorMode',label:'曲面颜色坐标',group,type:'select',options:[{value:'parameter-u',label:'参数 U 渐变'},{value:'legacy',label:'原有空间度量'}]},...(mode.surface==='parameter-u'?[{key:'surfaceGradientClosure',label:'U 渐变闭环',group,type:'select',options:[{value:'auto',label:'自动检测'},{value:'open',label:'开放渐变'},{value:'closed',label:'闭环渐变'}],help:'网格按端点探测或显式 U 接缝设置闭环；点模式按 U 周期设置。强制闭环只改变颜色，不修改几何。'} as ControlSpec]:[])];
 return scene.kind==='implicit'?[{key:'implicitColorMode',label:'隐式曲面颜色坐标',group,type:'select',options:[{value:'z-domain',label:'采样域 Z 渐变'},{value:'legacy',label:'原有空间度量'}],help:'颜色绑定变换前 Z 采样域。缩放、平移和旋转不会重新归一化颜色；旧文档保留原有空间度量。'}]:[];
}
