import type {SourceBouncingError,SourceBouncingResult} from './sourceBouncingConfig';

const F=Math.fround;
const MODEL='source-bouncing-clock-1.7.8' as const;
declare const checkpointBrand:unique symbol;
/** Transportable clock facts, never GPU state. A display consumes this absolute
 * update count; sceneTime must not be converted back into a physical step count. */
export interface SourceBouncingCheckpoint {
 readonly model:typeof MODEL;
 readonly simulationUpdates:number;
 readonly sceneTime:number;
 readonly [checkpointBrand]:true;
}
export interface SourceBouncingReplayOptions {readonly isCancelled?:()=>boolean;}
/** Local replay capacity, not a native simulation or duration limit. */
export const SOURCE_BOUNCING_REPLAY_LIMITS=Object.freeze({maxUpdates:10_000});
export interface SourceBouncingFixedReplayPlan {
 readonly checkpoint:SourceBouncingCheckpoint;
 readonly step:number;
 readonly advancedUpdates:number;
}
export interface SourceBouncingRecordingPlan {
 readonly start:SourceBouncingCheckpoint;
 readonly warmup:SourceBouncingCheckpoint;
 readonly frames:readonly SourceBouncingCheckpoint[];
 readonly end:SourceBouncingCheckpoint;
 readonly step:number;
}
class ClockFailure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(kind:SourceBouncingError['kind'],path:readonly string[],reason:string):never {throw new ClockFailure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceBouncingResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof ClockFailure)return{ok:false,error:error.detail};throw error;}}
function cancelled(options:SourceBouncingReplayOptions):void {if(options.isCancelled?.())fail('cancelled',[],'源弹跳帧计划已取消');}
function updates(value:unknown,path:readonly string[]):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('input',path,'物理更新次数必须为非负整数');
 if(value>SOURCE_BOUNCING_REPLAY_LIMITS.maxUpdates)fail('capacity',path,'源弹跳回放超过 10000 次更新容量；不减少更新次数');
 return value;
}
function checkpoint(simulationUpdates:number,sceneTime:number):SourceBouncingCheckpoint {
 return Object.freeze({model:MODEL,simulationUpdates,sceneTime}) as SourceBouncingCheckpoint;
}
function readCheckpoint(raw:unknown):SourceBouncingCheckpoint {
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))fail('input',[],'源弹跳检查点必须为对象');
 const value=raw as Record<string,unknown>,keys=Object.keys(value);
 if(keys.length!==3||keys.some(key=>!['model','simulationUpdates','sceneTime'].includes(key))||value.model!==MODEL)fail('input',[],'源弹跳检查点字段或模型无效');
 const count=updates(value.simulationUpdates,['simulationUpdates']),time=value.sceneTime;
 if(typeof time!=='number'||!Number.isFinite(time))fail('nonfinite',['sceneTime'],'源弹跳场景时间必须有限');
 if(time<0||!Object.is(F(time),time))fail('input',['sceneTime'],'源弹跳场景时间必须为非负 Float32 事实');
 // A seed cannot have elapsed time: every unpaused source frame advances once.
 if(count===0&&time!==0)fail('input',['sceneTime'],'初始种子检查点的场景时间必须为零');
 return checkpoint(count,time);
}
/** Revalidate serialized worker/document-boundary facts. This checks shape and
 * capacity; callers remain responsible for binding facts to their scene identity. */
export function parseSourceBouncingCheckpoint(raw:unknown):SourceBouncingResult<SourceBouncingCheckpoint>{return attempt(()=>readCheckpoint(raw));}
export function sourceBouncingSeedCheckpoint():SourceBouncingCheckpoint {return checkpoint(0,0);}
function advance(current:SourceBouncingCheckpoint,delta:number,options:SourceBouncingReplayOptions):SourceBouncingCheckpoint {
 cancelled(options);
 const count=updates(current.simulationUpdates+1,['simulationUpdates']),time=F(current.sceneTime+delta);
 if(!Number.isFinite(time))fail('nonfinite',['sceneTime'],'源弹跳 Float32 场景时间溢出');
 return checkpoint(count,time);
}
function renderStep(value:number):number {
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)fail('input',['fps'],'固定帧率必须是有限正数');
 const fps=F(value),step=F(1/fps);
 if(!Number.isFinite(fps)||fps<=0||!Number.isFinite(step)||step<=0)fail('nonfinite',['fps'],'固定帧率不能形成有限正 Float32 帧间隔');
 return step;
}
/** Scene.update paused branch does not compute a delta. The caller supplies
 * rawDt=0 for the first realtime frame; that frame still advances particles.
 * Bouncing's empty/finished queue never freezes this clock. */
