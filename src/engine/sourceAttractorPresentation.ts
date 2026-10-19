import type {SceneDocument,SceneOutput} from '../types';
import {usesSourceAttractor} from './sourceAttractorDocument';

/** The producer already ran motion, gradients and tracking together. Display
 * consumers must not replay particles just to rediscover its delivered camera. */
export function sourceAttractorPresentedScene(scene:SceneDocument,output:SceneOutput):SceneDocument|undefined {
 if(!usesSourceAttractor(scene)||output.type!=='geometry'||output.backend!=='cpu'||!output.sourceCameraFrame)return undefined;
 return {...scene,evaluatedSourceCamera:output.sourceCameraFrame};
}
