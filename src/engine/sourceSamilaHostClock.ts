import type {SourceCameraScalars} from './sourceCamera';
export interface SourceSamilaClockRequest {paused:boolean;timestampMs?:number;}
export type SourceSamilaSavedAngles=Pick<SourceCameraScalars,'phi'|'theta'|'gamma'>;
const F=Math.fround,workerOrigin=Date.now();
/** Native PApplet uses wall-clock milliseconds relative to its own start. The
 * local worker has its own origin; it does not capture the original JVM clock. */
const workerMillis=()=>Date.now()-workerOrigin;
export function validateSourceSamilaClockRequest(request:SourceSamilaClockRequest):void {
 if(!request||typeof request.paused!=='boolean'||request.timestampMs!==undefined&&(!Number.isFinite(request.timestampMs)||Math.abs(request.timestampMs)>Number.MAX_SAFE_INTEGER))throw Error('Samila 实时时钟需要暂停状态与有限安全毫秒');
}
function sourceNow(timestamp:number):number {
 if(!Number.isFinite(timestamp)||Math.abs(timestamp)>Number.MAX_SAFE_INTEGER)throw Error('Samila 宿主毫秒超出安全范围');
 // System.currentTimeMillis - millisOffset, l2i, i2f, fdiv 1000F.
 return F(F(Math.trunc(timestamp)|0)/1000);
}
function angles(value:SourceSamilaSavedAngles):SourceSamilaSavedAngles {
 const result={phi:F(value.phi),theta:F(value.theta),gamma:F(value.gamma)};
 if(!Object.values(result).every(Number.isFinite))throw Error('Samila 暂停角度必须为有限 Float32');return result;
}
/** Host pause transitions and Scene.lastTime are separate from simulation.
 * Pause never reads time; resume resets lastTime and restores saved angles.
 * Neither operation performs a queue update or a display. */
export class SourceSamilaHostClock {
 private lastTime=0;private saved:SourceSamilaSavedAngles;private paused:boolean;
 private source:'worker-wall-clock'|'injected'='worker-wall-clock';
 constructor(paused:boolean,initial:SourceSamilaSavedAngles,private readonly now:()=>number=workerMillis){if(typeof paused!=='boolean')throw Error('Samila 初始暂停状态无效');this.paused=paused;this.saved=angles(initial);}
 private read(timestampMs?:number):number {const value=sourceNow(timestampMs??this.now());this.source=timestampMs===undefined?'worker-wall-clock':'injected';return value;}
 assertPaused(paused:boolean):void {if(paused!==this.paused)throw Error('Samila 暂停状态变化必须通过独立 setPaused 操作');}
 update(request:SourceSamilaClockRequest):number {
  validateSourceSamilaClockRequest(request);this.assertPaused(request.paused);if(this.paused)return 0;
  const now=this.read(request.timestampMs),dt=this.lastTime===0?0:F(now-this.lastTime);this.lastTime=now;return dt;
 }
 setPaused(paused:boolean,current:SourceSamilaSavedAngles,timestampMs?:number):SourceSamilaSavedAngles|undefined {
  validateSourceSamilaClockRequest({paused,timestampMs});if(paused===this.paused)return;
  if(paused){this.saved=angles(current);this.paused=true;return;}
  const now=this.read(timestampMs),restore={...this.saved};this.lastTime=now;this.paused=false;return restore;
 }
 diagnostics(){return{paused:this.paused,lastTime:this.lastTime,savedAngles:{...this.saved},clockSource:this.source};}
}
