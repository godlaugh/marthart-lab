import {usesSourceFractal} from './sourceFractalDocument';
import {SourceFractalLiveSession} from './sourceFractalLiveSession';
import {fractalRecordingFrameFacts,validateFractalRecordingFrameInput} from './sourceFractalRecording';
import {sceneAtFractalFrame} from './timeline';
import {SourceIteratedSession} from './sourceIteratedSession';
import {SourceSamilaSession} from './sourceSamilaSession';
import {usesSourcePerlinCpu} from './sourcePerlinIdentity';
import {SourcePerlinSession} from '../scenes/sourcePerlin';
import {usesSourcePerlinGpu} from './sourcePerlinIdentity';
import {SourcePerlinGpuSession} from '../scenes/sourcePerlinGpu';
import {usesSourceAttractor} from './sourceAttractorDocument';
import {usesSourceBouncing} from './sourceBouncingDocument';
import {SourceBouncingSession} from '../scenes/sourceBouncing';
import {generateSourceAttractor,SourceAttractorSession} from '../scenes/sourceAttractor';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,bindOrdinarySourceCamera,prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {sourceCameraMode} from './sourceCameraMode';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {generateSourceSurface} from '../scenes/sourceSurface';
import {AttractorParticleSession} from '../scenes/attractorParticles';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import type { GenerateContext, GeometryOutput, SceneDocument, SceneOutput, ParticleCameraRequest } from '../types';
import { definition } from '../scenes';
import { integrateStep, prepareAttractorFrame, prepareAttractorParticles, type AttractorParticle } from '../scenes/geometry';
import { numberSetting } from './expression';
import { paletteColor, vertexColors } from './palette';
import { sceneAtTime,timelineWarnings,prepareParticleCamera } from './timeline';
import {ParticleCameraCache,attractorParticleId} from './particleCamera';
import { presentPointFrames, presentPoints } from './density';
import {PerlinParticleSession,generatePerlinParticles} from '../scenes/perlinParticles';
import {BouncingRasterSession,generateBouncingRaster} from '../scenes/bouncingRaster';
import {outputBuffers} from './outputBuffers';
import {IteratedDensitySession,generateIteratedDensity} from '../scenes/iteratedDensity';
import {RootsDensitySession,generateRootsDensity} from '../scenes/rootsDensity';
import {RootsNativePresentationSession,generateRootsNativePresentation} from './rootsNativePresentationSession';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {hasContinuousDensity,hasProgressiveRoots} from './sceneCamera';
import {simulationTime} from './simulationClock';
import {DomainRenderSession} from './domainRenderSession';
import {generateDomain} from './domain';
import {usesSpirographFrameClock} from './spirographFrameConfig';
import {SpirographFrameSession,sceneAtSpirographFrame} from './spirographFramePlan';

type PointOutput = GeometryOutput & SceneOutput;
interface PointFrame { time: number; output: PointOutput; recording: boolean; identitySpace?: string; }
interface Simulation { frame: number; particles: AttractorParticle[]; integrated: number; }
const MAX_HISTORY_VERTICES = 1_000_000, MAX_REPLAY_STEPS = 2_000_000, CACHE_BYTES = 32 * 1024 * 1024;
const integer = (scene: SceneDocument, key: string, fallback: number, min: number, max: number) => {
  const n = numberSetting(scene.settings, key, fallback, min, max);
  if (!Number.isInteger(n)) throw new Error(`${key} 必须为整数`); return n;
};
const aborted = (context: GenerateContext) => { if (context.isCancelled?.()) throw new DOMException('已取消', 'AbortError'); };
const cloneParticles = (particles: AttractorParticle[]) => particles.map(p => ({ ...p, point: [...p.point] as [number, number, number] }));
function cloneOutput(output: PointOutput): PointOutput {
  return structuredClone(output);
}
function frameBytes(frame: PointFrame) { return outputBuffers(frame.output).reduce((bytes,buffer)=>bytes+buffer.byteLength,0)+512; }

/** One worker owns one session. Cache entries never escape without copying, so
 * transferring a response buffer cannot detach retained historical state. */
