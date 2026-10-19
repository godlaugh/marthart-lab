import {SourceAttractorCpuParticles,type SourceAttractorCpuOptions} from './sourceAttractorCpuParticles';
import {evaluateOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {SOURCE_CAMERA_MODEL,type SourceCameraScalars,type SourceCameraViewport} from './sourceCamera';
import type {AnimationTrack,SceneOutput} from '../types';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {sourceParticlePointAppearance} from './sourceParticlePointAppearance';
import type {SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';

export interface SourceAttractorCpuReplayOptions extends SourceAttractorCpuOptions {
 readonly camera:SourceCameraScalars;
 readonly tracks:readonly AnimationTrack[];
 readonly fps:number;readonly time:number;
}
/** A fresh CPU Mobject per replay. The native queue updates animation, motion,
 * then camera; callers receive geometry and camera from that same lifetime.
 * This boundary does not import local Attractor documents or reinterpret their
 * simulationFps/seed/RK4 settings as native CPU settings. */
export function replaySourceAttractorCpu(options:SourceAttractorCpuReplayOptions){
 let particles:SourceAttractorCpuParticles|undefined;
 const frame=evaluateOrdinarySourceCameraTimeline(options.camera,options.tracks,options.fps,options.time,{
  particleActions:'attractor',isCancelled:options.isCancelled,
  createParticles:()=>particles=new SourceAttractorCpuParticles(options),
 });
 return{frame,particles:particles!};
}


export interface SourceAttractorCpuDisplayOptions extends SourceAttractorCpuReplayOptions {
 readonly visualConfiguration:SourceAttractorVisualConfiguration;
 readonly viewport:SourceCameraViewport;
 readonly referencePixelDensity?:number;
 /** Already parsed source background, supplied by the configuration owner. */
 readonly backgroundColor:number;
}
/** Production display boundary, independent of the public importer/editor.
 * The complete output pairs one replay's current head, retained substep trails,
 * palette and camera. Renderers consume only these delivered facts. */
export function generateSourceAttractorCpu(options:SourceAttractorCpuDisplayOptions):Extract<SceneOutput,{type:'geometry'}> {
 const started=performance.now();
 if(options.visualConfiguration===undefined)throw new Error('源吸引子显示需要完整视觉配置');
 if(!Number.isInteger(options.backgroundColor)||options.backgroundColor<0||options.backgroundColor>0xffffffff)throw new Error('源吸引子背景需要 uint32 颜色');
 // Reject invalid projection before allocating a warmup/particle history.
 prepareOrdinarySourceFrame({model:SOURCE_CAMERA_MODEL,time:0,frameIndex:0,camera:options.camera,viewport:options.viewport});
 const {frame,particles}=replaySourceAttractorCpu(options),snapshot=particles.snapshot(),visual=snapshot.visualConfiguration!;
 const sourceCameraFrame={model:SOURCE_CAMERA_MODEL,time:frame.time,frameIndex:frame.frameIndex,camera:structuredClone(frame.camera),viewport:{...options.viewport}};
 const plan=prepareOrdinarySourceFrame(sourceCameraFrame),scale=plan.displayScale,F=Math.fround;
 // StrangeAttractor.resolveTrailLineWeight ignores scale magnitude: a finite
 // positive scale selects .95; invalid/nonpositive selects 1. Preserve that.
 const trailWidth=Math.max(F(.1),F(F(visual.trails.lineWeight)*F(Number.isFinite(scale)&&scale>0?.95:1))),trails=snapshot.trails!;
 let invalid=0;for(let i=0;i<snapshot.positions.length;i+=3)if(!Number.isFinite(snapshot.positions[i])||!Number.isFinite(snapshot.positions[i+1])||!Number.isFinite(snapshot.positions[i+2]))invalid++;
 return{type:'geometry',topology:'points',backend:'cpu',positions:snapshot.positions,colors:snapshot.colors,pointAlphas:snapshot.pointAlphas,particleIds:snapshot.particleIds,
  sourceCameraFrame,sourcePointAppearance:sourceParticlePointAppearance(visual.points.dotRadius,plan,options.referencePixelDensity),sourceBackgroundColor:options.backgroundColor,
  ...(visual.trails.show?{trails:{positions:trails.positions,colors:trails.colors,alphas:trails.alphas,indices:trails.indices,appearance:{width:trailWidth,overlay:true,model:'processing-lines-1.7.8' as const}}}:{}),
  temporal:{time:frame.time,windowStart:trails.records?Math.min(frame.time,trails.oldestTime):frame.time,frames:frame.frameIndex+1,samplingFps:options.fps,recordedPoints:trails.records,cacheHits:0},
  stats:{samples:snapshot.positions.length/3,generated:snapshot.positions.length/3,invalid,elapsedMs:performance.now()-started},
  warnings:[...snapshot.diagnostics!,...frame.diagnostics.map(d=>d.message),'源吸引子 CPU 按固定帧率回放；原版实际帧率和完整画面尚未完成一致性验收。'],
 };
}
