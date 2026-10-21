import {sourceGradientFrame,sourceGradientWrap as wrap} from './sourceGradientRuntime';
import {SOURCE_EASING_NAMES,sourceEase} from './sourceEasing';
import {parseRootsGradientConfiguration,RootsGradientConfigurationError} from './rootsGradientConfig';
import type {RootsGradientConfiguration} from './rootsGradientConfig';

export interface RootsSceneClip {
  readonly duration:number;
  /** Verified InstantAction: zero duration, no interpolated children. The
   * queue still consumes one update; this is not a general zero-duration tween. */
  readonly instant?:true;
  /** Source leaf whose start decides it is already complete (e.g. a same-mode
   * surface transition). Its declared duration still contributes to Scene's
   * remaining-time fold before that first update, unlike a zero-time instant. */
  readonly finishOnStart?:true;
  /** Canonical name, already resolved by the importing/authoring owner. */
  readonly easing:string;
  readonly zoom?:number;
  readonly rates?:readonly [number,number,number];
  readonly gradientActions?:readonly RootsSceneGradientAction[];
}
export interface RootsCameraState {
  readonly phi:number;readonly theta:number;readonly gamma:number;readonly zoom:number;
}
export type RootsSceneGradientAction={readonly kind:'start';readonly config:RootsGradientConfiguration}|{readonly kind:'stop'};
export interface RootsGradientPhase {
  readonly kind:'active'|'raw';readonly dt:number;readonly applied:boolean;
  readonly progressBefore:number;readonly progressAfter:number;
  readonly offsetBefore:number;readonly offsetAfter:number;
}
export interface RootsSceneGradientFrame {
  readonly running:boolean;readonly progress:number;readonly speedScale:number;
  readonly targetSpeed:number;readonly offset:number;readonly config?:RootsGradientConfiguration;
  /** Calls of Roots.update, including stopped or dt=0 calls, in source order. */
  readonly updates:number;readonly phases:readonly RootsGradientPhase[];
}
export interface RootsSceneFrame {
  readonly camera:RootsCameraState;
  readonly rates:readonly [number,number,number];
  readonly frame:number;readonly rawDt:number;readonly activeDt:number;readonly sceneTime:number;
  readonly queueIndex:number;readonly queueComplete:boolean;readonly clipRuntime:number;
  readonly paused:boolean;readonly startedClip:number|null;readonly finishedClip:number|null;
  readonly managerFinishedAtFrameStart?:boolean;readonly gradient?:RootsSceneGradientFrame;
}
export type RootsSceneClockErrorCode='input'|'capacity'|'arithmetic'|'cancelled';
export class RootsSceneClockError extends Error {
  constructor(readonly code:RootsSceneClockErrorCode,message:string) {
    super(message);this.name=code==='cancelled'?'AbortError':'RootsSceneClockError';
  }
}

