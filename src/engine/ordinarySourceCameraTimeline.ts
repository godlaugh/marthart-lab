import {normalizeSourceSamilaParameterAction,type SourceSamilaParameterAction} from './sourceSamilaParameter';
import {sourceSurfaceFadeRatio,sourceSurfaceTransitionFrame,type SourceSurfaceMode} from './sourceSurfaceTransition';
import {parseSourceSurfaceParameterActions,parseSourceSurfaceParameterClip} from './sourceSurfaceParameterConfig';
import {parseSourcePerlinParameterAction,SourcePerlinParameterFailure,type SourcePerlinParameterAction} from './sourcePerlinParameterConfig';
import type {SourceSurfaceParameterAction,SourceSurfaceParameterConfiguration} from './sourceSurfaceParameterRuntime';
import {parseSourceParticleGradientConfiguration} from './sourceParticleGradientConfig';
import type {SourceGradientAction} from './sourceGradientRuntime';
import type {AnimationAction,AnimationTrack} from '../types';
import {resolveSourceCamera,SOURCE_CAMERA_MODEL,type SourceCameraScalars,type SourceCameraVec3} from './sourceCamera';
import {RootsSceneClock,type RootsSceneClip,type RootsSceneFrame} from './rootsSceneClock';
import {sourceEase,SOURCE_EASING_NAMES} from './sourceEasing';
import {validateTimelineCapacity} from './timelineCapacity';

/** Explicit source sequence only. Local orbit timelines must not use this owner.
 * The Roots clock already owns the identical retained Scene/SceneManager/
 * Animation queue arithmetic. Its scalar angles are not used here: ordinary
 * MoveCamera writes components before CameraController adds ambient rotation.
 */
export const ORDINARY_CAMERA_SEQUENCE='ordinary-camera-sequence-v1' as const;
export class OrdinarySourceCameraTimelineError extends Error {
 constructor(readonly code:'input'|'unsupported'|'capacity'|'cancelled'|'arithmetic',message:string,readonly trackId?:string){super(message);this.name=code==='cancelled'?'AbortError':'OrdinarySourceCameraTimelineError';}
}
export interface OrdinaryCameraDiagnostic {readonly code:'sequence-start'|'sequence-repeat'|'action-enabled'|'noncamera-clock'|'tracking-target-ignored';readonly trackId:string;readonly message:string;}
export interface OrdinaryCameraTargetRequest {
 readonly action:AnimationAction;readonly trackId:string;readonly actionIndex:number;
}
export type OrdinaryCameraTargetBinding=
 /** Capture the actual producer object, not an index to resolve on every read.
  * A producer may intentionally return the same target for multiple actions. */
 | {readonly kind:'bound';readonly readPosition:()=>SourceCameraVec3}
 /** Only a confirmed source no-op (e.g. Attractor's out-of-range slot). Missing
  * producer facts must throw, never silently become an ignored action. */
 | {readonly kind:'ignored';readonly reason:string};
