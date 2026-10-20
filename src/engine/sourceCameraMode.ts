import type {SceneDocument} from '../types';

export const CAPTURED_DENSITY_CAMERA_MODEL='captured-density-v1' as const;
type Scene=Pick<SceneDocument,'kind'|'settings'>&Partial<Pick<SceneDocument,'sourceCamera'|'perlinSource'|'perlinCpuSource'|'perlinGpuSource'>>;
export type SourceCameraMode=
 | {readonly kind:'local'}
 | {readonly kind:'ordinary'}
 | {readonly kind:'captured-density';readonly family:'map'|'symmetry'}
 | {readonly kind:'unsupported';readonly reason:'unknown-density-model'|'density-family'|'density-not-continuous'|'density-camera-missing'|'display-mode'};

/** Geometric applicability predates the source marker. Importers use it before
 * installing a camera; it does not activate a source camera on an old document. */
export function ordinarySourceCameraGeometry(scene:Scene):boolean{
 if(scene.kind==='perlin'&&(scene.perlinSource!==undefined||scene.perlinCpuSource!==undefined||scene.perlinGpuSource!==undefined))return true;
 if(scene.kind==='surface'||scene.kind==='implicit')return true;
 if(scene.kind==='attractor')return scene.settings.presentation!=='density';
 return scene.kind==='perlin'&&scene.settings.style==='continuous'&&['heads','trails'].includes(String(scene.settings.particleDisplay));
}
/** Owns display dispatch only. Numeric camera parsing and source projection
 * remain with sourceCamera; no module here imports those runtime consumers. */
export function sourceCameraMode(scene:Scene):SourceCameraMode{
 const marker=scene.settings.iteratedCameraModel;
 if(marker!==undefined){
  if(marker!==CAPTURED_DENSITY_CAMERA_MODEL)return{kind:'unsupported',reason:'unknown-density-model'};
  if(scene.kind!=='map'&&scene.kind!=='symmetry')return{kind:'unsupported',reason:'density-family'};
  if(scene.settings.iteratedMode!=='continuous')return{kind:'unsupported',reason:'density-not-continuous'};
  if(scene.sourceCamera===undefined)return{kind:'unsupported',reason:'density-camera-missing'};
  return{kind:'captured-density',family:scene.kind};
 }
 if(scene.sourceCamera===undefined)return{kind:'local'};
 return ordinarySourceCameraGeometry(scene)?{kind:'ordinary'}:{kind:'unsupported',reason:'display-mode'};
}
export const usesCapturedDensityCamera=(scene:Scene)=>sourceCameraMode(scene).kind==='captured-density';
// Fixed 1.7.8 JsonMapAttractorConfig / JsonSymmetryChaosConfig camera dispatch.
// Neither family dispatches track or stopTracking; Symmetry has no align clip.
export const CAPTURED_DENSITY_CAMERA_ACTIONS:readonly string[]=['ambient','stopAmbient','rotateTheta','rotatePhi','rotateGamma','rotateTo','zoom','focal'];
export function capturedDensityCameraClipTypes(scene:Scene):readonly string[]{
 const mode=sourceCameraMode(scene);
 return mode.kind!=='captured-density'?[]:mode.family==='map'?['wait','animate','align']:['wait','animate'];
}
