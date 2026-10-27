import {createSourceImplicitTimeline} from './sourceImplicitTimeline';
import {sourcePaletteRuntimeScene} from './sourcePaletteRuntimeScene';
import {sourceGeometryCapturePlan,type SourceGeometryCapturePreparation} from './sourceGeometryCapture';
import {SourceSceneHostClock} from './sourceSceneHostClock';
import {sameSourceRecordingValue} from './sourceRecordingValue';
import {validateSourceImplicitLiveContext,implicitObservedFrameRate} from './sourceImplicitLive';
import type {GenerateContext,GenerationInput,SceneOutput,SceneDocument} from '../types';
import type {SourceRecordingOptions} from './generationProtocol';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {usesSourceImplicitMesh} from './sourceImplicitIdentity';
import {prepareSourceImplicitOffscreenTarget} from './sourceImplicitViewport';
import type {SourceImplicitPresentation} from './sourceImplicitPresentation';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,ordinarySourceViewport} from './ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {sourceRecordingSize} from './sourceRecordingSize';
import {snapshotGenerationInput} from './generationInput';
import {resolveFormulaContent,presentFormulas} from './formulas';
import {validateFrameFormulas} from './formulaConfig';
import {generateImplicit} from '../scenes/geometry';
import {ImplicitPaletteControlOwner,type ImplicitPaletteFacts,type PreparedImplicitPaletteControls} from './implicitPaletteControl';

export interface SourceImplicitRecordingFrame {
 readonly displayFrame:number;readonly simulationFps:number;readonly actualFrameRate:number;
 readonly warmup:boolean;readonly complete:boolean;
}
type GeometryOutput=Extract<SceneOutput,{type:'geometry'}>;
type Primary={presentationModel:SourceImplicitPresentation['model'];scene:SceneDocument;context:GenerationInput;anchor:SceneDocument;input:GenerationInput};
type Recording={presentationModel:SourceImplicitPresentation['model'];handle:object;author:SceneDocument;callerAuthor:SceneDocument;control?:ImplicitPaletteControlOwner;primary:GenerationInput;target:GenerationInput;clock:SourceQueueRecordingClock;numerical:ReturnType<typeof createSourceImplicitTimeline>;queue:OrdinarySourceCameraTimelineSession;formulas:ReturnType<typeof resolveFormulaContent>;frame:OrdinarySourceCameraFrame;next:number;actualFrameRate:number;pending?:{frame:OrdinarySourceCameraFrame;actualFrameRate:number};finished?:{context:GenerationInput;frame:OrdinarySourceCameraFrame};cancel?:()=>boolean;liveClock?:SourceSceneHostClock;liveFailed?:boolean};
const rate=implicitObservedFrameRate;
const check=(cancel?:()=>boolean)=>{if(cancel?.())throw new DOMException('隐式录制已取消','AbortError');};

/** Owns the numerical recording and its subsequent live continuation.
 * The Worker admits the exact
 * completed primary request; no renderer or client can synthesize this lease.
 * Native drawing and encoded video delivery remain separate consumers. */
