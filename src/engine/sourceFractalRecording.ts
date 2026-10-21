import type {SceneDocument,SceneOutput} from '../types';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {FRACTAL_SCENE_SEQUENCE,usesSourceFractal} from './sourceFractalDocument';
import {prepareSourceFractalScene,type SourceFractalEvaluation} from './sourceFractalTimeline';
import {SourceFractalSceneRuntime} from './sourceFractalSceneRuntime';
import {SourceFractalPlaybackSession} from './sourceFractalPlayback';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from './fractalSourcePrecision';

export class SourceFractalRecordingError extends Error {
 constructor(readonly code:'input'|'cancelled'|'state'|'capacity',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceFractalRecordingError';}
}
export interface SourceFractalRecordingFrameInput {readonly displayFrame:number;readonly simulationFps:number;}
/** Facts from the exact evaluated state paired with a successfully rendered
 * raster. A completion plan cannot manufacture these observations. */
export interface SourceFractalRecordingFrame extends SourceFractalRecordingFrameInput {
 readonly warmup:boolean;readonly complete:boolean;readonly queueIndex:number;readonly sceneTime:number;
}
export interface FractalFreshRecordingPlan extends SourceQueueRecordingClock {
 readonly policy:'fresh-local-source-queue-replay';readonly encoderFps:number;readonly workUnits:number;
}
const WORK_LIMIT=2_000_000;
const cancel=(isCancelled?:()=>boolean)=>{if(isCancelled?.())throw new SourceFractalRecordingError('cancelled','分形录制规划已取消');};
function fps(value:unknown,encoder=false):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>120)throw new SourceFractalRecordingError('input',`分形录制${encoder?'编码':'模拟'}帧率必须为 1–120 的整数`);
 return value;
}
function ordinal(displayFrame:unknown,simulationFps:number):number {
 if(typeof displayFrame!=='number'||!Number.isSafeInteger(displayFrame)||displayFrame<0||displayFrame/simulationFps>86400)throw new SourceFractalRecordingError('input','分形录制显示帧必须是 24 小时范围内的非负整数');
 return displayFrame;
}
/** Admit a transport/request value before scene replay or GPU work. Equality
 * with a document rate does not establish that either rate is valid. */
export function validateFractalRecordingFrameInput(input:unknown):SourceFractalRecordingFrameInput {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new SourceFractalRecordingError('input','分形录制帧请求需要对象');
 const raw=input as Record<string,unknown>,simulationFps=fps(raw.simulationFps);
 return{displayFrame:ordinal(raw.displayFrame,simulationFps),simulationFps};
}
function prepareFresh(scene:SceneDocument,simulationFps:number){
 fps(simulationFps);
 if(!usesSourceFractal(scene)||scene.timeline.schedule!==FRACTAL_SCENE_SEQUENCE)throw new SourceFractalRecordingError('input','分形源录制需要完整配置和原版逐帧队列');
 const fresh={...scene,timeline:{...scene.timeline,fps:simulationFps}};
 delete fresh.evaluatedFractalScene;delete fresh.evaluatedFractalGradient;
 return{scene:fresh,configuration:prepareSourceFractalScene(fresh)};
}
/** Applies the authored document to a fresh local replay. It neither forks the
 * preview instance nor reproduces MathArt's last-applied snapshot/GL target. */
export function withFractalFreshRecording(scene:SceneDocument,simulationFps:number):SceneDocument {
 return prepareFresh(scene,simulationFps).scene;
}
function plan(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean){
 cancel(isCancelled);const {configuration}=prepareFresh(scene,simulationFps);cancel(isCancelled);
 let workUnits=0;
 const reserve=(units:number)=>{
  cancel(isCancelled);
  if(!Number.isSafeInteger(units)||units<0||!Number.isSafeInteger(workUnits+units)||workUnits+units>WORK_LIMIT)throw new SourceFractalRecordingError('capacity','分形录制队列与参数循环超过共享 200 万工作预算');
  workUnits+=units;
 };
 const playback=new SourceFractalPlaybackSession({fps:simulationFps,isCancelled,reserve,
  createScene:()=>new SourceFractalSceneRuntime(configuration,{reserve}).clock,
 });
 // The same budget/cancellation scope covers queue advancement, parameter
 // phase loops and the real gradient callbacks, including terminal raw update.
 const clock=playback.planRecording();cancel(isCancelled);return{clock,workUnits};
}
export function planFractalRecordingClock(scene:SceneDocument,simulationFps:number,isCancelled?:()=>boolean):SourceQueueRecordingClock {
 return plan(scene,simulationFps,isCancelled).clock;
}
/** Updates before display, discards exactly one warmup, and stops after the
 * queue-completing display. Continuing parameter/gradient animators add no hold.
 * Planning executes the full numerical scene, but does not render or encode. */
