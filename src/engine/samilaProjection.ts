import type {SceneDocument,Settings} from '../types';
import type {ParticleTransform} from '../scenes/particleTransform';
import {numberSetting} from './expression';
import {samilaCameraEnabled} from './samilaCamera';

export const SAMILA_SOURCE_PROJECTION_MODEL='source-ndc-v1' as const;
type Scene=Pick<SceneDocument,'kind'|'settings'>;
export interface SamilaNdcProjection {readonly model:typeof SAMILA_SOURCE_PROJECTION_MODEL;readonly scaleX:number;readonly scaleY:number;readonly offsetX:number;readonly offsetY:number;}
/** This version owns only the shipped XY viewport transform. Local sampling,
 * point coverage, color and fixed-frame replay remain separate contracts. */
export function usesSamilaSourceProjection(scene:Scene):boolean {
 const model=scene.settings.samilaProjectionModel;
 if(model===undefined)return false;
 if(model!==SAMILA_SOURCE_PROJECTION_MODEL)throw Error('Samila 投影模型无效');
 if(scene.kind!=='samila'||!samilaCameraEnabled(scene))throw Error('源 Samila 投影需要持续批次、限幅历史、锚定 theta 与 XY 投影');
 return true;
}
export function prepareSamilaNdcProjection(scene:Scene):SamilaNdcProjection|undefined {
 if(!usesSamilaSourceProjection(scene))return;
 const read=(key:string,fallback:number)=>{const value=Math.fround(numberSetting(scene.settings,key,fallback));if(!Number.isFinite(value))throw Error('Samila 视口变换超出 float32');return value;};
 return Object.freeze({model:SAMILA_SOURCE_PROJECTION_MODEL,scaleX:read('scaleX',Math.fround(.33)),scaleY:read('scaleY',Math.fround(.33)),offsetX:read('offsetX',0),offsetY:read('offsetY',0)});
}
/** Input already has the sampling rotation (runtime rotation + theta anchor).
 * No global scale, Z components or the local post-scale rotateZ are consumed. */
export function samilaNdcParticleTransform(p:SamilaNdcProjection):ParticleTransform {
 const {scaleX:sx,scaleY:sy}=p;
 return Object.freeze({sx,sy,sz:0,ox:0,oy:0,oz:0,co:1,si:0,point:(x:number,y:number):[number,number,number]|null=>{
  const point:[number,number,number]=[Math.fround(Math.fround(x)*sx),Math.fround(Math.fround(y)*sy),0];
  return point.every(Number.isFinite)?point:null;
 }});
}
/** Aspect correction belongs before offset; do not subtract an already rounded
 * offset to reconstruct the scaled point. Local colors sample pre-offset XY. */
export function samilaNdcPosition(p:SamilaNdcProjection,point:readonly number[],width:number,height:number):[number,number] {
 const aspect=Math.fround(width/height);
 return [Math.fround(point[0]+p.offsetX),Math.fround(Math.fround(point[1]*aspect)+p.offsetY)];
}
export const SAMILA_NDC_POSITION_GLSL='vec2 samilaNdcPosition(vec3 point){return vec2(point.x,point.y*samilaAspect)+samilaOffset;}';
/** A source projection never parses dormant local auto-fit controls. */
export const samilaNdcDensityViewport=()=>({projection:'xy' as const,padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}});
export const SAMILA_SOURCE_DORMANT_CONTROLS:readonly (keyof Settings)[]=['iteratedMode','samilaHistoryModel','densityProjection','densityView','densityCenterX','densityCenterY','densitySpan','densityPadding','scale','scaleZ','offsetZ','rotateX','rotateY','rotateZ'];

export function samilaNdcSamplingRotation(rotation:number,anchor:number):number {const value=Math.fround(Math.fround(rotation)+Math.fround(anchor));if(!Number.isFinite(value))throw Error('Samila 采样旋转超出 float32');return Math.abs(value)>1e-9?value:0;}