export class SourceImplicitRecordingSession {
 private primary?:Primary;private recording?:Recording;private handoff?:Recording;private continuation?:Recording;private busy=false;private cancel?:()=>boolean;
 private control?:ImplicitPaletteControlOwner;
 private validatePrimary(scene:SceneDocument,context:GenerationInput,output:GeometryOutput):void {
  if(!usesSourceImplicitMesh(scene)||!output.sourceImplicitPresentation||!output.sourceCameraFrame||context.sourceViewport?.target!=='primary'||output.sourceCameraFrame.viewport.target!=='primary')throw Error('隐式录制需要已完成的源网格主预览');
  validateFrameFormulas(output.formulaPresentation,context.sourceViewport);
 }
 private clearContinuation():void {
  this.handoff?.queue.reset();this.continuation?.queue.reset();this.handoff=undefined;this.continuation=undefined;
 }
 admitPrimary(scene:SceneDocument,context:GenerationInput,output:GeometryOutput):void {
  if(this.recording||this.busy)throw Error('隐式录制期间不能替换主预览');
  this.validatePrimary(scene,context,output);
  if(context.implicitControls){if(this.control?.sessionId!==context.implicitControls.sessionId||output.implicitControls?.sessionId!==this.control.sessionId)throw Error('隐式色板主预览缺少已提交的控制状态');}
  else this.control=undefined;
  this.clearContinuation();
  this.primary={presentationModel:output.sourceImplicitPresentation!.model,scene,context,anchor:structuredClone(this.control?.coldScene??sourcePaletteRuntimeScene(scene)),input:snapshotGenerationInput(context)};
 }
 /** Control preparation is transactional. Neither staged author fields nor
  * failed rendering may replace the effective scene or the cold reset anchor. */
 generateControlled(scene:SceneDocument,context:GenerateContext,render:(effectiveScene:SceneDocument,palette:ImplicitPaletteFacts)=>GeometryOutput):GeometryOutput {
  if(this.busy||this.recording)throw Error('隐式录制期间不能提交色板控制');
  const request=context.implicitControls;if(!request)throw Error('隐式色板控制上下文缺失');
  const control=this.control?.sessionId===request.sessionId?this.control:new ImplicitPaletteControlOwner(request.sessionId);
  const prepared=control.prepare({acknowledgedRevision:request.acknowledgedRevision,commands:request.commands},context.isCancelled);
  const resets=prepared.steps.some(step=>step.reset),same=control===this.control;
  if(resets&&context.time!==0)throw Error('隐式 Apply 或 restart 的主预览时间必须为 0');
  if(context.implicitLive){
   if(!same||resets)throw Error('隐式 Apply 或 restart 需要新的主预览上下文');
   return this.continueFrame(scene,context,prepared,()=>control.commit(prepared));
  }
  if(same&&this.continuation&&!resets)throw Error('隐式持有的继续播放需要 implicitLive；重新生成必须显式 Apply 或 restart');
  this.busy=true;
  try{
   let output:GeometryOutput|undefined;
   // Every explicit Apply must pass the real producer, even if a later Apply
   // supersedes it. A batch cannot conceal invalid equations or geometry.
   for(const step of prepared.steps)if(step.kind==='apply'){
    check(context.isCancelled);const candidate=render(step.scene,step.palette);check(context.isCancelled);this.validatePrimary(step.scene,context,candidate);
    if(step.scene===prepared.current&&step.palette===prepared.palette)output=candidate;
   }
   if(!output){check(context.isCancelled);output=render(prepared.current,prepared.palette);check(context.isCancelled);}
   this.validatePrimary(scene,context,output);
   const anchor=structuredClone(prepared.cold),input=snapshotGenerationInput(context);
   control.commit(prepared);this.control=control;
   if(!same||resets)this.clearContinuation();
   output.implicitControls={sessionId:control.sessionId,...prepared.receipt};
   this.primary={presentationModel:output.sourceImplicitPresentation!.model,scene,context,anchor,input};return output;
  }finally{this.busy=false;}
 }
 // These are Worker-owned object identities, not caller-provided IDs or JSON
 // equality; the anchor is copied before later requests can mutate its state.
 matchesCompletedPrimary(scene:SceneDocument,context:GenerationInput):boolean{return !this.recording&&this.primary?.scene===scene&&this.primary.context===context;}
 ownsRecording(handle:object):boolean{return this.recording?.handle===handle;}
 reset():void {this.recording?.queue.reset();this.clearContinuation();this.recording=undefined;this.primary=undefined;this.control=undefined;}
 private display(record:Recording,frame:OrdinarySourceCameraFrame,context:GenerationInput,recording:boolean,actualFrameRate:number,cancel?:()=>boolean,prepared?:PreparedImplicitPaletteControls):GeometryOutput {
  check(cancel);const scene={...(prepared?.current??record.control?.currentScene??record.author),parameters:record.numerical.parameters(),evaluatedSourceCamera:frame};
  const palette=prepared?.palette??record.control?.currentPalette;
  const output=generateImplicit(scene,{...context,time:frame.sceneTime,isCancelled:cancel,...(palette?{implicitPalettePrepared:palette}:{})});check(cancel);
  if(output.type!=='geometry'||output.sourceImplicitPresentation?.model!==record.presentationModel)throw Error('隐式录制未生成匹配的源网格显示模型');
  output.sourceImplicitParameters={model:'implicit-registry-1.7.8',values:{...scene.parameters}};
  output.sourceCameraFrame=ordinarySourceCameraFrame(scene,context);
  output.formulaPresentation=presentFormulas(record.formulas,context.sourceViewport);
  if(record.control)output.implicitControls={sessionId:record.control.sessionId,...(prepared?.receipt??record.control.receipt)};
  if(recording){
   if(frame.frameIndex<0||frame.frameIndex>record.clock.lastDisplayFrame||frame.queueComplete!==(frame.frameIndex===record.clock.lastDisplayFrame)||frame.rawDt!==Math.fround(1/Math.fround(record.clock.simulationFps)))throw Error('隐式录制实际帧与队列完成规划不一致');
   output.implicitRecording={displayFrame:frame.frameIndex,simulationFps:record.clock.simulationFps,actualFrameRate,warmup:frame.frameIndex===0,complete:frame.queueComplete};
  }
  if(!recording&&context.implicitLive){const live=record.liveClock!;output.implicitLive={sessionId:context.implicitLive.sessionId,paused:live.diagnostics().paused,clockSource:live.diagnostics().clockSource,actualFrameRate,renderKind:'snapshot'};}
  return output;
 }
 beginRecording(scene:SceneDocument,context:GenerateContext,options:SourceRecordingOptions){
  if(this.busy||!this.matchesCompletedPrimary(scene,context))throw Error('隐式录制需要匹配的已完成主预览');
  check(context.isCancelled);const observed=rate(options.actualFrameRate),fps=options.simulationFps;
  if(!Number.isSafeInteger(fps)||fps<1||fps>120)throw Error('隐式录制帧率必须为 1–120 的整数');
  const control=this.control,prepared=control?.prepareRecordingReset(context.isCancelled);
  const author=structuredClone(prepared?.current??this.primary!.anchor),callerAuthor=structuredClone(sourcePaletteRuntimeScene(scene)),camera=ordinarySourceCameraInitial(author);
  if(!camera||author.timeline.schedule!=='ordinary-camera-sequence-v1')throw Error('隐式录制缺少源相机与顺序队列');
  const layout=resolveOrdinarySourceCameraTimeline(camera,author.timeline.tracks,fps,{isCancelled:context.isCancelled,particleActions:'implicit'});
  if(layout.diagnostics.some(d=>d.code==='noncamera-clock'||d.code==='tracking-target-ignored'))throw Error('隐式录制尚未实现此非相机动作，不能忽略后继续录制');
  const updates=Math.max(1,layout.updates);
  if((updates-1)/fps>86400)throw Error('隐式录制超过本地 24 小时帧域');
  const clock:SourceQueueRecordingClock={simulationFps:fps,warmupUpdates:1,updates,encodedFrames:updates-1,firstEncodedUpdate:updates>1?2:null,lastDisplayFrame:updates-1,completionReason:'animation-queue'};
  const primary=snapshotGenerationInput(this.primary!.input),density=primary.sourcePointPixelDensity;
  if(density===undefined||!Number.isFinite(density)||density<=0)throw Error('隐式录制缺少主预览像素密度');
  primary.implicitLive={sessionId:crypto.randomUUID(),clock:{paused:false},actualFrameRate:observed};
  if(control&&prepared)primary.implicitControls={sessionId:control.sessionId,acknowledgedRevision:prepared.receipt.revision,commands:[]};
  const size=sourceRecordingSize(options,density);
  const presentationModel=this.primary!.presentationModel,displayTarget=prepareSourceImplicitOffscreenTarget(presentationModel,size,density,primary.sourceViewport!.logicalHeight);
  const target:GenerationInput={...primary,time:0,quality:'export',width:displayTarget.width,height:displayTarget.height,sourceViewport:{...ordinarySourceViewport(author,size.width,size.height,'offscreen',primary.sourceViewport!.logicalHeight),...displayTarget.sourceViewport}};
  const numerical=createSourceImplicitTimeline(author,fps,()=>this.cancel?.()??false),queue=numerical.queue;this.busy=true;this.cancel=context.isCancelled;
  try{
   const frame=queue.step(Math.fround(1/Math.fround(fps)),{actualFrameRate:observed});
   const record:Recording={presentationModel,handle:Object.freeze({}),author,callerAuthor,control,primary,target,clock,numerical,queue,formulas:resolveFormulaContent(author),frame,next:1,actualFrameRate:observed,cancel:context.isCancelled};
   const warmup=this.display(record,frame,target,true,observed,context.isCancelled,prepared);check(context.isCancelled);
   if(control&&prepared)control.commit(prepared);
   this.handoff?.queue.reset();this.continuation?.queue.reset();this.continuation=undefined;this.handoff=undefined;this.primary=undefined;this.recording=record;
   return{handle:record.handle,scene:structuredClone(callerAuthor),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
  }catch(error){queue.reset();throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 nextRecordingFrame(handle:object,index:number,actualFrameRate?:number){
  const record=this.recording;
  if(this.busy||!record||record.handle!==handle||record.finished||index!==record.next||index>record.clock.lastDisplayFrame)throw Error('隐式录制身份或连续帧序号无效');
  const observed=rate(actualFrameRate);
  if(record.pending&&!Object.is(record.pending.actualFrameRate,observed))throw Error('隐式录制重试不能改变已消费的实际帧率');
  this.busy=true;this.cancel=record.cancel;record.numerical.beginOperation();
  try{
   check(record.cancel);
   if(!record.pending){
    try{record.pending={frame:record.queue.step(Math.fround(1/Math.fround(record.clock.simulationFps)),{actualFrameRate:observed}),actualFrameRate:observed};}
    catch(error){this.reset();throw error;}
   }
   const output=this.display(record,record.pending.frame,record.target,true,observed,record.cancel);check(record.cancel);
   record.frame=record.pending.frame;record.actualFrameRate=observed;record.next++;record.pending=undefined;return output;
  }finally{this.busy=false;this.cancel=undefined;}
 }
 finishRecording(handle:object,timestampMs?:number){
  const record=this.recording??this.handoff;
  if(this.busy||!record||record.handle!==handle)throw Error('隐式录制结束身份无效');
  this.busy=true;
  try{
   // Stop does not update or inherit cancellation. A failed/detached
   // publication re-materializes the same numerical frame and fresh buffers.
   if(!record.finished){
    const frame=record.pending?.frame??record.frame,context={...snapshotGenerationInput(record.primary),time:frame.sceneTime};
    const observed=record.pending?.actualFrameRate??record.actualFrameRate;context.implicitLive={...context.implicitLive!,actualFrameRate:observed};
    record.liveClock=new SourceSceneHostClock(false,frame.camera);record.liveClock.resetTime(timestampMs);record.finished={frame,context};record.frame=frame;record.actualFrameRate=observed;
   }
   const {frame,context}=record.finished,preview=this.display(record,frame,context,false,record.pending?.actualFrameRate??record.actualFrameRate);
   this.primary={presentationModel:preview.sourceImplicitPresentation!.model,scene:record.callerAuthor,context,anchor:structuredClone(record.control?.coldScene??record.author),input:snapshotGenerationInput(context)};this.recording=undefined;this.handoff=record;this.continuation=record;
   return{scene:record.callerAuthor,context,preview};
  }finally{this.busy=false;this.cancel=undefined;}
 }
 private continued(scene:SceneDocument,context:GenerationInput):Recording {
  const record=this.continuation,live=context.implicitLive;validateSourceImplicitLiveContext(live!);
  const sameAuthor=record?.control?record.control===this.control&&context.implicitControls?.sessionId===record.control.sessionId:sameSourceRecordingValue(sourcePaletteRuntimeScene(scene),record?.callerAuthor);
  if(this.recording||this.busy||!record||record.liveFailed||record.primary.implicitLive?.sessionId!==live!.sessionId||!sameAuthor)throw Error('隐式继续播放需要原录制持有的场景，不能重建或套用到其它配置');
  if(context.sourceViewport?.target!=='primary'||context.domainLive||context.surfaceLive||context.fractalLive||context.perlinLive||context.rootsLive||context.samilaLive||context.mapLive||context.symmetryLive||context.fractalRecording)throw Error('隐式继续播放只接受自身主视口');
  record.liveClock!.assertPaused(live!.clock.paused);return record;
 }
 generateContinuation(scene:SceneDocument,context:GenerateContext):GeometryOutput {
  if(context.implicitControls||this.control)throw Error('隐式受控继续播放必须经过色板控制事务');
  return this.continueFrame(scene,context);
 }
 private continueFrame(scene:SceneDocument,context:GenerateContext,prepared?:PreparedImplicitPaletteControls,commit?:()=>void):GeometryOutput {
  const record=this.continued(scene,context),live=context.implicitLive!,observed=rate(live.actualFrameRate);check(context.isCancelled);this.busy=true;this.cancel=context.isCancelled;this.primary=undefined;this.handoff=undefined;record.numerical.beginOperation();
  try{
   const snapshot=live.clock.paused;
   const frame=snapshot?record.queue.display():record.queue.step(record.liveClock!.update(live.clock),{actualFrameRate:observed});
   record.frame=frame;record.actualFrameRate=observed;
   const output=this.display(record,frame,context,false,observed,context.isCancelled,prepared);output.implicitLive!.renderKind=snapshot?'snapshot':'update';
   const anchor=structuredClone(record.control?.coldScene??record.author),input=snapshotGenerationInput(context),callerAuthor=structuredClone(sourcePaletteRuntimeScene(scene));
   commit?.();record.callerAuthor=callerAuthor;
   this.primary={presentationModel:output.sourceImplicitPresentation!.model,scene,context,anchor,input};return output;
  }catch(error){record.liveFailed=true;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Read the held queue without a numerical update or clock reset. Geometry
  * and transfer buffers are disposable; the numerical owner survives failure. */
 capturePaused(scene:SceneDocument,context:GenerationInput,size:{width:number;height:number},scale:1|3|5):SourceGeometryCapturePreparation {
  if(!this.matchesCompletedPrimary(scene,context))throw Error('隐式截图需要当前已完成的暂停主预览');
  const record=this.continued(scene,context),plan=sourceGeometryCapturePlan(context,size,scale,this.primary!.presentationModel);
  record.liveClock!.assertPaused(true);this.busy=true;
  try{
   const frame=record.queue.display();
   const capture=this.display(record,frame,plan.captureContext,false,record.actualFrameRate);
   const preview=this.display(record,frame,context,false,record.actualFrameRate);
   return{scene:structuredClone(record.callerAuthor),capture,preview};
  }finally{this.busy=false;}
 }
 setPaused(scene:SceneDocument,context:GenerationInput,paused:boolean,timestampMs?:number){
  if(!this.matchesCompletedPrimary(scene,context))throw Error('隐式暂停控制需要当前已完成的主预览');
  const record=this.continued(scene,context),clock=record.liveClock!;
  const restore=clock.setPaused(paused,record.frame.camera,timestampMs);if(restore)record.queue.writeAngles(restore);
  record.frame=record.queue.snapshot();this.handoff=undefined;
  const next={...context,implicitLive:{...context.implicitLive!,clock:{...context.implicitLive!.clock,paused}}};
  this.primary={presentationModel:this.primary!.presentationModel,scene,context:next,anchor:structuredClone(record.author),input:snapshotGenerationInput(next)};
  return next;
 }

}
