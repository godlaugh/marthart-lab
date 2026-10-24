import type {SourceCameraScalars} from './sourceCamera';
export interface SourceSceneClockRequest {paused:boolean;timestampMs?:number;}
export type SourceSceneSavedAngles=Pick<SourceCameraScalars,'phi'|'theta'|'gamma'>;
const F=Math.fround,workerOrigin=Date.now();
/** Native PApplet uses wall-clock milliseconds relative to its own start. The
 * local worker has its own origin; it does not capture the original JVM clock. */
const workerMillis=()=>Date.now()-workerOrigin;
export function validateSourceSceneClockRequest(request:SourceSceneClockRequest):void {
 if(!request||typeof request.paused!=='boolean'||request.timestampMs!==undefined&&(!Number.isFinite(request.timestampMs)||Math.abs(request.timestampMs)>Number.MAX_SAFE_INTEGER))throw Error('场景 实时时钟需要暂停状态与有限安全毫秒');
}
function sourceNow(timestamp:number):number {
 if(!Number.isFinite(timestamp)||Math.abs(timestamp)>Number.MAX_SAFE_INTEGER)throw Error('场景 宿主毫秒超出安全范围');
 // System.currentTimeMillis - millisOffset, l2i, i2f, fdiv 1000F.
 return F(F(Math.trunc(timestamp)|0)/1000);
}
function angles(value:SourceSceneSavedAngles):SourceSceneSavedAngles {
 const result={phi:F(value.phi),theta:F(value.theta),gamma:F(value.gamma)};
 if(!Object.values(result).every(Number.isFinite))throw Error('场景 暂停角度必须为有限 Float32');return result;
}
/** Host pause transitions and Scene.lastTime are separate from simulation.
 * Pause never reads time; resume resets lastTime and restores saved angles.
 * Neither operation performs a queue update or a display. */
export class SourceSceneHostClock<S extends 'worker-wall-clock'|'page-wall-clock'='worker-wall-clock'> {
 private lastTime=0;private saved:SourceSceneSavedAngles;private paused:boolean;
 private source:S|'injected';
 constructor(paused:boolean,initial:SourceSceneSavedAngles,private readonly now:()=>number=workerMillis,private readonly clockSource:S='worker-wall-clock' as S){if(typeof paused!=='boolean')throw Error('场景 初始暂停状态无效');this.paused=paused;this.saved=angles(initial);this.source=clockSource;}
 private read(timestampMs?:number):number {const value=sourceNow(timestampMs??this.now());this.source=timestampMs===undefined?this.clockSource:'injected';return value;}
 assertPaused(paused:boolean):void {if(paused!==this.paused)throw Error('场景 暂停状态变化必须通过独立 setPaused 操作');}
 /** Scene.disableRenderMode resets wall time without pausing or restoring
  * saved angles. Recording completion must not reuse pause/resume semantics. */
 resetTime(timestampMs?:number):void {this.lastTime=this.read(timestampMs);}
 update(request:SourceSceneClockRequest):number {
  validateSourceSceneClockRequest(request);this.assertPaused(request.paused);if(this.paused)return 0;
  const now=this.read(request.timestampMs),dt=this.lastTime===0?0:F(now-this.lastTime);this.lastTime=now;return dt;
 }
 setPaused(paused:boolean,current:SourceSceneSavedAngles,timestampMs?:number):SourceSceneSavedAngles|undefined {
  validateSourceSceneClockRequest({paused,timestampMs});if(paused===this.paused)return;
  if(paused){this.saved=angles(current);this.paused=true;return;}
  const now=this.read(timestampMs),restore={...this.saved};this.lastTime=now;this.paused=false;return restore;
 }
 /** Native MathArt.forceResume does not reset Scene.lastTime or restore angles. */
 forceResume():void {this.paused=false;}
 diagnostics(){return{paused:this.paused,lastTime:this.lastTime,savedAngles:{...this.saved},clockSource:this.source};}
}