export interface OrdinaryCameraParticleFrame {
 readonly frameIndex:number;readonly time:number;readonly deltaTime:number;
}
export interface OrdinarySourceCameraParticles {
 /** Called once for EVERY track action, in build order, before playback. Even
  * subsequently overwritten actions can mutate a shared tracked-dot selector. */
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding;
 /** Complete eagerly captured bindings before any animation/read/update. */
 finishBindings?():void;
 /** One Mobject.update(time, activeDt) between animation and camera reads.
  * Includes waits and frames with no target reads; stops when the queue was
  * already complete at frame start. This is not CameraController's raw dt. */
 update(frame:OrdinaryCameraParticleFrame):void;
 /** Scene.display follows camera update on every rendered frame, including
  * completed queues. Mesh seam/cache initialization belongs to this event. */
 displayFrame?(frameIndex:number,final:boolean):void;
 switchMode?(mode:SourceSurfaceMode):void;
 /** Surface InstantAction executes before this frame's Mobject update. It
  * changes recording only; history lifetime/display remain producer-owned. */
 setRecordingTrails?(enabled:boolean):void;
 /** Perlin InstantAction calls setShowTrails: both drawing existing trails and
  * recording new trail points follow this value. Accumulation is separate. */
 setShowTrails?(enabled:boolean):void;
 beginSamilaParameterActions?(actions:readonly SourceSamilaParameterAction[],duration:number,easing:string):void;
 advanceSamilaParameterActions?(dt:number):void;
 beginPerlinParameterActions?(actions:readonly SourcePerlinParameterAction[]):void;
 interpolatePerlinParameterActions?(eased:number,finished:boolean,dt:number):void;
 beginGradientActions?(actions:readonly SourceGradientAction[]):void;
 interpolateGradientActions?(eased:number,finished:boolean):void;
 beginParameterActions?(actions:readonly SourceSurfaceParameterAction[]):void;
 interpolateParameterActions?(eased:number,finished:boolean):void;
 beginParameterClip?(parameters:readonly ({name:string}&SourceSurfaceParameterConfiguration)[]):void;
 finishParameterClip?():void;
}
export interface OrdinarySourceCameraTimelineOptions {
 readonly isCancelled?:()=>boolean;
 /** Explicit producer contract; other scene gradients keep their own clocks. */
 readonly particleActions?:'surface'|'attractor'|'perlin'|'samila';
 /** Initial main-object mode, required for exact transition/skip scheduling. */
 readonly surfaceMode?:SourceSurfaceMode;
 /** Fresh, synchronous, in-memory producer state per replay. No scalar cache
  * may borrow its identity or history. CPU/GPU trajectory ownership belongs to
  * the producer; local orbit samplers are not native particle implementations. */
 readonly createParticles?:()=>OrdinarySourceCameraParticles;
}
export interface OrdinarySourceCameraFrame {
 readonly time:number;readonly camera:SourceCameraScalars;readonly frameIndex:number;
 readonly sceneTime:number;readonly queueIndex:number;readonly queueComplete:boolean;
 readonly activeDt:number;readonly rawDt:number;readonly rates:readonly [number,number,number];
 readonly diagnostics:readonly OrdinaryCameraDiagnostic[];
 readonly surfaceTransition?:{readonly mode:SourceSurfaceMode;readonly overlayAlpha:number};
}
type Axis='phi'|'theta'|'gamma';
type Targets=Partial<Record<Axis,number>>;
type Tracking={readonly kind:'origin'}|Extract<OrdinaryCameraTargetBinding,{kind:'bound'}>;
type TrackingAction={readonly kind:'origin'}|{readonly kind:'bind';readonly request:OrdinaryCameraTargetRequest};
interface Clip extends RootsSceneClip {readonly samilaParameterActions?:readonly SourceSamilaParameterAction[];readonly samilaParameterDuration?:number;readonly surfaceTransition?:{to:SourceSurfaceMode;fadeRatio:number};readonly trackId:string;readonly targets?:Targets;readonly align?:Targets;readonly focal?:number;readonly trackingActions?:readonly TrackingAction[];readonly trailAction?:{readonly kind:'record'|'show';readonly enabled:boolean};readonly gradientActions?:readonly SourceGradientAction[];readonly surfaceParameterActions?:readonly SourceSurfaceParameterAction[];readonly perlinParameterActions?:readonly SourcePerlinParameterAction[];readonly surfaceParameterClip?:readonly ({name:string}&SourceSurfaceParameterConfiguration)[];}
interface Plan {initial:SourceCameraScalars;clips:Clip[];diagnostics:OrdinaryCameraDiagnostic[];fps:number;dt:number;}
const F=Math.fround,axes=['phi','theta','gamma'] as const,TAU=F(2*Math.PI),names=new Set(SOURCE_EASING_NAMES);
const WORK_LIMIT=2_000_000; // Bounded synchronous frames plus remaining-queue folds, as the existing source clock.
const float=(v:unknown,label:string):number=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(F(v)))throw new OrdinarySourceCameraTimelineError('input',`${label} 必须为有限 Float32 数值`);return F(v);};
const finite=(v:number):number=>{if(!Number.isFinite(v))throw new OrdinarySourceCameraTimelineError('arithmetic','源相机运算产生非有限值');return v;};
// A zero-duration child can write transient NaN before onFinish restores its
// target (tracking/rates). Validate the final frame after those callbacks.
const lerp=(a:number,b:number,t:number)=>F(a+F(F(b-a)*t));
const check=(options:OrdinarySourceCameraTimelineOptions)=>{if(options.isCancelled?.())throw new OrdinarySourceCameraTimelineError('cancelled','源相机回放已取消');};
const noncameraMethods=new Set(['paramStart','paramStop','gradientStart','gradientStop']);
function prepare(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],fps:number,particleActions?:'surface'|'attractor'|'perlin'|'samila',initialSurfaceMode?:SourceSurfaceMode):Plan {
 if(initialSurfaceMode!==undefined&&(particleActions!=='surface'||!['points','mesh'].includes(initialSurfaceMode)))throw new OrdinarySourceCameraTimelineError('input','源曲面初始模式需要曲面动作合同');
 let surfaceMode=initialSurfaceMode;
 if(!initial||typeof initial!=='object'||['phi','theta','gamma','center','zoom','focalDistance'].some(key=>!Object.hasOwn(initial,key)))throw new OrdinarySourceCameraTimelineError('input','源相机初始标量必须完整');
 const validated=resolveSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'},frame:initial});
 if(!validated.ok||validated.value.kind!=='known')throw new OrdinarySourceCameraTimelineError('input','源相机初始标量无效');
 if(typeof fps!=='number'||!Number.isFinite(fps)||fps<1||fps>120)throw new OrdinarySourceCameraTimelineError('input','源相机帧率必须在 1–120');
 if(!Array.isArray(tracks)||tracks.length>1000||tracks.some(t=>!t||typeof t!=='object'||Array.isArray(t)))throw new OrdinarySourceCameraTimelineError('capacity','源相机时间线要求最多 1000 个片段');
 for(const track of tracks)if(track.actions!==undefined&&(!Array.isArray(track.actions)||track.actions.some((a:unknown)=>!a||typeof a!=='object')))throw new OrdinarySourceCameraTimelineError('input','源相机动作列表无效',track.id);
 validateTimelineCapacity(tracks);
 const base=validated.value.state.value,clips:Clip[]=[],diagnostics:OrdinaryCameraDiagnostic[]=[];
 const warn=(track:AnimationTrack,code:OrdinaryCameraDiagnostic['code'],message:string)=>diagnostics.push({trackId:track.id,code,message});
 for(const track of tracks){
  if(!track.enabled)continue;
  if(particleActions==='samila'&&!['wait','animate'].includes(track.type??'numeric'))throw new OrdinarySourceCameraTimelineError('unsupported','源 Samila 规范队列仅支持等待与动作组',track.id);
  const instant=track.type==='trails',duration=float(track.duration,'源片段时长');
  // Generic Animation keeps zero duration. Its queue consumes one update,
  // using the full remaining-queue dt; 0/0 is retained through child finish.
  if(instant&&(duration!==0||typeof track.trailsEnabled!=='boolean'))throw new OrdinarySourceCameraTimelineError('input','源拖尾片段必须为零时长并指定录制开关',track.id);
  if(duration>86400)throw new OrdinarySourceCameraTimelineError('capacity','源片段时长超过 24 小时',track.id);
  if(!names.has(track.easing))throw new OrdinarySourceCameraTimelineError('input',`未知源缓动 ${track.easing}`,track.id);
  if(track.start!==0)warn(track,'sequence-start','源队列按保存顺序执行；绝对 start 不参与执行，延迟必须由等待片段表达。');
  if(track.pingPong||(track.repeat??1)!==1)warn(track,'sequence-repeat','源队列不执行 repeat/pingPong；作者输入保留。');
  const clip:{-readonly[K in keyof Clip]:Clip[K]}={duration,easing:track.easing,trackId:track.id};
  if(instant){clip.instant=true;clip.trailAction={kind:particleActions==='perlin'?'show':'record',enabled:track.trailsEnabled!};}
  else if(track.type==='surface_mode_transition'&&surfaceMode!==undefined){
   if(track.surfaceMode!=='points'&&track.surfaceMode!=='mesh')throw new OrdinarySourceCameraTimelineError('input','源曲面过渡目标缺失或无效',track.id);
   clip.duration=Math.max(F(.0001),duration);
   clip.surfaceTransition={to:track.surfaceMode,fadeRatio:sourceSurfaceFadeRatio(track.surfaceFadeOutRatio??.5)};
   if(surfaceMode===track.surfaceMode)clip.finishOnStart=true;surfaceMode=track.surfaceMode;
  }
  else if(track.type==='align'){
   if(track.alignMode==='absolute')throw new OrdinarySourceCameraTimelineError('unsupported','源 AlignCamera 使用下一圈对齐，不支持本地 absolute 对齐',track.id);
   const targets:Targets={};for(const axis of axes)if(track.orientation?.[axis]!==undefined)targets[axis]=float(track.orientation[axis],`align ${axis}`);clip.align=targets;
  }else if(track.type==='animate'){
   if(track.actions!==undefined&&(!Array.isArray(track.actions)||track.actions.length>64))throw new OrdinarySourceCameraTimelineError('capacity','源相机片段最多 64 个动作',track.id);
   const targets:Targets={},trackingActions:TrackingAction[]=[],gradientActions:SourceGradientAction[]=[],surfaceParameterActions:SourceSurfaceParameterAction[]=[],perlinParameterActions:SourcePerlinParameterAction[]=[],samilaParameterActions:SourceSamilaParameterAction[]=[];
   for(const [actionIndex,action] of (track.actions??[]).entries()){
    if(!action||typeof action!=='object')throw new OrdinarySourceCameraTimelineError('input','源相机动作无效',track.id);
    if(action.samilaParameters!==undefined&&(particleActions!=='samila'||!['paramStart','paramStop'].includes(action.method)))throw new OrdinarySourceCameraTimelineError('input','Samila 参数配置只能由对应源参数动作消费',track.id);
    if(particleActions==='samila'&&!['ambient','stopAmbient','rotatePhi','rotateTheta','rotateGamma','rotateTo','zoom','focal','paramStart','paramStop'].includes(action.method))throw new OrdinarySourceCameraTimelineError('unsupported',`源 Samila 不分派 ${action.method}`,track.id);
    if(action.perlinParameters!==undefined&&(particleActions!=='perlin'||!['paramStart','paramStop'].includes(action.method)))throw new OrdinarySourceCameraTimelineError('input','Perlin 参数配置只能由对应源参数动作消费',track.id);
    if(action.enabled===false)warn(track,'action-enabled','源 CameraAnimator 不读取动作级 enabled；片段开关控制整个片段。');
    if(particleActions==='perlin'&&['track','rotateGamma','rotate'].includes(action.method))throw new OrdinarySourceCameraTimelineError('unsupported',`原版 Perlin 不分派 ${action.method}，不能在规范化队列中执行`,track.id);
    const args=action.args??{},arg=(name:string)=>float(args[name]??0,`${action.method}.${name}`);
    if(['rotatePhi','rotateTheta','rotateGamma'].includes(action.method)){
     const axis=action.method.slice(6).toLowerCase() as Axis;targets[axis]=finite(F(base[axis]+arg('angle')));
    }else if(action.method==='rotateTo'||action.method==='rotate'){
     for(const axis of axes)targets[axis]=action.method==='rotateTo'?arg(axis):finite(F(base[axis]+arg(axis)));
    }else if(action.method==='zoom')clip.zoom=arg('value');
    else if(action.method==='focal')clip.focal=arg('value');
    else if(action.method==='ambient')clip.rates=[arg('phiSpeed'),arg('thetaSpeed'),arg('gammaSpeed')];
    else if(action.method==='stopAmbient')clip.rates=[0,0,0];
    // CameraAnimator.stopTracking builds a transition to a fixed origin vector;
    // it does not freeze the current local orbit center.
    else if(action.method==='stopTracking')trackingActions.push({kind:'origin'});
    else if(action.method==='track')trackingActions.push({kind:'bind',request:{action:structuredClone(action),trackId:track.id,actionIndex}});
    else if(particleActions==='samila'&&(action.method==='paramStart'||action.method==='paramStop')){
     if(action.parameters!==undefined||action.domainParameters!==undefined||action.surfaceParameters!==undefined||action.perlinParameters!==undefined)throw new OrdinarySourceCameraTimelineError('input','Samila 参数动作不能混用其他参数模型',track.id);
     const parsed=normalizeSourceSamilaParameterAction(action.samilaParameters);if(!parsed.ok)throw new OrdinarySourceCameraTimelineError('input',parsed.error.reason,track.id);
     if(parsed.value.kind!==(action.method==='paramStart'?'start':'stop'))throw new OrdinarySourceCameraTimelineError('input','Samila 参数方法不匹配',track.id);
     samilaParameterActions.push(parsed.value);
    }
    else if(particleActions==='surface'&&(action.method==='paramStart'||action.method==='paramStop')){
     if(action.parameters!==undefined||action.domainParameters!==undefined)throw new OrdinarySourceCameraTimelineError('input','曲面源参数动作不能混用其他参数模型',track.id);
     for(const operation of parseSourceSurfaceParameterActions(action.surfaceParameters,action.method))surfaceParameterActions.push({kind:action.method==='paramStart'?'start':'stop',scope:operation.scope,...(operation.configuration?{configuration:operation.configuration}:{})});
    }
    else if(particleActions!==undefined&&action.method==='gradientStart'){
     const config=parseSourceParticleGradientConfiguration(action.gradient);
     // JsonPerlinConfig.setupTimeline PC364–371 retains one last successfully
     // built gradient child. Surface/Attractor retain their ordered children.
     if(particleActions==='perlin')gradientActions.length=0;
     gradientActions.push({kind:'start',config});
    }
    else if(particleActions!==undefined&&action.method==='gradientStop'){if(particleActions==='perlin')gradientActions.length=0;gradientActions.push({kind:'stop'});}
    else if(particleActions==='perlin'&&noncameraMethods.has(action.method)){
     if(action.parameters!==undefined||action.domainParameters!==undefined||action.surfaceParameters!==undefined)throw new OrdinarySourceCameraTimelineError('input','Perlin 源参数动作不能混用其它参数模型',track.id);
     const parsed=parseSourcePerlinParameterAction(action.perlinParameters);if(!parsed.ok)throw new SourcePerlinParameterFailure(parsed.error);
     if(parsed.value.kind!==(action.method==='paramStart'?'start':'stop'))throw new OrdinarySourceCameraTimelineError('input','Perlin 参数动作方法不匹配',track.id);
     perlinParameterActions.push(parsed.value);
    }
    else if(particleActions==='attractor'&&noncameraMethods.has(action.method))throw new OrdinarySourceCameraTimelineError('unsupported','原版 ATTRACTOR 没有参数动画，规范化队列不能包含参数动作',track.id);
    else if(noncameraMethods.has(action.method))warn(track,'noncamera-clock',`${action.method} 仍由独立生产 owner 执行；其 native 参数/渐变帧时钟未在相机合同中验证。`);
    else throw new OrdinarySourceCameraTimelineError('unsupported',`源相机不能解释动作 ${action.method}；需原始编译事实`,track.id);
   }
   if(Object.keys(targets).length)clip.targets=targets;
   if(trackingActions.length)clip.trackingActions=trackingActions;
   if(gradientActions.length)clip.gradientActions=gradientActions;
   if(surfaceParameterActions.length)clip.surfaceParameterActions=surfaceParameterActions;
   if(perlinParameterActions.length)clip.perlinParameterActions=perlinParameterActions;
   if(samilaParameterActions.length){clip.samilaParameterActions=samilaParameterActions;clip.samilaParameterDuration=duration;clip.duration=Math.max(0,duration);}
  }else if(track.type==='param'&&particleActions==='surface'){
   if(track.parameterAnimations!==undefined||track.parameterClock!==undefined||track.replaceParameters!==undefined)throw new OrdinarySourceCameraTimelineError('input','曲面源参数片段不能混用其他参数模型',track.id);
   clip.surfaceParameterClip=parseSourceSurfaceParameterClip(track.surfaceParameterClip).parameters;
  }else if(track.type!=='wait'){
   if(particleActions==='perlin')throw new OrdinarySourceCameraTimelineError('unsupported',`源 Perlin 不支持规范化片段 ${track.type??'numeric'}`,track.id);
   if(particleActions==='attractor')throw new OrdinarySourceCameraTimelineError('unsupported',`源吸引子不支持片段 ${track.type??'numeric'}`,track.id);
   if(track.type==='param'||track.type==='surface_mode_transition')warn(track,'noncamera-clock',`${track.type} 的时长保留为队列占位；非相机效果仍由独立 owner 执行，其 native 帧时钟未验证。`);
   else throw new OrdinarySourceCameraTimelineError('unsupported',`片段 ${track.type??'numeric'} 的原始队列时长未解析，不能假设为本地 duration`,track.id);
  }
  clips.push(clip);
 }
 return{initial:base,clips,diagnostics,fps,dt:F(1/fps)};
}
function targetFrame(time:number,fps:number):number {if(!Number.isFinite(time)||time<0||time>86400)throw new OrdinarySourceCameraTimelineError('input','源相机时间必须在 0–86400 秒');const target=Math.floor(time*fps+1e-9);if(target+1>WORK_LIMIT)throw new OrdinarySourceCameraTimelineError('capacity','源相机超过本地逐帧工作预算');return target;}
function budget(){let used=0;return(index:number,count:number)=>{used+=1+count-index;if(used>WORK_LIMIT)throw new OrdinarySourceCameraTimelineError('capacity','源相机超过本地逐帧与队列折叠工作预算');};}
const copy=(camera:SourceCameraScalars)=>({...camera,center:[...camera.center] as [number,number,number]});
/** Build all relative destinations against initial, then capture each child's
 * runtime start. Time zero is source display frame zero, after one update(dt),
 * matching Scene.draw and the existing retained Roots frame contract. */
