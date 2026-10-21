import type {GenerateContext} from '../types';
import {MAX_RASTER_PIXELS,rasterDimensions} from './rasterDimensions';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
/** Explicit logical canvas; absent on legacy, adaptively sized previews. */
export interface DomainTargetRequest {logicalWidth:number;logicalHeight:number;pixelDensity:number;}
export type DomainRasterTarget=ReturnType<typeof prepareSourcePausedCaptureSize>;
/** Capture callers round requested physical size through the shared source
 * capture owner first. Rendering consumes its exact logical/physical result. */
export function prepareDomainRasterTarget(c:GenerateContext):DomainRasterTarget|undefined {
 const p=c.domainTarget;if(p===undefined)return;
 if(!p||typeof p!=='object'||Array.isArray(p)||![p.logicalWidth,p.logicalHeight,p.pixelDensity].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('域着色目标需要正整数逻辑尺寸与密度');
 const target=prepareSourcePausedCaptureSize({width:p.logicalWidth*p.pixelDensity,height:p.logicalHeight*p.pixelDensity},p.pixelDensity,MAX_RASTER_PIXELS);
 if(target.width!==c.width||target.height!==c.height)throw Error('域着色目标物理尺寸必须与逻辑尺寸及密度一致');
 return target;
}
/** Explicit targets never silently change the sample lattice. Preserve the
 * existing preview pixel/work bounds, admitting both formula and presentation
 * work. Export retains the existing exact-image budget. */
export function admitDomainTarget(c:GenerateContext,target:DomainRasterTarget,cost:number,backend:'cpu'|'webgl2',logicalCpu:boolean):void {
 const extra=logicalCpu&&target.density>1?target.logicalWidth*target.logicalHeight:0;
 if(target.width*target.height+extra>MAX_RASTER_PIXELS)throw Error('域着色物理图像与逻辑中间图超过 128 MiB 图像预算');
 const pixels=target.width*target.height,work=logicalCpu?target.logicalWidth*target.logicalHeight*cost+(extra?pixels*4:0):pixels*cost;
 const admitted=rasterDimensions(c,work/pixels,backend,[]);
 if(admitted[0]!==target.width||admitted[1]!==target.height)throw Error('域着色明确目标超过预览工作预算，请使用导出或减小尺寸');
}
/** Source PImage RGB -> opaque target: texel-center LINEAR, CLAMP_TO_EDGE.
 * Software interpolation is source-derived, not a native driver byte oracle.
 * Target admission owns allocation bounds; no extra full-size scratch. */
export function presentDomainRgbLinear(source:Uint8ClampedArray,logicalWidth:number,logicalHeight:number,pixels:Uint8ClampedArray,width:number,height:number,cancel:()=>void):void {
 if(source.length!==logicalWidth*logicalHeight*4||pixels.length!==width*height*4)throw Error('域着色线性呈现缓冲尺寸无效');
 for(let y=0;y<height;y++){
  cancel();const sy=Math.max(0,Math.min(logicalHeight-1,(y+.5)*logicalHeight/height-.5)),y0=Math.floor(sy),y1=Math.min(logicalHeight-1,y0+1),fy=sy-y0;
  for(let x=0;x<width;x++){
   const sx=Math.max(0,Math.min(logicalWidth-1,(x+.5)*logicalWidth/width-.5)),x0=Math.floor(sx),x1=Math.min(logicalWidth-1,x0+1),fx=sx-x0,at=(y*width+x)*4;
   for(let k=0;k<3;k++){
    const a=source[(y0*logicalWidth+x0)*4+k]*(1-fx)+source[(y0*logicalWidth+x1)*4+k]*fx;
    const b=source[(y1*logicalWidth+x0)*4+k]*(1-fx)+source[(y1*logicalWidth+x1)*4+k]*fx;
    pixels[at+k]=Math.round(a*(1-fy)+b*fy);
   }
   pixels[at+3]=255;
  }
 }
}
