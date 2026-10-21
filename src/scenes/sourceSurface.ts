import {sourceParticlePointAppearance} from '../engine/sourceParticlePointAppearance';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {replaySourceSurface,type SourceSurfaceParticles} from '../engine/sourceSurfaceParticles';
import type {OrdinarySourceCameraFrame} from '../engine/ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../engine/ordinarySourceCamera';
import {usesSourceSurfaceHost} from '../engine/sourceSurfaceIdentity';
import type {SourceSurfaceHost} from '../engine/sourceSurfaceHost';
import {replaySourceSurfaceHost} from '../engine/sourceSurfaceScene';
import {sourceSurfaceMeshAppearance} from '../engine/sourceSurfaceMeshRenderer';

export type SourceSurfaceDisplayState=
 |{kind:'host';frame:OrdinarySourceCameraFrame;snapshot:ReturnType<SourceSurfaceHost['snapshot']>}
 |{kind:'points';frame:OrdinarySourceCameraFrame;points:ReturnType<SourceSurfaceParticles['snapshot']>};
/** Admission runs before allocating a fresh numerical producer. */
export function validateSourceSurfacePresentation(scene:SceneDocument,context:GenerateContext):void {
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('原版曲面需要源相机');
 const initialFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:initial}},context);
 const prepared=prepareOrdinarySourceFrame(initialFrame);
 if(!usesSourceSurfaceHost(scene))sourceParticlePointAppearance(scene.settings.pointSize,prepared,context.sourcePointPixelDensity);
}
export function generateSourceSurface(scene:SceneDocument,context:GenerateContext):SceneOutput {
 const started=performance.now();validateSourceSurfacePresentation(scene,context);
 if(usesSourceSurfaceHost(scene)){
  const replay=replaySourceSurfaceHost(scene,context.time,'all',context.isCancelled);
  return presentSourceSurfaceFrame(scene,context,{kind:'host',frame:replay.frame,snapshot:replay.host.snapshot()},started);
 }
 const replay=replaySourceSurface(scene,context.time,'all',context.isCancelled);
 return presentSourceSurfaceFrame(scene,context,{kind:'points',frame:replay.frame,points:replay.particles.snapshot()},started);
}
/** Rendering consumes one producer-owned frame; it never reconstructs a queue
 * or interprets authored parameter values as the current animation state. */
export function presentSourceSurfaceFrame(scene:SceneDocument,context:GenerateContext,state:SourceSurfaceDisplayState,started=performance.now()):SceneOutput {
 const frame=state.frame;let points:ReturnType<SourceSurfaceParticles['snapshot']>;
 const configuration=usesSourceSurfaceHost(scene)?scene.surfaceSource:undefined;
 let pointRadius=scene.settings.pointSize,trailWidth=Number(scene.settings.trailWidth);
 if(configuration){
  if(state.kind!=='host')throw Error('曲面展示帧与宿主配置不匹配');
  const snapshot=state.snapshot;
  if('gpuPoints' in snapshot){
   const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),gpu=snapshot.gpuPoints;
   return{type:'geometry',topology:'points',backend:'webgl2',positions:new Float32Array(),sourceGpuPoints:gpu.frame,
    sourcePointAppearance:sourceParticlePointAppearance(configuration.points.dotRadius,prepareOrdinarySourceFrame(sourceCameraFrame),context.sourcePointPixelDensity),sourceCameraFrame,
    sourceBackgroundColor:configuration.backgroundColor,
    temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
    stats:{samples:gpu.frame.seeds.length/4,generated:gpu.frame.seeds.length/4,invalid:0,elapsedMs:performance.now()-started},
    warnings:[...gpu.diagnostics,...frame.diagnostics.map(d=>d.message),'原版 GPU 点由着色器计算位置；跟踪点独立按 CPU 时钟更新。GPU 不绘制拖尾，创建时的点颜色不随渐变动作重建。原版完整画面尚未验收。'],
   };
  }
  if(snapshot.mode==='mesh'){
   const mesh=snapshot.mesh;
   if(mesh.gpuMesh){
    const gpu=mesh.gpuMesh;
    return{type:'geometry',topology:'mesh',backend:'webgl2',positions:new Float32Array(),sourceGpuMesh:{...gpu,referencePixelDensity:context.sourcePointPixelDensity},
     sourceBackgroundColor:configuration.backgroundColor,sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),
     temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
     stats:{samples:configuration.mesh.uSegments*configuration.mesh.vSegments,generated:gpu.seeds.length/4,invalid:0,elapsedMs:performance.now()-started},
     warnings:[...mesh.diagnostics,...frame.diagnostics.map(d=>d.message),'原版 GPU 网格位置与法线由着色器计算；参数更新保留创建时三角拓扑，独立线框不产生可见几何。原版完整画面尚未验收。'],
    };
   }
   const geometry=mesh.geometry,positions=geometry?.positions??new Float32Array(),indices=geometry?.triangles??new Uint32Array();
   return{type:'geometry',topology:'mesh',backend:'cpu',positions,indices,
    sourceMeshColors:mesh.packedColors,sourceMeshWireframe:mesh.wireframe,
    sourceMeshAppearance:sourceSurfaceMeshAppearance(mesh.fillEnabled,mesh.fillOpacity),
    sourceBackgroundColor:configuration.backgroundColor,sourceSurfaceOverlayAlpha:frame.surfaceTransition!.overlayAlpha,
    sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),
    temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
    stats:{samples:configuration.mesh.uSegments*configuration.mesh.vSegments,generated:positions.length/3,invalid:0,elapsedMs:performance.now()-started},
    warnings:[...mesh.diagnostics,...frame.diagnostics.map(d=>d.message),'原版 CPU 曲面采用源队列与 Float32 更新；原版完整画面一致性仍待完成。'],
   };
  }
  points=snapshot.points;pointRadius=configuration.points.dotRadius;trailWidth=configuration.points.lineWeight;
 }else{
  if(state.kind!=='points')throw Error('曲面展示帧与点配置不匹配');
  points=state.points;
 }
 const {positions,particleIds,trails,colors,pointAlphas,diagnostics}=points;
 let trailOutput;
 if(trails){
  trailOutput={positions:trails.positions,indices:trails.indices,alphas:trails.alphas,colors:trails.colors,appearance:{width:Math.max(Math.fround(.1),Math.fround(Math.fround(trailWidth)*Math.fround(.95))),overlay:true}};
 }
 const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context);
 const sourcePointAppearance=sourceParticlePointAppearance(pointRadius,prepareOrdinarySourceFrame(sourceCameraFrame),context.sourcePointPixelDensity);
 return{type:'geometry',topology:'points',backend:'cpu',positions,particleIds,colors,pointAlphas,...(trailOutput?{trails:trailOutput}:{}),
  sourceCameraFrame,sourcePointAppearance,...(configuration?{sourceBackgroundColor:configuration.backgroundColor,sourceSurfaceOverlayAlpha:frame.surfaceTransition!.overlayAlpha}:{}),
  temporal:{time:frame.time,windowStart:trails?Math.min(frame.time,trails.oldestTime):frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:trails?.records??0,cacheHits:0},
  stats:{samples:particleIds.length,generated:particleIds.length,invalid:0,elapsedMs:performance.now()-started},
  warnings:[...diagnostics,...frame.diagnostics.map(d=>d.message),'原版曲面粒子采用源队列、源索引与 Float32 运动；静态色板与边界点渐隐已按源规则接入；圆形光照点与纹理采用保留着色器规则；动态渐变按源回调顺序和历史年龄采样；原版应用完整画面尚未一致性验收。'],
 };
}
