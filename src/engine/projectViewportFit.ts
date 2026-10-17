import type {ProjectResolution} from './projectResolution';

export interface ProjectViewportFit {
 readonly width:number;readonly height:number;
 readonly left:number;readonly top:number;
}

/** Browser CSS adaptation of AppLayout's configured-aspect fit. The authored
 * resolution is already parsed by its owner; it is not the primary pixel size.
 * AppLayout stages ratio/multiply/divide as float32. Centering here is CSS
 * arithmetic, not a claim about Compose alignment, Swing rounding or JOGL DPI.
 * Omission retains the existing full-parent layout without float conversion. */
export function projectViewportFit(resolution:ProjectResolution|undefined,availableWidth:number,availableHeight:number):ProjectViewportFit {
 if(!Number.isFinite(availableWidth)||!Number.isFinite(availableHeight)||availableWidth<=0||availableHeight<=0)
  throw new Error('画布可用尺寸必须为有限正数');
 if(!resolution)return{width:availableWidth,height:availableHeight,left:0,top:0};
 const f=Math.fround,width=f(availableWidth),height=f(availableHeight);
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
  throw new Error('画布可用尺寸超出浮点范围');
 const aspect=f(f(resolution.width)/f(resolution.height));
 const fitWidth=Math.min(width,f(height*aspect)),fitHeight=Math.min(height,f(width/aspect));
 return{width:fitWidth,height:fitHeight,left:(availableWidth-fitWidth)/2,top:(availableHeight-fitHeight)/2};
}
