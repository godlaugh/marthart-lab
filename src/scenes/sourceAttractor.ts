import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceAttractorScene} from '../engine/sourceAttractorDocument';
import {generateSourceAttractorCpu} from '../engine/sourceAttractorScene';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

/** Public Worker and export entry. Canonical authored inputs select the native
 * owner before the old local simulation, quality presets or density adapters. */
export function generateSourceAttractor(scene:SceneDocument,context:GenerateContext):SceneOutput {
 const prepared=prepareSourceAttractorScene(scene);
 const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context);
 return generateSourceAttractorCpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time,
  viewport:initial.viewport,referencePixelDensity:context.sourcePointPixelDensity,isCancelled:context.isCancelled});
}
