/** Work-paced preview advances at most one fixed sample step after the previous
 * result completes. Wall-clock delays are never accumulated as catch-up work. */
export function readyPlaybackStep(clock:number,lastStepMs:number,nowMs:number,samplingFps:number,previewFps:number,pending:boolean):{clock:number;lastStepMs:number;advanced:boolean}{
  if(![clock,lastStepMs,nowMs].every(Number.isFinite)||clock<0||lastStepMs<0||nowMs<lastStepMs)throw new Error('播放时钟无效');
  if(![samplingFps,previewFps].every(value=>Number.isInteger(value)&&value>=1&&value<=120))throw new Error('播放采样频率须为 1–120 的整数');
  if(pending||nowMs-lastStepMs<1000/Math.min(samplingFps,previewFps))return{clock,lastStepMs,advanced:false};
  return{clock:clock+1/samplingFps,lastStepMs:nowMs,advanced:true};
}