export function stepSourceBouncingRealtime(current:SourceBouncingCheckpoint,request:{readonly deltaTime:number;readonly paused:boolean},options:SourceBouncingReplayOptions={}):SourceBouncingResult<SourceBouncingCheckpoint>{return attempt(()=>{
 cancelled(options);const state=readCheckpoint(current);
 if(typeof request?.paused!=='boolean')fail('input',['paused'],'暂停状态必须为布尔值');
 if(request.paused)return state;
 const delta=request.deltaTime;
 if(typeof delta!=='number'||!Number.isFinite(delta)||delta<0)fail('input',['deltaTime'],'实时帧间隔必须是有限非负数');
 if(!Number.isFinite(F(delta)))fail('nonfinite',['deltaTime'],'实时帧间隔超出 Float32 范围');
 return advance(state,F(delta),options);
});}
/** Bouncing.setRenderMode resets scene.time only. It preserves particle state
 * even when recording starts from an already advanced displayed checkpoint. */
export function resetSourceBouncingRenderClock(current:SourceBouncingCheckpoint,options:SourceBouncingReplayOptions={}):SourceBouncingResult<SourceBouncingCheckpoint>{return attempt(()=>{
 cancelled(options);const state=readCheckpoint(current);return checkpoint(state.simulationUpdates,0);
});}
/** Explicit local fixed-frame replay. updates is an absolute target index, not
 * seconds or a frame count relative to from. Reverse seeking starts from seed. */
export function planSourceBouncingFixedReplay(request:{readonly from?:SourceBouncingCheckpoint;readonly updates:number;readonly fps:number},options:SourceBouncingReplayOptions={}):SourceBouncingResult<SourceBouncingFixedReplayPlan>{return attempt(()=>{
 cancelled(options);const from=request.from===undefined?sourceBouncingSeedCheckpoint():readCheckpoint(request.from),target=updates(request.updates,['updates']),step=renderStep(request.fps);
 if(target<from.simulationUpdates)fail('input',['updates'],'反向回放必须从种子或更早的检查点开始');
 let state=from;while(state.simulationUpdates<target)state=advance(state,step,options);
 return Object.freeze({checkpoint:state,step,advancedUpdates:target-from.simulationUpdates});
});}
/** Native offline ordering: reset only time, render one unencoded warmup,
 * then advance/render/encode and only afterwards test duration. At least one
 * frame is encoded even when warmup already crossed the duration threshold.
 * Completion does not freeze subsequent realtime simulation. */
export function planSourceBouncingRecording(request:{readonly from:SourceBouncingCheckpoint;readonly fps:number;readonly recordDuration:number},options:SourceBouncingReplayOptions={}):SourceBouncingResult<SourceBouncingRecordingPlan>{return attempt(()=>{
 cancelled(options);const from=readCheckpoint(request.from),step=renderStep(request.fps),duration=request.recordDuration;
 if(typeof duration!=='number'||!Number.isFinite(duration)||!Number.isFinite(F(duration)))fail('nonfinite',['recordDuration'],'录像时长必须为有限 Float32 数值');
 // Canonical owner applies the native max(.1f, value); do not apply a second clamp.
 if(!Object.is(F(duration),duration)||duration<F(.1))fail('input',['recordDuration'],'录像时长必须为已规范化且至少 0.1 秒的 Float32 值');
 const start=checkpoint(from.simulationUpdates,0),warmup=advance(start,step,options),frames:SourceBouncingCheckpoint[]=[];
 let state=warmup;
 do{state=advance(state,step,options);frames.push(state);}while(state.sceneTime<duration);
 return Object.freeze({start,warmup,frames:Object.freeze(frames),end:state,step});
});}