// The saved timeline admits 1000 authored clips; compilation can insert one
// leading wait per clip. This bounds retained inputs and each remaining-time
// fold. The clock retains no growing frame history or per-frame clip copies.
export const ROOTS_SCENE_MAX_CLIPS=2000;
// Same aggregate action admission as the authored timeline, before copying any
// configurations. Current-child state is bounded by this, not by frame count.
export const ROOTS_SCENE_MAX_GRADIENT_ACTIONS=4096;
const F=Math.fround,names=new Set(SOURCE_EASING_NAMES);
const finiteFloat=(value:number,label:string):number=>{
  if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))
    throw new RootsSceneClockError('input',`Roots 相机 ${label} 必须为有限 Float32 数值`);
  return F(value);
};
const finiteResult=(value:number,label:string):number=>{
  if(!Number.isFinite(value))throw new RootsSceneClockError('arithmetic',`Roots 相机 ${label} 浮点运算产生非有限值`);
  return value;
};
const cancelled=(check?:()=>boolean)=>{
  if(check?.())throw new RootsSceneClockError('cancelled','Roots 相机帧更新已取消');
};
const lerp=(start:number,target:number,t:number)=>F(start+F(F(target-start)*t));
const constrain=(value:number)=>value<0?0:value>1?1:value;
type Triple=[number,number,number];
interface GradientState {
  running:boolean;progress:number;speedScale:number;targetSpeed:number;offset:number;
  base:number;config?:RootsGradientConfiguration;phases:RootsGradientPhase[];
}
interface GradientChildState {finished:boolean;startScale:number}
interface State {
  camera:{phi:number;theta:number;gamma:number;zoom:number};rates:Triple;
  frame:number;rawDt:number;activeDt:number;sceneTime:number;queueIndex:number;
  current:boolean;runtime:number;startZoom:number;startRates:Triple;paused:boolean;
  startedClip?:number;finishedClip?:number;
  gradient?:GradientState;gradientChildren:GradientChildState[];managerFinishedAtFrameStart?:boolean;
}
function fresh(camera:RootsCameraState,initialOffset?:number,emptyQueue=false):State {
  return{camera:{...camera},rates:[0,0,0],frame:0,rawDt:0,activeDt:0,sceneTime:0,queueIndex:0,
    current:false,runtime:0,startZoom:camera.zoom,startRates:[0,0,0],paused:false,gradientChildren:[],
    ...(initialOffset===undefined?{}:{managerFinishedAtFrameStart:emptyQueue,
      gradient:{running:false,progress:0,speedScale:0,targetSpeed:0,offset:initialOffset,base:initialOffset,phases:[]}})};
}
function copy(state:State):State {
  return{...state,camera:{...state.camera},rates:[...state.rates],startRates:[...state.startRates],
    gradientChildren:state.gradientChildren.map(child=>({...child})),
    ...(state.gradient?{gradient:{...state.gradient,phases:[]}}:{})};
}

// Common double frame arithmetic; Roots owns its F32 target mapping and
// active/raw update phases, separately from Surface's per-application smoothing.
function applyGradientFrame(gradient:GradientState):void {
  const config=gradient.config!;
  const {palette,inside,outside}=sourceGradientFrame(gradient.base,config,gradient.progress);
  // ComplexRootsMobject.applyGradientFrame performs both d2f conversions,
  // then fadd/fmul. Nonfinite candidates are ignored, not a clock failure.
  const candidate=config.mode==='offset_cycle'||config.mode==='cross_fade'?F(.5*F(F(inside)+F(outside))):F(palette);
  // Java float equality deliberately preserves the previous sign of zero.
  if(Number.isFinite(candidate)&&candidate!==gradient.offset)gradient.offset=candidate;
}
function setGradientScale(gradient:GradientState,value:number):void {
  gradient.speedScale=value<0?0:value; // onFinish may replace transient NaN before progress advances.
  if(gradient.running)applyGradientFrame(gradient);
}
function startGradientChildren(state:State,actions:readonly RootsSceneGradientAction[],check?:()=>boolean):void {
  const gradient=state.gradient!;
  state.gradientChildren=actions.map((action,index)=>{
    if((index&63)===0)cancelled(check);
    if(action.kind==='stop')return{finished:!gradient.running,startScale:gradient.speedScale};
    // All three source offset getters return the same current F32 target.
    gradient.base=gradient.offset;gradient.config=action.config;
    gradient.running=true;gradient.progress=0;gradient.speedScale=0;gradient.targetSpeed=action.config.speed;
    applyGradientFrame(gradient);setGradientScale(gradient,0);
    return{finished:false,startScale:0};
  });
}
function updateGradientChildren(state:State,actions:readonly RootsSceneGradientAction[],eased:number,finish:boolean,check?:()=>boolean):void {
  const gradient=state.gradient!;
  for(let i=0;i<actions.length;i++){
    if((i&63)===0)cancelled(check);
    const action=actions[i],child=state.gradientChildren[i];
    if(child.finished)continue;
    setGradientScale(gradient,action.kind==='start'?eased:child.startScale*(1-eased));
    if(finish){
      if(action.kind==='start')setGradientScale(gradient,1);
      else{setGradientScale(gradient,0);gradient.running=false;gradient.targetSpeed=0;gradient.speedScale=0;}
      child.finished=true;
    }
  }
}
function advanceGradient(gradient:GradientState,kind:RootsGradientPhase['kind'],dt:number):void {
  const progressBefore=gradient.progress,offsetBefore=gradient.offset,applied=gradient.running;
  if(gradient.running){
    if(dt>0){
      // Preserve currentSpeed, multiply dt, divide 360, add, then remainder.
      const progress=gradient.progress+((gradient.targetSpeed*gradient.speedScale)*dt)/360;
      gradient.progress=wrap(finiteResult(progress,'渐变进度'));
    }
    applyGradientFrame(gradient);
  }
  gradient.phases.push({kind,dt,applied,progressBefore,progressAfter:gradient.progress,offsetBefore,offsetAfter:gradient.offset});
}

