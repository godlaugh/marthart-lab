import type {SceneDocument} from '../types';
import {parseRootsMath,usesRootsNativeMath} from './rootsMathConfig';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {prepareRootsWorkerPartitions} from './rootsSourceRandom';
import {parseRootsPresentationConfiguration} from './rootsPresentationConfig';
import {parseRootsDensityColorVersion,parseRootsMetricKind,ROOTS_DENSITY_COLOR_VERSION} from './rootsDensityColor';
import {prepareRootsMathJob,type RootsMathJob} from './rootsMathJob';
import {RootsPendingStream,type RootsPendingStreamFacts} from './rootsPendingStream';
import {createRootsNativeProgress} from './rootsNativePointReader';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import {
 createRootsCameraClock,createRootsCameraWorkBudget,prepareRootsCameraTimeline,
 rootsCameraTargetFrame,usesRootsCameraTimeline,ROOTS_CAMERA_FRAME_LIMIT,
} from './rootsCameraTimeline';
import {RootsSceneClockError,type RootsSceneFrame} from './rootsSceneClock';
import {rootsSampleProgressAt,rootsSchedule} from '../scenes/rootsDensity';

export class RootsRecordingError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){
  super(message);this.name=code==='cancelled'?'AbortError':'RootsRecordingError';
 }
}
export interface RootsAutoRecordingInputs {
 readonly queueComplete:boolean;readonly hasAnimations:boolean;
 readonly mode:'density'|'point-cloud';
 readonly finishedWorkers:number;readonly workerCount:number;
 readonly queueSize:number;readonly pendingPoints:number;
}
/** Retained ComplexRootsScene.isAutoRecordingComplete (0–46) and
 * ComplexRootsMobject.isRecordingComplete (0–64). Queue and pending counts
 * use the source <=0 predicate. No gradient-running or root count condition.
 * The caller owns these observations; this function never infers live state. */
export function isRootsAutoRecordingComplete(facts:RootsAutoRecordingInputs):boolean {
 if(typeof facts.queueComplete!=='boolean'||typeof facts.hasAnimations!=='boolean')throw new RootsRecordingError('input','复根录制队列完成事实无效');
 if(!facts.queueComplete)return false;
 if(facts.hasAnimations)return true;
 if(facts.mode!=='density'&&facts.mode!=='point-cloud')throw new RootsRecordingError('input','复根录制显示模式无效');
 if(![facts.finishedWorkers,facts.workerCount,facts.queueSize].every(Number.isSafeInteger)||facts.mode==='density'&&!Number.isSafeInteger(facts.pendingPoints))throw new RootsRecordingError('input','复根录制工作线程或提交计数无效');
 return facts.finishedWorkers>=Math.max(1,facts.workerCount)&&facts.queueSize<=0&&(facts.mode==='point-cloud'||facts.pendingPoints<=0);
}
export interface RootsOrdinalCompletionFacts extends RootsAutoRecordingInputs {
 readonly policy:'local-synchronous-ordinal';readonly configuredWorkerCount:number;
 readonly sampleCount:number;readonly attemptedSamples:number;readonly complete:boolean;
}
export interface RootsPendingCompletionFacts extends RootsAutoRecordingInputs {
 readonly policy:'roots-pending-ordinal-v1';readonly configuredWorkerCount:number;
 readonly sampleCount:number;readonly attemptedSamples:number;readonly complete:boolean;
}
export type RootsRecordingCompletionFacts=RootsOrdinalCompletionFacts|RootsPendingCompletionFacts;
export function rootsPendingCompletion(pending:RootsPendingStreamFacts,input:{
 mode:RootsAutoRecordingInputs['mode'];queueComplete:boolean;hasAnimations:boolean;
 configuredWorkerCount:number;sampleCount:number;
}):RootsPendingCompletionFacts {
 if(pending.policy!=='roots-pending-ordinal-v1'||pending.failed||pending.disposed)
  throw new RootsRecordingError('input','复根录制需要有效且未释放的待绘制队列事实');
 if(!Number.isSafeInteger(input.configuredWorkerCount)||input.configuredWorkerCount<1||
  !Number.isSafeInteger(input.sampleCount)||input.sampleCount<1||
  !Number.isSafeInteger(pending.attemptedSamples)||pending.attemptedSamples<0||pending.attemptedSamples>input.sampleCount)
  throw new RootsRecordingError('input','复根录制采样与配置线程计数无效');
 // Select the predicate's facts explicitly. A caller may pass its previous
 // completion object; its extra diagnostics must not become another queue copy.
 const facts={mode:input.mode,queueComplete:input.queueComplete,hasAnimations:input.hasAnimations,
  configuredWorkerCount:input.configuredWorkerCount,sampleCount:input.sampleCount,
  policy:'roots-pending-ordinal-v1' as const,attemptedSamples:pending.attemptedSamples,
  workerCount:pending.workerCount,finishedWorkers:pending.finishedWorkers,queueSize:pending.queuedBatches,pendingPoints:pending.pendingPoints};
 return Object.freeze({...facts,complete:isRootsAutoRecordingComplete(facts)});
}
export interface RootsOrdinalCompletion {
 readonly sampleCount:number;readonly configuredWorkerCount:number;readonly workerCount:number;
 /** Call only after synchronous submission of every generated point succeeds.
  * queueSize/pendingPoints=0 are this local policy, not native worker telemetry. */
 at(attemptedSamples:number,mode:RootsAutoRecordingInputs['mode'],queueComplete:boolean,hasAnimations:boolean):RootsOrdinalCompletionFacts;
}
/** Shared native worker partition producer also clamps W to the sample count.
 * The ordinal replay exhausts one logical partition at a time; no worker array,
 * RNG, roots, or frame history is allocated by this completion observer. */
