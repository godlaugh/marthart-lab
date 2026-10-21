import {sourceDomainQueueDuration} from './sourceDomainQueueDuration';
import type {AnimationAction,AnimationTrack,SceneDocument} from '../types';
import {SourceDomainSceneRuntime,type SourceDomainSceneClip} from './sourceDomainSceneRuntime';
import type {SourceDomainParameterRuntimeAction} from './sourceDomainParameterRuntime';
import {validateDomainParameterActions} from './domainParameterTimeline';
import {RootsSceneClock} from './rootsSceneClock';
import {SOURCE_EASING_NAMES,sourceEase} from './sourceEasing';
import {validateGradientConfig} from './gradientOffsets';
import type {SourceGradientAction} from './sourceGradientRuntime';

export const DOMAIN_SCENE_SEQUENCE='domain-scene-sequence-v1' as const;
const F=Math.fround,WORK_LIMIT=2_000_000,MAX_ACTIONS=4096,MAX_NAME_CHARACTERS=262144;
export type SourceDomainPlan=ConstructorParameters<typeof SourceDomainSceneRuntime>[0]&{fps:number;fixedDt:number};
export type SourceDomainEvaluation=ReturnType<SourceDomainSceneRuntime['snapshot']>&{displayFrame:number;simulationFps:number};
export function usesSourceDomain(scene:Pick<SceneDocument,'kind'|'timeline'>):boolean{return scene.kind==='domain'&&scene.timeline.schedule===DOMAIN_SCENE_SEQUENCE;}
function finite(value:unknown,label:string):number {if(typeof value!=='number'||!Number.isFinite(value))throw Error(`域着色 ${label} 必须是有限数值`);return value;}
function sourceFloat(value:unknown,label:string):number {const result=F(finite(value,label));if(!Number.isFinite(result))throw Error(`域着色 ${label} 超出 Float32 范围`);return result;}
const curve=(name:string)=>{if(!SOURCE_EASING_NAMES.includes(name))throw Error('域着色源缓动无效');return(t:number)=>sourceEase(name,t);};
function noForeignAction(action:AnimationAction):void {
 if(action.parameters!==undefined||action.surfaceParameters!==undefined||action.symmetryParameters!==undefined||action.mapParameters!==undefined||action.perlinParameters!==undefined||action.samilaParameters!==undefined)throw Error('域着色源动作不能混用本地或其它场景参数');
}
/** Explicit source schedules are ordered queues. start is derived display
 * metadata, never a local overlap/gap instruction. Legacy unscheduled documents
 * remain with their existing timeline owner. */
