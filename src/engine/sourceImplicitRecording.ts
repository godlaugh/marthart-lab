import type {GenerateContext,GenerationInput,SceneOutput,SceneDocument} from '../types';
import type {SourceRecordingOptions} from './generationProtocol';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,ordinarySourceViewport} from './ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {sourceRecordingSize} from './sourceRecordingSize';
import {snapshotGenerationInput} from './generationInput';
import {resolveFormulaContent,presentFormulas} from './formulas';
import {validateFrameFormulas} from './formulaConfig';
import {generateImplicit} from '../scenes/geometry';

export interface SourceImplicitRecordingFrame {
 readonly displayFrame:number;readonly simulationFps:number;readonly actualFrameRate:number;
 readonly warmup:boolean;readonly complete:boolean;
}
type GeometryOutput=Extract<SceneOutput,{type:'geometry'}>;
type Primary={scene:SceneDocument;context:GenerationInput;anchor:SceneDocument;input:GenerationInput};
type Recording={handle:object;author:SceneDocument;primary:GenerationInput;target:GenerationInput;clock:SourceQueueRecordingClock;queue:OrdinarySourceCameraTimelineSession;formulas:ReturnType<typeof resolveFormulaContent>;frame:OrdinarySourceCameraFrame;next:number;actualFrameRate:number;pending?:{frame:OrdinarySourceCameraFrame;actualFrameRate:number};finished?:{context:GenerationInput;frame:OrdinarySourceCameraFrame};cancel?:()=>boolean};
const rate=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(Math.fround(value)))throw Error('隐式录制需要独立观察的有限实际帧率');return Math.fround(value);};
const check=(cancel?:()=>boolean)=>{if(cancel?.())throw new DOMException('隐式录制已取消','AbortError');};

/** Owns only the numerical recording lifecycle. The Worker admits the exact
 * completed primary request; no renderer or client can synthesize this lease.
 * Native drawing and encoded video delivery remain separate consumers. */
