import type {Settings} from '../types';
import {numberSetting} from './expression';

export type DomainViewportVersion='local-v1'|'mathart-1.7.8-cpu'|'mathart-1.7.8-gpu';
export interface PreparedDomainViewport {
 readonly version:DomainViewportVersion;
 /** Authored values, not rounded uniforms or a second persisted zoom. */
 readonly centerX:number;readonly centerY:number;readonly scale:number;readonly rotation:number;
 readonly effectiveScale:number;readonly inverseScale:number;readonly halfSpan:number;
 readonly angle:number;readonly yDirection:1|-1;
 readonly cosine:number;readonly sine:number;readonly referenceCosine:number;readonly referenceSine:number;
}
export function parseDomainViewportVersion(raw:unknown):DomainViewportVersion{
 if(raw===undefined)return 'local-v1';
 if(raw==='local-v1'||raw==='mathart-1.7.8-cpu'||raw==='mathart-1.7.8-gpu')return raw;
 throw new Error('未知的域着色视口版本');
}
export function prepareDomainViewport(settings:Settings):PreparedDomainViewport{
 const version=parseDomainViewportVersion(settings.domainViewportVersion),local=version==='local-v1';
 const sourceNumber=(key:string,fallback:number)=>{const value=settings[key]===undefined?fallback:settings[key];if(typeof value!=='number'||!Number.isFinite(value))throw new Error(key+' 必须为有限数字');return value;};
 const n=local?(key:string,fallback:number)=>numberSetting(settings,key,fallback):sourceNumber;
 const scale=local?numberSetting(settings,'scale',1,1e-6,1e12):sourceNumber('scale',2.5),rotation=n('rotation',0);
 const effectiveScale=local?scale:Math.max(1e-9,scale),inverseScale=1/effectiveScale,angle=local?rotation:Math.fround(rotation),cosine=Math.cos(angle),sine=Math.sin(angle);
 return Object.freeze({version,centerX:n('centerX',0),centerY:n('centerY',0),scale,rotation,effectiveScale,inverseScale,halfSpan:(local?2:1)*inverseScale,angle,yDirection:local?-1:1,cosine,sine,referenceCosine:version==='mathart-1.7.8-gpu'?Math.fround(cosine):cosine,referenceSine:version==='mathart-1.7.8-gpu'?Math.fround(sine):sine});
}
const f=Math.fround;
/** Raster index plus explicit subpixel offset. SS>1 is a local extension: the
 * CPU offset is rounded before addition to the integer index. GPU SS extends
 * the interpolated pixel-center UV by the explicit subpixel displacement.
 * CPU source keeps the original multiply-before-divide staged-F32 plane.
 * GPU CPU reference approximates that center UV by a rounded division, then
 * adds the F32 displacement. Actual varying interpolation and shader trig/FMA
 * can differ; successful GPU math repair consumes captured GPU coordinates. */
export function domainPixel(column:number,row:number,width:number,height:number,view:PreparedDomainViewport,offsetX=.5,offsetY=.5):[number,number]{
 if(view.version==='local-v1'){
  // Preserve the former complexPixel call and operation order, including the
  // canceling -.5/+.5 in supersampling. Do not simplify this legacy recipe.
  const x=column+offsetX-.5,y=row+offsetY-.5;
  const re=((x+.5)/width-.5)*4*width/height/view.scale,im=(.5-(y+.5)/height)*4/view.scale;
  const co=Math.cos(view.rotation),si=Math.sin(view.rotation);
  return[view.centerX+0+(re*co-im*si),view.centerY+0+(re*si+im*co)];
 }
 const x=f(f(column)+f(offsetX)),y=f(f(row)+f(offsetY)),w=f(width),h=f(height),aspect=f(w/h);
 if(view.version==='mathart-1.7.8-cpu'){
  const px=f(f(f(f(2*x)/w)-1)*aspect),py=f(f(f(2*y)/h)-1),co=view.referenceCosine,si=view.referenceSine;
  return[view.centerX+(px*co-py*si)*view.inverseScale,view.centerY+(px*si+py*co)*view.inverseScale];
 }
 const u=f(f(f(f(column)+.5)/w)+f(f(f(offsetX)-.5)/w)),v=f(f(f(f(row)+.5)/h)+f(f(f(offsetY)-.5)/h));
 const px=f(f(f(u*2)-1)*aspect),py=f(f(v*2)-1),co=view.referenceCosine,si=view.referenceSine,radius=f(view.inverseScale);
 return[f(f(view.centerX)+f(f(f(px*co)-f(py*si))*radius)),f(f(view.centerY)+f(f(f(px*si)+f(py*co))*radius))];
}
/** Ideal affine navigation, deliberately not a quantized pixel oracle. Source
 * angle is F32 but center/scale remain authored doubles so gestures can retain
 * sub-uniform changes instead of repeatedly rounding the document. */
