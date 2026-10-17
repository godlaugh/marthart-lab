import {numberSetting} from '../engine/expression';
import type {Settings} from '../types';
export interface ParticleTransform {
 sx:number;sy:number;sz:number;ox:number;oy:number;oz:number;co:number;si:number;
 point(x:number,y:number,z?:number):[number,number,number]|null;
}
/** One interpretation for particle geometry, guide curves and direct raster positioning. */
export function parseParticleTransform(settings:Settings):ParticleTransform {
 const scale=numberSetting(settings,'scale',1),sx=numberSetting(settings,'scaleX',1)*scale,sy=numberSetting(settings,'scaleY',1)*scale,sz=numberSetting(settings,'scaleZ',1)*scale,ox=numberSetting(settings,'offsetX',0),oy=numberSetting(settings,'offsetY',0),oz=numberSetting(settings,'offsetZ',0),angle=numberSetting(settings,'rotateZ',0),co=Math.cos(angle),si=Math.sin(angle);
 if(![sx,sy,sz].every(Number.isFinite))throw new Error('粒子派生缩放必须为有限数值');
 return Object.freeze({sx,sy,sz,ox,oy,oz,co,si,point:(x:number,y:number,z=0):[number,number,number]|null=>{
  if(![x,y,z].every(Number.isFinite)||Math.abs(x)>=1e12||Math.abs(y)>=1e12)return null;
  const result:[number,number,number]=[x*sx*co-y*sy*si+ox,x*sx*si+y*sy*co+oy,z*sz+oz];
  return result.every(v=>Number.isFinite(v)&&Math.abs(v)<=3.4028234663852886e38)?result:null;
 }});
}
