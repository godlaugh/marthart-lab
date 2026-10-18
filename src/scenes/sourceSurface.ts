import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {replaySourceSurface} from '../engine/sourceSurfaceParticles';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';
import {vertexColors} from '../engine/palette';
import {geometryColorModel,surfacePaletteSampler} from '../engine/geometryColor';

export function generateSourceSurface(scene:SceneDocument,context:GenerateContext):SceneOutput {
 const started=performance.now();
 // Projection admission precedes full particle allocation. Later camera facts
 // are paired with positions from that SAME replay, not reevaluated by a view.
 const initial=ordinarySourceCameraInitial(scene)!;
 ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:initial}},context);
 const {frame,particles}=replaySourceSurface(scene,context.time,'all',context.isCancelled),{positions,particleIds}=particles.snapshot();
 const coloring=geometryColorModel(scene);let colors:Float32Array;
 if(coloring.surface==='parameter-u'){
  const closed=coloring.closure==='closed'||coloring.closure==='auto'&&scene.settings.periodicU===true,sample=surfacePaletteSampler(scene.palette,closed);
  colors=new Float32Array(positions.length);const nu=Number(scene.settings.uSegments),nv=Number(scene.settings.vSegments);
  for(let id=0;id<particleIds.length;id++)colors.set(sample((nu-1-Math.floor(id/nv))/Math.max(1,nu-1)),id*3);
 }else colors=vertexColors(positions,scene.palette,String(scene.settings.colorMetric??'height') as 'height'|'radius'|'angle'|'index');
 return{type:'geometry',topology:'points',backend:'cpu',positions,particleIds,colors,
  sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context),
  temporal:{time:frame.time,windowStart:frame.time,frames:1,samplingFps:scene.timeline.fps,recordedPoints:0,cacheHits:0},
  stats:{samples:particleIds.length,generated:particleIds.length,invalid:0,elapsedMs:performance.now()-started},
  warnings:[...frame.diagnostics.map(d=>d.message),'原版曲面粒子采用固定帧率、源索引与 Float32 运动；当前调色、点外观及原版应用完整画面尚未一致性验收。'],
 };
}