export function prepareRootsOrdinalCompletion(sampleCount:number,workerCount:number,seed:string):RootsOrdinalCompletion {
 if(typeof seed!=='string')throw new RootsRecordingError('input','复根录制种子必须保留整数文本');
 const parsed=parseRootsSignedLongText(seed);
 if(!parsed.ok)throw new RootsRecordingError(parsed.error.kind==='capacity'?'capacity':'input','复根录制种子必须是有符号 64 位整数');
 const prepared=prepareRootsWorkerPartitions(sampleCount,workerCount,parsed.value);
 if(!prepared.ok)throw new RootsRecordingError('input',prepared.error.reason);
 const partitions=prepared.value;
 return Object.freeze({sampleCount,configuredWorkerCount:workerCount,workerCount:partitions.workerCount,
  at(attemptedSamples:number,mode:RootsAutoRecordingInputs['mode'],queueComplete:boolean,hasAnimations:boolean):RootsOrdinalCompletionFacts {
   if(!Number.isSafeInteger(attemptedSamples)||attemptedSamples<0||attemptedSamples>sampleCount)throw new RootsRecordingError('input','复根录制已尝试样本数超出有序采样范围');
   if(mode!=='density'&&mode!=='point-cloud')throw new RootsRecordingError('input','复根录制显示模式无效');
   // A sample ordinal is the next unattempted sample. Its owning partition
   // gives the completed prefix without reproducing the partition formula.
   const finishedWorkers=attemptedSamples===sampleCount?partitions.workerCount:partitions.partitionForSample(attemptedSamples).index;
   const facts={policy:'local-synchronous-ordinal' as const,sampleCount,attemptedSamples,configuredWorkerCount:workerCount,workerCount:partitions.workerCount,finishedWorkers,mode,queueComplete,hasAnimations,queueSize:0,pendingPoints:0};
   return Object.freeze({...facts,complete:isRootsAutoRecordingComplete(facts)});
  },
 });
}
/** Explicit fresh replay document. This does not clone/fork the current render
 * instance. Its caller must use a fresh Generator/session. Only offline
 * simulation FPS changes; encoder FPS and authored camera/gradient stay separate. */
export function withRootsFreshRecording(scene:SceneDocument,simulationFps:number):SceneDocument {
 if(!usesRootsCameraTimeline(scene)||!usesRootsNativeMath(scene)||scene.settings.rootsMode!=='progressive'||parseRootsDensityColorVersion(scene.settings.rootDensityColorVersion)!==ROOTS_DENSITY_COLOR_VERSION)throw new RootsRecordingError('input','复根源录制需要显式源场景或相机队列、源数学与源配色');
 rootsCameraTargetFrame(0,simulationFps);
 return{...scene,timeline:{...scene.timeline,fps:simulationFps}};
}
export interface RootsFreshRecordingPlan {
 readonly policy:'fresh-local-ordinal-replay';readonly simulationFps:number;readonly encoderFps:number;
 readonly warmupUpdates:1;readonly updates:number;readonly encodedFrames:number;
 readonly firstEncodedUpdate:2|null;readonly lastDisplayFrame:number;
 readonly completionReason:'animation-queue'|'ordinal-samples'|'pending-drained';readonly finished:true;
 readonly logicalWorkerCount:number;readonly workUnits:number;
 readonly completion:RootsRecordingCompletionFacts;readonly finalFrame:RootsSceneFrame;
 /** Present only for the explicit pending policy. workUnits above remains the
  * shared clock budget; math work is separately charged during real solving. */
 readonly pendingPlanning?:{readonly storage:'count-only';readonly mathWorkUnits:number;readonly peakBytes:number;readonly finalQueue:RootsPendingStreamFacts};
 readonly warnings:readonly string[];
}
const cancel=(isCancelled?:()=>boolean)=>{if(isCancelled?.())throw new RootsRecordingError('cancelled','复根录制规划已取消');};
/** A bounded scalar plan, not a render or proof of GPU/solver completion. Actual
 * drawing uses the same ordinal completion observer after successful submission.
 * Native MathArt.draw renders first, discards one warmup or encodes, then checks
 * completion. Therefore a queue finishing in update 1 has zero encoded frames. */