/** Single source Scene -> group -> Roots update -> camera -> Roots update clock.
 * No gradient option means exactly the prior camera-only frame contract. The
 * two active/raw gradient calls retain separate wrapping and target writes;
 * no continuous-seconds helper or merged dt is used. The caller owns frame
 * selection and actual point arrivals. Initial offset is a local extension
 * (native construction uses 0F), not a claimed native JSON property.
 *
 * Failed/cancelled steps are transactional. Nonfinite state arithmetic is a
 * local explicit boundary; target float overflow instead retains its prior
 * value as in the source. JS/Java libm last-bit equality is not asserted.
 */
export class RootsSceneClock {
  private readonly initial:RootsCameraState;
  private readonly clips:readonly RootsSceneClip[];
  private state:State;
  private readonly initialOffset?:number;
  readonly gradientActionCount:number;

  constructor(initial:RootsCameraState,clips:readonly RootsSceneClip[],options:{gradient?:{initialOffset:number}}={}) {
    if(!initial||typeof initial!=='object')throw new RootsSceneClockError('input','Roots 相机初始状态无效');
    this.initial={phi:finiteFloat(initial.phi,'phi'),theta:finiteFloat(initial.theta,'theta'),gamma:finiteFloat(initial.gamma,'gamma'),zoom:finiteFloat(initial.zoom,'zoom')};
    if(!Array.isArray(clips))throw new RootsSceneClockError('input','Roots 相机队列必须为数组');
    if(clips.length>ROOTS_SCENE_MAX_CLIPS)throw new RootsSceneClockError('capacity','Roots 相机队列超过 2000 个已编译片段容量');
    if(!options||typeof options!=='object')throw new RootsSceneClockError('input','Roots 场景时钟选项无效');
    if(options.gradient!==undefined){
      if(!options.gradient||typeof options.gradient!=='object')throw new RootsSceneClockError('input','Roots 渐变初始状态无效');
      this.initialOffset=finiteFloat(options.gradient.initialOffset,'初始渐变偏移');
    }
    let actionCount=0;
    for(const clip of this.initialOffset===undefined?[]:clips){
      if(clip?.gradientActions!==undefined){
        if(!Array.isArray(clip.gradientActions))throw new RootsSceneClockError('input','Roots 渐变动作必须为数组');
        actionCount+=clip.gradientActions.length;
        if(actionCount>ROOTS_SCENE_MAX_GRADIENT_ACTIONS)throw new RootsSceneClockError('capacity','Roots 渐变队列超过 4096 个动作容量');
      }
    }
    this.gradientActionCount=actionCount;
    this.clips=clips.map((clip:RootsSceneClip,index)=>{
      if(!clip||typeof clip!=='object')throw new RootsSceneClockError('input',`Roots 相机片段 ${index} 无效`);
      const duration=finiteFloat(clip.duration,`片段 ${index} 时长`);
      // Roots JSON clamps to .001F at import. Generic Animation retains signed
      // zero and negative durations; explicit InstantAction ignores interpolation.
      if(clip.instant!==undefined&&clip.instant!==true)throw new RootsSceneClockError('input','即时片段标记无效');
      if(clip.finishOnStart!==undefined&&clip.finishOnStart!==true)throw new RootsSceneClockError('input','开始即完成标记无效');
      if(clip.finishOnStart&&(clip.instant||clip.zoom!==undefined||clip.rates!==undefined||clip.gradientActions?.length))throw new RootsSceneClockError('input','开始即完成片段不能含其它插值子项');
      if(clip.instant&&(duration!==0||clip.zoom!==undefined||clip.rates!==undefined||clip.gradientActions?.length))throw new RootsSceneClockError('input','即时片段必须零时长且没有插值子项');
      if(!names.has(clip.easing))throw new RootsSceneClockError('input',`Roots 相机片段缓动未知：${String(clip.easing)}`);
      if(clip.rates!==undefined&&(!Array.isArray(clip.rates)||clip.rates.length!==3))
        throw new RootsSceneClockError('input','Roots 相机角速度必须为三个数值');
      const gradientActions=this.initialOffset===undefined?undefined:clip.gradientActions?.map((action):RootsSceneGradientAction=>{
        if(!action||typeof action!=='object'||(action.kind!=='start'&&action.kind!=='stop'))
          throw new RootsSceneClockError('input','Roots 渐变动作类型无效');
        if(action.kind==='stop')return Object.freeze({kind:'stop'});
        try{return Object.freeze({kind:'start',config:Object.freeze(parseRootsGradientConfiguration(action.config))});}
        catch(error){if(error instanceof RootsGradientConfigurationError)throw new RootsSceneClockError(error.code,error.message);throw error;}
      });
      return{duration,easing:clip.easing,...(clip.instant?{instant:true as const}:{}),
        ...(clip.finishOnStart?{finishOnStart:true as const}:{}),
        ...(gradientActions===undefined?{}:{gradientActions:Object.freeze(gradientActions)}),
        ...(clip.zoom===undefined?{}:{zoom:finiteFloat(clip.zoom,'目标 zoom')}),
        ...(clip.rates===undefined?{}:{rates:clip.rates.map((value:number,i:number)=>finiteFloat(value,`目标角速度 ${i}`)) as Triple})};
    });
    this.state=fresh(this.initial,this.initialOffset,this.clips.length===0);
  }

