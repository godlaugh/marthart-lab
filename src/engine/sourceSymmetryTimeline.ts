import type {SceneDocument} from '../types';
import {SourceSymmetryGradientRuntime,usesSourceSymmetryGradient,validateSourceSymmetryGradient,type SourceSymmetryPaletteFrame} from './sourceSymmetryGradient';
import {OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import type {SourceSymmetryUpdateEvent} from './sourceSymmetryFramePlan';
import {SourceSymmetryParameterRuntime} from './sourceSymmetryParameterRuntime';
import {usesSourceSymmetryParameters,validateSourceSymmetryParameters} from './sourceSymmetryParameterIdentity';
import {isJavaBlank} from './sourceJavaText';
export interface SourceSymmetryParameterFrame {readonly values:Readonly<Record<string,number>>;readonly changed:boolean;}
interface Owner {session:OrdinarySourceCameraTimelineSession;palette?:SourceSymmetryPaletteFrame;frameIndex:number;updatedFrame:number;work:number;parameters?:SourceSymmetryParameterFrame;}
const owners=new Map<string,Owner[]>();
const frames=new WeakMap<SceneDocument,{palette:SourceSymmetryPaletteFrame;update?:SourceSymmetryUpdateEvent;parameters?:SourceSymmetryParameterFrame}>();
export function sourceSymmetryPaletteFrame(scene:SceneDocument){return frames.get(scene)?.palette;}
export function sourceSymmetryParameterFrame(scene:SceneDocument){return frames.get(scene)?.parameters;}
export function sourceSymmetryUpdateEvent(scene:SceneDocument){return frames.get(scene)?.update;}
/** Isolated palette probes may bind only the palette. Full generation requires
 * the update event from the same evaluated queue, never an inferred dt flag. */
export function bindSourceSymmetryPaletteFrame(scene:SceneDocument,palette:SourceSymmetryPaletteFrame,update?:SourceSymmetryUpdateEvent,parameters?:SourceSymmetryParameterFrame){frames.set(scene,{palette,...(update?{update:Object.freeze({...update})}:{}),...(parameters?{parameters}:{})});}
export function clearSourceSymmetryTimelineCache(){for(const group of owners.values())for(const owner of group)owner.session.reset();owners.clear();}
function create(scene:SceneDocument):Owner{
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('Symmetry 渐变缺少源相机');
 const offset=scene.palette.offset,sourceParameters=usesSourceSymmetryParameters(scene),initialValues=Object.entries(scene.parameters);
 let owner:Owner;
 const session=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,scene.timeline.fps,{particleActions:sourceParameters?'symmetry-parameters':'symmetry',createParticles(){
  const runtime=new SourceSymmetryGradientRuntime(offset);
  owner.updatedFrame=-1;
  const values=new Map(initialValues);let acknowledged=new Map<string,number>();
  const parameters=sourceParameters?new SourceSymmetryParameterRuntime({
   read:name=>isJavaBlank(name)?undefined:values.get(name),
   write:(name,value)=>{if(!isJavaBlank(name))values.set(name,value);},
   reserve:units=>{owner.work+=units;if(owner.work>2_000_000)throw Error('源 Symmetry 参数回放超过本地工作预算');},
  }):undefined;
  return{bind(){throw Error('原版 Symmetry 不支持粒子跟踪');},
   beginSymmetryParameterActions:actions=>parameters!.begin(actions),advanceSymmetryParameterActions:dt=>parameters!.advance(dt),
   beginGradientActions:actions=>runtime.begin(actions),interpolateGradientActions:(eased,finished)=>runtime.interpolate(eased,finished),
   update:frame=>{parameters?.update(frame.deltaTime,60);runtime.update(frame.deltaTime);owner.updatedFrame=frame.frameIndex;},
   displayFrame:()=>{
    owner.palette=runtime.display();
    if(parameters){
     // Native display acknowledges only a changed double snapshot. Small
     // changes accumulate against that snapshot, not the previous Float32 GPU field.
     owner.work+=values.size;if(owner.work>2_000_000)throw Error('源 Symmetry 参数快照超过本地工作预算');
     const changed=values.size!==acknowledged.size||[...values].some(([name,value])=>!acknowledged.has(name)||Math.abs(acknowledged.get(name)!-value)>1e-9);
     if(changed)acknowledged=new Map(values);
     owner.parameters=Object.freeze({values:Object.freeze(Object.fromEntries(values)),changed});
    }
   }};
 }});
 return owner={session,frameIndex:-1,updatedFrame:-1,work:0};
}
/** Three bounded forward lanes cover display lookahead, frame zero and density
 * replay. Keys include every scalar producer input; no frame history is cached. */
export function replaySourceSymmetryTimeline(scene:SceneDocument,time:number):{frame:OrdinarySourceCameraFrame;palette:SourceSymmetryPaletteFrame;update:SourceSymmetryUpdateEvent;parameters?:SourceSymmetryParameterFrame}{
 if(!usesSourceSymmetryGradient(scene))throw Error('未启用源 Symmetry 渐变');validateSourceSymmetryGradient(scene);validateSourceSymmetryParameters(scene);
 const key=JSON.stringify([scene.sourceCamera,scene.settings.sourceCameraProjection,scene.palette.offset,scene.timeline,scene.settings.symmetryParameterModel,usesSourceSymmetryParameters(scene)?scene.parameters:undefined],(_key,value)=>Object.is(value,-0)?{negativeZero:true}:value),cacheable=key.length<=1_000_000;
 const group=(cacheable?owners.get(key):undefined)??[],target=Math.floor(time*scene.timeline.fps+1e-9);
 let owner=group.filter(o=>o.frameIndex<=target).sort((a,b)=>b.frameIndex-a.frameIndex)[0];
 if(!owner){if(group.length<3){owner=create(scene);group.push(owner);}else{owner=group.reduce((a,b)=>a.frameIndex>b.frameIndex?a:b);owner.session.reset();owner.frameIndex=-1;}}
 try{
  owner.work=0;const frame=owner.session.evaluate(time);owner.frameIndex=frame.frameIndex;
  if(cacheable){owners.delete(key);owners.set(key,group);while(owners.size>4){const first=owners.keys().next().value!;for(const old of owners.get(first)!)old.session.reset();owners.delete(first);}}
  return{frame,palette:owner.palette!,update:{frameIndex:frame.frameIndex,updated:owner.updatedFrame===frame.frameIndex},...(owner.parameters?{parameters:owner.parameters}:{})};
 }catch(error){owner.session.reset();owner.frameIndex=-1;if(cacheable){for(const old of group)old.session.reset();owners.delete(key);}throw error;}
}
