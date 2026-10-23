import {DOMAIN_SCENE_SEQUENCE,usesSourceDomain,validateSourceDomainTrack,resolveSourceDomainTimeline,replaySourceDomain,replaySourceDomainFrame,bindSourceDomainFrame} from './sourceDomainTimeline';
import {FRACTAL_SCENE_SEQUENCE,usesSourceFractal} from './sourceFractalDocument';
import {bindSourceFractalFrame,replaySourceFractal,replaySourceFractalFrame,resolveSourceFractalTimeline,validateSourceFractalTrack} from './sourceFractalTimeline';
import {SOURCE_EASING_NAMES} from './sourceEasing';
import {parseSourceFractalZoomTarget,evaluateSourceFractalZoom} from './sourceFractalZoom';
import {usesSourceMapParameters,validateSourceMapParameters} from './sourceMapParameterIdentity';
import {usesSourceSymmetryParameters,validateSourceSymmetryParameters} from './sourceSymmetryParameterIdentity';
import {usesSourceSymmetryGradient} from './sourceSymmetryGradient';
import {replaySourceIteratedTimeline,bindSourceIterationFrame} from './sourceIteratedTimeline';
import {SAMILA_SCENE_SEQUENCE,usesSourceSamilaTimeline,resolveSourceSamilaTimeline,replaySourceSamilaTimeline,bindSourceSamilaFrame} from './sourceSamilaReplay';
import {normalizeSourceSamilaParameterAction} from './sourceSamilaParameter';
import {usesSourcePerlin} from './sourcePerlinIdentity';
import {usesCapturedDensityCamera,capturedDensityCameraClipTypes,CAPTURED_DENSITY_CAMERA_ACTIONS} from './sourceCameraMode';
import {replaySourcePerlinCamera} from './sourcePerlinReplay';
import {parseSourcePerlinParameterAction} from './sourcePerlinParameterConfig';
import {usesSourceBouncing,prepareSourceBouncingScene} from './sourceBouncingDocument';
import {usesSourceAttractor} from './sourceAttractorDocument';
import {replaySourceAttractorCamera} from './sourceAttractorReplay';
import {parseSourceMapParameterActions,parseSourceSymmetryParameterActions,parseSourceSurfaceParameterActions,parseSourceSurfaceParameterClip} from './sourceRegistryParameterConfig';
import {parseSourceParticleGradientConfiguration} from './sourceParticleGradientConfig';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {replaySourceSurfaceCamera} from './sourceSurfaceReplay';
import {usesSourceSurfaceHost,usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {evaluateOrdinarySourceCameraTimeline,resolveOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {inactiveFractalSourceColorTarget,usesFractalSourceColor,readFractalSourceColorAnimation,writeFractalSourceColorAnimation,FRACTAL_SOURCE_COLOR_ANIMATION_TARGETS} from './fractalSourceColorAuthoring';
import {rootMathAnimationTargetEnabled} from './rootsMathConfig';
import {validateTimelineCapacity} from './timelineCapacity';
export {validateTimelineCapacity} from './timelineCapacity';
import {usesRootsCameraTimeline,prepareRootsCameraTimeline,resolveRootsCameraTimeline,rootsCameraAtTime} from './rootsCameraTimeline';
import {parseRootsGradientConfiguration} from './rootsGradientConfig';
import {samilaCameraEnabled,samilaCameraFrame,writeSamilaTheta,cloneSamilaCameraFrame,parseSamilaCamera} from './samilaCamera';
import {rgb,hex,hueRotate,interpolateColor} from './colorInterpolation';
import {parameterAnimationSuggestion} from './parameterEditing';
import {ROOTS_SOURCE_TONE_DEFAULTS} from './rootsDensityColor';
import {parseDomainViewportVersion} from './domainViewport';
import {parseSpirographVersion,spirographSourceRotationRate} from './spirographModel';
import {usesSpirographFrameClock} from './spirographFrameConfig';
import {interactiveSpirographFrames,sceneAtSpirographFrame} from './spirographFramePlan';
import {DomainParameterTimeline,validateDomainParameterActions} from './domainParameterTimeline';
export {validateDomainParameterActions,domainParameterFrame,readDomainParameterScalar} from './domainParameterTimeline';
export {interpolateColor} from './colorInterpolation';
import {genericParameterTargets,genericParameterTimelineWarning} from './sceneParameters';
import {compileGradientOffsets,readGradientOffsets,validateGradientConfig,gradientAnimationCapabilities,isLocalPaletteAnimationTarget} from './gradientOffsets';
import type { AnimationAction, AnimationClipType, AnimationTrack, GradientAnimation, ParameterAnimation, SceneDocument, RGB, CameraFrame, ParticleCameraRequest, ParticleCameraSample } from '../types';
import { MAX_PALETTE_STOPS, paletteBaseColor, paletteStopsColor, validatePalettePositions } from './palette';
import {dd,ddAdd,ddSub,ddMul} from './doubleDouble';
import {sampleSurfaceParticle} from '../scenes/geometry';
import { estimateSpirographCompletion,spirographVisualCompletion } from '../scenes/spirograph';
import {complexCompanion} from './fractalParameterBindings';
import {EdgePhaseTimeline,parseOscillationEdge,prepareParameterOscillation,validateOscillationRange} from './oscillation';
import {MAX_CAMERA_SAMPLES,particleCameraKey} from './particleCamera';
export {particleCameraKey} from './particleCamera';
import {supportsCameraActions,supportsCameraAction,supportsCameraComponent,supportsCameraTarget,supportsParticleTracking,initializeEvaluatedCamera,cloneEvaluatedCamera,sceneCamera,writableSceneCamera,writeCameraOptics,refreshCameraSetting} from './sceneCamera';

type Curve = (t: number) => number;
const TAU = Math.PI * 2;
const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const mod = (x: number, n: number) => ((x % n) + n) % n;
function finite(value: number, name: string) { if (!Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`); return value; }
const bounce: Curve = t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; };
const bases: Record<string, Curve> = {
  quad: t => t * t, cubic: t => t ** 3, quart: t => t ** 4, quint: t => t ** 5,
  sine: t => 1 - Math.cos(t * Math.PI / 2), expo: t => t === 0 ? 0 : 2 ** (10 * t - 10),
  circ: t => 1 - Math.sqrt(Math.max(0, 1 - t * t)), back: t => 2.70158 * t ** 3 - 1.70158 * t * t,
  elastic: t => t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * TAU / 3), bounce: t => 1 - bounce(1 - t),
};
const sigmoid = (t: number) => 1 / (1 + Math.exp(-t));
const smooth: Curve = t => (sigmoid(10 * (t - .5)) - sigmoid(-5)) / (sigmoid(5) - sigmoid(-5));
const thereBack: Curve = t => smooth(t < .5 ? 2 * t : 2 * (1 - t));
const extras: Record<string, Curve> = {
  smooth, 'smooth-step': t => t * t * (3 - 2 * t), 'smoother-step': t => t ** 3 * (t * (6 * t - 15) + 10),
  'smootherer-step': t => t ** 4 * (35 + t * (-84 + t * (70 - 20 * t))),
  'rush-in': t => 2 * smooth(t / 2), 'rush-from': t => 2 * smooth((t + 1) / 2) - 1,
  'double-smooth': t => t < .5 ? smooth(2 * t) / 2 : .5 + smooth(2 * t - 1) / 2,
  'there-and-back': thereBack, 'there-and-back-with-pause': t => t < 1 / 3 ? smooth(3 * t) : t <= 2 / 3 ? 1 : smooth(3 * (1 - t)),
  'running-start': t => t * t * (2 * t - 1), wiggle: t => thereBack(t) * Math.sin(4 * Math.PI * t),
  lingering: t => Math.min(1, 1.5 * t), 'exponential-decay': t => 1 - Math.exp(-5 * t),
  'slow-into': t => Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)), 'not-quite-there': t => .7 * smooth(t),
};
// 46 shipped names. Legacy "step" remains accepted but is not a shipped easing.
export const EASING_NAMES = ['linear', ...Object.keys(bases).flatMap(k => [`${k}-in`, `${k}-out`, `${k}-in-out`]), ...Object.keys(extras)];
export function easingCurve(name:string):Curve {
  const normalized = name.toLowerCase().replaceAll('_', '-');
  if (normalized === 'linear') return t=>t;
  if (normalized === 'step') return t=>t === 1 ? 1 : 0;
  if (Object.hasOwn(extras, normalized)) return extras[normalized];
  const [base, ...parts] = normalized.split('-'), mode = parts.join('-'), f = bases[base];
  if (!Object.hasOwn(bases, base) || !f || !['in', 'out', 'in-out'].includes(mode)) throw new Error(`未知缓动 ${name}`);
  return mode === 'in' ? f : mode === 'out' ? t=>1-f(1-t) : t=>t<.5?f(2*t)/2:1-f(2-2*t)/2;
}
export function ease(name: string, input: number): number {return easingCurve(name)(clamp(finite(input,'缓动时间')));}


export const CLIP_TYPES: { type: AnimationClipType; label: string }[] = [
  { type: 'numeric', label: '数值动画' }, { type: 'wait', label: '等待' }, { type: 'animate', label: '动作组合' },
  { type: 'align', label: '相机对齐' }, { type: 'param', label: '参数往返' }, { type: 'fractal_zoom', label: '分形缩放' },
  { type: 'surface_mode_transition', label: '点云 / 网格过渡' }, { type: 'spirograph_finish_wait', label: '等待旋轮绘制完成' }, { type: 'trails', label: '拖尾记录' },
];
export const ACTIONS = [
  ['rotateTheta', '水平旋转'], ['rotatePhi', '垂直旋转'], ['rotateGamma', '相机滚转'], ['rotateTo', '转至角度'], ['zoom', '相机缩放'], ['focal', '焦距'],
  ['track', '跟踪目标'], ['stopTracking', '停止跟踪'], ['ambient', '持续环绕'], ['fractalRotate', '分形旋转'], ['domainRotate', '复平面旋转'], ['spirographRotate', '旋轮线旋转'],
  ['stopAmbient', '停止持续旋转'], ['paramStart', '开始参数振荡'], ['paramStop', '停止参数振荡'], ['gradientStart', '开始渐变动画'], ['gradientStop', '停止渐变动画'],
] as const;

const cameraMethods=new Set(['rotateTheta','rotatePhi','rotateGamma','rotateTo','zoom','focal','track','stopTracking','ambient','stopAmbient']);
export function isCameraAction(method:string){return cameraMethods.has(method);}
export function timelineWarnings(scene:SceneDocument,clock:'fixed'|'realtime'='fixed'):string[]{
 if(usesSourceDomain(scene))return [clock==='realtime'?'域着色按实际经过时间播放；暂停后可拖拽、缩放和修改参数。应用场景或时间跳转会重新开始。队列结束后，已启动的动画仍可继续。':'域着色使用逐帧顺序队列；参数、渐变和旋转共同更新。固定回放以时间线帧率代替宿主观测帧率，跳转会重建初始状态。'];
 if(usesSourceFractal(scene))return [clock==='realtime'?'暂停保留当前画面；跳转会从初始配置重建。修改时间线后，请在播放时点击“应用场景”。':'按固定帧率回放；跳转会从初始配置重建。'];
 if(usesSourceSamilaTimeline(scene)){const frame=replaySourceSamilaTimeline(scene,0);return[...frame.diagnostics.map(d=>d.message),...(clock==='fixed'?['源 Samila 队列按固定帧率回放；仅 theta 参与密度显示，其他相机分量保留运行状态。']:[])];}
 if(usesCapturedDensityCamera(scene))validateTimelineSchedule(scene);
 if(usesRootsCameraTimeline(scene))return [...prepareRootsCameraTimeline(scene).warnings,...(clock==='fixed'?['复根相机动画按本地固定帧率逐帧回放；循环和跳转重建实例，不代表原版实时线程时钟。']:[])];
 const genericWarning=genericParameterTimelineWarning(scene),messages:string[]=[...(genericWarning?[genericWarning]:[]),...parseSamilaCamera(scene).warnings];
 if(scene.sourceCamera){const initial=ordinarySourceCameraInitial(scene)!,frame=(usesSourceSymmetryGradient(scene)||usesSourceMapParameters(scene))?replaySourceIteratedTimeline(scene,0).frame:usesSourcePerlin(scene)?replaySourcePerlinCamera(scene,0):usesSourceSurfaceGeometry(scene)?replaySourceSurfaceCamera(scene,0):usesSourceAttractor(scene)?replaySourceAttractorCamera(scene,0):evaluateOrdinarySourceCameraTimeline(initial,scene.timeline.tracks,scene.timeline.fps,0);messages.push(...frame.diagnostics.map(d=>d.message));if(clock==='fixed')messages.push('原版相机按本地固定帧率回放；原版实时线程时钟和非相机效果仍待完整对照。');}
 if(scene.timeline.tracks.some(track=>track.enabled&&((track.type??'numeric')==='numeric'&&!rootMathAnimationTargetEnabled(scene,track.target)||track.type==='param'&&track.parameterAnimations?.some(p=>p.enabled&&!rootMathAnimationTargetEnabled(scene,p.target))||track.actions?.some(action=>action.enabled!==false&&action.method==='paramStart'&&action.parameters?.some(p=>p.enabled&&!rootMathAnimationTargetEnabled(scene,p.target))))))messages.push('源复根数学不使用通用参数或旧采样与求解字段；相关轨道保留时长但未执行。');
 const inactiveSourceParameters=(parameters:readonly ParameterAnimation[]|undefined)=>parameters?.some(p=>p.enabled&&inactiveFractalSourceColorTarget(scene,p.target));
 if(scene.timeline.tracks.some(track=>track.enabled&&((track.type??'numeric')==='numeric'&&inactiveFractalSourceColorTarget(scene,track.target)||track.type==='param'&&inactiveSourceParameters(track.parameterAnimations)||track.actions?.some(action=>action.enabled!==false&&action.method==='paramStart'&&inactiveSourceParameters(action.parameters)))))messages.push('原版分形着色已停用；其偏移动画保留但不执行。');
 const gradient=gradientAnimationCapabilities(scene),paletteParameters=(parameters:readonly ParameterAnimation[]|undefined)=>parameters?.some(p=>p.enabled&&isLocalPaletteAnimationTarget(p.target));
 if(gradient.retainedPaletteWarning&&scene.timeline.tracks.some(track=>track.enabled&&(
  (track.type??'numeric')==='numeric'&&isLocalPaletteAnimationTarget(track.target)||track.type==='param'&&paletteParameters(track.parameterAnimations)||
  track.actions?.some(action=>action.enabled!==false&&(action.method==='gradientStart'&&action.gradient?.model!=='offsets'||action.method==='paramStart'&&paletteParameters(action.parameters)))
 )))messages.push(gradient.retainedPaletteWarning);
 if(!supportsParticleTracking(scene)&&scene.timeline.tracks.some(track=>track.enabled&&track.actions?.some(action=>action.enabled!==false&&action.method==='track'&&action.args&&Object.hasOwn(action.args,'index'))))messages.push('当前场景尚未提供动态粒子采样合同，track(index) 保留但未执行。');
 if(supportsCameraActions(scene))return messages;
 if(samilaCameraEnabled(scene)){
  const unsupported=scene.timeline.tracks.filter(track=>track.enabled&&(track.type==='align'&&Object.keys(track.orientation??{}).some(axis=>!supportsCameraComponent(scene,axis))||(track.type??'numeric')==='numeric'&&!supportsCameraTarget(scene,track.target)||track.actions?.some(action=>action.enabled!==false&&isCameraAction(action.method)&&(!supportsCameraAction(scene,action.method)||action.method==='rotateTo'&&['phi','gamma'].some(key=>Object.hasOwn(action.args??{},key))||action.method==='ambient'&&['phiSpeed','gammaSpeed'].some(key=>Object.hasOwn(action.args??{},key))))));
  return [...messages,...(unsupported.length?[`${unsupported.length} 个时间线片段含 Samila 不支持的相机分量；仅应用 theta，其他相机动作或分量保留但未执行。`]:[])];
 }
 const unsupported=scene.timeline.tracks.filter(track=>track.enabled&&(track.type==='align'||(track.type??'numeric')==='numeric'&&track.target.startsWith('camera.')||track.actions?.some(action=>action.enabled!==false&&isCameraAction(action.method))));
 return [...messages,...(unsupported.length?[`${unsupported.length} 个时间线片段含通用相机动作，当前二维数学视口不支持；原轨道保留，未变换图像平面。请动画修改数学中心、缩放或旋转参数。`]:[])];
}
/** elapsed is a monotonic playback clock, not the previously reflected display time. */
export function normalizeTimelineTime(elapsed: number, timeline: SceneDocument['timeline']): number {
  finite(elapsed, '播放时间'); finite(timeline.duration, '时间线时长');
  if (timeline.duration <= 0) throw new Error('时间线时长必须大于零');
  const t = Math.max(0, elapsed), d = timeline.duration, mode = timeline.playbackMode ?? (timeline.loop ? 'loop' : 'once');
  if (mode === 'once') return Math.min(d, t);
  if (mode === 'loop') return mod(t, d);
  if (mode === 'ping-pong') return d - Math.abs(mod(t, 2 * d) - d);
  throw new Error(`未知播放模式 ${mode}`);
}
/** Shared keyframe boundary for document import and compiled animation plans. */
export function validateFractalKeyframes(track:AnimationTrack):NonNullable<AnimationTrack['keyframes']> {
  if(!Array.isArray(track.keyframes)||track.keyframes.length<2||track.keyframes.length>256)throw new Error('分形缩放需要2–256个关键帧');
  const frames=track.keyframes.map(frame=>{if(!frame||typeof frame!=='object')throw new Error('分形关键帧必须为对象');return {...frame};}).sort((a,b)=>a.time-b.time);
  frames.forEach((frame,i)=>{
    for(const key of ['time','centerX','centerY','zoom'] as const)finite(frame[key],`关键帧 ${key}`);
    for(const key of ['centerXLow','centerYLow'] as const)if(frame[key]!==undefined)finite(frame[key]!,`关键帧 ${key}`);
    if(frame.time<0||frame.time>track.duration||(i>0&&frame.time<=frames[i-1].time))throw new Error('关键帧时间须递增且位于片段内');
    if(frame.zoom<1e-6||frame.zoom>1e28)throw new Error('分形关键帧缩放必须在 1e-6 至 1e28');
    ease(frame.easing??track.easing,.5);
  });
  return frames;
}
export function clipDuration(track: AnimationTrack, scene: SceneDocument): number {
  if(usesSourceDomain(scene)){validateSourceDomainTrack(track);return Math.max(0,track.duration);}
  if(usesSourceFractal(scene)){validateSourceFractalTrack(track);return Math.max(0,track.duration);}
  if(usesSpirographFrameClock(scene))return interactiveSpirographFrames.timeline(scene).tracks.find(item=>item.id===track.id)?.duration??track.duration;
  if (track.type === 'spirograph_finish_wait') {
    if(track.spirographWait!==undefined){
      if(track.spirographWait!=='visual-or-deadline-v1'||scene.kind!=='spirograph')throw new Error('旋轮完成等待规则无效');
      const duration=finite(track.duration,'最长等待时长');
      if(duration<0||duration>86400)throw new Error('最长等待时长必须在 0–86400 秒');
      const start=finite(Number(scene.settings.traceStartTime??0),'旋轮绘制起点');
      const through=track.start+duration-start;
      if(through<0)return duration;
      // Only a completion inside the supported replay horizon can affect a
      // playable document. Keep the caller's full deadline if none is found;
      // the sequence owner separately checks its resulting total capacity.
      const completion=spirographVisualCompletion(scene.settings,Math.min(through,86400));
      return completion===null?duration:clamp(completion+start-track.start,0,duration);
    }
    const completion = estimateSpirographCompletion(scene.settings).totalSeconds;
    if (completion === null || !Number.isFinite(completion)) throw new Error('持续或未闭合的旋轮没有有限完成时间，不能自动等待完成');
    const start = finite(Number(scene.settings.traceStartTime ?? 0), '旋轮绘制起点');
    return Math.max(0, completion + start - track.start);
  }
  return track.duration;
}
export function validateTimelineSchedule(scene:SceneDocument):void {
  const schedule=scene.timeline.schedule;
  if(usesSourceDomain(scene)){for(const track of scene.timeline.tracks)validateSourceDomainTrack(track);return;}
  if(usesSourceFractal(scene)){if(schedule!==FRACTAL_SCENE_SEQUENCE)throw Error('源分形必须使用逐帧队列');for(const track of scene.timeline.tracks)validateSourceFractalTrack(track);return;}
  if(scene.sourceCamera&&schedule!=='ordinary-camera-sequence-v1')throw new Error('原版几何相机必须使用对应的顺序时间线');
  if(schedule!==undefined&&!(usesSourceSamilaTimeline(scene)||(schedule==='ordinary-camera-sequence-v1'&&!!scene.sourceCamera)||(schedule==='spirograph-sequence-v1'&&scene.kind==='spirograph')||((schedule==='roots-camera-sequence-v1'||schedule==='roots-scene-sequence-v1')&&scene.kind==='roots')))throw new Error('时间线顺序规则无效');
  if(usesCapturedDensityCamera(scene)){
    const clips=capturedDensityCameraClipTypes(scene);
    for(const track of scene.timeline.tracks){
      if(!track.enabled)continue;
      if(!clips.includes(track.type??'numeric'))throw new Error(`源 ${scene.kind} 密度相机不支持 ${track.type??'numeric'} 片段`);
      // The native camera builder ignores action-level enabled, so even a
      // retained disabled unsupported action must not reach the shared clock.
      for(const action of track.actions??[])if((isCameraAction(action.method)||action.method==='rotate')&&!CAPTURED_DENSITY_CAMERA_ACTIONS.includes(action.method))throw new Error(`源 ${scene.kind} 密度相机不分派 ${action.method}`);
    }
  }
}
const resolvedSequences=new Map<string,{starts:number[];duration:number}>();
/** Resolve the explicit source queue against the current geometry. A source
 * finish wait is a predicate/deadline, so its successor cannot own a saved
 * absolute start. Disabled clips consume neither their delay nor duration.
 * The deterministic clock omits the original live manager's next-frame delay.
 * Omitted schedule preserves every existing absolute-track contract. */
export function resolveTimeline(scene:SceneDocument):SceneDocument['timeline'] {
  validateTimelineSchedule(scene);
  if(usesSourceDomain(scene))return resolveSourceDomainTimeline(scene);
  if(usesSourceFractal(scene))return resolveSourceFractalTimeline(scene);
  if(usesSourceSamilaTimeline(scene))return resolveSourceSamilaTimeline(scene);
  if(scene.sourceCamera){const layout=resolveOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(scene)!,scene.timeline.tracks,scene.timeline.fps,{particleActions:sourceParticleActionFamily(scene),surfaceMode:usesSourceSurfaceHost(scene)?scene.surfaceSource?.mode:undefined});const byId=new Map(layout.clips.map(c=>[c.trackId,c]));return{...scene.timeline,duration:Math.max(scene.timeline.duration,layout.span),tracks:scene.timeline.tracks.map(t=>{const c=byId.get(t.id);return c?{...t,start:c.start,duration:c.duration}:t;})};}
  if(usesRootsCameraTimeline(scene))return resolveRootsCameraTimeline(scene);
  if(scene.timeline.schedule==='roots-camera-sequence-v1'||scene.timeline.schedule==='roots-scene-sequence-v1')return {...scene.timeline,schedule:undefined};
  if(usesSpirographFrameClock(scene))return interactiveSpirographFrames.timeline(scene);
  const timeline=scene.timeline;
  if(timeline.schedule===undefined)return timeline;
  if(!Number.isFinite(timeline.duration)||timeline.duration<=0||timeline.duration>86400||timeline.tracks.length>1000)throw new Error('时间线时长或片段数无效');
  const key=JSON.stringify([scene.kind,scene.settings,timeline]);
  let resolved=resolvedSequences.get(key);
  if(!resolved){
    let cursor=0;
    const starts=timeline.tracks.map(track=>{
      const delay=finite(track.start,'片段前置等待');
      if(delay<0||delay>86400)throw new Error('片段前置等待必须在 0–86400 秒');
      if(!track.enabled)return cursor;
      const start=cursor+delay;
      if(start>86400)throw new Error('顺序时间线超过 24 小时');
      const duration=finite(clipDuration({...track,start},scene),'片段有效时长');
      if(duration<0)throw new Error('片段有效时长不能为负数');
      cursor=start+duration;
      if(cursor>86400)throw new Error('顺序时间线超过 24 小时');
      return start;
    });
    resolved={starts,duration:Math.max(timeline.duration,cursor)};
    if(key.length<=1_000_000){resolvedSequences.set(key,resolved);while(resolvedSequences.size>4)resolvedSequences.delete(resolvedSequences.keys().next().value!);}
  }
  const {schedule:_schedule,...absolute}=timeline;
  return{...absolute,duration:resolved.duration,tracks:timeline.tracks.map((track,i)=>({...track,start:resolved!.starts[i]}))};
}
export function clipProgress(track: AnimationTrack, time: number, duration = track.duration): number {
  if (!Number.isFinite(duration) || duration < 0 || duration === 0 && !['animate', 'spirograph_finish_wait'].includes(track.type ?? 'numeric')) throw new Error('片段时长必须是正有限数值；animate 动作或已完成的等待可瞬时执行');
  const repeat = track.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 1000) throw new Error('重复次数必须为1–1000的整数');
  if (duration === 0) return ease(track.easing, time < track.start ? 0 : 1);
  const fraction = clamp((time - track.start) / duration), cycle = fraction === 1 ? 1 : mod(fraction * repeat, 1);
  return ease(track.easing, track.pingPong ? 1 - Math.abs(2 * cycle - 1) : cycle);
}

function copyState(scene: SceneDocument, time?:number): SceneDocument {
  const copied:SceneDocument = { ...scene, parameters: { ...scene.parameters }, settings: { ...scene.settings }, palette: { ...scene.palette, stops: [...scene.palette.stops], ...(scene.palette.positions ? { positions: [...scene.palette.positions] } : {}) }, camera: { ...scene.camera, position: [...scene.camera.position], target: [...scene.camera.target] }, ...(scene.evaluatedCamera?{evaluatedCamera:cloneEvaluatedCamera(scene.evaluatedCamera)}:{}) };
  if(scene.fractalSourceColor)copied.fractalSourceColor=structuredClone(scene.fractalSourceColor);
  if(scene.domainSourcePalette)copied.domainSourcePalette={...scene.domainSourcePalette,colors:[...scene.domainSourcePalette.colors]};
  if(scene.surfaceSource)copied.surfaceSource=structuredClone(scene.surfaceSource);
  if(scene.attractorSource)copied.attractorSource=structuredClone(scene.attractorSource);
  if(scene.bouncingSource)copied.bouncingSource=structuredClone(scene.bouncingSource);
  if(scene.surfaceSourcePalette)copied.surfaceSourcePalette={colors:[...scene.surfaceSourcePalette.colors]};
  if(scene.rootsSourcePalette)copied.rootsSourcePalette={colors:[...scene.rootsSourcePalette.colors]};
  if(scene.rootsMath)copied.rootsMath=structuredClone(scene.rootsMath);
  if(scene.rootsPresentation)copied.rootsPresentation=structuredClone(scene.rootsPresentation);
  delete copied.evaluatedDomainGradient;
  delete copied.evaluatedDomainScene;
  delete copied.evaluatedFractalGradient;
  delete copied.evaluatedFractalScene;
  if(scene.fractalSource)copied.fractalSource=structuredClone(scene.fractalSource);
  delete copied.evaluatedSpirographRotationRadians;
  delete copied.evaluatedSpirographFrame;
  delete copied.evaluatedRootsCamera;
  delete copied.evaluatedSourceCamera;
  if(scene.sourceCamera){copied.sourceCamera=structuredClone(scene.sourceCamera);if(time!==undefined&&(usesSourceSymmetryGradient(copied)||usesSourceMapParameters(copied))){const evaluated=replaySourceIteratedTimeline(copied,time);copied.evaluatedSourceCamera=evaluated.frame;bindSourceIterationFrame(copied,evaluated.palette,evaluated.update,evaluated.parameters);if(evaluated.parameters)copied.parameters={...evaluated.parameters.values};if(evaluated.mapColors)Object.assign(copied.settings,evaluated.mapColors);}else if(time!==undefined)copied.evaluatedSourceCamera=usesSourcePerlin(copied)?replaySourcePerlinCamera(copied,time):usesSourceSurfaceGeometry(copied)?replaySourceSurfaceCamera(copied,time):usesSourceAttractor(copied)?replaySourceAttractorCamera(copied,time):evaluateOrdinarySourceCameraTimeline(ordinarySourceCameraInitial(copied)!,scene.timeline.tracks,scene.timeline.fps,time);}
  if(time!==undefined&&scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)==='mathart-1.7.8-v1'){
    copied.evaluatedSpirographRotationRadians=finite(spirographSourceRotationRate(scene.settings.rotationSpeed)*time,'旋轮运行时旋转');
  }
  if(time!==undefined)initializeEvaluatedCamera(copied,time);else cloneSamilaCameraFrame(scene,copied);return copied;
}
/** Trace commands are discrete drawing events; interpolating their timestamps
 * would silently move the past while a completion wait is being scheduled. */
export function isSpirographEventTarget(scene:SceneDocument,target:string):boolean {
  return scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)!=='local-v1'&&['settings.traceStartTime','settings.traceClearTime','settings.traceFinishTime'].includes(target);
}
/** Source drawing computes its ease window from speed and closure. The saved
 * local easeDuration field stays intact for explicit local-v1 selection. */
export function isSpirographIgnoredTarget(scene:SceneDocument,target:string):boolean {
  return scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)!=='local-v1'&&['settings.easeDuration','settings.scaleZ','settings.offsetZ'].includes(target);
}
export function readAnimationValue(scene: SceneDocument, target: string): number {
  if(!rootMathAnimationTargetEnabled(scene,target))throw new Error('源复根数学不使用此本地数学动画目标；原轨道保留但未执行');
  if(isSpirographEventTarget(scene,target))throw new Error('旋轮绘制事件不能作为连续数值动画目标');
  if(isSpirographIgnoredTarget(scene,target))throw new Error(target==='settings.easeDuration'?'源旋轮使用自适应缓动，不能动画修改缓动时长':'源二维旋轮不使用 Z 缩放或偏移，不能动画修改这些字段');
  const [group, key, extra] = target.split('.');
  if (!key || extra || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`无效动画目标 ${target}`);
  if(group==='fractalColor'){const value=readFractalSourceColorAnimation(scene,target);if(value!==undefined)return finite(value,target);}
  if (group === 'parameters' && Object.hasOwn(scene.parameters, key)) return finite(scene.parameters[key], target);
  if (group === 'settings' && key === 'samilaCameraTheta') {
    const frame = samilaCameraFrame(scene); if (frame) return frame.theta;
  }
  if(group==='settings'&&key==='paletteOffset'&&scene.kind==='domain')return readGradientOffsets(scene).palette;
  if (group === 'settings' && Object.hasOwn(scene.settings, key) && typeof scene.settings[key] === 'number') return finite(Number(scene.settings[key]), target);
  if(group==='settings'&&scene.kind==='roots'&&scene.settings[key]===undefined&&Object.hasOwn(ROOTS_SOURCE_TONE_DEFAULTS,key))return ROOTS_SOURCE_TONE_DEFAULTS[key];
  if (group === 'palette' && ['offset', 'cycles'].includes(key)) return scene.palette[key as 'offset' | 'cycles'];
  if (group === 'camera') {
    if(key==='theta')return samilaCameraFrame(scene)?.theta??angles(scene).theta;
    const {camera,roll,focalLength}=sceneCamera(scene);
    if (['x', 'y', 'z'].includes(key)) return camera.position[['x', 'y', 'z'].indexOf(key)];
    if (['targetX', 'targetY', 'targetZ'].includes(key)) return camera.target[['targetX', 'targetY', 'targetZ'].indexOf(key)];
    if (key === 'zoom') return camera.zoom;
    if (key === 'gamma') return roll;
    if (key === 'focalLength') return focalLength;
  }
  throw new Error(`动画目标不存在或不是数值：${target}`);
}
const deferredTracking=new WeakMap<SceneDocument,()=>void>();
const writtenTargets=new WeakMap<SceneDocument,Set<string>>();
/** Facts for this evaluated object only. Held values still control their target;
 * disabled/future plans do not. Nothing is persisted or inferred from raw clips. */
export function timelineControlsTarget(evaluatedScene:SceneDocument,target:string):boolean {
  return writtenTargets.get(evaluatedScene)?.has(target)??false;
}
function recordWrittenTarget(scene:SceneDocument,target:string) {
  let targets=writtenTargets.get(scene);if(!targets)writtenTargets.set(scene,targets=new Set());targets.add(target);
}
function writeValue(scene: SceneDocument, target: string, value: number) {
  finite(value, target); readAnimationValue(scene, target);
  const [group, key] = target.split('.');
  if (group === 'parameters') scene.parameters[key] = value;
  else if (group === 'settings') {scene.settings[key] = value;refreshCameraSetting(scene,key);}
  else if(group==='fractalColor')writeFractalSourceColorAnimation(scene,target,value);
  else if (group === 'palette') scene.palette[key as 'offset' | 'cycles'] = value;
  else if (key === 'theta') {if(samilaCameraEnabled(scene))writeSamilaTheta(scene,value);else setAngles(scene,{theta:value});recordWrittenTarget(scene,target);return;}
  else if (key === 'zoom') { if (value <= 0) throw new Error('相机缩放必须大于零'); writableSceneCamera(scene).zoom = value; }
  else if (key === 'gamma') writeCameraOptics(scene,'gamma',value);
  else if (key === 'focalLength') writeCameraOptics(scene,'focalLength',value);
  else if (key.startsWith('target')) writableSceneCamera(scene).target[['targetX', 'targetY', 'targetZ'].indexOf(key)] = value;
  else writableSceneCamera(scene).position[['x', 'y', 'z'].indexOf(key)] = value;
  if (group === 'camera') {writableSceneCamera(scene).autoFit = false;if(['x','y','z','targetX','targetY','targetZ'].includes(key))deferredTracking.delete(scene);}
  recordWrittenTarget(scene,target);
}
// Spherical coordinates have multiple representations. Keep the sampled winding
// while its direction still matches the camera, instead of folding at each pole.
const orientations = new WeakMap<SceneDocument, { theta: number; phi: number }>();
function angles(scene: SceneDocument) {
  const scalar=samilaCameraFrame(scene);if(scalar)return{theta:scalar.theta,phi:0,gamma:0,radius:1};
  const {camera,roll}=sceneCamera(scene);
  const [x, y, z] = camera.position.map((v, i) => v - camera.target[i]);
  const radius = Math.hypot(x, y, z);
  const cached = orientations.get(scene), matches = cached && radius > 0 && Math.hypot(
    Math.sin(cached.theta) * Math.cos(cached.phi) - x / radius,
    Math.sin(cached.phi) - y / radius,
    Math.cos(cached.theta) * Math.cos(cached.phi) - z / radius,
  ) < 1e-10;
  return { theta: matches ? cached.theta : Math.atan2(x, z), phi: matches ? cached.phi : radius ? Math.asin(clamp(y / radius, -1, 1)) : 0, gamma: roll, radius: radius || 1 };
}
function setAngles(scene: SceneDocument, update: Partial<ReturnType<typeof angles>>) {
  if(samilaCameraEnabled(scene)){if(update.theta!==undefined)writeSamilaTheta(scene,update.theta);return;}
  const { theta, phi, gamma, radius } = { ...angles(scene), ...update };
  const camera=writableSceneCamera(scene);
  camera.position = [Math.sin(theta) * Math.cos(phi) * radius, Math.sin(phi) * radius, Math.cos(theta) * Math.cos(phi) * radius].map((v, i) => finite(v + camera.target[i], '相机位置')) as [number, number, number];
  orientations.set(scene, { theta, phi });
  writeCameraOptics(scene,'gamma',finite(gamma, '相机滚转')); camera.autoFit = false;
}


interface Plan { start: number; apply: (out: SceneDocument, time: number) => void; }
interface Continuous { start: number; duration: number; easing: string; completion: 'easing-endpoint' | 'gradient-lifecycle' | 'domain-parameter-lifecycle'; cutoff?: number; stop?: { start: number; duration: number; easing: string }; }
function integrateSamples(sample: (at:number)=>number, fraction: number) {
  const b = clamp(fraction), n = 64, h = b / n;
  let sum = sample(0) + sample(b);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * sample(i * h);
  return sum * h / 3;
}
function integrateCurve(name: string, fraction: number, bounded = true) {
  return integrateSamples(at=>bounded?clamp(ease(name,at)):ease(name,at),fraction);
}
interface AngularRateTransition { start:number;duration:number;easing:string;from:number;to:number;arithmetic?:'source-float32';sampleRate?:(at:number)=>number; }
function angularRateAt(effect:AngularRateTransition,time:number):number {
  if(effect.sampleRate)return finite(effect.sampleRate(time),'旋轮角速度');
  const progress=effect.duration===0?1:clamp((time-effect.start)/effect.duration);
  // The source interpolates the speed itself, and does not clamp overshooting
  // easing outputs or force the target in onFinish.
  if(effect.arithmetic==='source-float32'){
    const eased=Math.fround(ease(effect.easing,Math.fround(progress)));
    return finite(Math.fround(effect.from+Math.fround(Math.fround(effect.to-effect.from)*eased)),'旋轮角速度');
  }
  return effect.from+(effect.to-effect.from)*ease(effect.easing,progress);
}
function angularRotationDelta(effect:AngularRateTransition,time:number):number {
  const elapsed=Math.max(0,time-effect.start),duration=effect.duration;
  if(duration===0)return angularRateAt(effect,time)*elapsed;
  if(effect.arithmetic==='source-float32'){
    // Deterministic continuous integration permits cold seek and export. The
    // source's frame-by-frame float accumulation depends on its live dt; it is
    // not claimed to have the same low bits as this declared local clock.
    return duration*integrateSamples(fraction=>angularRateAt(effect,effect.start+duration*fraction),Math.min(elapsed/duration,1))
      +angularRateAt(effect,effect.start+duration)*Math.max(0,elapsed-duration);
  }
  const active=Math.min(elapsed,duration),area=duration*integrateCurve(effect.easing,active/duration,false);
  return effect.from*active+(effect.to-effect.from)*area+angularRateAt(effect,effect.start+duration)*Math.max(0,elapsed-duration);
}
function continuousFrame(effect: Continuous, time: number): { seconds: number; running: boolean } {
  if(effect.completion==='domain-parameter-lifecycle'){
    // Start/StopDomainParamAnimation.onFinish explicitly sets 1 / 0;
    // DomainParameterAnimator.setStepScale clamps only the lower bound.
    const stopEnd=effect.stop?effect.stop.start+effect.stop.duration:Infinity;
    const running=time>=effect.start&&time<Math.min(effect.cutoff??Infinity,stopEnd);
    time=Math.min(time,effect.cutoff??Infinity,stopEnd);
    const sample=(name:string,t:number,stop=false)=>Math.max(0,stop?1-Math.fround(ease(name,Math.fround(t))):Math.fround(ease(name,Math.fround(t))));
    const area=(name:string,fraction:number,stop=false)=>{
      const b=clamp(fraction),n=64,h=b/n;let sum=sample(name,0,stop)+sample(name,b,stop);
      for(let i=1;i<n;i++)sum+=(i%2?4:2)*sample(name,i*h,stop);
      return sum*h/3;
    };
    const elapsed=Math.max(0,time-effect.start),duration=effect.duration;
    const ramp=(seconds:number)=>duration===0?seconds:duration*area(effect.easing,seconds/duration)+Math.max(0,seconds-duration);
    if(!effect.stop||time<=effect.stop.start)return{seconds:ramp(elapsed),running};
    const atStop=Math.max(0,effect.stop.start-effect.start),gain=duration===0||atStop>=duration?1:sample(effect.easing,atStop/duration);
    return{seconds:ramp(atStop)+gain*effect.stop.duration*area(effect.stop.easing,effect.stop.duration===0?1:(time-effect.stop.start)/effect.stop.duration,true),running};
  }
  const lifecycle = effect.completion === 'gradient-lifecycle';
  const stopEnd = effect.stop ? effect.stop.start + effect.stop.duration : Infinity;
  const running = time >= effect.start && time < Math.min(effect.cutoff ?? Infinity, stopEnd);
  // Source gradient onFinish explicitly sets speed to 1 / 0. Legacy local
  // palette, parameter and rotation animations retain their easing endpoints.
  time = Math.min(time, effect.cutoff ?? Infinity, lifecycle ? stopEnd : Infinity);
  const elapsed = Math.max(0, time - effect.start), d = effect.duration;
  const ramp = (seconds: number) => d === 0 ? seconds : d * integrateCurve(effect.easing, seconds / d) + (lifecycle ? 1 : clamp(ease(effect.easing, 1))) * Math.max(0, seconds - d);
  if (!effect.stop || time <= effect.stop.start) return { seconds: ramp(elapsed), running };
  const atStop = Math.max(0, effect.stop.start - effect.start), gain = d === 0 || lifecycle && effect.stop.start >= effect.start + d ? 1 : clamp(ease(effect.easing, atStop / d));
  if (effect.stop.duration <= 0) return { seconds: ramp(atStop), running };
  const seconds = Math.max(0, time - effect.stop.start), after = clamp(seconds / effect.stop.duration);
  return { seconds: ramp(atStop) + gain * (effect.stop.duration * (after - integrateCurve(effect.stop.easing, after))
    + (lifecycle ? 0 : 1 - clamp(ease(effect.stop.easing, 1))) * Math.max(0, seconds - effect.stop.duration)), running };
}
function actionNumber(action: AnimationAction, key: string, fallback = 0) {
  const raw = action.args?.[key] ?? fallback;
  if (typeof raw !== 'number') throw new Error(`${action.method}.${key} 必须是数值`);
  return finite(raw, `${action.method}.${key}`);
}
export function validateParameterAnimations(value:unknown,sceneKind?:SceneDocument['kind']):ParameterAnimation[]{
 if(!Array.isArray(value)||value.length>128)throw new Error('单片段最多128个参数振荡');
 return value.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('参数振荡必须为对象');const p=raw as ParameterAnimation;
  if(typeof p.target!=='string'||p.target.length>200||typeof p.enabled!=='boolean')throw new Error('参数振荡目标或范围无效');
  validateOscillationRange(p);
  if(p.model==='domain-1.7.8'&&sceneKind!==undefined&&sceneKind!=='domain')throw new Error('原产物 Domain 参数振荡仅适用于域着色');
  if(p.round!==undefined&&typeof p.round!=='boolean')throw new Error('参数振荡相位或取整无效');
  if(p.binding&&(p.binding.mode!=='complex-full'||typeof p.binding.imaginaryTarget!=='string'||p.binding.imaginaryTarget.length>200))throw new Error('复参数绑定无效');
  const edge=p.edgeEasing?parseOscillationEdge(p.edgeEasing):undefined;if(edge)easingCurve(edge.easing);
  return{...p,...(edge?{edgeEasing:edge}:{})};
 });
}
export type SourceParticleActionFamily='surface'|'attractor'|'perlin'|'symmetry'|'symmetry-parameters'|'map-parameters';
export function sourceParticleActionFamily(scene:SceneDocument):SourceParticleActionFamily|undefined{return usesSourceMapParameters(scene)?'map-parameters':usesSourceSymmetryParameters(scene)?'symmetry-parameters':usesSourcePerlin(scene)?'perlin':usesSourceSurfaceGeometry(scene)?'surface':usesSourceAttractor(scene)?'attractor':usesSourceSymmetryGradient(scene)?'symmetry':undefined;}
export function validateTimelineExtensions(track:AnimationTrack,sceneKind?:SceneDocument['kind'],schedule?:SceneDocument['timeline']['schedule'],sourceFamily?:SourceParticleActionFamily):void{
 if(schedule===DOMAIN_SCENE_SEQUENCE){if(sceneKind!=='domain')throw Error('域着色源队列仅用于域着色作品');validateSourceDomainTrack(track);return;}
 if(schedule===FRACTAL_SCENE_SEQUENCE){if(sceneKind!=='fractal')throw Error('源分形队列仅用于分形作品');validateSourceFractalTrack(track);return;}
 if(track.fractalSource!==undefined)throw Error('源分形动作缺少对应队列');
 const sourceSurface=sourceFamily==='surface',sourcePerlin=sourceFamily==='perlin';
 if(Array.isArray(track.actions))for(const action of track.actions){
  if(action?.sourceEffect===undefined)continue;
  if(action.sourceEffect!=='unmapped'||sceneKind!=='implicit'||schedule!=='ordinary-camera-sequence-v1'||track.type!=='animate'||!['paramStart','paramStop'].includes(action.method)||Object.keys(action).some(key=>!['id','method','enabled','sourceEffect'].includes(key)))throw Error('未映射源效果必须保留为无执行参数的隐式动作');
 }
 if(track.sourceFractalZoom!==undefined){
  if(track.type!=='fractal_zoom'||sceneKind!=='fractal'||track.keyframes!==undefined||track.interpolation!==undefined||track.pingPong||(track.repeat??1)!==1)throw Error('原版分形目标缩放不能混用关键帧、往返或重复');
  const parsed=parseSourceFractalZoomTarget(track.sourceFractalZoom);if(!parsed.ok)throw Error(parsed.error.reason);
  if(!SOURCE_EASING_NAMES.includes(track.easing)||!Number.isFinite(track.duration)||track.duration<Math.fround(1e-4)||track.duration>86400)throw Error('原版分形缩放曲线或时长无效');
 }
 if(Array.isArray(track.actions))for(const action of track.actions){if(action?.samilaParameters!==undefined){if(sceneKind!=='samila'||schedule!==SAMILA_SCENE_SEQUENCE||!['paramStart','paramStop'].includes(action.method))throw new Error('Samila 源参数只适用于源 Samila 队列');const parsed=normalizeSourceSamilaParameterAction(action.samilaParameters);if(!parsed.ok)throw new Error(parsed.error.reason);}}
 if(Array.isArray(track.actions))for(const action of track.actions){if(action?.perlinParameters!==undefined){if(!sourcePerlin||!['paramStart','paramStop'].includes(action.method))throw new Error('Perlin 源参数只能用于源 Perlin 作品');const parsed=parseSourcePerlinParameterAction(action.perlinParameters);if(!parsed.ok)throw new Error(parsed.error.reason);}}
 if(track.spirographWait!==undefined&&(track.spirographWait!=='visual-or-deadline-v1'||track.type!=='spirograph_finish_wait'||sceneKind!==undefined&&sceneKind!=='spirograph'))throw new Error('旋轮完成等待规则无效');
 if(track.surfaceFadeOutRatio!==undefined&&(track.type!=='surface_mode_transition'||typeof track.surfaceFadeOutRatio!=='number'||!Number.isFinite(track.surfaceFadeOutRatio)||!Number.isFinite(Math.fround(track.surfaceFadeOutRatio))))throw new Error('曲面淡出比例无效');
 if(track.gradient!==undefined)validateGradientConfig(track.gradient);
 if(track.surfaceParameterClip!==undefined||sourceSurface&&track.type==='param'){if(!sourceSurface||track.type!=='param'||track.parameterAnimations!==undefined||track.parameterClock!==undefined||track.replaceParameters!==undefined)throw new Error('曲面源参数片段不能混用其他参数模型');parseSourceSurfaceParameterClip(track.surfaceParameterClip);}
 if(track.alignMode!==undefined&&!['absolute','next-turn'].includes(track.alignMode))throw new Error('未知相机对齐模式');
 if(track.orientation!==undefined){if(!track.orientation||typeof track.orientation!=='object'||Array.isArray(track.orientation)||Object.keys(track.orientation).some(key=>!['theta','phi','gamma'].includes(key))||Object.values(track.orientation).some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('相机对齐目标无效');}
 if(track.parameterClock!==undefined&&!['elapsed','eased'].includes(track.parameterClock)||track.replaceParameters!==undefined&&typeof track.replaceParameters!=='boolean')throw new Error('参数时钟配置无效');
 if(track.parameterAnimations!==undefined)track.parameterAnimations=validateParameterAnimations(track.parameterAnimations,sceneKind);
 if(track.actions!==undefined){if(!Array.isArray(track.actions)||track.actions.length>64)throw new Error('片段动作无效');for(const action of track.actions){if(!action||typeof action!=='object')throw new Error('动画动作无效');if(action.mapParameters!==undefined||sourceFamily==='map-parameters'&&['paramStart','paramStop'].includes(action.method)){if(sourceFamily!=='map-parameters'||!['paramStart','paramStop'].includes(action.method)||action.parameters!==undefined||action.symmetryParameters!==undefined||action.domainParameters!==undefined||action.surfaceParameters!==undefined||action.perlinParameters!==undefined||action.samilaParameters!==undefined)throw Error('Map 源参数不能混用其他参数模型');parseSourceMapParameterActions(action.mapParameters,action.method as 'paramStart'|'paramStop');}if(action.symmetryParameters!==undefined||sourceFamily==='symmetry-parameters'&&['paramStart','paramStop'].includes(action.method)){if(sourceFamily!=='symmetry-parameters'||!['paramStart','paramStop'].includes(action.method)||action.parameters!==undefined||action.domainParameters!==undefined||action.surfaceParameters!==undefined||action.perlinParameters!==undefined||action.samilaParameters!==undefined)throw Error('Symmetry 源参数不能混用其他参数模型');parseSourceSymmetryParameterActions(action.symmetryParameters,action.method as 'paramStart'|'paramStop');}if(action.surfaceParameters!==undefined||sourceSurface&&['paramStart','paramStop'].includes(action.method)){if(!sourceSurface||!['paramStart','paramStop'].includes(action.method)||action.parameters!==undefined||action.domainParameters!==undefined)throw new Error('曲面源参数动作不能混用其他参数模型');parseSourceSurfaceParameterActions(action.surfaceParameters,action.method as 'paramStart'|'paramStop');}if(action.parameters!==undefined)action.parameters=validateParameterAnimations(action.parameters,sceneKind);if(action.domainParameters!==undefined){if(action.parameters!==undefined)throw new Error('域参数注册表不能同时声明旧参数振荡');action.domainParameters=validateDomainParameterActions(action.domainParameters,action.method,sceneKind,easingCurve);}if(action.gradient!==undefined){
  // Authored full-scene configuration has one contract even while its clip is
  // disabled. Camera-only markers retain the older generic validation rules.
  if(sceneKind==='roots'&&schedule==='roots-scene-sequence-v1'&&action.method==='gradientStart')parseRootsGradientConfiguration(action.gradient);
  else if(sourceFamily!==undefined&&sourceFamily!=='map-parameters'&&action.method==='gradientStart')parseSourceParticleGradientConfiguration(action.gradient);
  else validateGradientConfig(action.gradient);
 }}}
}
function validateTrack(track: AnimationTrack, scene: SceneDocument) {
  validateSourceSymmetryParameters(scene);validateSourceMapParameters(scene);
  if (!Number.isFinite(track.start) || track.start < 0) throw new Error('片段起点必须是非负有限数值');
  if (!CLIP_TYPES.some(item => item.type === (track.type ?? 'numeric'))) throw new Error(`未知片段类型 ${track.type}`);
  if (track.actions && (!Array.isArray(track.actions) || track.actions.length > 64)) throw new Error('单片段最多64个动作');
  validateTimelineExtensions(track,scene.kind,scene.timeline.schedule,sourceParticleActionFamily(scene));if(!track.sourceFractalZoom)clipProgress(track, track.start, clipDuration(track, scene));
}

type TimelineEvaluator = (position: number, base: SceneDocument) => SceneDocument;
const compiledTimelines = new Map<string, TimelineEvaluator>();
/** Explicit source recording ordinals bypass local seconds/loop sampling. */
export function sceneAtFractalFrame(scene:SceneDocument,displayFrame:number,isCancelled?:()=>boolean):SceneDocument {
 if(!usesSourceFractal(scene))throw Error('分形录制帧需要完整源分形配置');
 const out=copyState(scene);for(const target of bindSourceFractalFrame(out,replaySourceFractalFrame(scene,displayFrame,isCancelled)))recordWrittenTarget(out,target);return out;
}
export function sceneAtDomainFrame(scene:SceneDocument,displayFrame:number,isCancelled?:()=>boolean):SceneDocument {
 if(!usesSourceDomain(scene))throw Error('域着色逐帧回放需要显式源队列');const out=copyState(scene);for(const target of bindSourceDomainFrame(out,replaySourceDomainFrame(scene,displayFrame,isCancelled)))recordWrittenTarget(out,target);return out;
}
/** Pure evaluation: starts are ordered chronologically, ties follow document order. */
export function sceneAtTime(scene: SceneDocument, position: number, options?:{isCancelled?:()=>boolean}): SceneDocument {
  finite(position, '时间位置');
  if(usesSourceDomain(scene)){const out=copyState(scene);for(const target of bindSourceDomainFrame(out,replaySourceDomain(scene,position,options?.isCancelled)))recordWrittenTarget(out,target);return out;}
  if(usesSourceFractal(scene)){const out=copyState(scene);for(const target of bindSourceFractalFrame(out,replaySourceFractal(scene,position,options?.isCancelled)))recordWrittenTarget(out,target);return out;}
  if(usesSourceBouncing(scene)){
    const prepared=prepareSourceBouncingScene(scene);if(!prepared.ok)throw new Error(prepared.error.reason);
    return copyState(scene); // Display snapshot only; explicit checkpoints own physics.
  }
  if(usesRootsCameraTimeline(scene)){
    const copied=copyState(scene),facts=rootsCameraAtTime(scene,position);
    copied.evaluatedRootsCamera=facts;
    return copied;
  }
  if(usesSpirographFrameClock(scene))return sceneAtSpirographFrame(scene,position);
  const resolved=resolveTimeline(scene);
  if(usesSourceSamilaTimeline(scene)){const copied=copyState(scene,position),frame=replaySourceSamilaTimeline(scene,clamp(position,0,resolved.duration));copied.parameters={...frame.parameters};writeSamilaTheta(copied,frame.camera.theta);bindSourceSamilaFrame(copied,frame);return copied;}
  // The native Attractor queue owns every supported action. Do not compile it
  // again as local palette/parameter animation, or retain duplicate snapshots
  // in the generic timeline cache. Geometry and camera replay share this owner.
  if(usesSourceAttractor(scene)||usesSourcePerlin(scene))return copyState(scene,clamp(position,0,resolved.duration));
  if (!Number.isFinite(scene.timeline.duration) || scene.timeline.duration <= 0 || scene.timeline.tracks.length > 1000) throw new Error('时间线时长或片段数无效');
  if (!scene.timeline.tracks.length) return copyState(scene,scene.timeline.schedule===undefined?position:clamp(position,0,resolved.duration));
  // Content identity works across worker messages and detects edits to the same
  // object. Compilation owns a snapshot, so later caller mutation cannot alter it.
  // Unresolved native variable labels are metadata, and may retain a nonfinite
  // parsed JSON number alongside its exact token. They affect identity without
  // becoming a mathematical value or being erased by JSON's null conversion.
  const rootsMathIdentity=JSON.stringify(scene.rootsMath,(_key,value:unknown)=>typeof value==='number'&&!Number.isFinite(value)?{nonfinite:String(value)}:value);
  // Presentation is authored independently of legacy camera/settings. Preserve
  // its original doubles (including signed zero) in both identity and snapshot;
  // this does not activate new presentation animation targets or render rules.
  const rootsPresentationIdentity=JSON.stringify(scene.rootsPresentation,(_key,value:unknown)=>typeof value==='number'?Object.is(value,-0)?{negativeZero:true}:finite(value,'时间线文档数值'):value);
  const fractalSourceColorIdentity=JSON.stringify(scene.fractalSourceColor,(_key,value:unknown)=>typeof value==='number'?Object.is(value,-0)?{negativeZero:true}:finite(value,'时间线文档数值'):value);
  const sourceCameraIdentity=JSON.stringify(scene.sourceCamera,(_key,value)=>typeof value==='number'&&Object.is(value,-0)?{negativeZero:true}:value);
  const surfaceSourceIdentity=JSON.stringify(scene.surfaceSource,(_key,value)=>typeof value==='number'&&Object.is(value,-0)?{negativeZero:true}:value);
  const key = JSON.stringify({ sourceCameraIdentity, surfaceSourceIdentity, rootsMathIdentity, rootsPresentationIdentity, fractalSourceColorIdentity, kind: scene.kind, equations:scene.equations, parameters: scene.parameters, settings: scene.settings, palette: scene.palette, domainSourcePalette:scene.domainSourcePalette, rootsSourcePalette:scene.rootsSourcePalette, surfaceSourcePalette:scene.surfaceSourcePalette, camera: scene.camera, timeline: scene.timeline }, (_key, value: unknown) => typeof value === 'number' ? finite(value, '时间线文档数值') : value);
  let evaluate = compiledTimelines.get(key);
  if (!evaluate) {
    const snapshot=JSON.parse(key);
    // Cache-only identities are not authored document fields. Their owning
    // payloads are copied explicitly below to preserve non-JSON numeric facts.
    delete snapshot.sourceCameraIdentity;delete snapshot.surfaceSourceIdentity;delete snapshot.rootsMathIdentity;delete snapshot.rootsPresentationIdentity;delete snapshot.fractalSourceColorIdentity;
    evaluate = compileTimeline({ ...scene, ...snapshot, ...(scene.surfaceSource?{surfaceSource:structuredClone(scene.surfaceSource)}:{}), ...(scene.sourceCamera?{sourceCamera:structuredClone(scene.sourceCamera)}:{}), ...(scene.fractalSourceColor?{fractalSourceColor:structuredClone(scene.fractalSourceColor)}:{}), ...(scene.rootsMath?{rootsMath:structuredClone(scene.rootsMath)}:{}), ...(scene.rootsPresentation?{rootsPresentation:structuredClone(scene.rootsPresentation)}:{}) });
    if (key.length <= 1_000_000) {
      if (compiledTimelines.size >= 4) compiledTimelines.delete(compiledTimelines.keys().next().value!);
      compiledTimelines.set(key, evaluate);
    }
  } else {
    compiledTimelines.delete(key); compiledTimelines.set(key, evaluate);
  }
  return evaluate(clamp(position, 0, resolved.duration), scene);
}
export interface ParticleCameraPlan {
 requests:readonly ParticleCameraRequest[];
 resolve(samples:ReadonlyMap<string,ParticleCameraSample>):{frame:CameraFrame;warnings:string[]};
}
/** Two-phase camera evaluation. Discovery never samples or simulates particles;
 * the producer supplies facts from its one CPU/GPU trajectory. Recompiling the
 * small timeline with those facts also resolves historical camera baselines for
 * later actions, without serializing closures or persisting runtime state. */
export function prepareParticleCamera(scene:SceneDocument,position:number):ParticleCameraPlan|undefined{
 if(scene.sourceCamera)return;
 if(scene.kind!=='attractor'||!supportsParticleTracking(scene)||!scene.timeline.tracks.some(track=>track.enabled&&track.start<=position&&track.actions?.some(action=>action.enabled!==false&&action.method==='track'&&action.args&&Object.hasOwn(action.args,'index'))))return;
 sceneAtTime(scene,position); // Reuse the public document/timeline validation.
 const snapshot=structuredClone(scene),time=clamp(position,0,scene.timeline.duration),requests=new Map<string,ParticleCameraRequest>();
 const discover=(request:ParticleCameraRequest)=>{const key=particleCameraKey(request);if(!requests.has(key)){if(requests.size>=MAX_CAMERA_SAMPLES)throw new Error('相机跟踪采样超过 16384 个位置的有界缓存预算');requests.set(key,request);}return[0,0,0];};
 compileTimeline(snapshot,discover,time)(time,snapshot);
 // An unavailable newer target is a no-op, so an older target may still be
 // needed at that boundary. Capture the finite index/time product in the same
 // forward simulation, rather than discovering a missing past sample later.
 const indices=[...new Set([...requests.values()].map(r=>r.index))],times=[...new Set([...requests.values()].map(r=>r.time))];
 for(const index of indices)for(const at of times)discover({index,time:at});
 return{requests:[...requests.values()].sort((a,b)=>a.time-b.time||a.index-b.index),resolve(samples){
  const warnings=new Set<string>();
  const lookup=(request:ParticleCameraRequest)=>{
   const sample=samples.get(particleCameraKey(request));if(!sample)throw new Error('相机跟踪生产者缺少请求的位置事实');
   if(sample.status!=='available'){warnings.add(`吸引子跟踪索引 ${request.index} 在 ${request.time} 秒${sample.status==='out-of-range'?'越界':'死亡或位置无效'}；该跟踪动作未应用。`);return;}
   if(!sample.position.every(Number.isFinite))throw new Error('相机跟踪生产者返回非有限位置');return sample.position;
  };
  const evaluated=compileTimeline(snapshot,lookup,time)(time,snapshot),view=sceneCamera(evaluated);
  return{frame:{time:position,camera:{...view.camera,position:[...view.camera.position],target:[...view.camera.target]},roll:view.roll,focalLength:view.focalLength},warnings:[...warnings]};
 }};
}
function compileTimeline(scene: SceneDocument, particlePosition?: (request:ParticleCameraRequest)=>readonly number[]|undefined, throughTime=Infinity): TimelineEvaluator {
  const gradientCapabilities=gradientAnimationCapabilities(scene);
  const sourceDomainRotation=scene.kind==='domain'&&parseDomainViewportVersion(scene.settings.domainViewportVersion)!=='local-v1';
  const sourceSpirographRotation=scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)==='mathart-1.7.8-v1';
  let domainRate:AngularRateTransition|undefined,spirographRate:AngularRateTransition|undefined;
  const plans: Plan[] = [], continuous = new Map<string, Continuous>();
  const domainParameters=new DomainParameterTimeline(easingCurve);
  const tracks = resolveTimeline(scene).tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.enabled&&track.start<=throughTime).sort((a, b) => a.track.start - b.track.start || a.index - b.index);
  validateTimelineCapacity(tracks.map(({track})=>track));
  const evaluate = (at: number, base = scene, resolveTargets=true):SceneDocument => { const state = copyState(base,at); for (const plan of plans) if (at >= plan.start) plan.apply(state, at); if(resolveTargets)deferredTracking.get(state)?.();return state; };
  function stop(key: string, track: AnimationTrack, instant = false) {
    const existing = continuous.get(key);
    if (existing && instant) existing.cutoff = Math.min(existing.cutoff ?? Infinity, track.start);
    else if (existing && !existing.stop) existing.stop = { start: track.start, duration: clipDuration(track, scene), easing: track.easing };
  }
  function registerContinuous(key: string, track: AnimationTrack, completion: Continuous['completion'] = 'easing-endpoint') {
    stop(key, track, true);
    const effect: Continuous = { start: track.start, duration: clipDuration(track, scene), easing: track.easing, completion };
    continuous.set(key, effect); return effect;
  }
  function numeric(track: AnimationTrack, baseline: SceneDocument, target: string, to: number, from?: number) {
    if(inactiveFractalSourceColorTarget(scene,target)||!rootMathAnimationTargetEnabled(scene,target)||!gradientCapabilities.localPalette&&isLocalPaletteAnimationTarget(target))return;
    if(sourceSpirographRotation&&target==='settings.rotationSpeed'){
      // Numeric rate authoring is a local extension. The same angular owner
      // integrates it, including repeat/round/ping-pong, and hands its current
      // rate to a later native rate action. The renderer never reinterprets it.
      const start=spirographSourceRotationRate(from??(spirographRate?angularRateAt(spirographRate,track.start):readAnimationValue(baseline,target)));
      spirographSourceRotationRate(to);
      const rotation=finite(baseline.evaluatedSpirographRotationRadians??0,'旋轮运行时旋转');
      const effect:AngularRateTransition={start:track.start,duration:track.duration,easing:track.easing,from:start,to,arithmetic:'source-float32',sampleRate:at=>{
        const value=mix(start,to,clipProgress(track,at));return Math.fround(track.round?Math.round(value):value);
      }};
      spirographRate=effect;
      plans.push({start:track.start,apply:(out,at)=>{
        out.evaluatedSpirographRotationRadians=finite(rotation+angularRotationDelta(effect,at),'旋轮运行时旋转');
        writeValue(out,target,angularRateAt(effect,at));
      }});return;
    }
    const start = from ?? readAnimationValue(baseline, target); finite(to, '动画终值');
    plans.push({ start: track.start, apply: (out, at) => { const v = mix(start, to, clipProgress(track, at)); writeValue(out, target, track.round ? Math.round(v) : v); } });
  }
  function oscillators(track: AnimationTrack, ranges: ParameterAnimation[], continuousMode: boolean, sourceStartup?:SceneDocument) {
    if (ranges.length > 128) throw new Error('单片段最多128个参数振荡');
    for (const parameter of validateParameterAnimations(ranges,scene.kind)) {
      if (!parameter.enabled||inactiveFractalSourceColorTarget(scene,parameter.target)||!rootMathAnimationTargetEnabled(scene,parameter.target)) continue;
      if(sourceSpirographRotation&&parameter.target==='settings.rotationSpeed')throw new Error('旋轮角速度请使用数值片段或旋轮线旋转动作');
      if(!gradientCapabilities.localPalette&&isLocalPaletteAnimationTarget(parameter.target))continue;
      for (const [key, value] of Object.entries(parameter)) if (typeof value === 'number') finite(value, key);
      // Source AnimationGroup starts every action before the first parameter
      // update. syncPhase reads but never writes the parameter, so later starts
      // in that group must not consume an earlier synthesized t=0 sample.
      const baseline = parameter.model==='domain-1.7.8'&&sourceStartup?sourceStartup:evaluate(track.start), initial = readAnimationValue(baseline, parameter.target),{middle,half,phase,rate}=prepareParameterOscillation(parameter,initial);
      const effect = continuousMode ? registerContinuous(`param:${parameter.target}`, track,parameter.model==='domain-1.7.8'?'domain-parameter-lifecycle':'easing-endpoint') : undefined;
      const edge=parameter.edgeEasing?parseOscillationEdge(parameter.edgeEasing):undefined;
      const phaseTimeline=edge?new EdgePhaseTimeline(phase,rate,edge,easingCurve(edge.easing),parameter.model==='domain-1.7.8'):undefined;
      if(parameter.binding&&complexCompanion(scene,parameter.target)!==parameter.binding.imaginaryTarget)throw new Error('复参数绑定不匹配当前公式');
      const frozenImag=parameter.binding?.mode==='complex-full'?readAnimationValue(baseline,parameter.binding.imaginaryTarget):undefined;
      plans.push({ start: track.start, apply: (out, at) => {
        const seconds = effect ? continuousFrame(effect, at).seconds : track.parameterClock==='elapsed'?clamp(at-track.start,0,track.duration):clipProgress(track, at) * track.duration;
        const value = half ? middle + half * Math.sin(phaseTimeline?phaseTimeline.sample(seconds):phase + rate * seconds) : middle;
        writeValue(out, parameter.target, parameter.round?Math.round(value):value);
        if(frozenImag!==undefined)writeValue(out,parameter.binding!.imaginaryTarget,frozenImag);
      } });
    }
  }
  function gradient(track: AnimationTrack, config: GradientAnimation) {
    if(usesSourceSymmetryGradient(scene))return;
    validateGradientConfig(config);
    if(config.model!=='offsets'&&!gradientCapabilities.localPalette)return;
    if(config.model==='offsets'){
      const apply=compileGradientOffsets(evaluate(track.start),config),effect=registerContinuous('gradient',track,'gradient-lifecycle');
      plans.push({start:track.start,apply:(out,at)=>{
        const frame=continuousFrame(effect,at);apply(out,frame.seconds);
        if(out.kind==='domain')out.evaluatedDomainGradient={running:frame.running,interpolation:config.interpolation};
        if(usesFractalSourceColor(out)){
          if(frame.running)out.evaluatedFractalGradient={interpolation:config.interpolation,cyclic:true};else delete out.evaluatedFractalGradient;
          for(const target of FRACTAL_SOURCE_COLOR_ANIMATION_TARGETS)recordWrittenTarget(out,target);
        }
      }});return;
    }
    const baseline = evaluate(track.start), from = config.fromStops ?? baseline.palette.stops, to = config.toStops ?? [...from].reverse();
    const fromPositions = config.fromStops ? undefined : baseline.palette.positions;
    const toPositions = config.toStops ? undefined : fromPositions?.map(position => 1 - position).reverse();
    for (const stops of [config.fromStops, config.toStops]) if (stops && stops.length > 32) throw new Error('渐变编辑输入最多32个色标');
    validatePalettePositions(from, fromPositions); validatePalettePositions(to, toPositions);
    from.forEach(rgb); to.forEach(rgb);
    const morph = config.mode === 'palette_morph' || config.mode === 'cross_fade';
    const knots = (stops: string[], positions?: number[]) => positions ?? stops.map((_, i) => i / (stops.length - 1));
    const positions = morph ? [...new Set([...knots(from, fromPositions), ...knots(to, toPositions)])].sort((a, b) => a - b) : [];
    if (positions.length > MAX_PALETTE_STOPS) throw new Error(`渐变合并位置超过${MAX_PALETTE_STOPS}个色标预算`);
    const hsv = baseline.palette.interpolation === 'hsv';
    // HSV stop interpolation is nonlinear in RGB. Preserve original knots and
    // add a bounded dense sampling; the intermediate RGB representation is an
    // approximation, while exact endpoints keep the original HSV representation.
    if (morph && hsv) {
      const room = MAX_PALETTE_STOPS - positions.length;
      const extra = Math.min(257, room);
      const union = new Set(positions);
      for (let i = 1; i <= extra; i++) union.add(i / (extra + 1));
      positions.splice(0, positions.length, ...[...union].sort((a, b) => a - b));
    }
    const sample = (stops: string[], at: number, locations?: number[]) => hsv
      ? paletteBaseColor({ ...baseline.palette, mode: 'linear', stops, positions: locations }, at)
      : paletteStopsColor(stops, at, locations);
    const fromColors = positions.map(position => hex(sample(from, position, fromPositions)));
    const toColors = positions.map(position => hex(sample(to, position, toPositions)));
    const effect = registerContinuous('gradient', track), offset = baseline.palette.offset;
    plans.push({ start: track.start, apply: (out, at) => {
      const phase = continuousFrame(effect, at).seconds * config.speed;
      if (config.mode === 'offset_cycle') { out.palette.offset = offset + phase; return; }
      out.palette.mode = baseline.palette.mode;
      out.palette.interpolation = baseline.palette.interpolation;
      if (config.mode === 'hue_rotate') {
        out.palette.stops = from.map(color => hueRotate(color, phase));
        out.palette.positions = fromPositions ? [...fromPositions] : undefined; return;
      }
      const t = config.mode === 'cross_fade' ? clamp(Math.abs(phase)) : 1 - Math.abs(mod(phase, 2) - 1);
      // Endpoints retain their original representation and color mode. In-between
      // states retain every knot, rather than discarding a middle source color.
      if (t === 0 || t === 1) {
        out.palette.stops = [...(t === 0 ? from : to)];
        const endpointPositions = t === 0 ? fromPositions : toPositions;
        out.palette.positions = endpointPositions ? [...endpointPositions] : undefined; return;
      }
      out.palette.stops = fromColors.map((color, i) => interpolateColor(color, toColors[i], t, config.interpolation));
      out.palette.positions = [...positions];
      out.palette.interpolation = 'rgb';
    } });
  }
  function action(track: AnimationTrack, item: AnimationAction, sourceStartup:SceneDocument) {
    if(item.sourceEffect==='unmapped')return; // Retained eligibility fact, never a local no-op/stop command.
    if(scene.sourceCamera&&isCameraAction(item.method))return;
    if (item.enabled === false || !supportsCameraAction(scene,item.method)&&isCameraAction(item.method)) return;
    if (!ACTIONS.some(([name]) => name === item.method)) throw new Error(`未知动画动作 ${item.method}`);
    if((usesSourceSymmetryParameters(scene)||usesSourceMapParameters(scene))&&(item.method==='paramStart'||item.method==='paramStop'))return;
    if(item.domainParameters)return; // The group registry owner handles these together.
    if(usesSourceSymmetryGradient(scene)&&(item.method==='gradientStart'||item.method==='gradientStop'))return;
    const baseline = evaluate(track.start), initial = angles(baseline), method = item.method;
    if(usesSourceSurfaceGeometry(scene)&&(method==='gradientStart'||method==='gradientStop'||method==='paramStart'||method==='paramStop'))return;
    if (method === 'gradientStart') { gradient(track, item.gradient ?? { mode: 'offset_cycle', speed: .1, interpolation: 'rgb' }); return; }
    if (method === 'gradientStop') { stop('gradient', track); return; }
    if (method === 'paramStart') { oscillators(track, item.parameters ?? [], true,sourceStartup); return; }
    if (method === 'paramStop') {
      const target = String(item.args?.target ?? '*');
      for (const key of continuous.keys()) if (key.startsWith('param:') && (target === '*' || key === `param:${target}`)) stop(key, track);
      return;
    }
    if (method === 'stopAmbient') { for (const key of continuous.keys()) if (key.startsWith('rotation:')) stop(key, track); return; }
    if (method === 'stopTracking') { stop('tracking', track, true); return; }
    if (method === 'zoom' || method === 'focal') {
      numeric(track, baseline, method === 'zoom' ? 'camera.zoom' : 'camera.focalLength', actionNumber(item, 'value', method === 'zoom' ? 2 : 50)); return;
    }
    if (['rotateTheta', 'rotatePhi', 'rotateGamma', 'rotateTo'].includes(method)) {
      const component = method === 'rotateTheta' ? 'theta' : method === 'rotatePhi' ? 'phi' : 'gamma';
      const destination = method === 'rotateTo' ? { theta: actionNumber(item, 'theta', initial.theta), ...(supportsCameraComponent(scene,'phi')?{phi:actionNumber(item,'phi',initial.phi)}:{}), ...(supportsCameraComponent(scene,'gamma')?{gamma:actionNumber(item,'gamma',initial.gamma)}:{}) } : { [component]: initial[component] + actionNumber(item, 'angle', Math.PI / 2) };
      plans.push({ start: track.start, apply: (out, at) => { const t = clipProgress(track, at), values: Partial<typeof initial> = {}; for (const [key, value] of Object.entries(destination)) values[key as 'theta' | 'phi' | 'gamma'] = mix(initial[key as 'theta' | 'phi' | 'gamma'], value, t); setAngles(out, values); } });
      return;
    }
    if (method === 'track') {
      const baseCamera=sceneCamera(baseline).camera;
      if(item.args&&Object.hasOwn(item.args,'index')){
        if(!supportsParticleTracking(scene)||scene.kind==='attractor'&&!particlePosition)return;
        const index=actionNumber(item,'index');
        // Native Attractor lookup returns null for an unavailable initial target,
        // so it must not replace an earlier tracking action at all.
        if(scene.kind==='attractor'&&!particlePosition!({time:track.start,index}))return;
        const effect=registerContinuous('tracking',track);
        plans.push({start:track.start,apply:(out,at)=>{
          const sampleAt=Math.min(at,effect.cutoff??Infinity,effect.stop?.start??Infinity),progress=sampleAt>=track.start+track.duration?1:clipProgress(track,sampleAt);
          const previous=deferredTracking.get(out);
          deferredTracking.set(out,()=>{
            // Parameter/formula plans are fully evaluated before sampling the
            // mathematical target. Frozen tracking samples its historical cutoff.
            const sampled=scene.kind==='surface'?(sampleAt===at?out:evaluate(sampleAt,scene,false)):undefined;
            const position=sampled?sampleSurfaceParticle(sampled,sampleAt,index).position:particlePosition!({time:sampleAt,index});if(!position){previous?.();return;}
            const camera=writableSceneCamera(out),next=baseCamera.target.map((v,i)=>mix(v,position[i],progress)) as [number,number,number];
            camera.position=camera.position.map((v,i)=>v+next[i]-camera.target[i]) as [number,number,number];camera.target=next;camera.autoFit=false;
          });
        }});return;
      }
      const destination = ['x', 'y', 'z'].map((key, i) => actionNumber(item, key, baseCamera.target[i])), effect = registerContinuous('tracking', track);
      plans.push({ start: track.start, apply: (out, at) => {
        const sampleAt = Math.min(at, effect.cutoff ?? Infinity, effect.stop?.start ?? Infinity), t = clipProgress(track, sampleAt);
        deferredTracking.delete(out);const camera=writableSceneCamera(out);
        const next = baseCamera.target.map((v, i) => mix(v, destination[i], t)) as [number, number, number];
        if (item.args?.follow === true) camera.position = camera.position.map((v, i) => v + next[i] - camera.target[i]) as [number, number, number];
        camera.target = next; camera.autoFit = false;
      } }); return;
    }
    if (method === 'ambient') {
      const effect = registerContinuous('rotation:camera', track), speeds = { theta: actionNumber(item, 'thetaSpeed', .2), phi:supportsCameraComponent(scene,'phi')?actionNumber(item,'phiSpeed'):0, gamma:supportsCameraComponent(scene,'gamma')?actionNumber(item,'gammaSpeed'):0 };
      plans.push({ start: track.start, apply: (out, at) => { const t = continuousFrame(effect, at).seconds; setAngles(out, { theta: initial.theta + speeds.theta * t, phi: initial.phi + speeds.phi * t, gamma: initial.gamma + speeds.gamma * t }); } }); return;
    }
    const expected = method === 'fractalRotate' ? 'fractal' : method === 'domainRotate' ? 'domain' : 'spirograph';
    if (scene.kind !== expected) throw new Error(`${method} 仅适用于 ${expected} 场景`);
    if(sourceDomainRotation&&method==='domainRotate'){
      const rotation=finite(Number(baseline.settings.rotation??0),'域旋转角度');
      const target=finite(Math.fround(actionNumber(item,'speed',.2)),'源域旋转速率');
      const effect:AngularRateTransition={start:track.start,duration:clipDuration(track,scene),easing:track.easing,from:domainRate?angularRateAt(domainRate,track.start):0,to:target};
      domainRate=effect;
      // Native JSON clips are sequential. Overlapping locally authored clips
      // keep the existing stable ordering: the later plan takes over at start.
      // Integrate deterministically for seek; this is not native frame-by-frame
      // float accumulation. Zero-duration clips retain our instant convention.
      plans.push({start:track.start,apply:(out,at)=>{out.settings.rotation=finite(rotation+angularRotationDelta(effect,at),'域旋转角度');refreshCameraSetting(out,'rotation');recordWrittenTarget(out,'settings.rotation');}});
      return;
    }
    if(sourceSpirographRotation&&method==='spirographRotate'){
      const rotation=baseline.evaluatedSpirographRotationRadians??0;
      const target=spirographSourceRotationRate(actionNumber(item,'speed',.2));
      const effect:AngularRateTransition={start:track.start,duration:clipDuration(track,scene),easing:track.easing,from:spirographRate?angularRateAt(spirographRate,track.start):spirographSourceRotationRate(scene.settings.rotationSpeed),to:target,arithmetic:'source-float32'};
      spirographRate=effect;
      plans.push({start:track.start,apply:(out,at)=>{out.evaluatedSpirographRotationRadians=finite(rotation+angularRotationDelta(effect,at),'旋轮运行时旋转');}});
      return;
    }
    const rotation = Number(baseline.settings.rotation ?? 0), speed = actionNumber(item, 'speed', .2), effect = registerContinuous(`rotation:${expected}`, track);
    plans.push({ start: track.start, apply: (out, at) => { out.settings.rotation = rotation + speed * continuousFrame(effect, at).seconds;refreshCameraSetting(out,'rotation');recordWrittenTarget(out,'settings.rotation'); } });
  }

  for (const { track } of tracks) {
    validateTrack(track, scene);
    const type = track.type ?? 'numeric', baseline = evaluate(track.start);
    if (type === 'wait' || type === 'spirograph_finish_wait'||scene.sourceCamera&&(type==='align'||type==='numeric'&&track.target.startsWith('camera.'))) continue;
    if(type==='align'&&!supportsCameraComponent(scene,'theta')||type==='numeric'&&!supportsCameraTarget(scene,track.target))continue;
    if (type === 'numeric') { numeric(track, baseline, track.target, track.to, track.fromCurrent ? undefined : track.from); continue; }
    if (type === 'animate') {
      const items=track.actions??[];let lastRotation=-1;
      const registryGroup=domainParameters.appendGroup(track.start,clipDuration(track,scene),track.easing,items,baseline);
      if(registryGroup>=0)plans.push({start:track.start,apply:(out,at)=>{if(domainParameters.latestGroup(at)===registryGroup)domainParameters.apply(out,at,key=>recordWrittenTarget(out,`settings.${key}`));}});
      const rotationMethod=sourceDomainRotation?'domainRotate':sourceSpirographRotation?'spirographRotate':undefined;
      if(rotationMethod)for(let i=items.length-1;i>=0;i--)if(items[i].enabled!==false&&items[i].method===rotationMethod){lastRotation=i;break;}
      // Each native scene importer owns one rate animation per clip; repeated
      // setters replace that animation's target before playback begins.
      for(let i=0;i<items.length;i++)if(!rotationMethod||items[i].method!==rotationMethod||i===lastRotation)action(track,items[i],baseline);
      continue;
    }
    if (type === 'param') { if(usesSourceSurfaceGeometry(scene))continue; if(track.replaceParameters)for(const key of continuous.keys())if(key.startsWith('param:'))stop(key,track,true);oscillators(track, track.parameterAnimations ?? [], false); continue; }
    if (type === 'align') {
      if(track.alignMode!==undefined&&!['absolute','next-turn'].includes(track.alignMode))throw new Error('未知相机对齐模式');
      const initial=angles(baseline),destination:Partial<typeof initial>={};
      for(const axis of ['theta','phi','gamma'] as const)if(supportsCameraComponent(scene,axis)&&track.orientation?.[axis]!==undefined){const target=finite(track.orientation[axis]!,axis);destination[axis]=track.alignMode==='next-turn'?(Math.floor(initial[axis]/TAU)+1)*TAU+target:target;}
      // The source nullable axis flags mean an omitted axis is untouched. In
      // particular, an align clip with all axes omitted is a legal timed no-op.
      if(Object.keys(destination).length)plans.push({start:track.start,apply:(out,at)=>{const t=clipProgress(track,at),update:Partial<typeof initial>={};for(const axis of ['theta','phi','gamma'] as const)if(destination[axis]!==undefined)update[axis]=mix(initial[axis],destination[axis]!,t);setAngles(out,update);}});
      continue;
    }
    // Source recording is applied by the same queue that advances particles.
    // Never overwrite its initial recording state or display flag here.
    if (type === 'trails') { if(!usesSourceSurfaceGeometry(scene))plans.push({ start: track.start, apply: out => { out.settings.recordTrails = track.trailsEnabled !== false; out.settings.showTrails = track.trailsEnabled !== false; } }); continue; }
    if (type === 'surface_mode_transition') {
      if(usesSourceSurfaceHost(scene))continue;
      if (scene.kind !== 'surface') throw new Error('曲面过渡仅适用于参数曲面');
      const from = Number(baseline.settings.surfaceBlend ?? (baseline.settings.renderMode === 'points' ? 0 : 1)), to = track.surfaceMode === 'points' ? 0 : 1;
      plans.push({ start: track.start, apply: (out, at) => { out.settings.surfaceBlend = clamp(mix(from, to, clipProgress(track, at))); out.settings.renderMode = 'mesh'; } }); continue;
    }
    if (type === 'fractal_zoom') {
      if (scene.kind !== 'fractal') throw new Error('分形缩放仅适用于分形场景');
      if(track.sourceFractalZoom!==undefined){
        const parsed=parseSourceFractalZoomTarget(track.sourceFractalZoom);if(!parsed.ok)throw Error(parsed.error.reason);const target=parsed.value,initial={centerX:Number(baseline.settings.centerX),centerY:Number(baseline.settings.centerY),centerXLow:Number(baseline.settings.centerXLow??0),centerYLow:Number(baseline.settings.centerYLow??0),zoom:Number(baseline.settings.zoom)};
        plans.push({start:track.start,apply:(out,at)=>{
          const value=evaluateSourceFractalZoom(initial,target,track.easing,(at-track.start)/Math.max(Math.fround(1e-4),Math.fround(track.duration)));if(!value.ok)throw Error(value.error.reason);Object.assign(out.settings,value.value);
          refreshCameraSetting(out,'zoom');
          for(const key of ['centerX','centerY','centerXLow','centerYLow','zoom'])recordWrittenTarget(out,'settings.'+key);
        }});
        continue;
      }
      const frames = validateFractalKeyframes(track);
      plans.push({ start: track.start, apply: (out, at) => {
        const elapsed = clamp(clipProgress({ ...track, easing: 'linear' }, at)) * track.duration;
        let left = frames[0], right = frames[frames.length - 1];
        if (elapsed <= left.time) right = left;
        else if (elapsed >= right.time) left = right;
        else for (let i = 1; i < frames.length; i++) if (frames[i].time >= elapsed) { left = frames[i - 1]; right = frames[i]; break; }
        const p = left === right ? 0 : clamp(ease(right.easing ?? track.easing, (elapsed - left.time) / (right.time - left.time)));
        for(const axis of ['X','Y'] as const){
          const high=`center${axis}` as const,low=`center${axis}Low` as const,a=dd(left[high],left[low]??0),b=dd(right[high],right[low]??0);
          const value=p===0?a:p===1?b:ddAdd(a,ddMul(ddSub(b,a),[p,0]));
          out.settings[high]=finite(value[0],'高精度中心');out.settings[low]=finite(value[1],'高精度中心低位');
        }
        out.settings.zoom = track.interpolation === 'linear' ? mix(left.zoom, right.zoom, p) : Math.exp(mix(Math.log(left.zoom), Math.log(right.zoom), p));refreshCameraSetting(out,'zoom');
        for(const key of ['centerX','centerY','centerXLow','centerYLow','zoom'])recordWrittenTarget(out,'settings.'+key);
      } });
    }
  }
  return evaluate;
}

export function createAnimationTrack(scene: SceneDocument, type: AnimationClipType = 'numeric', start = 0): AnimationTrack {
  if(usesSourceDomain(scene)){if(!['wait','animate'].includes(type))throw Error('域着色源队列只支持等待和动作组合');return{id:crypto.randomUUID(),type,target:type==='wait'?'timeline.wait':'camera.actions',from:0,to:0,start:0,duration:1,easing:'sine-in-out',pingPong:false,enabled:true,...(type==='animate'?{actions:[{id:crypto.randomUUID(),method:'domainRotate',enabled:true,args:{speed:.2}}]}:{})};}
  if(usesSourceFractal(scene)){
    if(!['wait','animate','fractal_zoom'].includes(type))throw Error('源分形只支持等待、动画和目标缩放');
    const track:AnimationTrack={id:crypto.randomUUID(),type,target:type==='wait'?'timeline.wait':type==='animate'?'fractal.actions':'settings.zoom',from:0,to:0,start:0,duration:1,easing:'sine-in-out',pingPong:false,enabled:true};
    if(type==='animate')track.fractalSource={model:'mathart-1.7.8-actions-v1',targets:{rotationRate:.2},parameters:[]};
    if(type==='fractal_zoom')track.sourceFractalZoom={model:'mathart-1.7.8-target',centerX:Number(scene.settings.centerX??0),centerY:Number(scene.settings.centerY??0),centerXLow:Number(scene.settings.centerXLow??0),centerYLow:Number(scene.settings.centerYLow??0),zoom:Number(scene.settings.zoom??1)*10,maxZoom:1e300};
    return track;
  }
  if(usesRootsCameraTimeline(scene)){
    if(!['wait','animate'].includes(type))throw new Error('复根源相机时间线仅支持等待与动作组');
    return {id:crypto.randomUUID(),type,target:type==='wait'?'timeline.wait':'camera.actions',from:0,to:0,start:0,duration:1,easing:'sine-in-out',pingPong:false,enabled:true,repeat:1,...(type==='animate'?{actions:[{id:crypto.randomUUID(),method:'ambient',args:{phiSpeed:0,thetaSpeed:.2,gammaSpeed:0}}]}:{})};
  }
  if(usesSourceSurfaceGeometry(scene)&&type==='param'){
    const name=Object.keys(scene.parameters)[0];
    return{id:crypto.randomUUID(),type,target:'surface.parameters',from:0,to:0,start:0,duration:1,easing:'linear',pingPong:false,enabled:true,repeat:1,surfaceParameterClip:{model:'surface-registry-1.7.8',parameters:name?[{name,min:-100,max:100,step:Math.fround(.1),enabled:true}]:[]}};
  }
  const target = genericParameterTargets(scene).find(target=>rootMathAnimationTargetEnabled(scene,target)) ?? gradientAnimationCapabilities(scene).paletteOffsetTarget;
  // Only numeric/parameter clips consume a scalar source. Action, wait and
  // recording clips must not require an unrelated palette offset to exist.
  const from = type==='numeric'||type==='param'?readAnimationValue(scene,target):0, duration = Math.min(3, Math.max(.1, resolveTimeline(scene).duration - start));
  const track: AnimationTrack = { id: crypto.randomUUID(), type, target, from, to: from + 1, start, duration, easing: 'sine-in-out', pingPong: false, enabled: true, repeat: 1, label: CLIP_TYPES.find(item => item.type === type)?.label };
  if (type === 'animate') { const method=supportsCameraAction(scene,'rotateTheta')?'rotateTheta':scene.kind==='fractal'?'fractalRotate':scene.kind==='domain'?'domainRotate':scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)!=='local-v1'?'spirographRotate':gradientAnimationCapabilities(scene).localPalette||gradientAnimationCapabilities(scene).offsets?'gradientStart':'paramStart';track.target = 'camera.actions'; track.actions = [{ id: crypto.randomUUID(), method, args: method==='rotateTheta'?{ angle: Math.PI / 2 }:method==='gradientStart'||method==='paramStart'?{}:{speed:.2}, enabled: true }]; }
  if (type === 'align') { track.target = 'camera.orientation'; track.orientation = supportsCameraActions(scene)?{theta:0,phi:0,gamma:0}:{theta:0}; track.alignMode='next-turn'; }
  if (type === 'param') track.parameterAnimations = [{ target, ...(parameterAnimationSuggestion(scene,target)??{min:from-1,max:from+1}), step: 1, enabled: true }];
  if (type === 'fractal_zoom') { track.target = 'settings.zoom'; const centerX = Number(scene.settings.centerX ?? 0), centerY = Number(scene.settings.centerY ?? 0), centerXLow=Number(scene.settings.centerXLow??0),centerYLow=Number(scene.settings.centerYLow??0),zoom = Number(scene.settings.zoom ?? 1); track.sourceFractalZoom={model:'mathart-1.7.8-target',centerX,centerY,centerXLow,centerYLow,zoom:Math.min(1e28,zoom*10),maxZoom:1e300}; }
  if (type === 'surface_mode_transition') { track.target = 'settings.surfaceBlend'; track.surfaceMode = (usesSourceSurfaceHost(scene)?scene.surfaceSource!.mode:scene.settings.renderMode) === 'points' ? 'mesh' : 'points'; }
  if (type === 'trails') { track.target = 'settings.recordTrails'; track.trailsEnabled = true;if(usesSourceSurfaceGeometry(scene)||usesSourcePerlin(scene)){track.duration=0;track.easing='linear';if(usesSourcePerlin(scene))track.target='settings.showTrails';} }
  if (type === 'wait' || type === 'spirograph_finish_wait') track.target = 'timeline.wait';
  if (type === 'spirograph_finish_wait') {
    if(scene.kind==='spirograph'&&parseSpirographVersion(scene.settings.spirographVersion)==='mathart-1.7.8-v1'){
      track.spirographWait='visual-or-deadline-v1';
      track.duration=Math.min(1200,Math.max(.1,duration));
    }else track.duration = clipDuration(track, scene);
  }
  return track;
}
