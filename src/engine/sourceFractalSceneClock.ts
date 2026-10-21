import {RootsSceneClock,type RootsSceneFrame} from './rootsSceneClock';
import {sourceEase,SOURCE_EASING_NAMES} from './sourceEasing';
import {evaluateSourceFractalZoom,normalizeSourceFractalCenter,parseSourceFractalZoomTarget,type SourceFractalZoomState,type SourceFractalZoomTarget} from './sourceFractalZoom';

export interface SourceFractalObjectState extends SourceFractalZoomState {
 rotation:number;rotationRate:number;iterations:number;bailout:number;juliaReal:number;juliaImag:number;
 ambientAngles:[number,number,number];ambientRates:[number,number,number];currentTime:number;
}
export interface SourceFractalAnimationTargets {
 center?:readonly [number,number];zoom?:number;rotation?:number;rotationRate?:number;
 ambientRates?:readonly [number,number,number];iterations?:number;bailout?:number;julia?:readonly [number,number];
}
export type SourceFractalSceneClip=
 |{kind:'wait';duration:number}
 |{kind:'target';duration:number;easing:string;target:SourceFractalZoomTarget}
 |{kind:'animate';duration:number;easing:string;targets:SourceFractalAnimationTargets;grouped?:boolean};
export type SourceFractalViewField='centerX'|'centerY'|'centerXLow'|'centerYLow'|'zoom'|'rotation';
export interface SourceFractalUpdatePhase {kind:'active'|'completed';time:number;dt:number;}
export interface SourceFractalSceneFrame {
 frame:number;sceneTime:number;rawDt:number;activeDt:number;queueIndex:number;queueComplete:boolean;
 managerFinishedAtFrameStart:boolean;clipRuntime:number;startedClip:number|null;finishedClip:number|null;paused:boolean;
 object:SourceFractalObjectState;cameraAngles:readonly [number,number,number];cameraRates:readonly [number,number,number];
 objectUpdates:readonly SourceFractalUpdatePhase[];
 /** Fields actually written since construction/reset; held writes retain ownership. */
 writtenViewFields:readonly SourceFractalViewField[];
}
/** The host owns parameter and gradient registries. Starts happen after the
 * ordinary target captures its baseline, and before any child update. The
 * mobject phase calls follow ordinary writes, then parameter and gradient work.
 * A failed hook invalidates this clock; reset reconstructs all owned state. */
export interface SourceFractalSceneHooks {
 reset?():void;
 begin?(clipIndex:number,state:SourceFractalObjectState):void;
 interpolate?(clipIndex:number,runtime:number,duration:number,easing:string,finished:boolean,state:SourceFractalObjectState):void;
 update?(phase:SourceFractalUpdatePhase,state:SourceFractalObjectState):void;
}
const F=Math.fround,names=new Set(SOURCE_EASING_NAMES),copy=<T>(v:T):T=>structuredClone(v);
const finite=(v:unknown,label:string):number=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error(`分形场景 ${label} 必须为有限数值`);return v;};
const float=(v:unknown,label:string)=>{const n=F(finite(v,label));if(!Number.isFinite(n))throw Error(`分形场景 ${label} 超出 Float32`);return n;};
const int=(v:number)=>Math.min(2147483647,Math.max(-2147483648,Math.trunc(v)));
const round=(v:number)=>Number.isNaN(v)?0:int(Math.floor(v+.5));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const lerpF=(a:number,b:number,t:number)=>F(F(a)+F(F(F(b)-F(a))*t));
/** Initial bailout is a stored native field: formula mapping can write below
 * the ordinary setter's floor (Newton/Nova use 1e-12). Do not apply a setter
 * again when adopting an already initialized mobject. */
