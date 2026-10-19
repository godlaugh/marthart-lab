import {sourceSurfacePointAppearance} from '../engine/sourceSurfacePointAppearance';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {replaySourceSurface,type SourceSurfaceParticles} from '../engine/sourceSurfaceParticles';
import type {OrdinarySourceCameraFrame} from '../engine/ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../engine/ordinarySourceCamera';
import {usesSourceSurfaceHost} from '../engine/sourceSurfaceIdentity';
import {replaySourceSurfaceHost} from '../engine/sourceSurfaceScene';
import {sourceSurfaceMeshAppearance} from '../engine/sourceSurfaceMeshRenderer';

export function generateSourceSurface(scene:SceneDocument,context:GenerateContext):SceneOutput {
 const started=performance.now();
 // Projection admission precedes full particle allocation. Later camera facts
 // are paired with positions from that SAME replay, not reevaluated by a view.
 const initial=ordinarySourceCameraInitial(scene)!;
 const initialFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:initial}},context);
 let frame:OrdinarySourceCameraFrame,points:ReturnType<SourceSurfaceParticles['snapshot']>;
 const configuration=usesSourceSurfaceHost(scene)?scene.surfaceSource:undefined;
 let pointRadius=scene.settings.pointSize,trailWidth=Number(scene.settings.trailWidth);
 if(configuration){
  prepareOrdinarySourceFrame(initialFrame);
  const replay=replaySourceSurfaceHost(scene,context.time,'all',context.isCancelled),snapshot=replay.host.snapshot();frame=replay.frame;
  if('gpuPoints' in snapshot){
   const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),gpu=snapshot.gpuPoints;
   return{type:'geometry',topology:'points',backend:'webgl2',positions:new Float32Array(),sourceGpuPoints:gpu.frame,
    sourcePointAppearance:sourceSurfacePointAppearance(configuration.points.dotRadius,prepareOrdinarySourceFrame(sourceCameraFrame),context.sourcePointPixelDensity),sourceCameraFrame,
    sourceSurfaceBackgroundColor:configuration.backgroundColor,
    temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
    stats:{samples:gpu.frame.seeds.length/4,generated:gpu.frame.seeds.length/4,invalid:0,elapsedMs:performance.now()-started},
    warnings:[...gpu.diagnostics,...frame.diagnostics.map(d=>d.message),'原版 GPU 点由着色器计算位置；跟踪点独立按 CPU 时钟更新。GPU 不绘制拖尾，创建时的点颜色不随渐变动作重建。原版完整画面尚未验收。'],
   };
  }
  if(snapshot.mode==='mesh'){
   const mesh=snapshot.mesh,geometry=mesh.geometry,positions=geometry?.positions??new Float32Array(),indices=geometry?.triangles??new Uint32Array();
   return{type:'geometry',topology:'mesh',backend:'cpu',positions,indices,
    sourceMeshColors:mesh.packedColors,sourceMeshWireframe:mesh.wireframe,
    sourceMeshAppearance:sourceSurfaceMeshAppearance(mesh.fillEnabled,mesh.fillOpacity),
    sourceSurfaceBackgroundColor:configuration.backgroundColor,sourceSurfaceOverlayAlpha:frame.surfaceTransition!.overlayAlpha,
    sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),
    temporal:{time:frame.time,windowStart:frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
    stats:{samples:configuration.mesh.uSegments*configuration.mesh.vSegments,generated:positions.length/3,invalid:0,elapsedMs:performance.now()-started},
    warnings:[...mesh.diagnostics,...frame.diagnostics.map(d=>d.message),'原版 CPU 曲面按固定帧率回放；GPU 与原版完整画面一致性仍待完成。'],
   };
  }
  points=snapshot.points;pointRadius=configuration.points.dotRadius;trailWidth=configuration.points.lineWeight;
 }else{
  sourceSurfacePointAppearance(pointRadius,prepareOrdinarySourceFrame(initialFrame),context.sourcePointPixelDensity);
  const replay=replaySourceSurface(scene,context.time,'all',context.isCancelled);frame=replay.frame;points=replay.particles.snapshot();
 }
 const {positions,particleIds,trails,colors,pointAlphas,diagnostics}=points;
 let trailOutput;
 if(trails){
  trailOutput={positions:trails.positions,indices:trails.indices,alphas:trails.alphas,colors:trails.colors,appearance:{width:Math.max(Math.fround(.1),Math.fround(Math.fround(trailWidth)*Math.fround(.95))),overlay:true}};
 }
 const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context);
 const sourcePointAppearance=sourceSurfacePointAppearance(pointRadius,prepareOrdinarySourceFrame(sourceCameraFrame),context.sourcePointPixelDensity);
 return{type:'geometry',topology:'points',backend:'cpu',positions,particleIds,colors,pointAlphas,...(trailOutput?{trails:trailOutput}:{}),
  sourceCameraFrame,sourcePointAppearance,...(configuration?{sourceSurfaceBackgroundColor:configuration.backgroundColor,sourceSurfaceOverlayAlpha:frame.surfaceTransition!.overlayAlpha}:{}),
  temporal:{time:frame.time,windowStart:trails?Math.min(frame.time,trails.oldestTime):frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:trails?.records??0,cacheHits:0},
  stats:{samples:particleIds.length,generated:particleIds.length,invalid:0,elapsedMs:performance.now()-started},
  warnings:[...diagnostics,...frame.diagnostics.map(d=>d.message),'原版曲面粒子采用固定帧率、源索引与 Float32 运动；静态色板与边界点渐隐已按源规则接入；圆形光照点与纹理采用保留着色器规则；动态渐变按源回调顺序和历史年龄采样；原版应用完整画面尚未一致性验收。'],
 };
}