export function domainIdealPoint(x:number,y:number,width:number,height:number,view:PreparedDomainViewport):[number,number]{
 const re=(x/width-.5)*2*view.halfSpan*width/height,im=(y/height-.5)*2*view.halfSpan*view.yDirection,co=view.cosine,si=view.sine;
 return[view.centerX+(re*co-im*si),view.centerY+(re*si+im*co)];
}
function sourceShift(view:PreparedDomainViewport,re:number,im:number,scale:number):Settings{
 const centerX=view.centerX+(re*view.cosine-im*view.sine),centerY=view.centerY+(re*view.sine+im*view.cosine);
 if(![centerX,centerY,scale].every(Number.isFinite))throw new Error('视口超出数值范围');
 return{centerX,centerY,scale};
}
/** Source-version gesture facts. Local navigation retains its existing DD path. */
export function panDomainViewport(view:PreparedDomainViewport,dx:number,dy:number,width:number,height:number):Settings{
 if(view.version==='local-v1')throw new Error('本地视口使用原有导航规则');
 if(![dx,dy,width,height].every(Number.isFinite)||width<=0||height<=0)throw new Error('视口输入必须有限');
 return sourceShift(view,-dx/width*(2*view.halfSpan*width/height),-dy/height*(2*view.halfSpan),view.scale);
}
export function zoomDomainViewport(view:PreparedDomainViewport,x:number,y:number,width:number,height:number,deltaPixels:number):Settings{
 if(view.version==='local-v1')throw new Error('本地视口使用原有导航规则');
 if(![x,y,width,height,deltaPixels].every(Number.isFinite)||width<=0||height<=0)throw new Error('视口输入必须有限');
 const factor=Math.exp(-deltaPixels*.001),scale=Math.max(1e-9,Math.min(Number.MAX_VALUE,view.effectiveScale*factor)),nextHalfSpan=1/scale;
 const delta=view.halfSpan-nextHalfSpan;
 return sourceShift(view,(x/width-.5)*2*delta*width/height,(y/height-.5)*2*delta,scale);
}
/** Physical line width. Keep the local expression's arithmetic order. */
export function domainPixelSpan(view:PreparedDomainViewport,height:number,spacing=1):number{
 return view.version==='local-v1'?4/(height*view.scale*spacing):2*view.inverseScale/(height*spacing);
}
/** The original local explorer used a distinct addition order and .37/.61
 * jitter; retain it here while sharing all version interpretation. */
export function domainExplorePoint(column:number,row:number,width:number,height:number,view:PreparedDomainViewport):[number,number]{
 if(view.version!=='local-v1')return domainPixel(column,row,width,height,view,.37,.61);
 const re=((column+.37)/width-.5)*4*width/height/view.scale,im=(.5-(row+.61)/height)*4/view.scale,co=Math.cos(view.rotation),si=Math.sin(view.rotation);
 return[view.centerX+re*co-im*si,view.centerY+re*si+im*co];
}
export function domainViewportWarnings(view:PreparedDomainViewport):string[]{
 if(view.version==='local-v1')return[];
 const warnings=[view.version==='mathart-1.7.8-cpu'?'原产物 CPU 视口规则：向下的虚轴、分阶段 float32 平面与双精度中心；超采样为本地扩展。':'原产物 GPU 视口规则：向下的虚轴与 varying UV；CPU 参考无法逐位复现设备插值、三角函数及融合运算。'];
 if(view.scale<1e-9)warnings.push('原始视口缩放保留；计算按原产物下限 1e-9 执行。');
 return warnings;
}
export function domainViewportGpuReason(view:PreparedDomainViewport,width:number,height:number):string|undefined{
 if(view.version==='mathart-1.7.8-cpu')return '原产物 CPU 视口需要分阶段 float32 平面与双精度中心，使用 CPU 保留所选规则';
 if(view.version==='mathart-1.7.8-gpu'){
  if(![view.centerX,view.centerY,view.angle,view.inverseScale].every(v=>Number.isFinite(f(v))))return '视口 uniform 超出 float32 有限范围，使用所选 GPU 规则的 CPU 参考';
  if([view.centerX,view.centerY,view.inverseScale].some(v=>f(v)!==0&&Math.abs(f(v))<1.1754943508222875e-38))return '视口 uniform 为 float32 次正规数，使用所选 GPU 规则的 CPU 参考避免设备清零差异';
  // Underflow of inverseScale is part of this explicit float32 contract, not
  // permission to substitute a different double-precision coordinate map.
  return;
 }
 const pixelStep=4/(height*view.scale),extent=4*Math.max(width/height,1)/view.scale,max=Math.max(Math.abs(view.centerX),Math.abs(view.centerY))+extent;
 if(!Number.isFinite(max)||!Number.isFinite(f(max))||max*2**-23>pixelStep/4)return '当前复平面像素间距不足以用 GPU float32 区分';
}
