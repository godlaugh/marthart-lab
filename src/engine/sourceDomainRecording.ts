import type {SceneDocument} from '../types';
import {prepareSourceDomainScene} from './sourceDomainTimeline';
import {sourceDomainQueueDuration} from './sourceDomainQueueDuration';
import {RootsSceneClock} from './rootsSceneClock';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';

export class SourceDomainRecordingError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceDomainRecordingError';}
}

/** Queue completion depends on fixed dt and group durations, not the observed
 * PApplet.frameRate used by parameter animators. This planner predicts only
 * ordinals; each recorded image still needs a real host update with its own
 * observed FPS. It neither evaluates parameters nor predicts raster success. */
export function planDomainRecordingClock(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean):SourceQueueRecordingClock {
 if(typeof simulationFps!=='number'||!Number.isFinite(simulationFps)||simulationFps<1||simulationFps>120)throw new SourceDomainRecordingError('input','域着色录制模拟帧率必须在 1–120');
 const check=()=>{if(isCancelled?.())throw new SourceDomainRecordingError('cancelled','域着色录制规划已取消');};check();
 const plan=prepareSourceDomainScene(scene),clips=plan.clips.map(c=>({duration:sourceDomainQueueDuration(c),easing:'linear'}));
 const clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},clips),dt=Math.fround(1/Math.fround(simulationFps));
 let updates=0,work=0;
 do{
  check();work+=1+clips.length-clock.snapshot().queueIndex;
  if(work>2_000_000||updates/simulationFps>86400)throw new SourceDomainRecordingError('capacity','域着色录制规划超过 200 万工作预算或 24 小时');
  clock.step(dt,{isCancelled});updates++;
 }while(!clock.snapshot().queueComplete);
 check();return{simulationFps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
}
