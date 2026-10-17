import {advanceSpirographSourcePhase,prepareSpirographSourceProfile,spirographSourceRotationRate,SPIROGRAPH_SOURCE_MAX_SECONDS} from './spirographModel';
import type {SpirographSourceFrame,SpirographSourceMotionLayer} from './spirographModel';
import {sourceEase} from './sourceEasing';

export type SpirographClockVersion='source-frame-v1';
/** Clock omission retains the earlier 60 Hz / continuous-angle contract. */
export function parseSpirographClock(raw:unknown):SpirographClockVersion|undefined {
  if(raw===undefined)return undefined;
  if(raw==='source-frame-v1')return raw;
  throw new Error('未知旋轮帧时钟');
}
export interface SpirographReplayClip {readonly id:string;readonly kind:'wait'|'rotate'|'finish-wait';readonly duration:number;readonly easing?:string;readonly targetRate?:number;}
export interface SpirographReplayEvent {readonly beforeFrame:number;readonly type:'clear'|'restart'|'finish';}
export type SpirographReplayClock={readonly kind:'offline-fixed';readonly fps:number}|{readonly kind:'retained-millis';readonly frames:readonly {readonly millis:number;readonly paused?:boolean;readonly resume?:boolean}[]};
export interface SpirographReplaySettings {readonly startEaseEnabled?:boolean;readonly endEaseEnabled?:boolean;readonly fadeInStatorsOnStart?:boolean;readonly fadeOutStatorsOnFinish?:boolean;}
export interface SpirographReplayInput {
  readonly layers:readonly SpirographSourceMotionLayer[];
  readonly settings:SpirographReplaySettings;
  readonly clips:readonly SpirographReplayClip[];
  readonly clock:SpirographReplayClock;
  readonly initialRate?:number;
  readonly events?:readonly SpirographReplayEvent[];
  readonly recording?:boolean;
}
export interface SpirographReplayClipFact {
  readonly id:string;readonly index:number;readonly startFrame:number|null;readonly endFrame:number|null;
  readonly startSeconds:number|null;readonly endSeconds:number|null;readonly runtime:number;
}
export interface SpirographReplayFrame extends SpirographSourceFrame {
  /** frame is relative to this plan; absoluteFrame also survives recording forks. */
  readonly absoluteFrame:number;readonly sceneTime:number;readonly rawDt:number;readonly activeDt:number;
  readonly rotationRate:number;readonly rotationRadians:number;readonly activeLayer:number;
  readonly elapsedMotionSeconds:readonly number[];readonly closed:readonly boolean[];
  readonly clearedPhases:readonly number[];
  readonly geometryFinished:boolean;readonly visualFinished:boolean;
  readonly queueIndex:number;readonly queueFinished:boolean;readonly clipRuntime:number;
  readonly queueCompleteFrame:number|null;readonly queueCompleteSeconds:number|null;
  readonly clips:readonly SpirographReplayClipFact[];
  readonly paused:boolean;readonly encodedFrameIndex:number|null;readonly encodedFrames:number;
  readonly recordingFinished:boolean;
}
export interface SpirographReplaySchedule {
  readonly frame:number;readonly absoluteFrame:number;readonly sceneTime:number;
  readonly finished:boolean;readonly clips:readonly SpirographReplayClipFact[];
  readonly queueCompleteFrame:number|null;readonly queueCompleteSeconds:number|null;
  readonly recordingFinished:boolean;readonly encodedFrames:number;
}
export interface PreparedSpirographReplay {
  sample(frame:number,isCancelled?:()=>boolean):SpirographReplayFrame;
  schedule(throughFrame:number,isCancelled?:()=>boolean):SpirographReplaySchedule;
  /** Owned checkpoint fork: no writable external state or identity token. The new
   * index 0 is the selected preview state. Only its future clock changes. */
  forkRecording(startFrame:number,fps:number,isCancelled?:()=>boolean):PreparedSpirographReplay;
  diagnostics():{readonly retainedCheckpoints:number;readonly estimatedRetainedBytes:number;readonly advancedFrames:number;readonly disposed:boolean};
  dispose():void;
}
// Saved timeline capacity (24 h at the highest supported 120 fps). Four queried
// checkpoints plus initial/high-water states retain O(layers + clips) memory.
export const SPIROGRAPH_REPLAY_MAX_FRAMES=SPIROGRAPH_SOURCE_MAX_SECONDS*120;
const F=Math.fround,FADE=.6;
const constrain=(x:number)=>x<0?0:x>1?1:x;
const requireFinite=(x:number,label:string)=>{if(!Number.isFinite(x))throw new Error(`旋轮帧回放 ${label} 非有限值`);return x;};
const abort=(cancel?:()=>boolean)=>{if(cancel?.()){const error=new Error('旋轮帧回放已取消');error.name='AbortError';throw error;}};
export function parseSpirographReplayFps(fps:number):number {if(!Number.isInteger(fps)||fps<1||fps>120)throw new Error('旋轮模拟帧率必须为 1–120 的整数');return fps;}
interface State {
  frame:number;absoluteFrame:number;sceneTime:number;rawDt:number;activeDt:number;lastTime:number;paused:boolean;
  rate:number;angle:number;phases:number[];elapsed:number[];closed:boolean[];cleared:number[];
  startSeconds:(number|null)[];endSeconds:(number|null)[];active:number;fadeIn:number;fadeOut:number;
  geometrySeconds:number|null;visualSeconds:number|null;
  queue:number;current:boolean;runtime:number;startRate:number;clips:SpirographReplayClipFact[];
  queueCompleteFrame:number|null;queueCompleteSeconds:number|null;
  warmup:number;encoded:number;encodedFrameIndex:number|null;recordingFinished:boolean;
}
type ClockFacts={kind:'offline-fixed';fps:number}|{kind:'retained-millis';millis:Int32Array;flags:Uint8Array};
function prepareClock(clock:SpirographReplayClock):ClockFacts {
  if(clock.kind==='offline-fixed')return{kind:'offline-fixed',fps:parseSpirographReplayFps(clock.fps)};
  if(clock.kind!=='retained-millis')throw new Error('未知旋轮回放时钟');
  if(clock.frames.length>SPIROGRAPH_REPLAY_MAX_FRAMES)throw new Error('旋轮保留时钟超过帧容量');
  // Five bytes per supplied frame (at most 51.84 MB); avoid retaining a second
  // object graph for a long supplied trace. Validate capacity before allocation.
  const millis=new Int32Array(clock.frames.length),flags=new Uint8Array(clock.frames.length);
  for(let i=0;i<clock.frames.length;i++){
    const f=clock.frames[i];
    if(!Number.isInteger(f.millis)||f.millis<0||f.millis>2147483647)throw new Error('保留时钟 millis 须为非负 Java int；时钟溢出未受支持');
    millis[i]=f.millis;flags[i]=(f.paused===true?1:0)|(f.resume===true?2:0);
  }
  return{kind:'retained-millis',millis,flags};
}
function clone(s:State):State {return{...s,phases:[...s.phases],elapsed:[...s.elapsed],closed:[...s.closed],cleared:[...s.cleared],startSeconds:[...s.startSeconds],endSeconds:[...s.endSeconds],clips:s.clips.map(c=>({...c}))};}

