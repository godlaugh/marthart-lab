import {isSourceMapColorTarget,sourceMapColorValue,sourceMapRuntimeColors,type SourceMapRuntimeColors} from './sourceMapRuntimeColors';
import {usesSourceMapParameters,validateSourceMapParameters} from './sourceMapParameterIdentity';
import type {SceneDocument} from '../types';
import {SourceSymmetryGradientRuntime,usesSourceSymmetryGradient,validateSourceSymmetryGradient,type SourceSymmetryPaletteFrame} from './sourceSymmetryGradient';
import {OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import type {SourceIterationUpdateEvent,SourceIterationObjectUpdate} from './sourceIterationFramePlan';
import {SourceIteratedParameterRuntime} from './sourceIteratedParameterRuntime';
import {usesSourceSymmetryParameters,validateSourceSymmetryParameters} from './sourceSymmetryParameterIdentity';
import {isJavaBlank} from './sourceJavaText';
export interface SourceIterationParameterFrame {readonly values:Readonly<Record<string,number>>;readonly changed:boolean;}
export interface SourceIteratedTimelineResult {frame:OrdinarySourceCameraFrame;palette:SourceSymmetryPaletteFrame;update:SourceIterationUpdateEvent;parameters?:SourceIterationParameterFrame;mapColors?:SourceMapRuntimeColors;}
const owners=new Map<string,SourceIteratedTimelineSession[]>();
const frames=new WeakMap<SceneDocument,{palette:SourceSymmetryPaletteFrame;update?:SourceIterationUpdateEvent;parameters?:SourceIterationParameterFrame}>();
export function sourceIterationPaletteFrame(scene:SceneDocument){return frames.get(scene)?.palette;}
export function sourceIterationParameterFrame(scene:SceneDocument){return frames.get(scene)?.parameters;}
export function sourceIterationUpdateEvent(scene:SceneDocument){return frames.get(scene)?.update;}
/** Isolated palette probes may bind only the palette. Full generation requires
 * the update event from the same evaluated queue, never an inferred dt flag. */
export function bindSourceIterationFrame(scene:SceneDocument,palette:SourceSymmetryPaletteFrame,update?:SourceIterationUpdateEvent,parameters?:SourceIterationParameterFrame){frames.set(scene,{palette,...(update?{update:Object.freeze({...update})}:{}),...(parameters?{parameters}:{})});}
export function clearSourceIteratedTimelineCache(){for(const group of owners.values())for(const owner of group)owner.reset();owners.clear();}
/** Owns one queue and its mutable parameter/gradient registries. Fixed replay
 * and live display use the same producer. A replay display does not acknowledge
 * parameter changes: native display returns before the snapshot branch. */
export class SourceIteratedTimelineSession {
 private readonly session:OrdinarySourceCameraTimelineSession;
 private palette?:SourceSymmetryPaletteFrame;
 private parameters?:SourceIterationParameterFrame;
 private parameterWriter?: (changes:readonly (readonly [string,number])[])=>void;
 private mapColors?:SourceMapRuntimeColors;
 private updatedFrame=-1;
 private calls:SourceIterationObjectUpdate[]=[];
 private work=0;
 private acknowledgeParameters=true;
 private index=-1;
 get frameIndex(){return this.index;}
 constructor(scene:SceneDocument){
  const map=usesSourceMapParameters(scene);if(map)validateSourceMapParameters(scene);else{if(!usesSourceSymmetryGradient(scene))throw Error('未启用源迭代队列');validateSourceSymmetryGradient(scene);validateSourceSymmetryParameters(scene);}
  const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('源迭代队列缺少相机');
  const initialColors=map?sourceMapRuntimeColors(scene.settings):undefined;
  const offset=scene.palette.offset,sourceParameters=map||usesSourceSymmetryParameters(scene),initialValues=Object.entries(scene.parameters);
  this.session=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,scene.timeline.fps,{particleActions:map?'map-parameters':sourceParameters?'symmetry-parameters':'symmetry',createParticles:()=>{
   const runtime=map?undefined:new SourceSymmetryGradientRuntime(offset);
   this.updatedFrame=-1;this.calls=[];this.palette=Object.freeze({offset});
   this.mapColors=initialColors;
   const values=new Map(initialValues);let acknowledged=new Map<string,number>(map?initialValues:[]);
   const snapshot=(changed:boolean)=>Object.freeze({values:Object.freeze(Object.fromEntries(values)),changed});
   this.parameters=sourceParameters?snapshot(false):undefined;
   this.parameterWriter=sourceParameters?changes=>{
    for(const [name,value]of changes)if(!values.has(name)||!Number.isFinite(value))throw Error('已有迭代参数热更新无效');
    for(const [name,value]of changes)if(!isJavaBlank(name))values.set(name,value);
    this.parameters=snapshot(false);
   }:undefined;
   const parameters=sourceParameters?new SourceIteratedParameterRuntime({
    read:name=>map&&isSourceMapColorTarget(name)?this.mapColors![name]:isJavaBlank(name)?undefined:values.get(name),
    write:(name,value)=>{if(map&&isSourceMapColorTarget(name))this.mapColors=Object.freeze({...this.mapColors!,[name]:sourceMapColorValue(name,value)});else if(!isJavaBlank(name))values.set(name,value);},
    reserve:units=>this.reserve(units),
   }):undefined;
   const update=(frame:{frameIndex:number;time:number;deltaTime:number})=>{
    if(this.updatedFrame!==frame.frameIndex){this.calls=[];this.updatedFrame=frame.frameIndex;}
    parameters?.update(frame.deltaTime,60);runtime?.update(frame.deltaTime);
    if(parameters)this.reserve(values.size);
    this.calls.push(Object.freeze({time:frame.time,deltaTime:frame.deltaTime,...(parameters?{parameters:Object.freeze(Object.fromEntries(values))}:{})}));
   };
   return{bind(){throw Error('源迭代场景不支持粒子跟踪');},
    beginIteratedParameterActions:actions=>parameters!.begin(actions),advanceIteratedParameterActions:dt=>parameters!.advance(dt),
    beginGradientActions:actions=>runtime?.begin(actions),interpolateGradientActions:(eased,finished)=>runtime?.interpolate(eased,finished),
    update,
    afterSceneUpdate:frame=>{if(!frame.paused)update(frame);},
    displayFrame:frameIndex=>{
     if(this.updatedFrame!==frameIndex)this.calls=[];
     this.palette=runtime?.display()??Object.freeze({offset});
     if(parameters){
      // Compare doubles against the last acknowledged display, never the
      // previous Float32 GPU field or a display skipped by native replay.
      this.reserve(values.size);
      const changed=this.acknowledgeParameters&&(values.size!==acknowledged.size||[...values].some(([name,value])=>!acknowledged.has(name)||Math.abs(acknowledged.get(name)!-value)>1e-9));
      if(changed)acknowledged=new Map(values);
      this.parameters=snapshot(changed);
     }
    }};
  }});
 }
 private reserve(units:number){this.work+=units;if(this.work>2_000_000)throw Error('源迭代参数回放超过本地工作预算');}
 private run(operation:()=>OrdinarySourceCameraFrame):SourceIteratedTimelineResult{
  this.work=0;
  try{const frame=operation();this.index=frame.frameIndex;
   return{frame,palette:this.palette!,update:{frameIndex:frame.frameIndex,calls:Object.freeze([...this.calls])},...(this.parameters?{parameters:this.parameters}:{}),...(this.mapColors?{mapColors:this.mapColors}:{})};
  }catch(error){this.reset();throw error;}
  finally{this.acknowledgeParameters=true;}
 }
 evaluate(time:number){return this.run(()=>this.session.evaluate(time));}
 /** Snapshot does not advance or acknowledge a display. Frame -1 precedes the
  * first display and must not be sent to the GPU frame planner. */
 snapshot(){return this.run(()=>this.session.snapshot());}
 step(dt:number,options:{paused?:boolean;acknowledgeParameters?:boolean}={}){
  if(options.acknowledgeParameters!==undefined&&typeof options.acknowledgeParameters!=='boolean')throw Error('源迭代参数显示确认标记无效');
  this.acknowledgeParameters=options.acknowledgeParameters!==false;
  return this.run(()=>this.session.step(dt,{paused:options.paused}));
 }
 /** Offscreen capture has a display but no preceding scene/object update. */
 display(acknowledgeParameters=true){
  if(typeof acknowledgeParameters!=='boolean')throw Error('源迭代参数显示确认标记无效');
  this.acknowledgeParameters=acknowledgeParameters;this.calls=[];
  return this.run(()=>this.session.display());
 }
 /** A local seek reconstructs a fresh fixed trajectory before entering live
  * mode; it is not an operation advertised by the original native scene. */
 reconstruct(time:number){return this.run(()=>this.session.reconstruct(time));}
 /** Native updateRuntimeSettings compares against current animated values,
  * writes both fields, and requests replay only beyond the Float32 threshold. */
 writeMapColors(colors:SourceMapRuntimeColors){
  if(!this.mapColors)throw Error('仅 Map 队列支持热着色设置');
  const next=sourceMapRuntimeColors({...colors}),before=this.mapColors;
  const replay=Math.abs(Math.fround(before.colorSpeed-next.colorSpeed))>Math.fround(1e-6)||Math.abs(Math.fround(before.colorPhase-next.colorPhase))>Math.fround(1e-6);
  this.mapColors=next;return replay;
 }
 writeParameters(changes:readonly (readonly [string,number])[]){if(!this.parameterWriter)throw Error('迭代参数运行时尚未初始化');this.parameterWriter(changes);}
 writeAngles(angles:Parameters<OrdinarySourceCameraTimelineSession['writeAngles']>[0]){this.session.writeAngles(angles);}
 writeViewport(camera:Parameters<OrdinarySourceCameraTimelineSession['writeViewport']>[0]){this.session.writeViewport(camera);}
 reset(){this.session.reset();this.parameterWriter=undefined;this.palette=undefined;this.parameters=undefined;this.mapColors=undefined;this.index=-1;this.updatedFrame=-1;this.calls=[];this.work=0;this.acknowledgeParameters=true;}
}
/** Three bounded forward lanes cover display lookahead, frame zero and density
 * replay. Keys include every scalar producer input; no frame history is cached. */
