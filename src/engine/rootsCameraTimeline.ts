import type {SceneDocument} from '../types';
import {RootsSceneClock, RootsSceneClockError, type RootsSceneClip, type RootsSceneFrame} from './rootsSceneClock';
import {SOURCE_EASING_NAMES} from './sourceEasing';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {validateTimelineCapacity} from './timelineCapacity';
import {parseRootsGradientConfiguration} from './rootsGradientConfig';
import {normalizeRootsSourceToneField} from './rootsDensityColor';

export const ROOTS_CAMERA_METHODS: readonly string[] = Object.freeze(['ambient', 'stopAmbient', 'zoom']);
export const ROOTS_SCENE_METHODS: readonly string[] = Object.freeze([...ROOTS_CAMERA_METHODS,'gradientStart','gradientStop']);
export const ROOTS_CAMERA_CLIP_TYPES: readonly string[] = Object.freeze(['wait', 'animate']);
/** Missing authored arguments and their editor display share one source default. */
export const ROOTS_CAMERA_ARGUMENT_DEFAULTS = Object.freeze({
 ambient:Object.freeze({phiSpeed:0,thetaSpeed:0,gammaSpeed:0}),
 stopAmbient:Object.freeze({}),zoom:Object.freeze({value:0}),
});
const F=Math.fround, easings=new Set(SOURCE_EASING_NAMES);
// The document's 24-hour / 120-FPS domain admits at most 10,368,001 frames.
// Layout and pure camera lookup retain only one state, never a frame history.
export const ROOTS_CAMERA_FRAME_LIMIT=10_368_001;
/** A local synchronous-work budget, not a source format or wall-time limit.
 * Each frame costs one unit plus the number of remaining-duration terms folded
 * by the source clock. Full scene replay also reserves up to three visits per
 * current gradient child (copy/start/update) and two gradient phases. These are
 * conservative local work units, not timings. Layout omits gradient execution. */
export const ROOTS_CAMERA_WORK_LIMIT=2_000_000;
const checkCancelled=(isCancelled?:()=>boolean)=>{
 if(isCancelled?.())throw new RootsSceneClockError('cancelled','复根相机回放已取消');
};
const validateFps=(fps:number)=>{
 if(typeof fps!=='number'||!Number.isFinite(fps)||fps<1||fps>120)throw new RootsSceneClockError('input','复根相机帧率必须在 1–120');
};
export interface RootsCameraWorkBudget {
 readonly usedUnits:number;
 /** Reserve before stepping, using the current pre-step queue index. */
 reserveFrame(queueIndex:number):void;
}
/** One budget per lookup/display request, never one per frame. Sessions can
 * share this exact accounting without interpreting source duration arithmetic. */
