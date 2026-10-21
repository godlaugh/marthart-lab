import {usesSourcePerlin} from './sourcePerlinIdentity';
import type {SceneDocument,SceneOutput} from '../types';
import {usesSourceAttractor} from './sourceAttractorDocument';

/** The producer already ran motion, gradients and its source queue. Display
 * consumers must not replay particles just to rediscover its delivered camera. */
export function sourceQueuePresentedScene(scene:SceneDocument,output:SceneOutput):SceneDocument|undefined {
 if(!(usesSourceAttractor(scene)||usesSourcePerlin(scene)||output.type==='raster'&&(scene.kind==='symmetry'&&output.symmetryLive!==undefined||scene.kind==='map'&&output.mapLive!==undefined))||!output.sourceCameraFrame)return undefined;
 return {...scene,evaluatedSourceCamera:output.sourceCameraFrame};
}