export class TemporalGenerationSession {
  private key = '';
  private selectedKind?:SceneDocument['kind'];
  private selectedDensity=false;
  private selectedRoots=false;
  private cleanup = new GenerationCleanupState();
  private frames = new Map<string, PointFrame>();
  private bytes = 0;
  cacheHits = 0;
  simulation?: Simulation;
  readonly perlin = new PerlinParticleSession();
  readonly sourcePerlin = new SourcePerlinSession();
  readonly sourcePerlinGpu = new SourcePerlinGpuSession();
  readonly bouncing = new BouncingRasterSession();
  readonly sourceBouncing = new SourceBouncingSession();
  readonly sourceAttractor = new SourceAttractorSession();
  readonly sourceSymmetry = new SourceIteratedSession('symmetry');
  readonly sourceMap = new SourceIteratedSession('map');
  readonly sourceSamila = new SourceSamilaSession();
  readonly sourceFractal = new SourceFractalLiveSession();
  readonly iterated = new IteratedDensitySession();
  readonly roots = new RootsDensitySession();
  readonly rootsNative = new RootsNativePresentationSession();
  readonly attractor = new AttractorParticleSession();
  readonly tracking = new ParticleCameraCache();
  readonly domain = new DomainRenderSession();
  readonly spirograph = new SpirographFrameSession();
  private clearFrames(){this.frames.clear();this.bytes=0;this.simulation=undefined;this.cacheHits=0;this.perlin.reset();this.tracking.reset();}
  reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{ this.key = ''; this.selectedKind=undefined;this.selectedDensity=false;this.selectedRoots=false;this.clearFrames();this.sourcePerlinGpu.reset();this.sourcePerlin.reset();this.sourceAttractor.reset();this.sourceBouncing.reset();this.bouncing.reset();this.iterated.reset();this.sourceSymmetry.reset();this.sourceMap.reset();this.sourceSamila.reset();this.sourceFractal.reset();this.roots.reset();this.rootsNative.reset();this.attractor.reset();this.domain.reset();this.spirograph.reset(); },failures);}
  select(scene: SceneDocument, context: GenerateContext) {
    this.cleanup.prepare();
    if(context.fractalLive===undefined)this.sourceFractal.reset();
    if(context.mapLive===undefined)this.sourceMap.reset();else this.iterated.reset();
    if(context.symmetryLive===undefined)this.sourceSymmetry.reset();else this.iterated.reset();
    if(context.samilaLive===undefined)this.sourceSamila.reset();else this.iterated.reset();
    if(!scene.perlinSource&&!usesSourcePerlinCpu(scene))this.sourcePerlin.reset();
    if(scene.perlinSource||!usesSourcePerlinGpu(scene))this.sourcePerlinGpu.reset();
    if(!usesSourceAttractor(scene))this.sourceAttractor.reset();
    if(!usesSourceBouncing(scene))this.sourceBouncing.reset();else this.bouncing.reset();
    if(!usesRootsNativePresentation(scene))this.rootsNative.reset();
    if(scene.kind==='domain')this.domain.select(scene.id);else this.domain.reset();
    if(!usesSpirographFrameClock(scene))this.spirograph.reset();
    const key = JSON.stringify({ scene, width: context.width, height: context.height });
    if (key !== this.key) {
      this.clearFrames();
      // Bouncing owns and validates its initial-state key; viewport changes do
      // not invalidate particle seeds. Leaving its family releases that owner.
      if(this.selectedKind!=='bouncing'||scene.kind!=='bouncing')this.bouncing.reset();
      if(!this.selectedDensity||!hasContinuousDensity(scene)||this.selectedKind!==scene.kind)this.iterated.reset();
      if(!this.selectedRoots||!hasProgressiveRoots(scene)||usesRootsNativePresentation(scene))this.roots.reset();
      if(this.selectedKind!=='attractor'||scene.kind!=='attractor'||usesSourceAttractor(scene)||scene.settings.simulationMode!=='continuous')this.attractor.reset();
      this.key=key;this.selectedKind=scene.kind;this.selectedDensity=hasContinuousDensity(scene);
      this.selectedRoots=hasProgressiveRoots(scene);
    }
    this.cacheHits = 0;
  }
  get(time: number) {
    const key = String(time), frame = this.frames.get(key);
    if (frame) { this.frames.delete(key); this.frames.set(key, frame); this.cacheHits++; }
    return frame;
  }
  has(time: number) { return this.frames.has(String(time)); }
  put(frame: PointFrame) {
    const key = String(frame.time), old = this.frames.get(key);
    if (old) this.bytes -= frameBytes(old);
    this.frames.delete(key);
    const bytes = frameBytes(frame); if (bytes > CACHE_BYTES) return;
    this.frames.set(key, frame); this.bytes += bytes;
    while (this.bytes > CACHE_BYTES || this.frames.size > 2048) {
      const oldest = this.frames.keys().next().value!; this.bytes -= frameBytes(this.frames.get(oldest)!); this.frames.delete(oldest);
    }
  }
  diagnostics() { return { retainedBytes: this.bytes + this.sourceMap.diagnostics().retainedBytes + this.sourceSymmetry.diagnostics().retainedBytes + this.sourceSamila.diagnostics().retainedBytes + this.sourcePerlinGpu.diagnostics().retainedBytes + this.sourceAttractor.diagnostics().retainedBytes + this.sourceBouncing.diagnostics().retainedBytes + this.perlin.diagnostics().retainedBytes+this.bouncing.diagnostics().retainedBytes+this.iterated.diagnostics().retainedBytes+this.roots.diagnostics().retainedBytes+this.rootsNative.diagnostics().retainedBytes+this.attractor.diagnostics().retainedBytes+this.tracking.diagnostics().estimatedRetainedBytes, retainedFrames: this.frames.size, cacheHits: this.cacheHits, perlin: this.perlin.diagnostics(),sourcePerlin:this.sourcePerlin.diagnostics(),sourcePerlinGpu:this.sourcePerlinGpu.diagnostics(),bouncing:this.bouncing.diagnostics(),sourceBouncing:this.sourceBouncing.diagnostics(),sourceAttractor:this.sourceAttractor.diagnostics(),iterated:this.iterated.diagnostics(),sourceSamila:this.sourceSamila.diagnostics(),sourceSymmetry:this.sourceSymmetry.diagnostics(),sourceMap:this.sourceMap.diagnostics(),roots:this.roots.diagnostics(),rootsNative:this.rootsNative.diagnostics(),attractor:this.attractor.diagnostics(),tracking:this.tracking.diagnostics() }; }
}

