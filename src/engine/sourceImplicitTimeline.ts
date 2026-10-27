import type {SceneDocument} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraParticles} from './ordinarySourceCameraTimeline';
import {SourceOscillatingParameterRuntime} from './sourceOscillatingParameterRuntime';
import {SourceImplicitDisplayOwner} from './sourceImplicitDisplay';
/** One implicit function/parameter registry per queue lifetime. The original
 * Mobject updates parameters after child animations and before camera updates.
 * No geometry consumer owns a second interpretation of the parameter clock. */
export function createSourceImplicitTimeline(scene:SceneDocument,fps:number,isCancelled?:()=>boolean){
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('隐式源参数需要源相机');
 const authored=Object.freeze({...scene.parameters});let values={...authored},used=0,display=new SourceImplicitDisplayOwner();
 const reserve=(units:number)=>{if(isCancelled?.())throw new DOMException('隐式参数已取消','AbortError');used+=units;if(!Number.isSafeInteger(used)||used>20_000_000)throw Error('隐式参数单次操作超过本地 2000 万工作单位预算');};
 const queue=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,fps,{particleActions:'implicit',isCancelled,createParticles:()=>{
  values={...authored};display=new SourceImplicitDisplayOwner();
  const runtime=new SourceOscillatingParameterRuntime({implicit:{hasParameter:name=>Object.hasOwn(values,name)},read:name=>values[name]??0,write:(name,value)=>{if(Object.hasOwn(values,name)){display.markDirty();values[name]=value;}},reserve});
  const producer:OrdinarySourceCameraParticles={
   bind:()=>({kind:'ignored',reason:'原版隐式场景不提供粒子跟踪目标'}),
   beginParameterActions:actions=>runtime.begin(actions),interpolateParameterActions:(eased,finished)=>runtime.interpolate(eased,finished),
   update:frame=>runtime.update(frame.deltaTime,frame.actualFrameRate??fps),
   displayFrame:(_index,final)=>{if(!final)display.consumeHistoricalDisplay();},
  };return producer;
 }});
 return{queue,parameters:()=>({...values}),get display(){return display;},beginOperation:()=>{used=0;}};
}
export function replaySourceImplicitTimeline(scene:SceneDocument,time:number,isCancelled?:()=>boolean){
 const owner=createSourceImplicitTimeline(scene,scene.timeline.fps,isCancelled);
 try{const frame=owner.queue.evaluate(time);return{frame,parameters:owner.parameters()};}finally{owner.queue.reset();}
}