function state(value:SourceFractalObjectState):SourceFractalObjectState {
 const out=copy(value);for(const key of ['centerX','centerY','centerXLow','centerYLow','zoom','juliaReal','juliaImag'] as const)finite(out[key],key);
 for(const key of ['rotation','rotationRate','bailout','currentTime'] as const)out[key]=float(out[key],key);
 out.iterations=Math.max(1,int(finite(out.iterations,'iterations')));out.zoom=Math.max(1e-6,out.zoom);
 for(const key of ['ambientAngles','ambientRates'] as const){if(!Array.isArray(out[key])||out[key].length!==3)throw Error('分形角度必须包含三个分量');out[key]=out[key].map(n=>float(n,key)) as [number,number,number];}
 [out.centerX,out.centerXLow]=normalizeSourceFractalCenter(out.centerX,out.centerXLow);[out.centerY,out.centerYLow]=normalizeSourceFractalCenter(out.centerY,out.centerYLow);return out;
}
function targets(value:SourceFractalAnimationTargets):SourceFractalAnimationTargets {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('分形动画目标无效');const out=copy(value);
 for(const key of Object.keys(out)){if(!['center','zoom','rotation','rotationRate','ambientRates','iterations','bailout','julia'].includes(key))throw Error('分形动画目标含未知字段');}
 for(const key of ['center','julia','ambientRates'] as const)if(out[key]!==undefined){const n=key==='ambientRates'?3:2;if(!Array.isArray(out[key])||out[key]!.length!==n)throw Error('分形动画目标分量数错误');for(const v of out[key]!)finite(v,key);}
 for(const key of ['zoom','rotation','rotationRate','iterations','bailout'] as const)if(out[key]!==undefined)finite(out[key],key);
 if(out.rotation!==undefined)out.rotation=float(out.rotation,'目标旋转');if(out.rotationRate!==undefined)out.rotationRate=float(out.rotationRate,'目标转速');if(out.bailout!==undefined)out.bailout=float(out.bailout,'目标逃逸值');if(out.iterations!==undefined)out.iterations=int(out.iterations);
 if(out.ambientRates)out.ambientRates=out.ambientRates.map(v=>float(v,'目标角速度')) as [number,number,number];return out;
}
/** Shared Scene/SceneManager arithmetic remains owned by RootsSceneClock, also
 * used by ordinary source scenes. This owner supplies the distinct Fractal
 * subclass order: active object update, camera update using previous rates,
 * publish new camera rates, then a raw-dt object update when the queue is done.
 * It accepts actual dt; fixed replay and wall-clock/recording hosts choose dt. */