export function createRootsCameraWorkBudget(plan:Pick<RootsCameraTimelinePlan,'clips'|'model'>):RootsCameraWorkBudget {
 const clipCount=plan.clips.length;let used=0;
 return {
  get usedUnits(){return used;},
  reserveFrame(queueIndex:number){
   if(!Number.isSafeInteger(queueIndex)||queueIndex<0||queueIndex>clipCount)throw new RootsSceneClockError('input','复根相机队列位置无效');
   const actionWork=3*(plan.clips[queueIndex]?.gradientActions?.length??0);
   const next=used+1+clipCount-queueIndex+actionWork+(plan.model==='roots-scene-sequence-v1'?2:0);
   if(next>ROOTS_CAMERA_WORK_LIMIT)throw new RootsSceneClockError('capacity','复根相机回放超过本地逐帧与队列折叠工作预算');
   used=next;
  },
 };
}
export function usesRootsCameraTimeline(scene:Pick<SceneDocument,'kind'|'timeline'|'rootsPresentation'>):boolean {
 return usesRootsNativePresentation(scene)&&(scene.timeline.schedule==='roots-camera-sequence-v1'||scene.timeline.schedule==='roots-scene-sequence-v1');
}
export function usesRootsGradientTimeline(scene:Pick<SceneDocument,'kind'|'timeline'|'rootsPresentation'>):boolean {
 return usesRootsNativePresentation(scene)&&scene.timeline.schedule==='roots-scene-sequence-v1';
}
/** Explicit opt-in: saved camera-only markers never activate retained gradients. */
export function withRootsSceneTimeline(scene:SceneDocument,enabled:boolean):SceneDocument {
 if(scene.kind!=='roots'||!usesRootsNativePresentation(scene))throw new RootsSceneClockError('input','源场景时间线要求启用复根空间显示');
 const timeline={...scene.timeline};
 if(enabled)timeline.schedule='roots-scene-sequence-v1';else delete timeline.schedule;
 return {...scene,timeline};
}
export function withRootsCameraTimeline(scene:SceneDocument,enabled:boolean):SceneDocument {
 if(scene.kind!=='roots'||!usesRootsNativePresentation(scene))throw new RootsSceneClockError('input','源相机时间线要求启用复根空间显示');
 const timeline={...scene.timeline};
 if(enabled)timeline.schedule='roots-camera-sequence-v1';else delete timeline.schedule;
 return {...scene,timeline};
}
const scalar=(value:unknown,label:string):number=>{
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw new RootsSceneClockError('input',`${label} 必须为有限 Float32 数值`);
 return F(value);
};
export interface RootsCameraTimelinePlan {
 readonly model:'roots-camera-sequence-v1'|'roots-scene-sequence-v1';
 readonly fps:number;readonly dt:number;readonly clips:readonly RootsSceneClip[];
 readonly trackIds:readonly string[];readonly trackIndices:readonly number[];readonly warnings:readonly string[];
}
/** One compilation of the shared authored tracks. Nothing is copied back into
 * the saved camera baseline. The source builder's last target write wins. */
