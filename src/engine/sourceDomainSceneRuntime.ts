import type {Settings} from '../types';
import {RootsSceneClock,type RootsSceneFrame} from './rootsSceneClock';
import {sourceEase,SOURCE_EASING_NAMES} from './sourceEasing';
import {SourceGradientRuntime,type SourceGradientAction} from './sourceGradientRuntime';
import {SourceDomainParameterRuntime,type SourceDomainParameterRuntimeAction} from './sourceDomainParameterRuntime';
import {applyDomainParameterBinding,domainParameterBinding,normalizedDomainParameterValue,readDomainParameterBinding} from './domainParameterBinding';
import {validateGradientConfig} from './gradientOffsets';
import {TIMELINE_OPERATION_LIMIT} from './timelineCapacity';

export type SourceDomainSceneClip=
 |{readonly kind:'wait';readonly duration:number}
 |{readonly kind:'animate';readonly duration:number;readonly easing:string;readonly rotationRate?:number;readonly parameters?:readonly SourceDomainParameterRuntimeAction[];readonly gradients?:readonly SourceGradientAction[]};
export interface SourceDomainSceneConfiguration {
 readonly initial:{readonly settings:Settings;readonly parameters:Record<string,number>;readonly rotation:number;readonly rotationRate:number;readonly paletteOffset:number};
 readonly clips:readonly SourceDomainSceneClip[];
 /** PApplet.frameRate observed by the parameter animator; independent of dt. */
 readonly parameterFps:number;
}
export interface SourceDomainUpdatePhase {readonly kind:'active'|'raw';readonly dt:number;readonly rotationBefore:number;readonly rotationAfter:number;}
const F=Math.fround;
function finite(value:unknown,label:string):number {if(typeof value!=='number'||!Number.isFinite(value))throw Error(`域场景 ${label} 必须为有限数值`);return value;}
function float(value:unknown,label:string):number {const n=F(finite(value,label));if(!Number.isFinite(n))throw Error(`域场景 ${label} 超出 Float32`);return n;}

/** Domain owns its unconditional subclass update, unlike Fractal's completed-
 * only second update. The shared clock owns queue/remaining-time arithmetic.
 * Parameter and gradient callbacks have disjoint scalar targets; relative order
 * within each registry is retained, and both start before any object update.
 * A failed step invalidates the entire instance, including child registries. */