/** Grid is anchored at zero; arbitrary seek time adds one final exact-time sample. */
export function historyTimes(time: number, lifetime: number, fps: number) {
  if (!Number.isFinite(time) || time < 0 || time > 86400) throw new Error('历史时间必须为 0–86400 秒');
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 60) throw new Error('历史寿命必须在 (0,60] 秒');
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('历史采样率必须为 1–120 的整数');
  const start=simulationTime(Math.max(0,time-lifetime),fps),end=simulationTime(time,fps);
  const first=start.frame+(start.fraction>0?1:0),last=end.frame;
  const times: number[] = [];
  for (let frame = first; frame <= last; frame++) times.push(frame / fps);
  if(times.length&&end.fraction===0)times[times.length-1]=time;
  else times.push(time);
  return times;
}

function assembleTrails(frames: PointFrame[], time: number, lifetime: number, fade: boolean): NonNullable<GeometryOutput['trails']> {
  const positions: number[] = [], colors: number[] = [], alphas: number[] = [], indices: number[] = [];
  let previous = new Map<number, number>();
  let previousSpace: string | undefined;
  for (const frame of frames) {
    const next = new Map<number, number>(), output = frame.output;
    if (frame.identitySpace !== previousSpace) previous.clear();
    previousSpace = frame.identitySpace;
    if (!frame.recording || !output.particleIds) { previous = next; continue; }
    for (let i = 0; i < output.particleIds.length; i++) {
      if (positions.length / 3 >= MAX_HISTORY_VERTICES) throw new Error('历史拖尾超过 1,000,000 个顶点；请降低粒子数、寿命或采样率');
      const id = output.particleIds[i], at = positions.length / 3;
      positions.push(output.positions[i * 3], output.positions[i * 3 + 1], output.positions[i * 3 + 2]);
      colors.push(output.colors?.[i * 3] ?? 1, output.colors?.[i * 3 + 1] ?? 1, output.colors?.[i * 3 + 2] ?? 1);
      alphas.push(fade ? Math.max(0, Math.min(1, 1 - (time - frame.time) / lifetime)) : 1);
      const old = previous.get(id); if (old !== undefined) indices.push(old, at);
      next.set(id, at);
    }
    previous = next;
  }
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors), alphas: Float32Array.from(alphas), indices: Uint32Array.from(indices) };
}

