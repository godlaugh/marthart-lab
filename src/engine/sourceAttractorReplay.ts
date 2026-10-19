import type {SceneDocument} from '../types';
import {prepareSourceAttractorScene} from './sourceAttractorDocument';
import {replaySourceAttractorCpu} from './sourceAttractorScene';

/** Camera-only consumers still query the actual motion owner. No static seed
 * surrogate or local RK4 simulation stands in for the displayed particles. */
export function replaySourceAttractorCamera(scene:SceneDocument,time:number,isCancelled?:()=>boolean){
 const prepared=prepareSourceAttractorScene(scene);
 return replaySourceAttractorCpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time,isCancelled}).frame;
}