export function planRootsFreshRecording(scene:SceneDocument,options:{simulationFps:number;encoderFps:number;isCancelled?:()=>boolean}):RootsFreshRecordingPlan {
 cancel(options.isCancelled);
 if(!Number.isSafeInteger(options.encoderFps)||options.encoderFps<1||options.encoderFps>120)throw new RootsRecordingError('input','复根视频编码帧率必须为 1–120 的整数');
 const fresh=withRootsFreshRecording(scene,options.simulationFps),timeline=prepareRootsCameraTimeline(fresh),clock=createRootsCameraClock(fresh,timeline);
 const math=parseRootsMath(fresh.rootsMath),schedule=rootsSchedule(fresh.settings,math),presentation=parseRootsPresentationConfiguration(fresh.rootsPresentation);
 if(presentation.pending)return planRootsPendingRecording(fresh,options,timeline,clock,schedule,presentation);
 const completion=prepareRootsOrdinalCompletion(math.sampling.sampleCount,math.sampling.workerCount,math.sampling.seed),budget=createRootsCameraWorkBudget(timeline),hasAnimations=timeline.clips.length>0;
 let frame=clock.snapshot();
 for(let update=1;update<=ROOTS_CAMERA_FRAME_LIMIT;update++){
  cancel(options.isCancelled);
  const displayFrame=update-1,time=displayFrame/timeline.fps;
  if(time>86400)throw new RootsRecordingError('capacity','复根录制规划超过本地 24 小时帧域');
  budget.reserveFrame(frame.queueIndex);
  frame=clock.step(timeline.dt,{isCancelled:options.isCancelled});
  const progress=rootsSampleProgressAt(schedule,time),facts=completion.at(progress.attemptedSamples,presentation.mode,frame.queueComplete,hasAnimations);
  cancel(options.isCancelled);
  if(facts.complete)return{
   policy:'fresh-local-ordinal-replay',simulationFps:timeline.fps,encoderFps:options.encoderFps,warmupUpdates:1,
   updates:update,encodedFrames:update-1,firstEncodedUpdate:update>1?2:null,lastDisplayFrame:displayFrame,
   completionReason:hasAnimations?'animation-queue':'ordinal-samples',finished:true,logicalWorkerCount:completion.workerCount,
   workUnits:budget.usedUnits,completion:facts,finalFrame:frame,
   warnings:[...timeline.warnings,'复根录制从新实例按本地确定性样本顺序重放；不复制当前实例或原版并发到达状态。','录制完成规划不执行求根或绘制；实际提交失败、取消与容量错误仍会中止导出。'],
  };
 }
 throw new RootsSceneClockError('capacity','复根录制规划超过本地帧预算');
}

/** Completed count-only planning is one synchronous task. Its real solver work
 * uses the existing export-request ceiling, cumulatively across all frames,
 * rather than resetting it per frame. Representation admission includes the
 * math workspace capacity and count-only queue's retained/transient charge;
 * borrowed document data, JS allocator/GC overhead and GPU memory are not a
 * measured RSS claim. The shared camera budget separately bounds frame/fold
 * work. This is a local resource policy, not a native format restriction. */
