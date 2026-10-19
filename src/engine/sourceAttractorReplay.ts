import type {SceneDocument} from '../types';
import {prepareSourceAttractorScene} from './sourceAttractorDocument';
import {replaySourceAttractorCpu} from './sourceAttractorScene';
import {replaySourceAttractorGpu} from './sourceAttractorGpuReplay';

/** CPU tracking follows current particles; native GPU tracking deliberately
 * retains the initial CPU Dot3D. Neither path uses a local simulation. */
export function replaySourceAttractorCamera(scene:SceneDocument,time:number,isCancelled?:()=>boolean){
 const prepared=prepareSourceAttractorScene(scene);
 if(prepared.backend==='gpu')return replaySourceAttractorGpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time,isCancelled}).frame;
 return replaySourceAttractorCpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time,isCancelled}).frame;
}
