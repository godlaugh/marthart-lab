import type {SourceCameraPlan} from './sourceCamera';

export const SOURCE_SURFACE_POINT_MODEL='mathart-1.7.8-cpu-billboard-v1' as const;
export interface SourceSurfacePointAppearance {
 readonly model:typeof SOURCE_SURFACE_POINT_MODEL;
 readonly dotRadius:number;readonly radius:number;readonly focalLength:number;
 /** Actual local preview density, not an observation of the original app. */
 readonly referencePixelDensity:number;
 readonly densityOrigin:'request'|'legacy-default-1';
 readonly displayScale:number;
}
const F=Math.fround;
/** ParticleSystemMobject.bindPointShader/getLineScale. Preserve negative radius
 * and the depth-based vertex expansion even for the scene-fade ortho pass. */
export function sourceSurfacePointAppearance(dotRadius:unknown,plan:SourceCameraPlan,referencePixelDensity?:number):SourceSurfacePointAppearance {
 if(typeof dotRadius!=='number'||!Number.isFinite(F(dotRadius)))throw new Error('源曲面点半径需要有限 Float32 数值');
 const density=referencePixelDensity??1;
 if(!Number.isFinite(density)||density<=0)throw new Error('源曲面参考像素密度须为大于 0 的有限数值');
 const displayScale=plan.viewport.target==='primary'?1:F(F(Math.sqrt(F(plan.displayScale/F(Math.pow(Math.max(1,density),F(.15))))))*F(1.4));
 const radius=F(F(F(dotRadius)*displayScale)*F(.8)),focalLength=F(F(F(plan.viewport.logicalHeight)/2)/F(Math.tan(F(plan.optics.fov/2))));
 if(!Number.isFinite(radius)||!Number.isFinite(focalLength)||focalLength<=0)throw new Error('源曲面点尺寸换算超出有限范围');
 return{model:SOURCE_SURFACE_POINT_MODEL,dotRadius:F(dotRadius),radius,focalLength,referencePixelDensity:density,densityOrigin:referencePixelDensity===undefined?'legacy-default-1':'request',displayScale};
}
/** ParametricSurface initializes a 64x64 PImage. ParticleSystemMobject creates
 * white RGB with a two-pixel alpha ramp, then transparent black outside. */
export function sourceSurfacePointSprite():Uint8Array {
 const size=64,center=32,radius=30,pixels=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const dx=F(center-x),dy=F(center-y),distance=F(Math.sqrt(F(F(dx*dx)+F(dy*dy))));
  if(distance>=radius+1)continue;
  const alpha=distance<radius-1?255:F(255+F(-255*F(F(distance-F(radius-1))/2)));
  const at=(y*size+x)*4;pixels[at]=255;pixels[at+1]=255;pixels[at+2]=255;
  pixels[at+3]=Math.trunc(F(255*F(Math.max(0,Math.min(255,alpha))/255)));
 }
 return pixels;
}