function surfaceFrame(scene: SceneDocument, context: GenerateContext, time: number, session: TemporalGenerationSession): PointFrame {
  const cached = session.get(time); if (cached) return cached;
  aborted(context);
  const current = sceneAtTime(scene, time);
  // CPU history is explicit, matching the documented availability of trails.
  const output = definition('surface').generate({ ...current, settings: { ...current.settings, renderMode: 'points', computeBackend: 'cpu', presentation: 'points' } }, { ...context, time });
  if (output.type !== 'geometry') throw new Error('曲面历史需要点几何');
  const frame = { time, output, recording: current.settings.recordTrails !== false, identitySpace: `surface:${current.settings.uSegments}:${current.settings.vSegments}` };
  session.put(frame); return frame;
}

function simulationFrames(scene: SceneDocument, context: GenerateContext, times: number[], fps: number, session: TemporalGenerationSession,requests:readonly ParticleCameraRequest[]=[]): PointFrame[] {
  let requestSteps = 0;
  const zeroScene = sceneAtTime(scene, 0), initialFrame = prepareAttractorFrame(zeroScene);
  const target = context.time,clock=simulationTime(target,fps),lastFrame=clock.frame;
  const count = integer(zeroScene, 'particleCount', 1, 1, 10000);
  if (times.length * count > MAX_HISTORY_VERTICES) throw new Error('历史拖尾超过 1,000,000 个顶点；请降低粒子数、寿命或采样率');
  let state = session.simulation;
  const requestedFrames=new Map<number,ParticleCameraRequest[]>();for(const request of requests){const frame=simulationTime(request.time,fps).frame,batch=requestedFrames.get(frame)??[];batch.push(request);requestedFrames.set(frame,batch);}
  for(const request of requests)session.tracking.get(request); // Protect current facts from LRU eviction.
  const allCached = times.every(time => session.has(time))&&requests.every(request=>session.tracking.has(request));
  if (allCached) return times.map(time => session.get(time)!);
  if (!state || state.frame > lastFrame || times.some(time => simulationTime(time,fps).frame < state!.frame && !session.has(time))||requests.some(request=>simulationTime(request.time,fps).frame<state!.frame&&!session.tracking.has(request))) {
    session.tracking.reset();
    state = { frame: 0, particles: prepareAttractorParticles(zeroScene), integrated: 0 };
    const warmupSteps = state.particles.reduce((sum, p) => sum + p.warmup, 0);
    if (warmupSteps + count * lastFrame * initialFrame.subSteps > MAX_REPLAY_STEPS) throw new Error('连续粒子重放超过 2,000,000 积分步；请减少粒子数、时间、子步或预热');
    for (const particle of state.particles) advance(particle, initialFrame, particle.warmup, 1, state, context);
    session.simulation = state;
    capture(0, zeroScene, state);
  }
  const immutableKeys = ['simulationFps', 'particleCount', 'seed', 'initialSpread', 'useInitialBounds', 'burnIn', 'staggerMin', 'staggerMax', ...['X', 'Y', 'Z'].flatMap(a => [`initial${a}`, `initialMin${a}`, `initialMax${a}`])];
  for (let frame = state.frame; frame < lastFrame; frame++) {
    aborted(context);
    captureTracking(state);
    const at = frame / fps, current = sceneAtTime(scene, at);
    if (immutableKeys.some(key => current.settings[key] !== zeroScene.settings[key])) throw new Error('连续模拟期间不能动画修改粒子初始条件、数量或随机种子');
    const config = prepareAttractorFrame(current);
    if (requestSteps + count * config.subSteps > MAX_REPLAY_STEPS) throw new Error('连续粒子重放超过 2,000,000 积分步；请减少粒子数、时间或子步');
    for (const particle of state.particles) advance(particle, config, config.subSteps, 1, state, context);
    state.frame = frame + 1;
    capture(state.frame / fps, sceneAtTime(scene, state.frame / fps), state);
  }
  captureTracking(state);
  if (clock.fraction>0) {
    const partial: Simulation = { ...state, particles: cloneParticles(state.particles) };
    const current = sceneAtTime(scene, clock.gridTime), config = prepareAttractorFrame(current), fraction = clock.fraction;
    if (requestSteps + count * config.subSteps > MAX_REPLAY_STEPS) throw new Error('连续粒子积分超过工作预算');
    for (const particle of partial.particles) advance(particle, config, config.subSteps, fraction, partial, context);
    capture(target, sceneAtTime(scene, target), partial);
  }else if(!session.has(target))capture(target,sceneAtTime(scene,target),state);
  return times.map(time => { const frame = session.get(time); if (!frame) throw new Error('历史窗口超过缓存容量，请降低粒子数或寿命'); return frame; });

  function captureTracking(state:Simulation){
    const batch=requestedFrames.get(state.frame);if(!batch)return;
    for(const request of batch){
      if(session.tracking.has(request))continue;aborted(context);const id=attractorParticleId(request.index,count);
      if(id===undefined){session.tracking.put(request,{status:'out-of-range'});continue;}
      let particle=state.particles[id];const fraction=simulationTime(request.time,fps).fraction;
      if(fraction>0){particle={...particle,point:[...particle.point]};const config=prepareAttractorFrame(sceneAtTime(scene,state.frame/fps));if(requestSteps+config.subSteps>MAX_REPLAY_STEPS)throw new Error('连续粒子跟踪采样超过积分工作预算');advance(particle,config,config.subSteps,fraction,{...state,particles:[]},context);}
      const point=new Float32Array(3),transform=prepareAttractorFrame(sceneAtTime(scene,request.time)).transform;
      const available=particle.alive&&transform.write(...particle.point,point,0);
      session.tracking.put(request,available?{status:'available',particleId:id,position:[point[0],point[1],point[2]]}:{status:'unavailable',particleId:id});
    }
  }

  function advance(particle: AttractorParticle, config: ReturnType<typeof prepareAttractorFrame>, steps: number, fraction: number, state: Simulation, context: GenerateContext) {
    const dt = (config.variableTimeStep ? config.dtMin + particle.dtFraction * (config.dtMax - config.dtMin) : config.dt) * fraction;
    for (let i = 0; i < steps && particle.alive; i++) {
      if ((i & 127) === 0) aborted(context);
      particle.point = integrateStep(config.derivative, particle.point, particle.physicalTime, dt, config.method);
      particle.physicalTime += dt; state.integrated++; requestSteps++;
      if (!particle.point.every(Number.isFinite) || Math.hypot(...particle.point) > config.limit) particle.alive = false;
    }
  }
  function capture(time: number, current: SceneDocument, state: Simulation) {
    const config = prepareAttractorFrame(current), positions: number[] = [], ids: number[] = [];
    let invalid = 0;
    for (const particle of state.particles) {
      const p = config.transform.apply(particle.point);
      if (!particle.alive || !p.every(value => Number.isFinite(Math.fround(value)))) { invalid++; continue; }
      positions.push(...p); ids.push(particle.id);
    }
    const values = Float32Array.from(positions), metric = String(current.settings.colorMetric ?? 'index');
    const colors = metric === 'index' ? Float32Array.from(ids.flatMap(id => paletteColor(current.palette, id / Math.max(1, count - 1)))) : vertexColors(values, current.palette, metric);
    const output: PointOutput = { type: 'geometry', topology: 'points', backend: 'cpu', dimension: 3, positions: values, particleIds: Uint32Array.from(ids), colors,
      stats: { samples: state.integrated, generated: ids.length, invalid }, ...(invalid ? { warnings: [`${invalid} 个发散或无效粒子已停止；不自动重生。`] } : {}) };
    session.put({ time, output, recording: current.settings.recordTrails !== false });
  }
}