export function planFractalFreshRecording(scene:SceneDocument,options:{simulationFps:number;encoderFps:number;isCancelled?:()=>boolean}):FractalFreshRecordingPlan {
 cancel(options.isCancelled);fps(options.encoderFps,true);
 const {clock,workUnits}=plan(scene,options.simulationFps,options.isCancelled);
 return{...clock,policy:'fresh-local-source-queue-replay',encoderFps:options.encoderFps,workUnits};
}
/** Build an explicit render request, including update 1's discarded display. */
export function fractalRecordingFrameInput(clock:SourceQueueRecordingClock,displayFrame:number):SourceFractalRecordingFrameInput {
 const input=validateFractalRecordingFrameInput({displayFrame,simulationFps:clock.simulationFps});
 if(!Number.isSafeInteger(clock.lastDisplayFrame)||clock.lastDisplayFrame<0||clock.updates!==clock.lastDisplayFrame+1||clock.encodedFrames!==clock.lastDisplayFrame||clock.warmupUpdates!==1||clock.firstEncodedUpdate!==(clock.encodedFrames?2:null)||clock.completionReason!=='animation-queue'||displayFrame>clock.lastDisplayFrame)
  throw new SourceFractalRecordingError('state','分形录制显示帧超出完成规划');
 return input;
}
export function fractalRecordingFrameFacts(frame:SourceFractalEvaluation,input:SourceFractalRecordingFrameInput):SourceFractalRecordingFrame {
 const request=validateFractalRecordingFrameInput(input);
 if(!frame||frame.displayFrame!==request.displayFrame||frame.simulationFps!==request.simulationFps||!frame.scene||typeof frame.scene.queueComplete!=='boolean'||!Number.isSafeInteger(frame.scene.queueIndex)||frame.scene.queueIndex<0||!Number.isFinite(frame.scene.sceneTime))
  throw new SourceFractalRecordingError('state','分形录制请求与实际求值帧不一致');
 return{displayFrame:frame.displayFrame,simulationFps:frame.simulationFps,warmup:frame.displayFrame===0,complete:frame.scene.queueComplete,queueIndex:frame.scene.queueIndex,sceneTime:frame.scene.sceneTime};
}
/** Called for every delivered render, including warmup. Never accept an early
 * completion, a hold after completion, or a plan standing in for real pixels. */
export function assertFractalRecordingFrame(output:SceneOutput,clock:SourceQueueRecordingClock,displayFrame:number):void {
 const input=fractalRecordingFrameInput(clock,displayFrame);
 if(output.type!=='raster')throw new SourceFractalRecordingError('state','分形录制需要实际栅格帧');
 const facts=output.fractalRecording,render=output.fractalRender;
 if(!facts||!render||render.profile!==FRACTAL_SOURCE_NUMERIC_PROFILE||render.execution.backend!=='webgl2'||render.rasterSize[0]!==output.width||render.rasterSize[1]!==output.height||
  facts.displayFrame!==input.displayFrame||facts.simulationFps!==input.simulationFps||facts.warmup!==(displayFrame===0)||facts.complete!==(displayFrame===clock.lastDisplayFrame)||
  !Number.isSafeInteger(facts.queueIndex)||facts.queueIndex<0||!Number.isFinite(facts.sceneTime))
  throw new SourceFractalRecordingError('state','分形录制帧与实际队列完成状态或渲染事实不一致');
}
