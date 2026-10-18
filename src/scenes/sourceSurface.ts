import {sourceSurfacePointAppearance} from '../engine/sourceSurfacePointAppearance';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {replaySourceSurface} from '../engine/sourceSurfaceParticles';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from '../engine/ordinarySourceCamera';

export function generateSourceSurface(scene:SceneDocument,context:GenerateContext):SceneOutput {
 const started=performance.now();
 // Projection admission precedes full particle allocation. Later camera facts
 // are paired with positions from that SAME replay, not reevaluated by a view.
 const initial=ordinarySourceCameraInitial(scene)!;
 const initialFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:initial}},context);
 sourceSurfacePointAppearance(scene.settings.pointSize,prepareOrdinarySourceFrame(initialFrame),context.sourcePointPixelDensity);
 const {frame,particles}=replaySourceSurface(scene,context.time,'all',context.isCancelled),{positions,particleIds,trails,colors,pointAlphas,diagnostics}=particles.snapshot();
 let trailOutput;
 if(trails){
  trailOutput={positions:trails.positions,indices:trails.indices,alphas:trails.alphas,colors:trails.colors,appearance:{width:Math.max(Math.fround(.1),Math.fround(Math.fround(Number(scene.settings.trailWidth))*Math.fround(.95))),overlay:true}};
 }
 const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context);
 const sourcePointAppearance=sourceSurfacePointAppearance(scene.settings.pointSize,prepareOrdinarySourceFrame(sourceCameraFrame),context.sourcePointPixelDensity);
 return{type:'geometry',topology:'points',backend:'cpu',positions,particleIds,colors,pointAlphas,...(trailOutput?{trails:trailOutput}:{}),
  sourceCameraFrame,sourcePointAppearance,
  temporal:{time:frame.time,windowStart:trails?Math.min(frame.time,trails.oldestTime):frame.time,frames:frame.frameIndex+1,samplingFps:scene.timeline.fps,recordedPoints:trails?.records??0,cacheHits:0},
  stats:{samples:particleIds.length,generated:particleIds.length,invalid:0,elapsedMs:performance.now()-started},
  warnings:[...diagnostics,...frame.diagnostics.map(d=>d.message),'原版曲面粒子采用固定帧率、源索引与 Float32 运动；静态色板与边界点渐隐已按源规则接入；圆形光照点与纹理采用保留着色器规则；动态渐变按源回调顺序和历史年龄采样；原版应用完整画面尚未一致性验收。'],
 };
}
