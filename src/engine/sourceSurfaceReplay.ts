import type {SceneDocument} from '../types';
import {usesSourceSurfaceHost} from './sourceSurfaceIdentity';
import {replaySourceSurface} from './sourceSurfaceParticles';
import {replaySourceSurfaceHost} from './sourceSurfaceScene';

/** Camera queries select the same producer identity as full scene generation. */
export function replaySourceSurfaceCamera(scene:SceneDocument,time:number,isCancelled?:()=>boolean){
 return usesSourceSurfaceHost(scene)?replaySourceSurfaceHost(scene,time,'tracked',isCancelled).frame:replaySourceSurface(scene,time,'tracked',isCancelled).frame;
}