  snapshot():RootsSceneFrame {
    const state=this.state;
    return Object.freeze({camera:Object.freeze({...state.camera}),rates:Object.freeze([...state.rates]) as readonly [number,number,number],
      frame:state.frame,rawDt:state.rawDt,activeDt:state.activeDt,sceneTime:state.sceneTime,
      queueIndex:state.queueIndex,queueComplete:state.queueIndex>=this.clips.length,clipRuntime:state.runtime,paused:state.paused,
      startedClip:state.startedClip??null,finishedClip:state.finishedClip??null,
      ...(state.gradient?{managerFinishedAtFrameStart:state.managerFinishedAtFrameStart,
        gradient:Object.freeze({running:state.gradient.running,progress:state.gradient.progress,speedScale:state.gradient.speedScale,
          targetSpeed:state.gradient.targetSpeed,offset:state.gradient.offset,...(state.gradient.config?{config:state.gradient.config}:{}),
          updates:state.gradient.phases.length,phases:Object.freeze(state.gradient.phases.map(phase=>Object.freeze({...phase})))})}:{})});
  }

  /** CameraController.zoom is also writable between queue updates. Keep the
   * active Zoom animation's captured start and destination intact. */
  writeZoom(zoom:number):void {this.state.camera.zoom=finiteFloat(zoom,'热 zoom');}
  reset():void {this.state=fresh(this.initial,this.initialOffset,this.clips.length===0);}

