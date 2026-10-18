import type {SceneDocument} from '../types';

/** Versioned identities keep older local samplers out of native replay paths. */
export const SOURCE_SURFACE_PARTICLES='mathart-1.7.8-points-v1';
export const SOURCE_SURFACE_MESH='mathart-1.7.8-mesh-v1';
export const SOURCE_SURFACE_CLIP_TYPES:readonly string[]=['wait','animate','align','trails','param'];
export const SOURCE_SURFACE_ACTION_METHODS:readonly string[]=['rotatePhi','rotateTheta','rotateGamma','rotateTo','zoom','focal','ambient','stopAmbient','track','stopTracking','gradientStart','gradientStop','paramStart','paramStop'];
type Identity=Pick<SceneDocument,'kind'|'settings'>;
export const usesSourceSurfaceParticles=(scene:Identity)=>scene.kind==='surface'&&scene.settings.surfaceGeometryVersion===SOURCE_SURFACE_PARTICLES;
export const usesSourceSurfaceMesh=(scene:Identity)=>scene.kind==='surface'&&scene.settings.surfaceGeometryVersion===SOURCE_SURFACE_MESH;
export const usesSourceSurfaceGeometry=(scene:Identity)=>usesSourceSurfaceParticles(scene)||usesSourceSurfaceMesh(scene);
