import {importSourceParticleGradient} from './sourceParticleGradientImport';
export {SOURCE_PARTICLE_GRADIENT_SOURCE_FIELDS as SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS,sourceParticleGradientPayload as sourceSurfaceGradientPayload,type SourceParticleGradientPayload as SourceSurfaceGradientPayload,type SourceParticleGradientImportFacts as SourceSurfaceGradientImportFacts} from './sourceParticleGradientImport';
/** Surface alone excludes targetDomain FRACTAL at its child builder. */
export const importSourceSurfaceGradient=(args:unknown)=>importSourceParticleGradient(args,'surface');