  step(rawDt:number,options:{paused?:boolean;isCancelled?:()=>boolean;allowSignedDt?:boolean}={}):RootsSceneFrame {
    cancelled(options.isCancelled);
    const dt=finiteFloat(rawDt,'帧间隔');
    if(options.allowSignedDt!==undefined&&typeof options.allowSignedDt!=='boolean')throw new RootsSceneClockError('input','源时钟有符号间隔选项无效');
    if(dt<0&&!options.allowSignedDt)throw new RootsSceneClockError('input','Roots 相机帧间隔不能为负');
    if(options.paused!==undefined&&typeof options.paused!=='boolean')throw new RootsSceneClockError('input','Roots 相机暂停状态必须为布尔值');
    if(this.state.frame>=Number.MAX_SAFE_INTEGER)throw new RootsSceneClockError('capacity','Roots 相机帧序号超过安全整数容量');
    const next=copy(this.state);
    next.frame++;delete next.startedClip;delete next.finishedClip;
    next.paused=options.paused===true;
    next.rawDt=next.paused?0:dt;next.activeDt=0;
    if(next.gradient)next.managerFinishedAtFrameStart=next.queueIndex>=this.clips.length;
    if(!next.paused){
      if(next.queueIndex<this.clips.length){
        // Source getRemainingDuration performs this left fold on every frame.
        // A cached suffix sum changes rounding and therefore activeDt.
        let remaining=next.current?Math.max(0,F(this.clips[next.queueIndex].duration-next.runtime)):0;
        for(let i=next.queueIndex+(next.current?1:0);i<this.clips.length;i++){
          if((i&63)===0)cancelled(options.isCancelled);
          remaining=finiteResult(F(remaining+Math.max(0,this.clips[i].duration)),'队列剩余时间');
        }
        next.activeDt=remaining>0?Math.min(dt,remaining):0;
        next.sceneTime=finiteResult(F(next.sceneTime+next.activeDt),'场景时间');
        const clip=this.clips[next.queueIndex];
        if(!next.current){
          // AnimationGroup starts all children before updating any child.
          next.current=true;next.runtime=0;next.startZoom=next.camera.zoom;next.startRates=[...next.rates];
          next.startedClip=next.queueIndex;
          if(next.gradient)startGradientChildren(next,clip.gradientActions??[],options.isCancelled);
        }
        if(!clip.finishOnStart)next.runtime=finiteResult(F(next.runtime+next.activeDt),'动画时间');
        if(clip.zoom!==undefined||clip.rates!==undefined){
          const eased=sourceEase(clip.easing,constrain(F(next.runtime/clip.duration)));
          if(clip.zoom!==undefined)next.camera.zoom=lerp(next.startZoom,clip.zoom,eased);
          if(clip.rates!==undefined)next.rates=clip.rates.map((target,i)=>lerp(next.startRates[i],target,eased)) as Triple;
        }
        // Camera child completes before any gradient child is updated.
        // SetAmbientRotation snaps rates; ZoomCamera has no onFinish override.
        if(next.runtime>=clip.duration&&clip.rates!==undefined)next.rates=[...clip.rates];
        if(next.gradient&&clip.gradientActions?.length){
          const eased=sourceEase(clip.easing,constrain(F(next.runtime/clip.duration)));
          updateGradientChildren(next,clip.gradientActions,eased,next.runtime>=clip.duration,options.isCancelled);
        }
        if(clip.finishOnStart||next.runtime>=clip.duration){
          next.finishedClip=next.queueIndex;next.queueIndex++;next.current=false;next.runtime=0;next.gradientChildren=[];
        }
      }else{
        next.activeDt=dt;next.sceneTime=finiteResult(F(next.sceneTime+dt),'场景时间');
      }
      if(next.gradient&&!next.managerFinishedAtFrameStart)advanceGradient(next.gradient,'active',next.activeDt);
      for(const value of next.rates)finiteResult(value,'角速度');
      finiteResult(next.camera.zoom,'zoom');
      // CameraController.update returns for dt <= 0 (including signed zero).
      if(dt>0){
        next.camera.phi=finiteResult(F(next.camera.phi+F(next.rates[0]*dt)),'phi');
        next.camera.theta=finiteResult(F(next.camera.theta+F(next.rates[1]*dt)),'theta');
        next.camera.gamma=finiteResult(F(next.camera.gamma+F(next.rates[2]*dt)),'gamma');
      }
    }
    if(next.gradient)advanceGradient(next.gradient,'raw',next.rawDt);
    cancelled(options.isCancelled);
    this.state=next;
    return this.snapshot();
  }
}
