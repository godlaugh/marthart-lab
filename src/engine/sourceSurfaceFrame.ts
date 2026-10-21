import type {OrdinaryCameraParticleFrame} from './ordinarySourceCameraTimeline';

/** Surface parameters consume PApplet.frameRate, independently of simulation
 * dt. Fixed reconstruction omits the observation and explicitly uses its FPS. */
export interface SourceSurfaceUpdateFrame extends OrdinaryCameraParticleFrame {
 readonly actualFrameRate?:number;
}
export function sourceSurfaceParameterFrameRate(frame:SourceSurfaceUpdateFrame,fixedFrameRate:number):number {
 const value=frame.actualFrameRate===undefined?fixedFrameRate:frame.actualFrameRate;
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw Error('曲面宿主观测帧率必须为有限 Float32');
 // Preserve <=1: the original parameter animator owns its fallback to 60.
 return Math.fround(value);
}