export function replaySourceIteratedTimeline(scene:SceneDocument,time:number):SourceIteratedTimelineResult{
 if(usesSourceMapParameters(scene))validateSourceMapParameters(scene);else{if(!usesSourceSymmetryGradient(scene))throw Error('未启用源迭代队列');validateSourceSymmetryGradient(scene);validateSourceSymmetryParameters(scene);}
 const key=JSON.stringify([scene.kind,scene.settings.mapParameterModel,usesSourceMapParameters(scene)?sourceMapRuntimeColors(scene.settings):undefined,scene.sourceCamera,scene.settings.sourceCameraProjection,scene.palette.offset,scene.timeline,scene.settings.symmetryParameterModel,usesSourceMapParameters(scene)||usesSourceSymmetryParameters(scene)?scene.parameters:undefined],(_key,value)=>Object.is(value,-0)?{negativeZero:true}:value),cacheable=key.length<=1_000_000;
 const group=(cacheable?owners.get(key):undefined)??[],target=Math.floor(time*scene.timeline.fps+1e-9);
 let owner=group.filter(o=>o.frameIndex<=target).sort((a,b)=>b.frameIndex-a.frameIndex)[0];
 if(!owner){if(group.length<3){owner=new SourceIteratedTimelineSession(scene);group.push(owner);}else{owner=group.reduce((a,b)=>a.frameIndex>b.frameIndex?a:b);owner.reset();}}
 try{
  const result=owner.evaluate(time);
  if(cacheable){owners.delete(key);owners.set(key,group);while(owners.size>4){const first=owners.keys().next().value!;for(const old of owners.get(first)!)old.reset();owners.delete(first);}}
  return result;
 }catch(error){owner.reset();if(cacheable){for(const old of group)old.reset();owners.delete(key);}throw error;}
}