function generateDensityWindow(scene: SceneDocument, context: GenerateContext, session: TemporalGenerationSession): SceneOutput {
  const current = sceneAtTime(scene, context.time,{isCancelled:context.isCancelled}), fps = integer(current, 'densitySampleRate', 10, 1, 120);
  const lifetime = numberSetting(current.settings, 'densityLifetime', 1, .001, 60), times = historyTimes(context.time, lifetime, fps);
  const frames: PointOutput[] = [], continuous = scene.kind === 'attractor' && current.settings.simulationMode === 'continuous';
  const replaySession = continuous ? new TemporalGenerationSession() : undefined;
  const pointScene = { ...scene, settings: { ...scene.settings, presentation: 'points', showTrails: false } };
  let points = 0;
  for (const time of times) {
    aborted(context);
    let frame = continuous ? undefined : session.get(time);
    if (!frame) {
      const snapshot = sceneAtTime(pointScene, time);
      // Sampling quality is identical for preview/export; only the final raster
      // pixel budget may differ. Existing scene point budgets remain explicit.
      const output = continuous ? generateScene({...pointScene,settings:{...pointScene.settings,attractorBackend:'cpu'}}, { ...context, quality: 'export', time }, replaySession)
        : definition(scene.kind).generate(snapshot, { ...context, quality: 'export', time });
      if (output.type !== 'geometry' || output.topology !== 'points') throw new Error('时间密度累积需要点云模式；请先切换为采样点');
      frame = { time, output, recording: true };
      if (!continuous) session.put(frame);
    }
    points += frame.output.positions.length / 3;
    if (points > 2_000_000) throw new Error('时间密度累积超过 2,000,000 个样本；请减少单帧点数、寿命或采样率');
    frames.push(frame.output);
  }
  const decay = numberSetting(current.settings, 'densityDecay', 1, 0, 1);
  const weights = times.map(time => decay ** Math.max(0, (context.time - time) * fps));
  const output = presentPointFrames(frames, current, context, weights);
  aborted(context);
  output.temporal = { time: context.time, windowStart: Math.max(0, context.time - lifetime), frames: times.length, samplingFps: fps, recordedPoints: points, cacheHits: session.cacheHits };
  return output;
}