export class SourceFractalSceneClock {
 private readonly initial:SourceFractalObjectState;private readonly clips:SourceFractalSceneClip[];private clock:RootsSceneClock;
 private object:SourceFractalObjectState;private captured:SourceFractalObjectState;
 private readonly initialCamera:readonly [number,number,number];private cameraAngles:[number,number,number];private cameraRates:[number,number,number]=[0,0,0];private finishedAtStart=false;
 private updates:SourceFractalUpdatePhase[]=[];private failed=false;
 private readonly writtenViewFields=new Set<SourceFractalViewField>();
 constructor(initial:SourceFractalObjectState,clips:readonly SourceFractalSceneClip[],private readonly hooks:SourceFractalSceneHooks={},initialCamera:readonly [number,number,number]=[0,0,0]){
  this.initial=state(initial);if(!Array.isArray(clips)||clips.length>2000)throw Error('分形队列最多 2000 个已编译片段');
  this.clips=clips.map(c=>{
   if(!c||!['wait','target','animate'].includes(c.kind))throw Error('分形队列片段无效');const duration=float(c.duration,'时长');
   if(c.kind==='wait')return{kind:c.kind,duration};if(!names.has(c.easing))throw Error('分形队列缓动无效');
   if(c.kind==='target'){const parsed=parseSourceFractalZoomTarget(c.target);if(!parsed.ok)throw Error(parsed.error.reason);return{kind:c.kind,duration:Math.max(F(1e-4),duration),easing:c.easing,target:parsed.value};}
   if(c.grouped!==undefined&&typeof c.grouped!=='boolean')throw Error('分形动画组标记无效');return{kind:c.kind,duration,easing:c.easing,targets:targets(c.targets),...(c.grouped?{grouped:true}:{})};
  });
  if(!Array.isArray(initialCamera)||initialCamera.length!==3)throw Error('分形相机初始角度无效');this.initialCamera=initialCamera.map(v=>float(v,'相机角度')) as [number,number,number];this.cameraAngles=[...this.initialCamera];
  this.object=copy(this.initial);this.captured=copy(this.initial);this.clock=this.newClock();
 }
 get clipCount():number{return this.clips.length;}
 private newClock(){return new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},this.clips.map(c=>({duration:c.kind==='animate'&&c.grouped?Math.max(0,c.duration):c.duration,easing:'linear'})));}
 reset():void {this.failed=true;this.hooks.reset?.();this.object=copy(this.initial);this.captured=copy(this.initial);this.cameraAngles=[...this.initialCamera];this.cameraRates=[0,0,0];this.finishedAtStart=false;this.updates=[];this.writtenViewFields.clear();this.clock=this.newClock();this.failed=false;}
 private ordinary(c:Extract<SourceFractalSceneClip,{kind:'animate'}>,runtime:number):void {
  const a=this.captured,b=c.targets,p=sourceEase(c.easing,Math.max(0,Math.min(1,F(runtime/c.duration)))),o=this.object;
  if(b.center){o.centerX=lerp(a.centerX+a.centerXLow,b.center[0],p);o.centerY=lerp(a.centerY+a.centerYLow,b.center[1],p);o.centerXLow=0;o.centerYLow=0;for(const field of ['centerX','centerY','centerXLow','centerYLow'] as const)this.writtenViewFields.add(field);}
  if(b.zoom!==undefined){o.zoom=Math.max(1e-6,lerp(a.zoom,b.zoom,p));this.writtenViewFields.add('zoom');}
  if(b.rotation!==undefined){o.rotation=lerpF(a.rotation,b.rotation,p);this.writtenViewFields.add('rotation');}if(b.rotationRate!==undefined)o.rotationRate=lerpF(a.rotationRate,b.rotationRate,p);
  if(b.ambientRates)o.ambientRates=b.ambientRates.map((v,i)=>lerpF(a.ambientRates[i],v,p)) as [number,number,number];
  if(b.iterations!==undefined)o.iterations=Math.max(1,round(lerpF(a.iterations,b.iterations,p)));if(b.bailout!==undefined)o.bailout=Math.max(F(1e-6),lerpF(a.bailout,b.bailout,p));
  if(b.julia){o.juliaReal=lerp(a.juliaReal,b.julia[0],p);o.juliaImag=lerp(a.juliaImag,b.julia[1],p);}
 }
 private updateObject(kind:SourceFractalUpdatePhase['kind'],time:number,dt:number):void {
  const o=this.object;o.currentTime=time;
  if(dt>0){if(o.rotationRate!==0){o.rotation=F(o.rotation+F(o.rotationRate*dt));this.writtenViewFields.add('rotation');}o.ambientAngles=o.ambientAngles.map((v,i)=>F(v+F(o.ambientRates[i]*dt))) as [number,number,number];}
  const phase={kind,time,dt};this.updates.push(phase);this.hooks.update?.(phase,o);
 }
 step(dt:number,paused=false,isCancelled?:()=>boolean):SourceFractalSceneFrame {
  if(this.failed)throw Error('分形场景时钟上次更新失败，必须重置');
  try{
   const before=this.clock.snapshot();this.finishedAtStart=before.queueComplete;this.updates=[];
   const next=this.clock.step(dt,{paused,isCancelled,allowSignedDt:true});
   if(!paused){
    if(!before.queueComplete){
     const index=before.queueIndex,clip=this.clips[index],runtime=F((next.startedClip===null?before.clipRuntime:0)+next.activeDt);
     if(next.startedClip!==null){this.captured=copy(this.object);if(clip.kind==='animate')this.hooks.begin?.(index,this.object);}
     if(clip.kind==='target'){const out=evaluateSourceFractalZoom(this.captured,clip.target,clip.easing,F(runtime/clip.duration));if(!out.ok)throw Error(out.error.reason);Object.assign(this.object,out.value);for(const field of ['centerX','centerY','centerXLow','centerYLow','zoom'] as const)this.writtenViewFields.add(field);}
     else if(clip.kind==='animate'){this.ordinary(clip,runtime);this.hooks.interpolate?.(index,runtime,clip.duration,clip.easing,next.finishedClip!==null,this.object);}
     this.updateObject('active',next.sceneTime,next.activeDt);
    }
    if(next.rawDt>0)this.cameraAngles=this.cameraAngles.map((v,i)=>F(v+F(this.cameraRates[i]*next.rawDt))) as [number,number,number];
    this.cameraRates=[...this.object.ambientRates];
    if(next.queueComplete)this.updateObject('completed',next.sceneTime,next.rawDt);
   }
   for(const [k,v] of Object.entries(this.object))if(Array.isArray(v))v.forEach(n=>finite(n,k));else finite(v,k);
   this.cameraAngles.forEach(v=>finite(v,'相机角度'));if(isCancelled?.())throw new DOMException('分形场景回放已取消','AbortError');return this.snapshot(next);
  }catch(error){this.failed=true;throw error;}
 }
 snapshot(facts:RootsSceneFrame=this.clock.snapshot()):SourceFractalSceneFrame {
  if(this.failed)throw Error('分形场景时钟上次更新失败，必须重置');
  return{frame:facts.frame,sceneTime:facts.sceneTime,rawDt:facts.rawDt,activeDt:facts.activeDt,queueIndex:facts.queueIndex,queueComplete:facts.queueComplete,managerFinishedAtFrameStart:this.finishedAtStart,clipRuntime:facts.clipRuntime,startedClip:facts.startedClip,finishedClip:facts.finishedClip,paused:facts.paused,object:copy(this.object),cameraAngles:[...this.cameraAngles],cameraRates:[...this.cameraRates],objectUpdates:copy(this.updates),writtenViewFields:[...this.writtenViewFields]};
 }
}