interface Replay {
 plan:Plan;clock:RootsSceneClock;facts:RootsSceneFrame;camera:ReturnType<typeof copy>;start:ReturnType<typeof copy>;
 targets:Targets;tracking?:Tracking;frameIndex:number;activeDt:number;rates:[number,number,number];startRates:[number,number,number];
 clipTracking:readonly (Tracking|undefined)[];particles?:OrdinarySourceCameraParticles;
 surfaceMode?:SourceSurfaceMode;overlayAlpha:number;transitionSwitched:boolean;transitionSnapshot?:{camera:ReturnType<typeof copy>;rates:[number,number,number]};
}
function bindTracking(plan:Plan,particles:OrdinarySourceCameraParticles|undefined,options:OrdinarySourceCameraTimelineOptions):(Tracking|undefined)[] {
 return plan.clips.map(clip=>{
  let target:Tracking|undefined;
  for(const action of clip.trackingActions??[]){
   check(options);
   if(action.kind==='origin'){target=action;continue;}
   const binding=particles!.bind(action.request);
   if(binding?.kind==='bound'&&typeof binding.readPosition==='function')target=binding;
   else if(binding?.kind==='ignored'&&typeof binding.reason==='string'&&binding.reason.length>0){
    plan.diagnostics.push({code:'tracking-target-ignored',trackId:clip.trackId,message:binding.reason});
   }else throw new OrdinarySourceCameraTimelineError('input','源跟踪生产者返回了无效的构建期目标',clip.trackId);
  }
  return target;
 });
}
const replays=new Map<string,Replay>();
type Layout={schedule:typeof ORDINARY_CAMERA_SEQUENCE;span:number;updates:number;clips:{trackId:string;start:number;duration:number;sourceDuration:number}[];diagnostics:OrdinaryCameraDiagnostic[]};
const layouts=new Map<string,Layout>();
function inputKey(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],fps:number,particleActions?:'surface'|'attractor'|'perlin'|'samila',surfaceMode?:SourceSurfaceMode):string|undefined {
 const key=JSON.stringify([initial,tracks,fps,particleActions,surfaceMode],(_key,value)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value);
 return key.length<=1_000_000?key:undefined;
}
/** Four latest pure scalar sessions, one state each. Provider-backed particle
 * histories deliberately bypass this cache because their identity/lifetime is
 * external. Negative zero remains part of source scalar cache identity. */
