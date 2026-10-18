import type {SceneDocument} from '../types';
import {usesSourceSurfaceMesh} from './sourceSurfaceIdentity';
import {replaySourceSurface} from './sourceSurfaceParticles';
import {replaySourceSurfaceMesh} from './sourceSurfaceMeshScene';

/** Camera queries select the same producer identity as full scene generation. */
export function replaySourceSurfaceCamera(scene:SceneDocument,time:number,isCancelled?:()=>boolean){
 return usesSourceSurfaceMesh(scene)?replaySourceSurfaceMesh(scene,time,'tracked',isCancelled).frame:replaySourceSurface(scene,time,'tracked',isCancelled).frame;
}