/** Single time-addressable entry point for preview, seeking and frame export. */
function generateSceneFrame(scene: SceneDocument, context: GenerateContext, session: TemporalGenerationSession): SceneOutput {
  const started = performance.now();
  if (context.isCancelled?.()) { session.reset(); throw new DOMException('已取消', 'AbortError'); }
  if (!Number.isFinite(context.time) || context.time < 0 || context.time > 86400) throw new Error('生成时间必须为 0–86400 秒');
  session.select(scene, context);
  if(usesSpirographFrameClock(scene)){
    try{
      const current=sceneAtSpirographFrame(scene,context.time,context.spirographFrame,session.spirograph,context.isCancelled);
      const output=definition(scene.kind).generate(current,context);
      output.spirographFrame=current.evaluatedSpirographFrame;
      return output;
    }catch(error){session.spirograph.reset();throw error;}
  }
  if(context.spirographFrame)throw new Error('旋轮帧请求不适用于当前场景或时钟');
  if(usesRootsNativePresentation(scene)){
    try{return generateRootsNativePresentation(scene,context,session.rootsNative);}
    catch(error){session.reset([error]);throw error;}
  }
  if(context.fractalRecording!==undefined){
    const input=validateFractalRecordingFrameInput(context.fractalRecording);
    if(input.simulationFps!==scene.timeline.fps)throw Error('分形录制模拟帧率与场景不一致');
    const current=sceneAtFractalFrame(scene,input.displayFrame,context.isCancelled);
    const output=definition(scene.kind).generate(current,context);
    if(output.type!=='raster')throw Error('分形录制没有生成像素画面');
    output.fractalRecording=fractalRecordingFrameFacts(current.evaluatedFractalScene!,input);
    return output;
  }
  const current = sceneAtTime(scene, context.time,{isCancelled:context.isCancelled}), settings = current.settings;
  if(scene.kind==='domain')return generateDomain(current,context,session.domain);
  const tracking=prepareParticleCamera(scene,context.time);
  if (scene.kind === 'perlin' && settings.style === 'continuous') {
    try { return generatePerlinParticles(scene, context, session.perlin); }
    catch (error) { session.reset(); throw error; }
  }
  if(scene.kind==='bouncing'&&settings.bouncingPresentation==='raster'){
    try{return generateBouncingRaster(scene,context,session.bouncing);}
    catch(error){session.reset();throw error;}
  }
  if(hasContinuousDensity(current)){
    try{return generateIteratedDensity(scene,context,session.iterated);}
    catch(error){session.reset();throw error;}
  }
  if(hasProgressiveRoots(current)){
    try{return generateRootsDensity(scene,context,session.roots);}
    catch(error){session.reset([error]);throw error;}
  }
  let attractorWarnings:string[]=[];
  const failAttractorFallback=(error:unknown):never=>{session.reset();if(attractorWarnings.length&&!(error instanceof DOMException&&error.name==='AbortError'))throw new Error(attractorWarnings.join('；')+'；CPU 回退无法完成：'+(error instanceof Error?error.message:String(error)));throw error;};
  if(scene.kind==='attractor'&&settings.simulationMode==='continuous'){
    try{const attempt=session.attractor.generate(scene,context,tracking?.requests);attractorWarnings=attempt.warnings;
      if(attempt.output){if(tracking){const camera=tracking.resolve(attempt.trackingSamples!);attempt.output.cameraFrame=camera.frame;attempt.output.warnings=[...(attempt.output.warnings??[]),...camera.warnings];}if(settings.presentation==='density'){const raster=presentPoints(attempt.output as GeometryOutput&SceneOutput,current,context);raster.temporal=attempt.output.temporal;return raster;}return attempt.output;}
    }catch(error){session.reset();throw error;}
  }
  if (settings.presentation === 'density' && settings.densityAccumulation === 'window') {
    try { const output = generateDensityWindow(scene, context, session);output.warnings=[...(output.warnings??[]),...attractorWarnings]; output.stats.elapsedMs = performance.now() - started; return output; }
    catch (error) { return failAttractorFallback(error); }
  }
  const continuous = scene.kind === 'attractor' && settings.simulationMode === 'continuous';
  const surfaceTrails = scene.kind === 'surface' && settings.renderMode === 'points' && settings.showTrails === true;
  if (!continuous && !surfaceTrails) return definition(scene.kind).generate(current, context);
  const fps = integer(current, continuous ? 'simulationFps' : 'trailSampleRate', 30, 1, 120);
  if (continuous && fps !== integer(sceneAtTime(scene, 0), 'simulationFps', 30, 1, 120)) throw new Error('连续模拟期间不能动画修改模拟帧率');
  const lifetime = numberSetting(settings, 'trailLifetime', 5, .001, 60);
  const times = settings.showTrails === true ? historyTimes(context.time, lifetime, fps) : [context.time];
  if (surfaceTrails) {
    let samples = 0;
    for (const time of times) {
      const snapshot = sceneAtTime(scene, time);
      samples += integer(snapshot, 'uSegments', 96, 2, 512) * integer(snapshot, 'vSegments', 48, 2, 512);
      if (samples > MAX_HISTORY_VERTICES) throw new Error('历史拖尾超过 1,000,000 个采样点；请降低曲面点数、寿命或采样率');
    }
  }
  try {
    const frames = continuous ? simulationFrames(scene, context, times, fps, session,tracking?.requests) : times.map(time => surfaceFrame(scene, context, time, session));
    aborted(context);
    const output = cloneOutput(frames[frames.length - 1].output);
    if(tracking){const camera=tracking.resolve(session.tracking.collect(tracking.requests));output.cameraFrame=camera.frame;output.warnings=[...(output.warnings??[]),...camera.warnings];}
    if(attractorWarnings.length)output.warnings=[...(output.warnings??[]),...attractorWarnings];
    if (settings.showTrails === true) output.trails = assembleTrails(frames, context.time, lifetime, settings.fadeTrails === true);
    if (surfaceTrails && new Set(frames.map(f => f.identitySpace)).size > 1) output.warnings = [...(output.warnings ?? []), '曲面采样网格尺寸已变化；新旧粒子集合之间不连接拖尾。'];
    const recordedPoints = output.trails?.positions.length ? output.trails.positions.length / 3 : 0;
    output.temporal = { time: context.time, windowStart: Math.max(0, context.time - lifetime), frames: frames.length, samplingFps: fps, recordedPoints, cacheHits: session.cacheHits };
    output.stats.elapsedMs = performance.now() - started;
    if (surfaceTrails && settings.computeBackend !== 'cpu' && settings.computeBackend !== undefined) output.warnings = [...(output.warnings ?? []), '历史拖尾使用 CPU 采样；当前后端为 CPU。'];
    if (settings.presentation === 'density') { const raster = presentPoints(output, current, context); raster.temporal = output.temporal; return raster; }
    return output;
  } catch (error) { return failAttractorFallback(error); }
}