export function prepareRootsCameraTimeline(scene:SceneDocument):RootsCameraTimelinePlan {
 if(scene.kind!=='roots'||(scene.timeline.schedule!=='roots-camera-sequence-v1'&&scene.timeline.schedule!=='roots-scene-sequence-v1'))throw new RootsSceneClockError('input','复根源场景时间线规则无效');
 const {fps,tracks}=scene.timeline;
 validateFps(fps);
 if(!Number.isFinite(scene.timeline.duration)||scene.timeline.duration<=0||scene.timeline.duration>86400)throw new RootsSceneClockError('capacity','复根时间线超过本地 24 小时播放域');
 if(!Array.isArray(tracks)||tracks.length>1000)throw new RootsSceneClockError('capacity','复根相机时间线最多 1000 个片段');
 if(tracks.some(track=>!track||typeof track!=='object'||Array.isArray(track)))throw new RootsSceneClockError('input','复根相机片段必须为对象');
 validateTimelineCapacity(tracks);
 const clips:RootsSceneClip[]=[],trackIds:string[]=[],trackIndices:number[]=[],warnings:string[]=[];
 const gradientEnabled=scene.timeline.schedule==='roots-scene-sequence-v1';
 for(const [trackIndex,track] of tracks.entries()){
  if(!track.enabled)continue;
  if(!ROOTS_CAMERA_CLIP_TYPES.includes(track.type??'numeric')){warnings.push(`复根源相机时间线不执行片段 ${track.label??track.id} 的 ${track.type??'numeric'}；作者数据保留。`);continue;}
  const duration=Math.max(F(.001),scalar(track.duration,'复根片段时长'));
  if(duration>86400)throw new RootsSceneClockError('capacity','复根片段时长超过 24 小时');
  if(track.start!==0)warnings.push('复根源相机队列按片段顺序执行；已保存的绝对起点不参与执行，可用等待片段表示延迟。');
  if(track.pingPong||(track.repeat??1)!==1)warnings.push('复根源相机片段不读取重复次数与往返设置；原值保留。');
  if(!easings.has(track.easing))throw new RootsSceneClockError('input',`未知复根源缓动 ${track.easing}`);
  let zoom:number|undefined,rates:[number,number,number]|undefined;
  const gradientActions:NonNullable<RootsSceneClip['gradientActions']>[number][]=[];
  if(track.type==='animate'){
   if(track.actions!==undefined&&(!Array.isArray(track.actions)||track.actions.length>64))throw new RootsSceneClockError('capacity','复根相机片段最多 64 个动作');
   for(const action of track.actions??[]){
    if(!action||typeof action!=='object')throw new RootsSceneClockError('input','复根相机动作必须为对象');
    if(action.enabled===false)warnings.push('原版复根相机动作不读取动作级启用开关；请用片段开关控制执行。');
    const args=action.args??{};
    if(action.method==='stopAmbient')rates=[0,0,0];
    else if(action.method==='zoom')zoom=scalar(args.value??ROOTS_CAMERA_ARGUMENT_DEFAULTS.zoom.value,'目标缩放');
    else if(action.method==='ambient')rates=[scalar(args.phiSpeed??ROOTS_CAMERA_ARGUMENT_DEFAULTS.ambient.phiSpeed,'phi 角速度'),scalar(args.thetaSpeed??ROOTS_CAMERA_ARGUMENT_DEFAULTS.ambient.thetaSpeed,'theta 角速度'),scalar(args.gammaSpeed??ROOTS_CAMERA_ARGUMENT_DEFAULTS.ambient.gammaSpeed,'gamma 角速度')];
    else if(gradientEnabled&&action.method==='gradientStop')gradientActions.push({kind:'stop'});
    else if(gradientEnabled&&action.method==='gradientStart'){
     if(action.gradient===undefined)warnings.push('保留的复根渐变启动动作没有配置；请显式设置渐变配置后再执行。');
     else gradientActions.push({kind:'start',config:parseRootsGradientConfiguration(action.gradient)});
    }
    else warnings.push(`复根源队列尚不执行 ${action.method}；原动作保留。${gradientEnabled?'':'仅相机队列不会启用渐变动作。'}`);
   }
  }
  clips.push({duration,easing:track.easing,...(zoom===undefined?{}:{zoom}),...(rates===undefined?{}:{rates}),...(gradientEnabled?{gradientActions}:{})});trackIds.push(track.id);trackIndices.push(trackIndex);
 }
 return {model:scene.timeline.schedule,fps,dt:F(1/fps),clips,trackIds,trackIndices,warnings:[...new Set(warnings)]};
}
export function rootsCameraTargetFrame(time:number,fps:number):number {
 validateFps(fps);
 if(!Number.isFinite(time)||time<0||time>86400)throw new RootsSceneClockError('input','复根相机时间必须为 0–86400 秒');
 return Math.floor(time*fps+1e-9);
}
export function createRootsCameraClock(scene:SceneDocument,plan:RootsCameraTimelinePlan):RootsSceneClock {
 if(!scene.rootsPresentation)throw new RootsSceneClockError('input','缺少复根空间相机');
 return new RootsSceneClock(scene.rootsPresentation.camera,plan.clips,plan.model==='roots-scene-sequence-v1'?{gradient:{initialOffset:normalizeRootsSourceToneField('rootSourcePaletteOffset',(scene.settings.rootSourcePaletteOffset??0) as number)}}:undefined);
}
export function rootsCameraAtTime(scene:SceneDocument,time:number,isCancelled?:()=>boolean):RootsSceneFrame {
 checkCancelled(isCancelled);
 const plan=prepareRootsCameraTimeline(scene),clock=createRootsCameraClock(scene,plan),target=rootsCameraTargetFrame(time,plan.fps);
 // Even an empty queue still performs one source camera step per frame.
 if(target+1>ROOTS_CAMERA_WORK_LIMIT)throw new RootsSceneClockError('capacity','复根相机回放超过本地逐帧与队列折叠工作预算');
 const budget=createRootsCameraWorkBudget(plan);let facts=clock.snapshot();
 for(let i=0;i<=target;i++){
  checkCancelled(isCancelled);budget.reserveFrame(facts.queueIndex);
  facts=clock.step(plan.dt,{isCancelled});
 }
 return facts;
}
const layouts=new Map<string,{starts:number[];durations:number[];span:number}>();
/** A conservative lower bound rejects only impossible work before replay. For
 * nonnegative runtime x < duration and activeDt <= dt, one F32 add advances by
 * at most dt + (duration + dt) * 2^-23 (a full relative ULP, conservatively twice
 * the normal rounding bound). This is NOT a replacement duration formula.
 * Exact accepted layouts still execute the source float clock below. */
