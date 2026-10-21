import {SourceFractalSceneClock,type SourceFractalSceneFrame} from './sourceFractalSceneClock';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';

export class SourceFractalPlaybackError extends Error {
 constructor(readonly code:'input'|'state'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceFractalPlaybackError';}
}
export interface SourceFractalPlaybackOptions {
 /** Reconstruct the whole owned scene, including formula/animator registries.
  * Reusing hooks bound to an older instance would corrupt seek/reset behavior. */
 readonly createScene:()=>SourceFractalSceneClock;
 readonly fps:number;
 readonly isCancelled?:()=>boolean;
 /** Optional shared request budget also used by parameter/gradient children. */
 readonly reserve?:(units:number)=>void;
}
export interface SourceFractalPlaybackFrame extends SourceFractalSceneFrame {
 /** -1 is an unadvanced fresh scene. Fixed time 0 renders update 1. */
 readonly displayFrame:number;
}
const WORK_LIMIT=2_000_000;
const FPS=(value:number)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<1||value>120)throw new SourceFractalPlaybackError('input','分形模拟帧率必须在 1–120');return value;};
const timeValue=(value:number)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>86400)throw new SourceFractalPlaybackError('input','分形回放时间必须在 0–86400 秒');return value;};

/** Frame host for the actual Fractal scene clock. Fixed replay and live updates
 * are distinct modes. This owner retains one state, not growing frame history;
 * backward seeks reconstruct all children through createScene. */
export class SourceFractalPlaybackSession {
 private scene?:SourceFractalSceneClock;
 private index=-1;
 private mode?:'fixed'|'live';
 private failed=false;
 private work=0;
 private readonly options:SourceFractalPlaybackOptions;
 constructor(options:SourceFractalPlaybackOptions){
  if(!options||typeof options.createScene!=='function')throw new SourceFractalPlaybackError('input','分形回放需要场景工厂与有界队列');
  this.options={...options,fps:FPS(options.fps)};
 }
 private check(){if(this.options.isCancelled?.())throw new SourceFractalPlaybackError('cancelled','分形回放已取消');}
 private owned():SourceFractalSceneClock {
  if(this.failed)throw new SourceFractalPlaybackError('state','分形回放失败后需要重置');
  this.check();return this.scene??=this.options.createScene();
 }
 private facts(frame:SourceFractalSceneFrame):SourceFractalPlaybackFrame{return{...frame,displayFrame:this.index};}
 private advance(dt:number,paused=false):SourceFractalPlaybackFrame {
  const scene=this.owned(),pending=scene.clipCount-scene.snapshot().queueIndex;
  const units=1+Math.max(0,pending);this.work+=units;if(this.work>WORK_LIMIT)throw new SourceFractalPlaybackError('capacity','分形单次回放超过 200 万工作预算');this.options.reserve?.(units);
  const frame=scene.step(dt,paused,this.options.isCancelled);this.index++;return this.facts(frame);
 }
 private run<T>(action:()=>T):T {this.work=0;try{return action();}catch(error){this.failed=true;throw error;}}
 /** The display grid uses each original fixed update, including terminal
  * double object updates. Seconds choose an ordinal, never a partial last dt. */
 evaluate(time:number):SourceFractalPlaybackFrame {
  timeValue(time);return this.evaluateFrame(Math.floor(time*this.options.fps+1e-9));
 }
 /** Recording supplies an exact display ordinal. Do not round-trip it through
  * seconds: fixed frame 0 is the first update, including the discarded warmup. */
 evaluateFrame(displayFrame:number):SourceFractalPlaybackFrame {
  if(!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame/this.options.fps>86400)throw new SourceFractalPlaybackError('input','分形显示帧必须是 24 小时范围内的非负整数');
  if(this.mode==='live')throw new SourceFractalPlaybackError('state','实时分形实例不能直接改为固定帧回放');
  return this.run(()=>{
   this.owned();
   if(displayFrame<this.index){this.reset();this.owned();}
   this.mode='fixed';while(this.index<displayFrame)this.advance(Math.fround(1/this.options.fps));
   return this.facts(this.owned().snapshot());
  });
 }
 snapshot():SourceFractalPlaybackFrame {return this.run(()=>this.facts(this.owned().snapshot()));}
 step(dt:number,paused=false):SourceFractalPlaybackFrame {
  if(this.mode==='fixed')throw new SourceFractalPlaybackError('state','固定帧分形实例需要明确重建后才能实时续接');
  return this.run(()=>{this.mode='live';return this.advance(dt,paused);});
 }
 /** Local seek reconstruction; original MathArt has no arbitrary seek API. */
 reconstruct(time:number):SourceFractalPlaybackFrame {timeValue(time);this.reset();const frame=this.evaluate(time);this.mode='live';return frame;}
 reset():void {this.scene=undefined;this.mode=undefined;this.index=-1;this.work=0;this.failed=false;}
 /** A fresh recording updates before display, discards one warmup, and checks
  * queue completion after that display. Even an empty queue gets one update.
  * This establishes ordinals, not successful rendering or encoding. */
 planRecording():SourceQueueRecordingClock {
  return this.run(()=>{
   if(this.scene||this.mode)throw new SourceFractalPlaybackError('state','分形录制规划必须使用新的场景实例');
   this.mode='fixed';let frame:SourceFractalPlaybackFrame;
   do{frame=this.advance(Math.fround(1/this.options.fps));}while(!frame.queueComplete);
   const updates=this.index+1;if(this.index/this.options.fps>86400)throw new SourceFractalPlaybackError('capacity','分形录制超过 24 小时');
   return{simulationFps:this.options.fps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
  });
 }
}