export const ROOTS_PENDING_RECORDING_LIMITS=Object.freeze({mathWork:300_000_000,bytes:768*1024*1024});
function planRootsPendingRecording(
 scene:SceneDocument,options:{encoderFps:number;isCancelled?:()=>boolean},
 timeline:ReturnType<typeof prepareRootsCameraTimeline>,clock:ReturnType<typeof createRootsCameraClock>,
 schedule:ReturnType<typeof rootsSchedule>,presentation:ReturnType<typeof parseRootsPresentationConfiguration>,
):RootsFreshRecordingPlan {
 const budget=createRootsCameraWorkBudget(timeline),hasAnimations=timeline.clips.length>0;
 const state=createRootsNativeProgress(schedule.total),metric=parseRootsMetricKind(scene.settings.rootColor);
 let math:RootsMathJob|undefined,stream:RootsPendingStream|undefined,mathWork=0,peakBytes=0;
 const cleanup=new GenerationCleanupState(),owner={reset(failures:readonly unknown[]=[]){cleanup.reset(()=>{
  stream?.dispose();stream=undefined;math?.dispose();math=undefined;
 },failures);}};
 const hooks={isCancelled:options.isCancelled,onWork:(n:number)=>{
  if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(mathWork+n))throw new RootsRecordingError('capacity','复根录制规划工作计数超出精确整数范围');
  mathWork+=n;
  if(mathWork>ROOTS_PENDING_RECORDING_LIMITS.mathWork)throw new RootsRecordingError('capacity','复根录制规划超过累计 3 亿求根工作预算；请减少样本或缩短录制队列');
 }};
 return withGenerationCleanup(()=>{
  // Preparation shares the same cancellation/work hook as sample evaluation.
  math=prepareRootsMathJob(scene,hooks);
  const workspace=math.workspaceCapacityBytes;
  const admit=(queueBytes:number)=>{
   const total=workspace+queueBytes;
   if(!Number.isSafeInteger(total)||total<0||total>ROOTS_PENDING_RECORDING_LIMITS.bytes)
    throw new RootsRecordingError('capacity','复根录制规划的数学与待绘制表示超过 768 MiB');
   peakBytes=Math.max(peakBytes,total);
  };
  admit(0);
  stream=new RootsPendingStream(math,state,schedule,presentation.pending!,{storage:'count-only',onBytes:admit});
  let frame=clock.snapshot();
  for(let update=1;update<=ROOTS_CAMERA_FRAME_LIMIT;update++){
   cancel(options.isCancelled);
   const displayFrame=update-1,time=displayFrame/timeline.fps;
   if(time>86400)throw new RootsRecordingError('capacity','复根录制规划超过本地 24 小时帧域');
   // Capture the pre-update fact. A clip completing in this step still has its
   // active Roots update, even for rawDt=0; camera-only clocks need no gradient.
   const managerFinishedAtStart=frame.queueComplete;
   budget.reserveFrame(frame.queueIndex);
   frame=clock.step(timeline.dt,{isCancelled:options.isCancelled});
   stream.pump(rootsSampleProgressAt(schedule,time).attemptedSamples,metric,hooks);
   if(!managerFinishedAtStart)stream.drain(presentation.mode,undefined,hooks);
   stream.drain(presentation.mode,undefined,hooks); // explicit raw update
   stream.drain(presentation.mode,undefined,hooks); // display
   if(presentation.mode==='density')stream.consumeDensity(undefined,hooks);
   const queue=stream.facts;
   const facts=rootsPendingCompletion(queue,{mode:presentation.mode,queueComplete:frame.queueComplete,hasAnimations,
    configuredWorkerCount:math.ensemble!.configuredWorkers,sampleCount:math.ensemble!.sampleCount});
   cancel(options.isCancelled);
   // MathArt checks completion after the render and warmup/encode decision.
   if(facts.complete)return{
    policy:'fresh-local-ordinal-replay',simulationFps:timeline.fps,encoderFps:options.encoderFps,warmupUpdates:1,
    updates:update,encodedFrames:update-1,firstEncodedUpdate:update>1?2:null,lastDisplayFrame:displayFrame,
    completionReason:hasAnimations?'animation-queue':'pending-drained',finished:true,logicalWorkerCount:facts.workerCount,
    workUnits:budget.usedUnits,completion:facts,finalFrame:frame,
    pendingPlanning:{storage:'count-only',mathWorkUnits:mathWork,peakBytes,finalQueue:Object.freeze(queue)},
    warnings:[...timeline.warnings,
     '复根录制从新实例按本地确定性样本顺序重放；不复制当前实例或原版并发到达状态。',
     '待绘制录制规划执行真实求根与同一批次队列，只省略点存储和 GPU 绘制；每帧仅在排空前按样本序号生产一次。',
     '规划受整项累计求根、队列内存与逐帧工作预算约束；实际绘制仍可能因设备、容量或取消失败。'],
   };
  }
  throw new RootsSceneClockError('capacity','复根录制规划超过本地帧预算');
 },owner);
}