export function clearOrdinarySourceCameraTimelineCache():void {replays.clear();layouts.clear();}
/** Explicit provider lifetime; no global cache may retain a particle owner. */
export class OrdinarySourceCameraTimelineSession {
 private readonly cache=new Map<string,Replay>();
 private readonly initial:SourceCameraScalars;
 private readonly tracks:readonly AnimationTrack[];
 private readonly options:OrdinarySourceCameraTimelineOptions;
 constructor(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],private readonly fps:number,options:OrdinarySourceCameraTimelineOptions){
  this.initial=structuredClone(initial);this.tracks=structuredClone(tracks);this.options={...options};
 }
 evaluate(time:number):OrdinarySourceCameraFrame{try{return evaluateTimeline(this.initial,this.tracks,this.fps,time,this.options,this.cache);}catch(error){this.reset();throw error;}}
 /** Explicit hot angle write; queued destinations and captured child starts
  * remain unchanged, as on CameraController. Only an owned replay is writable. */
 writeTheta(theta:number):void {const value=float(theta,'源相机热 theta');if(!this.cache.size)throw new OrdinarySourceCameraTimelineError('input','源相机热写入需要已初始化队列');for(const replay of this.cache.values())replay.camera.theta=value;}
 reset():void{this.cache.clear();}
}
export function evaluateOrdinarySourceCameraTimeline(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],fps:number,time:number,options:OrdinarySourceCameraTimelineOptions={}):OrdinarySourceCameraFrame {
 return evaluateTimeline(initial,tracks,fps,time,options);
}
function evaluateTimeline(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],fps:number,time:number,options:OrdinarySourceCameraTimelineOptions,ownedCache?:Map<string,Replay>):OrdinarySourceCameraFrame {
 check(options);
 if(typeof fps!=='number'||!Number.isFinite(fps)||fps<1||fps>120)throw new OrdinarySourceCameraTimelineError('input','源相机帧率必须在 1–120');
 const target=targetFrame(time,fps),reserve=budget();
 const key=ownedCache?'owned':options.createParticles?undefined:inputKey(initial,tracks,fps,options.particleActions,options.surfaceMode);
 const replayCache=ownedCache??replays;
 let state=key===undefined?undefined:replayCache.get(key);
 if(state&&state.frameIndex>target){if(key!==undefined)replayCache.delete(key);state=undefined;}
 if(!state){
  const plan=prepare(initial,tracks,fps,options.particleActions,options.surfaceMode);
  if(plan.clips.some(c=>c.trackingActions?.some(a=>a.kind==='bind'))&&!options.createParticles)throw new OrdinarySourceCameraTimelineError('unsupported','track 需要原版粒子生产者；不会回退到本地轨道相机');
  const particles=options.createParticles?.();
  if(options.createParticles&&(!particles||typeof particles.bind!=='function'||typeof particles.update!=='function'))throw new OrdinarySourceCameraTimelineError('input','源跟踪生产者缺少构建或逐帧更新入口');
  if(plan.clips.some(c=>c.trailAction?.kind==='record')&&typeof particles?.setRecordingTrails!=='function')throw new OrdinarySourceCameraTimelineError('unsupported','源拖尾片段需要支持录制开关的粒子生产者');
  if(plan.clips.some(c=>c.trailAction?.kind==='show')&&typeof particles?.setShowTrails!=='function')throw new OrdinarySourceCameraTimelineError('unsupported','源 Perlin 拖尾片段需要支持显示与记录开关的生产者');
  if(plan.clips.some(c=>c.gradientActions?.length)&&(typeof particles?.beginGradientActions!=='function'||typeof particles?.interpolateGradientActions!=='function'))throw new OrdinarySourceCameraTimelineError('unsupported','源粒子渐变需要支持完整生命周期的粒子生产者');
  if(plan.clips.some(c=>c.samilaParameterActions?.length)&&(typeof particles?.beginSamilaParameterActions!=='function'||typeof particles?.advanceSamilaParameterActions!=='function'))throw new OrdinarySourceCameraTimelineError('unsupported','源 Samila 参数需要专属参数生产者');
  if(plan.clips.some(c=>c.perlinParameterActions?.length)&&(typeof particles?.beginPerlinParameterActions!=='function'||typeof particles?.interpolatePerlinParameterActions!=='function'))throw new OrdinarySourceCameraTimelineError('unsupported','源 Perlin 参数需要专属参数生产者');
  if(plan.clips.some(c=>c.surfaceParameterActions?.length)&&(typeof particles?.beginParameterActions!=='function'||typeof particles?.interpolateParameterActions!=='function'))throw new OrdinarySourceCameraTimelineError('unsupported','源曲面参数动作需要支持完整生命周期的粒子生产者');
  if(plan.clips.some(c=>c.surfaceParameterClip)&&(typeof particles?.beginParameterClip!=='function'||typeof particles?.finishParameterClip!=='function'))throw new OrdinarySourceCameraTimelineError('unsupported','源曲面参数片段需要支持替换及停止的粒子生产者');
  if(plan.clips.some(c=>c.surfaceTransition)&&typeof particles?.switchMode!=='function')throw new OrdinarySourceCameraTimelineError('unsupported','曲面切换需要原版主对象宿主');
  const clipTracking=bindTracking(plan,particles,options);
  check(options);particles?.finishBindings?.();check(options);
  // Only queue/zoom belong to the reused clock. Feeding it rates would evolve
  // a hidden angle history without MoveCamera resets and can falsely overflow.
  const clock=new RootsSceneClock(plan.initial,plan.clips.map(({rates:_rates,...clip})=>clip)),camera=copy(plan.initial);
  state={plan,clock,facts:clock.snapshot(),camera,start:copy(camera),targets:{},frameIndex:-1,activeDt:0,rates:[0,0,0],startRates:[0,0,0],clipTracking,particles,surfaceMode:options.surfaceMode,overlayAlpha:0,transitionSwitched:false};
 }
 const replay=state,{plan,clock}=replay;
 const point=(binding:Tracking):[number,number,number]=>{
  const value=binding.kind==='origin'?[0,0,0]:binding.readPosition();
  if(!Array.isArray(value)||value.length!==3)throw new OrdinarySourceCameraTimelineError('input','源跟踪 provider 必须返回三个世界坐标');return value.map((v,i)=>float(v,`tracked[${i}]`)) as [number,number,number];
 };
 try{
  for(let frameIndex=replay.frameIndex+1;frameIndex<=target;frameIndex++){
   check(options);reserve(replay.facts.queueIndex,plan.clips.length);
   const before=replay.facts,index=before.queueIndex,clip=plan.clips[index],tracking=replay.clipTracking[index],camera=replay.camera;
   const facts=replay.facts=clock.step(plan.dt,{isCancelled:options.isCancelled});
   replay.activeDt=before.queueComplete?0:facts.activeDt;
   let particleEased:number|undefined;
   if(clip?.surfaceTransition){
    if(facts.startedClip!==null){replay.transitionSwitched=false;replay.overlayAlpha=0;replay.transitionSnapshot=clip.finishOnStart?undefined:{camera:copy(camera),rates:[...replay.rates]};}
    if(!clip.finishOnStart){
     const runtime=F((facts.startedClip!==null?0:before.clipRuntime)+facts.activeDt);
     const transition=sourceSurfaceTransitionFrame(F(runtime/clip.duration),clip.surfaceTransition.fadeRatio,clip.easing);
     if(transition.switchMode&&!replay.transitionSwitched){
      check(options);replay.particles!.switchMode!(clip.surfaceTransition.to);replay.surfaceMode=clip.surfaceTransition.to;
      const snapshot=replay.transitionSnapshot!;Object.assign(camera,copy(snapshot.camera));replay.rates=[...snapshot.rates];replay.transitionSwitched=true;
     }
     replay.overlayAlpha=transition.overlayAlpha;
    }
    if(facts.finishedClip!==null)replay.overlayAlpha=0;
   }else if(clip?.instant){
    if(facts.startedClip!==null){
     check(options);const action=clip.trailAction!;
     if(action.kind==='show')replay.particles!.setShowTrails!(action.enabled);else replay.particles!.setRecordingTrails!(action.enabled);
    }
   }else if(clip){
    if(facts.startedClip!==null){
     if(options.particleActions){
      // All starts precede child updates. Perlin orders parameter children
      // before its last gradient; Surface/Attractor retain existing order.
      if(options.particleActions==='samila')replay.particles?.beginSamilaParameterActions?.(clip.samilaParameterActions??[],clip.samilaParameterDuration??clip.duration,clip.easing);
      if(options.particleActions==='perlin')replay.particles?.beginPerlinParameterActions?.(clip.perlinParameterActions??[]);
      replay.particles?.beginGradientActions?.(clip.gradientActions??[]);
      if(clip.surfaceParameterClip)replay.particles!.beginParameterClip!(clip.surfaceParameterClip);
      else replay.particles?.beginParameterActions?.(clip.surfaceParameterActions??[]);
     }
     replay.start=copy(camera);replay.targets={...clip.targets};replay.startRates=[...replay.rates];
     if(clip.align)for(const axis of axes)if(clip.align[axis]!==undefined)replay.targets[axis]=finite(F(F(F(F(Math.floor(F(camera[axis]/TAU)))+1)*TAU)+clip.align[axis]!));
     if(tracking)replay.tracking=undefined;
    }
    // A Samila group clamps its own duration to zero, but each camera child
    // retains the original negative duration. Parameter children own their
    // separate duration<=0 progress rule below.
    const runtime=F((facts.startedClip!==null?0:before.clipRuntime)+facts.activeDt),cameraDuration=clip.samilaParameterDuration??clip.duration,eased=sourceEase(clip.easing,Math.max(0,Math.min(1,F(runtime/cameraDuration))));
    particleEased=eased;
    for(const axis of axes)if(replay.targets[axis]!==undefined)camera[axis]=lerp(replay.start[axis],replay.targets[axis]!,eased);
    if(clip.focal!==undefined)camera.focalDistance=lerp(replay.start.focalDistance,clip.focal,eased);
    if(clip.rates)replay.rates=clip.rates.map((value,i)=>lerp(replay.startRates[i],value,eased)) as [number,number,number];
    // SetAmbientRotation alone snaps the target rates in onFinish.
    if(clip.rates&&facts.finishedClip!==null)replay.rates=[...clip.rates];
    if(tracking){const to=point(tracking);camera.center=to.map((v,i)=>lerp(replay.start.center[i],v,eased)) as [number,number,number];if(facts.finishedClip!==null)replay.tracking=tracking;}
   }
   if(particleEased!==undefined&&options.particleActions){
    if(clip.samilaParameterActions?.length)replay.particles!.advanceSamilaParameterActions!(facts.activeDt);
    if(clip.perlinParameterActions?.length){
     const eased=clip.duration<=0?sourceEase(clip.easing,1):particleEased;
     replay.particles!.interpolatePerlinParameterActions!(eased,facts.finishedClip!==null,facts.activeDt);
    }
    if(clip.gradientActions?.length)replay.particles?.interpolateGradientActions?.(particleEased,facts.finishedClip!==null);
    if(clip.surfaceParameterClip){if(facts.finishedClip!==null)replay.particles!.finishParameterClip!();}
    else if(clip.surfaceParameterActions?.length)replay.particles?.interpolateParameterActions?.(particleEased,facts.finishedClip!==null);
   }
   camera.zoom=facts.camera.zoom;
   // Scene.update PC132/183/225: animation, then Mobject, then camera. The
   // queue's final frame still updates Mobject; later frames skip it entirely.
   if(!before.queueComplete){check(options);replay.particles?.update({frameIndex,time:facts.sceneTime,deltaTime:facts.activeDt});check(options);}
   // CameraController copies tracking center before ambient component updates.
   if(replay.tracking)camera.center=point(replay.tracking);
   for(const [i,axis]of axes.entries())camera[axis]=finite(F(camera[axis]+F(replay.rates[i]*plan.dt)));
   finite(camera.focalDistance);finite(camera.zoom);camera.center.forEach(finite);
   check(options);replay.particles?.displayFrame?.(frameIndex,frameIndex===target);
   replay.frameIndex=frameIndex;
  }
  check(options);
  if(key!==undefined){replayCache.delete(key);replayCache.set(key,replay);while(replayCache.size>(ownedCache?1:4))replayCache.delete(replayCache.keys().next().value!);}
  return{time:target/fps,camera:copy(replay.camera),frameIndex:target,sceneTime:replay.facts.sceneTime,queueIndex:replay.facts.queueIndex,queueComplete:replay.facts.queueComplete,activeDt:replay.activeDt,rawDt:replay.facts.rawDt,rates:[...replay.rates],diagnostics:plan.diagnostics.map(item=>({...item})),...(replay.surfaceMode?{surfaceTransition:{mode:replay.surfaceMode,overlayAlpha:replay.overlayAlpha}}:{})};
 }catch(error){if(key!==undefined)replayCache.delete(key);throw error;}
}
/** Integer update count and display layout facts. Never feed rounded display durations back into
 * the source clock: sourceDuration is the authored child duration (a native
 * multi-child group may compile a negative duration to zero). */
