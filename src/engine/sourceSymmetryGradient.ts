import type {SceneDocument} from '../types';
import {SourceGradientRuntime,type SourceGradientFrame,type SourceGradientAction} from './sourceGradientRuntime';
import type {SourcePaletteRuntimeState} from './sourcePaletteRuntime';
import {OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
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
interface Owner {session:OrdinarySourceCameraTimelineSession;runtime?:SourceSymmetryGradientRuntime;palette?:SourceSymmetryPaletteFrame;frameIndex:number;}
const owners=new Map<string,Owner[]>();
const frames=new WeakMap<SceneDocument,SourceSymmetryPaletteFrame>();
export function sourceSymmetryPaletteFrame(scene:SceneDocument){return frames.get(scene);}
export function bindSourceSymmetryPaletteFrame(scene:SceneDocument,frame:SourceSymmetryPaletteFrame){frames.set(scene,frame);}
export function clearSourceSymmetryGradientCache(){for(const group of owners.values())for(const owner of group)owner.session.reset();owners.clear();}
function create(scene:SceneDocument):Owner{
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('Symmetry 渐变缺少源相机');
 const offset=scene.palette.offset;
 let owner:Owner;
 const session=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,scene.timeline.fps,{particleActions:'symmetry',createParticles(){
  const runtime=owner.runtime=new SourceSymmetryGradientRuntime(offset);
  return{bind(){throw Error('原版 Symmetry 不支持粒子跟踪');},beginGradientActions:actions=>runtime.begin(actions),interpolateGradientActions:(eased,finished)=>runtime.interpolate(eased,finished),update:frame=>runtime.update(frame.deltaTime),displayFrame:()=>{owner.palette=runtime.display();}};
 }});
 return owner={session,frameIndex:-1};
}
/** Three bounded forward lanes cover display lookahead, frame zero and density
 * replay. Keys include every scalar producer input; no frame history is cached. */
export function replaySourceSymmetryGradient(scene:SceneDocument,time:number):{frame:OrdinarySourceCameraFrame;palette:SourceSymmetryPaletteFrame}{
 if(!usesSourceSymmetryGradient(scene))throw Error('未启用源 Symmetry 渐变');validateSourceSymmetryGradient(scene);
 const key=JSON.stringify([scene.sourceCamera,scene.settings.sourceCameraProjection,scene.palette.offset,scene.timeline]),cacheable=key.length<=1_000_000;
 const group=(cacheable?owners.get(key):undefined)??[],target=Math.floor(time*scene.timeline.fps+1e-9);
 let owner=group.filter(o=>o.frameIndex<=target).sort((a,b)=>b.frameIndex-a.frameIndex)[0];
 if(!owner){if(group.length<3){owner=create(scene);group.push(owner);}else{owner=group.reduce((a,b)=>a.frameIndex>b.frameIndex?a:b);owner.session.reset();owner.frameIndex=-1;}}
 try{
  const frame=owner.session.evaluate(time);owner.frameIndex=frame.frameIndex;
  if(cacheable){owners.delete(key);owners.set(key,group);while(owners.size>4){const first=owners.keys().next().value!;for(const old of owners.get(first)!)old.session.reset();owners.delete(first);}}
  return{frame,palette:owner.palette!};
 }catch(error){owner.session.reset();owner.frameIndex=-1;if(cacheable){for(const old of group)old.session.reset();owners.delete(key);}throw error;}
}
