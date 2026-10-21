import type {SceneDocument} from '../types';
import {SourceGradientRuntime,type SourceGradientFrame,type SourceGradientAction} from './sourceGradientRuntime';
import type {SourcePaletteRuntimeState} from './sourcePaletteRuntime';
import {usesSourceSymmetryGpu} from './sourceSymmetryMath';
export const SOURCE_SYMMETRY_GRADIENT_MODEL='symmetry-gradient-1.7.8';
export function usesSourceSymmetryGradient(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='symmetry'&&scene.settings.symmetryGradientModel===SOURCE_SYMMETRY_GRADIENT_MODEL;}
export function validateSourceSymmetryGradient(scene:SceneDocument):void{
 if(scene.settings.symmetryGradientModel===undefined)return;
 if(!usesSourceSymmetryGradient(scene)||!usesSourceSymmetryGpu(scene)||!scene.sourceCamera||scene.timeline.schedule!=='ordinary-camera-sequence-v1')throw Error('源 Symmetry 渐变需要对应 GPU 与原版顺序时间线');
}
export interface SourceSymmetryPaletteFrame {readonly offset:number;readonly runtime?:SourcePaletteRuntimeState;}
/** Target offsets and the last uploaded palette have different lifetimes.
 * Stopping alone does not dirty a LUT. Each component has the native 1e-9
 * write threshold; inside/outside writes also dirty the primary-only LUT. */
export class SourceSymmetryGradientRuntime {
 private offsets:{-readonly[K in keyof SourceGradientFrame]:SourceGradientFrame[K]};
 private dirty=true;
 private displayed?:SourceSymmetryPaletteFrame;
 readonly gradient:SourceGradientRuntime;
 constructor(offset=0){
  if(!Number.isFinite(offset))throw Error('Symmetry 渐变起始偏移必须有限');
  this.offsets={palette:offset,inside:0,outside:0};
  this.gradient=new SourceGradientRuntime(()=>({...this.offsets}),frame=>{
   for(const key of ['palette','inside','outside'] as const)if(Number.isFinite(frame[key])&&Math.abs(frame[key]-this.offsets[key])>1e-9){this.offsets[key]=frame[key];this.dirty=true;}
  });
 }
 begin(actions:readonly SourceGradientAction[]){this.gradient.begin(actions);}
 interpolate(eased:number,finished:boolean){this.gradient.interpolate(Math.fround(eased),finished);}
 update(dt:number){this.gradient.update(Math.fround(dt));}
 display():SourceSymmetryPaletteFrame{
  if(this.dirty){this.displayed=Object.freeze({offset:this.offsets.palette,...(this.gradient.running?{runtime:Object.freeze({interpolation:this.gradient.config!.interpolation,cyclic:true})}:{})});this.dirty=false;}
  return this.displayed!;
 }
 snapshot(){return{offsets:{...this.offsets},gradient:this.gradient.snapshot(),dirty:this.dirty,displayed:this.displayed};}
}