function preflightLayout(plan:RootsCameraTimelinePlan):void {
 let minimumFrames=0,minimumWork=0;
 for(const [index,clip] of plan.clips.entries()){
  const maximumIncrement=plan.dt+(clip.duration+plan.dt)*2**-23;
  const frames=Math.max(1,Math.ceil(clip.duration/maximumIncrement));
  minimumFrames+=frames;minimumWork+=frames*(1+plan.clips.length-index);
 }
 if(minimumFrames>ROOTS_CAMERA_FRAME_LIMIT)throw new RootsSceneClockError('capacity','复根源队列超过 24 小时帧域');
 if(minimumWork>ROOTS_CAMERA_WORK_LIMIT)throw new RootsSceneClockError('capacity','复根相机布局超过本地逐帧与队列折叠工作预算');
}
/** Queue layout uses the same duration/remaining-time arithmetic as execution,
 * but no camera targets or GPU work. UI start positions are derived facts. */
export function resolveRootsCameraTimeline(scene:SceneDocument,options:{isCancelled?:()=>boolean}={}):SceneDocument['timeline'] {
 checkCancelled(options.isCancelled);
 const plan=prepareRootsCameraTimeline(scene),key=JSON.stringify([plan.fps,plan.clips.map(c=>c.duration)]);
 preflightLayout(plan);
 let layout=layouts.get(key);
 if(!layout){
  const layoutClips=plan.clips.map(c=>({duration:c.duration,easing:'linear'}));
  const clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},layoutClips);
  const starts:number[]=[],durations:number[]=[];let frame=0,facts=clock.snapshot();const budget=createRootsCameraWorkBudget({clips:layoutClips,model:'roots-camera-sequence-v1'});
  while(!facts.queueComplete){
   checkCancelled(options.isCancelled);budget.reserveFrame(facts.queueIndex);
   if(frame>=ROOTS_CAMERA_FRAME_LIMIT)throw new RootsSceneClockError('capacity','复根源队列超过 24 小时帧域');
   facts=clock.step(plan.dt,{isCancelled:options.isCancelled});
   if(facts.startedClip!==null)starts[facts.startedClip]=frame/plan.fps;
   if(facts.finishedClip!==null)durations[facts.finishedClip]=(frame+1)/plan.fps-starts[facts.finishedClip];
   frame++;
  }
  layout={starts,durations,span:frame/plan.fps};
  if(key.length<=1_000_000){layouts.set(key,layout);while(layouts.size>4)layouts.delete(layouts.keys().next().value!);}
 }
 checkCancelled(options.isCancelled);
 const byIndex=new Map(plan.trackIndices.map((index,i)=>[index,i])),{schedule:_schedule,...timeline}=scene.timeline;
 const duration=Math.max(timeline.duration,layout.span);
 if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new RootsSceneClockError('capacity','复根时间线超过本地 24 小时播放域');
 return {...timeline,duration,tracks:timeline.tracks.map((track,index)=>{
  const i=byIndex.get(index);return i===undefined?{...track,start:0}:{...track,start:layout!.starts[i],duration:layout!.durations[i]};
 })};
}