export function validateSourceDomainTrack(track:AnimationTrack):void {
 if(!track||typeof track!=='object'||!['wait','animate'].includes(track.type??''))throw Error('域着色源队列只接受等待和动画片段');
 if(typeof track.enabled!=='boolean'||typeof track.pingPong!=='boolean'||track.pingPong||(track.repeat??1)!==1)throw Error('域着色源片段不能往返或重复');
 if(track.keyframes!==undefined||track.interpolation!==undefined||track.parameterAnimations!==undefined||track.surfaceParameterClip!==undefined||track.orientation!==undefined||track.gradient!==undefined||track.fractalSource!==undefined||track.sourceFractalZoom!==undefined||track.parameterClock!==undefined||track.replaceParameters!==undefined||track.surfaceMode!==undefined||track.surfaceFadeOutRatio!==undefined||track.trailsEnabled!==undefined||track.spirographWait!==undefined||track.alignMode!==undefined)throw Error('域着色源片段不能混用本地片段功能');
 if(finite(track.start,'片段显示起点')<0||Math.abs(finite(track.duration,'片段时长'))>86400)throw Error('域着色片段时间超出 24 小时范围');sourceFloat(track.duration,'片段时长');curve(track.easing);
 if(track.type==='wait'&&track.actions!==undefined)throw Error('域着色等待片段不能携带动画动作');
 if(track.type==='animate'&&(!Array.isArray(track.actions)||track.actions.length>64))throw Error('域着色动画需要最多64个动作的数组');
 for(const action of track.actions??[]){
  if(!action||typeof action!=='object'||Array.isArray(action)||action.enabled!==undefined&&typeof action.enabled!=='boolean')throw Error('域着色动作或启用状态无效');noForeignAction(action);
  if(!['domainRotate','paramStart','paramStop','gradientStart','gradientStop'].includes(action.method))throw Error('域着色源队列不支持此本地动作');
  if(action.args!==undefined&&(!action.args||typeof action.args!=='object'||Array.isArray(action.args)||Object.keys(action.args).some(k=>action.method!=='domainRotate'||k!=='speed')))throw Error('域着色动作包含未支持的本地参数');
  if(action.method==='domainRotate')sourceFloat(action.args?.speed??0,'目标角速度');
  if(action.method==='paramStart'||action.method==='paramStop')validateDomainParameterActions(action.domainParameters,action.method,'domain',curve);
  else if(action.domainParameters!==undefined)throw Error('域参数注册表只属于参数开始或停止动作');
  if(action.method==='gradientStart'){if(!action.gradient||action.gradient.model!=='offsets')throw Error('域着色源渐变需要 offsets 模型');validateGradientConfig(action.gradient);if(action.gradient.fromStops!==undefined||action.gradient.toStops!==undefined)throw Error('域着色源渐变不接受本地色标插值');}
  else if(action.gradient!==undefined)throw Error('域渐变配置只属于渐变开始动作');
 }
}
export function prepareSourceDomainScene(scene:SceneDocument):SourceDomainPlan {
 if(!usesSourceDomain(scene))throw Error('域着色源配置需要显式逐帧队列');
 const {fps,tracks,duration}=scene.timeline;if(finite(fps,'模拟帧率')<1||fps>120||finite(duration,'播放时长')<=0||duration>86400)throw Error('域着色帧率或播放时长无效');
 if(!Array.isArray(tracks)||tracks.length>1000)throw Error('域着色队列最多1000个片段');
 const clips:SourceDomainSceneClip[]=[];let actions=0,nameCharacters=0;
 for(const track of tracks){validateSourceDomainTrack(track);if(!track.enabled)continue;
  if(track.type==='wait'){clips.push({kind:'wait',duration:track.duration});continue;}
  const parameters:SourceDomainParameterRuntimeAction[]=[],gradients:SourceGradientAction[]=[];let rotationRate:number|undefined;actions++;if(actions>MAX_ACTIONS)throw Error('域着色队列动作超过共享容量');
  for(const action of track.actions!){if(action.enabled===false)continue;
   if(action.method==='domainRotate'){rotationRate=sourceFloat(action.args?.speed??0,'目标角速度');}
   else if(action.method==='paramStart'||action.method==='paramStop')for(const spec of action.domainParameters!){actions++;if(spec.scope.kind==='named')nameCharacters+=spec.scope.name.length;parameters.push({method:action.method,spec});}
   else{actions++;if(action.method==='gradientStop')gradients.push({kind:'stop'});else{const g=action.gradient!;gradients.push({kind:'start',config:{mode:g.mode,speed:g.speed,interpolation:g.interpolation,affectInside:g.affectInside??true,affectOutside:g.affectOutside??true}});}}
   if(actions>MAX_ACTIONS||nameCharacters>MAX_NAME_CHARACTERS)throw Error('域着色队列动作或参数名称超过共享容量');
  }
  clips.push({kind:'animate',duration:track.duration,easing:track.easing,...(rotationRate===undefined?{}:{rotationRate}),...(parameters.length?{parameters:structuredClone(parameters)}:{}),...(gradients.length?{gradients}: {})});
 }
 // parameterFps is an explicit fixed-replay surrogate for native PApplet.frameRate,
 // not the native effective-recording-FPS API. Live hosts must supply observations.
 return{initial:{settings:structuredClone(scene.settings),parameters:structuredClone(scene.parameters),rotation:sourceFloat(scene.settings.rotation??0,'初始角度'),rotationRate:0,paletteOffset:finite(scene.settings.paletteOffset??0,'初始色板偏移')},clips,parameterFps:F(fps),fps,fixedDt:F(1/F(fps))};
}
interface Layout {starts:readonly number[];lastTime:number;}
const layouts=new Map<string,Layout>();
export function resolveSourceDomainTimeline(scene:SceneDocument):SceneDocument['timeline'] {
 const plan=prepareSourceDomainScene(scene),durations=plan.clips.map(c=>sourceDomainQueueDuration(c));
 const key=JSON.stringify([plan.fps,plan.fixedDt,durations]);let layout=layouts.get(key);
 if(!layout){const clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},durations.map(duration=>({duration,easing:'linear'}))),starts:number[]=[];let frame=0,work=0;
  while(!clock.snapshot().queueComplete){work+=1+durations.length-clock.snapshot().queueIndex;if(work>WORK_LIMIT)throw Error('域着色队列布局超过200万工作预算');const next=clock.step(plan.fixedDt,{allowSignedDt:true});if(next.startedClip!==null)starts[next.startedClip]=frame/plan.fps;frame++;}
  layout={starts,lastTime:Math.max(0,frame-1)/plan.fps};layouts.set(key,layout);if(layouts.size>4)layouts.delete(layouts.keys().next().value!);
 }
 const duration=Math.max(scene.timeline.duration,layout.lastTime);if(duration>86400)throw Error('域着色队列超过24小时');let index=0;
 return{...scene.timeline,duration,tracks:scene.timeline.tracks.map(track=>({...track,start:track.enabled?layout.starts[index++]??0:0}))};
}
interface Cached {runtime:SourceDomainSceneRuntime;index:number;used:number;cancel?:()=>boolean;}
const sessions=new Map<string,Cached>();
export function replaySourceDomain(scene:SceneDocument,time:number,isCancelled?:()=>boolean):SourceDomainEvaluation {
 if(finite(time,'回放时间')<0||time>86400)throw Error('域着色回放时间必须在0至86400秒');return replaySourceDomainFrame(scene,Math.floor(time*scene.timeline.fps+1e-9),isCancelled);
}
export function replaySourceDomainFrame(scene:SceneDocument,displayFrame:number,isCancelled?:()=>boolean):SourceDomainEvaluation {
 const plan=prepareSourceDomainScene(scene);if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame/plan.fps>86400)throw Error('域着色显示帧必须是24小时内的非负整数');
 const key=JSON.stringify(plan,(_key,v:unknown)=>typeof v==='number'&&Object.is(v,-0)?{negativeZero:true}:v);let cached=sessions.get(key);
 if(cached&&displayFrame<cached.index){sessions.delete(key);cached=undefined;}
 if(!cached){const entry={} as Cached;entry.index=-1;entry.used=0;const reserve=(units:number)=>{if(entry.cancel?.())throw new DOMException('域着色回放已取消','AbortError');entry.used+=units;if(entry.used>WORK_LIMIT)throw Error('域着色回放超过共享200万工作预算');};entry.runtime=new SourceDomainSceneRuntime(plan,{reserve});cached=entry;sessions.set(key,cached);if(sessions.size>4)sessions.delete(sessions.keys().next().value!);}
 cached.used=0;cached.cancel=isCancelled;
 try{if(isCancelled?.())throw new DOMException('域着色回放已取消','AbortError');while(cached.index<displayFrame){cached.runtime.advance(plan.fixedDt,false,isCancelled);cached.index++;}return{...cached.runtime.snapshot(),displayFrame:cached.index,simulationFps:plan.fps};}
 catch(error){sessions.delete(key);throw error;}finally{cached.cancel=undefined;}
}
/** Bind only a display clone; settings/parameter writes and gradient sampling
 * all derive from this single queue snapshot, never the legacy 60Hz timeline. */
export function bindSourceDomainFrame(out:SceneDocument,frame:SourceDomainEvaluation):readonly string[] {
 out.evaluatedDomainScene=frame;Object.assign(out.settings,frame.settings,{rotation:frame.rotation,paletteOffset:frame.paletteOffset});out.parameters=structuredClone(frame.parameters);
 if(frame.gradient.running&&frame.gradient.config)out.evaluatedDomainGradient={running:true,interpolation:frame.gradient.config.interpolation};else delete out.evaluatedDomainGradient;
 return frame.writtenSettings.map(key=>`settings.${key}`);
}