export class SourceImplicitRecordingSession {
 private primary?:Primary;private recording?:Recording;private handoff?:Recording;private busy=false;
 admitPrimary(scene:SceneDocument,context:GenerationInput,output:GeometryOutput):void {
  if(this.recording||this.busy)throw Error('隐式录制期间不能替换主预览');
  if(!usesSourceImplicitCpuMesh(scene)||!output.sourceImplicitPresentation||!output.sourceCameraFrame||context.sourceViewport?.target!=='primary'||output.sourceCameraFrame.viewport.target!=='primary')throw Error('隐式录制需要已完成的 CPU 网格主预览');
  validateFrameFormulas(output.formulaPresentation,context.sourceViewport);
  this.handoff?.queue.reset();this.handoff=undefined;
  this.primary={scene,context,anchor:structuredClone(scene),input:snapshotGenerationInput(context)};
 }
 // These are Worker-owned object identities, not caller-provided IDs or JSON
 // equality; the anchor is copied before later requests can mutate its state.
 matchesCompletedPrimary(scene:SceneDocument,context:GenerationInput):boolean{return !this.recording&&this.primary?.scene===scene&&this.primary.context===context;}
 ownsRecording(handle:object):boolean{return this.recording?.handle===handle;}
 reset():void {this.recording?.queue.reset();this.handoff?.queue.reset();this.recording=undefined;this.handoff=undefined;this.primary=undefined;}
 private display(record:Recording,frame:OrdinarySourceCameraFrame,context:GenerationInput,recording:boolean,actualFrameRate:number,cancel?:()=>boolean):GeometryOutput {
  check(cancel);const scene={...record.author,evaluatedSourceCamera:frame};
  const output=generateImplicit(scene,{...context,time:frame.sceneTime,isCancelled:cancel});check(cancel);
  if(output.type!=='geometry'||!output.sourceImplicitPresentation)throw Error('隐式录制未生成源 CPU 网格');
  output.sourceCameraFrame=ordinarySourceCameraFrame(scene,context);
  output.formulaPresentation=presentFormulas(record.formulas,context.sourceViewport);
  if(recording){
   if(frame.frameIndex<0||frame.frameIndex>record.clock.lastDisplayFrame||frame.queueComplete!==(frame.frameIndex===record.clock.lastDisplayFrame)||frame.rawDt!==Math.fround(1/Math.fround(record.clock.simulationFps)))throw Error('隐式录制实际帧与队列完成规划不一致');
   output.implicitRecording={displayFrame:frame.frameIndex,simulationFps:record.clock.simulationFps,actualFrameRate,warmup:frame.frameIndex===0,complete:frame.queueComplete};
  }
  return output;
 }
 beginRecording(scene:SceneDocument,context:GenerateContext,options:SourceRecordingOptions){
  if(this.busy||!this.matchesCompletedPrimary(scene,context))throw Error('隐式录制需要匹配的已完成主预览');
  check(context.isCancelled);const observed=rate(options.actualFrameRate),fps=options.simulationFps;
  if(!Number.isSafeInteger(fps)||fps<1||fps>120)throw Error('隐式录制帧率必须为 1–120 的整数');
  const author=structuredClone(this.primary!.anchor),camera=ordinarySourceCameraInitial(author);
  if(!camera||author.timeline.schedule!=='ordinary-camera-sequence-v1')throw Error('隐式录制缺少源相机与顺序队列');
  const layout=resolveOrdinarySourceCameraTimeline(camera,author.timeline.tracks,fps,{isCancelled:context.isCancelled});
  if(layout.diagnostics.some(d=>d.code==='noncamera-clock'||d.code==='tracking-target-ignored'))throw Error('隐式录制尚未实现此非相机动作，不能忽略后继续录制');
  const updates=Math.max(1,layout.updates);
  if((updates-1)/fps>86400)throw Error('隐式录制超过本地 24 小时帧域');
  const clock:SourceQueueRecordingClock={simulationFps:fps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
  const primary=snapshotGenerationInput(this.primary!.input),density=primary.sourcePointPixelDensity;
  if(density===undefined||!Number.isFinite(density)||density<=0)throw Error('隐式录制缺少主预览像素密度');
  const size=sourceRecordingSize(options,density);
  // Implicit retained line width already incorporates the reference density.
  // Its offscreen camera/renderer contract uses physical pixels exactly once.
  const target:GenerationInput={...primary,time:0,quality:'export',width:size.width,height:size.height,sourceViewport:ordinarySourceViewport(author,size.width,size.height,'offscreen',primary.sourceViewport!.logicalHeight)};
  const queue=new OrdinarySourceCameraTimelineSession(camera,author.timeline.tracks,fps,{isCancelled:context.isCancelled});this.busy=true;
  try{
   const frame=queue.step(Math.fround(1/Math.fround(fps)),{actualFrameRate:observed});
   const record:Recording={handle:Object.freeze({}),author,primary,target,clock,queue,formulas:resolveFormulaContent(author),frame,next:1,actualFrameRate:observed,cancel:context.isCancelled};
   const warmup=this.display(record,frame,target,true,observed,context.isCancelled);check(context.isCancelled);
   this.handoff?.queue.reset();this.handoff=undefined;this.primary=undefined;this.recording=record;
   return{handle:record.handle,scene:structuredClone(author),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
  }catch(error){queue.reset();throw error;}finally{this.busy=false;}
 }
 nextRecordingFrame(handle:object,index:number,actualFrameRate?:number){
  const record=this.recording;
  if(this.busy||!record||record.handle!==handle||record.finished||index!==record.next||index>record.clock.lastDisplayFrame)throw Error('隐式录制身份或连续帧序号无效');
  const observed=rate(actualFrameRate);
  if(record.pending&&!Object.is(record.pending.actualFrameRate,observed))throw Error('隐式录制重试不能改变已消费的实际帧率');
  this.busy=true;
  try{
   check(record.cancel);
   if(!record.pending){
    try{record.pending={frame:record.queue.step(Math.fround(1/Math.fround(record.clock.simulationFps)),{actualFrameRate:observed}),actualFrameRate:observed};}
    catch(error){this.reset();throw error;}
   }
   const output=this.display(record,record.pending.frame,record.target,true,observed,record.cancel);check(record.cancel);
   record.frame=record.pending.frame;record.actualFrameRate=observed;record.next++;record.pending=undefined;return output;
  }finally{this.busy=false;}
 }
 finishRecording(handle:object){
  const record=this.recording??this.handoff;
  if(this.busy||!record||record.handle!==handle)throw Error('隐式录制结束身份无效');
  this.busy=true;
  try{
   // Stop does not update or inherit cancellation. A failed/detached
   // publication re-materializes the same numerical frame and fresh buffers.
   record.finished??={frame:record.pending?.frame??record.frame,context:{...snapshotGenerationInput(record.primary),time:(record.pending?.frame??record.frame).sceneTime}};
   const {frame,context}=record.finished,preview=this.display(record,frame,context,false,record.pending?.actualFrameRate??record.actualFrameRate);
   this.primary={scene:record.author,context,anchor:structuredClone(record.author),input:snapshotGenerationInput(context)};this.recording=undefined;this.handoff=record;
   return{scene:record.author,context,preview};
  }finally{this.busy=false;}
 }
}