/** Static source contract: SceneManager updates one Animation before Mobject,
 * with no residual dt carry into the next clip. This reproduces staged float
 * time/rate arithmetic; JS/Java transcendental last-bit parity is not asserted.
 * A retained millis trace reproduces that trace, not an inferred live history. */
export function prepareSpirographReplay(input:SpirographReplayInput):PreparedSpirographReplay {
  // Same layer capacity as the prepared Spirograph document producer.
  if(input.layers.length>32)throw new Error('旋轮帧回放图层超过 32 项容量');
  const layers=input.layers.map(l=>{
    if(!Number.isFinite(l.speed)||l.speed<0||!Number.isFinite(l.closureDegrees)||l.closureDegrees<=0)throw new Error('旋轮帧回放需要有限非负速度与正闭合相位');
    return{...l};
  });
  if(input.clips.length>2000)throw new Error('旋轮帧队列超过 1000 片段及其前置等待容量');
  const clips=input.clips.map(c=>{
    if(!['wait','rotate','finish-wait'].includes(c.kind)||typeof c.id!=='string'||!Number.isFinite(c.duration)||c.duration<0||c.duration>SPIROGRAPH_SOURCE_MAX_SECONDS)throw new Error('旋轮帧片段长度须在 0–86400 秒内');
    const duration=F(c.duration),easing=c.easing??'sine-in-out';
    if(c.kind==='rotate')sourceEase(easing,0); // validate name once; no result clamp
    return{...c,duration,easing,...(c.targetRate===undefined?{}:{targetRate:spirographSourceRotationRate(c.targetRate)})};
  });
  const profiles=layers.map(l=>prepareSpirographSourceProfile(l.speed,l.closureDegrees));
  const settings={...input.settings},fadeIn=settings.fadeInStatorsOnStart===true,fadeOut=settings.fadeOutStatorsOnFinish===true&&layers.some(l=>l.visible&&l.showGuides);
  const events=new Map<number,SpirographReplayEvent['type']>();
  if((input.events?.length??0)>4096)throw new Error('旋轮帧事件超过 4096 项容量');
  for(const e of input.events??[]){
    if(!Number.isSafeInteger(e.beforeFrame)||e.beforeFrame<1||e.beforeFrame>SPIROGRAPH_REPLAY_MAX_FRAMES||!['clear','restart','finish'].includes(e.type))throw new Error('旋轮帧事件无效');
    // MathArt stores one pendingTraceOperation integer, consumed before update.
    events.set(e.beforeFrame,e.type);
  }
  const clock=prepareClock(input.clock);
  if(input.recording&&clock.kind!=='offline-fixed')throw new Error('源录制须使用明确离线帧率');
  const runnable=(i:number)=>layers[i].visible&&layers[i].enabled;
  const next=(s:State,i:number)=>{while(i<layers.length&&(!runnable(i)||s.closed[i]))i++;return i;};
  const geometry=(s:State)=>next(s,0)===layers.length;
  const visual=(s:State)=>geometry(s)&&(!fadeOut||s.fadeOut>=FADE);
  const syncCompletion=(s:State)=>{if(geometry(s))s.geometrySeconds??=s.sceneTime;if(visual(s))s.visualSeconds??=s.sceneTime;};
  const initial:State={frame:0,absoluteFrame:0,sceneTime:0,rawDt:0,activeDt:0,lastTime:0,paused:false,rate:spirographSourceRotationRate(input.initialRate),angle:0,phases:layers.map(()=>0),elapsed:layers.map(()=>0),closed:layers.map(()=>false),cleared:layers.map(()=>0),startSeconds:layers.map(()=>null),endSeconds:layers.map(()=>null),active:0,fadeIn:fadeIn?0:FADE,fadeOut:0,geometrySeconds:null,visualSeconds:null,queue:0,current:false,runtime:0,startRate:0,clips:clips.map((c,index)=>({id:c.id,index,startFrame:null,endFrame:null,startSeconds:null,endSeconds:null,runtime:0})),queueCompleteFrame:clips.length?null:0,queueCompleteSeconds:clips.length?null:0,warmup:input.recording?1:0,encoded:0,encodedFrameIndex:null,recordingFinished:false};
  syncCompletion(initial);
  const applyEvent=(s:State)=>{
    switch(events.get(s.absoluteFrame)){
      case 'clear':s.cleared=[...s.phases];break;
      case 'restart':
        s.phases.fill(0);s.elapsed.fill(0);s.closed.fill(false);s.cleared.fill(0);s.startSeconds.fill(null);s.endSeconds.fill(null);s.active=0;s.fadeIn=fadeIn?0:FADE;s.fadeOut=0;s.geometrySeconds=null;s.visualSeconds=null;break;
      case 'finish':
        for(let i=s.active;i<layers.length;i++)if(runnable(i)&&layers[i].autoStopOnClosure&&!s.closed[i]){s.phases[i]=layers[i].closureDegrees;s.closed[i]=true;s.startSeconds[i]??=s.sceneTime;s.endSeconds[i]=s.sceneTime;}
        s.active=layers.length;s.fadeOut=0;s.visualSeconds=null;break;
    }
    syncCompletion(s);
  };
  const advanceObject=(s:State,dt:number,beforeTime:number)=>{
    if(dt<=0)return;
    if(fadeIn)s.fadeIn=Math.min(FADE,s.fadeIn+Math.max(0,dt));
    if(s.rate!==0)s.angle=requireFinite(F(s.angle+F(s.rate*dt)),'角度');
    s.active=next(s,s.active);
    if(s.active<layers.length){
      s.fadeOut=0;
      const i=s.active;s.startSeconds[i]??=beforeTime;
      const value=advanceSpirographSourcePhase(layers[i],profiles[i],s.phases[i],s.elapsed[i],dt,settings.startEaseEnabled===true,settings.endEaseEnabled===true);
      s.phases[i]=requireFinite(value.phase,'轨迹相位');
      if(value.closed){s.closed[i]=true;s.endSeconds[i]=s.sceneTime;s.active=next(s,i+1);}
      else s.elapsed[i]=requireFinite(value.elapsed,'图层运动时间');
    }
    if(s.active===layers.length&&fadeOut)s.fadeOut=Math.min(FADE,s.fadeOut+Math.max(0,dt));
    syncCompletion(s);
  };
  const remainingDuration=(s:State)=>{
    // Keep the source left fold: a suffix sum would change float rounding.
    let total=s.current?Math.max(0,F(clips[s.queue].duration-s.runtime)):0;
    for(let i=s.queue+(s.current?1:0);i<clips.length;i++)total=F(total+Math.max(0,clips[i].duration));
    return requireFinite(total,'队列剩余时间');
  };
  const updateQueue=(s:State,dt:number,beforeTime:number)=>{
    const c=clips[s.queue];
    if(!s.current){s.current=true;s.runtime=0;s.startRate=s.rate;s.clips[s.queue]={...s.clips[s.queue],startFrame:s.absoluteFrame,startSeconds:beforeTime};}
    s.runtime=F(s.runtime+(c.kind==='finish-wait'?Math.max(0,dt):dt));
    let done:boolean;
    if(c.kind==='finish-wait')done=visual(s)||s.runtime>=c.duration;
    else{
      const progress=constrain(F(s.runtime/c.duration));
      if(c.kind==='rotate'){
        const eased=sourceEase(c.easing,progress);
        if(c.targetRate!==undefined)s.rate=requireFinite(F(s.startRate+F(F(c.targetRate-s.startRate)*eased)),`片段 ${c.id} 角速度（零时长可产生 0/0）`);
      }
      done=s.runtime>=c.duration;
    }
    s.clips[s.queue]={...s.clips[s.queue],runtime:s.runtime,...(done?{endFrame:s.absoluteFrame,endSeconds:s.sceneTime}:{})};
    if(done){s.queue++;s.current=false;s.runtime=0;if(s.queue===clips.length){s.queueCompleteFrame=s.absoluteFrame;s.queueCompleteSeconds=s.sceneTime;}}
  };
  const build=(seed:State,ownClock:ClockFacts,recording:boolean):PreparedSpirographReplay=>{
    let base:State|null=clone(seed),checkpoint:State|null=clone(seed),disposed=false,advancedFrames=0;
    const snapshots=new Map<number,State>();
    const update=(s:State)=>{
      advancedFrames++;
      s.frame++;s.absoluteFrame++;s.encodedFrameIndex=null;applyEvent(s);
      let dt:number;
      if(ownClock.kind==='offline-fixed'){s.paused=false;dt=F(1/F(ownClock.fps));}
      else{
        const flag=ownClock.flags[s.frame-1],now=F(F(ownClock.millis[s.frame-1])/1000);
        if(flag&2)s.lastTime=now;
        s.paused=(flag&1)!==0;
        if(s.paused){s.rawDt=0;s.activeDt=0;return;}
        dt=s.lastTime===0?0:F(now-s.lastTime);s.lastTime=now;
        if(dt<0)throw new Error('保留时钟倒退；不能推断原始计时历史');
      }
      s.rawDt=requireFinite(dt,'帧间隔');
      const finishedBefore=s.queue>=clips.length,beforeTime=s.sceneTime;
      if(!finishedBefore){const remain=remainingDuration(s);s.activeDt=remain>0?Math.min(dt,remain):0;s.sceneTime=requireFinite(F(s.sceneTime+s.activeDt),'场景时间');updateQueue(s,s.activeDt,beforeTime);advanceObject(s,s.activeDt,beforeTime);}
      else{s.activeDt=dt;s.sceneTime=requireFinite(F(s.sceneTime+dt),'场景时间');advanceObject(s,dt,beforeTime);}
      if(recording){if(s.warmup>0)s.warmup--;else{s.encodedFrameIndex=s.encoded;s.encoded++;}if(s.queue>=clips.length)s.recordingFinished=true;}
    };
    const stateAt=(requested:number,cancel?:()=>boolean,stopAtQueueCompletion=false):State=>{
      if(disposed||!base||!checkpoint)throw new Error('旋轮帧回放已释放');abort(cancel);
      let target=requested;
      if(!Number.isSafeInteger(target)||target<0||target>SPIROGRAPH_REPLAY_MAX_FRAMES)throw new Error('旋轮帧回放超过 24 小时 × 120 fps 帧容量');
      if(ownClock.kind==='retained-millis'&&target>ownClock.millis.length)throw new Error('保留时钟没有请求帧的 millis 证据');
      if(ownClock.kind==='offline-fixed'&&target>SPIROGRAPH_SOURCE_MAX_SECONDS*ownClock.fps)throw new Error('旋轮帧回放超过 86400 秒容量');
      if(stopAtQueueCompletion){
        if(recording&&checkpoint.recordingFinished)target=Math.min(target,checkpoint.frame);
        else if(!recording&&checkpoint.queueCompleteFrame!==null)target=Math.min(target,Math.max(0,checkpoint.queueCompleteFrame-base.absoluteFrame));
      }
      let selected=target>=checkpoint.frame?checkpoint:base;
      for(const saved of snapshots.values())if(saved.frame<=target&&saved.frame>selected.frame)selected=saved;
      const state=clone(selected);
      while(state.frame<target&&!state.recordingFinished&&(!stopAtQueueCompletion||recording||state.queue<clips.length)){if((state.frame&255)===0)abort(cancel);update(state);}
      // Commit only complete successful queries. Exceptions/cancellation leave the
      // owned high-water state intact, so a retry has the same cold semantics.
      if(state.frame>=checkpoint.frame)checkpoint=state;
      snapshots.delete(state.frame);snapshots.set(state.frame,clone(state));while(snapshots.size>4)snapshots.delete(snapshots.keys().next().value!);
      return state;
    };
    const present=(s:State):SpirographReplayFrame=>({frame:s.frame,absoluteFrame:s.absoluteFrame,sceneTime:s.sceneTime,rawDt:s.rawDt,activeDt:s.activeDt,rotationRate:s.rate,rotationRadians:s.angle,phases:[...s.phases],elapsedMotionSeconds:[...s.elapsed],closed:[...s.closed],clearedPhases:[...s.cleared],startSeconds:[...s.startSeconds],endSeconds:[...s.endSeconds],activeLayer:s.active,geometrySeconds:s.geometrySeconds,visualSeconds:s.visualSeconds,guideOpacity:F((fadeIn?sourceEase('sine-in-out',F(s.fadeIn/FADE)):1)*(fadeOut?F(1-sourceEase('sine-in-out',F(s.fadeOut/FADE))):1)),geometryFinished:geometry(s),visualFinished:visual(s),queueIndex:s.queue,queueFinished:s.queue>=clips.length,queueCompleteFrame:s.queueCompleteFrame,queueCompleteSeconds:s.queueCompleteSeconds,clipRuntime:s.runtime,clips:s.clips.map(c=>({...c})),paused:s.paused,encodedFrameIndex:s.encodedFrameIndex,encodedFrames:s.encoded,recordingFinished:s.recordingFinished});
    return{
      sample:(frame,cancel)=>present(stateAt(frame,cancel)),
      schedule:(frame,cancel)=>{const s=stateAt(frame,cancel,true);return{frame:s.frame,absoluteFrame:s.absoluteFrame,sceneTime:s.sceneTime,finished:s.queue>=clips.length,clips:s.clips.map(c=>({...c})),queueCompleteFrame:s.queueCompleteFrame,queueCompleteSeconds:s.queueCompleteSeconds,recordingFinished:s.recordingFinished,encodedFrames:s.encoded};},
      forkRecording:(frame,fps,cancel)=>{const rate=parseSpirographReplayFps(fps),s=clone(stateAt(frame,cancel));s.frame=0;s.rawDt=0;s.activeDt=0;s.lastTime=0;s.paused=false;s.warmup=1;s.encoded=0;s.encodedFrameIndex=null;s.recordingFinished=false;return build(s,{kind:'offline-fixed',fps:rate},true);},
      // Estimated numeric payload only, not JS object/process memory. Input facts
      // and child forks remain separately owned; disposal drops this plan's states.
      diagnostics:()=>({retainedCheckpoints:disposed?0:2+snapshots.size,estimatedRetainedBytes:disposed?0:(2+snapshots.size)*(256+layers.length*7*8+clips.length*7*8),advancedFrames,disposed}),
      dispose:()=>{disposed=true;snapshots.clear();base=null;checkpoint=null;},
    };
  };
  return build(initial,clock,input.recording===true);
}