export function resolveOrdinarySourceCameraTimeline(initial:SourceCameraScalars,tracks:readonly AnimationTrack[],fps:number,options:Pick<OrdinarySourceCameraTimelineOptions,'isCancelled'|'particleActions'|'surfaceMode'>={}) {
 check(options);const key=inputKey(initial,tracks,fps,options.particleActions,options.surfaceMode),cached=key===undefined?undefined:layouts.get(key);
 if(cached){layouts.delete(key!);layouts.set(key!,cached);return structuredClone(cached);}
 const plan=prepare(initial,tracks,fps,options.particleActions,options.surfaceMode),clock=new RootsSceneClock(plan.initial,plan.clips.map(c=>({duration:c.duration,easing:'linear',...(c.instant?{instant:true as const}:{}),...(c.finishOnStart?{finishOnStart:true as const}:{})}))),reserve=budget();
 let facts=clock.snapshot(),frame=0;const starts:number[]=[],durations:number[]=[];
 while(!facts.queueComplete){check(options);reserve(facts.queueIndex,plan.clips.length);facts=clock.step(plan.dt,{isCancelled:options.isCancelled});if(facts.startedClip!==null)starts[facts.startedClip]=frame/fps;if(facts.finishedClip!==null)durations[facts.finishedClip]=(frame+1)/fps-starts[facts.finishedClip];frame++;}
 const layout:Layout={schedule:ORDINARY_CAMERA_SEQUENCE,span:frame/fps,updates:frame,clips:plan.clips.map((c,i)=>({trackId:c.trackId,start:starts[i],duration:durations[i],sourceDuration:c.duration})),diagnostics:plan.diagnostics};
 check(options);if(key!==undefined){layouts.set(key,layout);while(layouts.size>4)layouts.delete(layouts.keys().next().value!);}
 return structuredClone(layout);
}