/** All public callers receive the same unsupported-timeline evidence. */
export function generateScene(scene:SceneDocument,context:GenerateContext,session?:TemporalGenerationSession):SceneOutput{
  if(context.fractalRecording!==undefined&&!usesSourceFractal(scene))throw Error('分形录制帧只能用于完整源分形场景');
  if((context.sourceBouncingFrame!==undefined||context.sourceBouncingView!==undefined)&&!usesSourceBouncing(scene))throw new Error('源弹跳检查点只能用于带源弹跳配置的场景');
  if(scene.bouncingSource!==undefined&&!usesSourceBouncing(scene))throw new Error('源弹跳配置只能用于弹跳场景');
  const owner=session??new TemporalGenerationSession();
  const generate=()=>{
    if(context.fractalLive!==undefined){owner.select(scene,context);return owner.sourceFractal.generate(scene,context);}
    if(context.mapLive!==undefined){owner.select(scene,context);return owner.sourceMap.generate(scene,context);}
    if(context.symmetryLive!==undefined){owner.select(scene,context);return owner.sourceSymmetry.generate(scene,context);}
    if(context.samilaLive!==undefined){owner.select(scene,context);return owner.sourceSamila.generate(scene,context);}
    if(scene.perlinSource||usesSourcePerlinCpu(scene)){owner.select(scene,context);return owner.sourcePerlin.generate(scene,context);}
    if(usesSourcePerlinGpu(scene)){owner.select(scene,context);return owner.sourcePerlinGpu.generate(scene,context);}
    if(usesSourceBouncing(scene)){owner.select(scene,context);return owner.sourceBouncing.generate(scene,context);}
    if(usesSourceSurfaceGeometry(scene)){owner.select(scene,context);return generateSourceSurface(scene,context);}
    if(usesSourceAttractor(scene)){owner.select(scene,context);return generateSourceAttractor(scene,context,owner.sourceAttractor);}
    ordinarySourceCameraInitial(scene);
    // Validate requested projection and paired camera before any geometry or
    // simulation allocation. Progress frames may use an earlier scene time.
    if(scene.sourceCamera){
      const state=sceneAtTime(scene,context.time);
      ordinarySourceCameraFrame(state,context);
    }
    const mode=sourceCameraMode(scene);
    const bind=(output:SceneOutput)=>{
      if(mode.kind==='ordinary')return bindOrdinarySourceCamera(output,sceneAtTime(scene,output.temporal?.time??context.time),context);
      if(mode.kind==='captured-density'){
        if(output.type!=='raster'||!output.cameraResolved||!output.sourceCameraFrame)throw new Error('源密度相机需要携带相机帧的已投影像素图像');
        prepareOrdinarySourceFrame(output.sourceCameraFrame);
      }
      return output;
    };
    const scoped=scene.sourceCamera&&context.onProgress?{...context,onProgress:(output:SceneOutput)=>context.onProgress!(bind(output))}:context;
    const output=bind(generateSceneFrame(scene,scoped,owner)),warnings=timelineWarnings(scene);
    if(warnings.length)output.warnings=[...new Set([...(output.warnings??[]),...warnings])];
    return output;
  };
  return session?generate():withGenerationCleanup(generate,owner);
}