export class SourceDomainSceneRuntime {
 private readonly clips:readonly SourceDomainSceneClip[];
 private readonly clock:RootsSceneClock;
 private readonly values:{settings:Settings;parameters:Record<string,number>};
 private readonly parameters:SourceDomainParameterRuntime;
 private readonly gradient:SourceGradientRuntime;
 private readonly writtenSettings=new Set<string>();
 private rotation:number;private rotationRate:number;private capturedRate=0;private paletteOffset:number;
 private parameterFps:number;private failed=false;private phases:SourceDomainUpdatePhase[]=[];
 private finishedAtFrameStart=false;
 constructor(configuration:SourceDomainSceneConfiguration,private readonly options:{reserve:(units:number)=>void}){
  if(!configuration||typeof options?.reserve!=='function'||!Array.isArray(configuration.clips)||configuration.clips.length>2000)throw Error('域场景需要有界队列与工作预算');
  let actions=0;for(const clip of configuration.clips){
   if(!clip||!['wait','animate'].includes(clip.kind))throw Error('域场景片段类型无效');
   float(clip.duration,'片段时长');
   if(clip.kind==='animate'){
    if(!SOURCE_EASING_NAMES.includes(clip.easing))throw Error('域场景缓动无效');
    if(clip.parameters!==undefined&&!Array.isArray(clip.parameters)||clip.gradients!==undefined&&!Array.isArray(clip.gradients))throw Error('域场景动作需要数组');
    actions+=1+(clip.parameters?.length??0)+(clip.gradients?.length??0);
    if(actions>TIMELINE_OPERATION_LIMIT)throw Error('域场景动作超过4096个');
    if(clip.rotationRate!==undefined)float(clip.rotationRate,'目标转速');
    for(const action of clip.gradients??[]){if(!action||!['start','stop'].includes(action.kind))throw Error('域场景渐变动作无效');if(action.kind==='start')validateGradientConfig({...action.config,model:'offsets'});}
   }
  }
  this.clips=structuredClone(configuration.clips);
  this.rotation=float(configuration.initial.rotation,'初始旋转');this.rotationRate=float(configuration.initial.rotationRate,'初始转速');this.paletteOffset=float(configuration.initial.paletteOffset,'初始渐变偏移');
  this.parameterFps=float(configuration.parameterFps,'宿主帧率');
  this.values=structuredClone({settings:configuration.initial.settings,parameters:configuration.initial.parameters});
  // These fields have dedicated owners; retaining a second mutable copy would
  // let downstream rendering accidentally consume an initial value.
  delete this.values.settings.rotation;delete this.values.settings.paletteOffset;
  const bindings=new Map<string,ReturnType<typeof domainParameterBinding>>();
  const binding=(name:string)=>{let value=bindings.get(name);if(!value){value=domainParameterBinding(name);bindings.set(name,value);}return value;};
  this.parameters=new SourceDomainParameterRuntime({reserve:options.reserve,
   readScalar:name=>readDomainParameterBinding(this.values,binding(name)),
   writeScalar:(name,value)=>{
    const target=binding(name),next=normalizedDomainParameterValue(target,value,readDomainParameterBinding(this.values,target));
    if(next===undefined)return;applyDomainParameterBinding(this.values,target,next);
    if(target.kind==='scale')this.writtenSettings.add('scale');else if(target.kind==='curve')this.writtenSettings.add(target.key);
   },
  });
  this.gradient=new SourceGradientRuntime(()=>this.paletteOffset,frame=>{this.paletteOffset=F(frame.palette);this.writtenSettings.add('paletteOffset');});
  this.clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},this.clips.map(c=>({duration:c.kind==='animate'&&(c.parameters?.length||c.gradients?.length)?Math.max(0,F(c.duration)):F(c.duration),easing:'linear'})));
 }
 get clipCount(){return this.clips.length;}
 get queueComplete(){this.ensure();return this.clock.snapshot().queueComplete;}
 private ensure(){if(this.failed)throw Error('域场景上次更新失败，需要重建完整实例');}
 setParameterFrameRate(value:number):void {this.ensure();this.parameterFps=float(value,'宿主帧率');}
 private update(kind:SourceDomainUpdatePhase['kind'],dt:number):void {
  const before=this.rotation;
  if(dt>0){
   this.parameters.update(dt,this.parameterFps);this.gradient.update(dt);
   if(this.rotationRate!==0){this.rotation=F(this.rotation+F(this.rotationRate*dt));this.writtenSettings.add('rotation');}
  }
  this.phases.push({kind,dt,rotationBefore:before,rotationAfter:this.rotation});
 }
 step(dt:number,paused=false,isCancelled?:()=>boolean){this.advance(dt,paused,isCancelled);return this.snapshot();}
 /** Advance without copying display state; replay materializes only its requested frame. */
 advance(dt:number,paused=false,isCancelled?:()=>boolean):void {
  this.ensure();
  try{
   const before=this.clock.snapshot();this.options.reserve(1+Math.max(0,this.clips.length-before.queueIndex));
   this.phases=[];this.finishedAtFrameStart=before.queueComplete;
   const next=this.clock.step(dt,{paused,isCancelled,allowSignedDt:true});
   if(!paused){
    if(!before.queueComplete){
     const clip=this.clips[before.queueIndex];
     if(clip.kind==='animate'){
      if(next.startedClip!==null){this.capturedRate=this.rotationRate;this.parameters.begin(clip.parameters??[]);this.options.reserve(clip.gradients?.length??0);this.gradient.begin(clip.gradients??[]);}
      const runtime=F((next.startedClip===null?before.clipRuntime:0)+next.activeDt),progress=F(runtime/F(clip.duration)),eased=sourceEase(clip.easing,Math.max(0,Math.min(1,progress)));
      if(clip.rotationRate!==undefined)this.rotationRate=F(this.capturedRate+F(F(F(clip.rotationRate)-this.capturedRate)*eased));
      const finished=runtime>=F(clip.duration);this.parameters.interpolate(eased,finished);
      // Gradient children are traversed even after finishing; parameters charge
      // their own work, while this composition owner budgets gradient callbacks.
      this.options.reserve(clip.gradients?.length??0);this.gradient.interpolate(eased,finished);
     }
     this.update('active',next.activeDt);
    }
    // Camera raw-delta work is owned by the shared clock; Domain's raster does
    // not consume its generic 3D camera. The subclass mobject call always runs.
    this.update('raw',next.rawDt);
   }
   finite(this.rotation,'旋转结果');finite(this.rotationRate,'转速结果');finite(this.paletteOffset,'渐变结果');
   if(isCancelled?.())throw new DOMException('域场景更新已取消','AbortError');
  }catch(error){this.failed=true;throw error;}
 }
 snapshot(clock:RootsSceneFrame=this.clock.snapshot()){
  this.ensure();return{clock,parameterFps:this.parameterFps,rotation:this.rotation,rotationRate:this.rotationRate,settings:structuredClone(this.values.settings),parameters:{...this.values.parameters},paletteOffset:this.paletteOffset,parameterState:this.parameters.snapshot(),gradient:this.gradient.snapshot(),phases:this.phases.map(p=>({...p})),writtenSettings:[...this.writtenSettings],managerFinishedAtFrameStart:this.finishedAtFrameStart};
 }
}
